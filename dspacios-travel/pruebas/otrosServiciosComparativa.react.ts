// Se ejecuta con npm run test:react.
// «Otro servicio» en el resumen comercial de cada opción de una comparativa: se ve en la vista de selección y en el documento imprimible (el mismo componente, modo solo lectura), sale del snapshot
// CONGELADO de la opción (cotizacion_opciones.plantilla_hija), no duplica ni vuelve a sumar su precio, no muestra costos ni proveedores, y una comparativa cuyo snapshot no se puede verificar
// dice que hay que generarla de nuevo en vez de aparentar que contiene —o no— el servicio. Se lee con `cargarDatosComparativa` y se renderiza el componente REAL.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import * as nodeModule from "node:module";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/app/tarifario/checkout/actions": datos("export async function elegirOpcionComparativa() { return { ok: false, error: 'no se usa' }; } export async function solicitarOpcionComparativa() { return { ok: false, error: 'no se usa' }; } export async function resumenOpcionComparativa() { return { ok: false, error: 'no se usa' }; }"),
  "@/app/(dashboard)/dashboard/cotizaciones/manual-actions": datos("export async function resolverSolicitudComparativa() { return { ok: false, error: 'no se usa' }; }"),
  "@/app/(dashboard)/dashboard/cotizaciones/[id]/DescartarBtn": datos("export function DescartarBtn() { return null; }"),
  "@/lib/supabase/server": datos("export async function createClient() { throw new Error('no se usa'); }"),
  "@/lib/supabase/admin": datos("export function createAdminClient() { throw new Error('no se usa'); }"),
  "@/lib/cotizacion/comparativaServidor": datos("export async function visitantePuedeContinuar() { return false; }"),
  "next/navigation": datos("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; } export function notFound() { throw new Error('404'); }"),
  "next/headers": datos("export async function headers() { return new Map(); }"),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FRONTERAS[specifier]) return { url: FRONTERAS[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { renderToStaticMarkup } = await import("react-dom/server");
const { cargarDatosComparativa, ComparativaDocumento } = await import("../lib/cotizacion/comparativaDocumento.tsx");
const { otrosServiciosDeOpcion } = await import("../lib/cotizacion/comparativa.ts");
const { crearBD } = await import("./support/fechaNegocioArnes.ts");

type Fila = Record<string, unknown>;
const TOTAL_HOTEL = { A: 1_200_000, B: 1_450_000, C: 1_100_000 };
const VUELO = { clase: "vuelo", nombre: "Tiquete Avianca", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000, tramo: "ida_regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", hotelRef: "item-0" };
const OTRO = { clase: "otro", nombre: "Traslado privado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 25_000, origen: null, destino: null, fechaIda: "2030-10-15", fechaRegreso: null, hotelRef: "item-0", costo: 60_000, proveedor: "Operador Secreto SAS" };
const TOUR = { nombre: "City tour", precio: 85_000 };

/** Una opción como la deja crearComparativaCarrito: resumen público (sin servicios adicionales listados) + snapshot congelado de la hija. */
function opcion(ref: string, orden: number, manuales: Fila[], opts: { tours?: Fila[]; totalForzado?: number; payloadManuales?: unknown } = {}) {
  const hotel = TOTAL_HOTEL[ref as keyof typeof TOTAL_HOTEL];
  const tours = opts.tours ?? [];
  const total = opts.totalForzado ?? hotel + tours.reduce((s, t) => s + Number(t.precio), 0) + manuales.reduce((s, m) => s + Number(m.precio), 0);
  const vuelos = manuales.filter((m) => m.clase === "vuelo");
  return {
    id: orden + 1, cotizacion_id: 1, opcion_ref: ref, acomodacion_ref: "doble", orden, etiqueta: `Hotel ${ref}`, moneda: "COP", tarifa_persona: null, total,
    resumen_publico: {
      hotel: `Hotel ${ref}`, plan_nombre: "Marina Suite · Desayuno", pax: 2, moneda: "COP", total, total_hotel: hotel, acomodacion: "doble", habitaciones: { doble: 1 },
      servicios: tours.map((t) => ({ nombre: t.nombre, precio: t.precio })),
      vuelos: vuelos.map(() => ({ tramo: "ida", origen: "Bogotá", destino: "Cartagena", fecha: "2030-10-15", hora: null, nota: "Vuelo manual · pasajeros en este vuelo: 2" })),
    },
    plantilla_hija: { payload: { items: [{ ref: "item-0", precio: hotel }], tours: tours.map((t) => ({ nombre: t.nombre, precio: t.precio })), ...(opts.payloadManuales !== undefined ? { manuales: opts.payloadManuales } : manuales.length ? { manuales } : {}) }, detalle: {} },
  };
}
function bdCon(opciones: Fila[]) {
  const bd = crearBD({ cotizacion_opciones: opciones as never, cotizaciones: [] });
  return bd.sb as never;
}
const madre = { id: 1, codigo: "COT-CMP-1", version: 1, estado: "abierta", cliente: "Ana Pérez", destino: "CARTAGENA", fecha_salida: "2030-10-15", fecha_regreso: "2030-10-18", pax: 2, moneda: "COP", vigencia_hasta: "2030-10-20", share_token: "t".repeat(36) };
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
async function pintar(opciones: Fila[], modo: "solo_lectura" | "checkout") {
  const d = await cargarDatosComparativa(bdCon(opciones), 1);
  const html = renderToStaticMarkup(createElement(ComparativaDocumento as ComponentType<Record<string, unknown>>, { madre, datos: d, modo, token: modo === "checkout" ? "t".repeat(36) : null, vencida: false }));
  return { d, t: texto(html), html };
}
const veces = (t: string, s: string) => t.split(s).length - 1;
const AVISO_GENERAR = /Genera la comparativa de nuevo/;

describe("«Otro servicio» en el resumen de cada opción (selección pública y documento imprimible)", () => {
  for (const modo of ["checkout", "solo_lectura"] as const) {
    const donde = modo === "checkout" ? "vista de selección" : "documento imprimible";

    test(`${donde} · unidestino: el servicio común aparece UNA vez en cada alternativa, con tours y vuelos intactos, sin sumarse otra vez ni mostrar costo o proveedor`, async () => {
      const ops = ["A", "B", "C"].map((r, i) => opcion(r, i, [VUELO, OTRO], { tours: [TOUR] }));
      const { d, t } = await pintar(ops, modo);
      assert.equal(veces(t, "Servicio adicional: Traslado privado · 2 pax · 2030-10-15 · incluido en el total"), 3, "una vez en cada una de las tres opciones");
      assert.equal(veces(t, "+ City tour"), 3, "los tours se conservan");
      assert.equal(veces(t, "Vuelo ida: Bogotá → Cartagena"), 3, "los vuelos se conservan");
      // Totales: hotel + tour + vuelo + servicio, UNA vez (el servicio no se suma de nuevo al renderizar).
      const esperado = [1_200_000, 1_450_000, 1_100_000].map((h) => h + 85_000 + 1_800_000 + 90_000);
      assert.deepEqual(d.grupos.map((g) => g.acomodaciones[0].total), esperado);
      for (const e of esperado) assert.ok(t.includes(`$ ${e.toLocaleString("es-CO")}`) || t.replace(/\./g, "").includes(String(e)), `total ${e}`);
      assert.doesNotMatch(t, /Operador Secreto|60\.000|60000|costo|proveedor/i, "ni costo ni proveedor");
      assert.doesNotMatch(t, /\$\s?90\.000/, "el precio del servicio no se muestra suelto ni se duplica");
    });

    test(`${donde} · multidestino: el servicio del grupo elegido se ve SOLO en sus opciones`, async () => {
      const ops = [opcion("A", 0, [VUELO]), opcion("B", 1, [VUELO]), opcion("C", 2, [OTRO])];
      const { d, t } = await pintar(ops, modo);
      assert.equal(veces(t, "Servicio adicional: Traslado privado"), 1, "solo la opción de su grupo");
      assert.deepEqual(Object.fromEntries(Object.entries(d.resumenes).filter(([k]) => k.includes("/")).map(([k, v]) => [k, (v.otros ?? []).length])), { "A/doble": 0, "B/doble": 0, "C/doble": 1 });
      const tarjetaC = t.slice(t.indexOf("Opción C"));
      assert.ok(tarjetaC.includes("Servicio adicional: Traslado privado"));
      assert.equal(t.slice(0, t.indexOf("Opción C")).includes("Servicio adicional"), false, "A y B no lo muestran");
    });
  }

  test("una comparativa ya creada (su resumen público nunca listó el servicio) lo muestra desde el snapshot congelado: no depende del resumen", async () => {
    const ops = ["A", "B"].map((r, i) => opcion(r, i, [OTRO]));
    for (const o of ops) assert.equal(JSON.stringify(o.resumen_publico).includes("Traslado"), false, "el resumen público no lo trae");
    const { t } = await pintar(ops, "solo_lectura");
    assert.equal(veces(t, "Servicio adicional: Traslado privado"), 2);
  });

  test("snapshot NO verificable (el total no cuadra con sus componentes, o el bloque está mal formado): no se afirma nada y se pide generar la comparativa de nuevo", async () => {
    const sospechosa = opcion("A", 0, [OTRO], { totalForzado: 9_999_999 });
    const malFormado = opcion("B", 1, [OTRO], { payloadManuales: "no es una lista" });
    const sinNombre = opcion("C", 2, [{ ...OTRO, nombre: "" }]);
    const { d, t } = await pintar([sospechosa, malFormado, sinNombre], "solo_lectura");
    assert.equal(veces(t, "Servicio adicional"), 0, "no aparenta que contiene el servicio");
    assert.equal(veces(t, "Genera la comparativa de nuevo"), 3);
    assert.match(t, AVISO_GENERAR);
    assert.ok(Object.values(d.resumenes).every((r) => r.otrosNoVerificables));
  });

  test("sin servicios manuales (o una comparativa manual): nada que mostrar y ningún aviso", async () => {
    const { t } = await pintar([opcion("A", 0, []), opcion("B", 1, [VUELO])], "solo_lectura");
    assert.equal(veces(t, "Servicio adicional"), 0);
    assert.doesNotMatch(t, AVISO_GENERAR);
    assert.deepEqual(otrosServiciosDeOpcion({ payload: { servicios: [] } }, 1000), { ok: true, otros: [] }, "sin ítems de carrito: no lleva manuales");
  });
});

describe("otrosServiciosDeOpcion (puro)", () => {
  const plan = (manuales: unknown, total: number, extra: Fila = {}) => ({ payload: { items: [{ precio: 1_000 }], tours: [{ precio: 100 }], manuales, ...extra } });
  test("lee solo los «otro»; ignora los vuelos; descarta fechas mal formadas; exige que todo sume el total", () => {
    const r = otrosServiciosDeOpcion(plan([{ clase: "vuelo", precio: 500, pax: 2 }, { clase: "otro", nombre: " Entrada ", pax: 3, precio: 50, fechaIda: "2030-01-02", fechaRegreso: "02/01/2030" }], 0), 1_650);
    assert.deepEqual(r, { ok: true, otros: [{ nombre: "Entrada", pax: 3, fechaIda: "2030-01-02", fechaRegreso: null }] });
    assert.deepEqual(otrosServiciosDeOpcion(plan([{ clase: "otro", nombre: "X", pax: 3, precio: 50 }], 0), 1_151), { ok: false }, "no cuadra");
    assert.deepEqual(otrosServiciosDeOpcion(plan([{ clase: "otro", nombre: "X", pax: 0, precio: 50 }], 0), 1_150), { ok: false }, "pasajeros inválidos");
    assert.deepEqual(otrosServiciosDeOpcion(plan([{ clase: "otro", nombre: "X", pax: 1, precio: "50" }], 0), 1_150), { ok: false }, "precio no numérico");
    assert.deepEqual(otrosServiciosDeOpcion(plan([], 0), 1_100), { ok: true, otros: [] });
    assert.deepEqual(otrosServiciosDeOpcion(null, 10), { ok: true, otros: [] });
  });
});
