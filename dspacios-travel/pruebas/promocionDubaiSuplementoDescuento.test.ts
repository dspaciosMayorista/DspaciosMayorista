import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generarTarifasDubai,
  generarTarifas,
  validarDubaiParams,
  type DubaiParams,
} from "../lib/calc/calculadoras.ts";
import {
  liquidarHotelNoches,
  liquidarHotelNochesConTemporadas,
  resolverNetoNocheDetallado,
  marcar,
  toTemporadaRango,
  type TemporadaRango,
} from "../lib/calc/paquetes.ts";

// ─────────────────────────────────────────────────────────────────────────
// Corrección de cálculo — promociones Dubai: el % de descuento se aplica
// sobre la tarifa COMPLETA del régimen (base + suplemento efectivo), nunca
// solo sobre la base. Antes, `generarTarifasDubai` descontaba únicamente la
// base y sumaba el suplemento DESPUÉS sin descontar — y para elegir el
// suplemento, nunca miraba si la BASE referenciada tenía uno propio
// (`usarSuplementosPropios`), cayendo siempre al general.
//
// El motor de recálculo automático (`lib/calc/paquetes.ts`, camino
// "legacy" en `resolverNetoNocheDetallado` para una promoción SIN fila
// materializada) ya era correcto: descuenta el neto YA CARGADO de la
// tarifa-base para ese combo categoría+régimen — y ese neto, cuando la fila
// base fue generada por Dubai, YA INCLUYE el suplemento (la base genera una
// fila POR régimen, con su suplemento horneado). Por eso NO se toca
// `paquetes.ts` en esta ronda — el defecto estaba solo en la calculadora.
// ─────────────────────────────────────────────────────────────────────────

const HOY = "2026-01-01";

function temporada(overrides: Partial<Parameters<typeof toTemporadaRango>[0]>): TemporadaRango {
  return toTemporadaRango({
    nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30",
    prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    ...overrides,
  });
}

describe("Caso A — Estándar: suplemento propio de la BASE (200.000) heredado por la promo sin suplemento propio", () => {
  const params: DubaiParams = {
    regimen_base: "PAE",
    modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
    suplementos: [],
    bases: [{
      categoria: "Estandar", temporada: "ALTA", precio: 200_000,
      usarSuplementosPropios: true, suplementosPropios: [{ regimen: "FULL", monto: 200_000 }],
    }],
    promos: [
      { temporadaBase: "ALTA", temporadaPromo: "PROMO_PAE", regimen: "PAE", descuentoPct: 10 },
      { temporadaBase: "ALTA", temporadaPromo: "PROMO_FULL", regimen: "FULL", descuentoPct: 10 },
    ],
  };
  const filas = generarTarifasDubai(params);

  test("PAE (régimen base, sin suplemento) = 200.000 × 0,90 = 180.000", () => {
    const fila = filas.find((f) => f.temporada === "PROMO_PAE")!;
    assert.equal(fila.neto_doble, 180_000);
  });

  test("FULL (hereda el suplemento propio de la BASE, 200.000) = (200.000+200.000) × 0,90 = 360.000", () => {
    const fila = filas.find((f) => f.temporada === "PROMO_FULL")!;
    assert.equal(fila.neto_doble, 360_000);
  });
});

describe("Caso B — Superior: suplemento GENERAL de régimen (base sin suplemento propio)", () => {
  const params: DubaiParams = {
    regimen_base: "PAE",
    modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
    suplementos: [{ regimen: "FULL", monto: 100_000 }],
    bases: [{ categoria: "Superior", temporada: "ALTA", precio: 300_000 }],
    promos: [
      { temporadaBase: "ALTA", temporadaPromo: "PROMO_PAE", regimen: "PAE", descuentoPct: 10 },
      { temporadaBase: "ALTA", temporadaPromo: "PROMO_FULL", regimen: "FULL", descuentoPct: 10 },
    ],
  };
  const filas = generarTarifasDubai(params);

  test("PAE (régimen base, sin suplemento) = 300.000 × 0,90 = 270.000", () => {
    const fila = filas.find((f) => f.temporada === "PROMO_PAE")!;
    assert.equal(fila.neto_doble, 270_000);
  });

  test("FULL (suplemento GENERAL, la base no tiene uno propio) = (300.000+100.000) × 0,90 = 360.000", () => {
    const fila = filas.find((f) => f.temporada === "PROMO_FULL")!;
    assert.equal(fila.neto_doble, 360_000);
  });
});

describe("Caso C — promoción con suplemento propio: gana sobre el de la base Y sobre el general; el descuento cubre el total", () => {
  const params: DubaiParams = {
    regimen_base: "PAE",
    modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
    suplementos: [{ regimen: "FULL", monto: 100_000 }], // general — no debe usarse
    bases: [{
      categoria: "Estandar", temporada: "ALTA", precio: 200_000,
      usarSuplementosPropios: true, suplementosPropios: [{ regimen: "FULL", monto: 200_000 }], // propio de la base — tampoco debe usarse
    }],
    promos: [{
      temporadaBase: "ALTA", temporadaPromo: "PROMO_FULL", regimen: "FULL", descuentoPct: 10,
      usarSuplementoPropio: true, suplementoPropioMonto: 50_000, // propio de la PROMO — debe ganar
    }],
  };
  const filas = generarTarifasDubai(params);

  test("usa el suplemento propio de LA PROMO (50.000), no el de la base (200.000) ni el general (100.000)", () => {
    const fila = filas.find((f) => f.temporada === "PROMO_FULL")!;
    // (200.000 + 50.000) × 0,90 = 225.000
    assert.equal(fila.neto_doble, 225_000);
    assert.notEqual(fila.neto_doble, Math.round((200_000 + 200_000) * 0.9)); // no el de la base
    assert.notEqual(fila.neto_doble, Math.round((200_000 + 100_000) * 0.9)); // no el general
  });

  test("el descuento se aplica DESPUÉS de sumar el suplemento propio, sobre el total (no antes)", () => {
    const fila = filas.find((f) => f.temporada === "PROMO_FULL")!;
    assert.notEqual(fila.neto_doble, Math.round(200_000 * 0.9) + 50_000); // cálculo viejo (bug): 230.000
  });
});

describe("Caso D — Paridad: promoción SIN fila materializada (motor automático) vs. CON fila materializada (calculadora)", () => {
  // Misma configuración que el Caso B (FULL, suplemento general 100.000).
  const paramsCalc: DubaiParams = {
    regimen_base: "PAE",
    modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
    suplementos: [{ regimen: "FULL", monto: 100_000 }],
    bases: [{ categoria: "Superior", temporada: "ALTA", precio: 300_000 }],
    promos: [{ temporadaBase: "ALTA", temporadaPromo: "ALTA_PROMO_FULL", regimen: "FULL", descuentoPct: 10 }],
  };
  const filasMaterializadas = generarTarifasDubai(paramsCalc);
  const filaFullMaterializada = filasMaterializadas.find((f) => f.temporada === "ALTA_PROMO_FULL" && f.alimentacion === "FULL")!;
  const filaBaseFull = filasMaterializadas.find((f) => f.temporada === "ALTA" && f.alimentacion === "FULL")!;

  test("la fila materializada por la calculadora da 360.000 y queda precio_final_autoritativo", () => {
    assert.equal(filaFullMaterializada.neto_doble, 360_000);
    assert.equal(filaFullMaterializada.precio_final_autoritativo, true);
    assert.equal(filaFullMaterializada.temporada_base, "ALTA");
  });

  test("camino AUTOMÁTICO (sin fila materializada de promo, solo la vigencia descuento_pct + la base FULL que ya generó Dubai) da el MISMO neto", () => {
    // Vigencia de la promo creada a mano en hotel_temporadas (tipo
    // descuento_pct) — SIN pasar precioFinalTemporadas: simula el escenario
    // "promoción sin fila materializada" del camino automático/legacy.
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const promoDescuento = temporada({ nombre: "ALTA_PROMO_FULL", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10 });
    const temporadas = [base, promoDescuento];
    // netoPorTemporada para el combo FULL: la base "ALTA" YA trae el
    // suplemento horneado (400.000) — es la fila que generó el bucle de
    // `bases[]` de Dubai (`filaBaseFull.neto_doble`), no un valor inventado.
    const netoPorTemporada = { ALTA: filaBaseFull.neto_doble };
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 1, temporadas, netoPorTemporada, hoy: HOY, regimen: "FULL" });
    assert.equal(total, 360_000);
    assert.equal(total, filaFullMaterializada.neto_doble, "el automático y el materializado deben dar el MISMO neto");
  });

  test("procedencia: ambos caminos conservan el nombre de la promoción GANADORA (ALTA_PROMO_FULL)", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const promoDescuento = temporada({ nombre: "ALTA_PROMO_FULL", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10 });
    const temporadas = [base, promoDescuento];

    // Automático (sin precioFinalTemporadas).
    const netoPorTemporadaAuto = { ALTA: filaBaseFull.neto_doble };
    const rAuto = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-05", numNoches: 1, temporadas, netoPorTemporada: netoPorTemporadaAuto, hoy: HOY, regimen: "FULL" });
    assert.ok(rAuto);
    assert.equal(rAuto!.procedencia[0].temporadaGanadora, "ALTA_PROMO_FULL");

    // Materializado (con precioFinalTemporadas apuntando a la fila de la promo).
    const netoPorTemporadaMat = { ALTA_PROMO_FULL: filaFullMaterializada.neto_doble };
    const rMat = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-09-05", numNoches: 1, temporadas, netoPorTemporada: netoPorTemporadaMat, hoy: HOY, regimen: "FULL",
      precioFinalTemporadas: new Set(["ALTA_PROMO_FULL"]),
    });
    assert.ok(rMat);
    assert.equal(rMat!.procedencia[0].temporadaGanadora, "ALTA_PROMO_FULL");
    assert.equal(rMat!.total, rAuto!.total, "mismo neto total en ambos caminos");
  });

  test("PVP tras el margen del paquete (10%) coincide en ambos caminos: 360.000 / 0,90 = 400.000", () => {
    const pvpAuto = marcar(360_000, 0.10);
    const pvpMaterializado = marcar(filaFullMaterializada.neto_doble, 0.10);
    assert.equal(Math.round(pvpAuto), 400_000);
    assert.equal(Math.round(pvpAuto), Math.round(pvpMaterializado));
  });
});

describe("No doble descuento — fila con precio_final_autoritativo nunca vuelve a aplicar el descuento de la vigencia", () => {
  test("aunque la vigencia siga marcada tipo=descuento_pct/descuento_valor=10, el neto materializado se usa TAL CUAL (no 400.000×0,9×0,9)", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    // La vigencia de la promo, si se creó como descuento_pct (uso típico),
    // sigue trayendo su propio `descuento_valor` — precioFinalTemporadas debe
    // evitar que se reaplique sobre el neto YA descontado de la fila materializada.
    const promo = temporada({ nombre: "ALTA_PROMO_FULL", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10 });
    const temporadas = [base, promo];
    const netoMaterializado = 360_000; // (300.000+100.000) × 0,90 — YA con el descuento aplicado
    const netoPorTemporada = { ALTA_PROMO_FULL: netoMaterializado, ALTA: 400_000 };
    const r = resolverNetoNocheDetallado(
      new Date("2026-09-05T00:00:00").getTime(),
      temporadas, netoPorTemporada, HOY, "FULL",
      new Set(["ALTA_PROMO_FULL"])
    );
    assert.ok(r);
    assert.equal(r!.neto, 360_000);
    assert.notEqual(r!.neto, Math.round(360_000 * 0.9)); // NUNCA re-aplicar el 10% sobre el ya descontado
    assert.equal(r!.precioFinalAutoritativo, true);
  });
});

describe("Vista previa y filas persistidas — misma función, no pueden divergir", () => {
  test("generarTarifas('dubai', params) delega EXACTO en generarTarifasDubai (el dispatcher que usa generarTarifasCalculadora, la persistencia)", () => {
    const params: DubaiParams = {
      regimen_base: "PAE",
      modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
      suplementos: [{ regimen: "FULL", monto: 100_000 }],
      bases: [{ categoria: "Superior", temporada: "ALTA", precio: 300_000 }],
      promos: [{ temporadaBase: "ALTA", temporadaPromo: "ALTA_PROMO_FULL", regimen: "FULL", descuentoPct: 10 }],
    };
    // La MISMA llamada que hace CalculadoraEditor.tsx para la vista previa
    // (`generarTarifasDubai(params)`) y la que hace `generarTarifasCalculadora`
    // (hoteles/actions.ts) vía el dispatcher `generarTarifas("dubai", params)`.
    const viaPreview = generarTarifasDubai(params);
    const viaPersistencia = generarTarifas("dubai", params);
    assert.deepEqual(viaPersistencia, viaPreview);
  });
});

describe("Paquete con 3 noches y MK 10% — caso REAL validado por el usuario: PAE y FULL, MISMA temporada destino 'PROMOCION', sin regimen_restringido", () => {
  // Escenario exacto de la captura: base Estándar PAE doble = 200.000,
  // suplemento propio de la base para FULL = 200.000, y las DOS entradas de
  // la calculadora apuntan a la MISMA `temporadaPromo`: "PROMOCION" — una
  // materializa PAE al 10%, la otra materializa FULL al 10%. En
  // `hotel_temporadas` existe UNA sola vigencia "PROMOCION" (sin
  // `regimen_restringido`); cada régimen obtiene su propia fila de
  // `tarifa_hotel` por la combinación temporada+alimentación real — la
  // vigencia no necesita restringirse por régimen porque la identidad de la
  // fila (`neto_doble` por combo) ya la separa.
  const paramsCalc: DubaiParams = {
    regimen_base: "PAE",
    modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
    suplementos: [],
    bases: [{
      categoria: "Estandar", temporada: "ALTA", precio: 200_000,
      usarSuplementosPropios: true, suplementosPropios: [{ regimen: "FULL", monto: 200_000 }],
    }],
    promos: [
      { temporadaBase: "ALTA", temporadaPromo: "PROMOCION", regimen: "PAE", descuentoPct: 10 },
      { temporadaBase: "ALTA", temporadaPromo: "PROMOCION", regimen: "FULL", descuentoPct: 10 },
    ],
  };
  const filas = generarTarifasDubai(paramsCalc);
  const filaPromoPae = filas.find((f) => f.temporada === "PROMOCION" && f.alimentacion === "PAE")!;
  const filaPromoFull = filas.find((f) => f.temporada === "PROMOCION" && f.alimentacion === "FULL")!;

  test("PAE materializado = 200.000 × 0,90 = 180.000", () => {
    assert.equal(filaPromoPae.neto_doble, 180_000);
  });

  test("FULL materializado = (200.000+200.000) × 0,90 = 360.000", () => {
    assert.equal(filaPromoFull.neto_doble, 360_000);
  });

  test("dos promos de calculadora con la MISMA temporada destino son válidas cuando corresponden a regímenes diferentes (sin solapamiento)", () => {
    const errores = validarDubaiParams(paramsCalc);
    assert.equal(errores.filter((e) => /solapad/.test(e.mensaje)).length, 0, "no debe rechazar dos promos que comparten temporadaPromo pero difieren en régimen");
  });

  // UNA sola vigencia "PROMOCION" en `hotel_temporadas` — sin
  // `regimen_restringido` (aplica a cualquier régimen que la consulte). Cada
  // liquidación por régimen trae su PROPIO `netoPorTemporada` (el neto de SU
  // fila materializada), así que la MISMA vigencia resuelve valores
  // distintos según el régimen que se esté liquidando.
  const base = temporada({ nombre: "ALTA", prioridad: 1 });
  const vigenciaPromocion = temporada({ nombre: "PROMOCION", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10, regimen_restringido: null });
  const temporadas = [base, vigenciaPromocion];
  const precioFinalTemporadas = new Set(["PROMOCION"]);

  test("liquidación de 3 noches con las filas AUTORITATIVAS (precioFinalTemporadas) — PAE usa su propio neto bajo 'PROMOCION'", () => {
    const netoPorTemporada = { PROMOCION: 180_000 };
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY, regimen: "PAE", precioFinalTemporadas });
    assert.equal(total, 540_000); // 180.000 × 3 — sin doble descuento (nunca 180.000×0,9×3)
  });

  test("liquidación de 3 noches con las filas AUTORITATIVAS — FULL usa su propio neto bajo 'PROMOCION' (mismo nombre de vigencia, mapa independiente)", () => {
    const netoPorTemporada = { PROMOCION: 360_000 };
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY, regimen: "FULL", precioFinalTemporadas });
    assert.equal(total, 1_080_000); // 360.000 × 3 — sin doble descuento (nunca 360.000×0,9×3)
  });

  test("sin doble descuento: el neto de cada noche es EXACTAMENTE el materializado, nunca re-descontado", () => {
    const rPae = resolverNetoNocheDetallado(
      new Date("2026-09-05T00:00:00").getTime(), temporadas, { PROMOCION: 180_000 }, HOY, "PAE", precioFinalTemporadas
    );
    assert.ok(rPae);
    assert.equal(rPae!.neto, 180_000);
    assert.equal(rPae!.precioFinalAutoritativo, true);
    assert.notEqual(rPae!.neto, Math.round(180_000 * 0.9)); // nunca 162.000

    const rFull = resolverNetoNocheDetallado(
      new Date("2026-09-05T00:00:00").getTime(), temporadas, { PROMOCION: 360_000 }, HOY, "FULL", precioFinalTemporadas
    );
    assert.ok(rFull);
    assert.equal(rFull!.neto, 360_000);
    assert.equal(rFull!.precioFinalAutoritativo, true);
    assert.notEqual(rFull!.neto, Math.round(360_000 * 0.9)); // nunca 324.000
  });

  test("procedencia: la vigencia GANADORA es 'PROMOCION' tanto para PAE como para FULL", () => {
    const rPae = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada: { PROMOCION: 180_000 }, hoy: HOY, regimen: "PAE", precioFinalTemporadas,
    });
    assert.ok(rPae);
    assert.equal(rPae!.procedencia[0].temporadaGanadora, "PROMOCION");
    assert.equal(rPae!.procedencia[0].esPromocion, true);

    const rFull = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada: { PROMOCION: 360_000 }, hoy: HOY, regimen: "FULL", precioFinalTemporadas,
    });
    assert.ok(rFull);
    assert.equal(rFull!.procedencia[0].temporadaGanadora, "PROMOCION");
    assert.equal(rFull!.procedencia[0].esPromocion, true);
  });

  test("PVP con MK 10% — PAE = 600.000 (180.000×3 / 0,90); FULL = 1.200.000 (360.000×3 / 0,90)", () => {
    const netoPaeTresNoches = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada: { PROMOCION: 180_000 }, hoy: HOY, regimen: "PAE", precioFinalTemporadas })!;
    const netoFullTresNoches = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada: { PROMOCION: 360_000 }, hoy: HOY, regimen: "FULL", precioFinalTemporadas })!;

    const pvpPae = marcar(netoPaeTresNoches, 0.10);
    const pvpFull = marcar(netoFullTresNoches, 0.10);
    assert.equal(Math.round(pvpPae), 600_000);
    assert.equal(Math.round(pvpFull), 1_200_000);
  });
});
