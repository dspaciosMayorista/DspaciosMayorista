// REV2 (B95-16, owner 2026-11-26) — DOCUMENTO DEL CLIENTE de contratos que nacieron en el TARIFARIO (comparativa del carrito → opción elegida → convertirCotizacionCarrito).
// pruebas/f95tarifario.rev2.pg.ts vuelca las filas PERSISTIDAS por las acciones reales a docs/tecnico/evidencia-rev2-95tarifario-2026-11-26/*.json (sintéticas). Aquí se renderiza el componente REAL
// (el mismo que sirven /contrato/[numero] y /c/[token], pantalla y papel) con esas filas y se comprueba, con totales calculados a mano:
//   · B95-02: el servicio adicional (asistencia) NO tiene precio propio en el documento del cliente; su valor está dentro de la tarifa del adulto;
//   · B95-19: no hay fila ni texto «Ajuste por redondeo»; las filas visibles suman EXACTAMENTE el total (lo guardado = lo impreso), saldo cero si está pagado;
//   · B95-18: se ve el hotel elegido con su categoría, plan de alimentación y la habitación/niño del carrito; nada del otro hotel; ni proveedor ni costos;
//   · la tarifa real del niño (gratis en B, 150.000 en A).
// Se ejecuta con `npm run test:react:rev2`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement, type ComponentType } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { cobroDeVenta } = await import("../lib/finanzas/cobro.ts");

const DIR = "docs/tecnico/evidencia-rev2-95tarifario-2026-11-26";
const archivos = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^rev2_.*\.json$/.test(f)).sort() : [];
const limpio = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ").replace(/\$ /g, "$");
const centavos = (n: number) => Math.round(n * 100);
const cop = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

function renderContrato(d: Record<string, any>): { texto: string; html: string } {
  const venta = d.venta;
  const props = {
    venta: { cliente_telefono: null, cliente_direccion: null, asesor_firma_nombre: venta.asesor, asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, fecha_emision: "2030-02-01", agencia_nombre: null, freelance_nombre: null, ...venta },
    pasajeros: d.pasajeros, hoteles: d.hoteles, vuelos: [], items: d.items, totalPagado: d.pagado, cobro: cobroDeVenta(venta), agencia: AGENCIA_PRUEBA, condiciones: null,
    habitacionesBernalo: [], resumenPrecios: d.resumen[0]?.resumen ?? null, netoTotalExigible: null, estancia: null, incluye: null, noIncluye: null,
  };
  const html = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
  return { texto: limpio(html), html };
}

test("hay volcados del recorrido real (si faltan: corre supabase/scripts/test_rev2_95docs.sh con R2_ARCHIVOS=pruebas/f95tarifario.rev2.pg.ts y R2_EVIDENCIA)", () => {
  assert.ok(archivos.length >= 3, `se esperaban ≥ 3 volcados y hay ${archivos.length}`);
});

for (const archivo of archivos) {
  test(`documento del contrato nacido en el Tarifario · ${archivo.replace(".json", "")}`, (t) => {
    const d = JSON.parse(fs.readFileSync(`${DIR}/${archivo}`, "utf8")) as Record<string, any>;
    const { opcion, conNino, total } = d.contexto as { opcion: "A" | "B"; conNino: boolean; total: number };
    const { texto, html } = renderContrato(d);
    t.diagnostic(texto.slice(texto.indexOf("Hoteles"), texto.indexOf("Hoteles") + 1800));

    // B95-18: el hotel elegido y sus datos (nada del otro).
    const [hotel, categoria, plan] = opcion === "A" ? ["Hotel Alfa 95T", "Estandar", "Desayuno"] : ["Hotel Beta 95T", "Superior", "Todo incluido"];
    assert.ok(texto.includes(`${hotel} · ${categoria}`), `hotel y categoría: ${hotel} · ${categoria}`);
    assert.ok(texto.includes("Ciudad: CARTAGENA 95T"));
    assert.ok(texto.includes(`Alimentación: ${plan}`), `plan de alimentación ${plan}`);
    assert.ok(texto.includes(conNino ? "1 hab Doble (2 pax), 1 Niño 1" : "1 hab Doble (2 pax)"), "la habitación y el niño del carrito");
    assert.ok(/1 de marzo de 2030/.test(texto) && /4 de marzo de 2030/.test(texto), "fechas del hotel");
    assert.ok(!texto.includes(opcion === "A" ? "Hotel Beta" : "Hotel Alfa"), "nada del otro hotel");
    for (const interno of ["Proveedor 95T", "compra_origen", "neto"]) assert.ok(!texto.includes(interno), `el documento del cliente no expone «${interno}»`);

    // B95-19: ni fila ni texto de redondeo.
    const iv = texto.indexOf("Valores y Pagos");
    const valoresTexto = texto.slice(iv, texto.indexOf("CONTRATO DE PRESTACIÓN", iv));
    assert.ok(valoresTexto.length > 100 && !/ajuste|redondeo/i.test(valoresTexto), "sin fila ni texto de ajuste por redondeo en Valores y Pagos");

    // B95-02: el servicio adicional se DESCRIBE pero no lleva precio propio (su valor va dentro de la tarifa del adulto).
    const servicio = d.items.find((i: Record<string, any>) => /^Servicio · /.test(i.descripcion));
    const valorServicio = Number(servicio.tarifa_adulto) * Number(servicio.adultos);
    assert.ok(valorServicio > 0, "fixture coherente: el servicio tiene valor guardado");
    const celdas = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => limpio(c[1]).trim()));
    const filaServicio = celdas.find((c) => c.some((x) => /Asistencia médica 95T/.test(x)));
    if (filaServicio) assert.ok(!filaServicio.some((x) => x.includes(cop(valorServicio)) || x.includes(String(valorServicio))), `la fila del servicio no muestra su precio propio (${filaServicio.join(" | ")})`);
    assert.ok(!texto.includes(`Asistencia médica 95T — CARTAGENA 95T ${cop(valorServicio)}`), "ningún «servicio + precio» suelto");
    assert.ok(/Asistencia médica 95T/.test(texto), "el servicio sí se describe (qué incluye)");

    // Valores: las filas de valores visibles suman EXACTAMENTE el total (pesos), con la tarifa real del niño.
    const valores = celdas.filter((c) => c.length >= 4 && c.some((x) => /^\$[\d.]+$/.test(x)));
    t.diagnostic(`filas de valores: ${JSON.stringify(valores)}`);
    const importes = valores.map((c) => Number(c[c.length - 1].replace(/[^\d]/g, "")));
    assert.equal(importes.reduce((s, n) => s + n, 0), total, "las filas visibles suman exactamente el total del contrato");
    assert.ok(texto.includes(cop(total)), "el total impreso es el guardado");
    // Tarifa del adulto y del niño a mano: el hotel (A: adulto 375.000, niño 150.000 · B: adulto 480.000, niño GRATIS) + la asistencia de 40.000 por persona que cubre a los 3 pasajeros
    // (el niño de B es gratis en el HOTEL pero paga su asistencia: $40.000, no $0; el valor del servicio NO aparece aparte).
    const esperado = opcion === "A" ? { adulto: 415_000, nino: 190_000 } : { adulto: conNino ? 520_000 : 520_000, nino: conNino ? 40_000 : 0 };
    const fila = valores[0];
    assert.equal(valores.length, 1, "UNA sola fila de valores agrupada");
    assert.deepEqual([fila[3], fila[4]], [cop(esperado.adulto), cop(esperado.nino)], "tarifa por adulto y por niño (a mano)");
    assert.equal(fila[1] + "/" + fila[2], conNino ? "2/1" : "2/0");
    // Pagado por completo → saldo cero.
    assert.equal(centavos(d.pagado), centavos(total), "pagado = total (saldo cero)");
    assert.ok(/Saldo[^$]{0,40}\$0\b/.test(texto) || !/Saldo pendiente/i.test(texto), "el documento no pide saldo");
  });
}
