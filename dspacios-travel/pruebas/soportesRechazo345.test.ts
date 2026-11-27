// S339-02 / 345 · reglas PURAS del rechazo: motivo, enlace, contenido del correo y orquestación del aviso (sin red, sin base).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validarMotivo, MOTIVO_MAX, construirCorreoRechazo, urlSoportesPortal, enviarAvisoRechazo, type DepsAviso, type Reclamo } from "../lib/soportes/rechazo.ts";
import type { Mensaje } from "../lib/solicitudProveedor/transporte.ts";

describe("validarMotivo", () => {
  test("recorta y exige 1..500", () => {
    assert.deepEqual(validarMotivo("  borroso \n"), { ok: true, motivo: "borroso" });
    for (const malo of ["", "   ", "\n\t", null, undefined, 5]) assert.equal(validarMotivo(malo).ok, false);
    assert.equal(validarMotivo("x".repeat(MOTIVO_MAX)).ok, true);
    assert.equal(validarMotivo("x".repeat(MOTIVO_MAX + 1)).ok, false);
  });
});

describe("urlSoportesPortal", () => {
  test("base del sitio sin barra final; respaldo a localhost; VERCEL_URL en hosting", () => {
    assert.equal(urlSoportesPortal({ NEXT_PUBLIC_SITE_URL: "https://app.example/" }), "https://app.example/portal/b2b/cartera?vista=soportes");
    assert.equal(urlSoportesPortal({}), "http://localhost:3000/portal/b2b/cartera?vista=soportes");
    assert.equal(urlSoportesPortal({ VERCEL_URL: "x.vercel.app" }), "https://x.vercel.app/portal/b2b/cartera?vista=soportes");
  });
});

describe("construirCorreoRechazo", () => {
  const c = construirCorreoRechazo({ numeroVisible: "00-0451", archivo: "pago <1>.pdf", motivo: "Es de \"otro\" contrato & no se lee", url: "http://x/y?a=1&b=2", nombre: "Ana" });
  test("lleva contrato, archivo, motivo y enlace; escapa HTML; aclara que no cambia ningún pago", () => {
    assert.equal(c.asunto, "Soporte de pago rechazado · Contrato 00-0451");
    assert.match(c.texto, /Hola Ana,/); assert.match(c.texto, /«pago <1>\.pdf»/); assert.match(c.texto, /Motivo: Es de "otro" contrato & no se lee/);
    assert.ok(c.texto.includes("http://x/y?a=1&b=2"));
    assert.ok(c.html.includes("pago &lt;1&gt;.pdf") && c.html.includes("&quot;otro&quot;") && c.html.includes("a=1&amp;b=2"), "HTML escapado");
    assert.ok(!c.html.includes("<1>"));
    assert.match(c.texto, /no confirma ni cambia ningún pago/);
  });
  test("sin nombre: saludo genérico", () => assert.match(construirCorreoRechazo({ numeroVisible: "1", archivo: "a", motivo: "m", url: "u" }).texto, /^Hola,/));
});

describe("enviarAvisoRechazo (dependencias inyectadas)", () => {
  const rec = (n: number): Reclamo => ({ id: 7, numero_contrato: "DTM-1", nombre_original: "a.pdf", motivo: "porque", intento: 1, destinatarios: Array.from({ length: n }, (_, i) => ({ email: `u${i}@x.test`, nombre: `U${i}` })) });
  function armar(o: { cfg?: boolean; reclamo?: Reclamo | null; reclamoError?: boolean; envio?: (m: Mensaje) => Promise<{ ok: true; mensajeId: null } | { ok: false; error: string; incierto?: boolean }> }) {
    const cierres: unknown[][] = []; const enviados: Mensaje[] = []; let reclamos = 0;
    const deps: DepsAviso = {
      config: () => (o.cfg === false ? { ok: false, error: "apagado" } : { ok: true, config: { modo: "captura", remitente: "r@x.test", responderA: "re@x.test", capturaUrl: "http://127.0.0.1:1" } }),
      transporte: () => ({ idempotente: false, ventanaIdempotenciaMs: 0, enviar: async (m) => { enviados.push(m); return (o.envio ? o.envio(m) : { ok: true, mensajeId: null }); } }),
      reclamar: async () => { reclamos++; return o.reclamoError ? { data: null, error: { message: "x" } } : { data: o.reclamo === undefined ? rec(1) : o.reclamo, error: null }; },
      cerrar: async (...a) => { cierres.push(a); },
      numeroVisible: (n) => n, url: "http://x/portal",
    };
    return { deps, cierres, enviados, reclamos: () => reclamos };
  }
  test("apagado: no reclama ni consume intento", async () => {
    const a = armar({ cfg: false }); const r = await enviarAvisoRechazo(7, a.deps);
    assert.equal(r.estado, "no_configurado"); assert.equal(a.reclamos(), 0); assert.equal(a.cierres.length, 0);
  });
  test("nada que reclamar / error al reclamar: no envía", async () => {
    for (const o of [{ reclamo: null }, { reclamoError: true }]) { const a = armar(o); assert.equal((await enviarAvisoRechazo(7, a.deps)).estado, "nada_que_enviar"); assert.equal(a.enviados.length, 0); }
  });
  test("sin destinatarios: cierra «sin_destinatario» sin enviar", async () => {
    const a = armar({ reclamo: rec(0) }); const r = await enviarAvisoRechazo(7, a.deps);
    assert.equal(r.estado, "sin_destinatario"); assert.deepEqual(a.cierres[0].slice(1, 3), ["sin_destinatario", 0]); assert.equal(a.enviados.length, 0);
  });
  test("un mensaje por destinatario, con clave de idempotencia por rechazo+destinatario; cierra «enviado»", async () => {
    const a = armar({ reclamo: rec(2) }); const r = await enviarAvisoRechazo(7, a.deps);
    assert.equal(r.estado, "enviado"); assert.equal(a.enviados.length, 2);
    assert.deepEqual(a.enviados.map((m) => m.para), [["u0@x.test"], ["u1@x.test"]]);
    assert.deepEqual(a.enviados.map((m) => m.claveIdempotencia), ["soporte-rechazo-7-u0@x.test", "soporte-rechazo-7-u1@x.test"]);
    assert.deepEqual(a.cierres[0].slice(0, 3), [7, "enviado", 2]);
  });
  test("fallo parcial = enviado a los que salieron (con nota); fallo total o excepción = «fallido»", async () => {
    const parcial = armar({ reclamo: rec(2), envio: async (m) => (m.para[0] === "u1@x.test" ? { ok: false, error: "boom" } : { ok: true, mensajeId: null }) });
    assert.equal((await enviarAvisoRechazo(7, parcial.deps)).estado, "enviado"); assert.match(String(parcial.cierres[0][3]), /1 destinatario\(s\) sin enviar/);
    const total = armar({ reclamo: rec(2), envio: async () => ({ ok: false, error: "caído", incierto: true }) });
    assert.equal((await enviarAvisoRechazo(7, total.deps)).estado, "fallido"); assert.deepEqual(total.cierres[0].slice(1, 3), ["fallido", 0]);
    const lanza = armar({ reclamo: rec(1), envio: async () => { throw new Error("red"); } });
    assert.equal((await enviarAvisoRechazo(7, lanza.deps)).estado, "fallido");
  });
});
