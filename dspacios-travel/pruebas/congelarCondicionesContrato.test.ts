// ─────────────────────────────────────────────────────────────────────────
// EJECUCIÓN REAL (no grep) del puente Rama B (lib/contrato/
// congelarCondicionesContrato.ts): construye el `ComponenteSnapshot` desde
// filas REALES de catálogo (hotel_temporadas/armado_paquetes/programas) y
// llama al RPC `congelar_condiciones_contrato` (migración 165) con un
// snapshot correctamente armado. No toca Supabase real — usa un cliente
// FALSO mínimo (mismo patrón que pruebas/tarifarioDatos.test.ts), inyectado
// como primer argumento de cada función exportada.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import {
  vigenciasCondicionDeHotel,
  componenteHotelReal,
  componentePaqueteReal,
  componenteProgramaReal,
  trmReferenciaAproximada,
  congelarCondicionesContrato,
  congelarCondicionesContratoBestEffort,
} from "../lib/contrato/congelarCondicionesContrato.ts";

type Admin = SupabaseClient<Database>;

/** Cliente Supabase falso: soporta `.from(t).select().eq()[.maybeSingle()]` y `.rpc()`. */
function clienteFalso(opts: {
  tablas?: Record<string, { data: unknown[] | unknown | null; error?: unknown }>;
  rpc?: (nombre: string, args: unknown) => { data: unknown; error: unknown };
}) {
  const rpcLlamadas: { nombre: string; args: unknown }[] = [];
  function builder(tabla: string) {
    const cfg = opts.tablas?.[tabla] ?? { data: null, error: null };
    const b = {
      select() { return this; },
      eq() { return this; },
      maybeSingle() {
        return Promise.resolve({ data: cfg.data ?? null, error: cfg.error ?? null });
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        resolve({ data: cfg.data ?? null, error: cfg.error ?? null });
      },
    };
    return b;
  }
  const sb = {
    from: builder,
    rpc(nombre: string, args: unknown) {
      rpcLlamadas.push({ nombre, args });
      const r = opts.rpc ? opts.rpc(nombre, args) : { data: "OK", error: null };
      return Promise.resolve(r);
    },
  };
  return { admin: sb as unknown as Admin, rpcLlamadas };
}

describe("vigenciasCondicionDeHotel", () => {
  test("traduce filas reales y descarta vigencias sin rango de fechas", async () => {
    const { admin } = clienteFalso({
      tablas: {
        hotel_temporadas: {
          data: [
            { id: 1, nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2027-01-15", condicion_pago_tipo: "pago_total", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null },
            { id: 2, nombre: "SIN FECHAS", fecha_inicio: null, fecha_fin: null, condicion_pago_tipo: "sin_condicion", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null },
          ],
        },
      },
    });
    const vigencias = await vigenciasCondicionDeHotel(admin, 99);
    assert.equal(vigencias.length, 1);
    assert.equal(vigencias[0].hotelTemporadaId, 1);
    assert.equal(vigencias[0].tipo, "pago_total");
    assert.equal(vigencias[0].restriccionComercial, "no_reembolsable_no_endosable");
  });

  test("error de Supabase → arreglo vacío (nunca lanza)", async () => {
    const { admin } = clienteFalso({ tablas: { hotel_temporadas: { data: null, error: { message: "boom" } } } });
    const vigencias = await vigenciasCondicionDeHotel(admin, 1);
    assert.deepEqual(vigencias, []);
  });
});

describe("componenteHotelReal — usa TODAS las vigencias reales, nunca el ganador del motor de precios", () => {
  test("estadía que cruza dos vigencias distintas aplica la MÁS EXIGENTE", async () => {
    const { admin } = clienteFalso({
      tablas: {
        hotel_temporadas: {
          data: [
            // BAJA: sin_condicion (neutra) cubre la primera noche.
            { id: 1, nombre: "BAJA", fecha_inicio: "2026-11-01", fecha_fin: "2026-12-05", condicion_pago_tipo: "sin_condicion", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null },
            // ALTA: pago_total (100%, la más exigente) cubre la segunda noche.
            { id: 2, nombre: "ALTA", fecha_inicio: "2026-12-05", fecha_fin: "2027-01-15", condicion_pago_tipo: "pago_total", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null },
          ],
        },
      },
    });
    const comp = await componenteHotelReal(admin, {
      hotelId: 10,
      id: "hotel-10",
      valor: 1_000_000,
      referencia: "Hotel Test",
      fechaIda: "2026-12-04",
      fechaRegreso: "2026-12-06",
      fechaPago: "2026-01-01",
    });
    assert.equal(comp.tipo, "hotel");
    assert.equal(comp.condicion?.tipo, "pago_total"); // la más exigente, no la neutra
    assert.equal(comp.restriccionComercial, "no_reembolsable_no_endosable");
    assert.equal(comp.valor, 1_000_000);
  });

  test("hotel sin ninguna vigencia restringida → restriccionComercial normal", async () => {
    const { admin } = clienteFalso({
      tablas: {
        hotel_temporadas: {
          data: [{ id: 1, nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", condicion_pago_tipo: "sin_condicion", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null }],
        },
      },
    });
    const comp = await componenteHotelReal(admin, {
      hotelId: 10, id: "h1", valor: 500_000, fechaIda: "2026-06-01", fechaRegreso: "2026-06-03", fechaPago: "2026-01-01",
    });
    assert.equal(comp.restriccionComercial, "normal");
    assert.equal(comp.condicion?.tipo, "sin_condicion");
  });
});

describe("componentePaqueteReal / componenteProgramaReal", () => {
  test("paquete existente con anticipo_saldo → componente real, no default", async () => {
    const { admin } = clienteFalso({
      tablas: {
        armado_paquetes: {
          data: { condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_inicial: 0.5, condicion_pago_dias_saldo: 30, restriccion_comercial: "normal" },
        },
      },
    });
    const comp = await componentePaqueteReal(admin, { paqueteId: 7, id: "paquete-7", valor: 2_000_000 });
    assert.ok(comp);
    assert.equal(comp!.tipo, "paquete");
    assert.equal(comp!.condicion?.pctInicial, 0.5);
    assert.equal(comp!.condicion?.diasSaldo, 30);
  });

  test("paquete inexistente → null (nunca inventa un default)", async () => {
    const { admin } = clienteFalso({ tablas: { armado_paquetes: { data: null, error: null } } });
    const comp = await componentePaqueteReal(admin, { paqueteId: 999, id: "paquete-999", valor: 1 });
    assert.equal(comp, null);
  });

  test("programa existente → componente tipo programa", async () => {
    const { admin } = clienteFalso({
      tablas: {
        programas: {
          data: { condicion_pago_tipo: "pago_total", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null, restriccion_comercial: "promocional_no_reembolsable_no_endosable" },
        },
      },
    });
    const comp = await componenteProgramaReal(admin, { programaId: 3, id: "programa-3", valor: 3_000_000 });
    assert.ok(comp);
    assert.equal(comp!.tipo, "programa");
    assert.equal(comp!.restriccionComercial, "promocional_no_reembolsable_no_endosable");
  });
});

describe("trmReferenciaAproximada", () => {
  test("COP siempre devuelve 1, sin consultar la tabla", async () => {
    const { admin } = clienteFalso({ tablas: { parametros_tributarios: { data: { valor: 4200 } } } });
    assert.equal(await trmReferenciaAproximada(admin, "COP"), 1);
  });
  test("USD con trm_referencia configurada → ese valor", async () => {
    const { admin } = clienteFalso({ tablas: { parametros_tributarios: { data: { valor: 4200 } } } });
    assert.equal(await trmReferenciaAproximada(admin, "USD"), 4200);
  });
  test("USD sin trm_referencia configurada → respaldo 1 (nunca 0/NaN)", async () => {
    const { admin } = clienteFalso({ tablas: { parametros_tributarios: { data: null } } });
    assert.equal(await trmReferenciaAproximada(admin, "USD"), 1);
  });
});

describe("congelarCondicionesContrato — construye el snapshot y llama al RPC de la 165", () => {
  test("arreglo de componentes vacío → no-op, JAMÁS llama al RPC", async () => {
    const { admin, rpcLlamadas } = clienteFalso({});
    const r = await congelarCondicionesContrato(admin, {
      numeroContrato: "DTM-1", componentes: [], moneda: "COP", trm: 1, precioTotalMoneda: 100,
      usuarioId: "u1",
    });
    assert.equal(r.ok, true);
    assert.equal((r as { noop?: boolean }).noop, true);
    assert.equal(rpcLlamadas.length, 0);
  });

  test("llama al RPC con el snapshot ya calculado (montos reales, no ceros)", async () => {
    const { admin, rpcLlamadas } = clienteFalso({});
    const r = await congelarCondicionesContrato(admin, {
      numeroContrato: "DTM-2",
      componentes: [{
        id: "hotel-1", tipo: "hotel", valor: 1_000_000,
        condicion: { tipo: "pago_total", pctInicial: null, diasSaldo: null },
        fechaViaje: "2026-12-01", referencia: "Hotel X", restriccionComercial: "no_reembolsable_no_endosable",
      }],
      moneda: "COP", trm: 1, precioTotalMoneda: 1_000_000, fechaPago: "2026-01-01",
      usuarioId: "u1",
    });
    assert.equal(r.ok, true);
    assert.equal(rpcLlamadas.length, 1);
    assert.equal(rpcLlamadas[0].nombre, "congelar_condiciones_contrato");
    const args = rpcLlamadas[0].args as { p_numero_contrato: string; p_snapshot: { monto_exigido: number; tipo_componente: string }[]; p_moneda: string; p_usuario_id: string };
    assert.equal(args.p_numero_contrato, "DTM-2");
    assert.equal(args.p_moneda, "COP");
    assert.equal(args.p_usuario_id, "u1");
    assert.equal(args.p_snapshot.length, 1);
    assert.equal(args.p_snapshot[0].monto_exigido, 1_000_000); // 100% pago_total, no el 30% normal
    assert.equal(args.p_snapshot[0].tipo_componente, "hotel");
  });

  test("error del RPC se sanea (nunca fuga detalle crudo de Postgres)", async () => {
    const { admin } = clienteFalso({
      rpc: () => ({ data: null, error: { message: 'duplicate key value violates unique constraint "x"' } }),
    });
    const r = await congelarCondicionesContrato(admin, {
      numeroContrato: "DTM-3",
      componentes: [{ id: "p1", tipo: "paquete", valor: 100, condicion: null, fechaViaje: null, restriccionComercial: "normal" }],
      moneda: "COP", trm: 1, precioTotalMoneda: 100, usuarioId: "u1",
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.doesNotMatch(r.error, /duplicate key|constraint/i);
    }
  });
});

describe("congelarCondicionesContratoBestEffort — NUNCA lanza, aunque el RPC falle o el cliente explote", () => {
  test("RPC devuelve error → no lanza", async () => {
    const { admin } = clienteFalso({ rpc: () => ({ data: null, error: { message: "boom" } }) });
    await assert.doesNotReject(() =>
      congelarCondicionesContratoBestEffort(admin, {
        numeroContrato: "DTM-4",
        componentes: [{ id: "p1", tipo: "paquete", valor: 100, condicion: null, fechaViaje: null, restriccionComercial: "normal" }],
        moneda: "COP", trm: 1, precioTotalMoneda: 100, usuarioId: "u1",
      })
    );
  });

  test("cliente lanza una excepción inesperada → no lanza (se captura)", async () => {
    const adminRoto = {
      rpc() { throw new Error("conexión perdida"); },
    } as unknown as Admin;
    await assert.doesNotReject(() =>
      congelarCondicionesContratoBestEffort(adminRoto, {
        numeroContrato: "DTM-5",
        componentes: [{ id: "p1", tipo: "paquete", valor: 100, condicion: null, fechaViaje: null, restriccionComercial: "normal" }],
        moneda: "COP", trm: 1, precioTotalMoneda: 100, usuarioId: "u1",
      })
    );
  });
});
