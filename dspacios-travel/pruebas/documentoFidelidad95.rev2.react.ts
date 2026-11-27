// REV2 (B95-15 / B95-18, owner 2026-11-26) — DOCUMENTOS DEL CLIENTE de la opción elegida de una comparativa, convertida con las acciones REALES (pruebas/f95docsFidelidad.rev2.pg.ts vuelca las filas
// persistidas a docs/tecnico/evidencia-rev2-95docs-2026-11-26/*.json). Renderiza los componentes REALES con esas filas y las mismas props que arman app/contrato/[numero], app/c/[token] y app/cotizacion/[id]:
//   · el CONTRATO muestra «Hoteles y Servicios» con el hotel elegido (nombre · categoría, ciudad, alimentación, acomodación, fechas), «Incluye / No incluye» de ESA opción y la fila agrupada del paquete
//     con la tarifa REAL del niño; sin fila «Ajuste por redondeo»; el total impreso = la suma de las filas = lo guardado; nada del otro hotel; ni proveedor ni plataforma ni costos;
//   · la COTIZACIÓN elegida muestra el mismo hotel, categoría, plan y acomodación (pantalla y papel son el MISMO marcado: es una página HTML de impresión, no hay otra plantilla).
// Se ejecuta con `npm run test:react:rev2`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement, type ComponentType } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { CotizacionManualDocumento } = await import("../components/contrato/CotizacionManualDocumento.tsx");
const { cobroDeVenta } = await import("../lib/finanzas/cobro.ts");
const { formatoExacto } = await import("../lib/contrato/repartoTarifa.ts");

const DIR = "docs/tecnico/evidencia-rev2-95docs-2026-11-26";
const archivos = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^rev2_.*\.json$/.test(f)).sort() : [];
const limpio = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ").replace(/\$ /g, "$");
const centavos = (n: number) => Math.round(n * 100);
const importe = (n: number, moneda: string) => formatoExacto(n, moneda).replace(/\s+/g, moneda === "USD" ? " " : "");

function renderContrato(d: Record<string, any>): { texto: string; html: string } {
  const venta = d.venta;
  const props = {
    venta: { cliente_telefono: null, cliente_direccion: null, asesor_firma_nombre: venta.asesor, asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, fecha_emision: "2030-02-01", agencia_nombre: null, freelance_nombre: null, ...venta },
    pasajeros: d.pasajeros, hoteles: d.hoteles, vuelos: [], items: d.items, totalPagado: d.pagado, cobro: cobroDeVenta(venta), agencia: AGENCIA_PRUEBA, condiciones: null,
    habitacionesBernalo: [], resumenPrecios: null, netoTotalExigible: null, estancia: null, incluye: d.contexto.incluye, noIncluye: d.contexto.noIncluye,
  };
  const html = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
  return { texto: limpio(html), html };
}
function renderCotizacion(d: Record<string, any>): string {
  const cot = d.cotizacion_hija;
  const det = cot.detalle;
  const venta = { cliente: cot.cliente, destino: cot.destino, fecha_salida: cot.fecha_salida, fecha_regreso: cot.fecha_regreso, pax: cot.pax, ninos: Number(cot.payload?.ninos ?? 0), precio_venta: Number(cot.precio_venta), moneda: cot.moneda };
  return limpio(renderToStaticMarkup(createElement(CotizacionManualDocumento as ComponentType<Record<string, unknown>>, {
    codigo: cot.codigo ?? "", venta, items: det.items, cliente: cot.payload?.cliente ?? {}, incluye: det.incluye ?? null, noIncluye: det.noIncluye ?? null, hoteles: det.hoteles ?? null,
    vigenciaHasta: cot.vigencia_hasta, fechaEmision: "2030-02-01", agencia: AGENCIA_PRUEBA, logoAliado: null,
  })));
}

test("hay volcados del recorrido real (si faltan: corre supabase/scripts/test_rev2_95docs.sh con R2_EVIDENCIA)", () => {
  assert.ok(archivos.length >= 4, `se esperaban ≥ 4 volcados (2 escenarios × 2 opciones) y hay ${archivos.length}`);
});

for (const archivo of archivos) {
  test(`opción elegida convertida · ${archivo.replace(".json", "")}`, () => {
    const d = JSON.parse(fs.readFileSync(`${DIR}/${archivo}`, "utf8")) as Record<string, any>;
    const { opcion, moneda, total } = d.contexto as { opcion: "A" | "B"; moneda: string; total: number };
    const hotel = d.hoteles as Record<string, any>[];
    assert.equal(hotel.length, 1, "el contrato trae EL hotel elegido");
    const { texto, html } = renderContrato(d);

    // Hoteles y Servicios: hotel, categoría, ciudad, plan de alimentación, acomodación, fechas.
    const nombre = opcion === "A" ? "Hotel A" : "Hotel B", categoria = opcion === "A" ? "Superior" : "Estándar", plan = opcion === "A" ? "PAM" : "PC";
    assert.ok(texto.includes(`${nombre} · ${categoria}`), `hotel y categoría: ${nombre} · ${categoria}`);
    assert.ok(texto.includes("Ciudad: CARTAGENA 95"));
    assert.ok(texto.includes(`Alimentación: ${plan} · Acomodación: ${hotel[0].acomodacion}`), `plan de alimentación y acomodación (${plan} · ${hotel[0].acomodacion})`);
    assert.ok(/1 de marzo de 2030/.test(texto) && /4 de marzo de 2030/.test(texto), "fechas del hotel");
    assert.ok(!texto.includes(opcion === "A" ? "Hotel B" : "Hotel A"), "nada del otro hotel");
    // Proveedor, plataforma y origen de compra son internos.
    for (const interno of ["Booking", "Proveedor 95", "Despegar", "plataforma", "compra_origen"]) assert.ok(!texto.includes(interno), `el documento del cliente no expone «${interno}»`);

    // Incluye / No incluye de ESA opción.
    assert.ok(html.includes('data-testid="incluye-documento"'), "sección Incluye / No incluye");
    for (const linea of String(d.contexto.incluye).split("\n")) assert.ok(texto.includes(linea), `incluye: ${linea}`);
    assert.ok(texto.includes(String(d.contexto.noIncluye)), "no incluye");
    const otra = opcion === "A" ? "Plan completo B" : "Desayuno buffet A";
    assert.ok(!texto.includes(otra), "nada prestado de la otra opción");

    // Valores: UNA fila agrupada (sin fila de ajuste), tarifa REAL del niño, suma exacta = total.
    assert.ok(!texto.includes("Ajuste por redondeo") && !texto.includes("redondeo"), "ni fila ni texto de redondeo");
    const filas = [...html.matchAll(/<tr[^>]*data-testid="fila-paquete-turistico"|<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    const valores = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => limpio(c[1]).trim())).filter((c) => c[0]?.startsWith("PAQUETE TURÍSTICO"));
    void filas;
    assert.equal(valores.length, 1, "UNA sola fila de valores (agrupada)");
    const paquete = d.items.find((i: Record<string, any>) => String(i.descripcion).startsWith("PAQUETE TURÍSTICO A "));
    const aj = d.items.find((i: Record<string, any>) => i.descripcion === "Ajuste de redondeo del reparto del hotel");
    const adultosTotal = centavos(paquete.adultos * paquete.tarifa_adulto) + (aj ? centavos(aj.adultos * aj.tarifa_adulto) : 0);
    const f = valores[0];
    assert.equal(f[1], String(paquete.adultos));
    assert.equal(f[2], String(paquete.ninos));
    assert.equal(f[3], importe(adultosTotal / paquete.adultos / 100, moneda), "tarifa del adulto con el residuo, a su precisión de cálculo");
    assert.equal(f[4], importe(Number(paquete.tarifa_nino), moneda), "tarifa REAL del niño");
    assert.equal(f[5], importe(total, moneda), "valor total de la fila = el total exacto");
    assert.ok(texto.includes(`Total del contrato ${importe(total, moneda)}`));

    // La COTIZACIÓN elegida muestra el mismo alojamiento y el mismo total; sin proveedor ni plataforma.
    const cot = renderCotizacion(d);
    assert.ok(cot.includes("Hoteles y Servicios") && cot.includes(`${nombre} · ${categoria}`), "la cotización elegida muestra su hotel y categoría");
    assert.ok(cot.includes(`Alimentación: ${plan} · Acomodación: ${hotel[0].acomodacion}`));
    assert.ok(cot.includes(importe(total, moneda)));
    for (const interno of ["Booking", "Proveedor 95", "Despegar"]) assert.ok(!cot.includes(interno), `la cotización no expone «${interno}»`);
    assert.ok(!cot.includes(opcion === "A" ? "Hotel B" : "Hotel A"));
  });
}
