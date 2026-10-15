import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MemorySnapshot } from "../api";
import { Treemap, type MapNode } from "../components/Treemap";
import { Legend, Popover, RecommendationList, Segmented, StatCell } from "../components/ui";
import { plural, ramSize } from "../format";
import type { Palette, Swatch } from "../theme";
import { buildModel, EXPLANATIONS, script, type MemCategory, type MemNode } from "./model";

type Mode = "Category" | "Reclaim";

const TITLES: Record<MemCategory, string> = {
  apps: "Apps", browsers: "Browsers", dev: "Dev tools", ai: "AI models", system: "System",
  kernel: "Kernel & GPU", shared: "Unowned", cache: "File cache", free: "Free",
};

function swatchFor(p: Palette, c: MemCategory, mode: Mode): Swatch {
  if (mode === "Reclaim") {
    if (c === "cache" || c === "free") return p.safe;
    if (c === "apps" || c === "browsers" || c === "dev" || c === "ai") return p.review;
    return p.neutral;
  }
  return { apps: p.blue, browsers: p.orange, dev: p.purple, ai: p.pink, system: p.gray, kernel: p.teal, shared: p.review, cache: p.safe, free: p.neutral }[c];
}

export function MemoryTab({ visible, palette }: { visible: boolean; palette: Palette }) {
  const [snap, setSnap] = useState<MemorySnapshot | null>(null);
  const [mode, setMode] = useState<Mode>("Category");
  const [zoom, setZoom] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<MapNode | null>(null);
  const [overMap, setOverMap] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [copied, setCopied] = useState(false);
  const seen = useRef(new Set<string>());

  // Refresh every 3s while visible; pause while the pointer is over the map so blocks don't move under it.
  useEffect(() => {
    if (!visible || overMap) return;
    let alive = true;
    const tick = () => api.memorySnapshot().then((s) => alive && setSnap(s));
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [visible, overMap]);

  const model = useMemo(() => (snap ? buildModel(snap) : null), [snap]);

  // Safe items start selected the first time they appear; vanished items drop out.
  useEffect(() => {
    if (!model) return;
    const ids = new Set(model.recs.map((r) => r.id));
    // Work out what's new before updating `seen`: the state updater runs later.
    const fresh = model.recs.filter((r) => r.safe && !seen.current.has(r.id)).map((r) => r.id);
    for (const r of model.recs) seen.current.add(r.id);
    setSelected((prev) => new Set([...[...prev].filter((id) => ids.has(id)), ...fresh]));
  }, [model]);

  if (!model) return <div className="tab" hidden={!visible}><div className="center"><div className="spinner" />Reading every process…</div></div>;

  const { snap: s, recs } = model;
  const path: MemNode[] = [model.root];
  for (const id of zoom) {
    const next = path[path.length - 1].children.find((c) => c.id === id);
    if (!next) break;
    path.push(next);
  }
  const current = path[path.length - 1];
  const selectedBytes = recs.filter((r) => selected.has(r.id)).reduce((sum, r) => sum + r.size, 0);
  const recFor = (n: MemNode) => recs.find((r) => r.nodeIds.includes(n.id));
  const focusedRec = recs.find((r) => r.id === focused);

  const toMap = (n: MemNode, depth: number): MapNode => {
    const rec = recFor(n);
    const hatch = rec && selected.has(rec.id) ? (rec.safe ? palette.safe.dot : palette.review.dot) + "99" : undefined;
    return {
      key: n.id, label: n.name, size: n.size, sizeLabel: ramSize(n.size), swatch: swatchFor(palette, n.category, mode),
      children: depth < 1 ? n.children.map((c) => toMap(c, depth + 1)) : [],
      dashed: n.category === "free", hatch, outlined: !!focusedRec?.nodeIds.includes(n.id),
      openable: depth === 0 && n.children.length > 0, data: n,
    };
  };
  const nodes = current.children.map((n) => toMap(n, 0));
  const hoveredNode = hovered?.data as MemNode | undefined;

  const describe = (n: MemNode) => {
    const fixed = EXPLANATIONS[n.id] ?? (n.category === "system" && !n.id.startsWith("g:") ? EXPLANATIONS.system : undefined);
    if (fixed) return fixed;
    const parts = [];
    if (n.processCount > 1) parts.push(plural(n.processCount, "process", "processes"));
    if (n.pids.length === 1) parts.push(`pid ${n.pids[0]}`);
    if (n.resident > n.size + 500e6) parts.push(`${ramSize(n.resident)} resident incl. mapped files`);
    return parts.join(" · ");
  };

  const pressureSwatch = s.pressure === "critical" ? palette.pink : s.pressure === "warning" ? palette.review : palette.safe;

  return (
    <div className="tab" hidden={!visible}>
      <div className="card stats">
        <StatCell label="Memory used" value={ramSize(s.used)}
          suffix={selectedBytes > 0 ? `−${ramSize(selectedBytes)}` : `of ${ramSize(s.total)}`}
          suffixColor={selectedBytes > 0 ? palette.safe.dot : undefined} />
        <StatCell label="Your apps" dot={palette.blue.dot} value={ramSize(model.mine)}
          suffix={model.appCount ? plural(model.appCount, "app") : `${model.userProcessCount} processes`} />
        <StatCell label={s.wired ? "System & kernel" : "System"} dot={palette.gray.dot} value={ramSize(model.system + s.wired)}
          suffix={`${model.systemProcessCount} processes`} />
        <StatCell label={model.gap >= 0 ? "Not owned by any app" : "Counted twice"} dot={palette.review.dot} info
          value={ramSize(Math.abs(model.gap))} suffix={model.gap >= 0 ? "shared & GPU" : "shared memory"} onClick={() => setShowWhy(true)} />
        <Popover open={showWhy} onClose={() => setShowWhy(false)}>
          <h3>Why don't the numbers add up?</h3>
          <div className="grid">
            <span className="strong">Memory used</span><span className="num strong">{ramSize(s.used)}</span><span className="note">what the OS reports</span>
            <span className="rule" />
            <span>Every process added up</span><span className="num">{ramSize(model.mine + model.system)}</span><span className="note">{s.processes.length} processes, including the system's</span>
            {s.wired > 0 && <><span>Kernel{s.platform === "macos" ? ", drivers & GPU" : ""}</span><span className="num">{ramSize(s.wired)}</span><span className="note">owned by no process</span></>}
            <span className="rule" />
            <span className="strong">{model.gap >= 0 ? "Not owned by any app" : "Counted twice"}</span>
            <span className="num strong">{ramSize(Math.abs(model.gap))}</span>
            <span className="note">{model.gap >= 0 ? "GPU buffers, window surfaces, shared memory" : "memory shared between processes is counted once per process"}</span>
          </div>
          <div className="insights">
            {insights(model).map((line) => <div key={line}>{line}</div>)}
          </div>
        </Popover>
      </div>

      <div className="main">
        <div className="card explorer">
          <div className="card-head">
            <div className="grow">
              <h2>Memory map</h2>
              <p>All of your RAM, sized by what's using it. Click a block to open it.</p>
            </div>
            {s.pressure && (
              <span className="pressure" style={{ background: pressureSwatch.fill, color: pressureSwatch.ink }}
                title="Memory pressure is the real signal: Normal means you have enough RAM, however full the numbers look.">
                <span className="dot" style={{ background: pressureSwatch.dot }} />
                Pressure: {s.pressure[0].toUpperCase() + s.pressure.slice(1)}
                {s.swapUsed > 0 && <span className="muted"> · swap {ramSize(s.swapUsed)}</span>}
              </span>
            )}
            <Segmented options={["Category", "Reclaim"] as Mode[]} value={mode} onChange={setMode} />
          </div>
          <div className="crumbs">
            {path.map((n, i) => (
              <span key={n.id} style={{ display: "contents" }}>
                <button className={`crumb ${i === path.length - 1 ? "current" : ""}`} onClick={() => setZoom(zoom.slice(0, i))}>{n.name}</button>
                {i < path.length - 1 && <span className="sep">/</span>}
              </span>
            ))}
            <span className="grow" />
            {overMap && <span className="note">paused while you look</span>}
            <span className="mono muted">{ramSize(current.size)}</span>
          </div>
          <Treemap nodes={nodes} maxDepth={2} hovered={hovered} onHover={setHovered} onPointerInside={setOverMap}
            onOpen={(n) => setZoom([...zoom, (n.data as MemNode).id])} />
          <div className="footer">
            {hoveredNode ? (
              <>
                <span style={{ fontWeight: 600 }}>{hoveredNode.name}</span>
                <span className="path muted">{describe(hoveredNode)}</span>
                <span className="mono" style={{ fontWeight: 600 }}>{ramSize(hoveredNode.size)}</span>
              </>
            ) : mode === "Category" ? (
              <Legend items={(["apps", "browsers", "dev", "ai", "system", "kernel", "shared", "cache"] as MemCategory[])
                .map((c) => [swatchFor(palette, c, "Category").dot, TITLES[c]])} />
            ) : (
              <>
                <Legend items={[[palette.safe.dot, "Reusable right now"], [palette.review.dot, "Freed by quitting"], [palette.neutral.dot, "Held by the system"]]} />
                <span className="muted">Hatched = selected</span>
              </>
            )}
          </div>
        </div>

        <div className="card side">
          <div className="card-head">
            <div className="grow">
              <h2>Recommendations</h2>
              <p>Select items to build a script that frees RAM</p>
            </div>
          </div>
          {recs.length === 0 ? (
            <div className="center">No app is using a notable amount of memory.</div>
          ) : (
            <RecommendationList
              rows={recs.map((r) => ({
                id: r.id, title: r.title, subtitle: r.subtitle, size: ramSize(r.size), safe: r.safe,
                detail: (
                  <>
                    <div className="desc">{r.detail}</div>
                    <div>
                      {r.items.map((it, i) => (
                        <div key={i} className="item-row mono"><span className="name" style={{ direction: "ltr" }}>{it.name}</span><span className="muted">{ramSize(it.size)}</span></div>
                      ))}
                    </div>
                    <div className="code">{r.commands.join("\n")}</div>
                  </>
                ),
              }))}
              safeLabel="Safe to do"
              reviewLabel="Quit to free"
              sectionTotal={(safe) => ramSize(recs.filter((r) => r.safe === safe).reduce((sum, r) => sum + r.size, 0))}
              selected={selected}
              onToggle={(id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              onFocus={setFocused}
              safeSwatch={palette.safe}
              reviewSwatch={palette.review}
            />
          )}
          <div className="side-foot">
            <div className="row">
              <span className="mono" style={{ fontWeight: 600 }}>{ramSize(selectedBytes)}</span>
              <span className="muted">selected · {plural(selected.size, "item")}</span>
            </div>
            <div className="row">
              <button className="pill" onClick={() => setSelected(new Set(recs.filter((r) => r.safe).map((r) => r.id)))}>Select safe</button>
              <button className="pill primary" disabled={selected.size === 0} onClick={async () => {
                await api.copy(script(recs.filter((r) => selected.has(r.id)), s.platform));
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }}>{copied ? "Copied ✓" : "Copy script"}</button>
            </div>
            <div className="note">
              {copied ? `Paste it into ${s.platform === "windows" ? "PowerShell" : "a terminal"}, read it, press Enter.` : "Nothing is quit until you run the script yourself."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function insights(m: ReturnType<typeof buildModel>): string[] {
  const s = m.snap;
  const out: string[] = [];
  if (s.gpuInUse && s.gpuInUse > s.total * 0.05) {
    out.push(`The GPU is holding ${ramSize(s.gpuInUse)}. On Apple Silicon it shares regular RAM, and most of that isn't charged to any app.`);
  }
  if (m.gap > s.total * 0.08) {
    out.push(`${ramSize(m.gap)} is in use but billed to nobody. That's the "more RAM used than I can see" effect. Quitting the app that created it (often a browser, local AI model or game) releases it.`);
  }
  for (const p of s.processes.filter((p) => p.resident > p.footprint + 1.5e9).sort((a, b) => b.resident - a.resident).slice(0, 2)) {
    out.push(`${p.name} shows ${ramSize(p.footprint)} but has ${ramSize(p.resident)} resident. It memory-maps big files (like an AI model), which count as file cache, not under the app.`);
  }
  if (s.cached > s.total * 0.15) out.push(`${ramSize(s.cached)} is file cache. Some tools call it "used". The OS reclaims it instantly.`);
  if (m.gap < 0) out.push("On this system, per-process numbers include memory shared between processes, so they add up to more than what's actually used.");
  if (s.pressure) {
    out.push(`Memory pressure is ${s.pressure}${s.swapUsed > 0 ? ` with ${ramSize(s.swapUsed)} in swap` : " and nothing is swapped to disk"}. That's the number that tells you whether you actually need more RAM.`);
  }
  return out;
}
