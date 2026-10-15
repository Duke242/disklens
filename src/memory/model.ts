import type { MemorySnapshot, Proc } from "../api";
import { ramSize } from "../format";

export type MemCategory = "apps" | "browsers" | "dev" | "ai" | "system" | "kernel" | "shared" | "cache" | "free";

export interface MemNode {
  id: string;
  name: string;
  size: number;
  category: MemCategory;
  children: MemNode[];
  processCount: number;
  pids: number[];
  /** The .app bundle / executable, when the group is a real application. */
  appPath?: string;
  resident: number;
}

export interface MemRec {
  id: string;
  title: string;
  subtitle: string;
  safe: boolean;
  size: number;
  detail: string;
  commands: string[];
  nodeIds: string[];
  items: { name: string; size: number }[];
}

export interface MemoryModel {
  snap: MemorySnapshot;
  root: MemNode;
  mine: number;
  system: number;
  /** used − (every process + kernel). Positive: memory nobody is billed for. Negative: double counting. */
  gap: number;
  /** Real applications (0 on Linux, which has no app bundles). */
  appCount: number;
  userProcessCount: number;
  systemProcessCount: number;
  recs: MemRec[];
}

const BROWSERS = ["brave", "google chrome", "chrome", "chromium", "safari", "firefox", "arc", "microsoft edge", "msedge",
  "opera", "vivaldi", "orion", "zen", "dia", "com.apple.webkit"];
const AI = ["ollama", "llama", "lm studio", "lmstudio", "mlx", "whisper", "comfy", "kobold", "jan", "msty"];
const DEV = ["code", "cursor", "xcode", "node", "bun", "deno", "python", "java", "ruby", "go", "cargo", "rustc", "rust-analyzer",
  "docker", "com.docker", "virtualization", "qemu", "vmmem", "wsl", "terminal", "iterm", "ghostty", "warp", "wezterm",
  "alacritty", "kitty", "zed", "t3", "claude", "codex", "mysqld", "postgres", "redis", "mongod", "simulator", "android studio",
  "studio64", "intellij", "idea", "pycharm", "webstorm", "goland", "rider", "devenv", "sourcekit", "clangd", "git", "tsserver",
  "esbuild", "vite", "next-server", "turbo", "gradle", "electron", "github desktop", "sublime", "nova", "windsurf", "antigravity"];

/** Never offered as "quit": the shell, window system, and this app. */
const NEVER_QUIT = new Set(["disklens", "finder", "dock", "loginwindow", "systemuiserver", "controlcenter", "windowmanager",
  "explorer", "dwm", "csrss", "gnome-shell", "plasmashell", "xorg", "xwayland", "systemd", "kwin_x11", "kwin_wayland"]);

const matches = (g: string, list: string[]) =>
  list.some((p) => g === p || g.startsWith(p + " ") || g.startsWith(p + "-") || g.startsWith(p + ".") || g.startsWith(p + "_"));

export function classify(group: string, mine: boolean): MemCategory {
  if (group === "kernel_task") return "kernel";
  if (!mine) return "system";
  const g = group.toLowerCase();
  if (matches(g, BROWSERS)) return "browsers";
  if (AI.some((p) => g.startsWith(p))) return "ai";
  if (matches(g, DEV)) return "dev";
  return "apps";
}

/** Groups helper processes with their app: everything inside "Foo.app/" belongs to "Foo". */
function appGroup(p: Proc, os: string): { name: string; appPath?: string } {
  if (os === "macos") {
    const i = p.path.indexOf(".app/");
    if (i >= 0) {
      const appPath = p.path.slice(0, i + 4);
      return { name: appPath.slice(appPath.lastIndexOf("/") + 1, -4), appPath };
    }
    return { name: p.path.slice(p.path.lastIndexOf("/") + 1) || p.name };
  }
  if (os === "windows") {
    const installed = /\\(Program Files( \(x86\))?|AppData\\Local\\Programs)\\/i.test(p.path);
    return { name: p.name, appPath: installed ? p.path : undefined };
  }
  return { name: p.name };
}

const sameUser = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function buildModel(snap: MemorySnapshot): MemoryModel {
  const groups = new Map<string, { name: string; mine: boolean; rows: Proc[]; appPath?: string }>();
  for (const p of snap.processes) {
    if (p.footprint <= 0) continue;
    const mine = sameUser(p.user, snap.me);
    const g = appGroup(p, snap.platform);
    const key = (mine ? "u:" : "s:") + g.name;
    const entry = groups.get(key) ?? { name: g.name, mine, rows: [], appPath: g.appPath };
    entry.rows.push(p);
    groups.set(key, entry);
  }

  const nodes: MemNode[] = [...groups].map(([key, g]) => {
    const category = classify(g.name, g.mine);
    const rows = g.rows.sort((a, b) => b.footprint - a.footprint);
    return {
      id: "g:" + key,
      name: g.name,
      size: rows.reduce((s, p) => s + p.footprint, 0),
      category,
      processCount: rows.length,
      pids: rows.map((p) => p.pid),
      appPath: g.appPath,
      resident: rows.reduce((s, p) => s + p.resident, 0),
      children: rows.length > 1
        ? rows.map((p) => ({ id: `p:${p.pid}`, name: p.name, size: p.footprint, category, children: [], processCount: 1, pids: [p.pid], resident: p.resident }))
        : [],
    };
  });
  const user = nodes.filter((n) => n.id.startsWith("g:u:")).sort((a, b) => b.size - a.size);
  const sys = nodes.filter((n) => n.id.startsWith("g:s:")).sort((a, b) => b.size - a.size);
  const mine = user.reduce((s, n) => s + n.size, 0);
  const system = sys.reduce((s, n) => s + n.size, 0);

  const container = (id: string, name: string, category: MemCategory, kids: MemNode[]): MemNode => ({
    id, name, category, children: kids, size: kids.reduce((s, n) => s + n.size, 0),
    processCount: kids.reduce((s, n) => s + n.processCount, 0), pids: [], resident: 0,
  });
  const leaf = (id: string, name: string, category: MemCategory, size: number): MemNode =>
    ({ id, name, category, size, children: [], processCount: 0, pids: [], resident: 0 });

  const big = 200 * 1024 * 1024;
  const top: MemNode[] = [...user.filter((n) => n.size >= big)];
  const small = user.filter((n) => n.size < big);
  if (small.length) top.push(container("smallapps", "Smaller apps & helpers", "apps", small));
  if (sys.length) top.push(container("system", "System processes", "system", sys));
  const gap = snap.used - (mine + system + snap.wired);
  if (snap.wired > 0) top.push(leaf("wired", snap.platform === "macos" ? "Kernel, drivers & GPU" : "Kernel", "kernel", snap.wired));
  if (gap > 0) top.push(leaf("shared", "Not owned by any app", "shared", gap));
  if (snap.cached > 0) top.push(leaf("cache", "Cached files", "cache", snap.cached));
  if (snap.free > 0) top.push(leaf("free", "Free", "free", snap.free));
  const root = container("root", "Physical memory", "system", top.filter((n) => n.size > 0).sort((a, b) => b.size - a.size));

  // Real apps only: on macOS, bundles in an Applications folder (not the OS's own background agents).
  const appCount = user.filter((n) => n.appPath && (snap.platform !== "macos" || n.appPath.includes("/Applications/"))).length;

  return {
    snap, root, mine, system, gap, appCount,
    userProcessCount: user.reduce((s, n) => s + n.processCount, 0),
    systemProcessCount: sys.reduce((s, n) => s + n.processCount, 0),
    recs: recommendations(snap, user),
  };
}

const shq = (s: string, os: string) => (os === "windows" ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`);

function recommendations(snap: MemorySnapshot, user: MemNode[]): MemRec[] {
  const os = snap.platform;
  const out: MemRec[] = [];
  if (snap.models.length) {
    out.push({
      id: "ollama", title: "Unload Ollama models", subtitle: snap.models.map((m) => m.name).join(", "), safe: true,
      size: snap.models.reduce((s, m) => s + m.size, 0),
      detail: "Models stay loaded for a while after you use them. Unloading frees the RAM; Ollama loads them again on the next request.",
      commands: snap.models.map((m) => `ollama stop ${shq(m.name, os)}`),
      nodeIds: user.filter((n) => /^(ollama|llama)/i.test(n.name)).map((n) => n.id),
      items: snap.models.map((m) => ({ name: m.name, size: m.size })),
    });
  }
  for (const g of user) {
    if (g.size < 300 * 1024 * 1024 || NEVER_QUIT.has(g.name.toLowerCase())) continue;
    const app = g.appPath !== undefined;
    const ids = g.pids.join(os === "windows" ? "," : " ");
    const commands =
      os === "macos" && app ? [`osascript -e ${shq(`quit app "${g.name}"`, os)}`]
        : os === "windows" && app ? [`Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }`]
          : os === "windows" ? [`Stop-Process -Id ${ids} -ErrorAction SilentlyContinue`]
            : [`kill ${ids}`];
    const detail =
      g.category === "browsers" ? "Closing tabs, or turning on the browser's memory saver, frees most of this without quitting."
        : g.category === "ai" ? "Holds a model in memory. Stopping it frees the model's RAM until it's started again."
          : app ? "Asks the app to quit normally, so you'll get a chance to save anything open."
            : "Sends a normal stop signal. If this is a database or dev server, something may depend on it.";
    out.push({
      id: `quit:${g.name}`, title: `${app ? "Quit" : "Stop"} ${g.name}`,
      subtitle: [g.processCount > 1 ? `${g.processCount} processes` : "", g.appPath ?? ""].filter(Boolean).join(" · ") || g.name,
      safe: false, size: g.size, detail, commands, nodeIds: [g.id],
      items: (g.children.length ? g.children : [g]).slice(0, 6).map((c) => ({ name: c.name, size: c.size })),
    });
  }
  return out.sort((a, b) => (a.safe === b.safe ? b.size - a.size : a.safe ? -1 : 1));
}

export function script(recs: MemRec[], os: string): string {
  const total = ramSize(recs.reduce((s, r) => s + r.size, 0));
  const say = (t: string) => (os === "windows" ? `Write-Host ${shq(t, os)}` : `echo ${shq(t, os)}`);
  const lines = os === "windows"
    ? ["# DiskLens memory script (PowerShell)", `# Frees about ${total} of RAM across ${recs.length} item(s). Read it before running.`, ""]
    : ["#!/bin/bash", "# DiskLens memory script", `# Frees about ${total} of RAM across ${recs.length} item(s). Read it before running.`, "set -u", ""];
  for (const r of recs) lines.push(`# ${r.title}: ${ramSize(r.size)}`, say(`-> ${r.title} (${ramSize(r.size)})`), ...r.commands, "");
  return lines.join("\n");
}

export const EXPLANATIONS: Partial<Record<string, string>> = {
  system: "Run by the operating system itself (root, window server, background services).",
  wired: "Kernel, driver and GPU memory. Locked in RAM and owned by no process.",
  shared: "In use but charged to no process: GPU buffers, window surfaces, memory shared between processes.",
  cache: "Recently used files. The OS hands this back instantly when an app needs it.",
  free: "Empty RAM.",
};
