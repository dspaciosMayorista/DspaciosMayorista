"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio } from "@/lib/calc/paquetes";

export type TipoPaquete = "bloqueo" | "porcion_terrestre" | "empaquetado" | "dinamico";

export type PasajeroInput = {
  nombres: string;
  apellidos: string;
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

  // Precio BLOQUEADO del producto para negociados: se ignoran las tarifas que
  // venga del cliente y se usan las del paquete (el asesor no puede cambiarlas).
  let items = input.items;
  const negociado =
    input.tipoPaquete === "bloqueo" || input.tipoPaquete === "porcion_terrestre";
  if (negociado && input.paqueteId) {
    const { data: precios } = await sb
      .from("paquete_precios")
      .select("acomodacion, precio")
      .eq("paquete_id", input.paqueteId);
    if (precios && precios.length) {
      const doble =
        precios.find((p) => p.acomodacion === "doble")?.precio ??
        Math.min(...precios.map((p) => p.precio));
      const nino = precios.find((p) => p.acomodacion === "nino")?.precio ?? 0;
      items = input.items.map((it) => ({ ...it, tarifaAdulto: doble, tarifaNino: nino }));
    }
  }

  const precioVenta = items.reduce(
    (s, it) => s + it.adultos * it.tarifaAdulto + it.ninos * it.tarifaNino,
    0
  );
  const pax =
    input.pasajeros.filter((p) => !p.esInfante).length ||
    items.reduce((s, it) => s + it.adultos, 0) ||
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
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
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

  if (items.length) {
    const { error } = await sb.from("contrato_items").insert(
      items.map((it, i) => ({
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
          const holders = input.pasajeros.filter((p) => !p.esInfante);
          const adultos = holders.length || pax;
          const { data: libres } = await admin
            .from("sillas")
            .select("id")
            .eq("bloqueo_id", input.bloqueoId)
            .in("estado", ["disponible", "cambio_entrante"])
            .order("numero_silla")
            .limit(adultos);
          if (libres && libres.length) {
            await Promise.all(
              libres.map((s, i) => {
                const p = holders[i];
                return admin.from("sillas").update({
                  estado: "en_plazo",
                  numero_contrato: numero,
                  asesor: oNull(input.asesorNombre),
                  hotel: input.hoteles[0]?.nombre ?? null,
                  acomodacion: input.hoteles[0]?.acomodacion ?? null,
                  pasajero_nombres: oNull(p?.nombres),
                  pasajero_apellidos: oNull(p?.apellidos),
                  tipo_doc: oNull(p?.tipoId),
                  numero_doc: oNull(p?.identificacion),
                  nacimiento: oNull(p?.fechaNacimiento),
                }).eq("id", s.id);
              })
            );
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

export type VentaEditInput = {
  cliente: string;
  clienteDocumento: string;
  clienteTelefono: string;
  clienteEmail: string;
  clienteDireccion: string;
  destino: string;
  fechaSalida: string;
  fechaRegreso: string;
  plazo: string;
  tipoAsesor: string;
  agenciaNombre: string;
  agenciaAsesor: string;
  freelanceNombre: string;
  asesorNombre: string;
  planNombre: string;
  observaciones: string;
};

export async function actualizarVenta(
  numero: string,
  input: VentaEditInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.cliente.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };
  const sb = await createClient();
  const { error } = await sb
    .from("ventas")
    .update({
      cliente: input.cliente.trim(),
      cliente_documento: oNull(input.clienteDocumento),
      cliente_telefono: oNull(input.clienteTelefono),
      cliente_email: oNull(input.clienteEmail),
      cliente_direccion: oNull(input.clienteDireccion),
      destino: oNull(input.destino),
      fecha_salida: oNull(input.fechaSalida),
      fecha_regreso: oNull(input.fechaRegreso),
      plazo: oNull(input.plazo),
      tipo_asesor: oNull(input.tipoAsesor),
      agencia_nombre: oNull(input.agenciaNombre),
      agencia_asesor: oNull(input.agenciaAsesor),
      freelance_nombre: oNull(input.freelanceNombre),
      asesor_firma_nombre: oNull(input.asesorNombre),
      plan_nombre: oNull(input.planNombre),
      observaciones: oNull(input.observaciones),
      updated_at: new Date().toISOString(),
    })
    .eq("numero_contrato", numero);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
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

  // Regla de negocio: un abono confirma la venta pendiente (y sus sillas).
  const { data: venta } = await sb
    .from("ventas")
    .select("estado")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (venta?.estado === "pendiente") {
    await sb.from("ventas").update({ estado: "confirmado" }).eq("numero_contrato", numeroContrato);
    const client = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
    await client
      .from("sillas")
      .update({ estado: "confirmada" })
      .eq("numero_contrato", numeroContrato)
      .eq("estado", "en_plazo");
  }

  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
}

// ── Editar servicios adicionales de un contrato PENDIENTE ───────────────────
// Re-liquida los servicios del paquete según los seleccionados, actualiza los
// ítems de servicio, el precio de venta y (admin) el costo receptivo + las
// casillas Tours/Asistencia. Solo aplica a contratos en estado 'pendiente'.
export async function actualizarServiciosContrato(
  numeroContrato: string,
  serviciosIds: number[]
): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { data: venta } = await sb
    .from("ventas")
    .select("estado, pax, precio_venta, paquete_armado_id")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (!venta) return { ok: false, error: "Contrato no encontrado." };
  if (venta.estado !== "pendiente") return { ok: false, error: "Solo se pueden editar servicios en contratos pendientes." };
  if (!venta.paquete_armado_id) return { ok: false, error: "El contrato no está enlazado a un paquete." };

  const pax = Number(venta.pax) || 0;

  // Servicios disponibles del paquete (PVP) desde el tarifario.
  const { data: servFilas } = await sb
    .from("tarifario_resultado")
    .select("servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, precio_pvp")
    .eq("paquete_id", venta.paquete_armado_id)
    .eq("modulo", "servicios");
  type Serv = { nombre: string; modo: "persona" | "grupo"; personaPvp: number | null; grupos: { pax_desde: number; pax_hasta: number; precio: number }[] };
  const byServ = new Map<number, Serv>();
  for (const r of servFilas ?? []) {
    if (r.servicio_id == null) continue;
    let s = byServ.get(r.servicio_id);
    if (!s) { s = { nombre: r.servicio_nombre ?? "Servicio", modo: r.tipo_tarifa === "grupo" ? "grupo" : "persona", personaPvp: null, grupos: [] }; byServ.set(r.servicio_id, s); }
    if (s.modo === "grupo") s.grupos.push({ pax_desde: r.pax_desde ?? 1, pax_hasta: r.pax_hasta ?? 1, precio: r.precio_pvp });
    else s.personaPvp = r.precio_pvp;
  }

  // Nuevos ítems de servicio + total.
  const nuevos: { nombre: string; precio: number }[] = [];
  let nuevoTotal = 0;
  for (const id of serviciosIds) {
    const s = byServ.get(id);
    if (!s) continue;
    const p = precioServicio(s.modo, s.personaPvp, s.grupos, pax);
    if (p > 0) { nuevos.push({ nombre: s.nombre, precio: p }); nuevoTotal += p; }
  }

  // Quitar ítems de servicio actuales (y su total) para recalcular el precio.
  const { data: oldItems } = await sb
    .from("contrato_items")
    .select("id, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino")
    .eq("numero_contrato", numeroContrato);
  let oldTotal = 0;
  const oldServiceIds: number[] = [];
  for (const it of oldItems ?? []) {
    if (it.descripcion?.startsWith("Servicio · ")) {
      oldTotal += it.adultos * it.tarifa_adulto + it.ninos * it.tarifa_nino;
      oldServiceIds.push(it.id);
    }
  }
  if (oldServiceIds.length) await sb.from("contrato_items").delete().in("id", oldServiceIds);
  if (nuevos.length) {
    await sb.from("contrato_items").insert(
      nuevos.map((s, i) => ({
        numero_contrato: numeroContrato,
        descripcion: `Servicio · ${s.nombre}`,
        adultos: 1, ninos: 0, tarifa_adulto: s.precio, tarifa_nino: 0, orden: 100 + i,
      }))
    );
  }

  const nuevoPrecio = Math.max(0, (Number(venta.precio_venta) || 0) - oldTotal + nuevoTotal);
  await sb.from("ventas").update({ precio_venta: nuevoPrecio }).eq("numero_contrato", numeroContrato);

  // Costo receptivo neto + casillas Tours/Asistencia (admin: oculto al asesor).
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      let costoReceptivo = 0;
      const tours: string[] = [];
      let hayAsistencia = false;
      if (serviciosIds.length) {
        const [{ data: arm }, { data: gruposNet }] = await Promise.all([
          admin.from("armado_servicios").select("servicio_id, modo, servicios_adicionales(precio_persona, categoria, nombre)").eq("paquete_id", venta.paquete_armado_id).in("servicio_id", serviciosIds),
          admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio").in("servicio_id", serviciosIds),
        ]);
        const gruposPorServ = new Map<number, { pax_desde: number; pax_hasta: number; precio: number }[]>();
        for (const g of gruposNet ?? []) {
          const arr = gruposPorServ.get(g.servicio_id) ?? [];
          arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
          gruposPorServ.set(g.servicio_id, arr);
        }
        for (const s of arm ?? []) {
          const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
          const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; categoria: string | null; nombre: string } | null;
          costoReceptivo += precioServicio(modo, srv?.precio_persona ?? null, gruposPorServ.get(s.servicio_id) ?? [], pax);
          const cat = srv?.categoria ?? "otro";
          if (cat === "asistencia") hayAsistencia = true;
          else if (cat === "tour_traslado" && srv?.nombre) tours.push(srv.nombre);
        }
      }
      await admin.from("ventas").update({
        costo_receptivo: costoReceptivo,
        tours_traslados: tours.length ? tours.join(", ") : null,
        asistencia_medica: hayAsistencia,
      }).eq("numero_contrato", numeroContrato);
    } catch {
      // Costo neto informativo; no bloquea la edición.
    }
  }

  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  return { ok: true };
}
