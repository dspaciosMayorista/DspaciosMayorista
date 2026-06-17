"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { crearCotizacion, type ReservaInput } from "@/app/(dashboard)/dashboard/reservar/actions";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { formatCOP } from "@/lib/utils";
import { comisionDefault, categoriaAliado } from "@/lib/b2b";

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
  infantes: number;
  pax: number;
  precio: number;
};

export type SolicitudCliente = { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string };

// Datos de facturación (contrato neto): normalmente la agencia.
export type Facturacion = { nombre: string; nit: string; email: string; telefono: string };

export type ContextoB2B = {
  esB2B: boolean;
  tipo: "agencia" | "freelance" | null;
  agencia: Facturacion | null;
  pctComision: number; // fracción (0.10)
  categoria: string | null; // "Agencia Junior" / "Agencia Senior" / ...
};

// Contexto del aliado logueado (para el checkout B2B): tipo, datos de
// facturación de la agencia y su % de comisión.
export async function getContextoB2B(): Promise<ContextoB2B> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { esB2B: false, tipo: null, agencia: null, pctComision: 0, categoria: null };
  const { data: perfil } = await sb.from("usuarios").select("nombre, email, rol, agencia_id, pct_comision").eq("id", user.id).maybeSingle();
  const rol = perfil?.rol ?? null;
  if (rol !== "agencia" && rol !== "freelance") return { esB2B: false, tipo: null, agencia: null, pctComision: 0, categoria: null };

  // Si es un AGENTE, la facturación/comisión es la de su AGENCIA titular.
  const agenciaUserId = perfil?.agencia_id ?? user.id;
  let agenciaPerfil = perfil;
  if (perfil?.agencia_id) {
    const { data: ap } = await sb.from("usuarios").select("nombre, email, rol, pct_comision").eq("id", perfil.agencia_id).maybeSingle();
    if (ap) agenciaPerfil = { ...ap, agencia_id: null };
  }

  const { data: sols } = await sb
    .from("b2b_solicitudes")
    .select("nombre, nit, email, telefono")
    .eq("usuario_id", agenciaUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  const sol = sols?.[0];
  const agencia: Facturacion = {
    nombre: sol?.nombre ?? agenciaPerfil?.nombre ?? "",
    nit: sol?.nit ?? "",
    email: sol?.email ?? agenciaPerfil?.email ?? "",
    telefono: sol?.telefono ?? "",
  };

  // Comisión POR AGENCIA: el % vive en el usuario (la agencia titular). El
  // default general sale del parámetro tributario; la categoría compara contra él.
  const def = await comisionDefault(sb, rol);
  const pct = agenciaPerfil?.pct_comision ?? def;
  const categoria = categoriaAliado(rol, pct, def).label;
  return { esB2B: true, tipo: rol, agencia, pctComision: pct, categoria };
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

export type SolicitudResult =
  | { ok: true; cotizaciones: { id: number; codigo: string; hotel: string; url: string }[]; waUrl: string | null; mailtoUrl: string | null; mensaje: string }
  | { ok: false; error: string };

function resumenHab(it: SolicitudItem): string {
  const partes = Object.entries(it.habitaciones)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  if (it.infantes > 0) partes.push(`${it.infantes} Infante(s)`);
  return partes.join(", ");
}

function construirMensaje(
  cliente: SolicitudCliente,
  cotis: { codigo: string; hotel: string; precio: number; item: SolicitudItem; url: string }[],
  extra: string | null,
  b2b?: { modo: "comisionable" | "neta"; facturacion: Facturacion; pctComision: number },
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
  L.push(`Total (PVP): ${formatCOP(total)}`);
  if (b2b?.modo === "neta") {
    const comision = Math.round(total * (b2b.pctComision || 0));
    L.push(`Comisión (${Math.round((b2b.pctComision || 0) * 100)}%): −${formatCOP(comision)}`);
    L.push(`TOTAL NETO a pagar: ${formatCOP(total - comision)}`);
  } else if (b2b?.modo === "comisionable") {
    const comision = Math.round(total * (b2b.pctComision || 0));
    L.push(`Comisión a liquidar (${Math.round((b2b.pctComision || 0) * 100)}%): ${formatCOP(comision)}`);
  }
  if (extra?.trim()) { L.push(""); L.push(extra.trim()); }
  return L.join("\n");
}

// Genera una cotización por ítem del carrito (un hotel por cotización) y arma los
// enlaces wa.me + mailto hacia los destinatarios configurados. Público (sin login).
export async function crearSolicitudReserva(input: {
  items: SolicitudItem[];
  cliente: SolicitudCliente;
  modo?: "comisionable" | "neta";
  facturacion?: Facturacion;
  pctComision?: number;
}): Promise<SolicitudResult> {
  if (!input.items.length) return { ok: false, error: "El carrito está vacío." };
  if (!`${input.cliente.nombres}${input.cliente.apellidos}`.trim()) return { ok: false, error: "Ingresa nombres y apellidos." };
  if (!input.cliente.numeroDoc.trim()) return { ok: false, error: "El documento es obligatorio." };
  if (!input.cliente.telefono.trim()) return { ok: false, error: "El teléfono / WhatsApp es obligatorio." };

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
      infantes: it.infantes || 0,
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

  // Agrega el cliente a la base de contactos del CRM como B2C (cliente_final),
  // editable luego a B2B (agencia/freelance). Service-role: el checkout es público.
  try {
    const admin = createAdminClient();
    const nombre = `${input.cliente.nombres} ${input.cliente.apellidos}`.trim();
    if (nombre) {
      // Si ya existe (índice único por documento/email/teléfono) el insert falla
      // con 23505 y simplemente se ignora (no se duplica ni bloquea la solicitud).
      await admin.from("crm_contactos").insert({
        categoria: "cliente_final",
        nombre,
        tipo_doc: input.cliente.numeroDoc.trim() ? "CC" : null,
        documento: input.cliente.numeroDoc.trim() || null,
        email: input.cliente.email.trim() || null,
        telefono: input.cliente.telefono.trim() || null,
        origen: "Cotización tarifario (B2C)",
      });
    }
  } catch { /* no bloquear la solicitud */ }

  // Destinatarios configurados (service-role: el checkout es público/anónimo).
  let whatsapp: string | null = null, emails: string | null = null, mensajeExtra: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from("config_solicitudes").select("whatsapp, emails, mensaje_extra").eq("id", 1).maybeSingle();
    whatsapp = cfg?.whatsapp ?? null; emails = cfg?.emails ?? null; mensajeExtra = cfg?.mensaje_extra ?? null;
  } catch { /* ignore */ }

  const b2b = input.modo && input.facturacion
    ? { modo: input.modo, facturacion: input.facturacion, pctComision: input.pctComision ?? 0 }
    : undefined;
  const mensaje = construirMensaje(input.cliente, cotis, mensajeExtra, b2b);
  const wa = (whatsapp ?? "").replace(/\D/g, "");
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}` : null;
  const correos = (emails ?? "").split(",").map((e) => e.trim()).filter(Boolean).join(",");
  const mailtoUrl = correos
    ? `mailto:${correos}?subject=${encodeURIComponent("Solicitud de reserva — D'spacios Travel")}&body=${encodeURIComponent(mensaje)}`
    : null;

  return { ok: true, cotizaciones: cotis.map((c) => ({ id: c.id, codigo: c.codigo, hotel: c.hotel, url: c.url })), waUrl, mailtoUrl, mensaje };
}
