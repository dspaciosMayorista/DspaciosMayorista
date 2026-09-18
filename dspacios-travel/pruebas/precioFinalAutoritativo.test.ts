import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolverNetoNocheDetallado, liquidarHotelNoches, liquidarHotelNochesConTemporadas,
  liquidarHotelMasBarato, liquidarHotelMasBaratoConTemporada, resolverNocheGratisDetallado,
  type TemporadaRango, type ProcedenciaNoche,
} from "../lib/calc/paquetes.ts";
import { generarTarifasDubai, type DubaiParams, type TarifaGenerada } from "../lib/calc/calculadoras.ts";
import {
  resolverReglaEdadEstadiaSegura, normalizarReglaEdadGeneral, type FilaTarifaHotelEdadCruda,
} from "../lib/calc/reglaEdadTarifa.ts";
import { extraerCondicionesTarifa } from "../lib/calc/condicionesTarifa.ts";
import { columnasProcedencia } from "../lib/tarifario/procedenciaTarifario.ts";

// ─────────────────────────────────────────────────────────────────────────
// Defecto confirmado: `generarTarifasDubai` crea, por cada `promos[]`, una
// fila de `tarifa_hotel` bajo `temporada = temporadaPromo` con el precio
// FINAL ya calculado (descuento + suplemento propio + modificadores +
// edades/condiciones propias). Pero `resolverNetoNocheDetallado`, cuando la
// vigencia ganadora es `descuento_pct`/`descuento_monto`, IGNORABA esa fila
// por completo: volvía a tomar la fila BASE y reaplicaba el descuento
// (perdiendo el suplemento propio y las edades propias), devolviendo
// `temporadaTarifa: base.nombre` (nunca el nombre de la promo), lo que además
// impedía que la condición de tarifa de la promoción llegara a cotización/
// contrato (`extraerCondicionesTarifa` busca `notas` por nombre de temporada).
//
// Migración 179 (PROPUESTA): `tarifa_hotel.precio_final_autoritativo` marca
// la fila promocional como autoritativa; el motor recibe el set de nombres
// marcados (`precioFinalTemporadas`) y, si la vigencia ganadora está en ese
// set y tiene neto cargado para el combo, usa su propia fila DIRECTO.
//
// Estas pruebas demuestran el comportamiento ANTES (llamando sin
// `precioFinalTemporadas`, exactamente como se llamaba en todo el motor
// antes de esta ronda) y DESPUÉS (con el set, como ahora hacen computo.ts/
// liquidacionHotel.ts/paquetes-actions.ts) del mismo escenario real.
// ─────────────────────────────────────────────────────────────────────────

const hoy = "2026-01-01";

function escenarioPromo(): {
  temporadas: TemporadaRango[];
  filas: TarifaGenerada[];
  netoPorTemporada: Record<string, number | null>;
  precioFinalTemporadas: Set<string>;
} {
  const params: DubaiParams = {
    regimen_base: "PC",
    modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
    suplementos: [{ regimen: "PAM", monto: 20000 }],
    bases: [{ categoria: "estandar", temporada: "BAJA", precio: 100000 }],
    promos: [{
      temporadaBase: "BAJA",
      temporadaPromo: "PROMO10",
      regimen: "PC", // = regimen_base — una promo SÍ puede llevar suplemento propio aquí
      descuentoPct: 10,
      usarSuplementoPropio: true,
      suplementoPropioMonto: 5000,
      usarEdadesPropias: true,
      edadesPropias: { infanteMin: 0, infanteMax: 1, ninoMin: 2, ninoMax: 9 },
      condicionesPropias: "No reembolsable. No endosable.",
    }],
  };
  const filas = generarTarifasDubai(params);

  const temporadas: TemporadaRango[] = [
    { nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" },
    // Prioridad más alta que BAJA — misma que declararía el usuario en
    // Temporadas al crear la vigencia de la promoción. `descuento_valor: 10`
    // configurado a mano por el usuario (fuente DISTINTA de `promo.descuentoPct`
    // en `generarTarifasDubai` — a propósito, para que el escenario "legacy"
    // (sin marca) recalcule con SU PROPIO número, no con el de la calculadora).
    { nombre: "PROMO10", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10 },
  ];

  const filaCombo = (temp: string) => filas.find((f) => f.temporada === temp && f.tipo_habitacion === "estandar" && f.alimentacion === "PC");
  const filaBase = filaCombo("BAJA")!;
  const filaPromo = filaCombo("PROMO10")!;
  const netoPorTemporada: Record<string, number | null> = {
    BAJA: filaBase.neto_doble,
    PROMO10: filaPromo.neto_doble,
  };
  const precioFinalTemporadas = new Set<string>();
  for (const f of filas) if (f.precio_final_autoritativo && f.temporada) precioFinalTemporadas.add(f.temporada);

  return { temporadas, filas, netoPorTemporada, precioFinalTemporadas };
}

describe("generarTarifasDubai — identidad de precio final (migración 179)", () => {
  test("la fila de BASE nunca lleva precio_final_autoritativo/temporada_base", () => {
    const { filas } = escenarioPromo();
    const base = filas.find((f) => f.temporada === "BAJA" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    assert.equal(base.precio_final_autoritativo, undefined);
    assert.equal(base.temporada_base, undefined);
  });

  test("la fila de PROMOCIÓN lleva precio_final_autoritativo=true y temporada_base=la base de la que se derivó", () => {
    const { filas } = escenarioPromo();
    const promo = filas.find((f) => f.temporada === "PROMO10" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    assert.equal(promo.precio_final_autoritativo, true);
    assert.equal(promo.temporada_base, "BAJA");
  });

  test("el precio final de la promo incluye el suplemento propio (5.000) — la base NO lo incluye para el régimen base", () => {
    const { filas } = escenarioPromo();
    const base = filas.find((f) => f.temporada === "BAJA" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    const promo = filas.find((f) => f.temporada === "PROMO10" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    assert.equal(base.neto_doble, 100000); // base × 1, sin suplemento (régimen base)
    // Regla comercial (corrección posterior): (100000 + 5000) × (1 − 10%) = 94500
    // — el suplemento propio (5000) entra al valor COMPLETO del régimen ANTES
    // del descuento, y el descuento lo cubre también. NUNCA 90000 (que sería
    // ignorar el suplemento propio por completo) ni 95000 (que sería sumar el
    // suplemento DESPUÉS del descuento, sin descontarlo — el error original
    // de esta ronda, corregido en `generarTarifasDubai`).
    assert.equal(promo.neto_doble, 94500);
  });

  test("la promo lleva su condición propia en `notas`; la base no lleva notas", () => {
    const { filas } = escenarioPromo();
    const base = filas.find((f) => f.temporada === "BAJA" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    const promo = filas.find((f) => f.temporada === "PROMO10" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    assert.equal(base.notas, undefined);
    assert.equal(promo.notas, "No reembolsable. No endosable.");
  });

  test("la promo lleva sus edades propias (infante 0-1, niño 2-9); la base no lleva override", () => {
    const { filas } = escenarioPromo();
    const base = filas.find((f) => f.temporada === "BAJA" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    const promo = filas.find((f) => f.temporada === "PROMO10" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    assert.deepEqual(
      [base.edad_infante_min, base.edad_infante_max, base.edad_nino_min, base.edad_nino_max],
      [null, null, null, null]
    );
    assert.deepEqual(
      [promo.edad_infante_min, promo.edad_infante_max, promo.edad_nino_min, promo.edad_nino_max],
      [0, 1, 2, 9]
    );
  });
});

describe("resolverNetoNocheDetallado — sin pasar precioFinalTemporadas: la fila materializada de la promo IGUAL gana (el flag ya no gobierna elegibilidad)", () => {
  test("con la promoción vigente y prioritaria Y con neto materializado en netoPorTemporada, gana la promo aunque no se pase precioFinalTemporadas", () => {
    const { temporadas, netoPorTemporada } = escenarioPromo();
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    // Llamada SIN el 6º argumento — la eligibilidad depende SOLO de tener
    // neto materializado para este combo (netoPorTemporada.PROMO10 = 94500),
    // nunca del flag `precioFinalTemporadas` (que ahora únicamente alimenta
    // el detalle `precioFinalAutoritativo`, ver la corrección posterior).
    const r = resolverNetoNocheDetallado(t0, temporadas, netoPorTemporada, hoy, "PC");
    assert.ok(r);
    assert.equal(r!.neto, 94500);
    assert.equal(r!.temporadaTarifa, "PROMO10");
    assert.equal(r!.precioFinalAutoritativo, false, "sin el set, el detalle de auditoría sale false — pero el neto/identidad no cambian");
  });
});

describe("resolverNetoNocheDetallado — DESPUÉS del fix (con precioFinalTemporadas): usa el precio final una sola vez", () => {
  test("usa EXACTAMENTE el neto de la fila de la promo (94.500, con su suplemento propio ya descontado junto con la base) y devuelve su propia identidad", () => {
    const { temporadas, netoPorTemporada, precioFinalTemporadas } = escenarioPromo();
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    const r = resolverNetoNocheDetallado(t0, temporadas, netoPorTemporada, hoy, "PC", precioFinalTemporadas);
    assert.ok(r);
    assert.equal(r!.neto, 94500);
    assert.equal(r!.temporadaTarifa, "PROMO10");
  });

  test("liquidarHotelNoches (3 noches) usa el precio final de la promo una sola vez por noche — nunca aplica el descuento dos veces", () => {
    const { temporadas, netoPorTemporada, precioFinalTemporadas } = escenarioPromo();
    const total = liquidarHotelNoches({
      fechaIda: "2026-06-01", numNoches: 3, temporadas, netoPorTemporada, hoy, regimen: "PC", precioFinalTemporadas,
    });
    assert.equal(total, 94500 * 3);
  });

  test("liquidarHotelMasBarato (ventana 'desde') también usa el precio final de la promo", () => {
    const { temporadas, netoPorTemporada, precioFinalTemporadas } = escenarioPromo();
    const total = liquidarHotelMasBarato({
      desde: "2026-06-01", hasta: "2026-06-05", numNoches: 3, temporadas, netoPorTemporada, hoy, regimen: "PC", precioFinalTemporadas,
    });
    assert.equal(total, 94500 * 3);
  });

  test("liquidarHotelNochesConTemporadas devuelve `temporadasTarifa` con el nombre de la PROMO, no de la base", () => {
    const { temporadas, netoPorTemporada, precioFinalTemporadas } = escenarioPromo();
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 2, temporadas, netoPorTemporada, hoy, regimen: "PC", precioFinalTemporadas,
    });
    assert.ok(r);
    assert.deepEqual(r!.temporadasTarifa, ["PROMO10"]);
  });

  test("tarifa BASE sigue funcionando exactamente igual cuando NO hay ninguna promoción vigente para esas fechas", () => {
    const { netoPorTemporada, precioFinalTemporadas } = escenarioPromo();
    // Solo la temporada BASE, sin PROMO10 — mismo neto/identidad de siempre.
    const soloBase: TemporadaRango[] = [{ nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" }];
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    const r = resolverNetoNocheDetallado(t0, soloBase, netoPorTemporada, hoy, "PC", precioFinalTemporadas);
    assert.ok(r);
    assert.equal(r!.neto, 100000);
    assert.equal(r!.temporadaTarifa, "BAJA");
  });

  test("si la promo NO tiene neto materializado para ESTE combo (categoría/régimen distinto), se IGNORA — usa la base con su propio neto, SIN descontar", () => {
    const { temporadas, precioFinalTemporadas } = escenarioPromo();
    // netoPorTemporada de OTRO combo: la promo no generó fila para él (su
    // entrada queda en null) — solo la base tiene neto.
    const netoOtroCombo: Record<string, number | null> = { BAJA: 120000, PROMO10: null };
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    const r = resolverNetoNocheDetallado(t0, temporadas, netoOtroCombo, hoy, "PC", precioFinalTemporadas);
    assert.ok(r);
    // Regla definitiva: una vigencia sin fila materializada para este combo
    // se ignora por completo — NUNCA recalcula desde la base con
    // `descuento_valor`. La base gana con su PROPIO neto, sin descontar.
    assert.equal(r!.neto, 120000);
    assert.equal(r!.temporadaTarifa, "BAJA");
    assert.equal(r!.esPromocion, false, "la promo quedó fuera de la resolución — la BASE es quien gana");
  });
});

describe("Regla definitiva — una vigencia SIN fila materializada nunca calcula nada, con o sin precioFinalTemporadas", () => {
  test("una temporada descuento_pct creada a mano (sin fila propia en tarifa_hotel) se ignora: la base gana con su neto SIN descontar", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO_LEGACY", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 2, tipo: "descuento_pct", descuento_valor: 15 },
    ];
    // Solo existe la fila BASE en tarifa_hotel — "PROMO_LEGACY" nunca tuvo
    // fila propia. El camino "legacy" que recalculaba desde la base con
    // `descuento_valor` quedó RETIRADO en esta ronda: cambiar
    // `descuento_valor` sin regenerar tarifas ya no cambia ningún precio.
    const netoPorTemporada: Record<string, number | null> = { BAJA: 100000 };
    const t0 = new Date("2026-06-01T00:00:00").getTime();

    const sinSet = resolverNetoNocheDetallado(t0, temporadas, netoPorTemporada, hoy, "PC");
    const conSetVacio = resolverNetoNocheDetallado(t0, temporadas, netoPorTemporada, hoy, "PC", new Set());
    for (const r of [sinSet, conSetVacio]) {
      assert.ok(r);
      assert.equal(r!.neto, 100000); // SIN descuento — antes: Math.round(100000 * 0.85) = 85000
      assert.equal(r!.temporadaTarifa, "BAJA");
      assert.equal(r!.temporadaGanadora, "BAJA", "la base gana directamente — la vigencia ignorada nunca queda como 'ganadora'");
      assert.equal(r!.esPromocion, false);
    }
  });

  test("cambiar descuento_valor de 10 a 20 sin regenerar tarifas NO cambia el precio publicado (la vigencia sin fila propia es puramente decorativa)", () => {
    const netoPorTemporada: Record<string, number | null> = { BASE_FULL: 400000 };
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    const conDiez: TemporadaRango[] = [
      { nombre: "BASE_FULL", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMOCION", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10 },
    ];
    const conVeinte: TemporadaRango[] = [
      { nombre: "BASE_FULL", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMOCION", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 2, tipo: "descuento_pct", descuento_valor: 20 },
    ];
    const r10 = resolverNetoNocheDetallado(t0, conDiez, netoPorTemporada, hoy, "FULL");
    const r20 = resolverNetoNocheDetallado(t0, conVeinte, netoPorTemporada, hoy, "FULL");
    assert.ok(r10);
    assert.ok(r20);
    assert.equal(r10!.neto, 400000);
    assert.equal(r20!.neto, 400000);
    assert.equal(r10!.neto, r20!.neto, "editar descuento_valor de una vigencia sin fila propia nunca debe cambiar el precio publicado");
  });
});

describe("Integración pura — edades y condiciones de tarifa resuelven contra la fila de la PROMOCIÓN, no de la base (objetivo 3 completo)", () => {
  test("edades propias promocionales ganan sobre la regla general del hotel; condición propia de la promo aparece; la base sigue sin condición", () => {
    const { temporadas, filas, netoPorTemporada, precioFinalTemporadas } = escenarioPromo();
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 2, temporadas, netoPorTemporada, hoy, regimen: "PC", precioFinalTemporadas,
    });
    assert.ok(r);
    const temporadasUsadas = new Set(r!.temporadasTarifa);
    assert.ok(temporadasUsadas.has("PROMO10"));
    assert.ok(!temporadasUsadas.has("BAJA"));

    const filasEdadCrudas: FilaTarifaHotelEdadCruda[] = filas
      .filter((f) => f.tipo_habitacion === "estandar" && f.alimentacion === "PC")
      .map((f) => ({
        tipo_habitacion: f.tipo_habitacion, alimentacion: f.alimentacion, temporada: f.temporada,
        edad_infante_min: f.edad_infante_min ?? null, edad_infante_max: f.edad_infante_max ?? null,
        edad_nino_min: f.edad_nino_min ?? null, edad_nino_max: f.edad_nino_max ?? null,
      }));
    // Regla general del hotel — deliberadamente DISTINTA de la de la promo,
    // para probar que la promo gana sobre el fallback general.
    const general = normalizarReglaEdadGeneral({ infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 11 });
    const rEdad = resolverReglaEdadEstadiaSegura({
      filas: filasEdadCrudas, categoria: "estandar", regimen: "PC", temporadasUsadas, general,
    });
    assert.ok(rEdad.ok);
    assert.equal(rEdad.regla.infanteMax, 1); // de la promo (edadesPropias.infanteMax), no 2 (general)
    assert.equal(rEdad.regla.ninoMax, 9);    // de la promo, no 11 (general)

    const condiciones = extraerCondicionesTarifa({
      filas: filas.filter((f) => f.tipo_habitacion === "estandar" && f.alimentacion === "PC"),
      categoria: "estandar", regimen: "PC", temporadasUsadas,
    });
    assert.deepEqual(condiciones, [{ temporada: "PROMO10", texto: "No reembolsable. No endosable." }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ronda de validación posterior — hallazgos corregidos:
//  1) regenerarTarifariosDeHotel debía detectar también fulfilled{ok:false}
//     (cubierto en pruebas/precioFinalAutoritativoWiring.test.ts, por ser I/O).
//  2) generarTarifasCalculadora ahora delega TODO el reemplazo a un RPC
//     transaccional (migración 179) — la atomicidad real (rollback completo,
//     mismos ids) se prueba en supabase/scripts/postcheck_179_...sql sección
//     6 (requiere Postgres real); acá, lo que SÍ es puro y ejecutable es que
//     el wrapper JS ya no reimplementa ningún select→delete→insert→restaurar
//     (pruebas/precioFinalAutoritativoWiring.test.ts).
//  3) Clasificador general Base/Promoción (temporada ganadora + es_promocion),
//     usado para persistir procedencia en `tarifario_resultado` (administración/
//     cálculo) — motor puro probado abajo.
//  4) Condiciones de BASE (DubaiBase.condicionesPropias) — probado abajo.
// ─────────────────────────────────────────────────────────────────────────

describe("resolverNetoNocheDetallado — temporadaGanadora/esPromocion: clasificador GENERAL Base/Promoción (NUNCA por precio_final_autoritativo)", () => {
  test("temporada tipo 'tarifa' → esPromocion:false, temporadaGanadora = su propio nombre", () => {
    const temporadas: TemporadaRango[] = [{ nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" }];
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    const r = resolverNetoNocheDetallado(t0, temporadas, { BAJA: 100000 }, "2026-01-01");
    assert.ok(r);
    assert.equal(r!.temporadaGanadora, "BAJA");
    assert.equal(r!.esPromocion, false);
  });

  test("temporada descuento_pct SIN fila materializada → se ignora: gana la BASE, esPromocion:false, temporadaGanadora = la base", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO_SIN_FILA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 2, tipo: "descuento_pct", descuento_valor: 15 },
    ];
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    // Sin entrada para "PROMO_SIN_FILA" en netoPorTemporada — nunca se
    // materializó. Regla definitiva: se ignora, la BASE gana directo.
    const r = resolverNetoNocheDetallado(t0, temporadas, { BAJA: 100000 }, "2026-01-01");
    assert.ok(r);
    assert.equal(r!.temporadaGanadora, "BAJA");
    assert.equal(r!.esPromocion, false);
    assert.equal(r!.temporadaTarifa, "BAJA");
    assert.equal(r!.neto, 100000, "sin descuento — la vigencia sin fila propia nunca aporta ni modifica el precio");
    assert.equal(r!.precioFinalAutoritativo, false);
  });

  test("temporada descuento_pct CON fila materializada → esPromocion:true, temporadaGanadora = la promo (misma identidad que temporadaTarifa)", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO_CON_FILA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 2, tipo: "descuento_pct", descuento_valor: 15 },
    ];
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    const r = resolverNetoNocheDetallado(t0, temporadas, { BAJA: 100000, PROMO_CON_FILA: 85000 }, "2026-01-01");
    assert.ok(r);
    assert.equal(r!.temporadaGanadora, "PROMO_CON_FILA");
    assert.equal(r!.esPromocion, true);
    assert.equal(r!.temporadaTarifa, "PROMO_CON_FILA", "ahora SIEMPRE es la misma identidad que temporadaGanadora — ya no hay camino que recalcule desde una base distinta");
    assert.equal(r!.neto, 85000, "el neto materializado, tal cual — nunca 85000 recalculado desde 100000×0,85 de forma implícita");
  });

  test("sin ninguna vigencia cubriendo la fecha → null (nunca se inventa 'Base' por defecto)", () => {
    const temporadas: TemporadaRango[] = [{ nombre: "BAJA", fecha_inicio: "2026-01-01", fecha_fin: "2026-03-31", prioridad: 1, tipo: "tarifa" }];
    const t0 = new Date("2026-06-01T00:00:00").getTime();
    assert.equal(resolverNetoNocheDetallado(t0, temporadas, { BAJA: 100000 }, "2026-01-01"), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ronda de validación — hallazgo 1: la etiqueta Base/Promoción NO se puede
// reconstruir con `tarifario_resultado.fecha_ida`. En Porción terrestre
// (`liquidarHotelMasBarato`/`liquidarHotelMasBaratoConTemporada`) el precio
// publicado es el MÁS BARATO de cualquier fecha dentro de la ventana de
// viaje — `fecha_ida` (=`desde`) puede pertenecer a una temporada distinta a
// la que realmente ganó. Estas pruebas demuestran ambas direcciones del
// defecto y confirman que cada acomodación conserva su PROPIA procedencia.
// ─────────────────────────────────────────────────────────────────────────
describe("liquidarHotelMasBaratoConTemporada — procedencia EXACTA, nunca reconstruible desde fecha_ida", () => {
  test("fecha_ida (desde) cae en la BASE, pero una fecha POSTERIOR promocional produce el precio ganador", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BASE_TOTAL", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      // Solo cubre el TRAMO FINAL de la ventana — nunca la fecha `desde`.
      { nombre: "PROMO_TARDIA", fecha_inicio: "2026-06-08", fecha_fin: "2026-06-10", prioridad: 2, tipo: "descuento_pct", descuento_valor: 80 },
    ];
    // PROMO_TARDIA con su fila MATERIALIZADA (20000) — regla definitiva: sin
    // esta fila propia, la vigencia se ignoraría por completo.
    const netoPorTemporada = { BASE_TOTAL: 100000, PROMO_TARDIA: 20000 };
    const r = liquidarHotelMasBaratoConTemporada({
      desde: "2026-06-01", hasta: "2026-06-10", numNoches: 3, temporadas, netoPorTemporada, hoy: "2026-01-01",
    });
    assert.ok(r);
    // 20000, muy por debajo de los 100000 de la base — la noche más barata
    // de la ventana SOLO puede venir de PROMO_TARDIA.
    assert.equal(r!.procedencia.length, 1, "masBarato siempre reporta UNA sola noche representativa");
    assert.equal(r!.procedencia[0].temporadaGanadora, "PROMO_TARDIA");
    assert.equal(r!.procedencia[0].esPromocion, true);
    assert.equal(r!.total, 20000 * 3);
  });

  test("caso INVERSO: fecha_ida (desde) cae en una PROMOCIÓN, pero una fecha posterior de la BASE produce el precio ganador", () => {
    const temporadas: TemporadaRango[] = [
      // Cubre SOLO el tramo inicial (mismo rango que la promo) — nunca debe
      // solaparse con BASE_BAJA, o un empate de prioridad la haría ganar ahí
      // también (orden estable, primera declarada gana el empate).
      { nombre: "BASE_ALTA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-03", prioridad: 1, tipo: "tarifa" },
      // Cubre justo la fecha `desde` — descuento modesto, sigue siendo cara.
      { nombre: "PROMO_MODESTA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-03", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10 },
      // Temporada BASE distinta, mucho más barata, cubre el resto de la ventana.
      { nombre: "BASE_BAJA", fecha_inicio: "2026-06-04", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
    ];
    // PROMO_MODESTA con su fila materializada (180000).
    const netoPorTemporada = { BASE_ALTA: 200000, PROMO_MODESTA: 180000, BASE_BAJA: 90000 };
    const r = liquidarHotelMasBaratoConTemporada({
      desde: "2026-06-01", hasta: "2026-06-10", numNoches: 3, temporadas, netoPorTemporada, hoy: "2026-01-01",
    });
    assert.ok(r);
    // PROMO_MODESTA en 06-01..06-03: 180000 (materializado). BASE_BAJA en
    // 06-04..06-10: 90000 — mucho más barata. La noche ganadora es BASE_BAJA
    // pese a que `desde` (fecha_ida) cae en la temporada PROMOCIONAL.
    assert.equal(r!.procedencia.length, 1);
    assert.equal(r!.procedencia[0].temporadaGanadora, "BASE_BAJA");
    assert.equal(r!.procedencia[0].esPromocion, false);
    assert.equal(r!.total, 90000 * 3);
  });

  test("cada ACOMODACIÓN conserva su PROPIA procedencia — la misma ventana/temporadas puede dar Base para una acomodación y Promoción para otra", () => {
    const temporadas: TemporadaRango[] = [
      // Cubre SOLO el tramo inicial (mismo rango que la promo) — nunca debe
      // solaparse con BASE_BAJA, o un empate de prioridad la haría ganar ahí
      // también (orden estable, primera declarada gana el empate).
      { nombre: "BASE_ALTA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-03", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO_ALTA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-03", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10 },
      { nombre: "BASE_BAJA", fecha_inicio: "2026-06-04", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
    ];
    // Acomodación "doble": BASE_BAJA sí tiene neto cargado y es más barata
    // que la promo materializada (180000) → gana ella (Base).
    const rDoble = liquidarHotelMasBaratoConTemporada({
      desde: "2026-06-01", hasta: "2026-06-10", numNoches: 3, temporadas,
      netoPorTemporada: { BASE_ALTA: 200000, PROMO_ALTA: 180000, BASE_BAJA: 90000 }, hoy: "2026-01-01",
    });
    // Acomodación "triple": el hotel NUNCA cargó tarifa de BASE_BAJA para
    // triple (no hay entrada en el mapa) — la única opción disponible en
    // toda la ventana es la promo del tramo inicial, con su fila materializada.
    const rTriple = liquidarHotelMasBaratoConTemporada({
      desde: "2026-06-01", hasta: "2026-06-10", numNoches: 3, temporadas,
      netoPorTemporada: { BASE_ALTA: 200000, PROMO_ALTA: 180000 }, hoy: "2026-01-01",
    });
    assert.ok(rDoble);
    assert.ok(rTriple);
    assert.equal(rDoble!.procedencia[0].temporadaGanadora, "BASE_BAJA");
    assert.equal(rDoble!.procedencia[0].esPromocion, false);
    assert.equal(rTriple!.procedencia[0].temporadaGanadora, "PROMO_ALTA");
    assert.equal(rTriple!.procedencia[0].esPromocion, true);
    assert.notEqual(rDoble!.procedencia[0].temporadaGanadora, rTriple!.procedencia[0].temporadaGanadora, "las dos acomodaciones deben conservar identidades DISTINTAS, ninguna se contamina con la otra");
  });

  test("liquidarHotelMasBarato (sin identidad, compatibilidad) sigue devolviendo EXACTAMENTE el mismo total que liquidarHotelMasBaratoConTemporada", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BASE_TOTAL", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO_TARDIA", fecha_inicio: "2026-06-08", fecha_fin: "2026-06-10", prioridad: 2, tipo: "descuento_pct", descuento_valor: 80 },
    ];
    const netoPorTemporada = { BASE_TOTAL: 100000 };
    const args = { desde: "2026-06-01", hasta: "2026-06-10", numNoches: 3, temporadas, netoPorTemporada, hoy: "2026-01-01" };
    assert.equal(liquidarHotelMasBarato(args), liquidarHotelMasBaratoConTemporada(args)!.total);
  });
});

describe("generarTarifasDubai — condiciones de BASE (nuevas) y de PROMOCIÓN, sin contaminación cruzada", () => {
  function escenarioBaseYPromoConCondiciones() {
    const params: DubaiParams = {
      regimen_base: "PC",
      modificadores: { sencilla_pct: 0, pax3_pct: 0, pax4_pct: 0, nino_pct: 0, infante_pct: -100 },
      suplementos: [],
      bases: [{ categoria: "estandar", temporada: "BAJA", precio: 100000, condicionesPropias: "Tarifa base, no incluye impuestos hoteleros." }],
      promos: [{ temporadaBase: "BAJA", temporadaPromo: "PROMO", regimen: "PC", descuentoPct: 10, condicionesPropias: "Promo no reembolsable." }],
    };
    return generarTarifasDubai(params);
  }

  test("la fila BASE escribe su propia condición en `notas`", () => {
    const filas = escenarioBaseYPromoConCondiciones();
    const base = filas.find((f) => f.temporada === "BAJA" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    assert.equal(base.notas, "Tarifa base, no incluye impuestos hoteleros.");
  });

  test("la fila de PROMOCIÓN conserva SU PROPIA condición — nunca hereda la de la base", () => {
    const filas = escenarioBaseYPromoConCondiciones();
    const promo = filas.find((f) => f.temporada === "PROMO" && f.tipo_habitacion === "estandar" && f.alimentacion === "PC")!;
    assert.equal(promo.notas, "Promo no reembolsable.");
    assert.notEqual(promo.notas, "Tarifa base, no incluye impuestos hoteleros.");
  });

  test("sin condición propia configurada en la base, `notas` queda undefined (comportamiento histórico, no se inventa texto)", () => {
    const params: DubaiParams = {
      regimen_base: "PC",
      modificadores: { sencilla_pct: 0, pax3_pct: 0, pax4_pct: 0, nino_pct: 0, infante_pct: -100 },
      suplementos: [],
      bases: [{ categoria: "estandar", temporada: "BAJA", precio: 100000 }],
    };
    const filas = generarTarifasDubai(params);
    const base = filas.find((f) => f.temporada === "BAJA")!;
    assert.equal(base.notas, undefined);
  });

  test("integración: cotización/contrato (extraerCondicionesTarifa) muestran la condición de BASE cuando gana la base, y la de PROMOCIÓN cuando gana la promo", () => {
    const filas = escenarioBaseYPromoConCondiciones();
    const condBase = extraerCondicionesTarifa({
      filas, categoria: "estandar", regimen: "PC", temporadasUsadas: new Set(["BAJA"]),
    });
    assert.deepEqual(condBase, [{ temporada: "BAJA", texto: "Tarifa base, no incluye impuestos hoteleros." }]);

    const condPromo = extraerCondicionesTarifa({
      filas, categoria: "estandar", regimen: "PC", temporadasUsadas: new Set(["PROMO"]),
    });
    assert.deepEqual(condPromo, [{ temporada: "PROMO", texto: "Promo no reembolsable." }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ronda de validación — hallazgo restante: `liquidarHotelNochesConTemporadas`
// sumaba TODAS las noches de la estadía pero solo persistía la identidad de
// la noche de CHECK-IN. Incorrecto cuando una estadía fija CRUZA temporadas
// (noche 1 base, noche 2 promoción: el total ya suma ambas, la fila
// publicada solo "recordaba" la de la noche 1). Ahora `procedencia` reúne y
// deduplica la identidad de TODAS las noches que aportaron al total.
// ─────────────────────────────────────────────────────────────────────────
describe("liquidarHotelNochesConTemporadas — procedencia agregada de TODAS las noches, nunca solo el check-in", () => {
  // BAJA cubre toda la ventana; PROMO cubre EXACTAMENTE un día, con mayor
  // prioridad, así que "gana" esa noche puntual por prioridad.
  function temporadas(diaPromo: string): TemporadaRango[] {
    return [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO", fecha_inicio: diaPromo, fecha_fin: diaPromo, prioridad: 2, tipo: "descuento_pct", descuento_valor: 50 },
    ];
  }
  // PROMO con su fila materializada (50000) — regla definitiva: sin ella la
  // vigencia se ignoraría y la noche seguiría en BAJA (100000).
  const netoPorTemporada = { BAJA: 100000, PROMO: 50000 };

  test("estadía fija BASE → PROMOCIÓN (noche 1 base, noche 2 promoción) — el total suma ambas Y la procedencia reporta las DOS, en orden cronológico", () => {
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 2, temporadas: temporadas("2026-06-02"), netoPorTemporada, hoy: "2026-01-01",
    });
    assert.ok(r);
    assert.equal(r!.total, 100000 + 50000); // noche 1 (BAJA) + noche 2 (PROMO al 50%)
    assert.equal(r!.procedencia.length, 2, "NUNCA solo la identidad del check-in — deben quedar las DOS temporadas reales");
    assert.deepEqual(r!.procedencia[0], { temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false });
    assert.deepEqual(r!.procedencia[1], { temporadaGanadora: "PROMO", esPromocion: true, precioFinalAutoritativo: false });
  });

  test("caso INVERSO: PROMOCIÓN → BASE (noche 1 promoción, noche 2 base) — misma agregación, orden cronológico invertido", () => {
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 2, temporadas: temporadas("2026-06-01"), netoPorTemporada, hoy: "2026-01-01",
    });
    assert.ok(r);
    assert.equal(r!.total, 50000 + 100000);
    assert.equal(r!.procedencia.length, 2);
    assert.deepEqual(r!.procedencia[0], { temporadaGanadora: "PROMO", esPromocion: true, precioFinalAutoritativo: false });
    assert.deepEqual(r!.procedencia[1], { temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false });
  });

  test("DOS promociones DIFERENTES en la misma estadía — la procedencia distingue ambas, ninguna se pierde ni se confunde con la otra", () => {
    const temporadasDosPromos: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO_A", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-01", prioridad: 2, tipo: "descuento_pct", descuento_valor: 20 },
      { nombre: "PROMO_B", fecha_inicio: "2026-06-02", fecha_fin: "2026-06-02", prioridad: 2, tipo: "descuento_monto", descuento_valor: 15000 },
    ];
    // PROMO_A y PROMO_B con sus filas materializadas (80000 y 85000).
    const netoDosPromos = { BAJA: 100000, PROMO_A: 80000, PROMO_B: 85000 };
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 2, temporadas: temporadasDosPromos, netoPorTemporada: netoDosPromos, hoy: "2026-01-01",
    });
    assert.ok(r);
    // PROMO_A: 100000×0.8 = 80000. PROMO_B: 100000−15000 = 85000.
    assert.equal(r!.total, 80000 + 85000);
    assert.equal(r!.procedencia.length, 2);
    const nombres = r!.procedencia.map((p) => p.temporadaGanadora).sort();
    assert.deepEqual(nombres, ["PROMO_A", "PROMO_B"]);
    assert.ok(r!.procedencia.every((p) => p.esPromocion === true), "ambas entradas deben clasificar como promoción");
  });

  test("TODAS las noches misma BASE — procedencia con UN solo elemento (caso uniforme, sin cambios de comportamiento)", () => {
    const soloBase: TemporadaRango[] = [{ nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" }];
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 3, temporadas: soloBase, netoPorTemporada, hoy: "2026-01-01",
    });
    assert.ok(r);
    assert.equal(r!.total, 100000 * 3);
    assert.deepEqual(r!.procedencia, [{ temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false }]);
  });

  test("TODAS las noches misma PROMOCIÓN — procedencia con UN solo elemento (caso uniforme)", () => {
    const soloPromo: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 2, tipo: "descuento_pct", descuento_valor: 30 },
    ];
    // PROMO con su fila materializada (70000).
    const netoSoloPromo = { BAJA: 100000, PROMO: 70000 };
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 3, temporadas: soloPromo, netoPorTemporada: netoSoloPromo, hoy: "2026-01-01",
    });
    assert.ok(r);
    assert.equal(r!.total, 70000 * 3);
    assert.deepEqual(r!.procedencia, [{ temporadaGanadora: "PROMO", esPromocion: true, precioFinalAutoritativo: false }]);
  });
});

describe("promo_noche_gratis — forma parte de la procedencia (nunca solo reduce el total en silencio)", () => {
  const hoyRef = "2026-01-01";

  test("base + noche gratis — el total NO cambia (mismo factor que antes) y la procedencia queda MIXTA (base + la promo de noche gratis)", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "3X2", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "promo_noche_gratis", min_noches: 3 },
    ];
    const netoPorTemporada = { BAJA: 100000 };
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 3, temporadas, netoPorTemporada, hoy: hoyRef,
    });
    assert.ok(r);
    assert.equal(r!.total, Math.round(300000 * (2 / 3)), "el total con noche gratis no cambia frente al comportamiento ya existente");
    assert.equal(r!.procedencia.length, 2, "procedencia mixta: la tarifa base que liquidó las noches + la promo de noche gratis");
    const nombres = r!.procedencia.map((p) => p.temporadaGanadora).sort();
    assert.deepEqual(nombres, ["3X2", "BAJA"]);
    const entradaGratis = r!.procedencia.find((p) => p.temporadaGanadora === "3X2");
    assert.deepEqual(entradaGratis, { temporadaGanadora: "3X2", esPromocion: true, precioFinalAutoritativo: false });
  });

  test("promoción porcentual + noche gratis — la procedencia reporta AMBAS (la promo de la noche puntual y la de noche gratis), nunca solo una", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "PROMO50", fecha_inicio: "2026-06-02", fecha_fin: "2026-06-02", prioridad: 2, tipo: "descuento_pct", descuento_valor: 50 },
      { nombre: "2X1", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "promo_noche_gratis", min_noches: 2 },
    ];
    // PROMO50 con su fila materializada (50000).
    const netoPorTemporada = { BAJA: 100000, PROMO50: 50000 };
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 2, temporadas, netoPorTemporada, hoy: hoyRef,
    });
    assert.ok(r);
    // noche 1 BAJA (100000) + noche 2 PROMO50 (50000) = 150000, × factor 1/2 (2X1).
    assert.equal(r!.total, 150000 * (1 / 2));
    assert.equal(r!.procedencia.length, 3);
    const nombres = r!.procedencia.map((p) => p.temporadaGanadora).sort();
    assert.deepEqual(nombres, ["2X1", "BAJA", "PROMO50"]);
  });

  test("la estadía NO cumple min_noches de la promo — no se agrega procedencia promocional de noche gratis, ni se descuenta el total", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "3X2", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "promo_noche_gratis", min_noches: 3 },
    ];
    const netoPorTemporada = { BAJA: 100000 };
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 2, temporadas, netoPorTemporada, hoy: hoyRef,
    });
    assert.ok(r);
    assert.equal(r!.total, 200000, "sin noche gratis, el total es la suma simple");
    assert.deepEqual(r!.procedencia, [{ temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false }]);
    assert.equal(resolverNocheGratisDetallado(temporadas, "2026-06-01", 2, hoyRef), null);
  });

  test("régimen restringido incompatible — la promo de noche gratis no aplica, no se agrega procedencia ni se descuenta el total", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "3X2", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "promo_noche_gratis", min_noches: 3, regimen_restringido: "ALL_INCLUSIVE" },
    ];
    const netoPorTemporada = { BAJA: 100000 };
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-06-01", numNoches: 3, temporadas, netoPorTemporada, hoy: hoyRef, regimen: "PC",
    });
    assert.ok(r);
    assert.equal(r!.total, 300000);
    assert.deepEqual(r!.procedencia, [{ temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false }]);
  });

  test("Porción terrestre (liquidarHotelMasBaratoConTemporada) también conserva la noche gratis en la procedencia, anclada a `desde`", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "3X2", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "promo_noche_gratis", min_noches: 3 },
    ];
    const netoPorTemporada = { BAJA: 100000 };
    const r = liquidarHotelMasBaratoConTemporada({
      desde: "2026-06-01", hasta: "2026-06-05", numNoches: 3, temporadas, netoPorTemporada, hoy: hoyRef,
    });
    assert.ok(r);
    assert.equal(r!.total, Math.round(300000 * (2 / 3)));
    assert.equal(r!.procedencia.length, 2);
    const nombres = r!.procedencia.map((p) => p.temporadaGanadora).sort();
    assert.deepEqual(nombres, ["3X2", "BAJA"]);
  });

  test("las variantes SIMPLES (liquidarHotelNoches/liquidarHotelMasBarato) y DETALLADAS (…ConTemporadas) devuelven EXACTAMENTE el mismo total — misma fuente (resolverNocheGratisDetallado), nunca pueden divergir", () => {
    const temporadas: TemporadaRango[] = [
      { nombre: "BAJA", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "tarifa" },
      { nombre: "3X2", fecha_inicio: "2026-06-01", fecha_fin: "2026-06-10", prioridad: 1, tipo: "promo_noche_gratis", min_noches: 3 },
    ];
    const netoPorTemporada = { BAJA: 100000 };

    const simple = liquidarHotelNoches({ fechaIda: "2026-06-01", numNoches: 3, temporadas, netoPorTemporada, hoy: hoyRef });
    const detallado = liquidarHotelNochesConTemporadas({ fechaIda: "2026-06-01", numNoches: 3, temporadas, netoPorTemporada, hoy: hoyRef });
    assert.ok(detallado);
    assert.equal(simple, detallado!.total);

    const simpleBarato = liquidarHotelMasBarato({ desde: "2026-06-01", hasta: "2026-06-05", numNoches: 3, temporadas, netoPorTemporada, hoy: hoyRef });
    const detalladoBarato = liquidarHotelMasBaratoConTemporada({ desde: "2026-06-01", hasta: "2026-06-05", numNoches: 3, temporadas, netoPorTemporada, hoy: hoyRef });
    assert.ok(detalladoBarato);
    assert.equal(simpleBarato, detalladoBarato!.total);
  });
});

describe("lib/tarifario/procedenciaTarifario.ts — columnasProcedencia: representación estructurada (jsonb), nunca texto serializado", () => {
  test("sin procedencia (undefined/vacío) — todo NULL/[]/false, nunca se inventa una identidad", () => {
    const entradasVacias: Array<ProcedenciaNoche[] | null | undefined> = [undefined, null, []];
    for (const entrada of entradasVacias) {
      const c = columnasProcedencia(entrada);
      assert.deepEqual(c, {
        temporada_ganadora: null, es_promocion: null, precio_final_autoritativo: null,
        procedencia_temporadas: [], procedencia_mixta: false,
      });
    }
  });

  test("1 sola identidad — caso UNIFORME: columnas planas pobladas, procedencia_mixta=false, jsonb con 1 elemento", () => {
    const entradas: ProcedenciaNoche[] = [{ temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false }];
    const c = columnasProcedencia(entradas);
    assert.equal(c.temporada_ganadora, "BAJA");
    assert.equal(c.es_promocion, false);
    assert.equal(c.precio_final_autoritativo, false);
    assert.equal(c.procedencia_mixta, false);
    assert.deepEqual(c.procedencia_temporadas, [{ temporada: "BAJA", es_promocion: false, precio_final_autoritativo: false }]);
  });

  test("2+ identidades — caso MIXTO: columnas planas NULL (nunca se elige una arbitraria), procedencia_mixta=true, jsonb con TODAS", () => {
    const entradas: ProcedenciaNoche[] = [
      { temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false },
      { temporadaGanadora: "PROMO", esPromocion: true, precioFinalAutoritativo: true },
    ];
    const c = columnasProcedencia(entradas);
    assert.equal(c.temporada_ganadora, null);
    assert.equal(c.es_promocion, null);
    assert.equal(c.precio_final_autoritativo, null);
    assert.equal(c.procedencia_mixta, true);
    assert.deepEqual(c.procedencia_temporadas, [
      { temporada: "BAJA", es_promocion: false, precio_final_autoritativo: false },
      { temporada: "PROMO", es_promocion: true, precio_final_autoritativo: true },
    ]);
  });

  test("el jsonb es SIEMPRE un arreglo de OBJETOS estructurados — nunca una lista serializada como texto/CSV", () => {
    const c = columnasProcedencia([{ temporadaGanadora: "BAJA", esPromocion: false, precioFinalAutoritativo: false }]);
    assert.ok(Array.isArray(c.procedencia_temporadas));
    assert.equal(typeof c.procedencia_temporadas[0], "object");
    assert.equal(typeof c.procedencia_temporadas[0].temporada, "string");
  });
});
