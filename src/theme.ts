import { useEffect, useMemo, useState } from "react";

/** A tile palette: a strong `dot` for legends, plus a pale fill, border and text color for tiles. */
export interface Swatch {
  dot: string;
  fill: string;
  stroke: string;
  ink: string;
}

type Hex = number;
const hex = (h: Hex) => `#${h.toString(16).padStart(6, "0")}`;
const rgba = (h: Hex, a: number) => `rgba(${(h >> 16) & 255}, ${(h >> 8) & 255}, ${h & 255}, ${a})`;
const towardWhite = (h: Hex, t: number) => {
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${mix((h >> 16) & 255)}, ${mix((h >> 8) & 255)}, ${mix(h & 255)})`;
};

function swatch(dot: Hex, fill: Hex, stroke: Hex, ink: Hex, dark: boolean): Swatch {
  return dark
    ? { dot: hex(dot), fill: rgba(dot, 0.2), stroke: rgba(dot, 0.6), ink: towardWhite(dot, 0.7) }
    : { dot: hex(dot), fill: hex(fill), stroke: hex(stroke), ink: hex(ink) };
}

export function palette(dark: boolean) {
  return {
    orange: swatch(0xf07b3f, 0xfdeee4, 0xf2c3a2, 0x6b3a1e, dark),
    gray: swatch(0x8c9096, 0xf0f1f3, 0xced1d6, 0x3e4248, dark),
    purple: swatch(0x6e5be8, 0xe9e7fc, 0xb8b0f2, 0x2f2470, dark),
    teal: swatch(0x2fa7c9, 0xdff1f7, 0xa2d4e4, 0x15495a, dark),
    pink: swatch(0xe0508c, 0xfce6ef, 0xefadc8, 0x6e1e40, dark),
    blue: swatch(0x4d7be3, 0xe1e9fb, 0xa7bdef, 0x1d3570, dark),
    safe: swatch(0x2e9e5b, 0xe3f4ea, 0x86c9a0, 0x175233, dark),
    review: swatch(0xd9822b, 0xfcefd9, 0xebc287, 0x6a3e0e, dark),
    neutral: swatch(0xa0a4aa, 0xf3f4f6, 0xdadde1, 0x6a6e74, dark),
  };
}
export type Palette = ReturnType<typeof palette>;

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/** Follows the OS light/dark setting. */
export function usePalette(): Palette {
  const [dark, setDark] = useState(darkQuery.matches);
  useEffect(() => {
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    darkQuery.addEventListener("change", on);
    return () => darkQuery.removeEventListener("change", on);
  }, []);
  return useMemo(() => palette(dark), [dark]);
}
