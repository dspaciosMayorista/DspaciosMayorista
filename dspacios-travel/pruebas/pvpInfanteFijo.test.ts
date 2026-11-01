import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aplicaPvpInfanteFijo, precioInfanteConServiciosOpcionales, pvpInfanteFijoValido, type ServicioOpcionalSeleccionado } from "../lib/paquetes/pvpInfanteFijo.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaServicioIncluidoRaw } from "../lib/reservar/liquidacionHotel.ts";
import { contarMenoresDeDos, tarifarMenores } from "../lib/reservar/menoresDeDos.ts";
import { tarifaPorMenor } from "../lib/reservar/tarifaPorMenor.ts";

const SIN = { vuelo: 0, servicios: 0, grupoIncluido: false };

describe("aplicaPvpInfanteFijo (regla pura)", () => {
  test("sin configurar (null) nunca aplica; $0 sí es un valor configurado", () => {
    assert.equal(aplicaPvpInfanteFijo(null, { ...SIN, menorDeDos: true }), false);
    assert.equal(aplicaPvpInfanteFijo(undefined, { ...SIN, menorDeDos: true }), false);
    assert.equal(aplicaPvpInfanteFijo(0, { ...SIN, menorDeDos: true }), true);
    assert.equal(pvpInfanteFijoValido(0), 0);
    assert.equal(pvpInfanteFijoValido(""), null);
    assert.equal(pvpInfanteFijoValido(-1), null);
  });
  test("vuelo gratuito ($0) no desactiva; fee o vuelo positivo sí", () => {
    assert.equal(aplicaPvpInfanteFijo(49000, { ...SIN, vuelo: 0, menorDeDos: false }), true);
    assert.equal(aplicaPvpInfanteFijo(49000, { ...SIN, vuelo: 1, menorDeDos: true }), false);
    assert.equal(aplicaPvpInfanteFijo(49000, { ...SIN, vuelo: 300000, menorDeDos: false }), false);
  });
  test("servicio positivo desactiva; servicio gratuito no", () => {
    assert.equal(aplicaPvpInfanteFijo(49000, { ...SIN, servicios: 0, menorDeDos: true }), true);
    assert.equal(aplicaPvpInfanteFijo(49000, { ...SIN, servicios: 5000, menorDeDos: true }), false);
  });
  test("servicio de grupo: indeterminado para 2+ (fórmula normal); el menor de 2 no cuenta para el rango", () => {
    assert.equal(aplicaPvpInfanteFijo(49000, { ...SIN, grupoIncluido: true, menorDeDos: false }), false);
    assert.equal(aplicaPvpInfanteFijo(49000, { ...SIN, grupoIncluido: true, menorDeDos: true }), true);
  });
});

// SIN «GENERAL»: el precio de cada incluido sale de una vigencia que cubre el rango (mismo neto que antes tenía como precio base; rangos de grupo en la vigencia).
const srv = (o: Partial<FilaServicioIncluidoRaw>): FilaServicioIncluidoRaw => {
  const s: FilaServicioIncluidoRaw = { incluido: true, precio_persona: 0, liquidacion: "paquete", servicio_id: 1, modo: "persona", nombre: "S", categoria: "otro", proveedor_id: null, rangos_grupo: [], ...o };
  return {
    ...s,
    vigencias: {
      servicioId: s.servicio_id, nombre: s.nombre ?? "S", conFranjas: new Set<string>(),
      temporadas: [{ nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", precio_persona: s.precio_persona, precio_infante: s.precio_infante ?? null }],
      grupos: (s.rangos_grupo ?? []).map((g) => ({ ...g, temporada: "VIG" })),
    },
  };
};
function datos(fijo: number | null, servicios: FilaServicioIncluidoRaw[]): DatosHotelPaquete {
  return {
    paquete: { pct_mk: 0.2, pvp_infante_fijo: fijo, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel", hotel_moneda: "COP" },
    temporadas: [{ nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-15", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null }],
    tarifas: [{ tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA", neto_sencilla: 150000, neto_doble: 100000, neto_triple: null, neto_multiple: null, neto_nino: 50000, neto_nino2: 30000, neto_infante: 40000 }],
    serviciosIncluidos: servicios,
    blackouts: [],
  };
}
const combo = (fijo: number | null, s: FilaServicioIncluidoRaw[]) => evaluarHotelPorFechas(datos(fijo, s), "2026-09-05", 3)!.combos[0];

describe("evaluarHotelPorFechas con PVP fijo del infante", () => {
  test("campo vacío: fórmula actual", () => {
    const c = combo(null, []);
    assert.equal(c.precios.infante, 150000);
    assert.equal(c.preciosMenor2!.infante, 150000);
  });
  test("$49.000 sin servicios: ambas rutas = 49.000; el neto (costo) del infante y los demás precios no cambian", () => {
    const base = combo(null, []);
    const c = combo(49000, []);
    assert.equal(c.precios.infante, 49000);
    assert.equal(c.preciosMenor2!.infante, 49000);
    assert.equal(c.netos!.infante, base.netos!.infante);
    assert.equal(c.precios.doble, base.precios.doble);
    assert.equal(c.precios.nino, base.precios.nino);
  });
  test("$0 es válido: el infante queda en $0 y el costo neto real del hotel NO se borra", () => {
    const c = combo(0, []);
    assert.equal(c.precios.infante, 0);
    assert.equal(c.preciosMenor2!.infante, 0);
    assert.equal(c.netos!.infante, combo(null, []).netos!.infante, "neto de infante positivo intacto con fijo $0");
    assert.ok(c.netos!.infante > 0);
  });
  test("asistencia con costo positivo NO desactiva el fijo", () => {
    const c = combo(49000, [srv({ categoria: "asistencia", precio_persona: 20000 })]);
    assert.equal(c.precios.infante, 49000);
    assert.equal(c.preciosMenor2!.infante, 49000);
  });
  test("servicio no-asistencia positivo: fórmula normal en ambas rutas", () => {
    const s = [srv({ precio_persona: 20000 })];
    const base = combo(null, s);
    const c = combo(49000, s);
    assert.equal(c.precios.infante, base.precios.infante);
    assert.equal(c.preciosMenor2!.infante, base.preciosMenor2!.infante);
    assert.notEqual(c.precios.infante, 49000);
  });
  test("servicio con precio de infante gratuito: menor de 2 usa el fijo; el de 2+ (paga precio de adulto) conserva la fórmula", () => {
    const s = [srv({ precio_persona: 20000, precio_infante: 0 })];
    const c = combo(49000, s);
    assert.equal(c.preciosMenor2!.infante, 49000);
    assert.equal(c.precios.infante, combo(null, s).precios.infante);
  });
  test("servicio de grupo: 2+ fórmula normal; menor de 2 fijo", () => {
    const s = [srv({ modo: "grupo", precio_persona: null, rangos_grupo: [{ pax_desde: 1, pax_hasta: 9, precio: 100000 }] })];
    const c = combo(49000, s);
    assert.equal(c.preciosMenor2!.infante, 49000);
    assert.equal(c.precios.infante, combo(null, s).precios.infante);
  });
});

describe("liquidación de menores con las dos rutas y tarifa por menor", () => {
  const edades = [1, 3];
  const c = combo(49000, []);
  const tot = { infante: 2, nino: 0, nino2: 0 };
  test("hotel con infantes hasta 5 años: el de 1 paga el fijo (menor de 2) y el de 3 la ruta precio_pvp", () => {
    const t = tarifarMenores({ totales: tot, menoresDeDos: contarMenoresDeDos(edades, 5, tot), pvp: c.precios, pvpMenor2: c.preciosMenor2! });
    assert.ok(t.ok);
    const lineas = t.ok ? t.lineas : [];
    assert.deepEqual(tarifaPorMenor(edades, 5, lineas), [{ tarifa: 49000, menorDeDos: true }, { tarifa: 49000, menorDeDos: false }]);
    assert.equal(t.ok && t.total, 98000);
    assert.equal(t.ok && t.paxConSilla, 1, "el de 3 años ocupa silla; el menor de 2 no");
  });
  test("con servicio positivo (fórmula normal) el total de la liquidación coincide con la suma mostrada por menor", () => {
    const cn = combo(49000, [srv({ precio_persona: 20000 })]);
    const t = tarifarMenores({ totales: tot, menoresDeDos: contarMenoresDeDos(edades, 5, tot), pvp: cn.precios, pvpMenor2: cn.preciosMenor2! });
    assert.ok(t.ok);
    const suma = tarifaPorMenor(edades, 5, t.ok ? t.lineas : []).reduce((s, x) => s + (x?.tarifa ?? 0), 0);
    assert.equal(suma, t.ok ? t.total : -1);
  });
  test("otro hotel (infante hasta 2): el de 3 años es niño y conserva su tarifa normal; el de 1 sigue con el fijo", () => {
    const tot2 = { infante: 1, nino: 1, nino2: 0 };
    const t = tarifarMenores({ totales: tot2, menoresDeDos: contarMenoresDeDos(edades, 2, tot2), pvp: c.precios, pvpMenor2: c.preciosMenor2! });
    assert.deepEqual(tarifaPorMenor(edades, 2, t.ok ? t.lineas : []), [{ tarifa: 49000, menorDeDos: true }, { tarifa: c.precios.nino, menorDeDos: false }]);
  });
  test("tres menores con tarifas distintas (infante, Niño 1, Niño 2) y el límite de 2 años", () => {
    const tot3 = { infante: 1, nino: 1, nino2: 1 };
    const e = [1, 2, 7];
    const t = tarifarMenores({ totales: tot3, menoresDeDos: contarMenoresDeDos(e, 1, tot3), pvp: { infante: 100, nino: 200, nino2: 300 }, pvpMenor2: { infante: 49, nino: 59, nino2: 69 } });
    assert.ok(t.ok);
    const pm = tarifaPorMenor(e, 1, t.ok ? t.lineas : []);
    assert.deepEqual(pm, [{ tarifa: 49, menorDeDos: true }, { tarifa: 200, menorDeDos: false }, { tarifa: 300, menorDeDos: false }]);
    assert.equal(pm.reduce((s, x) => s + (x?.tarifa ?? 0), 0), t.ok ? t.total : -1);
  });
  test("edad sin dato → sin precio inventado", () => {
    assert.deepEqual(tarifaPorMenor([null], 2, []), [null]);
  });
  test("costos: ninguna rama de costo/CxP lee la tarifa de la línea de menores (solo el precio de venta)", () => {
    const raiz = join(import.meta.dirname, "..");
    for (const f of ["lib/reservar/costosObligacionesCarrito.ts", "lib/reservar/aporteFuentes90.ts"]) {
      assert.doesNotMatch(readFileSync(join(raiz, f), "utf8"), /lineasMenores|pvp_infante_fijo|precio_pvp_menor2/, f);
    }
  });
});

describe("servicios opcionales seleccionados × PVP fijo (menor de 1 año y niño de 3 años, hotel con infantes hasta 5)", () => {
  const c = combo(49000, []);
  const normal = combo(null, []);
  const opc = (o: Partial<ServicioOpcionalSeleccionado>): ServicioOpcionalSeleccionado => ({ categoria: "otro", modo: "persona", personaPvp: 0, infantePvp: null, ...o });
  // Misma resolución que aplica computarReserva por cada línea de infante y que usa la estimación del cliente.
  const resolver = (servicios: ServicioOpcionalSeleccionado[]) => {
    const tot = { infante: 2, nino: 0, nino2: 0 };
    const pvp = { ...c.precios, infante: precioInfanteConServiciosOpcionales(c.precios.infante, c.preciosSinFijo!.infante, servicios, false) };
    const pvpMenor2 = { ...c.preciosMenor2!, infante: precioInfanteConServiciosOpcionales(c.preciosMenor2!.infante, c.preciosMenor2SinFijo!.infante, servicios, true) };
    const t = tarifarMenores({ totales: tot, menoresDeDos: contarMenoresDeDos([1, 3], 5, tot), pvp, pvpMenor2 });
    assert.ok(t.ok);
    return tarifaPorMenor([1, 3], 5, t.ok ? t.lineas : []).map((x) => x!.tarifa);
  };
  test("el tarifario guarda el precio normal junto al fijo (mismo que sin fijo)", () => {
    assert.equal(c.preciosSinFijo!.infante, normal.precios.infante);
    assert.equal(c.preciosMenor2SinFijo!.infante, normal.preciosMenor2!.infante);
    assert.equal(combo(null, []).preciosSinFijo!.infante, undefined);
  });
  test("sin servicios opcionales: ambos con el fijo", () => assert.deepEqual(resolver([]), [49000, 49000]));
  test("servicio opcional gratuito ($0 para todos): conserva el fijo", () => assert.deepEqual(resolver([opc({ personaPvp: 0, infantePvp: 0 })]), [49000, 49000]));
  test("servicio opcional positivo para todos: ambos vuelven a la fórmula normal completa (nunca fijo + normal)", () => {
    const r = resolver([opc({ personaPvp: 20000 })]);
    assert.deepEqual(r, [normal.preciosMenor2!.infante, normal.precios.infante]);
    assert.ok(r.every((x) => x !== 49000));
  });
  test("servicio positivo para el adulto pero gratuito para el infante: el de 1 año conserva el fijo; el de 3 años (paga como adulto) vuelve a la normal", () => {
    assert.deepEqual(resolver([opc({ personaPvp: 20000, infantePvp: 0 })]), [49000, normal.precios.infante]);
  });
  test("asistencia opcional con costo no desactiva el fijo", () => assert.deepEqual(resolver([opc({ categoria: "asistencia", personaPvp: 30000 })]), [49000, 49000]));
  test("servicio opcional por grupo: el de 3 años vuelve a la normal (cuenta para el rango); el de 1 año no", () => {
    assert.deepEqual(resolver([opc({ modo: "grupo", personaPvp: null })]), [49000, normal.precios.infante]);
  });
  test("un solo servicio positivo basta aunque otros sean gratuitos o asistencia", () => {
    assert.deepEqual(resolver([opc({ personaPvp: 0 }), opc({ categoria: "asistencia", personaPvp: 9 }), opc({ personaPvp: 1000 })]), [normal.preciosMenor2!.infante, normal.precios.infante]);
  });
});
