// #35 — PARIDAD de la hija manual con la cotización dinámica de hoy.
//
// La hija de una comparativa manual debe ser INDISTINGUIBLE de una cotización
// dinámica común con los mismos servicios (es lo que el RPC 198 convierte, en PVP).
// Esta prueba ejecuta de verdad `crearCotizacionManual` (app/…/manual-actions.ts)
// con Supabase simulado, y compara lo que INSERTA contra la plantilla que
// `construirComparativaManual` guarda para cada opción. Si alguien cambia la
// fórmula de una u otra, esta prueba falla.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";

// "next/cache" no tiene mapa de exports resoluble por el ESM de Node: se sirve como módulo mínimo SOLO
// en esta prueba (mismo patrón que pruebas/conversionIncluidosEjecucion.test.ts).
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {} export function revalidateTag() {}")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Fila = Record<string, unknown>;
const inserts: { tabla: string; filas: Fila[] }[] = [];

function cliente() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "asesor@dspacios.test" } }, error: null }) },
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        insert: (f: Fila | Fila[]) => { inserts.push({ tabla, filas: Array.isArray(f) ? f : [f] }); return b; },
        select: () => b,
        single: async () => ({ data: { id: 501 }, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return b;
    },
  };
}

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: {
    contextoCotizacion: async () => ({ ok: true, superadmin: false, tenant: "mayorista" }),
    autorizaTenant: () => true,
  },
});

const { crearCotizacionManual } = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const { construirComparativaManual } = await import("../lib/cotizacion/comparativa.ts");
import type { EntradaComparativaManual } from "../lib/cotizacion/comparativa.ts";

const HOY = "2026-10-15";
function base(sobre: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual {
  return {
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123456", telefono: "3001112233", email: "a@x.test", nacimiento: "1990-01-01" },
    destino: "Cartagena", fechaIda: "2030-11-10", fechaRegreso: "2030-11-14", pax: 2, ninos: 0, tarifaNino: 0,
    recobro: 0, recobroAliado: 0, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor Uno", agenciaNombre: "",
    freelanceNombre: "", plazo: "Inmediato", vigenciaHasta: "2030-11-05", observaciones: "Obs", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo BOG-CTG", proveedor: "Avianca", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "Hoteles A", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "A" },
      { tipo: "traslado", plataforma: "Directo", nombre: "Traslados", proveedor: "TransCo", costoNeto: 80000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel B", proveedor: "Hoteles B", costoNeto: 560000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "B" },
      { tipo: "asistencia", plataforma: "Directo", nombre: "Asistencia", proveedor: "Assist", costoNeto: 50000, modo: "mk", pctMarkup: 25, ta: 0 },
    ],
    ...sobre,
  };
}

// La cotización dinámica COMÚN equivalente a la opción `ref`: mismos datos, solo sus servicios, sin etiquetas de opción.
async function dinamicaComun(entrada: EntradaComparativaManual, ref: "A" | "B") {
  inserts.length = 0;
  const { aliadoId: _a, tenant: _t, ...resto } = entrada;
  void _a; void _t;
  const servicios = entrada.servicios.filter((s) => !s.opcionRef || s.opcionRef === ref).map(({ opcionRef: _o, ...s }) => { void _o; return s; });
  const r = await crearCotizacionManual({ ...resto, servicios });
  assert.ok(r.ok, "la cotización dinámica de referencia debe crearse");
  const cot = inserts.find((i) => i.tabla === "cotizaciones")!.filas[0];
  const servs = inserts.find((i) => i.tabla === "cotizacion_servicios")!.filas;
  return { cot, servs };
}

beforeEach(() => { inserts.length = 0; });

describe("paridad: la plantilla de cada opción = la cotización dinámica común equivalente", () => {
  for (const [nombre, sobre] of [
    ["interno sin recobro", {}],
    ["interno con recobro oculto", { recobro: 100000 }],
    ["con niños y recobro", { recobro: 100000, ninos: 2, tarifaNino: 250000 }],
    ["B2B agencia con recobro al aliado", { tipoAsesor: "agencia" as const, agenciaNombre: "Agencia Uno", recobro: 100000, recobroAliado: 60000 }],
    ["B2B freelance", { tipoAsesor: "freelance" as const, freelanceNombre: "Free Uno", recobro: 50000, recobroAliado: 20000 }],
    ["USD", { moneda: "USD" }],
  ] as const) {
    test(nombre, async () => {
      const entrada = base(sobre);
      const r = construirComparativaManual(entrada, { hoy: HOY, creadoPorEmail: "asesor@dspacios.test" });
      assert.ok(r.ok, r.ok ? "" : r.error);
      for (const op of r.datos.opciones) {
        const ref = op.opcion_ref as "A" | "B";
        const { cot, servs } = await dinamicaComun(entrada, ref);
        const pl = op.plantilla_hija as Record<string, unknown>;

        assert.equal(op.total, cot.precio_venta, `${ref}: total = precio_venta de la cotización común`);
        assert.deepEqual(pl.payload, cot.payload, `${ref}: payload idéntico`);
        assert.deepEqual(pl.detalle, cot.detalle, `${ref}: detalle idéntico`);
        for (const [col, esperado] of [
          ["cliente", cot.cliente], ["cliente_documento", cot.cliente_documento], ["destino", cot.destino], ["hotel", cot.hotel],
          ["plan_nombre", cot.plan_nombre], ["pax", cot.pax], ["fecha_salida", cot.fecha_salida], ["fecha_regreso", cot.fecha_regreso],
        ] as const) {
          assert.deepEqual(pl[col], esperado, `${ref}: columna ${col}`);
        }
        assert.equal(op.moneda, cot.moneda);
        assert.equal(cot.modulo, "manual");

        // Filas de servicios: las de la opción (comunes + su hotel), con los mismos valores y la misma
        // numeración consecutiva que produce la cotización común (la RPC renumera al copiar).
        type FilaServicio = { orden: number; tipo_servicio: string; plataforma: string | null; nombre_servicio: string | null; proveedor: string | null;
          costo_neto: number; modo: string; pct_markup: number; ta: number; valor: number };
        const propias: FilaServicio[] = r.datos.servicios.filter((s) => s.opcion_ref === null || s.opcion_ref === ref)
          .map((s, i): FilaServicio => ({ orden: i, tipo_servicio: s.tipo_servicio, plataforma: s.plataforma, nombre_servicio: s.nombre_servicio, proveedor: s.proveedor,
            costo_neto: s.costo_neto, modo: s.modo, pct_markup: s.pct_markup, ta: s.ta, valor: s.valor }));
        const comunes = servs.map(({ cotizacion_id: _c, ...f }) => { void _c; return f; });
        assert.deepEqual(propias, comunes, `${ref}: filas de servicios (valor, costo, markup, proveedor)`);
        assert.equal(propias.reduce((a, s) => a + Number(s.valor), 0) + Number(((cot.detalle as { recobro: { total: number } }).recobro.total)) + Number((cot.payload as { ninos?: number }).ninos ?? 0) * Number((cot.payload as { tarifaNino?: number }).tarifaNino ?? 0),
          op.total, `${ref}: Σ servicios + recobro + niños = total de la opción`);
      }
    });
  }

  test("el común (aéreo, traslado, asistencia) se cuenta UNA vez en cada opción", async () => {
    const r = construirComparativaManual(base(), { hoy: HOY });
    assert.ok(r.ok);
    const [a, b] = r.datos.opciones;
    // aéreo 1.000.000 + traslado 100.000 + asistencia 66.667 (50.000/0,75) = 1.166.667 de lo común
    const comunes = r.datos.servicios.filter((s) => s.opcion_ref === null).reduce((x, s) => x + s.valor, 0);
    assert.equal(a.total, comunes + 500_000);
    assert.equal(b.total, comunes + 700_000);
    assert.notEqual(a.total + b.total, comunes * 2 + 1_200_000 - 1, "no se suma un hotel con el otro");
  });
});

describe("la madre manual no se parece a una cotización cobrable", () => {
  test("la cabecera de la madre no trae precio_venta (NULL en la base) ni items cobrables", () => {
    const r = construirComparativaManual(base(), { hoy: HOY });
    assert.ok(r.ok);
    assert.equal("precio_venta" in r.datos.cabecera, false);
    assert.equal(r.datos.cabecera.tipo, "comparativa_manual");
    assert.deepEqual(Object.keys((r.datos.cabecera.detalle as Record<string, unknown>)).sort(), ["comparativa", "venta"]);
  });
  test("construirComparativaManual no ejecuta nada de dinero: no hay inserts", () => {
    inserts.length = 0;
    construirComparativaManual(base(), { hoy: HOY });
    assert.equal(inserts.length, 0);
  });
});
