import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cadenaDe, correrCola, debeEncadenar, MAX_CADENA, PEOR_LLAMADA_MS, PRESUPUESTO_RUTA_MS, urlRuta, type RpcAdmin } from "../lib/tarifario/continuacionPublicacion.ts";

// Cola falsa: cada llamada al trabajador avanza `porLlamada` pasos y cuesta `msLlamada` de reloj falso.
function colaFalsa(opts: { pendientes: number; porLlamada?: number; msLlamada?: number; falla?: string; sinVencidos?: number }) {
  const est = { t: 0, llamadas: 0, pendientes: opts.pendientes, sinVencidos: opts.sinVencidos ?? 0, dormidos: 0 };
  const rpc: RpcAdmin = async (fn, args) => {
    assert.equal(fn, "tarifario_cola_correr");
    assert.equal(args.p_presupuesto_ms, 12_000);
    est.llamadas++; est.t += opts.msLlamada ?? 12_000;
    if (opts.falla) return { data: null, error: { message: opts.falla } };
    if (est.sinVencidos > 0) { est.sinVencidos--; return { data: { pasos: 0, ultimo: null, en_cola: est.pendientes }, error: null }; }
    const n = Math.min(est.pendientes, opts.porLlamada ?? 3);
    est.pendientes -= n;
    return { data: { pasos: n, ultimo: "lote:1", en_cola: est.pendientes }, error: null };
  };
  return { est, rpc, reloj: () => est.t, dormir: async (ms: number) => { est.dormidos++; est.t += ms; } };
}

describe("continuación sin navegador: la ruta corre el trabajador de la base", () => {
  test("cola corta: se vacía en una invocación y no se encadena", async () => {
    const c = colaFalsa({ pendientes: 5 });
    const r = await correrCola(c.rpc, { reloj: c.reloj, dormir: c.dormir });
    assert.equal(r.enCola, 0); assert.equal(r.pasos, 5); assert.equal(debeEncadenar(r, 0), false);
  });

  test("cola larga: usa su presupuesto, NUNCA lo excede (cabe en el maxDuration de 60 s) y pide encadenar otra invocación", async () => {
    const c = colaFalsa({ pendientes: 1000, msLlamada: 15_000 });
    const r = await correrCola(c.rpc, { reloj: c.reloj, dormir: c.dormir });
    assert.ok(r.enCola > 0);
    assert.ok(c.est.t <= PRESUPUESTO_RUTA_MS, `tiempo usado ${c.est.t}`);
    assert.ok(c.est.t + PEOR_LLAMADA_MS > PRESUPUESTO_RUTA_MS, "aprovechó la ventana (otra llamada ya no cabría)");
    assert.equal(debeEncadenar(r, 0), true);
  });

  test("la cadena tiene tope: no se encadena para siempre", () => {
    const r = { llamadas: 1, pasos: 3, enCola: 9, ultimo: null, error: null };
    assert.equal(debeEncadenar(r, MAX_CADENA - 1), true);
    assert.equal(debeEncadenar(r, MAX_CADENA), false);
  });

  test("un error del trabajador corta la ejecución y NO encadena (no hay bucle de reintentos desde la ruta; la base reintenta con espera creciente)", async () => {
    const c = colaFalsa({ pendientes: 9, falla: "boom" });
    const r = await correrCola(c.rpc, { reloj: c.reloj, dormir: c.dormir });
    assert.equal(r.error, "boom"); assert.equal(r.llamadas, 1); assert.equal(debeEncadenar(r, 0), false);
  });

  test("con trabajo en cola pero nada vencido (esperando reintento) espera en vez de girar en vacío", async () => {
    const c = colaFalsa({ pendientes: 2, sinVencidos: 2, msLlamada: 100 });
    const r = await correrCola(c.rpc, { reloj: c.reloj, dormir: c.dormir });
    assert.equal(c.est.dormidos, 2); assert.equal(r.enCola, 0);
  });

  test("el encabezado de cadena se valida (un valor raro vuelve a 0) y la URL sale del sitio configurado", () => {
    assert.equal(cadenaDe("7"), 7); assert.equal(cadenaDe("-1"), 0); assert.equal(cadenaDe("abc"), 0); assert.equal(cadenaDe(null), 0); assert.equal(cadenaDe("99999"), 0);
    assert.equal(urlRuta({ NEXT_PUBLIC_SITE_URL: "https://x.test/" }), "https://x.test/api/cron/publicacion-tarifario");
    assert.equal(urlRuta({ VERCEL_URL: "p.vercel.app" }), "https://p.vercel.app/api/cron/publicacion-tarifario");
  });
});
