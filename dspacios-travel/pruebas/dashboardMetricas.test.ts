import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pctOrNull, pctRawOrNull, clasificarContratos, clasificarCartera, fechaLimitePago } from "../lib/dashboard/metricas";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no solo inspección de fuente) de la lógica pura
// detrás de los KPI del Dashboard — meta general, contratos y cartera.
// ─────────────────────────────────────────────────────────────────────────

describe("pctOrNull — % principal, SIEMPRE acotado 0-100", () => {
  test("0%, 50%, 100% y superior a 100% (acotado a 100)", () => {
    assert.equal(pctOrNull(0, 100), 0);
    assert.equal(pctOrNull(50, 100), 50);
    assert.equal(pctOrNull(100, 100), 100);
    assert.equal(pctOrNull(150, 100), 100); // 150% se acota a 100 — nunca se muestra como % principal
  });

  test("sin denominador válido (0, negativo o ausente) no hay %, nunca se asume 0", () => {
    assert.equal(pctOrNull(10, 0), null);
    assert.equal(pctOrNull(10, -5), null);
  });
});

describe("pctRawOrNull — SOLO para cuantificar excedente, nunca como % principal", () => {
  test("por encima de 100 devuelve el número real, sin acotar", () => {
    assert.equal(pctRawOrNull(120, 100), 120);
    assert.equal(pctRawOrNull(250, 100), 250);
  });

  test("0%, 50% y 100% coinciden con la variante acotada (no hay diferencia bajo el 100%)", () => {
    assert.equal(pctRawOrNull(0, 100), 0);
    assert.equal(pctRawOrNull(50, 100), 50);
    assert.equal(pctRawOrNull(100, 100), 100);
  });

  test("sin denominador válido tampoco hay número", () => {
    assert.equal(pctRawOrNull(10, 0), null);
  });
});

describe("Meta general de ventas — casos de dashboard/page.tsx (0%, 50%, 100%, >100%)", () => {
  function calcular(ventaMes: number, metaVentas: number) {
    const metaVentasPct = pctOrNull(ventaMes, metaVentas); // % principal / ancho de barra
    const metaVentasPctCrudo = pctRawOrNull(ventaMes, metaVentas);
    const metaSuperadaPor = metaVentasPctCrudo != null && metaVentasPctCrudo > 100 ? ventaMes - metaVentas : null;
    return { metaVentasPct, metaSuperadaPor };
  }

  test("ventas en 0% de la meta", () => {
    const { metaVentasPct, metaSuperadaPor } = calcular(0, 100_000_000);
    assert.equal(metaVentasPct, 0);
    assert.equal(metaSuperadaPor, null);
  });

  test("ventas en 50% de la meta", () => {
    const { metaVentasPct, metaSuperadaPor } = calcular(50_000_000, 100_000_000);
    assert.equal(metaVentasPct, 50);
    assert.equal(metaSuperadaPor, null);
  });

  test("ventas exactamente en 100% de la meta", () => {
    const { metaVentasPct, metaSuperadaPor } = calcular(100_000_000, 100_000_000);
    assert.equal(metaVentasPct, 100);
    assert.equal(metaSuperadaPor, null);
  });

  test("ventas superan la meta (134%): el % principal queda en 100 (nunca 134), y se cuantifica el excedente en $ aparte", () => {
    const { metaVentasPct, metaSuperadaPor } = calcular(134_000_000, 100_000_000);
    assert.equal(metaVentasPct, 100); // NUNCA 134 como % principal
    assert.equal(metaSuperadaPor, 34_000_000); // el excedente real, para el texto "Meta general superada por $34.000.000"
  });
});

describe("clasificarContratos — numerador SUBCONJUNTO explícito del denominador", () => {
  test("2 pendientes + 3 confirmados + 1 activo + 1 cancelado → 4 de 6 (nunca 4 de 1)", () => {
    const ventas = [
      { estado: "pendiente" }, { estado: "pendiente" },
      { estado: "confirmado" }, { estado: "confirmado" }, { estado: "confirmado" },
      { estado: "activo" },
      { estado: "cancelado" },
    ];
    const { nVigentes, nPendientes, nConfirmadosOActivos } = clasificarContratos(ventas);
    assert.equal(nVigentes, 6); // 2 pendientes + 3 confirmados + 1 activo (cancelado excluido)
    assert.equal(nPendientes, 2);
    assert.equal(nConfirmadosOActivos, 4); // 3 confirmados + 1 activo
  });

  test("el numerador nunca supera el denominador, incluso con un estado desconocido (no contemplado)", () => {
    const ventas = [
      { estado: "confirmado" }, { estado: "activo" }, { estado: "misterioso" }, { estado: "pendiente" },
    ];
    const { nVigentes, nConfirmadosOActivos } = clasificarContratos(ventas);
    assert.equal(nVigentes, 4); // todos menos cancelado (no hay ninguno)
    assert.equal(nConfirmadosOActivos, 2); // "misterioso" NO cuenta como confirmado/activo
    assert.ok(nConfirmadosOActivos <= nVigentes);
  });

  test("solo pendientes y cancelados: sin confirmados/activos, el numerador es 0 (sin dividir por cero en pctOrNull)", () => {
    const ventas = [{ estado: "pendiente" }, { estado: "cancelado" }];
    const { nVigentes, nConfirmadosOActivos } = clasificarContratos(ventas);
    assert.equal(nVigentes, 1);
    assert.equal(nConfirmadosOActivos, 0);
    assert.equal(pctOrNull(nConfirmadosOActivos, nVigentes), 0);
  });

  test("sin ningún contrato: nVigentes = 0, la barra no se dibuja (pctOrNull da null)", () => {
    const { nVigentes, nConfirmadosOActivos } = clasificarContratos([]);
    assert.equal(nVigentes, 0);
    assert.equal(pctOrNull(nConfirmadosOActivos, nVigentes), null);
  });
});

describe("fechaLimitePago — fechaSalida − 30 días calendario exactos", () => {
  test("30 de noviembre − 30 días = 31 de octubre", () => {
    assert.equal(fechaLimitePago("2026-11-30"), "2026-10-31");
  });

  test("cruza fin de año correctamente (15 de enero − 30 días = 16 de diciembre del año anterior)", () => {
    assert.equal(fechaLimitePago("2027-01-15"), "2026-12-16");
  });
});

describe("clasificarCartera — al día/vencida por fecha límite, sin fecha, pago total/parcial, COP/USD", () => {
  const HOY = "2026-11-01"; // fecha fija de Bogotá para todas las pruebas de este bloque

  test("en la fecha límite exacta (fechaViaje − 30d) TODAVÍA figura al día", () => {
    // fechaLimitePago("2026-12-01") = "2026-11-01" = HOY exactamente.
    const ventas = [{ numero_contrato: "A", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" }];
    const r = clasificarCartera(ventas, {}, HOY);
    assert.equal(r["COP"].alDia, 1_000_000);
    assert.equal(r["COP"].vencida, 0);
  });

  test("un día después de la fecha límite ya figura vencida", () => {
    // fechaLimitePago("2026-11-30") = "2026-10-31", que es ANTERIOR a HOY (2026-11-01).
    const ventas = [{ numero_contrato: "B", precio_venta: 1_000_000, fecha_salida: "2026-11-30", estado: "confirmado", moneda: "COP" }];
    const r = clasificarCartera(ventas, {}, HOY);
    assert.equal(r["COP"].vencida, 1_000_000);
    assert.equal(r["COP"].alDia, 0);
  });

  test("saldo completamente pagado (abono = precio_venta) NO aparece en cartera", () => {
    const ventas = [{ numero_contrato: "C", precio_venta: 1_000_000, fecha_salida: "2026-11-30", estado: "confirmado", moneda: "COP" }];
    const r = clasificarCartera(ventas, { C: 1_000_000 }, HOY);
    assert.deepEqual(r, {}); // ningún balde: el saldo es 0, se excluye por completo
  });

  test("pago parcial: el saldo pendiente es la diferencia, no el precio_venta completo", () => {
    const ventas = [{ numero_contrato: "D", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" }];
    const r = clasificarCartera(ventas, { D: 400_000 }, HOY);
    assert.equal(r["COP"].alDia, 600_000);
  });

  test("contrato cancelado: el caller debe excluirlo antes de llamar (no es responsabilidad de clasificarCartera) — se documenta pasando solo no-cancelados", () => {
    // dashboard/page.tsx filtra `estado !== "cancelado"` ANTES de llamar a
    // clasificarCartera — esta prueba confirma que la función confía en ese
    // filtro (no re-filtra estado internamente), así que un caller que
    // olvide filtrar vería el cancelado igual clasificado (documentado, no
    // es un bug de la función: el contrato del filtro vive en el caller).
    const ventas = [{ numero_contrato: "E", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "cancelado", moneda: "COP" }];
    const r = clasificarCartera(ventas, {}, HOY);
    assert.equal(r["COP"].alDia, 1_000_000, "confirma que el filtro de cancelados vive en el caller, no acá");
  });

  test("sin fecha de viaje: NUNCA se clasifica como al día — va a un balde `sinFecha` aparte", () => {
    const ventas = [{ numero_contrato: "F", precio_venta: 500_000, fecha_salida: null, estado: "confirmado", moneda: "COP" }];
    const r = clasificarCartera(ventas, {}, HOY);
    assert.equal(r["COP"].alDia, 0);
    assert.equal(r["COP"].vencida, 0);
    assert.equal(r["COP"].sinFecha, 500_000);
    assert.equal(r["COP"].sinFechaCount, 1);
  });

  test("COP y USD nunca se suman — quedan en baldes separados por moneda", () => {
    const ventas = [
      { numero_contrato: "G", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" },
      { numero_contrato: "H", precio_venta: 1_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "USD" },
    ];
    const r = clasificarCartera(ventas, {}, HOY);
    assert.equal(r["COP"].alDia, 1_000_000);
    assert.equal(r["USD"].alDia, 1_000);
    // Ninguna combinación numérica mezcla los dos — son objetos independientes.
    assert.notEqual(r["COP"], r["USD"]);
  });

  test("moneda ausente/nula se trata como COP (comportamiento explícito, no un accidente)", () => {
    const ventas = [{ numero_contrato: "I", precio_venta: 200_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: null }];
    const r = clasificarCartera(ventas, {}, HOY);
    assert.equal(r["COP"].alDia, 200_000);
  });
});
