// Se ejecuta con npm run test:react (loader del arnés).
// #32 (ADL-039) — Estructura RENDERIZADA de los documentos de cotización con el logo del aliado:
//   · con logo: el logo del aliado ocupa el lugar principal (una sola vez), el emisor legal sigue visible (razón social, NIT, RNT) y NO aparece el logo de la agencia como si fuera del aliado;
//   · sin logo: documento idéntico al de siempre (sin tarjeta, sin franja);
//   · la identidad del emisor y todo el resto del documento son idénticos con y sin logo;
//   · un CONTRATO nunca muestra el logo del aliado aunque se le pase.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";
import { CotizacionManualDocumento } from "../components/contrato/CotizacionManualDocumento.tsx";
import { ContratoDocumento } from "../components/contrato/ContratoDocumento.tsx";
import { ComparativaHoja, type MadreHoja } from "../components/cotizacion/ComparativaHoja.tsx";

const LOGO = { src: "/cot/tok-laura/logo?v=3", nombre: "Laura Gómez" };
const cuenta = (s: string, t: string) => s.split(t).length - 1;
// React 19 hoista un <link rel="preload" as="image"> por cada <img> al renderizar a cadena: es del renderizador, no del documento.
const sinPreload = (s: string) => s.replace(/<link rel="preload"[^>]*\/>/g, "");
const texto = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");

const venta = {
  numero_contrato: null, cliente: "Ana Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora Interna", asesor_firma_nombre: "Asesora Interna",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2026-11-03", fecha_salida: "2026-12-01", destino: "Cartagena",
  pax: 2, ninos: 0, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: "freelance", freelance_nombre: "Laura Gómez", agencia_nombre: null,
};
const itemsManual = [{ descripcion: "PAQUETE TURÍSTICO A CARTAGENA", cantidad: 2, tarifa_unit: 2_000_000, valor: 4_000_000 }];
const manual = (extra: Record<string, unknown> = {}) => sinPreload(renderToStaticMarkup(h(CotizacionManualDocumento, {
  codigo: "C-0001", venta, items: itemsManual, cliente: {}, incluye: "Desayuno", noIncluye: "Propinas", vigenciaHasta: "2026-11-30", fechaEmision: "2026-11-03", agencia: AGENCIA_PRUEBA, ...extra,
} as never)));

const itemsTarifario = [{ id: 1, numero_contrato: "X", descripcion: "Doble · Estándar/PAM", adultos: 2, ninos: 0, tarifa_adulto: 950_000, tarifa_nino: 0, orden: 0, modo_precio: "por_persona", valor_total: null }];
const contrato = (extra: Record<string, unknown> = {}) => sinPreload(renderToStaticMarkup(h(ContratoDocumento, {
  venta: { ...venta, numero_contrato: "DTM-0900" }, pasajeros: [], hoteles: [], vuelos: [], items: itemsTarifario, totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], ...extra,
} as never)));

const MADRE: MadreHoja = { codigo: "CMP-001", cliente: "Ana Pérez", destino: "Cartagena", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-14", pax: 2, moneda: "COP", vigencia_hasta: "2026-10-20", created_at: "2026-10-15T10:00:00Z", tenant: "mayorista" };
const GRUPOS = [{ opcionRef: "A", etiqueta: "Hotel A", acomodaciones: [{ opcionRef: "A", acomodacionRef: "unica", etiqueta: "Hotel A", moneda: "COP", tarifaPersona: 900_000, total: 1_800_000, orden: 0 }] }];
const comparativa = (extra: Record<string, unknown> = {}) => sinPreload(renderToStaticMarkup(h(ComparativaHoja, { madre: MADRE, grupos: GRUPOS as never, resumenes: {}, vencida: false, identidad: AGENCIA_PRUEBA, ...extra })));

/** Quita SOLO lo que el logo del aliado agrega/reemplaza (tarjeta, franja del emisor y el logo de la agencia) para comparar el resto byte a byte. */
const sinMarca = (s: string) => s
  .replace(/<div class="inline-flex[^>]*data-testid="logo-aliado"[\s\S]*?<\/div>/, "")
  .replace(/<div class="border-b border-gray-200 bg-gray-50[^>]*data-testid="emisor-linea">[\s\S]*?<\/div>/, "")
  .replace(/<img[^>]*logo-(minorista-)?white\.png[^>]*\/?>/, "");

const DOCS: [string, (extra?: Record<string, unknown>) => string][] = [
  ["cotización manual (CotizacionManualDocumento)", manual],
  ["cotización del tarifario (ContratoDocumento, esCotizacion)", (e) => contrato({ esCotizacion: true, codigo: "C-0002", vigenciaHasta: "2026-11-30", ...e })],
  ["comparativa (ComparativaHoja)", comparativa],
];

for (const [nombre, render] of DOCS) {
  describe(`#32 ${nombre}`, () => {
    const con = render({ logoAliado: LOGO });
    const sin = render();
    test("con logo: el logo del aliado aparece UNA vez, con su texto alternativo, y apunta a la ruta autorizada (no a una URL del bucket)", () => {
      assert.equal(cuenta(con, 'data-testid="logo-aliado"'), 1);
      assert.equal(cuenta(con, `src="${LOGO.src}"`), 1);
      assert.match(con, /alt="Logo de Laura Gómez"/);
      assert.doesNotMatch(con, /supabase|storage\/v1|aliado-logos/i);
    });
    test("con logo: el logo de la agencia ya no ocupa el lugar de la marca (no se presenta como del aliado)", () => {
      assert.equal(cuenta(con, "logo-white.png"), 0);
      assert.equal(cuenta(con, "logo-minorista-white.png"), 0);
    });
    test("con logo: el EMISOR legal está identificado de forma visible (razón social, NIT, RNT de `agencias`) y nombra al aliado que presenta", () => {
      assert.equal(cuenta(con, 'data-testid="emisor-linea"'), 1);
      const franja = texto(/data-testid="emisor-linea">([\s\S]*?)<\/div>/.exec(con)![1]);
      for (const dato of [AGENCIA_PRUEBA.razon_social, `NIT ${AGENCIA_PRUEBA.nit}`, `RNT ${AGENCIA_PRUEBA.rnt}`, "Laura Gómez"]) assert.ok(franja.includes(dato), `la franja incluye «${dato}»`);
      assert.match(franja, /emitida por/i);
    });
    test("sin logo (o sin aliado): documento de siempre — el logo de la agencia, sin tarjeta ni franja", () => {
      assert.equal(cuenta(sin, 'data-testid="logo-aliado"'), 0);
      assert.equal(cuenta(sin, 'data-testid="emisor-linea"'), 0);
      assert.equal(cuenta(sin, "logo-white.png"), 1);
      assert.equal(render({ logoAliado: null }), sin, "null = ausente, byte a byte");
    });
    test("todo lo demás es IDÉNTICO con y sin logo: datos del emisor, importes, secciones (solo cambian la marca y la franja)", () => {
      assert.equal(sinMarca(con), sinMarca(sin));
      assert.ok(texto(con).includes(AGENCIA_PRUEBA.rnt) && texto(sin).includes(AGENCIA_PRUEBA.rnt), "el RNT del encabezado se conserva");
    });
  });
}

describe("#32 un CONTRATO nunca lleva el logo del aliado", () => {
  test("ContratoDocumento sin esCotizacion ignora logoAliado: byte-idéntico al contrato sin él", () => {
    const sin = contrato();
    const con = contrato({ logoAliado: LOGO });
    assert.equal(con, sin);
    assert.equal(cuenta(con, 'data-testid="logo-aliado"'), 0);
    assert.equal(cuenta(con, "logo-white.png"), 1);
  });
  test("y su emisor sigue siendo el de la fila `agencias` (razón social, NIT, RNT)", () => {
    const t = texto(contrato({ logoAliado: LOGO }));
    for (const dato of [AGENCIA_PRUEBA.razon_social, AGENCIA_PRUEBA.nit, AGENCIA_PRUEBA.rnt]) assert.ok(t.includes(dato), dato);
  });
});
