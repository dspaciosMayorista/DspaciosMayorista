"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio, noches, temporadaVigenteParaFecha, toTemporadaRango, factorLiquidacion, type TemporadaRango } from "@/lib/calc/paquetes";
import { ACOM_ROOM_LABEL, paxDeAcomodacion, clasificarPorEdad, type AcomRoom } from "@/lib/acomodaciones";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { calcularEdad } from "@/lib/utils";
import { pvpPrograma } from "@/lib/programas";
import { postearAsientoCxP } from "@/lib/contabilidad/asientos";
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
import { resolverDatosVuelo, type DatosVueloOrigen } from "@/lib/reservar/empaquetadoOrigen";
import { esInfantePorEdad, pasajeroConsumeSilla } from "@/lib/reservar/pasajeros";
import { payloadGuardarPasajeros } from "@/lib/reservar/pasajerosEdicion";
import { normalizarResponsablesPorGrupo } from "@/lib/reservar/pasajerosFilas";
import { posicionesSinAsignar, posicionesUnicasDeGrupo, reindexarGrupoLocal, consolidarReservasSillasPorBloqueo } from "@/lib/reservar/carritoAsignaciones";
import {
  componenteHotelReal,
  componentePaqueteReal,
  trmReferenciaAproximada,
  congelarCondicionesContratoBestEffort,
} from "@/lib/contrato/congelarCondicionesContrato";
import { componenteDePrograma } from "@/lib/cotizacion/condicionDesdeCatalogo";
import type { ComponenteSnapshot } from "@/lib/cotizacion/snapshotCondiciones";

const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);

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

export type ReservaResult = { ok: true; numero: string } | { ok: false; error: string };

// NO EXPORTADA a propósito (defecto reportado en la revisión de PR #267): una
// Server Action exportada es alcanzable por el navegador con CUALQUIER
// argumento serializable, así que un `tenant` en la firma pública permitía
// que el cliente lo eligiera. El único caller válido es `convertirCotizacion`
// (mismo archivo), que ya validó `cot.tenant` en el servidor antes de llamar
// — el tenant llega aquí siempre ya autorizado, nunca desde el navegador.
async function reservarDesdeTarifarioInterno(input: ReservaInput, tenant: Tenant): Promise<ReservaResult> {
  const sb = await createClient();

  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";

  // 1) Cálculo (precios, líneas, pax, impuesto) — fuente única compartida.
  const comp = await computarReserva(sb, input);
  if (!comp.ok) return { ok: false, error: comp.error };
  const { origen, meta, pvpPorAcom, netoPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, impuestoTotal, monedaReserva, cargoMascota } = comp.data;

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

    if (origen.tipo === "bloqueo") {
      const { count, error: ce } = await admin
        .from("sillas")
        .select("id", { count: "exact", head: true })
        .eq("bloqueo_id", origen.id)
        .in("estado", ["disponible", "cambio_entrante"]);
      if (ce) return { ok: false, error: `No se pudo validar los cupos del vuelo: ${ce.message}` };
      const disponibles = count ?? 0;
      if (disponibles < paxConSilla) {
        return { ok: false, error: `No hay cupos suficientes en este vuelo (disponibles: ${disponibles}, requeridos: ${paxConSilla}).` };
      }
    }
  }
  const infantesN = Math.max(0, Math.trunc(Number(input.infantes) || 0));
  // Costo NETO real (lo que se le debe al proveedor) — nunca la reventa. Con
  // tarifa_proveedor=200.000/tarifa_para_empaquetar=242.022 (2 pax), usar la
  // reventa dejaba costo_aereo/CxP en $484.044 en vez de los $400.000 reales
  // (hallazgo de la revisión posterior al PR #268, punto 1 "COSTO FINANCIERO").
  const costoAereo = datosVuelo ? datosVuelo.costo_neto * paxConSilla + datosVuelo.fee_infante * infantesN : 0;

  // 3) Número de contrato — ya completo (DTM-#### / MIN-00-####), tenant
  // recibido como parámetro ya validado por el caller (nunca del navegador).
  const numRes = await siguienteNumeroContrato(tenant);
  if (!numRes.ok) return { ok: false, error: numRes.error };
  const numero = numRes.numero;

  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  // Todo contrato lleva ASESOR INTERNO (quien firma/vende internamente y a quien
  // aplica la escala). La agencia/freelance se guarda aparte (canal B2B).
  const asesorNombre = input.asesorInterno;

  // 4-bis) Modo de compra B2B (neta vs comisionable).
  //   base comisionable = PVP − impuesto (BNC) · comisión = base × % del aliado.
  //   · neta         → el aliado paga PVP − comisión (se descuenta).
  //   · comisionable → paga el PVP; la comisión se liquida aparte.
  let precioFinal = precioVenta;
  let baseComisB2B = 0;
  let pctComB2B = 0;
  let comisionB2B: number | null = null;
  let modoCompra: string | null = null;
  let comisionEstado: string | null = null;
  let b2bUsuarioId: string | null = null;
  if (input.tipoAsesor !== "interno" && input.modoCompra) {
    baseComisB2B = Math.max(0, precioVenta - impuestoTotal);
    let pct: number | null = null;
    if (input.aliadoId) {
      const { data: al } = await sb.from("aliados").select("pct_comision").eq("id", input.aliadoId).maybeSingle();
      pct = al?.pct_comision ?? null;
    }
    if (pct == null) {
      const defParam = input.tipoAsesor === "agencia" ? "COMISION_AGENCIA" : "COMISION_FREELANCE";
      const { data: p } = await sb.from("parametros_tributarios").select("valor").eq("parametro", defParam).maybeSingle();
      pct = Number(p?.valor) || (input.tipoAsesor === "agencia" ? 0.12 : 0.11);
    }
    pctComB2B = pct;
    const comision = Math.round(baseComisB2B * pct);
    modoCompra = input.modoCompra;
    comisionB2B = comision;
    if (modoCompra === "neta") { precioFinal = Math.max(0, precioVenta - comision); comisionEstado = "descontada"; }
    else { comisionEstado = "pendiente"; }
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
      if (perfil?.rol === "agencia" || perfil?.rol === "freelance") b2bUsuarioId = user.id;
    }
  }

  // 4) Venta (cabecera) — nace PENDIENTE
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    // Conserva EXACTAMENTE el tenant de la cotización de origen — ya validado
    // por el único caller (`convertirCotizacion`) antes de llegar aquí.
    tenant,
    cliente: `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim(),
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_email: oNull(input.cliente.email),
    destino: meta.destino_nombre,
    tipo_paquete: input.modulo,
    moneda: monedaReserva,
    fecha_salida: meta.fecha_ida,
    fecha_regreso: meta.fecha_regreso,
    pax: totalPax || paxConSilla,
    hotel: esServicios ? null : meta.hotel_nombre,
    precio_venta: precioFinal,
    impuesto: impuestoTotal,
    // Costo aéreo/aerolínea del origen ya resuelto y validado en el paso 2c
    // (nunca de una consulta posterior que pueda fallar en silencio).
    costo_aereo: datosVuelo ? costoAereo : undefined,
    aerolinea: datosVuelo?.aerolinea ?? null,
    estado: "pendiente",
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
    aliado_id: input.tipoAsesor !== "interno" ? input.aliadoId ?? null : null,
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
    plan_nombre: `${input.categoria} · ${input.regimen}`,
  });
  if (ve) return { ok: false, error: ve.message };

  // Auto-comisión B2B: si la venta es por agencia/freelance, crea la comisión con
  // el % propio del aliado (o el default general de su tipo).
  if (input.tipoAsesor !== "interno" && input.aliadoId) {
    const { data: al } = await sb
      .from("aliados")
      .select("nombre, nit, pct_comision, aplica_retencion, pct_retencion")
      .eq("id", input.aliadoId)
      .maybeSingle();
    if (al) {
      const defParam = input.tipoAsesor === "agencia" ? "COMISION_AGENCIA" : "COMISION_FREELANCE";
      const { data: p } = await sb.from("parametros_tributarios").select("valor").eq("parametro", defParam).maybeSingle();
      const pct = pctComB2B || al.pct_comision || Number(p?.valor) || (input.tipoAsesor === "agencia" ? 0.12 : 0.11);
      await sb.from("aliados_b2b").insert({
        numero_contrato: numero,
        tenant,
        aliado: al.nombre,
        nit: al.nit,
        precio_venta: precioVenta,
        base_comision: baseComisB2B || precioVenta,
        pct_comision: pct,
        recobro_total: 0,
        pct_recobro_aliado: 0,
        aplica_retencion: al.aplica_retencion,
        pct_retencion: al.pct_retencion,
        estado: comisionEstado === "descontada" ? "pagada" : "pendiente",
      });
    }
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
  const holdersCreacion = input.pasajeros.filter((_, i) => pasajeroConsumeSilla(esInfanteReal[i]));
  let sillaIdsAsignadas: number[] = [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "No se pudo crear la reserva (configuración del servidor incompleta)." };
  }
  {
    const { data: { user: actorPasajeros } } = await sb.auth.getUser();
    if (!actorPasajeros) return { ok: false, error: "Sesión inválida: no se pudo confirmar el usuario para crear la reserva." };
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
    const { error: pasajerosErr } = await admin.rpc("crear_pasajeros_contrato", {
      p_numero_contrato: numero,
      p_pasajeros: payloadPasajeros as unknown as Json,
      p_holders_min: paxConSilla,
      p_usuario_id: actorPasajeros.id,
    });
    if (pasajerosErr) return { ok: false, error: pasajerosErr.message };

    if (origen.tipo === "bloqueo") {
      const { data: sillasAsignadas } = await admin
        .from("sillas").select("id")
        .eq("numero_contrato", numero).in("estado", ["en_plazo", "confirmada"])
        .order("numero_silla");
      sillaIdsAsignadas = (sillasAsignadas ?? []).map((s) => s.id);
    }
  }

  // 6) Hotel del contrato (no aplica en paquete tipo servicios)
  if (!esServicios) {
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
      const fechaPagoCond = new Date().toISOString().slice(0, 10);
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
  if ((origen.tipo === "bloqueo" || origen.tipo === "empaquetado" || origen.tipo === "salida") && datosVuelo) {
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
  if (numNinos > 0 && pvpPorAcom["nino"] != null) {
    items.push({
      numero_contrato: numero,
      descripcion: `Niño 1 · ${input.categoria} / ${input.regimen}`,
      adultos: 0, ninos: numNinos, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino"], orden: 50,
    });
  }
  if (numNinos2 > 0 && pvpPorAcom["nino2"] != null) {
    items.push({
      numero_contrato: numero,
      descripcion: `Niño 2 · ${input.categoria} / ${input.regimen}`,
      adultos: 0, ninos: numNinos2, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino2"], orden: 51,
    });
  }
  // Infante: mismo tratamiento que Niño 1/2 (tarifa por temporada, 0 = gratis
  // sí se itemiza). Si el hotel no configuró tarifa de infante, pvpPorAcom["infante"]
  // no existe y simplemente no se cobra (no bloquea la reserva).
  const numInfantesItem = Number(input.infantes) || 0;
  if (numInfantesItem > 0 && pvpPorAcom["infante"] != null) {
    items.push({
      numero_contrato: numero,
      descripcion: `Infante · ${input.categoria} / ${input.regimen}`,
      adultos: 0, ninos: numInfantesItem, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["infante"], orden: 52,
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
  if (items.length) await sb.from("contrato_items").insert(items);

  // Cuentas por pagar (CxP) generadas AUTOMÁTICAMENTE porque la venta sale del
  // tarifario: una por proveedor de aéreo, hotel y cada servicio. Se acumulan
  // en los pasos 9/10/11 (que ya leen los costos netos con service-role) y se
  // insertan en el paso 12. El proveedor (con su retención) se jala del catálogo.
  const hoyISO = new Date().toISOString().slice(0, 10);
  const OBS_AUTO = "Generado automáticamente desde el tarifario";
  type ProvFact = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
  type CxPRow = {
    numero_contrato: string; tenant: Tenant; proveedor: string | null; tipo_proveedor: string;
    servicio: string; valor_total: number; fecha_obligacion: string;
    aplica_retencion: boolean; pct_retencion: number; observaciones: string;
  };
  const cxp: CxPRow[] = [];
  const pushCxP = (tipo: string, servicio: string, valor: number, pr: ProvFact, nombreFallback?: string | null, cxpOpts?: { permitirCero?: boolean }) => {
    if (!(valor > 0) && !cxpOpts?.permitirCero) return;
    cxp.push({
      numero_contrato: numero,
      tenant,
      proveedor: pr?.nombre ?? nombreFallback ?? null,
      tipo_proveedor: tipo,
      servicio,
      valor_total: Math.max(0, valor),
      fecha_obligacion: hoyISO,
      aplica_retencion: pr?.aplica_retencion ?? false,
      pct_retencion: Number(pr?.pct_retencion) || 0,
      observaciones: valor > 0 ? OBS_AUTO : `${OBS_AUTO} · costo neto pendiente`,
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

  // 9-bis) Snapshot cosmético de nombre/documento sobre las sillas YA
  // asignadas atómicamente en el paso 5-bis (`sillaIdsAsignadas`) — esto es
  // solo para que `sillas.pasajero_*` (usado en los listados operativos de
  // vuelos) muestre el nombre real; el inventario en sí ya quedó reservado
  // de forma atómica antes de crear los pasajeros, así que un fallo AQUÍ es
  // best-effort (no re-lanza la condición de carrera del inventario, que ya
  // se resolvió arriba) — nunca deja el inventario a medias, solo el
  // nombre en pantalla desactualizado hasta la próxima edición.
  if (sillaIdsAsignadas.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      await Promise.all(
        sillaIdsAsignadas.map((sillaId, i) => {
          const p = holdersCreacion[i];
          return admin.from("sillas").update({
            asesor: oNull(asesorNombre),
            hotel: meta.hotel_nombre,
            acomodacion: input.categoria,
            plazo: oNull(input.plazo),
            pasajero_nombres: oNull(p?.nombres),
            pasajero_apellidos: oNull(p?.apellidos),
            tipo_doc: oNull(p?.tipoDoc),
            numero_doc: oNull(p?.numeroDoc),
            nacimiento: oNull(p?.fechaNacimiento),
          }).eq("id", sillaId);
        })
      );
    } catch {
      // Best-effort — ver comentario arriba.
    }
  }

  // 10) Costo neto del HOTEL y su cuenta por pagar. El neto YA se calculó en
  //     computarReserva (netoPorAcom), con la vigencia de compra: si hubiera
  //     vencido, la venta ni siquiera se habría creado (se bloquea allá). Aquí
  //     solo se suma por pax y se crea la CxP con el proveedor del hotel. Una
  //     sola fuente del costo evita la divergencia que generaba costo 0.
  if (!esServicios && Object.keys(netoPorAcom).length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      let costoHotel = 0;
      for (const l of lineasHab) { const per = netoPorAcom[l.acom]; if (per != null) costoHotel += per * l.pax; }
      if (numNinos > 0 && netoPorAcom["nino"] != null) costoHotel += netoPorAcom["nino"] * numNinos;
      if (numNinos2 > 0 && netoPorAcom["nino2"] != null) costoHotel += netoPorAcom["nino2"] * numNinos2;
      const { data: hprov } = await admin
        .from("hoteles").select("nombre, proveedores(nombre, aplica_retencion, pct_retencion)").eq("id", input.hotelId).maybeSingle();
      if (costoHotel > 0) {
        await admin.from("ventas").update({ costo_hotel: costoHotel }).eq("numero_contrato", numero);
        const prH = hprov?.proveedores as unknown as ProvFact;
        pushCxP("hotel", `Hotel ${meta.hotel_nombre ?? hprov?.nombre ?? ""}`.trim(), costoHotel, prH);
      }
    } catch {
      // El costo neto es informativo para rentabilidad; no bloquea la reserva.
    }
  }

  // 11) Costo neto de SERVICIOS (receptivo) — admin, oculto al asesor.
  if (input.servicios?.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const [{ data: arm }, { data: gruposNet }, { data: tempsNet }] = await Promise.all([
        admin.from("armado_servicios")
          .select("servicio_id, modo, servicios_adicionales(precio_persona, recargo_individual, categoria, nombre, liquidacion, proveedores(nombre, aplica_retencion, pct_retencion))")
          .eq("paquete_id", input.paqueteId).in("servicio_id", input.servicios),
        admin.from("servicio_tarifa_pax")
          .select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", input.servicios),
        admin.from("servicio_temporadas")
          .select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").in("servicio_id", input.servicios),
      ]);
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
      const recTempServ = new Map<string, number>();    // servId|nombre -> recargo neto
      for (const t of tempsNet ?? []) {
        const arr = tempsPorServ.get(t.servicio_id) ?? [];
        arr.push(toTemporadaRango(t));
        tempsPorServ.set(t.servicio_id, arr);
        if (t.precio_persona != null) netoTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.precio_persona));
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
      const tours: string[] = [];
      let hayAsistencia = false;
      for (const s of arm ?? []) {
        const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
        const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; recargo_individual: number | null; categoria: string | null; nombre: string; liquidacion: string | null; proveedores: ProvFact } | null;
        const nombreTemp = tempVigente(s.servicio_id);
        // Neto por persona: el de la temporada vigente, o el base.
        const netoPersona = (nombreTemp ? netoTempServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined) ?? srv?.precio_persona ?? null;
        // Rangos por grupo: los de la temporada vigente si existen, si no GENERAL.
        const gruposTemp = nombreTemp ? gruposPorServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined;
        const grupos = gruposTemp?.length ? gruposTemp : (gruposPorServ.get(`${s.servicio_id}|GENERAL`) ?? []);
        let costoServ = precioServicio(modo, netoPersona, grupos, totalPax) * factorLiquidacion(srv?.liquidacion, nochesStay);
        // Recargo individual: suplemento NETO del proveedor cuando va 1 pax (cobro
        // por persona). El de la temporada vigente si lo define, si no el base.
        if (modo === "persona" && totalPax === 1) {
          const recTemp = nombreTemp ? recTempServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined;
          costoServ += Math.max(recTemp ?? (Number(srv?.recargo_individual) || 0), 0);
        }
        costoReceptivo += costoServ;
        const cat = srv?.categoria ?? "otro";
        if (cat === "asistencia") hayAsistencia = true;
        else if (cat === "tour_traslado" && srv?.nombre) tours.push(srv.nombre);
        // Una CxP por servicio (asistencia médica va a su propio tipo de proveedor).
        pushCxP(cat === "asistencia" ? "asistencia" : "receptivo", srv?.nombre ?? "Servicio", costoServ, srv?.proveedores ?? null);
      }
      const upd: { costo_receptivo?: number; tours_traslados?: string; asistencia_medica?: boolean } = {};
      if (costoReceptivo > 0) upd.costo_receptivo = costoReceptivo;
      if (tours.length) upd.tours_traslados = tours.join(", ");
      if (hayAsistencia) upd.asistencia_medica = true;
      if (Object.keys(upd).length) await admin.from("ventas").update(upd).eq("numero_contrato", numero);
    } catch {
      // Costo neto informativo; no bloquea la reserva.
    }
  }

  // 12) Insertar las cuentas por pagar acumuladas (hotel/aéreo/servicios). Como
  //     la venta proviene del tarifario, los proveedores y costos ya se conocen.
  if (cxp.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { data: creadas } = await admin.from("cuentas_por_pagar").insert(cxp).select("id, tipo_proveedor, proveedor, servicio, valor_total");
      for (const c of creadas ?? []) {
        await postearAsientoCxP({
          cuentaId: c.id, numeroContrato: numero, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
          servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoyISO, tenant,
        });
      }
    } catch {
      // No bloquear la reserva si falla la creación automática de CxP.
    }
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero };
}

// ── COTIZACIONES: presupuesto SIN número de contrato ───────────────────────
// crearCotizacion reusa computarReserva (mismo precio que el contrato) y guarda
// un snapshot listo para el PDF. NO toca inventario ni numera. Al convertir se
// llama a reservarDesdeTarifario (que sí genera número, sillas y CxP).
export type CotizacionResult = { ok: true; id: number } | { ok: false; error: string };

export async function crearCotizacion(input: ReservaInput, opts?: { vigenciaHasta?: string }): Promise<CotizacionResult> {
  const sb = await createClient();
  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";
  const comp = await computarReserva(sb, input);
  if (!comp.ok) return { ok: false, error: comp.error };
  const { origen, meta, pvpPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, monedaReserva, cargoMascota } = comp.data;

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

  const hoy = new Date().toISOString().slice(0, 10);
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
    asistencia_medica: false,
    tours_traslados: null,
    asesor_firma_nombre: oNull(asesorNombre),
    asesor_firma_cargo: "Asesor/a",
    asesor_firma_cc: null,
    asesor_firma_tel: null,
    moneda: monedaReserva,
  };

  const pasajerosSnap: Record<string, unknown>[] = input.pasajeros.map((p, i) => ({
    id: i + 1,
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
  if (numNinos > 0 && pvpPorAcom["nino"] != null)
    itemsSnap.push({ id: 50, descripcion: `Niño 1 · ${input.categoria} / ${input.regimen}`, adultos: 0, ninos: numNinos, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino"] });
  if (numNinos2 > 0 && pvpPorAcom["nino2"] != null)
    itemsSnap.push({ id: 51, descripcion: `Niño 2 · ${input.categoria} / ${input.regimen}`, adultos: 0, ninos: numNinos2, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino2"] });
  { const numInfantesSnap = Number(input.infantes) || 0;
    if (numInfantesSnap > 0 && pvpPorAcom["infante"] != null)
      itemsSnap.push({ id: 52, descripcion: `Infante · ${input.categoria} / ${input.regimen}`, adultos: 0, ninos: numInfantesSnap, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["infante"] }); }
  serviciosItems.forEach((s, i) => itemsSnap.push({ id: 100 + i, descripcion: `Servicio · ${s.nombre}`, adultos: 1, ninos: 0, tarifa_adulto: s.precio, tarifa_nino: 0 }));
  if (cargoMascota) {
    itemsSnap.push({
      id: 201,
      descripcion: cargoMascota.descripcion ? `Mascota · ${cargoMascota.descripcion}` : "Cargo de mascota",
      adultos: 0, ninos: 0, tarifa_adulto: cargoMascota.total, tarifa_nino: 0,
    });
  }

  const detalle = { venta: ventaSnap, pasajeros: pasajerosSnap, hoteles: hotelesSnap, vuelos: vuelosSnap, items: itemsSnap };

  // Vigencia: la que indique el asesor o, por defecto, 24 horas (hoy + 1 día).
  let vigencia = opts?.vigenciaHasta && /^\d{4}-\d{2}-\d{2}$/.test(opts.vigenciaHasta) ? opts.vigenciaHasta : null;
  if (!vigencia) { const vig = new Date(); vig.setDate(vig.getDate() + 1); vigencia = vig.toISOString().slice(0, 10); }

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

  // El precio se calcula en el servidor (autoritativo) y el checkout debe servir
  // tanto a aliados B2B como a usuarios públicos. La RLS de `cotizaciones` es solo
  // para roles internos, así que el insert va por service-role cuando está
  // disponible (si no, cae al cliente con sesión = sólo internos).
  const sbCot = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;

  const tenantCotizacion = ctx.tenant;

  const { data: row, error } = await sbCot.from("cotizaciones").insert({
    tenant: tenantCotizacion,
    payload: input as unknown as Json,
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

  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, id: row.id };
}

// Convierte una cotización en CONTRATO: corre el motor de reserva normal (genera
// numero_contrato + sillas + CxP) con el payload guardado, y enlaza la cotización.
export async function convertirCotizacion(id: number, pasajeros?: PasajeroReserva[], override?: boolean, asesorInterno?: string): Promise<ReservaResult> {
  const sb = await createClient();
  const { data: cot, error } = await sb
    .from("cotizaciones")
    .select("estado, payload, numero_contrato, tenant")
    .eq("id", id)
    .maybeSingle();
  if (error || !cot) return { ok: false, error: error?.message ?? "Cotización no encontrada." };
  if (cot.estado === "convertida" && cot.numero_contrato) return { ok: true, numero: cot.numero_contrato };
  if (cot.estado === "descartada") return { ok: false, error: "La cotización está descartada; no se puede convertir." };

  // Sin tenant asignado no se convierte: no hay con qué estampar el contrato
  // (ver migración 153 — no se asume ningún tenant por defecto).
  if (!cot.tenant) return { ok: false, error: "Esta cotización no tiene agencia (tenant) asignada; no se puede convertir. Contacta a un administrador." };

  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };

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
  const res = await reservarDesdeTarifarioInterno({ ...payload, pasajeros: pax, asesorInterno: asesor }, cot.tenant as Tenant);
  if (!res.ok) return res;

  await sb.from("cotizaciones").update({ estado: "convertida", numero_contrato: res.numero }).eq("id", id);
  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true, numero: res.numero };
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
//  · Los tours no generan CxP automática (no hay forma de re-liquidar su
//    costo neto desde el snapshot del carrito) — sí quedan como ítem visible
//    del contrato; el proveedor se registra a mano en la pestaña Proveedores.
export type ItemCarritoPayload = {
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number; hotelId: number; bloqueoId: number | null;
  hotelNombre: string; destino: string | null; categoria: string; regimen: string;
  fechaIda: string | null; fechaRegreso: string | null; noches: number | null;
  habitaciones: Record<string, number>; ninos: number; ninos2: number; infantes: number; pax: number; precio: number;
};
export type TourCarritoPayload = {
  nombre: string; destino: string | null; fechaIda: string | null; fechaRegreso: string | null;
  pax: number; precio: number; moneda: string;
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
type ItemCarritoConAsignacion = ItemCarritoPayload & { __posiciones: number[] };

export async function convertirCotizacionCarrito(
  id: number,
  opts: {
    agrupar: "todo" | "por_destino";
    pasajeros: PasajeroReserva[];
    asesorInterno?: string;
    // Una entrada por ítem, en el MISMO orden que `cotizaciones.payload.items`
    // (nunca por conteo/prefijo — ver `ItemCarritoConAsignacion` arriba).
    asignaciones: number[][];
  }
): Promise<{ ok: true; numeros: string[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("id, estado, tipo, payload, tenant")
    .eq("id", id).eq("tipo", "carrito").maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  if (cot.estado === "descartada") return { ok: false, error: "La cotización está descartada; no se puede convertir." };

  // Sin tenant asignado no se convierte (ver migración 153 — nunca se asume
  // un tenant por defecto), y el caller debe tener acceso a esa agencia.
  if (!cot.tenant) return { ok: false, error: "Esta cotización no tiene agencia (tenant) asignada; no se puede convertir. Contacta a un administrador." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  // Capturado en una constante (en vez de reusar `cot.tenant` más abajo,
  // después de varios `await`): TypeScript no puede seguir garantizando el
  // `!cot.tenant` de arriba a través de llamadas intermedias.
  const tenantCotizacion = cot.tenant as Tenant;

  const payload = (cot.payload ?? {}) as {
    items?: ItemCarritoPayload[]; tours?: TourCarritoPayload[];
    cliente?: { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string };
  };
  const itemsCrudos = payload.items ?? [];
  const tours = payload.tours ?? [];
  const cliente = payload.cliente ?? { nombres: "", apellidos: "", numeroDoc: "", telefono: "", email: "" };
  if (!itemsCrudos.length && !tours.length) return { ok: false, error: "La cotización no tiene ítems." };
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

  // Ningún pasajero del universo declarado puede quedar sin viajar en NINGÚN
  // ítem (B12, ronda 5) — si alguien no participa en nada, o el universo se
  // dimensionó mal (persona de más), o simplemente se olvidó marcarlo en
  // algún ítem; ninguno de los dos casos es correcto guardarlo en silencio.
  // Excepción real (no un descuido): un carrito de SOLO tours no tiene
  // ítems contra los cuales chequear — el concepto "asignado a un ítem" no
  // aplica cuando no hay ítems en absoluto.
  if (items.length) {
    const sinAsignar = posicionesSinAsignar(items.map((it) => it.__posiciones), opts.pasajeros.length);
    if (sinAsignar.length) {
      return { ok: false, error: `El pasajero ${sinAsignar[0]} no está asignado a ningún ítem del carrito. Marca en qué ítem(s) viaja o quítalo del listado.` };
    }
  }

  type Grupo = { destino: string | null; items: ItemCarritoConAsignacion[]; tours: TourCarritoPayload[] };
  let grupos: Grupo[];
  if (opts.agrupar === "todo" || items.length <= 1) {
    grupos = [{ destino: null, items, tours }];
  } else {
    const porDestino = new Map<string, ItemCarritoConAsignacion[]>();
    for (const it of items) {
      const k = it.destino ?? "—";
      porDestino.set(k, [...(porDestino.get(k) ?? []), it]);
    }
    grupos = [...porDestino.entries()].map(([destino, its]) => ({ destino: destino === "—" ? null : destino, items: its, tours: [] as TourCarritoPayload[] }));
    for (const t of tours) {
      const g = grupos.find((g) => g.destino && t.destino && g.destino === t.destino) ?? grupos[0];
      g.tours.push(t);
    }
  }

  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;

  // ── Paso 1: validar TODO (precio autoritativo + cupos) antes de insertar ──
  const gruposValidados: { grupo: Grupo; validados: { item: ItemCarritoConAsignacion; comp: ComputoReserva }[] }[] = [];
  for (const grupo of grupos) {
    const validados: { item: ItemCarritoConAsignacion; comp: ComputoReserva }[] = [];
    for (const it of grupo.items) {
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
      if (it.modulo === "bloqueo" && it.bloqueoId) {
        const { count } = await admin.from("sillas").select("id", { count: "exact", head: true })
          .eq("bloqueo_id", it.bloqueoId).in("estado", ["disponible", "cambio_entrante"]);
        const disponibles = count ?? 0;
        if (disponibles < comp.data.paxConSilla) {
          return { ok: false, error: `${it.hotelNombre}: no hay cupos suficientes (disponibles: ${disponibles}, requeridos: ${comp.data.paxConSilla}).` };
        }
      }
      validados.push({ item: it, comp: comp.data });
    }
    gruposValidados.push({ grupo, validados });
  }

  // ── Paso 2: crear un contrato por grupo, con TODOS sus hoteles/tours ──────
  const hoyISO = new Date().toISOString().slice(0, 10);
  const OBS_AUTO = "Generado automáticamente desde el carrito (tarifario)";
  const numeros: string[] = [];

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

  for (const { grupo, validados } of gruposValidados) {
    const numRes = await siguienteNumeroContrato(tenantCotizacion);
    if (!numRes.ok) return { ok: false, error: numRes.error };
    const numero = numRes.numero;

    const clienteNombre = `${cliente.nombres} ${cliente.apellidos}`.trim();
    const destinos = [...new Set(validados.map((v) => v.comp.meta.destino_nombre ?? v.item.destino).filter((d): d is string => !!d))];
    const fechasIda = validados.map((v) => v.comp.meta.fecha_ida).filter((f): f is string => !!f).sort();
    const fechasReg = validados.map((v) => v.comp.meta.fecha_regreso).filter((f): f is string => !!f).sort();
    // Fecha de referencia REAL de este grupo — la misma que se guarda como
    // `ventas.fecha_salida` abajo, y contra la que el RPC recalcula
    // es_infante server-side (B10, ronda 3).
    const fechaRefGrupo = fechasIda[0] ?? null;
    const precioTotal = validados.reduce((s, v) => s + v.comp.precioVenta, 0) + grupo.tours.reduce((s, t) => s + t.precio, 0);
    const monedaGrupo = validados[0]?.comp.monedaReserva ?? "COP";

    // ── Universo LOCAL de este contrato (B13, ronda 5) ───────────────────
    // ÚNICAMENTE la unión de posiciones asignadas a los ítems DE ESTE
    // GRUPO — nunca el universo completo del carrito, que puede incluir
    // personas que no viajan en este contrato en absoluto (otro destino,
    // en modo "por destino"). Excepción documentada: un grupo sin ítems
    // (todo el carrito son tours — `grupo.items` solo puede quedar vacío
    // cuando ES el único grupo, ver comentario de `posicionesSinAsignar`
    // más arriba) usa el universo GLOBAL completo, porque en ese caso el
    // único grupo ES el carrito entero.
    const posicionesGrupoItems = posicionesUnicasDeGrupo(
      grupo.items.map((it) => it.__posiciones),
      grupo.items.map((_, i) => i)
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

    const { error: ve } = await sb.from("ventas").insert({
      numero_contrato: numero,
      // Conserva EXACTAMENTE el tenant de la cotización de origen (validado
      // arriba: no nulo, y el caller tiene acceso a él).
      tenant: tenantCotizacion,
      cliente: clienteNombre,
      cliente_documento: oNull(cliente.numeroDoc),
      cliente_telefono: oNull(cliente.telefono),
      cliente_email: oNull(cliente.email),
      destino: destinos.join(" · ") || grupo.destino,
      tipo_paquete: "carrito",
      moneda: monedaGrupo,
      fecha_salida: fechasIda[0] ?? null,
      fecha_regreso: fechasReg.length ? fechasReg[fechasReg.length - 1] : null,
      pax: paxTotal,
      hotel: validados.length === 1 ? (validados[0].comp.meta.hotel_nombre ?? validados[0].item.hotelNombre) : `${validados.length} hoteles`,
      precio_venta: precioTotal,
      estado: "pendiente",
      canal: "B2C",
      tipo_asesor: "interno",
      plazo: null,
      asesor_firma_nombre: oNull(opts.asesorInterno ?? null),
      asesor: oNull(opts.asesorInterno ?? null),
      plan_nombre: validados.length === 1 ? `${validados[0].item.categoria} · ${validados[0].item.regimen}` : `${validados.length} hoteles`,
      tours_traslados: grupo.tours.length ? grupo.tours.map((t) => t.nombre).join(", ") : null,
    });
    if (ve) return { ok: false, error: ve.message };

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
    const itemsBloqueoLocal = validados
      .filter((v): v is typeof v & { item: { bloqueoId: number } } => v.item.modulo === "bloqueo" && v.item.bloqueoId != null)
      .map((v) => ({
        bloqueoId: v.item.bloqueoId,
        holdersMin: v.comp.paxConSilla,
        posiciones: v.item.__posiciones.map((posGlobal) => mapaGlobalALocal.get(posGlobal)! + 1),
      }));
    const reservasSillas = consolidarReservasSillasPorBloqueo(itemsBloqueoLocal);
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
    const { data: filasPasajerosMulti, error: peMulti } = await admin.rpc("crear_pasajeros_contrato_multi", {
      p_numero_contrato: numero,
      p_pasajeros: payloadPasajerosMulti as unknown as Json,
      p_reservas_sillas: reservasSillas as unknown as Json,
      p_usuario_id: usuarioCond.id,
    });
    if (peMulti) return { ok: false, error: peMulti.message };
    // Es_infante REAL, ya recalculado por el servidor (nunca por
    // `esInfantePorEdad` en este archivo) — se usa más abajo para el
    // backfill cosmético de nombre/documento sobre las sillas de cada
    // bloqueo (best-effort, igual que en los otros 3 flujos de creación).
    const esInfanteRealGrupo = (filasPasajerosMulti ?? [])
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map((f) => f.es_infante);

    type ProvFact = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
    const cxp: { numero_contrato: string; tenant: Tenant; proveedor: string | null; tipo_proveedor: string; servicio: string; valor_total: number; fecha_obligacion: string; aplica_retencion: boolean; pct_retencion: number; observaciones: string }[] = [];
    const pushCxP = (tipo: string, servicio: string, valor: number, pr: ProvFact, nombreFallback?: string | null) => {
      if (!(valor > 0)) return;
      cxp.push({
        numero_contrato: numero, tenant: tenantCotizacion, proveedor: pr?.nombre ?? nombreFallback ?? null, tipo_proveedor: tipo, servicio,
        valor_total: Math.max(0, valor), fecha_obligacion: hoyISO,
        aplica_retencion: pr?.aplica_retencion ?? false, pct_retencion: Number(pr?.pct_retencion) || 0, observaciones: OBS_AUTO,
      });
    };

    let costoAereoTotal = 0, costoHotelTotal = 0;
    // Componentes de condición de pago (Rama B) — uno por hotel del grupo,
    // condicionado por las vigencias REALES de CADA hotel (nunca por el
    // ganador del motor de precios). Se congelan todos juntos al final del
    // grupo, en UN solo contrato (igual que el resto de este flujo).
    const componentesCondicion: ComponenteSnapshot[] = [];

    for (let hIdx = 0; hIdx < validados.length; hIdx++) {
      const { item: it, comp } = validados[hIdx];
      const { meta, lineasHab, numNinos, numNinos2, pvpPorAcom, netoPorAcom, paxConSilla } = comp;

      const partes = lineasHab.map((l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`);
      if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
      if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
      if ((it.infantes || 0) > 0) partes.push(`${it.infantes} Infante(s)`);

      let proveedorHotel: string | null = null;
      const { data: hp } = await admin.from("hoteles").select("proveedores(nombre, aplica_retencion, pct_retencion)").eq("id", it.hotelId).maybeSingle();
      const prH = hp?.proveedores as unknown as ProvFact;
      proveedorHotel = prH?.nombre ?? null;

      await sb.from("contrato_hoteles").insert({
        numero_contrato: numero, nombre: meta.hotel_nombre ?? it.hotelNombre, categoria: it.categoria,
        proveedor: proveedorHotel, ciudad: meta.destino_nombre ?? it.destino, alimentacion: it.regimen,
        acomodacion: it.categoria, detalle_acomodacion: partes.join(", "),
        fecha_ingreso: meta.fecha_ida, fecha_salida: meta.fecha_regreso, orden: hIdx,
      });

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
          fechaPago: hoyISO,
        });
        if (componenteHotel) componentesCondicion.push(componenteHotel);
      }

      if (it.modulo === "bloqueo" && it.bloqueoId) {
        const { data: bq } = await admin
          .from("bloqueos_vuelo")
          .select("aerolinea, record, ruta, tarifa_para_empaquetar, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, proveedores(nombre, aplica_retencion, pct_retencion)")
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

          const costoAereo = (Number(bq.tarifa_para_empaquetar) || 0) * paxConSilla;
          costoAereoTotal += costoAereo;
          pushCxP("aereo", `Aéreo ${bq.aerolinea ?? ""}`.trim(), costoAereo, bq.proveedores as unknown as ProvFact, bq.aerolinea);

          // Las sillas de ESTE bloqueo ya quedaron reservadas atómicamente
          // arriba (crear_pasajeros_contrato_multi, junto con pasajeros y
          // vínculos, en la MISMA transacción) — aquí solo queda el snapshot
          // COSMÉTICO de nombre/documento sobre esas sillas (igual patrón
          // best-effort que los otros 3 flujos de creación, paso "9-bis"):
          // un fallo aquí nunca re-lanza la condición de carrera del
          // inventario, que ya se resolvió de forma atómica arriba.
          // B11 (ronda 3): usa las posiciones EXPLÍCITAS asignadas a este
          // ítem (nunca un prefijo por conteo) para el snapshot cosmético —
          // mismo criterio que la reserva atómica de sillas de arriba.
          // B13 (ronda 5): `esInfanteRealGrupo` está indexado por posición
          // LOCAL (el `orden` que devuelve el RPC sigue el orden de
          // `pasajerosLocal`, no el de `opts.pasajeros`) — `pos` aquí sigue
          // siendo GLOBAL (viene de `it.__posiciones`), así que se traduce
          // vía `mapaGlobalALocal` antes de indexar. El nombre/documento a
          // mostrar sí se toma de `opts.pasajeros[pos - 1]` (GLOBAL): son
          // los mismos datos de la persona, la reindexación solo afecta la
          // posición dentro del contrato, no su identidad.
          const holders = it.__posiciones
            .filter((pos) => pasajeroConsumeSilla(esInfanteRealGrupo[mapaGlobalALocal.get(pos)!]))
            .map((pos) => opts.pasajeros[pos - 1]);
          try {
            const { data: asignadas } = await admin.from("sillas").select("id")
              .eq("numero_contrato", numero).eq("bloqueo_id", it.bloqueoId)
              .in("estado", ["en_plazo", "confirmada"]).order("numero_silla");
            if (asignadas && asignadas.length) {
              await Promise.all(asignadas.map((s, i) => {
                const p = holders[i];
                return admin.from("sillas").update({
                  asesor: oNull(opts.asesorInterno ?? null),
                  hotel: meta.hotel_nombre, acomodacion: it.categoria, plazo: null,
                  pasajero_nombres: oNull(p?.nombres), pasajero_apellidos: oNull(p?.apellidos),
                  tipo_doc: oNull(p?.tipoDoc), numero_doc: oNull(p?.numeroDoc), nacimiento: oNull(p?.fechaNacimiento),
                }).eq("id", s.id);
              }));
            }
          } catch {
            // Best-effort — ver comentario arriba.
          }
        }
      }

      const itemsHotel: { numero_contrato: string; descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; orden: number }[] = [];
      lineasHab.forEach((l, i) => itemsHotel.push({
        numero_contrato: numero, descripcion: `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${it.categoria} / ${it.regimen}`,
        adultos: l.pax, ninos: 0, tarifa_adulto: l.pvp, tarifa_nino: 0, orden: hIdx * 300 + i,
      }));
      if (numNinos > 0 && pvpPorAcom["nino"] != null) itemsHotel.push({ numero_contrato: numero, descripcion: `Niño 1 · ${it.categoria} / ${it.regimen}`, adultos: 0, ninos: numNinos, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino"], orden: hIdx * 300 + 50 });
      if (numNinos2 > 0 && pvpPorAcom["nino2"] != null) itemsHotel.push({ numero_contrato: numero, descripcion: `Niño 2 · ${it.categoria} / ${it.regimen}`, adultos: 0, ninos: numNinos2, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino2"], orden: hIdx * 300 + 51 });
      const numInf = it.infantes || 0;
      if (numInf > 0 && pvpPorAcom["infante"] != null) itemsHotel.push({ numero_contrato: numero, descripcion: `Infante · ${it.categoria} / ${it.regimen}`, adultos: 0, ninos: numInf, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["infante"], orden: hIdx * 300 + 52 });
      if (itemsHotel.length) await sb.from("contrato_items").insert(itemsHotel);

      let costoHotel = 0;
      for (const l of lineasHab) { const per = netoPorAcom[l.acom]; if (per != null) costoHotel += per * l.pax; }
      if (numNinos > 0 && netoPorAcom["nino"] != null) costoHotel += netoPorAcom["nino"] * numNinos;
      if (numNinos2 > 0 && netoPorAcom["nino2"] != null) costoHotel += netoPorAcom["nino2"] * numNinos2;
      costoHotelTotal += costoHotel;
      pushCxP("hotel", `Hotel ${meta.hotel_nombre ?? it.hotelNombre}`.trim(), costoHotel, prH);
    }

    // Tours: quedan como ítem visible del contrato (sin CxP automática — ver nota arriba).
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
    }

    if (usuarioCond) {
      const trmCond = await trmReferenciaAproximada(admin, monedaGrupo);
      await congelarCondicionesContratoBestEffort(admin, {
        numeroContrato: numero,
        componentes: componentesCondicion,
        moneda: monedaGrupo,
        trm: trmCond,
        precioTotalMoneda: precioTotal,
        fechaPago: hoyISO,
        usuarioId: usuarioCond.id,
      });
    }

    if (costoAereoTotal > 0 || costoHotelTotal > 0) {
      await admin.from("ventas").update({ costo_aereo: costoAereoTotal, costo_hotel: costoHotelTotal }).eq("numero_contrato", numero);
    }
    if (cxp.length) {
      const { data: creadas } = await admin.from("cuentas_por_pagar").insert(cxp).select("id, tipo_proveedor, proveedor, servicio, valor_total");
      for (const c of creadas ?? []) {
        await postearAsientoCxP({
          cuentaId: c.id, numeroContrato: numero, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
          servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoyISO, tenant: tenantCotizacion,
        });
      }
    }

    numeros.push(numero);
  }

  const { data: cotActual } = await sb.from("cotizaciones").select("detalle").eq("id", id).maybeSingle();
  const detalleActual = (cotActual?.detalle ?? {}) as Record<string, unknown>;
  await sb.from("cotizaciones").update({
    estado: "convertida",
    numero_contrato: numeros[0],
    detalle: { ...detalleActual, contratos: numeros },
  }).eq("id", id);

  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true, numeros };
}

export async function actualizarVigenciaCotizacion(id: number, vigenciaHasta: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaHasta)) return { ok: false, error: "Fecha inválida." };
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { ok: false, error: "No autorizado." };
  const sb = await createClient();
  // El tenant NUNCA se toca aquí — solo se usa para filtrar qué fila puede
  // tocar el caller. Superadmin conserva alcance global.
  let q = sb.from("cotizaciones").update({ vigencia_hasta: vigenciaHasta }).eq("id", id).eq("estado", "abierta");
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
  const { error } = await sb.from("ventas").update({ estado: "confirmado" }).eq("numero_contrato", numeroContrato);
  if (error) return { ok: false, error: error.message };
  // Sillas a confirmada (admin si hay service-role; si no, intento directo)
  const client = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
  await client.from("sillas").update({ estado: "confirmada" }).eq("numero_contrato", numeroContrato).eq("estado", "en_plazo");
  // Respaldo: si el contrato aún no tiene cuentas por pagar (p. ej. venía de
  // legacy o se creó manual), generarlas desde sus costos al confirmar. No debe
  // tumbar la confirmación si falla.
  try { await asegurarCuentasPorPagar(numeroContrato); } catch { /* no bloquear la confirmación */ }
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true };
}

// ── Respaldo de cuentas por pagar ──────────────────────────────────────────
// Crea las cuentas por pagar que FALTEN para un contrato a partir de sus costos
// (hotel/aéreo/receptivo/asistencia/otros). NO duplica: solo agrega los tipos de
// proveedor que aún no tengan CxP. Útil cuando al reservar solo se generó parte
// (p. ej. "solo el aéreo" porque el costo neto del hotel salió 0). El proveedor
// del hotel/aéreo se jala del contrato; los demás quedan para que contabilidad
// los asigne. El hotel se crea aunque el costo sea 0 (queda pendiente de valor).
export async function asegurarCuentasPorPagar(numeroContrato: string): Promise<{ ok: boolean; creadas: number; error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, creadas: 0 };
  const admin = createAdminClient();

  const [{ data: existentes }, { data: v }, { data: ch }, { data: cv }, { data: provs }] = await Promise.all([
    admin.from("cuentas_por_pagar").select("tipo_proveedor").eq("numero_contrato", numeroContrato),
    admin.from("ventas").select("tenant, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, moneda, hotel, aerolinea, plazo, fecha_salida").eq("numero_contrato", numeroContrato).maybeSingle(),
    admin.from("contrato_hoteles").select("nombre, proveedor").eq("numero_contrato", numeroContrato).order("orden").limit(1),
    admin.from("contrato_vuelos").select("aerolinea").eq("numero_contrato", numeroContrato).order("orden").limit(1),
    admin.from("proveedores").select("nombre, aplica_retencion, pct_retencion"),
  ]);
  if (!v) return { ok: false, creadas: 0 };
  const tenant = (v.tenant as string | null) ?? "mayorista";

  const yaTiene = new Set(((existentes ?? []).map((r) => r.tipo_proveedor).filter(Boolean)) as string[]);
  const hoy = new Date().toISOString().slice(0, 10);
  const vence = (v.plazo as string | null) ?? (v.fecha_salida as string | null) ?? null;
  const moneda = (v.moneda as string | null) ?? "COP";
  const hotelRow = (ch ?? [])[0] as { nombre: string | null; proveedor: string | null } | undefined;
  const vueloRow = (cv ?? [])[0] as { aerolinea: string | null } | undefined;

  // Retención del catálogo de proveedores por nombre (case-insensitive).
  const retDe = (nombre: string | null) => {
    const p = (provs ?? []).find((x) => x.nombre && nombre && x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
    return { aplica_retencion: p?.aplica_retencion ?? false, pct_retencion: Number(p?.pct_retencion) || 0 };
  };

  type Row = {
    numero_contrato: string; tenant: string; proveedor: string | null; tipo_proveedor: string; servicio: string;
    valor_total: number; moneda: string; fecha_obligacion: string; fecha_vencimiento: string | null;
    aplica_retencion: boolean; pct_retencion: number; observaciones: string;
  };
  const rows: Row[] = [];
  const OBS = "Completado automáticamente (faltaba el proveedor)";
  const SIN_ESPECIFICAR = "Sin especificar";
  const add = (tipo: string, servicio: string, valor: number, proveedor: string | null) => {
    const nombre = proveedor?.trim() || SIN_ESPECIFICAR;
    const r = retDe(proveedor);
    rows.push({
      numero_contrato: numeroContrato, tenant, proveedor: nombre, tipo_proveedor: tipo, servicio,
      valor_total: Math.max(0, valor), moneda, fecha_obligacion: hoy, fecha_vencimiento: vence,
      aplica_retencion: r.aplica_retencion, pct_retencion: r.pct_retencion, observaciones: OBS,
    });
  };

  // Crea solo los tipos de proveedor que falten y tengan costo real (> 0). El
  // proveedor del hotel/aéreo se jala del contrato si existe; si no, queda
  // "Sin especificar" (editable luego desde la pestaña Proveedores).
  if (!yaTiene.has("hotel") && (Number(v.costo_hotel) || 0) > 0)
    add("hotel", `Hotel ${hotelRow?.nombre ?? v.hotel ?? ""}`.trim(), Number(v.costo_hotel) || 0, hotelRow?.proveedor ?? null);
  if (!yaTiene.has("aereo") && (Number(v.costo_aereo) || 0) > 0)
    add("aereo", `Aéreo ${vueloRow?.aerolinea ?? v.aerolinea ?? ""}`.trim(), Number(v.costo_aereo) || 0, vueloRow?.aerolinea ?? (v.aerolinea as string | null));
  if (!yaTiene.has("receptivo") && (Number(v.costo_receptivo) || 0) > 0)
    add("receptivo", "Servicios receptivos", Number(v.costo_receptivo) || 0, null);
  if (!yaTiene.has("asistencia") && (Number(v.costo_asistencia) || 0) > 0)
    add("asistencia", "Asistencia médica", Number(v.costo_asistencia) || 0, null);
  if (!yaTiene.has("otro") && (Number(v.otros_costos) || 0) > 0)
    add("otro", "Otros costos", Number(v.otros_costos) || 0, null);

  if (!rows.length) return { ok: true, creadas: 0 };

  const { data: creadas, error } = await admin.from("cuentas_por_pagar").insert(rows).select("id, tipo_proveedor, proveedor, servicio, valor_total");
  if (error) return { ok: false, creadas: 0, error: error.message };
  for (const c of creadas ?? []) {
    await postearAsientoCxP({
      cuentaId: c.id, numeroContrato, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
      servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoy, tenant,
    });
  }
  revalidatePath("/dashboard/pagos");
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true, creadas: rows.length };
}

// ── Liberar reservas vencidas (plazo pasado y sin confirmar) ───────────────
export async function liberarVencidas(): Promise<{ ok: boolean; liberadas: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, liberadas: 0 };
  const admin = createAdminClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: vencidas } = await admin
    .from("ventas")
    .select("numero_contrato")
    .eq("estado", "pendiente")
    .lt("plazo", hoy);
  const nums = (vencidas ?? []).map((v) => v.numero_contrato);
  if (!nums.length) return { ok: true, liberadas: 0 };
  // Liberar sillas en_plazo de esos contratos
  await admin
    .from("sillas")
    .update({ estado: "disponible", numero_contrato: null, asesor: null, hotel: null, acomodacion: null, plazo: null })
    .in("numero_contrato", nums)
    .eq("estado", "en_plazo");
  await admin.from("ventas").update({ estado: "cancelado" }).in("numero_contrato", nums);
  revalidatePath("/dashboard/contratos");
  return { ok: true, liberadas: nums.length };
}

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
};

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
export async function reservarPrograma(input: ReservaProgramaInput): Promise<ReservaResult> {
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
): Promise<ReservaResult> {
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

  // Etapa "validacion_programa": programa + vigencia + blackouts + precios +
  // habitaciones/pax + validación de edades — varias validaciones con
  // retorno anticipado; el cierre se loguea justo antes de generar el
  // número de contrato (único punto que se alcanza solo si todas pasaron).
  const _tValidacionProg0 = performance.now();
  // Revisión posterior — ronda 2 (mismo mecanismo que crearContrato() en
  // contratos/actions.ts): envuelve cada `return` de rechazo de esta sección
  // para que la etapa quede en "rechazado" sin duplicar el log de éxito
  // (mutuamente excluyentes) y sin reordenar ninguna validación.
  const _rechazarValidacionPrograma = (resultado: ReservaResult): ReservaResult => {
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
    .select("id, nombre, subtitulo, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, modo_precio, dias, noches, proveedor_id, vigencia_desde, vigencia_hasta, edad_nino_min, edad_nino_max, edad_infante_max, condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo, restriccion_comercial, proveedores(nombre, aplica_retencion, pct_retencion)")
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
  const netoDe: Record<string, { neto: number | null; bs: boolean }> = {};
  let nochesViaje = prog.dias != null ? Math.max(0, prog.dias - 1) : null; // noches del viaje
  let etiquetaOpcion: string | null = null; // nombre de la opción elegida (categoría o salida)
  let hotelSalida: string | null = null;

  if (modoSalida) {
    if (!input.salidaId) return _rechazarValidacionPrograma({ ok: false, error: "Elige una salida." });
    const { data: sal, error: salError } = await sb
      .from("programa_salidas")
      .select("etiqueta, columna, noches, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud")
      .eq("id", input.salidaId)
      .eq("programa_id", input.programaId)
      .maybeSingle();
    if (salError) return _errorValidacionPrograma("error_consulta_salida", salError);
    if (!sal) return _rechazarValidacionPrograma({ ok: false, error: "Salida no encontrada." });
    const bs = sal.bajo_solicitud;
    netoDe["sencilla"] = { neto: sal.neto_sencilla, bs };
    netoDe["doble"] = { neto: sal.neto_doble, bs };
    netoDe["triple"] = { neto: sal.neto_triple, bs };
    netoDe["multiple"] = { neto: sal.neto_multiple, bs };
    netoDe["nino"] = { neto: sal.neto_nino, bs };
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
    for (const p of precios) netoDe[p.acomodacion] = { neto: p.neto, bs: p.bajo_solicitud };
  }

  // PVP de venta: (neto + asistencia médica/día × días) → +markup → +fee bancario.
  // La asistencia es un costo neto más, así que entra ANTES del markup.
  // En modo salida la asistencia médica usa las noches de la salida.
  const diasPvp = modoSalida && nochesViaje != null ? nochesViaje : prog.dias;
  const pvp = (neto: number) =>
    pvpPrograma(neto, {
      pctMk: prog.pct_mk,
      asistenciaDia: prog.asistencia_medica_dia,
      dias: diasPvp,
      pctFee: prog.pct_fee_tarjeta,
      moneda: prog.moneda,
    });

  // 3) Liquidación por HABITACIONES (igual que hoteles): pax = hab × pax_tarifa
  //    (Doble ⇒ 2 pax, Triple ⇒ 3, Sencilla ⇒ 1). El precio de la matriz es por
  //    persona, así que 1 habitación = pax_tarifa × precio/persona. Niños aparte.
  const habs = Object.entries(input.paxPorAcom).filter(([, n]) => (Number(n) || 0) > 0);
  if (!habs.length && (input.ninos || 0) <= 0)
    return _rechazarValidacionPrograma({ ok: false, error: "Indica cuántas habitaciones reservas en cada acomodación." });

  let precioVenta = 0;
  let costoNeto = 0;
  let totalPax = 0;
  const items: { numero_contrato: string; descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; orden: number }[] = [];
  let catNombre: string | null = etiquetaOpcion;
  if (!modoSalida) {
    const { data: catData, error: catError } = await sb.from("programa_categorias").select("nombre").eq("id", input.categoriaId).maybeSingle();
    if (catError) return _errorValidacionPrograma("error_consulta_categoria", catError);
    catNombre = catData?.nombre ?? null;
  }

  let orden = 0;
  for (const [acom, habRaw] of habs) {
    const nHab = Number(habRaw) || 0;
    const info = netoDe[acom];
    if (!info || info.neto == null || info.bs)
      return _rechazarValidacionPrograma({ ok: false, error: `La acomodación ${acom} no tiene precio (o es "a solicitud") en esta categoría.` });
    const paxTarifa = paxDeAcomodacion(acom); // pax por habitación (cuadruple = 4)
    const nPax = nHab * paxTarifa;
    const precioPax = pvp(info.neto);
    const label = ACOM_ROOM_LABEL[acom as AcomRoom] ?? (acom === "cuadruple" ? "Cuádruple" : acom);
    precioVenta += precioPax * nPax;
    costoNeto += info.neto * nPax;
    totalPax += nPax;
    items.push({
      numero_contrato: "",
      descripcion: `${nHab} hab ${label} (${nPax} pax)${catNombre ? ` · ${catNombre}` : ""}`,
      adultos: nPax,
      ninos: 0,
      tarifa_adulto: precioPax,
      tarifa_nino: 0,
      orden: orden++,
    });
  }
  // Niños (por cantidad, no por habitación)
  if ((input.ninos || 0) > 0) {
    const info = netoDe["nino"];
    if (!info || info.neto == null || info.bs)
      return _rechazarValidacionPrograma({ ok: false, error: `Esta categoría no tiene precio de niño (o es "a solicitud").` });
    const n = Number(input.ninos) || 0;
    const precioPax = pvp(info.neto);
    precioVenta += precioPax * n;
    costoNeto += info.neto * n;
    totalPax += n;
    items.push({
      numero_contrato: "",
      descripcion: `${n} niño(s)${catNombre ? ` · ${catNombre}` : ""}`,
      adultos: 0,
      ninos: n,
      tarifa_adulto: 0,
      tarifa_nino: precioPax,
      orden: orden++,
    });
  }
  // Los infantes son pasajeros adicionales (sin silla), por cantidad.
  const numInfantes = Math.max(0, Math.trunc(Number(input.infantes) || 0));
  totalPax += numInfantes;
  if (totalPax <= 0) return _rechazarValidacionPrograma({ ok: false, error: "Debe haber al menos un pasajero." });

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

  // 5) Venta (cabecera) — nace PENDIENTE, en la moneda del programa
  const _tVenta0 = performance.now();
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    tenant,
    cliente: `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim(),
    cliente_documento: oNull(input.cliente.numeroDoc),
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
      const fechaPagoCond = new Date().toISOString().slice(0, 10);
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
    const { error } = await admin.rpc("crear_pasajeros_contrato", {
      p_numero_contrato: numero,
      p_pasajeros: payloadPasajeros as unknown as Json,
      p_holders_min: 0,
      p_usuario_id: actorPasajeros.id,
    });
    if (error) return _errorHijas("pasajeros", error);
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
      const fechaProg = new Date().toISOString().slice(0, 10);
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
  return { ok: true, numero };
}
