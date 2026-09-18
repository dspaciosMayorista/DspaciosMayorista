import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  liquidarHotelNoches,
  liquidarHotelNochesConTemporadas,
  resolverNetoNocheDetallado,
  marcar,
  toTemporadaRango,
  type TemporadaRango,
} from "../lib/calc/paquetes.ts";

// ─────────────────────────────────────────────────────────────────────────
// REGLA DEFINITIVA (corrección posterior a la ronda del suplemento/descuento
// Dubai): una vigencia de `hotel_temporadas` NUNCA genera, deriva ni
// modifica precios. Solo define nombre, fechas, prioridad, restricciones y
// clasificación. El ÚNICO precio válido es una fila MATERIALIZADA en
// `tarifa_hotel` para la combinación categoría+régimen+acomodación exacta.
//
// Caso confirmado en Preview: base Estándar FULL = 400.000/noche ("Prueba
// d"/Base). Existe la vigencia "PROMOCION" (descuento_pct 10%), pero SIN
// fila `tarifa_hotel` para FULL. El sistema publicaba 360.000 (400.000×0,90,
// RECALCULADO desde la base) y, al cambiar el descuento a 20% sin
// regenerar tarifas, el precio publicado cambiaba solo a ~333.333 — un
// precio que nunca fue cargado por nadie. Corregido: sin fila materializada,
// la vigencia se ignora; la base ("Prueba d") gana con su propio neto.
//
// Auditado: `resolverNetoNocheDetallado` es el ÚNICO punto de resolución de
// precio por noche — `liquidarHotelNoches`, `liquidarHotelMasBarato` y sus
// variantes "ConTemporadas" delegan TODAS en él (ver lib/calc/paquetes.ts),
// así que corregirlo ahí corrige el motor completo sin tocar ningún otro
// archivo. `netoPorTemporada`/`precioFinalTemporadas` los siguen
// construyendo los mismos call sites (computo.ts, liquidacionHotel.ts,
// paquetes/actions.ts) sin cambios — `precioFinalTemporadas` ya NO gobierna
// elegibilidad, solo alimenta el detalle `precioFinalAutoritativo` de
// auditoría.
// ─────────────────────────────────────────────────────────────────────────

const HOY = "2026-01-01";

function temporada(overrides: Partial<Parameters<typeof toTemporadaRango>[0]>): TemporadaRango {
  return toTemporadaRango({
    nombre: "Prueba d", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31",
    prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    ...overrides,
  });
}

// 1. Promo sin fila materializada: usa base sin descuento y procedencia Base.
describe("1. Promo sin fila materializada", () => {
  test("usa la base SIN descuento y la procedencia es la BASE, nunca la promoción", () => {
    const base = temporada({ nombre: "Prueba d", prioridad: 1 });
    const promocion = temporada({ nombre: "PROMOCION", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
    const temporadas = [base, promocion];
    // Sin entrada para "PROMOCION" — no existe fila tarifa_hotel para
    // PROMOCION + Estándar + FULL + doble.
    const netoPorTemporada = { "Prueba d": 400_000 };
    const r = resolverNetoNocheDetallado(
      new Date("2026-09-05T00:00:00").getTime(), temporadas, netoPorTemporada, HOY, "FULL"
    );
    assert.ok(r);
    assert.equal(r!.neto, 400_000);
    assert.equal(r!.temporadaGanadora, "Prueba d");
    assert.equal(r!.temporadaTarifa, "Prueba d");
    assert.equal(r!.esPromocion, false);
  });
});

// 2. Cambiar descuento_valor sin regenerar: no cambia el paquete.
describe("2. Cambiar descuento_valor sin regenerar tarifas", () => {
  test("editar la vigencia de 10% a 20% no cambia el precio publicado — la vigencia sin fila propia es puramente decorativa", () => {
    const netoPorTemporada = { "Prueba d": 400_000 };
    const con10 = [temporada({ nombre: "Prueba d", prioridad: 1 }), temporada({ nombre: "PROMOCION", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 })];
    const con20 = [temporada({ nombre: "Prueba d", prioridad: 1 }), temporada({ nombre: "PROMOCION", prioridad: 5, tipo: "descuento_pct", descuento_valor: 20 })];
    const t0 = new Date("2026-09-05T00:00:00").getTime();
    const r10 = resolverNetoNocheDetallado(t0, con10, netoPorTemporada, HOY, "FULL");
    const r20 = resolverNetoNocheDetallado(t0, con20, netoPorTemporada, HOY, "FULL");
    assert.ok(r10);
    assert.ok(r20);
    assert.equal(r10!.neto, 400_000);
    assert.equal(r20!.neto, 400_000);
    assert.equal(r10!.neto, r20!.neto);
  });
});

// 3. Promo materializada: usa exactamente su fila.
describe("3. Promo materializada", () => {
  test("usa EXACTAMENTE el neto de su propia fila, sin importar descuento_valor de la vigencia", () => {
    const base = temporada({ nombre: "Prueba d", prioridad: 1 });
    const promocion = temporada({ nombre: "PROMOCION", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
    const temporadas = [base, promocion];
    // Fila materializada para PROMOCION+FULL: 360.000 (generada por la
    // calculadora, o cargada a mano — no importa el origen).
    const netoPorTemporada = { "Prueba d": 400_000, PROMOCION: 360_000 };
    const r = resolverNetoNocheDetallado(
      new Date("2026-09-05T00:00:00").getTime(), temporadas, netoPorTemporada, HOY, "FULL"
    );
    assert.ok(r);
    assert.equal(r!.neto, 360_000);
    assert.equal(r!.temporadaGanadora, "PROMOCION");
    assert.equal(r!.temporadaTarifa, "PROMOCION");
    assert.equal(r!.esPromocion, true);
  });
});

// 4. No doble descuento.
describe("4. No doble descuento", () => {
  test("la fila materializada (ya con el 10% aplicado) nunca vuelve a descontarse por descuento_valor", () => {
    const base = temporada({ nombre: "Prueba d", prioridad: 1 });
    const promocion = temporada({ nombre: "PROMOCION", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
    const temporadas = [base, promocion];
    const netoPorTemporada = { "Prueba d": 400_000, PROMOCION: 360_000 };
    const r = resolverNetoNocheDetallado(
      new Date("2026-09-05T00:00:00").getTime(), temporadas, netoPorTemporada, HOY, "FULL",
      new Set(["PROMOCION"]) // precioFinalTemporadas — igual comportamiento con o sin el set
    );
    assert.ok(r);
    assert.equal(r!.neto, 360_000);
    assert.notEqual(r!.neto, Math.round(360_000 * 0.9), "nunca 324.000 — el neto materializado NUNCA se vuelve a descontar");
  });
});

// 5. Caso mixto PAE promocional / FULL base.
describe("5. Caso mixto — PAE con promoción materializada, FULL sin ella (cae a la base)", () => {
  const base = temporada({ nombre: "Prueba d", prioridad: 1 });
  const promocion = temporada({ nombre: "PROMOCION", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
  const temporadas = [base, promocion];

  test("PAE: PROMOCION SÍ tiene fila materializada (180.000) → gana la promoción", () => {
    const netoPorTemporada = { "Prueba d": 200_000, PROMOCION: 180_000 };
    const r = resolverNetoNocheDetallado(new Date("2026-09-05T00:00:00").getTime(), temporadas, netoPorTemporada, HOY, "PAE");
    assert.ok(r);
    assert.equal(r!.neto, 180_000);
    assert.equal(r!.temporadaGanadora, "PROMOCION");
    assert.equal(r!.esPromocion, true);
  });

  test("FULL: PROMOCION NO tiene fila materializada → se ignora, gana la base Prueba d (400.000)", () => {
    const netoPorTemporada = { "Prueba d": 400_000 }; // sin PROMOCION para FULL
    const r = resolverNetoNocheDetallado(new Date("2026-09-05T00:00:00").getTime(), temporadas, netoPorTemporada, HOY, "FULL");
    assert.ok(r);
    assert.equal(r!.neto, 400_000);
    assert.equal(r!.temporadaGanadora, "Prueba d");
    assert.equal(r!.esPromocion, false);
  });
});

// 6. Promoción prioritaria sin fila no bloquea una base o promoción inferior que sí tenga fila.
describe("6. Promoción prioritaria sin fila no bloquea la siguiente vigencia aplicable con fila", () => {
  test("PROMOCION_A (prioridad más alta, sin fila) se ignora; PROMOCION_B (prioridad menor, CON fila) gana", () => {
    const base = temporada({ nombre: "Prueba d", prioridad: 1 });
    const promoA = temporada({ nombre: "PROMOCION_A", prioridad: 10, tipo: "descuento_pct", descuento_valor: 30 }); // más prioritaria, SIN fila
    const promoB = temporada({ nombre: "PROMOCION_B", prioridad: 5, tipo: "descuento_pct", descuento_valor: 15 }); // menos prioritaria, CON fila
    const temporadas = [base, promoA, promoB];
    const netoPorTemporada = { "Prueba d": 400_000, PROMOCION_B: 340_000 }; // sin PROMOCION_A
    const r = resolverNetoNocheDetallado(new Date("2026-09-05T00:00:00").getTime(), temporadas, netoPorTemporada, HOY, "FULL");
    assert.ok(r);
    assert.equal(r!.neto, 340_000);
    assert.equal(r!.temporadaGanadora, "PROMOCION_B");
    assert.equal(r!.esPromocion, true);
  });

  test("PROMOCION_A (prioridad más alta, sin fila) se ignora; sin ninguna promo con fila, gana la BASE (prioridad más baja de todas, pero la única con precio)", () => {
    const base = temporada({ nombre: "Prueba d", prioridad: 1 });
    const promoA = temporada({ nombre: "PROMOCION_A", prioridad: 10, tipo: "descuento_pct", descuento_valor: 30 });
    const promoB = temporada({ nombre: "PROMOCION_B", prioridad: 5, tipo: "descuento_pct", descuento_valor: 15 });
    const temporadas = [base, promoA, promoB];
    const netoPorTemporada = { "Prueba d": 400_000 }; // ninguna promo tiene fila
    const r = resolverNetoNocheDetallado(new Date("2026-09-05T00:00:00").getTime(), temporadas, netoPorTemporada, HOY, "FULL");
    assert.ok(r);
    assert.equal(r!.neto, 400_000);
    assert.equal(r!.temporadaGanadora, "Prueba d");
    assert.equal(r!.esPromocion, false);
  });
});

// 7. Tres noches + MK 10%: PAE = 600.000, FULL = 1.333.333.
describe("7. Tres noches + MK 10% — caso confirmado", () => {
  const base = temporada({ nombre: "Prueba d", prioridad: 1 });
  const promocion = temporada({ nombre: "PROMOCION", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
  const temporadas = [base, promocion];

  test("PAE (PROMOCION materializada a 180.000) → 3 noches = 540.000 neto; PVP con MK 10% = 600.000", () => {
    const netoPorTemporada = { "Prueba d": 200_000, PROMOCION: 180_000 };
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY, regimen: "PAE" });
    assert.equal(total, 540_000);
    assert.equal(Math.round(marcar(total!, 0.10)), 600_000);
  });

  test("FULL (PROMOCION sin fila, cae a Prueba d/Base 400.000) → 3 noches = 1.200.000 neto; PVP con MK 10% = 1.333.333", () => {
    const netoPorTemporada = { "Prueba d": 400_000 }; // sin PROMOCION para FULL
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY, regimen: "FULL" });
    assert.equal(total, 1_200_000);
    assert.equal(Math.round(marcar(total!, 0.10)), 1_333_333);
  });
});

// 8. Vista administrativa no muestra 180.000 con un segundo valor 162.000.
// (cobertura de wiring en pruebas/precioFinalAutoritativoWiring.test.ts —
// "regla definitiva... NO recalcula ni muestra un segundo valor derivado de
// descuento_valor" — confirma que `conDescuento`/`cfgTemporada` se
// retiraron de HotelDetalleClient.tsx por completo.)

// 9. Vista previa y persistencia siguen coincidiendo.
// (cobertura ya existente en pruebas/promocionDubaiSuplementoDescuento.test.ts
// — "Vista previa y filas persistidas — misma función, no pueden divergir":
// generarTarifas("dubai", params) delega exacto en generarTarifasDubai, así
// que preview y persistencia son, por construcción, la MISMA llamada. Esta
// regla no cambia con la corrección de esta ronda — la calculadora sigue
// siendo la única fuente de las filas materializadas.)

describe("Procedencia agregada — la vigencia 'PROMOCION' aparece como ganadora SOLO cuando aportó neto materializado a alguna noche", () => {
  test("estadía con noche 1 en Base (sin promo con fila) y noche 2 con promo materializada — procedencia reporta AMBAS identidades reales", () => {
    const baseAmplia = temporada({ nombre: "Prueba d", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-10", prioridad: 1 });
    const promoUnDia = temporada({ nombre: "PROMOCION", fecha_inicio: "2026-09-06", fecha_fin: "2026-09-06", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
    const temporadas = [baseAmplia, promoUnDia];
    const netoPorTemporada = { "Prueba d": 400_000, PROMOCION: 360_000 };
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada, hoy: HOY, regimen: "FULL",
    });
    assert.ok(r);
    assert.equal(r!.total, 400_000 + 360_000);
    assert.equal(r!.procedencia.length, 2);
    const nombres = r!.procedencia.map((p) => p.temporadaGanadora).sort();
    assert.deepEqual(nombres, ["PROMOCION", "Prueba d"]);
  });
});
