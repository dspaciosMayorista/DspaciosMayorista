"use server";

import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant.server";
import { revalidatePath } from "next/cache";
import { limpiarMensajeAdicional, validarDestinatarios } from "@/lib/solicitudProveedor/nucleo";
import { configCorreo, transporteDeConfig } from "@/lib/solicitudProveedor/transporte";
import { armarAvisoPago, BUCKET_SOPORTES, cargarAdjuntosPago, cargarLineasPago, hidratarAdjuntosPago, listarPagosDeProveedor, MAX_ARCHIVO_BYTES, type PagoListado } from "@/lib/solicitudProveedor/cargar";
import { enviarSolicitud, reintentarEnvio } from "@/lib/solicitudProveedor/servicio";
import type { Json } from "@/types/database";

// #103 (D) — aviso de pago a proveedor. Tres hechos SEPARADOS: (1) el pago ya está registrado en `cxp_pagos` (otro módulo; aquí solo se LEE), (2) se sube evidencia (esta acción escribe solo `cxp_pago_soportes` y el
// bucket privado), (3) se envía el aviso (esta acción escribe solo `solicitudes_proveedor` tipo pago). Ninguna acción de este archivo crea, edita ni borra un pago, un asiento contable o una conciliación, y reintentar
// un envío nunca vuelve a postear nada. Autoriza el CÓDIGO: rol contable + agencia activa; la RLS decide qué filas lee la persona; el servidor vuelve a derivar TODO (relación, montos, adjuntos) de la base.
const ROLES = ["superadmin", "gerencia", "administracion", "operaciones"] as const;
type Contexto = { ok: false; error: string } | { ok: true; sb: Awaited<ReturnType<typeof createClient>>; userId: string; tenant: string };
export type VistaPreviaPago =
  | { ok: true; asunto: string; html: string; texto: string; totales: { moneda: string; total: number; equivalenteCop: number | null }[]; yaAvisados: number[] }
  | { ok: false; error: string };
type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

async function contexto(): Promise<Contexto> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión de nuevo." };
  const { data: rol } = await sb.rpc("mi_rol");
  if (!rol || !(ROLES as readonly string[]).includes(rol)) return { ok: false, error: "No tienes permiso para avisar pagos a proveedores." };
  return { ok: true, sb, userId: user.id, tenant: await getTenant() };
}

export async function pagosDelProveedor(proveedor: string): Promise<{ ok: true; pagos: PagoListado[] } | { ok: false; error: string }> {
  const c = await contexto(); if (!c.ok) return c;
  return { ok: true, pagos: await listarPagosDeProveedor(c.sb, c.tenant, proveedor) };
}

const FIRMAS: { tipo: string; ext: string; firma: number[] }[] = [
  { tipo: "application/pdf", ext: "pdf", firma: [0x25, 0x50, 0x44, 0x46] },
  { tipo: "image/png", ext: "png", firma: [0x89, 0x50, 0x4e, 0x47] },
  { tipo: "image/jpeg", ext: "jpg", firma: [0xff, 0xd8, 0xff] },
];
const limpiarNombre = (n: string): string => n.replace(/[\\/\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 200) || "soporte";
const slug = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "proveedor";

/** Uploads ONE evidence file and links it to the selected payments (all of the same supplier and agency). It does not touch the payments. */
export async function subirSoportePago(formData: FormData): Promise<Resultado> {
  const c = await contexto(); if (!c.ok) return c;
  const archivo = formData.get("archivo");
  let pagoIds: number[] = [];
  try { pagoIds = (JSON.parse(String(formData.get("pagoIds") ?? "[]")) as unknown[]).map(Number); } catch { /* handled below */ }
  pagoIds = [...new Set(pagoIds)];
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: "Elige un archivo." };
  if (!pagoIds.length || pagoIds.length > 50 || pagoIds.some((n) => !Number.isInteger(n) || n <= 0)) return { ok: false, error: "Elige los pagos que respalda el archivo." };
  if (archivo.size > MAX_ARCHIVO_BYTES) return { ok: false, error: "El archivo supera 5 MB." };
  const bytes = Buffer.from(await archivo.arrayBuffer());
  const tipo = FIRMAS.find((f) => f.firma.every((b, i) => bytes[i] === b));   // by CONTENT, not by the name or the type the browser declared
  if (!tipo) return { ok: false, error: "Solo se aceptan PDF, JPG o PNG." };
  // Every selected payment must be visible to the person, of this agency and of ONE supplier.
  const { data: pagos } = await c.sb.from("cxp_pagos").select("id, cuenta_por_pagar_id, tenant").in("id", pagoIds);
  if ((pagos ?? []).length !== pagoIds.length || pagos!.some((p) => p.tenant !== c.tenant)) return { ok: false, error: "Alguno de los pagos no existe, no es de esta agencia o no tienes acceso." };
  const { data: cxps } = await c.sb.from("cuentas_por_pagar").select("id, proveedor, tenant").in("id", [...new Set(pagos!.map((p) => p.cuenta_por_pagar_id))]);
  const proveedores = new Set((cxps ?? []).map((x) => x.proveedor ?? ""));
  if (proveedores.size !== 1 || [...proveedores][0] === "" || (cxps ?? []).some((x) => x.tenant !== c.tenant)) return { ok: false, error: "Todos los pagos del archivo deben ser del mismo proveedor." };
  const admin = createAdminClient();
  const path = `${c.tenant}/${slug([...proveedores][0])}/${randomUUID()}.${tipo.ext}`;
  const sube = await admin.storage.from(BUCKET_SOPORTES).upload(path, bytes, { contentType: tipo.tipo, upsert: false });
  if (sube.error) return { ok: false, error: "No se pudo guardar el archivo. Intenta de nuevo." };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { error } = await admin.from("cxp_pago_soportes").insert(pagoIds.map((id) => ({ cxp_pago_id: id, tenant: c.tenant, nombre: limpiarNombre(archivo.name), path, content_type: tipo.tipo, size_bytes: bytes.length, sha256, subido_por: c.userId })));
  if (error) { await admin.storage.from(BUCKET_SOPORTES).remove([path]); return { ok: false, error: "No se pudo registrar el archivo. Intenta de nuevo." }; }
  revalidatePath("/dashboard/pagos/avisos");
  return { ok: true, mensaje: "Soporte guardado. Aún no se ha enviado nada al proveedor." };
}

type EntradaAviso = { proveedor: string; pagoIds: number[]; soporteIds: number[]; referencia: string; /** Optional note for THIS send (H103-13), validated here. */ mensaje?: string | null };
const refLimpia = (r: string): string | null => { const t = r.replace(/[\r\n]+/g, " ").trim(); return t ? t.slice(0, 120) : null; };

async function armar(c: Extract<Contexto, { ok: true }>, e: EntradaAviso) {
  const lin = await cargarLineasPago(c.sb, c.tenant, e.proveedor, e.pagoIds);
  if (!lin.ok) return lin;
  const adj = await cargarAdjuntosPago(c.sb, createAdminClient(), c.tenant, lin.lineas.map((l) => l.pagoId), e.soporteIds);
  if (!adj.ok) return adj;
  const ref = refLimpia(e.referencia);
  const msj = limpiarMensajeAdicional(e.mensaje);
  if (!msj.ok) return msj;
  const correo = armarAvisoPago(e.proveedor, ref, lin.lineas, adj.adjuntos, msj.v);
  return { ok: true as const, lineas: lin.lineas, adjuntos: adj.adjuntos, ref, correo, mensaje: msj.v };
}

export async function previsualizarAvisoPago(e: EntradaAviso): Promise<VistaPreviaPago> {
  const c = await contexto(); if (!c.ok) return c;
  const a = await armar(c, e); if (!a.ok) return a;
  const { data: ya } = await c.sb.from("solicitud_proveedor_pagos").select("cxp_pago_id").in("cxp_pago_id", a.lineas.map((l) => l.pagoId));
  return { ok: true, asunto: a.correo.asunto, html: a.correo.html, texto: a.correo.texto, totales: a.correo.totales, yaAvisados: [...new Set((ya ?? []).map((x) => x.cxp_pago_id))] };
}

export async function enviarAvisoPago(e: EntradaAviso & { destinatarios: string; reenviar?: boolean }): Promise<Resultado> {
  const cfg = configCorreo(); if (!cfg.ok) return { ok: false, error: cfg.error };
  const d = validarDestinatarios(e.destinatarios); if (!d.ok) return { ok: false, error: d.error };
  const c = await contexto(); if (!c.ok) return c;
  const a = await armar(c, e); if (!a.ok) return a;
  const r = await enviarSolicitud(
    { admin: createAdminClient(), transporte: transporteDeConfig(cfg.config), config: cfg.config },
    {
      tipo: "pago", numero: null, contratoUid: null, tenant: c.tenant, proveedor: e.proveedor, destinatarios: d.destinatarios, referencia: a.ref, pagoIds: a.lineas.map((l) => l.pagoId),
      // The idempotency content is ONLY what identifies the notice: the payments (their own facts), the evidence hashes, the reference. Derived mutable values (cumulative paid, obligation total) are NOT part of it:
      // a later installment must not turn the same notice into a new request. The e-mail as sent is frozen in the stored payload.
      contenido: { proveedor: e.proveedor, referencia: a.ref, lineas: a.lineas.map((l) => ({ pagoId: l.pagoId, numeroContrato: l.numeroContrato, fecha: l.fecha, valor: l.valor, moneda: l.moneda, trm: l.trm })), adjuntos: a.adjuntos.map((x) => ({ nombre: x.nombre, bytes: x.bytes, sha256: x.sha256 })), ...(a.mensaje ? { mensaje: a.mensaje } : {}) } as unknown as Json,
      adjuntosRef: a.adjuntos.map((x) => ({ soporteId: x.soporteId, nombre: x.nombre, sha256: x.sha256, contentType: x.adjunto.contentType, bytes: x.bytes })),
      correo: { asunto: a.correo.asunto, html: a.correo.html, texto: a.correo.texto, adjuntos: a.correo.adjuntos }, creadoPor: c.userId, reenviar: e.reenviar,
    },
  );
  if (!r.ok) return r;
  revalidatePath("/dashboard/pagos/avisos");
  return { ok: true, mensaje: r.yaEnviada ? "Este aviso ya había sido enviado a esos correos con ese contenido; no se envió de nuevo." : "Aviso enviado. El pago NO cambia: aquí verás cuándo lo recibe el proveedor y si responde." };
}

/** RETRY of a persisted notice BY ID: re-sends its frozen message (original lines, amounts, recipients, evidence hashes) — never a rebuild from current payments. Bounded by the provider's idempotency window. */
export async function reintentarAvisoPago(solicitudId: number): Promise<Resultado> {
  const cfg = configCorreo(); if (!cfg.ok) return { ok: false, error: cfg.error };
  const c = await contexto(); if (!c.ok) return c;
  const { data: s } = await c.sb.from("solicitudes_proveedor").select("id, tenant, tipo").eq("id", solicitudId).maybeSingle();
  if (!s || s.tipo !== "pago" || s.tenant !== c.tenant) return { ok: false, error: "No se encontró el aviso." };
  const admin = createAdminClient();
  const r = await reintentarEnvio({ admin, transporte: transporteDeConfig(cfg.config), config: cfg.config, hidratarAdjuntos: hidratarAdjuntosPago(admin, c.tenant) }, solicitudId);
  if (!r.ok) return r;
  revalidatePath("/dashboard/pagos/avisos");
  return { ok: true, mensaje: r.yaEnviada ? "Este aviso ya había sido enviado; no se envió de nuevo." : "Aviso reenviado (el mensaje original). El pago NO cambia." };
}
