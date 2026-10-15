//! Storage scanning session: the scanned tree, its analysis, and what the UI asks for.

mod analysis;
mod ollama;
mod rules;
mod scan;

use analysis::Analysis;
use rules::Kind;
use scan::{Tree, NONE};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Instant;

pub use scan::Progress;

pub struct Session {
    tree: Tree,
    analysis: Analysis,
    root_path: PathBuf,
    home: PathBuf,
    duration: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    root_id: u32,
    root_path: String,
    size: u64,
    files: u64,
    unreadable: usize,
    duration: f64,
    recommendations: Vec<RecDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecDto {
    id: String,
    title: String,
    subtitle: String,
    safe: bool,
    size: u64,
    detail: String,
    items: Vec<RecItem>,
    commands: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecItem {
    node: u32,
    name: String,
    path: String,
    real_path: String,
    size: u64,
}

/// A node as the treemap sees it. Single-child folder chains are collapsed into one entry.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewNode {
    id: u32,
    /// The deepest folder of a collapsed chain; this is what opens on click.
    open_id: u32,
    label: String,
    size: u64,
    dir: bool,
    navigable: bool,
    virt: bool,
    aggregate: bool,
    unreadable: bool,
    category: u8,
    rec: Option<String>,
    path: String,
    children: Vec<ViewNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    root: ViewNode,
    crumbs: Vec<Crumb>,
}

#[derive(Serialize)]
pub struct Crumb {
    id: u32,
    name: String,
}

pub fn run_scan(root: PathBuf, home: PathBuf, cancel: &AtomicBool, progress: &dyn Fn(Progress)) -> Result<Session, String> {
    let start = Instant::now();
    let mut tree = scan::scan(&root, cancel, progress).ok_or_else(|| "cancelled".to_string())?;
    let analysis = analysis::analyze(&mut tree, &root, &home);
    Ok(Session { tree, analysis, root_path: root, home, duration: start.elapsed().as_secs_f64() })
}

impl Session {
    pub fn summary(&self) -> ScanSummary {
        let root = self.tree.node(0);
        ScanSummary {
            root_id: 0,
            root_path: self.root_path.to_string_lossy().into_owned(),
            size: root.size,
            files: root.files,
            unreadable: self.tree.unreadable.len(),
            duration: self.duration,
            recommendations: self.analysis.recs.iter().map(|r| self.rec_dto(r)).collect(),
        }
    }

    fn display(&self, p: &Path) -> String {
        let s = analysis::normalize(&p.to_string_lossy());
        let home = analysis::normalize(&self.home.to_string_lossy());
        let shown = match s.strip_prefix(&home) {
            Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("~{rest}"),
            _ => s,
        };
        if rules::windows() { shown.replace('/', "\\") } else { shown }
    }

    fn rec_dto(&self, r: &analysis::Rec) -> RecDto {
        let t = &self.tree;
        let mut items: Vec<RecItem> = r
            .nodes
            .iter()
            .map(|&n| RecItem {
                node: n,
                name: t.node(n).name.clone(),
                path: self.display(&t.path(n)),
                real_path: t.real_path(n).to_string_lossy().into_owned(),
                size: t.node(n).size,
            })
            .collect();
        items.sort_by(|a, b| b.size.cmp(&a.size));
        RecDto {
            id: r.id.clone(),
            title: r.title.clone(),
            subtitle: self.subtitle(r),
            safe: r.kind.safe(),
            size: r.size(t),
            detail: r.kind.detail().to_string(),
            items,
            commands: self.commands(r),
        }
    }

    fn subtitle(&self, r: &analysis::Rec) -> String {
        let t = &self.tree;
        match r.kind {
            Kind::NextTurbo | Kind::RustTarget | Kind::NodeModules => {
                let mut names: Vec<&str> = r.nodes.iter().map(|&n| t.node(n).name.as_str()).collect();
                names.sort();
                names.dedup();
                let roots: std::collections::BTreeSet<String> = r
                    .nodes
                    .iter()
                    .filter_map(|&n| {
                        let p = t.node(n).parent;
                        (p != NONE && t.node(p).parent != NONE).then(|| self.display(&t.path(t.node(p).parent)))
                    })
                    .collect();
                if roots.len() == 1 {
                    format!("{}/*/{}", roots.iter().next().unwrap(), names.join(", "))
                } else {
                    format!("{} projects · {}", r.nodes.len(), names.join(", "))
                }
            }
            Kind::Ollama => r.nodes.first().map(|&n| {
                let n = if t.node(n).virt { t.node(t.node(n).parent).parent } else { n };
                self.display(&t.path(n))
            }).unwrap_or_default(),
            Kind::Installers => format!("~/Downloads · {} files", r.nodes.len()),
            Kind::AppCaches | Kind::ToolCaches => {
                let mut s: Vec<String> = r.nodes.iter().take(3).map(|&n| self.display(&t.path(n))).collect();
                if r.nodes.len() > 3 {
                    s.push("…".into());
                }
                s.join(", ")
            }
            _ => {
                let mut s: Vec<String> = r.nodes.iter().map(|&n| self.display(&t.path(n))).collect();
                s.sort();
                s.dedup();
                s.join(", ")
            }
        }
    }

    fn commands(&self, r: &analysis::Rec) -> Vec<String> {
        let t = &self.tree;
        let path = |n: u32| t.path(n).to_string_lossy().into_owned();
        match r.kind {
            Kind::Ollama => r.nodes.iter().filter(|&&n| t.node(n).virt).map(|&n| format!("ollama rm {}", rules::quote(&t.node(n).name))).collect(),
            Kind::Trash if cfg!(target_os = "macos") => vec![r#"osascript -e 'tell application "Finder" to empty trash'"#.into()],
            Kind::Trash | Kind::TempFiles => r.nodes.iter().map(|&n| rules::empty_folder(&path(n))).collect(),
            Kind::SimDevices => vec!["xcrun simctl delete unavailable".into()],
            Kind::Docker => vec!["docker system prune -a -f".into()],
            Kind::Homebrew => std::iter::once("brew cleanup --prune=all".to_string()).chain(r.nodes.iter().map(|&n| rules::remove(&path(n)))).collect(),
            Kind::GoMod => vec!["go clean -modcache".into()],
            Kind::Worktrees => {
                let Some(repo) = &r.project else { return vec![] };
                let mut out: Vec<String> = r
                    .nodes
                    .iter()
                    .flat_map(|&n| t.node(n).children.clone())
                    .filter(|&c| t.node(c).dir)
                    .map(|c| {
                        let wt = path(c);
                        if rules::windows() {
                            format!("git -C {} worktree remove --force {}", rules::quote(repo), rules::quote(&wt))
                        } else {
                            format!("git -C {} worktree remove --force {} 2>/dev/null || {}", rules::quote(repo), rules::quote(&wt), rules::remove(&wt))
                        }
                    })
                    .collect();
                out.push(format!("git -C {} worktree prune", rules::quote(repo)));
                out
            }
            _ => r.nodes.iter().map(|&n| rules::remove(&path(n))).collect(),
        }
    }

    pub fn script(&self, ids: &[String]) -> String {
        let recs: Vec<&analysis::Rec> = self.analysis.recs.iter().filter(|r| ids.contains(&r.id)).collect();
        let total: u64 = recs.iter().map(|r| r.size(&self.tree)).sum();
        let mut lines: Vec<String> = if rules::windows() {
            vec![
                "# DiskLens cleanup script (PowerShell)".into(),
                format!("# Frees about {} across {} item(s). Read it before running.", fmt_size(total), recs.len()),
                "# Run: paste into PowerShell.".into(),
                String::new(),
            ]
        } else {
            vec![
                "#!/bin/bash".into(),
                "# DiskLens cleanup script".into(),
                format!("# Frees about {} across {} item(s). Read it before running.", fmt_size(total), recs.len()),
                "# Run: paste into a terminal, or save as cleanup.sh and run `bash cleanup.sh`.".into(),
                "set -u".into(),
                String::new(),
            ]
        };
        for r in recs {
            let size = fmt_size(r.size(&self.tree));
            lines.push(format!("# {}: {}{}", rules::comment(&r.title), size, if r.kind.safe() { "" } else { " (reviewed by you)" }));
            lines.push(rules::echo(&format!("-> {} ({size})", r.title)));
            lines.extend(self.commands(r));
            lines.push(String::new());
        }
        lines.push(rules::echo("Done. Rescan in DiskLens to see the result."));
        lines.join("\n") + "\n"
    }

    pub fn view(&self, id: u32) -> Option<View> {
        if id as usize >= self.tree.nodes.len() {
            return None;
        }
        let total = self.tree.node(id).size.max(1);
        // Anything under ~1/5000 of the view can't be seen, so it isn't sent.
        let min = total / 5000;
        let root = self.view_node(id, 3, min, false);
        let mut crumbs = Vec::new();
        let mut cur = id;
        while cur != NONE {
            let n = self.tree.node(cur);
            let name = if n.parent == NONE { self.display(&self.root_path) } else { n.name.clone() };
            crumbs.push(Crumb { id: cur, name });
            cur = n.parent;
        }
        crumbs.reverse();
        Some(View { root, crumbs })
    }

    fn view_node(&self, id: u32, depth: u32, min: u64, collapse: bool) -> ViewNode {
        let t = &self.tree;
        let mut content = id;
        let mut label = vec![t.node(id).name.clone()];
        let mut rec = self.analysis.node_rec.get(&id).copied();
        if collapse {
            while let Some(&only) = t.node(content).children.first() {
                let (c, o) = (t.node(content), t.node(only));
                if !(o.dir && t.navigable(only) && o.size as f64 >= c.size as f64 * 0.95) {
                    break;
                }
                content = only;
                label.push(o.name.clone());
                rec = rec.or_else(|| self.analysis.node_rec.get(&content).copied());
            }
        }
        let n = t.node(id);
        let cap = match depth { 3 => 80, 2 => 40, _ => 20 };
        let children = if depth > 0 {
            t.node(content)
                .children
                .iter()
                .copied()
                .filter(|&c| t.node(c).size >= min && t.node(c).size > 0)
                .take(cap)
                .map(|c| self.view_node(c, depth - 1, min, true))
                .collect()
        } else {
            Vec::new()
        };
        ViewNode {
            id,
            open_id: content,
            label: label.join(" / "),
            size: n.size,
            dir: n.dir,
            navigable: t.navigable(content),
            virt: n.virt,
            aggregate: n.aggregate,
            unreadable: n.unreadable,
            category: t.node(content).category & 0x7f,
            rec: rec.map(|i| self.analysis.recs[i].id.clone()),
            path: t.real_path(id).to_string_lossy().into_owned(),
            children,
        }
    }

    /// The folder to open so `id` shows as its own tile.
    pub fn locate(&self, id: u32) -> u32 {
        let mut cur = self.tree.node(id).parent;
        while cur != NONE && (self.tree.node(cur).virt || !self.tree.navigable(cur)) {
            cur = self.tree.node(cur).parent;
        }
        if cur == NONE { 0 } else { cur }
    }
}

/// Disk sizes in decimal units, like Finder and Explorer: "92 GB", "41.7 GB", "530 MB".
pub fn fmt_size(bytes: u64) -> String {
    let b = bytes as f64;
    if b >= 100e9 {
        format!("{:.0} GB", b / 1e9)
    } else if b >= 1e9 {
        format!("{:.1} GB", b / 1e9)
    } else if b >= 1e6 {
        format!("{:.0} MB", b / 1e6)
    } else {
        format!("{:.0} KB", b / 1e3)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![7u8; bytes]).unwrap();
    }

    /// A fake home folder with a few caches, projects and an Ollama model.
    fn fixture(name: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("disklens-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        write(&home.join(".npm/_cacache/big"), 60_000_000);
        write(&home.join("Desktop/site/package.json"), 10);
        write(&home.join("Desktop/site/.next/cache/big"), 55_000_000);
        write(&home.join("Desktop/site/src/index.ts"), 2_000);
        write(&home.join("code/tool/Cargo.toml"), 10);
        write(&home.join("code/tool/target/debug/big"), 70_000_000);
        write(&home.join("Documents/notes.txt"), 5_000);
        let digest = "sha256-aaaa";
        write(&home.join(format!(".ollama/models/blobs/{digest}")), 80_000_000);
        write(
            &home.join(".ollama/models/manifests/registry.ollama.ai/library/tiny/latest"),
            0,
        );
        fs::write(
            home.join(".ollama/models/manifests/registry.ollama.ai/library/tiny/latest"),
            r#"{"layers":[{"digest":"sha256:aaaa","size":80000000}],"config":{"digest":"sha256:none"}}"#,
        )
        .unwrap();
        home
    }

    #[test]
    fn scans_and_recommends() {
        let home = fixture("scan");
        let cancel = AtomicBool::new(false);
        let session = run_scan(home.clone(), home.clone(), &cancel, &|_| {}).unwrap();
        let summary = session.summary();

        // Every byte written is accounted for (allocated sizes can only round up).
        assert!(summary.size >= 60_000_000 + 55_000_000 + 70_000_000 + 80_000_000);

        let ids: Vec<&str> = summary.recommendations.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"npm"), "{ids:?}");
        assert!(ids.contains(&"nextturbo"), "{ids:?}");
        assert!(ids.contains(&"rusttarget"), "{ids:?}");
        assert!(ids.contains(&"ollama"), "{ids:?}");

        let ollama = summary.recommendations.iter().find(|r| r.id == "ollama").unwrap();
        assert_eq!(ollama.items[0].name, "tiny:latest");
        assert_eq!(ollama.commands, vec![format!("ollama rm {}", rules::quote("tiny:latest"))]);
        assert!(!ollama.safe);

        let script = session.script(&["npm".into(), "rusttarget".into()]);
        assert!(script.contains(".npm"));
        assert!(script.contains("target"));
        assert!(!script.contains(".next"), "unselected items must not be in the script");

        // The treemap view collapses chains and stays within the requested depth.
        let view = session.view(0).unwrap();
        assert!(!view.root.children.is_empty());
        assert_eq!(view.crumbs.len(), 1);

        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn cancelled_scan_returns_error() {
        let home = fixture("cancel");
        let cancel = AtomicBool::new(true);
        assert!(run_scan(home.clone(), home.clone(), &cancel, &|_| {}).is_err());
        let _ = fs::remove_dir_all(&home);
    }
}
