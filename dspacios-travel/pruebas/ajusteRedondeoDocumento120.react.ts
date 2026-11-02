// Se ejecuta con npm run test:react (loader del arnés).
//
// #120 · Presentación al CLIENTE de la línea de ajuste de redondeo del reparto de un hotel a solicitud: «Ajuste por redondeo», con el importe (±) solo en «Valor total» y «—» en Adultos, Niños y tarifas.
// NO cambia ningún importe: la suma de las filas del documento y el total que imprime son los de siempre (también con el ajuste en negativo). El texto completo («…del reparto del hotel») queda en los ítems guardados.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { DESCRIPCION_AJUSTE_REDONDEO, ETIQUETA_AJUSTE_CLIENTE, esLineaAjusteRedondeo } = await import("../lib/reservar/solicitudHotel.ts");

const venta = {
  numero_contrato: "", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
  pax: 3, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const HOTELES = [{ id: 1, nombre: "Hotel Almirante", categoria: "Estándar", ciudad: "Cartagena", alimentacion: "PC", acomodacion: "Doble", fecha_ingreso: "2030-10-15", fecha_salida: "2030-10-18" }];
const item = (id: number, descripcion: string, adultos: number, ninos: number, ta: number, tn: number) => ({ id, numero_contrato: "", descripcion, adultos, ninos, tarifa_adulto: ta, tarifa_nino: tn, orden: id, modo_precio: "por_persona", valor_total: null });
// 2 adultos × 1.000.000 + 1 niño × 751.000 = 2.751.000; con ajuste +1.000 = 2.752.000 (el caso S3 del navegador)
const base = [item(1, "1 hab Doble (2 pax) · A confirmar / A confirmar", 2, 0, 1_000_000, 0), item(2, "Niño 1 · A confirmar / A confirmar", 0, 1, 0, 751_000)];

function html(items: unknown[], esCotizacion = true) {
  const props = { venta, pasajeros: [], hoteles: HOTELES, vuelos: [], items, totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible: null, paqueteSnapshot: null };
  return renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
}
const plano = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** Celdas (texto) de la fila de la tabla de valores cuya primera celda empieza por `inicio`. */
function celdas(h: string, inicio: string): string[] | null {
  for (const m of h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cs = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => plano(c[1]).trim());
    if (cs[0]?.startsWith(inicio)) return cs;
  }
  return null;
}

describe("línea de ajuste de redondeo en el documento de cliente", () => {
  for (const [nombre, ajuste] of [["positivo", 1_000], ["negativo", -1_000]] as const) {
    test(`ajuste ${nombre} (${ajuste}): «${ETIQUETA_AJUSTE_CLIENTE}», «—» en personas y tarifas, importe solo en «Valor total»; el texto interno no aparece`, () => {
      const h = html([...base, item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, ajuste, 0)]);
      const c = celdas(h, ETIQUETA_AJUSTE_CLIENTE);
      assert.ok(c, "la fila existe con el rótulo de cliente");
      assert.deepEqual(c!.slice(0, 5), [ETIQUETA_AJUSTE_CLIENTE, "—", "—", "—", "—"]);
      assert.match(c![5], ajuste < 0 ? /-\s?\$\s?1\.000/ : /^\$\s?1\.000$/);
      assert.equal(plano(h).includes("reparto del hotel"), false, "ningún texto interno en el documento de cliente");
      assert.equal(plano(h).includes(DESCRIPCION_AJUSTE_REDONDEO), false);
    });
    test(`ajuste ${nombre}: el total del documento y la suma de sus filas NO cambian (2.751.000 ${ajuste < 0 ? "−" : "+"} 1.000)`, () => {
      const esperado = 2_751_000 + ajuste;
      const h = html([...base, item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, ajuste, 0)]);
      const t = plano(h);
      const fmt = esperado.toLocaleString("es-CO");
      assert.match(t, new RegExp(`TOTAL[^$]*\\$\\s?${fmt.replace(/\./g, "\\.")}`, "i"), `el total impreso es ${fmt}`);
      // suma de los «Valor total» de las tres filas de la tabla = total
      const vals = ["1 hab Doble", "Niño 1", ETIQUETA_AJUSTE_CLIENTE].map((i) => celdas(h, i)).map((c) => c![5]);
      const suma = vals.map((v) => (v.includes("-") ? -1 : 1) * Number(v.replace(/[^0-9]/g, ""))).reduce((a, b) => a + b, 0);
      assert.equal(suma, esperado, "las filas visibles suman el total congelado");
    });
  }
  test("sin ajuste no aparece ninguna fila (documento idéntico al de siempre) y una fila de otro tipo con texto parecido NO se oculta ni se renombra", () => {
    const h = html([...base, item(3, "Ajuste de redondeo del paquete", 1, 0, 500, 0)]);
    assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null);
    const otra = celdas(h, "Ajuste de redondeo del paquete");
    assert.ok(otra && otra[1] === "1", "solo la constante exacta se re-rotula; cualquier otra fila conserva sus columnas");
    assert.equal(celdas(html(base), ETIQUETA_AJUSTE_CLIENTE), null);
  });
  test("el reconocimiento es por la constante ÚNICA (igualdad exacta)", () => {
    assert.equal(esLineaAjusteRedondeo(DESCRIPCION_AJUSTE_REDONDEO), true);
    assert.equal(esLineaAjusteRedondeo(ETIQUETA_AJUSTE_CLIENTE), false);
    assert.equal(esLineaAjusteRedondeo(undefined), false);
    assert.equal(esLineaAjusteRedondeo("ajuste de redondeo del reparto del hotel"), false);
  });
  test("el mismo rótulo en el documento del CONTRATO (no cotización)", () => {
    const h = html([...base, item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, 1_000, 0)], false);
    const c = celdas(h, ETIQUETA_AJUSTE_CLIENTE);
    assert.ok(c);
    assert.deepEqual(c!.slice(0, 5), [ETIQUETA_AJUSTE_CLIENTE, "—", "—", "—", "—"]);
  });
});
