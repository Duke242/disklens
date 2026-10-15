//! Ollama stores models as content-addressed blobs. Rebuild them as named entries from its manifests.

use super::scan::{Node, Tree};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

pub const UNUSED: &str = "unused blobs";

pub fn expand(tree: &mut Tree, models: u32) {
    let Some(blobs) = tree.child_named(models, "blobs") else { return };
    let manifests = tree.path(models).join("manifests");

    let mut by_digest: HashMap<String, u32> = HashMap::new();
    for &b in &tree.node(blobs).children {
        let n = tree.node(b);
        if !n.aggregate {
            by_digest.insert(n.name.replacen("sha256-", "sha256:", 1), b);
        }
    }

    let mut files = Vec::new();
    collect_files(&manifests, &mut files);
    let mut owned = HashSet::new();
    let mut entries: Vec<(String, u64)> = Vec::new();
    for file in files {
        let Ok(text) = fs::read_to_string(&file) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let Ok(rel) = file.strip_prefix(&manifests) else { continue };
        let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        if parts.len() < 2 {
            continue;
        }
        let name = format!("{}:{}", parts[..parts.len() - 1].join("/"), parts[parts.len() - 1])
            .replace("registry.ollama.ai/library/", "");

        let mut layers: Vec<&serde_json::Value> = json["layers"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
        layers.push(&json["config"]);
        let mut size = 0;
        for layer in layers {
            let Some(digest) = layer["digest"].as_str() else { continue };
            let Some(&blob) = by_digest.get(digest) else { continue };
            if owned.insert(digest.to_string()) {
                size += tree.node(blob).size;
            }
        }
        if size > 0 {
            entries.push((name, size));
        }
    }
    if entries.is_empty() {
        return;
    }

    let blobs_size = tree.node(blobs).size;
    let model_bytes: u64 = entries.iter().map(|e| e.1).sum();
    if blobs_size > model_bytes {
        entries.push((UNUSED.to_string(), blobs_size - model_bytes));
    }
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    let mut kids = Vec::new();
    for (name, size) in entries {
        let n = Node {
            name,
            size,
            files: 1,
            dir: false,
            aggregate: false,
            virt: true,
            unreadable: false,
            markers: 0,
            modified: 0,
            category: 4,
            parent: blobs,
            children: Vec::new(),
        };
        kids.push(tree.push(n));
    }
    tree.nodes[blobs as usize].children = kids;
}

fn collect_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            collect_files(&e.path(), out);
        } else if ft.is_file() {
            out.push(e.path());
        }
    }
}
