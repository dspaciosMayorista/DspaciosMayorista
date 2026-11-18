// Upload-side size reduction: pure sizing rule + the «never worse than before» fallbacks (no canvas needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dimensionesReducidas, reducirImagen, LADO_MAX_PX, UMBRAL_BYTES } from "../lib/imagenes/reducirImagen.ts";

test("dimensionesReducidas: caps the longest side, keeps the ratio, never enlarges", () => {
  assert.deepEqual(dimensionesReducidas(4608, 3456), { w: LADO_MAX_PX, h: 1440 });
  assert.deepEqual(dimensionesReducidas(3456, 4608), { w: 1440, h: LADO_MAX_PX });
  assert.deepEqual(dimensionesReducidas(1600, 900), { w: 1600, h: 900 });
  assert.deepEqual(dimensionesReducidas(LADO_MAX_PX, 10), { w: LADO_MAX_PX, h: 10 });
  assert.deepEqual(dimensionesReducidas(50000, 10), { w: LADO_MAX_PX, h: 1 }, "never a zero side");
});

const archivo = (tipo: string, bytes = 10) => new File([new Uint8Array(bytes)], "foto.jpg", { type: tipo });

test("reducirImagen: formats it cannot safely re-encode are returned untouched", async () => {
  for (const t of ["image/gif", "image/svg+xml", "image/heic", "application/pdf"]) {
    const f = archivo(t);
    assert.equal(await reducirImagen(f), f);
  }
});

test("reducirImagen: decode failure or small-enough file → the original file object", async () => {
  const g = globalThis as unknown as { createImageBitmap?: unknown };
  const previo = g.createImageBitmap;
  try {
    g.createImageBitmap = async () => { throw new Error("no decoder"); };
    const f = archivo("image/jpeg", UMBRAL_BYTES * 3);
    assert.equal(await reducirImagen(f), f, "decode error → upload as before");
    let cerrada = false;
    g.createImageBitmap = async () => ({ width: 1200, height: 800, close: () => { cerrada = true; } });
    const chica = archivo("image/jpeg", UMBRAL_BYTES - 1);
    assert.equal(await reducirImagen(chica), chica, "already small → untouched");
    assert.ok(cerrada, "the bitmap is released");
  } finally { g.createImageBitmap = previo; }
});
