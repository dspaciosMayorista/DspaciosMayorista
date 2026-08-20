import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cotizarUnidadAlojamiento,
  construirSnapshotAlojamiento,
  clasificarMenores,
  determinarCantidadUnidades,
  derivarOcupacionTotal,
  resultadoBloqueado,
  type TarifaAlojamiento,
  type DistribucionUnidades,
  type ResultadoValido,
  type EntradaCotizacion,
} from "../lib/calc/unidadAlojamiento.ts";

function esperarValido(r: ReturnType<typeof cotizarUnidadAlojamiento>): asserts r is ResultadoValido {
  assert.equal(r.ok, true, `se esperaba un resultado válido, se obtuvo bloqueo: ${!r.ok ? `${r.codigo} — ${r.mensaje}` : ""}`);
}

function esperarCodigo(r: ReturnType<typeof cotizarUnidadAlojamiento>, codigo: string) {
  assert.equal(r.ok, false, `se esperaba un bloqueo (${codigo}), se obtuvo un resultado válido`);
  if (!r.ok) assert.equal(r.codigo, codigo);
}

// ─────────────────────────────────────────────────────────────────────────
// § Persona — el eje que ya soporta el sistema hoy, como caso base. La
// capacidad se sigue validando POR UNIDAD (habitación física) aunque el
// precio se calcule por pasajero agregado.
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
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaPersona,
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 6 }] }] },
      noches: 3,
    });
    esperarValido(r);
    // 2 adultos × 100.000 + 1 niño × 70.000 = 270.000/noche × 3 noches = 810.000
    assert.equal(r.totalNetoPorNoche, 270_000);
    assert.equal(r.totalNeto, 810_000);
    assert.equal(r.cantidadUnidades, 2); // "unidades" = suma de adultos; el niño no cuenta como unidad
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
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 4 }] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.menoresClasificados[0].categoria, "nino");
  });

  test("niño sin regla: la edad no está cubierta por ninguna regla configurada → edad_fuera_de_regla", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaPersona,
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 15 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "edad_fuera_de_regla");
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
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 2 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "combinacion_ambigua");
  });

  test("tarifa_no_encontrada: la edad clasifica bien, pero no hay valor configurado para esa categoría", () => {
    const sinValorInfante: TarifaAlojamiento = { ...tarifaPersona, valores: { adulto: 100_000 } }; // sin `nino`
    const r = cotizarUnidadAlojamiento({
      tarifa: sinValorInfante,
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 6 }] }] }, // 6 años clasifica "nino" por la regla
      noches: 1,
    });
    esperarCodigo(r, "tarifa_no_encontrada");
  });

  test("tarifa persona con habitación sobreocupada: la capacidad se valida por unidad aunque el cobro sea por pasajero", () => {
    const conCapacidad: TarifaAlojamiento = { ...tarifaPersona, capacidad: { minPax: 1, maxPax: 2, paxIncluidos: 0 } };
    const r = cotizarUnidadAlojamiento({
      tarifa: conCapacidad,
      distribucion: { unidades: [{ adultos: 3, menores: [] }] }, // 3 pax en una habitación de máx. 2
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Pareja — ej. Mumu Hotel / Okai (Guatapé, pág. 14–15 de la revista):
// tarifa fija por pareja, sin desglose por persona. Cada UNIDAD (pareja) se
// valida y calcula independientemente.
// ─────────────────────────────────────────────────────────────────────────
describe("unidad pareja", () => {
  // Pareja "estricta": una sola pareja, sin persona sola ni adultos extra.
  const tarifaMumu: TarifaAlojamiento = {
    id: "t-mumu-1",
    unidadCobro: "pareja",
    valores: { adulto: 550_000 }, // valor de LA PAREJA/noche, no por persona
    capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
    suplementos: [],
    reglaMenores: { reglas: [] }, // Mumu no tiene política de niños (hotel de pareja)
  };
  // Pareja "flexible": admite persona sola / adultos extra / menores, según
  // los suplementos que traiga cada prueba — capacidad ampliada para que la
  // validación de capacidad no tape la validación de suplemento que se
  // quiere probar.
  const parejaFlexible = (suplementos: TarifaAlojamiento["suplementos"]): TarifaAlojamiento => ({
    ...tarifaMumu,
    id: "t-mumu-flex",
    capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
    suplementos,
  });

  test("pareja exacta: 2 adultos, 1 unidad, conserva el total publicado sin dividir y volver a multiplicar", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaMumu,
      distribucion: { unidades: [{ adultos: 2, menores: [] }] },
      noches: 2,
    });
    esperarValido(r);
    assert.equal(r.cantidadUnidades, 1);
    assert.equal(r.totalNetoPorNoche, 550_000);
    assert.equal(r.totalNeto, 1_100_000);
    assert.deepEqual(r.desglose, [
      { concepto: "Pareja", tipo: "base", cantidad: 1, valorUnitario: 550_000, valorTotal: 550_000, unidadIndex: 0 },
    ]);
  });

  test("1 unidad con persona sola → tarifa persona sola (reemplaza la base, no se suma)", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 1, menores: [] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 400_000);
    assert.deepEqual(r.desglose[0].concepto, "Persona sola");
  });

  test("2 unidades: una pareja + una persona sola → pareja + persona sola", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: {
        unidades: [
          { adultos: 2, menores: [] },
          { adultos: 1, menores: [] },
        ],
      },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.cantidadUnidades, 2);
    assert.equal(r.totalNetoPorNoche, 550_000 + 400_000);
    assert.deepEqual(
      r.desglose.map((l) => [l.unidadIndex, l.concepto]),
      [
        [0, "Pareja"],
        [1, "Persona sola"],
      ]
    );
  });

  test("2 unidades: dos personas solas → dos tarifas de persona sola", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: {
        unidades: [
          { adultos: 1, menores: [] },
          { adultos: 1, menores: [] },
        ],
      },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 800_000);
  });

  test("falta la tarifa persona sola → falla cerrado", () => {
    const tarifa = parejaFlexible([]); // sin persona_sola configurada
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 1, menores: [] }] },
      noches: 1,
    });
    esperarCodigo(r, "tarifa_no_encontrada");
  });

  test("pareja con ocupación no configurada: 3 adultos sin suplemento de 'adulto adicional' → falla cerrado", () => {
    const tarifa = parejaFlexible([]); // capacidad hasta 4, pero sin adulto_adicional
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 3, menores: [] }] },
      noches: 1,
    });
    esperarCodigo(r, "tarifa_no_encontrada");
  });

  test("dos adultos con un menor: exige suplemento 'menor_adicional' de esa categoría, o falla cerrado", () => {
    const sinSuplemento: TarifaAlojamiento = {
      ...parejaFlexible([]),
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
    };
    const bloqueado = cotizarUnidadAlojamiento({
      tarifa: sinSuplemento,
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 5 }] }] },
      noches: 1,
    });
    esperarCodigo(bloqueado, "tarifa_no_encontrada");

    const conSuplemento: TarifaAlojamiento = {
      ...sinSuplemento,
      suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 90_000 }],
    };
    const r = cotizarUnidadAlojamiento({
      tarifa: conSuplemento,
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 5 }] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_000 + 90_000);
  });

  test("pareja que supera maxPax por menores: la capacidad estricta bloquea aunque el menor tenga regla", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: { ...tarifaMumu, reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] } },
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 5 }] }] }, // 3 pax, maxPax=2
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
  });

  test("varias unidades con mezcla pareja/persona sola: pareja + persona sola + pareja", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: {
        unidades: [
          { adultos: 2, menores: [] },
          { adultos: 1, menores: [] },
          { adultos: 2, menores: [] },
        ],
      },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_000 + 400_000 + 550_000);
    assert.equal(r.cantidadUnidades, 3);
  });

  test("CONTROL NEGATIVO — dividir y volver a multiplicar cambiaría el total publicado (y este motor no lo hace)", () => {
    // Tarifa deliberadamente NO divisible exacto entre 2, para exponer el
    // error clásico: tomar "valor / 2" como precio por persona y luego
    // volver a multiplicar por los pasajeros introduce redondeo que el
    // total original no tiene.
    const tarifaImpar: TarifaAlojamiento = { ...tarifaMumu, id: "t-impar", valores: { adulto: 550_001 } };
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaImpar,
      distribucion: { unidades: [{ adultos: 2, menores: [] }] },
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
      const distribucion: DistribucionUnidades = { unidades: [{ adultos: c.pax, menores: [] }] };

      // 3. Cantidad de unidades: 1 habitación
      const r = cotizarUnidadAlojamiento({ tarifa, distribucion, noches: 1 });
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

  test("una habitación con dos adultos (caso simple, números redondos)", () => {
    const tarifa = tarifaHabitacion(2, 300_000);
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 300_000);
  });

  test("dos habitaciones con dos adultos cada una: el total es la suma de cada unidad", () => {
    const tarifa = tarifaHabitacion(2, 300_000);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: {
        unidades: [
          { adultos: 2, menores: [] },
          { adultos: 2, menores: [] },
        ],
      },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.cantidadUnidades, 2);
    assert.equal(r.totalNetoPorNoche, 600_000);
  });

  test("dos habitaciones 3+1: detecta que la PRIMERA excede su capacidad, sin llegar a mirar la segunda", () => {
    const tarifa = tarifaHabitacion(2, 300_000); // maxPax=2 estricto
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: {
        unidades: [
          { adultos: 3, menores: [] }, // excede maxPax=2
          { adultos: 1, menores: [] },
        ],
      },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
    if (!r.ok) assert.equal(r.contexto?.indice, 0);
  });

  test("dos habitaciones 3+1: con capacidad ampliada la primera pasa, pero detecta que la SEGUNDA incumple el mínimo", () => {
    const tarifa: TarifaAlojamiento = { ...tarifaHabitacion(2, 300_000), capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 3 } };
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: {
        unidades: [
          { adultos: 3, menores: [] }, // 3 pax, dentro de [2,3]: pasa
          { adultos: 1, menores: [] }, // 1 pax, bajo el mínimo de 2: falla
        ],
      },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
    if (!r.ok) assert.equal(r.contexto?.indice, 1);
  });

  test("CONTROL NEGATIVO — multiplicar la tarifa de habitación por los pasajeros sobrecobraría", () => {
    const tarifa = tarifaHabitacion(2, 500_000); // DBL, capacidad exacta 2
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 });
    esperarValido(r);
    // El error clásico sería: valorUnidad(500.000) × pax(2) = 1.000.000 —
    // el doble del rack real. El motor nunca hace esa multiplicación.
    assert.notEqual(r.totalNetoPorNoche, tarifa.valores.adulto * 2);
    assert.equal(r.totalNetoPorNoche, 500_000);
  });

  test("CONTROL NEGATIVO — 3 pasajeros en una DBL sin suplemento configurado falla cerrado (no se factura por prorrateo)", () => {
    const tarifaEstrecta = tarifaHabitacion(2, 500_000); // maxPax=2, sin suplementos
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaEstrecta, distribucion: { unidades: [{ adultos: 3, menores: [] }] }, noches: 1 });
    esperarCodigo(r, "ocupacion_no_permitida");
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
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaAmpliada, distribucion: { unidades: [{ adultos: 3, menores: [] }] }, noches: 1 });
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
      distribucion: { unidades: [{ adultos: 3, menores: [] }] },
      noches: 1,
    });
    esperarCodigo(r, "tarifa_no_encontrada");
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
      distribucion: { unidades: [{ adultos: 4, menores: [{ edadAnios: 8 }, { edadAnios: 10 }] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 800_000);
    assert.equal(r.suplementosAplicados.length, 0);
  });

  test("apartamento sobre capacidad: 8 pax sobre un máximo de 6 → ocupacion_no_permitida", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaApto,
      distribucion: { unidades: [{ adultos: 5, menores: [{ edadAnios: 8 }, { edadAnios: 10 }, { edadAnios: 6 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Validación fail-closed / configuración inválida — corre ANTES de
// calcular, y su código (`configuracion_invalida`) nunca se confunde con
// "no hay precio configurado" (`tarifa_no_encontrada`).
// ─────────────────────────────────────────────────────────────────────────
describe("validación fail-closed", () => {
  function tarifaValida(): TarifaAlojamiento {
    return {
      id: "t-valida",
      unidadCobro: "habitacion",
      valores: { adulto: 500_000 },
      capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 50_000 }],
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
    };
  }
  function entradaValida(): EntradaCotizacion {
    return { tarifa: tarifaValida(), distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 };
  }

  test("dos habitaciones agregadas que parecen válidas, pero la segunda está sobreocupada", () => {
    const entrada = entradaValida();
    entrada.tarifa.capacidad = { minPax: 1, maxPax: 2, paxIncluidos: 2 };
    entrada.distribucion = {
      unidades: [
        { adultos: 2, menores: [] }, // válida por sí sola
        { adultos: 5, menores: [] }, // sobreocupada
      ],
    };
    const r = cotizarUnidadAlojamiento(entrada);
    esperarCodigo(r, "ocupacion_no_permitida");
    if (!r.ok) assert.equal(r.contexto?.indice, 1, "debe señalar la SEGUNDA unidad, no ocultarla detrás de la primera");
  });

  test("1.5 noches → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.noches = 1.5;
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("2.5 adultos en una unidad → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.distribucion = { unidades: [{ adultos: 2.5, menores: [] }] };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("edad de un menor: NaN, Infinity o decimal → configuracion_invalida", () => {
    for (const edadInvalida of [NaN, Infinity, 4.5]) {
      const entrada = entradaValida();
      entrada.distribucion = { unidades: [{ adultos: 1, menores: [{ edadAnios: edadInvalida }] }] };
      esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
    }
  });

  test("tarifa: negativa, NaN o Infinity → configuracion_invalida", () => {
    for (const valorInvalido of [-100_000, NaN, Infinity]) {
      const entrada = entradaValida();
      entrada.tarifa = { ...entrada.tarifa, valores: { adulto: valorInvalido } };
      esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
    }
  });

  test("capacidad maxPax < minPax → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.capacidad = { minPax: 3, maxPax: 2, paxIncluidos: 0 };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("paxIncluidos fuera de la capacidad → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.capacidad = { minPax: 1, maxPax: 2, paxIncluidos: 5 };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("regla de edad con mínimo > máximo → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.reglaMenores = { reglas: [{ categoria: "nino", edadMinAnios: 10, edadMaxAnios: 5 }] };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("suplementos duplicados: dos 'adulto_adicional' → configuracion_invalida, nunca se elige el primero arbitrariamente", () => {
    const entrada = entradaValida();
    entrada.tarifa.suplementos = [
      { tipo: "adulto_adicional", valor: 50_000 },
      { tipo: "adulto_adicional", valor: 999_999 },
    ];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("suplementos duplicados: dos 'menor_adicional' para la misma categoría → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.suplementos = [
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 40_000 },
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 999_999 },
    ];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("distribución vacía (sin unidades) → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.distribucion = { unidades: [] };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
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
      distribucion: { unidades: [{ adultos: 1, menores: [] }] },
      noches: 0,
    });
    esperarCodigo(r, "producto_no_soportado");
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
// § Funciones puras aisladas
// ─────────────────────────────────────────────────────────────────────────
test("determinarCantidadUnidades: persona suma adultos de todas las unidades; habitación/apartamento/pareja cuentan unidades", () => {
  const base: TarifaAlojamiento = {
    id: "t",
    unidadCobro: "persona",
    valores: { adulto: 1 },
    capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
    suplementos: [],
    reglaMenores: { reglas: [] },
  };
  assert.equal(
    determinarCantidadUnidades(base, {
      unidades: [
        { adultos: 2, menores: [] },
        { adultos: 1, menores: [] },
      ],
    }),
    3
  );
  assert.equal(
    determinarCantidadUnidades(
      { ...base, unidadCobro: "habitacion" },
      { unidades: [{ adultos: 2, menores: [] }, { adultos: 2, menores: [] }] }
    ),
    2
  );
});

test("derivarOcupacionTotal: agregado de solo-lectura, nunca un segundo estado editable", () => {
  const distribucion: DistribucionUnidades = {
    unidades: [
      { adultos: 2, menores: [{ edadAnios: 5 }] },
      { adultos: 1, menores: [] },
    ],
  };
  const total = derivarOcupacionTotal(distribucion);
  assert.equal(total.adultos, 3);
  assert.equal(total.menores.length, 1);
  // Mutar el resultado derivado no debe afectar la distribución original.
  total.menores.push({ edadAnios: 99 });
  assert.equal(distribucion.unidades[0].menores.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────
// § Snapshot — copia profunda real, sin recálculo futuro, sin comisión
// inventada (ajusteComercial siempre null en este PR)
// ─────────────────────────────────────────────────────────────────────────
describe("snapshot", () => {
  function tarifaBase(): TarifaAlojamiento {
    return {
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
  }
  function distribucionBase(): DistribucionUnidades {
    return { unidades: [{ adultos: 2, menores: [] }] };
  }

  test("ajusteComercial siempre null: este PR no calcula un total de venta con una regla comercial inventada", () => {
    const tarifa = tarifaBase();
    const distribucion = distribucionBase();
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion, noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, distribucion);
    assert.equal(snap.ajusteComercial, null);
    assert.equal(snap.totalNeto, 1_000_000);
    assert.equal("totalVenta" in snap, false, "este PR no debe inventar un total de venta");
    assert.equal("comision" in snap, false, "este PR no debe inventar una comisión");
    // La función tampoco acepta un tercer parámetro de opciones/porcentaje.
    assert.equal(construirSnapshotAlojamiento.length, 3);
  });

  test("serializable: sobrevive un round-trip JSON.stringify/parse sin perder datos", () => {
    const tarifa = tarifaBase();
    const distribucion = distribucionBase();
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion, noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, distribucion);
    const roundtrip = JSON.parse(JSON.stringify(snap));
    assert.deepEqual(roundtrip, snap);
  });

  test("mutación profunda posterior al snapshot: tarifa, distribución, resultado y todos sus objetos anidados pueden mutar sin afectar el snapshot", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t-amanzi-3",
      unidadCobro: "habitacion",
      categoria: "estandar",
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 80_000 }],
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 10 }] },
      fuente: { documento: "revista-hoteles-2026-FINAL-comerciales", pagina: 28 },
      versionTarifario: "bernalo-2026",
    };
    const distribucion: DistribucionUnidades = { unidades: [{ adultos: 3, menores: [] }] };

    const r = cotizarUnidadAlojamiento({ tarifa, distribucion, noches: 1 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, distribucion);
    const copiaAntesDeMutar = JSON.parse(JSON.stringify(snap));

    // Mutar TODO lo que el snapshot pudo haber referenciado en vivo: la
    // tarifa fuente (valores, capacidad, reglas, suplementos, fuente
    // documental), la distribución original, y el resultado devuelto por
    // `cotizarUnidadAlojamiento` (desglose, suplementos aplicados,
    // clasificación de menores, capacidad utilizada).
    tarifa.valores.adulto = 999_999_999;
    tarifa.capacidad.maxPax = 999;
    tarifa.reglaMenores.reglas.push({ categoria: "infante", edadMinAnios: 0, edadMaxAnios: 1 });
    tarifa.suplementos.push({ tipo: "persona_sola", valor: 1 });
    (tarifa.suplementos[0] as { valor: number }).valor = 1;
    tarifa.fuente!.pagina = 999;
    distribucion.unidades[0].adultos = 999;
    distribucion.unidades[0].menores.push({ edadAnios: 5 });
    r.desglose[0].valorTotal = -1;
    r.suplementosAplicados[0].valorTotal = -1;
    r.menoresClasificados.push({ edadAnios: 1, categoria: "infante" });
    r.capacidadUtilizada[0].adultos = -1;

    assert.deepEqual(
      JSON.parse(JSON.stringify(snap)),
      copiaAntesDeMutar,
      "el snapshot debe quedar exactamente igual byte por byte tras mutar todos los originales"
    );
    assert.equal(snap.valores.adulto, 500_000);
    assert.equal(snap.reglaMenoresAplicada.reglas.length, 1);
    assert.equal(snap.suplementosAplicados[0].valorTotal, 80_000);
    assert.equal(snap.distribucion.unidades[0].adultos, 3);
    assert.equal(snap.distribucion.unidades[0].menores.length, 0);
    assert.equal(snap.fuente?.pagina, 28);
    assert.equal(snap.desglose[0].valorTotal, 500_000);
    assert.equal(snap.menoresClasificados.length, 0);
    assert.equal(snap.capacidadUtilizada[0].adultos, 3);
  });

  test("contiene distribución completa, desglose completo, capacidad utilizada y versión del tarifario", () => {
    const tarifa = tarifaBase();
    const distribucion = distribucionBase();
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion, noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r, tarifa, distribucion);
    assert.equal(snap.distribucion.unidades.length, 1);
    assert.equal(snap.desglose.length, r.desglose.length);
    assert.equal(snap.capacidadUtilizada.length, 1);
    assert.equal(snap.totalNetoPorNoche, r.totalNetoPorNoche);
    assert.equal(snap.totalNeto, r.totalNeto);
    assert.equal(snap.versionTarifario, "bernalo-2026");
    assert.equal(snap.fuente?.pagina, 28);
  });
});
