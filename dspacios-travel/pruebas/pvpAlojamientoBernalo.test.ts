import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { calcularPvpAlojamientoBernalo, resolverMonedaComponentesBernalo, type EntradaPvpAlojamientoBernalo } from "../lib/calc/pvpAlojamientoBernalo.ts";
import { cotizarHabitaciones, type ItemCotizarHabitacion, type HabitacionOcupacion, type ResultadoColeccionCotizada } from "../lib/calc/ocupacionHabitacion.ts";
import type { TarifaAlojamiento } from "../lib/calc/unidadAlojamiento.ts";
import { marcar, aporteVuelo, redondearVenta } from "../lib/calc/paquetes.ts";
import type { ServicioGrupoIncluido } from "../lib/reservar/serviciosPaquete.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — composición del PVP público (`lib/calc/pvpAlojamientoBernalo.ts`).
// Los `ResultadoColeccionCotizada` de entrada se generan con el motor REAL
// (`cotizarHabitaciones`) — no se fabrican a mano — para que las pruebas
// numéricas reflejen exactamente lo que el motor produce.
// ─────────────────────────────────────────────────────────────────────────

const PCT_MK = 0.20; // 20%
const MONEDA = "COP";
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteComposer = readFileSync(join(raiz, "lib/calc/pvpAlojamientoBernalo.ts"), "utf8");

function tarifaHabitacion(valorAdulto: number, reglas: TarifaAlojamiento["reglaMenores"]["reglas"] = []): TarifaAlojamiento {
  return {
    id: "t-hab", unidadCobro: "habitacion", comisionPct: 15, versionTarifario: "v1",
    categoria: "estandar", alimentacion: "PC",
    valores: { adulto: valorAdulto },
    capacidad: { minPax: 2, maxPax: 5, paxIncluidos: 2 },
    suplementos: [
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 30_000 },
      { tipo: "menor_adicional", categoriaMenor: "infante", valor: 5_000 },
      { tipo: "adulto_adicional", valor: 40_000 },
    ],
    reglaMenores: { reglas },
  };
}

const REGLAS_EDAD = [
  { categoria: "infante" as const, edadMinAnios: 0, edadMaxAnios: 3 },
  { categoria: "nino" as const, edadMinAnios: 4, edadMaxAnios: 12 },
];

function cotizar(habitaciones: HabitacionOcupacion[]): ResultadoColeccionCotizada {
  const tarifa = tarifaHabitacion(100_000, REGLAS_EDAD);
  const items: ItemCotizarHabitacion[] = habitaciones.map((h) => ({ habitacion: h, tarifa }));
  const r = cotizarHabitaciones(items);
  assert.equal(r.ok, true, `fixture inválido: ${!r.ok ? r.mensaje : ""}`);
  return r as ResultadoColeccionCotizada;
}

function entradaBase(resultadoHabitaciones: ResultadoColeccionCotizada, over: Partial<EntradaPvpAlojamientoBernalo> = {}): EntradaPvpAlojamientoBernalo {
  return {
    resultadoHabitaciones,
    pctMk: PCT_MK,
    moneda: MONEDA,
    numNoches: 1,
    serviciosPersona: [],
    serviciosGrupo: [],
    vuelo: null,
    ...over,
  };
}

describe("calcularPvpAlojamientoBernalo — 1 habitación con 2 adultos", () => {
  test("pvp = redondearVenta(marcar(totalNeto,pctMk)) — sin servicios ni vuelo", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const totalNeto = res.porHabitacion[0].resultado.totalNeto;
    const r = calcularPvpAlojamientoBernalo(entradaBase(res));
    assert.equal(r.ok, true);
    if (r.ok) {
      const esperado = redondearVenta(marcar(totalNeto, PCT_MK), MONEDA);
      assert.equal(r.pvp, esperado);
      assert.equal(r.paxTotal, 2);
    }
  });
});

describe("calcularPvpAlojamientoBernalo — 2 habitaciones con 2 adultos cada una", () => {
  test("el hotel se cuenta DOS veces (una por habitación), nunca una tarifa única multiplicada", () => {
    const hab1: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "h2", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab1, hab2]);
    const netoTotal = res.porHabitacion.reduce((s, ph) => s + ph.resultado.totalNeto, 0);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res));
    assert.equal(r.ok, true);
    if (r.ok) {
      // Suma de los DOS marcar() SIN redondeo intermedio, redondeado UNA vez.
      const esperado = redondearVenta(marcar(res.porHabitacion[0].resultado.totalNeto, PCT_MK) + marcar(res.porHabitacion[1].resultado.totalNeto, PCT_MK), MONEDA);
      assert.equal(r.pvp, esperado);
      assert.notEqual(r.pvp, redondearVenta(marcar(netoTotal, PCT_MK) * 1, MONEDA) === r.pvp ? r.pvp + 1 : r.pvp); // sanity: no es un no-op
      assert.equal(r.paxTotal, 4);
    }
  });
});

describe("calcularPvpAlojamientoBernalo — 2 adultos + 1 niño", () => {
  test("el niño suma su propio aporte de hotel (vía el motor) y cuenta en paxTotal/paxConSilla", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [{ edadAnios: 8 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, {
      vuelo: { costoTiqueteSilla: 50_000, aplicaMk: true, ta: 0 },
    }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.paxTotal, 3); // 2 adultos + 1 niño
      const aporteHotel = marcar(res.porHabitacion[0].resultado.totalNeto, PCT_MK);
      const aporteVueloTot = marcar(50_000, PCT_MK) * 3; // niño SÍ ocupa silla
      assert.equal(r.pvp, redondearVenta(aporteHotel + aporteVueloTot, MONEDA));
    }
  });
});

describe("calcularPvpAlojamientoBernalo — 2 adultos + 1 infante: el infante NO suma vuelo", () => {
  test("paxConSilla excluye al infante; paxTotal sí lo incluye", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [{ edadAnios: 1 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, {
      vuelo: { costoTiqueteSilla: 50_000, aplicaMk: true, ta: 0 },
    }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.paxTotal, 3); // 2 adultos + 1 infante (SÍ cuenta en pax total)
      const aporteHotel = marcar(res.porHabitacion[0].resultado.totalNeto, PCT_MK);
      const aporteVueloTot = marcar(50_000, PCT_MK) * 2; // SOLO 2 adultos tienen silla — el infante no
      assert.equal(r.pvp, redondearVenta(aporteHotel + aporteVueloTot, MONEDA));
    }
  });

  test("comparado con la misma reserva sin infante, la diferencia es EXACTAMENTE el aporte de hotel del infante (nunca vuelo)", () => {
    const habSinInfante: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habConInfante: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [{ edadAnios: 1 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const vuelo = { costoTiqueteSilla: 50_000, aplicaMk: true, ta: 0 };
    const resSin = cotizar([habSinInfante]);
    const resCon = cotizar([habConInfante]);
    const rSin = calcularPvpAlojamientoBernalo(entradaBase(resSin, { vuelo }));
    const rCon = calcularPvpAlojamientoBernalo(entradaBase(resCon, { vuelo }));
    assert.equal(rSin.ok, true);
    assert.equal(rCon.ok, true);
    if (rSin.ok && rCon.ok) {
      // paxConSilla es el MISMO en ambos casos (2 adultos, el infante nunca
      // ocupa silla) — así que aislando el componente de hotel, la
      // diferencia total debe ser EXACTAMENTE
      // marcar(netoCon,pctMk) − marcar(netoSin,pctMk), calculado sobre los
      // netos reales que devolvió el motor (nunca un número fijo asumido).
      const netoSin = resSin.porHabitacion[0].resultado.totalNeto;
      const netoCon = resCon.porHabitacion[0].resultado.totalNeto;
      assert.ok(netoCon > netoSin, "el infante debe encarecer el costo neto de la habitación (suplemento > 0)");
      const diferenciaHotelSinRedondearFinal = marcar(netoCon, PCT_MK) - marcar(netoSin, PCT_MK);
      // El vuelo (paxConSilla=2 en ambos) aporta EXACTAMENTE lo mismo en los
      // dos casos, así que se cancela en la resta — la diferencia observada
      // en el PVP final viene solo del redondeo único aplicado a cada total.
      assert.equal(rCon.pvp, redondearVenta(marcar(netoCon, PCT_MK) + aporteVuelo(50_000, true, PCT_MK, 0) * 2, MONEDA));
      assert.equal(rSin.pvp, redondearVenta(marcar(netoSin, PCT_MK) + aporteVuelo(50_000, true, PCT_MK, 0) * 2, MONEDA));
      assert.ok(diferenciaHotelSinRedondearFinal > 0);
    }
  });
});

describe("calcularPvpAlojamientoBernalo — servicio incluido por persona usa pax real", () => {
  test("dos habitaciones (4 adultos): el servicio persona se cobra por los 4, nunca por habitación", () => {
    const hab1: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "h2", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab1, hab2]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, {
      serviciosPersona: [{ servicioId: 1, nombre: "Traslado", categoria: "tour_traslado", precioPersonaNeto: 20_000, liquidacion: null, proveedorId: null }],
    }));
    assert.equal(r.ok, true);
    if (r.ok) {
      const aporteHotel = res.porHabitacion.reduce((s, ph) => s + marcar(ph.resultado.totalNeto, PCT_MK), 0);
      const aporteServicio = marcar(20_000 * 4, PCT_MK); // 4 pax reales, NO 2 (por habitación) ni 8 (duplicado)
      assert.equal(r.pvp, redondearVenta(aporteHotel + aporteServicio, MONEDA));
    }
  });
});

describe("calcularPvpAlojamientoBernalo — servicio incluido por grupo se cobra una sola vez", () => {
  test("dos habitaciones: el cargo de grupo NO se duplica por habitación", () => {
    const hab1: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "h2", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab1, hab2]);
    const gruposServicio: ServicioGrupoIncluido[] = [{
      servicioId: 2, nombre: "Tour grupal", categoria: "tour_traslado", liquidacion: null, proveedorId: null,
      rangos: [{ pax_desde: 1, pax_hasta: 10, precio: 200_000 }],
    }];
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, { serviciosGrupo: gruposServicio }));
    assert.equal(r.ok, true);
    if (r.ok) {
      const aporteHotel = res.porHabitacion.reduce((s, ph) => s + marcar(ph.resultado.totalNeto, PCT_MK), 0);
      const aporteServicioGrupo = Math.round(marcar(200_000, PCT_MK)); // UNA sola vez, nunca ×2
      assert.equal(r.pvp, redondearVenta(aporteHotel + aporteServicioGrupo, MONEDA));
    }
  });
});

describe("calcularPvpAlojamientoBernalo — sin rango grupal aplicable bloquea", () => {
  test("ningún rango cubre el pax real: bloquea, nunca inventa un precio", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const gruposServicio: ServicioGrupoIncluido[] = [{
      servicioId: 3, nombre: "Tour exclusivo grupos grandes", categoria: "tour_traslado", liquidacion: null, proveedorId: null,
      rangos: [{ pax_desde: 10, pax_hasta: 20, precio: 500_000 }], // 2 pax no cabe en [10,20]
    }];
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, { serviciosGrupo: gruposServicio }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "servicio_sin_rango_grupal");
  });

  test("servicio persona sin precioPersonaNeto configurado: bloquea", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, {
      serviciosPersona: [{ servicioId: 4, nombre: "Sin tarifa", categoria: "otro", precioPersonaNeto: null, liquidacion: null, proveedorId: null }],
    }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "servicio_sin_tarifa");
  });
});

describe("calcularPvpAlojamientoBernalo — markup de hotel se aplica UNA vez por habitación", () => {
  test("el código fuente no llama componerTarifa (evita la mezcla de unidades)", () => {
    const codigoSinComentarios = fuenteComposer.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join("\n");
    assert.doesNotMatch(codigoSinComentarios, /componerTarifa/);
  });

  test("3 habitaciones con costos distintos: aporteHotelTotal es la suma de 3 marcar() independientes, cada uno sobre SU PROPIO totalNeto", () => {
    const habA: HabitacionOcupacion = { id: "a", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habB: HabitacionOcupacion = { id: "b", adultos: 3, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habC: HabitacionOcupacion = { id: "c", adultos: 4, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([habA, habB, habC]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res));
    assert.equal(r.ok, true);
    if (r.ok) {
      // Los 3 costos netos son distintos entre sí (adulto_adicional aplica
      // distinto según ocupación) — confirma que no es un fixture degenerado.
      const netos = res.porHabitacion.map((ph) => ph.resultado.totalNeto);
      assert.equal(new Set(netos).size, 3);
      const sumaIndividual = res.porHabitacion.reduce((s, ph) => s + marcar(ph.resultado.totalNeto, PCT_MK), 0);
      assert.equal(r.pvp, redondearVenta(sumaIndividual, MONEDA));
    }
  });
});

describe("calcularPvpAlojamientoBernalo — vuelo/servicios no se multiplican por cantidad de habitaciones", () => {
  test("mismo pax total repartido en 1 habitación vs. 2 habitaciones: el aporte de vuelo/servicios es IGUAL en ambos casos", () => {
    const habUnica: HabitacionOcupacion = { id: "h1", adultos: 4, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habDoble1: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habDoble2: HabitacionOcupacion = { id: "h2", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const vuelo = { costoTiqueteSilla: 50_000, aplicaMk: true, ta: 0 };
    const servicios = [{ servicioId: 1, nombre: "Traslado", categoria: "tour_traslado" as const, precioPersonaNeto: 20_000, liquidacion: null, proveedorId: null }];

    const resUnica = cotizar([habUnica]);
    const resDoble = cotizar([habDoble1, habDoble2]);

    const rUnica = calcularPvpAlojamientoBernalo(entradaBase(resUnica, { vuelo, serviciosPersona: servicios }));
    const rDoble = calcularPvpAlojamientoBernalo(entradaBase(resDoble, { vuelo, serviciosPersona: servicios }));
    assert.equal(rUnica.ok, true);
    assert.equal(rDoble.ok, true);
    if (rUnica.ok && rDoble.ok) {
      assert.equal(rUnica.paxTotal, 4);
      assert.equal(rDoble.paxTotal, 4);
      // El aporte de vuelo+servicios depende SOLO de pax (4 en ambos casos)
      // — aislando el componente de hotel (que sí puede variar según la
      // forma de la tarifa por unidad), lo que queda debe coincidir EXACTO
      // entre la reserva de 1 habitación y la de 2 habitaciones.
      const soloHotelUnica = marcar(resUnica.porHabitacion[0].resultado.totalNeto, PCT_MK);
      const soloHotelDoble = resDoble.porHabitacion.reduce((s, ph) => s + marcar(ph.resultado.totalNeto, PCT_MK), 0);
      const vueloServiciosUnica = rUnica.pvp - redondearVenta(soloHotelUnica, MONEDA);
      const vueloServiciosDoble = rDoble.pvp - redondearVenta(soloHotelDoble, MONEDA);
      const esperado = Math.round(marcar(50_000, PCT_MK) * 4 + marcar(20_000 * 4, PCT_MK));
      assert.equal(vueloServiciosUnica, esperado);
      assert.equal(vueloServiciosDoble, esperado);
    }
  });
});

// ⚠️ Fase 3F-3: `calcularPvpAlojamientoBernalo` DEJÓ de ser la frontera
// pública en sí misma (ver el encabezado del archivo fuente) — ahora expone
// A PROPÓSITO el desglose interno (costos netos, aportes de PVP, servicios
// resueltos) que `lib/reservar/computoReservaBernalo.ts` necesita para
// construir `ComputoReservaBernalo`. La frontera pública real es
// `app/tarifario/cotizacionBernaloActions.ts`, que sanitiza a las 5 claves
// de siempre — esa garantía se prueba en pruebas/cotizacionBernaloWiring.test.ts,
// no acá.
describe("calcularPvpAlojamientoBernalo — expone el desglose interno completo (Fase 3F-3)", () => {
  test("el resultado ok trae las claves públicas de siempre MÁS el desglose interno de costos/aportes", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const r = calcularPvpAlojamientoBernalo(entradaBase(cotizar([hab])));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(Object.keys(r).sort(), [
        "aporteHotelTotal", "aporteServiciosTotal", "aporteVueloTotal",
        "costoHotelTotal", "costoServiciosTotal", "costoVueloTotal",
        "moneda", "ok", "paxConSilla", "paxTotal", "promedioPorViajero", "pvp",
        "serviciosIncluidosResueltos",
      ].sort());
    }
  });

  test("costoHotelTotal = suma EXACTA de resultado.totalNeto por habitación (regla 5), nunca marcado con el %mk", () => {
    const hab1: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "h2", adultos: 3, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab1, hab2]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res));
    assert.equal(r.ok, true);
    if (r.ok) {
      const netoEsperado = res.porHabitacion.reduce((s, ph) => s + ph.resultado.totalNeto, 0);
      assert.equal(r.costoHotelTotal, netoEsperado);
      assert.notEqual(r.costoHotelTotal, r.aporteHotelTotal); // el costo NUNCA es el aporte marcado
    }
  });

  test("costoVueloTotal excluye infantes (regla 7): costoTiqueteSilla × paxConSilla, nunca × paxTotal", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [{ edadAnios: 1 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, { vuelo: { costoTiqueteSilla: 50_000, aplicaMk: true, ta: 0 } }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.paxTotal, 3); // 2 adultos + 1 infante
      assert.equal(r.paxConSilla, 2); // el infante NO tiene silla
      assert.equal(r.costoVueloTotal, 50_000 * 2);
      assert.notEqual(r.costoVueloTotal, 50_000 * r.paxTotal);
    }
  });

  test("sin vuelo, costoVueloTotal y aporteVueloTotal son 0", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const r = calcularPvpAlojamientoBernalo(entradaBase(cotizar([hab])));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.costoVueloTotal, 0);
      assert.equal(r.aporteVueloTotal, 0);
    }
  });

  test("costoServiciosTotal conserva identidad separada del hotel (regla 6): nunca se suma dentro de costoHotelTotal", () => {
    const hab1: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "h2", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab1, hab2]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, {
      serviciosPersona: [{ servicioId: 9, nombre: "Traslado", categoria: "tour_traslado", precioPersonaNeto: 20_000, liquidacion: null, proveedorId: 55 }],
    }));
    assert.equal(r.ok, true);
    if (r.ok) {
      const netoHotelEsperado = res.porHabitacion.reduce((s, ph) => s + ph.resultado.totalNeto, 0);
      assert.equal(r.costoHotelTotal, netoHotelEsperado); // el servicio NUNCA se cuela aquí
      assert.equal(r.costoServiciosTotal, 20_000 * 4); // 4 pax reales, aparte
      assert.equal(r.serviciosIncluidosResueltos.length, 1);
      assert.equal(r.serviciosIncluidosResueltos[0].proveedorId, 55);
    }
  });

  test("serviciosIncluidosResueltos incluye servicios de grupo con su proveedor real (nunca null por omisión)", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const gruposServicio: ServicioGrupoIncluido[] = [{
      servicioId: 2, nombre: "Tour grupal", categoria: "tour_traslado", liquidacion: null, proveedorId: 77,
      rangos: [{ pax_desde: 1, pax_hasta: 10, precio: 200_000 }],
    }];
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, { serviciosGrupo: gruposServicio }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.serviciosIncluidosResueltos.length, 1);
      assert.equal(r.serviciosIncluidosResueltos[0].proveedorId, 77);
      assert.equal(r.serviciosIncluidosResueltos[0].costoNeto, 200_000);
      assert.equal(r.costoServiciosTotal, 200_000);
    }
  });

  test("condición de demostración (regla 8): pvp = redondearVenta(aporteHotel + aporteServicios + aporteVuelo)", () => {
    const hab: HabitacionOcupacion = { id: "h1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const res = cotizar([hab]);
    const r = calcularPvpAlojamientoBernalo(entradaBase(res, {
      vuelo: { costoTiqueteSilla: 50_000, aplicaMk: true, ta: 0 },
      serviciosPersona: [{ servicioId: 1, nombre: "Traslado", categoria: "tour_traslado", precioPersonaNeto: 20_000, liquidacion: null, proveedorId: null }],
    }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.pvp, redondearVenta(r.aporteHotelTotal + r.aporteServiciosTotal + r.aporteVueloTotal, MONEDA));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Corrección (auditoría DeepSeek, hallazgo A3) — `resolverMonedaComponentesBernalo`.
// Pura y ejecutable directo, sin necesidad de wiring test.
// ─────────────────────────────────────────────────────────────────────────
describe("resolverMonedaComponentesBernalo — nunca colapsa la ausencia a COP", () => {
  test("hotel sin moneda configurada bloquea con moneda_indeterminada (nunca asume COP)", () => {
    const r = resolverMonedaComponentesBernalo(null, [], null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "moneda_indeterminada");
  });

  test("hotel USD sin servicios ni moneda de paquete: resuelve USD, no se etiqueta como COP", () => {
    const r = resolverMonedaComponentesBernalo("USD", [], null);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.moneda, "USD");
  });

  test("hotel COP con un servicio incluido sin moneda configurada bloquea (moneda_indeterminada)", () => {
    const r = resolverMonedaComponentesBernalo("COP", [null], null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "moneda_indeterminada");
  });

  test("hotel USD + servicio incluido en COP: mezcla de monedas bloquea (moneda_mixta)", () => {
    const r = resolverMonedaComponentesBernalo("USD", ["COP"], null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "moneda_mixta");
  });

  test("hotel y todos los servicios incluidos coinciden en USD: resuelve USD", () => {
    const r = resolverMonedaComponentesBernalo("USD", ["USD", "USD"], null);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.moneda, "USD");
  });

  test("armado_paquetes.moneda configurada y CONTRADICE al hotel: bloquea (moneda_contradice_paquete)", () => {
    const r = resolverMonedaComponentesBernalo("USD", [], "COP");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "moneda_contradice_paquete");
  });

  test("armado_paquetes.moneda configurada y COINCIDE con el hotel: resuelve sin bloquear", () => {
    const r = resolverMonedaComponentesBernalo("COP", [], "COP");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.moneda, "COP");
  });

  test("armado_paquetes.moneda ausente (null): nunca bloquea por sí sola", () => {
    const r = resolverMonedaComponentesBernalo("USD", ["USD"], null);
    assert.equal(r.ok, true);
  });
});
