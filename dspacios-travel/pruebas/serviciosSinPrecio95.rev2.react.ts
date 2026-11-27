// B95-02 (owner 2026-11-26) — un servicio adicional NUNCA muestra su propio precio en el documento del CLIENTE, sea del tipo que sea (asistencia, traslado, tour, otro), en cotización o contrato, PVP o NETO, COP o USD.
// Captura real del dueño: «Asistencia médica B95 · 2 pax · $76.000» como valor separado. Componente REAL (`ContratoDocumento`), importes calculados a mano; las filas visibles suman EXACTAMENTE el total impreso.
// El servicio sigue descrito (qué incluye, cuándo, a quién cubre) y su importe va dentro de la tarifa de los ADULTOS; la tarifa del niño es la real y no cambia.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");

const venta = {
  numero_contrato: "DTM-0950", cliente: "Cliente B95", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
  pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: true, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const it = (id: number, descripcion: string, adultos: number, ninos: number, ta: number, tn: number) => ({ id, numero_contrato: "", descripcion, adultos, ninos, tarifa_adulto: ta, tarifa_nino: tn, orden: id, modo_precio: "por_persona", valor_total: null });
const HOTEL = it(1, "1 hab Doble (2 pax) · Superior / PAM", 2, 0, 900_000, 0);
const ASISTENCIA = it(10, "Servicio · Asistencia médica B95", 1, 0, 76_000, 0); // así lo guarda Reservar: adultos 1 × el total del servicio (2 pax)

function render(items: unknown[], extra: Record<string, unknown> = {}) {
  const props = { venta, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], esCotizacion: false, netoTotalExigible: null, ...extra };
  return renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
}
const plano = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const filas = (h: string) => [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => plano(c[1]).trim()));
const fila = (h: string, inicio: string) => filas(h).find((c) => c[0]?.startsWith(inicio)) ?? null;
const centavos = (celda: string): number => {
  const usd = celda.includes("USD");
  const n = usd ? Number(celda.replace(/USD/g, "").replace(/[^0-9.]/g, "")) : Number(celda.replace(/[^0-9,]/g, "").replace(",", "."));
  return Math.round(n * 100) * (celda.includes("-") ? -1 : 1);
};
/** Texto de TODAS las celdas de la tabla de valores (y de la sección de servicios): ningún importe del servicio puede aparecer. */
const ocurrencias = (h: string, texto: string) => (plano(h).match(new RegExp("(?<![0-9.,])" + texto.replace(/[.$]/g, (c) => "\\" + c) + "(?![0-9])", "g")) ?? []).length;

describe("B95-02 · servicios adicionales sin precio propio (contrato Reservar, PVP, COP)", () => {
  const items = [HOTEL, ASISTENCIA];
  for (const esCotizacion of [false, true]) {
    test(`${esCotizacion ? "cotización" : "contrato"}: «Asistencia médica B95» descrita SIN $76.000; adultos 2 × 938.000 = 1.876.000 = total`, () => {
      const h = render(items, esCotizacion ? { esCotizacion: true, codigo: "C-9", vigenciaHasta: "2030-10-10" } : {});
      const t = plano(h);
      assert.ok(t.includes("Asistencia médica B95"), "el servicio sigue descrito");
      assert.equal(ocurrencias(h, "76.000"), 0, "su precio propio NO se imprime");
      const f = fila(h, "1 hab Doble")!;
      assert.match(f[3], /^\$\s?938\.000$/, `tarifa por adulto = 900.000 + 76.000/2 (${f.join(" | ")})`);
      assert.equal(centavos(f[5]), 1_876_000 * 100);
      assert.match(t, /Total del contrato \$\s?1\.876\.000/);
      // El servicio aparece solo en «Servicios incluidos» (Servicio · Fechas · A quién cubre), nunca con una columna de valor.
      const s = fila(h, "Asistencia médica B95")!;
      assert.equal(s.length, 3, "tres columnas descriptivas, ninguna de importe");
      assert.ok(!s.some((c) => /\$/.test(c)), "ninguna celda del servicio lleva un importe");
    });
  }
  test("dos servicios de naturaleza distinta (asistencia + traslado 40.000): ninguno muestra precio; suma exacta 1.916.000", () => {
    const h = render([HOTEL, ASISTENCIA, it(11, "Servicio · Traslado aeropuerto", 1, 0, 40_000, 0)]);
    assert.equal(ocurrencias(h, "76.000") + ocurrencias(h, "40.000"), 0);
    assert.match(fila(h, "1 hab Doble")![5], /^\$\s?1\.916\.000$/);
    assert.ok(plano(h).includes("Traslado aeropuerto") && plano(h).includes("Asistencia médica B95"));
  });
  test("con un niño (tarifa real 500.000): el servicio va en los adultos y la tarifa del niño NO cambia; las filas suman el total 2.376.000", () => {
    const h = render([HOTEL, it(2, "Niño 1 · Superior / PAM", 0, 1, 0, 500_000), ASISTENCIA]);
    const a = fila(h, "1 hab Doble")!, n = fila(h, "Niño 1")!;
    assert.equal(centavos(a[5]), 1_876_000 * 100);
    assert.equal(centavos(n[4]), 500_000 * 100, "tarifa REAL del niño intacta");
    assert.equal(centavos(a[5]) + centavos(n[5]), 2_376_000 * 100);
    assert.equal(ocurrencias(h, "76.000"), 0);
  });
  test("tour con fechas y cobertura en el texto («Servicio · Tour Rosario · 2030-10-16 → 2030-10-16 · 2 pax»): se explica qué incluye y a quién cubre, sin importe", () => {
    const h = render([HOTEL, it(12, "Servicio · Tour Rosario · 2030-10-16 → 2030-10-16 · 2 pax", 1, 0, 120_000, 0)]);
    const t = plano(h);
    assert.ok(t.includes("Tour Rosario"));
    assert.equal(ocurrencias(h, "120.000"), 0);
    assert.match(fila(h, "1 hab Doble")![5], /^\$\s?1\.920\.000$/);
  });
});

describe("B95-02 · NETO y USD", () => {
  test("NETO (total exigible 1.790.000 de un PVP 1.876.000): el servicio no muestra su neto; adultos 2 × 895.000", () => {
    const h = render([HOTEL, ASISTENCIA], { netoTotalExigible: 1_790_000 });
    const t = plano(h);
    assert.equal(ocurrencias(h, "76.000") + ocurrencias(h, "72.000"), 0, "ni PVP ni neto prorrateado del servicio");
    const f = fila(h, "1 hab Doble")!;
    assert.equal(centavos(f[5]), 1_790_000 * 100);
    assert.match(f[3], /^\$\s?895\.000$/);
    assert.match(t, /Total del contrato \$\s?1\.790\.000/);
    assert.equal(ocurrencias(h, "1.876.000"), 0, "el PVP no aparece");
  });
  test("USD con centavos: 2 × USD 450,25 + asistencia USD 38,00 → tarifa de adulto USD 469,25, total USD 938,50", () => {
    const h = render([it(1, "1 hab Doble (2 pax) · Superior / PAM", 2, 0, 450.25, 0), it(10, "Servicio · Asistencia médica B95", 1, 0, 38, 0)], { venta: { ...venta, moneda: "USD" } });
    const f = fila(h, "1 hab Doble")!;
    assert.match(f[3], /USD \$469\.25/);
    assert.equal(centavos(f[5]), 93_850);
    assert.equal(ocurrencias(h, "USD $38"), 0);
    assert.ok(plano(h).includes("USD $938.50"));
  });
});

describe("B95-02 · lo que NO cambia", () => {
  test("sin servicios el documento es el de siempre", () => {
    const h = render([HOTEL]);
    assert.match(fila(h, "1 hab Doble")![3], /^\$\s?900\.000$/);
    assert.equal(plano(h).includes("Servicios incluidos"), false);
  });
  test("con un total que no concilia con las líneas (dato inválido) NO se inventa un reparto NI se muestra el precio del servicio: solo el total, sin importes por fila", () => {
    const h = render([HOTEL, ASISTENCIA], { netoTotalExigible: 1_876_001 });
    assert.ok(plano(h).includes("1.876.001"), "el total exigible se conserva");
    assert.equal(ocurrencias(h, "76.000"), 0, "el precio del servicio nunca se imprime");
    assert.equal(ocurrencias(h, "938.000"), 0, "no se inventa un reparto");
    assert.ok(plano(h).includes("Asistencia médica B95"), "el servicio sigue descrito");
    assert.equal(fila(h, "1 hab Doble")!.length, 3, "solo Ítem · Adultos · Niños: ninguna columna de tarifa/valor");
  });
});
