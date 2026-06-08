"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { crearCotizacion, type ReservaInput } from "@/app/(dashboard)/dashboard/reservar/actions";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { formatCOP } from "@/lib/utils";

export type SolicitudItem = {
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
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
  pax: number;
  precio: number;
};

export type SolicitudCliente = { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string };

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

export type SolicitudResult =
  | { ok: true; cotizaciones: { id: number; codigo: string; hotel: string; url: string }[]; waUrl: string | null; mailtoUrl: string | null; mensaje: string }
  | { ok: false; error: string };

function resumenHab(it: SolicitudItem): string {
  const partes = Object.entries(it.habitaciones)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  return partes.join(", ");
}

function construirMensaje(
  cliente: SolicitudCliente,
  cotis: { codigo: string; hotel: string; precio: number; item: SolicitudItem; url: string }[],
  extra: string | null,
): string {
  const L: string[] = [];
  L.push("Solicitud de reserva — D'spacios Travel");
  L.push("");
  L.push(`Cliente: ${`${cliente.nombres} ${cliente.apellidos}`.trim()}`);
  const contacto = [cliente.telefono, cliente.email].map((x) => x?.trim()).filter(Boolean).join(" · ");
  if (contacto) L.push(`Contacto: ${contacto}`);
  if (cliente.numeroDoc?.trim()) L.push(`Documento: ${cliente.numeroDoc.trim()}`);
  L.push("");
  let total = 0;
  cotis.forEach((c, i) => {
    const it = c.item;
    total += c.precio;
    L.push(`${i + 1}) ${c.hotel}${it.destino ? ` — ${it.destino}` : ""}`);
    if (it.fechaIda) L.push(`   ${it.fechaIda} → ${it.fechaRegreso ?? ""}${it.noches ? ` (${it.noches} noches)` : ""}`);
    L.push(`   ${it.categoria} / ${it.regimen} · ${resumenHab(it)}`);
    L.push(`   ${it.pax} pax · Valor estimado: ${formatCOP(c.precio)}`);
    L.push(`   Cotización: ${c.codigo}`);
    if (c.url) L.push(`   Documento: ${c.url}`);
    L.push("");
  });
  L.push(`Total estimado: ${formatCOP(total)}`);
  if (extra?.trim()) { L.push(""); L.push(extra.trim()); }
  return L.join("\n");
}

// Genera una cotización por ítem del carrito (un hotel por cotización) y arma los
// enlaces wa.me + mailto hacia los destinatarios configurados. Público (sin login).
export async function crearSolicitudReserva(input: { items: SolicitudItem[]; cliente: SolicitudCliente }): Promise<SolicitudResult> {
  if (!input.items.length) return { ok: false, error: "El carrito está vacío." };
  if (!`${input.cliente.nombres}${input.cliente.apellidos}`.trim()) return { ok: false, error: "Ingresa tu nombre y apellido." };
  if (!input.cliente.telefono.trim() && !input.cliente.email.trim()) return { ok: false, error: "Ingresa al menos un teléfono o correo de contacto." };

  const sb = await createClient();

  // Origen absoluto para armar el enlace público del documento (/cot/<token>).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";

  const cotis: { id: number; codigo: string; hotel: string; precio: number; item: SolicitudItem; url: string }[] = [];

  for (const it of input.items) {
    const reserva: ReservaInput = {
      paqueteId: it.paqueteId,
      bloqueoId: it.bloqueoId,
      modulo: it.modulo,
      hotelId: it.hotelId,
      fechaIda: it.modulo !== "bloqueo" ? (it.fechaIda ?? undefined) : undefined,
      fechaRegreso: it.modulo !== "bloqueo" ? (it.fechaRegreso ?? undefined) : undefined,
      categoria: it.categoria,
      regimen: it.regimen,
      habitaciones: it.habitaciones,
      ninos: it.ninos,
      ninos2: it.ninos2,
      infantes: 0,
      cliente: {
        nombres: input.cliente.nombres, apellidos: input.cliente.apellidos, tipoDoc: "CC",
        numeroDoc: input.cliente.numeroDoc, telefono: input.cliente.telefono, email: input.cliente.email,
      },
      tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
      aliadoId: null, plazo: "", pasajeros: [], servicios: [],
    };
    const r = await crearCotizacion(reserva);
    if (!r.ok) return { ok: false, error: `No se pudo cotizar ${it.hotelNombre}: ${r.error}` };
    const { data: row } = await sb.from("cotizaciones").select("codigo, precio_venta, share_token").eq("id", r.id).maybeSingle();
    const url = origin && row?.share_token ? `${origin}/cot/${row.share_token}` : "";
    cotis.push({ id: r.id, codigo: row?.codigo ?? `#${r.id}`, hotel: it.hotelNombre, precio: row?.precio_venta ?? it.precio, item: it, url });
  }

  // Destinatarios configurados (service-role: el checkout es público/anónimo).
  let whatsapp: string | null = null, emails: string | null = null, mensajeExtra: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from("config_solicitudes").select("whatsapp, emails, mensaje_extra").eq("id", 1).maybeSingle();
    whatsapp = cfg?.whatsapp ?? null; emails = cfg?.emails ?? null; mensajeExtra = cfg?.mensaje_extra ?? null;
  } catch { /* ignore */ }

  const mensaje = construirMensaje(input.cliente, cotis, mensajeExtra);
  const wa = (whatsapp ?? "").replace(/\D/g, "");
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}` : null;
  const correos = (emails ?? "").split(",").map((e) => e.trim()).filter(Boolean).join(",");
  const mailtoUrl = correos
    ? `mailto:${correos}?subject=${encodeURIComponent("Solicitud de reserva — D'spacios Travel")}&body=${encodeURIComponent(mensaje)}`
    : null;

  return { ok: true, cotizaciones: cotis.map((c) => ({ id: c.id, codigo: c.codigo, hotel: c.hotel, url: c.url })), waUrl, mailtoUrl, mensaje };
}
