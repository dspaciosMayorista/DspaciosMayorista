// 226 — EJECUCIÓN REAL de `crearSolicitudReserva` (app/tarifario/checkout/actions.ts) con menores de 2 años: se
// reemplazan SOLO las fronteras externas (Supabase, next/headers) y los motores de liquidación por dobles
// deterministas — la composición de las filas del documento, la suma y el residual son el código de producción.
//   · cada línea de menores del cómputo (clase del hotel × tarifa) es UNA fila del documento: el infante de 1 año a su
//     tarifa de infante, el niño de 2 años con clase infante del hotel a la de adulto, el niño de 5 a la suya;
//   · las filas visibles suman EXACTAMENTE el precio de venta cotizado (sin residual inventado);
//   · si las filas sumaran más que el precio cotizado la solicitud se corta (regla fail-closed de siempre).
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Insert = { tabla: string; fila: Record<string, unknown> };
const inserts: Insert[] = [];
function clienteFalso() {
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, eq: () => b, order: () => b, limit: () => b, in: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: 77, codigo: "COT-77", share_token: "tok" }, error: null }),
      insert: (fila: Record<string, unknown>) => { inserts.push({ tabla, fila }); return b; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
    });
    return b;
  };
  return { from: builder, auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
}

type Linea = { clase: "infante" | "nino" | "nino2"; cantidad: number; tarifa: number; menorDeDos: boolean };
let LINEAS: Linea[] = [];
let PRECIO_VENTA = 0;
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async () => ({
      ok: true,
      data: {
        meta: { hotel_nombre: "Hotel 226", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
        precioVenta: PRECIO_VENTA, monedaReserva: "COP",
        lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 1_730_000 }], pvpPorAcom: { doble: 1_730_000 },
        lineasMenores: LINEAS, numMenoresDeDos: LINEAS.filter((l) => l.menorDeDos).reduce((n, l) => n + l.cantidad, 0),
        numNinos: 0, numNinos2: 0, numInfantes: LINEAS.filter((l) => l.clase === "infante").reduce((n, l) => n + l.cantidad, 0),
        totalPax: 2 + LINEAS.reduce((n, l) => n + l.cantidad, 0),
        edadesMenoresUsadas: [1, 2, 5], serviciosIncluidos: [], distribucionMenores: [], condicionesTarifa: null,
      },
    }),
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", {
  namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa en esta prueba"); } },
});
mock.module("@/lib/reservar/cotizar", {
  namedExports: { liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no disponible" }) },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteFalso() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteFalso() } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });

const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");

const cliente = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
const item = {
  modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null, hotelNombre: "Hotel 226", destino: "CARTAGENA",
  categoria: "Estandar", regimen: "PC", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [1, 2, 5], cantidadMenores: 3,
};

type ItemDoc = { descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; modo_precio?: string; valor_total?: number };
const cotizaciones = () => inserts.filter((i) => i.tabla === "cotizaciones").map((i) => i.fila);
const itemsDoc = (): ItemDoc[] => ((cotizaciones()[0]?.detalle as { items: ItemDoc[] } | undefined)?.items ?? []);
const sumaFilas = (items: ItemDoc[]) => items.reduce((s, i) => s + (i.modo_precio === "total" ? (i.valor_total ?? 0) : i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino), 0);

describe("checkout con menores de 2 años (ejecución real)", () => {
  beforeEach(() => { inserts.length = 0; });

  test("infante de 1 año + niño de 2 (clase infante del hotel) + niño de 5: una fila por clase y tarifa; suman el precio cotizado", async () => {
    LINEAS = [
      { clase: "nino", cantidad: 1, tarifa: 1_418_000, menorDeDos: false },
      { clase: "infante", cantidad: 1, tarifa: 205_000, menorDeDos: true },
      { clase: "infante", cantidad: 1, tarifa: 1_305_000, menorDeDos: false },
    ];
    PRECIO_VENTA = 2 * 1_730_000 + 1_418_000 + 205_000 + 1_305_000;
    const r = await crearSolicitudReserva({ items: [item], tours: [], cliente }) as { ok: boolean; error?: string };
    assert.equal(r.ok, true, r.error);
    const items = itemsDoc();
    const textos = items.map((i) => i.descripcion);
    assert.ok(textos.some((t) => /· Niño 1 · Estandar \/ PC$/.test(t)), textos.join(" | "));
    assert.ok(textos.some((t) => /· Infante · Estandar \/ PC$/.test(t)), "el infante de siempre conserva su texto");
    assert.ok(textos.some((t) => /· Infante \(2 años\) · Estandar \/ PC$/.test(t)), "el niño de 2 años con clase infante del hotel va aparte");
    assert.equal(items.find((i) => /· Infante · /.test(i.descripcion))!.tarifa_nino, 205_000);
    assert.equal(items.find((i) => /Infante \(2 años\)/.test(i.descripcion))!.tarifa_nino, 1_305_000);
    assert.equal(sumaFilas(items), PRECIO_VENTA, "las filas visibles agotan el precio de venta");
    assert.ok(!items.some((i) => i.modo_precio === "total"), "no hace falta línea residual de servicios por grupo");
  });

  test("sin menores el documento queda como siempre (solo la fila de la habitación)", async () => {
    LINEAS = [];
    PRECIO_VENTA = 2 * 1_730_000;
    const r = await crearSolicitudReserva({ items: [{ ...item, edadesMenores: [], cantidadMenores: 0 }], tours: [], cliente }) as { ok: boolean; error?: string };
    assert.equal(r.ok, true, r.error);
    assert.equal(itemsDoc().length, 1);
    assert.equal(sumaFilas(itemsDoc()), PRECIO_VENTA);
  });

  test("si las filas visibles sumaran MÁS que el precio cotizado la solicitud se corta (fail-closed)", async () => {
    LINEAS = [{ clase: "infante", cantidad: 1, tarifa: 205_000, menorDeDos: true }];
    PRECIO_VENTA = 2 * 1_730_000;   // menor a la suma de filas (3.665.000)
    const r = await crearSolicitudReserva({ items: [item], tours: [], cliente }) as { ok: boolean; error?: string };
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Inconsistencia interna/);
    assert.equal(cotizaciones().length, 0, "no se guarda una cotización inconsistente");
  });
});
