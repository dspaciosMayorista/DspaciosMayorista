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
  // Filas CRUDAS de paquete/armado (nunca modo/markup ya coercionados a un
  // default) — la validación de "modo/markup real vs inválido" vive en
  // `validarModoServicio`/`validarPctMarkup`/`resolverConfiguracionServicio`
  // más abajo, compartida por búsqueda y checkout. Guardar el default
  // aplicado DENTRO del contexto (como hacía la versión anterior) hacía
  // imposible distinguir "sin armado" de "armado con modo inválido" una vez
  // armado el mapa — ambos colapsaban al mismo `"persona"`.
  paquetesPorId: Map<number, FilaPaquete>;
  armadoPorPar: Map<string, FilaArmadoServicio>;
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
  const paquetesPorId = new Map(datos.paquetes.map((p) => [p.id, p]));
  const armadoPorPar = new Map(datos.armado.map((a) => [`${a.paquete_id}-${a.servicio_id}`, a]));
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
  return { paquetesPorId, armadoPorPar, svcPorId, gruposPorServ, tempsPorServ, netoTempServ, recTempServ };
}

// ── Validadores de configuración — COMPARTIDOS por búsqueda y checkout ─────
// (ronda 5, corrige que ambos caminos coercionaban modo/markup inválidos a
// "persona"/0% en silencio). Ninguno de los dos decide qué hacer con un
// resultado inválido — eso es responsabilidad de cada llamador:
// `calcularResultadoServicio` (búsqueda) omite el par; `resolverLiquidacionServicioPuntual`
// (checkout) aborta con `configuracion_invalida`.

// El modo de cobro (`armado_servicios.modo`) solo tiene dos valores de
// negocio válidos — cualquier otra cosa (null, "", "OTRO", mayúsculas,
// texto manipulado) es una configuración incompleta/corrupta, nunca "persona
// por default".
export function validarModoServicio(modo: unknown): "persona" | "grupo" | null {
  if (modo === "persona" || modo === "grupo") return modo;
  return null;
}

// Rango comercial real de `armado_paquetes.pct_mk`: se captura en la UI como
// un % entre 0 y 99 (`ConfigForm.tsx`, `<Input type="number" min={0} max={99}>`,
// dividido entre 100 al guardar — ver `paquetes/actions.ts`) — nunca
// negativo, nunca ≥1. `marcar()` (`lib/calc/paquetes.ts`, usada en TODO el
// motor de precios, no solo servicios) ya blinda el caso `pctMk >= 1`
// devolviendo `0` en silencio, para no dividir por cero/negativo en los
// demás flujos que confían en ese blindaje — pero un "0% fantasma" así
// generado sería indistinguible de un 0% real configurado. Este módulo
// SIEMPRE valida `pctMk` ANTES de llamar a `marcar()`, así que ese blindaje
// interno nunca llega a activarse desde acá: un markup fuera de rango se
// rechaza como configuración inválida, nunca se sustituye por 0.
export function validarPctMarkup(pctMk: unknown): number | null {
  if (typeof pctMk !== "number" || !Number.isFinite(pctMk)) return null;
  if (pctMk < 0 || pctMk >= 1) return null;
  return pctMk;
}

export type ConfiguracionServicioResuelta = { modo: "persona" | "grupo"; pctMk: number };

// Resuelve modo+markup a partir de las filas de paquete/armado YA
// CONSULTADAS — usa los MISMOS dos validadores de arriba que usa
// `resolverLiquidacionServicioPuntual` directamente (checkout), así que el
// criterio de "qué es una configuración válida" es idéntico en los dos
// caminos; la única diferencia legítima es qué hace cada llamador con un
// resultado `null` (omitir vs abortar). Falla cerrado ante CUALQUIER
// inconsistencia: paquete/armado ausentes, que no pertenezcan al par
// consultado, o que su modo/markup no sean válidos — nunca decide un default.
export function resolverConfiguracionServicio(
  paquete: FilaPaquete | null,
  armado: FilaArmadoServicio | null,
  par: DatosServicioPar
): ConfiguracionServicioResuelta | null {
  if (!paquete || !armado) return null;
  if (paquete.id !== par.paqueteId) return null;
  if (armado.paquete_id !== par.paqueteId || armado.servicio_id !== par.servicioId) return null;
  const modo = validarModoServicio(armado.modo);
  if (modo == null) return null;
  const pctMk = validarPctMarkup(paquete.pct_mk);
  if (pctMk == null) return null;
  return { modo, pctMk };
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
  // Defensa en profundidad: aunque los dos llamadores (`calcularResultadoServicio`
  // vía `resolverConfiguracionServicio`, `resolverLiquidacionServicioPuntual`
  // directo) ya validan `pctMk` antes de llegar acá, esta función — el
  // núcleo compartido de la fórmula — nunca debe poder calcular con un
  // markup fuera de rango sin importar quién la invoque.
  if (validarPctMarkup(pctMk) == null) return null;

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
  // Costo neto no finito (dato corrupto aguas arriba) nunca debe llegar a
  // `marcar()`/`redondearVenta()` — se rechaza acá, antes de calcular el total.
  if (!Number.isFinite(costoNeto)) return null;

  const moneda = srv.moneda ?? "COP";
  const total = redondearVenta(marcar(costoNeto, pctMk), moneda);
  // El total debe ser finito, seguro (entero representable sin pérdida de
  // precisión — `redondearVenta` siempre produce un entero, en pesos o
  // dólares) y positivo antes de darlo por válido.
  if (!Number.isSafeInteger(total) || total <= 0) return null;

  return { servicioId: par.servicioId, nombre: par.nombre, destino: par.destino, descripcion: par.descripcion, paqueteId: par.paqueteId, total, pax, noches: numNoches, moneda };
}

// ── Búsqueda en lote (buscarReceptivos): TOLERANTE con la AUSENCIA de datos
// (un par sin armado/paquete simplemente no aparece en los resultados, no
// rompe la búsqueda de los demás) pero NUNCA con un modo/markup INVÁLIDO —
// usa el MISMO validador de configuración que el checkout
// (`resolverConfiguracionServicio`); si el par existe pero su configuración
// no es válida, también se omite (nunca se calcula con "persona"/0% por
// default). Nunca se usa para checkout — ese usa `resolverLiquidacionServicioPuntual`.
export function calcularResultadoServicio(
  par: DatosServicioPar, ctx: ContextoServicios, fechaIdaDate: Date, numNoches: number, pax: number
): ResultadoServicio | null {
  const paquete = ctx.paquetesPorId.get(par.paqueteId) ?? null;
  const armado = ctx.armadoPorPar.get(`${par.paqueteId}-${par.servicioId}`) ?? null;
  const cfg = resolverConfiguracionServicio(paquete, armado, par);
  if (!cfg) return null;
  return calcularPrecioConModoYMarkup(par, ctx, fechaIdaDate, numNoches, pax, cfg.modo, cfg.pctMk);
}

// ── Re-liquidación puntual (liquidarServicioPuntual): FALLO CERRADO ────────
//
// Frontera pública (ronda 6): el `error` de ronda 4/5 concatenaba texto
// técnico REAL de Supabase (mensaje de la excepción, a veces con nombres de
// tabla/columna/policy) directo en el string que terminaba devuelto por la
// Server Action pública (`crearSolicitudReserva`) — una llamada anónima
// podía ver "relation \"armado_servicios\" does not exist" o "permission
// denied for table X". Se separan DOS canales, nunca mezclados:
// - `mensajePublico`: texto FIJO por familia de error (nunca interpolado con
//   nada que venga de Supabase/la config) — lo único que puede cruzar la
//   frontera pública, vía `respuestaPublicaServicioPuntual()` más abajo.
// - `detalleInterno`: texto técnico real (mensaje de Supabase, o qué fila/
//   columna de catálogo está mal) — SOLO para logging server-side (ver
//   `formatearLogLiquidacionServicioPuntual`), nunca se expone.
// `codigo` es estable y sirve para correlacionar el log con el motivo real
// sin tener que exponer `detalleInterno`.
export type CodigoErrorServicioPuntual =
  | "service_role_faltante"
  | "tarifario_consulta_fallida" | "paquete_consulta_fallida" | "armado_consulta_fallida"
  | "servicio_consulta_fallida" | "grupos_consulta_fallida" | "temporadas_consulta_fallida"
  | "tarifario_no_encontrado" | "servicio_no_existe" | "sin_tarifa_vigente"
  | "paquete_ausente" | "armado_ausente"
  | "paquete_no_coincide" | "servicio_no_coincide" | "armado_no_coincide"
  | "modo_invalido" | "markup_invalido" | "total_invalido";

export type ResultadoServicioPuntual =
  | { ok: true; resultado: ResultadoServicio }
  | {
      ok: false;
      tipo: "no_disponible" | "error_consulta" | "configuracion_invalida";
      codigo: CodigoErrorServicioPuntual;
      mensajePublico: string;
      detalleInterno: string;
    };

// Mensajes públicos FIJOS (nunca construidos por interpolación de datos
// externos) — uno por familia. `no_disponible` sí puede variar (son mensajes
// comerciales ya honestos, sin detalle técnico); `error_consulta` y
// `configuracion_invalida` son SIEMPRE el mismo texto exacto pedido, sin
// importar cuál de las 6 consultas falló o cuál pieza de configuración era
// inválida — así no hay forma de que un detalle técnico se filtre por accidente.
const MENSAJE_ERROR_CONSULTA = "No pudimos validar el servicio en este momento. Intenta nuevamente.";
const MENSAJE_CONFIGURACION_INVALIDA = "Este servicio requiere una revisión interna antes de poder cotizarse.";

// Exportada: también la usa `cotizar.ts` para el caso de arranque (falta
// `SUPABASE_SERVICE_ROLE_KEY`), que nunca llega a `resolverLiquidacionServicioPuntual`
// (aborta antes de tocar Supabase) pero debe fallar cerrado con el MISMO
// mensaje público fijo que cualquier otro `error_consulta`.
export function fallaErrorConsulta(codigo: CodigoErrorServicioPuntual, detalleInterno: string): ResultadoServicioPuntual {
  return { ok: false, tipo: "error_consulta", codigo, mensajePublico: MENSAJE_ERROR_CONSULTA, detalleInterno };
}
function fallaConfiguracionInvalida(codigo: CodigoErrorServicioPuntual, detalleInterno: string): ResultadoServicioPuntual {
  return { ok: false, tipo: "configuracion_invalida", codigo, mensajePublico: MENSAJE_CONFIGURACION_INVALIDA, detalleInterno };
}
// `no_disponible` reutiliza el mismo mensaje comercial como público e
// interno — ya es honesto y sin detalle técnico, no hace falta un segundo texto.
function fallaNoDisponible(codigo: CodigoErrorServicioPuntual, mensaje: string): ResultadoServicioPuntual {
  return { ok: false, tipo: "no_disponible", codigo, mensajePublico: mensaje, detalleInterno: mensaje };
}

// Recibe cada fila YA CONSULTADA por el llamador (que sí toca Supabase, ver
// `liquidarServicioPuntual` en cotizar.ts) junto con el `error` de SU
// consulta puntual — nunca se combinan en un solo booleano: "no existe" (fila
// null, sin error) y "la consulta falló" (error presente) son motivos
// distintos y se reportan distinto (no_disponible/configuracion_invalida vs
// error_consulta). Esta función es PURA: no consulta nada, solo decide (y no
// hace logging — eso es responsabilidad del llamador con I/O real, ver
// `liquidarServicioPuntual` en cotizar.ts).
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
  // datos parciales asumiendo un valor por defecto. El texto real de
  // Supabase va SOLO a `detalleInterno` (logging), nunca al mensaje público.
  if (input.filaTarifarioError) return fallaErrorConsulta("tarifario_consulta_fallida", `tarifario_resultado: ${input.filaTarifarioError}`);
  if (input.paqueteError) return fallaErrorConsulta("paquete_consulta_fallida", `armado_paquetes: ${input.paqueteError}`);
  if (input.armadoError) return fallaErrorConsulta("armado_consulta_fallida", `armado_servicios: ${input.armadoError}`);
  if (input.servicioError) return fallaErrorConsulta("servicio_consulta_fallida", `servicios_adicionales: ${input.servicioError}`);
  if (input.gruposError) return fallaErrorConsulta("grupos_consulta_fallida", `servicio_tarifa_pax: ${input.gruposError}`);
  if (input.temporadasError) return fallaErrorConsulta("temporadas_consulta_fallida", `servicio_temporadas: ${input.temporadasError}`);

  // 2) El par debe estar realmente publicado/activo — motivo de negocio
  // legítimo, no un fallo técnico. El mensaje ya es comercial (sin detalle
  // técnico), así que sirve igual como público e interno.
  if (!input.filaTarifarioEncontrada) {
    return fallaNoDisponible("tarifario_no_encontrado", "Este servicio ya no está publicado/activo para ese paquete.");
  }

  // 3) Paquete, armado y servicio son OBLIGATORIOS — nunca se cae a un modo o
  // markup por defecto cuando alguno falta (el defecto real corregido en la
  // ronda 4). Faltar cualquiera de los tres es un dato incompleto del
  // catálogo, no una elección inválida del cliente — el detalle técnico
  // (qué tabla/id falta) queda SOLO en `detalleInterno`.
  if (!input.paquete) return fallaConfiguracionInvalida("paquete_ausente", `armado_paquetes sin fila para paqueteId=${input.par.paqueteId}`);
  if (!input.armado) return fallaConfiguracionInvalida("armado_ausente", `armado_servicios sin fila para paqueteId=${input.par.paqueteId} servicioId=${input.par.servicioId}`);
  if (!input.servicio) return fallaNoDisponible("servicio_no_existe", "El servicio ya no existe.");

  // 4) Consistencia defensiva del par (ronda 5): aunque las consultas del
  // llamador ya filtran por id, el resolvedor puro nunca confía en eso —
  // verifica explícitamente que CADA fila pertenezca al par consultado.
  if (input.paquete.id !== input.par.paqueteId) {
    return fallaConfiguracionInvalida("paquete_no_coincide", `armado_paquetes.id=${input.paquete.id} no coincide con par.paqueteId=${input.par.paqueteId}`);
  }
  if (input.servicio.id !== input.par.servicioId) {
    return fallaConfiguracionInvalida("servicio_no_coincide", `servicios_adicionales.id=${input.servicio.id} no coincide con par.servicioId=${input.par.servicioId}`);
  }
  if (input.armado.paquete_id !== input.par.paqueteId || input.armado.servicio_id !== input.par.servicioId) {
    return fallaConfiguracionInvalida("armado_no_coincide", `armado_servicios(${input.armado.paquete_id}-${input.armado.servicio_id}) no coincide con par(${input.par.paqueteId}-${input.par.servicioId})`);
  }

  // 5) Modo y markup — MISMOS validadores que usa la búsqueda
  // (`validarModoServicio`/`validarPctMarkup`, vía `resolverConfiguracionServicio`
  // en `calcularResultadoServicio`): fallo cerrado, nunca "persona"/0% por
  // default cuando el valor real es inválido, ausente o fuera de rango
  // comercial (ronda 5). El valor real configurado (`armado.modo`/`pct_mk`)
  // va SOLO a `detalleInterno` — el público nunca ve la configuración interna.
  const modo = validarModoServicio(input.armado.modo);
  if (modo == null) {
    return fallaConfiguracionInvalida("modo_invalido", `armado_servicios.modo=${JSON.stringify(input.armado.modo)} inválido para paqueteId=${input.par.paqueteId} servicioId=${input.par.servicioId}`);
  }
  const pctMk = validarPctMarkup(input.paquete.pct_mk);
  if (pctMk == null) {
    return fallaConfiguracionInvalida("markup_invalido", `armado_paquetes.pct_mk=${JSON.stringify(input.paquete.pct_mk)} fuera de rango para paqueteId=${input.par.paqueteId}`);
  }

  const ctx = construirContextoServicios({
    paquetes: [input.paquete], armado: [input.armado], servicios: [input.servicio],
    grupos: input.grupos, temporadas: input.temporadas,
  });
  const resultado = calcularPrecioConModoYMarkup(input.par, ctx, input.fechaIdaDate, input.numNoches, input.pax, modo, pctMk);
  if (!resultado) return fallaNoDisponible("sin_tarifa_vigente", "Este servicio no tiene tarifa vigente para esas fechas/pax.");

  // 6) Defensa final: `calcularPrecioConModoYMarkup` ya garantiza que
  // `total` sea finito/seguro/positivo (devuelve `null` si no), pero se
  // re-verifica acá como segunda capa antes de dar la cotización por buena
  // — mismo criterio de defensa en profundidad que `resolverB2BParaMensaje`
  // re-validando `pctComision` aunque `getContextoB2B` ya lo haya hecho.
  if (!Number.isFinite(resultado.total) || !Number.isSafeInteger(resultado.total) || resultado.total <= 0) {
    return fallaConfiguracionInvalida("total_invalido", `total calculado no válido: ${JSON.stringify(resultado.total)}`);
  }

  return { ok: true, resultado };
}

// ── Frontera pública — traduce el resultado interno a lo ÚNICO que puede
// cruzar hacia el navegador. Nunca reenvía `detalleInterno`: aunque
// `resolverLiquidacionServicioPuntual` ya construye `mensajePublico` sin
// concatenar texto técnico, esta función es la que de verdad DESCARTA
// `detalleInterno` del objeto — la usa el llamador (`crearCotizacionCarrito`
// en checkout/actions.ts) en vez de leer los campos internos directamente,
// así que no hay forma de que un cambio futuro en ese código vuelva a filtrar
// el detalle técnico por accidente.
// `tipo` SÍ viaja al público — son 3 valores categóricos fijos, nunca texto
// libre ni datos de Supabase; el llamador (`crearCotizacionCarrito`) lo
// necesita para decidir si excluye el tour (`no_disponible`) o aborta la
// cotización completa (`error_consulta`/`configuracion_invalida`).
// `codigo` (ronda 7): aunque es un enum estable y no texto libre, el
// navegador no lo necesita para nada — `crearCotizacionCarrito` solo lee
// `.tipo`/`.mensaje` — así que sale del DTO público por defecto de
// exposición mínima (nunca dar más de lo que el consumidor real usa).
// `codigo` sigue disponible en `ResultadoServicioPuntual` (interno) y en la
// línea de log (`formatearLogLiquidacionServicioPuntual`), para poder
// correlacionar el incidente real sin exponerlo.
export type RespuestaPublicaServicioPuntual =
  | { ok: true; resultado: ResultadoServicio }
  | { ok: false; tipo: "no_disponible" | "error_consulta" | "configuracion_invalida"; mensaje: string };

export function respuestaPublicaServicioPuntual(r: ResultadoServicioPuntual): RespuestaPublicaServicioPuntual {
  if (r.ok) return { ok: true, resultado: r.resultado };
  return { ok: false, tipo: r.tipo, mensaje: r.mensajePublico };
}

// ── Logging server-side (ronda 6) — construye la línea de log a partir del
// resultado + el par que se estaba re-liquidando; NUNCA incluye datos del
// cliente (nombre/documento/teléfono/email), credenciales ni tokens — solo
// contexto de catálogo (servicioId/paqueteId), el código estable y el
// detalle técnico. Función PURA (solo arma el string); el I/O real
// (`console.error`) vive en el llamador (`liquidarServicioPuntual` en
// cotizar.ts, el único punto que de verdad toca Supabase/consola).
export function formatearLogLiquidacionServicioPuntual(ctx: {
  servicioId: number; paqueteId: number; tipo: string; codigo: string; detalle: string;
}): string {
  return `[liquidarServicioPuntual] tipo=${ctx.tipo} codigo=${ctx.codigo} paqueteId=${ctx.paqueteId} servicioId=${ctx.servicioId} detalle=${ctx.detalle}`;
}
