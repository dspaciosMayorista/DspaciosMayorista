// ─────────────────────────────────────────────────────────────────────────
// Liquidación de un servicio/tour — fórmula ÚNICA (temporada vigente por
// fecha, modo persona/grupo, recargo individual, markup del paquete,
// redondeo por moneda), compartida por `buscarReceptivos` (búsqueda en lote,
// tolerante — un par sin armado/paquete simplemente no aparece en los
// resultados) y `liquidarServicioPuntual` (re-liquidación del checkout,
// FALLO CERRADO — un tour real del carrito nunca se cotiza con un modo o
// margen inventado). Ambos caminos viven en lib/reservar/cotizar.ts (que sí
// toca Supabase); este módulo es PURO: decide con lo que ya se consultó,
// nunca consulta — mismo patrón que `resolverB2BParaMensaje` en
// lib/reservar/edadesMenores.ts.
//
// Defecto real corregido (ronda 4): la versión anterior de
// `liquidarServicioPuntual` reutilizaba la MISMA función tolerante que la
// búsqueda — si `armado_servicios` no traía fila para el par, el modo caía
// en silencio a "persona"; si `armado_paquetes` no traía fila, el markup
// caía en silencio a 0%. Un tour re-liquidado así podía cobrarse con la
// fórmula equivocada o sin margen, sin que nada lo distinguiera de un cálculo
// correcto. Ahora la re-liquidación puntual exige paquete/armado/servicio
// presentes, confirma que el armado pertenece EXACTAMENTE al par consultado,
// y distingue tres motivos de fallo — nunca los mezcla:
// - "error_consulta": una consulta a Supabase falló técnicamente (debe
//   abortar la cotización COMPLETA, nunca solo excluir el tour).
// - "configuracion_invalida": el servicio/paquete/armado está mal
//   configurado o incompleto en el catálogo (también aborta — no es "el
//   cliente eligió mal", es un dato faltante en el sistema).
// - "no_disponible": el servicio genuinamente no está publicado/activo, o no
//   tiene tarifa vigente para esas fechas/pax — esto SÍ es un caso legítimo
//   de "no se puede vender esto ahora", se excluye del carrito con un
//   mensaje honesto (nunca se confunde con un fallo técnico).
//
// Import relativo (no `@/…`) a propósito: `lib/calc/paquetes.ts` no tiene
// dependencias externas, así que este módulo se puede importar DIRECTO desde
// `node --test` (ver pruebas/liquidacionServicio.test.ts) sin bundler — mismo
// motivo por el que `lib/reservar/distribucionHabitaciones.ts`/
// `edadesMenores.ts` evitan el alias `@/`.
// ─────────────────────────────────────────────────────────────────────────

import {
  precioServicio, factorLiquidacion, marcar, redondearVenta, temporadaVigenteParaFecha,
  toTemporadaRango, type TemporadaRango,
} from "../calc/paquetes.ts";

export type DatosServicioPar = { servicioId: number; paqueteId: number; nombre: string; destino: string | null; descripcion: string | null };
export type FilaServicioAdicional = { id: number; precio_persona: number | null; recargo_individual: number | null; liquidacion: string | null; moneda: string | null };
export type FilaGrupoTarifa = { pax_desde: number; pax_hasta: number; precio: number };
export type FilaArmadoServicio = { paquete_id: number; servicio_id: number; modo: string | null };
export type FilaPaquete = { id: number; pct_mk: number | null };
export type FilaTemporadaServicio = {
  servicio_id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  compra_inicio: string | null; compra_fin: string | null; prioridad: number | null;
  precio_persona: number | null; recargo_individual: number | null;
};
export type FilaGrupoServicio = FilaGrupoTarifa & { servicio_id: number; temporada: string | null };

export type ResultadoServicio = {
  servicioId: number; nombre: string; destino: string | null; descripcion: string | null;
  paqueteId: number; total: number; pax: number; noches: number; moneda: string;
};

export type ContextoServicios = {
  pctMkPorPaquete: Map<number, number>;
  modoPorPar: Map<string, "grupo" | "persona">;
  svcPorId: Map<number, FilaServicioAdicional>;
  gruposPorServ: Map<string, FilaGrupoTarifa[]>;
  tempsPorServ: Map<number, TemporadaRango[]>;
  netoTempServ: Map<string, number>;
  recTempServ: Map<string, number>;
};

// Arma el contexto de liquidación (mapas por servicio/temporada/grupo) a
// partir de las filas ya consultadas — compartido por la búsqueda en lote y
// la re-liquidación puntual para no tener dos copias de este armado.
export function construirContextoServicios(datos: {
  paquetes: FilaPaquete[];
  armado: FilaArmadoServicio[];
  servicios: FilaServicioAdicional[];
  grupos: FilaGrupoServicio[];
  temporadas: FilaTemporadaServicio[];
}): ContextoServicios {
  const pctMkPorPaquete = new Map(datos.paquetes.map((p) => [p.id, Number(p.pct_mk) || 0]));
  const modoPorPar = new Map(datos.armado.map((a) => [`${a.paquete_id}-${a.servicio_id}`, a.modo === "grupo" ? "grupo" as const : "persona" as const]));
  const svcPorId = new Map(datos.servicios.map((s) => [s.id, s]));

  const gruposPorServ = new Map<string, FilaGrupoTarifa[]>();
  for (const g of datos.grupos) {
    const k = `${g.servicio_id}|${g.temporada ?? "GENERAL"}`;
    (gruposPorServ.get(k) ?? gruposPorServ.set(k, []).get(k)!).push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
  }
  const tempsPorServ = new Map<number, TemporadaRango[]>();
  const netoTempServ = new Map<string, number>();
  const recTempServ = new Map<string, number>();
  for (const t of datos.temporadas) {
    (tempsPorServ.get(t.servicio_id) ?? tempsPorServ.set(t.servicio_id, []).get(t.servicio_id)!).push(toTemporadaRango(t));
    if (t.precio_persona != null) netoTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.precio_persona));
    if (t.recargo_individual != null) recTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.recargo_individual));
  }
  return { pctMkPorPaquete, modoPorPar, svcPorId, gruposPorServ, tempsPorServ, netoTempServ, recTempServ };
}

// Fórmula ÚNICA de liquidación de un servicio/tour, dado un modo y un markup
// YA RESUELTOS (nunca decide defaults — eso es responsabilidad de cada
// llamador, ver `calcularResultadoServicio` (tolerante) vs
// `resolverLiquidacionServicioPuntual` (fallo cerrado) más abajo). `null` =
// no hay tarifa vigente para esa fecha/pax con el modo dado.
export function calcularPrecioConModoYMarkup(
  par: DatosServicioPar, ctx: ContextoServicios, fechaIdaDate: Date, numNoches: number, pax: number,
  modo: "grupo" | "persona", pctMk: number
): ResultadoServicio | null {
  const srv = ctx.svcPorId.get(par.servicioId);
  if (!srv) return null;
  const tt = ctx.tempsPorServ.get(par.servicioId);
  const nombreTemp = tt?.length ? temporadaVigenteParaFecha(fechaIdaDate, tt) : null;
  const netoPersona = (nombreTemp ? ctx.netoTempServ.get(`${par.servicioId}|${nombreTemp}`) : undefined) ?? srv.precio_persona ?? null;
  const gruposTemp = nombreTemp ? ctx.gruposPorServ.get(`${par.servicioId}|${nombreTemp}`) : undefined;
  const gruposServ = gruposTemp?.length ? gruposTemp : (ctx.gruposPorServ.get(`${par.servicioId}|GENERAL`) ?? []);
  if (modo === "persona" && netoPersona == null) return null; // sin tarifa para esa fecha
  if (modo === "grupo" && !gruposServ.length) return null;

  let costoNeto = precioServicio(modo, netoPersona, gruposServ, pax) * factorLiquidacion(srv.liquidacion, numNoches);
  if (modo === "persona" && pax === 1) {
    const recTemp = nombreTemp ? ctx.recTempServ.get(`${par.servicioId}|${nombreTemp}`) : undefined;
    costoNeto += Math.max(recTemp ?? (Number(srv.recargo_individual) || 0), 0);
  }
  const moneda = srv.moneda ?? "COP";
  const total = redondearVenta(marcar(costoNeto, pctMk), moneda);
  if (total <= 0) return null;

  return { servicioId: par.servicioId, nombre: par.nombre, destino: par.destino, descripcion: par.descripcion, paqueteId: par.paqueteId, total, pax, noches: numNoches, moneda };
}

// ── Búsqueda en lote (buscarReceptivos): TOLERANTE — un par sin armado o sin
// paquete simplemente no debe romper la búsqueda de los demás; se resuelve
// con el default de siempre (modo "persona", 0% markup) y, si aun así no hay
// tarifa, ese resultado no aparece en la lista. Nunca se usa para checkout.
export function calcularResultadoServicio(
  par: DatosServicioPar, ctx: ContextoServicios, fechaIdaDate: Date, numNoches: number, pax: number
): ResultadoServicio | null {
  const modo = ctx.modoPorPar.get(`${par.paqueteId}-${par.servicioId}`) ?? "persona";
  const pctMk = ctx.pctMkPorPaquete.get(par.paqueteId) ?? 0;
  return calcularPrecioConModoYMarkup(par, ctx, fechaIdaDate, numNoches, pax, modo, pctMk);
}

// ── Re-liquidación puntual (liquidarServicioPuntual): FALLO CERRADO ────────
export type ResultadoServicioPuntual =
  | { ok: true; resultado: ResultadoServicio }
  | { ok: false; tipo: "no_disponible" | "error_consulta" | "configuracion_invalida"; error: string };

// Recibe cada fila YA CONSULTADA por el llamador (que sí toca Supabase, ver
// `liquidarServicioPuntual` en cotizar.ts) junto con el `error` de SU
// consulta puntual — nunca se combinan en un solo booleano: "no existe" (fila
// null, sin error) y "la consulta falló" (error presente) son motivos
// distintos y se reportan distinto (no_disponible/configuracion_invalida vs
// error_consulta). Esta función es PURA: no consulta nada, solo decide.
export function resolverLiquidacionServicioPuntual(input: {
  par: DatosServicioPar;
  fechaIdaDate: Date;
  numNoches: number;
  pax: number;
  filaTarifarioEncontrada: boolean;
  filaTarifarioError: string | null;
  paquete: FilaPaquete | null;
  paqueteError: string | null;
  armado: FilaArmadoServicio | null;
  armadoError: string | null;
  servicio: FilaServicioAdicional | null;
  servicioError: string | null;
  grupos: FilaGrupoServicio[];
  gruposError: string | null;
  temporadas: FilaTemporadaServicio[];
  temporadasError: string | null;
}): ResultadoServicioPuntual {
  // 1) Cada consulta se revisa por separado — un error técnico de CUALQUIERA
  // de ellas aborta la cotización con "error_consulta": nunca se sigue con
  // datos parciales asumiendo un valor por defecto.
  if (input.filaTarifarioError) return { ok: false, tipo: "error_consulta", error: `No se pudo confirmar el servicio publicado: ${input.filaTarifarioError}` };
  if (input.paqueteError) return { ok: false, tipo: "error_consulta", error: `No se pudo consultar el paquete: ${input.paqueteError}` };
  if (input.armadoError) return { ok: false, tipo: "error_consulta", error: `No se pudo consultar el armado del servicio: ${input.armadoError}` };
  if (input.servicioError) return { ok: false, tipo: "error_consulta", error: `No se pudo consultar el servicio: ${input.servicioError}` };
  if (input.gruposError) return { ok: false, tipo: "error_consulta", error: `No se pudo consultar las tarifas de grupo: ${input.gruposError}` };
  if (input.temporadasError) return { ok: false, tipo: "error_consulta", error: `No se pudo consultar las temporadas del servicio: ${input.temporadasError}` };

  // 2) El par debe estar realmente publicado/activo — motivo de negocio
  // legítimo, no un fallo técnico.
  if (!input.filaTarifarioEncontrada) {
    return { ok: false, tipo: "no_disponible", error: "Este servicio ya no está publicado/activo para ese paquete." };
  }

  // 3) Paquete, armado y servicio son OBLIGATORIOS — nunca se cae a un modo o
  // markup por defecto cuando alguno falta (el defecto real corregido de
  // esta ronda). Faltar cualquiera de los tres es un dato incompleto del
  // catálogo, no una elección inválida del cliente.
  if (!input.paquete) return { ok: false, tipo: "configuracion_invalida", error: "El paquete de este servicio no existe o fue eliminado." };
  if (!input.armado) return { ok: false, tipo: "configuracion_invalida", error: "Este servicio no tiene armado (armado_servicios) para este paquete — no hay modo de cobro configurado." };
  if (!input.servicio) return { ok: false, tipo: "no_disponible", error: "El servicio ya no existe." };

  // 4) El armado consultado debe pertenecer EXACTAMENTE al par pedido —
  // nunca se confía en que el filtro de la consulta baste por sí solo.
  if (input.armado.paquete_id !== input.par.paqueteId || input.armado.servicio_id !== input.par.servicioId) {
    return { ok: false, tipo: "configuracion_invalida", error: "El armado consultado no corresponde al par paquete/servicio solicitado." };
  }

  const ctx = construirContextoServicios({
    paquetes: [input.paquete], armado: [input.armado], servicios: [input.servicio],
    grupos: input.grupos, temporadas: input.temporadas,
  });
  const modo = input.armado.modo === "grupo" ? "grupo" as const : "persona" as const;
  const pctMk = Number(input.paquete.pct_mk) || 0;
  const resultado = calcularPrecioConModoYMarkup(input.par, ctx, input.fechaIdaDate, input.numNoches, input.pax, modo, pctMk);
  if (!resultado) return { ok: false, tipo: "no_disponible", error: "Este servicio no tiene tarifa vigente para esas fechas/pax." };
  return { ok: true, resultado };
}
