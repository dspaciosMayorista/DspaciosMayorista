// O2 · primero se reduce, después se aplica el tope FINAL. Cobertura: original de cámara > 8 MB que sí se reduce, formato no reducible, sin ganancia, tope del original (recursos acotados),
// tipo no imagen, y piezas que no se reducen (flyer/historia).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { prepararSubidaImagen, TOPE_ORIGINAL_BYTES } from "../lib/imagenes/reducirImagen.ts";

const MB = 1024 * 1024;
const archivo = (nombre: string, tipo: string, bytes: number) => ({ name: nombre, type: tipo, size: bytes }) as unknown as File;
const reducidoA = (bytes: number) => async (f: File) => archivo(f.name.replace(/\.[^.]+$/, "") + ".webp", "image/webp", bytes);
const SERVICIO = { maxMb: 8, reducir: true, errorTipo: "Solo imágenes." };

describe("O2 · prepararSubidaImagen", () => {
  test("un original de cámara de 9,2 MB entra por su versión reducida (el tope se aplica al resultado)", async () => {
    const r = await prepararSubidaImagen(archivo("camara.jpg", "image/jpeg", 9.2 * MB), SERVICIO, reducidoA(1 * MB));
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.reducida, true); assert.equal(r.archivo.type, "image/webp"); assert.ok(r.archivo.size <= 8 * MB); }
  });
  test("una imagen dentro del tope que no necesita reducirse pasa tal cual", async () => {
    const f = archivo("chica.jpg", "image/jpeg", 0.3 * MB);
    const r = await prepararSubidaImagen(f, SERVICIO, async (x) => x);
    assert.equal(r.ok && r.archivo === f && !r.reducida, true);
  });
  test("formato no reducible (GIF/SVG/HEIC) de 9 MB: error CLARO que nombra el formato y la salida", async () => {
    const r = await prepararSubidaImagen(archivo("anim.gif", "image/gif", 9 * MB), SERVICIO, async (x) => x);
    assert.equal(r.ok, false);
    if (!r.ok) { assert.match(r.error, /9,0 MB/); assert.match(r.error, /image\/gif/); assert.match(r.error, /no se puede reducir automáticamente/); assert.match(r.error, /JPG o WebP/); }
  });
  test("reducible pero sigue sobre el tope: error que dice que aun reducida pesa X MB", async () => {
    const r = await prepararSubidaImagen(archivo("enorme.png", "image/png", 30 * MB), SERVICIO, reducidoA(8.6 * MB));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Aun reducida, la imagen pesa 8,6 MB y el máximo es 8 MB/);
  });
  test("un original por encima del tope de procesamiento (40 MB) NO se decodifica: el reductor ni se invoca", async () => {
    let llamado = false;
    const r = await prepararSubidaImagen(archivo("gigante.jpg", "image/jpeg", TOPE_ORIGINAL_BYTES + 1), SERVICIO, async (x) => { llamado = true; return x; });
    assert.equal(llamado, false, "recursos del navegador acotados");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /demasiado grande para procesarla/);
  });
  test("lo que no es imagen se rechaza con el mensaje de tipo del cargador, sin reducir", async () => {
    let llamado = false;
    const r = await prepararSubidaImagen(archivo("doc.pdf", "application/pdf", 1 * MB), SERVICIO, async (x) => { llamado = true; return x; });
    assert.equal(llamado, false);
    assert.deepEqual(r, { ok: false, error: "Solo imágenes." });
  });
  test("piezas que no se reducen (flyer/historia): el tope aplica al original, con el mensaje de siempre", async () => {
    const r = await prepararSubidaImagen(archivo("flyer.png", "image/png", 11 * MB), { maxMb: 10, reducir: false, errorTipo: "x" }, async () => { throw new Error("no se reduce"); });
    assert.deepEqual(r, { ok: false, error: "La imagen supera 10 MB." });
  });
});
