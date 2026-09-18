import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  liquidarHotelNoches,
  toTemporadaRango,
  type TemporadaRango,
} from "../lib/calc/paquetes.ts";

// ───────────────────────────────────────────────────────────────────────────
// Hallazgo 3 (cobertura) — dos regímenes, PC y PAM: una promoción restringida
// a un régimen (`hotel_temporadas.regimen_restringido`, migración 123) debe
// modificar SOLO ese régimen y conservar la tarifa base del otro intacta.
// Reutiliza el harness puro ya existente para este motor
// (`lib/calc/paquetes.ts` vía `liquidarHotelNoches`, mismo patrón que
// `liquidarHotelNochesConTemporadas.test.ts`) — sin refactor ni DI nueva:
// `filasHoteles` (paquetes/actions.ts) ya llama esta misma función pasando
// el `regimen` de cada combo categoría/régimen que genera.
// ───────────────────────────────────────────────────────────────────────────

const HOY = "2026-01-01";

function temporada(overrides: Partial<Parameters<typeof toTemporadaRango>[0]>): TemporadaRango {
  return toTemporadaRango({
    nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30",
    prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    ...overrides,
  });
}

describe("descuento_pct restringido a PC modifica PC y conserva PAM base intacta", () => {
  test("régimen PC: la promo del 10% SÍ se aplica", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const promoPc: TemporadaRango = temporada({
      nombre: "PROMO_PC", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10,
      regimen_restringido: "PC",
    });
    const temporadas = [base, promoPc];
    const netoPorTemporada = { ALTA: 100_000 };
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada, hoy: HOY, regimen: "PC" });
    // 100000 * 0.9 = 90000 por noche × 2 = 180000.
    assert.equal(total, 180_000);
  });

  test("régimen PAM: la MISMA promo (restringida a PC) NO se aplica — base intacta", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const promoPc: TemporadaRango = temporada({
      nombre: "PROMO_PC", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10,
      regimen_restringido: "PC",
    });
    const temporadas = [base, promoPc];
    const netoPorTemporada = { ALTA: 120_000 }; // neto propio de PAM, distinto al de PC
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada, hoy: HOY, regimen: "PAM" });
    // Sin descuento: 120000 × 2 = 240000 — la promo de PC nunca compite por PAM.
    assert.equal(total, 240_000);
  });
});

describe("promoción de reemplazo (tipo 'tarifa' de mayor prioridad, restringida a un régimen)", () => {
  // En el modelo actual no existe un tipo 'reemplazo' propio: una vigencia
  // 'tarifa' con prioridad mayor que la base y su propio neto EN
  // `netoPorTemporada` gana la noche por completo (reemplaza, no descuenta) —
  // ver `entradasNoche`/`netoNoche` en lib/calc/paquetes.ts (ordena por
  // prioridad descendente y toma la primera que cubra + calce régimen).
  test("régimen PC: la tarifa de reemplazo (prioridad mayor) gana sobre la base", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const reemplazoPc: TemporadaRango = temporada({
      nombre: "REEMPLAZO_PC", prioridad: 5, tipo: "tarifa", regimen_restringido: "PC",
    });
    const temporadas = [base, reemplazoPc];
    const netoPorTemporada = { ALTA: 100_000, REEMPLAZO_PC: 70_000 };
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada, hoy: HOY, regimen: "PC" });
    assert.equal(total, 140_000); // 70000 × 2 — la base de 100000 quedó reemplazada
  });

  test("régimen PAM: el reemplazo restringido a PC no aplica — sigue la base", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const reemplazoPc: TemporadaRango = temporada({
      nombre: "REEMPLAZO_PC", prioridad: 5, tipo: "tarifa", regimen_restringido: "PC",
    });
    const temporadas = [base, reemplazoPc];
    const netoPorTemporada = { ALTA: 100_000, REEMPLAZO_PC: 70_000 };
    const total = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada, hoy: HOY, regimen: "PAM" });
    assert.equal(total, 200_000); // 100000 × 2 — la base sigue vigente para PAM
  });
});
