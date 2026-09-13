import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolverTemporadaEstadia } from "../lib/calc/resolverTemporadaEstadia.ts";
import {
  orquestarCotizacionAlojamientoBernalo,
  type DatosOrquestacionBernalo,
  type ResultadoOrquestacionBernalo,
} from "../lib/calc/orquestarCotizacionAlojamientoBernalo.ts";
import type { TemporadaRango } from "../lib/calc/paquetes.ts";
import type { HabitacionOcupacion } from "../lib/calc/ocupacionHabitacion.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3C Bernalo — calendario autoritativo (`resolverTemporadaEstadia`,
// puro, ejecutable) + orquestación completa (`orquestarCotizacionAlojamientoBernalo`,
// puro, ejecutable — recibe filas ya leídas). La frontera server-side real
// (`lib/reservar/resolverCotizacionAlojamientoBernalo.ts`, que hace las 3
// consultas con cliente de sesión) no es ejecutable bajo `node --test`
// (toca Supabase/Next) — se verifica por inspección de su código fuente,
// mismo criterio que el resto de wiring tests del repo.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteBoundary = readFileSync(join(raiz, "lib/reservar/resolverCotizacionAlojamientoBernalo.ts"), "utf8");
const fuenteOrquestador = readFileSync(join(raiz, "lib/calc/orquestarCotizacionAlojamientoBernalo.ts"), "utf8");
const fuenteResolverTemporada = readFileSync(join(raiz, "lib/calc/resolverTemporadaEstadia.ts"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join("\n");
}
const codigoBoundary = sinComentarios(fuenteBoundary);
const codigoOrquestador = sinComentarios(fuenteOrquestador);
const codigoResolverTemporada = sinComentarios(fuenteResolverTemporada);

const HOY = "2026-01-01";

function temporada(over: Partial<TemporadaRango> & { nombre: string }): TemporadaRango {
  return {
    fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
    tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// § resolverTemporadaEstadia — calendario
// ─────────────────────────────────────────────────────────────────────────

describe("resolverTemporadaEstadia — entrada inclusiva y salida exclusiva", () => {
  const ALTA = temporada({ nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10" });
  const BAJA = temporada({ nombre: "BAJA", fecha_inicio: "2026-12-11", fecha_fin: "2026-12-31" });

  test("la noche de fechaRegreso NO se cuenta: estadía 2026-12-10→2026-12-11 es UNA noche (la del 10, ALTA), nunca toca BAJA (11)", () => {
    const r = resolverTemporadaEstadia([ALTA, BAJA], "2026-12-10", "2026-12-11", HOY);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.noches, 1);
      assert.equal(r.temporada, "ALTA");
    }
  });

  test("la noche de fechaIda SÍ se cuenta: estadía 2026-12-01→2026-12-03 incluye la noche del 01 y del 02 (ambas ALTA, adentro del rango 01-10)", () => {
    const r = resolverTemporadaEstadia([ALTA, BAJA], "2026-12-01", "2026-12-03", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.noches, 2);
  });
});

describe("resolverTemporadaEstadia — una temporada para todas las noches", () => {
  test("toda la estadía cae en la misma temporada: éxito con ese nombre", () => {
    const ALTA = temporada({ nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2027-01-31" });
    const r = resolverTemporadaEstadia([ALTA], "2026-12-15", "2026-12-20", HOY);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.temporada, "ALTA"); assert.equal(r.noches, 5); }
  });
});

describe("resolverTemporadaEstadia — cruce de temporadas bloqueado", () => {
  test("la estadía cruza ALTA y BAJA: estadia_multitemporada_no_soportada, con ambas temporadas y las fechas", () => {
    const ALTA = temporada({ nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-15" });
    const BAJA = temporada({ nombre: "BAJA", fecha_inicio: "2026-12-16", fecha_fin: "2026-12-31" });
    const r = resolverTemporadaEstadia([ALTA, BAJA], "2026-12-14", "2026-12-18", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.codigo, "estadia_multitemporada_no_soportada");
      assert.deepEqual((r.contexto.temporadas as string[]).sort(), ["ALTA", "BAJA"]);
      assert.equal(r.contexto.fechaIda, "2026-12-14");
      assert.equal(r.contexto.fechaRegreso, "2026-12-18");
    }
  });
});

describe("resolverTemporadaEstadia — blackout bloqueado con código propio, distinto de 'sin cobertura'", () => {
  test("una noche cae en un blackout de la única temporada que la cubriría: código 'blackout' (NO 'temporada_no_resuelta'), con la fecha exacta", () => {
    const ALTA = temporada({
      nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31",
      blackouts: [{ fecha_inicio: "2026-12-25", fecha_fin: "2026-12-25" }],
    });
    const r = resolverTemporadaEstadia([ALTA], "2026-12-24", "2026-12-27", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.codigo, "blackout");
      assert.equal(r.contexto.fecha, "2026-12-25");
      assert.match(r.mensaje, /blackout/i);
    }
  });

  test("una noche sin NINGUNA temporada configurada (ninguna la cubre, ni siquiera con blackout): código 'temporada_no_resuelta', con la fecha exacta", () => {
    const ALTA = temporada({ nombre: "ALTA", fecha_inicio: "2026-11-01", fecha_fin: "2026-11-30" }); // no cubre diciembre
    const r = resolverTemporadaEstadia([ALTA], "2026-12-24", "2026-12-27", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.codigo, "temporada_no_resuelta");
      assert.equal(r.contexto.fecha, "2026-12-24");
    }
  });

  test("blackout y sin cobertura generan códigos DISTINTOS entre sí, ambos con la noche exacta que falló", () => {
    const conBlackout = temporada({
      nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31",
      blackouts: [{ fecha_inicio: "2026-12-25", fecha_fin: "2026-12-25" }],
    });
    const rBlackout = resolverTemporadaEstadia([conBlackout], "2026-12-25", "2026-12-26", HOY);
    const rSinCobertura = resolverTemporadaEstadia([], "2026-12-25", "2026-12-26", HOY);
    assert.equal(rBlackout.ok, false);
    assert.equal(rSinCobertura.ok, false);
    if (!rBlackout.ok && !rSinCobertura.ok) {
      assert.notEqual(rBlackout.codigo, rSinCobertura.codigo);
      assert.equal(rBlackout.codigo, "blackout");
      assert.equal(rSinCobertura.codigo, "temporada_no_resuelta");
      assert.equal(rBlackout.contexto.fecha, "2026-12-25");
      assert.equal(rSinCobertura.contexto.fecha, "2026-12-25");
    }
  });
});

describe("resolverTemporadaEstadia — prioridad y temporada seleccionada permanecen idénticas", () => {
  test("con dos temporadas superpuestas, sigue ganando la de mayor prioridad (mismo criterio de siempre)", () => {
    const base = temporada({ nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 1 });
    const promo = temporada({ nombre: "PROMO", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 5 });
    const r = resolverTemporadaEstadia([base, promo], "2026-12-10", "2026-12-12", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.temporada, "PROMO");
  });

  test("una temporada de mayor prioridad en blackout deja pasar a la de menor prioridad que SÍ cubre (misma noche)", () => {
    const base = temporada({ nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 1 });
    const promoConBlackout = temporada({
      nombre: "PROMO", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 5,
      blackouts: [{ fecha_inicio: "2026-12-25", fecha_fin: "2026-12-25" }],
    });
    const r = resolverTemporadaEstadia([base, promoConBlackout], "2026-12-25", "2026-12-26", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.temporada, "BASE");
  });
});

describe("resolverTemporadaEstadia — fechas inválidas / cero noches", () => {
  test("fechaRegreso igual a fechaIda: fechas_invalidas", () => {
    const r = resolverTemporadaEstadia([], "2026-12-10", "2026-12-10", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "fechas_invalidas");
  });

  test("fecha con formato inválido: fechas_invalidas", () => {
    const r = resolverTemporadaEstadia([], "10-12-2026", "2026-12-12", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "fechas_invalidas");
  });
});

describe("resolverTemporadaEstadia.ts — reutiliza resolverNocheDetallado, no reimplementa prioridad/blackouts", () => {
  test("importa resolverNocheDetallado de paquetes.ts en vez de reimplementar la selección por prioridad/blackout", () => {
    assert.match(codigoResolverTemporada, /import\s*\{[\s\S]*resolverNocheDetallado[\s\S]*\}\s*from\s*"\.\/paquetes\.ts"/);
    assert.match(codigoResolverTemporada, /resolverNocheDetallado\(/);
  });

  test("no reimplementa el ordenamiento por prioridad ni la comprobación de blackouts", () => {
    // El mensaje de bloqueo SÍ nombra "blackout" (es diagnóstico, texto para
    // el usuario) — lo que NO debe existir es lógica que LEA esos campos.
    assert.doesNotMatch(codigoResolverTemporada, /\.prioridad\b/);
    assert.doesNotMatch(codigoResolverTemporada, /\.blackouts\b/);
    assert.doesNotMatch(codigoResolverTemporada, /compra_inicio|compra_fin/);
    assert.doesNotMatch(codigoResolverTemporada, /\.sort\(/);
  });
});

describe("paquetes.ts — temporadaVigenteParaFecha mantiene su contrato público anterior", () => {
  test("mismo comportamiento: gana la de mayor prioridad, null si nada resuelve (blackout o sin cobertura, sin distinguir — ese es el punto del contrato viejo)", async () => {
    const { temporadaVigenteParaFecha } = await import("../lib/calc/paquetes.ts");
    const base = temporada({ nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 1 });
    const promo = temporada({ nombre: "PROMO", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 5 });
    const fecha = (iso: string) => new Date(`${iso}T00:00:00`);

    assert.equal(temporadaVigenteParaFecha(fecha("2026-12-10"), [base, promo], HOY), "PROMO");
    assert.equal(temporadaVigenteParaFecha(fecha("2026-12-10"), [], HOY), null);

    const conBlackout = temporada({
      nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31",
      blackouts: [{ fecha_inicio: "2026-12-25", fecha_fin: "2026-12-25" }],
    });
    // Sigue devolviendo null para un blackout — igual que antes de esta
    // ronda; el contrato público de esta función NO distingue el motivo.
    assert.equal(temporadaVigenteParaFecha(fecha("2026-12-25"), [conBlackout], HOY), null);
  });

  test("el parámetro `hoy` con default sigue funcionando (no se volvió obligatorio)", async () => {
    const { temporadaVigenteParaFecha } = await import("../lib/calc/paquetes.ts");
    const ALTA = temporada({ nombre: "ALTA", fecha_inicio: "2020-01-01", fecha_fin: "2099-12-31" });
    // Sin tercer argumento: usa hoyISO() por defecto, como siempre.
    const resultado = temporadaVigenteParaFecha(new Date("2026-06-15T00:00:00"), [ALTA]);
    assert.equal(resultado, "ALTA");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § orquestarCotizacionAlojamientoBernalo — orquestación completa
// ─────────────────────────────────────────────────────────────────────────

const V = "bernalo-2026-fase3c";

function payloadHabitacion(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1", unidadCobro: "habitacion",
    valores: { adulto: 300_000 },
    capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 },
    suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 50_000 }],
    reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
    comisionPct: 20,
    temporada: "ALTA", categoria: "estandar", alimentacion: "PC",
    fuente: null, versionTarifario: V,
    ...over,
  };
}

function filaTarifa(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const payload = (over.payload as Record<string, unknown> | undefined) ?? payloadHabitacion();
  return {
    id: 1, hotel_id: 10,
    tarifa_id: payload.id, version_tarifario: payload.versionTarifario,
    temporada: payload.temporada, categoria: payload.categoria, alimentacion: payload.alimentacion,
    estado: "publicada", fuente_documento: null, fuente_pagina: null, comision_pct: payload.comisionPct,
    payload,
    ...over,
  };
}

const ALTA_TODO_DICIEMBRE = { nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null };

function hab(over: Partial<HabitacionOcupacion> & { id: string }): HabitacionOcupacion {
  return { adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 2, ...over };
}

function baseDatos(over: Partial<DatosOrquestacionBernalo> = {}): DatosOrquestacionBernalo {
  return {
    hotelId: 10,
    modeloTarifario: "unidad",
    temporadasRaw: [ALTA_TODO_DICIEMBRE],
    filasTarifas: [filaTarifa()],
    fechaIda: "2026-12-10",
    fechaRegreso: "2026-12-12",
    hoy: HOY,
    habitaciones: [hab({ id: "hab-1" })],
    ...over,
  };
}

function esperarOk(r: ResultadoOrquestacionBernalo): asserts r is Extract<ResultadoOrquestacionBernalo, { ok: true }> {
  assert.equal(r.ok, true, `se esperaba éxito, se obtuvo bloqueo: ${!r.ok ? `${r.codigo} — ${r.mensaje}` : ""}`);
}
function esperarBloqueada(r: ResultadoOrquestacionBernalo, codigo: string) {
  assert.equal(r.ok, false, "se esperaba un bloqueo, se obtuvo éxito");
  if (!r.ok) assert.equal(r.codigo, codigo);
}

describe("orquestarCotizacionAlojamientoBernalo — hotel que no es 'unidad' bloqueado", () => {
  test("modeloTarifario === 'persona': modelo_no_bernalo", () => {
    const r = orquestarCotizacionAlojamientoBernalo(baseDatos({ modeloTarifario: "persona" }));
    esperarBloqueada(r, "modelo_no_bernalo");
  });

  test("hotel no encontrado (modeloTarifario null): modelo_no_bernalo, fail-closed", () => {
    const r = orquestarCotizacionAlojamientoBernalo(baseDatos({ modeloTarifario: null }));
    esperarBloqueada(r, "modelo_no_bernalo");
  });
});

describe("orquestarCotizacionAlojamientoBernalo — dos habitaciones con igual criterio reutilizan la resolución en lote pero se cotizan separadamente", () => {
  test("dos habitaciones misma categoría/alimentación: UNA sola resolución de tarifa, DOS resultados independientes en la cotización", () => {
    const datos = baseDatos({
      habitaciones: [hab({ id: "hab-1" }), hab({ id: "hab-2" })],
    });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarOk(r);
    assert.equal(r.porHabitacion.length, 2);
    assert.deepEqual(r.porHabitacion.map((ph) => ph.habitacionId).sort(), ["hab-1", "hab-2"]);
    // Misma tarifa (mismo tarifaId/versión) en ambas — vino de la ÚNICA
    // resolución reutilizada, no de dos resoluciones separadas que podrían
    // divergir.
    assert.equal(r.porHabitacion[0].resultado.datosFuente.tarifaId, r.porHabitacion[1].resultado.datosFuente.tarifaId);
    // Snapshots DISTINTOS — cada habitación se cotizó por su cuenta.
    assert.notEqual(r.porHabitacion[0].snapshot, r.porHabitacion[1].snapshot);
  });
});

describe("orquestarCotizacionAlojamientoBernalo — categorías/alimentaciones diferentes resuelven tarifas diferentes", () => {
  test("dos habitaciones con categoría distinta: cada una toma la tarifa que le corresponde a SU clasificación", () => {
    const filaJunior = filaTarifa({
      id: 2, tarifa_id: "t2", version_tarifario: "v2",
      payload: payloadHabitacion({ id: "t2", versionTarifario: "v2", categoria: "junior", valores: { adulto: 500_000 } }),
      categoria: "junior",
    });
    const datos = baseDatos({
      filasTarifas: [filaTarifa(), filaJunior],
      habitaciones: [hab({ id: "hab-estandar", categoria: "estandar" }), hab({ id: "hab-junior", categoria: "junior" })],
    });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarOk(r);
    const estandar = r.porHabitacion.find((ph) => ph.habitacionId === "hab-estandar")!;
    const junior = r.porHabitacion.find((ph) => ph.habitacionId === "hab-junior")!;
    assert.equal(estandar.resultado.datosFuente.tarifaId, "t1");
    assert.equal(junior.resultado.datosFuente.tarifaId, "t2");
    assert.notEqual(estandar.resultado.totalBrutoPorNoche, junior.resultado.totalBrutoPorNoche);
  });
});

describe("orquestarCotizacionAlojamientoBernalo — tarifa ausente, ambigua o incoherente bloquea todo", () => {
  test("tarifa ausente para una clasificación: bloquea la colección completa (sin resultado parcial)", () => {
    const datos = baseDatos({
      habitaciones: [hab({ id: "hab-1" }), hab({ id: "hab-2", categoria: "no-existe" })],
    });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarBloqueada(r, "tarifa_no_encontrada");
    if (!r.ok) assert.equal((r as { habitacionId?: string }).habitacionId, "hab-2");
    assert.equal((r as unknown as { porHabitacion?: unknown }).porHabitacion, undefined);
  });

  test("tarifa ambigua (dos publicadas para la misma clasificación): bloquea todo", () => {
    const otraVersion = filaTarifa({ id: 2, tarifa_id: "t1b", version_tarifario: "v1b", payload: payloadHabitacion({ id: "t1b", versionTarifario: "v1b" }) });
    const datos = baseDatos({ filasTarifas: [filaTarifa(), otraVersion] });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarBloqueada(r, "tarifa_ambigua");
  });

  test("fila incoherente (columna espejo no cuadra con el payload): bloquea todo, sin usar otra fila", () => {
    const incoherente = filaTarifa({ categoria: "estandar", payload: payloadHabitacion({ categoria: "otra-cosa" }) });
    const datos = baseDatos({ filasTarifas: [incoherente] });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarBloqueada(r, "tarifa_invalida");
  });
});

describe("orquestarCotizacionAlojamientoBernalo — dos habitaciones con un niño cada una mantienen cálculos independientes", () => {
  test("cada niño es el primero de SU habitación — nunca se agregan globalmente", () => {
    const datos = baseDatos({
      habitaciones: [
        hab({ id: "hab-1", menores: [{ edadAnios: 5 }] }),
        hab({ id: "hab-2", menores: [{ edadAnios: 9 }] }),
      ],
    });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarOk(r);
    for (const ph of r.porHabitacion) {
      assert.equal(ph.resultado.menoresClasificados.length, 1);
      assert.equal(ph.resultado.cantidadUnidades, 1);
    }
  });
});

describe("orquestarCotizacionAlojamientoBernalo — totales son suma literal del motor", () => {
  test("totalNeto/totalBruto son exactamente la suma de cada resultado por habitación", () => {
    const datos = baseDatos({
      habitaciones: [hab({ id: "hab-1", menores: [{ edadAnios: 5 }] }), hab({ id: "hab-2" })],
    });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarOk(r);
    const sumaNeta = r.porHabitacion.reduce((s, ph) => s + ph.resultado.totalNeto, 0);
    const sumaBruta = r.porHabitacion.reduce((s, ph) => s + ph.resultado.totalBruto, 0);
    assert.equal(r.totalNeto, sumaNeta);
    assert.equal(r.totalBruto, sumaBruta);
    assert.equal(r.hotelId, 10);
    assert.equal(r.temporada, "ALTA");
    assert.equal(r.noches, 2);
  });
});

describe("orquestarCotizacionAlojamientoBernalo — habitación con noches distintas a la estadía bloquea", () => {
  test("HabitacionOcupacion.noches no coincide con la estadía resuelta: habitacion_noches_inconsistente", () => {
    const datos = baseDatos({ habitaciones: [hab({ id: "hab-1", noches: 99 })] });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarBloqueada(r, "habitacion_noches_inconsistente");
  });
});

describe("orquestarCotizacionAlojamientoBernalo — cruce de temporadas se propaga como bloqueo", () => {
  test("la estadía cruza temporadas: la orquestación completa bloquea con estadia_multitemporada_no_soportada", () => {
    const ALTA = { ...ALTA_TODO_DICIEMBRE, fecha_fin: "2026-12-15" };
    const BAJA = { ...ALTA_TODO_DICIEMBRE, nombre: "BAJA", fecha_inicio: "2026-12-16" };
    const datos = baseDatos({ temporadasRaw: [ALTA, BAJA], fechaIda: "2026-12-14", fechaRegreso: "2026-12-18" });
    const r = orquestarCotizacionAlojamientoBernalo(datos);
    esperarBloqueada(r, "estadia_multitemporada_no_soportada");
  });
});

describe("orquestarCotizacionAlojamientoBernalo.ts — reusa los resolvers reales de Fase 3A/3B/3C, sin reimplementar sus reglas", () => {
  test("importa resolverTemporadaEstadia, seleccionarTarifaAlojamientoPublicada y cotizarHabitaciones", () => {
    assert.match(codigoOrquestador, /import\s*\{[\s\S]*resolverTemporadaEstadia[\s\S]*\}\s*from\s*"\.\/resolverTemporadaEstadia\.ts"/);
    assert.match(codigoOrquestador, /import\s*\{[\s\S]*seleccionarTarifaAlojamientoPublicada[\s\S]*\}\s*from\s*"\.\/resolverTarifaAlojamiento\.ts"/);
    assert.match(codigoOrquestador, /import\s*\{[\s\S]*cotizarHabitaciones[\s\S]*\}\s*from\s*"\.\/ocupacionHabitacion\.ts"/);
  });

  test("no ordena/compara por id ni fecha para elegir tarifa (delega esa decisión al resolver de Fase 3B)", () => {
    assert.doesNotMatch(codigoOrquestador, /\.sort\(/);
    assert.doesNotMatch(codigoOrquestador, /created_at/);
  });

  test("no recalcula bruto/comisión/neto/suplementos fuera de los resolvers (solo suma lo ya devuelto, vía cotizarHabitaciones)", () => {
    assert.doesNotMatch(codigoOrquestador, /comisionPct\s*[/*]/);
    assert.doesNotMatch(codigoOrquestador, /suplementosAplicados\s*[:=]\s*\[/);
  });

  test("es puro: no importa Supabase/Next/UI", () => {
    const lineasImport = fuenteOrquestador.split(/\r?\n/).filter((l) => /^\s*import\b/.test(l));
    assert.doesNotMatch(lineasImport.join("\n"), /supabase/i);
    assert.doesNotMatch(lineasImport.join("\n"), /\bnext\//);
    assert.doesNotMatch(codigoOrquestador, /"use (server|client)"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Frontera server-side (`resolverCotizacionAlojamientoBernalo.ts`) —
// verificada por inspección: cliente de sesión, sin consultas N+1.
// ─────────────────────────────────────────────────────────────────────────

describe("resolverCotizacionAlojamientoBernalo.ts — cliente de sesión, sin N+1", () => {
  test("usa el cliente de sesión y nunca importa createAdminClient", () => {
    assert.match(fuenteBoundary, /from "@\/lib\/supabase\/server"/);
    assert.doesNotMatch(codigoBoundary, /createAdminClient/);
    assert.doesNotMatch(codigoBoundary, /service_role/i);
  });

  test("exactamente 3 consultas .from(...) en todo el archivo, ninguna dentro de un bucle", () => {
    const consultas = [...fuenteBoundary.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    assert.deepEqual(consultas.sort(), ["hotel_tarifas_unidad", "hotel_temporadas", "hoteles"]);
    // Ninguna de las 3 líneas de consulta vive dentro de un for/while/.map/.forEach.
    for (const tabla of consultas) {
      const idx = fuenteBoundary.indexOf(`.from("${tabla}")`);
      const antes = fuenteBoundary.slice(Math.max(0, idx - 300), idx);
      assert.doesNotMatch(antes, /for\s*\([^)]*\)\s*\{[^}]*$/);
      assert.doesNotMatch(antes, /\.(map|forEach)\(\s*\([^)]*\)\s*=>\s*\{?[^}]*$/);
    }
  });

  test("consulta hotel_tarifas_unidad filtrando por hotel_id y estado publicada (no trae borrador/inactiva)", () => {
    assert.match(fuenteBoundary, /\.from\("hotel_tarifas_unidad"\)[\s\S]{0,120}\.eq\("hotel_id", input\.hotelId\)/);
    assert.match(fuenteBoundary, /\.eq\("estado", "publicada"\)/);
  });

  test("delega toda la decisión al orquestador puro (no reimplementa nada de la lógica aquí)", () => {
    assert.match(codigoBoundary, /orquestarCotizacionAlojamientoBernalo\(\{/);
  });
});
