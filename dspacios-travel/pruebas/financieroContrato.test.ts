import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  registrarFinancieroContrato, revertirContratoIncompleto,
  type CxPFinanciera, type DepsFinanciero,
} from "../lib/reservar/financieroContrato.ts";

// ───────────────────────────────────────────────────────────────────────────
// B7 · ESCRITURA FINANCIERA ATÓMICA
//
// Antes, crear un contrato escribía el costo y las cuentas por pagar en
// llamadas sueltas envueltas en `try/catch`: si una fallaba, la operación
// devolvía ÉXITO con el contrato creado y la deuda con el proveedor
// inexistente. Estas pruebas ejecutan el orquestador de verdad contra una
// base FALSA que puede fallar a voluntad — no comprueban comentarios ni
// texto: comprueban qué pasa cuando la escritura financiera se cae.
//
// La atomicidad de la transacción misma (que no quede media lista de CxP) la
// verifica `supabase/scripts/test_171_financiero_atomico.sql` sobre Postgres
// real. Acá se verifica lo que decide la aplicación: no reportar éxito y no
// dejar un contrato fantasma.
// ───────────────────────────────────────────────────────────────────────────

function cxp(over: Partial<CxPFinanciera> & { tipo_proveedor: string; servicio: string }): CxPFinanciera {
  return {
    proveedor: "Proveedor X", valor_total: 100000, fecha_obligacion: "2026-09-08",
    aplica_retencion: false, pct_retencion: 0, observaciones: "Generado automáticamente desde el tarifario",
    servicio_id: null,
    ...over,
  };
}

/** Base falsa: registra todo lo que pasó y permite forzar fallos concretos. */
function baseFalsa(opts?: { fallaRegistro?: string; fallaReversion?: string; fallaAsiento?: string }) {
  let siguienteId = 100;
  const estado = {
    contratoExiste: true,
    cxpCreadas: [] as { id: number; tipo_proveedor: string; servicio: string; servicio_id: number | null }[],
    asientosPosteados: [] as number[],
    asientosBorrados: [] as number[],
    llamadas: [] as string[],
  };
  const deps: DepsFinanciero = {
    rpc: async (fn, args) => {
      estado.llamadas.push(fn);
      if (fn === "registrar_financiero_contrato") {
        if (opts?.fallaRegistro) return { data: null, error: { message: opts.fallaRegistro } };
        // Idempotencia: la transacción reemplaza las CxP automáticas previas.
        const eliminadas = estado.cxpCreadas.map((c) => c.id);
        estado.cxpCreadas = [];
        const filas = (args.p_cxp as CxPFinanciera[]) ?? [];
        const creadas = filas.map((f) => {
          const fila = { id: siguienteId++, tipo_proveedor: f.tipo_proveedor, servicio: f.servicio, servicio_id: f.servicio_id, valor_total: f.valor_total, proveedor: f.proveedor };
          estado.cxpCreadas.push(fila);
          return fila;
        });
        return { data: { creadas, eliminadas }, error: null };
      }
      if (fn === "revertir_contrato_incompleto") {
        if (opts?.fallaReversion) return { data: null, error: { message: opts.fallaReversion } };
        estado.contratoExiste = false;
        estado.cxpCreadas = [];
        return { data: null, error: null };
      }
      return { data: null, error: { message: `RPC no soportado: ${fn}` } };
    },
    postearAsiento: async (c) => {
      if (opts?.fallaAsiento) return { ok: false, error: opts.fallaAsiento };
      estado.asientosPosteados.push(c.id);
      return { ok: true };
    },
    eliminarAsiento: async (id) => { estado.asientosBorrados.push(id); },
  };
  return { deps, estado };
}

const PARAMS = { numeroContrato: "DTM-0451", tenant: "mayorista", fecha: "2026-09-08" };

describe("B7 · éxito: costos y CxP quedan, cada servicio con la suya", () => {
  test("una CxP por fila enviada, y el asiento de cada una", async () => {
    const { deps, estado } = baseFalsa();
    const r = await registrarFinancieroContrato(deps, {
      ...PARAMS,
      costos: { costo_hotel: 1200000, costo_receptivo: 300000 },
      cxp: [
        cxp({ tipo_proveedor: "hotel", servicio: "Hotel X", valor_total: 1200000 }),
        cxp({ tipo_proveedor: "receptivo", servicio: "Traslado grupal", valor_total: 180000, servicio_id: 991711 }),
        cxp({ tipo_proveedor: "receptivo", servicio: "City tour", valor_total: 120000, servicio_id: 991712 }),
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.creadas.length, 3);
    assert.equal(estado.asientosPosteados.length, 3);
    assert.equal(estado.contratoExiste, true);
    assert.ok(!estado.llamadas.includes("revertir_contrato_incompleto"), "no debe revertir cuando todo salió bien");
  });

  test("A4 · dos servicios del MISMO tipo_proveedor conservan CxP independiente por servicio_id", async () => {
    const { deps, estado } = baseFalsa();
    const r = await registrarFinancieroContrato(deps, {
      ...PARAMS,
      costos: { costo_receptivo: 300000 },
      cxp: [
        cxp({ tipo_proveedor: "receptivo", servicio: "Traslado grupal", valor_total: 180000, servicio_id: 991711 }),
        cxp({ tipo_proveedor: "receptivo", servicio: "City tour", valor_total: 120000, servicio_id: 991712 }),
      ],
    });
    assert.equal(r.ok, true);
    const receptivos = estado.cxpCreadas.filter((c) => c.tipo_proveedor === "receptivo");
    assert.equal(receptivos.length, 2, "no se fusionan por compartir tipo_proveedor");
    assert.deepEqual(receptivos.map((c) => c.servicio_id), [991711, 991712]);
  });
});

describe("B7 · fallo de la escritura financiera: ni éxito falso ni contrato fantasma", () => {
  test("A3 · si la transacción falla, NO se reporta éxito, no queda contrato y no se postea ningún asiento", async () => {
    const { deps, estado } = baseFalsa({ fallaRegistro: "deadlock detected" });
    const r = await registrarFinancieroContrato(deps, {
      ...PARAMS,
      costos: { costo_hotel: 1200000 },
      cxp: [cxp({ tipo_proveedor: "hotel", servicio: "Hotel X" })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.revertido, true);
    assert.match(r.error, /no se generó/i);
    assert.match(r.error, /deadlock detected/);
    assert.equal(estado.contratoExiste, false, "el contrato no puede sobrevivir a su escritura financiera");
    assert.equal(estado.cxpCreadas.length, 0);
    assert.equal(estado.asientosPosteados.length, 0, "ningún asiento parcial");
  });

  test("una excepción de red (no un error devuelto) tiene el mismo desenlace", async () => {
    const { estado, deps } = baseFalsa();
    const rpcOriginal = deps.rpc;
    const depsQueExplota: DepsFinanciero = {
      ...deps,
      rpc: async (fn, args) => {
        if (fn === "registrar_financiero_contrato") throw new Error("fetch failed");
        return rpcOriginal(fn, args);
      },
    };
    const r = await registrarFinancieroContrato(depsQueExplota, {
      ...PARAMS, costos: {}, cxp: [cxp({ tipo_proveedor: "hotel", servicio: "Hotel X" })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.revertido, true);
    assert.equal(estado.contratoExiste, false);
  });

  test("si TAMPOCO se puede revertir, el error lo dice con el número del contrato (nunca se calla)", async () => {
    const { deps, estado } = baseFalsa({ fallaRegistro: "permiso denegado", fallaReversion: "el contrato ya tiene abonos" });
    const r = await registrarFinancieroContrato(deps, {
      ...PARAMS, costos: {}, cxp: [cxp({ tipo_proveedor: "hotel", servicio: "Hotel X" })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.revertido, false);
    assert.match(r.error, /DTM-0451/);
    assert.match(r.error, /tampoco se pudo deshacer/i);
    assert.match(r.error, /ya tiene abonos/);
    assert.equal(estado.contratoExiste, true, "falla cerrado: no borra un contrato con dinero real");
  });

  test("si la transacción devuelve MENOS CxP de las enviadas, se trata como fallo (no éxito parcial)", async () => {
    const { estado, deps } = baseFalsa();
    const rpcOriginal = deps.rpc;
    const depsIncompleto: DepsFinanciero = {
      ...deps,
      rpc: async (fn, args) => {
        const res = await rpcOriginal(fn, args);
        if (fn === "registrar_financiero_contrato" && res.data) {
          const d = res.data as { creadas: unknown[]; eliminadas: number[] };
          return { data: { creadas: d.creadas.slice(0, 1), eliminadas: d.eliminadas }, error: null };
        }
        return res;
      },
    };
    const r = await registrarFinancieroContrato(depsIncompleto, {
      ...PARAMS,
      costos: {},
      cxp: [cxp({ tipo_proveedor: "hotel", servicio: "Hotel X" }), cxp({ tipo_proveedor: "aereo", servicio: "Aéreo X" })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /se esperaban 2 cuentas por pagar y se registraron 1/);
    assert.equal(estado.contratoExiste, false);
  });
});

describe("B7 · reintento: no duplica CxP ni asiento", () => {
  test("A5 · ejecutar dos veces deja las mismas CxP y borra el asiento de las reemplazadas", async () => {
    const { deps, estado } = baseFalsa();
    const filas = [
      cxp({ tipo_proveedor: "hotel", servicio: "Hotel X", valor_total: 1200000 }),
      cxp({ tipo_proveedor: "receptivo", servicio: "Traslado grupal", valor_total: 180000, servicio_id: 991711 }),
    ];
    const primera = await registrarFinancieroContrato(deps, { ...PARAMS, costos: { costo_hotel: 1200000 }, cxp: filas });
    assert.equal(primera.ok, true);
    if (!primera.ok) return;
    const idsPrimera = primera.creadas.map((c) => c.id);

    const segunda = await registrarFinancieroContrato(deps, { ...PARAMS, costos: { costo_hotel: 1200000 }, cxp: filas });
    assert.equal(segunda.ok, true);
    if (!segunda.ok) return;

    assert.equal(estado.cxpCreadas.length, 2, "el reintento reemplaza, no acumula");
    assert.deepEqual(estado.asientosBorrados, idsPrimera, "los asientos de las CxP reemplazadas se borran");
    assert.equal(estado.asientosPosteados.length, 4, "dos asientos por corrida, sin quedar duplicados vivos");
    const vivos = estado.asientosPosteados.filter((id) => !estado.asientosBorrados.includes(id));
    assert.equal(vivos.length, 2, "solo quedan vivos los asientos de las CxP vigentes");
  });
});

describe("B7 · el espejo contable no puede tumbar la reserva, pero tampoco se pierde", () => {
  test("si falla el asiento, el dinero (costo+CxP) queda y el fallo vuelve como aviso explícito", async () => {
    const { deps, estado } = baseFalsa({ fallaAsiento: "Falta la cuenta 613515 en el Plan de cuentas" });
    const r = await registrarFinancieroContrato(deps, {
      ...PARAMS, costos: { costo_receptivo: 120000 },
      cxp: [cxp({ tipo_proveedor: "receptivo", servicio: "City tour", valor_total: 120000, servicio_id: 9 })],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(estado.cxpCreadas.length, 1, "la obligación con el proveedor sí quedó registrada");
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0], /Falta la cuenta 613515/);
    assert.equal(estado.contratoExiste, true, "un problema contable no borra un contrato válido");
  });
});

describe("revertirContratoIncompleto", () => {
  test("devuelve ok cuando el contrato se borró", async () => {
    const { deps, estado } = baseFalsa();
    const r = await revertirContratoIncompleto(deps, "DTM-0451", "mayorista");
    assert.equal(r.ok, true);
    assert.equal(estado.contratoExiste, false);
  });
  test("devuelve el motivo cuando la reversión se niega (dinero real de por medio)", async () => {
    const { deps } = baseFalsa({ fallaReversion: "el contrato ya tiene pagos/retenciones a proveedor" });
    const r = await revertirContratoIncompleto(deps, "DTM-0451", "mayorista");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /pagos\/retenciones/);
  });
});
