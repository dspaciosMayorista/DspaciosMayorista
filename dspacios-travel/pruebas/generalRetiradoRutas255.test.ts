import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { servicioSeleccionable } from "../lib/paquetes/armadoPestanas.ts";
import { costoServicioContrato, rangoCubrePax } from "../lib/calc/servicioTarifa.ts";
import { precioServicio } from "../lib/calc/paquetes.ts";
import { serviciosSinPrecioInfanteVigencias } from "../lib/calc/servicioVigencias.ts";
import type { VigenciasServicio } from "../lib/calc/servicioVigencias.ts";

const HOY = "2026-10-29";
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Un servicio con precio/rangos GENERAL (columnas base) pero SIN vigencia no se puede vender.
describe("servicioSeleccionable exige una vigencia vendible, no el precio o rango GENERAL", () => {
  test("solo GENERAL (precio base o rangos con temporada GENERAL): NO seleccionable", () => {
    assert.equal(servicioSeleccionable({ precio_persona: 100000, servicio_tarifa_pax: [{ temporada: "GENERAL" }], servicio_temporadas: [] } as never, HOY), false);
    assert.equal(servicioSeleccionable({ servicio_tarifa_pax: [{ temporada: "GENERAL" }] } as never, HOY), false);
  });
  test("vigencia vigente con precio por persona: seleccionable (también con $0)", () => {
    const v = (precio: number | null) => ({ servicio_temporadas: [{ nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2027-12-31", precio_persona: precio }], servicio_tarifa_pax: [] });
    assert.equal(servicioSeleccionable(v(80000), HOY), true);
    assert.equal(servicioSeleccionable(v(0), HOY), true, "$0 es una tarifa, no ausencia");
    assert.equal(servicioSeleccionable(v(null), HOY), false);
  });
  test("vigencia vencida o sin fechas: NO seleccionable aunque tenga precio", () => {
    assert.equal(servicioSeleccionable({ servicio_temporadas: [{ nombre: "V0", fecha_inicio: "2025-01-01", fecha_fin: "2026-01-31", precio_persona: 50 }] }, HOY), false);
    assert.equal(servicioSeleccionable({ servicio_temporadas: [{ nombre: "V0", fecha_inicio: null, fecha_fin: null, precio_persona: 50 }] }, HOY), false);
  });
  test("grupo: solo cuentan los rangos cuya temporada es la de la vigencia, no los GENERAL", () => {
    const vig = [{ nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2027-12-31", precio_persona: null }];
    assert.equal(servicioSeleccionable({ servicio_temporadas: vig, servicio_tarifa_pax: [{ temporada: "GENERAL" }] }, HOY), false);
    assert.equal(servicioSeleccionable({ servicio_temporadas: vig, servicio_tarifa_pax: [{ temporada: "V1" }] }, HOY), true);
  });
});

describe("costo y CxP del servicio con infante: precio de la vigencia, nunca el precio_infante GENERAL", () => {
  const base = { modo: "persona" as const, netoPersona: 100, grupos: [], paxConSilla: 2, numMenoresDeDos: 1, liquidacion: null, nochesStay: 3, totalPax: 3, recargoIndividual: 0 };
  test("vigencia SIN precio_infante: el infante paga el adulto de la vigencia (100), aunque GENERAL dijera 5", () => {
    // 2 adultos × 100 + 1 infante × 100 = 300 (con el GENERAL de 5 saldría 205).
    assert.equal(costoServicioContrato({ ...base, netoInfanteVigencia: undefined }), 300);
    assert.equal(costoServicioContrato({ ...base, netoInfanteVigencia: null }), 300);
  });
  test("vigencia CON precio_infante propio (incluido $0): se usa ese", () => {
    assert.equal(costoServicioContrato({ ...base, netoInfanteVigencia: 40 }), 240);
    assert.equal(costoServicioContrato({ ...base, netoInfanteVigencia: 0 }), 200);
  });
  test("recargo de individual solo con 1 pax por persona", () => {
    assert.equal(costoServicioContrato({ ...base, paxConSilla: 1, numMenoresDeDos: 0, totalPax: 1, netoInfanteVigencia: null, recargoIndividual: 30 }), 130);
  });
  test("reservar/actions.ts: el costo (y su CxP) sale de costoServicioContrato y ya no lee srv.precio_infante", () => {
    const a = src("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(a, /costoServicioContrato\(/);
    assert.doesNotMatch(a, /\?\?\s*srv\?\.precio_infante/);
    assert.match(a, /pushCxP\(tipoProveedorCxpServicio\(categoria\), srv\?\.nombre \?\? "Servicio", costoServ,/, "la CxP usa el mismo costoServ");
  });
});

describe("aviso de infantes: sobre las vigencias aplicables, no sobre el precio base", () => {
  const sv = (infante: number | null): VigenciasServicio => ({
    servicioId: 1, nombre: "Traslado", grupos: [], conFranjas: new Set(),
    temporadas: [{ nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2027-12-31", precio_persona: 100, precio_infante: infante }],
  });
  const ventana = { desde: "2026-11-01", hasta: "2026-11-05" };
  test("vigencia sin precio_infante: avisa (una vez)", () => {
    assert.deepEqual(serviciosSinPrecioInfanteVigencias([{ nombre: "Traslado", modo: "persona", vigencias: sv(null) }], ventana, HOY), ["Traslado"]);
  });
  test("vigencia con precio_infante (incluido $0): no avisa", () => {
    assert.deepEqual(serviciosSinPrecioInfanteVigencias([{ nombre: "Traslado", modo: "persona", vigencias: sv(0) }], ventana, HOY), []);
    assert.deepEqual(serviciosSinPrecioInfanteVigencias([{ nombre: "Traslado", modo: "persona", vigencias: sv(25) }], ventana, HOY), []);
  });
  test("sin vigencias o ventana sin cobertura: no inventa un aviso", () => {
    assert.deepEqual(serviciosSinPrecioInfanteVigencias([{ nombre: "Traslado", modo: "persona", vigencias: undefined }], ventana, HOY), []);
    assert.deepEqual(serviciosSinPrecioInfanteVigencias([{ nombre: "Traslado", modo: "persona", vigencias: sv(null) }], { desde: "2030-01-01", hasta: "2030-01-05" }, HOY), []);
  });
  test("modo grupo no avisa; dos vigencias aplicables sin infante avisan una sola vez", () => {
    assert.deepEqual(serviciosSinPrecioInfanteVigencias([{ nombre: "Tour", modo: "grupo", vigencias: sv(null) }], ventana, HOY), []);
    const dos = sv(null);
    dos.temporadas.push({ nombre: "V2", fecha_inicio: "2026-01-01", fecha_fin: "2027-12-31", precio_persona: 120, precio_infante: null, prioridad: 2 } as never);
    assert.deepEqual(serviciosSinPrecioInfanteVigencias([{ nombre: "Traslado", modo: "persona", vigencias: dos }], ventana, HOY), ["Traslado"]);
  });
  test("paquetes/actions.ts ya no deriva el aviso de servicios_adicionales.precio_infante", () => {
    const a = src("app/(dashboard)/dashboard/paquetes/actions.ts");
    assert.match(a, /serviciosSinPrecioInfanteVigencias\(/);
    assert.doesNotMatch(a, /precioInfante: \(sv\.servicios_adicionales as unknown as \{ precio_infante/);
  });
});

describe("origen real de ServicioGrupoIncluido.rangos: siempre incluidoEnEstadia (vigencia)", () => {
  test("los tres constructores toman los rangos de la vigencia, no de la tarifa base", () => {
    assert.match(src("lib/reservar/liquidacionHotel.ts"), /rangos: inc\.rangos,/);
    assert.match(src("lib/reservar/computoReservaBernalo.ts"), /rangos: resueltos\.get\(s\.servicio_id\)\?\.rangos \?\? \[\]/);
    assert.doesNotMatch(src("lib/reservar/serviciosPaquete.ts"), /temporada GENERAL/);
  });
});

describe("precioServicio en modo grupo: ninguna ruta de venta puede caer al rango más alto sin cobertura", () => {
  const publicados = [{ pax_desde: 1, pax_hasta: 4, precio: 100 }];
  test("caracterización: precioServicio SÍ cae al rango más alto cuando el pax no entra (por eso cada llamador debe verificar antes)", () => {
    assert.equal(precioServicio("grupo", null, publicados, 5), 100);
  });
  test("rangoCubrePax: el rango PUBLICADO 1-4 no cubre 5 pax aunque la vigencia (1-6) sí", () => {
    assert.equal(rangoCubrePax(publicados, 5), false);
    assert.equal(rangoCubrePax([...publicados, { pax_desde: 5, pax_hasta: 8, precio: 90 }], 5), true);
    assert.equal(rangoCubrePax([], 1), false);
    assert.equal(rangoCubrePax(publicados, 4), true);
  });
  test("computo.ts (reserva interna): verifica que el rango PUBLICADO cubra el pax ANTES de precioServicio", () => {
    const c = src("lib/reservar/computo.ts");
    const guardia = c.indexOf("rangoCubrePax(s.grupos, paxServAdulto)");
    const llamada = c.indexOf("precioServicio(s.modo, s.personaPvp, s.grupos, paxServAdulto)");
    assert.ok(guardia > 0, "falta la guardia de cobertura sobre los rangos publicados");
    assert.ok(llamada > 0 && guardia < llamada, "la guardia debe ir antes del cálculo del precio");
  });
});
