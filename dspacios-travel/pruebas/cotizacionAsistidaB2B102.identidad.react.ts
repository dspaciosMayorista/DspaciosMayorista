// Se ejecuta con npm run test:react (loader del arnés).
// #102 (Preview #403) — Lo que ve el comprador de una venta NETO asistida y las firmas/RNT de los documentos:
//   · NETO: el «Cliente» del documento es el ALIADO (con su identidad fiscal) y la persona aparece como «Titular de la reserva».
//   · PVP con comisión / B2C: el documento es el de siempre (sin sección de titular).
//   · Firmas: quien elaboró y el vendedor salen de datos persistidos (asesor interno, aliado); si falta el dato se muestra «—», nunca un nombre inventado.
//   · RNT / datos de pago: salen de la fila `agencias` del tenant (Mayorista ≠ Minorista), también en la cotización manual.
//   · Listado: indicación «NETO» / «PVP» y el importe que corresponde a cada una.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { CotizacionManualDocumento } = await import("../components/contrato/CotizacionManualDocumento.tsx");
const { ValorCotizacion } = await import("../components/cotizacion/ValorCotizacion.tsx");
const { formatMoneda } = await import("../lib/utils.ts");

const texto = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const $ = (n: number) => formatMoneda(n, "COP").replace(/ /g, " ");

const ventaBase = {
  numero_contrato: "", cliente: "Ana Pérez", cliente_documento: "123", cliente_direccion: null, cliente_telefono: "300", estado: "pendiente",
  fecha_emision: "2030-02-01", fecha_salida: "2030-03-01", fecha_regreso: "2030-03-04", pax: 2, plan_nombre: "Estandar · Desayuno", tours_traslados: null,
  asistencia_medica: null, moneda: "COP", destino: "CARTAGENA",
};
const items = [{ id: 1, numero_contrato: "", descripcion: "Hotel Aurora — CARTAGENA · 1 hab Doble (2 pax)", adultos: 2, ninos: 0, tarifa_adulto: 500_000, tarifa_nino: 0, orden: 0, modo_precio: "por_persona", valor_total: null }];
const doc = (venta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  texto(createElement(ContratoDocumento, { venta: { ...ventaBase, ...venta }, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: 0, esCotizacion: true, codigo: "COT-1", vigenciaHasta: "2030-02-20", ...extra } as never));

const NETO_VENTA = {
  cliente: "Viajes Aurora 102", cliente_documento: "900123456-7", cliente_telefono: "6044440000", cliente_direccion: "Calle 10 # 5-20, Medellín",
  titular_nombre: "Ana Pérez", titular_documento: "123", titular_telefono: "3000000000",
};

describe("Cliente comercial = aliado; persona = «Titular de la reserva» (NETO)", () => {
  test("NETO: el cliente es el aliado con su identidad fiscal y la persona aparece aparte como titular", () => {
    const t = doc(NETO_VENTA, { netoTotalExigible: 1_190_000 });
    assert.match(t, /Cliente Nombre Viajes Aurora 102 N° Documento 900123456-7 Teléfono 6044440000 Dirección Calle 10 # 5-20, Medellín/);
    assert.match(t, /Titular de la reserva Nombre Ana Pérez N° Documento 123 Teléfono 3000000000/);
    assert.equal((t.match(/Ana Pérez/g) ?? []).length, 1, "la persona solo aparece como titular, no como cliente");
    assert.ok(!t.includes($(1_000_000)), "sigue sin revelar el PVP original");
    assert.doesNotMatch(t, /comisi[oó]n/i);
  });

  test("sin titular aparte (B2C o PVP con comisión) el documento es el de siempre: sin sección de titular", () => {
    const t = doc({}, { netoTotalExigible: null });
    assert.match(t, /Cliente Nombre Ana Pérez N° Documento 123/);
    assert.doesNotMatch(t, /Titular de la reserva/);
  });
});

describe("Firmas del documento", () => {
  test("quien elaboró sale del asesor persistido; el vendedor, del aliado cuando lo hay", () => {
    const t = doc({ asesor_firma_nombre: "Marta Ruiz", asesor_firma_cargo: "Asesor/a", tipo_asesor: "agencia", agencia_nombre: "Viajes Aurora 102" });
    assert.match(t, /Marta Ruiz Cargo: Asesor\/a/);
    assert.match(t, /Viajes Aurora 102 Cargo: Agencia aliada/);
  });

  test("contratos que solo tienen `asesor` (sin nombre de firma, p. ej. importados) firman con ese asesor en vez de «—»", () => {
    const t = doc({ asesor_firma_nombre: null, asesor: "Marta Ruiz" });
    assert.match(t, /Marta Ruiz Cargo: Elaboró el contrato/);
    assert.match(t, /Marta Ruiz Cargo: Vendedor\/a/);
    assert.doesNotMatch(t, /—\s+Cargo/);
  });

  test("si de verdad falta el dato se muestra «—» (no se inventa un nombre)", () => {
    const t = doc({ asesor_firma_nombre: null, asesor: null });
    assert.match(t, /— Cargo: Elaboró el contrato/);
    assert.match(t, /— Cargo: Vendedor\/a/);
  });
});

describe("RNT y datos de pago por agencia", () => {
  const agencia = (tenant: string, rnt: string, razon: string) => ({ tenant, rnt, razon_social: razon, nit: `NIT-${tenant}`, correo: `${tenant}@x.test`, banco: `Banco ${tenant}`, tipo_cuenta: "Ahorros", numero_cuenta: `CTA-${tenant}` });

  test("la cotización muestra el RNT, el NIT y la cuenta de la agencia que recibe, distintos entre Mayorista y Minorista", () => {
    const may = doc({}, { agencia: agencia("mayorista", "RNT-MAY-111", "Mayorista SAS") });
    const min = doc({ tenant: "minorista" }, { agencia: agencia("minorista", "RNT-MIN-222", "Minorista SAS") });
    assert.match(may, /RNT RNT-MAY-111/); assert.match(may, /Banco mayorista — Ahorros CTA-mayorista/); assert.doesNotMatch(may, /RNT-MIN-222/);
    assert.match(min, /RNT RNT-MIN-222/); assert.match(min, /Banco minorista — Ahorros CTA-minorista/); assert.doesNotMatch(min, /RNT-MAY-111/);
  });

  test("la cotización dinámica (manual) también usa la fila de agencias, no la constante de Mayorista", () => {
    const props = (ag: unknown) => ({ codigo: "C-9", venta: { cliente: "Ana", destino: "CARTAGENA", precio_venta: 100, moneda: "COP", asesor: "Marta Ruiz" }, items: [{ descripcion: "Paquete", valor: 100 }], cliente: {}, agencia: ag });
    const min = texto(createElement(CotizacionManualDocumento, props(agencia("minorista", "RNT-MIN-222", "Minorista SAS")) as never));
    assert.match(min, /RNT RNT-MIN-222/);
    assert.match(min, /Banco minorista — Ahorros CTA-minorista/);
    assert.match(min, /Marta Ruiz Cargo: Asesor\/a/);
  });
});

describe("Listado de cotizaciones: NETO / PVP", () => {
  test("NETO presenta el total exigible congelado con su indicación; no el PVP", () => {
    const t = texto(createElement(ValorCotizacion, { modo: "neta", precioVenta: 1_300_000, totalExigible: 1_190_000, moneda: "COP" }));
    assert.match(t, /NETO/);
    assert.ok(t.includes($(1_190_000)));
    assert.ok(!t.includes($(1_300_000)));
  });

  test("PVP con comisión presenta el PVP con su indicación", () => {
    const t = texto(createElement(ValorCotizacion, { modo: "comisionable", precioVenta: 1_300_000, totalExigible: 1_300_000, moneda: "COP" }));
    assert.match(t, /PVP/);
    assert.ok(t.includes($(1_300_000)));
    assert.doesNotMatch(t, /NETO/);
  });

  test("una cotización histórica sin modalidad conserva su valor y no se etiqueta como NETO", () => {
    for (const modo of [null, undefined, "", "otra"]) {
      const t = texto(createElement(ValorCotizacion, { modo: modo as never, precioVenta: 800_000, totalExigible: null, moneda: "COP" }));
      assert.ok(t.includes($(800_000)));
      assert.doesNotMatch(t, /NETO/);
    }
  });

  test("un NETO con total exigible faltante o inválido muestra «Revisar importe» y NUNCA el PVP", () => {
    for (const totalExigible of [Number.NaN, 0, -5, null, undefined, "abc", ""]) {
      const t = texto(createElement(ValorCotizacion, { modo: "neta", precioVenta: 800_000, totalExigible: totalExigible as never, moneda: "COP" }));
      assert.match(t, /Revisar importe/, String(totalExigible));
      assert.ok(!t.includes($(800_000)), "no muestra el PVP: " + String(totalExigible));
      assert.doesNotMatch(t, /NETO|PVP/, String(totalExigible));
    }
  });

  test("la comparativa conserva su regla «desde»", () => {
    const t = texto(createElement(ValorCotizacion, { desde: { total: 900_000, moneda: "COP" } } as never));
    assert.match(t, /desde/);
    assert.ok(t.includes($(900_000)));
  });
});
