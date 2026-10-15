import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { demo } from "./demo";

// Shapes returned by the Rust backend (src-tauri/src).

export interface Platform {
  os: "macos" | "windows" | "linux" | string;
  home: string;
  diskRoot: string;
  fullDiskAccess: boolean;
}

export interface DiskInfo {
  name: string;
  mount: string;
  total: number;
  available: number;
  used: number;
  volumes: { name: string; mount: string; total: number; available: number }[];
}

export interface RecItem {
  node: number;
  name: string;
  path: string;
  realPath: string;
  size: number;
}

export interface Recommendation {
  id: string;
  title: string;
  subtitle: string;
  safe: boolean;
  size: number;
  detail: string;
  items: RecItem[];
  commands: string[];
}

export interface ScanSummary {
  rootId: number;
  rootPath: string;
  size: number;
  files: number;
  unreadable: number;
  duration: number;
  recommendations: Recommendation[];
}

export interface ScanProgress {
  files: number;
  bytes: number;
  path: string;
}

export interface ViewNode {
  id: number;
  openId: number;
  label: string;
  size: number;
  dir: boolean;
  navigable: boolean;
  virt: boolean;
  aggregate: boolean;
  unreadable: boolean;
  /** 0 documents, 1 other, 2 code, 3 sdks, 4 ai, 5 caches */
  category: number;
  rec: string | null;
  path: string;
  children: ViewNode[];
}

export interface StorageView {
  root: ViewNode;
  crumbs: { id: number; name: string }[];
}

export interface Proc {
  pid: number;
  name: string;
  path: string;
  user: string;
  footprint: number;
  resident: number;
}

export interface MemorySnapshot {
  platform: string;
  total: number;
  used: number;
  wired: number;
  compressed: number;
  cached: number;
  free: number;
  swapUsed: number;
  swapTotal: number;
  pressure: "normal" | "warning" | "critical" | null;
  gpuInUse: number | null;
  me: string;
  processes: Proc[];
  models: { name: string; size: number }[];
}

/** Outside the Tauri shell (e.g. `npm run dev` in a browser) everything runs on sample data. */
export const isDemo = !("__TAURI_INTERNALS__" in window);

export const api = {
  platform: (): Promise<Platform> => (isDemo ? demo.platform() : invoke("platform")),
  diskInfo: (): Promise<DiskInfo> => (isDemo ? demo.diskInfo() : invoke("disk_info")),
  /** `target` is "home", "disk", or an absolute folder path. */
  startScan: (target: string): Promise<ScanSummary> => (isDemo ? demo.startScan() : invoke("start_scan", { target })),
  cancelScan: (): Promise<void> => (isDemo ? Promise.resolve() : invoke("cancel_scan")),
  storageView: (id: number): Promise<StorageView | null> => (isDemo ? demo.storageView(id) : invoke("storage_view", { id })),
  locate: (id: number): Promise<number> => (isDemo ? demo.locate(id) : invoke("locate", { id })),
  cleanupScript: (ids: string[]): Promise<string> => (isDemo ? demo.cleanupScript(ids) : invoke("cleanup_script", { ids })),
  memorySnapshot: (): Promise<MemorySnapshot> => (isDemo ? demo.memorySnapshot() : invoke("memory_snapshot")),

  onScanProgress(cb: (p: ScanProgress) => void): () => void {
    if (isDemo) return demo.onScanProgress(cb);
    const unlisten = listen<ScanProgress>("scan-progress", (e) => cb(e.payload));
    return () => void unlisten.then((f) => f());
  },

  async copy(text: string) {
    if (isDemo) return navigator.clipboard.writeText(text);
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    return writeText(text);
  },

  async reveal(path: string) {
    if (isDemo) return;
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    return revealItemInDir(path);
  },

  async openUrl(url: string) {
    if (isDemo) return;
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  },

  async pickFolder(): Promise<string | null> {
    if (isDemo) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  },
};
