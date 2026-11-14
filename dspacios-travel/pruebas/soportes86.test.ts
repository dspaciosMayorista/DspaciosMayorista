// #86 · Pruebas puras: validación del archivo (por contenido), límite configurable, orquestación Storage+base con fallos, textos de avisos.
//   npm run test:unit
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MAX_BYTES_POR_DEFECTO, TOPE_FUNCION_BYTES, cabeUnoNuevo, detectarTipo, estaExcedido, formatoMaximo, maxBytesSoporte, nombreSeguro, rutaSoporte, validarArchivo,
} from "../lib/soportes/archivo.ts";
import { MENSAJE_IDENTIDAD } from "../lib/contrato/identidad.ts";
import { esRechazoDefinitivo, mensajeDeBase, precomprobarIdentidad, subirYVincular, type Confirmacion, type DepsSubida, type Validado } from "../lib/soportes/operaciones.ts";
import { debeReclamar, textoAviso, tituloPestana } from "../lib/avisos/presentacion.ts";

const PDF = Buffer.from("%PDF-1.7\ncontenido");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test("tipo por contenido: PDF, JPEG y PNG se reconocen; lo demás no, aunque lo llamen .pdf", () => {
  assert.deepEqual(detectarTipo(PDF), { mime: "application/pdf", ext: "pdf" });
  assert.deepEqual(detectarTipo(JPG), { mime: "image/jpeg", ext: "jpg" });
  assert.deepEqual(detectarTipo(PNG), { mime: "image/png", ext: "png" });
  assert.equal(detectarTipo(Buffer.from("MZ\x90\x00 ejecutable")), null);
  assert.equal(detectarTipo(Buffer.from("<html><script>alert(1)</script>")), null);
  assert.equal(detectarTipo(Buffer.from("GIF89a")), null);
  assert.equal(detectarTipo(new Uint8Array(0)), null);
  assert.equal(detectarTipo(Buffer.from("%PD")), null, "firma truncada");
});

test("validarArchivo: tamaño real, tipo real y hash de los MISMOS bytes", () => {
  const v = validarArchivo(PDF, 1000);
  assert.equal(v.ok, true);
  if (v.ok) { assert.equal(v.sha256, createHash("sha256").update(PDF).digest("hex")); assert.equal(v.size, PDF.byteLength); assert.equal(v.mime, "application/pdf"); }
  assert.equal(validarArchivo(Buffer.alloc(0), 1000).ok, false);
  assert.equal(validarArchivo(PDF, PDF.byteLength - 1).ok, false, "un byte por encima del máximo");
  assert.equal(validarArchivo(PDF, PDF.byteLength).ok, true, "justo en el máximo");
  assert.equal(validarArchivo(Buffer.from("texto plano"), 1000).ok, false);
});

test("límite configurable: por defecto 4 MB, nunca por encima del tope de la función, valores raros caen al defecto", () => {
  assert.equal(maxBytesSoporte(undefined), MAX_BYTES_POR_DEFECTO);
  assert.equal(maxBytesSoporte(""), MAX_BYTES_POR_DEFECTO);
  assert.equal(maxBytesSoporte("abc"), MAX_BYTES_POR_DEFECTO);
  assert.equal(maxBytesSoporte("10"), MAX_BYTES_POR_DEFECTO, "demasiado bajo");
  assert.equal(maxBytesSoporte("-5000000"), MAX_BYTES_POR_DEFECTO);
  assert.equal(maxBytesSoporte("2000000"), 2_000_000);
  assert.equal(maxBytesSoporte("10000000"), TOPE_FUNCION_BYTES, "pedir 10 MB no lo concede: la subida pasa por una función con tope de solicitud");
  assert.ok(TOPE_FUNCION_BYTES < 4_500_000, "bajo el límite de cuerpo de Vercel Functions (4,5 MB)");
  assert.equal(formatoMaximo(4_000_000), "4 MB");
});

test("excedido y cupo se calculan, no se guardan", () => {
  assert.equal(estaExcedido(3, 2), true);
  assert.equal(estaExcedido(2, 2), false);
  assert.equal(cabeUnoNuevo(2, 3), true);
  assert.equal(cabeUnoNuevo(3, 3), false);
  assert.equal(cabeUnoNuevo(3, 2), false, "excedido: no cabe uno nuevo (reemplazar y retirar no dependen de esto)");
});

test("nombre y ruta: el nombre no puede inyectar rutas y la ruta la arma el servidor", () => {
  assert.equal(nombreSeguro("../../etc/passwd"), ".._.._etc_passwd");
  assert.equal(nombreSeguro("a\u0000b\nc.pdf"), "abc.pdf");
  assert.equal(nombreSeguro(""), "comprobante");
  assert.equal(nombreSeguro("x".repeat(500)).length, 200);
  assert.equal(rutaSoporte("DTM-0451", "u-u-i-d", "jpg"), "DTM-0451/u-u-i-d.jpg");
});

// ── Orquestación con fallos ───────────────────────────────────────────────
const archivo = validarArchivo(PDF, 1000) as Validado;
function deps(sobre: Partial<DepsSubida> & { log?: string[] } = {}): DepsSubida {
  const log = sobre.log ?? [];
  return {
    subir: async (p) => { log.push(`subir ${p}`); return { error: null }; },
    borrar: async (p) => { log.push(`borrar ${p}`); return { error: null }; },
    registrar: async (p) => { log.push(`registrar ${p}`); return { error: null }; },
    confirmar: async (p) => { log.push(`confirmar ${p}`); return "ausente" as Confirmacion; },
    alertarConciliacion: (p) => { log.push(`conciliar ${p}`); },
    alertarHuerfano: (p) => { log.push(`huerfano ${p}`); },
    ...sobre,
  };
}

test("camino feliz: sube y vincula, sin borrar nada", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log }), { path: "C/1.pdf", archivo, bytes: PDF });
  assert.deepEqual(r, { ok: true, path: "C/1.pdf" });
  assert.deepEqual(log, ["subir C/1.pdf", "registrar C/1.pdf"]);
});

test("si Storage falla al subir: no se intenta registrar ni borrar", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log, subir: async () => ({ error: { message: "x" } }) }), { path: "C/1.pdf", archivo, bytes: PDF });
  assert.equal(r.ok, false);
  assert.deepEqual(log, []);
});

test("si Storage lanza una excepción al subir: error limpio, sin registrar", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log, subir: async () => { throw new Error("red"); } }), { path: "C/1.pdf", archivo, bytes: PDF });
  assert.equal(r.ok, false);
  assert.deepEqual(log, []);
});

test("si la base rechaza: se borra SOLO el objeto nuevo y el mensaje es comprensible", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log, registrar: async () => ({ error: { message: "SOPORTE_LIMITE: el contrato…" } }) }), { path: "C/2.pdf", archivo, bytes: PDF });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /un soporte vigente por cada abono/);
  assert.deepEqual(log, ["subir C/2.pdf", "borrar C/2.pdf"]);
  assert.equal("huerfano" in r, false);
});

test("si la base rechaza Y la limpieza falla: el huérfano se reporta con su ruta (nunca en silencio)", async () => {
  const log: string[] = [];
  const r = await subirYVincular(
    deps({ log, registrar: async () => ({ error: { message: "SOPORTE_NO_VIGENTE" } }), borrar: async () => ({ error: { message: "denegado" } }) }),
    { path: "C/3.pdf", archivo, bytes: PDF }
  );
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.huerfano, "C/3.pdf");
  assert.deepEqual(log, ["subir C/3.pdf", "huerfano C/3.pdf"]);
});

test("rechazo definitivo = excepción propia de la función (SOPORTE_*); transporte o error desconocido = incierto", () => {
  assert.equal(esRechazoDefinitivo({ message: "SOPORTE_LIMITE: el contrato…" }), true);
  assert.equal(esRechazoDefinitivo({ message: "SOPORTE_NO_VIGENTE" }), true);
  assert.equal(esRechazoDefinitivo({ message: "TypeError: fetch failed" }), false);
  assert.equal(esRechazoDefinitivo({ message: "excepción al registrar: corte" }), false);
  assert.equal(esRechazoDefinitivo({ message: "" }), false);
  assert.equal(esRechazoDefinitivo({ message: "FOO_SOPORTE_X" }), false, "sin coincidencias parciales");
});

test("INCIERTO: registrar lanza una excepción pero la base SÍ lo tenía → éxito; NO se borra nada", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log, registrar: async () => { throw new Error("corte"); }, confirmar: async (p) => { log.push(`confirmar ${p}`); return "vinculado"; } }), { path: "C/4.pdf", archivo, bytes: PDF });
  assert.deepEqual(r, { ok: true, path: "C/4.pdf", confirmadoTrasError: true });
  assert.deepEqual(log, ["subir C/4.pdf", "confirmar C/4.pdf"], "sin borrar");
});

test("INCIERTO y la base NO lo tiene: el archivo se CONSERVA (la petición pudo seguir en vuelo) y se registra para conciliación", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log, registrar: async () => ({ error: { message: "TypeError: fetch failed" } }) }), { path: "C/5.pdf", archivo, bytes: PDF });
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.conciliar, "C/5.pdf");
  assert.match(r.ok ? "" : r.error, /El archivo se conservó/);
  assert.deepEqual(log, ["subir C/5.pdf", "confirmar C/5.pdf", "conciliar C/5.pdf"]);
  assert.ok(!log.some((l) => l.startsWith("borrar")), "nunca se borró");
});

test("INCIERTO y no se puede ni preguntar (la consulta falla o lanza): se conserva y se concilia", async () => {
  for (const confirmar of [async () => "incierto" as Confirmacion, async () => { throw new Error("sin red"); }]) {
    const log: string[] = [];
    const r = await subirYVincular(deps({ log, registrar: async () => { throw new Error("corte"); }, confirmar }), { path: "C/6.pdf", archivo, bytes: PDF });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? "" : r.conciliar, "C/6.pdf");
    assert.deepEqual(log, ["subir C/6.pdf", "conciliar C/6.pdf"]);
  }
});

test("mensajes de base: los técnicos no se muestran tal cual", () => {
  assert.match(mensajeDeBase({ message: "SOPORTE_NO_VIGENTE: …" }), /ya cambió/);
  assert.doesNotMatch(mensajeDeBase({ message: "duplicate key value violates unique constraint uq_soportes_reemplaza" }), /uq_soportes/);
});

// ── Avisos ────────────────────────────────────────────────────────────────
test("avisos: textos sin datos del contrato más que su número, título con contador y reclamo solo con permiso activado", () => {
  assert.equal(textoAviso("soporte_pago_nuevo", "0451"), "Nuevo soporte de pago en el contrato 0451");
  assert.equal(textoAviso("soporte_pago_reemplazado", "0451"), "Se reemplazó un soporte de pago en el contrato 0451");
  assert.equal(tituloPestana("Cartera", 3), "(3) Cartera");
  assert.equal(tituloPestana("(3) Cartera", 5), "(5) Cartera", "no acumula prefijos");
  assert.equal(tituloPestana("(3) Cartera", 0), "Cartera");
  assert.equal(tituloPestana("Cartera", 250), "(99+) Cartera");
  assert.equal(debeReclamar("granted", true), true);
  assert.equal(debeReclamar("granted", false), false, "permiso sin activación de la persona: no se reclama");
  assert.equal(debeReclamar("denied", true), false);
  assert.equal(debeReclamar("default", true), false);
  assert.equal(debeReclamar("no-soportado", true), false);
});

// ── Identidad del contrato (#75 · 285) ────────────────────────────────────
test("precomprobación: identidad o fallo desconocido → no se sube nada; OK → adelante", async () => {
  const log: string[] = [];
  const ident = await precomprobarIdentidad(async () => ({ error: { message: "SOPORTE_IDENTIDAD: x", code: "F4521" } }));
  assert.equal(ident, MENSAJE_IDENTIDAD);
  const otro = await precomprobarIdentidad(async () => { throw new Error("fetch failed"); });
  assert.match(otro ?? "", /No se subió nada/);
  assert.equal(await precomprobarIdentidad(async () => ({ error: null })), null);
  // el llamador solo sube cuando la precomprobación devuelve null: con error, subirYVincular no se invoca
  if (ident === null) await subirYVincular(deps({ log }), { path: "C/9.pdf", archivo, bytes: PDF });
  assert.deepEqual(log, []);
});

test("precomprobación OK + registro rechazado SOPORTE_IDENTIDAD: se borra solo el archivo nuevo y sale el mensaje de identidad", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log, registrar: async () => ({ error: { message: "SOPORTE_IDENTIDAD" } }) }), { path: "C/3.pdf", archivo, bytes: PDF });
  assert.deepEqual(log, ["subir C/3.pdf", "borrar C/3.pdf"]);
  assert.equal(r.ok ? "" : r.error, MENSAJE_IDENTIDAD);
});

test("registro con error de transporte: archivo conservado + alerta (sin cambios)", async () => {
  const log: string[] = [];
  const r = await subirYVincular(deps({ log, registrar: async () => ({ error: { message: "TypeError: fetch failed" } }) }), { path: "C/4.pdf", archivo, bytes: PDF });
  assert.equal(r.ok, false);
  assert.ok(!log.some((l) => l.startsWith("borrar")));
  assert.ok(log.includes("conciliar C/4.pdf"));
});

test("clasificación: SOPORTE_IDENTIDAD es rechazo definitivo; CONTRATO_CAMBIO / IDENTIDAD_REQUERIDA no (incierto: se conserva y se alerta)", async () => {
  assert.equal(esRechazoDefinitivo({ message: "SOPORTE_IDENTIDAD" }), true);
  assert.equal(esRechazoDefinitivo({ message: "CONTRATO_CAMBIO" }), false);
  assert.equal(esRechazoDefinitivo({ message: "IDENTIDAD_REQUERIDA" }), false);
  const log: string[] = [];
  await subirYVincular(deps({ log, registrar: async () => ({ error: { message: "CONTRATO_CAMBIO: uid" } }) }), { path: "C/5.pdf", archivo, bytes: PDF });
  assert.ok(!log.some((l) => l.startsWith("borrar")) && log.includes("conciliar C/5.pdf"));
});
