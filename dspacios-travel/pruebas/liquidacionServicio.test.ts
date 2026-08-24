import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  construirContextoServicios,
  calcularPrecioConModoYMarkup,
  calcularResultadoServicio,
  resolverLiquidacionServicioPuntual,
  type DatosServicioPar,
  type FilaPaquete,
  type FilaArmadoServicio,
  type FilaServicioAdicional,
} from "../lib/reservar/liquidacionServicio.ts";

// ───────────────────────────────────────────────────────────────────────────
// Ronda 4 — "RELIQUIDACIÓN DE TOURS PUEDE SUBCOTIZAR". La re-liquidación
// puntual del checkout (resolverLiquidacionServicioPuntual) ya NO usa
// defaults de modo/markup cuando falta armado_servicios/armado_paquetes —
// exige ambos presentes, confirma que el armado pertenece exactamente al par
// consultado, revisa cada error de Supabase por separado, y distingue tres
// motivos de fallo ("no_disponible" / "error_consulta" / "configuracion_invalida").
// Estas pruebas ejecutan la lógica REAL (no solo texto): el módulo es puro
// (sin Supabase/next), así que node --test lo importa directo.
// ───────────────────────────────────────────────────────────────────────────

const PAR: DatosServicioPar = { servicioId: 1, paqueteId: 10, nombre: "Tour X", destino: "Cartagena", descripcion: "Un tour" };
const PAQUETE: FilaPaquete = { id: 10, pct_mk: 0.2 };
const ARMADO: FilaArmadoServicio = { paquete_id: 10, servicio_id: 1, modo: "persona" };
const SERVICIO: FilaServicioAdicional = { id: 1, precio_persona: 100_000, recargo_individual: 5_000, liquidacion: null, moneda: "COP" };
const FECHA = new Date("2026-10-01T00:00:00");

function baseInput(overrides: Partial<Parameters<typeof resolverLiquidacionServicioPuntual>[0]> = {}) {
  return {
    par: PAR, fechaIdaDate: FECHA, numNoches: 1, pax: 2,
    filaTarifarioEncontrada: true, filaTarifarioError: null,
    paquete: PAQUETE, paqueteError: null,
    armado: ARMADO, armadoError: null,
    servicio: SERVICIO, servicioError: null,
    grupos: [], gruposError: null,
    temporadas: [], temporadasError: null,
    ...overrides,
  };
}

describe("1. Camino feliz: paquete+armado+servicio presentes → cotiza con el markup y modo REALES", () => {
  test("modo persona, 20% markup: total = (neto/persona × pax) marcado al 20%, nunca 0% de markup", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resultado.pax, 2);
      // Con pax=2 no aplica el recargo individual (solo pax===1) — neto =
      // 100000 × 2 = 200000; marcar(200000, 0.2) = 200000/(1−0.2) = 250000.
      assert.equal(r.resultado.total, 250_000);
      assert.notEqual(r.resultado.total, 200_000); // si el markup se hubiera caído a 0%, total sería el neto crudo sin margen
    }
  });
});

describe("2. Paquete ausente NUNCA cotiza con 0% de markup — aborta como configuración inválida", () => {
  test("paquete: null → ok:false, tipo configuracion_invalida, ningún resultado", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ paquete: null }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.tipo, "configuracion_invalida");
      assert.ok(!("resultado" in r));
    }
  });
});

describe("3. Armado ausente NUNCA cae a modo 'persona' por defecto — aborta como configuración inválida", () => {
  test("armado: null → ok:false, tipo configuracion_invalida", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ armado: null }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
  test("un servicio real de modo GRUPO, si su armado se pierde, no se re-liquida como 'persona' con el precio por persona (que puede ni existir)", () => {
    const servicioSoloGrupo: FilaServicioAdicional = { id: 2, precio_persona: null, recargo_individual: 0, liquidacion: null, moneda: "COP" };
    const r = resolverLiquidacionServicioPuntual(baseInput({ armado: null, servicio: servicioSoloGrupo, par: { ...PAR, servicioId: 2 } }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
});

describe("4. El armado debe pertenecer EXACTAMENTE al par consultado", () => {
  test("armado de otro paquete/servicio (aunque la fila exista) se rechaza como configuración inválida", () => {
    const armadoAjeno: FilaArmadoServicio = { paquete_id: 999, servicio_id: 1, modo: "persona" };
    const r = resolverLiquidacionServicioPuntual(baseInput({ armado: armadoAjeno }));
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /no corresponde al par/); }
  });
});

describe("5. Error simulado en CADA consulta aborta como error_consulta — nunca genera un resultado", () => {
  const casos: [string, Partial<Parameters<typeof resolverLiquidacionServicioPuntual>[0]>][] = [
    ["tarifario", { filaTarifarioError: "timeout" }],
    ["paquete", { paqueteError: "conexión perdida" }],
    ["armado", { armadoError: "500" }],
    ["servicio", { servicioError: "rls denegado" }],
    ["grupos", { gruposError: "timeout" }],
    ["temporadas", { temporadasError: "timeout" }],
  ];
  for (const [nombre, override] of casos) {
    test(`error en la consulta de ${nombre} → ok:false, tipo error_consulta`, () => {
      const r = resolverLiquidacionServicioPuntual(baseInput(override));
      assert.equal(r.ok, false);
      if (!r.ok) { assert.equal(r.tipo, "error_consulta"); assert.ok(!("resultado" in r)); }
    });
  }
});

describe("6. Servicio genuinamente no disponible se distingue de un fallo técnico", () => {
  test("tarifario no encontrado (par no publicado/activo) → no_disponible, no error_consulta", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ filaTarifarioEncontrada: false }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "no_disponible");
  });
  test("servicio sin fila (id ya no existe) → no_disponible", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ servicio: null }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "no_disponible");
  });
  test("sin tarifa vigente para esas fechas/pax (modo persona sin precio_persona) → no_disponible", () => {
    const servicioSinTarifa: FilaServicioAdicional = { id: 1, precio_persona: null, recargo_individual: 0, liquidacion: null, moneda: "COP" };
    const r = resolverLiquidacionServicioPuntual(baseInput({ servicio: servicioSinTarifa }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "no_disponible");
  });
});

describe("7. nombre/destino/descripción del par (nunca precio) — cambiarlos no afecta el total calculado", () => {
  test("el total depende SOLO de las filas de paquete/armado/servicio/temporadas/grupos, nunca del par", () => {
    const parManipulado: DatosServicioPar = { servicioId: 1, paqueteId: 10, nombre: "NOMBRE FALSO", destino: "DESTINO FALSO", descripcion: "desc falsa" };
    const r1 = resolverLiquidacionServicioPuntual(baseInput());
    const r2 = resolverLiquidacionServicioPuntual(baseInput({ par: parManipulado }));
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (r1.ok && r2.ok) {
      assert.equal(r1.resultado.total, r2.resultado.total);
      assert.equal(r2.resultado.nombre, "NOMBRE FALSO"); // el nombre SÍ se refleja (es cosmético, viene del tarifario)
    }
  });
});

describe("8. El resultado puntual coincide BYTE A BYTE con el camino de búsqueda (buscarReceptivos) para el mismo par/fechas/pax", () => {
  test("misma fórmula compartida (calcularPrecioConModoYMarkup): ambos caminos, con los mismos datos reales, dan el mismo objeto", () => {
    const ctx = construirContextoServicios({
      paquetes: [PAQUETE], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [],
    });
    // Camino "búsqueda" (tolerante, pero con datos completos no hay diferencia).
    const rBusqueda = calcularResultadoServicio(PAR, ctx, FECHA, 1, 2);
    // Camino "checkout" (fallo cerrado).
    const rCheckout = resolverLiquidacionServicioPuntual(baseInput());
    assert.equal(rCheckout.ok, true);
    if (rCheckout.ok) {
      assert.deepEqual(rBusqueda, rCheckout.resultado);
    }
  });
  test("ambos caminos usan la misma función base — cambiar el markup cambia el resultado de los dos por igual", () => {
    const paqueteOtroMarkup: FilaPaquete = { id: 10, pct_mk: 0.35 };
    const ctx = construirContextoServicios({
      paquetes: [paqueteOtroMarkup], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [],
    });
    const rBusqueda = calcularResultadoServicio(PAR, ctx, FECHA, 1, 2);
    const rCheckout = resolverLiquidacionServicioPuntual(baseInput({ paquete: paqueteOtroMarkup }));
    assert.equal(rCheckout.ok, true);
    if (rCheckout.ok) assert.deepEqual(rBusqueda, rCheckout.resultado);
  });
});

describe("9. calcularPrecioConModoYMarkup nunca decide defaults por sí sola — exige modo y pctMk explícitos", () => {
  test("modo 'grupo' sin rangos de grupo configurados → null (no inventa un precio por persona)", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [], servicios: [SERVICIO], grupos: [], temporadas: [] });
    const r = calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "grupo", 0.2);
    assert.equal(r, null);
  });
  test("0% de markup explícito SÍ se respeta (es una decisión real del llamador, no un default oculto)", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [], servicios: [SERVICIO], grupos: [], temporadas: [] });
    const r = calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "persona", 0);
    assert.ok(r);
    if (r) assert.equal(r.total, 200_000); // 2 pax × 100000, sin margen, sin recargo (pax≠1)
  });
});
