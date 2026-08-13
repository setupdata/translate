import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as Rgb;
}

function luminance(color: Rgb): number {
  const channels = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(rgb(foreground)), luminance(rgb(background)));
  const darker = Math.min(luminance(rgb(foreground)), luminance(rgb(background)));
  return (lighter + 0.05) / (darker + 0.05);
}

function variable(block: string, name: string): string {
  const value = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "iu"))?.[1];
  if (!value) throw new Error(`找不到颜色变量 ${name}`);
  return value;
}

describe("visual accessibility contract", () => {
  it("keeps focus and status colors distinguishable in light and dark themes", async () => {
    const css = await readFile(resolve(import.meta.dirname, "../styles.css"), "utf8");
    const lightRoot = css.match(/^:root\s*\{([^}]*)\}/mu)?.[1] ?? "";
    const darkRoot =
      css.match(
        /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{([^}]*)\}/u,
      )?.[1] ?? "";

    const lightFocus = variable(lightRoot, "--focus-ring");
    const lightAlert = variable(lightRoot, "--alert-text");
    const lightAccent = variable(lightRoot, "--accent-text");
    const darkFocus = variable(darkRoot, "--focus-ring");
    const darkAlert = variable(darkRoot, "--alert-text");
    const darkAccent = variable(darkRoot, "--accent-text");

    for (const background of ["#f5f2fb", "#ffffff"]) {
      expect(contrast(lightFocus, background)).toBeGreaterThanOrEqual(3);
      expect(contrast(lightAlert, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(lightAccent, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ["#18151d", "#26212c"]) {
      expect(contrast(darkFocus, background)).toBeGreaterThanOrEqual(3);
      expect(contrast(darkAlert, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(darkAccent, background)).toBeGreaterThanOrEqual(4.5);
    }

    expect(css).toMatch(/:focus-visible/u);
    expect(css).toMatch(/@media\s*\(max-width:\s*600px\)/u);
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)/u);
  });
});
