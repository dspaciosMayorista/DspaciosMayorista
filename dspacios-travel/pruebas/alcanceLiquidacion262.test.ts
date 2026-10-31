// Liquidación de servicios con ALCANCE (262): búsqueda (se muestra pero no se vende sin alcance o sin tarifa propia) y re-liquidación puntual (checkout/conversión, falla cerrado).
// Lo clasificado como traslado se vende SIEMPRE por alcance; lo demás conserva su comportamiento anterior y rechaza un alcance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { construirContextoServicios, calcularResultadoServicio, resolverLiquidacionServicioPuntual, type FilaTemporadaServicio, type FilaFranjaServicio } from "../lib/reservar/liquidacionServicio.ts";
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

test("búsqueda: sin tarifa propia para ese alcance (o fuera de todo rango) NO se vende ni se sustituye con otro precio", () => {
  const r = calcularResultadoServicio(par, ctx(TR, [P("trayecto", 100000)]), fecha, 3, 2, undefined, "ida_regreso")!;
  assert.ok(r.sinTarifaAlcance); assert.equal(r.total, 0);
  const g = construirContextoServicios({
    paquetes: [{ id: 1, pct_mk: 0.2 }], armado: [{ paquete_id: 1, servicio_id: 10, modo: "grupo" }],
    servicios: [{ id: 10, precio_persona: 1, recargo_individual: 0, liquidacion: "paquete", moneda: "COP" }], grupos: [], temporadas: [ALTA],
    clasificaciones: [{ servicio_id: 10, ...TR }], preciosAlcance: conPrecios([P("trayecto", 45000, 1, 4)]),
  });
  assert.ok(calcularResultadoServicio(par, g, fecha, 3, 8, undefined, "llegada")!.sinTarifaAlcance, "8 pax quedan fuera del rango 1–4");
  assert.equal(calcularResultadoServicio(par, g, fecha, 3, 3, undefined, "llegada")!.total, redondeo(45000));
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

test("puntual: sin tarifa propia para el alcance NO se vende (sin_precio_alcance)", () => {
  const r = puntual(ctx(TR), { alcance: "ida_regreso", clasificacion: TR, preciosAlcance: conPrecios([P("trayecto", 100000)]) });
  assert.equal(!r.ok && r.codigo, "sin_precio_alcance"); assert.equal(!r.ok && r.tipo, "no_disponible");
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
