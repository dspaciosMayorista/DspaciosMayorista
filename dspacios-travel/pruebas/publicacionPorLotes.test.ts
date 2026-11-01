import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decisionDeRespuesta, FILAS_POR_LOTE_DEFECTO, huellaManifiesto, huellaTexto, lotesPendientes, manifiestoDe, prepararLotes } from "../lib/tarifario/publicacionPorLotes.ts";

const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ paquete_id: 73, hotel_nombre: `Hotel ñandú ${i} — “café” 🏝`, precio_pvp: 1000 + i, procedencia_mixta: false }));

describe("publicación por lotes — parte pura del cliente", () => {
  test("trocea sin perder ni repetir filas y numera los lotes desde 1", () => {
    const f = filas(3187);
    const lotes = prepararLotes(f, 1500);
    assert.deepEqual(lotes.map((l) => l.lote), [1, 2, 3]);
    assert.deepEqual(lotes.map((l) => l.filas), [1500, 1500, 187]);
    assert.deepEqual(lotes.flatMap((l) => JSON.parse(l.texto)), f);
  });

  test("la huella es el SHA-256 de los bytes UTF-8 del texto EXACTO que se envía (incluye ñ, comillas tipográficas y emoji)", () => {
    const [l] = prepararLotes(filas(5), 10);
    assert.equal(l.huella, createHash("sha256").update(Buffer.from(l.texto, "utf8")).digest("hex"));
    assert.equal(l.huella, huellaTexto(l.texto));
    assert.match(l.huella, /^[0-9a-f]{64}$/);
    assert.notEqual(huellaTexto(l.texto), huellaTexto(l.texto.replace("1000", "1001")), "un solo carácter distinto cambia la huella");
  });

  test("el tamaño por defecto es 1.000 (medido: 5,5 s el lote más lento con la CPU de producción; 1.500 llegó a 9,8 s)", () => {
    assert.equal(FILAS_POR_LOTE_DEFECTO, 1000);
  });

  test("el manifiesto trae lote, filas y huella (sin el texto) y suma las filas calculadas", () => {
    const lotes = prepararLotes(filas(12669));
    const m = manifiestoDe(lotes);
    assert.equal(m.length, 13, "12.669 filas en lotes de 1.000 por defecto");
    assert.equal(m.reduce((a, x) => a + x.filas, 0), 12669);
    assert.ok(m.every((x) => Object.keys(x).sort().join() === "filas,huella,lote"));
  });

  test("recalcular las MISMAS filas da el MISMO manifiesto (reanudable); un cambio de una fila lo cambia", () => {
    const a = prepararLotes(filas(4000));
    const b = prepararLotes(filas(4000));
    assert.equal(huellaManifiesto(a), huellaManifiesto(b));
    const f = filas(4000); f[10] = { ...f[10], precio_pvp: f[10].precio_pvp + 1 };
    assert.notEqual(huellaManifiesto(prepararLotes(f)), huellaManifiesto(a));
  });

  test("la huella del manifiesto usa el mismo formato que la base («lote:filas:huella» por línea)", () => {
    const lotes = prepararLotes(filas(2500), 1000);
    const esperada = createHash("sha256").update(lotes.map((l) => `${l.lote}:${l.filas}:${l.huella}`).join("\n"), "utf8").digest("hex");
    assert.equal(huellaManifiesto(lotes), esperada);
  });

  test("reanudar: solo se vuelven a enviar los lotes que el servidor dice que faltan", () => {
    const lotes = prepararLotes(filas(4500));
    assert.deepEqual(lotesPendientes(lotes, [2, 3]).map((l) => l.lote), [2, 3]);
    assert.deepEqual(lotesPendientes(lotes, []), []);
  });

  test("toda respuesta distinta de «ok» detiene la publicación; nunca se activa a medias", () => {
    assert.equal(decisionDeRespuesta("ok"), "continuar");
    assert.equal(decisionDeRespuesta("obsoleta"), "generacion_vieja");
    assert.equal(decisionDeRespuesta("fuente_cambio"), "fuente_cambio");
    for (const r of ["conflicto", "huella", "filas", "lote_desconocido", "sin_manifiesto"]) assert.equal(decisionDeRespuesta(r), "contenido_distinto");
    assert.equal(decisionDeRespuesta("algo_nuevo"), "error");
  });

  test("tamaño de lote inválido se rechaza", () => {
    assert.throws(() => prepararLotes(filas(3), 0));
    assert.throws(() => prepararLotes(filas(3), 1.5));
  });
});
