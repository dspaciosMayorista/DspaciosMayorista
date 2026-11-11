import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  liquidarHotelNoches, liquidarHotelNochesConTemporadas, liquidarHotelMasBarato, minNochesAplicable, toTemporadaRango,
} from "../lib/calc/paquetes.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { filasPorClave, netosDeColumna, clavesPrecioFinal } from "../lib/calc/netosPorTemporada.ts";
import { claveNeto } from "../lib/calc/gruposDias.ts";
import { resolverReglaEdadEstadiaSegura, type FilaTarifaHotelEdadCruda } from "../lib/calc/reglaEdadTarifa.ts";
import {
  registrarConflictoEmpate, _vaciarRegistroConflictos, _tamanoRegistroConflictos, TTL_MS, MAX_ENTRADAS,
} from "../lib/calc/registroConflictos.ts";

// ─────────────────────────────────────────────────────────────────────────
// #43/#60 incremento 2 — motor por noche con grupos de días (historial AB, especificación §3).
// Los grupos ACTIVOS solo existen aquí, en memoria: en la base la migración 293 los mantiene inactivos.
// Fechas: el 1 de enero de 2027 es viernes ⇒ jue 7, vie 8, sáb 9, dom 10 de enero.
// ─────────────────────────────────────────────────────────────────────────
const HOY = "2026-11-11";
const FS = { id: "g-fs", dias: [5, 6, 7], activo: true };     // viernes a domingo
const SEMANA = { id: "g-sem", dias: [1, 2, 3, 4], activo: true };

const vig = (over: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: "2027-01-01", fecha_fin: "2027-12-31", prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...over,
});
const tar = (temporada: string, over: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: 100_000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...over,
});

/** Liquida como lo hacen computo, vigencia y la generación: armado compartido + motor. */
function liquidar(vigs: FilaTemporadaHotelRaw[], tarifas: FilaTarifaHotelRaw[], ida: string, n: number, col = "neto_doble") {
  return liquidarHotelNoches({
    fechaIda: ida, numNoches: n, temporadas: vigs.map(toTemporadaRango),
    netoPorTemporada: netosDeColumna(filasPorClave(tarifas), col), hoy: HOY, regimen: "PAM",
  });
}

// Base del ejemplo §3.6: BAJA todo el año 100.000; ALTA solo vie–dom 180.000 (prioridad mayor).
const BAJA = vig({ nombre: "BAJA" });
const ALTA_FS = vig({ nombre: "ALTA", prioridad: 2, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", hotel_temporada_grupos: [FS] });
const TARIFAS_EJEMPLO = [tar("BAJA", { neto_doble: 100_000, neto_sencilla: 120_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 180_000, neto_sencilla: 200_000 })];

describe("1. Cobertura por día (§3.1) y ejemplo de referencia (§3.6)", () => {
  test("jueves → domingo = 100.000 + 180.000 + 180.000 = 460.000", () => {
    assert.equal(liquidar([BAJA, ALTA_FS], TARIFAS_EJEMPLO, "2027-01-07", 3), 460_000);
  });
  test("el jueves no lo cubre ningún grupo de ALTA: lo resuelve BAJA; el procedente refleja ambas", () => {
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2027-01-07", numNoches: 3, temporadas: [BAJA, ALTA_FS].map(toTemporadaRango),
      netoPorTemporada: netosDeColumna(filasPorClave(TARIFAS_EJEMPLO), "neto_doble"), hoy: HOY, regimen: "PAM",
    });
    assert.equal(r?.total, 460_000);
    assert.deepEqual(r?.temporadasTarifa.sort(), ["ALTA", "BAJA"]);
    assert.deepEqual(r?.procedencia.map((p) => p.temporadaGanadora), ["BAJA", "ALTA"]);
  });
  test("una noche sin vigencia aplicable: la estadía no se ofrece (§3.3)", () => {
    const soloAlta = [ALTA_FS];
    assert.equal(liquidar(soloAlta, TARIFAS_EJEMPLO, "2027-01-07", 3), null); // el jueves no lo cubre nada
    assert.equal(liquidar(soloAlta, TARIFAS_EJEMPLO, "2027-01-08", 2), 360_000); // vie y sáb; la salida no cobra
  });
});

describe("2. Disponibilidad por acomodación (§3.2): sin rescate desde otra vigencia", () => {
  const tarifas = [tar("BAJA", { neto_doble: 100_000, neto_sencilla: 120_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: null, neto_sencilla: 200_000 })];
  test("el grupo cubre el viernes sin tarifa doble: la doble NO se vende y no cae a BAJA", () => {
    assert.equal(liquidar([BAJA, ALTA_FS], tarifas, "2027-01-07", 3, "neto_doble"), null);
  });
  test("la sencilla sí tiene tarifa: 120.000 + 200.000 + 200.000", () => {
    assert.equal(liquidar([BAJA, ALTA_FS], tarifas, "2027-01-07", 3, "neto_sencilla"), 520_000);
  });
  test("sin grupos (legado) la misma falta SÍ cae a la vigencia inferior, como hoy", () => {
    const altaSinGrupos = vig({ nombre: "ALTA", prioridad: 2, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31" });
    const legado = [tar("BAJA", { neto_doble: 100_000 }), tar("ALTA", { neto_doble: null, neto_sencilla: 200_000 })];
    assert.equal(liquidar([BAJA, altaSinGrupos], legado, "2027-01-07", 3), 300_000);
  });
  test("niño 0 es gratis y válido; niño nulo no se vende (sin cambio de semántica)", () => {
    const t = [tar("BAJA", { neto_nino: 0 }), tar("ALTA", { grupo_id: "g-fs", neto_nino: 0 })];
    assert.equal(liquidar([BAJA, ALTA_FS], t, "2027-01-07", 3, "neto_nino"), 0);
    const t2 = [tar("BAJA", { neto_nino: 0 }), tar("ALTA", { grupo_id: "g-fs", neto_nino: null })];
    assert.equal(liquidar([BAJA, ALTA_FS], t2, "2027-01-07", 3, "neto_nino"), null);
  });
});

describe("3. Grupos inactivos (estado real de la base): todo igual que sin grupos", () => {
  const altaInactiva = vig({ nombre: "ALTA", prioridad: 2, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", hotel_temporada_grupos: [{ ...FS, activo: false }] });
  const altaSinGrupos = vig({ nombre: "ALTA", prioridad: 2, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31" });
  const t = [tar("BAJA"), tar("ALTA", { neto_doble: 150_000 })];
  test("mismo total con grupos inactivos que sin grupos (450.000)", () => {
    assert.equal(liquidar([BAJA, altaInactiva], t, "2027-01-07", 3), 450_000);
    assert.equal(liquidar([BAJA, altaSinGrupos], t, "2027-01-07", 3), 450_000);
  });
  test("toTemporadaRango descarta los inactivos y no agrega campos si no hay activos", () => {
    const r = toTemporadaRango(altaInactiva);
    assert.equal("grupos" in r, false);
  });
});

describe("4. Empates de prioridad (N4, §3.7)", () => {
  let avisos: unknown[] = [];
  const original = console.warn;
  beforeEach(() => { _vaciarRegistroConflictos(); avisos = []; console.warn = (...a: unknown[]) => { avisos.push(a); }; });
  const OTRA = vig({ nombre: "OTRA", prioridad: 2, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31" });
  const t = [...TARIFAS_EJEMPLO, tar("OTRA", { neto_doble: 170_000 })];

  test("misma prioridad, una con grupos y ambas con precio el viernes: sin precio, en cualquier orden de lectura", () => {
    try {
      assert.equal(liquidar([BAJA, ALTA_FS, OTRA], t, "2027-01-08", 1), null);
      assert.equal(liquidar([BAJA, OTRA, ALTA_FS], t, "2027-01-08", 1), null);
      assert.equal(liquidar([BAJA, ALTA_FS, OTRA], [...t].reverse(), "2027-01-08", 1), null);
    } finally { console.warn = original; }
  });
  test("el jueves el grupo no cubre: no compiten y gana OTRA (sin empate)", () => {
    try { assert.equal(liquidar([BAJA, ALTA_FS, OTRA], t, "2027-01-07", 1), 170_000); assert.equal(avisos.length, 0); }
    finally { console.warn = original; }
  });
  test("el grupo cubre sin precio para la acomodación: no compite y gana la otra (W.3.5)", () => {
    const t2 = [tar("BAJA"), tar("ALTA", { grupo_id: "g-fs", neto_doble: null, neto_sencilla: 1 }), tar("OTRA", { neto_doble: 170_000 })];
    try { assert.equal(liquidar([BAJA, ALTA_FS, OTRA], t2, "2027-01-08", 1), 170_000); assert.equal(avisos.length, 0); }
    finally { console.warn = original; }
  });
  test("mil cotizaciones con el mismo conflicto producen UN registro", () => {
    try {
      for (let i = 0; i < 1000; i++) liquidar([BAJA, ALTA_FS, OTRA], t, "2027-01-08", 1);
      assert.equal(avisos.length, 1);
    } finally { console.warn = original; }
  });
  test("dos vigencias SIN grupos empatadas: como hoy, decide el orden de lectura (legado)", () => {
    const A = vig({ nombre: "A", prioridad: 3 }); const B = vig({ nombre: "B", prioridad: 3 });
    const tt = [tar("A", { neto_doble: 100_000 }), tar("B", { neto_doble: 150_000 })];
    try {
      assert.equal(liquidar([A, B], tt, "2027-01-08", 1), 100_000);
      assert.equal(liquidar([B, A], tt, "2027-01-08", 1), 150_000);
      assert.equal(avisos.length, 0);
    } finally { console.warn = original; }
  });
  test("una promoción con la misma prioridad que una base con grupos: empate (W.3.6)", () => {
    const PROMO = vig({ nombre: "PROMO", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31" });
    try { assert.equal(liquidar([BAJA, ALTA_FS, PROMO], [...TARIFAS_EJEMPLO, tar("PROMO", { neto_doble: 162_000 })], "2027-01-08", 1), null); }
    finally { console.warn = original; }
  });
});

describe("5. Fuera de este incremento: promociones por grupo y «Desde» aproximado", () => {
  test("una promoción con grupos activos los ignora y se resuelve como hoy (fila de todos los días)", () => {
    const PROMO = vig({ nombre: "PROMO", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10, hotel_temporada_grupos: [FS] });
    assert.equal(liquidar([BAJA, PROMO], [tar("BAJA"), tar("PROMO", { neto_doble: 90_000 })], "2027-01-07", 3), 270_000);
  });
  test("«noche más barata × noches» con grupos activos: no se publica (falla cerrado)", () => {
    const args = (vigs: FilaTemporadaHotelRaw[]) => ({
      desde: "2027-01-04", hasta: "2027-01-10", numNoches: 3, temporadas: vigs.map(toTemporadaRango),
      netoPorTemporada: netosDeColumna(filasPorClave(TARIFAS_EJEMPLO), "neto_doble"), hoy: HOY, regimen: "PAM",
    });
    assert.equal(liquidarHotelMasBarato(args([BAJA, ALTA_FS])), null);
    const altaInactiva = vig({ nombre: "ALTA", prioridad: 2, hotel_temporada_grupos: [{ ...FS, activo: false }] });
    assert.equal(liquidarHotelMasBarato(args([BAJA, altaInactiva])), 300_000); // sin grupos activos: como hoy
  });
  test("mínimo de noches: una vigencia con grupos que no cubre el día de entrada no lo fija", () => {
    const altaMin = vig({ nombre: "ALTA", prioridad: 2, min_noches: 3, hotel_temporada_grupos: [FS] });
    const ts = [BAJA, altaMin].map(toTemporadaRango);
    assert.equal(minNochesAplicable(ts, "2027-01-07", HOY), 1); // jueves: aplica BAJA
    assert.equal(minNochesAplicable(ts, "2027-01-08", HOY), 3); // viernes: aplica ALTA
  });
});

describe("6. Armado compartido del mapa de netos", () => {
  test("duplicados de todos los días: gana la ÚLTIMA (comportamiento previo)", () => {
    const m = netosDeColumna(filasPorClave([tar("ALTA", { neto_doble: 100_000 }), tar("ALTA", { neto_doble: 120_000 })]), "neto_doble");
    assert.deepEqual(m, { ALTA: 120_000 });
  });
  test("una fila por grupo no pisa la de todos los días ni la de otro grupo", () => {
    const m = netosDeColumna(filasPorClave([
      tar("ALTA", { neto_doble: 1 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 2 }), tar("ALTA", { grupo_id: "g-sem", neto_doble: 3 }),
    ]), "neto_doble");
    assert.deepEqual(m, { ALTA: 1, [claveNeto("ALTA", "g-fs")]: 2, [claveNeto("ALTA", "g-sem")]: 3 });
  });
  test("precio final autoritativo por clave", () => {
    const s = clavesPrecioFinal(filasPorClave([tar("P", { precio_final_autoritativo: true }), tar("Q", { grupo_id: "g", precio_final_autoritativo: true }), tar("R")]));
    assert.deepEqual([...s].sort(), ["P", claveNeto("Q", "g")].sort());
  });
});

describe("7. Paridad: evaluarHotelPorFechas (cotización/carrito) = armado compartido + motor (reserva, vigencia, generación)", () => {
  const vigs = [BAJA, vig({ nombre: "ALTA", prioridad: 2, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", hotel_temporada_grupos: [FS, SEMANA] })];
  const tarifas = [tar("BAJA"), tar("ALTA", { grupo_id: "g-sem", neto_doble: 130_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 180_000 })];
  const datos: DatosHotelPaquete = {
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2027-01-01", fecha_viaje_fin: "2027-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas: vigs, tarifas, serviciosIncluidos: [], blackouts: [],
  };
  for (const [ida, n, esperado] of [["2027-01-04", 7, 4 * 130_000 + 3 * 180_000], ["2027-01-07", 3, 130_000 + 2 * 180_000], ["2027-01-10", 2, 180_000 + 130_000]] as const) {
    test(`${ida}, ${n} noches: ${esperado}`, () => {
      const motor = liquidar(vigs, tarifas, ida, n);
      assert.equal(motor, esperado);
      const ev = evaluarHotelPorFechas(datos, ida, n);
      assert.equal(ev?.combos[0]?.netos?.["doble"], esperado);
    });
  }
});

describe("8. Regla de edad con filas por grupo", () => {
  const base = { tipo_habitacion: "Estandar", alimentacion: "PAM", temporada: "ALTA" };
  const edad = (g: string | null, nMax: number): FilaTarifaHotelEdadCruda =>
    ({ ...base, grupo_id: g, edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: nMax });
  const correr = (filas: FilaTarifaHotelEdadCruda[]) =>
    resolverReglaEdadEstadiaSegura({ filas, categoria: "Estandar", regimen: "PAM", temporadasUsadas: ["ALTA"], general: { infanteMax: 2, ninoMax: 10 } as never });
  test("dos grupos con la misma regla: válido", () => {
    const r = correr([edad("g-fs", 11), edad("g-sem", 11)]);
    assert.equal(r.ok, true);
  });
  test("dos grupos con reglas distintas: error explícito", () => {
    const r = correr([edad("g-fs", 11), edad("g-sem", 12)]);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /grupo de días/);
  });
  test("duplicado de todos los días: sigue siendo error, como antes", () => {
    const r = correr([edad(null, 11), edad(null, 11)]);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /duplicada/);
  });
});

describe("9. Registro de conflictos: acotado, con caducidad, por instancia", () => {
  beforeEach(() => _vaciarRegistroConflictos());
  const c = { vigencias: ["A", "B"], prioridad: 2, fecha: "2027-01-08", clave: "#1,#2|PAM" };
  const nada = () => {};
  test("se registra una vez dentro del TTL y de nuevo al caducar", () => {
    assert.equal(registrarConflictoEmpate(c, 0, nada), true);
    assert.equal(registrarConflictoEmpate(c, TTL_MS - 1, nada), false);
    assert.equal(registrarConflictoEmpate(c, TTL_MS, nada), true);
  });
  test("nunca guarda más de MAX_ENTRADAS", () => {
    for (let i = 0; i < MAX_ENTRADAS + 200; i++) registrarConflictoEmpate({ ...c, clave: `k${i}` }, i, nada);
    assert.ok(_tamanoRegistroConflictos() <= MAX_ENTRADAS);
  });
});
