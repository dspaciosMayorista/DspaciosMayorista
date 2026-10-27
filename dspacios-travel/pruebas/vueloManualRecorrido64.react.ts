// Se ejecuta con npm run test:react (loader del arnés).
//
// #64 (ronda 4) — RENDER con DATOS REALES del recorrido completo: interno crea la comparativa con un vuelo manual común y la marca para compartir → el visitante elige
// → la hija conserva el vuelo → el interno convierte. Los datos NO se inventan aquí: los escribe `pruebas/servicioManual64.pg.ts` (prueba P5) leyendo de Postgres local
// cuando se lanza `supabase/scripts/test_64_servicio_manual.sh` con PG64_EXPORT=<ruta de pruebas/.recorrido64.json>. Sin ese archivo las pruebas se OMITEN (no hay base).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import * as nodeModule from "node:module";

// Fronteras de servidor de la tarjeta de la comparativa (solo se RENDERIZA; no se llama a ninguna acción).
type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/app/tarifario/checkout/actions": datos("export async function elegirOpcionComparativa() { return { ok: false, error: 'no se usa' }; } export async function solicitarOpcionComparativa() { return { ok: false, error: 'no se usa' }; } export async function resumenOpcionComparativa() { return { ok: false, error: 'no se usa' }; }"),
  "@/app/(dashboard)/dashboard/cotizaciones/manual-actions": datos("export async function resolverSolicitudComparativa() { return { ok: false, error: 'no se usa' }; }"),
  "next/navigation": datos("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; }"),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FRONTERAS[specifier]) return { url: FRONTERAS[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { SelectorOpciones } = await import("../lib/cotizacion/comparativaAcciones.tsx");
const { agruparPorHotel, resumenDeOpcion } = await import("../lib/cotizacion/comparativa.ts");
const { formatMoneda } = await import("../lib/utils.ts");

const RUTA = process.env.PG64_EXPORT ?? join(dirname(fileURLToPath(import.meta.url)), ".recorrido64.json");
const HAY = existsSync(RUTA);
type Fila = Record<string, unknown>;
const D = (HAY ? JSON.parse(readFileSync(RUTA, "utf8")) : {}) as {
  hija: { detalle: { venta: Fila; hoteles: Fila[]; vuelos: Fila[]; items: Fila[] }; precio: number; vuelo: number; hotelNeto: number };
  contrato: { venta: Fila; items: Fila[]; vuelos: Fila[]; hoteles: Fila[] };
  comparativa: { puedeContinuar?: { activo: boolean; creadorDesactivado: boolean; creadorSinRolInterno: boolean }; madre: { codigo: string; version: number; token: string }; opciones: { opcion_ref: string; acomodacion_ref: string; orden: number; etiqueta: string; moneda: string; tarifa_persona: number | null; total: number; resumen_publico: unknown }[] };
};

const plano = (t: string) => t.replace(/\s+/g, "");
const $ = (n: number) => plano(formatMoneda(n, "COP"));
const veces = (t: string, s: string) => plano(t).split(s).length - 1;
function html(props: Fila): string {
  const h = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Fila>, props));
  return h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
const seccion = (t: string, desde: string, hasta?: string) => { const i = t.indexOf(desde); return t.slice(i, hasta ? t.indexOf(hasta, i) : undefined); };

describe("Recorrido completo con datos reales de Postgres: la hija (cotización) tras la elección del visitante", { skip: !HAY && "sin pruebas/.recorrido64.json (lo genera el arnés de Postgres local)" }, () => {
  const base = () => ({
    venta: D.hija.detalle.venta, pasajeros: [], hoteles: D.hija.detalle.hoteles, vuelos: D.hija.detalle.vuelos, items: D.hija.detalle.items,
    totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion: true, codigo: "COT-RECORRIDO", vigenciaHasta: "2030-02-01",
  });

  test("PVP / B2C: el vuelo está en el cuadro de vuelos, NO hay línea suelta y el total (hotel + vuelo) aparece una sola vez", () => {
    const t = html({ ...base(), netoTotalExigible: null });
    const vuelos = seccion(t, "Vuelos", "Hoteles y Servicios");
    assert.match(vuelos, /Ida:/);
    assert.match(vuelos, /Regreso:/);
    assert.match(vuelos, /pasajeros en este vuelo: 2 · sujeto a confirmación de disponibilidad y tarifa/);
    assert.doesNotMatch(vuelos, /record|PNR|silla/i);
    const valores = seccion(t, "Valores y Pagos");
    assert.doesNotMatch(valores, /Vuelo · /);
    assert.equal(veces(t, "Totaldelcontrato" + $(D.hija.precio)), 1, "el total aparece una vez");
    assert.equal(veces(t, $(D.hija.vuelo)), 0, "el importe del vuelo no se repite en ninguna tabla");
    assert.match(t, /El total del contrato incluye el valor de los vuelos indicados en la sección «Vuelos»\. Su importe no se desglosa/);
    assert.equal(veces(t, "Eltotaldelcontratoincluyeelvalor"), 1, "la aclaración sale una sola vez");
  });

  test("NETO: la aclaración dice que el total EXIGIBLE incluye el vuelo; el vuelo sigue en su cuadro; no aparece PVP, comisión ni el importe del vuelo", () => {
    const exigible = D.hija.precio - 240_000; // 10 % de comisión sobre 2.400.000 (la comisión NO se muestra al comprador)
    const t = html({ ...base(), netoTotalExigible: exigible });
    assert.ok(plano(t).includes("Totaldelcontrato" + $(exigible)), "total = total exigible");
    assert.equal(veces(t, "Totaldelcontrato" + $(exigible)), 1);
    assert.match(t, /El total exigible incluye el valor de los vuelos indicados en la sección «Vuelos»\. Su importe no se desglosa/);
    assert.match(seccion(t, "Vuelos", "Hoteles y Servicios"), /Ida:/);
    assert.doesNotMatch(seccion(t, "Valores y Pagos"), /Vuelo · /);
    assert.equal(veces(t, $(D.hija.precio)), 0, "no aparece el PVP original");
    assert.equal(veces(t, $(240_000)), 0, "no aparece la comisión");
    assert.equal(veces(t, $(D.hija.vuelo)), 0, "no aparece el importe del vuelo");
    // Solo la parte de la cotización (el texto legal del contrato, más abajo, habla de «proveedores» en general).
    assert.doesNotMatch(t.slice(0, t.indexOf("CONTRATO DE PRESTACIÓN")), /comisi[oó]n|recobro|costo neto|proveedor/i);
  });
});

describe("Recorrido completo con datos reales: el contrato que convierte el interno", { skip: !HAY && "sin pruebas/.recorrido64.json (lo genera el arnés de Postgres local)" }, () => {
  test("el contrato muestra los tramos del vuelo (sin record ni aviso de cotización), sin línea suelta y con el total una sola vez", () => {
    const c = D.contrato;
    const t = html({
      venta: c.venta, pasajeros: [], hoteles: c.hoteles, vuelos: c.vuelos, items: c.items, totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], netoTotalExigible: null,
    });
    const vuelos = seccion(t, "Vuelos", "Hoteles y Servicios");
    assert.match(vuelos, /Ida:/);
    assert.match(vuelos, /Regreso:/);
    assert.match(vuelos, /pasajeros en este vuelo: 2/);
    assert.doesNotMatch(vuelos, /sujeto a confirmación/, "convertido: costo y proveedor ya registrados");
    assert.doesNotMatch(vuelos, /record|PNR/i, "no se inventa record");
    assert.doesNotMatch(vuelos, /(\$|COP)\s?[\d.]{5,}/, "el cuadro de vuelos no lleva importes");
    assert.doesNotMatch(seccion(t, "Valores y Pagos"), /Vuelo · /);
    assert.equal(veces(t, "Totaldelcontrato" + $(D.hija.precio)), 1);
    assert.equal(veces(t, $(D.hija.vuelo)), 0);
    assert.match(t, /incluye el valor de los vuelos indicados en la sección «Vuelos»/);
  });
});

describe("Recorrido completo con datos reales: lo que ve el visitante en la comparativa compartida", { skip: !HAY && "sin pruebas/.recorrido64.json (lo genera el arnés de Postgres local)" }, () => {
  const grupos = () => agruparPorHotel(D.comparativa.opciones.map((o) => ({
    opcionRef: o.opcion_ref, acomodacionRef: o.acomodacion_ref, etiqueta: o.etiqueta, moneda: o.moneda,
    tarifaPersona: o.tarifa_persona == null ? null : Number(o.tarifa_persona), total: Number(o.total), orden: o.orden,
  })));
  const resumenes = () => Object.fromEntries(D.comparativa.opciones.flatMap((o) => [[`${o.opcion_ref}/${o.acomodacion_ref}`, resumenDeOpcion(o.resumen_publico)], [o.opcion_ref, resumenDeOpcion(o.resumen_publico)]]));
  const pintar = (modo: string) => renderToStaticMarkup(createElement(SelectorOpciones as ComponentType<Fila>, {
    version: D.comparativa.madre.version, token: D.comparativa.madre.token, grupos: grupos(), resumenes: resumenes(), modo, deshabilitada: false, elegida: null,
  }));

  test("cada opción muestra el vuelo (ruta, tramo, fecha, pasajeros), su total ya incluye el vuelo una vez y NO hay precio, costo ni comisión del vuelo", () => {
    const h = pintar("checkout");
    const t = h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(h, /data-testid="vuelos-opcion"/);
    assert.match(t, /Vuelo ida:/);
    assert.match(t, /Vuelo regreso:/);
    assert.match(t, /pasajeros en este vuelo: 2/);
    assert.equal(veces(t, $(D.hija.precio)) >= 1, true, "el total de la opción (hotel + vuelo)");
    assert.equal(veces(t, $(D.hija.vuelo)), 0, "el importe del vuelo no se desglosa");
    assert.doesNotMatch(t, /comisi[oó]n|costo neto|proveedor|record/i);
  });

  test("con el creador interno ACTIVO se ofrece «Continuar con esta opción»; desactivado o sin rol interno, la pantalla cae al camino de solicitud (decisión tomada con la regla de la base sobre datos reales)", () => {
    const p = D.comparativa.puedeContinuar!;
    assert.ok(p, "el arnés de Postgres exporta la decisión (prueba P7)");
    const modo = (puede: boolean) => (puede ? "checkout" : "solicitud");
    assert.equal(p.activo, true);
    assert.equal(p.creadorDesactivado, false);
    assert.equal(p.creadorSinRolInterno, false);
    assert.match(pintar(modo(p.activo)), /tarifario\/checkout\?comparativa=/);
    for (const puede of [p.creadorDesactivado, p.creadorSinRolInterno]) {
      const h = pintar(modo(puede));
      assert.doesNotMatch(h, /tarifario\/checkout\?comparativa=/, "ya no hay camino de continuar");
      assert.match(h.replace(/<[^>]+>/g, " "), /solicit/i, "queda el camino de solicitud al asesor");
    }
  });
  test("compartida → el visitante tiene el camino «Continuar con esta opción» (checkout con el token); no compartida (solicitud) no lo tiene", () => {
    const compartida = pintar("checkout");
    assert.match(compartida, /tarifario\/checkout\?comparativa=/);
    const noCompartida = pintar("solicitud");
    assert.doesNotMatch(noCompartida, /tarifario\/checkout\?comparativa=/);
  });
});
