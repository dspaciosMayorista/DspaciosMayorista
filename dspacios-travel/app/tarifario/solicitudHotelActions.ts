"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { codigoErrorContacto, datosContactoTarifario, logContactoTarifario, origenContactoTarifario } from "@/lib/crm/contactoTarifario";
import { paqueteVendibleHoy } from "@/lib/tarifario/datosSolicitud";
import { acreditarSeleccionCatalogo, claveSolicitudHotel, validarEntradaSolicitudHotel, type SolicitudHotelEntrada } from "@/lib/reservar/solicitudHotelEntrada";
import { ESTADO_PENDIENTE_TARIFA, TEXTO_BAJO_SOLICITUD, contieneImportes } from "@/lib/reservar/solicitudHotel";
import { catalogoDelHotel, evaluarOcupacionHotel, modalidadDelVinculo } from "@/lib/reservar/solicitudHotelServidor";
import type { Json } from "@/types/database";
import { getContextoB2B } from "./checkout/actions";

// #120 · El cliente (B2C anónimo o aliado B2B) pide cotización de un hotel SIN tarifa publicada. Crea una cotización SEPARADA `pendiente_tarifa`: sin precio, sin total
// parcial y sin los importes de los demás componentes del paquete. No toca el carrito (los hoteles tarifados se cotizan por su camino de siempre), no crea contrato,
// pago ni CxP. La identidad B2B sale de la sesión (nunca del navegador); las fechas de una salida con vuelo salen del vuelo, no de lo que mande el cliente.

export type SolicitudHotelResult =
  | { ok: true; codigo: string; url: string; waUrl: string | null; mailtoUrl: string | null; repetida: boolean; texto: string }
  | { ok: false; error: string };

const ERROR_CONFIG = "No se pudo registrar la solicitud por un problema de configuración. Contacta a D'spacios Travel.";
const ERROR_GENERICO = "No pudimos registrar tu solicitud en este momento. Inténtalo de nuevo en unos minutos.";

export type OcupacionSolicitudResult = { ok: true; adultos: number; ninos: number; infantes: number } | { ok: false; error: string };

/**
 * Aviso ANTES de enviar: ¿la acomodación elegida admite a los niños/infantes declarados en este hotel? Mismas reglas del motor (umbrales de edad del hotel, `hotel_acomodaciones`;
 * sin configurar rigen los defaults del motor). Solo informa conteos y el motivo; no crea nada y solo responde por hoteles marcados y seleccionados en el paquete.
 */
export async function validarOcupacionSolicitud(raw: unknown): Promise<OcupacionSolicitudResult> {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
  const paqueteId = id(r.paqueteId), hotelId = id(r.hotelId);
  if (!paqueteId || !hotelId) return { ok: false, error: "Elige un hotel válido." };
  const hab: Record<string, number> = {};
  for (const a of ["sencilla", "doble", "triple", "multiple"]) {
    const n = (r.habitaciones as Record<string, unknown> | undefined)?.[a] ?? 0;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10) return { ok: false, error: "Cantidad de habitaciones no válida." };
    hab[a] = n;
  }
  if (Object.values(hab).every((n) => n === 0)) return { ok: false, error: "Indica al menos una habitación." };
  const edades = r.edadesMenores == null ? [] : r.edadesMenores;
  if (!Array.isArray(edades) || edades.length > 12 || edades.some((e) => typeof e !== "number" || !Number.isInteger(e) || e < 0 || e > 17)) return { ok: false, error: "Las edades de los menores deben ser números entre 0 y 17." };
  const adultos = r.adultos == null || r.adultos === "" ? null : r.adultos;
  if (adultos !== null && (typeof adultos !== "number" || !Number.isInteger(adultos) || adultos < 1 || adultos > 40)) return { ok: false, error: "La cantidad de adultos debe ser un número entero de 1 en adelante." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: ERROR_CONFIG };
  const admin = createAdminClient();
  const mod = await modalidadDelVinculo(admin, paqueteId, hotelId);
  if (!mod.ok || mod.modalidad !== "bajo_solicitud") return { ok: false, error: "Este hotel no se ofrece bajo solicitud en este paquete." };
  const o = await evaluarOcupacionHotel(admin, hotelId, hab, edades as number[], adultos);
  return o.ok ? { ok: true, ...o.conteos } : { ok: false, error: o.error };
}

export async function crearSolicitudHotel(raw: unknown): Promise<SolicitudHotelResult> {
  const hoy = hoyBogota();
  const v = validarEntradaSolicitudHotel(raw, hoy);
  if (!v.ok) return { ok: false, error: v.error };
  const input: SolicitudHotelEntrada = v.input;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: ERROR_CONFIG };
  const admin = createAdminClient();

  // Paquete vendible hoy y de un tipo que admite hotel a solicitud.
  const { data: pq, error: ePq } = await admin
    .from("armado_paquetes")
    .select("id, nombre, tipo, activo, fecha_compra_inicio, fecha_compra_fin, fecha_viaje_inicio, fecha_viaje_fin, destinos(nombre)")
    .eq("id", input.paqueteId).maybeSingle();
  if (ePq) return { ok: false, error: ERROR_GENERICO };
  if (!pq || !pq.activo || (pq.tipo !== "bloqueo" && pq.tipo !== "porcion_terrestre") || !paqueteVendibleHoy(pq, hoy))
    return { ok: false, error: "Este paquete ya no está disponible para solicitar cotización." };
  const modulo = pq.tipo as "bloqueo" | "porcion_terrestre";
  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;

  // El vínculo DEBE ser «bajo solicitud»: un hotel tarifado se cotiza por el tarifario, no por aquí.
  const mod = await modalidadDelVinculo(admin, input.paqueteId, input.hotelId);
  if (!mod.ok) return { ok: false, error: ERROR_GENERICO };
  if (mod.modalidad !== "bajo_solicitud") return { ok: false, error: "Este hotel no se ofrece bajo solicitud en este paquete." };
  const { data: hotel, error: eH } = await admin.from("hoteles").select("nombre, moneda, adults_only").eq("id", input.hotelId).maybeSingle();
  if (eH || !hotel) return { ok: false, error: ERROR_GENERICO };
  if (hotel.adults_only && input.edadesMenores.length) return { ok: false, error: "Este hotel es Adults Only: no acepta niños ni infantes." };
  // Tipo de habitación y plan de alimentación: solo valores del catálogo configurado de ESTE hotel (se acreditan aquí, no en el navegador) y se guardan con el texto canónico del catálogo.
  const catalogo = await catalogoDelHotel(admin, input.hotelId);
  if (!catalogo.ok) return { ok: false, error: ERROR_GENERICO };
  const acreditada = acreditarSeleccionCatalogo({ categoria: input.categoria, regimen: input.regimen }, catalogo);
  if (!acreditada.ok) return { ok: false, error: acreditada.error };
  input.categoria = acreditada.categoria;
  input.regimen = acreditada.regimen;
  // La acomodación elegida debe admitir a los menores declarados (misma regla que usará la valoración y la reserva): así el operador no descubre el rechazo al cargar la neta.
  const ocupacion = await evaluarOcupacionHotel(admin, input.hotelId, input.habitaciones, input.edadesMenores, input.adultos);
  if (!ocupacion.ok) return { ok: false, error: ocupacion.error };

  // Salida: con vuelo, las fechas son las del vuelo vinculado al paquete; en porción terrestre las elige el cliente dentro del rango del paquete.
  let fechaIda = input.fechaIda;
  let fechaRegreso = input.fechaRegreso;
  let bloqueoId: number | null = null;
  let empaquetadoId: number | null = null;
  if (modulo === "bloqueo") {
    if (!!input.bloqueoId === !!input.empaquetadoId) return { ok: false, error: "Elige la salida del vuelo." };
    const fuente = input.bloqueoId
      ? await admin.from("armado_vuelos").select("bloqueos_vuelo(fecha_ida, fecha_regreso)").eq("paquete_id", input.paqueteId).eq("bloqueo_id", input.bloqueoId).maybeSingle()
      : await admin.from("armado_empaquetados").select("empaquetados(fecha_ida, fecha_regreso, activo, compra_inicio, compra_fin)").eq("paquete_id", input.paqueteId).eq("empaquetado_id", input.empaquetadoId!).maybeSingle();
    if (fuente.error) return { ok: false, error: ERROR_GENERICO };
    const f = (fuente.data as unknown as { bloqueos_vuelo?: { fecha_ida: string | null; fecha_regreso: string | null } | null; empaquetados?: { fecha_ida: string | null; fecha_regreso: string | null; activo: boolean; compra_inicio: string | null; compra_fin: string | null } | null } | null);
    const dato = f?.bloqueos_vuelo ?? f?.empaquetados ?? null;
    if (!dato?.fecha_ida || !dato.fecha_regreso || dato.fecha_ida < hoy) return { ok: false, error: "Esa salida ya no está disponible." };
    const e = f?.empaquetados;
    if (e && (!e.activo || (e.compra_inicio && e.compra_inicio > hoy) || (e.compra_fin && e.compra_fin < hoy))) return { ok: false, error: "Esa salida ya no está disponible." };
    fechaIda = dato.fecha_ida; fechaRegreso = dato.fecha_regreso;
    bloqueoId = input.bloqueoId; empaquetadoId = input.empaquetadoId;
  } else {
    if (input.bloqueoId || input.empaquetadoId) return { ok: false, error: "Este paquete no lleva vuelo." };
    if ((pq.fecha_viaje_inicio && fechaIda < pq.fecha_viaje_inicio) || (pq.fecha_viaje_fin && fechaRegreso > pq.fecha_viaje_fin))
      return { ok: false, error: `Las fechas deben estar dentro del viaje del paquete (${pq.fecha_viaje_inicio ?? "—"} a ${pq.fecha_viaje_fin ?? "—"}).` };
  }

  // Identidad B2B desde la sesión.
  const ctxB2B = await getContextoB2B();
  if (ctxB2B.error) return { ok: false, error: ctxB2B.error };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let aliadoId: number | null = null;
  if (ctxB2B.esB2B && user) {
    const { data: perfil } = await sb.from("usuarios").select("aliado_id").eq("id", user.id).maybeSingle();
    aliadoId = (perfil?.aliado_id as number | null) ?? null;
  }
  const tipoAsesor = ctxB2B.esB2B && ctxB2B.tipo ? ctxB2B.tipo : "interno";
  const nombreAliado = ctxB2B.esB2B ? (ctxB2B.agencia?.nombre ?? "") : "";

  const cantidadHab = Object.values(input.habitaciones).reduce((a, b) => a + b, 0);
  const payload = {
    paqueteId: input.paqueteId, bloqueoId, empaquetadoId, salidaId: null, modulo, hotelId: input.hotelId,
    fechaIda, fechaRegreso, categoria: input.categoria, regimen: input.regimen, habitaciones: input.habitaciones,
    ninos: 0, ninos2: 0, infantes: 0, edadesMenores: input.edadesMenores, cantidadMenores: input.edadesMenores.length, mascotas: 0,
    ...(input.adultos != null ? { adultosReales: input.adultos } : {}),
    cliente: { nombres: input.cliente.nombres, apellidos: input.cliente.apellidos, tipoDoc: input.cliente.tipoDoc ?? "", numeroDoc: input.cliente.numeroDoc, telefono: input.cliente.telefono, email: input.cliente.email },
    tipoAsesor, asesorInterno: "", agenciaNombre: tipoAsesor === "agencia" ? nombreAliado : "", agenciaAsesor: "", freelanceNombre: tipoAsesor === "freelance" ? nombreAliado : "",
    aliadoId, plazo: "", pasajeros: [], servicios: [],
  };
  const detalle = {
    solicitudHotel: {
      clave: claveSolicitudHotel({ ...input, fechaIda, fechaRegreso }), hotelNombre: hotel.nombre, paqueteNombre: pq.nombre, destino: destinoNombre,
      categoria: input.categoria, regimen: input.regimen, habitaciones: input.habitaciones, menores: input.edadesMenores.length, adultos: input.adultos, notas: input.notas || null, fechaIda, fechaRegreso,
    },
  };
  // Defensa: la solicitud pública no puede cargar importes (ni siquiera por un campo de más en el payload).
  if (contieneImportes(payload) || contieneImportes(detalle)) return { ok: false, error: "Solicitud no válida." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const urlDe = (token: string | null | undefined) => (host && token ? `${proto}://${host}/cot/${token}` : "");

  // Reintento / doble clic: la misma solicitud abierta no crea otra cotización.
  const { data: previa } = await admin.from("cotizaciones").select("codigo, share_token").eq("estado", ESTADO_PENDIENTE_TARIFA).eq("paquete_armado_id", input.paqueteId)
    .contains("detalle", { solicitudHotel: { clave: detalle.solicitudHotel.clave } } as Record<string, unknown>).limit(1).maybeSingle();

  let codigo: string; let token: string | null;
  let repetida = false;
  if (previa) {
    codigo = previa.codigo; token = previa.share_token; repetida = true;
  } else {
    const { data: row, error } = await admin.from("cotizaciones").insert({
      tenant: "mayorista", estado: ESTADO_PENDIENTE_TARIFA, payload: payload as unknown as Json, detalle: detalle as unknown as Json,
      cliente: `${input.cliente.nombres} ${input.cliente.apellidos}`.trim(), cliente_documento: input.cliente.numeroDoc,
      destino: destinoNombre, hotel: hotel.nombre, modulo, plan_nombre: `${input.categoria} · ${input.regimen}`,
      // Personas REALES de la solicitud (adultos + niños + infantes): la ficha muestra «Pasajeros» y pide ese número de filas al convertir (con 0 pedía 1 solo pasajero).
      pax: ocupacion.conteos.adultos + ocupacion.conteos.ninos + ocupacion.conteos.infantes, precio_venta: 0, moneda: hotel.moneda === "USD" ? "USD" : "COP", fecha_salida: fechaIda, fecha_regreso: fechaRegreso,
      paquete_armado_id: input.paqueteId, asesor: null, creado_por: user?.email ?? null,
    }).select("id, codigo, share_token").single();
    if (error || !row) { console.error(`[crearSolicitudHotel] etapa=insertar codigo=${error?.code ?? "sin_fila"}`); return { ok: false, error: ERROR_GENERICO }; }
    codigo = row.codigo; token = row.share_token;
    // El cliente entra al CRM ya (como en el checkout: efecto auxiliar, nunca bloquea la solicitud). El REGISTRO DE PERSONAS de la cotización (#42, migración 219) solo admite
    // cotizaciones abiertas: la alta del titular se hace en asignarNetaSolicitud, cuando la solicitud pasa de pendiente_tarifa a abierta.
    try {
      const datos = datosContactoTarifario({ nombres: input.cliente.nombres, apellidos: input.cliente.apellidos, numeroDoc: input.cliente.numeroDoc, telefono: input.cliente.telefono, email: input.cliente.email }, input.cliente.tipoDoc);
      if (datos) {
        const { error: eCrm } = await admin.from("crm_contactos").insert({ categoria: "cliente_final", ...datos, origen: origenContactoTarifario({ asistida: false, aliadoAutenticado: ctxB2B.esB2B }), tenant: "mayorista" });
        const codigoCrm = codigoErrorContacto(eCrm);
        if (codigoCrm) console.error(logContactoTarifario(codigoCrm));
      }
    } catch { console.error(logContactoTarifario("excepcion")); }
  }

  const url = urlDe(token);
  const lineas = [
    `Solicitud de cotización ${codigo} — ${TEXTO_BAJO_SOLICITUD}`,
    `Hotel: ${hotel.nombre} (${pq.nombre})`,
    `Fechas: ${fechaIda} al ${fechaRegreso}`,
    `Habitaciones: ${cantidadHab}${input.edadesMenores.length ? ` · Menores: ${input.edadesMenores.length}` : ""}`,
    `Cliente: ${input.cliente.nombres} ${input.cliente.apellidos} · ${input.cliente.telefono}`,
    ...(input.notas ? [`Notas: ${input.notas}`] : []),
    ...(url ? [`Detalle: ${url}`] : []),
  ];
  const texto = lineas.join("\n");
  let whatsapp: string | null = null; let emails: string | null = null;
  try {
    const { data: cfg } = await admin.from("config_solicitudes").select("whatsapp, emails").eq("id", 1).maybeSingle();
    whatsapp = cfg?.whatsapp ?? null; emails = cfg?.emails ?? null;
  } catch { /* best-effort */ }
  const wa = (whatsapp ?? "").replace(/\D/g, "");
  const correos = (emails ?? "").split(",").map((e) => e.trim()).filter(Boolean).join(",");
  return {
    ok: true, codigo, url, repetida, texto,
    waUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(texto)}` : null,
    mailtoUrl: correos ? `mailto:${correos}?subject=${encodeURIComponent("Solicitud de cotización — D'spacios Travel")}&body=${encodeURIComponent(texto)}` : null,
  };
}
