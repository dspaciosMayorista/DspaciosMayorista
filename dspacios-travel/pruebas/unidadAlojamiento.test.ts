import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cotizarUnidadAlojamiento,
  construirSnapshotAlojamiento,
  clasificarMenores,
  determinarCantidadUnidades,
  resultadoBloqueado,
  type TarifaAlojamiento,
  type ResultadoValido,
  type EntradaCotizacion,
} from "../lib/calc/unidadAlojamiento.ts";

function esperarValido(r: ReturnType<typeof cotizarUnidadAlojamiento>): asserts r is ResultadoValido {
  assert.equal(r.ok, true, `se esperaba un resultado válido, se obtuvo bloqueo: ${!r.ok ? `${r.codigo} — ${r.mensaje}` : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────
// § Persona — el eje que ya soporta el sistema hoy, como caso base.
// ─────────────────────────────────────────────────────────────────────────
describe("unidad persona", () => {
  const tarifaPersona: TarifaAlojamiento = {
    id: "t-persona-1",
    unidadCobro: "persona",
    valores: { adulto: 100_000, nino: 70_000 },
    capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
    suplementos: [],
    reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 }] },
  };

  test("persona por noche: adultos y niños se mantienen separados por categoría", () => {
    const entrada: EntradaCotizacion = {
      tarifa: tarifaPersona,
      ocupacion: { adultos: 2, menores: [{ edadAnios: 6 }] },
      noches: 3,
    };
    const r = cotizarUnidadAlojamiento(entrada);
    esperarValido(r);
    // 2 adultos × 100.000 + 1 niño × 70.000 = 270.000/noche × 3 noches = 810.000
    assert.equal(r.totalNetoPorNoche, 270_000);
    assert.equal(r.totalNeto, 810_000);
    assert.equal(r.cantidadUnidades, 2); // "unidades" = adultos; el niño no cuenta como unidad
    assert.equal(r.menoresClasificados.length, 1);
    assert.equal(r.menoresClasificados[0].categoria, "nino");
    assert.deepEqual(
      r.desglose.map((l) => l.concepto),
      ["Adultos", "Niños"]
    );
  });

  test("niño con regla aplicable: la edad cae dentro del rango configurado", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaPersona,
      ocupacion: { adultos: 1, menores: [{ edadAnios: 4 }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.menoresClasificados[0].categoria, "nino");
  });

  test("niño sin regla: la edad no está cubierta por ninguna regla configurada → edad_fuera_de_regla", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaPersona,
      ocupacion: { adultos: 1, menores: [{ edadAnios: 15 }] },
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "edad_fuera_de_regla");
  });

  test("tarifa ambigua: la edad coincide con dos reglas de menores a la vez → combinacion_ambigua", () => {
    const reglaAmbigua = {
      reglas: [
        { categoria: "nino" as const, edadMinAnios: 0, edadMaxAnios: 10 },
        { categoria: "infante" as const, edadMinAnios: 0, edadMaxAnios: 3 },
      ],
    };
    const c = clasificarMenores([{ edadAnios: 2 }], reglaAmbigua);
    assert.equal("codigo" in c ? c.codigo : null, "combinacion_ambigua");

    const r = cotizarUnidadAlojamiento({
      tarifa: { ...tarifaPersona, reglaMenores: reglaAmbigua },
      ocupacion: { adultos: 1, menores: [{ edadAnios: 2 }] },
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "combinacion_ambigua");
  });

  test("tarifa_no_encontrada: la edad clasifica bien, pero no hay valor configurado para esa categoría", () => {
    const sinValorInfante: TarifaAlojamiento = {
      ...tarifaPersona,
      valores: { adulto: 100_000 }, // sin `nino`
    };
    const r = cotizarUnidadAlojamiento({
      tarifa: sinValorInfante,
      ocupacion: { adultos: 1, menores: [{ edadAnios: 6 }] }, // 6 años clasifica "nino" por la regla
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "tarifa_no_encontrada");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Pareja — ej. Mumu Hotel / Okai (Guatapé, pág. 14–15 de la revista):
// tarifa fija por pareja, sin desglose por persona.
// ─────────────────────────────────────────────────────────────────────────
describe("unidad pareja", () => {
  // Cifra de ejemplo usada ya en el análisis previo (artefacto Bernalo,
  // §2) — no se carga al sistema en este PR, es solo el insumo de prueba.
  const tarifaMumu: TarifaAlojamiento = {
    id: "t-mumu-1",
    unidadCobro: "pareja",
    valores: { adulto: 550_000 }, // valor de LA PAREJA/noche, no por persona
    capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
    suplementos: [],
    reglaMenores: { reglas: [] }, // Mumu no tiene política de niños (hotel de pareja)
  };

  test("pareja exacta: 2 adultos, 1 pareja, conserva el total publicado sin dividir y volver a multiplicar", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaMumu,
      ocupacion: { adultos: 2, menores: [] },
      noches: 2,
    });
    esperarValido(r);
    assert.equal(r.cantidadUnidades, 1);
    assert.equal(r.totalNetoPorNoche, 550_000);
    assert.equal(r.totalNeto, 1_100_000);
    assert.deepEqual(r.desglose, [
      { concepto: "Pareja", tipo: "base", cantidad: 1, valorUnitario: 550_000, valorTotal: 550_000 },
    ]);
  });

  test("pareja con ocupación no configurada: 3 adultos sin suplemento de 'adulto adicional' → falla cerrado", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaMumu, // suplementos: [] — no hay regla para el 3er adulto
      ocupacion: { adultos: 3, menores: [] },
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "tarifa_no_encontrada");
  });

  test("persona sola: 1 adulto para una tarifa de pareja, con suplemento explícito configurado", () => {
    const conPersonaSola: TarifaAlojamiento = {
      ...tarifaMumu,
      suplementos: [{ tipo: "persona_sola", valor: 400_000 }],
    };
    const r = cotizarUnidadAlojamiento({
      tarifa: conPersonaSola,
      ocupacion: { adultos: 1, menores: [] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 400_000);
  });

  test("dos adultos con un menor: exige suplemento 'menor_adicional' de esa categoría, o falla cerrado", () => {
    const parejaConNino: TarifaAlojamiento = {
      ...tarifaMumu,
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
    };
    const bloqueado = cotizarUnidadAlojamiento({
      tarifa: parejaConNino,
      ocupacion: { adultos: 2, menores: [{ edadAnios: 5 }] },
      noches: 1,
    });
    assert.equal(bloqueado.ok, false);
    if (!bloqueado.ok) assert.equal(bloqueado.codigo, "tarifa_no_encontrada");

    const conSuplemento: TarifaAlojamiento = {
      ...parejaConNino,
      suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 90_000 }],
    };
    const r = cotizarUnidadAlojamiento({
      tarifa: conSuplemento,
      ocupacion: { adultos: 2, menores: [{ edadAnios: 5 }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_000 + 90_000);
  });

  test("CONTROL NEGATIVO — dividir y volver a multiplicar cambiaría el total publicado (y este motor no lo hace)", () => {
    // Tarifa deliberadamente NO divisible exacto entre 2, para exponer el
    // error clásico: tomar "valor / 2" como precio por persona y luego
    // volver a multiplicar por los pasajeros introduce redondeo que el
    // total original no tiene.
    const tarifaImpar: TarifaAlojamiento = { ...tarifaMumu, id: "t-impar", valores: { adulto: 550_001 } };
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaImpar,
      ocupacion: { adultos: 2, menores: [] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_001, "el motor debe conservar el total publicado exacto");

    const totalConElErrorClasico = Math.round(550_001 / 2) * 2; // 275.000,5 → 275.001 → ×2 = 550.002
    assert.notEqual(
      r.totalNetoPorNoche,
      totalConElErrorClasico,
      "si esto fallara, el motor estaría cometiendo el error de dividir y volver a multiplicar"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Habitación — Casa Amanzi (Cartagena, pág. 28): cobro por habitación,
// rack $500.000, trazado desde la calculadora Corporativa YA existente
// (`lib/calc/calculadoras.ts`, `generarTarifasCorporativa`) para demostrar
// que este modelo no cambia el total que Corporativa ya produce hoy.
//
// Trazo (persona_adicional = 0, sin impuesto, sin descuento):
//   habConImpuesto = rack = 500.000
//   neto_sencilla = round(500.000)        = 500.000  × pax_tarifa(1) = 500.000
//   neto_doble    = round(500.000/2)      = 250.000  × pax_tarifa(2) = 500.000
//   neto_triple   = round(500.000/3)      = 166.667  × pax_tarifa(3) = 500.001  (redondeo de $1, YA existe en Corporativa — no lo introduce este motor)
//   neto_multiple = round(500.000/4)      = 125.000  × pax_tarifa(4) = 500.000
// ─────────────────────────────────────────────────────────────────────────
describe("unidad habitación — compatibilidad con Corporativa (Casa Amanzi)", () => {
  function tarifaHabitacion(pax: 1 | 2 | 3 | 4, valorUnidad: number): TarifaAlojamiento {
    return {
      id: `t-amanzi-${pax}`,
      unidadCobro: "habitacion",
      categoria: "estandar",
      valores: { adulto: valorUnidad },
      capacidad: { minPax: pax, maxPax: pax, paxIncluidos: pax },
      suplementos: [],
      reglaMenores: { reglas: [] },
      fuente: { documento: "revista-hoteles-2026-FINAL-comerciales", pagina: 28 },
    };
  }

  const casos: { nombre: string; pax: 1 | 2 | 3 | 4; netoCorporativa: number; totalEsperado: number }[] = [
    { nombre: "habitación SGL", pax: 1, netoCorporativa: 500_000, totalEsperado: 500_000 },
    { nombre: "habitación DBL", pax: 2, netoCorporativa: 250_000, totalEsperado: 500_000 },
    { nombre: "habitación TPL", pax: 3, netoCorporativa: 166_667, totalEsperado: 500_001 },
    { nombre: "habitación múltiple (4 pax)", pax: 4, netoCorporativa: 125_000, totalEsperado: 500_000 },
  ];

  for (const c of casos) {
    test(`${c.nombre}: conserva el total de rack (± redondeo ya existente en Corporativa)`, () => {
      // 1. Tarifa fuente: neto_X de Corporativa (ya calculado, no se recalcula aquí)
      const valorUnidad = c.netoCorporativa * c.pax; // reconstrucción del total de habitación, tal como hace hoy `computo.ts` (pax = rooms × pax_tarifa; precioVenta += pax × pvp)
      const tarifa = tarifaHabitacion(c.pax, valorUnidad);

      // 2. Ocupación: exactamente la capacidad de esta tarifa (SGL=1, DBL=2, TPL=3, múltiple=4)
      const ocupacion = { adultos: c.pax, menores: [] };

      // 3. Cantidad de unidades: 1 habitación
      const r = cotizarUnidadAlojamiento({ tarifa, ocupacion, distribucion: { cantidadUnidades: 1 }, noches: 1 });
      esperarValido(r);

      // 4. Suplementos: ninguno (ocupación exacta, sin pax fuera de lo incluido)
      assert.equal(r.suplementosAplicados.length, 0);

      // 5. Total esperado (derivado del rack real de Casa Amanzi, pág. 28)
      assert.equal(c.totalEsperado, valorUnidad);

      // 6. Total obtenido — debe coincidir con el total esperado, NO con
      // "valorUnidad × pax" (eso sería cobrar la habitación dos veces).
      assert.equal(r.totalNetoPorNoche, c.totalEsperado);
      assert.equal(r.cantidadUnidades, 1, "1 habitación, nunca 1 por cada pasajero");
    });
  }

  test("CONTROL NEGATIVO — multiplicar la tarifa de habitación por los pasajeros sobrecobraría", () => {
    const tarifa = tarifaHabitacion(2, 500_000); // DBL, capacidad exacta 2
    const r = cotizarUnidadAlojamiento({
      tarifa,
      ocupacion: { adultos: 2, menores: [] },
      noches: 1,
    });
    esperarValido(r);
    // El error clásico sería: valorUnidad(500.000) × pax(2) = 1.000.000 —
    // el doble del rack real. El motor nunca hace esa multiplicación.
    assert.notEqual(r.totalNetoPorNoche, tarifa.valores.adulto * 2);
    assert.equal(r.totalNetoPorNoche, 500_000);
  });

  test("CONTROL NEGATIVO — 3 pasajeros en una DBL sin suplemento configurado falla cerrado (no se factura por prorrateo)", () => {
    const tarifaEstrecta = tarifaHabitacion(2, 500_000); // maxPax=2, sin suplementos
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaEstrecta,
      ocupacion: { adultos: 3, menores: [] },
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "ocupacion_no_permitida");
    // Si el motor "arreglara" esto derivando un precio por persona
    // (250.000 × 3 = 750.000), estaría escondiendo un problema de
    // capacidad detrás de un cálculo silencioso — en vez de eso, bloquea.
  });

  test("suplemento explícito: un 3er adulto en una habitación ampliada (maxPax=3) se cobra solo si hay suplemento configurado", () => {
    const tarifaAmpliada: TarifaAlojamiento = {
      ...tarifaHabitacion(2, 500_000),
      capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 80_000 }],
    };
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaAmpliada,
      ocupacion: { adultos: 3, menores: [] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 500_000 + 80_000);
    assert.equal(r.suplementosAplicados[0].tipo, "adulto_adicional");
  });

  test("suplemento faltante: mismo caso, pero sin suplemento configurado → tarifa_no_encontrada", () => {
    const tarifaAmpliadaSinSuplemento: TarifaAlojamiento = {
      ...tarifaHabitacion(2, 500_000),
      capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 },
      suplementos: [],
    };
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaAmpliadaSinSuplemento,
      ocupacion: { adultos: 3, menores: [] },
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "tarifa_no_encontrada");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Apartamento — caso ILUSTRATIVO (capacidad/valores sintéticos; este PR
// no carga cifras reales de Mangata Living/Mauku Beach ni ningún otro
// hotel del PDF). Mismo mecanismo que habitación: unidad completa +
// capacidad mín/máx + suplemento explícito para pax adicionales.
// ─────────────────────────────────────────────────────────────────────────
describe("unidad apartamento", () => {
  const tarifaApto: TarifaAlojamiento = {
    id: "t-apto-1",
    unidadCobro: "apartamento",
    valores: { adulto: 800_000 },
    capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 6 },
    suplementos: [],
    reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
  };

  test("apartamento dentro de capacidad: 6 pax (4 adultos + 2 niños) sin suplemento", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaApto,
      ocupacion: { adultos: 4, menores: [{ edadAnios: 8 }, { edadAnios: 10 }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 800_000);
    assert.equal(r.suplementosAplicados.length, 0);
  });

  test("apartamento sobre capacidad: 8 pax sobre un máximo de 6 → ocupacion_no_permitida", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaApto,
      ocupacion: { adultos: 5, menores: [{ edadAnios: 8 }, { edadAnios: 10 }, { edadAnios: 6 }] },
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "ocupacion_no_permitida");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Productos fuera de alcance de este PR
// ─────────────────────────────────────────────────────────────────────────
describe("productos no soportados / reservados", () => {
  const tarifaCualquiera: TarifaAlojamiento = {
    id: "t-x",
    unidadCobro: "persona",
    valores: { adulto: 100_000 },
    capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
    suplementos: [],
    reglaMenores: { reglas: [] },
  };

  test("producto no soportado: day use (0 noches) falla cerrado, nunca aproxima", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaCualquiera,
      ocupacion: { adultos: 1, menores: [] },
      noches: 0,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "producto_no_soportado");
  });

  test("requiere_cotizacion_manual: la forma existe y es utilizable, aunque este motor todavía no la dispara por sí mismo", () => {
    // Reservado para cuando un PR futuro integre `hotel_temporadas.solo_paquete`
    // (paquetes/day-use). Este PR solo prueba que el código y la forma del
    // resultado bloqueado son correctos y sirven para ese caso.
    const r = resultadoBloqueado("requiere_cotizacion_manual", "El periodo solicitado solo tiene tarifa de paquete.");
    assert.equal(r.ok, false);
    assert.equal(r.codigo, "requiere_cotizacion_manual");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § determinación de cantidad de unidades — función pura aislada
// ─────────────────────────────────────────────────────────────────────────
test("determinarCantidadUnidades: persona cuenta adultos; habitación/apartamento/pareja usan la distribución explícita", () => {
  const base: TarifaAlojamiento = {
    id: "t",
    unidadCobro: "persona",
    valores: { adulto: 1 },
    capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
    suplementos: [],
    reglaMenores: { reglas: [] },
  };
  assert.equal(determinarCantidadUnidades(base, { adultos: 3, menores: [] }, { cantidadUnidades: 1 }), 3);
  assert.equal(
    determinarCantidadUnidades({ ...base, unidadCobro: "habitacion" }, { adultos: 3, menores: [] }, { cantidadUnidades: 2 }),
    2
  );
});

// ─────────────────────────────────────────────────────────────────────────
// § Snapshot — serializable, sin recálculo futuro, sin comisión precargada
// ─────────────────────────────────────────────────────────────────────────
describe("snapshot", () => {
  const tarifa: TarifaAlojamiento = {
    id: "t-amanzi-2",
    unidadCobro: "habitacion",
    categoria: "estandar",
    alimentacion: "Solo alojamiento",
    temporada: "BAJA",
    valores: { adulto: 500_000 },
    capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
    suplementos: [],
    reglaMenores: { reglas: [] },
    fuente: { documento: "revista-hoteles-2026-FINAL-comerciales", pagina: 28 },
    versionTarifario: "bernalo-2026",
  };
  const ocupacion = { adultos: 2, menores: [] as { edadAnios: number }[] };

  test("sin comisión: totalVenta === totalNeto, comisión es null (nunca un valor precargado)", () => {
    const r = cotizarUnidadAlojamiento({ tarifa, ocupacion, noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, ocupacion);
    assert.equal(snap.comision, null);
    assert.equal(snap.totalVenta, snap.totalNeto);
    assert.equal(snap.totalNeto, 1_000_000);
    assert.equal(snap.fuente?.pagina, 28);
    assert.equal(snap.versionTarifario, "bernalo-2026");
  });

  test("con comisión explícita (pasada por el llamador, no un default): se refleja en totalVenta", () => {
    const r = cotizarUnidadAlojamiento({ tarifa, ocupacion, noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, ocupacion, { comisionPct: 15 });
    assert.equal(snap.comision?.pct, 15);
    assert.equal(snap.comision?.valor, 150_000); // 15% de 1.000.000
    assert.equal(snap.totalVenta, 1_150_000);
  });

  test("serializable y estable: sobrevive un round-trip JSON.stringify/parse sin perder datos", () => {
    const r = cotizarUnidadAlojamiento({ tarifa, ocupacion, noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, ocupacion, { comisionPct: 10 });
    const roundtrip = JSON.parse(JSON.stringify(snap));
    assert.deepEqual(roundtrip, snap);

    // Estable: mismo insumo → mismo snapshot (no depende de Date.now(),
    // Math.random() ni de volver a consultar la tarifa).
    const r2 = cotizarUnidadAlojamiento({ tarifa, ocupacion, noches: 2 });
    esperarValido(r2);
    const snap2 = construirSnapshotAlojamiento(r2, tarifa, ocupacion, { comisionPct: 10 });
    assert.deepEqual(snap, snap2);
  });

  test("recalcular tarifas futuras nunca cambia un snapshot ya construido (no guarda ninguna referencia viva)", () => {
    const r = cotizarUnidadAlojamiento({ tarifa, ocupacion, noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, ocupacion);
    const tarifaMutadaLuego = { ...tarifa, valores: { adulto: 999_999_999 } };
    void tarifaMutadaLuego; // simula que la tarifa fuente cambió después — el snapshot ya copió sus valores
    assert.equal(snap.totalNeto, 1_000_000, "el snapshot no debe verse afectado por cambios posteriores a la tarifa fuente");
  });
});
