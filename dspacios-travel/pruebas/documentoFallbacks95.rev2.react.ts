// Codex 2026-11-26 — las reglas del documento del CLIENTE son INCONDICIONALES: (a) un servicio adicional nunca muestra su precio propio y (b) la fila «Ajuste por redondeo» no existe,
// AUNQUE el importe no se pueda absorber de forma exacta. En esos casos NO se inventa un reparto ni se pierde el importe: el documento omite los importes por fila y conserva el total guardado.
// Estas pruebas fuerzan DELIBERADAMENTE las condiciones de respaldo (datos inválidos, sin fila de adultos, centavos fraccionarios, total que no concilia), no los casos de absorción exitosa.
// Redondeo: la presentación 3 × USD 477,33 = USD 1.431,99 ≠ USD 1.432,00 sigue siendo decisión PENDIENTE del dueño (no se afirma aquí que esté aprobada).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { DESCRIPCION_AJUSTE_REDONDEO, ETIQUETA_AJUSTE_CLIENTE } = await import("../lib/reservar/solicitudHotel.ts");

const venta = {
  numero_contrato: "DTM-0951", cliente: "Cliente B95", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
  pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: true, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const it = (id: number, descripcion: string, adultos: number, ninos: number, ta: number, tn: number) => ({ id, numero_contrato: "", descripcion, adultos, ninos, tarifa_adulto: ta, tarifa_nino: tn, orden: id, modo_precio: "por_persona", valor_total: null });
function render(items: unknown[], extra: Record<string, unknown> = {}) {
  const props = { venta, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], esCotizacion: false, netoTotalExigible: null, ...extra };
  return renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
}
const plano = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const filas = (h: string) => [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => plano(c[1]).trim()));
const fila = (h: string, inicio: string) => filas(h).find((c) => c[0]?.startsWith(inicio)) ?? null;
const n = (h: string, texto: string) => (plano(h).match(new RegExp("(?<![0-9.,])" + texto.replace(/[.$]/g, (c) => "\\" + c) + "(?![0-9])", "g")) ?? []).length;
const AJ = DESCRIPCION_AJUSTE_REDONDEO;

describe("servicios adicionales: respaldo sin reparto exacto → NUNCA con precio", () => {
  const HOTEL = it(1, "1 hab Doble (2 pax) · Superior / PAM", 2, 0, 900_000, 0);
  const caso = (nombre: string, items: unknown[], extra: Record<string, unknown>, total: string) => test(nombre, () => {
    const h = render(items, extra);
    assert.equal(n(h, "76.000"), 0, "el precio propio del servicio no se imprime");
    assert.ok(plano(h).includes("Asistencia médica B95"), "el servicio sigue descrito");
    assert.ok(!filas(h).some((c) => c[0]?.startsWith("Asistencia médica B95") && c.some((x) => /\$/.test(x))), "ninguna celda del servicio lleva importe");
    assert.ok(plano(h).includes(total), `el total guardado (${total}) se conserva`);
    assert.equal(fila(h, "1 hab Doble")!.length, 3, "sin columnas de tarifa/valor por fila");
    assert.equal(plano(h).includes("Servicios adicionales"), false, "no existe la tabla de servicios con precio");
  });
  caso("NETO: total exigible no concilia con las líneas", [HOTEL, it(10, "Servicio · Asistencia médica B95", 1, 0, 76_000, 0)], { netoTotalExigible: 1_876_001 }, "1.876.001");
  caso("PVP: línea del servicio con cantidad no entera (dato inválido)", [HOTEL, it(10, "Servicio · Asistencia médica B95", 1.5, 0, 50_666.67, 0)], {}, "1.876.000");
  caso("PVP: ids duplicados entre líneas", [HOTEL, { ...it(10, "Servicio · Asistencia médica B95", 1, 0, 76_000, 0), id: 1 }], {}, "1.876.000");
  test("cotización (no solo contrato) también oculta el precio en el respaldo", () => {
    const h = render([HOTEL, it(10, "Servicio · Asistencia médica B95", 1, 0, 76_000, 0)], { esCotizacion: true, codigo: "C-9", vigenciaHasta: "2030-10-10", netoTotalExigible: 1_876_001 });
    assert.equal(n(h, "76.000"), 0);
    assert.ok(plano(h).includes("Asistencia médica B95"));
  });
});

describe("ajuste de redondeo: respaldo sin reparto → la fila NO existe, el total no cambia", () => {
  const casos: [string, unknown[], string][] = [
    ["sin fila de adultos que lo reciba (solo niños) · ajuste +5", [it(1, "Niño 1 · Superior / PAM", 0, 2, 0, 100_000), it(2, AJ, 1, 0, 5, 0)], "200.005"],
    ["centavos fraccionarios entre filas (1×100.000 + 2×90.000 + ajuste 1 peso → reparto desigual)", [it(1, "Hotel A · Superior / PAM", 1, 0, 100_000, 0), it(2, "Hotel B · Superior / PAM", 2, 0, 90_000, 0), it(3, AJ, 1, 0, 0.01, 0)], "280.000"],
  ];
  for (const [nombre, items, total] of casos) {
    test(nombre, () => {
      const h = render(items);
      const t = plano(h);
      assert.equal(t.includes(ETIQUETA_AJUSTE_CLIENTE), false, "ninguna fila «Ajuste por redondeo»");
      assert.equal(t.includes("Ajuste de redondeo"), false);
      assert.ok(t.includes(total), `el total guardado (${total}) se conserva`);
      const encabezado = filas(h).find((c) => c[0] === "Ítem");
      assert.deepEqual(encabezado, ["Ítem", "Adultos", "Niños"], "sin columnas de tarifa/valor: no se inventa ningún reparto");
    });
  }
  test("contraste: con una fila de adultos que sí puede recibirlo, el ajuste se absorbe exacto y se conservan las columnas de valor", () => {
    const h = render([it(1, "PAQUETE · Superior / PAM", 2, 0, 715_228, 0), it(2, AJ, 1, 0, -1, 0)]);
    assert.equal(plano(h).includes(ETIQUETA_AJUSTE_CLIENTE), false);
    assert.ok(filas(h).find((c) => c[0] === "Ítem")!.length > 3);
  });
});

describe("resumen por pasajero heredado con residuo sin reparto: ninguna fila de ajuste ni importes inventados", () => {
  test("residuo de 1 centavo y pasajeros sin identificar: documento sin «Ajuste por redondeo», sin tarifas por fila; el total guardado se conserva", async () => {
    const { resumenUnidad, resumenCotizacion } = await import("../lib/cotizacion/resumenPrecios.ts");
    const r = resumenUnidad({ ref: "item-0", paquete: { id: 7, nombre: "Cartagena Esencial" }, hotel: "Hotel Almirante", categoria: "Estándar", regimen: "PC", cupos: ["a1", "a2", "a3"].map((id) => ({ id, tipo: "adulto" as const, baseCentavos: 30_000_000 })), servicios: [] });
    assert.ok(r.ok);
    const base = (r as { valor: Record<string, unknown> & { grupos: { cupos: string[] }[]; totalCentavos: number } }).valor;
    const legado = { ...base, ajusteCentavos: 1, totalCentavos: base.totalCentavos + 1, grupos: base.grupos.map((g) => ({ ...g, cupos: [] })) };
    const resumen = JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [legado as never] })));
    const h = render([it(1, "1 hab Triple (3 pax) · Estándar / PC", 3, 0, 300_000, 0), { ...it(2, "x", 0, 0, 0, 0), modo_precio: "total", valor_total: 0.01 }], { resumenPrecios: resumen, esCotizacion: true, codigo: "C-1", vigenciaHasta: "2030-10-10" });
    const t = plano(h);
    assert.ok(h.includes('data-testid="resumen-precios"'), "el resumen por pasajero se usa (la rama bajo prueba)");
    assert.equal(h.includes('data-testid="resumen-ajuste"'), false);
    assert.equal(t.includes(ETIQUETA_AJUSTE_CLIENTE), false);
    assert.equal(t.includes("Tarifa Adulto"), false, "sin columnas de tarifa: no se inventa un reparto");
    assert.equal(t.includes("Valor total"), false);
    assert.ok(t.includes("900.000,01") || t.includes("900.000"), "el total del contrato sigue visible");
  });
});
