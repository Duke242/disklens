//! Assigns a category to every folder and finds cleanup candidates.

use super::rules::{self, Category, Kind};
use super::scan::{marker, Node, Tree, NONE};
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MINIMUM_SIZE: u64 = 50_000_000;

pub struct Rec {
    pub id: String,
    pub kind: Kind,
    pub title: String,
    pub nodes: Vec<u32>,
    pub project: Option<String>,
}

impl Rec {
    pub fn size(&self, tree: &Tree) -> u64 {
        self.nodes.iter().map(|&n| tree.node(n).size).sum()
    }
}

pub struct Analysis {
    pub recs: Vec<Rec>,
    /// Node id → index into `recs`.
    pub node_rec: HashMap<u32, usize>,
}

struct Ctx {
    home: String,
    category_folders: HashMap<&'static str, Category>,
    rule_folders: HashMap<&'static str, Kind>,
    idle_cutoff: i64,
    recs: Vec<Rec>,
    rec_index: HashMap<String, usize>,
}

pub fn analyze(tree: &mut Tree, root_path: &Path, home: &Path) -> Analysis {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let mut ctx = Ctx {
        home: normalize(&home.to_string_lossy()),
        category_folders: rules::category_folders(),
        rule_folders: rules::rule_folders(),
        idle_cutoff: now - 30 * 86400,
        recs: Vec::new(),
        rec_index: HashMap::new(),
    };
    let root_abs = normalize(&root_path.to_string_lossy());
    visit(tree, &mut ctx, 0, &root_abs, None, false, false);

    let mut recs: Vec<Rec> = ctx.recs.into_iter().filter(|r| r.size(tree) >= MINIMUM_SIZE).collect();
    recs.sort_by(|a, b| b.size(tree).cmp(&a.size(tree)));
    let mut node_rec = HashMap::new();
    for (i, r) in recs.iter().enumerate() {
        for &n in &r.nodes {
            node_rec.insert(n, i);
        }
    }
    Analysis { recs, node_rec }
}

fn add(ctx: &mut Ctx, tree: &Tree, kind: Kind, node: u32, key: Option<String>, title: Option<String>, project: Option<String>) {
    let id = key.unwrap_or_else(|| kind.id().to_string());
    let idx = *ctx.rec_index.entry(id.clone()).or_insert_with(|| {
        ctx.recs.push(Rec { id, kind, title: title.unwrap_or_else(|| kind.title().to_string()), nodes: Vec::new(), project: None });
        ctx.recs.len() - 1
    });
    let rec = &mut ctx.recs[idx];
    if project.is_some() {
        rec.project = project;
    }
    if kind == Kind::Ollama {
        // Point at the individual models when we could identify them.
        let models: Vec<u32> = tree
            .child_named(node, "blobs")
            .map(|b| tree.node(b).children.iter().copied().filter(|&c| tree.node(c).virt && tree.node(c).name != super::ollama::UNUSED).collect())
            .unwrap_or_default();
        if models.is_empty() { rec.nodes.push(node) } else { rec.nodes.extend(models) }
    } else {
        rec.nodes.push(node);
    }
}

/// Returns per-category byte totals for the subtree, and sets each node's category.
fn visit(tree: &mut Tree, ctx: &mut Ctx, id: u32, abs: &str, rel_in: Option<&str>, in_node_modules: bool, claimed: bool) -> [u64; 6] {
    let rel_owned;
    let rel: Option<&str> = match rel_in {
        Some(r) => Some(r),
        None => {
            rel_owned = relative(abs, &ctx.home);
            rel_owned.as_deref()
        }
    };
    let (is_dir, markers) = (tree.node(id).dir, tree.node(id).markers);

    if is_dir && rel == Some(".ollama/models") {
        super::ollama::expand(tree, id);
    }

    let mut context: Option<Category> = None;
    if let Some(cur) = inherited_category(tree, id) {
        context = Some(cur);
    }
    if is_dir {
        if let Some(r) = rel {
            if let Some(&c) = ctx.category_folders.get(r) {
                context = Some(c);
            }
        }
        if markers != 0 && matches!(context, None | Some(Category::Documents) | Some(Category::Other)) {
            context = Some(Category::Code);
        }
    }

    let mut claimed_here = claimed;
    if !claimed {
        if let Some(r) = rel {
            claimed_here = match_rules(tree, ctx, id, r, in_node_modules);
        }
    }

    if !is_dir {
        let n = tree.node(id);
        let ext = Path::new(&n.name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let cat = context.unwrap_or(if rules::MEDIA_EXTENSIONS.contains(&ext.as_str()) {
            Category::Documents
        } else if rules::MODEL_EXTENSIONS.contains(&ext.as_str()) && n.size > 500_000_000 {
            Category::Ai
        } else {
            Category::Other
        });
        let size = n.size;
        tree.nodes[id as usize].category = cat as u8;
        let mut t = [0u64; 6];
        t[cat as usize] = size;
        return t;
    }

    if let Some(c) = context {
        // Children inherit this folder's context unless they find a more specific one.
        tree.nodes[id as usize].category = c as u8 | CATEGORY_SET;
    }
    let child_in_nm = in_node_modules || tree.node(id).name == "node_modules";
    let mut totals = [0u64; 6];
    for c in tree.node(id).children.clone() {
        let child: &Node = tree.node(c);
        let child_abs = if child.aggregate || child.virt { abs.to_string() } else { format!("{abs}{}{}", if abs.ends_with('/') { "" } else { "/" }, child.name) };
        let child_rel = match rel {
            Some(r) if !child.aggregate && !child.virt => Some(if r.is_empty() { child.name.clone() } else { format!("{r}/{}", child.name) }),
            Some(r) => Some(r.to_string()),
            None => None,
        };
        let t = visit(tree, ctx, c, &child_abs, child_rel.as_deref(), child_in_nm, claimed_here);
        for i in 0..6 {
            totals[i] += t[i];
        }
    }
    let cat = match context {
        Some(c) => c,
        None => {
            let (best, &bytes) = totals.iter().enumerate().max_by_key(|(_, b)| **b).unwrap();
            if bytes > 0 { Category::from_u8(best as u8) } else { Category::Other }
        }
    };
    tree.nodes[id as usize].category = cat as u8;
    totals
}

/// Marks a category that was set by context (so children inherit it) rather than computed.
const CATEGORY_SET: u8 = 0x80;

fn inherited_category(tree: &Tree, id: u32) -> Option<Category> {
    let p = tree.node(id).parent;
    if p == NONE {
        return None;
    }
    let c = tree.node(p).category;
    (c & CATEGORY_SET != 0).then(|| Category::from_u8(c & !CATEGORY_SET))
}

/// Returns true when `id` (and so its whole subtree) was claimed by a rule.
fn match_rules(tree: &Tree, ctx: &mut Ctx, id: u32, rel: &str, in_node_modules: bool) -> bool {
    let n = tree.node(id);
    if !n.dir {
        if n.virt || n.aggregate {
            return false;
        }
        let ext = Path::new(&n.name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if rel.starts_with("Downloads/") && rules::INSTALLER_EXTENSIONS.contains(&ext.as_str()) {
            add(ctx, tree, Kind::Installers, id, None, None, None);
            return true;
        }
        return false;
    }
    if let Some(&kind) = ctx.rule_folders.get(rel) {
        add(ctx, tree, kind, id, None, None, None);
        return true;
    }
    if in_node_modules || n.parent == NONE {
        return false;
    }
    let parent = tree.node(n.parent);
    let parent_rel = rel.rsplit_once('/').map(|(p, _)| p).unwrap_or("");

    if (n.name == ".next" || n.name == ".turbo") && parent.markers & marker::NODE != 0 {
        add(ctx, tree, Kind::NextTurbo, id, None, None, None);
        return true;
    }
    if n.name == "target" && parent.markers & marker::CARGO != 0 {
        add(ctx, tree, Kind::RustTarget, id, None, None, None);
        return true;
    }
    if n.name == "node_modules" && parent.markers & marker::NODE != 0 && parent.modified > 0 && parent.modified < ctx.idle_cutoff {
        add(ctx, tree, Kind::NodeModules, id, None, None, None);
        return true;
    }
    if n.name == "worktrees" && parent.name == ".claude" && parent.parent != NONE {
        let repo = tree.real_path(parent.parent).to_string_lossy().into_owned();
        let repo_name = tree.node(parent.parent).name.clone();
        add(ctx, tree, Kind::Worktrees, id, Some(format!("worktrees:{repo}")), Some(format!("{repo_name} worktrees")), Some(repo));
        return true;
    }
    if Some(parent_rel) == rules::app_cache_parent() {
        add(ctx, tree, Kind::AppCaches, id, None, None, None);
        return true;
    }
    if Some(parent_rel) == rules::tool_cache_parent() && ctx.category_folders.get(rel) != Some(&Category::Ai) {
        add(ctx, tree, Kind::ToolCaches, id, None, None, None);
        return true;
    }
    false
}

const MAC_DATA_PREFIX: &str = "/System/Volumes/Data";

/// Uses `/` separators and drops macOS's Data-volume prefix, so paths compare against the home folder.
pub fn normalize(path: &str) -> String {
    let p = path.replace('\\', "/");
    if cfg!(target_os = "macos") && p.starts_with(&format!("{MAC_DATA_PREFIX}/")) {
        return p[MAC_DATA_PREFIX.len()..].to_string();
    }
    p
}

fn relative(abs: &str, home: &str) -> Option<String> {
    let (a, h) = if cfg!(target_os = "windows") { (abs.to_lowercase(), home.to_lowercase()) } else { (abs.to_string(), home.to_string()) };
    if a == h {
        return Some(String::new());
    }
    let prefix = format!("{}/", h.trim_end_matches('/'));
    a.starts_with(&prefix).then(|| abs[prefix.len()..].to_string())
}
