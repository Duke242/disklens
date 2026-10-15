import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Swatch } from "../theme";

export function StatCell(props: { label: string; dot?: string; value: string; suffix?: string; suffixColor?: string; info?: boolean; onClick?: () => void }) {
  return (
    <div className={`stat ${props.onClick ? "clickable" : ""}`} onClick={props.onClick}>
      <div className="stat-label">
        {props.dot && <span className="dot" style={{ background: props.dot }} />}
        {props.label}
        {props.info && <span className="info">ⓘ</span>}
      </div>
      <div className="stat-value">
        <span className="mono big">{props.value}</span>
        {props.suffix && <span className="mono small" style={{ color: props.suffixColor }}>{props.suffix}</span>}
      </div>
    </div>
  );
}

export function CheckBox(props: { on: boolean; onToggle: () => void }) {
  return (
    <button className={`check ${props.on ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); props.onToggle(); }} aria-pressed={props.on}>
      {props.on && (
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </button>
  );
}

export function Segmented<T extends string>(props: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o} className={o === props.value ? "active" : ""} onClick={() => props.onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

export function Chip(props: { swatch: Swatch; children: ReactNode }) {
  return <span className="chip" style={{ background: props.swatch.fill, color: props.swatch.ink }}>{props.children}</span>;
}

export function Legend(props: { items: [color: string, label: string][] }) {
  return (
    <>
      {props.items.map(([c, l]) => (
        <span key={l} className="legend-item"><span className="legend-swatch" style={{ background: c }} />{l}</span>
      ))}
    </>
  );
}

/** A panel anchored under its trigger that closes on outside click or Escape. */
export function Popover(props: { open: boolean; onClose: () => void; children: ReactNode; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) props.onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    setTimeout(() => document.addEventListener("mousedown", click));
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return <div ref={ref} className={`popover ${props.align ?? "right"}`}>{props.children}</div>;
}

export interface MenuItem { label: string; onSelect: () => void }

/** A right-click style menu at the pointer. */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, [menu]);
  const element = menu && (
    <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
      {menu.items.map((i) => <button key={i.label} onClick={i.onSelect}>{i.label}</button>)}
    </div>
  );
  return { open: (x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }), element };
}

/** A recommendations list in the style of the mockup: sections, check rows, expandable details. */
export interface RecRow {
  id: string;
  title: string;
  subtitle: string;
  size: string;
  safe: boolean;
  detail: ReactNode;
}

export function RecommendationList(props: {
  rows: RecRow[];
  safeLabel: string;
  reviewLabel: string;
  sectionTotal: (safe: boolean) => string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onFocus: (id: string | null) => void;
  safeSwatch: Swatch;
  reviewSwatch: Swatch;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const section = (safe: boolean) => {
    const rows = props.rows.filter((r) => r.safe === safe);
    if (!rows.length) return null;
    return (
      <>
        <div className="rec-section">
          <Chip swatch={safe ? props.safeSwatch : props.reviewSwatch}>{safe ? props.safeLabel : props.reviewLabel}</Chip>
          <span className="mono muted">{props.sectionTotal(safe)}</span>
        </div>
        {rows.map((r) => {
          const open = expanded.has(r.id);
          return (
            <div key={r.id} className="rec" onMouseEnter={() => props.onFocus(r.id)} onMouseLeave={() => props.onFocus(null)}>
              <div className="rec-row" onClick={() => setExpanded((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>
                <CheckBox on={props.selected.has(r.id)} onToggle={() => props.onToggle(r.id)} />
                <div className="rec-text">
                  <div className="rec-title">{r.title}</div>
                  <div className="rec-sub mono">{r.subtitle}</div>
                </div>
                <span className="mono rec-size">{r.size}</span>
                <span className={`chevron ${open ? "open" : ""}`}>›</span>
              </div>
              {open && <div className="rec-detail">{r.detail}</div>}
            </div>
          );
        })}
      </>
    );
  };
  return <div className="rec-list">{section(true)}{section(false)}</div>;
}
