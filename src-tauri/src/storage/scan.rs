//! Walks a directory tree and builds a compact size tree.
//!
//! Sizes are space actually allocated on disk where the OS tells us (Unix block counts),
//! hard-linked files are counted once, and the walk never crosses into another volume.
//! Files under `KEEP_THRESHOLD` are folded into one "N small files" entry per folder so
//! scanning a whole disk stays light in memory.

use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, UNIX_EPOCH};

pub const NONE: u32 = u32::MAX;
const KEEP_THRESHOLD: u64 = 1_000_000;

/// Files and folders that mark a directory as a code project.
pub mod marker {
    pub const GIT: u8 = 1;
    pub const NODE: u8 = 2;
    pub const CARGO: u8 = 4;
    pub const GRADLE: u8 = 8;
    pub const PYTHON: u8 = 16;
    pub const SWIFT: u8 = 32;

    pub fn for_name(name: &str) -> u8 {
        match name {
            ".git" => GIT,
            "package.json" => NODE,
            "Cargo.toml" => CARGO,
            "build.gradle" | "build.gradle.kts" | "settings.gradle" | "settings.gradle.kts" => GRADLE,
            "pyproject.toml" | "requirements.txt" | "setup.py" => PYTHON,
            "Package.swift" => SWIFT,
            _ => 0,
        }
    }
}

#[derive(Clone)]
pub struct Node {
    pub name: String,
    pub size: u64,
    pub files: u64,
    pub dir: bool,
    pub aggregate: bool,
    pub virt: bool,
    pub unreadable: bool,
    pub markers: u8,
    pub modified: i64,
    pub category: u8,
    pub parent: u32,
    pub children: Vec<u32>,
}

impl Node {
    fn new(name: String, dir: bool, parent: u32) -> Self {
        Node {
            name,
            size: 0,
            files: 0,
            dir,
            aggregate: false,
            virt: false,
            unreadable: false,
            markers: 0,
            modified: 0,
            category: 1,
            parent,
            children: Vec::new(),
        }
    }
}

pub struct Tree {
    pub nodes: Vec<Node>,
    pub unreadable: Vec<u32>,
}

impl Tree {
    pub fn node(&self, id: u32) -> &Node {
        &self.nodes[id as usize]
    }

    pub fn push(&mut self, node: Node) -> u32 {
        self.nodes.push(node);
        (self.nodes.len() - 1) as u32
    }

    pub fn navigable(&self, id: u32) -> bool {
        let n = self.node(id);
        n.dir && !n.children.is_empty()
    }

    /// Full path; the root node's name is the scanned path itself.
    pub fn path(&self, id: u32) -> PathBuf {
        let mut parts = Vec::new();
        let mut cur = id;
        while cur != NONE {
            let n = self.node(cur);
            if !n.aggregate {
                parts.push(n.name.as_str());
            }
            cur = n.parent;
        }
        let mut p = PathBuf::new();
        for part in parts.iter().rev() {
            p.push(part);
        }
        p
    }

    /// Closest real location (virtual and aggregate entries resolve to their folder).
    pub fn real_path(&self, id: u32) -> PathBuf {
        let mut cur = id;
        while cur != NONE {
            let n = self.node(cur);
            if !n.virt && !n.aggregate {
                return self.path(cur);
            }
            cur = n.parent;
        }
        self.path(0)
    }

    pub fn child_named(&self, id: u32, name: &str) -> Option<u32> {
        self.node(id).children.iter().copied().find(|&c| self.node(c).name == name)
    }

    pub fn sort_children(&mut self, id: u32) {
        let mut kids = std::mem::take(&mut self.nodes[id as usize].children);
        kids.sort_by(|a, b| self.nodes[*b as usize].size.cmp(&self.nodes[*a as usize].size));
        self.nodes[id as usize].children = kids;
    }
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub files: u64,
    pub bytes: u64,
    pub path: String,
}

struct Walker<'a> {
    tree: Tree,
    seen: HashSet<(u64, u64)>,
    cancel: &'a AtomicBool,
    progress: &'a dyn Fn(Progress),
    files: u64,
    bytes: u64,
    last_report: Instant,
    root_dev: Option<u64>,
}

pub fn scan(root: &Path, cancel: &AtomicBool, progress: &dyn Fn(Progress)) -> Option<Tree> {
    let meta = fs::symlink_metadata(root).ok()?;
    let mut w = Walker {
        tree: Tree { nodes: Vec::with_capacity(1 << 16), unreadable: Vec::new() },
        seen: HashSet::new(),
        cancel,
        progress,
        files: 0,
        bytes: 0,
        last_report: Instant::now(),
        root_dev: device(&meta),
    };
    w.walk(root, root.to_string_lossy().into_owned(), NONE, &meta)?;
    Some(w.tree)
}

impl Walker<'_> {
    fn walk(&mut self, path: &Path, name: String, parent: u32, meta: &Metadata) -> Option<u32> {
        if self.cancel.load(Ordering::Relaxed) {
            return None;
        }
        let mut node = Node::new(name, true, parent);
        node.size = allocated(meta);
        node.modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let id = self.tree.push(node);

        let entries = match fs::read_dir(path) {
            Ok(e) => e,
            Err(_) => {
                self.tree.nodes[id as usize].unreadable = true;
                self.tree.unreadable.push(id);
                return Some(id);
            }
        };

        let (mut small_bytes, mut small_count) = (0u64, 0u64);
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().into_owned();
            let bit = marker::for_name(&fname);
            if bit != 0 {
                self.tree.nodes[id as usize].markers |= bit;
            }
            let Ok(ft) = entry.file_type() else { continue };
            let Ok(meta) = entry.metadata() else { continue };

            if ft.is_dir() && !ft.is_symlink() {
                // Don't wander into other mounted volumes.
                if self.root_dev.is_some() && device(&meta) != self.root_dev {
                    continue;
                }
                let child = self.walk(&entry.path(), fname, id, &meta)?;
                let (size, files) = (self.tree.node(child).size, self.tree.node(child).files);
                let n = &mut self.tree.nodes[id as usize];
                n.children.push(child);
                n.size += size;
                n.files += files;
                continue;
            }

            if let Some(key) = hardlink_key(&meta) {
                if !self.seen.insert(key) {
                    continue;
                }
            }
            let size = allocated(&meta);
            self.files += 1;
            self.bytes += size;
            if size >= KEEP_THRESHOLD {
                let mut f = Node::new(fname, false, id);
                f.size = size;
                f.files = 1;
                let fid = self.tree.push(f);
                let n = &mut self.tree.nodes[id as usize];
                n.children.push(fid);
                n.size += size;
                n.files += 1;
            } else {
                small_bytes += size;
                small_count += 1;
            }

            if self.files % 2048 == 0 && self.last_report.elapsed().as_millis() > 120 {
                self.last_report = Instant::now();
                (self.progress)(Progress {
                    files: self.files,
                    bytes: self.bytes,
                    path: entry.path().to_string_lossy().into_owned(),
                });
            }
        }

        if small_count > 0 {
            let label = if small_count == 1 { "1 small file".to_string() } else { format!("{} small files", group_thousands(small_count)) };
            let mut bucket = Node::new(label, false, id);
            bucket.aggregate = true;
            bucket.size = small_bytes;
            bucket.files = small_count;
            let bid = self.tree.push(bucket);
            let n = &mut self.tree.nodes[id as usize];
            n.children.push(bid);
            n.size += small_bytes;
            n.files += small_count;
        }
        self.tree.sort_children(id);
        Some(id)
    }
}

fn group_thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(unix)]
fn allocated(meta: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.blocks() * 512
}

#[cfg(not(unix))]
fn allocated(meta: &Metadata) -> u64 {
    meta.len()
}

#[cfg(unix)]
fn device(meta: &Metadata) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    Some(meta.dev())
}

#[cfg(not(unix))]
fn device(_meta: &Metadata) -> Option<u64> {
    None
}

#[cfg(unix)]
fn hardlink_key(meta: &Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    (meta.is_file() && meta.nlink() > 1).then(|| (meta.dev(), meta.ino()))
}

#[cfg(not(unix))]
fn hardlink_key(_meta: &Metadata) -> Option<(u64, u64)> {
    None
}
