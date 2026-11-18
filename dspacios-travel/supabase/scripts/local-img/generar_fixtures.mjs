// Synthetic photo-like JPEG fixtures for the image-delivery measurements (local only, no real media).
// Usage: node generar_fixtures.mjs <outDir>
// Tiers: huge = typical camera original (uploaded as-is today), large, ok = what a sized upload would be.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { randomFillSync } from "node:crypto";
import { join } from "node:path";
const require = createRequire(import.meta.url);
import { fileURLToPath } from "node:url";
const raiz = fileURLToPath(new URL("../../../", import.meta.url));
const sharpPath = readdirSync(join(raiz, "node_modules/.pnpm")).find((d) => d.startsWith("sharp@"));
const sharp = require(join(raiz, "node_modules/.pnpm", sharpPath, "node_modules/sharp"));
const out = process.argv[2];
if (!out) throw new Error("outDir required");
mkdirSync(out, { recursive: true });

async function foto(w, h, q, seed, grano) {
  // Low-frequency colour blobs + film-like grain so the JPEG is not trivially compressible.
  const lw = Math.max(8, Math.round(w / 64)), lh = Math.max(8, Math.round(h / 64));
  const low = Buffer.alloc(lw * lh * 3); randomFillSync(low);
  const fine = Buffer.alloc((w >> 1) * (h >> 1) * 3); randomFillSync(fine);
  const base = await sharp(low, { raw: { width: lw, height: lh, channels: 3 } }).resize(w, h, { kernel: "cubic" }).modulate({ hue: seed * 37 % 360 }).toBuffer();
  const grain = await sharp(fine, { raw: { width: w >> 1, height: h >> 1, channels: 3 } }).resize(w, h, { kernel: "linear" }).linear(grano, 0).toBuffer();
  return sharp(base, { raw: { width: w, height: h, channels: 3 } })
    .composite([{ input: grain, raw: { width: w, height: h, channels: 3 }, blend: "overlay" }])
    .jpeg({ quality: q, progressive: false }).toBuffer();
}
const tiers = { huge: [4608, 3456, 92, 0.9], large: [3000, 2000, 88, 0.6], ok: [1600, 900, 80, 0.35] };
const manifest = {};
for (const [tier, [w, h, q, g]] of Object.entries(tiers)) {
  const n = tier === "ok" ? 8 : 6;
  for (let i = 1; i <= n; i++) {
    const buf = await foto(w, h, q, i, g);
    const name = `${tier}-${i}.jpg`;
    writeFileSync(join(out, name), buf);
    manifest[name] = { w, h, bytes: buf.length };
  }
}
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
for (const [k, v] of Object.entries(manifest)) console.log(k, `${v.w}x${v.h}`, (v.bytes / 1024).toFixed(0) + " KB");
