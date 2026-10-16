import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DiskInfo, type Platform, type ScanProgress, type ScanSummary, type StorageView, type ViewNode } from "../api";
import { Treemap, type MapNode } from "../components/Treemap";
import { Legend, Popover, RecommendationList, Segmented, StatCell, useContextMenu } from "../components/ui";
import { diskSize, plural } from "../format";
import type { Palette, Swatch } from "../theme";

type Mode = "Category" | "Cleanup";

const CATEGORY_TITLES = ["Documents & media", "Dev tools & other", "Code projects", "iOS & Android SDKs", "AI models", "Package caches"];

function categorySwatch(p: Palette, c: number): Swatch {
  return [p.orange, p.gray, p.purple, p.teal, p.pink, p.blue][c] ?? p.gray;
}

export function StorageTab({ platform, palette }: { platform: Platform; palette: Palette }) {
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [target, setTarget] = useState("home");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [scannedTarget, setScannedTarget] = useState("home");
  const [currentId, setCurrentId] = useState(0);
  const [view, setView] = useState<StorageView | null>(null);
  const [mode, setMode] = useState<Mode>("Category");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<MapNode | null>(null);
  const [showDisk, setShowDisk] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useContextMenu();

  const scan = useCallback(async (t: string) => {
    setTarget(t);
    setScanning(true);
    setProgress(null);
    setError(null);
    try {
      const s = await api.startScan(t);
      const first = summary === null;
      setSummary(s);
      setScannedTarget(t);
      setCurrentId(s.rootId);
      const ids = new Set(s.recommendations.map((r) => r.id));
      // Safe items start selected on the first scan; later scans keep the user's choices.
      setSelected((prev) => (first ? new Set(s.recommendations.filter((r) => r.safe).map((r) => r.id)) : new Set([...prev].filter((id) => ids.has(id)))));
      setScanning(false);
    } catch (e) {
      if (String(e) !== "cancelled") {
        setError(String(e));
        setScanning(false);
      }
    }
    api.diskInfo().then(setDisk);
  }, [summary]);

  const started = useRef(false);
  useEffect(() => {
    api.diskInfo().then(setDisk);
    const off = api.onScanProgress(setProgress);
    // Development mode mounts effects twice; scan only once.
    if (!started.current) {
      started.current = true;
      scan("home");
    }
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (summary) api.storageView(currentId).then(setView);
  }, [summary, currentId]);

  const recs = summary?.recommendations ?? [];
  const recById = useMemo(() => new Map(recs.map((r) => [r.id, r])), [recs]);
  const selectedBytes = recs.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.size, 0);
  const safe = recs.filter((r) => r.safe);
  const review = recs.filter((r) => !r.safe);
  const notScanned = summary && disk ? Math.max(0, disk.used - summary.size) : null;
  const isWindows = platform.os === "windows";

  const mapNodes = useMemo(() => {
    const toMap = (v: ViewNode): MapNode => {
      const rec = v.rec ? recById.get(v.rec) : undefined;
      let swatch = categorySwatch(palette, v.category);
      if (mode === "Cleanup") swatch = rec ? (rec.safe ? palette.safe : palette.review) : palette.neutral;
      if (v.unreadable) swatch = palette.neutral;
      const hatchOn = rec && (selected.has(rec.id) || mode === "Cleanup");
      return {
        key: String(v.id),
        label: v.label === platform.home ? "~" : v.label,
        size: v.size,
        sizeLabel: diskSize(v.size),
        swatch,
        hatch: hatchOn ? (rec.safe ? palette.safe.dot : palette.review.dot) + (selected.has(rec.id) ? "99" : "33") : undefined,
        outlined: !!rec && rec.id === focused,
        openable: v.navigable,
        children: v.children.map(toMap),
        data: v,
      };
    };
    return view ? view.root.children.map(toMap) : [];
  }, [view, mode, palette, selected, focused, recById, platform.home]);

  const viewOf = (n: MapNode) => n.data as ViewNode;

  const copyScript = async () => {
    await api.copy(await api.cleanupScript([...selected]));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const showOnMap = async (node: number) => setCurrentId(await api.locate(node));

  const crumbs = view?.crumbs ?? [];
  const label = (name: string, i: number) => (i > 0 ? name : name === "~" || name === platform.home ? "~ Home" : name);

  const subtitle =
    scannedTarget === "home" ? "Your home folder, sized by space used. Click a tile to open it."
      : scannedTarget === "disk" ? "Your whole disk, sized by space used. Click a tile to open it."
        : `${scannedTarget}, sized by space used. Click a tile to open it.`;

  return (
    <div className="tab">
      {platform.os === "macos" && !platform.fullDiskAccess && (
        <div className="card banner">
          <span style={{ fontSize: 18 }}>🔒</span>
          <div className="grow">
            <div className="title">Give DiskLens Full Disk Access to see everything</div>
            <div className="text">Without it macOS hides Mail, Messages, Safari and other apps' data, and asks permission folder by folder. Add DiskLens in the list, then reopen it.</div>
          </div>
          <button className="pill" onClick={() => api.openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")}>Open Privacy Settings</button>
        </div>
      )}

      <div className="card stats">
        <StatCell label="Disk used" value={disk ? diskSize(disk.used) : "—"} suffix={disk ? `of ${diskSize(disk.total)}` : ""} />
        <StatCell label={selectedBytes > 0 ? "Free after cleanup" : "Free"} value={disk ? diskSize(disk.available + selectedBytes) : "—"}
          suffix={selectedBytes > 0 ? `+${diskSize(selectedBytes)}` : ""} suffixColor={palette.safe.dot} />
        <StatCell label="Safe to remove" dot={palette.safe.dot} value={summary ? diskSize(safe.reduce((s, r) => s + r.size, 0)) : "—"}
          suffix={summary ? plural(safe.length, "item") : ""} />
        <StatCell label="Needs review" dot={palette.review.dot} value={summary ? diskSize(review.reduce((s, r) => s + r.size, 0)) : "—"}
          suffix={summary ? plural(review.length, "item") : ""} />
        <StatCell label="Not scanned" value={notScanned !== null ? diskSize(notScanned) : "—"} info
          suffix={scannedTarget === "disk" ? "hidden & system" : "system & apps"} onClick={() => setShowDisk(true)} />
        <Popover open={showDisk} onClose={() => setShowDisk(false)}>
          <h3>What the scan doesn't cover</h3>
          <p>
            {scannedTarget === "disk"
              ? "The whole disk was scanned. What's left is the operating system's protected areas, snapshots, and folders DiskLens wasn't allowed to read."
              : "Only your home folder was scanned. The rest of the disk is the operating system, installed apps, shared folders, other users, and hidden system areas."}
          </p>
          {disk && (
            <div className="grid">
              <span>Disk</span><span className="num">{diskSize(disk.total)}</span><span className="note">{disk.name || disk.mount}</span>
              <span>Used</span><span className="num">{diskSize(disk.used)}</span><span className="note" />
              <span>Scanned</span><span className="num">{summary ? diskSize(summary.size) : "—"}</span>
              <span className="note">{summary ? `${summary.files.toLocaleString()} files in ${Math.round(summary.duration)}s` : ""}</span>
              <span className="strong">Not scanned</span><span className="num strong">{notScanned !== null ? diskSize(notScanned) : "—"}</span><span className="note" />
              <span>Free</span><span className="num">{diskSize(disk.available)}</span><span className="note" />
            </div>
          )}
          {summary && summary.unreadable > 0 && (
            <p style={{ marginTop: 12 }}>{plural(summary.unreadable, "folder")} couldn't be read{platform.os === "macos" && !platform.fullDiskAccess ? " (grant Full Disk Access to include them)" : ""}.</p>
          )}
          <div className="buttons">
            {scannedTarget !== "disk" && <button className="pill" onClick={() => { setShowDisk(false); scan("disk"); }}>Scan entire disk instead</button>}
            {scannedTarget !== "home" && <button className="pill" onClick={() => { setShowDisk(false); scan("home"); }}>Scan home folder</button>}
          </div>
        </Popover>
      </div>

      <div className="main">
        <div className="card explorer">
          <div className="card-head">
            <div className="grow">
              <h2>Explorer</h2>
              <p>{subtitle}</p>
            </div>
            <Segmented options={["Category", "Cleanup"] as Mode[]} value={mode} onChange={setMode} />
          </div>

          {scanning ? (
            <div className="center">
              <div className="spinner" />
              <div style={{ color: "var(--text)", fontWeight: 500, fontSize: 14 }}>Scanning {target === "home" ? "your home folder" : target === "disk" ? "the entire disk" : target}…</div>
              <div className="mono">{(progress?.files ?? 0).toLocaleString()} files · {diskSize(progress?.bytes ?? 0)}</div>
              <div className="scan-path mono">{progress?.path ?? ""}</div>
              <button className="pill" onClick={() => { api.cancelScan(); setScanning(false); }}>Stop</button>
            </div>
          ) : error ? (
            <div className="center">Scan failed: {error}<button className="pill" onClick={() => scan("home")}>Try again</button></div>
          ) : view ? (
            <>
              <div className="crumbs">
                {crumbs.map((c, i) => (
                  <span key={c.id} style={{ display: "contents" }}>
                    <button className={`crumb ${i === crumbs.length - 1 ? "current" : ""}`} onClick={() => setCurrentId(c.id)}>{label(c.name, i)}</button>
                    {i < crumbs.length - 1 && <span className="sep">/</span>}
                  </span>
                ))}
                <span className="grow" />
                <span className="mono muted">{diskSize(view.root.size)}</span>
                <button className="icon-btn" title="Rescan or scan something else" onClick={() => setShowMenu((s) => !s)}>⟳</button>
                {showMenu && (
                  <div className="context-menu menu" onMouseLeave={() => setShowMenu(false)}>
                    <button onClick={() => { setShowMenu(false); scan(scannedTarget); }}>Rescan</button>
                    <button onClick={() => { setShowMenu(false); scan("home"); }}>Scan home folder</button>
                    <button onClick={() => { setShowMenu(false); scan("disk"); }}>Scan entire disk</button>
                    <button onClick={async () => { setShowMenu(false); const p = await api.pickFolder(); if (p) scan(p); }}>Scan a folder…</button>
                  </div>
                )}
              </div>
              <Treemap
                nodes={mapNodes}
                hovered={hovered}
                onHover={setHovered}
                onOpen={(n) => setCurrentId(viewOf(n).openId)}
                onContextMenu={(n, e) => {
                  const v = viewOf(n);
                  menu.open(e.clientX, e.clientY, [
                    ...(v.navigable ? [{ label: "Open", onSelect: () => setCurrentId(v.openId) }] : []),
                    { label: isWindows ? "Show in Explorer" : platform.os === "macos" ? "Reveal in Finder" : "Show in file manager", onSelect: () => api.reveal(v.path) },
                    { label: "Copy path", onSelect: () => api.copy(v.path) },
                  ]);
                }}
              />
              <div className="footer">
                {hovered ? (
                  <>
                    <span className="path mono">{viewOf(hovered).path}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{hovered.sizeLabel}</span>
                  </>
                ) : mode === "Category" ? (
                  <Legend items={CATEGORY_TITLES.map((t, i) => [categorySwatch(palette, i).dot, t])} />
                ) : (
                  <>
                    <Legend items={[[palette.safe.dot, "Safe to remove"], [palette.review.dot, "Review first"], [palette.neutral.dot, "Keep"]]} />
                    <span className="muted">Hatched = selected</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="center"><div className="spinner" /></div>
          )}
        </div>

        <div className="card side">
          <div className="card-head">
            <div className="grow">
              <h2>Recommendations</h2>
              <p>Select items to build a cleanup script</p>
            </div>
          </div>
          {scanning || !summary ? (
            <div className="center"><div className="spinner" />Looking for things you can clean up…</div>
          ) : recs.length === 0 ? (
            <div className="center">Nothing obvious to clean up here.</div>
          ) : (
            <RecommendationList
              rows={recs.map((r) => ({
                id: r.id, title: r.title, subtitle: r.subtitle, size: diskSize(r.size), safe: r.safe,
                detail: (
                  <>
                    <div className="desc">{r.detail}</div>
                    <div>
                      {r.items.slice(0, 8).map((it) => (
                        <div key={it.node} className="item-row mono">
                          <span className="name">{it.path}</span>
                          <span className="muted">{diskSize(it.size)}</span>
                          <button className="link" title="Show on map" onClick={() => showOnMap(it.node)}>map</button>
                          <button className="link" title="Reveal" onClick={() => api.reveal(it.realPath)}>open</button>
                        </div>
                      ))}
                      {r.items.length > 8 && <div className="note">+ {r.items.length - 8} more</div>}
                    </div>
                    <div className="code">{r.commands.slice(0, 4).join("\n")}{r.commands.length > 4 ? "\n…" : ""}</div>
                  </>
                ),
              }))}
              safeLabel="Safe to remove"
              reviewLabel="Review first"
              sectionTotal={(s) => diskSize((s ? safe : review).reduce((sum, r) => sum + r.size, 0))}
              selected={selected}
              onToggle={(id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              onFocus={setFocused}
              safeSwatch={palette.safe}
              reviewSwatch={palette.review}
            />
          )}
          <div className="side-foot">
            <div className="row">
              <span className="mono" style={{ fontWeight: 600 }}>{diskSize(selectedBytes)}</span>
              <span className="muted">selected · {plural(selected.size, "item")}</span>
            </div>
            <div className="row">
              <button className="pill" onClick={() => setSelected(new Set(safe.map((r) => r.id)))}>Select safe</button>
              <button className="pill primary" disabled={selected.size === 0} onClick={copyScript}>{copied ? "Copied ✓" : "Copy script"}</button>
            </div>
            <div className="note">
              {copied ? `Paste it into ${isWindows ? "PowerShell" : "a terminal"}, read it, press Enter. Then rescan.` : "Nothing is deleted until you run the script yourself."}
            </div>
          </div>
        </div>
      </div>
      {menu.element}
    </div>
  );
}
