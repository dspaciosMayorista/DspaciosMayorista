import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  registrarFinancieroContrato, revertirContratoIncompleto,
  type CxPFinanciera, type DepsFinanciero,
} from "../lib/reservar/financieroContrato.ts";

// ───────────────────────────────────────────────────────────────────────────
// #44 · K15 — reentrada de la escritura financiera (migración 210).
//
// Ejecuta el orquestador REAL (`registrarFinancieroContrato` / `revertirContrato
// Incompleto`) contra una base falsa que reproduce el CONTRATO de las dos RPC de
// la 210: `registrar_financiero_contrato` solo actúa sobre un contrato pendiente
// (si no, responde {ya_completo:true} sin tocar nada) y `revertir_contrato_
// incompleto` no borra un contrato que la RPC ya completó (responde
// {estado:'ya_completo'}). El comportamiento real de las RPC, las carreras y los
// permisos se prueban en Postgres: test_210_financiero_contrato.sql,
// test_210_carrera.sh y test_210_app_rpc.sh. Aquí se prueba lo que decide la
// aplicación: no confundir un no-op con un fallo, no mover asientos y no
// revertir un contrato completo.
// ───────────────────────────────────────────────────────────────────────────

const cxp = (servicio: string, valor = 100000): CxPFinanciera => ({
  proveedor: "Proveedor X", tipo_proveedor: "hotel", servicio, valor_total: valor, fecha_obligacion: "2026-10-01",
  aplica_retencion: false, pct_retencion: 0, observaciones: "Generado automáticamente desde el tarifario", servicio_id: null,
});
const PARAMS = { numeroContrato: "DTM-0451", tenant: "mayorista", fecha: "2026-10-01" };

type Estado = {
  financiero: "pendiente" | "completo";
  registrado: boolean;          // financiero_registrado_en
  existe: boolean;
  cxp: { id: number; servicio: string }[];
  asientosPosteados: number[];
  asientosBorrados: number[];
  llamadas: string[];
  pendientes: number;
};
function baseFalsa(inicial: Partial<Estado> = {}, opts: { perderRespuesta?: boolean; fallaRpc?: string; fallaPendiente?: string; sinRespuestaRevertir?: boolean } = {}) {
  let id = 500;
  const e: Estado = { financiero: "pendiente", registrado: false, existe: true, cxp: [], asientosPosteados: [], asientosBorrados: [], llamadas: [], pendientes: 0, ...inicial };
  const deps: DepsFinanciero = {
    rpc: async (fn, args) => {
      e.llamadas.push(fn);
      if (fn === "registrar_financiero_contrato") {
        if (opts.fallaRpc) return { data: null, error: { message: opts.fallaRpc } };
        if (!e.existe) return { data: null, error: { message: "el contrato no existe" } };
        if (e.financiero !== "pendiente") { e.pendientes = 0; return { data: { creadas: [], eliminadas: [], ya_completo: true, estado: e.financiero }, error: null }; }
        const filas = (args.p_cxp as CxPFinanciera[]) ?? [];
        const creadas = filas.map((f) => { const fila = { id: id++, servicio: f.servicio, tipo_proveedor: f.tipo_proveedor, proveedor: f.proveedor, valor_total: f.valor_total }; e.cxp.push({ id: fila.id, servicio: f.servicio }); return fila; });
        e.financiero = "completo"; e.registrado = true; e.pendientes = 0;
        // La transacción COMMITEÓ, pero la respuesta no llega (corte de red / proceso que muere).
        if (opts.perderRespuesta) return { data: null, error: { message: "fetch failed" } };
        return { data: { creadas, eliminadas: [] }, error: null };
      }
      if (fn === "revertir_contrato_incompleto") {
        if (!e.existe) return { data: opts.sinRespuestaRevertir ? null : { estado: "no_existe" }, error: null };
        if (e.financiero === "completo" && e.registrado) return { data: { estado: "ya_completo" }, error: null };
        e.existe = false; e.cxp = []; e.pendientes = 0;
        return { data: opts.sinRespuestaRevertir ? null : { estado: "revertido" }, error: null };
      }
      return { data: null, error: { message: `RPC no soportado: ${fn}` } };
    },
    postearAsiento: async (c) => { e.asientosPosteados.push(c.id); return { ok: true }; },
    eliminarAsiento: async (cuentaId) => { e.asientosBorrados.push(cuentaId); },
    guardarPendiente: async () => {
      if (opts.fallaPendiente) return { ok: false, error: opts.fallaPendiente };
      if (e.financiero === "pendiente") e.pendientes = 1; // 210: para un contrato ya cerrado el trigger lo descarta
      return { ok: true };
    },
  };
  return { deps, e };
}

describe("K15 · la escritura ocurre una sola vez", () => {
  test("primera escritura: CxP, asientos y contrato completo", async () => {
    const { deps, e } = baseFalsa();
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: { costo_hotel: 1 }, cxp: [cxp("A"), cxp("B")] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.creadas.length, 2);
    assert.equal(r.yaCompleto, undefined);
    assert.equal(e.asientosPosteados.length, 2);
    assert.equal(e.pendientes, 0);
  });

  test("reentrada sobre un contrato ya completo: ÉXITO sin cambios — ni se borran ni se postean asientos, ni se revierte", async () => {
    const { deps, e } = baseFalsa({ financiero: "completo", registrado: true, cxp: [{ id: 1, servicio: "A" }] });
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: { costo_hotel: 1 }, cxp: [cxp("A")] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.yaCompleto, true);
    assert.deepEqual(r.creadas, [], "no devuelve CxP nuevas");
    assert.match(r.avisos.join(" "), /ya estaba registrada/);
    assert.deepEqual(e.asientosPosteados, [], "no postea asientos");
    assert.deepEqual(e.asientosBorrados, [], "no borra asientos");
    assert.ok(!e.llamadas.includes("revertir_contrato_incompleto"), "no compensa: no es un fallo");
    assert.deepEqual(e.cxp, [{ id: 1, servicio: "A" }], "las CxP existentes no se tocan");
    assert.equal(e.pendientes, 0, "sin residuo del pendiente");
  });

  test("doble proceso: dos escrituras seguidas dejan UNA sola serie de CxP y UN solo juego de asientos", async () => {
    const { deps, e } = baseFalsa();
    const a = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A"), cxp("B")] });
    const b = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A"), cxp("B")] });
    assert.equal(a.ok && b.ok, true);
    assert.equal(e.cxp.length, 2);
    assert.equal(e.asientosPosteados.length, 2);
    assert.deepEqual(e.asientosBorrados, []);
    assert.equal(e.pendientes, 0);
  });
});

describe("K15 · la compensación no destruye un contrato completo", () => {
  test("respuesta perdida: la RPC confirmó pero el proceso no lo supo → no se revierte; el contrato se conserva y se informa", async () => {
    const { deps, e } = baseFalsa({}, { perderRespuesta: true });
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A"), cxp("B")] });
    assert.equal(r.ok, true, "el dinero SÍ quedó escrito: no es un fallo");
    if (!r.ok) return;
    assert.equal(r.yaCompleto, true);
    assert.match(r.avisos.join(" "), /ya había quedado registrada.*reconciliación.*fetch failed/);
    assert.equal(e.existe, true, "el contrato se conserva");
    assert.equal(e.cxp.length, 2, "las CxP se conservan");
    assert.equal(e.pendientes, 0);
    assert.deepEqual(e.asientosBorrados, []);
  });

  test("error real de la RPC con el contrato aún pendiente: se revierte, como siempre", async () => {
    const { deps, e } = baseFalsa({}, { fallaRpc: "valor_total inválido" });
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A")] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.revertido, true);
    assert.match(r.error, /valor_total inválido/);
    assert.equal(e.existe, false);
  });

  test("error de la RPC mientras OTRA sesión completaba el contrato: no se revierte", async () => {
    const { deps, e } = baseFalsa({ financiero: "completo", registrado: true, cxp: [{ id: 7, servicio: "A" }] }, { fallaRpc: "canceling statement due to lock timeout" });
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A")] });
    assert.equal(r.ok, true);
    assert.equal(e.existe, true);
    assert.equal(e.cxp.length, 1);
  });

  test("no se pudo ni guardar el payload y otra sesión ya completó: se conserva el contrato", async () => {
    const { deps, e } = baseFalsa({ financiero: "completo", registrado: true }, { fallaPendiente: "timeout" });
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A")] });
    assert.equal(r.ok, true);
    assert.equal(e.existe, true);
  });

  test("revertirContratoIncompleto: ya_completo → ok:false con completado:true (los demás llamadores lo ven como 'no se pudo deshacer')", async () => {
    const { deps } = baseFalsa({ financiero: "completo", registrado: true });
    const r = await revertirContratoIncompleto(deps, "DTM-0451", "mayorista");
    assert.equal(r.ok, false);
    assert.equal(r.completado, true);
    assert.match(r.error ?? "", /ya quedó completo/);
  });

  test("revertirContratoIncompleto: revertido / no_existe / respuesta vacía de la versión 172 (void) → ok:true", async () => {
    for (const [inicial, opts] of [[{}, {}], [{ existe: false }, {}], [{}, { sinRespuestaRevertir: true }]] as const) {
      const { deps } = baseFalsa(inicial, opts);
      const r = await revertirContratoIncompleto(deps, "DTM-0451", "mayorista");
      assert.equal(r.ok, true);
      assert.equal(r.completado, undefined);
    }
  });

  test("la reversión misma falla: el error se dice (nunca se traga)", async () => {
    const { deps } = baseFalsa({}, { fallaRpc: "boom" });
    deps.rpc = async (fn) => (fn === "revertir_contrato_incompleto" ? { data: null, error: { message: "ya tiene abonos" } } : { data: null, error: { message: "boom" } });
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A")] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.revertido, false);
    assert.match(r.error, /DTM-0451/);
    assert.match(r.error, /ya tiene abonos/);
  });
});

describe("K15 · regresión: el camino de fallo anterior se conserva", () => {
  test("la coherencia (CxP esperadas ≠ creadas) revierte mientras el contrato esté pendiente", async () => {
    const { deps, e } = baseFalsa();
    const base = deps.rpc;
    deps.rpc = async (fn, args) => {
      if (fn === "registrar_financiero_contrato") { e.llamadas.push(fn); return { data: { creadas: [], eliminadas: [] }, error: null }; }
      return base(fn, args);
    };
    const r = await registrarFinancieroContrato(deps, { ...PARAMS, costos: {}, cxp: [cxp("A")] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.revertido, true);
    assert.match(r.error, /se esperaban 1 cuentas por pagar y se registraron 0/);
  });
});
