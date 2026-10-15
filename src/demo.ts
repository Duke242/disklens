// Sample data so the UI can run in a plain browser (`npm run dev`) and for screenshots.
// Nothing here touches the real file system.
import type { DiskInfo, MemorySnapshot, Platform, Proc, Recommendation, ScanProgress, ScanSummary, StorageView, ViewNode } from "./api";

const GB = 1e9;

type Spec = [name: string, size: number, category: number, children?: Spec[], rec?: string];

// A plausible developer's home folder.
const SPEC: Spec[] = [
  ["Desktop", 0, 2, [
    ["atlas", 0, 2, [["node_modules", 6.1 * GB, 2], [".next", 9.4 * GB, 2, [], "nextturbo"], ["src", 1.1 * GB, 2]]],
    ["pebble", 0, 2, [["node_modules", 3.9 * GB, 2], [".turbo", 2.9 * GB, 2, [], "nextturbo"], ["app", 1.4 * GB, 2]]],
    ["orbit", 3.6 * GB, 2], ["side-quest", 4.2 * GB, 2], ["old-saas", 2.8 * GB, 2], ["sandbox", 1.9 * GB, 2],
  ]],
  [".ollama / models", 0, 4, [
    ["deepseek-coder:6.7b", 8.3 * GB, 4, [], "ollama"], ["llama3.1:8b", 4.6 * GB, 4, [], "ollama"], ["mistral:7b", 3.8 * GB, 4, [], "ollama"],
  ]],
  [".npm", 13.4 * GB, 5, [], "npm"],
  ["Library", 0, 1, [
    ["Android / sdk", 9.9 * GB, 3, [], "android"],
    ["Developer / Xcode / DerivedData", 6.5 * GB, 3, [], "deriveddata"],
    ["Caches", 0, 5, [["CocoaPods", 2.4 * GB, 5, [], "cocoapods"], ["Google", 1.1 * GB, 5], ["Homebrew", 0.8 * GB, 5]]],
  ]],
  [".gradle / caches", 6.6 * GB, 5, [], "gradle"],
  ["Documents", 0, 0, [["Taxes", 1.9 * GB, 0], ["Scans", 2.3 * GB, 0], ["Projects.key", 1.2 * GB, 0], ["Books", 0.9 * GB, 0]]],
  [".cache", 0, 5, [["uv", 1.8 * GB, 5, [], "toolcaches"], ["puppeteer", 1.2 * GB, 5, [], "toolcaches"]]],
  ["Pictures", 0, 0, [["Photos Library.photoslibrary", 5.1 * GB, 0]]],
  ["Downloads", 0, 0, [["installers", 1.6 * GB, 0, [], "installers"], ["misc", 1.4 * GB, 0]]],
  [".vscode", 2.7 * GB, 1], [".cursor", 2.2 * GB, 1], ["Music", 2.0 * GB, 0], [".rustup", 1.5 * GB, 5],
];

interface DemoNode { id: number; name: string; size: number; category: number; rec?: string; parent: number; children: number[] }
const nodes: DemoNode[] = [];

function build(spec: Spec, parent: number): number {
  const [name, size, category, kids = [], rec] = spec;
  const id = nodes.length;
  nodes.push({ id, name, size, category, rec, parent, children: [] });
  for (const k of kids) nodes[id].children.push(build(k, id));
  if (kids.length) nodes[id].size = nodes[id].children.reduce((s, c) => s + nodes[c].size, 0) + size;
  nodes[id].children.sort((a, b) => nodes[b].size - nodes[a].size);
  return id;
}
build(["~", 0, 1, SPEC], -1);

const pathOf = (id: number): string => (id <= 0 ? "~" : `${pathOf(nodes[id].parent)}/${nodes[id].name.split(" / ").join("/")}`);

function view(id: number, depth: number): ViewNode {
  const n = nodes[id];
  return {
    id, openId: id, label: n.name, size: n.size, dir: n.children.length > 0, navigable: n.children.length > 0,
    virt: false, aggregate: false, unreadable: false, category: n.category, rec: n.rec ?? null, path: pathOf(id),
    children: depth > 0 ? n.children.map((c) => view(c, depth - 1)) : [],
  };
}

const REC_META: Record<string, [title: string, safe: boolean, detail: string]> = {
  npm: ["npm cache", true, "Downloaded packages. npm re-downloads whatever a project needs on the next install."],
  nextturbo: ["Next.js & Turbo build output", true, "Build output inside your JS projects. Recreated by the next build."],
  gradle: ["Gradle caches", true, "Downloaded packages. Gradle re-downloads whatever a build needs."],
  deriveddata: ["Xcode DerivedData", true, "Xcode build products and indexes. Rebuilt on the next build."],
  toolcaches: ["uv & Puppeteer caches", true, "Caches written by command-line tools. They refill on demand."],
  cocoapods: ["CocoaPods cache", true, "Downloaded pods. Re-downloaded on the next pod install."],
  android: ["Android SDK & emulators", false, "SDK platforms, system images and emulator disks."],
  ollama: ["Ollama models", false, "Local language models. Removing one means re-downloading it with `ollama pull`."],
  installers: ["Installers in Downloads", false, "Disk images and installers you've probably already used."],
};

function recommendations(): Recommendation[] {
  const groups = new Map<string, DemoNode[]>();
  for (const n of nodes) if (n.rec) groups.set(n.rec, [...(groups.get(n.rec) ?? []), n]);
  return [...groups].map(([id, ns]) => {
    const [title, safe, detail] = REC_META[id];
    const items = ns.map((n) => ({ node: n.id, name: n.name, path: pathOf(n.id), realPath: pathOf(n.id), size: n.size }));
    return {
      id, title, safe, detail, items, size: ns.reduce((s, n) => s + n.size, 0),
      subtitle: id === "nextturbo" ? "~/Desktop/*/.next, .turbo" : items.map((i) => i.path).join(", "),
      commands: id === "ollama" ? ns.map((n) => `ollama rm '${n.name}'`) : items.map((i) => `rm -rf '${i.path}'`),
    };
  }).sort((a, b) => b.size - a.size);
}

const progressListeners = new Set<(p: ScanProgress) => void>();

function procs(): Proc[] {
  const out: Proc[] = [];
  let pid = 400;
  const add = (name: string, path: string, user: string, mb: number, count = 1, resident = 0) => {
    for (let i = 0; i < count; i++) {
      const fp = (mb / count) * (1 + (i % 3) * 0.15) * 1024 * 1024;
      out.push({ pid: pid++, name: i ? `${name} Helper` : name, path, user, footprint: fp, resident: resident || fp * 1.3 });
    }
  };
  add("Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "you", 5200, 24);
  add("Slack", "/Applications/Slack.app/Contents/MacOS/Slack", "you", 1400, 5);
  add("Code", "/Applications/Visual Studio Code.app/Contents/MacOS/Code", "you", 2100, 9);
  add("llama-server", "/Applications/Ollama.app/Contents/Resources/llama-server", "you", 1300, 1, 5.2 * 1024 ** 3);
  add("Figma", "/Applications/Figma.app/Contents/MacOS/Figma", "you", 900, 4);
  add("node", "/opt/homebrew/bin/node", "you", 1100, 3);
  add("postgres", "/opt/homebrew/bin/postgres", "you", 420, 4);
  add("Spotify", "/Applications/Spotify.app/Contents/MacOS/Spotify", "you", 380, 3);
  for (let i = 0; i < 40; i++) add(`agent${i}`, `/usr/libexec/agent${i}`, "you", 20 + (i % 7) * 9);
  add("WindowServer", "/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer", "_windowserver", 640);
  add("kernel_task", "kernel_task", "root", 300);
  for (let i = 0; i < 60; i++) add(`daemon${i}`, `/usr/sbin/daemon${i}`, "root", 12 + (i % 5) * 8);
  return out;
}

export const demo = {
  platform: async (): Promise<Platform> => ({ os: "macos", home: "~", diskRoot: "/", fullDiskAccess: true }),
  diskInfo: async (): Promise<DiskInfo> => ({
    name: "Macintosh HD", mount: "/", total: 494 * GB, available: 39.5 * GB, used: 454.5 * GB,
    volumes: [{ name: "Macintosh HD", mount: "/", total: 494 * GB, available: 39.5 * GB }],
  }),
  async startScan(): Promise<ScanSummary> {
    for (let i = 1; i <= 12; i++) {
      await new Promise((r) => setTimeout(r, 90));
      progressListeners.forEach((cb) => cb({ files: i * 41_237, bytes: (i * nodes[0].size) / 12, path: `~/Desktop/atlas/node_modules/pkg-${i}` }));
    }
    return { rootId: 0, rootPath: "~", size: nodes[0].size, files: 1_284_311, unreadable: 0, duration: 41, recommendations: recommendations() };
  },
  storageView: async (id: number): Promise<StorageView> => {
    const crumbs = [];
    for (let c = id; c >= 0; c = nodes[c].parent) crumbs.unshift({ id: c, name: c === 0 ? "~" : nodes[c].name });
    return { root: view(id, 3), crumbs };
  },
  locate: async (id: number) => Math.max(0, nodes[id]?.parent ?? 0),
  cleanupScript: async (ids: string[]) =>
    ["#!/bin/bash", "# DiskLens cleanup script (demo)", ...recommendations().filter((r) => ids.includes(r.id)).flatMap((r) => [`# ${r.title}`, ...r.commands])].join("\n"),
  onScanProgress(cb: (p: ScanProgress) => void) {
    progressListeners.add(cb);
    return () => void progressListeners.delete(cb);
  },
  memorySnapshot: async (): Promise<MemorySnapshot> => {
    const GiB = 1024 ** 3;
    return {
      platform: "macos", total: 32 * GiB, used: 24.6 * GiB, wired: 3.9 * GiB, compressed: 1.2 * GiB, cached: 5.1 * GiB,
      free: 2.3 * GiB, swapUsed: 0.4 * GiB, swapTotal: 2 * GiB, pressure: "normal", gpuInUse: 3.4 * GiB, me: "you",
      processes: procs(), models: [{ name: "llama3.1:8b", size: 5.6 * GiB }],
    };
  },
};
