import test from "node:test";
import assert from "node:assert/strict";
import { validarPaquete, type PaqueteDin } from "../lib/paqueteDinamico/calculo.ts";
import { construirCotizacionDin, reliquidarComponentes } from "../lib/paqueteDinamico/cotizacion.ts";
import { armarPaqueteCalc } from "../lib/paqueteDinamico/modelo.ts";

const comp = { habitaciones: { doble: 1 }, ninos: 1, ninos2: 0, infantes: 1 };
const soloPvp: PaqueteDin = {
  esquema: "solo_pvp", pvpModo: "por_componente", moneda: "COP", pctMk: 0, usaVuelo: true, usaHotel: true, usaServicios: true,
  vuelo: { neto: { adulto: null, nino: null, infante: null }, pvp: { adulto: 900000, nino: 700000, infante: 0 } },
  hotel: { nombre: "H", neto: {}, pvp: { sencilla: 900000, doble: 800000, triple: 700000, multiple: 600000, nino: 300000, nino2: 200000, infante: 0 } },
  servicios: [{ id: "s1", nombre: "Tour", neto: null, pvp: 150000 }],
};
const entrada = (calc: PaqueteDin) => ({
  paqueteId: 1, paqueteNombre: "Paq", destino: "Cartagena", hotelId: 1, vueloId: 1, calc, composicion: comp,
  cliente: { nombres: "Ana", apellidos: "P", tipoDoc: "CC", numeroDoc: "1", telefono: "", email: "" }, fechaIda: "2027-01-10", fechaRegreso: "2027-01-13",
  vigenciaHasta: "2026-12-01", tipoAsesor: "interno" as const, asesorInterno: "Luis", agenciaNombre: "", freelanceNombre: "",
});

test("cotización: total = Σ componentes = Σ ítems del documento; solo PVP deja costos pendientes", () => {
  const r = construirCotizacionDin(entrada(soloPvp));
  assert.ok(r.ok);
  if (!r.ok) return;
  const total = r.cabecera.precio_venta as number;
  assert.equal(r.servicios.reduce((s, c) => s + c.valor, 0), total);
  // adultos 2: hotel 2×800000 + niño 300000 + vuelo 3×900000 (menor desde 2 años = adulto con silla) + infante 0 + tour 3×150000
  assert.equal(total, 1_600_000 + 300_000 + 2_700_000 + 450_000);
  assert.equal((r.cabecera.detalle as { items: { valor: number }[] }).items.reduce((s, i) => s + i.valor, 0), total);
  assert.ok(r.servicios.every((s) => s.costo_neto === 0 && s.exige_costo));
  assert.equal((r.cabecera.payload as { ninos: number }).ninos, 0);
  const ed = reliquidarComponentes({ componentes: r.servicios.map((s, i) => ({ valor: s.valor + (i === 0 ? 1000 : 0) })), destino: "Cartagena", fechaIda: "2027-01-10", fechaRegreso: "2027-01-13", resumenPax: "x" });
  assert.ok(!("error" in ed) && ed.total === total + 1000 && ed.items[0].valor === total + 1000);
  assert.ok("error" in reliquidarComponentes({ componentes: [], destino: "", fechaIda: "", fechaRegreso: "", resumenPax: "" }));
});

test("neta + markup: costos conocidos, nada que exigir", () => {
  const neta: PaqueteDin = { ...soloPvp, esquema: "neta_markup", pvpModo: null, pctMk: 0.2,
    vuelo: { neto: { adulto: 800000, nino: 600000, infante: 100000 }, pvp: { adulto: null, nino: null, infante: null } },
    hotel: { nombre: "H", neto: { sencilla: 1, doble: 700000, triple: 1, multiple: 1, nino: 300000, nino2: 200000, infante: 0 }, pvp: {} },
    servicios: [{ id: "s1", nombre: "Tour", neto: 100000, pvp: null }] };
  const r = construirCotizacionDin(entrada(neta));
  assert.ok(r.ok);
  if (r.ok) assert.ok(r.servicios.every((s) => !s.exige_costo && s.costo_neto > 0 && s.pct_markup === 0.2));
});

test("armarPaqueteCalc: sin hotel/vuelo elegido con el check activo, la validación falla", () => {
  const fila = { id: 1, nombre: "P", moneda: "COP", esquema: "neta_markup" as const, pvp_modo: null, pct_mk: 0.2, usa_vuelo: true, usa_hotel: true, usa_servicios: false, noches: 3, pvp_general: null, total_declarado: null };
  assert.ok(validarPaquete(armarPaqueteCalc(fila, null, null)).length > 0);
});
