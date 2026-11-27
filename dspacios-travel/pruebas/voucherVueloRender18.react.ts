// Se ejecuta con npm run test:react:resto (loader del arnés).
// #18 — render del voucher de vuelo (datos ausentes explícitos, sin PNR) y #17 — el contrato en TODAS sus variantes sigue sin horarios ni número de vuelo
// (fila nueva, fila anterior a la 135 y vuelo manual) mientras la cotización conserva ambos. Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { VoucherVueloDocumento } = await import("../components/voucher/VoucherVueloDocumento.tsx");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { construirVoucherVuelo } = await import("../lib/voucher/vuelo.ts");
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const texto = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const fila = (o: Record<string, unknown>) => ({
  id: 1, record: null, aerolinea: null, direccion: null, origen_codigo: null, origen_ciudad: null, destino_codigo: null, destino_ciudad: null, numero_vuelo: null, fecha_salida: null,
  hora_salida: null, hora_llegada: null, servicios: null, orden: 0, vuelo_ida: null, vuelo_regreso: null, hora_salida_ida: null, hora_llegada_ida: null,
  hora_salida_reg: null, hora_llegada_reg: null, fecha_regreso: null, ...o,
});
const base = { pasajeros: ["Ana Pérez", "Luis Gómez"], titular: "Ana Pérez", nReserva: "DTM-0001", vendedor: "Asesora", emision: "2030-10-01" };

describe("VoucherVueloDocumento", () => {
  const completo = construirVoucherVuelo({ ...base, filas: [
    fila({ orden: 0, direccion: "ida", aerolinea: "Aerolínea X", numero_vuelo: "XX1", origen_codigo: "BOG", destino_codigo: "CTG", fecha_salida: "2030-10-15", hora_salida: "06:05:00", hora_llegada: "07:30:00", servicios: "Maleta 23 kg" }),
    fila({ orden: 1, direccion: "regreso", aerolinea: "Aerolínea X", numero_vuelo: "XX2", origen_codigo: "CTG", destino_codigo: "BOG", fecha_salida: "2030-10-18", hora_salida: "18:40", hora_llegada: "20:10", servicios: "Maleta 23 kg" }),
  ] as never })!;

  test("datos guardados SIN PNR guardado: vuelo, horas HH:mm, pasajeros, y ni rastro de record/PNR (la ausencia no se rotula como dato faltante)", () => {
    const t = texto(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, { c: completo }));
    assert.match(t, /XX1/);
    assert.match(t, /XX2/);
    assert.match(t, /06:05/);
    assert.match(t, /20:10/);
    assert.match(t, /Ana Pérez/);
    assert.match(t, /Luis Gómez/);
    assert.doesNotMatch(t, /No registrado/);
    assert.doesNotMatch(t, /PNR|record/i);
    assert.doesNotMatch(t, /:\d\d:\d\d/, "sin segundos");
  });

  test("ADL-041: con PNR guardado (contrato pagado) el voucher lo muestra; sin él, no hay celda ni «No registrado»", () => {
    const conPnr = construirVoucherVuelo({ ...base, filas: [fila({ direccion: "ida", aerolinea: "Aerolínea X", numero_vuelo: "XX1", record: "ABC123" })] as never })!;
    const t = texto(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, { c: conPnr }));
    assert.match(t, /PNR \/ Código de reserva ABC123/);
    assert.doesNotMatch(t, /se mostrará en el voucher cuando el contrato esté 100/);
    const sinPnr = texto(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, { c: construirVoucherVuelo({ ...base, filas: [fila({ direccion: "ida", aerolinea: "Aerolínea X", numero_vuelo: "XX1" })] as never })! }));
    assert.doesNotMatch(sinPnr, /PNR/);
  });

  test("ADL-041: contrato sin pagar en la vista interna: sin PNR y con la nota interna (no se imprime)", () => {
    const c = construirVoucherVuelo({ ...base, filas: [fila({ direccion: "ida", numero_vuelo: "XX1" })] as never })!;
    const html = renderToStaticMarkup(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, { c, pnrPendientePago: true }) as never);
    assert.match(html, /data-testid="pnr-pendiente-pago"/);
    assert.match(html, /print:hidden/);
    assert.doesNotMatch(texto(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, { c, pnrPendientePago: true })), /PNR \/ Código de reserva/);
  });

  test("dato ausente: «No registrado» visible y ninguna hora inventada", () => {
    const v = construirVoucherVuelo({ ...base, filas: [fila({ direccion: "ida", origen_codigo: "BOG", destino_codigo: "CTG" })] as never })!;
    const t = texto(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, { c: v }));
    assert.match(t, /No registrado/);
    assert.doesNotMatch(t, /00:00/);
  });

  test("sin pasajeros: lo dice, no inventa una lista", () => {
    const v = construirVoucherVuelo({ ...base, pasajeros: [], filas: [fila({ direccion: "ida", numero_vuelo: "XX1" })] as never })!;
    const t = texto(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, { c: v }));
    assert.match(t, /Pasajeros de la reserva No registrado/);
  });
});

describe("#17 — el contrato no muestra horarios ni número de vuelo en ninguna forma de fila; la cotización sí", () => {
  const venta = {
    numero_contrato: "DTM-0001", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
    asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
    pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
  };
  const doc = (vuelos: unknown[], esCotizacion: boolean) => texto(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, {
    venta, pasajeros: [], hoteles: [], vuelos, items: [], totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], esCotizacion, codigo: "COT-1", vigenciaHasta: "2030-10-10",
  }));
  const nueva = { id: 1, numero_contrato: "DTM-0001", aerolinea: "Aerolínea Sintética", origen_codigo: "BOG", destino_codigo: "CTG", fecha_salida: "2030-10-15", direccion: "ida", numero_vuelo: "XX123", hora_salida: "06:05:00", hora_llegada: "07:30:00", servicios: null };
  const legacy = { id: 2, numero_contrato: "DTM-0001", aerolinea: "Aerolínea Vieja", origen_codigo: "MDE", destino_codigo: "CTG", fecha_salida: "2030-10-15", fecha_regreso: "2030-10-18", direccion: null, numero_vuelo: null, hora_salida: null, hora_llegada: null,
    vuelo_ida: "LG777", vuelo_regreso: "LG778", hora_salida_ida: "09:15:00", hora_llegada_ida: "10:20:00", hora_salida_reg: "16:45:00", hora_llegada_reg: "17:50:00", servicios: null };
  const PROHIBIDO = /XX123|LG77[78]|06:05|07:30|09:15|10:20|16:45|17:50/;

  for (const [nombre, vuelo] of [["fila de un tramo", nueva], ["fila anterior a la 135 (ida+regreso)", legacy]] as const) {
    test(`contrato · ${nombre}: sin número de vuelo ni horas, con aerolínea y ruta`, () => {
      const t = doc([vuelo], false);
      assert.doesNotMatch(t, PROHIBIDO);
      assert.match(t, /Aerolínea (Sintética|Vieja)/);
      assert.match(t, /Origen: .*Destino:/);
    });
    test(`cotización · ${nombre}: conserva número de vuelo y horas HH:mm`, () => {
      const t = doc([vuelo], true);
      assert.match(t, vuelo === nueva ? /XX123/ : /LG777/);
      assert.match(t, vuelo === nueva ? /06:05–07:30/ : /09:15–10:20/);
      assert.doesNotMatch(t, /:\d\d:\d\d/);
    });
  }
});
