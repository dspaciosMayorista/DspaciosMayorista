"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type TipoPaquete = "bloqueo" | "porcion_terrestre" | "empaquetado" | "dinamico";

export type PasajeroInput = {
  nombre: string;
  tipoId: string;
  identificacion: string;
  fechaNacimiento: string;
  esInfante: boolean;
};

export type HotelInput = {
  nombre: string;
  ciudad: string;
  alimentacion: string;
  acomodacion: string;
  detalleAcomodacion: string;
  fechaIngreso: string;
  fechaSalida: string;
};

export type VueloInput = {
  aerolinea: string;
  origenCodigo: string;
  origenCiudad: string;
  destinoCodigo: string;
  destinoCiudad: string;
  servicios: string;
  fechaSalida: string;
};

export type ItemInput = {
  descripcion: string;
  adultos: number;
  ninos: number;
  tarifaAdulto: number;
  tarifaNino: number;
};

export type ContratoInput = {
  tipoPaquete: TipoPaquete;
  paqueteId: number | null;
  bloqueoId: number | null; // record asignado (solo bloqueo)
  cliente: string;
  clienteDocumento: string;
  clienteTelefono: string;
  clienteDireccion: string;
  destino: string;
  fechaSalida: string;
  fechaRegreso: string;
  fechaEmision: string;
  asistenciaMedica: boolean;
  planNombre: string;
  toursTraslados: string;
  asesorNombre: string;
  asesorCargo: string;
  asesorCc: string;
  asesorTel: string;
  pasajeros: PasajeroInput[];
  hoteles: HotelInput[];
  vuelos: VueloInput[];
  items: ItemInput[];
};

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type CrearContratoResult = { ok: true; numero: string } | { ok: false; error: string };

export async function crearContrato(
  input: ContratoInput
): Promise<CrearContratoResult> {
  const sb = await createClient();

  // 1. Número de contrato (00-NNNN) vía secuencia en la BD
  const { data: numero, error: ne } = await sb.rpc("siguiente_numero_contrato");
  if (ne || !numero) {
    return {
      ok: false,
      error:
        (ne?.message ?? "No se pudo generar el número de contrato.") +
        " — Verifica que la migración 010 esté aplicada en Supabase.",
    };
  }

  const precioVenta = input.items.reduce(
    (s, it) => s + it.adultos * it.tarifaAdulto + it.ninos * it.tarifaNino,
    0
  );
  const pax =
    input.pasajeros.filter((p) => !p.esInfante).length ||
    input.items.reduce((s, it) => s + it.adultos, 0) ||
    1;

  // 2. Crear la venta (cabecera del contrato)
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    cliente: input.cliente.trim(),
    destino: oNull(input.destino),
    fecha_salida: oNull(input.fechaSalida),
    fecha_regreso: oNull(input.fechaRegreso),
    fecha_emision: oNull(input.fechaEmision),
    pax,
    precio_venta: precioVenta,
    estado: "activo",
    tipo_paquete: input.tipoPaquete,
    cliente_documento: oNull(input.clienteDocumento),
    cliente_telefono: oNull(input.clienteTelefono),
    cliente_direccion: oNull(input.clienteDireccion),
    asistencia_medica: input.asistenciaMedica,
    plan_nombre: oNull(input.planNombre),
    tours_traslados: oNull(input.toursTraslados),
    asesor_firma_nombre: oNull(input.asesorNombre),
    asesor_firma_cargo: oNull(input.asesorCargo) ?? "Asesor/a",
    asesor_firma_cc: oNull(input.asesorCc),
    asesor_firma_tel: oNull(input.asesorTel),
  });
  if (ve) return { ok: false, error: ve.message };

  // 3. Tablas hijas
  if (input.pasajeros.length) {
    const { error } = await sb.from("contrato_pasajeros").insert(
      input.pasajeros.map((p, i) => ({
        numero_contrato: numero,
        nombre: p.nombre.trim(),
        tipo_id: oNull(p.tipoId) ?? "CC",
        identificacion: oNull(p.identificacion),
        fecha_nacimiento: oNull(p.fechaNacimiento),
        es_infante: p.esInfante,
        orden: i,
      }))
    );
    if (error) return { ok: false, error: error.message };
  }

  if (input.hoteles.length) {
    const { error } = await sb.from("contrato_hoteles").insert(
      input.hoteles.map((h, i) => ({
        numero_contrato: numero,
        nombre: h.nombre.trim(),
        ciudad: oNull(h.ciudad),
        alimentacion: oNull(h.alimentacion),
        acomodacion: oNull(h.acomodacion),
        detalle_acomodacion: oNull(h.detalleAcomodacion),
        fecha_ingreso: oNull(h.fechaIngreso),
        fecha_salida: oNull(h.fechaSalida),
        orden: i,
      }))
    );
    if (error) return { ok: false, error: error.message };
  }

  if (input.vuelos.length) {
    const { error } = await sb.from("contrato_vuelos").insert(
      input.vuelos.map((v, i) => ({
        numero_contrato: numero,
        aerolinea: oNull(v.aerolinea),
        origen_codigo: oNull(v.origenCodigo),
        origen_ciudad: oNull(v.origenCiudad),
        destino_codigo: oNull(v.destinoCodigo),
        destino_ciudad: oNull(v.destinoCiudad),
        servicios: oNull(v.servicios),
        fecha_salida: oNull(v.fechaSalida),
        orden: i,
      }))
    );
    if (error) return { ok: false, error: error.message };
  }

  if (input.items.length) {
    const { error } = await sb.from("contrato_items").insert(
      input.items.map((it, i) => ({
        numero_contrato: numero,
        descripcion: it.descripcion.trim(),
        adultos: it.adultos,
        ninos: it.ninos,
        tarifa_adulto: it.tarifaAdulto,
        tarifa_nino: it.tarifaNino,
        orden: i,
      }))
    );
    if (error) return { ok: false, error: error.message };
  }

  // ── Productos negociados: costos desde el módulo de producto + cupos ──────
  // Se hace con el cliente service-role para que el asesor nunca vea los costos
  // ni necesite permisos sobre sillas. Si no hay llave service-role, se omite.
  const esNegociado =
    input.tipoPaquete === "bloqueo" || input.tipoPaquete === "porcion_terrestre";
  if ((esNegociado && input.paqueteId) || (input.tipoPaquete === "bloqueo" && input.bloqueoId)) {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();

        // 1) Copiar costos negociados del paquete a la venta (ocultos al asesor)
        if (esNegociado && input.paqueteId) {
          const { data: costos } = await admin
            .from("paquete_costos")
            .select("*")
            .eq("paquete_id", input.paqueteId)
            .maybeSingle();
          if (costos) {
            await admin
              .from("ventas")
              .update({
                costo_hotel: costos.costo_hotel,
                costo_aereo: costos.costo_aereo,
                costo_receptivo: costos.costo_receptivo,
                costo_asistencia: costos.costo_asistencia,
                otros_costos: costos.otros_costos,
              })
              .eq("numero_contrato", numero);
          }
        }

        // 2) Descontar cupos del record (asignar N sillas disponibles)
        if (input.tipoPaquete === "bloqueo" && input.bloqueoId) {
          const adultos = input.pasajeros.filter((p) => !p.esInfante).length || pax;
          const { data: libres } = await admin
            .from("sillas")
            .select("id")
            .eq("bloqueo_id", input.bloqueoId)
            .eq("estado", "disponible")
            .order("numero_silla")
            .limit(adultos);
          if (libres && libres.length) {
            await admin
              .from("sillas")
              .update({
                estado: "en_plazo",
                numero_contrato: numero,
                asesor: oNull(input.asesorNombre),
                hotel: input.hoteles[0]?.nombre ?? null,
                acomodacion: input.hoteles[0]?.acomodacion ?? null,
              })
              .in("id", libres.map((s) => s.id));
          }
        }
      } catch {
        // No bloquear la creación del contrato si falla el paso administrativo.
      }
    }
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero };
}

export async function registrarAbono(
  numeroContrato: string,
  valor: number,
  formaPago: string,
  referencia: string
) {
  const sb = await createClient();
  const { error } = await sb.from("abonos").insert({
    numero_contrato: numeroContrato,
    valor_abono: valor,
    forma_pago: formaPago || null,
    referencia: referencia || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
}
