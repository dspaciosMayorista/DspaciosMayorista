"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio, noches, temporadaVigenteParaFecha, toTemporadaRango, factorLiquidacion, type TemporadaRango } from "@/lib/calc/paquetes";
import { ACOM_ROOM_LABEL, clasificarPorEdad, type AcomRoom } from "@/lib/acomodaciones";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { calcularEdad } from "@/lib/utils";
import {
  liquidarSeleccion,
  impuestoParaVenta,
  avisoResidualBaseB2B,
  evaluarPrecioConfirmado,
  type FuentePrecio,
  type CambioPrecioPrograma,
} from "@/lib/programas/precioReserva57";
import { postearAsientoCxP, eliminarAsientoCxP } from "@/lib/contabilidad/asientos";
import { contextoCotizacion, autorizaTenant } from "@/lib/cotizacion/acceso";
import { siguienteNumeroContrato } from "@/lib/contrato/numeracion";
import { contextoCrearContrato } from "@/lib/contrato/contexto";
import {
  generarFlujoId, crearMedidor, registrarEtapa, registrarErrorTecnico,
  crearEstadoFlujo, elevarEstadoFlujo, resultadoTotal,
  type Medidor, type ResultadoEtapa, type EstadoFlujo,
} from "@/lib/observabilidad/medicion";
import type { Tenant } from "@/lib/tenant";
import type { Json } from "@/types/database";
import {
  cotizarPorFechas as cotizarPorFechasImpl,
  buscarHoteles as buscarHotelesImpl,
  buscarReceptivos as buscarReceptivosImpl,
  type CotizarResult,
  type BusquedaResultado,
  type ResultadoServicio,
  type SugerenciaFecha,
} from "@/lib/reservar/cotizar";
import {
  computarReserva,
  type ReservaInput,
  type PasajeroReserva,
  type ComputoReserva,
} from "@/lib/reservar/computo";
import { resolverDatosVuelo, datosVueloBloqueo, datosVueloEmpaquetado, type DatosVueloOrigen } from "@/lib/reservar/empaquetadoOrigen";
import { resolverCondicionesTarifaParaConversion, type HotelSnapConRef } from "@/lib/calc/condicionesTarifa";
import { computarReservaBernalo, type ComputoReservaBernaloOk, type SalidaResueltaBernalo } from "@/lib/reservar/computoReservaBernalo";
import type { HabitacionOcupacionValidada } from "@/lib/reservar/ocupacionPorHabitacion";
import { asegurarCuentasPorPagar } from "@/lib/reservar/asegurarCuentasPorPagar";
import { mensajeErrorRpc } from "@/lib/vuelos/operaciones";
import {
  normalizarCategoriaServicio, resumirServiciosContrato, tipoProveedorCxpServicio,
  type ServicioEfectivo,
} from "@/lib/reservar/serviciosPaquete";
import {
  registrarFinancieroContrato, revertirContratoIncompleto,
  type CxPFinanciera, type CostosContrato,
} from "@/lib/reservar/financieroContrato";
import { esInfantePorEdad, pasajeroConsumeSilla } from "@/lib/reservar/pasajeros";
import { payloadGuardarPasajeros } from "@/lib/reservar/pasajerosEdicion";
import { normalizarResponsablesPorGrupo } from "@/lib/reservar/pasajerosFilas";
import { posicionesSinAsignar, posicionesUnicasDeGrupo, reindexarGrupoLocal, consolidarReservasSillasPorBloqueo, demandaSillasPorBloqueo, faltanteDeCupos, prevalidarResponsablesDeGrupo, mensajePrevalidacionGrupo, type ReservaSillasPorBloqueo } from "@/lib/reservar/carritoAsignaciones";
import { armarGruposConversion, resolverVinculosCotizacion, validarPasajerosServiciosVinculados } from "@/lib/reservar/vinculoServiciosCheckout";
import { calcularResidualServiciosIncluidosPorGrupo } from "@/lib/reservar/desglosePersonaCotizacion";
import { descripcionLineaMenor, ordenLineaMenor, menoresDelComputo } from "@/lib/reservar/menoresDeDos";
import { claveHuellaIncluidos, validarIncluidosConversion, type ServicioIncluidoGuardado } from "@/lib/reservar/incluidosCotizados";
import {
  componenteHotelReal,
  componentePaqueteReal,
  trmReferenciaAproximada,
  congelarCondicionesContratoBestEffort,
} from "@/lib/contrato/congelarCondicionesContrato";
import { componenteDePrograma } from "@/lib/cotizacion/condicionDesdeCatalogo";
import type { ComponenteSnapshot } from "@/lib/cotizacion/snapshotCondiciones";
import { cotizacionVencida, hoyBogota, MENSAJE_COTIZACION_VENCIDA, resolverVigenciaCotizacion } from "@/lib/cotizacion/vigencia";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { resolverAliadoReserva, planComisionReserva, registrarComisionReserva, type PlanComisionReserva } from "@/lib/reservar/comisionReserva";
import { asignarRefsPasajeros, AVISO_PERSONAS_PENDIENTES } from "@/lib/personas/cotizacion";
import { MODO_OFERTA_63, MENSAJE_OFERTA_CAMBIO_63, huellaOferta63 } from "@/lib/reservar/ofertaDinamica63";
import { camposCxP63, sumaEquivalentesOferta63 } from "@/lib/reservar/payloadFinanciero63";
import { equivalenteOferta63, validarObligacion63 } from "@/lib/reservar/importeObligacion63";
import {
  armarItems63, armarTramos63, construirSnapshot63, construirObligaciones63, construirPlanB2b63, detalleAcomodacion63, huellaFinanciera63,
  MENSAJE_EN_CURSO_63, MENSAJE_OFERTA_CERRADA_63, MENSAJE_TRM_PROVISIONAL_REQUERIDA_63, validarTrmProvisional63, type AceptacionPreparada63, type HotelSnapshot63, type PlanB2bSnapshot63,
} from "@/lib/reservar/aceptacion63";
import { aceptarOferta63, crearCotizacionOferta63, leerRevisiones63, ventaExiste63 } from "@/lib/reservar/aceptacionServidor63";
import { validarEleccionCobro } from "@/lib/finanzas/cobro";
import { decidirCxP, evaluarObligaciones, type Obligacion } from "@/lib/reservar/monedaObligacionesCarrito";
import { compararTrmCostoConCongelada, decidirTrmCosto, equivalenteCopCosto, leerTrmCostoCongelada } from "@/lib/finanzas/costoTrmCarrito";
import { costoAereoBloqueo, costoHotelPersona, costoTourParaCxP, costoVueloBernalo, liquidarCostoTour } from "@/lib/reservar/costosObligacionesCarrito";
import { cobroDeContratoCarrito, compararConCongelado, leerCobroCongelado, monedaOfertaDeCotizacion, resolverMonedaOferta, validarEleccionCarrito } from "@/lib/finanzas/cobroCarrito";
import { ROLES_INTERNOS } from "@/lib/constants";
import { altaPersonasCotizacion, logPersonasCotizacion } from "@/lib/personas/consulta";
import {
  compararLineasConCongeladas, leerPlanB2BDePayload, planDeGrupoB2B, verificarCoberturaLineasB2B, MENSAJE_COTIZACION_B2B_INVALIDA, MENSAJE_TERMINOS_CAMBIARON,
  type LineaB2B, type PlanB2BCotizacion,
} from "@/lib/cotizacion/asistidaB2B";
import { resolverActorAsistencia, verificarAliadoVivoParaConversion } from "@/lib/cotizacion/asistidaB2BServidor";
import { resolverFirmasSesion } from "@/lib/cotizacion/firmasSesion";
import { tipoDocumentoParaVenta } from "@/lib/personas/tiposDocumento";
import { camposClienteVenta, nombreQuienElabora, titularDeCliente, type FiscalAliado } from "@/lib/cotizacion/identidadB2B";

const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);

// Adaptador del cliente admin (service-role) a las dos funciones de la
// migración 171. `lib/reservar/financieroContrato.ts` recibe SOLO esta
// función, sin conocer Supabase: así su comportamiento de fallo —el que
// importa— se puede ejecutar de verdad en las pruebas. El despacho es
// explícito por nombre (no un `as never` genérico) para conservar el tipado
// de cada RPC.
async function rpcFinanciero(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  const admin = createAdminClient();
  if (fn === "registrar_financiero_contrato") {
    const { data, error } = await admin.rpc("registrar_financiero_contrato", {
      p_numero_contrato: String(args.p_numero_contrato ?? ""),
      p_tenant: String(args.p_tenant ?? ""),
      p_costos: (args.p_costos ?? {}) as Json,
      p_cxp: (args.p_cxp ?? []) as Json,
    });
    return { data: data as unknown, error: error ? { message: error.message } : null };
  }
  if (fn === "revertir_contrato_incompleto") {
    const { data, error } = await admin.rpc("revertir_contrato_incompleto", {
      p_numero_contrato: String(args.p_numero_contrato ?? ""),
      p_tenant: String(args.p_tenant ?? ""),
    });
    return { data: data as unknown, error: error ? { message: error.message } : null };
  }
  return { data: null, error: { message: `RPC no soportado: ${fn}` } };
}

// Persiste la INTENCIÓN de escritura financiera (migración 172) — su propio
// commit, independiente de si el RPC financiero que sigue después tiene
// éxito, falla o el proceso muere sin poder ni intentarlo. `upsert` (no
// `insert`) porque la reconciliación reintenta llamando a esta misma función
// con el MISMO numero_contrato — el propio RPC financiero borra la fila al
// tener éxito, pero un segundo intento antes de eso (o una carrera benigna)
// no debe fallar por clave duplicada.
async function guardarPendienteFinanciero(p: { numeroContrato: string; tenant: string; costos: CostosContrato; cxp: CxPFinanciera[] }): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("contrato_financiero_pendiente").upsert({
    numero_contrato: p.numeroContrato,
    tenant: p.tenant,
    costos: p.costos as Json,
    cxp: p.cxp as unknown as Json,
  }, { onConflict: "numero_contrato" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Dependencias completas de la escritura financiera (RPC + espejo contable + intención durable).
function depsFinanciero(numeroContrato: string, tenant: Tenant, fecha: string) {
  return {
    rpc: rpcFinanciero,
    // #63: el importe del asiento de una CxP del modo COP con TRM sale de su equivalente congelado
    // (`cuentas_por_pagar.valor_cop_63`), que resuelve `postearAsientoCxP` por id de cuenta.
    postearAsiento: (c: { id: number; tipo_proveedor: string | null; proveedor: string | null; servicio: string | null; valor_total: number }) =>
      postearAsientoCxP({
        cuentaId: c.id, numeroContrato, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
        servicio: c.servicio, valorTotal: c.valor_total, fecha, tenant,
      }),
    eliminarAsiento: (cuentaId: number) => eliminarAsientoCxP(cuentaId),
    guardarPendiente: guardarPendienteFinanciero,
  };
}

// Mensajes públicos FIJOS para fallos TÉCNICOS de reservarPrograma() (revisión
// posterior — ronda 3, mismo criterio que MSG_ERROR_VALIDACION_CONTRATO/
// MSG_ERROR_GUARDAR_CONTRATO en contratos/actions.ts): nunca se devuelve
// error.message/details/hint/code crudo de Supabase/Postgres al navegador —
// el detalle técnico se registra aparte, server-side, con el helper registrarErrorTecnico.
const MSG_ERROR_VALIDACION_PROGRAMA = "No fue posible verificar la información del programa. Intenta nuevamente o contacta a soporte.";
const MSG_ERROR_GUARDAR_RESERVA = "No fue posible guardar la reserva. Intenta nuevamente o contacta a soporte.";

// `input` es `unknown` a propósito (ronda 2) — misma razón que `buscarHoteles`
// abajo: toda la validación de forma vive en `cotizarPorFechasImpl`
// (lib/reservar/cotizar.ts → `validarEntradaCotizarPorFechas`), nunca se
// confía en el tipo declarado en tiempo de ejecución.
/** Cotiza un hotel para las fechas que elige el asesor (porción/dinámico). */
export async function cotizarPorFechas(input: unknown): Promise<CotizarResult> {
  return cotizarPorFechasImpl(input);
}

// `input` es `unknown` a propósito: esta Server Action es alcanzable desde el
// navegador (Vista Booking pública) con cualquier body HTTP — toda la
// validación de forma vive en `buscarHotelesImpl` (lib/reservar/cotizar.ts),
// nunca se confía en el tipo `BusquedaInput` en tiempo de ejecución.
export async function buscarHoteles(input: unknown): Promise<
  { ok: true; resultados: BusquedaResultado[]; diagnostico?: string; sugerenciasFecha?: SugerenciaFecha[] } | { ok: false; error: string }
> {
  return buscarHotelesImpl(input);
}

// `input` es `unknown` a propósito (ronda 5) — misma razón que `buscarHoteles`
// arriba: toda la validación de forma vive en `buscarReceptivosImpl`
// (lib/reservar/cotizar.ts), nunca se confía en el tipo `BusquedaServiciosInput`
// en tiempo de ejecución.
export async function buscarReceptivos(input: unknown): Promise<{ ok: true; resultados: ResultadoServicio[] } | { ok: false; error: string }> {
  return buscarReceptivosImpl(input);
}

// `advertencias`: fallas NO bloqueantes que sí se reportan honestamente al
// caller (nunca se tragan en silencio) — hoy solo las usa el guardado
// best-effort de nombres/apellidos/nacionalidad (migración 187): el
// contrato y sus sillas quedan completos y correctos de todas formas, pero
// si ese UPDATE posterior falla, la reserva SIGUE siendo un éxito (`ok:
// true`) y el detalle del error real de Supabase viaja aquí para que la UI
// lo muestre — nunca se asume éxito sin comprobar `{ error }`.
export type ReservaResult =
  | { ok: true; numero: string; advertencias?: string[] }
  | { ok: false; error: string };

// NO EXPORTADA a propósito (defecto reportado en la revisión de PR #267): una
// Server Action exportada es alcanzable por el navegador con CUALQUIER
// argumento serializable, así que un `tenant` en la firma pública permitía
// que el cliente lo eligiera. El único caller válido es `convertirCotizacion`
// (mismo archivo), que ya validó `cot.tenant` en el servidor antes de llamar
// — el tenant llega aquí siempre ya autorizado, nunca desde el navegador.
async function reservarDesdeTarifarioInterno(input: ReservaInput, tenant: Tenant): Promise<ReservaResult> {
  const sb = await createClient();

  // Fallas NO bloqueantes que SÍ se reportan (ver el comentario de
  // ReservaResult) — hoy solo las llena el guardado best-effort de
  // nombres/apellidos/nacionalidad, más abajo.
  const advertencias: string[] = [];

  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";

  // 1) Cálculo (precios, líneas, pax, impuesto) — fuente única compartida.
  const comp = await computarReserva(sb, input);
  if (!comp.ok) return { ok: false, error: comp.error };
  const { origen, meta, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, impuestoTotal, monedaReserva, cargoMascota } = comp.data;
  // Menores (migración 226): líneas de precio y menores de 2 años (fee de vuelo / precio de infante).
  const { lineasMenores, numMenoresDeDos } = menoresDelComputo(comp.data, { infantesDeclarados: Number(input.infantes) || 0 });
  // #63 — oferta en COP con TRM (salida vinculada a Empaquetados, o manual de un paquete en ese modo). Si la cotización
  // de origen traía una huella, lo que se va a cobrar tiene que ser EXACTAMENTE lo que el cliente vio: precio, vuelo,
  // fechas, TRM y tarifario publicado. Cualquier diferencia pide una cotización nueva (nunca se cobra en silencio).
  const oferta63 = comp.data.oferta63 ?? null;
  const huellaEsperada63 = input.oferta63?.huella ?? null;
  if (huellaEsperada63) {
    if (!oferta63 || huellaDeOferta63(input, comp.data) !== huellaEsperada63) return { ok: false, error: MENSAJE_OFERTA_CAMBIO_63 };
  }
  // #63 (E/F/G): una oferta en COP con TRM se ACEPTA de forma atómica (`aceptar_oferta_63`) contra el snapshot privado de SU
  // cotización antes de numerar o crear nada. `cotizacionId` lo pone solo `convertirCotizacion`.
  const cotizacionId63 = oferta63 ? Number(input.oferta63?.cotizacionId) : 0;
  if (oferta63 && !(cotizacionId63 > 0)) return { ok: false, error: "Una oferta con conversión por TRM solo se reserva desde su cotización." };
  // 234: TRM provisional INGRESADA al convertir (oferta en USD sin TRM). Se valida positiva ANTES de numerar nada; la base la congela al aceptar.
  const trmProv63 = oferta63 ? validarTrmProvisional63(input.oferta63?.trmProvisional) : ({ ok: true, trm: null } as const);
  if (!trmProv63.ok) return { ok: false, error: trmProv63.error };
  // 234: una oferta en USD SIN TRM de publicación se contrata solo con la TRM provisional INGRESADA (sin respaldo en trm_referencia): sin ella
  // no se llama a la aceptación ni se reserva número. La base lo vuelve a exigir (aceptar_oferta_63).
  if (oferta63 && oferta63.moneda === "USD" && oferta63.trm == null && trmProv63.trm == null) return { ok: false, error: MENSAJE_TRM_PROVISIONAL_REQUERIDA_63 };

  // 2c) Resolver y VALIDAR el origen completo del vuelo (bloqueo negociado,
  // empaquetado o salida dinámica) ANTES de crear nada — ni sillas, ni venta,
  // ni contrato_vuelos, ni CxP. `origen` ya viene discriminado y validado por
  // `resolverOrigenVuelo` (dentro de `computarReserva`): a lo sumo UNO de los
  // tres está presente. Si la lectura falla o el origen ya no existe/no está
  // vigente, la reserva se detiene aquí — nunca queda un contrato "a medias"
  // sin el vuelo/costo que le corresponde (revisión de PR #268, defecto 5).
  let datosVuelo: DatosVueloOrigen | null = null;
  if (origen.tipo !== "ninguno") {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      return { ok: false, error: "No se pudo resolver el origen del vuelo (configuración del servidor incompleta)." };
    const admin = createAdminClient();
    const rv = await resolverDatosVuelo(admin, origen);
    if (!rv.ok) return { ok: false, error: rv.error };
    datosVuelo = rv.data;
    // 230 (regla D8): un Empaquetado como origen NO mezcla monedas. Si su moneda no es la del tarifario/contrato, se rechaza
    // (el generador ya lo bloquea al publicar; esto cubre un cambio posterior de la moneda del vuelo).
    if (!oferta63 && origen.tipo === "empaquetado" && datosVuelo?.moneda && datosVuelo.moneda !== (monedaReserva === "USD" ? "USD" : "COP")) {
      return { ok: false, error: `El vuelo de Empaquetados está en ${datosVuelo.moneda} y este contrato está en ${monedaReserva}. Vuelve al tarifario: el paquete debe regenerarse con la moneda del vuelo.` };
    }
    // #63 / 230: el aéreo (salida MANUAL o vinculada a un Empaquetado) CONSERVA su moneda de origen (COP o USD): `datosVuelo`
    // queda en esa moneda y la CxP aérea se debe en ella con su equivalente en COP congelado a la TRM (valor_cop_63/trm_63).
    // `ventas.costo_aereo` es ese mismo costo expresado en la moneda de la oferta/contrato (ver `costoAereoOferta`).

    // Cupos: SOLO un Bloqueo negociado tiene sillas. Una salida (vinculada a Empaquetados o manual) y un
    // Empaquetado nunca consultan `cupos_por_bloqueo` (#63, confirmado por el dueño).
    if (origen.tipo === "bloqueo") {
      // Misma definición de silla libre que usa el RPC al tomar las sillas
      // (`_silla_libre`, migración 201): una silla con pasajero precargado sin
      // contrato no cuenta como cupo.
      const { data: cup, error: ce } = await admin
        .from("cupos_por_bloqueo")
        .select("cupos_disponibles")
        .eq("id", origen.id)
        .maybeSingle();
      if (ce) return { ok: false, error: `No se pudo validar los cupos del vuelo: ${ce.message}` };
      const disponibles = Number(cup?.cupos_disponibles) || 0;
      if (disponibles < paxConSilla) {
        return { ok: false, error: `No hay cupos suficientes en este vuelo (disponibles: ${disponibles}, requeridos: ${paxConSilla}).` };
      }
    }
  }
  // Menores de 2 años (migración 226): pagan SOLO el fee de infante del vuelo
  // (precio = costo, sin MK ni TA) y no ocupan silla. El conteo sale del
  // cómputo (por edad, o por conteo declarado en el flujo legado), no del
  // `input.infantes` crudo — en el flujo por edades ese campo no se usa.
  const infantesN = numMenoresDeDos;
  // Costo NETO real (lo que se le debe al proveedor) — nunca la reventa. Con
  // tarifa_proveedor=200.000/tarifa_para_empaquetar=242.022 (2 pax), usar la
  // reventa dejaba costo_aereo/CxP en $484.044 en vez de los $400.000 reales
  // (hallazgo de la revisión posterior al PR #268, punto 1 "COSTO FINANCIERO").
  const costoAereo = datosVuelo ? datosVuelo.costo_neto * paxConSilla + datosVuelo.fee_infante * infantesN : 0;
  // 230 + #90: en el modo de oferta con conversión por TRM el costo del contrato está en la moneda de la oferta (COP o USD) y es el costo
  // de ORIGEN del aéreo expresado en ella (misma moneda: exacto; si no, con la TRM); fuera de ese modo es el mismo número de siempre.
  const costoAereoOferta = oferta63 ? equivalenteOferta63(costoAereo, oferta63.monedaAereo, oferta63.moneda, oferta63.trm) : costoAereo;

  // 2d) Reserva B2B: el aliado es OBLIGATORIO y tiene que poder leerse ANTES
  // de numerar o crear nada (#38). Antes, sin `aliadoId` o con la lectura
  // fallida, el contrato nacía sin comisión y sin aviso.
  let aliadoB2B: number | null = null;
  let planB2B: PlanComisionReserva | null = null;
  // #63: el plan B2B VIVO (con el % de hoy) solo sirve para compararlo con el aceptado (huella financiera); el que se escribe en la
  // cabecera es SIEMPRE el congelado en el snapshot de la oferta. El aliado se lee con el mismo cliente que usó la cotización.
  let planVivo63: PlanB2bSnapshot63 | null = null;
  if (input.tipoAsesor !== "interno") {
    const lector63 = oferta63 && process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
    const al = lector63
      ? await resolverAliadoReserva(lector63, input.tipoAsesor, input.aliadoId)
      : await resolverAliadoReserva(sb, input.tipoAsesor, input.aliadoId);
    if (!al.ok) return { ok: false, error: al.error };
    const plan = planComisionReserva({ modoCompra: input.modoCompra, precioVenta, impuesto: impuestoTotal, pct: al.pct });
    if (!plan.ok) return { ok: false, error: plan.error };
    aliadoB2B = al.aliadoId;
    planB2B = plan.plan;
    if (oferta63) planVivo63 = construirPlanB2b63({ aliadoId: al.aliadoId, tipoAsesor: input.tipoAsesor, plan: plan.plan });
  }

  // 3) Número de contrato — ya completo (DTM-#### / MIN-00-####), tenant
  // recibido como parámetro ya validado por el caller (nunca del navegador).
  let aceptacion63: AceptacionPreparada63 | null = null;
  let numero: string;
  if (oferta63) {
    // #63 (E/F/G): ACEPTACIÓN ATÓMICA. Los costos y obligaciones se recalculan EN VIVO solo para COMPARAR con lo cotizado
    // (huella financiera): lo que se escribe después sale exclusivamente de lo que devuelve la aceptación.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "No se pudo crear la reserva (configuración del servidor incompleta)." };
    const { data: { user: actor63 } } = await sb.auth.getUser();
    if (!actor63) return { ok: false, error: "Sesión inválida: no se pudo confirmar el usuario para crear la reserva." };
    // 235 (#90 F): moneda de COBRO elegida de forma EXPRESA al convertir. Se valida ANTES de numerar nada: solo el personal interno puede cobrar en una
    // moneda distinta de la de la oferta, la TRM de cobro es obligatoria en ese caso y NUNCA se reutiliza la de publicación ni la de referencia.
    const { data: perfil63 } = await sb.from("usuarios").select("rol, activo").eq("id", actor63.id).maybeSingle();
    const esInterno63 = perfil63?.activo === true && ROLES_INTERNOS.includes(perfil63.rol as never);
    const cobro63 = validarEleccionCobro({ monedaOferta: oferta63.moneda, monedaCobro: input.oferta63?.monedaCobro, trmCobro: input.oferta63?.trmCobro, esInterno: esInterno63 });
    if (!cobro63.ok) return { ok: false, error: cobro63.error };
    const vivo63 = await calcularFinancieroReserva({ input, data: comp.data, datosVuelo, costoAereo, hoyISO: fechaNegocio() });
    if (!vivo63.ok) return { ok: false, error: vivo63.error };
    const huellaFin63 = huellaFinanciera63({ costos: vivo63.costosContrato, cxp: construirObligaciones63(vivo63.cxp, oferta63.trm), b2b: planVivo63 });
    const adminAcept = createAdminClient();
    const ac63 = await aceptarOferta63(adminAcept, {
      cotizacionId: cotizacionId63, tenant, usuarioId: actor63.id, huella: huellaDeOferta63(input, comp.data) ?? "", huellaFinanciera: huellaFin63,
      trmProvisional: trmProv63.trm,
      monedaCobro: cobro63.monedaCobro, trmCobro: cobro63.trmCobro,
    });
    if (!ac63.ok) return { ok: false, error: ac63.error };
    if (ac63.aceptacion.estado === "completa") {
      // Ya convertida: se reconoce como éxito SOLO si el contrato sigue existiendo (la oferta convertida es terminal).
      const existe63 = await ventaExiste63(adminAcept, ac63.aceptacion.numero_contrato);
      if (existe63.ok && existe63.existe) return { ok: true, numero: ac63.aceptacion.numero_contrato };
      return { ok: false, error: MENSAJE_OFERTA_CERRADA_63 };
    }
    if (ac63.aceptacion.estado === "materializando") {
      return { ok: false, error: `${MENSAJE_EN_CURSO_63} (contrato ${ac63.aceptacion.numero_contrato})` };
    }
    aceptacion63 = ac63.aceptacion;
    numero = aceptacion63.numero_contrato;
  } else {
    const numRes = await siguienteNumeroContrato(tenant);
    if (!numRes.ok) return { ok: false, error: numRes.error };
    numero = numRes.numero;
  }

  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  // Todo contrato lleva ASESOR INTERNO (quien firma/vende internamente y a quien
  // aplica la escala). La agencia/freelance se guarda aparte (canal B2B).
  const asesorNombre = input.asesorInterno;

  // 4-bis) Modo de compra B2B (neta vs comisionable).
  //   base comisionable = PVP − impuesto (BNC) · comisión = base × % del aliado.
  //   · neta         → el aliado paga PVP − comisión (se descuenta).
  //   · comisionable → paga el PVP; la comisión se liquida aparte.
  // El plan (paso 2d) es puro y es el MISMO que recalcula la base al crear la
  // fila de comisión: si no cuadran, la reserva se revierte.
  if (aceptacion63) {
    // #63: el plan B2B de la cabecera es el ACEPTADO (snapshot.b2b: aliado, %, modo, comisión, estado y precio final), no un
    // recálculo con el % de hoy. La base contrasta la cabecera contra este mismo valor; y `registrar_comision_b2b_reserva` recalcula
    // con el % vigente, así que un cambio POSTERIOR a la aceptación falla cerrado y la reserva se revierte completa.
    const b2b63 = aceptacion63.snapshot.b2b;
    if (b2b63 == null) {
      if (aliadoB2B != null) return { ok: false, error: MENSAJE_OFERTA_CAMBIO_63 };
      planB2B = null;
    } else {
      if (aliadoB2B == null || b2b63.aliado_id !== aliadoB2B || b2b63.tipo_asesor !== input.tipoAsesor) return { ok: false, error: MENSAJE_OFERTA_CAMBIO_63 };
      planB2B = { pct: b2b63.pct, base: b2b63.base, comision: b2b63.comision, modoCompra: b2b63.modo_compra, comisionEstado: b2b63.comision_estado, precioFinal: b2b63.precio_final };
    }
  }
  const precioFinal = planB2B ? planB2B.precioFinal : precioVenta;
  const comisionB2B: number | null = planB2B?.comision ?? null;
  const modoCompra: string | null = planB2B?.modoCompra ?? null;
  const comisionEstado: string | null = planB2B?.comisionEstado ?? null;
  let b2bUsuarioId: string | null = null;
  if (planB2B?.modoCompra) {
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
      if (perfil?.rol === "agencia" || perfil?.rol === "freelance") b2bUsuarioId = user.id;
    }
  }

  // 3-bis) El servidor tiene que poder escribir con service-role ANTES de
  // crear nada: los pasajeros/sillas (paso 5-bis) y, sobre todo, la escritura
  // financiera del contrato (costo + cuentas por pagar, paso 12) pasan por el
  // cliente admin. Sin la llave, este flujo antes insertaba la venta y recién
  // después devolvía error (paso 5-bis) o se saltaba en silencio el costo y
  // las CxP — las dos formas del mismo defecto: un contrato numerado, visible
  // en los listados, sin obligación con el proveedor. Chequearlo aquí, antes
  // del insert, es lo que hace imposible el "contrato fantasma".
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "No se pudo crear la reserva (configuración del servidor incompleta)." };
  }

  // #63: la cabecera de una oferta aceptada sale del snapshot (la base además la compara campo a campo al insertar).
  const cab: { destino: string | null; moneda: string; fecha_salida: string | null; fecha_regreso: string | null; pax: number; hotel: string | null; impuesto: number; costo_aereo: number | undefined; aerolinea: string | null; plan_nombre: string } = aceptacion63
    ? aceptacion63.snapshot.cabecera
    : {
        destino: meta.destino_nombre, moneda: monedaReserva, fecha_salida: meta.fecha_ida, fecha_regreso: meta.fecha_regreso,
        pax: totalPax || paxConSilla, hotel: esServicios ? null : meta.hotel_nombre, impuesto: impuestoTotal,
        costo_aereo: datosVuelo ? costoAereoOferta : undefined, aerolinea: datosVuelo?.aerolinea ?? null, plan_nombre: `${input.categoria} · ${input.regimen}`,
      };
  // 4) Venta (cabecera) — nace PENDIENTE
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    // Conserva EXACTAMENTE el tenant de la cotización de origen — ya validado
    // por el único caller (`convertirCotizacion`) antes de llegar aquí.
    tenant,
    cliente: `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim(),
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_tipo_documento: tipoDocumentoParaVenta(input.cliente.tipoDoc, input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_email: oNull(input.cliente.email),
    destino: cab.destino,
    tipo_paquete: input.modulo,
    moneda: cab.moneda,
    fecha_salida: cab.fecha_salida,
    fecha_regreso: cab.fecha_regreso,
    pax: cab.pax,
    hotel: cab.hotel,
    precio_venta: precioFinal,
    impuesto: cab.impuesto,
    // Costo aéreo/aerolínea del origen ya resuelto y validado en el paso 2c
    // (nunca de una consulta posterior que pueda fallar en silencio).
    costo_aereo: cab.costo_aereo,
    aerolinea: cab.aerolinea,
    estado: "pendiente",
    // Migración 172: nace con la escritura financiera EN CURSO — solo pasa a
    // 'completo' dentro de registrar_financiero_contrato, atómicamente con
    // sus costos/CxP. Detectable/recuperable por reconciliacionFinanciera.ts
    // aunque el proceso muera antes de llegar al paso 12.
    financiero_estado: "pendiente",
    canal,
    tipo_asesor: input.tipoAsesor,
    modo_compra: modoCompra,
    comision_b2b: comisionB2B,
    comision_estado: comisionEstado,
    b2b_usuario_id: b2bUsuarioId,
    agencia_nombre: oNull(input.agenciaNombre),
    agencia_asesor: oNull(input.agenciaAsesor),
    freelance_nombre: oNull(input.freelanceNombre),
    // Vínculo FUERTE con el catálogo de aliados (migración 143): el portal B2B
    // resuelve la pertenencia por este id, no por el nombre en texto libre.
    // (`reservarPrograma` no lo lleva: su formulario no elige del catálogo,
    // así que esos contratos siguen dependiendo del respaldo por nombre.)
    aliado_id: aliadoB2B,
    plazo: oNull(input.plazo),
    paquete_armado_id: input.paqueteId,
    // Trazabilidad del origen — se toma del `origen` YA VALIDADO (nunca de
    // `input.bloqueoId`/`input.empaquetadoId` directos), así que los dos son
    // estructuralmente excluyentes: si `origen.tipo` es "empaquetado",
    // `bloqueo_ref_id` queda null y viceversa (defecto 4 de la revisión).
    bloqueo_ref_id: origen.tipo === "bloqueo" ? origen.id : null,
    empaquetado_ref_id: origen.tipo === "empaquetado" ? origen.id : null,
    asesor_firma_nombre: oNull(asesorNombre),
    asesor: oNull(input.asesorInterno),
    plan_nombre: cab.plan_nombre,
    aceptacion_63_id: aceptacion63?.aceptacion_id ?? null,
    // 235: moneda de cobro CONGELADA con el intento (NULL = aceptación anterior a la 235 o fuera del modo #63: se cobra en la moneda de la oferta).
    // La base compara estas tres columnas contra lo aceptado y las vuelve inmutables.
    moneda_cobro: aceptacion63?.cobro?.moneda ?? null,
    trm_cobro: aceptacion63?.cobro?.trm ?? null,
    total_cobro: aceptacion63?.cobro?.total ?? null,
  });
  // #63: la guarda de la cabecera (p63_cabecera) habla de intentos y snapshots; el navegador recibe un mensaje de negocio.
  if (ve) return { ok: false, error: aceptacion63 && /p63_cabecera/.test(ve.message) ? MENSAJE_EN_CURSO_63 : ve.message };

  // A partir de aquí el contrato YA existe: ninguna salida por error puede
  // limitarse a `return { ok: false }`, porque dejaría un contrato fantasma
  // (numerado, en los listados, sin pasajeros ni costo). `fallarYRevertir`
  // borra el contrato y sus hijas y libera las sillas
  // (`revertir_contrato_incompleto`, migración 171); si la reversión misma
  // falla, el mensaje lo dice con el número del contrato — nunca se calla.
  const fallarYRevertir = async (motivo: string): Promise<ReservaResult> => {
    const rev = await revertirContratoIncompleto({ rpc: rpcFinanciero }, numero, tenant);
    if (rev.ok) return { ok: false, error: motivo };
    return {
      ok: false,
      error: `${motivo} · Además, el contrato ${numero} quedó creado a medias y no se pudo deshacer automáticamente (${rev.error ?? "motivo desconocido"}): revísalo antes de volver a reservar.`,
    };
  };

  // Comisión B2B (#38): la crea la base (`registrar_comision_b2b_reserva`,
  // migración 205), que valida usuario, rol, tenant, aliado y venta, recalcula
  // el importe con la misma regla del plan y se niega a duplicar. Con el
  // cliente de la sesión — nada de service-role. Si falla, la reserva se
  // revierte completa: nunca queda un contrato B2B sin su comisión.
  if (aliadoB2B != null) {
    const com = await registrarComisionReserva(sb, numero, aliadoB2B);
    if (!com.ok) return fallarYRevertir(com.error);
  }

  // 5) Pasajeros — `es_infante` se recalcula SIEMPRE server-side desde la
  // fecha de nacimiento contra `meta.fecha_ida` (la misma fecha que se
  // acaba de guardar como `ventas.fecha_salida`, arriba) — nunca se confía
  // en el `esInfante` que manda el cliente (posicional en el formulario,
  // ver lib/reservar/pasajeros.ts). El mismo arreglo se reutiliza más abajo
  // para decidir qué pasajeros ocupan silla — una sola fuente de verdad.
  const esInfanteReal = input.pasajeros.map((p) => esInfantePorEdad(p.fechaNacimiento, meta.fecha_ida));

  // 5-bis) Pasajeros + responsables + sillas del BLOQUEO negociado, TODOS EN
  // UNA SOLA LLAMADA — segunda revisión de alto riesgo (B5): antes, las
  // sillas se reservaban aquí y los pasajeros se insertaban DESPUÉS en una
  // llamada Supabase aparte (o al revés, en contratos/actions.ts) — un fallo
  // a mitad de camino dejaba sillas tomadas sin pasajero, o un pasajero
  // guardado con el inventario incompleto. `crear_pasajeros_contrato`
  // (migración 167) hace TODO en una sola transacción Postgres: valida el
  // payload, exige responsable_id para todo infante NUEVO (autoridad real:
  // el trigger de la tabla — B1), y reconcilia las sillas del bloqueo con
  // `for update` (B5) — si cualquier parte falla (payload inválido, falta
  // de cupo, vínculo faltante), Postgres revierte TODO: nunca queda una
  // silla tomada sin pasajero ni un pasajero guardado sin su silla, y esta
  // función nunca sigue de largo como si hubiera tenido éxito.
  // `p_holders_min = paxConSilla` (agregado de la composición de
  // habitaciones, ANTES de nombrar pasajeros): la reserva puede crearse
  // legítimamente con la lista de pasajeros vacía (`convertirCotizacion` con
  // override de superadmin, "captura los pasajeros después"); el núcleo
  // reserva como mínimo ese piso, y nunca menos que los pasajeros reales
  // (no infante, por edad real) que sí vengan nombrados en este payload — así
  // nunca se sub-reserva ni por lista vacía ni por una edad real distinta a
  // la declarada. Si el origen no es un bloqueo, `_ajustar_sillas_nucleo`
  // resuelve `ventas.bloqueo_ref_id` en null y no hace nada (no-op).
  // `service_role` porque la reserva puede venir de un usuario B2B externo
  // (agencia/freelance), que nunca pasaría el candado de rol interno del
  // wrapper de edición — el RPC exige en cambio un usuario real y activo.
  {
    const { data: { user: actorPasajeros } } = await sb.auth.getUser();
    if (!actorPasajeros) return fallarYRevertir("Sesión inválida: no se pudo confirmar el usuario para crear la reserva.");
    const admin = createAdminClient();
    const payloadPasajeros = payloadGuardarPasajeros(
      input.pasajeros.map((p, i) => ({
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
        tipoId: oNull(p.tipoDoc) ?? "CC",
        identificacion: oNull(p.numeroDoc) ?? "",
        fechaNacimiento: p.fechaNacimiento ?? "",
        esInfante: esInfanteReal[i] ?? false,
        responsableIndex: p.responsableIndex ?? null,
      }))
    );
    // Migración 201: la misma transacción reserva las sillas y les copia los
    // datos del pasajero (`sillas.pasajero_*` es el manifiesto del vuelo). Sin
    // copia aparte no hay un momento en que la silla sea del contrato y esté
    // vacía, así que una edición manual no puede colarse ni hacer fallar la
    // copia; si la copia falla, se revierte todo y se deshace el contrato.
    // Quién ocupa silla lo decide la base, en el orden de este payload.
    const { data: pasajerosCreados, error: pasajerosErr } = await admin.rpc("crear_pasajeros_contrato_con_sillas", {
      p_numero_contrato: numero,
      p_pasajeros: payloadPasajeros as unknown as Json,
      p_holders_min: paxConSilla,
      p_usuario_id: actorPasajeros.id,
      p_comun: {
        asesor: oNull(asesorNombre),
        hotel: meta.hotel_nombre ?? null,
        acomodacion: input.categoria,
        plazo: oNull(input.plazo),
      },
      p_datos_pasajeros: input.pasajeros.map((p) => ({
        pasajero_nombres: oNull(p.nombres),
        pasajero_apellidos: oNull(p.apellidos),
        tipo_doc: oNull(p.tipoDoc),
        numero_doc: oNull(p.numeroDoc),
        nacimiento: oNull(p.fechaNacimiento),
      })),
    });
    if (pasajerosErr) return fallarYRevertir(pasajerosErr.message);

    // nombres/apellidos/nacionalidad — POSTERIOR al RPC atómico (que no los
    // conoce: no forman parte de v_claves_validas de
    // _reemplazar_pasajeros_nucleo, migración 167 — ver el comentario de la
    // migración 187). Es best-effort en el sentido de que un fallo NO
    // revierte la reserva (el pasajero y su silla ya quedaron completos y
    // correctos por el RPC atómico de arriba) — pero a diferencia del
    // snapshot de sillas.pasajero_* de más abajo, aquí SÍ se revisa
    // `{ error }` de cada UPDATE y se reporta honestamente en
    // `advertencias`: nunca se asume éxito sin comprobarlo, y nunca se llama
    // "cosmético" (nombres/apellidos/nacionalidad SÍ son el dato real que el
    // asesor capturó, no un adorno). Empareja por `orden` (0-based, mismo
    // orden en que se armó el payload).
    const filasPasajerosCreados = (pasajerosCreados ?? []).slice().sort((a, b) => a.orden - b.orden);
    const escriturasDemograficas = filasPasajerosCreados.map(async (f, i) => {
      const p = input.pasajeros[i];
      const patch: { nacionalidad?: string; nombres?: string; apellidos?: string } = {};
      const nac = oNull(p?.nacionalidad);
      const nom = oNull(p?.nombres);
      const ape = oNull(p?.apellidos);
      if (nac) patch.nacionalidad = nac;
      if (nom) patch.nombres = nom;
      if (ape) patch.apellidos = ape;
      if (Object.keys(patch).length === 0) return;
      const { error: errDemografico } = await admin.from("contrato_pasajeros").update(patch).eq("id", f.id);
      if (errDemografico) {
        const etiqueta = `${p?.nombres ?? ""} ${p?.apellidos ?? ""}`.trim() || `pasajero #${i + 1}`;
        advertencias.push(`No se pudo guardar nacionalidad/nombres estructurados de ${etiqueta}: ${errDemografico.message}`);
      }
    });
    await Promise.all(escriturasDemograficas);
  }

  // 6) Hotel del contrato (no aplica en paquete tipo servicios)
  if (aceptacion63) {
    // #63: el hotel (con su proveedor) sale de lo aceptado; no se vuelve a leer el catálogo.
    if (aceptacion63.snapshot.hotel) {
      const { error: ehot } = await sb.from("contrato_hoteles").insert({ numero_contrato: numero, ...aceptacion63.snapshot.hotel });
      if (ehot) return fallarYRevertir(`No se pudo guardar el hotel del contrato: ${ehot.message}`);
    }
  } else if (!esServicios) {
    // Detalle legible: "1 hab Doble (2 pax), 2 hab Triple (6 pax), 1 Niño 1".
    const partes = lineasHab.map(
      (l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`
    );
    if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
    if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
    if ((Number(input.infantes) || 0) > 0) partes.push(`${Number(input.infantes)} Infante(s)`);
    if ((Number(input.mascotas) || 0) > 0) partes.push(`${Number(input.mascotas)} Mascota(s)`);
    const resumenAcom = partes.join(", ");
    // Proveedor del hotel (se arrastra al contrato). proveedores es interno, se
    // lee con service-role si está disponible.
    let proveedorHotel: string | null = null;
    if (input.hotelId) {
      const clientH = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
      const { data: hp } = await clientH.from("hoteles").select("proveedores(nombre)").eq("id", input.hotelId).maybeSingle();
      proveedorHotel = (hp?.proveedores as unknown as { nombre: string } | null)?.nombre ?? null;
    }
    await sb.from("contrato_hoteles").insert({
      numero_contrato: numero,
      nombre: meta.hotel_nombre ?? "",
      categoria: input.categoria,
      proveedor: proveedorHotel,
      ciudad: meta.destino_nombre,
      alimentacion: input.regimen,
      acomodacion: input.categoria,
      detalle_acomodacion: resumenAcom,
      fecha_ingreso: meta.fecha_ida,
      fecha_salida: meta.fecha_regreso,
      orden: 0,
    });
  }

  // 6bis) Congelar condiciones de pago (Rama B, migración 165) — best-effort,
  // nunca bloquea la reserva. Con hotel: el componente "hotel" lleva TODO el
  // precio_venta, condicionado por las vigencias REALES del hotel
  // (hotel_temporadas). Sin hotel (paquete tipo servicios): el componente
  // "paquete" lleva el precio_venta, condicionado por armado_paquetes. Ver
  // cabecera de lib/contrato/congelarCondicionesContrato.ts para el porqué de
  // esta asignación mutuamente excluyente.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const adminCond = createAdminClient();
    const { data: { user: usuarioCond } } = await sb.auth.getUser();
    if (usuarioCond) {
      const fechaPagoCond = fechaNegocio();
      let componente: ComponenteSnapshot | null = null;
      if (!esServicios && meta.fecha_ida && meta.fecha_regreso) {
        componente = await componenteHotelReal(adminCond, {
          hotelId: input.hotelId,
          id: `hotel-${input.hotelId}`,
          valor: precioFinal,
          referencia: meta.hotel_nombre ?? null,
          fechaIda: meta.fecha_ida,
          fechaRegreso: meta.fecha_regreso,
          fechaPago: fechaPagoCond,
        });
      } else if (esServicios) {
        componente = await componentePaqueteReal(adminCond, {
          paqueteId: input.paqueteId,
          id: `paquete-${input.paqueteId}`,
          valor: precioFinal,
          fechaViaje: meta.fecha_ida ?? null,
        });
      }
      const trmCond = await trmReferenciaAproximada(adminCond, monedaReserva);
      await congelarCondicionesContratoBestEffort(adminCond, {
        numeroContrato: numero,
        componentes: componente ? [componente] : [],
        moneda: monedaReserva,
        trm: trmCond,
        precioTotalMoneda: precioFinal,
        fechaPago: fechaPagoCond,
        usuarioId: usuarioCond.id,
      });
    }
  }

  // 7) Vuelo del contrato (bloqueo, empaquetado o salida dinámica) — 1 fila
  // por tramo (ida y regreso), no 1 fila mezclando ambos sentidos. Usa
  // EXCLUSIVAMENTE `datosVuelo`, ya resuelto y validado en el paso 2c contra
  // el `origen` discriminado — nunca vuelve a consultar por
  // `input.bloqueoId`/`empaquetadoId`/`salidaId` directos, así que no hay
  // forma de que este paso arme el tramo de un origen distinto al que se
  // usó para el precio (defecto 1).
  //
  // HALLAZGO 7 (revisión posterior al PR #268) + su implementación en la
  // ronda siguiente (hallazgo 5, "ALCANCE FUNCIONAL"):
  //
  // Los contratos dinámicos HISTÓRICOS (creados ANTES de esta rama) NUNCA
  // tuvieron `contrato_vuelos` — sus únicos datos de vuelo son las columnas
  // planas de `ventas` (`aerolinea`/`fecha_salida`/`fecha_regreso`/
  // `costo_aereo`), sin ruta IATA, sin horarios, sin número de vuelo. Esto
  // sigue siendo estructural, no se toca: no hay ruta segura de "backfill
  // por coincidencia de texto" (record/aerolínea/fecha) sin arriesgar
  // emparejar el contrato equivocado — por eso `ventas_vuelo_sistema`
  // (hallazgo 2) expone SOLO lo que existe, y el diagnóstico de solo
  // lectura (`supabase/scripts/diagnostico_empaquetados_dinamico.sql`) sigue
  // siendo el punto de partida si se quiere clasificar los casos ambiguos.
  // NINGÚN backfill automático — solo contratos NUEVOS desde este cambio en
  // adelante quedan con `contrato_vuelos` real.
  //
  // Para contratos dinámicos NUEVOS: `datosVuelo` (origen.tipo === "salida",
  // vía `datosVueloSalida`, `lib/reservar/empaquetadoOrigen.ts`) YA trae
  // `ruta`/`fecha_ida`/`fecha_regreso`/`hora_*` desde `salidas_dinamicas` —
  // se arma el mismo shape de tramos ida/regreso que bloqueo/empaquetado.
  // `record`/`numero_vuelo` quedan `null` a propósito: `salidas_dinamicas`
  // no captura esos datos hoy (no existe PNR ni número de vuelo negociado en
  // una salida por sistema) — usar SOLO datos reales, nunca inventar un
  // valor donde la fuente no lo tiene.
  if (aceptacion63) {
    if (aceptacion63.snapshot.tramos.length) {
      const { error: ecv } = await sb.from("contrato_vuelos").insert(aceptacion63.snapshot.tramos.map((tr) => ({ numero_contrato: numero, ...tr })));
      if (ecv) return fallarYRevertir(`No se pudo guardar el vuelo del contrato: ${ecv.message}`);
    }
  } else if ((origen.tipo === "bloqueo" || origen.tipo === "empaquetado" || origen.tipo === "salida") && datosVuelo) {
    const r = parseRuta(datosVuelo.ruta);
    const tramos: {
      numero_contrato: string; aerolinea: string | null; record: string | null; direccion: string;
      origen_codigo: string | null; origen_ciudad: string | null; destino_codigo: string | null; destino_ciudad: string | null;
      numero_vuelo: string | null; hora_salida: string | null; hora_llegada: string | null;
      fecha_salida: string | null; orden: number;
    }[] = [
      {
        numero_contrato: numero, aerolinea: datosVuelo.aerolinea, record: datosVuelo.record, direccion: "ida",
        origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen), destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
        numero_vuelo: datosVuelo.vuelo_ida, hora_salida: datosVuelo.hora_salida_ida, hora_llegada: datosVuelo.hora_llegada_ida,
        fecha_salida: datosVuelo.fecha_ida, orden: 0,
      },
    ];
    if (datosVuelo.fecha_regreso || datosVuelo.vuelo_regreso) {
      tramos.push({
        numero_contrato: numero, aerolinea: datosVuelo.aerolinea, record: datosVuelo.record, direccion: "regreso",
        origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino), destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
        numero_vuelo: datosVuelo.vuelo_regreso, hora_salida: datosVuelo.hora_salida_reg, hora_llegada: datosVuelo.hora_llegada_reg,
        fecha_salida: datosVuelo.fecha_regreso, orden: 1,
      });
    }
    const { error: cve } = await sb.from("contrato_vuelos").insert(tramos);
    if (cve) return { ok: false, error: `No se pudo guardar el vuelo del contrato: ${cve.message}` };
  }

  // 8) Ítems de valores: una fila por tipo de habitación (adultos = pax que cubre)
  // y una fila por grupo de niños. La tarifa es por persona (PVP del tarifario).
  const items: {
    numero_contrato: string; descripcion: string; adultos: number; ninos: number;
    tarifa_adulto: number; tarifa_nino: number; orden: number;
  }[] = [];
  lineasHab.forEach((l, i) => {
    items.push({
      numero_contrato: numero,
      descripcion: `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${input.categoria} / ${input.regimen}`,
      adultos: l.pax,
      ninos: 0,
      tarifa_adulto: l.pvp,
      tarifa_nino: 0,
      orden: i,
    });
  });
  // Menores (migración 226): una fila por clase de hotel Y por tarifa (menor de
  // 2 años = tarifa de infante; 2+ = adulto en vuelo y servicios). 0 = gratis
  // sí se itemiza. Las líneas salen de `computarReserva` (única fuente).
  for (const lm of lineasMenores) {
    items.push({
      numero_contrato: numero,
      descripcion: descripcionLineaMenor(lm, input.categoria, input.regimen),
      adultos: 0, ninos: lm.cantidad, tarifa_adulto: 0, tarifa_nino: lm.tarifa, orden: ordenLineaMenor(lm),
    });
  }
  // Servicios add-on como ítems (1 fila por servicio, total del grupo o por pax)
  serviciosItems.forEach((s, i) => {
    items.push({
      numero_contrato: numero,
      descripcion: `Servicio · ${s.nombre}`,
      adultos: 1,
      ninos: 0,
      tarifa_adulto: s.precio,
      tarifa_nino: 0,
      orden: 100 + i,
    });
  });
  // Cargo de mascota (pet friendly), itemizado aparte igual que el de infante.
  if (cargoMascota) {
    items.push({
      numero_contrato: numero,
      descripcion: cargoMascota.descripcion ? `Mascota · ${cargoMascota.descripcion}` : "Cargo de mascota",
      adultos: 0, ninos: 0, tarifa_adulto: cargoMascota.total, tarifa_nino: 0,
      orden: 201,
    });
  }
  if (aceptacion63) {
    if (aceptacion63.snapshot.items.length) {
      const { error: eit } = await sb.from("contrato_items").insert(aceptacion63.snapshot.items.map((it) => ({ numero_contrato: numero, ...it })));
      if (eit) return fallarYRevertir(`No se pudieron guardar los valores del contrato: ${eit.message}`);
    }
  } else if (items.length) await sb.from("contrato_items").insert(items);

  // Cuentas por pagar y costos del contrato (pasos 9 a 12): `calcularFinancieroReserva` (más abajo) los calcula; la escritura
  // atómica es el paso 12 (`registrarFinancieroContrato`).
  const hoyISO = aceptacion63 ? aceptacion63.fecha_negocio : fechaNegocio();
  let cxp: CxPFinanciera[];
  let costosContrato: CostosContrato;
  let serviciosEfectivos: ServicioEfectivo[] = [];
  if (aceptacion63) {
    // #63: costos y obligaciones EXACTAMENTE los que devolvió la aceptación (derivados por la base del snapshot). No hay
    // lecturas vivas de costos/proveedores aquí: un cambio de catálogo posterior a la aceptación no altera lo acordado.
    cxp = aceptacion63.financiero.cxp as unknown as CxPFinanciera[];
    costosContrato = aceptacion63.financiero.costos as CostosContrato;
  } else {
    const finCalc = await calcularFinancieroReserva({ input, data: comp.data, datosVuelo, costoAereo, hoyISO });
    if (!finCalc.ok) return fallarYRevertir(finCalc.error);
    ({ cxp, costosContrato, serviciosEfectivos } = finCalc);
  }

  // Resumen ÚNICO de asistencia/tours (incluidos + opcionales, deduplicado
  // por servicioId) — misma fuente que checkout/crearCotizacion, para que
  // cotización y contrato muestren exactamente el mismo resultado. Es
  // DISPLAY (dos columnas de texto/booleano), no dinero: sigue siendo
  // best-effort a propósito.
  if (serviciosEfectivos.length) {
    try {
      const admin = createAdminClient();
      const resumen = resumirServiciosContrato(serviciosEfectivos);
      const upd: { tours_traslados?: string; asistencia_medica?: boolean } = {};
      if (resumen.toursTraslados) upd.tours_traslados = resumen.toursTraslados;
      if (resumen.asistenciaMedica) upd.asistencia_medica = true;
      if (Object.keys(upd).length) await admin.from("ventas").update(upd).eq("numero_contrato", numero);
    } catch {
      // Informativo/display; no bloquea la reserva.
    }
  }
  if (aceptacion63) {
    // #63: el resumen de tours/asistencia (display) también sale de lo aceptado. Best-effort, como el de siempre.
    try {
      const upd63: { tours_traslados?: string; asistencia_medica?: boolean } = {};
      if (aceptacion63.snapshot.resumen.tours_traslados) upd63.tours_traslados = aceptacion63.snapshot.resumen.tours_traslados;
      if (aceptacion63.snapshot.resumen.asistencia_medica) upd63.asistencia_medica = true;
      if (Object.keys(upd63).length) await createAdminClient().from("ventas").update(upd63).eq("numero_contrato", numero);
    } catch {
      // Informativo/display; no bloquea la reserva.
    }
  }
  // Se llama incluso con costo/CxP cero: el contrato nació con
  // financiero_estado='pendiente' y este RPC es la única transición válida a
  // 'completo'. Omitirlo dejaría una reserva sin costos pendiente para siempre
  // y el reconciliador terminaría revirtiéndola por falta de payload.
  // #63: toda obligación del modo COP con TRM debe traer su equivalente en COP coherente con la TRM del paquete ANTES de
  // escribir (fallo cerrado: nunca una CxP en USD sin equivalente, que la contabilidad leería como pesos).
  if (oferta63) {
    for (const c of cxp) {
      const v = validarObligacion63({ moneda: c.moneda, valor_total: c.valor_total, valor_cop: c.valor_cop, trm: c.trm });
      if (!v.ok) return fallarYRevertir(v.error);
    }
  }
  const fin = await registrarFinancieroContrato(depsFinanciero(numero, tenant, hoyISO), {
    numeroContrato: numero, tenant, costos: costosContrato, cxp, fecha: hoyISO,
  });
  if (!fin.ok) return { ok: false, error: fin.error };

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero, ...(advertencias.length ? { advertencias } : {}) };
}

// Costos y cuentas por pagar (CxP) de una reserva del tarifario — pasos 9 a 12 de `reservarDesdeTarifarioInterno`, extraídos SIN
// cambiar su cálculo para que el mismo código arme (a) lo que se escribe al reservar un contrato de siempre y (b) el snapshot
// financiero PRIVADO de una oferta en COP con TRM (#63) al cotizar. No escribe nada: devuelve las obligaciones y los costos.
// Lecturas con service-role de netos/proveedores/retención (nunca visibles al asesor). Un fallo de lectura es un error, jamás
// un costo en cero.
async function calcularFinancieroReserva(p: {
  input: ReservaInput;
  data: ComputoReserva;
  datosVuelo: DatosVueloOrigen | null;
  costoAereo: number;
  hoyISO: string;
}): Promise<{ ok: true; cxp: CxPFinanciera[]; costosContrato: CostosContrato; serviciosEfectivos: ServicioEfectivo[] } | { ok: false; error: string }> {
  const { input, datosVuelo, costoAereo, hoyISO } = p;
  const { meta, netoPorAcom, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosIncluidos, oferta63 } = p.data;
  const { numMenoresDeDos, numInfantes } = menoresDelComputo(p.data, { infantesDeclarados: Number(input.infantes) || 0 });
  const esServicios = input.modulo === "servicios";

  // Cuentas por pagar (CxP) generadas AUTOMÁTICAMENTE porque la venta sale del
  // tarifario: una por proveedor de aéreo, hotel y cada servicio. Se acumulan
  // en los pasos 9/10/11 (que ya leen los costos netos con service-role) y se
  // insertan en el paso 12. El proveedor (con su retención) se jala del catálogo.
  const OBS_AUTO = "Generado automáticamente desde el tarifario";
  type ProvFact = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
  // `numero_contrato`/`tenant` NO van en la fila: los pone la propia
  // transacción financiera (migración 171) a partir de sus parámetros, así
  // que no hay forma de que una fila del payload apunte a otro contrato o a
  // otra agencia.
  const cxp: CxPFinanciera[] = [];
  // #63: en el modo COP con TRM cada obligación conserva su moneda de ORIGEN (hotel/servicios pueden deberse en USD;
  // el aéreo de Empaquetados, en COP) y lleva su equivalente en COP congelado a la TRM del paquete. En el modo de
  // siempre `oferta63` es null y la fila queda exactamente como antes (sin moneda, sin equivalente).
  const monedaOrigenCxP63 = (tipo: string, servicioId?: number | null): "COP" | "USD" => {
    if (!oferta63) return "COP";
    if (tipo === "hotel") return oferta63.monedaHotel;
    if (tipo === "aereo") return oferta63.monedaAereo;
    return servicioId != null ? (oferta63.monedaServicios[servicioId] ?? "COP") : "COP";
  };
  const pushCxP = (tipo: string, servicio: string, valor: number, pr: ProvFact, nombreFallback?: string | null, cxpOpts?: { permitirCero?: boolean; servicioId?: number | null }) => {
    if (!(valor > 0) && !cxpOpts?.permitirCero) return;
    cxp.push({
      proveedor: pr?.nombre ?? nombreFallback ?? null,
      tipo_proveedor: tipo,
      servicio,
      valor_total: Math.max(0, valor),
      fecha_obligacion: hoyISO,
      aplica_retencion: pr?.aplica_retencion ?? false,
      pct_retencion: Number(pr?.pct_retencion) || 0,
      observaciones: valor > 0 ? OBS_AUTO : `${OBS_AUTO} · costo neto pendiente`,
      servicio_id: cxpOpts?.servicioId ?? null,
      ...(oferta63 ? camposCxP63({ valor: Math.max(0, valor), moneda: monedaOrigenCxP63(tipo, cxpOpts?.servicioId) }, oferta63.trm) : {}),
    });
  };

  // 9) CxP aérea (a partir de `datosVuelo`, ya resuelto/validado en el paso
  // 2c — `costo_aereo`/`aerolinea` de `ventas` ya se guardaron en el insert
  // del paso 4, así que aquí no vuelve a haber un UPDATE que pueda divergir
  // ni fallar en silencio). Ninguna rama de origen crea CxP dos veces, porque
  // `origen` es un discriminado único (defecto 1).
  if (datosVuelo) {
    pushCxP("aereo", `Aéreo ${datosVuelo.aerolinea ?? ""}`.trim(), costoAereo, datosVuelo.proveedor, datosVuelo.aerolinea);
  }

  // 10) Costo neto del HOTEL y su cuenta por pagar. El neto YA se calculó en
  //     computarReserva (netoPorAcom), con la vigencia de compra: si hubiera
  //     vencido, la venta ni siquiera se habría creado (se bloquea allá). Aquí
  //     solo se suma por pax y se acumula la CxP con el proveedor del hotel.
  //     Una sola fuente del costo evita la divergencia que generaba costo 0.
  //     NADA se escribe todavía: costos y CxP se guardan juntos, en una sola
  //     transacción, en el paso 12 (B7).
  let costoHotelTotal = 0;
  if (!esServicios && Object.keys(netoPorAcom).length) {
    try {
      const admin = createAdminClient();
      for (const l of lineasHab) { const per = netoPorAcom[l.acom]; if (per != null) costoHotelTotal += per * l.pax; }
      if (numNinos > 0 && netoPorAcom["nino"] != null) costoHotelTotal += netoPorAcom["nino"] * numNinos;
      if (numNinos2 > 0 && netoPorAcom["nino2"] != null) costoHotelTotal += netoPorAcom["nino2"] * numNinos2;
      // Infante de hotel (0 = gratis): el neto que cobra el hotel por cada uno,
      // menor de 2 años o de 2 (clase infante del hotel) — antes no se sumaba.
      if (numInfantes > 0 && netoPorAcom["infante"] != null) costoHotelTotal += netoPorAcom["infante"] * numInfantes;
      const { data: hprov, error: hprovErr } = await admin
        .from("hoteles").select("nombre, proveedores(nombre, aplica_retencion, pct_retencion)").eq("id", input.hotelId).maybeSingle();
      if (hprovErr) throw new Error(hprovErr.message);
      if (costoHotelTotal > 0) {
        const prH = hprov?.proveedores as unknown as ProvFact;
        pushCxP("hotel", `Hotel ${meta.hotel_nombre ?? hprov?.nombre ?? ""}`.trim(), costoHotelTotal, prH);
      }
    } catch (e) {
      // FALLA CERRADO: antes esto se tragaba el error y la reserva seguía como
      // si nada, dejando el contrato sin costo de hotel ni cuenta por pagar
      // (rentabilidad inflada y una deuda con el hotel que no existe en el
      // sistema). Ya no: se deshace el contrato y se devuelve el error.
      return { ok: false, error: `No se pudo calcular el costo del hotel para el contrato: ${e instanceof Error ? e.message : "error desconocido"}.` };
    }
  }

  // 11) Costo neto de SERVICIOS opcionales (receptivo) — admin, oculto al asesor.
  // Los efectivos (incluidos + opcionales) se acumulan en `serviciosEfectivos`
  // para un solo resumen final (asistencia_medica/tours_traslados) — fuente
  // única compartida con checkout/crearCotizacion (lib/reservar/serviciosPaquete.ts),
  // dedup por servicioId (nunca solo por nombre).
  const serviciosEfectivos: ServicioEfectivo[] = [];
  // Costo NETO de servicios del contrato (opcionales del paso 11 + incluidos
  // del 11-bis). Se escribe UNA sola vez, al final, para que
  // `ventas.costo_receptivo` cuadre EXACTAMENTE con la suma de las CxP de
  // servicio que crea este mismo flujo — de eso depende que
  // `asegurarCuentasPorPagar` (cobertura por monto, ver cxpCobertura.ts) no
  // vuelva a crear una segunda cuenta por el mismo dinero, y que la
  // rentabilidad no muestre un margen inflado por un costo con CxP pero sin
  // columna.
  let costoServiciosTotal = 0;
  if (input.servicios?.length) {
    try {
      const admin = createAdminClient();
      const [{ data: arm, error: armErr }, { data: gruposNet, error: gruposErr }, { data: tempsNet, error: tempsErr }] = await Promise.all([
        admin.from("armado_servicios")
          .select("servicio_id, modo, servicios_adicionales(precio_persona, precio_infante, recargo_individual, categoria, nombre, liquidacion, proveedor_id, proveedores(nombre, aplica_retencion, pct_retencion))")
          .eq("paquete_id", input.paqueteId).in("servicio_id", input.servicios),
        admin.from("servicio_tarifa_pax")
          .select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", input.servicios),
        admin.from("servicio_temporadas")
          .select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, precio_infante, recargo_individual").in("servicio_id", input.servicios),
      ]);
      // Un error de lectura deja `data` en null, no lanza: sin este chequeo el
      // bucle no correría y el contrato quedaría con los servicios cobrados y
      // sin costo ni CxP — el mismo defecto que B7 cierra.
      const errLectura = armErr ?? gruposErr ?? tempsErr;
      if (errLectura) throw new Error(errLectura.message);
      // Rangos por grupo (NETO) por servicio y temporada (incl. GENERAL).
      const gruposPorServ = new Map<string, { pax_desde: number; pax_hasta: number; precio: number }[]>();
      for (const g of gruposNet ?? []) {
        const k = `${g.servicio_id}|${g.temporada ?? "GENERAL"}`;
        const arr = gruposPorServ.get(k) ?? [];
        arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
        gruposPorServ.set(k, arr);
      }
      // Temporadas por servicio: el NETO del costo cambia según la fecha del viaje.
      const tempsPorServ = new Map<number, TemporadaRango[]>();
      const netoTempServ = new Map<string, number>();   // servId|nombre -> neto persona
      const netoInfTempServ = new Map<string, number>(); // servId|nombre -> neto infante
      const recTempServ = new Map<string, number>();    // servId|nombre -> recargo neto
      for (const t of tempsNet ?? []) {
        const arr = tempsPorServ.get(t.servicio_id) ?? [];
        arr.push(toTemporadaRango(t));
        tempsPorServ.set(t.servicio_id, arr);
        if (t.precio_persona != null) netoTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.precio_persona));
        if (t.precio_infante != null) netoInfTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.precio_infante));
        if (t.recargo_individual != null) recTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.recargo_individual));
      }
      const fechaViajeCosto = meta.fecha_ida ? new Date(`${meta.fecha_ida}T00:00:00`) : null;
      // Temporada vigente del servicio para la fecha del viaje (o null = GENERAL).
      const tempVigente = (servId: number): string | null => {
        if (!fechaViajeCosto) return null;
        const tt = tempsPorServ.get(servId);
        if (!tt?.length) return null;
        return temporadaVigenteParaFecha(fechaViajeCosto, tt);
      };
      const nochesStay = meta.fecha_ida && meta.fecha_regreso ? noches(meta.fecha_ida, meta.fecha_regreso) : 1;
      let costoReceptivo = 0;
      for (const s of arm ?? []) {
        const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
        const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; precio_infante: number | null; recargo_individual: number | null; categoria: string | null; nombre: string; liquidacion: string | null; proveedor_id: number | null; proveedores: ProvFact } | null;
        const nombreTemp = tempVigente(s.servicio_id);
        // Neto por persona: el de la temporada vigente, o el base.
        const netoPersona = (nombreTemp ? netoTempServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined) ?? srv?.precio_persona ?? null;
        // Rangos por grupo: los de la temporada vigente si existen, si no GENERAL.
        const gruposTemp = nombreTemp ? gruposPorServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined;
        const grupos = gruposTemp?.length ? gruposTemp : (gruposPorServ.get(`${s.servicio_id}|GENERAL`) ?? []);
        // Persona: adultos (2+ años) a la tarifa de adulto + menores de 2 años a su
        // precio de infante NETO (el de la temporada vigente, o el general, o el de
        // adulto si el servicio no lo configuró). Grupo: el rango cuenta SOLO a los
        // de 2+ años y el menor de 2 no paga extra (migración 226).
        const netoInfante = (nombreTemp ? netoInfTempServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined) ?? srv?.precio_infante ?? netoPersona ?? 0;
        let costoServ = (precioServicio(modo, netoPersona, grupos, paxConSilla) + (modo === "persona" ? netoInfante * numMenoresDeDos : 0)) * factorLiquidacion(srv?.liquidacion, nochesStay);
        // Recargo individual: suplemento NETO del proveedor cuando va 1 pax (cobro
        // por persona). El de la temporada vigente si lo define, si no el base.
        if (modo === "persona" && totalPax === 1) {
          const recTemp = nombreTemp ? recTempServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined;
          costoServ += Math.max(recTemp ?? (Number(srv?.recargo_individual) || 0), 0);
        }
        costoReceptivo += costoServ;
        const categoria = normalizarCategoriaServicio(srv?.categoria);
        serviciosEfectivos.push({
          servicioId: s.servicio_id, nombre: srv?.nombre ?? "Servicio", categoria,
          incluido: false, costoNeto: costoServ, proveedorId: srv?.proveedor_id ?? null,
        });
        // Una CxP por servicio — tipo derivado de la MISMA fuente que el
        // resumen (asistencia→asistencia, tour_traslado→receptivo, otro→otro;
        // antes "otro" caía incorrectamente en "receptivo").
        pushCxP(tipoProveedorCxpServicio(categoria), srv?.nombre ?? "Servicio", costoServ, srv?.proveedores ?? null, null, { servicioId: s.servicio_id });
      }
      costoServiciosTotal += costoReceptivo;
    } catch (e) {
      // FALLA CERRADO (B7), igual que el costo del hotel: un servicio del
      // contrato sin costo ni CxP es una deuda con el proveedor que el sistema
      // no conoce. Antes esto se tragaba en silencio.
      return { ok: false, error: `No se pudo calcular el costo de los servicios del contrato: ${e instanceof Error ? e.message : "error desconocido"}.` };
    }
  }

  // 11-bis) Servicios INCLUIDOS del paquete (armado_servicios.incluido=true).
  // Su PVP ya está horneado (comp.data.serviciosIncluidos, ver computo.ts) —
  // acá SOLO se genera la CxP de su proveedor real (antes se perdía dentro de
  // la CxP de "hotel") y se suman al resumen de asistencia/tours. La
  // validación DURA (modo inválido, grupo sin rango de pax) ya corrió en
  // `computarReserva`, ANTES de crear nada; un fallo TÉCNICO aquí ya no se
  // traga (B7): el ingreso del servicio incluido sí se cobró en el PVP, así
  // que su costo y su CxP no pueden faltar.
  if (serviciosIncluidos.length) {
    try {
      const admin = createAdminClient();
      const ids = serviciosIncluidos.map((s) => s.servicioId);
      const { data: provRows, error: provErr } = await admin
        .from("servicios_adicionales")
        .select("id, proveedores(nombre, aplica_retencion, pct_retencion)")
        .in("id", ids);
      if (provErr) throw new Error(provErr.message);
      const provPorId = new Map((provRows ?? []).map((r) => [r.id, r.proveedores as unknown as ProvFact]));
      for (const s of serviciosIncluidos) {
        serviciosEfectivos.push(s);
        if (s.costoNeto > 0) {
          pushCxP(tipoProveedorCxpServicio(s.categoria), s.nombre, s.costoNeto, provPorId.get(s.servicioId) ?? null, null, { servicioId: s.servicioId });
          // El costo del incluido va a la MISMA columna que el de los
          // opcionales: su CxP existe, así que su costo tiene que existir
          // también (si no, la rentabilidad mostraría un margen inflado y
          // `asegurarCuentasPorPagar` vería cobertura sin costo).
          costoServiciosTotal += s.costoNeto;
        }
      }
    } catch (e) {
      return { ok: false, error: `No se pudo registrar el costo de los servicios incluidos del paquete: ${e instanceof Error ? e.message : "error desconocido"}.` };
    }
  }


  // 12) ESCRITURA FINANCIERA ATÓMICA (B7): los costos del contrato y TODAS las
  //     cuentas por pagar acumuladas (hotel/aéreo/servicios) se guardan en UNA
  //     transacción (`registrar_financiero_contrato`, migración 171). Antes
  //     eran tres escrituras sueltas envueltas en `try/catch`: si una fallaba,
  //     esta función devolvía `ok: true` con el contrato creado y la deuda con
  //     el proveedor inexistente. Ahora, o queda todo, o no queda el contrato.
  //     `costo_receptivo` sale de la MISMA suma que las CxP de servicio, que
  //     es la invariante de la que depende `faltantesCxP` (cobertura por
  //     monto) para no crear después una segunda cuenta por el mismo dinero.
  //     `costo_aereo` ya quedó en el insert del paso 4 (dato del origen ya
  //     validado), así que no se reescribe aquí.
  const costosContrato: CostosContrato = {};
  if (costoHotelTotal > 0) costosContrato.costo_hotel = costoHotelTotal;
  if (costoServiciosTotal > 0) costosContrato.costo_receptivo = costoServiciosTotal;
  // #63: en el modo de oferta con conversión por TRM las columnas de costo del contrato (en la moneda de la oferta: COP o USD) son la suma
  // de los equivalentes de SUS MISMAS CxP (cuya moneda de origen puede ser otra): costo y obligación no pueden divergir. El aéreo ya sale
  // en esa moneda desde el origen.
  if (oferta63) {
    const TIPOS_SERVICIO_63 = ["receptivo", "asistencia", "otro"];
    const hotel63 = sumaEquivalentesOferta63(cxp.filter((c) => c.tipo_proveedor === "hotel").map((c) => ({ valor: c.valor_total, moneda: c.moneda === "USD" ? "USD" as const : "COP" as const })), oferta63.moneda, oferta63.trm);
    const servicios63 = sumaEquivalentesOferta63(cxp.filter((c) => TIPOS_SERVICIO_63.includes(c.tipo_proveedor)).map((c) => ({ valor: c.valor_total, moneda: c.moneda === "USD" ? "USD" as const : "COP" as const })), oferta63.moneda, oferta63.trm);
    if (hotel63 > 0) costosContrato.costo_hotel = hotel63; else delete costosContrato.costo_hotel;
    if (servicios63 > 0) costosContrato.costo_receptivo = servicios63; else delete costosContrato.costo_receptivo;
  }

  return { ok: true, cxp, costosContrato, serviciosEfectivos };
}

// #63 — huella de lo que el cliente vio al cotizar / lo que se va a cobrar al convertir. Misma función en las dos puntas.
function huellaDeOferta63(input: ReservaInput, data: ComputoReserva): string | null {
  const o = data.oferta63;
  if (!o) return null;
  return huellaOferta63({
    paqueteId: input.paqueteId,
    salidaId: input.salidaId ?? null,
    modo: MODO_OFERTA_63,
    trm: o.trm,
    generacion: o.generacionPublicada,
    revisionFuente: o.revisionPublicada,
    precioVenta: data.precioVenta,
    moneda: data.monedaReserva,
    tarifaParaEmpaquetar: o.tarifaParaEmpaquetar,
    feeInfante: o.feeInfante,
    fechaIda: data.meta.fecha_ida,
    fechaRegreso: data.meta.fecha_regreso,
  });
}

// ── COTIZACIONES: presupuesto SIN número de contrato ───────────────────────
// crearCotizacion reusa computarReserva (mismo precio que el contrato) y guarda
// un snapshot listo para el PDF. NO toca inventario ni numera. Al convertir se
// llama a reservarDesdeTarifario (que sí genera número, sillas y CxP).
export type CotizacionResult = { ok: true; id: number; avisoPersonas?: string } | { ok: false; error: string };

export async function crearCotizacion(input: ReservaInput, opts?: { vigenciaHasta?: string }): Promise<CotizacionResult> {
  const sb = await createClient();
  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";
  // #63 (E/F/G): revisiones de T0 de una salida dinámica — se leen ANTES de calcular nada. La base las compara de nuevo al guardar
  // la cotización y al aceptarla: cualquier cambio entre medias rechaza. Un error de lectura solo bloquea si la oferta es 63.
  const t063 = input.salidaId && process.env.SUPABASE_SERVICE_ROLE_KEY ? await leerRevisiones63(createAdminClient(), input.paqueteId) : null;
  const comp = await computarReserva(sb, input);
  if (!comp.ok) return { ok: false, error: comp.error };
  const { origen, meta, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, serviciosIncluidos, monedaReserva, cargoMascota, impuestoTotal } = comp.data;
  const { lineasMenores, numMenoresDeDos } = menoresDelComputo(comp.data, { infantesDeclarados: Number(input.infantes) || 0 });
  // Mismo resumen ÚNICO que usa `reservarDesdeTarifarioInterno` al convertir
  // (lib/reservar/serviciosPaquete.ts) — así la cotización ya muestra, antes
  // de convertirse, exactamente lo que mostrará el contrato.
  const resumenServicios = resumirServiciosContrato([
    ...serviciosIncluidos,
    ...serviciosItems.map((s): ServicioEfectivo => ({ servicioId: s.servicioId, nombre: s.nombre, categoria: s.categoria, incluido: false, costoNeto: 0, proveedorId: s.proveedorId })),
  ]);

  // Origen del vuelo (bloqueo/empaquetado/salida) para el snapshot de la
  // cotización — misma fuente única que usa `reservarDesdeTarifarioInterno`
  // al convertir.
  //
  // FALLA CERRADA (hallazgo 5 de la revisión posterior al PR #268): antes,
  // un fallo de `resolverDatosVuelo` (lectura rota, RLS, empaquetado
  // desactivado/vencido) se ignoraba en silencio (`if (rv.ok) ...`, sin
  // rama de error) — se generaba una cotización de un paquete tipo bloqueo/
  // dinámico SIN el vuelo, como si el paquete no lo llevara. Una cotización
  // de un paquete con vuelo no puede existir sin ese vuelo: si el origen no
  // se puede resolver, la cotización NO se crea (mismo criterio que
  // `reservarDesdeTarifarioInterno`, que ya fallaba cerrado en su paso 2c).
  let datosVueloSnap: DatosVueloOrigen | null = null;
  if (origen.tipo !== "ninguno") {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      return { ok: false, error: "No se pudo resolver el origen del vuelo (configuración del servidor incompleta)." };
    const rv = await resolverDatosVuelo(createAdminClient(), origen);
    if (!rv.ok) return { ok: false, error: rv.error };
    datosVueloSnap = rv.data;
  }

  const hoy = hoyBogota();
  const asesorNombre = input.asesorInterno;
  const clienteNombre = `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim();
  const planNombre = esServicios ? null : `${input.categoria} · ${input.regimen}`;

  // Snapshot para el documento/PDF (objetos planos tipo contrato_*, sin proveedor).
  const ventaSnap: Record<string, unknown> = {
    numero_contrato: "",
    cliente: clienteNombre,
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_direccion: null,
    destino: meta.destino_nombre,
    fecha_emision: hoy,
    fecha_salida: meta.fecha_ida,
    fecha_regreso: meta.fecha_regreso,
    pax: totalPax || paxConSilla,
    estado: "pendiente",
    plan_nombre: planNombre,
    asistencia_medica: resumenServicios.asistenciaMedica,
    tours_traslados: resumenServicios.toursTraslados,
    asesor_firma_nombre: oNull(asesorNombre),
    asesor_firma_cargo: "Asesor/a",
    asesor_firma_cc: null,
    asesor_firma_tel: null,
    moneda: monedaReserva,
  };

  // #42: cada pasajero IDENTIFICADO recibe aquí, en servidor y ANTES del insert, el `ref`
  // estable de su puesto (nunca el índice ni el documento); el que mande el navegador se
  // descarta. Va en `payload.pasajeros` y en `detalle.pasajeros` de la misma escritura.
  const pasajerosConRef = asignarRefsPasajeros(input.pasajeros, () => crypto.randomUUID());
  // #63: la cotización de una oferta en COP con TRM guarda la HUELLA de lo mostrado (no el costo N). Al convertirla se
  // recalcula; si el precio, el vuelo, la TRM o el tarifario publicado cambiaron, se exige reconfirmar con una nueva.
  const huella63 = huellaDeOferta63(input, comp.data);
  const inputPersistido = {
    ...input,
    pasajeros: pasajerosConRef,
    ...(huella63 ? { oferta63: { huella: huella63, modo: MODO_OFERTA_63, trm: comp.data.oferta63?.trm ?? null } } : {}),
  } as ReservaInput;

  const pasajerosSnap: Record<string, unknown>[] = pasajerosConRef.map((p, i) => ({
    id: i + 1,
    ...(p.ref ? { ref: p.ref } : {}),
    nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
    tipo_id: oNull(p.tipoDoc) ?? "CC",
    identificacion: oNull(p.numeroDoc),
    fecha_nacimiento: oNull(p.fechaNacimiento),
    es_infante: p.esInfante,
  }));

  const hotelesSnap: Record<string, unknown>[] = [];
  if (!esServicios) {
    const partes = lineasHab.map((l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`);
    if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
    if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
    if ((Number(input.infantes) || 0) > 0) partes.push(`${Number(input.infantes)} Infante(s)`);
    if ((Number(input.mascotas) || 0) > 0) partes.push(`${Number(input.mascotas)} Mascota(s)`);
    // Foto de portada del hotel (para mostrarla junto al nombre en el documento).
    let fotoUrl: string | null = null;
    if (input.hotelId) {
      const { data: fotos } = await sb.from("hotel_fotos").select("url, es_portada, orden").eq("hotel_id", input.hotelId).order("orden");
      for (const f of fotos ?? []) { if (fotoUrl == null) fotoUrl = f.url; if (f.es_portada) fotoUrl = f.url; }
    }
    hotelesSnap.push({
      id: 1,
      nombre: meta.hotel_nombre ?? "",
      categoria: input.categoria,
      ciudad: meta.destino_nombre,
      proveedor: null,
      alimentacion: input.regimen,
      acomodacion: input.categoria,
      detalle_acomodacion: partes.join(", "),
      fecha_ingreso: meta.fecha_ida,
      fecha_salida: meta.fecha_regreso,
      nota_regimen: null,
      foto_url: fotoUrl,
    });
  }

  // Snapshot del vuelo — misma forma para los 3 orígenes, tomada de
  // `datosVueloSnap` (resuelta arriba, una sola vez, a partir del `origen`
  // discriminado). Salida dinámica no lleva `record`/`numero_vuelo` (nunca
  // tuvo esos datos negociados) — mismo comportamiento que antes.
  const vuelosSnap: Record<string, unknown>[] = [];
  if (datosVueloSnap) {
    const r = parseRuta(datosVueloSnap.ruta);
    const numeroVueloIda = origen.tipo === "salida" ? null : datosVueloSnap.vuelo_ida;
    const numeroVueloReg = origen.tipo === "salida" ? null : datosVueloSnap.vuelo_regreso;
    vuelosSnap.push({
      id: 1, aerolinea: datosVueloSnap.aerolinea, record: datosVueloSnap.record, direccion: "ida",
      origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen),
      destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
      numero_vuelo: numeroVueloIda, hora_salida: datosVueloSnap.hora_salida_ida, hora_llegada: datosVueloSnap.hora_llegada_ida,
      fecha_salida: datosVueloSnap.fecha_ida,
    });
    if (datosVueloSnap.fecha_regreso || datosVueloSnap.vuelo_regreso) {
      vuelosSnap.push({
        id: 2, aerolinea: datosVueloSnap.aerolinea, record: datosVueloSnap.record, direccion: "regreso",
        origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino),
        destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
        numero_vuelo: numeroVueloReg, hora_salida: datosVueloSnap.hora_salida_reg, hora_llegada: datosVueloSnap.hora_llegada_reg,
        fecha_salida: datosVueloSnap.fecha_regreso,
      });
    }
  }

  const itemsSnap: Record<string, unknown>[] = [];
  lineasHab.forEach((l, i) => itemsSnap.push({
    id: i + 1,
    descripcion: `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${input.categoria} / ${input.regimen}`,
    adultos: l.pax, ninos: 0, tarifa_adulto: l.pvp, tarifa_nino: 0,
  }));
  // Menores (migración 226): misma composición que el contrato ya convertido
  // (`lineasMenores` de `computarReserva`, única fuente).
  for (const lm of lineasMenores)
    itemsSnap.push({ id: ordenLineaMenor(lm), descripcion: descripcionLineaMenor(lm, input.categoria, input.regimen), adultos: 0, ninos: lm.cantidad, tarifa_adulto: 0, tarifa_nino: lm.tarifa });
  serviciosItems.forEach((s, i) => itemsSnap.push({ id: 100 + i, descripcion: `Servicio · ${s.nombre}`, adultos: 1, ninos: 0, tarifa_adulto: s.precio, tarifa_nino: 0 }));
  if (cargoMascota) {
    itemsSnap.push({
      id: 201,
      descripcion: cargoMascota.descripcion ? `Mascota · ${cargoMascota.descripcion}` : "Cargo de mascota",
      adultos: 0, ninos: 0, tarifa_adulto: cargoMascota.total, tarifa_nino: 0,
    });
  }

  const detalle = { venta: ventaSnap, pasajeros: pasajerosSnap, hoteles: hotelesSnap, vuelos: vuelosSnap, items: itemsSnap };

  const { data: { user } } = await sb.auth.getUser();

  // Acción INTERNA (clasificación explícita, ver revisión de PR #267): el
  // único caller es `ReservaForm.tsx`, bajo `/dashboard/reservar` — una ruta
  // protegida por `proxy.ts` (exige sesión). Pero esta Server Action, al
  // estar exportada, es igual de alcanzable directo por red sin pasar por esa
  // página — así que la exige aquí también, no solo en el middleware.
  // `getTenant()` a secas NO basta: sin sesión cae en silencio al literal
  // "mayorista" (ver lib/tenant.server.ts) — exactamente el fallo que
  // `contextoCotizacion()` cierra (falla cerrado si no hay perfil o
  // `activo !== true`, y solo entonces resuelve tenant/superadmin).
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { ok: false, error: "No autorizado." };

  // #40 E3: solo el personal interno elige la fecha. Un aliado B2B (o cualquier rol externo) que la mande por red no la adquiere: se ignora
  // y rige el plazo automático de un día. Una fecha explícita fuera del rango se rechaza; el valor automático se recorta a la salida.
  const vigenciaRes = resolverVigenciaCotizacion({
    hoy,
    fechaSalida: meta.fecha_ida,
    vigenciaSolicitada: ctx.interno === false ? undefined : opts?.vigenciaHasta,
    diasPorDefecto: 1,
  });
  if (!vigenciaRes.ok) return { ok: false, error: vigenciaRes.error };
  const vigencia = vigenciaRes.vigencia;

  // El precio se calcula en el servidor (autoritativo) y el checkout debe servir
  // tanto a aliados B2B como a usuarios públicos. La RLS de `cotizaciones` es solo
  // para roles internos, así que el insert va por service-role cuando está
  // disponible (si no, cae al cliente con sesión = sólo internos).
  const sbCot = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;

  const tenantCotizacion = ctx.tenant;

  // #63 (E/F/G): una oferta en COP con TRM nace con su SNAPSHOT PRIVADO (precio, BNC, costos, proveedores, retenciones, tramos,
  // ítems y obligaciones de origen) y se guarda JUNTO con la cotización en UNA transacción (`crear_cotizacion_oferta_63`).
  // La autoría estable y el alta de personas (219) siguen siendo el paso posterior de abajo, con su aviso persistente.
  let row: { id: number };
  const oferta63 = comp.data.oferta63;
  if (oferta63) {
    const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
    if (!admin) return { ok: false, error: "No se pudo guardar la cotización (configuración del servidor incompleta)." };
    if (!user) return { ok: false, error: "No autorizado." };
    if (!t063) return { ok: false, error: "No se pudo leer la configuración del paquete. Intenta nuevamente." };
    if (!t063.ok) return { ok: false, error: t063.error };
    // 230: el aéreo (manual o vinculado) conserva su moneda de origen; la CxP la debe en ella y el costo del contrato es su equivalente COP.
    const datosFin: DatosVueloOrigen | null = datosVueloSnap;
    const costoAereo63 = datosFin ? datosFin.costo_neto * paxConSilla + datosFin.fee_infante * numMenoresDeDos : 0;
    const costoAereo63Oferta = equivalenteOferta63(costoAereo63, oferta63.monedaAereo, oferta63.moneda, oferta63.trm);
    const fin63 = await calcularFinancieroReserva({ input, data: comp.data, datosVuelo: datosFin, costoAereo: costoAereo63, hoyISO: hoy });
    if (!fin63.ok) return { ok: false, error: fin63.error };
    let proveedorHotel63: string | null = null;
    if (!esServicios && input.hotelId) {
      const { data: hp63, error: hpe63 } = await admin.from("hoteles").select("proveedores(nombre)").eq("id", input.hotelId).maybeSingle();
      if (hpe63) return { ok: false, error: "No se pudo leer el proveedor del hotel. Intenta nuevamente." };
      proveedorHotel63 = (hp63?.proveedores as unknown as { nombre: string } | null)?.nombre ?? null;
    }
    const hotel63: HotelSnapshot63 | null = esServicios ? null : {
      nombre: meta.hotel_nombre ?? "", categoria: input.categoria, proveedor: proveedorHotel63, ciudad: meta.destino_nombre,
      alimentacion: input.regimen, acomodacion: input.categoria,
      detalle_acomodacion: detalleAcomodacion63({ lineasHab, numNinos, numNinos2, infantes: Number(input.infantes) || 0, mascotas: Number(input.mascotas) || 0 }),
      fecha_ingreso: meta.fecha_ida, fecha_salida: meta.fecha_regreso, orden: 0,
    };
    const resumen63 = resumirServiciosContrato(fin63.serviciosEfectivos);
    // Plan B2B que determina comisión y precio NETO: se resuelve AHORA (con el % del aliado de hoy) y se congela en el snapshot.
    let planB2b63: PlanB2bSnapshot63 | null = null;
    if (input.tipoAsesor !== "interno") {
      const al63 = await resolverAliadoReserva(admin, input.tipoAsesor, input.aliadoId);
      if (!al63.ok) return { ok: false, error: al63.error };
      const plan63 = planComisionReserva({ modoCompra: input.modoCompra, precioVenta, impuesto: impuestoTotal, pct: al63.pct });
      if (!plan63.ok) return { ok: false, error: plan63.error };
      planB2b63 = construirPlanB2b63({ aliadoId: al63.aliadoId, tipoAsesor: input.tipoAsesor, plan: plan63.plan });
    }
    const snapshot63 = construirSnapshot63({
      paqueteId: input.paqueteId, salidaId: input.salidaId ?? null, empaquetadoId: oferta63.empaquetadoId, trm: oferta63.trm, moneda: oferta63.moneda,
      cabecera: {
        tipo_paquete: input.modulo, moneda: monedaReserva, fecha_salida: meta.fecha_ida, fecha_regreso: meta.fecha_regreso,
        pax: totalPax || paxConSilla, destino: meta.destino_nombre, hotel: esServicios ? null : meta.hotel_nombre,
        precio_venta: precioVenta, impuesto: impuestoTotal, costo_aereo: datosFin ? costoAereo63Oferta : 0, aerolinea: datosFin?.aerolinea ?? null,
        plan_nombre: `${input.categoria} · ${input.regimen}`, paquete_armado_id: input.paqueteId,
        tipo_asesor: input.tipoAsesor, canal: input.tipoAsesor === "interno" ? "B2C" : "B2B",
      },
      b2b: planB2b63,
      vigencias: comp.data.vigencias63,
      hotel: hotel63,
      tramos: armarTramos63(datosFin),
      items: armarItems63({ categoria: input.categoria, regimen: input.regimen, lineasHab, lineasMenores, serviciosItems, cargoMascota }),
      costos: fin63.costosContrato,
      cxp: fin63.cxp,
      resumen: { tours_traslados: resumen63.toursTraslados ?? null, asistencia_medica: !!resumen63.asistenciaMedica },
    });
    const cr63 = await crearCotizacionOferta63(admin, {
      usuarioId: user.id,
      tenant: tenantCotizacion,
      cotizacion: {
        tenant: tenantCotizacion, payload: inputPersistido, detalle, cliente: clienteNombre, cliente_documento: oNull(input.cliente.numeroDoc),
        destino: meta.destino_nombre, hotel: esServicios ? null : meta.hotel_nombre, modulo: input.modulo, plan_nombre: planNombre,
        pax: totalPax || paxConSilla, precio_venta: precioVenta, moneda: monedaReserva, fecha_salida: meta.fecha_ida, fecha_regreso: meta.fecha_regreso,
        vigencia_hasta: vigencia, paquete_armado_id: input.paqueteId, asesor: oNull(asesorNombre), creado_por: user.email ?? null,
      },
      snapshot: snapshot63,
      huella: huella63 ?? "",
      huellaFinanciera: huellaFinanciera63({ ...snapshot63.financiero, b2b: snapshot63.b2b }),
      revisiones: t063.revisiones,
    });
    if (!cr63.ok) return { ok: false, error: cr63.error };
    row = { id: cr63.id };
  } else {
  const { data: row0, error } = await sbCot.from("cotizaciones").insert({
    tenant: tenantCotizacion,
    payload: inputPersistido as unknown as Json,
    detalle: detalle as unknown as Json,
    cliente: clienteNombre,
    cliente_documento: oNull(input.cliente.numeroDoc),
    destino: meta.destino_nombre,
    hotel: esServicios ? null : meta.hotel_nombre,
    modulo: input.modulo,
    plan_nombre: planNombre,
    pax: totalPax || paxConSilla,
    precio_venta: precioVenta,
    moneda: monedaReserva,
    fecha_salida: meta.fecha_ida,
    fecha_regreso: meta.fecha_regreso,
    vigencia_hasta: vigencia,
    paquete_armado_id: input.paqueteId,
    asesor: oNull(asesorNombre),
    creado_por: user?.email ?? null,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  row = row0;
  }

  // #42: sello del autor estable (la API no puede estamparlo: solo la función de la 219) y alta
  // del titular y los pasajeros identificados en el registro de personas, desde lo que se acaba
  // de persistir. La cotización ya quedó guardada: un fallo aquí no la deshace, deja un aviso
  // persistente en su ficha (con "Reintentar") y un log sin datos personales — nunca se ignora.
  let avisoPersonas: string | undefined;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && user) {
    const alta = await altaPersonasCotizacion(createAdminClient(), {
      fila: { id: row.id, tenant: tenantCotizacion, tipo: "tarifario", payload: inputPersistido },
      usuarioId: user.id,
      sellar: true,
    });
    if (!alta.ok) {
      console.error(logPersonasCotizacion("reservar", row.id, alta));
      avisoPersonas = AVISO_PERSONAS_PENDIENTES;
    }
  } else {
    console.error(logPersonasCotizacion("reservar", row.id, { etapa: "configuracion", codigo: null }));
    avisoPersonas = AVISO_PERSONAS_PENDIENTES;
  }

  revalidatePath("/dashboard/cotizaciones");
  return avisoPersonas ? { ok: true, id: row.id, avisoPersonas } : { ok: true, id: row.id };
}

// Convierte una cotización en CONTRATO: corre el motor de reserva normal (genera
// numero_contrato + sillas + CxP) con el payload guardado, y enlaza la cotización.
export async function convertirCotizacion(
  id: number, pasajeros?: PasajeroReserva[], override?: boolean, asesorInterno?: string, trmProvisional?: number | null,
  /** 235 (#90 F): moneda de cobro elegida (null = la de la oferta) y su TRM (solo si difiere). Se validan en el servidor; el navegador no decide nada. */
  monedaCobro?: string | null, trmCobro?: number | null,
): Promise<ReservaResult> {
  const sb = await createClient();
  const { data: cot, error } = await sb
    .from("cotizaciones")
    .select("estado, payload, numero_contrato, tenant, modo, tipo, vigencia_hasta")
    .eq("id", id)
    .maybeSingle();
  if (error || !cot) return { ok: false, error: error?.message ?? "Cotización no encontrada." };
  // #35: una comparativa (madre) no se convierte: primero se elige una opción (la hija sí se convierte).
  if (cot.modo === "comparativa") return { ok: false, error: "Una comparativa no se convierte en contrato: elige una opción primero." };
  // #39: una cotización dinámica (manual) se convierte SOLO por su propia puerta
  // (`convertirCotizacionManualAContrato`), que además pasa sus pagos previos a
  // abonos. Su payload no es un pedido del tarifario, aunque traiga campos que lo
  // parezcan: se rechaza aquí, ANTES de calcular, numerar o crear nada.
  if (cot.tipo === "manual") return { ok: false, error: "Esta es una cotización dinámica: se convierte en contrato desde su propia ficha." };
  if (cot.estado === "convertida" && cot.numero_contrato) return { ok: true, numero: cot.numero_contrato };
  if (cot.estado === "descartada") return { ok: false, error: "La cotización está descartada; no se puede convertir." };

  // Sin tenant asignado no se convierte: no hay con qué estampar el contrato
  // (ver migración 153 — no se asume ningún tenant por defecto).
  if (!cot.tenant) return { ok: false, error: "Esta cotización no tiene agencia (tenant) asignada; no se puede convertir. Contacta a un administrador." };

  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  // #40 E3: una abierta vencida se rechaza ANTES de numerar o reservar sillas. Una oferta #63 la rechaza además la base (`aceptar_oferta_63`),
  // que deja pasar el reintento de una aceptación ya preparada; aquí solo se corta lo que aún no empezó (sin oferta63).
  if (cot.estado === "abierta" && !(cot.payload as { oferta63?: unknown } | null)?.oferta63 && cotizacionVencida(cot.vigencia_hasta, hoyBogota()))
    return { ok: false, error: MENSAJE_COTIZACION_VENCIDA };

  const payload = cot.payload as unknown as ReservaInput;
  // Un contrato necesita pasajeros: usa los capturados ahora o los que ya trae la
  // cotización (las internas los traen; las del tarifario B2C no). Sin pasajeros
  // no pasa a contrato, salvo override de superadmin.
  const pax = pasajeros && pasajeros.length ? pasajeros : (payload.pasajeros ?? []);
  if (!pax.length) {
    if (!(override && ctx.ok && ctx.superadmin)) {
      return { ok: false, error: "Captura los datos de los pasajeros antes de generar el contrato." };
    }
  }

  // Si viene del portal B2C, el asesor interno que la gestiona se elige al convertir.
  const asesor = asesorInterno?.trim() || payload.asesorInterno || "";
  // El contrato resultante conserva EXACTAMENTE el tenant de la cotización —
  // nunca se re-deriva de forma independiente (ver reservarDesdeTarifarioInterno).
  // #63: el payload de una cotización en COP con TRM trae su `oferta63.huella`; viaja tal cual dentro del pedido y la
  // reserva la compara con lo que se va a cobrar (precio, vuelo, fechas, TRM y tarifario publicado).
  const res = await reservarDesdeTarifarioInterno({ ...payload, pasajeros: pax, asesorInterno: asesor, oferta63: payload.oferta63 ? { ...payload.oferta63, cotizacionId: id, trmProvisional: trmProvisional ?? null, monedaCobro: monedaCobro ?? null, trmCobro: trmCobro ?? null } : payload.oferta63 }, cot.tenant as Tenant);
  if (!res.ok) return res;

  await sb.from("cotizaciones").update({ estado: "convertida", numero_contrato: res.numero }).eq("id", id);
  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  revalidatePath("/dashboard/contratos");
  // Reenvía `advertencias` de reservarDesdeTarifarioInterno — no
  // reconstruir el resultado a mano descartándolas en silencio.
  return { ok: true, numero: res.numero, ...(res.advertencias?.length ? { advertencias: res.advertencias } : {}) };
}

// ── Fase 3: convertir una cotización COMBINADA del carrito en contrato(s) ──
// A diferencia de convertirCotizacion (un solo hotel → reservarDesdeTarifario
// tal cual), aquí el payload trae VARIOS hoteles/tours (checkout del carrito,
// ver crearCotizacionCarrito en app/tarifario/checkout/actions.ts). Se agrupa
// por destino (o todo en un solo grupo) y cada grupo genera SU PROPIO
// numero_contrato con TODOS sus hoteles en contrato_hoteles (esa tabla ya
// soporta varias filas por contrato — igual que el generador manual
// multi-ciudad). Valida TODO (precio + cupos) antes de insertar cualquier
// cosa, para no dejar contratos a medias si un ítem falla a mitad de camino.
//
// Limitaciones conocidas de esta primera versión (documentadas, no bloquean):
//  · El contrato siempre nace B2C/interno — el modo B2B (neta/comisionable)
//    elegido en el checkout es solo informativo en el mensaje de WhatsApp/
//    correo, igual que ya pasaba desde la Fase 2; agregar la comisión B2B a
//    mano en el contrato ya generado sigue disponible como siempre.
//  · Los tours/servicios (opcionales del carrito + incluidos del paquete) SÍ
//    generan CxP automática cuando el snapshot trae `servicioId`/`paqueteId`
//    (ver bloque de tours más abajo, que re-liquida el costo NETO al
//    convertir con la MISMA fórmula que `reservarDesdeTarifarioInterno`) —
//    cotizaciones de carrito creadas ANTES de este cambio no traen esos ids
//    y sus tours siguen sin CxP automática (residual, documentado en el PR).
export type ItemCarritoPayload = {
  // Marcador de discriminación — SIEMPRE `undefined` para un ítem persona
  // (nunca se escribe en runtime; JSON.stringify lo descarta). Existe solo
  // para que TypeScript narrowe `it.modeloTarifario === "unidad"` contra la
  // unión con `ItemCarritoBernaloPayload` (Fase 3F-4B) sin necesitar un cast
  // — mismo criterio que `HotelCartItemPersona`/`SolicitudItemPersona`.
  modeloTarifario?: undefined;
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number; hotelId: number; bloqueoId: number | null;
  hotelNombre: string; destino: string | null; categoria: string; regimen: string;
  fechaIda: string | null; fechaRegreso: string | null; noches: number | null;
  habitaciones: Record<string, number>; ninos: number; ninos2: number; infantes: number; pax: number; precio: number;
  // Referencia ESTABLE del ítem (ver checkout/actions.ts::crearCotizacionCarrito)
  // — OPCIONAL: cotizaciones creadas ANTES de esta ronda no la traen. Cuando
  // falta, `resolverCondicionesTarifaParaConversion` (lib/calc/condicionesTarifa.ts)
  // devuelve "sin snapshot que copiar" — NUNCA se adivina la referencia por
  // posición/nombre/hotelId+categoría.
  ref?: string;
};

// Ítem Bernalo YA COMPUTADO al crear la cotización de carrito (Fase 3F-4A,
// `SolicitudItemBernaloComputado` en checkout/actions.ts) — SOLO decisiones
// + PVP/pax autoritativos AL MOMENTO DE COTIZAR, nunca netos/costos/
// comisión/snapshot (esos nunca se persistieron en `cotizaciones.payload`).
// Fase 3F-4B re-liquida esto EN VIVO con `computarReservaBernalo` al
// convertir (regla A.3) — este tipo es solo la forma del payload YA
// GUARDADO, nunca la autoridad de precio final.
export type ItemCarritoBernaloPayload = {
  modeloTarifario: "unidad";
  paqueteId: number; hotelId: number; hotelNombre: string; destino: string | null;
  categoria: string; alimentacion: string;
  salida: SalidaResueltaBernalo;
  habitaciones: HabitacionOcupacionValidada[];
  pax: number; precio: number;
  // Misma referencia estable que `ItemCarritoPayload.ref` (ver ahí) — nunca
  // se usa para copiar condiciones de tarifa Dubai a un ítem Bernalo.
  ref?: string;
};
export type TourCarritoPayload = {
  nombre: string; destino: string | null; fechaIda: string | null; fechaRegreso: string | null;
  pax: number; precio: number; moneda: string;
  // Opcionales: cotizaciones de carrito creadas ANTES de este cambio no los
  // traen — nunca se inventa una categoría/proveedor para esos casos
  // legados, `normalizarCategoriaServicio(undefined)` cae a "otro". Sin
  // `servicioId`/`paqueteId` no se puede re-liquidar el costo NETO al
  // convertir (ver bloque de tours en `convertirCotizacionCarrito`) — esos
  // tours legados siguen sin CxP automática, igual que antes de este cambio.
  // `proveedorId` NO viaja acá (revisión PR #294): es un id interno y el
  // proveedor de la CxP se vuelve a resolver server-side contra el catálogo.
  servicioId?: number; paqueteId?: number; categoria?: string;
  // Servicio elegido en la tarjeta de un hotel: `ref` server-side de ese
  // hotel (`ItemCarritoPayload.ref`, generado en checkout/actions.ts — nunca
  // el id de localStorage). Ausente/null = tour independiente o cotización
  // anterior a este cambio (comportamiento de siempre). Ver
  // lib/reservar/vinculoServiciosCheckout.ts.
  hotelRef?: string | null;
};

// Un ítem del carrito con su asignación EXPLÍCITA de pasajeros — revisión de
// alto riesgo, ronda 3 (B11). Antes, cada ítem usaba SIEMPRE las posiciones
// 1..item.pax de `opts.pasajeros` (un prefijo) — una suposición nunca
// demostrada: el carrito (`lib/cart/CartContext.tsx`) es una lista de ítems
// AGREGADOS DE FORMA INDEPENDIENTE (cada uno con su propio `pax`, capturado
// en el momento de agregarlo desde Vista Booking/Receptivos, sin ningún
// vínculo entre sí) — dos ítems pueden representar grupos de viajeros
// DISTINTOS o parcialmente distintos, no necesariamente el mismo prefijo de
// la lista total. Ahora el llamador (la UI, que sabe qué persona marcó para
// cada ítem) declara explícitamente qué POSICIONES (1-based, dentro de
// `opts.pasajeros` — misma convención que `responsableOrden`) corresponden a
// cada ítem — nunca se adivina por posición/conteo.
// Unión discriminada real (persona | Bernalo) — Fase 3F-4B. El acceso a
// campos ESPECÍFICOS de una variante (`.modulo`/`.bloqueoId` de persona,
// `.salida`/`.alimentacion` de Bernalo) SIEMPRE debe pasar primero por
// `it.modeloTarifario === "unidad"` para que TypeScript angoste — nunca un
// cast. `ItemCarritoPersonaConAsignacion` (abajo) es la variante YA
// angostada, para las funciones que solo conocen el camino persona
// (`reservasSillasDeGrupo`, sin cambios de comportamiento — regla 16).
type ItemCarritoConAsignacion = (ItemCarritoPayload | ItemCarritoBernaloPayload) & { __posiciones: number[] };
type ItemCarritoPersonaConAsignacion = ItemCarritoPayload & { __posiciones: number[] };
type ItemCarritoBernaloConAsignacion = ItemCarritoBernaloPayload & { __posiciones: number[] };
// Un tour del carrito con su asignación EXPLÍCITA de pasajeros — B17 (ronda
// 6). Igual que los hoteles/bloqueos, los tours se agregan de forma
// INDEPENDIENTE (cada uno con su propio `pax`), así que quién viaja en cada
// tour NO puede deducirse del grupo del hotel ni de todo el universo: se
// declara explícitamente, con la misma convención de posiciones 1-based.
// `__idx` (#102): posición del tour en `payload.tours`, la llave `tour-N` de las líneas B2B congeladas en la cotización.
type TourCarritoConAsignacion = TourCarritoPayload & { __posiciones: number[]; __idx: number };

// Reservas de sillas consolidadas de UN grupo/contrato del carrito, EXACTAMENTE
// como las recibirá `crear_pasajeros_contrato_multi` — fuente ÚNICA usada por
// la pre-validación de capacidad (B21) y por la creación real, para que lo que
// se pre-valida sea idéntico byte a byte a lo que se escribe. B19: quién ocupa
// silla en cada bloqueo se decide con la fecha REAL de salida de ESE bloqueo
// (`comp.meta.fecha_ida`), no con la única `ventas.fecha_salida`. B15: el piso
// consolidado es la unión de `posicionesConSilla` (personas únicas con silla),
// nunca la suma por ítem. Todo `posGlobal` de `__posiciones` pertenece al
// universo del grupo, así que siempre está en `mapaGlobalALocal`.
// `fechaRefGrupo` es SIEMPRE una fecha concreta (nunca null) — B-fix
// (fecha_salida NULL, revisión de Opus ronda 9): el llamador ya la resolvió
// a `fechasIda[0] ?? hoyISO` ANTES de invocar esto (misma referencia
// efectiva que se pasa como `p_fecha_referencia_fallback` al RPC), así que
// esta función nunca necesita decidir "hoy" por su cuenta.
function reservasSillasDeGrupo(
  validados: readonly { item: ItemCarritoPersonaConAsignacion; comp: ComputoReserva }[],
  mapaGlobalALocal: ReadonlyMap<number, number>,
  pasajerosNormalizadosGlobal: readonly PasajeroReserva[],
  fechaRefGrupo: string
): ReservaSillasPorBloqueo[] {
  const itemsBloqueoLocal = validados
    .filter((v): v is typeof v & { item: { bloqueoId: number } } => v.item.modulo === "bloqueo" && v.item.bloqueoId != null)
    .map((v) => {
      const fechaBloqueo = v.comp.meta.fecha_ida ?? fechaRefGrupo;
      return {
        bloqueoId: v.item.bloqueoId,
        posiciones: v.item.__posiciones.map((posGlobal) => mapaGlobalALocal.get(posGlobal)! + 1),
        posicionesConSilla: v.item.__posiciones
          .filter((posGlobal) => pasajeroConsumeSilla(esInfantePorEdad(pasajerosNormalizadosGlobal[posGlobal - 1].fechaNacimiento, fechaBloqueo)))
          .map((posGlobal) => mapaGlobalALocal.get(posGlobal)! + 1),
      };
    });
  return consolidarReservasSillasPorBloqueo(itemsBloqueoLocal);
}

/** Fila de `proveedores` embebida en un `.select("...proveedores(nombre, aplica_retencion, pct_retencion)")`. */
type ProveedorFilaCatalogo = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;

// ── Fase 3F-4B, regla A: reliquidación + regla B: proveedores obligatorios ──
// Re-liquida un ítem Bernalo EN VIVO con el ÚNICO servicio autoritativo
// (`computarReservaBernalo`, el mismo que usa la cotización pública — regla
// D.17 de 3F-4A, sin segunda implementación) y aplica las guardias que la
// VISTA PREVIA no exige pero el CONTRATO sí:
//   · tarifa/salida/moneda/configuración inválida → bloquea (regla A.4),
//     con el mensaje real del servicio interno (nunca uno fabricado aparte).
//   · el PVP recalculado difiere del PVP persistido en la cotización →
//     bloquea con mensaje de "recotiza" — NUNCA actualiza ni convierte con
//     el precio nuevo en silencio (regla A.5).
//   · proveedor del HOTEL ausente → bloquea (regla B.9.1): la vista previa
//     podía cotizar sin proveedor (`proveedorHotel: null` es un resultado
//     válido de `computarReservaBernalo`), el contrato no.
//   · algún servicio incluido con costo > 0 sin proveedor resuelto →
//     bloquea (regla B.9.2) — nunca "Sin especificar" para una obligación
//     financiera Bernalo (regla B.11).
// El proveedor AÉREO (si la salida es bloqueo/empaquetado) NO se valida
// aquí — regla B.9.3: se resuelve más abajo, en la creación, con la MISMA
// función que ya usa el flujo persona (`datosVueloBloqueo`/
// `datosVueloEmpaquetado`, `lib/reservar/empaquetadoOrigen.ts`), que
// tolera proveedor ausente exactamente como persona (fallback al nombre de
// la aerolínea) — no existe una regla más estricta y segura que inventar
// aquí, así que se reutiliza tal cual.
async function validarBernaloParaConversion(
  it: ItemCarritoBernaloConAsignacion,
  monedaCotizacion: string | null
): Promise<
  | { ok: true; resultado: ComputoReservaBernaloOk; proveedoresServicios: Map<number, ProveedorFilaCatalogo> }
  | { ok: false; error: string }
> {
  // Service-role propio (mismo criterio que `computarReservaBernalo`, que
  // tampoco recibe cliente por parámetro): esta validación corre en Paso 1,
  // ANTES de que este archivo confirme `SUPABASE_SERVICE_ROLE_KEY` (esa
  // verificación vive en Paso 2, ver más abajo) — nunca debe depender de
  // `admin`/`sb` del llamador, que en ese punto todavía podría ser el
  // cliente de sesión.
  const admin = createAdminClient();
  const resultado = await computarReservaBernalo({
    paqueteId: it.paqueteId,
    hotelId: it.hotelId,
    categoria: it.categoria,
    alimentacion: it.alimentacion,
    salida: it.salida,
    habitaciones: it.habitaciones,
  });
  if (!resultado.ok) {
    return { ok: false, error: `${it.hotelNombre}: ${resultado.mensaje}` };
  }

  // Regla A.5: el precio del carrito NUNCA es autoridad — pero un cambio
  // real (tarifa modificada, temporada vencida y reemplazada, etc.) tampoco
  // se acepta en silencio. Se corta y se pide recotizar, igual que hace el
  // checkout (Fase 3F-4A, regla B.10) — la diferencia es que acá ya no hay
  // "segunda confirmación" posible dentro de esta llamada: el asesor tiene
  // que volver al tarifario, rehacer la cotización y reintentar convertir.
  if (resultado.precioVenta !== it.precio) {
    return {
      ok: false,
      error: `${it.hotelNombre}: el precio cambió desde que se generó la cotización (antes ${it.precio}, ahora ${resultado.precioVenta} ${resultado.moneda}). Vuelve al tarifario, recotiza y genera una nueva cotización antes de convertir.`,
    };
  }

  // Hallazgo confirmado (cierre 3F-4B): el payload persistido de un ítem
  // Bernalo (`ItemCarritoBernaloPayload`) no guarda SU PROPIA moneda por
  // ítem — solo `cotizaciones.moneda` (la moneda ÚNICA declarada para TODA
  // la cotización, congelada al crearla en checkout/actions.ts). Comparar
  // solo el precio numérico no detecta un cambio de moneda (ej. el catálogo
  // pasó de COP a USD y el número coincidiera por coincidencia/redondeo) —
  // se exige la invariante explícita: la moneda recalculada de CADA ítem
  // Bernalo debe coincidir con la moneda declarada de la cotización.
  if (monedaCotizacion && resultado.moneda !== monedaCotizacion) {
    return {
      ok: false,
      error: `${resultado.hotelNombre}: la moneda cambió desde que se generó la cotización (antes ${monedaCotizacion}, ahora ${resultado.moneda}). Vuelve al tarifario, recotiza y genera una nueva cotización antes de convertir.`,
    };
  }

  // Cierre 3F-4B (hallazgo confirmado): un ítem Bernalo con salida "bloqueo"
  // o "empaquetado" implica un vuelo negociado/de sistema real — que en el
  // flujo persona SIEMPRE reserva cupo físico (`sillas`/inventario del
  // record) dentro de la MISMA transacción atómica que crea el contrato
  // (`crear_pasajeros_contrato_multi`). Bernalo todavía NO participa en esa
  // reserva de sillas (regla A.8 de la fase anterior: nunca se disfraza de
  // la forma persona-shaped que usa ese motor) — integrarlo exige tocar el
  // núcleo de inventario compartido con persona, fuera del alcance de este
  // cierre puntual. Convertir de todas formas emitiría el costo/CxP aéreo
  // correctos pero SIN decrementar ningún cupo real: sobreventa silenciosa
  // del mismo vuelo. Se bloquea explícito en vez de arriesgarlo — la
  // resolución correcta es la integración real con Reservar interno.
  if (resultado.salida.tipo !== "sin_vuelo") {
    return {
      ok: false,
      error: `${resultado.hotelNombre}: esta reserva usa una salida aérea negociada/de sistema (${resultado.salida.tipo}) — la conversión a contrato para hoteles Bernalo con vuelo todavía no reserva cupo real en el inventario de sillas y se bloquea para evitar sobreventa. Solo se puede convertir por ahora una cotización Bernalo de porción terrestre (sin vuelo). Contacta al equipo técnico para la integración con Reservar interno.`,
    };
  }

  // Regla B.9.1: proveedor del hotel OBLIGATORIO para el contrato (la vista
  // previa/cotización pública sí tolera `proveedorHotel: null`).
  if (!resultado.proveedorHotel?.nombre) {
    return {
      ok: false,
      error: `${resultado.hotelNombre}: este hotel no tiene proveedor configurado en el catálogo — no se puede convertir a contrato. Configura el proveedor del hotel e inténtalo de nuevo.`,
    };
  }

  // Regla B.9.2/B.10: cada servicio incluido con costo real requiere un
  // proveedor REAL resuelto server-side — nunca "Sin especificar" (B.11).
  const proveedoresServicios = new Map<number, ProveedorFilaCatalogo>();
  const idsServiciosConCosto = [...new Set(resultado.serviciosIncluidos.filter((s) => s.costoNeto > 0).map((s) => s.servicioId))];
  if (idsServiciosConCosto.length) {
    const { data: filasServicio, error: eServ } = await admin
      .from("servicios_adicionales")
      .select("id, nombre, proveedores(nombre, aplica_retencion, pct_retencion)")
      .in("id", idsServiciosConCosto);
    if (eServ) {
      return { ok: false, error: `${resultado.hotelNombre}: no se pudo validar el proveedor de los servicios incluidos (${eServ.message}).` };
    }
    for (const f of filasServicio ?? []) proveedoresServicios.set(f.id, f.proveedores as unknown as ProveedorFilaCatalogo);
    for (const s of resultado.serviciosIncluidos) {
      if (s.costoNeto <= 0) continue;
      if (!proveedoresServicios.get(s.servicioId)?.nombre) {
        return {
          ok: false,
          error: `${resultado.hotelNombre}: el servicio incluido "${s.nombre}" no tiene proveedor configurado con cuenta por pagar asociada — no se puede convertir a contrato. Configura su proveedor e inténtalo de nuevo.`,
        };
      }
    }
  }

  return { ok: true, resultado, proveedoresServicios };
}


// Rechazo de cotizaciones con `costoNeto` en el payload (ver convertirCotizacionCarrito).
const ERROR_COTIZACION_FORMATO_ANTERIOR =
  "Esta cotización se generó con un formato anterior que ya no se puede convertir de forma segura. Genera una cotización nueva desde el tarifario antes de convertirla.";

// `advertencias` en el retorno: mismo criterio que ReservaResult (ver su
// comentario) — hoy solo las llena el guardado best-effort de
// nombres/apellidos/nacionalidad.
export async function convertirCotizacionCarrito(
  id: number,
  opts: {
    agrupar: "todo" | "por_destino";
    pasajeros: PasajeroReserva[];
    asesorInterno?: string;
    // Una entrada por ítem, en el MISMO orden que `cotizaciones.payload.items`
    // (nunca por conteo/prefijo — ver `ItemCarritoConAsignacion` arriba).
    asignaciones: number[][];
    // Una entrada por tour, en el MISMO orden que `cotizaciones.payload.tours`
    // — B17 (ronda 6): los tours también participan en la asignación
    // explícita, nunca heredan en silencio los pasajeros del hotel ni todos.
    asignacionesTours: number[][];
    /** 235 (#90 F): moneda de COBRO elegida (OBLIGATORIA, COP o USD) y su TRM (solo si difiere de la moneda de la cotización). Una sola para todos los contratos. */
    monedaCobro?: string | null;
    trmCobro?: number | string | null;
    /** 236 (#90 I): TRM de COSTOS (pesos por dólar). Solo se exige —y solo se guarda— si alguna obligación positiva con proveedores está en USD. Distinta de la TRM de cobro. */
    trmCosto?: number | string | null;
  }
): Promise<{ ok: true; numeros: string[]; advertencias?: string[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("id, estado, tipo, payload, tenant, numero_contrato, detalle, moneda, vigencia_hasta")
    .eq("id", id).eq("tipo", "carrito").maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  // Acceso PRIMERO (antes de revelar o devolver nada de la cotización, incluso si ya está convertida).
  // Sin tenant asignado no se convierte (ver migración 153 — nunca se asume
  // un tenant por defecto), y el caller debe tener acceso a esa agencia.
  if (!cot.tenant) return { ok: false, error: "Esta cotización no tiene agencia (tenant) asignada; no se puede convertir. Contacta a un administrador." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  // Capturado en una constante (en vez de reusar `cot.tenant` más abajo,
  // después de varios `await`): TypeScript no puede seguir garantizando el
  // `!cot.tenant` de arriba a través de llamadas intermedias.
  const tenantCotizacion = cot.tenant as Tenant;
  // #102: ¿es una venta B2B ASISTIDA? Los términos viven CONGELADOS en la cotización (`payload.b2bAsistido`); una cotización con ese bloque
  // jamás se convierte en contrato B2C. Bloque presente pero ilegible ⇒ falla cerrado. Quien convierte debe estar en la lista explícita de
  // roles (ni `control_vuelo` ni un aliado) y en la agencia Mayorista — igual que quien la creó; se exige ANTES de devolver o escribir nada.
  const lecturaB2B = leerPlanB2BDePayload(cot.payload);
  if (!lecturaB2B.ok) return { ok: false, error: lecturaB2B.error };
  const planB2BCot: PlanB2BCotizacion | null = lecturaB2B.plan;
  if (planB2BCot) {
    const actorB2B = await resolverActorAsistencia(sb);
    if (!actorB2B.ok) return { ok: false, error: actorB2B.error };
  }
  // 235 (#90 F): MONEDA DE COBRO. Se valida AQUÍ, en el servidor, antes de leer o escribir nada (el selector de la pantalla no basta): es obligatoria
  // y expresa —también si coincide con la moneda de la cotización—, solo el personal interno puede cobrar en la otra, y la otra exige una TRM positiva.
  const monedaOfertaCarrito = monedaOfertaDeCotizacion(cot.moneda, cot.payload);
  const { data: { user: actorCobro } } = await sb.auth.getUser();
  const { data: perfilCobro } = actorCobro ? await sb.from("usuarios").select("rol, activo").eq("id", actorCobro.id).maybeSingle() : { data: null };
  const esInternoCobro = perfilCobro?.activo === true && ROLES_INTERNOS.includes(perfilCobro.rol as never);
  const vEleccionCobro = validarEleccionCarrito({ monedaOferta: monedaOfertaCarrito, monedaCobro: opts.monedaCobro, trmCobro: opts.trmCobro, esInterno: esInternoCobro });
  if (!vEleccionCobro.ok) return { ok: false, error: vEleccionCobro.error };
  const eleccionCobro = vEleccionCobro.eleccion;
  // Hallazgo confirmado (cierre 3F-4B): mismo criterio que `convertirCotizacion`
  // (persona, un solo contrato) — si esta cotización YA quedó "convertida" en
  // un intento anterior, un reintento (doble clic, red lenta, etc.) NUNCA debe
  // volver a crear contratos/sillas/CxP: devuelve los números ya generados.
  const detalleExistente = (cot.detalle ?? {}) as { contratos?: unknown; contratosPorGrupo?: Record<string, string>; agrupar?: string };
  // 235: un REINTENTO no puede cambiar lo ya congelado (moneda ni TRM de cobro), ni siquiera si la cotización ya quedó convertida.
  const cmpCobro = compararConCongelado({
    eleccion: eleccionCobro,
    congelado: leerCobroCongelado(cot.detalle),
    hayContratos: Object.keys(detalleExistente.contratosPorGrupo ?? {}).length > 0
      || (Array.isArray(detalleExistente.contratos) && detalleExistente.contratos.length > 0) || !!cot.numero_contrato,
    monedaOferta: monedaOfertaCarrito,
  });
  if (!cmpCobro.ok) return { ok: false, error: cmpCobro.error };
  // 236 (#90 I): la TRM de costos congelada tampoco cambia en un reintento, aunque ya esté todo convertido o el grupo pendiente no genere CxP en USD.
  const cmpTrmCosto = compararTrmCostoConCongelada({ congelada: leerTrmCostoCongelada(cot.detalle), recibida: opts.trmCosto });
  if (!cmpTrmCosto.ok) return { ok: false, error: cmpTrmCosto.error };
  if (cot.estado === "convertida") {
    const contratosPrevios = Array.isArray(detalleExistente.contratos)
      ? (detalleExistente.contratos as unknown[]).filter((n): n is string => typeof n === "string")
      : [];
    if (contratosPrevios.length) return { ok: true, numeros: contratosPrevios };
    if (cot.numero_contrato) return { ok: true, numeros: [cot.numero_contrato] };
  }
  if (cot.estado === "descartada") return { ok: false, error: "La cotización está descartada; no se puede convertir." };
  // #40 E3: una abierta vencida no crea NINGÚN contrato nuevo (ni de los grupos pendientes de una conversión parcial): se rechaza antes de numerar,
  // reservar sillas o crear contrato/CxP/asientos. Los contratos ya creados no se tocan; una cotización completamente convertida ya salió arriba
  // con sus números, y al renovar la vigencia el reintento completa solo los grupos pendientes.
  if (cot.estado === "abierta" && cotizacionVencida(cot.vigencia_hasta, hoyBogota()))
    return { ok: false, error: MENSAJE_COTIZACION_VENCIDA };

  // Hallazgo confirmado (idempotencia, ronda 2): la clave de progreso por
  // grupo (`claveDeGrupo`, más abajo) sale de `grupo.destino`, que solo
  // existe porque `opts.agrupar` decidió CÓMO se armaron los grupos — "todo"
  // arma un único grupo con `destino: null`, "por_destino" arma uno por
  // destino real. Si un intento previo ya dejó progreso
  // (`contratosPorGrupo` no vacío) y el reintento llega con OTRO
  // `opts.agrupar`, la misma clave ("__sin_destino__" vs. un destino real, o
  // viceversa) dejaría de significar lo mismo — un ítem que antes vivía
  // "adentro" de un contrato ya creado podría terminar huérfano en un grupo
  // nuevo, o un grupo nuevo podría creerse "ya completo" por una clave que
  // en realidad es de otro modo. Se persiste el modo usado en
  // `detalle.agrupar` (ver más abajo) y un reintento con un modo distinto se
  // rechaza explícito — nunca intenta reconciliar las dos agrupaciones.
  const contratosPorGrupoExistente = detalleExistente.contratosPorGrupo ?? {};
  if (Object.keys(contratosPorGrupoExistente).length > 0 && detalleExistente.agrupar && detalleExistente.agrupar !== opts.agrupar) {
    return {
      ok: false,
      error: `Esta cotización ya tiene contratos creados agrupando por "${detalleExistente.agrupar}" — no se puede reintentar la conversión con un modo de agrupación distinto ("${opts.agrupar}"), cambiaría a qué contrato pertenece cada grupo ya creado. Vuelve a convertir con "${detalleExistente.agrupar}".`,
    };
  }


  const payload = (cot.payload ?? {}) as {
    items?: (ItemCarritoPayload | ItemCarritoBernaloPayload)[]; tours?: TourCarritoPayload[];
    // Servicios INCLUIDOS de cada paquete de hotel del carrito, congelados al
    // crear la cotización (checkout/actions.ts) — ausente en cotizaciones
    // creadas antes de este cambio (queda `[]`, nunca se inventa contenido).
    // Formato nuevo: identidad + huella del costo, sin costos ni proveedores.
    // Cotizaciones anteriores pueden traer `costoNeto`: si aparece, la
    // conversión se rechaza antes de escribir (ver más abajo), aunque coincida.
    serviciosIncluidos?: ServicioIncluidoGuardado[];
    cliente?: { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string };
  };
  const itemsCrudos = payload.items ?? [];
  const tours = payload.tours ?? [];
  const serviciosIncluidosCot = payload.serviciosIncluidos ?? [];
  // Formato anterior a PR #353: el payload guardaba el costo neto de los
  // incluidos (legible por `venta`). Esas cotizaciones NO se convierten —
  // aunque el costo coincida con el recalculado—: se rechazan aquí, antes de
  // cualquier escritura, con un mensaje sin datos internos. Un `costoNeto`
  // en el payload nuevo es igual de anómalo y corre la misma suerte.
  if (Array.isArray(serviciosIncluidosCot) && serviciosIncluidosCot.some((s) => s != null && typeof s === "object" && "costoNeto" in s)) {
    return { ok: false, error: ERROR_COTIZACION_FORMATO_ANTERIOR };
  }
  // Snapshot `detalle.hoteles[]` — SOLO se usa para copiar condiciones de
  // tarifa Dubai por referencia estable (`ref`, ver
  // lib/calc/condicionesTarifa.ts::resolverCondicionesTarifaParaConversion).
  // Nunca se consulta `tarifa_hotel` en esta función: el snapshot YA
  // congelado al crear la cotización es la única fuente — cambios
  // posteriores en el catálogo nunca deben alterar un contrato ya cotizado.
  const detalleHotelesSnap: HotelSnapConRef[] = (() => {
    const h = (cot.detalle as { hoteles?: unknown } | null)?.hoteles;
    return Array.isArray(h) ? (h as HotelSnapConRef[]) : [];
  })();
  const cliente = payload.cliente ?? { nombres: "", apellidos: "", numeroDoc: "", telefono: "", email: "" };
  if (!itemsCrudos.length && !tours.length) return { ok: false, error: "La cotización no tiene ítems." };

  // Fase 3F-4B, regla A.7: esta conversión YA sabe reliquidar/escribir un
  // ítem Bernalo (`hoteles.modelo_tarifario = "unidad"`, marcado en el
  // payload con `modeloTarifario: "unidad"` desde checkout/actions.ts,
  // Fase 3F-4A) — el bloqueo genérico de 3F-4A se retira. El "Reservar"
  // interno (formulario `/dashboard/reservar/nuevo`) sigue bloqueado sin
  // cambios: su guardia vive en `lib/reservar/computo.ts` (regla D.16/
  // "Reservar interno continúa bloqueado" de este encargo), un archivo que
  // esta fase no toca.

  if (!opts.pasajeros.length) return { ok: false, error: "Captura los pasajeros antes de generar el contrato." };

  // ── Validar `opts.asignaciones` (B11): una entrada por ítem, posiciones
  // 1-based dentro de `opts.pasajeros`, sin duplicados DENTRO del mismo
  // ítem (duplicados ENTRE ítems distintos sí son válidos — el mismo grupo
  // de personas puede viajar en más de un ítem/bloqueo), y el conteo debe
  // coincidir con `it.pax` (la composición de habitaciones/tarifa de ese
  // ítem se calculó para ese número exacto de personas). ──────────────────
  if (!Array.isArray(opts.asignaciones) || opts.asignaciones.length !== itemsCrudos.length) {
    return { ok: false, error: "La asignación de pasajeros no coincide con los ítems del carrito. Vuelve a cargar la página e inténtalo de nuevo." };
  }
  const items: ItemCarritoConAsignacion[] = [];
  for (let i = 0; i < itemsCrudos.length; i++) {
    const it = itemsCrudos[i];
    const posiciones = opts.asignaciones[i];
    if (!Array.isArray(posiciones) || posiciones.length === 0) {
      return { ok: false, error: `${it.hotelNombre}: selecciona qué pasajeros viajan en este ítem.` };
    }
    if (it.pax > 0 && posiciones.length !== it.pax) {
      return { ok: false, error: `${it.hotelNombre}: la cantidad de pasajeros asignados (${posiciones.length}) no coincide con la cantidad esperada (${it.pax}).` };
    }
    const vistos = new Set<number>();
    for (const pos of posiciones) {
      if (!Number.isInteger(pos) || pos < 1 || pos > opts.pasajeros.length) {
        return { ok: false, error: `${it.hotelNombre}: una posición de pasajero asignada es inválida.` };
      }
      if (vistos.has(pos)) {
        return { ok: false, error: `${it.hotelNombre}: un mismo pasajero está asignado dos veces al mismo ítem.` };
      }
      vistos.add(pos);
    }
    items.push({ ...it, __posiciones: posiciones });
  }

  // ── Validar `opts.asignacionesTours` (B17, ronda 6): misma forma que los
  // ítems — una entrada por tour, posiciones 1-based, sin duplicados dentro
  // del mismo tour, conteo = `tour.pax`. Los tours NO reservan silla, así
  // que no participan en la consolidación de sillas (B14/B15) — pero SÍ en
  // el universo del contrato y en `ventas.pax` (un pasajero puede viajar solo
  // en un tour). ─────────────────────────────────────────────────────────
  if (!Array.isArray(opts.asignacionesTours) || opts.asignacionesTours.length !== tours.length) {
    return { ok: false, error: "La asignación de pasajeros de los tours no coincide con el carrito. Vuelve a cargar la página e inténtalo de nuevo." };
  }
  const toursAsign: TourCarritoConAsignacion[] = [];
  for (let i = 0; i < tours.length; i++) {
    const t = tours[i];
    const posiciones = opts.asignacionesTours[i];
    if (!Array.isArray(posiciones) || posiciones.length === 0) {
      return { ok: false, error: `${t.nombre}: selecciona qué pasajeros viajan en este tour.` };
    }
    if (t.pax > 0 && posiciones.length !== t.pax) {
      return { ok: false, error: `${t.nombre}: la cantidad de pasajeros asignados (${posiciones.length}) no coincide con la cantidad esperada (${t.pax}).` };
    }
    const vistos = new Set<number>();
    for (const pos of posiciones) {
      if (!Number.isInteger(pos) || pos < 1 || pos > opts.pasajeros.length) {
        return { ok: false, error: `${t.nombre}: una posición de pasajero asignada es inválida.` };
      }
      if (vistos.has(pos)) {
        return { ok: false, error: `${t.nombre}: un mismo pasajero está asignado dos veces al mismo tour.` };
      }
      vistos.add(pos);
    }
    toursAsign.push({ ...t, __posiciones: posiciones, __idx: i });
  }

  // Ningún pasajero del universo declarado puede quedar sin viajar en NINGUNA
  // unidad —ítem (hotel/bloqueo) o tour— del carrito (B12 + B17, ronda 6): si
  // alguien no participa en nada, o el universo se dimensionó mal (persona de
  // más), o se olvidó marcarlo; ninguno es correcto guardarlo en silencio.
  // Ya no hay excepción por "solo tours": los tours ahora también llevan
  // asignación explícita, así que SIEMPRE hay unidades contra las cuales
  // validar (el carrito exige ≥1 ítem o tour, chequeado arriba).
  const posicionesTodasUnidades = [...items.map((it) => it.__posiciones), ...toursAsign.map((t) => t.__posiciones)];
  const sinAsignar = posicionesSinAsignar(posicionesTodasUnidades, opts.pasajeros.length);
  if (sinAsignar.length) {
    return { ok: false, error: `El pasajero ${sinAsignar[0]} no está asignado a ninguna unidad del carrito (ni hotel ni tour). Márcalo en al menos una o quítalo del listado.` };
  }

  // Servicios elegidos en la tarjeta de un hotel (`hotelRef` persistido por
  // el checkout): el vínculo se valida ANTES de escribir nada — un vínculo
  // inválido rechaza la conversión, nunca se adivina el hotel. Sus pasajeros
  // deben viajar en ESE hotel (subconjunto, no solo la misma cantidad).
  // Cotizaciones anteriores / tours de Receptivos: sin `hotelRef`, nada cambia.
  const vVinculos = resolverVinculosCotizacion(tours, itemsCrudos);
  if (!vVinculos.ok) return { ok: false, error: vVinculos.error };
  const hotelDeTour = vVinculos.hotelDeTour;
  const errPasajerosVinculados = validarPasajerosServiciosVinculados({
    asignacionesItems: items.map((it) => it.__posiciones),
    asignacionesTours: toursAsign.map((t) => t.__posiciones),
    hotelDeTour,
    nombresItems: items.map((it) => it.hotelNombre),
    nombresTours: toursAsign.map((t) => t.nombre),
  });
  if (errPasajerosVinculados) return { ok: false, error: errPasajerosVinculados };

  type Grupo = { destino: string | null; items: ItemCarritoConAsignacion[]; tours: TourCarritoConAsignacion[] };
  // "todo": un solo contrato. "por_destino": agrupa por destino TANTO
  // hoteles como tours independientes — un destino que solo tenga tours
  // forma su propio contrato (B17), nunca se cuelga en silencio del grupo
  // del primer hotel. Un servicio VINCULADO va SIEMPRE al contrato de su
  // hotel, aunque su texto de destino sea distinto (mayúsculas, tildes,
  // null): nunca queda separado de su hotel. Misma función que usa la
  // vista previa (ConvertirCarritoBtn).
  const grupos: Grupo[] = armarGruposConversion<ItemCarritoConAsignacion, TourCarritoConAsignacion>({
    modo: opts.agrupar, items, tours: toursAsign, hotelDeTour,
  });

  // W8 (§6.8): sin la clave de servicio no se puede crear la reserva. Antes
  // había aquí un respaldo al cliente de SESIÓN que nunca llegaba a escribir
  // (más abajo ya se cortaba con este mismo mensaje antes de la primera
  // escritura); ahora el corte va primero y el cliente es siempre el admin.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "No se pudo crear la reserva (configuración del servidor incompleta)." };
  }
  const admin = createAdminClient();

  // Hallazgo confirmado (idempotencia, ronda 2): un grupo que YA generó su
  // contrato en un intento anterior se salta ANTES de reliquidar/validar sus
  // ítems — nunca solo antes de escribir (como quedó en la ronda 1). Un
  // grupo completo no debe poder bloquear el reintento porque su precio,
  // moneda o proveedor cambiaron DESPUÉS de convertirlo (ese contrato ya es
  // un hecho consumado; no hay nada que re-decidir sobre él). `numeros` se
  // siembra aquí mismo con los contratos que ya existían, en el mismo orden
  // que `grupos`.
  const claveDeGrupo = (g: Grupo) => g.destino ?? "__sin_destino__";
  const contratosPorGrupo: Record<string, string> = { ...contratosPorGrupoExistente };
  // 235: la elección de cobro viaja en CADA escritura de progreso, así que queda congelada desde el primer contrato (los reintentos la comparan arriba).
  const detalleBase = { ...((cot.detalle ?? {}) as Record<string, unknown>), cobro: { moneda: eleccionCobro.monedaCobro, trm: eleccionCobro.trmCobro } } as Record<string, unknown>;
  const numeros: string[] = [];
  // Fallas NO bloqueantes acumuladas de TODOS los grupos/contratos de este
  // carrito — mismo criterio que ReservaResult, ver su comentario.
  const advertencias: string[] = [];
  for (const grupo of grupos) {
    const numeroExistente = contratosPorGrupo[claveDeGrupo(grupo)];
    if (numeroExistente) numeros.push(numeroExistente);
  }
  const gruposPendientes = grupos.filter((g) => !contratosPorGrupo[claveDeGrupo(g)]);

  // #102: con grupos por convertir, el aliado de HOY (existe, activo, mismo tipo, mismo %) debe ser el congelado. Si cambió, se rechaza
  // ANTES de reliquidar o numerar nada: nunca se recalcula la comisión en silencio con otro porcentaje. Un grupo ya convertido no se
  // vuelve a juzgar (ese contrato es un hecho consumado).
  // Identidad fiscal del ALIADO tal como está HOY en el catálogo (nunca del snapshot de la cotización): es el cliente del contrato en NETO.
  let fiscalAliadoVivo: FiscalAliado | null = null;
  if (planB2BCot && gruposPendientes.length) {
    // Cobertura exacta del congelado: las unidades de TODOS los grupos (también los ya convertidos, para que el reintento verifique el conjunto
    // completo) deben ser, una vez cada una, las líneas del plan. Una unidad faltante, repetida o ajena se rechaza antes de numerar.
    const cobertura = verificarCoberturaLineasB2B(
      planB2BCot,
      grupos.map((g) => [...g.items.map((it) => it.ref ?? ""), ...g.tours.map((t) => `tour-${t.__idx}`)]),
    );
    if (!cobertura.ok) return { ok: false, error: cobertura.error };
    const aliadoVivo = await verificarAliadoVivoParaConversion(sb, planB2BCot);
    if (!aliadoVivo.ok) return { ok: false, error: aliadoVivo.error };
    fiscalAliadoVivo = aliadoVivo.aliado.fiscal;
  }
  // Quien firma como «elaboró»: el asesor elegido en pantalla o, si no se eligió (p. ej. superadmin), el usuario interno autenticado. Nunca se inventa.
  const firmaConversion = nombreQuienElabora(opts.asesorInterno, (await resolverFirmasSesion(sb)).elabora);
  // Plan B2B de cada contrato por crear (con los términos CONGELADOS y el PVP/impuesto VIVOS de sus unidades, ya comparados).
  const planesB2BPorGrupo = new Map<string, PlanComisionReserva>();

  // ── Paso 1: validar TODO (precio autoritativo + cupos) antes de insertar ──
  // Fase 3F-4B: cada ítem se despacha por `modeloTarifario` a su propio
  // camino de validación — persona sigue exactamente igual
  // (`validadosPersona`); Bernalo re-liquida con `computarReservaBernalo` y
  // aplica las guardias de proveedor/PVP de `validarBernaloParaConversion`
  // (`validadosBernalo`). Mantenerlos en arreglos SEPARADOS (en vez de una
  // unión etiquetada mezclada) evita reintroducir un cast en
  // `reservasSillasDeGrupo`/el resto del código persona, que sigue
  // recibiendo EXACTAMENTE la misma forma que antes (regla A.16). Solo se
  // valida `gruposPendientes` — los grupos ya convertidos ni se tocan.
  type ValidadoBernalo = { item: ItemCarritoBernaloConAsignacion; resultado: ComputoReservaBernaloOk; proveedoresServicios: Map<number, ProveedorFilaCatalogo> };
  const gruposValidados: {
    grupo: Grupo;
    validadosPersona: { item: ItemCarritoPersonaConAsignacion; comp: ComputoReserva; incluidos: ServicioEfectivo[] }[];
    validadosBernalo: ValidadoBernalo[];
  }[] = [];
  for (const grupo of gruposPendientes) {
    const validadosPersona: { item: ItemCarritoPersonaConAsignacion; comp: ComputoReserva; incluidos: ServicioEfectivo[] }[] = [];
    const validadosBernalo: ValidadoBernalo[] = [];
    for (const it of grupo.items) {
      // Regla A.1/A.2/A.8: SOLO las decisiones guardadas se reconstruyen —
      // nunca se arma un `ReservaInput` persona-shaped para un ítem Bernalo.
      if (it.modeloTarifario === "unidad") {
        const rBernalo = await validarBernaloParaConversion(it, cot.moneda ?? null);
        if (!rBernalo.ok) return { ok: false, error: rBernalo.error };
        validadosBernalo.push({ item: it, resultado: rBernalo.resultado, proveedoresServicios: rBernalo.proveedoresServicios });
        continue;
      }
      // Salida dinámica cotizada en el carrito público: esta conversión no arma su vuelo por sistema todavía — falla cerrada y explícita.
      if ((it.modulo as string) === "dinamico") return { ok: false, error: `${it.hotelNombre}: es una salida dinámica; genera su contrato desde Reservar (módulo dinámico).` };
      const reserva: ReservaInput = {
        paqueteId: it.paqueteId, bloqueoId: it.bloqueoId, modulo: it.modulo, hotelId: it.hotelId,
        fechaIda: it.modulo !== "bloqueo" ? (it.fechaIda ?? undefined) : undefined,
        fechaRegreso: it.modulo !== "bloqueo" ? (it.fechaRegreso ?? undefined) : undefined,
        categoria: it.categoria, regimen: it.regimen, habitaciones: it.habitaciones,
        ninos: it.ninos, ninos2: it.ninos2, infantes: it.infantes || 0,
        cliente: { nombres: cliente.nombres, apellidos: cliente.apellidos, tipoDoc: "CC", numeroDoc: cliente.numeroDoc, telefono: cliente.telefono, email: cliente.email },
        tipoAsesor: "interno", asesorInterno: opts.asesorInterno || "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
        // Cada ítem valida EXACTAMENTE con SUS pasajeros asignados (B11,
        // ronda 3) — nunca un prefijo adivinado por conteo: el carrito
        // (lib/cart/CartContext.tsx) agrega ítems de forma independiente,
        // cada uno con su propio `pax`, sin ninguna garantía de que
        // compartan el mismo subconjunto de `opts.pasajeros`.
        aliadoId: null, plazo: "", pasajeros: it.__posiciones.map((pos) => opts.pasajeros[pos - 1]), servicios: [],
      };
      const comp = await computarReserva(sb, reserva);
      if (!comp.ok) return { ok: false, error: `${it.hotelNombre}: ${comp.error}` };
      // Hallazgo confirmado (P2-1): mismo criterio que la guarda de moneda de
      // `validarBernaloParaConversion` — `cotizaciones.moneda` es la moneda
      // ÚNICA congelada para TODA la cotización (persona + Bernalo mixtos
      // incluidos). Sin este chequeo, un ítem persona cuya moneda cambió
      // desde que se cotizó (catálogo re-configurado de COP a USD, etc.)
      // podía terminar estampando `ventas.moneda` con una moneda distinta a
      // la de un ítem Bernalo del MISMO contrato — un contrato con dos
      // monedas mezcladas en silencio. Se bloquea ANTES de acumular el ítem,
      // con el mismo mensaje de "recotiza" que usa Bernalo.
      if (cot.moneda && comp.data.monedaReserva !== cot.moneda) {
        return {
          ok: false,
          error: `${it.hotelNombre}: la moneda cambió desde que se generó la cotización (antes ${cot.moneda}, ahora ${comp.data.monedaReserva}). Vuelve al tarifario, recotiza y genera una nueva cotización antes de convertir.`,
        };
      }
      // La capacidad de sillas ya NO se valida por ÍTEM aquí (B21, ronda 8): el
      // RPC reserva la UNIÓN consolidada por bloqueo, no la suma por ítem, así
      // que un chequeo por ítem daba falsos OK (ej. 3 sillas y dos ítems
      // disjuntos de 2 personas sobre el mismo bloqueo: cada ítem pasa 2≤3,
      // pero la demanda real consolidada es 4). Se valida la demanda
      // consolidada de TODA la operación en la pre-validación de más abajo,
      // antes de escribir nada.
      // Servicios INCLUIDOS del paquete: costo y proveedor se resuelven OTRA
      // VEZ en el servidor (`comp.data.serviciosIncluidos`) y se validan
      // contra lo cotizado — hotel (`ref`), paquete, fechas, pasajeros,
      // conjunto de servicios y huella del costo — ANTES de escribir nada.
      // Discrepancia o dato faltante → falla cerrado (nunca un costo del
      // payload ni del navegador, nunca una sustitución silenciosa).
      const hotelCotizado = detalleHotelesSnap.find((h) => it.ref != null && h.ref === it.ref) as { fecha_ingreso?: string | null; fecha_salida?: string | null } | undefined;
      const vIncluidos = validarIncluidosConversion({
        hotelNombre: it.hotelNombre,
        item: { ref: it.ref ?? null, paqueteId: it.paqueteId, pax: it.pax },
        fechasCotizadas: hotelCotizado ? { ida: hotelCotizado.fecha_ingreso ?? null, regreso: hotelCotizado.fecha_salida ?? null } : null,
        recalculo: {
          totalPax: comp.data.totalPax, fechaIda: comp.data.meta.fecha_ida, fechaRegreso: comp.data.meta.fecha_regreso,
          incluidos: comp.data.serviciosIncluidos,
        },
        guardados: serviciosIncluidosCot,
        clave: claveHuellaIncluidos(process.env.SUPABASE_SERVICE_ROLE_KEY),
      });
      if (!vIncluidos.ok) return { ok: false, error: vIncluidos.error };
      validadosPersona.push({ item: it, comp: comp.data, incluidos: vIncluidos.incluidos });
    }
    // #102: cada unidad del grupo debe valer EXACTAMENTE lo congelado en la cotización (PVP e impuesto). Si el precio, el impuesto o la
    // moneda cambiaron después de cotizar, se rechaza antes de numerar. Bernalo no genera impuesto; los tours conservan su PVP cotizado.
    if (planB2BCot) {
      const vivas: LineaB2B[] = [
        ...validadosPersona.map((v) => ({ clave: v.item.ref ?? "", pvp: v.comp.precioVenta, impuesto: v.comp.impuestoTotal })),
        ...validadosBernalo.map((v) => ({ clave: v.item.ref ?? "", pvp: v.resultado.precioVenta, impuesto: 0 })),
        ...grupo.tours.map((t) => ({ clave: `tour-${t.__idx}`, pvp: t.precio, impuesto: 0 })),
      ];
      const cmpLineas = compararLineasConCongeladas(planB2BCot, vivas, cot.moneda ?? "");
      if (!cmpLineas.ok) return { ok: false, error: cmpLineas.error };
      const pg = planDeGrupoB2B(planB2BCot, vivas);
      if (!pg.ok) return { ok: false, error: pg.error };
      planesB2BPorGrupo.set(claveDeGrupo(grupo), pg.plan);
    }
    gruposValidados.push({ grupo, validadosPersona, validadosBernalo });
  }

  // ── Paso 2: crear un contrato por grupo, con TODOS sus hoteles/tours ──────
  // `numeros` ya viene sembrado (arriba) con los contratos de grupos que
  // esta misma llamada saltó por estar ya convertidos.
  const OBS_AUTO = "Generado automáticamente desde el carrito (tarifario)";

  // Usuario real de la sesión — resuelto UNA vez para todos los grupos.
  // Antes solo alimentaba el congelado de condiciones (best-effort); ahora
  // TAMBIÉN es el actor exigido por `crear_pasajeros_contrato_multi`
  // (revisión de alto riesgo, ronda 3 — B6): a diferencia del congelado de
  // condiciones, sin usuario real y activo NO se puede crear el contrato en
  // absoluto (mismo candado que crear_pasajeros_contrato de un solo
  // bloqueo) — la creación de pasajeros nunca puede quedar "sin autor".
  const { data: { user: usuarioCond } } = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await sb.auth.getUser()
    : { data: { user: null } };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "No se pudo crear la reserva (configuración del servidor incompleta)." };
  }
  if (!usuarioCond) {
    return { ok: false, error: "Sesión inválida: no se pudo confirmar el usuario para crear el contrato." };
  }

  // ── B23: la referencia de edad la fija el RELOJ DE LA BASE, no el de este
  // proceso. Antes se calculaba aquí un `hoyISO` con `new Date()` y se le
  // inyectaba a Postgres (`p_fecha_referencia_fallback`) para que la
  // prevalidación y la escritura decidieran igual. Ese parámetro se eliminó:
  // una fecha que viaja desde fuera es una fecha que se puede elegir, y en un
  // cumpleaños de frontera un solo día cambia si alguien es infante (y por
  // tanto si exige responsable, y si consume silla). Ahora la dirección se
  // invierte — se LEE `current_date` de Postgres UNA vez y se prevalida con
  // él, que es exactamente el valor que usará
  // `_fecha_referencia_efectiva` al escribir cuando el contrato quede sin
  // `fecha_salida`.
  //
  // Falla CERRADO a propósito: si no se puede leer el reloj de la base, se
  // aborta en vez de caer al reloj de Node — ese respaldo silencioso es
  // justamente la divergencia que este cambio elimina.
  const { data: fechaServidor, error: errFechaServidor } = await createAdminClient()
    .rpc("fecha_referencia_servidor");
  if (errFechaServidor || typeof fechaServidor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fechaServidor)) {
    return { ok: false, error: "No se pudo resolver la fecha de referencia del servidor. Inténtalo de nuevo." };
  }
  const hoyServidor: string = fechaServidor;

  // ── PRE-VALIDACIÓN de TODOS los grupos ANTES de crear NINGÚN contrato
  // (B18/B20/B21). Todo lo PREVISIBLE (responsables y capacidad) se decide aquí,
  // en seco, con las MISMAS funciones puras y datos que usará la creación
  // (deterministas), y se aborta antes de generar el primer número o escribir
  // una sola fila — así un error esperable no deja un primer contrato escrito
  // cuando falla el segundo. La autoridad concurrente final sigue siendo el RPC
  // (candado `for update`); esto solo mejora el mensaje y evita la escritura
  // parcial. `demandaPorBloqueo` acumula la demanda consolidada de TODA la
  // operación (B21): cada contrato reserva por separado, así que un bloqueo
  // usado por varios grupos suma su demanda, no se valida grupo por grupo.
  const pre: { ok: false; error: string } | { ok: true; demanda: Map<number, number> } = (() => {
    const reservasPorGrupo: ReservaSillasPorBloqueo[][] = [];
    for (const { grupo, validadosPersona, validadosBernalo } of gruposValidados) {
      // Bernalo aporta su fecha RESUELTA (`resultado.salida`, autoritativa —
      // nunca la del ítem crudo) a la referencia de edad del grupo, pero
      // NUNCA participa en `reservasSillasDeGrupo` más abajo (regla A.8: no
      // se disfraza de `ReservaInput` persona-shaped, y esta fase no integra
      // Bernalo con el inventario de sillas — ver "riesgos residuales").
      const fechasIdaPre = [
        ...validadosPersona.map((v) => v.comp.meta.fecha_ida),
        ...validadosBernalo.map((v) => v.resultado.salida.fechaIda),
        ...grupo.tours.map((t) => t.fechaIda),
      ].filter((f): f is string => !!f).sort();
      // B-fix (fecha_salida NULL, revisión de Opus ronda 9): si este grupo no
      // tiene NINGUNA unidad con fecha (porción terrestre/tours sin fecha),
      // `ventas.fecha_salida` va a quedar en `null` (eso NO cambia — ver más
      // abajo) — pero la CLASIFICACIÓN de edad no puede quedarse sin
      // referencia ni inventar la suya por separado en cada función pura:
      // `hoyServidor` (leído UNA sola vez del reloj de Postgres, arriba) es
      // exactamente el `current_date` con el que la base va a decidir al
      // escribir, así que la prevalidación de aquí y la escritura real
      // concluyen lo mismo — sin que la app le imponga ninguna fecha a la
      // base (B23) y sin que cada función pura invente su propio "hoy".
      const fechaRefPre = fechasIdaPre[0] ?? hoyServidor;
      const posGrupoPre = posicionesUnicasDeGrupo(
        [...grupo.items.map((it) => it.__posiciones), ...grupo.tours.map((t) => t.__posiciones)],
        [...grupo.items, ...grupo.tours].map((_, i) => i)
      );
      const universoPre = posGrupoPre.length ? posGrupoPre : opts.pasajeros.map((_, i) => i + 1);
      // B18/B20 — validación COMPLETA del vínculo responsable dentro de ESTE
      // contrato (cruza-contrato, infante sin responsable, autorreferencia,
      // responsable CHD/infante/menor de edad), vía la MISMA función de
      // orquestación compartida que usa cualquier otra verificación de este
      // tipo (`prevalidarResponsablesDeGrupo`, `lib/reservar/
      // carritoAsignaciones.ts`) — no una reconstrucción inline del pipeline
      // que pudiera divergir en silencio.
      const respPre = prevalidarResponsablesDeGrupo(opts.pasajeros, universoPre, fechaRefPre);
      if (!respPre.ok) {
        return { ok: false, error: mensajePrevalidacionGrupo(respPre) };
      }
      // B21 — mismas reservas consolidadas que recibirá el RPC de este grupo.
      // Recalcula normalización/reindexado (mismas funciones puras, mismos
      // datos que acaba de usar `prevalidarResponsablesDeGrupo` arriba) porque
      // esta parte necesita además `mapaGlobalALocal`/los pasajeros
      // normalizados para armar las reservas de sillas — la validación de
      // responsables de arriba ya garantiza que esto no puede fallar aquí.
      const pasajerosNormPre = normalizarResponsablesPorGrupo(opts.pasajeros, fechaRefPre);
      const { mapaGlobalALocal: mapaPre } = reindexarGrupoLocal(pasajerosNormPre, universoPre);
      reservasPorGrupo.push(reservasSillasDeGrupo(validadosPersona, mapaPre, pasajerosNormPre, fechaRefPre));
    }
    return { ok: true, demanda: demandaSillasPorBloqueo(reservasPorGrupo) };
  })();
  if (!pre.ok) return { ok: false, error: pre.error };
  const demandaPorBloqueo = pre.demanda;

  // B21 — cupos: se consulta la disponibilidad UNA vez por bloqueo (unión de
  // los que pide toda la operación) y se compara con la demanda consolidada
  // ACUMULADA. Falla cerrado (un bloqueo sin fila de disponibilidad cuenta
  // como 0). El RPC vuelve a verificarlo bajo candado por si cambia entre esta
  // lectura y la escritura.
  if (demandaPorBloqueo.size) {
    const disponiblesPorBloqueo = new Map<number, number>();
    // Misma definición de silla libre que el RPC (`_silla_libre`, migración 201).
    for (const bloqueoId of demandaPorBloqueo.keys()) {
      const { data: cup } = await admin.from("cupos_por_bloqueo").select("cupos_disponibles")
        .eq("id", bloqueoId).maybeSingle();
      disponiblesPorBloqueo.set(bloqueoId, Number(cup?.cupos_disponibles) || 0);
    }
    const faltante = faltanteDeCupos(demandaPorBloqueo, disponiblesPorBloqueo);
    if (faltante) {
      return { ok: false, error: `No hay cupos suficientes en el bloqueo (disponibles: ${faltante.disponibles}, requeridos por esta operación: ${faltante.demanda}). No se creó ningún contrato.` };
    }
  }

  // Moneda de la OFERTA de los contratos (#90 F): todas las unidades de cada grupo —hoteles Y tours— deben coincidir con la de la cotización. Se valida
  // para TODOS los grupos pendientes ANTES de numerar o escribir el primero, y nunca se suman importes de monedas distintas. Un grupo de solo tours
  // toma la moneda de la cotización (antes caía en COP). La elección de cobro se revalida contra esta moneda si la cotización no la traía.
  const rMoneda = resolverMonedaOferta({
    monedaCotizacion: cot.moneda,
    grupos: gruposValidados.map(({ grupo, validadosPersona, validadosBernalo }) => ({
      etiqueta: grupo.destino ?? "",
      unidades: [
        ...validadosPersona.map((v) => ({ origen: v.item.hotelNombre, moneda: v.comp.monedaReserva })),
        ...validadosBernalo.map((v) => ({ origen: v.item.hotelNombre, moneda: v.resultado.moneda })),
        ...grupo.tours.map((t) => ({ origen: t.nombre, moneda: t.moneda })),
      ],
    })),
  });
  if (!rMoneda.ok) return { ok: false, error: rMoneda.error };
  const monedaOfertaConversion = rMoneda.moneda;
  // #102: la moneda con la que se congelaron los términos B2B debe ser la de la conversión (nunca se mezclan ni se reinterpretan importes).
  if (planB2BCot && monedaOfertaConversion !== planB2BCot.moneda) return { ok: false, error: MENSAJE_TERMINOS_CAMBIARON };
  if (monedaOfertaConversion !== (monedaOfertaCarrito === "USD" ? "USD" : "COP")) {
    const revalidada = validarEleccionCarrito({ monedaOferta: monedaOfertaConversion, monedaCobro: opts.monedaCobro, trmCobro: opts.trmCobro, esInterno: esInternoCobro });
    if (!revalidada.ok) return { ok: false, error: revalidada.error };
    if (revalidada.eleccion.monedaCobro !== eleccionCobro.monedaCobro || revalidada.eleccion.trmCobro !== eleccionCobro.trmCobro) {
      return { ok: false, error: "La moneda de la cotización no coincide con la de sus unidades; recotiza el carrito antes de elegir la moneda de cobro." };
    }
  }

  // Obligaciones (CxP) de la conversión (#90 F): moneda REAL de cada costo, verificada ANTES de numerar o escribir — SOLO de las CxP que realmente se
  // crearían con importe positivo. El costo de cada una sale de las MISMAS funciones y condiciones que la creación (lib/reservar/costosObligacionesCarrito.ts
  // + `obligacionPositiva`, la misma que usa `pushCxP`), así que un costo USD en cero no bloquea y uno positivo sí. La ruta financiera vigente devenga una CxP
  // sin marca de oferta #63 por su valor nominal: una obligación en USD se contabilizaría como pesos. Mientras no exista el equivalente en COP para el
  // carrito, cualquier obligación positiva en USD (o de moneda indeterminable en un contrato USD) detiene la conversión, sin tocar ningún importe.
  const idsServiciosObl = new Set<number>();
  const idsBloqueosObl = new Set<number>();
  for (const { grupo, validadosPersona } of gruposValidados) {
    for (const t of grupo.tours) if (t.servicioId != null && t.paqueteId != null) idsServiciosObl.add(t.servicioId);
    for (const v of validadosPersona) {
      for (const sv of v.incluidos) idsServiciosObl.add(sv.servicioId);
      if (v.item.modulo === "bloqueo" && v.item.bloqueoId) idsBloqueosObl.add(v.item.bloqueoId);
    }
  }
  const monedaServicio = new Map<number, unknown>();
  if (idsServiciosObl.size) {
    const { data: filas, error: errMon } = await admin.from("servicios_adicionales").select("id, moneda").in("id", [...idsServiciosObl]);
    if (errMon) return { ok: false, error: "No se pudo verificar la moneda de los servicios del carrito; no se crea ningún contrato. Intenta de nuevo." };
    for (const r of filas ?? []) monedaServicio.set(r.id as number, (r as { moneda?: unknown }).moneda);
  }
  const bloqueosObl = new Map<number, { moneda: unknown; tarifa_para_empaquetar: unknown; fee_infante: unknown }>();
  if (idsBloqueosObl.size) {
    const { data: filas, error: errMon } = await admin.from("bloqueos_vuelo").select("id, moneda, tarifa_para_empaquetar, fee_infante").in("id", [...idsBloqueosObl]);
    if (errMon) return { ok: false, error: "No se pudo verificar la moneda de los vuelos del carrito; no se crea ningún contrato. Intenta de nuevo." };
    for (const r of filas ?? []) bloqueosObl.set(r.id as number, r as unknown as { moneda: unknown; tarifa_para_empaquetar: unknown; fee_infante: unknown });
  }
  let requiereTrmCosto = false;
  for (const { grupo, validadosPersona, validadosBernalo } of gruposValidados) {
    const obligaciones: Obligacion[] = [];
    for (const v of validadosPersona) {
      const { numMenoresDeDos, numInfantes } = menoresDelComputo(v.comp, { infantesDeclarados: v.item.infantes || 0 });
      obligaciones.push({ origen: `Hotel ${v.comp.meta.hotel_nombre ?? v.item.hotelNombre}`, moneda: v.comp.monedaReserva, valor: costoHotelPersona(v.comp, numInfantes) });
      const bq = v.item.modulo === "bloqueo" && v.item.bloqueoId ? bloqueosObl.get(v.item.bloqueoId) : undefined;
      if (bq) obligaciones.push({ origen: `Vuelo de ${v.item.hotelNombre}`, moneda: bq.moneda, valor: costoAereoBloqueo(bq, v.comp.paxConSilla, numMenoresDeDos) });
      for (const sv of v.incluidos) obligaciones.push({ origen: sv.nombre, moneda: monedaServicio.get(sv.servicioId), valor: sv.costoNeto });
    }
    for (const v of validadosBernalo) {
      const res = v.resultado;
      obligaciones.push({ origen: `Hotel ${v.item.hotelNombre}`, moneda: res.moneda, valor: res.costoHotelTotal });
      for (const sv of res.serviciosIncluidos) obligaciones.push({ origen: sv.nombre, moneda: sv.moneda ?? res.moneda, valor: sv.costoNeto });
      if (res.salida.tipo === "bloqueo" || res.salida.tipo === "empaquetado") {
        const rV = res.salida.tipo === "bloqueo" ? await datosVueloBloqueo(admin, res.salida.id) : await datosVueloEmpaquetado(admin, res.salida.id);
        if (!rV.ok) return { ok: false, error: `No se pudo validar el vuelo del hotel "${res.hotelNombre}": ${rV.error}` };
        obligaciones.push({ origen: `Vuelo de ${v.item.hotelNombre}`, moneda: rV.data.moneda ?? res.moneda, valor: costoVueloBernalo(rV.data, res.paxTotal, res.paxConSilla) });
      }
    }
    for (const t of grupo.tours) {
      if (t.servicioId == null || t.paqueteId == null) continue;
      try {
        const liq = await liquidarCostoTour(admin, { servicioId: t.servicioId, paqueteId: t.paqueteId, pax: t.pax, fechaIda: t.fechaIda, fechaRegreso: t.fechaRegreso });
        obligaciones.push({ origen: t.nombre, moneda: monedaServicio.get(t.servicioId), valor: costoTourParaCxP(liq) });
      } catch (e) {
        return { ok: false, error: `No se pudo calcular el costo del tour "${t.nombre}": ${e instanceof Error ? e.message : "error desconocido"}. No se crea ningún contrato.` };
      }
    }
    const rObl = evaluarObligaciones({ monedaContrato: monedaOfertaConversion, obligaciones });
    if (!rObl.ok) return { ok: false, error: rObl.error };
    if (rObl.requiereTrmCosto) requiereTrmCosto = true;
  }
  // 236 (#90 I): TRM de COSTOS. Se decide AQUÍ, antes de numerar o escribir: con obligaciones en USD es obligatoria (solo personal interno) y un reintento no
  // puede cambiar la ya congelada; sin ellas no se pide ni se guarda una nueva. Queda en `detalle.costo` junto a la elección de cobro desde el primer contrato.
  const rTrmCosto = decidirTrmCosto({ requiere: requiereTrmCosto, recibida: opts.trmCosto, esInterno: esInternoCobro, congelada: leerTrmCostoCongelada(cot.detalle) });
  if (!rTrmCosto.ok) return { ok: false, error: rTrmCosto.error };
  const trmCostoConversion = rTrmCosto.trm;
  if (trmCostoConversion != null) detalleBase.costo = { trm: trmCostoConversion };
  // Orden de despliegue: la RPC de antes de la 236 IGNORA en silencio las claves del equivalente y crearía la CxP en USD sin él (se devengaría como pesos).
  // Con obligaciones en USD se comprueba ANTES de numerar que la base ya tiene las columnas de la 236; si no, no se crea nada.
  if (requiereTrmCosto) {
    const { error: errEsquema236 } = await admin.from("cuentas_por_pagar").select("valor_cop_costo, trm_costo").limit(1);
    if (errEsquema236) return { ok: false, error: "La base de datos todavía no tiene el equivalente en pesos de las cuentas por pagar (migración 236); no se crea ningún contrato. Avisa a soporte." };
  }

  // `contratosPorGrupo`/`claveDeGrupo`/`detalleBase` ya se inicializaron
  // ANTES de Paso 1 (`gruposPendientes` los usó para excluir los grupos ya
  // convertidos de la reliquidación/validación) — `gruposValidados` acá
  // SOLO contiene grupos pendientes, así que este loop nunca necesita
  // volver a chequear "¿ya existe?": si estuviera completo no habría
  // llegado hasta Paso 1 en absoluto.
  for (const { grupo, validadosPersona, validadosBernalo } of gruposValidados) {
    const claveGrupo = claveDeGrupo(grupo);
    const totalHotelesGrupo = validadosPersona.length + validadosBernalo.length;

    // Regla A.6/C.12: destino/fechas/precio/moneda del contrato se agregan
    // sobre AMBAS listas — una cotización mixta persona+Bernalo debe quedar
    // en UN contrato coherente, sin que la presencia de Bernalo cambie cómo
    // se calculan estos totales para las líneas persona (regla 16).
    const destinos = [...new Set([
      ...validadosPersona.map((v) => v.comp.meta.destino_nombre ?? v.item.destino),
      ...validadosBernalo.map((v) => v.resultado.hotelDestino ?? v.item.destino),
      ...grupo.tours.map((t) => t.destino),
    ].filter((d): d is string => !!d))];
    // Fechas del CONTRATO: la más temprana/tardía de TODAS las unidades del
    // grupo —hoteles/bloqueos Y tours— (B16, ronda 6). Antes solo miraba los
    // hoteles, así que un grupo con un tour más temprano que el hotel escribía
    // una `ventas.fecha_salida` que no reflejaba la salida real, y un grupo de
    // SOLO tours quedaba sin fecha. `fecha_salida` es la referencia única
    // contra la que el RPC recalcula es_infante de TODOS los pasajeros — la UI
    // clasifica contra esta MISMA fecha (ver `fechaContratoDePasajero`).
    const fechasIda = [
      ...validadosPersona.map((v) => v.comp.meta.fecha_ida),
      ...validadosBernalo.map((v) => v.resultado.salida.fechaIda),
      ...grupo.tours.map((t) => t.fechaIda),
    ].filter((f): f is string => !!f).sort();
    const fechasReg = [
      ...validadosPersona.map((v) => v.comp.meta.fecha_regreso),
      ...validadosBernalo.map((v) => v.resultado.salida.fechaRegreso),
      ...grupo.tours.map((t) => t.fechaRegreso),
    ].filter((f): f is string => !!f).sort();
    // Fecha de referencia REAL de este grupo — cuando existe, es la MISMA que
    // se guarda como `ventas.fecha_salida` abajo, y contra la que el RPC
    // recalcula es_infante server-side (B10, ronda 3; B16, ronda 6).
    // ⚠️ B-fix (fecha_salida NULL, ronda 9; procedencia corregida en B23):
    // cuando NINGUNA unidad del grupo trae fecha, `ventas.fecha_salida` se
    // guarda en `null` TAL CUAL abajo (nunca se fabrica una fecha de viaje)
    // — pero `fechaRefGrupo`, que solo sirve para CLASIFICAR edades en este
    // archivo, cae a `hoyServidor`, el `current_date` LEÍDO de Postgres. Los
    // dos valores DIVERGEN a propósito cuando no hay fecha: uno es un dato
    // persistido (nunca inventado), el otro es la clasificación transitoria
    // que la base va a rehacer por su cuenta con ese mismo `current_date`.
    const fechaRefGrupo = fechasIda[0] ?? hoyServidor;
    // Regla C.12: `ventas.precio_venta` para un grupo con un único ítem
    // Bernalo (el caso típico) queda en EXACTAMENTE `resultado.precioVenta`
    // — la suma de una sola parte más 0 tours/otros hoteles.
    const precioTotal = validadosPersona.reduce((s, v) => s + v.comp.precioVenta, 0)
      + validadosBernalo.reduce((s, v) => s + v.resultado.precioVenta, 0)
      + grupo.tours.reduce((s, t) => s + t.precio, 0);
    const monedaGrupo = monedaOfertaConversion; // validada arriba: todas las unidades del grupo (hoteles y tours) están en esta moneda
    // #102: venta B2B asistida ⇒ el contrato nace B2B, del aliado congelado, y lo EXIGIBLE es el de su plan (PVP en comisionable; PVP −
    // comisión en NETO). `precio_venta`, el total de cobro y todo lo que depende de él (saldo, factura, portal) parten de ese importe.
    const planGrupoB2B = planB2BCot ? planesB2BPorGrupo.get(claveGrupo) ?? null : null;
    if (planB2BCot && !planGrupoB2B) return { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA };
    const precioExigibleGrupo = planGrupoB2B ? planGrupoB2B.precioFinal : precioTotal;
    // 235 (#90 F): el total a cobrar de ESTE contrato se convierte UNA sola vez desde su precio_venta (la oferta no cambia) y se congela en la cabecera.
    // Se calcula ANTES de reservar el número: un total inválido no gasta consecutivo.
    const cobroGrupo = cobroDeContratoCarrito({ precioVenta: precioExigibleGrupo, monedaContrato: monedaGrupo, eleccion: eleccionCobro });
    if (!cobroGrupo.ok) return { ok: false, error: numeros.length ? `${cobroGrupo.error} (los contratos ${numeros.join(", ")} sí quedaron completos)` : cobroGrupo.error };
    const numRes = await siguienteNumeroContrato(tenantCotizacion);
    if (!numRes.ok) return { ok: false, error: numRes.error };
    const numero = numRes.numero;

    // ── Universo LOCAL de este contrato (B13, ronda 5; B17, ronda 6) ─────
    // ÚNICAMENTE la unión de posiciones asignadas a las UNIDADES DE ESTE
    // GRUPO —hoteles/bloqueos Y tours— nunca el universo completo del
    // carrito, que puede incluir personas que no viajan en este contrato en
    // absoluto (otro destino, en modo "por destino"). Incluir los tours (B17)
    // hace que `ventas.pax` y `contrato_pasajeros` contengan a un pasajero que
    // viaja SOLO en un tour de este grupo, y sólo a los de este grupo. Como el
    // carrito exige ≥1 unidad y todo pasajero quedó asignado a alguna (validado
    // arriba), este universo nunca queda vacío — el fallback al universo global
    // sólo protege un caso imposible.
    const posicionesGrupoUnidades = [...grupo.items.map((it) => it.__posiciones), ...grupo.tours.map((t) => t.__posiciones)];
    const posicionesGrupoItems = posicionesUnicasDeGrupo(
      posicionesGrupoUnidades,
      posicionesGrupoUnidades.map((_, i) => i)
    );
    const universoGrupo = posicionesGrupoItems.length ? posicionesGrupoItems : opts.pasajeros.map((_, i) => i + 1);
    // Normaliza edades GLOBALMENTE contra la fecha REAL de este grupo (B10)
    // ANTES de reindexar a local — en ese orden, `posicionesInvalidas` de
    // abajo solo puede señalar un INFANTE REAL de este grupo cuyo
    // responsable no viaja en él (nunca un falso positivo de alguien cuyo
    // responsableIndex quedó "vivo" solo porque en OTRO grupo sí era
    // infante — ese caso ya lo limpió la normalización).
    const pasajerosNormalizadosGlobal = normalizarResponsablesPorGrupo(opts.pasajeros, fechaRefGrupo);
    const { pasajerosLocal, posicionesInvalidas, mapaGlobalALocal } = reindexarGrupoLocal(pasajerosNormalizadosGlobal, universoGrupo);
    if (posicionesInvalidas.length) {
      // Decisión de diseño investigada (B13 punto 5, ver comentario de
      // `reindexarGrupoLocal`): el responsable de un infante debe
      // pertenecer al MISMO CONTRATO (lo exige la FK responsable_id de la
      // migración 167) — no necesariamente al mismo ítem/bloqueo. Aquí el
      // infante en esta posición GLOBAL quedó en este grupo, pero su
      // responsable elegido en la UI terminó en un contrato DISTINTO.
      return { ok: false, error: `El adulto responsable del pasajero ${posicionesInvalidas[0]} debe viajar en el mismo contrato que él (mismo destino/grupo) — elige otro responsable o revisa la asignación.` };
    }
    // `ventas.pax` = personas ÚNICAS de este contrato (B13 punto 7) —
    // nunca la suma de `it.pax`/`comp.paxConSilla` de sus ítems, que
    // duplicaba a cualquier viajero compartido entre 2+ ítems del mismo
    // grupo.
    const paxTotal = pasajerosLocal.length;

    // Resumen ÚNICO de asistencia/tours de ESTE grupo (incluidos del paquete
    // de sus hoteles + opcionales del carrito), misma fuente compartida que
    // `crearCotizacion`/`reservarDesdeTarifarioInterno`
    // (lib/reservar/serviciosPaquete.ts). Legados sin `servicioId` caen a
    // "otro" vía `normalizarCategoriaServicio` (nunca se inventa asistencia/
    // tour para un dato ausente).
    // Los incluidos son los VALIDADOS y RECALCULADOS en el servidor para cada
    // hotel por persona de este grupo (pre-validación, `validarIncluidosConversion`).
    // Regla A.6/25: Bernalo queda fuera — sus incluidos se re-liquidan FRESCOS
    // más abajo (`resultado.serviciosIncluidos`) con su propia CxP; sumarlos
    // aquí los contaría DOS veces.
    const incluidosGrupo = validadosPersona.flatMap((v) => v.incluidos);
    const serviciosEfectivosGrupo: ServicioEfectivo[] = [
      ...incluidosGrupo,
      ...grupo.tours.map((t, i): ServicioEfectivo => ({
        servicioId: t.servicioId ?? -(i + 1),
        nombre: t.nombre,
        categoria: normalizarCategoriaServicio(t.categoria),
        incluido: false,
        costoNeto: 0,
        proveedorId: null,
      })),
    ];
    const resumenGrupo = resumirServiciosContrato(serviciosEfectivosGrupo);

    const { error: ve } = await sb.from("ventas").insert({
      numero_contrato: numero,
      // Conserva EXACTAMENTE el tenant de la cotización de origen (validado
      // arriba: no nulo, y el caller tiene acceso a él).
      tenant: tenantCotizacion,
      // Preview #403: NETO ⇒ cliente = aliado (catálogo) y la persona queda como titular de la reserva; PVP con comisión y B2C ⇒ cliente = la persona.
      ...camposClienteVenta({ modo: planB2BCot?.modo_compra ?? null, fiscal: fiscalAliadoVivo, titular: titularDeCliente(cliente) }),
      destino: destinos.join(" · ") || grupo.destino,
      tipo_paquete: "carrito",
      moneda: monedaGrupo,
      ...cobroGrupo.cobro,
      fecha_salida: fechasIda[0] ?? null,
      fecha_regreso: fechasReg.length ? fechasReg[fechasReg.length - 1] : null,
      pax: paxTotal,
      hotel: totalHotelesGrupo === 1
        ? (validadosPersona[0]?.comp.meta.hotel_nombre ?? validadosPersona[0]?.item.hotelNombre ?? validadosBernalo[0]?.resultado.hotelNombre ?? null)
        : totalHotelesGrupo === 0 ? null : `${totalHotelesGrupo} hoteles`,
      // Lo EXIGIBLE del contrato: el PVP del carrito (`precioTotal`) o, en una venta B2B asistida, el de su plan (PVP, o PVP − comisión en NETO).
      precio_venta: precioExigibleGrupo,
      estado: "pendiente",
      // Migración 172 — mismo criterio que reservarDesdeTarifarioInterno.
      financiero_estado: "pendiente",
      // #102: B2B asistido ⇒ canal B2B del aliado congelado, con su modalidad y su comisión (la fila de `aliados_b2b` la crea la base
      // justo después). El asesor interno sigue siendo quien gestiona; el beneficiario es el aliado. Sin plan B2B: B2C de siempre.
      ...(planB2BCot && planGrupoB2B
        ? {
            canal: "B2B",
            tipo_asesor: planB2BCot.tipo_asesor,
            modo_compra: planGrupoB2B.modoCompra,
            comision_b2b: planGrupoB2B.comision,
            comision_estado: planGrupoB2B.comisionEstado,
            // Mismo impuesto que se usó para la base: la base de datos recalcula la comisión desde `ventas.impuesto`.
            impuesto: validadosPersona.reduce((s, v) => s + v.comp.impuestoTotal, 0),
            aliado_id: planB2BCot.aliado_id,
            agencia_nombre: planB2BCot.tipo_asesor === "agencia" ? planB2BCot.aliado_nombre : null,
            freelance_nombre: planB2BCot.tipo_asesor === "freelance" ? planB2BCot.aliado_nombre : null,
            // Candado de la base (238): una cotización convierte UNA vez cada grupo. Un doble envío simultáneo choca aquí, antes de escribir
            // pasajeros, comisión o CxP; si el contrato se revierte por una falla, su fila desaparece y el reintento queda libre.
            cotizacion_origen_id: id,
            grupo_conversion: claveGrupo,
          }
        : { canal: "B2C", tipo_asesor: "interno" }),
      plazo: null,
      asesor_firma_nombre: oNull(firmaConversion),
      asesor: oNull(firmaConversion),
      plan_nombre: totalHotelesGrupo === 1
        ? (validadosPersona[0] ? `${validadosPersona[0].item.categoria} · ${validadosPersona[0].item.regimen}` : `${validadosBernalo[0].item.categoria} · ${validadosBernalo[0].item.alimentacion}`)
        : totalHotelesGrupo === 0 ? (grupo.tours.length === 1 ? grupo.tours[0].nombre : `${grupo.tours.length} tours`) : `${totalHotelesGrupo} hoteles`,
      tours_traslados: resumenGrupo.toursTraslados,
      asistencia_medica: resumenGrupo.asistenciaMedica,
    });
    if (ve) {
      // #102: otra conversión de ESTA misma cotización ya creó (o está creando) este grupo ⇒ no se duplica nada. El número reservado en esta
      // llamada queda sin usar; el contrato, la comisión y las CxP del otro intento son los válidos.
      if (planB2BCot && ve.code === "23505" && /ux_ventas_conversion_cotizacion_grupo/.test(ve.message)) {
        return { ok: false, error: "Esta cotización ya se está convirtiendo (o ya se convirtió) en otra solicitud. No se creó un contrato duplicado: recarga la cotización para ver su contrato." };
      }
      return { ok: false, error: ve.message };
    }

    // Igual que en `reservarDesdeTarifarioInterno`: con el contrato ya
    // insertado, ninguna salida por error puede dejarlo vivo — sería un
    // contrato fantasma (numerado, en los listados, sin pasajeros ni costo).
    // Los contratos de grupos ANTERIORES que sí se completaron no se tocan:
    // están íntegros, y borrarlos sería inventar una anulación comercial.
    const fallarYRevertirGrupo = async (motivo: string): Promise<{ ok: false; error: string }> => {
      const rev = await revertirContratoIncompleto({ rpc: rpcFinanciero }, numero, tenantCotizacion);
      const yaCreados = numeros.length ? ` (los contratos ${numeros.join(", ")} sí quedaron completos)` : "";
      if (rev.ok) return { ok: false, error: `${motivo}${yaCreados}` };
      return {
        ok: false,
        error: `${motivo} · Además, el contrato ${numero} quedó creado a medias y no se pudo deshacer automáticamente (${rev.error ?? "motivo desconocido"}): revísalo antes de volver a intentarlo.${yaCreados}`,
      };
    };

    // #102 · Comisión B2B del aliado: la crea la base (`registrar_comision_b2b_reserva`, migración 205 — valida usuario, rol, tenant,
    // aliado y venta, recalcula el importe con la MISMA regla del plan y se niega a duplicar). En NETO queda marcada como descontada
    // y no se puede pagar otra vez. Si falla, el contrato de este grupo se revierte completo (nunca un contrato B2B sin su comisión).
    if (planB2BCot) {
      const com = await registrarComisionReserva(sb, numero, planB2BCot.aliado_id);
      if (!com.ok) return fallarYRevertirGrupo(com.error);
    }

    // Pasajeros + responsables + sillas de TODOS los bloqueos del grupo, en
    // UNA sola llamada atómica (revisión de alto riesgo, ronda 3 — B6):
    // antes, este flujo insertaba `contrato_pasajeros` directo (sin
    // recalcular es_infante por RPC) y LUEGO reservaba las sillas de cada
    // ítem con select+update aparte, sin candado ni reversión conjunta — la
    // misma falla de atomicidad que B5 ya cerró para los otros 3 flujos de
    // creación, y encima rechazaba cualquier infante con un mensaje "no
    // admitido todavía" (correcto como corte de emergencia, pero una
    // regresión real frente a los demás flujos). `crear_pasajeros_contrato_
    // multi` (migración 167) generaliza el mismo núcleo atómico de un solo
    // bloqueo a VARIOS: recibe cada `bloqueoId` de este grupo de forma
    // EXPLÍCITA (nunca lo descubre — un numero_contrato con más de un
    // bloqueo no puede representarse en la columna `ventas.bloqueo_ref_id`,
    // que sigue sin tocarse) junto con las POSICIONES (1-based, dentro de
    // `opts.pasajeros` — misma convención que responsableOrden) que ocupan
    // silla en él; recalcula es_infante server-side contra
    // `ventas.fecha_salida` (= fechasIda[0], ya guardado arriba) y exige
    // responsable_id para todo infante nuevo (autoridad real: el trigger de
    // la 167) — si cualquier bloqueo no tiene cupo o falta un vínculo,
    // Postgres revierte TODO el grupo (pasajeros, vínculos y sillas de
    // TODOS sus bloqueos juntos), nunca un estado parcial entre bloqueos.
    // B11 (ronda 3): las posiciones de cada bloqueo son las asignadas
    // EXPLÍCITAMENTE al ítem (`__posiciones`), nunca un prefijo derivado de
    // `it.pax` — ver el comentario de `ItemCarritoConAsignacion` arriba.
    // B14 (ronda 5): `__posiciones` está en el sistema GLOBAL del carrito —
    // se traduce a LOCAL (vía `mapaGlobalALocal`, coherente con el payload
    // `pasajerosLocal` que se envía al RPC más abajo) y se consolida por
    // `bloqueoId`, porque `CartContext.add` permite 2+ ítems sobre el mismo
    // bloqueo (ej. dos hoteles distintos que comparten el mismo vuelo
    // negociado) y el RPC (migración 167) rechaza un bloqueoId repetido en
    // el mismo payload. Todo `posGlobal` de `v.item.__posiciones` pertenece
    // a `universoGrupo` (por construcción: viene de `grupo.items`, la misma
    // fuente de `posicionesGrupoItems`), así que siempre está en el mapa.
    // B15 (ronda 6): el piso de sillas consolidado es el número de PERSONAS
    // ÚNICAS que ocupan silla — la unión de `posicionesConSilla` de los ítems
    // que comparten bloqueo, nunca la SUMA de sus pisos (que duplicaba a un
    // viajero presente en 2+ ítems del mismo bloqueo y sobre-reservaba).
    // B19 (ronda 7): quién ocupa silla se decide con la fecha REAL de salida
    // de ESE bloqueo (`v.comp.meta.fecha_ida`), no con la única
    // `ventas.fecha_salida` del contrato — un pasajero infante en el vuelo más
    // temprano puede ya tener 2 años (y ocupar silla) en un vuelo posterior.
    // Es la MISMA fecha por bloqueo con la que el RPC recalcula `holders_reales`
    // (mira `bloqueos_vuelo.fecha_ida`), así que el piso coincide exacto.
    // Mismas reservas consolidadas que ya se pre-validaron por capacidad (B21):
    // única fuente `reservasSillasDeGrupo`, así lo escrito coincide byte a byte
    // con lo comprobado.
    const reservasSillas = reservasSillasDeGrupo(validadosPersona, mapaGlobalALocal, pasajerosNormalizadosGlobal, fechaRefGrupo);
    // B10 (ronda 3): la fecha de referencia que usó la UI para decidir
    // quién es infante y capturar su responsable es SIEMPRE conservadora
    // (la más temprana de TODO el carrito — la UI no puede conocer de
    // antemano en qué grupo/contrato terminará cada pasajero). La fecha
    // REAL de ESTE grupo (`fechaRefGrupo`) puede ser posterior — y la edad
    // de un pasajero solo AVANZA con una fecha posterior, nunca retrocede
    // — así que un `responsableIndex` que la UI capturó para alguien que
    // YA DEJÓ de ser infante para la fecha real de este grupo en particular
    // quedaría "sobrante": el propio trigger de la migración 167 lo
    // rechazaría ("solo un infante puede tener responsable"), tumbando la
    // creación de ESTE grupo con un error que no describe el problema real.
    // `normalizarResponsablesPorGrupo` ya limpió ese sobrante GLOBALMENTE
    // arriba (antes de reindexar a local, ver comentario de
    // `pasajerosNormalizadosGlobal`) — nunca hace falta AGREGAR uno nuevo
    // aquí (si alguien SIGUE siendo infante para este grupo y no trae
    // vínculo, el propio RPC lo rechaza con su mensaje real, igual que en
    // cualquier otro flujo de creación).
    // B13 (ronda 5): el payload es `pasajerosLocal` — ÚNICAMENTE la unión de
    // posiciones de este grupo, ya reindexada (posiciones globales de
    // `opts.pasajeros` NUNCA se envían completas a cada contrato).
    const payloadPasajerosMulti = payloadGuardarPasajeros(
      pasajerosLocal.map((p) => ({
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
        tipoId: oNull(p.tipoDoc) ?? "CC",
        identificacion: oNull(p.numeroDoc) ?? "",
        fechaNacimiento: p.fechaNacimiento ?? "",
        esInfante: false, // ignorado por el servidor — lo recalcula por fecha (ver payloadGuardarPasajeros).
        responsableIndex: p.responsableIndex ?? null,
      }))
    );
    // Migración 201: la misma transacción reserva las sillas de cada record
    // y les copia los datos del pasajero (manifiesto del vuelo). Una sola
    // copia por record aunque dos ítems lo compartan (B14); quién ocupa silla
    // lo decide la base con la fecha de ESE record (B19), igual que al
    // reservarlas. Datos comunes del record: los del primer ítem que lo usa.
    const comunPorBloqueo = new Map<number, { asesor: string | null; hotel: string | null; acomodacion: string | null; plazo: null }>();
    for (const { item: it, comp } of validadosPersona) {
      if (it.modulo === "bloqueo" && it.bloqueoId && !comunPorBloqueo.has(it.bloqueoId)) {
        comunPorBloqueo.set(it.bloqueoId, {
          asesor: oNull(opts.asesorInterno ?? null), hotel: comp.meta.hotel_nombre ?? null, acomodacion: it.categoria, plazo: null,
        });
      }
    }
    const { data: filasPasajerosMulti, error: peMulti } = await admin.rpc("crear_pasajeros_contrato_multi_con_sillas", {
      p_numero_contrato: numero,
      p_pasajeros: payloadPasajerosMulti as unknown as Json,
      p_reservas_sillas: reservasSillas as unknown as Json,
      p_usuario_id: usuarioCond.id,
      // B23: aquí ya NO se manda ninguna referencia de fecha. El RPC la
      // resuelve solo (`fecha_salida` o su propio `current_date`), que es el
      // mismo valor que esta Server Action leyó en `hoyServidor` para
      // prevalidar. Inyectarla era lo que permitía elegirla.
      p_comun_por_bloqueo: [...comunPorBloqueo].map(([bloqueoId, comun]) => ({ bloqueoId, comun })),
      p_datos_pasajeros: pasajerosLocal.map((p) => ({
        pasajero_nombres: oNull(p.nombres), pasajero_apellidos: oNull(p.apellidos),
        tipo_doc: oNull(p.tipoDoc), numero_doc: oNull(p.numeroDoc), nacimiento: oNull(p.fechaNacimiento),
      })),
    });
    if (peMulti) return fallarYRevertirGrupo(peMulti.message);
    const filasPasajerosMultiOrdenadas = (filasPasajerosMulti ?? [])
      .slice()
      .sort((a, b) => a.orden - b.orden);

    // nombres/apellidos/nacionalidad — mismo criterio que
    // reservarDesdeTarifarioInterno/reservarProgramaInterno: POSTERIOR al
    // RPC atómico (no forman parte de v_claves_validas de
    // _reemplazar_pasajeros_nucleo, migración 167), un fallo NO revierte
    // este contrato del carrito, pero SÍ se revisa `{ error }` de cada
    // UPDATE y se reporta honestamente en `advertencias` (acumulada de
    // todos los grupos) — nunca se asume éxito sin comprobarlo. Empareja
    // por `orden` con `pasajerosLocal` (la MISMA fuente que armó
    // payloadPasajerosMulti, arriba).
    await Promise.all(
      filasPasajerosMultiOrdenadas.map(async (f, i) => {
        const p = pasajerosLocal[i];
        const patch: { nacionalidad?: string; nombres?: string; apellidos?: string } = {};
        const nac = oNull(p?.nacionalidad);
        const nom = oNull(p?.nombres);
        const ape = oNull(p?.apellidos);
        if (nac) patch.nacionalidad = nac;
        if (nom) patch.nombres = nom;
        if (ape) patch.apellidos = ape;
        if (Object.keys(patch).length === 0) return;
        const { error: errDemografico } = await admin.from("contrato_pasajeros").update(patch).eq("id", f.id);
        if (errDemografico) {
          const etiqueta = `${p?.nombres ?? ""} ${p?.apellidos ?? ""}`.trim() || `pasajero #${i + 1}`;
          advertencias.push(`Contrato ${numero}: no se pudo guardar nacionalidad/nombres estructurados de ${etiqueta}: ${errDemografico.message}`);
        }
      })
    );

    type ProvFact = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
    // `numero_contrato`/`tenant` los pone la transacción financiera
    // (migración 171) desde sus propios parámetros — ver el mismo criterio en
    // `reservarDesdeTarifarioInterno`.
    const cxp: CxPFinanciera[] = [];
    // #90 F: `moneda` es la moneda REAL del COSTO (hotel, vuelo o servicio), y TODA CxP la lleva EXPLÍCITA — ya no se depende del default 'COP' del RPC ni
    // se asigna la del contrato en bloque. Una obligación en USD (o indeterminable en un contrato USD) no se registra: ya la detuvo la verificación previa
    // antes de numerar; esta es la segunda barrera (defensa en profundidad) y revierte el contrato del grupo.
    const estadoObligaciones: { error: string | null } = { error: null };
    const pushCxP = (tipo: string, servicio: string, valor: number, pr: ProvFact, nombreFallback: string | null | undefined, servicioId: number | null | undefined, monedaCosto: unknown) => {
      const decision = decidirCxP({ origen: servicio, moneda: monedaCosto, valor, monedaContrato: monedaGrupo });
      if (decision.accion === "omitir") return;
      if (decision.accion === "rechazar") { estadoObligaciones.error ??= decision.error; return; }
      // 236 (#90 I): una obligación en USD conserva su valor y moneda originales (a centavos, como la columna) y lleva su equivalente en COP
      // congelado a la TRM de COSTOS — la misma para todo el contrato. Sin esa TRM no se crea (la revisión previa ya la exigió antes de numerar).
      const enUsd = decision.moneda === "USD";
      if (enUsd && trmCostoConversion == null) { estadoObligaciones.error ??= `${servicio}: falta la TRM de costos para su obligación en USD; no se crea el contrato.`; return; }
      const valorTotal = enUsd ? Math.round(Math.max(0, valor) * 100 + 1e-9) / 100 : Math.max(0, valor);
      cxp.push({
        proveedor: pr?.nombre ?? nombreFallback ?? null, tipo_proveedor: tipo, servicio,
        valor_total: valorTotal, fecha_obligacion: hoyServidor,
        aplica_retencion: pr?.aplica_retencion ?? false, pct_retencion: Number(pr?.pct_retencion) || 0, observaciones: OBS_AUTO,
        // Migración 170 — vínculo durable con el servicio del catálogo.
        servicio_id: servicioId ?? null,
        moneda: decision.moneda,
        ...(enUsd ? { valor_cop_costo: equivalenteCopCosto(valorTotal, trmCostoConversion as number), trm_costo: trmCostoConversion as number } : {}),
      });
    };

    let costoAereoTotal = 0, costoHotelTotal = 0;
    // Componentes de condición de pago (Rama B) — uno por hotel del grupo,
    // condicionado por las vigencias REALES de CADA hotel (nunca por el
    // ganador del motor de precios). Se congelan todos juntos al final del
    // grupo, en UN solo contrato (igual que el resto de este flujo).
    const componentesCondicion: ComponenteSnapshot[] = [];

    for (let hIdx = 0; hIdx < validadosPersona.length; hIdx++) {
      const { item: it, comp } = validadosPersona[hIdx];
      const { meta, lineasHab, numNinos, numNinos2, netoPorAcom, paxConSilla } = comp;
      const { lineasMenores, numMenoresDeDos, numInfantes } = menoresDelComputo(comp, { infantesDeclarados: it.infantes || 0 });

      const partes = lineasHab.map((l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`);
      if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
      if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
      if ((it.infantes || 0) > 0) partes.push(`${it.infantes} Infante(s)`);

      let proveedorHotel: string | null = null;
      const { data: hp } = await admin.from("hoteles").select("proveedores(nombre, aplica_retencion, pct_retencion)").eq("id", it.hotelId).maybeSingle();
      const prH = hp?.proveedores as unknown as ProvFact;
      proveedorHotel = prH?.nombre ?? null;

      // Condiciones de tarifa (Dubai) — EXCLUSIVAMENTE del snapshot de la
      // cotización, correlacionado por `it.ref` (nunca por `hIdx`, que se
      // reinicia en cada grupo con `agrupar: "por_destino"`; nunca por
      // nombre/hotelId+categoría, que pueden repetirse dentro del mismo
      // carrito — ver lib/calc/condicionesTarifa.ts). `it.ref` ausente
      // (cotización histórica) ⇒ `condiciones: null`, se guarda NULL sin
      // bloquear. `it.ref` presente pero sin match único ⇒ falla cerrado con
      // el mecanismo existente (revierte TODO el grupo, nunca un contrato a
      // medias ni un `continue` silencioso).
      const rCondiciones = resolverCondicionesTarifaParaConversion(detalleHotelesSnap, it.ref);
      if (!rCondiciones.ok) {
        return fallarYRevertirGrupo(`No se pudieron determinar las condiciones de tarifa del hotel "${meta.hotel_nombre ?? it.hotelNombre}": ${rCondiciones.error}`);
      }

      const { error: eHotelP } = await sb.from("contrato_hoteles").insert({
        numero_contrato: numero, nombre: meta.hotel_nombre ?? it.hotelNombre, categoria: it.categoria,
        proveedor: proveedorHotel, ciudad: meta.destino_nombre ?? it.destino, alimentacion: it.regimen,
        acomodacion: it.categoria, detalle_acomodacion: partes.join(", "),
        fecha_ingreso: meta.fecha_ida, fecha_salida: meta.fecha_regreso, orden: hIdx,
        condiciones_tarifa: rCondiciones.condiciones as unknown as Json,
      });
      if (eHotelP) return fallarYRevertirGrupo(`No se pudo registrar el hotel "${meta.hotel_nombre ?? it.hotelNombre}" del contrato: ${eHotelP.message}`);

      if (usuarioCond && meta.fecha_ida && meta.fecha_regreso) {
        // componenteHotelReal puede devolver null si la consulta de vigencias
        // falló (finding F1, revisión de PR #282) — no se agrega nada al
        // snapshot en ese caso: mejor no congelar este hotel que congelar una
        // condición neutra incorrecta y permanente.
        const componenteHotel = await componenteHotelReal(admin, {
          hotelId: it.hotelId,
          id: `hotel-${it.hotelId}-${hIdx}`,
          valor: comp.precioVenta,
          referencia: meta.hotel_nombre ?? it.hotelNombre ?? null,
          fechaIda: meta.fecha_ida,
          fechaRegreso: meta.fecha_regreso,
          fechaPago: hoyServidor,
        });
        if (componenteHotel) componentesCondicion.push(componenteHotel);
      }

      if (it.modulo === "bloqueo" && it.bloqueoId) {
        const { data: bq } = await admin
          .from("bloqueos_vuelo")
          .select("aerolinea, moneda, record, ruta, tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, proveedores(nombre, aplica_retencion, pct_retencion)")
          .eq("id", it.bloqueoId).maybeSingle();
        if (bq) {
          const r = parseRuta(bq.ruta);
          const tramos = [{
            numero_contrato: numero, aerolinea: bq.aerolinea, record: bq.record, direccion: "ida",
            origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen), destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
            numero_vuelo: bq.vuelo_ida, hora_salida: bq.hora_salida_ida, hora_llegada: bq.hora_llegada_ida,
            fecha_salida: bq.fecha_ida, orden: hIdx * 10,
          }];
          if (bq.fecha_regreso || bq.vuelo_regreso) {
            tramos.push({
              numero_contrato: numero, aerolinea: bq.aerolinea, record: bq.record, direccion: "regreso",
              origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino), destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
              numero_vuelo: bq.vuelo_regreso, hora_salida: bq.hora_salida_reg, hora_llegada: bq.hora_llegada_reg,
              fecha_salida: bq.fecha_regreso, orden: hIdx * 10 + 1,
            });
          }
          await sb.from("contrato_vuelos").insert(tramos);

          // Menores de 2 años: pagan SOLO el fee de infante del bloqueo (migración
          // 226, precio = costo) y no ocupan silla (`paxConSilla` ya los excluye).
          const costoAereo = costoAereoBloqueo(bq, paxConSilla, numMenoresDeDos);
          costoAereoTotal += costoAereo;
          pushCxP("aereo", `Aéreo ${bq.aerolinea ?? ""}`.trim(), costoAereo, bq.proveedores as unknown as ProvFact, bq.aerolinea, null, (bq as { moneda?: unknown }).moneda);

          // Las sillas de ESTE bloqueo y los datos del pasajero sobre ellas ya
          // quedaron escritos arriba, en la MISMA transacción
          // (crear_pasajeros_contrato_multi_con_sillas, migración 201).
        }
      }

      const itemsHotel: { numero_contrato: string; descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; orden: number; modo_precio?: "total"; valor_total?: number }[] = [];
      lineasHab.forEach((l, i) => itemsHotel.push({
        numero_contrato: numero, descripcion: `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${it.categoria} / ${it.regimen}`,
        adultos: l.pax, ninos: 0, tarifa_adulto: l.pvp, tarifa_nino: 0, orden: hIdx * 300 + i,
      }));
      // Menores (migración 226): una fila por clase de hotel y por tarifa (menor
      // de 2 años = tarifa de infante; 2+ = adulto en vuelo y servicios).
      for (const lm of lineasMenores) {
        itemsHotel.push({ numero_contrato: numero, descripcion: descripcionLineaMenor(lm, it.categoria, it.regimen), adultos: 0, ninos: lm.cantidad, tarifa_adulto: 0, tarifa_nino: lm.tarifa, orden: hIdx * 300 + ordenLineaMenor(lm) });
      }
      // Servicios incluidos por GRUPO: su cargo (ya dentro de `comp.precioVenta`,
      // una sola vez) no va en ninguna fila de habitación/menores. El total del
      // documento del contrato es la suma de sus líneas, así que sin esta línea
      // mostraba menos que `ventas.precio_venta` y que la cotización (que sí la
      // tiene, checkout/actions.ts). Misma regla y mismo helper: fail-closed.
      const rResidual = calcularResidualServiciosIncluidosPorGrupo({
        precioVenta: comp.precioVenta, lineasHab,
        numNinos: 0, tarifaNino: null,
        numNinos2: 0, tarifaNino2: null,
        numInfantes: 0, tarifaInfante: null,
        lineasMenores,
      });
      if (!rResidual.ok) return fallarYRevertirGrupo(`${meta.hotel_nombre ?? it.hotelNombre}: ${rResidual.error}`);
      if (rResidual.residual > 0) {
        itemsHotel.push({
          numero_contrato: numero, descripcion: `${meta.hotel_nombre ?? it.hotelNombre} · Servicios incluidos por grupo`,
          adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: hIdx * 300 + 60,
          modo_precio: "total", valor_total: rResidual.residual,
        });
      }
      if (itemsHotel.length) await sb.from("contrato_items").insert(itemsHotel);

      const costoHotel = costoHotelPersona(comp, numInfantes);
      costoHotelTotal += costoHotel;
      pushCxP("hotel", `Hotel ${meta.hotel_nombre ?? it.hotelNombre}`.trim(), costoHotel, prH, null, null, comp.monedaReserva);
    }

    // ── Ítems Bernalo del grupo (Fase 3F-4B) ──────────────────────────────
    // Cada uno ya viene RE-LIQUIDADO y con proveedores VALIDADOS por
    // `validarBernaloParaConversion` (Paso 1) — acá solo se escribe.
    for (let bIdx = 0; bIdx < validadosBernalo.length; bIdx++) {
      const { item: it, resultado, proveedoresServicios } = validadosBernalo[bIdx];
      // Offset de `orden` que nunca colisiona con los hoteles persona del
      // mismo grupo (que usan `hIdx`/`hIdx*300` arriba) ni entre sí.
      const ordenBase = validadosPersona.length + bIdx;
      const numHabitaciones = resultado.habitaciones.length;

      // Identidad del hotel — reutiliza la MISMA tabla/sección del documento
      // que ya renderiza la tarjeta de hotel para persona (regla F.32: nunca
      // se construyó un componente nuevo para esto). El desglose PRIVADO por
      // habitación vive aparte, en `contrato_alojamiento_bernalo` (regla D).
      const { error: eHotelB } = await sb.from("contrato_hoteles").insert({
        numero_contrato: numero, nombre: resultado.hotelNombre, categoria: it.categoria,
        proveedor: resultado.proveedorHotel?.nombre ?? null, ciudad: resultado.hotelDestino ?? it.destino,
        alimentacion: it.alimentacion, acomodacion: it.categoria,
        detalle_acomodacion: `${numHabitaciones} habitación(es) · ${resultado.paxTotal} viajero(s)`,
        fecha_ingreso: resultado.salida.fechaIda, fecha_salida: resultado.salida.fechaRegreso, orden: ordenBase,
      });
      if (eHotelB) return fallarYRevertirGrupo(`No se pudo registrar el hotel "${resultado.hotelNombre}" del contrato: ${eHotelB.message}`);

      // Regla D.17/18/19/21: UNA fila por habitación física, SOLO desde el
      // resultado autoritativo del servidor (nunca del navegador/cotización),
      // vía service-role (la tabla no tiene ninguna policy — migración 176).
      // Cualquier fallo revierte TODO el contrato; el cascade de
      // `revertir_contrato_incompleto` (FK a `ventas` ON DELETE CASCADE)
      // limpia estas filas sin intervención manual.
      const filasSnapshot = resultado.habitaciones.map((h, i) => ({
        numero_contrato: numero,
        habitacion_id: h.habitacionId,
        orden: i,
        hotel_id: resultado.hotelId,
        hotel_nombre: resultado.hotelNombre,
        categoria: it.categoria,
        alimentacion: it.alimentacion,
        adultos: h.ocupacion.adultos,
        edades_menores: h.ocupacion.edadesMenores as unknown as Json,
        snapshot: h.snapshot as unknown as Json,
      }));
      const { error: eSnap } = await admin.from("contrato_alojamiento_bernalo").insert(filasSnapshot);
      if (eSnap) return fallarYRevertirGrupo(`No se pudo registrar el detalle por habitación del hotel "${resultado.hotelNombre}": ${eSnap.message}`);

      // Regla C.13/14: UNA sola línea agregada, `modo_precio: "total"` — los
      // 4 campos per-cápita quedan en su default (0), nunca son autoridad
      // para esta fila (ver `lib/contrato/valorContratoItem.ts`).
      const { error: eItemB } = await sb.from("contrato_items").insert({
        numero_contrato: numero,
        descripcion: `${resultado.hotelNombre} · ${it.categoria} / ${it.alimentacion} · ${numHabitaciones} habitación(es), ${resultado.paxTotal} viajero(s)`,
        adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0,
        modo_precio: "total", valor_total: resultado.precioVenta,
        orden: ordenBase * 300,
      });
      if (eItemB) return fallarYRevertirGrupo(`No se pudo registrar el ítem del contrato para "${resultado.hotelNombre}": ${eItemB.message}`);

      // Vuelo (regla B.9.3/24): SOLO si la salida resuelta es bloqueo o
      // empaquetado — "sin_vuelo" nunca inserta contrato_vuelos ni CxP
      // aérea. `validarBernaloParaConversion` (Paso 1) ya bloquea CUALQUIER
      // salida distinta de "sin_vuelo" (cierre 3F-4B: sin integración de
      // sillas todavía) — esta rama queda como código de defensa/preparación
      // para cuando esa integración exista, nunca se alcanza hoy en la
      // práctica. El proveedor se resuelve con la MISMA función que ya usa
      // el flujo persona (`datosVueloBloqueo`/`datosVueloEmpaquetado`) —
      // tolera proveedor ausente igual que persona (regla B.9.3: ninguna
      // regla más estricta que inventar aquí).
      if (resultado.salida.tipo === "bloqueo" || resultado.salida.tipo === "empaquetado") {
        const rVuelo = resultado.salida.tipo === "bloqueo"
          ? await datosVueloBloqueo(admin, resultado.salida.id)
          : await datosVueloEmpaquetado(admin, resultado.salida.id);
        // Hallazgo confirmado (cierre 3F-4B): antes, `!rVuelo.ok` omitía el
        // tramo/CxP aérea best-effort — dejaba `costo_aereo` sin su CxP
        // correspondiente cuando la salida SÍ lleva vuelo, un estado
        // financiero incoherente. Ahora falla y revierte TODO el contrato,
        // igual que cualquier otro insert de esta rama.
        if (!rVuelo.ok) return fallarYRevertirGrupo(`No se pudo validar el vuelo del hotel "${resultado.hotelNombre}": ${rVuelo.error}`);
        const dv = rVuelo.data;
        const r = parseRuta(dv.ruta);
        const tramosBernalo = [{
          numero_contrato: numero, aerolinea: dv.aerolinea, record: dv.record, direccion: "ida",
          origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen), destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
          numero_vuelo: dv.vuelo_ida, hora_salida: dv.hora_salida_ida, hora_llegada: dv.hora_llegada_ida,
          fecha_salida: dv.fecha_ida, orden: ordenBase * 10 + 5000,
        }];
        if (dv.fecha_regreso || dv.vuelo_regreso) {
          tramosBernalo.push({
            numero_contrato: numero, aerolinea: dv.aerolinea, record: dv.record, direccion: "regreso",
            origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino), destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
            numero_vuelo: dv.vuelo_regreso, hora_salida: dv.hora_salida_reg, hora_llegada: dv.hora_llegada_reg,
            fecha_salida: dv.fecha_regreso, orden: ordenBase * 10 + 5001,
          });
        }
        const { error: eVueloB } = await sb.from("contrato_vuelos").insert(tramosBernalo);
        if (eVueloB) return fallarYRevertirGrupo(`No se pudo registrar el vuelo del hotel "${resultado.hotelNombre}": ${eVueloB.message}`);
        // Hallazgo confirmado (cierre 3F-4B): la CxP/costo aéreo REAL sale
        // del NETO real leído fresco (`dv.costo_neto`, ya corregido a
        // `tarifa_proveedor` para empaquetados por `datosVueloEmpaquetado`)
        // más el cargo fijo por infante — nunca de `resultado.costoVueloTotal`
        // (que además de no incluir fee_infante, para "empaquetado" venía
        // del `tarifa_para_empaquetar`/reventa antes de este cierre).
        const costoVueloReal = costoVueloBernalo(dv, resultado.paxTotal, resultado.paxConSilla);
        costoAereoTotal += costoVueloReal;
        pushCxP("aereo", `Aéreo ${dv.aerolinea ?? ""}`.trim(), costoVueloReal, dv.proveedor, dv.aerolinea, null, dv.moneda ?? resultado.moneda);
      }

      // `ProveedorHotelBernalo` (camelCase: `aplicaRetencion`/`pctRetencion`)
      // vs. `ProvFact` (snake_case, la forma que ya arma el resto de este
      // archivo desde `.select("proveedores(...)")`) — se adapta explícito
      // en vez de mezclar las dos convenciones en `pushCxP`.
      const proveedorHotelCxP: ProvFact = resultado.proveedorHotel
        ? { nombre: resultado.proveedorHotel.nombre, aplica_retencion: resultado.proveedorHotel.aplicaRetencion, pct_retencion: resultado.proveedorHotel.pctRetencion }
        : null;
      // `costoAereoTotal` (si aplica) ya se acumuló DENTRO del bloque de
      // vuelo de arriba, con el costo REAL (`dv.costo_neto`/`fee_infante`) —
      // nunca `resultado.costoVueloTotal` (regla del cierre 3F-4B).
      costoHotelTotal += resultado.costoHotelTotal;
      pushCxP("hotel", `Hotel ${resultado.hotelNombre}`.trim(), resultado.costoHotelTotal, proveedorHotelCxP, null, null, resultado.moneda);
      for (const s of resultado.serviciosIncluidos) {
        if (s.costoNeto <= 0) continue;
        pushCxP(tipoProveedorCxpServicio(s.categoria), s.nombre, s.costoNeto, proveedoresServicios.get(s.servicioId) ?? null, null, s.servicioId, s.moneda ?? resultado.moneda);
      }
    }

    // Tours (opcionales del carrito): ítem visible del contrato + CxP real
    // cuando se puede re-liquidar el costo NETO al convertir (servicioId +
    // paqueteId presentes en el snapshot — cotizaciones de carrito creadas
    // ANTES de este cambio no los traen, quedan sin CxP automática igual que
    // antes, ver comentario de `TourCarritoPayload`).
    if (grupo.tours.length) {
      const itemsTours = grupo.tours.map((t, i) => ({
        numero_contrato: numero, descripcion: `Servicio · ${t.nombre}${t.destino ? ` — ${t.destino}` : ""}`,
        adultos: 1, ninos: 0, tarifa_adulto: t.precio, tarifa_nino: 0, orden: 9000 + i,
      }));
      await sb.from("contrato_items").insert(itemsTours);
      // Sin fuente de condición propia (servicios_adicionales no la tiene) —
      // neutro (% normal configurable), mismo criterio que traslado/
      // asistencia/otro en componentesManual.ts.
      if (usuarioCond) {
        for (let i = 0; i < grupo.tours.length; i++) {
          const t = grupo.tours[i];
          if (!(t.precio > 0)) continue;
          componentesCondicion.push({
            id: `tour-${i}`,
            tipo: "servicio",
            valor: t.precio,
            condicion: null,
            fechaViaje: null,
            referencia: t.nombre,
            restriccionComercial: "normal",
          });
        }
      }
      // CxP de cada tour opcional — re-liquida el costo NETO al convertir con
      // la MISMA fórmula que usa `reservarDesdeTarifarioInterno` (paso 11)
      // para sus servicios opcionales (temporada vigente, modo persona/
      // grupo, recargo individual si va 1 pax) — NUNCA usa `t.precio`, que
      // es el PVP ya marcado. FALLA CERRADO (B7): si el costo no se puede
      // re-liquidar, el contrato se deshace en vez de quedar con el tour
      // cobrado y sin deuda registrada con el proveedor.
      for (const t of grupo.tours) {
        if (t.servicioId == null || t.paqueteId == null) continue; // legado, sin ids para re-liquidar
        try {
          // Misma liquidación que la revisión previa (lib/reservar/costosObligacionesCarrito.ts::liquidarCostoTour). `null` = el tour ya no está en el paquete.
          const liq = await liquidarCostoTour(admin, { servicioId: t.servicioId, paqueteId: t.paqueteId, pax: t.pax, fechaIda: t.fechaIda, fechaRegreso: t.fechaRegreso });
          if (!liq) continue;
          const srv = liq.srv;
          const costoNeto = costoTourParaCxP(liq);
          if (costoNeto > 0) {
            pushCxP(tipoProveedorCxpServicio(normalizarCategoriaServicio(srv?.categoria)), srv?.nombre ?? t.nombre, costoNeto, srv?.proveedores ?? null, null, t.servicioId, monedaServicio.get(t.servicioId));
          }
        } catch (e) {
          // FALLA CERRADO (B7): el tour ya se le cobró al cliente como ítem
          // del contrato, así que su costo/CxP no puede faltar por un fallo
          // técnico silencioso.
          return fallarYRevertirGrupo(`No se pudo calcular el costo del tour "${t.nombre}": ${e instanceof Error ? e.message : "error desconocido"}.`);
        }
      }
    }

    // Servicios INCLUIDOS del paquete que pertenecen a este grupo
    // (`incluidosGrupo`, ver arriba) — su PVP ya está en `comp.precioVenta`
    // (nunca se vuelve a sumar acá), solo se genera su CxP real con el costo
    // RECALCULADO y validado contra la huella de la cotización. FALLA CERRADO (B7): el ingreso de ese servicio ya se le cobró
    // al cliente, así que su costo/CxP no pueden faltar en silencio.
    if (incluidosGrupo.length) {
      try {
        const ids = incluidosGrupo.map((s) => s.servicioId);
        const { data: provRows, error: provErr } = await admin
          .from("servicios_adicionales")
          .select("id, proveedores(nombre, aplica_retencion, pct_retencion)")
          .in("id", ids);
        if (provErr) throw new Error(provErr.message);
        const provPorId = new Map((provRows ?? []).map((r) => [r.id, r.proveedores as unknown as ProvFact]));
        for (const s of incluidosGrupo) {
          if (s.costoNeto > 0) {
            // El proveedor ya se validó contra la cotización (huella); si el
            // catálogo no lo devuelve, no se registra una CxP a nombre de nadie.
            const prov = provPorId.get(s.servicioId);
            if (!prov?.nombre) throw new Error(`el proveedor de «${s.nombre}» no se encontró en el catálogo`);
            pushCxP(tipoProveedorCxpServicio(s.categoria), s.nombre, s.costoNeto, prov, null, s.servicioId, monedaServicio.get(s.servicioId));
          }
        }
      } catch (e) {
        return fallarYRevertirGrupo(`No se pudo registrar el costo de los servicios incluidos del paquete: ${e instanceof Error ? e.message : "error desconocido"}.`);
      }
    }

    if (usuarioCond) {
      const trmCond = await trmReferenciaAproximada(admin, monedaGrupo);
      await congelarCondicionesContratoBestEffort(admin, {
        numeroContrato: numero,
        componentes: componentesCondicion,
        moneda: monedaGrupo,
        trm: trmCond,
        precioTotalMoneda: precioTotal,
        fechaPago: hoyServidor,
        usuarioId: usuarioCond.id,
      });
    }

    // `costo_receptivo` = suma de las CxP de SERVICIO creadas para este
    // contrato (tours opcionales + incluidos del paquete). Sin esto, el
    // carrito dejaba CxP de servicio con `costo_receptivo = 0`: la
    // rentabilidad mostraba margen inflado y `asegurarCuentasPorPagar` veía
    // cobertura sin costo. Se calcula de la MISMA lista que se va a insertar,
    // así ambos números salen de una sola fuente.
    if (estadoObligaciones.error) return fallarYRevertirGrupo(estadoObligaciones.error);
    const costoServiciosCarrito = cxp
      .filter((r) => r.servicio_id != null)
      .reduce((acc, r) => acc + (Number(r.valor_total) || 0), 0);
    // ESCRITURA FINANCIERA ATÓMICA (B7), igual que en el flujo del tarifario:
    // costos y CxP en UNA transacción. Antes eran dos escrituras sueltas SIN
    // chequeo de error — si cualquiera fallaba, este flujo seguía de largo y
    // devolvía los números de contrato como si todo hubiera quedado bien.
    const costosGrupo: CostosContrato = {};
    if (costoAereoTotal > 0 || costoHotelTotal > 0 || costoServiciosCarrito > 0) {
      costosGrupo.costo_aereo = costoAereoTotal;
      costosGrupo.costo_hotel = costoHotelTotal;
      if (costoServiciosCarrito > 0) costosGrupo.costo_receptivo = costoServiciosCarrito;
    }
    // Igual que el flujo individual, debe cerrar el estado aunque el payload
    // financiero sea vacío.
    const fin = await registrarFinancieroContrato(
      depsFinanciero(numero, tenantCotizacion, hoyServidor),
      { numeroContrato: numero, tenant: tenantCotizacion, costos: costosGrupo, cxp, fecha: hoyServidor }
    );
    // `registrarFinancieroContrato` YA revirtió este contrato (o dijo por
    // qué no pudo) — acá solo se agrega qué contratos del carrito sí
    // quedaron completos, para que el error no parezca cancelarlo todo.
    if (!fin.ok) {
      return { ok: false, error: numeros.length ? `${fin.error} (los contratos ${numeros.join(", ")} sí quedaron completos)` : fin.error };
    }

    numeros.push(numero);
    // Progreso DURABLE por grupo — se escribe ACÁ, apenas este grupo queda
    // completo, nunca solo al final: si un grupo POSTERIOR falla, un
    // reintento ya encuentra esta clave resuelta (Paso 1 la salta antes de
    // reliquidar) y no duplica este contrato. `agrupar: opts.agrupar` viaja
    // en CADA escritura para que el guard de modo de arriba tenga algo que
    // comparar desde el primer grupo que complete, no solo al final.
    contratosPorGrupo[claveGrupo] = numero;
    const { error: eDetalleGrupo } = await sb.from("cotizaciones").update({
      detalle: { ...detalleBase, contratos: numeros, contratosPorGrupo, agrupar: opts.agrupar },
    }).eq("id", id);
    // Hallazgo confirmado (idempotencia, ronda 2): si esta escritura falla,
    // el progreso NO quedó durable — un reintento no sabría que este grupo
    // ya está completo y lo duplicaría. El contrato ${numero} en sí YA es
    // real y válido (ventas + financiero ya se escribieron arriba) — nunca
    // se revierte por esto (sería peor: perder un contrato bueno por un
    // fallo de bookkeeping) — pero SÍ se corta acá, sin seguir de largo como
    // si el progreso fuera durable, para que quien reciba el error sepa que
    // tiene que revisar manualmente antes de reintentar.
    if (eDetalleGrupo) {
      return {
        ok: false,
        error: `El contrato ${numero} se creó correctamente, pero no se pudo guardar el progreso de la conversión (${eDetalleGrupo.message}). Antes de reintentar, revisa en /dashboard/contratos que no se dupliquen contratos para el mismo grupo/destino.`,
      };
    }
  }

  const { error: eDetalleFinal } = await sb.from("cotizaciones").update({
    estado: "convertida",
    numero_contrato: numeros[0],
    detalle: { ...detalleBase, contratos: numeros, contratosPorGrupo, agrupar: opts.agrupar },
  }).eq("id", id);
  if (eDetalleFinal) {
    return {
      ok: false,
      error: `Los contratos ${numeros.join(", ")} se crearon correctamente, pero no se pudo cerrar el estado de la cotización (${eDetalleFinal.message}). Los contratos son válidos — revisa la cotización manualmente antes de reintentar convertirla.`,
    };
  }

  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true, numeros, ...(advertencias.length ? { advertencias } : {}) };
}

export async function actualizarVigenciaCotizacion(id: number, vigenciaHasta: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { ok: false, error: "No autorizado." };
  // #40 E3: cambiar o renovar la vigencia es solo del personal interno; un aliado B2B activo de la misma agencia pasa `contextoCotizacion` pero no esta puerta.
  if (ctx.interno === false) return { ok: false, error: "No tienes permiso para cambiar la vigencia." };
  const sb = await createClient();
  let lectura = sb.from("cotizaciones").select("fecha_salida").eq("id", id).eq("estado", "abierta");
  if (!ctx.superadmin) lectura = lectura.eq("tenant", ctx.tenant);
  const { data: cot, error: errorLectura } = await lectura.maybeSingle();
  if (errorLectura) return { ok: false, error: errorLectura.message };
  if (!cot) return { ok: false, error: "Cotización no encontrada o sin acceso." };

  const vigenciaRes = resolverVigenciaCotizacion({
    hoy: hoyBogota(),
    fechaSalida: cot.fecha_salida,
    vigenciaSolicitada: vigenciaHasta,
  });
  if (!vigenciaRes.ok) return { ok: false, error: vigenciaRes.error };

  // El tenant NUNCA se toca aquí — solo se usa para filtrar qué fila puede
  // tocar el caller. Superadmin conserva alcance global.
  let q = sb.from("cotizaciones").update({ vigencia_hasta: vigenciaRes.vigencia }).eq("id", id).eq("estado", "abierta");
  if (!ctx.superadmin) q = q.eq("tenant", ctx.tenant);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Cotización no encontrada o sin acceso." };
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  return { ok: true };
}

export async function descartarCotizacion(id: number): Promise<{ ok: boolean; error?: string }> {
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { ok: false, error: "No autorizado." };
  const sb = await createClient();

  // A3 (auditoría 164): una cotización con pagos previos ACTIVOS/APLICADOS no se
  // puede descartar — el candado AUTORITATIVO es el trigger de BD
  // `cotizaciones_no_descartar_con_pagos` (aplica también a service_role/SQL
  // directo). Aquí hay una pre-comprobación de solo lectura para dar un mensaje
  // limpio ANTES de intentar el update; el trigger sigue siendo el respaldo si un
  // pago cae en la carrera entre la pre-comprobación y el update.
  const admin = createAdminClient();
  const { count: activos } = await admin
    .from("cotizacion_pagos_previos")
    .select("id", { count: "exact", head: true })
    .eq("cotizacion_id", id)
    .in("estado", ["activo", "aplicado"]);
  if (Number(activos) > 0) {
    return {
      ok: false,
      error: "No se puede descartar esta cotización: tiene pagos previos activos/aplicados. Debe anular cada pago previo (reversa contable formal) antes de descartarla.",
    };
  }

  let q = sb.from("cotizaciones").update({ estado: "descartada" }).eq("id", id).eq("estado", "abierta");
  if (!ctx.superadmin) q = q.eq("tenant", ctx.tenant);
  const { data, error } = await q.select("id");
  if (error) {
    // El trigger pudo haber detenido el descarte (pago concurrente) → mensaje limpio.
    if (/pagos previos activos|no_descartar_con_pagos/i.test(String(error.message))) {
      return {
        ok: false,
        error: "No se puede descartar esta cotización: tiene pagos previos activos/aplicados. Debe anular cada pago previo (reversa contable formal) antes de descartarla.",
      };
    }
    return { ok: false, error: "No se pudo descartar la cotización. Inténtalo de nuevo." };
  }
  if (!data?.length) return { ok: false, error: "Cotización no encontrada o sin acceso." };
  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  return { ok: true };
}

// ── Confirmar venta: sillas en_plazo -> confirmada ─────────────────────────
export async function confirmarVenta(numeroContrato: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  // W7 (§6.8), migración 197: la venta y sus sillas se confirman en UNA
  // transacción de la base (`confirmar_venta`). La función corre con la RLS
  // de quien llama (lee y actualiza `ventas` con su sesión, como antes) y
  // aplica dentro el candado de la 172: un contrato con la escritura
  // financiera incompleta (financiero_estado='pendiente') NUNCA se confirma.
  // Si cualquier parte falla, no cambia nada. Ya no necesita la clave de
  // servicio ni hay "compensación" en dos pasos.
  const { error } = await sb.rpc("confirmar_venta", { p_numero: numeroContrato });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  // Respaldo: si el contrato aún no tiene cuentas por pagar (p. ej. venía de
  // legacy o se creó manual), generarlas desde sus costos al confirmar. No debe
  // tumbar la confirmación si falla.
  try { await asegurarCuentasPorPagar(numeroContrato); } catch { /* no bloquear la confirmación */ }
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true };
}

// ── Respaldo de cuentas por pagar ──────────────────────────────────────────
// `asegurarCuentasPorPagar` vive en lib/reservar/asegurarCuentasPorPagar.ts.
// Escribe con service-role y NO autoriza: exportada desde este archivo
// ("use server") era una Server Action invocable por cualquiera. Quien la llama
// debe autorizar antes (ver completarProveedores y confirmarVenta).

// ── Liberar reservas vencidas ─────────────────────────────────────────────
// `liberarVencidas` vive en lib/reservar/liberarVencidas.ts por la misma razón:
// escribe con service-role sin sesión. La invocan solo el render de
// /dashboard/reservar (servidor) y el cron protegido por CRON_SECRET.

// ── Reservar un PROGRAMA (circuito de proveedor, en su moneda) ──────────────
// Flujo dedicado: el precio se calcula desde la matriz del programa (neto +
// markup), autoritativo en el servidor. Crea venta (con moneda), pasajeros,
// ítems, hoteles por ciudad y la cuenta por pagar al proveedor (en su moneda).
export type ReservaProgramaInput = {
  programaId: number;
  categoriaId: number;
  salidaId?: number; // cuando el programa tarifa por salida (modo_precio='salida')
  fechaIda: string;
  paxPorAcom: Record<string, number>; // CANTIDAD DE HABITACIONES por acomodación (sencilla/doble/triple/…). Pax = hab × pax_tarifa.
  ninos: number;
  infantes?: number; // cantidad de infantes (pasajeros adicionales, sin silla)
  cliente: { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string };
  tipoAsesor: "interno" | "agencia" | "freelance";
  asesorInterno: string;
  agenciaNombre: string;
  agenciaAsesor: string;
  freelanceNombre: string;
  plazo: string;
  pasajeros: PasajeroReserva[];
  /**
   * #57 — Importe total que el usuario VIO y confirmó en la moneda del
   * programa. El servidor recalcula con la regla única de precio
   * (`lib/programas/precioReserva57.ts`); si no coincide, no crea contrato,
   * CxP ni asientos: devuelve el nuevo importe (`cambioPrecio`) para que el
   * usuario lo acepte de forma expresa. Obligatorio: sin él no se reserva.
   */
  precioConfirmado: number;
};

/** #57 — `ReservaResult` + el rechazo por cambio de precio (sin escrituras). */
export type ReservaProgramaResultado =
  | ReservaResult
  | { ok: false; error: string; cambioPrecio: CambioPrecioPrograma };

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Flujo real (revisión posterior — corrección de observabilidad, mismo
// patrón que `crearContrato()` en contratos/actions.ts): la Server Action
// exportada es un wrapper delgado que genera el `flujo_id` de esta ejecución
// y mide la duración TOTAL (incluye `revalidatePath`) en `finally`, así que
// se emite en éxito, en cualquier rechazo de validación (early-return) y en
// excepción no capturada. `reservarProgramaInterno` es el cuerpo real, con
// las etapas atadas al mismo `flujo_id` — antes esta Server Action solo
// medía "contexto" y nada más, lo que no permitía diagnosticar el botón
// "Generar reserva" de Programas más allá del gate de autorización.
export async function reservarPrograma(input: ReservaProgramaInput): Promise<ReservaProgramaResultado> {
  const flujoId = generarFlujoId();
  const medir = crearMedidor("reservar_programa", flujoId);
  // Estado técnico INTERNO (revisión posterior — ronda 2, mismo mecanismo que
  // crearContrato() en contratos/actions.ts): nunca se expone al navegador ni
  // cambia el contrato público de esta función (lib/observabilidad/medicion.ts).
  const estado = crearEstadoFlujo();
  const _tTotal0 = performance.now();
  let _resultadoTotal: ResultadoEtapa = "error";
  try {
    const res = await reservarProgramaInterno(input, flujoId, medir, estado);
    _resultadoTotal = resultadoTotal(estado, res.ok);
    return res;
  } catch (err) {
    _resultadoTotal = "error";
    registrarErrorTecnico("reservar_programa", flujoId, "total", "excepcion", err);
    throw err;
  } finally {
    registrarEtapa("reservar_programa", flujoId, "total", Math.round(performance.now() - _tTotal0), _resultadoTotal);
  }
}

async function reservarProgramaInterno(
  input: ReservaProgramaInput,
  flujoId: string,
  medir: Medidor,
  estado: EstadoFlujo
): Promise<ReservaProgramaResultado> {
  // Contexto fail-closed INTERNO (revisión posterior al PR #274, ronda 2):
  // reservarPrograma() es exportada y por lo tanto alcanzable directo por
  // red — este flujo NO es autoservicio B2B como convertirCotizacion*/
  // reservarDesdeTarifarioInterno (no hay ninguna cotización previa cuya
  // propiedad valide el acceso; `tipoAsesor`/`agenciaNombre`/`freelanceNombre`
  // en `input` son solo la clasificación comercial de la venta —de quién
  // cobra comisión, elegida por el asesor interno que la vende— NUNCA la
  // identidad de quien llama). Su único caller real
  // (`ProgramaReservaForm.tsx`) vive bajo `/dashboard/reservar/programa/
  // [id]`, un módulo listado en `LECTURA_MODULO.reservar = ROLES_INTERNOS`
  // en `lib/constants.ts` — los roles externos (agencia/freelance/
  // cliente_final) YA quedan fuera de esa ruta por el propio `proxy.ts`
  // (el "único módulo permitido" para ellos no incluye "reservar" en
  // LECTURA_MODULO, pese a la excepción de bloqueo-de-dashboard). Por eso se
  // usa el MISMO contexto que `crearContrato()` (`contextoCrearContrato()`):
  // sesión + activo=true + rol con permiso real de escritura sobre `ventas`
  // (`ESCRITURA.ventas` = superadmin/administracion/gerencia/operaciones/
  // venta) — esto es lo que cierra el hueco real: antes, el gate de sesión
  // usado por las cotizaciones (mismo criterio que `autorizaTenant`) solo
  // exigía un perfil activo, así que un `control_vuelo` (rol interno,
  // pero SIN permiso de crear ventas) activo podía alcanzar este RPC
  // administrativo, gastar un consecutivo DTM y fallar recién al insertar
  // en `ventas` por RLS.
  const ctx = await medir("contexto", () => contextoCrearContrato("reservar_programa", flujoId), (r) => (r.ok ? "ok" : r.tecnico ? "error" : "rechazado"));
  if (!ctx.ok) {
    // `ctx.tecnico` (revisión posterior — ronda 3): un fallo TÉCNICO real de
    // auth.getUser()/la consulta de usuarios eleva el TOTAL a "error" — antes
    // quedaba indistinguible de "rechazado". El mensaje público no cambia.
    if (ctx.tecnico) elevarEstadoFlujo(estado, "error");
    return { ok: false, error: ctx.error };
  }
  // Reutiliza el MISMO cliente de sesión que `contextoCrearContrato()` ya
  // creó y autenticó (optimización posterior al PR #274, ver el comentario
  // en `lib/contrato/contexto.ts`) — antes se creaba aquí ANTES del gate,
  // así que un intento rechazado también pagaba el costo de un cliente
  // (barato, pero innecesario) que nunca se llegaba a usar.
  const { tenant, sb } = ctx;

  // Fallas NO bloqueantes que SÍ se reportan (ver el comentario de
  // ReservaResult) — hoy solo las llena el guardado best-effort de
  // nombres/apellidos/nacionalidad, más abajo.
  const advertencias: string[] = [];

  // Etapa "validacion_programa": programa + vigencia + blackouts + precios +
  // habitaciones/pax + validación de edades — varias validaciones con
  // retorno anticipado; el cierre se loguea justo antes de generar el
  // número de contrato (único punto que se alcanza solo si todas pasaron).
  const _tValidacionProg0 = performance.now();
  // Revisión posterior — ronda 2 (mismo mecanismo que crearContrato() en
  // contratos/actions.ts): envuelve cada `return` de rechazo de esta sección
  // para que la etapa quede en "rechazado" sin duplicar el log de éxito
  // (mutuamente excluyentes) y sin reordenar ninguna validación.
  const _rechazarValidacionPrograma = (resultado: ReservaProgramaResultado): ReservaProgramaResultado => {
    registrarEtapa("reservar_programa", flujoId, "validacion_programa", Math.round(performance.now() - _tValidacionProg0), "rechazado");
    return resultado;
  };
  // Revisión posterior — ronda 3 (mismo criterio que crearContratoInterno):
  // las consultas de esta sección (programas, programa_blackouts,
  // programa_salidas, programa_precios, programa_categorias) desestructuraban
  // solo `data` e ignoraban `error` — un fallo TÉCNICO de Supabase terminaba
  // indistinguible de "no existe"/"sin precios", y en el caso de
  // programa_blackouts un fallo técnico dejaba pasar la reserva EN SILENCIO
  // (bos ?? [] = sin blackouts). `_errorValidacionPrograma` eleva el TOTAL a
  // "error" (nunca "rechazado"), registra el detalle técnico server-side, y
  // devuelve un mensaje público FIJO — nunca el error crudo de Supabase.
  const _errorValidacionPrograma = (detalle: string, error: unknown): ReservaResult => {
    registrarEtapa("reservar_programa", flujoId, "validacion_programa", Math.round(performance.now() - _tValidacionProg0), "error");
    registrarErrorTecnico("reservar_programa", flujoId, "validacion_programa", detalle, error);
    elevarEstadoFlujo(estado, "error");
    return { ok: false, error: MSG_ERROR_VALIDACION_PROGRAMA };
  };

  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim())
    return _rechazarValidacionPrograma({ ok: false, error: "El nombre del cliente es obligatorio." });
  if (!input.fechaIda) return _rechazarValidacionPrograma({ ok: false, error: "Elige la fecha de salida." });

  // 1) Programa + precios (autoritativo). proveedores/neto se leen aquí.
  const { data: prog, error: progError } = await sb
    .from("programas")
    .select("id, nombre, subtitulo, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, modo_precio, dias, noches, proveedor_id, vigencia_desde, vigencia_hasta, edad_nino_min, edad_nino_max, edad_infante_max, condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo, restriccion_comercial, regla_comisionable, regla_comisionable_modalidad_mk, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision, regla_comisionable_impuesto_por_acomodacion, proveedores(nombre, aplica_retencion, pct_retencion)")
    .eq("id", input.programaId)
    .maybeSingle();
  if (progError) return _errorValidacionPrograma("error_consulta_programa", progError);
  if (!prog) return _rechazarValidacionPrograma({ ok: false, error: "Programa no encontrado." });
  const modoSalida = prog.modo_precio === "salida";

  // Vigencia
  if (prog.vigencia_desde && input.fechaIda < prog.vigencia_desde)
    return _rechazarValidacionPrograma({ ok: false, error: "La fecha de salida es anterior a la vigencia del programa." });
  if (prog.vigencia_hasta && input.fechaIda > prog.vigencia_hasta)
    return _rechazarValidacionPrograma({ ok: false, error: "La fecha de salida supera la vigencia del programa." });

  // Blackouts
  const { data: bos, error: bosError } = await sb
    .from("programa_blackouts")
    .select("fecha_inicio, fecha_fin, motivo")
    .eq("programa_id", input.programaId);
  if (bosError) return _errorValidacionPrograma("error_consulta_blackouts", bosError);
  for (const b of bos ?? []) {
    if (b.fecha_inicio && b.fecha_fin && input.fechaIda >= b.fecha_inicio && input.fechaIda <= b.fecha_fin)
      return _rechazarValidacionPrograma({ ok: false, error: `La fecha cae en un blackout${b.motivo ? ` (${b.motivo})` : ""}.` });
  }

  // 2) Precios — por categoría (matriz) o por salida (fecha × precio).
  //    #57: el PVP sale de la REGLA ÚNICA (`lib/programas/precioReserva57.ts`),
  //    la misma que la ficha y el formulario: regla 161 (tarifa de proveedor y
  //    modalidad de MK), fee bancario dentro del PVP y asistencia por las noches
  //    de la salida o, si son NULL, por los días del programa. Antes se usaba
  //    `pvpPrograma(neto)` suelto con `dias − 1` y sin la regla 161.
  let fuentePrecio: FuentePrecio;
  let nochesViaje = prog.dias != null ? Math.max(0, prog.dias - 1) : null; // noches del viaje (fecha de regreso)
  let etiquetaOpcion: string | null = null; // nombre de la opción elegida (categoría o salida)
  let hotelSalida: string | null = null;

  if (modoSalida) {
    if (!input.salidaId) return _rechazarValidacionPrograma({ ok: false, error: "Elige una salida." });
    const { data: sal, error: salError } = await sb
      .from("programa_salidas")
      .select("etiqueta, columna, noches, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud, tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple, impuesto_sencilla, impuesto_doble, impuesto_triple, impuesto_multiple")
      .eq("id", input.salidaId)
      .eq("programa_id", input.programaId)
      .maybeSingle();
    if (salError) return _errorValidacionPrograma("error_consulta_salida", salError);
    if (!sal) return _rechazarValidacionPrograma({ ok: false, error: "Salida no encontrada." });
    fuentePrecio = { modo: "salida", salida: sal };
    if (sal.noches != null) nochesViaje = sal.noches;
    etiquetaOpcion = sal.etiqueta ?? null;
    hotelSalida = sal.columna ?? null;
  } else {
    const { data: precios, error: preciosError } = await sb
      .from("programa_precios")
      .select("acomodacion, neto, bajo_solicitud")
      .eq("categoria_id", input.categoriaId);
    if (preciosError) return _errorValidacionPrograma("error_consulta_precios", preciosError);
    if (!precios?.length) return _rechazarValidacionPrograma({ ok: false, error: "La categoría no tiene precios cargados." });
    fuentePrecio = { modo: "categoria", precios };
  }

  // 3) Liquidación por HABITACIONES (igual que hoteles): pax = hab × pax_tarifa
  //    (Doble ⇒ 2 pax, Triple ⇒ 3, Sencilla ⇒ 1). El precio de la matriz es por
  //    persona, así que 1 habitación = pax_tarifa × precio/persona. Niños aparte.
  //    La FORMA de la solicitud (sin habitaciones ni niños, sin pasajeros) se
  //    valida aquí, como siempre; los errores de PRECIO (acomodación o niño sin
  //    tarifa) los devuelve la liquidación compartida.
  const hayHabitaciones = Object.values(input.paxPorAcom).some((n) => (Number(n) || 0) > 0);
  if (!hayHabitaciones && (Number(input.ninos) || 0) <= 0)
    return _rechazarValidacionPrograma({ ok: false, error: "Indica cuántas habitaciones reservas en cada acomodación." });
  const liq = liquidarSeleccion({
    programa: prog,
    fuente: fuentePrecio,
    habitaciones: input.paxPorAcom,
    ninos: input.ninos,
    infantes: input.infantes,
  });
  // El mensaje NO lleva cifras de costo (neto del proveedor, costo atribuible): el rol `venta`
  // también reserva programas y no debe verlas; tampoco se loguean (los logs no llevan datos de negocio).
  if (!liq.ok) return _rechazarValidacionPrograma({ ok: false, error: liq.error });
  const { precioVenta, costoNeto, totalPax } = liq;
  if (totalPax <= 0) return _rechazarValidacionPrograma({ ok: false, error: "Debe haber al menos un pasajero." });
  const numInfantes = Math.max(0, Math.trunc(Number(input.infantes) || 0));

  const items: { numero_contrato: string; descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; orden: number }[] = [];
  let catNombre: string | null = etiquetaOpcion;
  if (!modoSalida) {
    const { data: catData, error: catError } = await sb.from("programa_categorias").select("nombre").eq("id", input.categoriaId).maybeSingle();
    if (catError) return _errorValidacionPrograma("error_consulta_categoria", catError);
    catNombre = catData?.nombre ?? null;
  }

  let orden = 0;
  for (const l of liq.lineas) {
    const label = ACOM_ROOM_LABEL[l.acomodacion as AcomRoom] ?? (l.acomodacion === "cuadruple" ? "Cuádruple" : l.acomodacion);
    items.push({
      numero_contrato: "",
      descripcion: `${l.habitaciones} hab ${label} (${l.pax} pax)${catNombre ? ` · ${catNombre}` : ""}`,
      adultos: l.pax,
      ninos: 0,
      tarifa_adulto: l.pvpUnit,
      tarifa_nino: 0,
      orden: orden++,
    });
  }
  // Niños (por cantidad, no por habitación)
  if (liq.nino) {
    items.push({
      numero_contrato: "",
      descripcion: `${liq.nino.cantidad} niño(s)${catNombre ? ` · ${catNombre}` : ""}`,
      adultos: 0,
      ninos: liq.nino.cantidad,
      tarifa_adulto: 0,
      tarifa_nino: liq.nino.pvpUnit,
      orden: orden++,
    });
  }

  // 3.b) Validación de pasajeros por edad (umbrales del programa, según el
  //      proveedor). Si hay fechas de nacimiento, la clasificación real debe
  //      cuadrar con los niños/infantes declarados; si faltan, no se bloquea.
  {
    const numNinos = Math.max(0, Math.trunc(Number(input.ninos) || 0));
    const infanteMax = prog.edad_infante_max ?? 1;
    const ninoMax = prog.edad_nino_max ?? 11;
    const real = clasificarPorEdad(
      input.pasajeros.map((p) => calcularEdad(p.fechaNacimiento, input.fechaIda)),
      infanteMax,
      ninoMax
    );
    if (input.pasajeros.length && real.sinFecha === 0) {
      const adultosEsperados = totalPax - numNinos - numInfantes;
      const errores: string[] = [];
      if (real.infantes > numInfantes)
        errores.push(`Por fecha de nacimiento hay ${real.infantes} infante(s), pero declaraste ${numInfantes}.`);
      if (real.ninos > numNinos)
        errores.push(`Por fecha de nacimiento hay ${real.ninos} niño(s), pero declaraste ${numNinos}.`);
      if (real.adultos > adultosEsperados)
        errores.push(`Por fecha de nacimiento hay ${real.adultos} adulto(s), pero la reserva es para ${adultosEsperados}.`);
      if (errores.length) return _rechazarValidacionPrograma({ ok: false, error: errores.join(" ") });
    }
  }

  // 3.c) #57 — CONFIRMACIÓN DEL PRECIO. El importe que el usuario vio y confirmó
  //      debe ser el que cobra el servidor con la regla única. Si cambió (el
  //      programa se editó entre la lectura y la confirmación, o es el segundo
  //      cambio de un reintento), se rechaza AQUÍ: antes de numerar y de toda
  //      escritura (sin contrato, CxP ni asientos), devolviendo el nuevo importe
  //      para que el usuario lo acepte de forma expresa. Cada intento recalcula.
  const confirmacion = evaluarPrecioConfirmado(input.precioConfirmado, precioVenta, prog.moneda);
  if (!confirmacion.ok) {
    return _rechazarValidacionPrograma({ ok: false, error: confirmacion.error, cambioPrecio: confirmacion.cambioPrecio });
  }

  registrarEtapa("reservar_programa", flujoId, "validacion_programa", Math.round(performance.now() - _tValidacionProg0), "ok");

  // 4) Número de contrato — ya completo, tenant resuelto arriba (nunca del navegador)
  const numRes = await medir("numero_contrato", () => siguienteNumeroContrato(tenant), (r) => (r.ok ? "ok" : "error"));
  if (!numRes.ok) {
    // Fallo TÉCNICO bloqueante (RPC de numeración) — nunca "rechazado".
    // `numRes.error` ya es un mensaje saneado por el propio RPC.
    elevarEstadoFlujo(estado, "error");
    return { ok: false, error: numRes.error };
  }
  const numero = numRes.numero;

  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  // Todo contrato lleva ASESOR INTERNO (quien firma/vende internamente y a quien
  // aplica la escala). La agencia/freelance se guarda aparte (canal B2B).
  const asesorNombre = input.asesorInterno;
  const fechaRegreso = nochesViaje != null ? sumarDias(input.fechaIda, nochesViaje) : prog.dias ? sumarDias(input.fechaIda, Math.max(0, prog.dias - 1)) : null;

  // #57 — impuesto fiscal verificable (solo B2B) y residual de la base comisionable.
  const impuestoVenta = impuestoParaVenta(liq, input.tipoAsesor);
  const residualB2B = avisoResidualBaseB2B(liq, input.tipoAsesor);
  if (residualB2B) advertencias.push(residualB2B);

  // 5) Venta (cabecera) — nace PENDIENTE, en la moneda del programa
  const _tVenta0 = performance.now();
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    tenant,
    cliente: `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim(),
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_tipo_documento: tipoDocumentoParaVenta(input.cliente.tipoDoc, input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_email: oNull(input.cliente.email),
    destino: prog.subtitulo ?? prog.nombre,
    tipo_paquete: "programa",
    moneda: prog.moneda,
    fecha_salida: input.fechaIda,
    fecha_regreso: fechaRegreso,
    pax: totalPax,
    hotel: prog.nombre,
    precio_venta: precioVenta,
    estado: "pendiente",
    canal,
    tipo_asesor: input.tipoAsesor,
    agencia_nombre: oNull(input.agenciaNombre),
    agencia_asesor: oNull(input.agenciaAsesor),
    freelance_nombre: oNull(input.freelanceNombre),
    plazo: oNull(input.plazo),
    asesor_firma_nombre: oNull(asesorNombre),
    plan_nombre: catNombre ?? prog.nombre,
    // #57 — base comisionable B2B: SOLO un impuesto del proveedor verificable
    // (regla en modo `impuesto` con tarifa de proveedor cargada). Nunca se
    // infiere de `montoNoComisionable` ni de la reducción por % de la regla.
    ...(impuestoVenta != null ? { impuesto: impuestoVenta } : {}),
  });
  registrarEtapa("reservar_programa", flujoId, "insert_venta", Math.round(performance.now() - _tVenta0), ve ? "error" : "ok");
  if (ve) {
    elevarEstadoFlujo(estado, "error");
    registrarErrorTecnico("reservar_programa", flujoId, "insert_venta", "error_insert_venta", ve);
    return { ok: false, error: MSG_ERROR_GUARDAR_RESERVA };
  }

  // 5bis) Congelar condiciones de pago (Rama B, migración 165) — best-effort,
  // nunca bloquea la reserva. Un programa es UN SOLO componente ("programa")
  // por precio_venta completo, condicionado por su propia fila real de
  // `programas` (ya traída arriba, sin re-consultar).
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const adminCond = createAdminClient();
    const { data: { user: usuarioCond } } = await sb.auth.getUser();
    if (usuarioCond) {
      const fechaPagoCond = fechaNegocio();
      const componente = componenteDePrograma(prog, {
        id: `programa-${input.programaId}`,
        valor: precioVenta,
        referencia: prog.nombre,
        fechaViaje: input.fechaIda,
      });
      const trmCond = await trmReferenciaAproximada(adminCond, prog.moneda);
      await congelarCondicionesContratoBestEffort(adminCond, {
        numeroContrato: numero,
        componentes: [componente],
        moneda: prog.moneda,
        trm: trmCond,
        precioTotalMoneda: precioVenta,
        fechaPago: fechaPagoCond,
        usuarioId: usuarioCond.id,
      });
    }
  }

  // 6-8) Tablas hijas — pasajeros/items/hoteles, medidas como un solo grupo
  // (etapa=insert_hijas, mismo criterio que crearContrato()): no se
  // reordenan ni paralelizan sin antes demostrar sus dependencias. Antes de
  // esta ronda, los INSERT de ítems y hoteles descartaban su `error` en
  // silencio (nunca bloqueaban, pero tampoco quedaba registro de que algo
  // había fallado) — ahora se capturan para que la métrica diga "error" en
  // vez de "ok" si alguno falla, sin cambiar el comportamiento histórico
  // (siguen sin bloquear la reserva).
  const _tHijas0 = performance.now();
  const _errorHijas = (detalle: string, error: unknown) => {
    registrarEtapa("reservar_programa", flujoId, "insert_hijas", Math.round(performance.now() - _tHijas0), "error");
    registrarErrorTecnico("reservar_programa", flujoId, "insert_hijas", detalle, error);
    elevarEstadoFlujo(estado, "error");
    return { ok: false as const, error: MSG_ERROR_GUARDAR_RESERVA };
  };
  let _resultadoHijas: ResultadoEtapa = "ok";

  // 6) Pasajeros + responsable — vía crear_pasajeros_contrato (migración
  // 167): un programa no usa sillas/bloqueos propios (p_holders_min = 0,
  // no-op en _ajustar_sillas_nucleo), pero SÍ debe pasar por el mismo
  // mecanismo transaccional para que `es_infante` se recalcule SIEMPRE
  // server-side (antes se confiaba en `p.esInfante`, el flag que manda el
  // cliente) y para que todo infante nuevo exija un adulto responsable
  // vinculado (revisión de alto riesgo — B1), con un mensaje claro si el
  // formulario no lo capturó, en vez de guardarlo en silencio sin vínculo.
  if (input.pasajeros.length) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return _errorHijas("sin_service_role_para_pasajeros", null);
    const { data: { user: actorPasajeros } } = await sb.auth.getUser();
    if (!actorPasajeros) return _errorHijas("sin_usuario_para_pasajeros", null);
    const admin = createAdminClient();
    const payloadPasajeros = payloadGuardarPasajeros(
      input.pasajeros.map((p) => ({
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
        tipoId: oNull(p.tipoDoc) ?? "CC",
        identificacion: oNull(p.numeroDoc) ?? "",
        fechaNacimiento: p.fechaNacimiento ?? "",
        esInfante: false,
        responsableIndex: p.responsableIndex ?? null,
      }))
    );
    const { data: pasajerosCreadosPrograma, error } = await admin.rpc("crear_pasajeros_contrato", {
      p_numero_contrato: numero,
      p_pasajeros: payloadPasajeros as unknown as Json,
      p_holders_min: 0,
      p_usuario_id: actorPasajeros.id,
    });
    if (error) return _errorHijas("pasajeros", error);

    // nombres/apellidos/nacionalidad — mismo criterio que
    // reservarDesdeTarifarioInterno: POSTERIOR al RPC atómico (no forman
    // parte de v_claves_validas de _reemplazar_pasajeros_nucleo, migración
    // 167), un fallo NO revierte la reserva, pero SÍ se revisa `{ error }`
    // de cada UPDATE y se reporta honestamente en `advertencias` — nunca se
    // asume éxito sin comprobarlo.
    const filasPasajerosCreadosPrograma = (pasajerosCreadosPrograma ?? []).slice().sort((a, b) => a.orden - b.orden);
    await Promise.all(
      filasPasajerosCreadosPrograma.map(async (f, i) => {
        const p = input.pasajeros[i];
        const patch: { nacionalidad?: string; nombres?: string; apellidos?: string } = {};
        const nac = oNull(p?.nacionalidad);
        const nom = oNull(p?.nombres);
        const ape = oNull(p?.apellidos);
        if (nac) patch.nacionalidad = nac;
        if (nom) patch.nombres = nom;
        if (ape) patch.apellidos = ape;
        if (Object.keys(patch).length === 0) return;
        const { error: errDemografico } = await admin.from("contrato_pasajeros").update(patch).eq("id", f.id);
        if (errDemografico) {
          const etiqueta = `${p?.nombres ?? ""} ${p?.apellidos ?? ""}`.trim() || `pasajero #${i + 1}`;
          advertencias.push(`No se pudo guardar nacionalidad/nombres estructurados de ${etiqueta}: ${errDemografico.message}`);
        }
      })
    );
  }

  // 7) Ítems (líneas por acomodación)
  for (const it of items) it.numero_contrato = numero;
  if (items.length) {
    const { error } = await sb.from("contrato_items").insert(items);
    if (error) return _errorHijas("items", error);
  }

  // 8) Hoteles por ciudad (de la categoría elegida) — informativo en el
  //    contrato: su fallo NO bloquea la reserva (comportamiento histórico
  //    sin cambios), pero ya no queda como "ok" sin más — la métrica pasa a
  //    "parcial". En modo salida no hay matriz de hoteles; se usa el hotel
  //    de la columna si lo hay.
  const provNombre = (prog.proveedores as unknown as { nombre: string } | null)?.nombre ?? null;
  const { data: hotelesCat, error: hotelesCatError } = modoSalida
    ? { data: hotelSalida ? [{ ciudad: prog.subtitulo ?? prog.nombre, hotel: hotelSalida, orden: 0 }] : [], error: null }
    : await sb
        .from("programa_categoria_hoteles")
        .select("ciudad, hotel, orden")
        .eq("categoria_id", input.categoriaId)
        .order("orden");
  if (hotelesCatError) {
    _resultadoHijas = "parcial";
    registrarErrorTecnico("reservar_programa", flujoId, "insert_hijas", "error_consulta_hoteles_categoria", hotelesCatError);
  }
  if (hotelesCat?.length) {
    const { error: hotelesInsertError } = await sb.from("contrato_hoteles").insert(
      hotelesCat.map((h, i) => ({
        numero_contrato: numero,
        nombre: h.hotel ?? "",
        categoria: catNombre,
        proveedor: provNombre,
        ciudad: h.ciudad,
        detalle_acomodacion: `${totalPax} pax`,
        orden: i,
      }))
    );
    if (hotelesInsertError) {
      _resultadoHijas = "parcial";
      registrarErrorTecnico("reservar_programa", flujoId, "insert_hijas", "error_insert_hoteles", hotelesInsertError);
    }
  }
  registrarEtapa("reservar_programa", flujoId, "insert_hijas", Math.round(performance.now() - _tHijas0), _resultadoHijas);
  // Solo alcanzable aquí por el fallo NO bloqueante de hoteles (pasajeros/
  // items bloquean y elevan "error" antes de llegar a esta línea, vía
  // `_errorHijas`) — best-effort: eleva el TOTAL a "parcial", nunca a "error".
  if (_resultadoHijas !== "ok") elevarEstadoFlujo(estado, "parcial");

  // 9) Cuenta por pagar al proveedor del programa (neto, en la moneda del
  // programa). Best-effort igual que antes (no bloquea la reserva), pero la
  // MÉTRICA ya no dice "ok" a ciegas: "parcial" si algún paso individual
  // devolvió `error` sin lanzar excepción, "error" si entró al catch.
  const _tCxp0 = performance.now();
  let _huboBloqueCxp = false;
  let _resultadoCxp: ResultadoEtapa = "ok";
  if (costoNeto > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    _huboBloqueCxp = true;
    try {
      const admin = createAdminClient();
      const pr = prog.proveedores as unknown as { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
      const { error: updateError } = await admin.from("ventas").update({ costo_receptivo: costoNeto }).eq("numero_contrato", numero);
      if (updateError) {
        _resultadoCxp = "parcial";
        registrarErrorTecnico("reservar_programa", flujoId, "cxp_programa", "error_update_costo", updateError);
      }
      const fechaProg = fechaNegocio();
      const { data: cProg, error: cProgError } = await admin.from("cuentas_por_pagar").insert({
        numero_contrato: numero,
        proveedor: pr?.nombre ?? null,
        tipo_proveedor: "programa",
        servicio: prog.nombre,
        valor_total: costoNeto,
        moneda: prog.moneda,
        fecha_obligacion: fechaProg,
        aplica_retencion: pr?.aplica_retencion ?? false,
        pct_retencion: Number(pr?.pct_retencion) || 0,
        observaciones: "Generado automáticamente desde el tarifario (programa)",
      }).select("id").single();
      if (cProgError) {
        _resultadoCxp = "error";
        registrarErrorTecnico("reservar_programa", flujoId, "cxp_programa", "error_insert_cxp", cProgError);
      }
      if (cProg) {
        const asiento = await postearAsientoCxP({
          cuentaId: cProg.id, numeroContrato: numero, tipoProveedor: "programa", proveedor: pr?.nombre ?? null,
          servicio: prog.nombre, valorTotal: costoNeto, fecha: fechaProg,
        });
        if (!asiento.ok) {
          if (_resultadoCxp === "ok") _resultadoCxp = "parcial";
          registrarErrorTecnico("reservar_programa", flujoId, "cxp_programa", "error_asiento_cxp", asiento.error);
        }
      }
    } catch (e) {
      // No bloquear la reserva si falla el paso administrativo (sin
      // cambios) — pero la métrica SÍ debe decir "error", nunca "ok".
      _resultadoCxp = "error";
      registrarErrorTecnico("reservar_programa", flujoId, "cxp_programa", "excepcion", e);
    }
  }
  if (_huboBloqueCxp) {
    registrarEtapa("reservar_programa", flujoId, "cxp_programa", Math.round(performance.now() - _tCxp0), _resultadoCxp);
    // Best-effort: nunca bloquea la reserva, pero eleva el TOTAL.
    if (_resultadoCxp !== "ok") elevarEstadoFlujo(estado, "parcial");
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero, ...(advertencias.length ? { advertencias } : {}) };
}
