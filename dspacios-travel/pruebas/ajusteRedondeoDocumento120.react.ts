// Se ejecuta con npm run test:react (loader del arnés).
//
// B95-19 (corrección del dueño 2026-11-26) — SUPERA la presentación de #120. El dueño rechaza la fila visible «Ajuste por redondeo» en el documento del CLIENTE. El residuo de redondeo (la línea guardada
// «Ajuste de redondeo del reparto del hotel», ±) ya NO se imprime como fila: se pliega en la tarifa de los ADULTOS (la del niño es la real y no cambia), de modo que las filas impresas suman EXACTAMENTE el total
// guardado, en la unidad de la moneda (peso en COP, centavo en USD), sin tolerancia. La línea guardada NO se toca (Σ ítems = precio_venta); solo cambia la presentación.
//   · Aserciones anteriores que se MOVIERON (no se debilitaron): «fila "Ajuste por redondeo" con importe solo en Valor total» → «ninguna fila de ajuste; la tarifa de adulto incluye el residuo»;
//     «el total y la suma de las filas no cambian» se conserva y se endurece (suma exacta de las filas visibles, en COP y en USD con centavos).
//   · Se conserva: el reconocimiento por la constante ÚNICA (igualdad exacta), una fila de otro tipo con texto parecido NO se pliega, ningún texto interno llega al cliente.
//   · Único caso en que la fila se conserva: el residuo no se puede repartir en centavos enteros entre las filas de adultos (varias filas con distinto número de adultos). Nunca se adivina ni se reparte desigual.
import { test, describe } from "node:test";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { DESCRIPCION_AJUSTE_REDONDEO, ETIQUETA_AJUSTE_CLIENTE, esLineaAjusteRedondeo } = await import("../lib/reservar/solicitudHotel.ts");
const { absorberAjusteRedondeo } = await import("../lib/contrato/absorberAjusteRedondeo.ts");

const venta = {
  numero_contrato: "", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
  pax: 3, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const HOTELES = [{ id: 1, nombre: "Hotel Almirante", categoria: "Estándar", ciudad: "Cartagena", alimentacion: "PC", acomodacion: "Doble", fecha_ingreso: "2030-10-15", fecha_salida: "2030-10-18" }];
const item = (id: number, descripcion: string, adultos: number, ninos: number, ta: number, tn: number) => ({ id, numero_contrato: "", descripcion, adultos, ninos, tarifa_adulto: ta, tarifa_nino: tn, orden: id, modo_precio: "por_persona", valor_total: null });
// 2 adultos × 1.000.000 + 1 niño × 751.000 = 2.751.000; con ajuste +1.000 = 2.752.000 (el caso S3 del navegador)
const base = [item(1, "1 hab Doble (2 pax) · A confirmar / A confirmar", 2, 0, 1_000_000, 0), item(2, "Niño 1 · A confirmar / A confirmar", 0, 1, 0, 751_000)];

function html(items: unknown[], esCotizacion = true, moneda = "COP") {
  const props = { venta: { ...venta, moneda }, pasajeros: [], hoteles: HOTELES, vuelos: [], items, totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], esCotizacion, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible: null };
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
/** Importes de una celda («$ 1.000.500», «-$ 5», «USD $477.33») → centavos enteros con signo. */
const centavos = (celda: string): number => {
  const neg = celda.includes("-");
  const sinMoneda = celda.replace(/USD/g, "").replace(/[^0-9.,]/g, "");
  const usd = celda.includes("USD");
  const n = usd ? Number(sinMoneda.replace(/,/g, "")) : Number(sinMoneda.replace(/\./g, "").replace(",", "."));
  return (neg ? -1 : 1) * Math.round(n * 100);
};
const filasValor = (h: string, iniciales: string[]) => iniciales.map((i) => celdas(h, i)!).map((c) => c[5]);

describe("B95-19 · el ajuste de redondeo ya no es una fila del documento del cliente", () => {
  for (const [nombre, ajuste] of [["positivo", 1_000], ["negativo", -1_000]] as const) {
    test(`ajuste ${nombre} (${ajuste}): ninguna fila «${ETIQUETA_AJUSTE_CLIENTE}»; la tarifa del adulto lo incluye y la del niño NO cambia`, () => {
      const h = html([...base, item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, ajuste, 0)]);
      const t = plano(h);
      assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null, "no hay fila de ajuste");
      assert.equal(t.includes("redondeo"), false, "ni «Ajuste por redondeo» ni ningún texto de redondeo");
      assert.equal(t.includes("reparto del hotel"), false, "ningún texto interno en el documento de cliente");
      const fila = celdas(h, "1 hab Doble")!;
      // 2 adultos reciben ajuste/2 cada uno: 1.000.000 ± 500.
      const tarifa = (1_000_000 + ajuste / 2).toLocaleString("es-CO");
      assert.ok(fila[3].replace(/[^0-9.]/g, "") === tarifa, `tarifa por adulto ${tarifa} (fila: ${fila.join(" | ")})`);
      assert.equal(centavos(fila[5]), (2_000_000 + ajuste) * 100, "valor total de la fila de adultos");
      const nino = celdas(h, "Niño 1")!;
      assert.equal(centavos(nino[4]), 751_000 * 100, "la tarifa REAL del niño no cambia");
      assert.equal(centavos(nino[5]), 751_000 * 100);
    });
    test(`ajuste ${nombre}: el total impreso y la suma EXACTA de las filas (2.751.000 ${ajuste < 0 ? "−" : "+"} 1.000)`, () => {
      const esperado = 2_751_000 + ajuste;
      const h = html([...base, item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, ajuste, 0)]);
      const t = plano(h);
      assert.match(t, new RegExp(`TOTAL[^$]*\\$\\s?${esperado.toLocaleString("es-CO").replace(/\./g, "\\.")}`, "i"), "el total impreso es el guardado");
      const suma = filasValor(h, ["1 hab Doble", "Niño 1"]).reduce((s, v) => s + centavos(v), 0);
      assert.equal(suma, esperado * 100, "las filas visibles suman el total guardado, sin tolerancia");
    });
  }

  test("B95-18 (COP): 2 adultos + niño real 150.000, residuo −1 → tarifa de adulto $715.227,50 (no un reparto 715.228/715.227), total de la fila $1.430.455, suma 1.580.455", () => {
    const h = html([item(1, "PAQUETE TURÍSTICO A CARTAGENA DEL 01/03/2030 AL 04/03/2030", 2, 1, 715_228, 150_000), item(2, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, -1, 0)], false);
    const fila = celdas(h, "PAQUETE TURÍSTICO")!;
    assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null);
    assert.deepEqual([fila[1], fila[2]], ["2", "1"]);
    assert.match(fila[3], /^\$\s?715\.227,50$/, `tarifa adulto exacta: ${fila[3]}`);
    assert.doesNotMatch(fila[3], /×/, "no se muestra un reparto entre dos tarifas de adulto");
    assert.match(fila[4], /^\$\s?150\.000$/, "tarifa REAL del niño");
    // la fila agrupa adultos y niño: 2 × 715.227,50 + 150.000 = 1.580.455
    assert.equal(centavos(fila[5]), 1_580_455 * 100);
    assert.ok(plano(h).includes("Total del contrato $ 1.580.455") || plano(h).includes("Total del contrato $1.580.455"));
  });

  test("B95-20 (USD, 3 adultos): residuo USD 0,01 → sin fila de ajuste; el total de la fila es USD 1.582,55; la tarifa de adulto no es de centavos enteros: se imprime con su precisión de cálculo y el total exacto", () => {
    const h = html([item(1, "PAQUETE TURÍSTICO A CARTAGENA DEL 01/03/2030 AL 04/03/2030", 3, 1, 477.33, 150.55), item(2, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, 0.01, 0)], false, "USD");
    const fila = celdas(h, "PAQUETE TURÍSTICO")!;
    assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null);
    assert.match(fila[3], /^USD \$477\.33$/, `tarifa con su precisión de cálculo (${fila[3]})`);
    assert.doesNotMatch(fila[3], /×/, "sin reparto entre tarifas de adulto distintas");
    assert.match(fila[4], /USD \$150\.55/);
    assert.equal(centavos(fila[5]), 158_255, "3 × 477,3333… + 150,55 = 1.582,55 exacto");
    assert.ok(plano(h).includes("USD $1,582.55"), "total impreso");
  });

  test("residuo que NO se reparte en centavos enteros entre filas de adultos (1 y 2 adultos, 1 centavo): nunca se adivina el reparto Y la fila ya NO se muestra (regla incondicional del dueño; Codex 2026-11-26)", () => {
    const items = [item(1, "Doble · A", 1, 0, 100, 0), item(2, "Doble · B", 2, 0, 90, 0), item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, 0.01, 0)];
    const r = absorberAjusteRedondeo(items);
    assert.equal(r.absorbido, false);
    assert.equal(r.sinReparto, true);
    assert.equal(r.items.length, 2);
    const h = html(items, false, "USD");
    assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null, "la fila de ajuste nunca aparece; el documento omite los importes por fila y deja el total guardado");
  });

  test("varias filas de adultos con residuo repartible (2 + 2 adultos, −2 pesos): cada adulto −0,5 y las filas suman el total exacto", () => {
    const items = [item(1, "Doble · A", 2, 0, 500_000, 0), item(2, "Doble · B", 2, 0, 400_000, 0), item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, -2, 0)];
    const r = absorberAjusteRedondeo(items);
    assert.equal(r.absorbido, true);
    const h = html(items, false);
    assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null);
    const suma = filasValor(h, ["Doble · A", "Doble · B"]).reduce((s, v) => s + centavos(v), 0);
    assert.equal(suma, 1_800_000 * 100 - 200);
    assert.match(celdas(h, "Doble · A")![3], /499\.999,50/);
  });

  test("sin ajuste el documento es el de siempre; una fila de otro tipo con texto parecido NO se pliega ni se oculta", () => {
    const h = html([...base, item(3, "Ajuste de redondeo del paquete", 1, 0, 500, 0)]);
    assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null);
    const otra = celdas(h, "Ajuste de redondeo del paquete");
    assert.ok(otra && otra[1] === "1", "solo la constante exacta se pliega; cualquier otra fila conserva sus columnas");
    assert.equal(celdas(html(base), ETIQUETA_AJUSTE_CLIENTE), null);
    assert.equal(absorberAjusteRedondeo(base).absorbido, false);
  });
  test("el reconocimiento es por la constante ÚNICA (igualdad exacta)", () => {
    assert.equal(esLineaAjusteRedondeo(DESCRIPCION_AJUSTE_REDONDEO), true);
    assert.equal(esLineaAjusteRedondeo(ETIQUETA_AJUSTE_CLIENTE), false);
    assert.equal(esLineaAjusteRedondeo(undefined), false);
    assert.equal(esLineaAjusteRedondeo("ajuste de redondeo del reparto del hotel"), false);
  });
  test("lo mismo en el documento del CONTRATO (no cotización)", () => {
    const h = html([...base, item(3, DESCRIPCION_AJUSTE_REDONDEO, 1, 0, 1_000, 0)], false);
    assert.equal(celdas(h, ETIQUETA_AJUSTE_CLIENTE), null);
    assert.equal(plano(h).includes("redondeo"), false);
    assert.equal(centavos(celdas(h, "1 hab Doble")![5]), 2_001_000 * 100);
  });
});
