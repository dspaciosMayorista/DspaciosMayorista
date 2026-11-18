// Se ejecuta con npm run test:react (loader del arnés).
//
// Corrección del dueño 2026-11-18 (documentos de CLIENTE, componentes REALES):
//   · USD con cobro en COP: sin tarjeta «Total a cobrar»; pagado y saldo en USD con la TRM de cobro congelada (USD 1000, TRM 4100, COP 1.230.000 pagados => USD 300 / USD 700);
//   · confirmado: no se imprime el mínimo para confirmar (las condiciones congeladas se conservan); pendiente: se imprime como siempre;
//   · niño gratis: DTM-0003 (1.464.000), DTM-0004 (360.000) y C-0005 (1.757.000, un niño gratis + otro que paga 293.000) con totales intactos, «Niño gratis» solo en el niño sin costo,
//     sin nombre de promoción ni cálculo en el contrato; en NETO la fila también se pliega; con resumen congelado la fila del niño gratis se rotula igual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { cobroDeVenta } = await import("../lib/finanzas/cobro.ts");
const { formatMoneda } = await import("../lib/utils.ts");

const NBSP = new RegExp(String.fromCharCode(160), "g");
const limpiar = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(NBSP, " ").replace(/\s+/g, " ");
const cop = (n: number) => formatMoneda(n, "COP").replace(NBSP, " ");
const usd = (n: number) => formatMoneda(n, "USD").replace(NBSP, " ");

const ventaBase = {
  numero_contrato: "DTM-0005", cliente: "Cliente Prueba", cliente_documento: "1", cliente_direccion: null, cliente_telefono: null,
  asesor: "Asesor", asesor_firma_nombre: "Asesor", asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null,
  estado: "confirmado", fecha_emision: "2026-11-18", fecha_salida: "2027-06-10", pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null,
  moneda: "COP", tenant: "mayorista", tipo_asesor: "interno", agencia_nombre: null, freelance_nombre: null,
};
const base = { numero_contrato: "X", modo_precio: "por_persona", valor_total: null };
const doc = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(ContratoDocumento, { agencia: AGENCIA_PRUEBA, pasajeros: [], hoteles: [], vuelos: [], totalPagado: 0, ...extra } as never));
// ── USD con cobro en COP ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ventaUsd = { ...ventaBase, moneda: "USD", precio_venta: 1000, moneda_cobro: "COP", trm_cobro: 4100, total_cobro: 4_100_000 };
const itemsUsd = [{ ...base, id: 1, descripcion: "Paquete Cartagena", adultos: 2, ninos: 0, tarifa_adulto: 500, tarifa_nino: 0, orden: 0 }];

test("USD con cobro en COP: sin «Total a cobrar»; pagado USD 300 y saldo USD 700 con la TRM congelada (COP 1.230.000 / 4100)", () => {
  const t = limpiar(doc({ venta: ventaUsd, items: itemsUsd, totalPagado: 1_230_000, cobro: cobroDeVenta(ventaUsd) }));
  assert.ok(!t.includes("Total a cobrar"), "la tarjeta en COP desaparece del documento de cliente");
  assert.ok(t.includes(`Total del contrato ${usd(1000)}`));
  assert.ok(t.includes(`Total pagado ${usd(300)}`), t.slice(t.indexOf("Valores y Pagos"), t.indexOf("Valores y Pagos") + 260));
  assert.ok(t.includes(`Saldo pendiente ${usd(700)}`));
  assert.ok(!t.includes(cop(4_100_000)) && !t.includes(cop(1_230_000)), "ningún importe en COP en el documento");
});

test("USD con cobro en COP: sin pagos el saldo es la oferta; con el total a cobrar completo el saldo es 0", () => {
  const sin = limpiar(doc({ venta: ventaUsd, items: itemsUsd, totalPagado: 0, cobro: cobroDeVenta(ventaUsd) }));
  assert.ok(sin.includes(`Total pagado ${usd(0)}`) && sin.includes(`Saldo pendiente ${usd(1000)}`));
  const todo = limpiar(doc({ venta: ventaUsd, items: itemsUsd, totalPagado: 4_100_000, cobro: cobroDeVenta(ventaUsd) }));
  assert.ok(todo.includes(`Total pagado ${usd(1000)}`) && todo.includes(`Saldo pendiente ${usd(0)}`));
});

test("USD en NETO (total exigible 900): pagado convertido y saldo contra el total exigible, en USD", () => {
  const t = limpiar(doc({ venta: ventaUsd, items: itemsUsd, totalPagado: 1_230_000, cobro: cobroDeVenta(ventaUsd), netoTotalExigible: 900 }));
  assert.ok(!t.includes("Total a cobrar"));
  assert.ok(t.includes(`Total pagado ${usd(300)}`));
  assert.ok(t.includes(`Saldo pendiente ${usd(600)}`));
});

// ── Mínimo para confirmar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const condiciones = {
  hayCondiciones: true, moneda: "COP", huboRestriccionOriginal: false, restringidas: [], minimoAcordado: null, minimoNoVerificable: false,
  filas: [{ key: "k1", referencia: "Hotel Demo", nombreComponente: "hotel", condicionTexto: "Anticipo + saldo", condicionDetalle: null, fechaLimite: null, exigido: 300_000, moneda: "COP" }],
  resumen: { montoMinimoExigidoTotal: 300_000, pctEfectivoInformativo: 30, texto: "Pago mínimo requerido: $300.000 COP (30 % informativo)", minimoConfirmar: null },
};
const ventaCop = { ...ventaBase, precio_venta: 1_000_000 };
const itemsCop = [{ ...base, id: 1, descripcion: "Paquete", adultos: 2, ninos: 0, tarifa_adulto: 500_000, tarifa_nino: 0, orden: 0 }];

test("confirmado: no se imprime el mínimo para confirmar, pero las condiciones congeladas siguen; pendiente: se imprime como siempre", () => {
  const conf = limpiar(doc({ venta: ventaCop, items: itemsCop, condiciones }));
  assert.ok(!/Pago mínimo/.test(conf), "sin columna ni texto de mínimo");
  assert.ok(conf.includes("Condiciones de pago") && conf.includes("Hotel Demo") && conf.includes("Anticipo + saldo"), "las condiciones congeladas se conservan");
  const pen = limpiar(doc({ venta: { ...ventaCop, estado: "pendiente" }, items: itemsCop, condiciones }));
  assert.ok(pen.includes("Pago mínimo requerido: $300.000 COP"));
  assert.ok(/Pago mínimo/.test(pen) && pen.includes(cop(300_000)), "pendiente conserva columna y valor");
});

// ── Niño gratis ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const itemsNg = (tarifaAdulto: number, tarifaNino: number, ninos: number, condonado: number, nc = 1) => [
  { ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 0, tarifa_adulto: tarifaAdulto, tarifa_nino: 0, orden: 0 },
  { ...base, id: 2, descripcion: `Niño ${nc} · Estandar / PAM`, adultos: 0, ninos, tarifa_adulto: 0, tarifa_nino: tarifaNino, orden: 1 },
  { ...base, id: 3, descripcion: `Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño ${nc}))`, adultos: 1, ninos: 0, tarifa_adulto: -condonado, tarifa_nino: 0, orden: 203 },
];
const hotelConExplicacion = {
  id: 1, numero_contrato: "X", nombre: "Hotel Demo", categoria: "Estandar", ciudad: "CARTAGENA", alimentacion: "PAM", acomodacion: "Doble", detalle_acomodacion: null,
  fecha_ingreso: "2027-06-10", fecha_salida: "2027-06-13", proveedor: null, orden: 0, nota_regimen: null, foto_url: null,
  condiciones_tarifa: [{ temporada: "PRE BF", texto: "Niño gratis de «PRE BF»: habitación 1, niño de 8 años, tarifa Niño 1." }],
};

// Filas de VALOR de la tabla «Ítem · Adultos · Niños · Tarifa Adulto · Tarifa Niño · Valor total» (lo que el cliente cuenta): cada celda como texto.
const filasTabla = (html: string) => {
  const tabla = html.split("<table").find((x) => x.includes("Tarifa Adulto")) ?? "";
  return [...tabla.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => limpiar(c[1]).trim())).filter((f) => f.length > 0);
};
const numES = (s: string) => Number(s.replace(/[^0-9,]/g, "").replace(",", ".")); // «$ 1.380.676,15» → 1380676.15
const SIN_PROMO = /PRE BF|PROMO|por habitación|Niño gratis de «|\(hab\.|-\s?\$/;

test("DTM-0003 (1.464.000) y DTM-0004 (360.000): UNA fila de paquete con 2 adultos y el niño en 0 («Niño gratis»); total intacto, sin promoción ni cálculo", () => {
  for (const [tarifaAdulto, tarifaNino, total, nc] of [[732_000, 293_000, 1_464_000, 1], [180_000, 150_000, 360_000, 2]] as const) {
    const html = doc({ venta: ventaCop, items: itemsNg(tarifaAdulto, tarifaNino, 1, tarifaNino, nc), hoteles: [hotelConExplicacion] });
    const t = limpiar(html);
    assert.ok(t.includes(`Total del contrato ${cop(total)}`), `total ${total}`);
    const filas = filasTabla(html);
    assert.equal(filas.length, 1, `${total}: UNA sola fila de valor (obtenidas ${filas.length}: ${JSON.stringify(filas)})`);
    assert.ok(filas[0][0].startsWith("1 hab Doble (2 pax)"), "la fila es la del paquete");
    assert.deepEqual(filas[0].slice(1), ["2", "1", cop(tarifaAdulto), "Niño gratis", cop(total)], "adultos 2 · niños 1 · tarifa adulto · tarifa niño «Niño gratis» · valor = total");
    assert.doesNotMatch(t, SIN_PROMO, "ni nombre de promoción ni cálculo ni importes negativos");
    assert.doesNotMatch(html, /-\s?\$/, "ningún importe negativo");
  }
});

test("C-0005 (1.757.000): DOS filas — adultos + el niño gratis (1.464.000) y el niño que paga 293.000 (cotización y contrato)", () => {
  for (const extra of [{}, { esCotizacion: true, codigo: "C-0005" }]) {
    const html = doc({ ...extra, venta: ventaCop, items: itemsNg(732_000, 293_000, 2, 293_000) });
    assert.ok(limpiar(html).includes(`Total del contrato ${cop(1_757_000)}`));
    const filas = filasTabla(html);
    assert.equal(filas.length, 2, `dos filas de valor (obtenidas ${filas.length}: ${JSON.stringify(filas)})`);
    assert.deepEqual(filas[0].slice(1), ["2", "1", cop(732_000), "Niño gratis", cop(1_464_000)], "fila del paquete: 2 adultos + el niño gratis");
    assert.deepEqual([filas[1][1], filas[1][2], filas[1][4], filas[1][5]], ["0", "1", cop(293_000), cop(293_000)], "el niño que paga conserva SU tarifa");
    assert.equal(filas.filter((f) => f.includes("Niño gratis")).length, 1, "«Niño gratis» una sola vez");
    assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_757_000, "las filas suman el total");
  }
});

test("dos habitaciones, misma tarifa de adulto: UNA fila (4 adultos, 2 niños en 0); total 4 × 100.000 = 400.000", () => {
  const items = [
    { ...base, id: 1, descripcion: "2 hab Doble (4 pax) · Estandar / PAM", adultos: 4, ninos: 0, tarifa_adulto: 100_000, tarifa_nino: 0, orden: 0 },
    { ...base, id: 2, descripcion: "Niño 1 · Estandar / PAM", adultos: 0, ninos: 2, tarifa_adulto: 0, tarifa_nino: 60_000, orden: 1 },
    { ...base, id: 3, descripcion: "Niño gratis por habitación · PRE BF (hab. 1: niño de 7 años (Niño 1); hab. 2: niño de 9 años (Niño 1))", adultos: 1, ninos: 0, tarifa_adulto: -120_000, tarifa_nino: 0, orden: 203 },
  ];
  const html = doc({ venta: { ...ventaCop, precio_venta: 400_000 }, items });
  const filas = filasTabla(html);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].slice(1), ["4", "2", cop(100_000), "Niño gratis", cop(400_000)]);
  assert.ok(limpiar(html).includes(`Total del contrato ${cop(400_000)}`));
  assert.doesNotMatch(limpiar(html), SIN_PROMO);
});

test("dos habitaciones con tarifas de adulto DISTINTAS: el niño gratis no se adivina — dos filas de adultos intactas + UNA fila «Niño gratis» en 0; total 470.000", () => {
  const items = [
    { ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 0, tarifa_adulto: 100_000, tarifa_nino: 0, orden: 0 },
    { ...base, id: 2, descripcion: "1 hab Triple (3 pax) · Estandar / PAM", adultos: 3, ninos: 0, tarifa_adulto: 90_000, tarifa_nino: 0, orden: 1 },
    { ...base, id: 3, descripcion: "Niño 1 · Estandar / PAM", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 50_000, orden: 2 },
    { ...base, id: 4, descripcion: "Niño gratis por habitación · PRE BF (hab. 2: niño de 6 años (Niño 1))", adultos: 1, ninos: 0, tarifa_adulto: -50_000, tarifa_nino: 0, orden: 203 },
  ];
  const html = doc({ venta: { ...ventaCop, precio_venta: 470_000 }, items });
  const filas = filasTabla(html);
  assert.equal(filas.length, 3, `Doble, Triple y la fila del niño gratis (obtenidas ${JSON.stringify(filas)})`);
  assert.deepEqual(filas[0].slice(1), ["2", "0", cop(100_000), cop(0), cop(200_000)]);
  assert.deepEqual(filas[1].slice(1), ["3", "0", cop(90_000), cop(0), cop(270_000)]);
  assert.deepEqual([filas[2][0], filas[2][2], filas[2][4], filas[2][5]], ["Niño gratis · Estandar / PAM", "1", "Niño gratis", cop(0)]);
  assert.ok(limpiar(html).includes(`Total del contrato ${cop(470_000)}`));
  assert.doesNotMatch(html, /-\s?\$/);
});

test("niño con beneficio PARCIAL (347.000 − 253.000 = 94.000): no es «Niño gratis», conserva su propia fila a 94.000 y las filas suman 1.482.000", () => {
  const items = [
    { ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 0, tarifa_adulto: 694_000, tarifa_nino: 0, orden: 0 },
    { ...base, id: 2, descripcion: "Niño 1 · Estandar / PAM", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 347_000, orden: 1 },
    { ...base, id: 3, descripcion: "Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño 1))", adultos: 1, ninos: 0, tarifa_adulto: -253_000, tarifa_nino: 0, orden: 203 },
  ];
  const html = doc({ venta: { ...ventaCop, precio_venta: 1_482_000 }, items });
  const filas = filasTabla(html);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0].slice(1), ["2", "0", cop(694_000), cop(0), cop(1_388_000)], "los adultos NO absorben al niño que todavía paga");
  assert.deepEqual([filas[1][1], filas[1][2], filas[1][4], filas[1][5]], ["0", "1", cop(94_000), cop(94_000)]);
  assert.ok(!limpiar(html).includes("Niño gratis"), "no se rotula gratis");
  assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_482_000);
  assert.doesNotMatch(limpiar(html), SIN_PROMO);
});

test("C2: dos niños en dos habitaciones con beneficio PARCIAL (2 × 100.000 − 50.000): sin fila negativa, UNA fila de grupo por 150.000 sin tarifa por niño; total 950.000", () => {
  const items = [
    { ...base, id: 1, descripcion: "2 hab Doble (4 pax) · Estandar / PAM", adultos: 4, ninos: 0, tarifa_adulto: 200_000, tarifa_nino: 0, orden: 0 },
    { ...base, id: 2, descripcion: "Niño 1 · Estandar / PAM", adultos: 0, ninos: 2, tarifa_adulto: 0, tarifa_nino: 100_000, orden: 1 },
    { ...base, id: 3, descripcion: "Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño 1); hab. 2: niño de 9 años (Niño 1))", adultos: 1, ninos: 0, tarifa_adulto: -50_000, tarifa_nino: 0, orden: 203 },
  ];
  for (const extra of [{}, { esCotizacion: true, codigo: "C-X" }]) {
    const html = doc({ ...extra, venta: { ...ventaCop, precio_venta: 950_000 }, items });
    const filas = filasTabla(html);
    assert.equal(filas.length, 2, `adultos + UNA fila de grupo de niños (obtenidas ${JSON.stringify(filas)})`);
    assert.deepEqual(filas[0].slice(1), ["4", "0", cop(200_000), cop(0), cop(800_000)]);
    assert.deepEqual([filas[1][1], filas[1][2], filas[1][4], filas[1][5]], ["0", "2", "—", cop(150_000)], "grupo: 2 niños, sin tarifa por niño («—»), valor del grupo");
    assert.doesNotMatch(html, /-\s?\$/, "ningún importe negativo");
    assert.doesNotMatch(limpiar(html), SIN_PROMO);
    assert.ok(limpiar(html).includes(`Total del contrato ${cop(950_000)}`));
    assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 950_000);
  }
});

test("NETO (exigible 1.657.000 = PVP 1.757.000 − comisión 100.000): C-0005 en dos filas; las filas NETO suman EXACTO el exigible y el niño gratis se rotula, sin PVP ni comisión", () => {
  const html = doc({ venta: ventaCop, items: itemsNg(732_000, 293_000, 2, 293_000), netoTotalExigible: 1_657_000 });
  const filas = filasTabla(html);
  assert.equal(filas.length, 2);
  assert.equal(filas[0][2], "1");
  assert.equal(filas[0][4], "Niño gratis", "el niño gratis también se rotula en NETO");
  assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_657_000, "Σ filas NETO = exigible");
  // a mano (reparto proporcional al PVP de cada fila): 1.657.000 × 1.464.000 / 1.757.000 = 1.380.676,15 y el resto 276.323,85
  assert.equal(numES(filas[0][5]), 1_380_676.15);
  assert.equal(numES(filas[1][5]), 276_323.85);
  assert.ok(limpiar(html).includes(`Total del contrato ${cop(1_657_000)}`));
  assert.doesNotMatch(limpiar(html), /1\.757\.000|100\.000,00|PRE BF|por habitación/);
  assert.doesNotMatch(html, /-\s?\$/);
  // DTM-0004 en NETO: una sola fila, todo el exigible en el paquete
  const unica = filasTabla(doc({ venta: { ...ventaCop, precio_venta: 360_000 }, items: itemsNg(180_000, 150_000, 1, 150_000, 2), netoTotalExigible: 300_000 }));
  assert.equal(unica.length, 1);
  assert.deepEqual([unica[0][1], unica[0][2], unica[0][4]], ["2", "1", "Niño gratis"]);
  assert.equal(numES(unica[0][5]), 300_000);
});

test("cotización con resumen congelado (sellado por niño): adultos + niño gratis en UNA fila y el niño que paga 293.000 en otra — dos filas, total 1.757.000", () => {
  const resumen = {
    moneda: "COP", version: 1, modalidad: "pvp", totalCentavos: 175_700_000,
    unidades: [{
      ref: "item-0", hotel: "Hotel Demo", regimen: "PAM", categoria: "Estandar", paquete: { id: 1, nombre: null }, totalCentavos: 175_700_000, ajusteCentavos: 0,
      grupos: [
        { tipo: "adulto", cupos: ["a1", "a2"], incluye: [], cantidad: 2, tarifaCentavos: 73_200_000, subtotalCentavos: 146_400_000, tarifaExactaCentavos: 73_200_000 },
        { tipo: "nino", cupos: ["n1"], incluye: [], cantidad: 1, tarifaCentavos: 29_300_000, subtotalCentavos: 29_300_000, tarifaExactaCentavos: 29_300_000 },
        { tipo: "nino", cupos: ["n2"], incluye: [], cantidad: 1, tarifaCentavos: 0, subtotalCentavos: 0, tarifaExactaCentavos: 0 },
      ],
    }],
  };
  const html = doc({ esCotizacion: true, codigo: "C-0005", venta: ventaCop, items: [{ ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 2, tarifa_adulto: 732_000, tarifa_nino: 146_500, orden: 0 }], resumenPrecios: resumen });
  const filas = [...html.matchAll(/data-testid="resumen-grupo"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => limpiar(c[1]).trim()));
  assert.equal(filas.length, 2, `adultos + niño gratis (una fila) y niño que paga (otra): ${JSON.stringify(filas)}`);
  assert.deepEqual(filas[0].slice(1), ["2", "1", cop(732_000), "Niño gratis", cop(1_464_000)]);
  assert.deepEqual([filas[1][2], filas[1][4], filas[1][5]], ["1", cop(293_000), cop(293_000)]);
  assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_757_000);
});

test("cotización con resumen congelado y beneficio PARCIAL sellado por niño: dos niños con tarifas distintas (50.000 y 100.000) conservan cada uno su fila exacta — nunca una fila negativa ni un promedio", () => {
  const resumen = {
    moneda: "COP", version: 1, modalidad: "pvp", totalCentavos: 55_000_000,
    unidades: [{
      ref: "item-0", hotel: "Hotel Demo", regimen: "PAM", categoria: "Estandar", paquete: { id: 1, nombre: null }, totalCentavos: 55_000_000, ajusteCentavos: 0,
      grupos: [
        { tipo: "adulto", cupos: ["a1", "a2"], incluye: [], cantidad: 2, tarifaCentavos: 20_000_000, subtotalCentavos: 40_000_000, tarifaExactaCentavos: 20_000_000 },
        { tipo: "nino", cupos: ["n1"], incluye: [], cantidad: 1, tarifaCentavos: 10_000_000, subtotalCentavos: 10_000_000, tarifaExactaCentavos: 10_000_000 },
        { tipo: "nino", cupos: ["n2"], incluye: [], cantidad: 1, tarifaCentavos: 5_000_000, subtotalCentavos: 5_000_000, tarifaExactaCentavos: 5_000_000 },
      ],
    }],
  };
  const html = doc({ esCotizacion: true, codigo: "C-X", venta: { ...ventaCop, precio_venta: 550_000 }, items: [{ ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 2, tarifa_adulto: 200_000, tarifa_nino: 75_000, orden: 0 }], resumenPrecios: resumen });
  const filas = [...html.matchAll(/data-testid="resumen-grupo"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => limpiar(c[1]).trim()));
  assert.equal(filas.length, 3, "adultos y dos tarifas de niño realmente distintas (ninguna en cero)");
  assert.deepEqual(filas.map((f) => f[5]), [cop(400_000), cop(100_000), cop(50_000)]);
  assert.ok(!limpiar(html).includes("Niño gratis"));
  assert.doesNotMatch(html, /-\s?\$/);
});

// ── Aceptación (TEST_ACCEPTANCE.md): conteo de filas renderizadas por ruta de entrada y transiciones de estado USD ────────────────────────────────────
/** Filas de la tabla «Valores y Pagos» que describen el alojamiento (adultos o niños de la estadía): lo que el cliente cuenta. */
const filasAlojamiento = (html: string) => html.split("<tr").filter((f) => f.includes("<td") && /Estandar \/ PAM/.test(f)).map((f) => [...f.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => limpiar(m[1]).trim()));
// [adultos × tarifa adulto, niño(s) pagando, total, filas esperadas (corregido 2026-11-18: el niño gratis va en la fila del paquete), niño gratis esperado en fila de adultos]
const CASOS = [
  { n: "DTM-0003", ta: 732_000, tn: 293_000, ninos: 1, cond: 293_000, nc: 1, total: 1_464_000, filas: 1, pagan: 0 }, // 2×732.000 + 0 → UNA fila
  { n: "DTM-0004", ta: 180_000, tn: 150_000, ninos: 1, cond: 150_000, nc: 2, total: 360_000, filas: 1, pagan: 0 }, // 2×180.000 + 0 → UNA fila
  { n: "C-0005", ta: 732_000, tn: 293_000, ninos: 2, cond: 293_000, nc: 1, total: 1_757_000, filas: 2, pagan: 1 }, // (1.464.000 con el niño gratis) + 293.000 → DOS filas
] as const;
const RUTAS = [
  { ruta: "contrato interno/público (confirmado)", extra: {} },
  { ruta: "contrato pendiente", extra: { venta: { ...ventaCop, estado: "pendiente" } } },
  { ruta: "cotización (interna y pública /cot, /cotizacion)", extra: { esCotizacion: true, codigo: "C-X", vigenciaHasta: "2027-06-01" } },
  { ruta: "contrato con condiciones congeladas", extra: { condiciones } },
] as const;
test("conteo de filas y contenido: DTM-0003 (1) / DTM-0004 (1) / C-0005 (2) en cada ruta de documento (sin fila negativa, sin promoción, total a mano)", () => {
  for (const c of CASOS) for (const r of RUTAS) {
    const html = doc({ venta: ventaCop, items: itemsNg(c.ta, c.tn, c.ninos, c.cond, c.nc), ...r.extra });
    const etiqueta = `${c.n} · ${r.ruta}`;
    const filas = filasAlojamiento(html);
    assert.equal(filas.length, c.filas, `${etiqueta}: ${filas.length} filas de alojamiento ${JSON.stringify(filas)}`);
    assert.equal(filas[0][2], "1", `${etiqueta}: la fila del paquete incluye al niño gratis`);
    assert.equal(filas[0][4], "Niño gratis", `${etiqueta}: tarifa del niño en la fila del paquete`);
    assert.equal(filas.filter((f) => f[2] === "1" && f[4] === cop(c.tn)).length, c.pagan, `${etiqueta}: niño que paga su tarifa`);
    assert.ok(limpiar(html).includes(`Total del contrato ${cop(c.total)}`), `${etiqueta}: total ${c.total}`);
    assert.doesNotMatch(limpiar(html), /PRE BF|por habitación|Niño gratis de «|-\s?\$/, `${etiqueta}: sin promoción, cálculo ni negativos`);
    // Σ filas (hand): adultos + niño que paga = total
    const suma = filas.reduce((s, f) => s + Number(f[5].replace(/[^0-9]/g, "")), 0);
    assert.equal(suma, c.total, `${etiqueta}: la suma de las filas visibles = total`);
  }
});

test("cotización con servicio manual (fila única «Paquete turístico»): niño gratis + niño que paga NO se promedian; con un solo niño gratis la fila única se conserva", () => {
  const manual = { ...base, id: 9, descripcion: "Servicio · Traslado privado — sujeto a confirmación de disponibilidad y tarifa", adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: 9, modo_precio: "total", valor_total: 300_000 };
  const cotiz = { esCotizacion: true, codigo: "C-0005", vigenciaHasta: "2027-06-01", venta: { ...ventaCop, estado: "pendiente" } };
  // C-0005 + servicio manual: 1.757.000 + 300.000 = 2.057.000
  const mixto = doc({ ...cotiz, items: [...itemsNg(732_000, 293_000, 2, 293_000), manual] });
  assert.ok(limpiar(mixto).includes(`Total del contrato ${cop(2_057_000)}`));
  assert.ok(!mixto.includes('data-testid="fila-paquete-turistico"'), "tarifas de niño distintas (0 y 293.000): no hay una fila única promediada");
  assert.deepEqual(filasAlojamiento(mixto).map((f) => f[4]).filter((x) => x === "Niño gratis" || x === cop(293_000)).sort(), [cop(293_000), "Niño gratis"].sort());
  // DTM-0003 + servicio manual: 1.464.000 + 300.000 = 1.764.000, un solo tipo de tarifa de niño ⇒ fila única
  const unico = doc({ ...cotiz, items: [...itemsNg(732_000, 293_000, 1, 293_000), manual] });
  assert.ok(limpiar(unico).includes(`Total del contrato ${cop(1_764_000)}`));
  assert.ok(unico.includes('data-testid="fila-paquete-turistico"'));
  assert.doesNotMatch(limpiar(unico), /PRE BF|por habitación|-\s?\$/);
});

test("USD: pendiente → confirmado, pago revertido y mínimo ya cubierto (importes a mano, en USD en todos los estados)", () => {
  const condUsd = { ...condiciones, moneda: "USD", filas: [{ ...condiciones.filas[0], exigido: 300, moneda: "USD" }], resumen: { ...condiciones.resumen, montoMinimoExigidoTotal: 300, texto: "Pago mínimo requerido: $300 USD (30 % informativo)" } };
  const cobro = cobroDeVenta(ventaUsd);
  const ver = (estado: string, totalPagado: number) => limpiar(doc({ venta: { ...ventaUsd, estado }, items: itemsUsd, totalPagado, cobro, condiciones: condUsd }));
  // pendiente con el mínimo ya cubierto (COP 1.230.000 = USD 300): sigue pendiente, sigue mostrando su mínimo; pagado/saldo en USD
  const pendCubierto = ver("pendiente", 1_230_000);
  assert.ok(pendCubierto.includes("Pago mínimo requerido: $300 USD") && pendCubierto.includes(`Total pagado ${usd(300)}`) && pendCubierto.includes(`Saldo pendiente ${usd(700)}`));
  // el mismo contrato ya confirmado: sin mínimo, mismos importes, condiciones congeladas intactas
  const conf = ver("confirmado", 1_230_000);
  assert.ok(!/Pago mínimo/.test(conf) && conf.includes("Anticipo + saldo") && conf.includes(`Total pagado ${usd(300)}`) && conf.includes(`Saldo pendiente ${usd(700)}`));
  // pago revertido (anulado): vuelve a 0 / saldo = oferta; confirmado sigue sin pedir el mínimo (la regla de confirmación no cambia)
  const revertido = ver("confirmado", 0);
  assert.ok(revertido.includes(`Total pagado ${usd(0)}`) && revertido.includes(`Saldo pendiente ${usd(1000)}`) && !/Pago mínimo/.test(revertido));
  // pago parcial intermedio: COP 615.000 / 4100 = USD 150; saldo 850
  assert.ok(ver("pendiente", 615_000).includes(`Total pagado ${usd(150)}`) && ver("pendiente", 615_000).includes(`Saldo pendiente ${usd(850)}`));
  for (const t of [pendCubierto, conf, revertido]) assert.ok(!t.includes("Total a cobrar") && !t.includes(cop(1_230_000)) && !t.includes(cop(4_100_000)));
});

test("USD con cobro en COP, PENDIENTE: el mínimo acordado se expresa en USD con la TRM congelada (1.230.000 / 4.100 = USD 300), nunca en COP; confirmado lo oculta", () => {
  const cobro = cobroDeVenta(ventaUsd);
  const r = { regla: "acuerdo", minimo: 1_230_000, moneda: "COP", trm: null };
  const sinFilas = { hayCondiciones: false, moneda: "COP", filas: [], restringidas: [], huboRestriccionOriginal: false, resumen: null, minimoNoVerificable: false,
    minimoAcordado: { texto: "Pago mínimo para confirmar: $1.230.000 COP (mínimo acordado)", minimoConfirmar: r } };
  const pend = limpiar(doc({ venta: { ...ventaUsd, estado: "pendiente" }, items: itemsUsd, totalPagado: 0, cobro, condiciones: sinFilas }));
  assert.ok(pend.includes("Pago mínimo para confirmar: $300 USD (mínimo acordado)"), "el mínimo sale en la moneda del contrato");
  assert.ok(!pend.includes("1.230.000"), "el documento de cliente no imprime el mínimo en COP");
  assert.doesNotMatch(pend, /Pago mínimo[^(]*COP/, "ninguna frase del mínimo queda en COP");
  // resumen con condiciones: mismo criterio en el resumen agregado
  const conRes = { ...condiciones, minimoAcordado: null, resumen: { ...condiciones.resumen, texto: "Pago mínimo para confirmar: $1.230.000 COP (mínimo acordado)", minimoConfirmar: r } };
  assert.ok(limpiar(doc({ venta: { ...ventaUsd, estado: "pendiente" }, items: itemsUsd, totalPagado: 0, cobro, condiciones: conRes })).includes("Pago mínimo para confirmar: $300 USD (mínimo acordado)"));
  // confirmado: ni el aviso ni la conversión (la regla de confirmación no cambia)
  assert.ok(!/Pago mínimo/.test(limpiar(doc({ venta: { ...ventaUsd, estado: "confirmado" }, items: itemsUsd, totalPagado: 1_230_000, cobro, condiciones: sinFilas }))));
  // sin conversión (contrato COP cobrado en COP): el texto se conserva tal cual
  const cop1 = limpiar(doc({ venta: { ...ventaCop, estado: "pendiente" }, items: itemsUsd, totalPagado: 0, cobro: cobroDeVenta(ventaCop), condiciones: sinFilas }));
  assert.ok(cop1.includes("Pago mínimo para confirmar: $1.230.000 COP (mínimo acordado)"));
});

// ── Round 2 (Codex C1/C2): NETO sellado, USD y redacción cotización/contrato ─────────────────────────────────────────────────────────────────────────
test("NETO con resumen SELLADO por pasajero (exigible 1.657.000): adultos + niño gratis en UNA fila (1.380.000) y el niño que paga en otra (277.000); las filas suman el exigible, sin PVP", () => {
  const resumen = {
    moneda: "COP", version: 1, modalidad: "neto", totalCentavos: 165_700_000,
    unidades: [{
      ref: "item-0", hotel: "Hotel Demo", regimen: "PAM", categoria: "Estandar", paquete: { id: 1, nombre: null }, totalCentavos: 165_700_000, ajusteCentavos: 0,
      grupos: [
        { tipo: "adulto", cupos: ["a1", "a2"], incluye: [], cantidad: 2, tarifaCentavos: 69_000_000, subtotalCentavos: 138_000_000, tarifaExactaCentavos: 69_000_000 },
        { tipo: "nino", cupos: ["n1"], incluye: [], cantidad: 1, tarifaCentavos: 27_700_000, subtotalCentavos: 27_700_000, tarifaExactaCentavos: 27_700_000 },
        { tipo: "nino", cupos: ["n2"], incluye: [], cantidad: 1, tarifaCentavos: 0, subtotalCentavos: 0, tarifaExactaCentavos: 0 },
      ],
    }],
  };
  const html = doc({ esCotizacion: true, codigo: "C-0005", venta: ventaCop, items: [{ ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 2, tarifa_adulto: 732_000, tarifa_nino: 146_500, orden: 0 }], netoTotalExigible: 1_657_000, resumenPrecios: resumen });
  const filas = [...html.matchAll(/data-testid="resumen-grupo"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => limpiar(c[1]).trim()));
  assert.equal(filas.length, 2, JSON.stringify(filas));
  assert.deepEqual([filas[0][1], filas[0][2], filas[0][4]], ["2", "1", "Niño gratis"]);
  assert.equal(numES(filas[0][5]), 1_380_000);
  assert.deepEqual([filas[1][1], filas[1][2], numES(filas[1][5])], ["0", "1", 277_000]);
  assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_657_000);
  assert.doesNotMatch(html, /-\s?\$/);
});

test("USD: contrato con niño gratis en UNA fila (2 × USD 500 + niño en 0 = USD 1.000), sin importes COP ni líneas negativas", () => {
  const items = [
    { ...base, id: 1, descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 0, tarifa_adulto: 500, tarifa_nino: 0, orden: 0 },
    { ...base, id: 2, descripcion: "Niño 1 · Estandar / PAM", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 200, orden: 1 },
    { ...base, id: 3, descripcion: "Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño 1))", adultos: 1, ninos: 0, tarifa_adulto: -200, tarifa_nino: 0, orden: 203 },
  ];
  const html = doc({ venta: ventaUsd, items, cobro: cobroDeVenta(ventaUsd) });
  const filas = filasTabla(html);
  assert.equal(filas.length, 1, JSON.stringify(filas));
  assert.deepEqual(filas[0].slice(1), ["2", "1", usd(500), "Niño gratis", usd(1000)]);
  assert.doesNotMatch(html, /-\s?\$/);
  assert.doesNotMatch(limpiar(html), /1\.230\.000|4\.100\.000|PRE BF/);
});

test("cotización vs contrato: la cotización conserva la explicación del niño gratis (condiciones de la tarifa); el contrato nunca nombra la promoción ni el cálculo — con la MISMA estructura de filas", () => {
  const items = itemsNg(732_000, 293_000, 1, 293_000);
  const cont = doc({ venta: ventaCop, items, hoteles: [hotelConExplicacion] });
  const cot = doc({ esCotizacion: true, codigo: "C-X", vigenciaHasta: "2027-06-01", venta: ventaCop, items, hoteles: [hotelConExplicacion] });
  assert.doesNotMatch(limpiar(cont), /Niño gratis de «|PRE BF/);
  assert.match(limpiar(cot), /Niño gratis de «PRE BF»/);
  assert.deepEqual(filasTabla(cont), filasTabla(cot), "mismas filas en contrato y cotización");
  assert.equal(filasTabla(cot).length, 1);
});
