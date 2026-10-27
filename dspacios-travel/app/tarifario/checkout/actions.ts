"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computarReserva, type ReservaInput } from "@/lib/reservar/computo";
import { computarReservaBernalo, type SalidaResueltaBernalo } from "@/lib/reservar/computoReservaBernalo";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { construirHotelSnapPersona } from "@/lib/reservar/hotelSnapPersona";
import { formatMoneda } from "@/lib/utils";
import { comisionDefault } from "@/lib/b2b";
import {
  resolverB2BParaMensaje, resolverContextoB2B,
  respuestaPublicaInsertCotizacion, formatearLogInsertCotizacion,
  type SolicitudItemValidado, type SolicitudTourValidado,
} from "@/lib/reservar/edadesMenores";
import {
  validarCrearSolicitudInput,
  type SolicitudItemVariante,
  type SalidaSeleccionadaBernaloEntrada,
} from "@/lib/reservar/solicitudAlojamientoBernalo";
import type { HabitacionOcupacionEntrada, HabitacionOcupacionValidada } from "@/lib/reservar/ocupacionPorHabitacion";
import { liquidarServicioPuntual } from "@/lib/reservar/cotizar";
import {
  errorHotelConServicios, errorServicioVinculado, validarServicioContraHotel, type HotelResueltoCheckout,
} from "@/lib/reservar/vinculoServiciosCheckout";
import { resumirServiciosContrato, type CategoriaServicio, type ServicioEfectivo } from "@/lib/reservar/serviciosPaquete";
import { claveHuellaIncluidos, incluidosParaPayload, type ServicioIncluidoCotizado } from "@/lib/reservar/incluidosCotizados";
import { hoyBogota, resolverVigenciaCotizacion } from "@/lib/cotizacion/vigencia";
import { calcularResidualServiciosIncluidosPorGrupo } from "@/lib/reservar/desglosePersonaCotizacion";
import { descripcionLineaMenor, menoresDelComputo } from "@/lib/reservar/menoresDeDos";
import type { ComposicionBernaloDocumento } from "@/lib/reservar/alojamientoBernaloDocumento";
import type { Json } from "@/types/database";
import { PAX_TARIFA_DEFAULT, paxDeAcomodacion } from "@/lib/acomodaciones";
import {
  MAX_OPCIONES, OPCIONES_REF, MENSAJES_COMPARATIVA, canalDeRol, composicionesUniformes, codigoErrorComparativa,
  esErrorReintentable, ipOrigenConfiable, mensajeErrorComparativa, validarClienteCheckoutPublico, validarEntradaEleccion,
  validarEntradaSolicitud, validarRefsOpcion, type CanalEleccion, type CapacidadAcomodacion, type OpcionRef, type OpcionRpc,
} from "@/lib/cotizacion/comparativa";
import { huellaIp } from "@/lib/cotizacion/comparativaServidor";
import { TIPOS_DOC_PERSONA } from "@/lib/personas/identidad";
import { tipoDocCheckout } from "@/lib/personas/cotizacion";
import { altaPersonasCotizacion, logPersonasCotizacion } from "@/lib/personas/consulta";
import { codigoErrorContacto, datosContactoTarifario, logContactoTarifario, origenContactoTarifario } from "@/lib/crm/contactoTarifario";
import { leerEntradaModalidad } from "@/lib/cotizacion/netoHija";
import {
  compararTerminosVistos, construirPlanB2B, ETIQUETA_MODO_B2B, ETIQUETA_ORIGEN_PCT, leerAsistenciaB2BEntrada, type LineaB2B, type PlanB2BCotizacion,
} from "@/lib/cotizacion/asistidaB2B";
import { listarAliadosParaAsistencia, prepararAsistenciaB2B, type AliadoListado, type ContextoAsistenciaB2B } from "@/lib/cotizacion/asistidaB2BServidor";
import { resolverFirmasSesion } from "@/lib/cotizacion/firmasSesion";
import { descripcionCotizacionManual, leerManualesEntrada, lineaB2BManual, validarServicioManual, type ServicioManual } from "@/lib/cart/servicioManual";
import { camposClienteVenta, camposVendedorAliado, nombreQuienElabora, titularDeCliente } from "@/lib/cotizacion/identidadB2B";

// Forma que arma el CARRITO en el cliente (ver lib/cart/CartContext.tsx) —
// incluye `ninos`/`ninos2`/`infantes`/`pax`/`precio` para la vista previa en
// el navegador (carrito, resumen antes de enviar), pero NADA de esto se
// confía en el servidor: `crearSolicitudReserva` recibe el ítem como
// `unknown`, lo revalida con `validarSolicitudItem` (que ni siquiera lee
// estos 5 campos) y el precio/pax/ninos/ninos2/infantes reales SIEMPRE salen
// de `computarReserva` — nunca de lo que mande el navegador.
export type SolicitudItemPersona = {
  modeloTarifario?: undefined;
  // `id` del ítem en el carrito — SOLO para que un servicio vinculado
  // (`SolicitudTour.hotelItemId`) señale a este hotel; nunca autoriza ni calcula.
  itemId?: string;
  modulo: "bloqueo" | "porcion_terrestre" | "dinamico";
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  // Solo `dinamico` (obligatoria ahí): la salida elegida — ver `validarSolicitudItem`.
  salidaId?: number | null;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  regimen: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  habitaciones: Record<string, number>;
  ninos: number;
  ninos2: number;
  infantes: number;
  pax: number;
  precio: number;
  // Edad exacta de cada menor tal como se pidió en Vista Booking — ver
  // lib/reservar/edadesMenores.ts. Obligatoria en este flujo público
  // (`validarSolicitudItem` rechaza el ítem si falta): nunca cae al reparto
  // legado ninos/ninos2/infantes de arriba.
  edadesMenores?: number[];
};

// Ítem Bernalo del carrito (Fase 3F-1, `hoteles.modelo_tarifario = "unidad"`)
// — SOLO decisiones del usuario, mismo criterio que `HotelCartItemBernalo`
// (lib/cart/CartContext.tsx): nunca neto/bruto/comisión/snapshot/payload/
// costos/markup. `precio`/`moneda` son presentación, nunca autoridad —
// `validarSolicitudItemBernalo` (lib/reservar/solicitudAlojamientoBernalo.ts)
// ni siquiera los lee.
// `itemId` (cierre 3F-4A #1) es el `id` estable que el carrito ya asignó al
// ítem (`HotelCartItemBernalo.id`) — viaja SOLO para correlación: permite que
// un `precio_actualizado` señale exactamente cuál ítem cambió, incluso si el
// carrito tiene dos ítems del mismo paquete/hotel con ocupaciones distintas.
// Nunca se usa para autorizar ni para calcular nada.
export type SolicitudItemBernalo = {
  modeloTarifario: "unidad";
  itemId: string;
  paqueteId: number;
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: HabitacionOcupacionEntrada[];
  precio: number;
  moneda: string | null;
};

export type SolicitudItem = SolicitudItemPersona | SolicitudItemBernalo;

// Ítem YA validado (`validarSolicitudItem`) + los valores REALES que arrojó
// `computarReserva` para ese ítem — es lo único que se usa para el resumen
// visible al asesor/cliente (mensaje de WhatsApp/email, snapshot de la
// cotización). Nunca se construye a partir del `SolicitudItem` crudo del
// carrito.
type SolicitudItemComputado = SolicitudItemValidado & {
  ninos: number;
  ninos2: number;
  infantes: number;
  pax: number;
  precio: number;
  // Referencia ESTABLE del ítem, generada server-side a partir de su
  // posición ORIGINAL VALIDADA en `input.items` (nunca enviada por el
  // navegador) — ver el bucle en `crearCotizacionCarrito`. Sobrevive a
  // cualquier reagrupación posterior (`convertirCotizacionCarrito`, por
  // destino) y es la ÚNICA llave que `resolverCondicionesTarifaParaConversion`
  // (lib/calc/condicionesTarifa.ts) usa para encontrar el snapshot correcto
  // de CADA hotel — nunca posición dentro del grupo, nombre ni hotelId+categoría,
  // que pueden repetirse dentro del mismo carrito.
  ref: string;
};

// Ítem Bernalo YA re-liquidado con `computarReservaBernalo` — SOLO decisiones
// + PVP/moneda/pax autoritativos (regla C.12/13 de Fase 3F-4A). Deliberadamente
// SIN `resultado`/`snapshot` por habitación (netos, comisión, fuente,
// proveedor): eso vive en `ComputoReservaBernaloOk.habitaciones[].resultado/
// .snapshot` y NUNCA debe llegar a este objeto — lo único que se conserva de
// cada habitación es su ocupación de ENTRADA (`HabitacionOcupacionValidada`,
// ya sin dinero).
type SolicitudItemBernaloComputado = {
  modeloTarifario: "unidad";
  paqueteId: number;
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  alimentacion: string;
  salida: SalidaResueltaBernalo;
  habitaciones: HabitacionOcupacionValidada[];
  pax: number;
  precio: number;
  // Misma referencia estable que `SolicitudItemComputado.ref` (ver ahí) —
  // Bernalo la recibe por simetría/consistencia del snapshot, pero
  // `convertirCotizacionCarrito` NUNCA la usa para copiar condiciones de
  // tarifa Dubai a un ítem Bernalo (esa funcionalidad es exclusiva de
  // hoteles "persona" — Bernalo nunca pasa por `computarReserva`).
  ref: string;
};

// Tour/servicio agregado al carrito — entra a la MISMA cotización combinada
// que los hoteles del carrito (ver crearCotizacionCarrito), como una línea
// más de "Servicios adicionales". `servicioId`/`paqueteId` (ver
// lib/cart/CartContext.tsx → TourCartItem, siempre los trae desde que
// BuscadorReceptivos es el único lugar que arma este ítem) son la ÚNICA
// forma de re-liquidar el precio real en el servidor — `nombre`/`precio`/
// `moneda`/`destino` que manda el navegador NUNCA se usan para calcular ni
// para persistir: son solo lo que el cliente cree que agregó, y se
// descartan por completo en cuanto se re-liquida (ver `validarTourInput`).
export type SolicitudTour = {
  servicioId: number | null; paqueteId: number;
  // `itemId` del hotel al que pertenece (servicio elegido en su tarjeta);
  // ausente/null = tour independiente (Receptivos). Ver vinculoServiciosCheckout.ts.
  hotelItemId?: string | null;
  nombre: string; destino: string | null; fechaIda: string | null; fechaRegreso: string | null;
  pax: number; precio: number; moneda: string;
};

// Ítem YA re-liquidado en servidor (`liquidarServicioPuntual`, misma fórmula
// que `buscarReceptivos`) — lo único que se usa para mensaje/snapshot.
type SolicitudTourComputado = {
  servicioId: number; paqueteId: number;
  // `ref` del hotel al que pertenece (el MISMO `ref` server-side del ítem en
  // `payload.items[].ref`), o `null` si es un tour independiente. Lo genera
  // el servidor por posición validada — nunca el id de localStorage. Ausente
  // en cotizaciones anteriores (ver `vinculoTourCotizacion`).
  hotelRef: string | null;
  nombre: string; destino: string | null; descripcion: string | null;
  fechaIda: string; fechaRegreso: string; noches: number;
  pax: number; precio: number; moneda: string;
  categoria: CategoriaServicio;
};

// `tipoDoc` (#42, D-6): tipo de documento que elige quien llena el checkout; se lee de la entrada
// cruda (el validador compartido no lo conserva) y se guarda tal cual en `payload.cliente`.
export type SolicitudCliente = { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string; tipoDoc?: string };

// Datos de facturación (contrato neto): normalmente la agencia.
export type Facturacion = { nombre: string; nit: string; email: string; telefono: string };

export type ContextoB2B = {
  esB2B: boolean;
  tipo: "agencia" | "freelance" | null;
  agencia: Facturacion | null;
  pctComision: number; // fracción (0.10)
  categoria: string | null; // "Agencia Junior" / "Agencia Senior" / ...
  // Fallo de configuración del servidor al cargar la facturación de un aliado
  // ya verificado (falta la llave de servicio). Mensaje sin detalles internos;
  // `null` en cualquier otro caso. Con error no se muestran datos parciales.
  error?: string | null;
};

const ERROR_CONFIG_B2B = "No pudimos cargar los datos de facturación de tu agencia por un problema de configuración del servidor. Intenta más tarde o contacta a D'spacios Travel.";
const ERROR_LECTURA_B2B = "No pudimos cargar los datos de facturación de tu agencia en este momento. Intenta de nuevo en unos minutos; no se generó ninguna cotización.";

// Contexto del aliado logueado (para el checkout B2B): tipo, datos de
// facturación de la agencia y su % de comisión.
//
// FALLA CERRADO (ronda 4): esta función solo consulta — TODA la decisión
// (usuario activo, agencia titular activa y con rol B2B válido, comisión en
// rango) vive en `resolverContextoB2B` (lib/reservar/edadesMenores.ts,
// módulo puro, testeable con node --test sin tocar Supabase). Defecto real
// corregido: antes ni el usuario logueado ni la agencia titular se
// verificaban contra `usuarios.activo` — un aliado B2B desactivado por un
// administrador seguía viendo la sección B2B del checkout (facturación neta,
// % de comisión) hasta que expirara su sesión.
export async function getContextoB2B(): Promise<ContextoB2B> {
  const DEFAULT: ContextoB2B = { esB2B: false, tipo: null, agencia: null, pctComision: 0, categoria: null };
  const sb = await createClient();
  const { data: { user }, error: userErr } = await sb.auth.getUser();
  if (userErr || !user) return DEFAULT;

  const { data: perfil, error: perfilErr } = await sb
    .from("usuarios").select("nombre, email, rol, agencia_id, pct_comision, activo").eq("id", user.id).maybeSingle();
  if (perfilErr) return DEFAULT;

  // El default general de comisión (parámetro tributario) hace falta para
  // decidir la categoría (Junior/Senior) y como fallback si `pct_comision`
  // del usuario está vacío — se consulta con el rol crudo (si no es
  // "agencia"/"freelance", `comisionDefault` ya cae a un default razonable;
  // `resolverContextoB2B` de todas formas rechaza cualquier rol inválido).
  const def = await comisionDefault(sb, perfil?.rol ?? "");

  let agenciaTitular: { nombre: string | null; email: string | null; rol: string | null; pct_comision: number | null; activo: boolean | null } | null = null;
  let agenciaTitularErr = false;
  const agenciaId: string | null = perfil?.agencia_id ?? null;
  if (agenciaId) {
    const { data: ap, error: apErr } = await sb
      .from("usuarios").select("nombre, email, rol, pct_comision, activo").eq("id", agenciaId).maybeSingle();
    agenciaTitular = ap ?? null;
    agenciaTitularErr = !!apErr;
  }

  const base = {
    usuarioAutenticado: true,
    perfil: perfil ?? null, perfilError: !!perfilErr,
    agenciaId, agenciaTitular, agenciaTitularError: agenciaTitularErr,
    pctComisionDefault: def,
  };
  // Primero se verifica la identidad y la relación de agencia con las MISMAS
  // reglas de siempre (usuario activo, rol B2B, titular activa). Solo si es
  // B2B se leen sus datos de facturación.
  if (!resolverContextoB2B({ ...base, solicitud: null, solicitudError: false }).esB2B) return DEFAULT;

  // `b2b_solicitudes` solo la leen roles administrativos (RLS, migración
  // 193): con la sesión del aliado la consulta devolvía 0 filas sin error y
  // NIT/teléfono salían vacíos. Se lee con service-role, acotada a la cuenta
  // ya verificada: `agenciaUserId` sale de `auth.getUser()` y de su propia
  // fila `usuarios.agencia_id` — nunca de algo que mande el navegador — y
  // solo los 4 campos de facturación. La RLS no se abre.
  // Sin la llave de servicio NO se vuelve a la sesión (la RLS devolvería 0
  // filas y la facturación saldría vacía en silencio): fallo explícito.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[getContextoB2B] etapa=facturacion_b2b detalle=falta la llave de servicio en el entorno");
    return { ...DEFAULT, error: ERROR_CONFIG_B2B };
  }
  const agenciaUserId = agenciaId ?? user.id;
  // Un fallo de esta lectura NO convierte al aliado en B2C en silencio (sin
  // facturación ni modo neto): error público genérico — sin el detalle
  // técnico — y la solicitud se aborta antes de crear la cotización.
  let sols: { nombre: string | null; nit: string | null; email: string | null; telefono: string | null }[] | null = null;
  try {
    const { data, error: solsErr } = await createAdminClient()
      .from("b2b_solicitudes")
      .select("nombre, nit, email, telefono")
      .eq("usuario_id", agenciaUserId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (solsErr) {
      console.error(`[getContextoB2B] etapa=facturacion_b2b codigo=${solsErr.code ?? "desconocido"}`);
      return { ...DEFAULT, error: ERROR_LECTURA_B2B };
    }
    sols = data;
  } catch {
    console.error("[getContextoB2B] etapa=facturacion_b2b codigo=excepcion");
    return { ...DEFAULT, error: ERROR_LECTURA_B2B };
  }

  const r = resolverContextoB2B({ ...base, solicitud: sols?.[0] ?? null, solicitudError: false });
  if (!r.esB2B) return DEFAULT;
  return { esB2B: true, tipo: r.tipo, agencia: r.agencia, pctComision: r.pctComision, categoria: r.categoria };
}

// Portada actual por hotel (para resolver la foto de ítems del carrito que se
// guardaron sin fotoUrl). hotel_fotos es lectura pública.
export async function fotosPortada(hotelIds: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  if (!hotelIds.length) return out;
  const sb = await createClient();
  const { data } = await sb.from("hotel_fotos").select("hotel_id, url, es_portada, orden").in("hotel_id", hotelIds).order("orden");
  for (const f of data ?? []) {
    if (out[f.hotel_id] == null) out[f.hotel_id] = f.url;
    if (f.es_portada) out[f.hotel_id] = f.url;
  }
  return out;
}

// Fase 3F-4A, regla B.10: cuando el PVP/moneda AUTORITATIVOS de un ítem
// Bernalo ya no coinciden con lo que el carrito mostraba, el checkout NUNCA
// crea la cotización — devuelve este resultado estructurado en su lugar, con
// SOLO el nuevo PVP/moneda públicos (nunca netos/costos/comisión/snapshot).
// El cliente debe actualizar el ítem visible y reintentar — el reintento
// vuelve a pasar por el MISMO recálculo completo (regla B.11: "nunca acepta
// el precio solo porque coincide con el cliente" — no existe un modo
// "confía en esto", solo repetición de la misma verificación autoritativa).
export type ResultadoPrecioActualizadoBernalo = {
  ok: false;
  tipo: "precio_actualizado";
  // Cierre 3F-4A #1: identifica el ítem EXACTO del carrito (no
  // paqueteId+hotelId, que puede repetirse entre dos ítems con ocupaciones
  // distintas) — la UI actualiza este ítem y solo este.
  itemId: string;
  paqueteId: number;
  hotelId: number;
  pvp: number;
  moneda: string;
  mensaje: string;
};

export type SolicitudResult =
  // `b2bAsistido` (#102): términos B2B CONGELADOS en la cotización, solo cuando el personal interno la asistió para un aliado.
  // Los ve quien la generó (rol de la lista explícita); nunca viajan en un documento externo.
  | { ok: true; cotizacion: { id: number; codigo: string; url: string }; waUrl: string | null; mailtoUrl: string | null; mensaje: string; b2bAsistido?: PlanB2BCotizacion }
  | { ok: false; error: string }
  // #102: entre la vista previa y generar cambió el desglose B2B (precio, impuesto, base, %, comisión o total). No se creó nada; `terminos` es el desglose vigente.
  | ResultadoTerminosCambiaron
  | ResultadoPrecioActualizadoBernalo;
export type ResultadoTerminosCambiaron = { ok: false; tipo: "terminos_cambiaron"; error: string; terminos: TerminosB2BPrevios };

// ── Snapshot público de vuelo — compartido entre persona (bloqueo) y Bernalo
// (bloqueo/empaquetado, Fase 3F-4A cierre #3). `bloqueos_vuelo` y
// `empaquetados` tienen EXACTAMENTE las mismas columnas de vuelo (mismo
// select de siempre) — un solo constructor arma los 1-2 tramos (ida +
// regreso si aplica) con la MISMA forma pública que ya renderiza
// `ContratoDocumento`. Nunca expone tarifa/costo (esas columnas ni siquiera
// se seleccionan en `CAMPOS_VUELO_SNAP`).
const CAMPOS_VUELO_SNAP = "aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg";

type FilaVueloSnap = {
  aerolinea: string | null; record: string | null; ruta: string | null;
  fecha_ida: string | null; fecha_regreso: string | null;
  vuelo_ida: string | null; vuelo_regreso: string | null;
  hora_salida_ida: string | null; hora_llegada_ida: string | null;
  hora_salida_reg: string | null; hora_llegada_reg: string | null;
};

function construirTramosVueloSnap(bq: FilaVueloSnap): Record<string, unknown>[] {
  const r = parseRuta(bq.ruta);
  const tramos: Record<string, unknown>[] = [{
    aerolinea: bq.aerolinea, record: bq.record, direccion: "ida",
    origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen),
    destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
    numero_vuelo: bq.vuelo_ida, hora_salida: bq.hora_salida_ida, hora_llegada: bq.hora_llegada_ida,
    fecha_salida: bq.fecha_ida,
  }];
  if (bq.fecha_regreso || bq.vuelo_regreso) {
    tramos.push({
      aerolinea: bq.aerolinea, record: bq.record, direccion: "regreso",
      origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino),
      destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
      numero_vuelo: bq.vuelo_regreso, hora_salida: bq.hora_salida_reg, hora_llegada: bq.hora_llegada_reg,
      fecha_salida: bq.fecha_regreso,
    });
  }
  return tramos;
}

// Tramos del vuelo de una salida dinámica para el snapshot. Falla (con un motivo solo para el log) si falta la configuración
// de servicio, la consulta falla, la salida no existe o los tramos quedan incompletos (sin origen/destino IATA o sin fecha).
async function tramosVueloSalidaDinamica(
  salidaId: number | null
): Promise<{ ok: true; tramos: Record<string, unknown>[] } | { ok: false; motivo: string }> {
  if (!salidaId) return { ok: false, motivo: "sin_salida" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, motivo: "sin_service_role" };
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, motivo: "cliente_servicio" };
  }
  const { data: sd, error } = await admin
    .from("salidas_dinamicas")
    .select("aerolinea, ruta, fecha_ida, fecha_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg")
    .eq("id", salidaId).maybeSingle();
  if (error) return { ok: false, motivo: `consulta_${error.code ?? "error"}` };
  if (!sd) return { ok: false, motivo: "salida_inexistente" };
  const tramos = construirTramosVueloSnap({ ...sd, record: null, vuelo_ida: null, vuelo_regreso: null });
  const completos = tramos.length > 0 && tramos.every((t) => t.origen_codigo && t.destino_codigo && t.fecha_salida);
  return completos ? { ok: true, tramos } : { ok: false, motivo: "tramos_incompletos" };
}

function resumenHab(it: SolicitudItemComputado): string {
  const partes = Object.entries(it.habitaciones)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  if (it.infantes > 0) partes.push(`${it.infantes} Infante(s)`);
  return partes.join(", ");
}

// Bernalo no tiene conteo por acomodación (regla A.2: habitaciones FÍSICAS
// con adultos/edades propias, no columnas persona/nino/nino2/infante) — el
// resumen de texto solo cuenta habitaciones y menores, nunca inventa una
// clasificación que este modelo no tiene.
function resumenHabBernalo(it: SolicitudItemBernaloComputado): string {
  const totalMenores = it.habitaciones.reduce((s, h) => s + h.edadesMenores.length, 0);
  const partes = [`${it.habitaciones.length} habitación(es)`];
  if (totalMenores > 0) partes.push(`${totalMenores} menor(es)`);
  return partes.join(", ");
}

function construirMensaje(
  cliente: SolicitudCliente,
  cot: { codigo: string; url: string },
  items: SolicitudItemComputado[],
  tours: SolicitudTourComputado[],
  moneda: string,
  extra: string | null,
  b2b?: { modo: "comisionable" | "neta"; facturacion: Facturacion; pctComision: number },
  itemsBernalo: SolicitudItemBernaloComputado[] = [],
  manuales: ServicioManual[] = [],
): string {
  const L: string[] = [];
  L.push("Solicitud de reserva — D'spacios Travel");
  L.push("");
  if (b2b) L.push(`Modalidad: ${b2b.modo === "neta" ? "CONTRATO NETO" : "CONTRATO COMISIONABLE"}`);
  L.push(`${b2b?.modo === "neta" ? "Titular / pasajero" : "Cliente"}: ${`${cliente.nombres} ${cliente.apellidos}`.trim()}`);
  const contacto = [cliente.telefono, cliente.email].map((x) => x?.trim()).filter(Boolean).join(" · ");
  if (contacto) L.push(`Contacto: ${contacto}`);
  if (cliente.numeroDoc?.trim()) L.push(`Documento: ${cliente.numeroDoc.trim()}`);
  if (b2b?.modo === "neta" && b2b.facturacion.nombre) {
    L.push("");
    L.push(`Facturar a: ${b2b.facturacion.nombre}${b2b.facturacion.nit ? ` · NIT ${b2b.facturacion.nit}` : ""}`);
    const fc = [b2b.facturacion.telefono, b2b.facturacion.email].map((x) => x?.trim()).filter(Boolean).join(" · ");
    if (fc) L.push(`   ${fc}`);
  }
  L.push("");
  let total = 0;
  items.forEach((it, i) => {
    total += it.precio;
    L.push(`${i + 1}) ${it.hotelNombre}${it.destino ? ` — ${it.destino}` : ""}`);
    if (it.fechaIda) L.push(`   ${it.fechaIda} → ${it.fechaRegreso ?? ""}${it.noches ? ` (${it.noches} noches)` : ""}`);
    L.push(`   ${it.categoria} / ${it.regimen} · ${resumenHab(it)}`);
    L.push(`   ${it.pax} pax · Valor estimado: ${formatMoneda(it.precio, moneda)}`);
    L.push("");
  });
  itemsBernalo.forEach((it, i) => {
    total += it.precio;
    L.push(`${items.length + i + 1}) ${it.hotelNombre}${it.destino ? ` — ${it.destino}` : ""}`);
    L.push(`   ${it.salida.fechaIda} → ${it.salida.fechaRegreso}`);
    L.push(`   ${it.categoria} / ${it.alimentacion} · ${resumenHabBernalo(it)}`);
    L.push(`   ${it.pax} pax · Valor estimado: ${formatMoneda(it.precio, moneda)}`);
    L.push("");
  });
  if (tours.length) {
    L.push("Servicios / tours adicionales:");
    for (const t of tours) {
      L.push(`- ${t.nombre}${t.destino ? ` — ${t.destino}` : ""}`);
      if (t.fechaIda) L.push(`   ${t.fechaIda} → ${t.fechaRegreso ?? ""}`);
      L.push(`   ${t.pax} pax · Valor estimado: ${formatMoneda(t.precio, moneda)}`);
      total += t.precio;
    }
    L.push("");
  }
  if (manuales.length) {
    L.push("Servicios manuales (precio declarado por el asesor, sujetos a confirmación):");
    for (const m of manuales) {
      L.push(`- ${m.nombre}${m.clase === "vuelo" && m.origen && m.destino ? ` ${m.origen} → ${m.destino}` : ""}`);
      L.push(`   ${m.pax} pax · Valor estimado: ${formatMoneda(m.precio, moneda)}`);
      total += m.precio;
    }
    L.push("");
  }
  L.push(`Total (PVP): ${formatMoneda(total, moneda)}`);
  if (b2b?.modo === "neta") {
    const comision = Math.round(total * (b2b.pctComision || 0));
    L.push(`Comisión (${Math.round((b2b.pctComision || 0) * 100)}%): −${formatMoneda(comision, moneda)}`);
    L.push(`TOTAL NETO a pagar: ${formatMoneda(total - comision, moneda)}`);
  } else if (b2b?.modo === "comisionable") {
    const comision = Math.round(total * (b2b.pctComision || 0));
    L.push(`Comisión a liquidar (${Math.round((b2b.pctComision || 0) * 100)}%): ${formatMoneda(comision, moneda)}`);
  }
  L.push("");
  L.push(`Cotización: ${cot.codigo}`);
  if (cot.url) L.push(`Documento: ${cot.url}`);
  if (extra?.trim()) { L.push(""); L.push(extra.trim()); }
  return L.join("\n");
}

// Genera UNA sola cotización combinada para todo el carrito (hoteles + tours):
// re-liquida cada hotel con el motor autoritativo (computarReserva, mismo
// precio que usaría un contrato) y arma un solo snapshot {venta, hoteles,
// vuelos, items} — el mismo formato que ya renderiza ContratoDocumento, así
// que /cot/[token] y /cotizacion/[id] la muestran sin cambios. Si el carrito
// mezcla monedas (raro: un hotel/tour en USD junto a otros en COP), los ítems
// de la moneda minoritaria quedan FUERA de esta cotización (se listan en
// `excluidos` para avisar) — evita totales mezclando pesos y dólares.
// Un ítem excluido siempre trae SU motivo real — nunca se resume todo el
// arreglo bajo un solo texto genérico ("otra moneda") aunque la causa real
// haya sido que el servicio no estaba disponible (defecto real corregido,
// ronda 4: `notaExcluidos` en `crearSolicitudReserva` decía "por estar en
// otra moneda" para CUALQUIER exclusión, incl. tours simplemente no
// disponibles para esas fechas/pax).
// Referencia ESTABLE de un ítem de hotel dentro de la cotización (por su
// posición validada en la solicitud). La usan `payload.items[].ref`,
// `detalle.hoteles[].ref` y el `hotelRef` de los tours vinculados — una sola
// fórmula para que nunca diverjan.
const refItemCotizacion = (posicion: number) => `item-${posicion}`;

export type ItemExcluido = { etiqueta: string; motivo: "moneda" | "no_disponible" };

// #35 (comparativas): `capturar` entrega la FILA de `cotizaciones` que se iba a
// insertar y devuelve el éxito SIN insertar nada. Así cada opción de una
// comparativa se arma con EXACTAMENTE el mismo motor que una cotización de
// carrito común (mismos precios, mismas reglas), sin duplicar su cálculo.
// Sin `capturar` el comportamiento es el de siempre.
// #102: `b2b` = venta asistida ya AUTORIZADA en servidor (actor + aliado + modalidad, ver prepararAsistenciaB2B). Con él, los términos
// quedan congelados dentro de la cotización; sin él, la cotización es la B2C de siempre.
type OpcionesCarrito = { capturar?: (fila: Record<string, unknown>) => void; b2b?: ContextoAsistenciaB2B | null };

async function crearCotizacionCarrito(input: {
  items: SolicitudItemVariante[];
  tours: SolicitudTourValidado[];
  hotelDeTour: (number | null)[];
  cliente: SolicitudCliente;
  /** #64: servicios manuales (ya validados en la frontera; aquí se vuelve a exigir moneda). */
  manuales?: ServicioManual[];
}, opts?: OpcionesCarrito): Promise<
  | { ok: true; id: number; codigo: string; url: string; moneda: string; itemsOk: SolicitudItemComputado[]; itemsBernaloOk: SolicitudItemBernaloComputado[]; toursOk: SolicitudTourComputado[]; manualesOk: ServicioManual[]; excluidos: ItemExcluido[]; b2bPlan: PlanB2BCotizacion | null }
  | { ok: false; error: string }
  | ResultadoTerminosCambiaron
  | ResultadoPrecioActualizadoBernalo
> {
  const sb = await createClient();
  const clienteNombre = `${input.cliente.nombres} ${input.cliente.apellidos}`.trim();
  if (!clienteNombre) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const hoy = hoyBogota();
  const hotelesSnap: Record<string, unknown>[] = [];
  const vuelosSnap: Record<string, unknown>[] = [];
  const itemsSnap: Record<string, unknown>[] = [];
  // Detalle por habitación de los hoteles Bernalo del carrito — SOLO datos
  // no sensibles (mismo criterio que `habitacionesBernaloDeContrato`, la
  // función que lee esto ya convertido a contrato desde
  // `contrato_alojamiento_bernalo`): nunca neto/bruto/comisión/fuente. Antes
  // de convertir, esta cotización todavía no tiene filas en esa tabla —
  // este snapshot es la única forma de mostrar el mismo detalle por
  // habitación en el documento previo.
  const habitacionesBernaloSnap: Record<string, unknown>[] = [];
  const composicionBernaloSnap: ComposicionBernaloDocumento[] = [];
  const itemsOk: SolicitudItemComputado[] = [];
  const itemsBernaloOk: SolicitudItemBernaloComputado[] = [];
  const toursOk: SolicitudTourComputado[] = [];
  // Servicios INCLUIDOS de cada paquete de hotel del carrito — acumulados
  // acá para el resumen (asistencia/tours) y el snapshot que
  // `convertirCotizacionCarrito` reutiliza al crear la CxP del proveedor
  // real (nunca se vuelven a sumar al precio: ya vienen horneados en
  // `precioVenta` desde `computarReserva`).
  // Incluidos de los hoteles ACEPTADOS: en memoria (con costo) solo para el
  // resumen del documento; al payload va `incluidosPayload`, sin costos ni
  // proveedores (lo lee el rol `venta`) — ver lib/reservar/incluidosCotizados.ts.
  const incluidosSnap: ServicioEfectivo[] = [];
  const incluidosPayload: ServicioIncluidoCotizado[] = [];
  const claveHuella = claveHuellaIncluidos(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const excluidos: ItemExcluido[] = [];
  // #102: PVP e impuesto no comisionable (BNC) de CADA unidad aceptada, para congelar la venta B2B asistida. Se llena donde se hace
  // `total += …`, o sea solo con lo que realmente entra en la cotización (nunca con lo excluido por moneda o disponibilidad).
  // Claves: `item-N` = `ref` estable del ítem (igual a `payload.items[].ref`) y `tour-N` = posición en `payload.tours`.
  const lineasB2B: LineaB2B[] = [];
  let monedaPrincipal: string | null = null;
  let total = 0;
  let hIdx = 0, vIdx = 0, iIdx = 0;
  // Hoteles con servicios adicionales vinculados (posición en `input.items`):
  // ese conjunto se cotiza COMPLETO o la solicitud falla — nunca parcial. Lo
  // que el servidor resuelve para cada uno (fechas/pax/moneda) es contra lo
  // que se valida cada servicio, nunca contra lo que declaró el carrito.
  const hotelesConServicios = new Set(input.hotelDeTour.filter((h): h is number => h != null));
  const hotelesResueltos = new Map<number, HotelResueltoCheckout>();

  for (let posOriginal = 0; posOriginal < input.items.length; posOriginal++) {
    const it = input.items[posOriginal];
    // Referencia ESTABLE del ítem — deriva de su posición ORIGINAL VALIDADA
    // dentro de `input.items` (el arreglo ya validado por
    // `validarCrearSolicitudInput`/`validarSolicitudItem`, nunca algo que el
    // navegador declare como "mi id") — sobrevive intacta a cualquier
    // reordenamiento o agrupación posterior por destino en
    // `convertirCotizacionCarrito`. Se persiste en `payload.items[].ref` Y en
    // `detalle.hoteles[].ref` (ver más abajo), así ambas superficies pueden
    // correlacionarse sin ambigüedad aunque dos ítems compartan hotel/nombre.
    const ref = refItemCotizacion(posOriginal);
    // Fase 3F-4A: el ítem Bernalo se re-liquida DIRECTO con el servicio
    // interno autoritativo (`computarReservaBernalo`, Fase 3F-3) — el MISMO
    // que usa la cotización pública en vivo (`cotizarAlojamientoBernaloPublico`),
    // nunca una segunda implementación del cálculo (regla D.17). `computarReserva`
    // (persona) ni su guardia de Fase 3 se tocan para este ítem.
    if (it.modeloTarifario === "unidad") {
      const resultadoBernalo = await computarReservaBernalo({
        paqueteId: it.paqueteId,
        hotelId: it.hotelId,
        categoria: it.categoria,
        alimentacion: it.alimentacion,
        salida: it.salida,
        habitaciones: it.habitaciones,
      });
      if (!resultadoBernalo.ok) {
        // Regla D.18: tarifa/salida ya no vigente ⇒ bloquea, nunca crea
        // cotización — mismo criterio fail-closed que el resto del archivo
        // (ver `comp.ok` de persona más abajo).
        return { ok: false, error: `No se pudo cotizar ${it.hotelNombre}: ${resultadoBernalo.mensaje}` };
      }

      // Regla B.9/B.10/B.11: el resultado del SERVIDOR reemplaza cualquier
      // precio que haya mandado el navegador. Si el PVP/moneda autoritativos
      // ya no coinciden con lo que el carrito mostraba (`precioDeclarado`/
      // `monedaDeclarada` — Fase 3F-4A, `solicitudAlojamientoBernalo.ts`),
      // NUNCA se crea la cotización: se corta acá mismo y se devuelve el
      // nuevo precio público para que el cliente confirme de nuevo. No hay
      // un modo "confía en esto": el PRÓXIMO intento vuelve a pasar por este
      // mismo bloque y se recalcula de cero (regla B.11).
      if (resultadoBernalo.precioVenta !== it.precioDeclarado || resultadoBernalo.moneda !== it.monedaDeclarada) {
        return {
          ok: false,
          tipo: "precio_actualizado",
          // Cierre 3F-4A #1: `itemId` (el `id` del ítem del carrito, nunca
          // paqueteId+hotelId) para que la UI actualice EXACTAMENTE ese
          // ítem — dos ítems del mismo paquete/hotel con ocupaciones
          // distintas nunca se confunden entre sí.
          itemId: it.itemId,
          paqueteId: it.paqueteId,
          hotelId: it.hotelId,
          pvp: resultadoBernalo.precioVenta,
          moneda: resultadoBernalo.moneda,
          mensaje: `El precio de ${it.hotelNombre} cambió a ${formatMoneda(resultadoBernalo.precioVenta, resultadoBernalo.moneda)}. Confirma de nuevo para continuar.`,
        };
      }

      if (monedaPrincipal && resultadoBernalo.moneda !== monedaPrincipal) {
        if (hotelesConServicios.has(posOriginal)) {
          return { ok: false, error: errorHotelConServicios(resultadoBernalo.hotelNombre, `está en ${resultadoBernalo.moneda} y el resto del carrito en ${monedaPrincipal}`) };
        }
        excluidos.push({ etiqueta: `${it.hotelNombre} (moneda ${resultadoBernalo.moneda})`, motivo: "moneda" });
        continue;
      }
      monedaPrincipal = monedaPrincipal ?? resultadoBernalo.moneda;
      hotelesResueltos.set(posOriginal, {
        nombre: resultadoBernalo.hotelNombre, moneda: resultadoBernalo.moneda, pax: resultadoBernalo.paxTotal,
        fechaIda: resultadoBernalo.salida.fechaIda, fechaRegreso: resultadoBernalo.salida.fechaRegreso,
      });

      // Regla C.13: SOLO la ocupación de ENTRADA de cada habitación (nunca
      // `.resultado`/`.snapshot`, que traen netos/comisión/fuente/tarifa) —
      // ver `SolicitudItemBernaloComputado`.
      const habitacionesSnap = resultadoBernalo.habitaciones.map((h) => h.ocupacion);
      // Cierre 3F-4A #2: destino AUTORITATIVO (`resultadoBernalo.hotelDestino`,
      // resuelto server-side contra `armado_paquetes.destino_id -> destinos`
      // dentro de `computarReservaBernalo`) — NUNCA `it.destino` (texto libre
      // del carrito, sin validar contra nada real).
      const destinoAutoritativo = resultadoBernalo.hotelDestino;

      hIdx++;
      hotelesSnap.push({
        id: hIdx, ref, nombre: resultadoBernalo.hotelNombre, categoria: it.categoria, ciudad: destinoAutoritativo,
        proveedor: null, alimentacion: it.alimentacion, acomodacion: it.categoria,
        detalle_acomodacion: `${habitacionesSnap.length} habitación(es)`,
        fecha_ingreso: resultadoBernalo.salida.fechaIda, fecha_salida: resultadoBernalo.salida.fechaRegreso,
        nota_regimen: null, foto_url: null,
      });
      // Bernalo se cobra por unidad (pareja/habitación/apartamento/persona
      // según la tarifa capturada), así que el documento previo NO inventa
      // una tarifa adulto/niño dividiendo el PVP. La tabla per-cápita queda
      // para hoteles persona; Bernalo viaja como línea total + composición.
      iIdx++;
      itemsSnap.push({
        id: iIdx,
        descripcion: `${resultadoBernalo.hotelNombre}${destinoAutoritativo ? ` — ${destinoAutoritativo}` : ""} · ${it.categoria} / ${it.alimentacion} · ${habitacionesSnap.length} habitación(es), ${resultadoBernalo.paxTotal} viajero(s)`,
        adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0,
        modo_precio: "total", valor_total: resultadoBernalo.precioVenta,
      });
      resultadoBernalo.habitaciones.forEach((hComp, idx) => {
        const h = hComp.ocupacion;
        habitacionesBernaloSnap.push({
          habitacionId: h.id,
          orden: idx,
          hotelNombre: resultadoBernalo.hotelNombre,
          categoria: it.categoria,
          alimentacion: it.alimentacion,
          adultos: h.adultos,
          edadesMenores: h.edadesMenores,
        });
        for (const linea of hComp.resultado.desglose) {
          composicionBernaloSnap.push({
            habitacionId: h.id,
            orden: idx,
            hotelNombre: resultadoBernalo.hotelNombre,
            concepto: linea.concepto,
            cantidad: linea.cantidad,
            valorUnitario: linea.valorUnitario,
            valorTotal: linea.valorTotal,
            periodicidad: linea.periodicidad,
          });
        }
      });

      // Cierre 3F-4A #3: `vuelosSnap` público con la MISMA forma que persona
      // (`construirTramosVueloSnap`, arriba) — SOLO para bloqueo/empaquetado,
      // y SIEMPRE sobre `resultadoBernalo.salida` (la salida RESUELTA por el
      // servicio interno, confirmada perteneciente al paquete real — nunca
      // `it.salida`, que es la elección cruda del navegador). "sin_vuelo"
      // nunca genera un tramo — no hay vuelo que inventar.
      if (resultadoBernalo.salida.tipo === "bloqueo" || resultadoBernalo.salida.tipo === "empaquetado") {
        const tabla = resultadoBernalo.salida.tipo === "bloqueo" ? "bloqueos_vuelo" : "empaquetados";
        const { data: bq } = await sb
          .from(tabla)
          .select(CAMPOS_VUELO_SNAP)
          .eq("id", resultadoBernalo.salida.id)
          .maybeSingle();
        if (bq) {
          for (const tramo of construirTramosVueloSnap(bq)) { vIdx++; vuelosSnap.push({ id: vIdx, ...tramo }); }
        }
      }

      total += resultadoBernalo.precioVenta;
      lineasB2B.push({ clave: ref, pvp: resultadoBernalo.precioVenta, impuesto: 0 });
      itemsBernaloOk.push({
        modeloTarifario: "unidad", ref,
        paqueteId: it.paqueteId, hotelId: it.hotelId, hotelNombre: resultadoBernalo.hotelNombre, destino: destinoAutoritativo,
        categoria: it.categoria, alimentacion: it.alimentacion,
        salida: resultadoBernalo.salida, habitaciones: habitacionesSnap,
        pax: resultadoBernalo.paxTotal, precio: resultadoBernalo.precioVenta,
      });
      continue;
    }

    const reserva: ReservaInput = {
      paqueteId: it.paqueteId,
      bloqueoId: it.bloqueoId,
      // Dinámico: `computarReserva` valida la salida viva y toma de ELLA las fechas (nunca del navegador).
      salidaId: it.modulo === "dinamico" ? it.salidaId : undefined,
      modulo: it.modulo,
      hotelId: it.hotelId,
      fechaIda: it.modulo === "porcion_terrestre" ? (it.fechaIda ?? undefined) : undefined,
      fechaRegreso: it.modulo === "porcion_terrestre" ? (it.fechaRegreso ?? undefined) : undefined,
      categoria: it.categoria,
      regimen: it.regimen,
      habitaciones: it.habitaciones,
      // `it` ya pasó por `validarSolicitudItem`: `edadesMenores` SIEMPRE viene
      // presente (arreglo, posiblemente vacío) en este flujo público — nunca
      // `undefined`, así que `computarReserva` nunca cae al reparto legado
      // ninos/ninos2/infantes. Esos 3 quedan en 0: es la única fuente de
      // verdad la edad real, reclasificada por hotel más abajo.
      ninos: 0, ninos2: 0, infantes: 0,
      edadesMenores: it.edadesMenores,
      cantidadMenores: it.cantidadMenores,
      cliente: {
        nombres: input.cliente.nombres, apellidos: input.cliente.apellidos, tipoDoc: "CC",
        numeroDoc: input.cliente.numeroDoc, telefono: input.cliente.telefono, email: input.cliente.email,
      },
      tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
      aliadoId: null, plazo: "", pasajeros: [], servicios: [],
    };
    const comp = await computarReserva(sb, reserva);
    if (!comp.ok) return { ok: false, error: `No se pudo cotizar ${it.hotelNombre}: ${comp.error}` };
    const { meta, precioVenta, monedaReserva, lineasHab, numNinos, numNinos2, numInfantes, totalPax, edadesMenoresUsadas, serviciosIncluidos } = comp.data;
    const { lineasMenores } = menoresDelComputo(comp.data);
    if (monedaPrincipal && monedaReserva !== monedaPrincipal) {
      if (hotelesConServicios.has(posOriginal)) {
        return { ok: false, error: errorHotelConServicios(meta.hotel_nombre ?? it.hotelNombre, `está en ${monedaReserva} y el resto del carrito en ${monedaPrincipal}`) };
      }
      excluidos.push({ etiqueta: `${it.hotelNombre} (moneda ${monedaReserva})`, motivo: "moneda" });
      continue;
    }
    monedaPrincipal = monedaPrincipal ?? monedaReserva;
    hotelesResueltos.set(posOriginal, {
      nombre: meta.hotel_nombre ?? it.hotelNombre, moneda: monedaReserva, pax: totalPax,
      fechaIda: meta.fecha_ida, fechaRegreso: meta.fecha_regreso,
    });

    // Incluidos del paquete: SOLO de un hotel que entra en la cotización (ya
    // pasó la exclusión por moneda de arriba). Un hotel excluido no anuncia
    // su asistencia/traslado ni deja nada para una CxP al convertir. Al
    // payload: identidad + huella del costo, nunca el costo ni el proveedor.
    if (serviciosIncluidos.length) {
      if (!claveHuella) {
        console.error("[crearCotizacionCarrito] etapa=incluidos detalle=falta la llave de servicio en el entorno");
        return { ok: false, error: "No se pudo generar la cotización por un problema de configuración del servidor. Intenta más tarde." };
      }
      incluidosSnap.push(...serviciosIncluidos.map((s) => ({ ...s, proveedorId: null, paqueteId: it.paqueteId })));
      incluidosPayload.push(...incluidosParaPayload(serviciosIncluidos, { ref, paqueteId: it.paqueteId }, claveHuella));
    }

    // Las edades usadas para clasificar infante/Niño 1/Niño 2 SIEMPRE deben
    // salir de `comp.data` (única fuente autoritativa, ver
    // `resolverMenoresPorEdad` en computo.ts) — en este flujo público
    // `edadesMenores` es obligatorio en el ítem de entrada, así que
    // `computarReserva` siempre reclasifica por edad y siempre debería
    // devolver un arreglo. Si por algún motivo no lo hace, es una
    // inconsistencia interna del servidor — nunca se completa en silencio
    // con `it.edadesMenores` (defecto real corregido, ronda 4: ese fallback
    // podía dejar en el snapshot/cotización una edad que NO fue la que en
    // realidad se usó para calcular el precio).
    if (edadesMenoresUsadas == null) {
      return { ok: false, error: `No se pudo confirmar la edad de los menores cotizados para ${it.hotelNombre} (inconsistencia interna del servidor) — inténtalo de nuevo.` };
    }
    const edadesMenoresConfirmadas = [...edadesMenoresUsadas]; // copia — nunca la referencia de comp.data

    let fotoUrl: string | null = null;
    const { data: fotos } = await sb.from("hotel_fotos").select("url, es_portada, orden").eq("hotel_id", it.hotelId).order("orden");
    for (const f of fotos ?? []) { if (fotoUrl == null) fotoUrl = f.url; if (f.es_portada) fotoUrl = f.url; }

    // `construirHotelSnapPersona` (lib/reservar/hotelSnapPersona.ts) — función
    // PURA extraída de este mismo bloque, compartida con
    // pruebas/reservaOrquestadorE2E.test.ts, para que la prueba de ejecución
    // real de `computarReserva` nunca fabrique `condiciones_tarifa` a mano:
    // usa la MISMA función que produce este snapshot en producción.
    hIdx++;
    hotelesSnap.push(construirHotelSnapPersona({
      id: hIdx, ref, comp: comp.data, categoria: it.categoria, regimen: it.regimen,
      destinoFallback: it.destino, hotelNombreFallback: it.hotelNombre, fotoUrl, edadesMenoresConfirmadas,
    }));

    if (it.modulo === "bloqueo" && it.bloqueoId) {
      const { data: bq } = await sb
        .from("bloqueos_vuelo")
        .select(CAMPOS_VUELO_SNAP)
        .eq("id", it.bloqueoId).maybeSingle();
      if (bq) {
        for (const tramo of construirTramosVueloSnap(bq)) { vIdx++; vuelosSnap.push({ id: vIdx, ...tramo }); }
      }
    }
    // Vuelo por sistema de la salida dinámica (sin record ni tarifa) — OBLIGATORIO: es parte del paquete cotizado, así que
    // cualquier falla corta la solicitud ANTES de guardar (nunca una cotización sin vuelo). Service-role: `salidas_dinamicas`
    // es solo interna por RLS. Al navegador va un mensaje fijo; el detalle técnico solo al log del servidor.
    if (it.modulo === "dinamico") {
      const vuelo = await tramosVueloSalidaDinamica(it.salidaId ?? null);
      if (!vuelo.ok) {
        console.error(`[crearCotizacionCarrito] etapa=vuelo_salida_dinamica salida=${it.salidaId ?? "-"} motivo=${vuelo.motivo}`);
        return { ok: false, error: `No se pudo cotizar ${it.hotelNombre}: no fue posible confirmar el vuelo de la salida elegida. Intenta de nuevo o elige otra fecha.` };
      }
      for (const tramo of vuelo.tramos) { vIdx++; vuelosSnap.push({ id: vIdx, ...tramo }); }
    }

    // Regla (corrección de este hallazgo): la tabla de valores del documento
    // debe reflejar la MISMA composición por acomodación/menor que ya usa el
    // contrato ya convertido (`reservar/actions.ts`, líneas 1055-1067) — nunca
    // una única fila "adultos: 1" con `tarifa_adulto: precioVenta`, que
    // convertía todo el precio del hotel en la tarifa de una sola persona
    // (una doble de 2 adultos se veía como "Adultos 1 · $590.000" en vez de
    // "Adultos 2 · $295.000"). Cada fila sale de `comp.data`
    // (`lineasHab`/`pvpPorAcom`/`numNinos`/`numNinos2`/`numInfantes`) — nunca
    // de una cantidad u precio mandado por el navegador.
    const hotelEtiqueta = `${meta.hotel_nombre ?? it.hotelNombre}${meta.destino_nombre ?? it.destino ? ` — ${meta.destino_nombre ?? it.destino}` : ""}`;
    for (const l of lineasHab) {
      iIdx++;
      itemsSnap.push({
        id: iIdx,
        descripcion: `${hotelEtiqueta} · ${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${it.categoria} / ${it.regimen}`,
        adultos: l.pax, ninos: 0, tarifa_adulto: l.pvp, tarifa_nino: 0,
      });
    }
    // Menores (migración 226): una fila por clase de hotel Y por tarifa — un
    // menor de 2 años paga la tarifa de infante (fee de vuelo + servicios de
    // infante), uno de 2+ paga como adulto en vuelo y servicios. Las líneas
    // vienen de `comp.data.lineasMenores` (única fuente).
    for (const lm of lineasMenores) {
      iIdx++;
      itemsSnap.push({
        id: iIdx,
        descripcion: `${hotelEtiqueta} · ${descripcionLineaMenor(lm, it.categoria, it.regimen)}`,
        adultos: 0, ninos: lm.cantidad, tarifa_adulto: 0, tarifa_nino: lm.tarifa,
      });
    }

    // Hallazgo confirmado: las filas de arriba (habitaciones + Niño 1/2 +
    // Infante) NO agotan necesariamente `precioVenta` — un servicio INCLUIDO
    // del paquete con cobro por GRUPO (`cargoGrupoIncluido`, ver
    // lib/reservar/computo.ts) se suma a `precioVenta` sin pasar por
    // `lineasHab`/`pvpPorAcom`, porque su costo depende del tamaño real del
    // grupo. `cargoMascota`/`serviciosItems` (add-ons) son las OTRAS dos
    // fuentes que `computo.ts` puede sumar a `precioVenta` fuera de
    // habitaciones/menores — pero `reserva` (arriba) nunca envía
    // `mascotas`/`servicios`, así que ambas quedan estructuralmente en 0/[]
    // en este flujo público: la única fuente real de un residual positivo acá
    // es el servicio incluido por grupo. Nunca se reparte el residual sobre
    // `tarifa_adulto` ni se guarda en silencio una cotización cuyas filas
    // visibles sumen distinto de `precioVenta` (regla fail-closed, sin
    // tolerancias).
    const rResidual = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta,
      lineasHab,
      numNinos: 0, tarifaNino: null,
      numNinos2: 0, tarifaNino2: null,
      numInfantes: 0, tarifaInfante: null,
      lineasMenores,
    });
    if (!rResidual.ok) return { ok: false, error: `${it.hotelNombre}: ${rResidual.error}` };
    if (rResidual.residual > 0) {
      iIdx++;
      itemsSnap.push({
        id: iIdx,
        descripcion: `${hotelEtiqueta} · Servicios incluidos por grupo`,
        adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0,
        modo_precio: "total", valor_total: rResidual.residual,
      });
    }

    total += precioVenta;
    lineasB2B.push({ clave: ref, pvp: precioVenta, impuesto: comp.data.impuestoTotal });
    // Dinámico: las fechas guardadas son las de la salida que resolvió el servidor, no las que mandó el navegador.
    itemsOk.push({ ...it, ref, edadesMenores: edadesMenoresConfirmadas, ninos: numNinos, ninos2: numNinos2, infantes: numInfantes, pax: totalPax, precio: precioVenta,
      ...(it.modulo === "dinamico" ? { fechaIda: meta.fecha_ida ?? null, fechaRegreso: meta.fecha_regreso ?? null } : {}) });
  }

  for (let j = 0; j < input.tours.length; j++) {
    const t = input.tours[j];
    // Servicio vinculado a un hotel de esta solicitud: el hotel ya se resolvió
    // arriba (si no se pudo incluir, la solicitud ya falló). Se valida contra
    // lo que el SERVIDOR resolvió para ese hotel, antes de liquidar.
    const posHotel = input.hotelDeTour[j] ?? null;
    const hotelDelTour = posHotel != null ? hotelesResueltos.get(posHotel) : undefined;
    if (posHotel != null) {
      if (!hotelDelTour) return { ok: false, error: errorServicioVinculado(input.items[posHotel]?.hotelNombre ?? "el hotel", `#${t.servicioId}`, "no se pudo asociar a su hotel") };
      const incompatible = validarServicioContraHotel(t, hotelDelTour);
      if (incompatible) return { ok: false, error: errorServicioVinculado(hotelDelTour.nombre, `#${t.servicioId}`, incompatible) };
    }
    // Re-liquida EN VIVO con la misma fórmula de `buscarReceptivos` — nunca
    // se usa nombre/precio/moneda/destino que haya mandado el navegador
    // (esos ni siquiera llegan hasta acá: `validarTourInput` no los lee).
    //
    // FALLO CERRADO (ronda 4): `liquidarServicioPuntual` ahora distingue tres
    // motivos de fallo (ver lib/reservar/liquidacionServicio.ts). Solo
    // "no_disponible" es un motivo legítimo de negocio para EXCLUIR el tour
    // y seguir con el resto del carrito — un "error_consulta" (Supabase
    // falló técnicamente) o una "configuracion_invalida" (el catálogo tiene
    // un dato incompleto/incoherente) aborta la cotización COMPLETA: nunca
    // se genera una cotización parcial a partir de un fallo técnico, y nunca
    // se cobra un tour con un modo/margen inventado por no encontrar su
    // configuración real.
    //
    // FRONTERA PÚBLICA (ronda 6): `liquidarServicioPuntual` ya devuelve la
    // respuesta SANEADA (`resultado.mensaje`, nunca el detalle técnico real
    // de Supabase — ese queda solo en el log del servidor, ver cotizar.ts).
    // Este bloque NUNCA debe leer un campo que no sea `.tipo`/`.codigo`/`.mensaje`.
    const resultado = await liquidarServicioPuntual(t);
    if (!resultado.ok) {
      // Un servicio del conjunto de un hotel nunca se omite: el conjunto falla.
      if (hotelDelTour) {
        return { ok: false, error: errorServicioVinculado(hotelDelTour.nombre, `#${t.servicioId}`, `no se pudo cotizar (${resultado.mensaje})`) };
      }
      if (resultado.tipo === "no_disponible") {
        excluidos.push({ etiqueta: `Servicio #${t.servicioId} (${resultado.mensaje})`, motivo: "no_disponible" });
        continue;
      }
      return { ok: false, error: `No se pudo cotizar el servicio #${t.servicioId}: ${resultado.mensaje}` };
    }
    const tMoneda = resultado.resultado.moneda || "COP";
    if (hotelDelTour && tMoneda !== hotelDelTour.moneda) {
      return { ok: false, error: errorServicioVinculado(hotelDelTour.nombre, `«${resultado.resultado.nombre}»`, `está en ${tMoneda} y el hotel en ${hotelDelTour.moneda}`) };
    }
    if (monedaPrincipal && tMoneda !== monedaPrincipal) {
      excluidos.push({ etiqueta: `${resultado.resultado.nombre} (moneda ${tMoneda})`, motivo: "moneda" });
      continue;
    }
    monedaPrincipal = monedaPrincipal ?? tMoneda;
    iIdx++;
    itemsSnap.push({
      id: iIdx,
      descripcion: `Servicio · ${resultado.resultado.nombre}${resultado.resultado.destino ? ` — ${resultado.resultado.destino}` : ""}`,
      adultos: 1, ninos: 0, tarifa_adulto: resultado.resultado.total, tarifa_nino: 0,
    });
    total += resultado.resultado.total;
    lineasB2B.push({ clave: `tour-${toursOk.length}`, pvp: resultado.resultado.total, impuesto: 0 });
    toursOk.push({
      servicioId: resultado.resultado.servicioId, paqueteId: resultado.resultado.paqueteId,
      hotelRef: posHotel != null ? refItemCotizacion(posHotel) : null,
      nombre: resultado.resultado.nombre, destino: resultado.resultado.destino, descripcion: resultado.resultado.descripcion,
      fechaIda: t.fechaIda, fechaRegreso: t.fechaRegreso, noches: resultado.resultado.noches,
      pax: resultado.resultado.pax, precio: resultado.resultado.total, moneda: resultado.resultado.moneda,
      categoria: resultado.resultado.categoria,
    });
  }

  // #64: servicios manuales. Precio declarado por el asesor (único dato que se acepta tal cual y por eso solo personal interno, ver
  // crearSolicitudReserva). Nunca se excluyen en silencio: si su moneda no es la de la cotización, la solicitud falla. La cotización
  // NO guarda costo ni proveedor: se exigen al convertir.
  const manualesOk: ServicioManual[] = [];
  for (const m of input.manuales ?? []) {
    const r = validarServicioManual(m, monedaPrincipal);
    if (!r.ok) return { ok: false, error: `Servicio manual «${m.nombre}»: ${r.error}` };
    monedaPrincipal = monedaPrincipal ?? r.valor.moneda;
    iIdx++;
    itemsSnap.push({
      id: iIdx, descripcion: descripcionCotizacionManual(r.valor),
      adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, modo_precio: "total", valor_total: r.valor.precio,
    });
    total += r.valor.precio;
    lineasB2B.push(lineaB2BManual(r.valor, manualesOk.length)); // #102: la comisión sale de PVP − impuesto no comisionable del manual
    manualesOk.push(r.valor);
  }

  // Un servicio manual se SUMA a un carrito con hotel o servicio del tarifario; solo no sostiene una cotización (la conversión necesita al menos una unidad con pasajeros).
  if (!itemsOk.length && !itemsBernaloOk.length && !toursOk.length) {
    return { ok: false, error: manualesOk.length ? "Un servicio manual se agrega a un carrito que ya tenga un hotel o un servicio del tarifario. Agrega uno primero." : "No se pudo generar la cotización (revisa disponibilidad)." };
  }

  const totalHoteles = itemsOk.length + itemsBernaloOk.length;
  const moneda = monedaPrincipal ?? "COP";
  const destinos = [...new Set([...itemsOk.map((i) => i.destino), ...itemsBernaloOk.map((i) => i.destino)].filter((d): d is string => !!d))];
  if (!destinos.length) for (const m of manualesOk) if (m.destino && !destinos.includes(m.destino)) destinos.push(m.destino);
  const destinoTxt = destinos.length ? destinos.join(" · ") : null;
  const fechasIda = [...itemsOk.map((i) => i.fechaIda), ...itemsBernaloOk.map((i) => i.salida.fechaIda)].filter((f): f is string => !!f).sort();
  const fechasRegreso = [...itemsOk.map((i) => i.fechaRegreso), ...itemsBernaloOk.map((i) => i.salida.fechaRegreso)].filter((f): f is string => !!f).sort();
  const fechaIda = fechasIda[0] ?? null;
  const fechaRegreso = fechasRegreso.length ? fechasRegreso[fechasRegreso.length - 1] : null;
  const paxTotal = itemsOk.reduce((s, i) => s + (i.pax || 0), 0) + itemsBernaloOk.reduce((s, i) => s + (i.pax || 0), 0) || (toursOk[0]?.pax ?? manualesOk[0]?.pax ?? 0);
  const planNombre: string | null = totalHoteles > 1
    ? `${totalHoteles} hoteles`
    : (itemsOk[0] ? `${itemsOk[0].categoria} · ${itemsOk[0].regimen}` : (itemsBernaloOk[0] ? `${itemsBernaloOk[0].categoria} · ${itemsBernaloOk[0].alimentacion}` : null));

  // Resumen ÚNICO (asistencia/tours) de servicios INCLUIDOS + opcionales
  // realmente seleccionados — misma fuente que reservarDesdeTarifarioInterno/
  // crearCotizacion (lib/reservar/serviciosPaquete.ts), deduplicado por
  // servicioId. Nunca clasifica una asistencia como tour ni inventa
  // categoría para un servicio "otro".
  const serviciosEfectivosSnap: ServicioEfectivo[] = [
    ...incluidosSnap,
    // `proveedorId: null` a propósito: el proveedor NUNCA viaja por el
    // snapshot público del carrito — quien crea la CxP lo vuelve a resolver
    // server-side contra el catálogo (ver convertirCotizacionCarrito).
    ...toursOk.map((t): ServicioEfectivo => ({ servicioId: t.servicioId, nombre: t.nombre, categoria: t.categoria, incluido: false, costoNeto: 0, proveedorId: null })),
  ];
  const resumenServicios = resumirServiciosContrato(serviciosEfectivosSnap);

  // #102: venta B2B asistida. Los términos se calculan AQUÍ, con lo que el servidor liquidó (PVP e impuesto por unidad), el % vigente
  // del aliado y la modalidad elegida; se congelan dentro de la cotización y la conversión los compara contra lo vivo. Nada de esto
  // viene del navegador: de él solo llegó el id del aliado y la modalidad (ya autorizados en `prepararAsistenciaB2B`).
  let planB2B: PlanB2BCotizacion | null = null;
  if (opts?.b2b) {
    const r = construirPlanB2B({
      aliado: opts.b2b.aliado, pct: opts.b2b.aliado.pct, pctOrigen: opts.b2b.aliado.pctOrigen, modo: opts.b2b.modo, moneda, lineas: lineasB2B,
      identidad: { documento: opts.b2b.aliado.fiscal.documento, tipoDocumento: opts.b2b.aliado.fiscal.tipoDocumento },
      actor: { id: opts.b2b.actor.id, email: opts.b2b.actor.email, rol: opts.b2b.actor.rol }, congeladoEn: new Date().toISOString(),
    });
    if (!r.ok) return { ok: false, error: r.error };
    planB2B = r.plan;
    // El usuario confirmó UN desglose (vista previa): si lo que el servidor liquida ahora es distinto, no se crea nada y se devuelve el vigente para confirmar de nuevo.
    // El cálculo sigue siendo el del servidor; `vistos` solo se compara. (La vista previa misma corre en modo captura y no compara.)
    if (opts.b2b.vistos && !opts.capturar) {
      const cmp = compararTerminosVistos(opts.b2b.vistos, planB2B);
      if (!cmp.ok) return { ok: false, tipo: "terminos_cambiaron", error: cmp.error, terminos: terminosPrevios(planB2B) };
    }
  }

  // Preview #403: cliente comercial y firmas. En NETO el cliente es el ALIADO (identidad fiscal del catálogo, ya resuelta en servidor) y la persona queda
  // como «Titular de la reserva»; en PVP con comisión y B2C el cliente sigue siendo la persona. Quien elaboró sale del usuario autenticado y el vendedor
  // del aliado (cotizado o logueado): si el dato no existe (visitante anónimo) queda vacío y el documento muestra «—».
  const adminLookup = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
  const firmasSesion = await resolverFirmasSesion(sb, adminLookup);
  const elabora = nombreQuienElabora(opts?.b2b?.actor.nombre, firmasSesion.elabora);
  const campos = camposClienteVenta({ modo: planB2B?.modo_compra ?? null, fiscal: opts?.b2b?.aliado.fiscal ?? null, titular: titularDeCliente(input.cliente) });
  const vendedor = planB2B ? camposVendedorAliado({ nombre: planB2B.aliado_nombre, tipo: planB2B.tipo_asesor }) : camposVendedorAliado(firmasSesion.aliado);

  const ventaSnap: Record<string, unknown> = {
    numero_contrato: "", cliente: campos.cliente, cliente_documento: campos.cliente_documento,
    cliente_telefono: campos.cliente_telefono, cliente_direccion: campos.cliente_direccion,
    ...(campos.titular_nombre ? { titular_nombre: campos.titular_nombre, titular_documento: campos.titular_documento, titular_telefono: campos.titular_telefono, titular_email: campos.titular_email } : {}),
    asesor: elabora, asesor_firma_nombre: elabora, asesor_firma_cargo: elabora ? "Asesor/a" : null,
    ...(vendedor ?? {}),
    destino: destinoTxt, fecha_emision: hoy, fecha_salida: fechaIda, fecha_regreso: fechaRegreso,
    pax: paxTotal, estado: "pendiente",
    plan_nombre: planNombre,
    asistencia_medica: resumenServicios.asistenciaMedica,
    tours_traslados: resumenServicios.toursTraslados,
    moneda,
  };

  const detalle = {
    venta: ventaSnap, pasajeros: [], hoteles: hotelesSnap, vuelos: vuelosSnap, items: itemsSnap,
    habitacionesBernalo: habitacionesBernaloSnap,
    composicionBernalo: composicionBernaloSnap,
    // #102: lo ÚNICO de la venta B2B que puede ver el comprador en los documentos de la cotización (imprimible y enlace público): en NETO,
    // el total exigible. Se deriva del plan congelado (que vive en `payload`, nunca en un documento externo); el PVP original y la comisión
    // no salen de aquí. Quien convierte lee siempre `payload.b2bAsistido`, jamás este valor.
    ...(planB2B && planB2B.modo_compra === "neta" ? { b2bExterno: { netoTotalExigible: planB2B.total_exigible } } : {}),
  };

  const vigenciaRes = resolverVigenciaCotizacion({
    hoy,
    fechaSalida: fechaIda,
    diasPorDefecto: 1,
  });
  if (!vigenciaRes.ok) return { ok: false, error: vigenciaRes.error };
  const vigencia = vigenciaRes.vigencia;

  const { data: { user } } = await sb.auth.getUser();
  const admin = adminLookup;

  const filaCotizacion = {
    // Estampado FIJO en el servidor — nunca desde `input` (el cliente no
    // manda ni puede mandar un tenant): este checkout es el carrito público
    // del tarifario, que es un producto exclusivo de mayorista (minorista no
    // tiene tarifario/catálogo público — MINORISTA_OCULTAS en proxy.ts).
    tenant: "mayorista",
    tipo: "carrito",
    // Regla C.14: cada ítem Bernalo persistido lleva `modeloTarifario:
    // "unidad"` (ya presente en `SolicitudItemBernaloComputado`) para que
    // `convertirCotizacionCarrito` (3F-4B) lo detecte y bloquee la
    // conversión a contrato explícitamente, sin caer al flujo persona.
    payload: { items: [...itemsOk, ...itemsBernaloOk], tours: toursOk, ...(manualesOk.length ? { manuales: manualesOk } : {}), serviciosIncluidos: incluidosPayload, cliente: input.cliente, ...(planB2B ? { b2bAsistido: planB2B } : {}) } as unknown as Json,
    detalle: detalle as unknown as Json,
    cliente: campos.cliente,
    cliente_documento: campos.cliente_documento,
    destino: destinoTxt,
    hotel: totalHoteles === 1 ? (itemsOk[0]?.hotelNombre ?? itemsBernaloOk[0]?.hotelNombre ?? null) : (totalHoteles ? `${totalHoteles} hoteles` : null),
    modulo: "carrito",
    plan_nombre: planNombre,
    pax: paxTotal,
    precio_venta: total,
    moneda,
    fecha_salida: fechaIda,
    fecha_regreso: fechaRegreso,
    vigencia_hasta: vigencia,
    asesor: elabora,
    creado_por: user?.email ?? null,
  };
  // #35: una opción de comparativa solo necesita la fila calculada.
  if (opts?.capturar) {
    opts.capturar(filaCotizacion as unknown as Record<string, unknown>);
    return { ok: true, id: 0, codigo: "", url: "", moneda, itemsOk, itemsBernaloOk, toursOk, manualesOk, excluidos, b2bPlan: planB2B };
  }
  const { data: row, error } = await admin.from("cotizaciones").insert(filaCotizacion).select("id, codigo, share_token").single();
  // FRONTERA PÚBLICA (ronda 7): nunca se reenvía `error.message` — un fallo
  // real de Postgres/Supabase (columna faltante, RLS, restricción violada)
  // no debe llegar a esta Server Action pública. `respuestaPublicaInsertCotizacion`
  // (lib/reservar/edadesMenores.ts, función pura) decide el mensaje FIJO; el
  // detalle técnico real se registra ACÁ, server-side — nunca datos del
  // cliente (nombre/documento/teléfono/email) ni el payload de la cotización.
  // El `if (error || !row)` se conserva explícito (en vez de solo leer
  // `pubInsert.ok`) para que TypeScript siga estrechando `row` a no-nulo en
  // el resto de la función — `pubInsert` decide el MENSAJE, no el control de flujo.
  if (error || !row) {
    const detalle = error?.message ?? "insert no devolvió fila (row ausente)";
    console.error(formatearLogInsertCotizacion({ etapa: "insertar_cotizacion", detalle }));
    return respuestaPublicaInsertCotizacion(detalle);
  }

  // #42: titular en el registro de personas (solo titular: el carrito no trae pasajeros). Con
  // sesión interna o B2B se sella el autor; sin sesión la cotización es anónima y su captura,
  // provisional (D-6). El cliente público nunca ve este error: queda el aviso interno de la
  // ficha y un log sin datos personales.
  const actorPersonas = await actorComparativa();
  const alta = await altaPersonasCotizacion(admin, {
    fila: { id: row.id, tenant: "mayorista", tipo: "carrito", payload: filaCotizacion.payload, creado_por_id: null },
    usuarioId: actorPersonas.userId,
    sellar: true,
  });
  if (!alta.ok) console.error(logPersonasCotizacion("checkout", row.id, alta));

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";
  const url = origin && row.share_token ? `${origin}/cot/${row.share_token}` : "";

  return { ok: true, id: row.id, codigo: row.codigo, url, moneda, itemsOk, itemsBernaloOk, toursOk, manualesOk, excluidos, b2bPlan: planB2B };
}

// Genera UNA sola cotización combinada para todo el carrito y arma los
// enlaces wa.me + mailto hacia los destinatarios configurados. Público (sin
// login) — `inputRaw` se trata como `unknown`, ver `validarCrearSolicitudInput`.
export async function crearSolicitudReserva(inputRaw: unknown): Promise<SolicitudResult> {
  const v = validarCrearSolicitudInput(inputRaw);
  if (!v.ok) return { ok: false, error: v.error };
  const input = v.input;
  const tours = input.tours;
  const man = leerManualesEntrada(inputRaw);
  if (!man.ok) return { ok: false, error: man.error };
  if (!input.items.length && !tours.length && !man.manuales.length) return { ok: false, error: "El carrito está vacío." };
  // #64: el precio de un servicio manual lo declara el asesor (no sale de un catálogo): solo personal interno autorizado, nunca el público ni un aliado.
  if (man.manuales.length && !(await puedeAgregarServicioManual())) {
    return { ok: false, error: "Los servicios manuales solo los puede agregar el personal autorizado. Inicia sesión con tu usuario interno o quítalos del carrito." };
  }
  if (!`${input.cliente.nombres}${input.cliente.apellidos}`.trim()) return { ok: false, error: "Ingresa nombres y apellidos." };
  if (!input.cliente.numeroDoc.trim()) return { ok: false, error: "El documento es obligatorio." };
  if (!input.cliente.telefono.trim()) return { ok: false, error: "El teléfono / WhatsApp es obligatorio." };
  // #42 (D-6): tipo de documento elegido en el checkout, tal cual (nunca un "CC" por defecto).
  const tipoDoc = tipoDocCheckout(inputRaw, TIPOS_DOC_PERSONA);
  if (!tipoDoc.ok) return { ok: false, error: tipoDoc.error };
  const clienteCheckout: SolicitudCliente = tipoDoc.tipo ? { ...input.cliente, tipoDoc: tipoDoc.tipo } : input.cliente;

  // El contexto B2B se resuelve ANTES de crear la cotización: si la
  // facturación de un aliado no se puede cargar (configuración), la solicitud
  // falla sin dejar una cotización creada ni tratarlo como B2C en silencio.
  const ctxB2B = await getContextoB2B();
  if (ctxB2B.error) return { ok: false, error: ctxB2B.error };

  // #102: venta B2B ASISTIDA por personal interno. El navegador solo ELIGE (aliado + modalidad); quién asiste (sesión + rol de la lista
  // explícita + agencia Mayorista) y quién es el beneficiario (aliado activo del catálogo, con su tipo y su %) se resuelven aquí, ANTES
  // de crear la cotización. Una sesión de aliado B2B (o cualquier otra) que mande `asistencia` es rechazada: el aliado no se "asiste" a sí mismo.
  const asistencia = leerAsistenciaB2BEntrada(inputRaw);
  if (!asistencia.ok) return { ok: false, error: asistencia.error };
  let b2bAsistido: ContextoAsistenciaB2B | null = null;
  if (asistencia.asistencia) {
    const prep = await prepararAsistenciaB2B(await createClient(), asistencia.asistencia);
    if (!prep.ok) return { ok: false, error: prep.error };
    b2bAsistido = prep.contexto;
  }

  const cot = await crearCotizacionCarrito({ items: input.items, tours, hotelDeTour: input.hotelDeTour, cliente: clienteCheckout, manuales: man.manuales }, { b2b: b2bAsistido });
  if (!cot.ok) return cot;

  // Agrega el cliente a la base de contactos del CRM como B2C (cliente_final),
  // editable luego a B2B (agencia/freelance). Service-role: el checkout es público.
  // Efecto AUXILIAR (#40 E1): conserva el tipo elegido (NULL si no eligió, nunca "CC"), revisa el
  // `{error}`, no sobrescribe una colisión 23505 y registra solo el código; jamás bloquea la solicitud.
  try {
    const admin = createAdminClient();
    const datos = datosContactoTarifario(input.cliente, tipoDoc.tipo);
    if (datos) {
      const { error } = await admin.from("crm_contactos").insert({
        categoria: "cliente_final",
        ...datos,
        origen: origenContactoTarifario({ asistida: b2bAsistido !== null, aliadoAutenticado: ctxB2B.esB2B }),
        // Misma agencia FIJA que la cotización de este checkout (arriba): el
        // tarifario público es solo de mayorista. Service-role no tiene sesión,
        // así que sin esto el contacto quedaría sin atribuir.
        tenant: "mayorista",
      });
      // 23505 (ya existe) y éxito no registran nada; cualquier otro error, solo su código.
      const codigo = codigoErrorContacto(error);
      if (codigo) console.error(logContactoTarifario(codigo));
    }
  } catch {
    // Excepción (red, o falta la configuración del servidor): nunca se registra su mensaje.
    console.error(logContactoTarifario("excepcion"));
  }

  // Destinatarios configurados (service-role: el checkout es público/anónimo).
  let whatsapp: string | null = null, emails: string | null = null, mensajeExtra: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from("config_solicitudes").select("whatsapp, emails, mensaje_extra").eq("id", 1).maybeSingle();
    whatsapp = cfg?.whatsapp ?? null; emails = cfg?.emails ?? null; mensajeExtra = cfg?.mensaje_extra ?? null;
  } catch { /* ignore */ }

  // El contexto B2B se resuelve ENTERO desde la sesión autenticada + la base
  // de datos (`getContextoB2B()`, la misma fuente que ya usa el cliente para
  // decidir si mostrar la sección B2B) — nunca desde `input`. Un visitante
  // anónimo (o un usuario B2C autenticado) nunca puede autodeclararse B2B,
  // elegir modo neto ni inflar una comisión: `ctxB2B.esB2B` sale de
  // `usuarios.rol` vía `auth.getUser()`, y `pctComision`/`agencia` salen de
  // `usuarios.pct_comision`/`b2b_solicitudes` — ninguno es un valor que el
  // navegador pueda mandar. Corrige un defecto real: antes `pctComision`
  // llegaba tal cual del cliente (podía mandar `1` = 100%/"gratis").
  const b2b = resolverB2BParaMensaje(ctxB2B, input.modo);
  // Si algo del carrito quedó fuera de la cotización, se avisa igual en el
  // mensaje para no perderlo silenciosamente — pero cada motivo se reporta
  // por separado (nunca todos como "otra moneda": un tour excluido por no
  // estar disponible para esas fechas/pax es un motivo distinto, y decir lo
  // contrario sería falso — defecto real corregido, ronda 4).
  const excluidosPorMoneda = cot.excluidos.filter((e) => e.motivo === "moneda").map((e) => e.etiqueta);
  const excluidosNoDisponibles = cot.excluidos.filter((e) => e.motivo === "no_disponible").map((e) => e.etiqueta);
  const notasExcluidos: string[] = [];
  if (excluidosPorMoneda.length) {
    notasExcluidos.push(`Nota: quedaron fuera de esta cotización por estar en otra moneda — coordinar aparte: ${excluidosPorMoneda.join(", ")}.`);
  }
  if (excluidosNoDisponibles.length) {
    notasExcluidos.push(`Nota: no se pudieron incluir en esta cotización (ya no disponibles) — coordinar aparte: ${excluidosNoDisponibles.join(", ")}.`);
  }
  const notaExcluidos = notasExcluidos.length ? notasExcluidos.join("\n") : null;
  const notaB2BAsistida = cot.b2bPlan ? lineasMensajeB2BAsistido(cot.b2bPlan) : null;
  const extra = [mensajeExtra?.trim() || null, notaExcluidos, notaB2BAsistida].filter(Boolean).join("\n\n") || null;
  const mensaje = construirMensaje(input.cliente, { codigo: cot.codigo, url: cot.url }, cot.itemsOk, cot.toursOk, cot.moneda, extra, b2b, cot.itemsBernaloOk, cot.manualesOk);
  const wa = (whatsapp ?? "").replace(/\D/g, "");
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}` : null;
  const correos = (emails ?? "").split(",").map((e) => e.trim()).filter(Boolean).join(",");
  const mailtoUrl = correos
    ? `mailto:${correos}?subject=${encodeURIComponent("Solicitud de reserva — D'spacios Travel")}&body=${encodeURIComponent(mensaje)}`
    : null;

  return { ok: true, cotizacion: { id: cot.id, codigo: cot.codigo, url: cot.url }, waUrl, mailtoUrl, mensaje, ...(cot.b2bPlan ? { b2bAsistido: cot.b2bPlan } : {}) };
}

/** Términos de la venta B2B asistida tal como el servidor los liquida HOY (los mismos que se congelarán al generar). */
export type TerminosB2BPrevios = Pick<PlanB2BCotizacion, "aliado_nombre" | "tipo_asesor" | "modo_compra" | "moneda" | "pvp" | "impuesto" | "base" | "pct" | "pct_origen" | "comision" | "total_exigible">;
export type PrevisualizacionB2B = { ok: true; terminos: TerminosB2BPrevios } | { ok: false; error: string };

/**
 * Vista previa del desglose B2B ANTES de generar: corre el MISMO cálculo que `crearSolicitudReserva` (`crearCotizacionCarrito` en modo captura: reliquida el carrito en
 * el servidor, valida actor/aliado/modalidad y construye el plan), sin insertar nada ni tocar el CRM. No es una fórmula aparte: si no puede liquidarse devuelve el motivo.
 * Los datos de la persona no intervienen (se usa un titular provisional que nunca se guarda). Generar vuelve a validar y congelar.
 */
export async function previsualizarTerminosB2BAsistido(inputRaw: unknown): Promise<PrevisualizacionB2B> {
  const asistencia = leerAsistenciaB2BEntrada(inputRaw);
  if (!asistencia.ok) return { ok: false, error: asistencia.error };
  if (!asistencia.asistencia) return { ok: false, error: "Elige el aliado y la modalidad para ver el desglose." };
  const crudo = (typeof inputRaw === "object" && inputRaw !== null ? inputRaw : {}) as Record<string, unknown>;
  const v = validarCrearSolicitudInput({ ...crudo, cliente: { nombres: "Vista", apellidos: "previa", tipoDoc: "CC", numeroDoc: "0", telefono: "0", email: "" } });
  if (!v.ok) return { ok: false, error: v.error };
  const man = leerManualesEntrada(inputRaw);
  if (!man.ok) return { ok: false, error: man.error };
  if (!v.input.items.length && !v.input.tours.length && !man.manuales.length) return { ok: false, error: "El carrito está vacío." };
  const prep = await prepararAsistenciaB2B(await createClient(), asistencia.asistencia);
  if (!prep.ok) return { ok: false, error: prep.error };
  const cot = await crearCotizacionCarrito({ items: v.input.items, tours: v.input.tours, hotelDeTour: v.input.hotelDeTour, cliente: v.input.cliente, manuales: man.manuales }, { b2b: prep.contexto, capturar: () => {} });
  if (!cot.ok) return { ok: false, error: "error" in cot ? cot.error : "El precio de un hotel cambió; revisa el carrito y vuelve a intentar." };
  if (!cot.b2bPlan) return { ok: false, error: "No se pudo liquidar la venta B2B." };
  return { ok: true, terminos: terminosPrevios(cot.b2bPlan) };
}

function terminosPrevios(p: PlanB2BCotizacion): TerminosB2BPrevios {
  const { aliado_nombre, tipo_asesor, modo_compra, moneda, pvp, impuesto, base, pct, pct_origen, comision, total_exigible } = p;
  return { aliado_nombre, tipo_asesor, modo_compra, moneda, pvp, impuesto, base, pct, pct_origen, comision, total_exigible };
}

// Venta B2B asistida: aliado, modalidad y términos congelados, para el mensaje INTERNO que se envía a D'spacios (mismo destino y
// mismo criterio que el bloque de comisión del aliado logueado en `construirMensaje`).
function lineasMensajeB2BAsistido(p: PlanB2BCotizacion): string {
  const m = (n: number) => formatMoneda(n, p.moneda);
  const L = [
    `VENTA B2B ASISTIDA — ${p.aliado_nombre} (${p.tipo_asesor === "agencia" ? "agencia" : "freelance"})`,
    `Modalidad: ${ETIQUETA_MODO_B2B[p.modo_compra]}`,
    `PVP: ${m(p.pvp)} · Impuesto no comisionable: ${m(p.impuesto)} · Base comisionable: ${m(p.base)}`,
    `${ETIQUETA_ORIGEN_PCT[p.pct_origen]}: ${(p.pct * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} % · Comisión: ${m(p.comision)}`,
    p.modo_compra === "neta" ? `TOTAL EXIGIBLE (NETO: PVP − comisión): ${m(p.total_exigible)}` : `Total exigible (PVP): ${m(p.total_exigible)} · comisión pendiente de liquidar`,
  ];
  return L.join("\n");
}

// Contexto del checkout para el personal que puede asistir una venta B2B (#102): aliados activos con su % vigente. Quien no tiene
// permiso (visitante, aliado B2B, cliente, `control_vuelo`…) recibe `puede: false` y ninguna lista. Solo informativo: la autoridad
// se vuelve a evaluar al crear la cotización.
export type ContextoAsistenciaCheckout = { puede: false } | { puede: true; aliados: AliadoListado[] } | { puede: false; error: string };
/** #64: ¿la sesión actual es personal interno autorizado a vender (mismo criterio que la venta asistida)? */
async function puedeAgregarServicioManual(): Promise<boolean> {
  const r = await listarAliadosParaAsistencia(await createClient());
  return r.ok && r.puede;
}

export async function getContextoAsistenciaB2B(): Promise<ContextoAsistenciaCheckout> {
  const r = await listarAliadosParaAsistencia(await createClient());
  if (!r.ok) return { puede: false, error: r.error };
  return r.puede ? { puede: true, aliados: r.aliados } : { puede: false };
}

// ═════════════════════════════════════════════════════════════════════════
// #35 · COTIZACIONES COMPARATIVAS del tarifario (Vista Booking)
//
// Una comparativa sirve para ESCOGER UN hotel (hasta 3) del mismo viaje; nunca
// para comprar alternativas juntas. Cada opción = su hotel + sus servicios
// vinculados + sus acomodaciones; cada opción se arma con el MISMO motor que
// una cotización de carrito común (`crearCotizacionCarrito` con `capturar`).
//
//   crearComparativaCarrito   → madre (precio_venta NULL; no se cobra ni convierte)
//   elegirOpcionComparativa   → revalida y reliquida, emite un RECIBO de un solo
//                               uso y recién entonces crea la HIJA (cotización
//                               simple con solo la opción elegida)
//   solicitarOpcionComparativa→ visitante / B2B sobre comparativas que no
//                               continúan por checkout: solo registra una
//                               SOLICITUD; nada cobrable
//
// El `share_token` del enlace público solo LEE: nunca autoriza escribir. Quien
// escribe es siempre una acción validada en servidor (sesión, recibo, RPC).
// ═════════════════════════════════════════════════════════════════════════

export type ResultadoComparativaCreada =
  | { ok: true; id: number; codigo: string; url: string }
  | { ok: false; error: string };
export type ResultadoEleccion =
  | { ok: true; hijaId: number; codigo: string; url: string }
  | { ok: false; error: string; tipo?: "precio_actualizado"; pvp?: number; moneda?: string; reintentable?: boolean };
export type ResultadoSolicitud = { ok: true; actualizada: boolean } | { ok: false; error: string };

type ActorComparativa = { userId: string | null; canal: CanalEleccion; email: string | null; aliadoId: number | null; tipoB2B: "agencia" | "freelance" | null };

/** Identidad desde la SESIÓN auténtica (`auth.getUser()` valida el JWT); jamás desde el cuerpo de la petición. */
async function actorComparativa(): Promise<ActorComparativa> {
  const anonimo: ActorComparativa = { userId: null, canal: "publico", email: null, aliadoId: null, tipoB2B: null };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return anonimo;
  const { data: perfil } = await sb.from("usuarios").select("rol, activo, aliado_id").eq("id", user.id).maybeSingle();
  if (!perfil) return anonimo;
  const canal = canalDeRol(perfil.rol, perfil.activo);
  if (canal === "publico") return anonimo;
  return {
    userId: user.id, canal, email: user.email ?? null,
    aliadoId: canal === "b2b" ? (perfil.aliado_id ?? null) : null,
    tipoB2B: canal === "b2b" ? (perfil.rol === "agencia" ? "agencia" : "freelance") : null,
  };
}

function urlCotizacionPublica(h: Headers, token: string | null | undefined): string {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host && token ? `${proto}://${host}/cot/${token}` : "";
}

/** Pax que cubre cada acomodación del hotel (migración 027), con los valores por defecto del sistema. */
async function capacidadesAcomodacion(hotelId: number): Promise<CapacidadAcomodacion> {
  const caps: CapacidadAcomodacion = { ...PAX_TARIFA_DEFAULT };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return caps;
  const { data } = await createAdminClient().from("hotel_acomodaciones").select("acomodacion, pax_tarifa").eq("hotel_id", hotelId);
  for (const r of data ?? []) {
    if (typeof r.acomodacion === "string" && Number.isInteger(r.pax_tarifa) && (r.pax_tarifa as number) > 0) caps[r.acomodacion] = r.pax_tarifa as number;
  }
  return caps;
}

type FilaCapturada = Record<string, unknown> & {
  payload: { items?: Array<Record<string, unknown>>; tours?: Array<Record<string, unknown>> };
  detalle: unknown; moneda: string; precio_venta: number; pax: number; destino: string | null;
  fecha_salida: string | null; fecha_regreso: string | null; hotel: string | null; plan_nombre: string | null;
  cliente: string; cliente_documento: string | null;
};

/** Arma UNA opción (un hotel con una composición) con el motor real; no inserta nada. */
async function armarOpcionCarrito(
  item: SolicitudItemVariante, tours: SolicitudTourValidado[], cliente: SolicitudCliente
): Promise<{ ok: true; fila: FilaCapturada } | { ok: false; error: string }> {
  let fila: FilaCapturada | null = null;
  const r = await crearCotizacionCarrito(
    { items: [item], tours, hotelDeTour: tours.map(() => 0), cliente },
    { capturar: (f) => { fila = f as FilaCapturada; } }
  );
  if (!r.ok) return { ok: false, error: "error" in r ? r.error : "El precio cambió; vuelve a intentarlo." };
  if (r.excluidos.length) return { ok: false, error: `No se pudo cotizar el conjunto completo de ${item.hotelNombre}: ${r.excluidos.map((e) => e.etiqueta).join(", ")}.` };
  if (!fila) return { ok: false, error: "No se pudo armar la opción." };
  return { ok: true, fila };
}

export async function crearComparativaCarrito(inputRaw: unknown): Promise<ResultadoComparativaCreada> {
  const v = validarCrearSolicitudInput(inputRaw);
  if (!v.ok) return { ok: false, error: v.error };
  const input = v.input;

  if (input.items.length < 2 || input.items.length > MAX_OPCIONES) {
    return { ok: false, error: `Una comparativa necesita entre 2 y ${MAX_OPCIONES} hoteles.` };
  }
  if (input.items.some((i) => i.modeloTarifario === "unidad")) {
    return { ok: false, error: "Los hoteles por unidad (Bernalo) todavía no se pueden comparar." };
  }
  const items = input.items as Exclude<SolicitudItemVariante, { modeloTarifario: "unidad" }>[];
  if (items.some((i) => i.modulo === "bloqueo")) {
    return { ok: false, error: "Los paquetes con vuelo negociado todavía no se pueden comparar." };
  }
  if (items.some((i) => i.modulo === "dinamico")) {
    return { ok: false, error: "Los paquetes con salida de vuelo fija (dinámicos) todavía no se pueden comparar." };
  }
  if (input.hotelDeTour.some((h) => h == null)) {
    return { ok: false, error: "En una comparativa cada servicio debe estar vinculado a un hotel." };
  }
  // #42 (D-6): tipo de documento del checkout, tal cual; viaja en el payload de la madre y de cada opción.
  const tipoDoc = tipoDocCheckout(inputRaw, TIPOS_DOC_PERSONA);
  if (!tipoDoc.ok) return { ok: false, error: tipoDoc.error };
  const cli: SolicitudCliente = tipoDoc.tipo ? { ...input.cliente, tipoDoc: tipoDoc.tipo } : input.cliente;
  if (!`${cli.nombres}${cli.apellidos}`.trim()) return { ok: false, error: "Ingresa nombres y apellidos." };
  if (!cli.telefono.trim()) return { ok: false, error: "El teléfono / WhatsApp es obligatorio." };

  const actor = await actorComparativa();

  type OpcionArmada = { opcion_ref: OpcionRef; acomodacion_ref: string; fila: FilaCapturada; hotelPrecio: number };
  const armadas: OpcionArmada[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const toursDelHotel = input.tours.filter((_, j) => input.hotelDeTour[j] === i);
    const caps = await capacidadesAcomodacion(item.hotelId);
    const adultos = Object.entries(item.habitaciones).reduce((s, [a, n]) => s + n * (caps[a] ?? paxDeAcomodacion(a)), 0);
    const candidatas = composicionesUniformes(adultos, caps, {
      conMenores: (item.edadesMenores?.length ?? 0) > 0, composicionActual: item.habitaciones,
    });
    for (let k = 0; k < candidatas.length; k++) {
      const cand = candidatas[k];
      const r = await armarOpcionCarrito({ ...item, habitaciones: cand.habitaciones }, toursDelHotel, cli);
      if (!r.ok) {
        if (k === 0) return { ok: false, error: r.error }; // la composición del carrito siempre debe poder cotizarse
        continue; // una alternativa que el hotel no admite simplemente no se ofrece
      }
      const hotelPrecio = Number(r.fila.payload.items?.[0]?.precio) || 0;
      armadas.push({ opcion_ref: OPCIONES_REF[i], acomodacion_ref: cand.acomodacionRef, fila: r.fila, hotelPrecio });
    }
  }

  // Mismo viaje: destino, fechas, pasajeros y moneda iguales en TODAS las opciones.
  const ref = armadas[0].fila;
  const mismoViaje = armadas.every((o) =>
    o.fila.moneda === ref.moneda && o.fila.pax === ref.pax && o.fila.fecha_salida === ref.fecha_salida &&
    o.fila.fecha_regreso === ref.fecha_regreso && o.fila.destino === ref.destino);
  if (!mismoViaje) {
    return { ok: false, error: "Los hoteles de una comparativa deben tener el mismo destino, fechas, pasajeros y moneda." };
  }

  const vigenciaRes = resolverVigenciaCotizacion({ hoy: hoyBogota(), fechaSalida: ref.fecha_salida, diasPorDefecto: 3 });
  if (!vigenciaRes.ok) return { ok: false, error: vigenciaRes.error };

  const opciones: OpcionRpc[] = armadas.map((o, idx) => ({
    opcion_ref: o.opcion_ref,
    acomodacion_ref: o.acomodacion_ref,
    orden: idx,
    etiqueta: o.fila.hotel ?? `Hotel ${o.opcion_ref}`,
    moneda: o.fila.moneda,
    tarifa_persona: o.fila.pax > 0 && o.hotelPrecio > 0 ? Math.round(o.hotelPrecio / o.fila.pax) : null,
    total: o.fila.precio_venta,
    resumen_publico: {
      hotel: o.fila.hotel, plan_nombre: o.fila.plan_nombre, pax: o.fila.pax, moneda: o.fila.moneda,
      total: o.fila.precio_venta, total_hotel: o.hotelPrecio, acomodacion: o.acomodacion_ref,
      habitaciones: o.fila.payload.items?.[0]?.habitaciones ?? null,
      servicios: (o.fila.payload.tours ?? []).map((t) => ({ nombre: t.nombre, precio: t.precio })),
      fecha_salida: o.fila.fecha_salida, fecha_regreso: o.fila.fecha_regreso,
    },
    plantilla_hija: {
      hotel: o.fila.hotel, destino: o.fila.destino, plan_nombre: o.fila.plan_nombre, pax: o.fila.pax,
      cliente: o.fila.cliente, cliente_documento: o.fila.cliente_documento,
      fecha_salida: o.fila.fecha_salida, fecha_regreso: o.fila.fecha_regreso, payload: o.fila.payload, detalle: o.fila.detalle,
    },
  }));

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "No se pudo crear la comparativa por un problema de configuración del servidor." };
  const admin = createAdminClient();
  const nombre = `${cli.nombres} ${cli.apellidos}`.trim();
  const { data: id, error } = await admin.rpc("crear_cotizacion_comparativa", {
    p_usuario_id: actor.userId,
    p_cabecera: {
      tipo: "comparativa_carrito", moneda: ref.moneda, vigencia_hasta: vigenciaRes.vigencia,
      cliente: nombre, cliente_documento: cli.numeroDoc.trim() || null, destino: ref.destino, plan_nombre: "Cotización comparativa",
      pax: ref.pax, asesor: null, creado_por: actor.email, fecha_salida: ref.fecha_salida, fecha_regreso: ref.fecha_regreso,
      payload: { comparativa: true, tipoAsesor: actor.tipoB2B && actor.aliadoId ? actor.tipoB2B : "interno", cliente: cli },
      detalle: { comparativa: true, venta: { cliente: nombre, destino: ref.destino, fecha_salida: ref.fecha_salida, fecha_regreso: ref.fecha_regreso, pax: ref.pax, moneda: ref.moneda, estado: "cotizacion" } },
    } as unknown as Json,
    p_servicios: [] as unknown as Json,
    p_opciones: opciones as unknown as Json,
    p_aliado_id: actor.tipoB2B ? actor.aliadoId : null,
  });
  if (error || id == null) {
    console.error(formatearLogInsertCotizacion({ etapa: "crear_comparativa", detalle: error?.message ?? "sin id" }));
    return { ok: false, error: mensajeErrorComparativa(error?.message) };
  }
  const { data: fila } = await admin.from("cotizaciones")
    .select("id, codigo, share_token, tenant, tipo, payload, creado_por_id, propietario_id, aliado_id").eq("id", id).maybeSingle();
  // #42: titular de la MADRE en el registro de personas, sin escribir su payload (la 211 ya
  // estampó el autor si había sesión; sin sesión es anónima y su captura, provisional).
  const alta = fila
    ? await altaPersonasCotizacion(admin, { fila, usuarioId: actor.userId, sellar: false })
    : ({ ok: false, etapa: "registro", codigo: null } as const);
  if (!alta.ok) console.error(logPersonasCotizacion("comparativa_carrito", id, alta));
  return { ok: true, id, codigo: fila?.codigo ?? "", url: urlCotizacionPublica(await headers(), fila?.share_token) };
}

/** Reconstruye el carrito de UNA opción desde su plantilla guardada y lo reliquida con el motor real. */
async function reliquidarOpcionCarrito(
  plantilla: { payload?: { items?: Array<Record<string, unknown>>; tours?: Array<Record<string, unknown>> } },
  cliente: SolicitudCliente
): Promise<{ ok: true; fila: FilaCapturada } | { ok: false; error: string }> {
  const item = plantilla.payload?.items?.[0];
  if (!item || item.modeloTarifario === "unidad") return { ok: false, error: "No se pudo validar la opción." };
  const { ref: _r, ninos: _n, ninos2: _n2, infantes: _i, pax: _p, precio: _pr, ...entrada } = item;
  void _r; void _n; void _n2; void _i; void _p; void _pr;
  const tours: SolicitudTourValidado[] = (plantilla.payload?.tours ?? []).map((t) => ({
    servicioId: Number(t.servicioId), paqueteId: Number(t.paqueteId),
    fechaIda: String(t.fechaIda), fechaRegreso: String(t.fechaRegreso), pax: Number(t.pax),
  }));
  return armarOpcionCarrito(entrada as unknown as SolicitudItemVariante, tours, cliente);
}

export async function elegirOpcionComparativa(inputRaw: unknown): Promise<ResultadoEleccion> {
  const v = validarEntradaEleccion(inputRaw);
  if (!v.ok) return { ok: false, error: v.error };
  const d = v.datos;
  // #50: modalidad PVP/NETO de la hija B2B (solo personal interno, comparativa manual). Sin ella,
  // el comportamiento de siempre; la base decide permisos, aliado, margen y obligatoriedad.
  const mod = leerEntradaModalidad(inputRaw);
  if (!mod.ok) return { ok: false, error: mod.error };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "No se pudo completar la operación por un problema de configuración del servidor." };
  const admin = createAdminClient();
  const sb = await createClient();
  const actor = await actorComparativa();

  const { data: madre } = await admin.from("cotizaciones")
    .select("id, tipo, modo, estado, version, vigencia_hasta, moneda").eq("share_token", d.token).maybeSingle();
  // «No existe» y «no es tuya» responden igual: nunca se enumeran cotizaciones.
  if (!madre || madre.modo !== "comparativa" || madre.estado !== "abierta") return { ok: false, error: MENSAJES_COMPARATIVA.NO_DISPONIBLE };
  if (madre.version !== d.version) return { ok: false, error: MENSAJES_COMPARATIVA.VERSION, reintentable: true };

  const { data: opcion } = await admin.from("cotizacion_opciones")
    .select("total, moneda, plantilla_hija").eq("cotizacion_id", madre.id).eq("opcion_ref", d.opcionRef).eq("acomodacion_ref", d.acomodacionRef).maybeSingle();
  if (!opcion) return { ok: false, error: MENSAJES_COMPARATIVA.OPCION };

  const esCarrito = madre.tipo === "comparativa_carrito";
  // El origen manual no tiene checkout público: allí el visitante/B2B solo SOLICITA (otra acción).
  if (!esCarrito && actor.canal !== "interno") return { ok: false, error: "Esta comparativa se confirma con tu asesor: envía una solicitud." };
  if (mod.datos && (esCarrito || actor.canal !== "interno")) {
    return { ok: false, error: "La modalidad PVP/NETO solo la fija el personal interno en una comparativa manual." };
  }

  let datosCliente: Json | null = null;
  if (actor.canal === "publico") {
    const val = validarClienteCheckoutPublico(d.cliente);
    if (!val.ok) return { ok: false, error: val.error };
    datosCliente = { nombres: d.cliente!.nombres, apellidos: d.cliente!.apellidos, numeroDoc: d.cliente!.numeroDoc, telefono: d.cliente!.telefono, email: d.cliente!.email };
  }

  // Reliquidación EN VIVO con el motor real (precio y disponibilidad vigentes).
  let precio = Number(opcion.total);
  if (esCarrito) {
    const clienteMotor: SolicitudCliente = d.cliente
      ? { nombres: d.cliente.nombres, apellidos: d.cliente.apellidos, numeroDoc: d.cliente.numeroDoc, telefono: d.cliente.telefono, email: d.cliente.email }
      : { nombres: "Cliente", apellidos: "", numeroDoc: "", telefono: "", email: "" };
    const r = await reliquidarOpcionCarrito(opcion.plantilla_hija as { payload?: { items?: Array<Record<string, unknown>>; tours?: Array<Record<string, unknown>> } }, clienteMotor);
    if (!r.ok) return { ok: false, error: r.error };
    if (r.fila.moneda !== opcion.moneda) return { ok: false, error: MENSAJES_COMPARATIVA.PRECIO_CAMBIO, tipo: "precio_actualizado", reintentable: false };
    precio = Number(r.fila.precio_venta);
    if (Math.round(precio * 100) !== Math.round(Number(opcion.total) * 100)) {
      // La comparativa es inmutable: no se "confirma" un valor nuevo sobre ella. Se informa el valor vigente y se pide una nueva.
      return { ok: false, tipo: "precio_actualizado", pvp: precio, moneda: r.fila.moneda, reintentable: false,
        error: `El precio de esta opción cambió (ahora ${formatMoneda(precio, r.fila.moneda)}). Esta comparativa no se modifica: genera una comparativa nueva desde el tarifario.` };
    }
  }

  const paramsRecibo = {
    p_madre_id: madre.id, p_opcion_ref: d.opcionRef, p_acomodacion_ref: d.acomodacionRef, p_version: d.version,
    p_canal: actor.canal, p_actor_id: actor.userId, p_precio_reliquidado: precio, p_moneda: opcion.moneda,
    p_disponibilidad_ok: true, p_datos_cliente: datosCliente,
  };
  // #50: con modalidad, el recibo la lleva (RPC n50); sin ella, la de siempre.
  const recibo = mod.datos
    ? await admin.rpc("registrar_validacion_comparativa_n50", {
        ...paramsRecibo, p_modalidad: mod.datos.modalidad, p_reconoce: mod.datos.reconoceRecobro, p_autorizar: mod.datos.autorizarMargen,
      })
    : await admin.rpc("registrar_validacion_comparativa", paramsRecibo);
  if (recibo.error || !recibo.data) return { ok: false, error: mensajeErrorComparativa(recibo.error?.message), reintentable: esErrorReintentable(codigoErrorComparativa(recibo.error?.message)) };

  // Consumo del recibo: con sesión (identidad = auth.uid() en la base) o por checkout público.
  const consumo = actor.canal === "publico"
    ? await admin.rpc("elegir_opcion_comparativa_publica", { p_validacion: recibo.data, p_clave: d.clave })
    : await sb.rpc("elegir_opcion_comparativa_sesion", { p_validacion: recibo.data, p_clave: d.clave });
  if (consumo.error || consumo.data == null) {
    return { ok: false, error: mensajeErrorComparativa(consumo.error?.message), reintentable: esErrorReintentable(codigoErrorComparativa(consumo.error?.message)) };
  }
  const { data: hija } = await admin.from("cotizaciones")
    .select("id, codigo, share_token, tenant, tipo, payload, creado_por_id, propietario_id, aliado_id").eq("id", consumo.data).maybeSingle();
  // #42: titular de la HIJA con los datos que ella persistió. El relleno "Cliente" que usa el
  // motor para reliquidar no se persiste ni se registra (participantesDesdeCotizacion lo omite).
  const alta = hija
    ? await altaPersonasCotizacion(admin, { fila: hija, usuarioId: actor.userId, sellar: false })
    : ({ ok: false, etapa: "registro", codigo: null } as const);
  if (!alta.ok) console.error(logPersonasCotizacion("hija_checkout", consumo.data, alta));
  return { ok: true, hijaId: consumo.data, codigo: hija?.codigo ?? "", url: urlCotizacionPublica(await headers(), hija?.share_token) };
}

/** Visitante o B2B sobre una comparativa que no continúa por checkout: solo registra una SOLICITUD. */
export async function solicitarOpcionComparativa(inputRaw: unknown): Promise<ResultadoSolicitud> {
  const v = validarEntradaSolicitud(inputRaw);
  if (!v.ok) return { ok: false, error: v.error };
  const d = v.datos;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "No se pudo completar la operación por un problema de configuración del servidor." };
  const admin = createAdminClient();
  // La comparativa se localiza SOLO por el token de su enlace; un id adivinado no existe para esta acción.
  const { data: madre } = await admin.from("cotizaciones").select("id").eq("share_token", d.token).eq("modo", "comparativa").maybeSingle();
  if (!madre) return { ok: false, error: MENSAJES_COMPARATIVA.NO_DISPONIBLE };
  const h = await headers();
  // IP SOLO de cabeceras que fija la plataforma (nunca un x-forwarded-for del cliente).
  const ip = ipOrigenConfiable((n) => h.get(n), { enVercel: process.env.VERCEL === "1" });
  const { data, error } = await admin.rpc("registrar_solicitud_comparativa", {
    p_madre_id: madre.id, p_opcion_ref: d.opcionRef, p_acomodacion_ref: d.acomodacionRef, p_version: d.version,
    p_nombre: d.contacto.nombre, p_telefono: d.contacto.telefono || null, p_email: d.contacto.email || null,
    p_nota: d.contacto.nota || null, p_clave: d.clave, p_ip_huella: huellaIp(ip, process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
  if (error) return { ok: false, error: mensajeErrorComparativa(error.message) };
  const r = (data ?? {}) as { actualizada?: boolean };
  return { ok: true, actualizada: r.actualizada === true };
}

export type ResumenOpcionComparativa = {
  version: number; tipo: string; opcionRef: string; acomodacionRef: string; etiqueta: string;
  total: number; moneda: string; tarifaPersona: number | null; destino: string | null; fechaSalida: string | null;
  fechaRegreso: string | null; pax: number | null; vigenciaHasta: string | null; vencida: boolean;
};

/**
 * Resumen PÚBLICO (solo lectura) de UNA opción, para la pantalla «Continuar con
 * esta opción» del checkout. El `share_token` solo localiza la comparativa: nada
 * de lo que devuelve concede escritura. Sin netos, proveedores ni datos personales.
 */
export async function resumenOpcionComparativa(
  token: unknown, opcionRef: unknown, acomodacionRef: unknown
): Promise<{ ok: true; datos: ResumenOpcionComparativa } | { ok: false; error: string }> {
  const refs = validarRefsOpcion(opcionRef, acomodacionRef);
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token) || !refs) return { ok: false, error: MENSAJES_COMPARATIVA.NO_DISPONIBLE };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: MENSAJES_COMPARATIVA.NO_DISPONIBLE };
  const admin = createAdminClient();
  const { data: m } = await admin.from("cotizaciones")
    .select("id, tipo, modo, estado, version, vigencia_hasta, destino, fecha_salida, fecha_regreso, pax")
    .eq("share_token", token).maybeSingle();
  if (!m || m.modo !== "comparativa" || m.estado !== "abierta") return { ok: false, error: MENSAJES_COMPARATIVA.NO_DISPONIBLE };
  const { data: o } = await admin.from("cotizacion_opciones")
    .select("etiqueta, total, moneda, tarifa_persona")
    .eq("cotizacion_id", m.id).eq("opcion_ref", refs.opcionRef).eq("acomodacion_ref", refs.acomodacionRef).maybeSingle();
  if (!o) return { ok: false, error: MENSAJES_COMPARATIVA.OPCION };
  return {
    ok: true,
    datos: {
      version: m.version, tipo: m.tipo, opcionRef: refs.opcionRef, acomodacionRef: refs.acomodacionRef,
      etiqueta: o.etiqueta, total: Number(o.total), moneda: o.moneda, tarifaPersona: o.tarifa_persona == null ? null : Number(o.tarifa_persona),
      destino: m.destino, fechaSalida: m.fecha_salida, fechaRegreso: m.fecha_regreso, pax: m.pax,
      vigenciaHasta: m.vigencia_hasta, vencida: !!m.vigencia_hasta && m.vigencia_hasta < hoyBogota(),
    },
  };
}
