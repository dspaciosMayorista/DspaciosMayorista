// Liquidación de servicios con ALCANCE (262): búsqueda (se muestra pero no se vende sin alcance o sin tarifa propia) y re-liquidación puntual (checkout/conversión, falla cerrado).
// Lo clasificado como traslado se vende SIEMPRE por alcance; lo demás conserva su comportamiento anterior y rechaza un alcance.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construirContextoServicios, calcularResultadoServicio, resolverLiquidacionServicioPuntual, separarFranjas, SELECT_TEMPORADAS_CON_FRANJAS, SELECT_TEMPORADAS_CON_FRANJAS_SIN_RANGO,
  type FilaTemporadaConFranjas, type FilaTemporadaServicio, type FilaFranjaServicio,
} from "../lib/reservar/liquidacionServicio.ts";
import type { ClasificacionServicio, FilaPrecioAlcance } from "../lib/calc/servicioAlcance.ts";

const par = { servicioId: 10, paqueteId: 1, nombre: "Traslado aeropuerto", destino: "CARTAGENA", descripcion: null };
const fecha = new Date("2030-05-10T00:00:00");
const ALTA: FilaTemporadaServicio = { id: 5, servicio_id: 10, nombre: "ALTA", fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", precio_persona: 999999, recargo_individual: 50000 };
const P = (alcance: FilaPrecioAlcance["alcance"], precio: number, d: number | null = null, h: number | null = null): FilaPrecioAlcance => ({ alcance, pax_desde: d, pax_hasta: h, precio });
const NOCHE: FilaFranjaServicio = { servicio_temporada_id: 5, hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 30000, cobro: "grupo" };
const redondeo = (neto: number) => Math.ceil(neto / 0.8 / 1000) * 1000; // marcar + redondeo al millar de COP (20 % de margen)

function ctx(clasif: ClasificacionServicio | null, precios: FilaPrecioAlcance[] = [], franjas: FilaFranjaServicio[] = []) {
  return construirContextoServicios({
    paquetes: [{ id: 1, pct_mk: 0.2 }], armado: [{ paquete_id: 1, servicio_id: 10, modo: "persona" }],
    servicios: [{ id: 10, precio_persona: 999999, recargo_individual: 50000, liquidacion: "paquete", moneda: "COP", categoria: "tour_traslado" }],
    grupos: [], temporadas: [ALTA], franjas,
    ...(clasif ? { clasificaciones: [{ servicio_id: 10, ...clasif }], preciosAlcance: precios.map((p) => ({ ...p, servicio_temporada_id: 5 })) } : {}),
  });
}
const conPrecios = (precios: FilaPrecioAlcance[]) => precios.map((p) => ({ ...p, servicio_temporada_id: 5 }));
const puntual = (c: ReturnType<typeof ctx>, extra: Record<string, unknown> = {}) => resolverLiquidacionServicioPuntual({
  par, fechaIdaDate: fecha, numNoches: 3, pax: 2, filaTarifarioEncontrada: true, filaTarifarioError: null,
  paquete: c.paquetesPorId.get(1)!, paqueteError: null, armado: c.armadoPorPar.get("1-10")!, armadoError: null, servicio: c.svcPorId.get(10)!, servicioError: null,
  grupos: [], gruposError: null, temporadas: [ALTA], temporadasError: null, franjas: [], franjasError: null, ...extra,
} as never);
const TR: ClasificacionServicio = { tipo_receptivo: "traslado" };
const PRECIOS = [P("trayecto", 100000), P("ida_regreso", 170000)];

test("búsqueda: traslado sin alcance elegido se muestra pero NO se vende (requiereAlcance, total 0)", () => {
  const r = calcularResultadoServicio(par, ctx(TR, PRECIOS), fecha, 3, 2, undefined, undefined)!;
  assert.equal(r.requiereAlcance, true); assert.equal(r.total, 0); assert.equal(r.tipoReceptivo, "traslado");
});

test("búsqueda: cada alcance cobra SU precio con el margen (2 pax): 250.000 y 425.000; ida y regreso no es el doble del trayecto", () => {
  const c = ctx(TR, PRECIOS);
  const t = calcularResultadoServicio(par, c, fecha, 3, 2, undefined, "llegada")!;
  const ir = calcularResultadoServicio(par, c, fecha, 3, 2, undefined, "ida_regreso")!;
  assert.equal(t.total, redondeo(200000)); assert.equal(t.alcance, "llegada");
  assert.equal(ir.total, redondeo(340000)); assert.equal(ir.alcance, "ida_regreso");
  assert.notEqual(ir.total, 2 * t.total);
});

test("búsqueda: un trayecto sin precio propio (o fuera de todo rango) NO se vende ni se sustituye con otro precio; ida y regreso sin precio propio usa la tarifa de la vigencia", () => {
  const r = calcularResultadoServicio(par, ctx(TR, [P("ida_regreso", 170000)]), fecha, 3, 2, undefined, "llegada")!;
  assert.ok(r.sinTarifaAlcance); assert.equal(r.total, 0);
  const ir = calcularResultadoServicio(par, ctx(TR, [P("trayecto", 100000)]), fecha, 3, 2, undefined, "ida_regreso")!;
  assert.equal(ir.sinTarifaAlcance, undefined); assert.equal(ir.total, redondeo(999999 * 2)); assert.equal(ir.alcance, "ida_regreso");
  const g = construirContextoServicios({
    paquetes: [{ id: 1, pct_mk: 0.2 }], armado: [{ paquete_id: 1, servicio_id: 10, modo: "grupo" }],
    servicios: [{ id: 10, precio_persona: 1, recargo_individual: 0, liquidacion: "paquete", moneda: "COP" }],
    // rangos de la tarifa vigente de ALTA (los de la captura): son el precio de ida y regreso mientras no haya uno propio
    grupos: [[1, 4, 120000], [5, 12, 200000], [13, 19, 280000], [20, 40, 400000]].map(([d, h, p]) => ({ servicio_id: 10, pax_desde: d, pax_hasta: h, precio: p, temporada: "ALTA" })), temporadas: [ALTA],
    clasificaciones: [{ servicio_id: 10, ...TR }], preciosAlcance: conPrecios([P("trayecto", 45000, 1, 4)]),
  });
  assert.ok(calcularResultadoServicio(par, g, fecha, 3, 8, undefined, "llegada")!.sinTarifaAlcance, "8 pax quedan fuera del rango 1–4 del trayecto (los rangos de la tarifa no son de un trayecto)");
  assert.equal(calcularResultadoServicio(par, g, fecha, 3, 3, undefined, "llegada")!.total, redondeo(45000));
  for (const [pax, valor] of [[1, 120000], [4, 120000], [5, 200000], [12, 200000], [13, 280000], [19, 280000], [20, 400000], [40, 400000]]) {
    assert.equal(calcularResultadoServicio(par, g, fecha, 3, pax, undefined, "ida_regreso")!.total, redondeo(valor), `ida y regreso, ${pax} pax`);
  }
  assert.ok(calcularResultadoServicio(par, g, fecha, 3, 41, undefined, "ida_regreso")!.sinTarifaAlcance, "41 pax: ningún rango");
});

test("búsqueda: lo que no es traslado ignora el alcance elegido (no se rechaza ni se oculta)", () => {
  const tour = calcularResultadoServicio(par, ctx({ tipo_receptivo: "tour" }), fecha, 3, 2, undefined, "llegada")!;
  assert.ok(tour.total > 0); assert.equal(tour.alcance, undefined); assert.equal(tour.requiereAlcance, undefined); assert.equal(tour.tipoReceptivo, "tour");
});

test("legado: un servicio SIN clasificar se cotiza como siempre (tarifa de la vigencia), con o sin la 262", () => {
  const sin = calcularResultadoServicio(par, ctx(null), fecha, 3, 2)!;
  const conTabla = calcularResultadoServicio(par, ctx({ tipo_receptivo: null }), fecha, 3, 2)!;
  assert.equal(sin.total, conTabla.total); assert.equal(sin.total, redondeo(999999 * 2)); assert.equal(sin.alcance, undefined);
});

test("puntual: traslado SIN alcance no se cotiza (no_disponible); con alcance y precio propio sí", () => {
  const c = ctx(TR, PRECIOS);
  const sin = puntual(c, { clasificacion: TR, preciosAlcance: conPrecios(PRECIOS) });
  assert.equal(sin.ok, false); assert.equal(!sin.ok && sin.codigo, "alcance_requerido"); assert.equal(!sin.ok && sin.tipo, "no_disponible");
  const ok = puntual(c, { alcance: "salida", clasificacion: TR, preciosAlcance: conPrecios(PRECIOS) });
  assert.equal(ok.ok && ok.resultado.total, redondeo(200000)); assert.equal(ok.ok && ok.resultado.alcance, "salida");
});

test("puntual: un trayecto sin precio propio NO se vende (sin_precio_alcance); ida y regreso sin precio propio se vende con la tarifa vigente, igual que en la búsqueda", () => {
  const r = puntual(ctx(TR), { alcance: "llegada", clasificacion: TR, preciosAlcance: conPrecios([P("ida_regreso", 170000)]) });
  assert.equal(!r.ok && r.codigo, "sin_precio_alcance"); assert.equal(!r.ok && r.tipo, "no_disponible");
  const ir = puntual(ctx(TR), { alcance: "ida_regreso", clasificacion: TR, preciosAlcance: conPrecios([P("trayecto", 100000)]) });
  assert.equal(ir.ok && ir.resultado.total, redondeo(999999 * 2)); assert.equal(ir.ok && ir.resultado.alcance, "ida_regreso");
  const busq = calcularResultadoServicio(par, ctx(TR, [P("trayecto", 100000)]), fecha, 3, 2, undefined, "ida_regreso")!;
  assert.equal(ir.ok && ir.resultado.total, busq.total, "búsqueda y re-liquidación puntual (cotización/conversión) dan el mismo importe");
  const sinTarifa = puntual(ctx(TR), { alcance: "ida_regreso", clasificacion: TR, preciosAlcance: [], temporadas: [{ ...ALTA, precio_persona: null }] });
  assert.equal(!sinTarifa.ok && sinTarifa.codigo, "sin_precio_alcance", "sin precio propio ni tarifa vigente no se vende");
});

test("puntual: un alcance en un servicio que no es traslado (petición alterada) aborta como configuración inválida; sin la 262 nunca se acepta", () => {
  const r = puntual(ctx({ tipo_receptivo: "tour" }), { alcance: "llegada", clasificacion: { tipo_receptivo: "tour" }, preciosAlcance: [] });
  assert.equal(!r.ok && r.codigo, "alcance_no_aplica"); assert.equal(!r.ok && r.tipo, "configuracion_invalida");
  const sinEsquema = puntual(ctx(null), { alcance: "llegada" });
  assert.equal(!sinEsquema.ok && sinEsquema.codigo, "alcance_no_aplica");
});

test("puntual: un fallo al leer la 262 es error técnico (no se sigue con datos parciales)", () => {
  const r = puntual(ctx(TR, PRECIOS), { alcance: "llegada", alcanceError: "boom" });
  assert.equal(!r.ok && r.tipo, "error_consulta");
});

test("suplemento: trayecto de llegada cobra SOLO la llegada y no pide la salida; ida y regreso cobra cada tramo con SU hora", () => {
  const f = [NOCHE];
  const base = { clasificacion: TR, preciosAlcance: conPrecios(PRECIOS), franjas: f };
  const c = ctx(TR, PRECIOS, f);
  const llegada = puntual(c, { ...base, alcance: "llegada", horas: { llegada: "22:00" } });
  assert.equal(llegada.ok && llegada.resultado.total, redondeo(200000 + 30000));
  assert.deepEqual(llegada.ok && llegada.resultado.horasCotizadas, { llegada: "22:00" }, "la salida no interviene");
  const sinHora = puntual(c, { ...base, alcance: "salida", horas: { llegada: "22:00" } });
  assert.equal(!sinHora.ok && sinHora.tipo, "requiere_hora"); assert.deepEqual(!sinHora.ok && sinHora.tramosPendientes, ["salida"]);
  const ambos = puntual(c, { ...base, alcance: "ida_regreso", horas: { llegada: "22:00", salida: "05:00" } });
  assert.equal(ambos.ok && ambos.resultado.total, redondeo(340000 + 60000));
});

test("combo con traslado: conserva su tarifa y el suplemento solo cuenta para el tramo declarado", () => {
  const combo: ClasificacionServicio = { tipo_receptivo: "combo", combo_incluye_traslado: true, combo_traslado_alcance: "trayecto_llegada" };
  const c = ctx(combo, [], [NOCHE]);
  const r = puntual(c, { clasificacion: combo, preciosAlcance: [], franjas: [NOCHE], horas: { llegada: "22:00" } });
  assert.equal(r.ok && r.resultado.total, redondeo(999999 * 2 + 30000));
  assert.equal(r.ok && r.resultado.alcance, undefined, "el combo no usa alcance de venta");
});

// ── Suplementos por RANGO de pasajeros en la ruta de venta (hueco hallado con el escenario #423: la lectura descartaba pax_desde/pax_hasta) ────────────
const BASE_FRANJA = { hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", cobro: "grupo" };
const FRANJAS_PROVEEDOR = [[1, 4, 45000], [5, 12, 80000], [13, 19, 130000], [20, 40, 190000]].map(([d, h, v], i) => ({ id: i + 1, ...BASE_FRANJA, valor: v, pax_desde: d, pax_hasta: h }));

test("la lectura de franjas pide y conserva el rango de pasajeros; sin rango la forma no cambia", () => {
  assert.match(SELECT_TEMPORADAS_CON_FRANJAS, /servicio_suplementos_franja\([^)]*pax_desde, pax_hasta\)/);
  assert.doesNotMatch(SELECT_TEMPORADAS_CON_FRANJAS_SIN_RANGO, /pax_desde/, "la versión de respaldo (base sin las columnas) no las pide");
  const { franjas } = separarFranjas([{ ...ALTA, servicio_suplementos_franja: FRANJAS_PROVEEDOR } as unknown as FilaTemporadaConFranjas]);
  assert.deepEqual(franjas.map((f) => [f.pax_desde, f.pax_hasta, f.valor]), [[1, 4, 45000], [5, 12, 80000], [13, 19, 130000], [20, 40, 190000]]);
  const sinRango = separarFranjas([{ ...ALTA, servicio_suplementos_franja: [{ id: 9, ...BASE_FRANJA, valor: 30000 }] } as unknown as FilaTemporadaConFranjas]).franjas[0];
  assert.equal("pax_desde" in sinRango, false, "una franja sin rango sigue sin llevar las claves");
});

test("ida y regreso con la tarifa vigente: cada rango cobra SU suplemento por tramo (45.000 / 80.000 / 130.000 / 190.000), en búsqueda y en re-liquidación puntual", () => {
  const { temporadas, franjas } = separarFranjas([{ ...ALTA, servicio_suplementos_franja: FRANJAS_PROVEEDOR } as unknown as FilaTemporadaConFranjas]);
  const c = construirContextoServicios({
    paquetes: [{ id: 1, pct_mk: 0.2 }], armado: [{ paquete_id: 1, servicio_id: 10, modo: "persona" }],
    servicios: [{ id: 10, precio_persona: 999999, recargo_individual: 50000, liquidacion: "paquete", moneda: "COP", categoria: "tour_traslado" }],
    grupos: [], temporadas, franjas, clasificaciones: [{ servicio_id: 10, ...TR }], preciosAlcance: [],
  });
  const noche = { llegada: "22:00", salida: "05:00" };
  for (const [pax, sup] of [[1, 45000], [4, 45000], [5, 80000], [12, 80000], [13, 130000], [19, 130000], [20, 190000], [40, 190000]] as const) {
    const esperado = redondeo(999999 * pax + (pax === 1 ? 50000 : 0) + 2 * sup); // 1 pax: la tarifa vigente lleva su recargo individual
    const busq = calcularResultadoServicio(par, c, fecha, 3, pax, noche, "ida_regreso")!;
    assert.equal(busq.total, esperado, `búsqueda, ${pax} pax`);
    const pun = puntual(c, { alcance: "ida_regreso", clasificacion: TR, preciosAlcance: [], franjas, horas: noche, pax } as never);
    assert.equal(pun.ok && pun.resultado.total, esperado, `puntual, ${pax} pax`);
  }
});

test("tarifa vigente en 0: es una tarifa (no «sin_precio_alcance»); la venta la rechaza después porque el total debe ser mayor que 0, y un trayecto sigue sin usarla", () => {
  const cero = { alcance: "ida_regreso", clasificacion: TR, preciosAlcance: [], temporadas: [{ ...ALTA, precio_persona: 0, recargo_individual: 0 }] };
  const r = puntual(ctx(TR), cero);
  assert.equal(r.ok, false); assert.notEqual(!r.ok && r.codigo, "sin_precio_alcance", "0 no es «sin tarifa»");
  const trayecto = puntual(ctx(TR), { ...cero, alcance: "llegada" });
  assert.equal(!trayecto.ok && trayecto.codigo, "sin_precio_alcance", "un trayecto exige su precio propio aunque la tarifa exista");
});
