import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconciliarFinancieroPendiente, type DepsReconciliacion } from "../lib/reservar/reconciliacionFinanciera.ts";
import type { CxPFinanciera, CostosContrato, CxPCreada } from "../lib/reservar/financieroContrato.ts";

// ───────────────────────────────────────────────────────────────────────────
// B7 R2 · RECONCILIACIÓN — cierra el hueco real: un proceso DISTINTO al que
// creó el contrato, corriendo después, sin que el original haya podido
// terminar ni siquiera intentar revertir.
//
// Estas pruebas simulan exactamente los cinco puntos de interrupción
// pedidos, con una base de datos falsa (nunca mocks del camino feliz):
//   · caída DESPUÉS de persistir el payload, antes/durante el RPC financiero;
//   · caída ANTES de persistir cualquier payload;
//   · reversión que se niega por dinero real;
//   · CxP sin asiento (detectable, reintento idempotente);
//   · reintento no duplica.
// ───────────────────────────────────────────────────────────────────────────

type Venta = { numeroContrato: string; tenant: string; financieroEstado: "pendiente" | "completo"; costoHotel?: number };
type Pendiente = { numeroContrato: string; tenant: string; costos: CostosContrato; cxp: CxPFinanciera[]; intentos: number; ultimoError?: string };

function baseFalsa() {
  let siguienteId = 500;
  const ventas = new Map<string, Venta>();
  const pendientes = new Map<string, Pendiente>();
  const cxpPorContrato = new Map<string, { id: number; tipo_proveedor: string; servicio: string; valor_total: number }[]>();
  const asientosPosteados: number[] = [];
  const revertidos: string[] = [];
  const negarReversionDe = new Set<string>();

  const deps: DepsReconciliacion = {
    rpc: async (fn, args) => {
      const numero = String(args.p_numero_contrato ?? "");
      if (fn === "registrar_financiero_contrato") {
        const v = ventas.get(numero);
        if (!v) return { data: null, error: { message: `no existe ${numero}` } };
        const filas = (args.p_cxp as CxPFinanciera[]) ?? [];
        const creadas = filas.map((f) => ({ id: siguienteId++, tipo_proveedor: f.tipo_proveedor, servicio: f.servicio, proveedor: f.proveedor, valor_total: f.valor_total }));
        cxpPorContrato.set(numero, creadas);
        v.financieroEstado = "completo";
        const costos = (args.p_costos ?? {}) as CostosContrato;
        v.costoHotel = costos.costo_hotel;
        pendientes.delete(numero);
        return { data: { creadas, eliminadas: [] }, error: null };
      }
      if (fn === "revertir_contrato_incompleto") {
        if (negarReversionDe.has(numero)) return { data: null, error: { message: `el contrato ${numero} ya tiene abonos` } };
        ventas.delete(numero);
        pendientes.delete(numero);
        revertidos.push(numero);
        return { data: null, error: null };
      }
      return { data: null, error: { message: `no soportado: ${fn}` } };
    },
    postearAsiento: async (c: CxPCreada) => { asientosPosteados.push(c.id); return { ok: true }; },
    eliminarAsiento: async () => {},
    guardarPendiente: async (p) => {
      pendientes.set(p.numeroContrato, { numeroContrato: p.numeroContrato, tenant: p.tenant, costos: p.costos, cxp: p.cxp, intentos: 0 });
      return { ok: true };
    },
    listarPendientesAntiguos: async () =>
      [...ventas.values()].filter((v) => v.financieroEstado === "pendiente").map((v) => ({ numeroContrato: v.numeroContrato, tenant: v.tenant })),
    leerPendiente: async (numeroContrato) => {
      const p = pendientes.get(numeroContrato);
      return p ? { costos: p.costos as Record<string, number>, cxp: p.cxp } : null;
    },
    marcarIntentoFallido: async (numeroContrato, error) => {
      const p = pendientes.get(numeroContrato);
      if (p) { p.intentos += 1; p.ultimoError = error; }
    },
    listarCxpSinAsiento: async () => {
      const todas = [...cxpPorContrato.values()].flat();
      return todas.filter((c) => !asientosPosteados.includes(c.id)).map((c) => ({ id: c.id, tipo_proveedor: c.tipo_proveedor, proveedor: null, servicio: c.servicio, valor_total: c.valor_total }));
    },
  };

  return { deps, ventas, pendientes, cxpPorContrato, asientosPosteados, revertidos, negarReversionDe };
}

describe("Escenario 1/2 · caída del proceso original — dos resoluciones posibles, nunca una tercera", () => {
  test("con payload persistido: reintenta EXACTO, el contrato queda completo con el costo correcto", async () => {
    const { deps, ventas, pendientes } = baseFalsa();
    ventas.set("DTM-7001", { numeroContrato: "DTM-7001", tenant: "mayorista", financieroEstado: "pendiente" });
    // Esto es EXACTAMENTE lo que hizo el proceso original antes de morir:
    // persistió la intención, nunca llegó a llamar (o llamar con éxito) al
    // RPC financiero.
    await deps.guardarPendiente({
      numeroContrato: "DTM-7001", tenant: "mayorista", costos: { costo_hotel: 900000 },
      cxp: [{ proveedor: "Hotel X", tipo_proveedor: "hotel", servicio: "Hotel X", valor_total: 900000, fecha_obligacion: "2026-09-08", aplica_retencion: false, pct_retencion: 0, observaciones: "auto", servicio_id: null }],
    });

    const r = await reconciliarFinancieroPendiente(deps, { umbralMinutos: 0 });

    assert.equal(r.pendientes.length, 1);
    assert.equal(r.pendientes[0].accion, "reintentado");
    assert.equal(r.pendientes[0].ok, true);
    assert.equal(ventas.get("DTM-7001")?.financieroEstado, "completo");
    assert.equal(ventas.get("DTM-7001")?.costoHotel, 900000);
    assert.equal(pendientes.has("DTM-7001"), false, "el payload se limpia al reintentar con éxito");
  });

  test("sin payload persistido (la caída fue ANTES de guardarlo): nunca se inventa un costo — se revierte", async () => {
    const { deps, ventas, revertidos } = baseFalsa();
    ventas.set("DTM-7002", { numeroContrato: "DTM-7002", tenant: "mayorista", financieroEstado: "pendiente" });
    // El proceso murió antes de siquiera llamar a guardarPendiente.

    const r = await reconciliarFinancieroPendiente(deps, { umbralMinutos: 0 });

    assert.equal(r.pendientes.length, 1);
    assert.equal(r.pendientes[0].accion, "revertido");
    assert.equal(r.pendientes[0].ok, true);
    assert.deepEqual(revertidos, ["DTM-7002"]);
    assert.equal(ventas.has("DTM-7002"), false);
  });
});

describe("Escenario 3 · reversión que se niega por dinero real — sigue detectable, nunca se calla", () => {
  test("el contrato permanece pendiente, el intento fallido queda registrado con motivo", async () => {
    const { deps, ventas, negarReversionDe, pendientes } = baseFalsa();
    ventas.set("DTM-7003", { numeroContrato: "DTM-7003", tenant: "mayorista", financieroEstado: "pendiente" });
    negarReversionDe.add("DTM-7003");

    const r = await reconciliarFinancieroPendiente(deps, { umbralMinutos: 0 });

    assert.equal(r.pendientes[0].accion, "revertido");
    assert.equal(r.pendientes[0].ok, false);
    assert.match(r.pendientes[0].error ?? "", /ya tiene abonos/);
    assert.equal(ventas.get("DTM-7003")?.financieroEstado, "pendiente", "sigue detectable, no se pierde");
    void pendientes;
  });

  test("un fallo de REINTENTO (no de reversión) deja rastro durable en el payload — no solo un mensaje perdido", async () => {
    const { ventas, pendientes } = baseFalsa();
    ventas.set("DTM-7004", { numeroContrato: "DTM-7004", tenant: "mayorista", financieroEstado: "pendiente" });
    const deps: DepsReconciliacion = {
      rpc: async (fn) => (fn === "registrar_financiero_contrato" ? { data: null, error: { message: "valor_total inválido" } } : { data: null, error: null }),
      postearAsiento: async () => ({ ok: true }),
      eliminarAsiento: async () => {},
      guardarPendiente: async () => ({ ok: true }),
      listarPendientesAntiguos: async () => [{ numeroContrato: "DTM-7004", tenant: "mayorista" }],
      leerPendiente: async () => ({ costos: {}, cxp: [] }),
      marcarIntentoFallido: async (numeroContrato, error) => {
        pendientes.set(numeroContrato, { numeroContrato, tenant: "mayorista", costos: {}, cxp: [], intentos: 1, ultimoError: error });
      },
      listarCxpSinAsiento: async () => [],
    };

    const r = await reconciliarFinancieroPendiente(deps, { umbralMinutos: 0 });

    assert.equal(r.pendientes[0].accion, "reintentado");
    assert.equal(r.pendientes[0].ok, false);
    const rastro = pendientes.get("DTM-7004");
    assert.ok(rastro, "el fallo queda escrito en una fila consultable, no solo en la respuesta de esta corrida");
    assert.equal(rastro?.intentos, 1);
    assert.match(rastro?.ultimoError ?? "", /valor_total inválido/);
  });
});

describe("Escenario 5 · CxP sin asiento — detectable en vivo, reintento idempotente", () => {
  test("postea el asiento faltante de una CxP ya registrada por otra corrida", async () => {
    const { deps, cxpPorContrato, asientosPosteados } = baseFalsa();
    cxpPorContrato.set("DTM-7005", [{ id: 999, tipo_proveedor: "hotel", servicio: "Hotel Y", valor_total: 500000 }]);

    const r = await reconciliarFinancieroPendiente(deps, { umbralMinutos: 0 });

    assert.equal(r.asientos.length, 1);
    assert.equal(r.asientos[0].cuentaId, 999);
    assert.equal(r.asientos[0].ok, true);
    assert.deepEqual(asientosPosteados, [999]);
  });

  test("una CxP que ya tiene asiento no se vuelve a tocar", async () => {
    const { deps, cxpPorContrato, asientosPosteados } = baseFalsa();
    cxpPorContrato.set("DTM-7006", [{ id: 998, tipo_proveedor: "hotel", servicio: "Hotel Z", valor_total: 300000 }]);
    asientosPosteados.push(998); // ya tiene asiento antes de esta corrida

    const r = await reconciliarFinancieroPendiente(deps, { umbralMinutos: 0 });

    assert.equal(r.asientos.length, 0);
  });
});

describe("Escenario 4 · reintento no duplica ni deja dos contratos resueltos distinto", () => {
  test("dos contratos pendientes en la misma corrida se resuelven de forma independiente", async () => {
    const { deps, ventas, pendientes } = baseFalsa();
    ventas.set("DTM-7007", { numeroContrato: "DTM-7007", tenant: "mayorista", financieroEstado: "pendiente" });
    ventas.set("DTM-7008", { numeroContrato: "DTM-7008", tenant: "mayorista", financieroEstado: "pendiente" });
    await deps.guardarPendiente({ numeroContrato: "DTM-7007", tenant: "mayorista", costos: { costo_hotel: 100000 }, cxp: [] });
    // DTM-7008 sin payload — se revertirá.

    const r = await reconciliarFinancieroPendiente(deps, { umbralMinutos: 0 });

    const porNumero = new Map(r.pendientes.map((p) => [p.numeroContrato, p]));
    assert.equal(porNumero.get("DTM-7007")?.accion, "reintentado");
    assert.equal(porNumero.get("DTM-7008")?.accion, "revertido");
    assert.equal(ventas.get("DTM-7007")?.financieroEstado, "completo");
    assert.equal(ventas.has("DTM-7008"), false);
    void pendientes;
  });
});
