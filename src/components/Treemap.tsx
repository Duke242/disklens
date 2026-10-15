import { useEffect, useMemo, useRef, useState } from "react";
import type { Swatch } from "../theme";

export interface MapNode {
  key: string;
  label: string;
  size: number;
  /** Big number drawn in the corner, e.g. "13.4 GB". */
  sizeLabel: string;
  swatch: Swatch;
  children: MapNode[];
  dashed?: boolean;
  /** Diagonal hatching color, used to mark selected cleanup items. */
  hatch?: string;
  /** Thick outline, used to show the recommendation under the pointer. */
  outlined?: boolean;
  /** Clicking opens this node (zooms in). */
  openable?: boolean;
  /** Whatever the caller needs back on hover/click. */
  data?: unknown;
}

interface Tile {
  node: MapNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  nested: boolean;
}

/** Squarified treemap (Bruls, Huizing & van Wijk). `sizes` must be sorted descending. */
function squarify(sizes: number[], x: number, y: number, w: number, h: number, total: number) {
  const out: [number, number, number, number][] = sizes.map(() => [0, 0, 0, 0]);
  if (total <= 0 || !sizes.length) return out;
  const scale = (w * h) / total;
  const areas: number[] = [];
  for (const s of sizes) {
    if (s <= 0) break;
    areas.push(s * scale);
  }
  const worst = (sum: number, min: number, max: number, side: number) => {
    const s2 = sum * sum, w2 = side * side;
    return Math.max((w2 * max) / s2, s2 / (w2 * min));
  };
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    if (side <= 0) break;
    let sum = areas[i];
    let cur = worst(sum, areas[i], areas[i], side);
    let j = i + 1;
    while (j < areas.length) {
      const next = worst(sum + areas[j], areas[j], areas[i], side);
      if (next > cur) break;
      cur = next;
      sum += areas[j++];
    }
    const t = sum / side;
    let off = 0;
    for (let k = i; k < j; k++) {
      const len = areas[k] / t;
      out[k] = w >= h ? [x, y + off, t, len] : [x + off, y, len, t];
      off += len;
    }
    if (w >= h) { x += t; w = Math.max(0, w - t); } else { y += t; h = Math.max(0, h - t); }
    i = j;
  }
  return out;
}

function layout(children: MapNode[], x: number, y: number, w: number, h: number, depth: number, maxDepth: number, out: Tile[]) {
  if (w < 8 || h < 8) return;
  const total = children.reduce((s, c) => s + c.size, 0);
  if (total <= 0) return;
  const gap = depth === 0 ? 6 : 4;
  const minSize = (total * 60) / (w * h);
  const visible = [...children].sort((a, b) => b.size - a.size).filter((c) => c.size >= minSize);
  const rects = squarify(visible.map((c) => c.size), x, y, w, h, total);
  visible.forEach((node, i) => {
    const [rx, ry, rw, rh] = rects[i];
    const t = { x: rx + gap / 2, y: ry + gap / 2, w: rw - gap, h: rh - gap };
    if (t.w <= 3 || t.h <= 3) return;
    const header = depth === 0 ? 30 : 24;
    const nested = node.children.length > 0 && depth + 1 < maxDepth && t.w > 70 && t.h > header + 30;
    out.push({ node, ...t, depth, nested });
    if (nested) {
      const pad = depth === 0 ? 6 : 4;
      layout(node.children, t.x + pad, t.y + header, t.w - 2 * pad, t.h - header - pad, depth + 1, maxDepth, out);
    }
  });
}

const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`;

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= max) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}

function roundRect(ctx: CanvasRenderingContext2D, t: { x: number; y: number; w: number; h: number }, r: number) {
  ctx.beginPath();
  ctx.roundRect(t.x, t.y, t.w, t.h, Math.min(r, t.w / 3, t.h / 3));
}

export function Treemap(props: {
  nodes: MapNode[];
  maxDepth?: number;
  hovered: MapNode | null;
  onHover: (n: MapNode | null) => void;
  onOpen: (n: MapNode) => void;
  onContextMenu?: (n: MapNode, e: React.MouseEvent) => void;
  /** Called when the pointer enters or leaves the map. */
  onPointerInside?: (inside: boolean) => void;
}) {
  const { nodes, maxDepth = 3, hovered, onHover, onOpen } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(() => {
    const out: Tile[] = [];
    layout(nodes, 0, 0, size.w, size.h, 0, maxDepth, out);
    return out;
  }, [nodes, size, maxDepth]);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.textBaseline = "top";

    for (const t of tiles) {
      const s = t.node.swatch;
      const r = t.depth === 0 ? 8 : 6;
      roundRect(ctx, t, r);
      ctx.fillStyle = s.fill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = s.stroke;
      ctx.setLineDash(t.node.dashed ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      if (t.nested) {
        const hx = t.x + 9, hy = t.y + (t.depth === 0 ? 8 : 6), hw = t.w - 18;
        ctx.font = `10.5px ${MONO}`;
        const sizeW = ctx.measureText(t.node.sizeLabel).width;
        const showSize = hw - sizeW > 50;
        if (showSize) {
          ctx.fillStyle = s.ink;
          ctx.globalAlpha = 0.55;
          ctx.textAlign = "right";
          ctx.fillText(t.node.sizeLabel, hx + hw, hy + 1);
          ctx.textAlign = "left";
          ctx.globalAlpha = 1;
        }
        ctx.font = `600 ${t.depth === 0 ? 13 : 11.5}px ${SANS}`;
        ctx.fillStyle = s.ink;
        ctx.fillText(ellipsize(ctx, t.node.label, hw - (showSize ? sizeW + 8 : 0)), hx, hy);
        continue;
      }
      if (t.w <= 34 || t.h <= 20) continue;
      ctx.font = `${t.depth === 0 ? 600 : 400} ${t.depth === 0 ? 12.5 : 11.5}px ${SANS}`;
      ctx.fillStyle = s.ink;
      ctx.globalAlpha = 0.85;
      ctx.fillText(ellipsize(ctx, t.node.label, t.w - 16), t.x + 8, t.y + 7);
      ctx.globalAlpha = 1;
      if (t.h > 52 && t.w > 64) {
        const fs = Math.max(12, Math.min(22, Math.min(t.w / 6, t.h / 4)));
        ctx.font = `600 ${fs}px ${MONO}`;
        if (ctx.measureText(t.node.sizeLabel).width < t.w - 16) {
          ctx.textBaseline = "bottom";
          ctx.fillText(t.node.sizeLabel, t.x + 8, t.y + t.h - 7);
          ctx.textBaseline = "top";
        }
      }
    }

    // Hatching goes on top so it covers nested children too.
    for (const t of tiles) {
      if (!t.node.hatch) continue;
      ctx.save();
      roundRect(ctx, t, t.depth === 0 ? 8 : 6);
      ctx.clip();
      ctx.strokeStyle = t.node.hatch;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = t.x - t.h; x < t.x + t.w; x += 7) {
        ctx.moveTo(x, t.y + t.h);
        ctx.lineTo(x + t.h, t.y);
      }
      ctx.stroke();
      ctx.restore();
      roundRect(ctx, t, t.depth === 0 ? 8 : 6);
      ctx.strokeStyle = t.node.hatch;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    const outline = (t: Tile, color: string, width: number) => {
      roundRect(ctx, t, t.depth === 0 ? 8 : 6);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const ink = getComputedStyle(c).color;
    for (const t of tiles) if (t.node.outlined) outline(t, ink, 2.5);
    const h = hovered && tiles.findLast((t) => t.node.key === hovered.key);
    if (h) outline(h, ink, 1.5);
  }, [tiles, size, hovered]);

  const hit = (e: React.MouseEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return tiles.findLast((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
  };

  return (
    <div ref={wrap} className="treemap" onMouseEnter={() => props.onPointerInside?.(true)} onMouseLeave={() => props.onPointerInside?.(false)}>
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h }}
        onMouseMove={(e) => {
          const t = hit(e);
          if ((t?.node.key ?? null) !== (hovered?.key ?? null)) onHover(t?.node ?? null);
        }}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          // Open the deepest openable tile under the pointer.
          const rect = canvas.current!.getBoundingClientRect();
          const x = e.clientX - rect.left, y = e.clientY - rect.top;
          const t = tiles.findLast((t) => t.node.openable && x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
          if (t) onOpen(t.node);
        }}
        onContextMenu={(e) => {
          const t = hit(e);
          if (t && props.onContextMenu) {
            e.preventDefault();
            props.onContextMenu(t.node, e);
          }
        }}
      />
    </div>
  );
}
