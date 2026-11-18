// Se ejecuta con npm run test:react (loader del arnés).
//
// #125 · F3: el beneficio «niño gratis por habitación» llega a los documentos como una línea FIRMADA (adultos:1 × tarifa_adulto negativa) y, cuando hay resumen por
// pasajero, como la tarifa REBAJADA del propio niño. Aquí se renderizan los componentes REALES (ContratoDocumento y ResumenPreciosCliente) con datos copiados del
// recorrido real contra la base (supabase/scripts/recorrido_125.mjs, escenario S2c/S6b: H2 «R125 ESTADIA», 4 noches desde 4-dic, 1 doble + niño de 8, PVP 1.482.000).
// Se comprueba: explicación y descripción visibles, el niño paga su tarifa rebajada, la línea firmada muestra «—» en personas y tarifas, el conteo de adultos NO se
// infla con ella, y el HTML no trae claves ni importes de neto/markup/detalle por noche.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { ResumenPreciosCliente } = await import("../components/contrato/ResumenPreciosCliente.tsx");
const { formatMoneda } = await import("../lib/utils.ts");
const { formatoExacto } = await import("../lib/contrato/repartoTarifa.ts");

// ── Datos reales del recorrido (S2c / S6b) ─────────────────────────────────────────────────────────────────────────────────────────────────────
const NUMERO = "DTM-0912";
const DESCRIPCION_NG = "Niño gratis por habitación · SIGUE X (hab. 1: niño de 8 años (Niño 1))";
// Importes reales: 2 adultos × 694.000 + niño 347.000 − niño gratis 253.000 = 1.482.000 (el niño paga 94.000 de la noche sin promoción).
const PRECIO = 1_482_000;
const NINO_REBAJADO = 94_000;
const venta = {
  numero_contrato: NUMERO, cliente: "Cliente Recorrido125", cliente_documento: "125999", cliente_direccion: null, cliente_telefono: null,
  asesor: "T125 Operaciones", asesor_firma_nombre: "T125 Operaciones", asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null,
  estado: "activo", fecha_emision: "2026-11-17", fecha_salida: "2026-12-04", pax: 3, plan_nombre: null, tours_traslados: null, asistencia_medica: null,
  moneda: "COP", tenant: "mayorista", tipo_asesor: "interno", agencia_nombre: null, freelance_nombre: null,
};
const base = { numero_contrato: NUMERO, modo_precio: "por_persona", valor_total: null, tarifa_nino: 0 };
const items = [
  { ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 0, tarifa_adulto: 694_000, tarifa_nino: 0, orden: 0 },
  { ...base, id: 2, descripcion: "Niño 1 · Estandar / PAM", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 347_000, orden: 1 },
  { ...base, id: 3, descripcion: DESCRIPCION_NG, adultos: 1, ninos: 0, tarifa_adulto: -253_000, tarifa_nino: 0, orden: 203 },
];
const hotel = {
  id: 1, numero_contrato: NUMERO, nombre: "R125 ESTADIA", categoria: "Estandar", ciudad: "R125 DESTINO", alimentacion: "PAM", acomodacion: "Doble",
  detalle_acomodacion: null, fecha_ingreso: "2026-12-04", fecha_salida: "2026-12-08", proveedor: null, orden: 0, nota_regimen: null, foto_url: null,
  condiciones_tarifa: [{ temporada: "SIGUE X", texto: "Niño gratis de «SIGUE X»: habitación 1, niño de 8 años, tarifa Niño 1." }],
};
// Resumen por pasajero REAL guardado por crearSolicitudReserva (cotizaciones.detalle.resumenPrecios) y congelado en contrato_resumen_precios (S6b).
const RESUMEN_REAL = {
  moneda: "COP", version: 1, modalidad: "pvp", totalCentavos: 148_200_000,
  unidades: [{
    ref: "item-0", hotel: "R125 ESTADIA", regimen: "PAM", categoria: "Estandar", paquete: { id: 126002, nombre: null }, totalCentavos: 148_200_000, ajusteCentavos: 0,
    grupos: [
      { tipo: "adulto", cupos: ["adulto:doble#1", "adulto:doble#2"], incluye: [], cantidad: 2, tarifaCentavos: 69_400_000, subtotalCentavos: 138_800_000, tarifaExactaCentavos: 69_400_000 },
      { tipo: "nino", cupos: ["nino#1"], incluye: [], cantidad: 1, tarifaCentavos: 9_400_000, subtotalCentavos: 9_400_000, tarifaExactaCentavos: 9_400_000 },
    ],
  }],
};

const NBSP = new RegExp(String.fromCharCode(160), "g"); // el formato monetario usa espacio duro: se normaliza en ambos lados
const limpiar = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(NBSP, " ").replace(/\s+/g, " ");
const $ = (n: number) => formatMoneda(n, "COP").replace(NBSP, " ");
const f = (n: number) => formatoExacto(n, "COP").replace(NBSP, " ");
const documento = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ContratoDocumento, {
  agencia: AGENCIA_PRUEBA, venta, pasajeros: [], hoteles: [hotel], vuelos: [], items, totalPagado: 0, ...extra,
} as never));
/** Celdas (texto) de la fila de tabla que contiene `marca`. */
function celdasDeFila(html: string, marca: string): string[] {
  const fila = html.split("<tr").find((f) => f.includes(marca));
  assert.ok(fila, `hay una fila con «${marca}»`);
  return [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => limpiar(m[1]).trim());
}
// Importes y claves que NUNCA deben verse: netos reales de la cuenta (adulto 555.000, niño 277.500, pagadero 202.500, noche sin promoción 75.000) y las claves internas.
const NETOS = [555_000, 1_110_000, 277_500, 202_500, 75_000, 1_185_000];
const CLAVES = /neto|markup|pctMk|porNoche|por noche|costoNeto|ninoGratisNoches|netosOrigen/i;
function sinNetos(html: string) {
  const texto = limpiar(html);
  assert.doesNotMatch(html, CLAVES, "el HTML no trae claves de neto, markup ni detalle por noche");
  for (const n of NETOS) assert.ok(!texto.includes($(n)) && !texto.includes(f(n)), `no aparece el importe interno ${n}`);
}

// Corrección del dueño 2026-11-18: el beneficio se pliega en la tarifa del niño (no hay fila negativa) y un CONTRATO no nombra la promoción ni muestra su cálculo.
test("contrato sin resumen: el beneficio queda en la tarifa del niño (sin fila negativa ni promoción) y no infla a los adultos", () => {
  const html = documento();
  const texto = limpiar(html);
  assert.ok(!texto.includes(DESCRIPCION_NG) && !/Niño gratis por habitación|SIGUE X|PRE BF/.test(texto), "ni promoción ni cálculo en el contrato");
  assert.ok(!texto.includes("Niño gratis de «"), "la explicación con el nombre de la promoción tampoco sale en un contrato");
  assert.ok(texto.includes(`Total del contrato ${$(PRECIO)}`), "el total no cambia: es la suma guardada");

  const fAlojamiento = celdasDeFila(html, "1 hab Doble (2 pax)");
  assert.equal(fAlojamiento[1], "2", "los adultos siguen siendo 2");
  const nino = celdasDeFila(html, "Niño 1 · Estandar");
  assert.equal(nino[2], "1", "un solo niño");
  assert.equal(nino[4], $(NINO_REBAJADO), "el niño paga lo que de verdad paga, en SU fila");
  assert.equal(nino[5], $(NINO_REBAJADO));
  assert.equal(Number(fAlojamiento[1]) + Number(nino[1]), 2, "Σ adultos de las filas = 2");
  assert.ok(!html.includes("Niño gratis"), "paga una parte de la estadía: no se rotula gratis");
  sinNetos(html);
});

test("la cotización conserva la explicación del beneficio; el contrato no", () => {
  assert.ok(limpiar(documento({ esCotizacion: true, codigo: "C-0005" })).includes("Niño gratis de «SIGUE X»: habitación 1, niño de 8 años, tarifa Niño 1."));
  assert.ok(!limpiar(documento()).includes("Niño gratis de «"));
});

test("documento con resumen por pasajero: el niño muestra su tarifa rebajada y los adultos se cuentan una vez", () => {
  const html = documento({ resumenPrecios: RESUMEN_REAL });
  const texto = limpiar(html);
  assert.ok(texto.includes(f(NINO_REBAJADO)), `la tarifa del niño rebajada (${NINO_REBAJADO}) es visible`);
  assert.ok(texto.includes(f(694_000)), "tarifa por adulto completa");
  assert.ok(texto.includes(`Total del contrato ${$(PRECIO)}`), "el total del documento coincide con el del resumen");
  assert.ok(!texto.includes("Niño gratis de «"), "el contrato no nombra la promoción tampoco con el resumen");
  assert.ok(!texto.includes(f(347_000)), "la tarifa completa del niño (347.000) ya no se muestra: el resumen la rebajó");
  const fila = celdasDeFila(html, "resumen-grupo");
  assert.equal(fila[1], "2", "adultos = 2 (sin adulto ficticio por la línea firmada)");
  assert.equal(fila[2], "1", "niños = 1");
  assert.equal(fila[4], f(NINO_REBAJADO), "celda «Tarifa Niño» = tarifa rebajada");
  assert.doesNotMatch(texto, new RegExp(DESCRIPCION_NG.replace(/[()]/g, "\\$&")), "con resumen no se pinta la línea firmada como una fila de personas");
  sinNetos(html);
});

test("ResumenPreciosCliente aislado: lee el JSON guardado y muestra la tarifa rebajada, sin netos ni claves internas", () => {
  const html = renderToStaticMarkup(createElement(ResumenPreciosCliente, { resumen: RESUMEN_REAL as never, destino: "R125 DESTINO" }));
  const texto = limpiar(html);
  assert.ok(texto.includes(f(NINO_REBAJADO)) && texto.includes(f(694_000)));
  assert.ok(texto.includes(f(PRECIO)), "valor total del grupo = total del resumen");
  assert.equal((html.match(/data-testid="resumen-grupo"/g) ?? []).length, 1, "adultos y niño comparten una sola fila de paquete");
  sinNetos(html);
  assert.doesNotMatch(JSON.stringify(RESUMEN_REAL), CLAVES, "el JSON guardado tampoco las trae");
});
