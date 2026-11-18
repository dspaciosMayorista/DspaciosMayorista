// Owner correction batch 2026-11-18, items 2 and 5 (pure helpers). Presentation only: stored items, totals and payments are never changed.
//   · pagadoEnMonedaOferta: USD 1000 offer, COP collection at the frozen TRM 4100, COP 1.230.000 paid => USD 300 paid / USD 700 balance.
//   · plegarNinoGratisItems: the signed «Niño gratis por habitación» line is folded into the payable tariff of the child it belongs to (sum preserved).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cobroDeVenta, pagadoEnMonedaOferta } from "../lib/finanzas/cobro.ts";
import { descripcionClienteNinoGratis, esExplicacionNinoGratis, plegarNinoGratisItems } from "../lib/contrato/plegarNinoGratis.ts";
import { esLineaNinoGratis as esLineaNinoGratisTest } from "../lib/reservar/ninoGratisLinea.ts";
import { totalVisibleContratoItems } from "../lib/contrato/valorContratoItem.ts";

describe("pagadoEnMonedaOferta (documentos de cliente en la moneda de la oferta)", () => {
  const cobro = cobroDeVenta({ moneda: "USD", precio_venta: 1000, moneda_cobro: "COP", trm_cobro: 4100, total_cobro: 4_100_000 });
  test("ejemplo del dueño: COP 1.230.000 a TRM 4100 = USD 300 pagados y USD 700 de saldo", () => {
    const pagado = pagadoEnMonedaOferta(1_230_000, cobro);
    assert.equal(pagado, 300);
    assert.equal(cobro.precioOferta - pagado, 700);
  });
  test("sin pagos = 0; el total a cobrar completo = la oferta completa (sin saldo ni exceso fantasma por el redondeo al mil)", () => {
    assert.equal(pagadoEnMonedaOferta(0, cobro), 0);
    assert.equal(pagadoEnMonedaOferta(4_100_000, cobro), 1000);
    assert.equal(pagadoEnMonedaOferta(4_500_000, cobro), 1000);
  });
  test("pagos parciales con cálculo a mano: 615.000/4100 = USD 150; 1.000.000/4100 = USD 243,90; un peso menos que el total nunca muestra la oferta completa", () => {
    assert.equal(pagadoEnMonedaOferta(615_000, cobro), 150);
    assert.equal(pagadoEnMonedaOferta(1_000_000, cobro), 243.9); // 243,9024… a centavos
    assert.equal(pagadoEnMonedaOferta(4_099_999, cobro), 999.99, "4.099.999/4100 = 999,99976 se redondearía a 1000,00: se limita para que el saldo no sea 0 con dinero pendiente");
  });
  test("caso inverso (oferta COP, cobro USD) multiplica por la TRM congelada; sin conversión no toca nada", () => {
    const inverso = cobroDeVenta({ moneda: "COP", precio_venta: 4_100_000, moneda_cobro: "USD", trm_cobro: 4100, total_cobro: 1000 });
    assert.equal(pagadoEnMonedaOferta(300, inverso), 1_230_000);
    const misma = cobroDeVenta({ moneda: "USD", precio_venta: 1000 });
    assert.equal(pagadoEnMonedaOferta(250, misma), 250);
  });
});

type It = { id: number; descripcion: string; modo_precio: string; valor_total: number | null; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number };
const base = { modo_precio: "por_persona", valor_total: null };
const fila = (id: number, descripcion: string, adultos: number, ninos: number, tarifa_adulto: number, tarifa_nino: number): It => ({ ...base, id, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino });
const ng = (id: number, importe: number, partes: string, prefijo = "") => fila(id, `${prefijo}Niño gratis por habitación · PRE BF (${partes})`, 1, 0, -importe, 0);
const suma = (items: readonly It[]) => Math.round(totalVisibleContratoItems(items) * 100) / 100;

describe("plegarNinoGratisItems: el beneficio entra en la tarifa del niño, el niño en cero va en la fila del paquete y la suma no cambia", () => {
  test("DTM-0003 (C1): UNA fila de paquete con 2 adultos y el niño en 0; total 1.464.000", () => {
    const items = [fila(1, "1 hab Doble (2 pax) · Estandar / PAM", 2, 0, 732_000, 0), fila(2, "Niño 1 · Estandar / PAM", 0, 1, 0, 293_000), ng(3, 293_000, "hab. 1: niño de 8 años (Niño 1)")];
    const { items: out, plegado } = plegarNinoGratisItems(items);
    assert.equal(plegado, true);
    assert.equal(suma(out), 1_464_000);
    assert.equal(suma(out), suma(items));
    assert.equal(out.length, 1, "UNA sola fila: ni línea negativa ni fila de niño aparte");
    assert.deepEqual([out[0].adultos, out[0].ninos, out[0].tarifa_adulto, out[0].tarifa_nino, out[0].ninoGratisFusionado], [2, 1, 732_000, 0, true]);
    assert.equal(out[0].descripcion, "1 hab Doble (2 pax) · Estandar / PAM");
    assert.ok(out.every((i) => !/PRE BF|por habitación|\(hab\./.test(i.descripcion)), "ni promoción ni cálculo");
  });
  test("DTM-0004 (C1): UNA fila, 2 adultos a 180.000 y el niño (Niño 2) en 0; total 360.000", () => {
    const items = [fila(1, "1 hab Doble (2 pax) · Estandar / PAM", 2, 0, 180_000, 0), fila(2, "Niño 2 · Estandar / PAM", 0, 1, 0, 150_000), ng(3, 150_000, "hab. 1: niño de 10 años (Niño 2)")];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), 360_000);
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].adultos, out[0].ninos, out[0].tarifa_nino, out[0].ninoGratisFusionado], [2, 1, 0, true]);
  });
  test("C-0005 (C1): DOS filas — adultos + el niño gratis (1.464.000) y el niño que paga 293.000 (genuinamente otra tarifa); total 1.757.000", () => {
    const items = [fila(1, "1 hab Doble (2 pax) · Estandar / PAM", 2, 0, 732_000, 0), fila(2, "Niño 1 · Estandar / PAM", 0, 2, 0, 293_000), ng(3, 293_000, "hab. 1: niño de 8 años (Niño 1)")];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), 1_757_000);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((i) => [i.adultos, i.ninos, i.tarifa_adulto, i.tarifa_nino]), [[2, 1, 732_000, 0], [0, 1, 0, 293_000]]);
    assert.equal(out[0].ninoGratisFusionado, true);
    assert.equal(out[1].ninoGratisFusionado, undefined, "el que paga no es «Niño gratis»");
    assert.equal(out[1].descripcion, "Niño 1 · Estandar / PAM");
  });
  test("dos habitaciones con la misma tarifa de adulto: UNA fila (4 adultos, 2 niños en 0) — mismo total", () => {
    const items = [fila(1, "2 hab Doble (4 pax) · Estandar / PAM", 4, 0, 100_000, 0), fila(2, "Niño 1 · Estandar / PAM", 0, 2, 0, 60_000), ng(3, 120_000, "hab. 1: niño de 7 años (Niño 1); hab. 2: niño de 9 años (Niño 1)")];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), 400_000); // 4 × 100.000 + 2 × 0
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].adultos, out[0].ninos, out[0].tarifa_nino, out[0].ninoGratisFusionado], [4, 2, 0, true]);
  });
  test("dos habitaciones con tarifas de adulto DISTINTAS: el niño gratis no se adivina en una habitación — fila propia «Niño gratis» (0), adultos intactos", () => {
    const items = [
      fila(1, "1 hab Doble (2 pax) · Estandar / PAM", 2, 0, 100_000, 0), fila(2, "1 hab Triple (3 pax) · Estandar / PAM", 3, 0, 90_000, 0),
      fila(3, "Niño 1 · Estandar / PAM", 0, 1, 0, 50_000), ng(4, 50_000, "hab. 2: niño de 6 años (Niño 1)"),
    ];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), 470_000); // 2×100.000 + 3×90.000
    assert.equal(out.length, 3, "dos filas de adultos + la fila del niño gratis");
    assert.ok(out.slice(0, 2).every((i) => i.ninos === 0 && !i.ninoGratisFusionado));
    assert.deepEqual([out[2].ninos, out[2].tarifa_nino, out[2].descripcion], [1, 0, "Niño gratis · Estandar / PAM"]);
  });
  test("niño con beneficio PARCIAL (paga el resto de la estadía): su tarifa baja a 94.000, no se rotula gratis y no se une a la fila de adultos", () => {
    const items = [fila(1, "1 hab Doble (2 pax) · Estandar / PAM", 2, 0, 694_000, 0), fila(2, "Niño 1 · Estandar / PAM", 0, 1, 0, 347_000), ng(3, 253_000, "hab. 1: niño de 8 años (Niño 1)")];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), 1_482_000);
    assert.equal(out.length, 2);
    const nino = out.find((i) => i.ninos > 0 && i.adultos === 0)!;
    assert.equal(nino.tarifa_nino, 94_000);
    assert.equal(nino.descripcion, "Niño 1 · Estandar / PAM");
    assert.equal(nino.ninoGratisFusionado, undefined);
    assert.equal(nino.tarifaNinoNoAtribuible, undefined, "un solo niño beneficiado: su tarifa SÍ es atribuible");
  });
  test("C2: dos niños (dos habitaciones) con beneficio PARCIAL de 50.000 sobre 2 × 100.000 — sin fila negativa: UNA fila de grupo por 150.000, sin tarifa por niño ni promedio", () => {
    const items = [fila(1, "2 hab Doble (4 pax) · Estandar / PAM", 4, 0, 200_000, 0), fila(2, "Niño 1 · Estandar / PAM", 0, 2, 0, 100_000), ng(3, 50_000, "hab. 1: niño de 8 años (Niño 1); hab. 2: niño de 9 años (Niño 1)")];
    const { items: out, plegado } = plegarNinoGratisItems(items);
    assert.equal(plegado, true);
    assert.equal(suma(out), 800_000 + 150_000, "4 × 200.000 + (2 × 100.000 − 50.000)");
    assert.equal(suma(out), suma(items));
    assert.ok(out.every((i) => !esLineaNinoGratisTest(i.descripcion) && Number(i.adultos) * Number(i.tarifa_adulto) >= 0), "ningún importe negativo ni línea firmada");
    const grupo = out.find((i) => i.tarifaNinoNoAtribuible)!;
    assert.deepEqual([grupo.adultos, grupo.ninos, Math.round(grupo.ninos * grupo.tarifa_nino)], [0, 2, 150_000]);
    assert.equal(grupo.descripcion, "Niño 1 · Estandar / PAM");
  });
  test("C2: de tres niños de la clase, dos con beneficio parcial: el tercero conserva su fila y tarifa completa; el grupo vale Σ − beneficio", () => {
    const items = [fila(1, "2 hab Doble · E / P", 4, 0, 100_000, 0), fila(2, "Niño 1 · E / P", 0, 3, 0, 50_000), ng(3, 60_000, "hab. 1: niño (Niño 1); hab. 2: niño (Niño 1)")];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), 400_000 + 150_000 - 60_000);
    const completo = out.find((i) => i.ninos === 1 && !i.tarifaNinoNoAtribuible)!;
    assert.equal(completo.tarifa_nino, 50_000, "el niño sin beneficio paga su tarifa completa");
    const grupo = out.find((i) => i.tarifaNinoNoAtribuible)!;
    assert.deepEqual([grupo.ninos, Math.round(grupo.ninos * grupo.tarifa_nino)], [2, 40_000]);
  });
  test("carrito con varios hoteles: el prefijo del hotel enlaza cada línea con SUS niños (cada hotel tiene su fila de paquete)", () => {
    const items = [
      fila(1, "Hotel A · 1 hab Doble (2 pax) · Est / PAM", 2, 0, 100_000, 0), fila(2, "Hotel A · Niño 1 · Est / PAM", 0, 1, 0, 50_000), ng(3, 50_000, "hab. 1: niño de 7 años (Niño 1)", "Hotel A · "),
      fila(4, "Hotel B · 1 hab Doble (2 pax) · Est / PAM", 2, 0, 80_000, 0), fila(5, "Hotel B · Niño 1 · Est / PAM", 0, 1, 0, 40_000),
    ];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), suma(items));
    const a = out.find((i) => i.descripcion.startsWith("Hotel A · 1 hab"))!;
    assert.deepEqual([a.adultos, a.ninos, a.tarifa_nino, a.ninoGratisFusionado], [2, 1, 0, true], "el niño gratis del hotel A está en SU fila de paquete");
    assert.ok(!out.some((i) => i.descripcion.startsWith("Hotel A · Niño")), "el hotel A ya no tiene fila de niño aparte");
    assert.equal(out.find((i) => i.descripcion === "Hotel B · Niño 1 · Est / PAM")!.tarifa_nino, 40_000, "el otro hotel no se toca");
    assert.equal(out.find((i) => i.descripcion.startsWith("Hotel B · 1 hab"))!.ninoGratisFusionado, undefined);
  });
  test("niño 1 y niño 2 gratis a la vez: solo se atribuye si ambos quedan en 0 y los dos entran en la fila del paquete", () => {
    const items = [fila(1, "1 hab Doble · E / P", 2, 0, 100_000, 0), fila(2, "Niño 1 · E / P", 0, 1, 0, 50_000), fila(3, "Niño 2 · E / P", 0, 1, 0, 30_000), ng(4, 80_000, "hab. 1: niño (Niño 1); hab. 2: niño (Niño 2)")];
    const { items: out, plegado } = plegarNinoGratisItems(items);
    assert.equal(plegado, true);
    assert.equal(suma(out), 200_000);
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].adultos, out[0].ninos, out[0].tarifa_nino], [2, 2, 0]);
  });
  test("niño 1 y niño 2 con beneficio parcial mezclado: UNA fila de grupo «Niños» (Σ tarifas − beneficio), sin tarifa por niño y sin fila negativa", () => {
    const items = [fila(1, "1 hab Doble · E / P", 2, 0, 100_000, 0), fila(2, "Niño 1 · E / P", 0, 1, 0, 50_000), fila(3, "Niño 2 · E / P", 0, 1, 0, 30_000), ng(4, 40_000, "hab. 1: niño (Niño 1); hab. 2: niño (Niño 2)")];
    const { items: out } = plegarNinoGratisItems(items);
    assert.equal(suma(out), 200_000 + 80_000 - 40_000);
    const grupo = out.find((i) => i.tarifaNinoNoAtribuible)!;
    assert.deepEqual([grupo.ninos, Math.round(grupo.ninos * grupo.tarifa_nino), grupo.descripcion], [2, 40_000, "Niños · E / P"]);
    assert.ok(!out.some((i) => Number(i.adultos) * Number(i.tarifa_adulto) < 0));
  });
  test("lo inconsistente NO se inventa: si lo condonado supera lo que pagarían los niños nombrados, o falta su fila, la línea se conserva (rótulo «Niño gratis») y la suma sigue igual", () => {
    const supera = [fila(1, "1 hab Doble · E / P", 2, 0, 100_000, 0), fila(2, "Niño 1 · E / P", 0, 2, 0, 50_000), ng(3, 120_000, "hab. 1: niño (Niño 1); hab. 2: niño (Niño 1)")];
    const r1 = plegarNinoGratisItems(supera);
    assert.equal(r1.plegado, false);
    assert.equal(r1.items.length, supera.length);
    assert.equal(descripcionClienteNinoGratis(r1.items[2].descripcion), "Niño gratis");
    const sinFila = [fila(1, "1 hab Doble · E / P", 2, 0, 100_000, 0), ng(2, 50_000, "hab. 1: niño (Niño 1)")];
    const r2 = plegarNinoGratisItems(sinFila);
    assert.equal(r2.plegado, false);
    assert.equal(suma(r2.items), suma(sinFila));
  });
  test("sin línea de niño gratis no cambia nada; descripciones y explicaciones", () => {
    const items = [fila(1, "1 hab Doble · E / P", 2, 0, 100_000, 0)];
    assert.deepEqual(plegarNinoGratisItems(items), { items, plegado: false });
    assert.equal(descripcionClienteNinoGratis("1 hab Doble"), "1 hab Doble");
    assert.equal(esExplicacionNinoGratis("Niño gratis de «PRE BF»: habitación 1, niño de 8 años, tarifa Niño 1."), true);
    assert.equal(esExplicacionNinoGratis("Mínimo 2 noches"), false);
  });
});

// Forma REAL persistida (DTM-0001 NETO, 2026-11-18): la línea firmada lleva el hotel delante y las filas de niño NO.
describe("plegarNinoGratisItems: línea firmada con el hotel delante y filas de niño sin prefijo (forma real de Reservar/conversión)", () => {
  const real = () => [
    fila(1, "1 hab Doble (2 pax) · Estandar / PAM", 2, 0, 732_000, 0), fila(2, "Niño 1 · Estandar / PAM", 0, 1, 0, 366_000), fila(3, "Niño 2 · Estandar / PAM", 0, 1, 0, 293_000),
    fila(4, "Hotel PRE BF 125 ACTIVO · Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño 1))", 1, 0, -366_000, 0),
  ];
  test("se encuentra la única fila de la clase sin prefijo: UNA fila de adultos + niño gratis y el niño que paga; Σ = 1.757.000", () => {
    const { items: out, plegado } = plegarNinoGratisItems(real());
    assert.equal(plegado, true);
    assert.equal(suma(out), 1_757_000);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((i) => [i.adultos, i.ninos, i.tarifa_nino]), [[2, 1, 0], [0, 1, 293_000]]);
    assert.ok(!out.some((i) => Number(i.adultos) * Number(i.tarifa_adulto) < 0), "sin fila negativa");
  });
  test("con VARIAS filas de esa clase sin prefijo no se adivina cuál es: la línea se conserva", () => {
    const items = [...real().slice(0, 3), fila(5, "Niño 1 · Otra / PC", 0, 1, 0, 100_000), real()[3]];
    const { plegado, items: out } = plegarNinoGratisItems(items);
    assert.equal(plegado, false);
    assert.equal(suma(out), suma(items));
  });
});

// Mínimo para confirmar en moneda del contrato (documento de cliente): cálculo a mano, independiente del helper.
import { textoMinimoEnMonedaOferta } from "../lib/contrato/reglaConfirmacion.ts";
test("textoMinimoEnMonedaOferta: COP→USD con la TRM de cobro congelada, redondeo hacia arriba al centavo, y sin cambio cuando no aplica", () => {
  const cobro = { moneda: "COP" as const, monedaOferta: "USD" as const, convertido: true, trm: 4100 };
  const t = "Pago mínimo para confirmar: $1.230.000 COP (mínimo acordado)";
  const r = (minimo: number, moneda: "COP" | "USD" = "COP") => ({ regla: "acuerdo" as const, minimo, moneda, trm: null });
  // 1.230.000 / 4.100 = 300 exacto
  assert.equal(textoMinimoEnMonedaOferta(t, r(1_230_000), cobro), "Pago mínimo para confirmar: $300 USD (mínimo acordado)");
  // 1.000.000 / 4.100 = 243,9024… → 243,91 (hacia arriba: nunca menos de lo exigido); formato es-CO con coma decimal
  assert.equal(textoMinimoEnMonedaOferta(t, r(1_000_000), cobro), "Pago mínimo para confirmar: $243,91 USD (mínimo acordado)");
  // no aplica: sin conversión, sin TRM, misma moneda, regla en otra moneda, texto que no es el del mínimo, sin regla
  assert.equal(textoMinimoEnMonedaOferta(t, r(1_230_000), { ...cobro, convertido: false }), t);
  assert.equal(textoMinimoEnMonedaOferta(t, r(1_230_000), { ...cobro, trm: null }), t);
  assert.equal(textoMinimoEnMonedaOferta(t, r(300, "USD"), cobro), t);
  assert.equal(textoMinimoEnMonedaOferta("Pago mínimo requerido: $1.230.000 COP", r(1_230_000), cobro), "Pago mínimo requerido: $1.230.000 COP");
  assert.equal(textoMinimoEnMonedaOferta(t, null, cobro), t);
});
