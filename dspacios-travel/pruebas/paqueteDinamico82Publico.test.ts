import test from "node:test";
import assert from "node:assert/strict";
import { liquidarPaquete, validarPaquete } from "../lib/paqueteDinamico/calculo.ts";
import { armarPaqueteCalc, type FilaHotelDin, type FilaPaqueteDin, type FilaServicioDin, type FilaVueloDin } from "../lib/paqueteDinamico/modelo.ts";
import { aPvpPublico, vistaPublica, FOTO_HOTEL_PREDETERMINADA } from "../lib/paqueteDinamico/publico.ts";

const p = { id: 1, nombre: "Paq", moneda: "COP", esquema: "neta_markup" as const, pvp_modo: null, pct_mk: 0.2, usa_vuelo: true, usa_hotel: true, usa_servicios: true, noches: 3,
  pvp_general: null, total_declarado: null, destino: "CARTAGENA", compra_fin: null, descripcion: "d", incluye: "a\nb", no_incluye: "c" };
const hotel: FilaHotelDin = { id: 7, hotel_id: null, nombre: "Hotel Manual", categoria: "4*", regimen: "PAM", descripcion: null, foto_url: null, proveedor: "PROV_SECRETO_HOTEL",
  neto: { sencilla: 1111111, doble: 777777, triple: 666666, multiple: 555555, nino: 333333, nino2: 222222, infante: 0 }, pvp: {}, pvp_general: null };
const vuelo: FilaVueloDin = { id: 3, empaquetado_id: null, destino_id: null, aerolinea: "AV", ruta: "BOG-CTG", fecha_ida: "2027-01-10", fecha_regreso: "2027-01-13", proveedor: "PROV_SECRETO_VUELO",
  neto: { adulto: 888888, nino: 666666, infante: 99999 }, pvp: {} };
const servicio: FilaServicioDin = { id: 5, servicio_id: null, nombre: "Tour", proveedor: "PROV_SECRETO_TOUR", neto: 123457, pvp: null };
const comp = { habitaciones: { doble: 1 }, ninos: 1, ninos2: 0, infantes: 1 };

test("la vista pública no contiene netas, markup ni proveedores", () => {
  const v = vistaPublica(p, [hotel], [vuelo], [servicio]);
  assert.ok(v);
  const json = JSON.stringify(v);
  for (const secreto of ["PROV_SECRETO", "777777", "888888", "123457", "1111111", "pctMk\":0.2", "99999,"]) assert.ok(!json.includes(secreto), `filtra ${secreto}`);
  assert.equal(v!.hoteles[0].foto, FOTO_HOTEL_PREDETERMINADA);
});

test("el total público (solo PVP) es idéntico al de la opción con netas + markup", () => {
  const original = armarPaqueteCalc(p, hotel, vuelo, [servicio]);
  const publico = aPvpPublico(original);
  assert.deepEqual(validarPaquete(publico), []);
  assert.equal(liquidarPaquete(publico, comp).total, liquidarPaquete(original, comp).total);
});

test("modo general: se conserva el precio general y no aparecen netas", () => {
  const g = { ...p, esquema: "solo_pvp" as const, pvp_modo: "general" as const, pct_mk: 0, pvp_general: { sencilla: 3e6, doble: 2.5e6, triple: 2e6, multiple: 1.8e6, nino: 1e6, nino2: 8e5, infante: 0 } };
  const v = vistaPublica(g, [hotel], [vuelo], [servicio]);
  assert.ok(v);
  assert.equal(v!.opciones[0].desdePorPersona, 2.5e6);
  assert.equal(liquidarPaquete(v!.opciones[0].calc, comp).total, 2 * 2.5e6 + 1e6);
});

test("opción sin precio válido no se publica", () => {
  const roto = { ...hotel, neto: { ...hotel.neto, doble: null } };
  assert.equal(vistaPublica(p, [roto], [vuelo], [servicio]), null);
});
