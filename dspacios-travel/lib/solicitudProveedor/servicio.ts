// #103 — supplier service request service layer: send once, record events once, notify once. Dependencies are injected (admin client, transport, config) so the same code runs against
// the real database with a LOCAL capture transport in tests and in the Server Action / webhook route in the app. No secrets, no provider calls other than through `transporte`.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { claveEnvio, direccionRespuesta, generarToken, type EventoNormalizado, type EstadoSolicitud } from "./nucleo.ts";
import type { Adjunto, ConfigCorreo, Transporte } from "./transporte.ts";
import { esErrorIdentidad, MENSAJE_IDENTIDAD } from "../contrato/identidad.ts";

type Admin = SupabaseClient<Database>;
type Fila = Database["public"]["Tables"]["solicitudes_proveedor"]["Row"];

/** The e-mail exactly as it will leave (built by documento.ts / avisoPago.ts from persisted data). */
export type CorreoSaliente = { asunto: string; html: string; texto: string; adjuntos?: Adjunto[] };
export type EntradaEnvio = {
  /** solicitud = request of ONE contract (needs numero + contratoUid); pago = payment notice (may relate several contracts). */
  tipo: "solicitud" | "pago";
  numero: string | null; contratoUid: string | null; tenant: string; proveedor: string | null;
  /** The structured data the e-mail was built from: hashed into the idempotency key and stored as the snapshot. */ contenido: unknown;
  destinatarios: string[]; correo: CorreoSaliente;
  hotelId?: number | null; codigo?: { codigoId: number; texto: string; promocion: string } | null; sinPromocion?: boolean; referencia?: string | null;
  /** Payments a notice reports (cxp_pagos ids): stored in the frozen payload and linked (checked) BEFORE sending. */ pagoIds?: number[];
  /** Evidence files of a notice as REFERENCES (the bytes travel in `correo.adjuntos` for this first send; a retry re-reads and hash-checks them). */ adjuntosRef?: PayloadGuardado["adjuntos"];
  creadoPor: string | null; reenviar?: boolean;
};
export type ResultadoEnvioSolicitud = { ok: true; id: number; estado: EstadoSolicitud; yaEnviada: boolean } | { ok: false; error: string };

/** Un reclamo `enviando` más viejo que esto se presume de un trabajador muerto (la llamada al proveedor tiene su propio tope de 20 s: transporte.ts → TIEMPO_LLAMADA_MS). */
export const ARRENDAMIENTO_SEG = 120;

async function leerPorClave(admin: Admin, clave: string): Promise<Fila | null> {
  const { data } = await admin.from("solicitudes_proveedor").select("*").eq("clave_envio", clave).maybeSingle();
  return data ?? null;
}

type ArgsEvento = { p_solicitud: number; p_tipo: string; p_dedupe: string; p_externo: string | null; p_resumen: Json; p_avisar: string[] | null };
/** El dedupe de un intento es DETERMINISTA (tipo + solicitud + n.º de intento): repetir el registro tras un fallo de red guarda el evento UNA sola vez. */
async function registrarConReintentos(admin: Admin, args: ArgsEvento, veces = 3) {
  let ultimo = await admin.rpc("registrar_evento_solicitud_proveedor", args);
  for (let i = 1; i < veces && ultimo.error; i++) ultimo = await admin.rpc("registrar_evento_solicitud_proveedor", args);
  return ultimo;
}

const MSG_INCIERTA = "No se sabe si el correo de esta solicitud salió (el envío anterior se interrumpió). No se reenvía solo para no duplicar el mensaje al proveedor: revisa con el proveedor o usa «Reenviar» si decides enviarlo de nuevo.";
const MSG_VENTANA = "El proveedor de correo ya no puede garantizar que un reintento no duplique el mensaje (pasó la ventana de seguridad y un intento anterior pudo haber salido). No se reintenta solo: revisa con el proveedor o crea una versión nueva con «Reenviar como nueva».";

/** What a retry re-sends: the message FROZEN when the request was created. Attachments are referenced (re-read and hash-checked by `hidratarAdjuntos`), never rebuilt from current data. */
export type PayloadGuardado = { html: string; texto: string; adjuntos: { soporteId: number; nombre: string; sha256: string; contentType: string; bytes: number }[]; pagoIds: number[] };
export type HidratarAdjuntos = (refs: PayloadGuardado["adjuntos"]) => Promise<{ ok: true; adjuntos: Adjunto[] } | { ok: false; error: string }>;
const leerPayload = (j: Json): PayloadGuardado | null => {
  const p = (j ?? {}) as Record<string, unknown>;
  if (typeof p.html !== "string" || typeof p.texto !== "string") return null;
  return { html: p.html, texto: p.texto, adjuntos: Array.isArray(p.adjuntos) ? (p.adjuntos as PayloadGuardado["adjuntos"]) : [], pagoIds: Array.isArray(p.pagoIds) ? (p.pagoIds as number[]).filter((x) => Number.isInteger(x)) : [] };
};

type DepsEnvio = { admin: Admin; transporte: Transporte; config: ConfigCorreo; ahora?: () => number };

/** Links a payment notice to the payments it reports. Checked, idempotent, and run BEFORE anything leaves: a failure here means nothing was sent and a retry can repair it. */
async function vincularPagos(admin: Admin, solicitudId: number, pagoIds: number[]): Promise<boolean> {
  if (!pagoIds.length) return true;
  const { error } = await admin.from("solicitud_proveedor_pagos").upsert(pagoIds.map((id) => ({ solicitud_id: solicitudId, cxp_pago_id: id })), { onConflict: "solicitud_id,cxp_pago_id", ignoreDuplicates: true });
  return !error;
}

/** Sends the FROZEN message of an already-claimed row and records the outcome (one event per real attempt, deterministic key, a few retries). */
async function ejecutarEnvio(deps: DepsEnvio, fila: Fila, intento: number, p: PayloadGuardado, adjuntos: Adjunto[]): Promise<ResultadoEnvioSolicitud> {
  const { admin, transporte, config } = deps;
  const ev = (tipo: string, extra: { externo?: string | null; resumen?: Json } = {}): ArgsEvento =>
    ({ p_solicitud: fila.id, p_tipo: tipo, p_dedupe: `${tipo}:${fila.id}:${intento}`, p_externo: extra.externo ?? null, p_resumen: extra.resumen ?? ({} as Json), p_avisar: null });
  const r = await transporte.enviar({
    de: config.remitente, para: fila.destinatarios, responderA: direccionRespuesta(config.responderA, fila.token_respuesta), asunto: fila.asunto,
    html: p.html, texto: p.texto, adjuntos: adjuntos.length ? adjuntos : undefined, claveIdempotencia: fila.clave_envio,
  });
  if (r.ok) {
    const registrado = await registrarConReintentos(admin, ev("envio", { externo: r.mensajeId }));
    if (registrado.error) {
      // The mail left but the record failed: the claim stays `enviando`; after its lease the retry reconciles through the provider's idempotency (same key → same message, inside its window) or marks it uncertain. Never a blind resend.
      console.error("solicitudProveedor: el correo salió pero no se pudo registrar el estado:", registrado.error.message);
      return { ok: false, error: "El correo salió, pero no se pudo registrar el estado. No lo reenvíes: vuelve a abrir esta solicitud en unos minutos y se conciliará sola." };
    }
    return { ok: true, id: fila.id, estado: (registrado.data?.[0]?.estado_nuevo as EstadoSolicitud | undefined) ?? "enviada", yaEnviada: false };
  }
  // Failure. Certain (4xx) → fallida, known unsent. Ambiguous → remembered (`ambiguo`): idempotent provider → fallida (retry bounded by its window), otherwise incierta.
  const sinSaber = !!r.incierto && !transporte.idempotente;
  await registrarConReintentos(admin, sinSaber ? ev("envio_incierto", { resumen: { error: r.error } as Json }) : ev("error_envio", { resumen: { error: r.error, ambiguo: !!r.incierto } as Json }));
  return { ok: false, error: sinSaber ? MSG_INCIERTA : `No se pudo enviar el correo: ${r.error}` };
}

/**
 * NEW request. The UNIQUE `clave_envio` decides who sends: a double click / concurrent request finds the row instead of creating another send. An identical request that already exists is NEVER re-driven from here
 * (that would rebuild the message from current data): its state is reported and, if it is pending/failed, the person uses `reintentarEnvio` on THAT request.
 * The frozen message is stored with the row, the payment links (notices) are written and checked BEFORE sending.
 */
export async function enviarSolicitud(deps: DepsEnvio, e: EntradaEnvio): Promise<ResultadoEnvioSolicitud> {
  const { admin } = deps;
  const ancla = e.numero ?? `pago:${e.tenant}:${e.proveedor ?? ""}`;
  const base = claveEnvio({ voucherId: null, numero: ancla, destinatarios: e.destinatarios, contenido: e.contenido, version: 1 });
  let version = 1;
  if (e.reenviar) {
    const { data } = await admin.from("solicitudes_proveedor").select("clave_envio").like("clave_envio", `${base.split(":")[0]}:v%`);
    version = Math.max(1, ...(data ?? []).map((r) => Number(r.clave_envio.split(":v")[1]) || 1)) + 1;
  }
  const clave = claveEnvio({ voucherId: null, numero: ancla, destinatarios: e.destinatarios, contenido: e.contenido, version });
  const payload: PayloadGuardado = { html: e.correo.html, texto: e.correo.texto, adjuntos: e.adjuntosRef ?? [], pagoIds: e.pagoIds ?? [] };
  const ins = await admin.from("solicitudes_proveedor").insert({
    tipo: e.tipo, tenant: e.tenant, numero_contrato: e.numero, contrato_uid: e.contratoUid, hotel_id: e.hotelId ?? null, codigo_id: e.codigo?.codigoId ?? null, codigo_texto: e.codigo?.texto ?? null, codigo_promocion: e.codigo?.promocion ?? null,
    sin_promocion: !!e.sinPromocion, referencia: e.referencia ?? null, snapshot: e.contenido as Json, payload: payload as unknown as Json, proveedor: e.proveedor, destinatarios: e.destinatarios, asunto: e.correo.asunto, token_respuesta: generarToken(), clave_envio: clave, creado_por: e.creadoPor,
  }).select("*").maybeSingle();
  if (!ins.data) {
    if (ins.error?.code === "23505") {
      const { data: previa } = await admin.from("solicitudes_proveedor").select("*").eq("clave_envio", clave).maybeSingle();
      if (!previa) return { ok: false, error: "No se pudo registrar la solicitud. Intenta de nuevo." };
      if (previa.estado === "incierta") return { ok: false, error: MSG_INCIERTA };
      if (previa.estado === "enviando") return { ok: false, error: "Esta solicitud ya se está enviando." };
      if (previa.estado === "fallida") return { ok: false, error: `Ya existe una solicitud idéntica (n.º ${previa.id}) cuyo envío falló. Usa «Reintentar envío» sobre ella: se reenvía el mensaje original, no uno nuevo.` };
      return { ok: true, id: previa.id, estado: previa.estado, yaEnviada: true };
    }
    if (ins.error && esErrorIdentidad(ins.error)) return { ok: false, error: MENSAJE_IDENTIDAD };
    if (ins.error?.message?.includes("CODIGO_PROMOCION")) return { ok: false, error: "El código de promoción no corresponde a la configuración actual del hotel. Recarga y vuelve a elegirlo." };
    return { ok: false, error: "No se pudo registrar la solicitud. Intenta de nuevo." };
  }
  const fila = ins.data;
  if (!(await vincularPagos(admin, fila.id, payload.pagoIds))) {
    await registrarConReintentos(admin, { p_solicitud: fila.id, p_tipo: "error_envio", p_dedupe: `error_envio:${fila.id}:1`, p_externo: null, p_resumen: { error: "no se pudieron registrar los pagos del aviso", ambiguo: false } as Json, p_avisar: null });
    return { ok: false, error: `No se pudo registrar qué pagos reporta el aviso; no se envió nada. Usa «Reintentar envío» (aviso n.º ${fila.id}).` };
  }
  return ejecutarEnvio(deps, fila, 1, payload, e.correo.adjuntos ?? []);
}

/**
 * RETRY of an existing request BY ID: re-sends its frozen message with its own key and recipients — never a rebuild from the current contract/payments/code choice.
 *  · one caller takes over (compare-and-swap, database clock); a live claim is respected;
 *  · if any earlier attempt MAY have reached the provider (`enviando` expired, or `ambiguo`), a retry is allowed only inside the provider's idempotency window (`created_at` + window, a conservative start);
 *    outside it — or with a provider that does not deduplicate — the request becomes `incierta` and only an explicit «Reenviar como nueva» can send again.
 */
export async function reintentarEnvio(deps: DepsEnvio & { hidratarAdjuntos?: HidratarAdjuntos }, solicitudId: number): Promise<ResultadoEnvioSolicitud> {
  const { admin, transporte } = deps;
  const ahora = deps.ahora ?? Date.now;
  const { data: previa } = await admin.from("solicitudes_proveedor").select("*").eq("id", solicitudId).maybeSingle();
  if (!previa) return { ok: false, error: "No se encontró la solicitud." };
  if (previa.estado === "incierta") return { ok: false, error: MSG_INCIERTA };
  if (previa.estado !== "enviando" && previa.estado !== "fallida") return { ok: true, id: previa.id, estado: previa.estado, yaEnviada: true };
  const p = leerPayload(previa.payload);
  if (!p) return { ok: false, error: "Esta solicitud no guardó su mensaje original; crea una versión nueva con «Reenviar como nueva»." };
  const { data: n, error: errReclamo } = await admin.rpc("reclamar_envio_solicitud_proveedor", { p_solicitud: previa.id, p_estado_visto: previa.estado, p_visto: previa.envio_iniciado_en, p_segundos: ARRENDAMIENTO_SEG });
  if (errReclamo) return { ok: false, error: "No se pudo registrar la solicitud. Intenta de nuevo." };
  if (!n || n < 1) return { ok: false, error: "Esta solicitud ya se está enviando." };
  const intento = n;
  const fila: Fila = { ...previa, estado: "enviando", intentos: n };
  const ev = (tipo: string, resumen: Json): ArgsEvento => ({ p_solicitud: fila.id, p_tipo: tipo, p_dedupe: `${tipo}:${fila.id}:${intento}`, p_externo: null, p_resumen: resumen, p_avisar: null });
  // an earlier attempt may have gone out → only inside the provider's deduplication window
  if (previa.estado === "enviando" || previa.ambiguo) {
    const dentro = transporte.idempotente && ahora() - Date.parse(previa.created_at) < transporte.ventanaIdempotenciaMs;
    if (!dentro) {
      await registrarConReintentos(admin, ev("envio_incierto", { error: "un intento anterior pudo salir y ya no se puede comprobar con el proveedor" } as Json));
      return { ok: false, error: previa.estado === "enviando" ? MSG_INCIERTA : MSG_VENTANA };
    }
  }
  // nothing leaves until the payment links and the evidence are consistent; these failures are CLEAR (nothing was sent by this attempt)
  const falla = async (msg: string) => { await registrarConReintentos(admin, ev("error_envio", { error: msg, ambiguo: false } as Json)); return { ok: false as const, error: msg }; };
  if (previa.tipo === "pago" && !(await vincularPagos(admin, previa.id, p.pagoIds))) return falla("No se pudo registrar qué pagos reporta el aviso; no se envió nada. Intenta de nuevo.");
  let adjuntos: Adjunto[] = [];
  if (p.adjuntos.length) {
    if (!deps.hidratarAdjuntos) return falla("No se pudieron leer los soportes del aviso.");
    const h = await deps.hidratarAdjuntos(p.adjuntos);
    if (!h.ok) return falla(h.error);
    adjuntos = h.adjuntos;
  }
  return ejecutarEnvio(deps, fila, intento, p, adjuntos);
}

export type ResultadoWebhook = { ok: true; ignorado: true } | { ok: true; ignorado: false; nuevo: boolean; estado: string | null; solicitudId: number };

/** Applies one normalised provider event. Unknown token / message → ignored (200, nothing stored, nothing revealed). Duplicate delivery → stored once, notifies once. */
export async function procesarEvento(
  deps: { admin: Admin; usuariosAvisar: (s: Fila) => Promise<string[]>; notificarInterno?: (s: Fila, e: EventoNormalizado) => Promise<void> },
  ev: EventoNormalizado,
): Promise<ResultadoWebhook> {
  const { admin } = deps;
  let sol: Fila | null = null;
  if (ev.token) sol = (await admin.from("solicitudes_proveedor").select("*").eq("token_respuesta", ev.token).maybeSingle()).data ?? null;
  // `mensaje_id` holds the PROVIDER's email id: an RFC Message-ID (another namespace) is never matched against it.
  const ref = ev.espacio === "rfc822" ? null : (ev.enRespuestaA ?? ev.externoId);
  if (!sol && ref) sol = (await admin.from("solicitudes_proveedor").select("*").eq("mensaje_id", ref.replace(/^<|>$/g, "")).maybeSingle()).data ?? null;
  if (!sol) return { ok: true, ignorado: true };
  const avisar = ev.tipo === "respuesta" ? await deps.usuariosAvisar(sol) : null;
  const { data, error } = await admin.rpc("registrar_evento_solicitud_proveedor", { p_solicitud: sol.id, p_tipo: ev.tipo, p_dedupe: ev.dedupe, p_externo: ev.externoId, p_resumen: ev.resumen as Json, p_avisar: avisar });
  if (error) throw new Error(`registrar_evento_solicitud_proveedor: ${error.message}`);
  const fila = data?.[0];
  if (fila?.nuevo && ev.tipo === "respuesta") { try { await deps.notificarInterno?.(sol, ev); } catch (e) { console.error("solicitudProveedor: no se pudo avisar por correo:", e instanceof Error ? e.message : e); } }
  return { ok: true, ignorado: false, nuevo: !!fila?.nuevo, estado: fila?.estado_nuevo ?? null, solicitudId: sol.id };
}

/** Internal users who must see a reply: whoever created the request + the active `operaciones` users of its agency. (Recipient policy is an owner decision — Q5 — and lives only here.) */
export async function usuariosAvisarPorDefecto(admin: Admin, s: Fila): Promise<string[]> {
  const ids = new Set<string>();
  if (s.creado_por) ids.add(s.creado_por);
  const { data } = await admin.from("usuarios").select("id").eq("rol", "operaciones").eq("activo", true).eq("tenant", s.tenant);
  for (const u of data ?? []) ids.add(u.id);
  return [...ids];
}

/** Records the BUSINESS decision (confirmed / rejected) made by an internal user after reading the reply. Never inferred from the reply text. */
export async function registrarDecision(admin: Admin, id: number, resultado: "confirmacion" | "rechazo", usuarioId: string): Promise<{ ok: true; estado: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("registrar_evento_solicitud_proveedor", { p_solicitud: id, p_tipo: resultado, p_dedupe: `manual:${randomUUID()}`, p_externo: null, p_resumen: { por: usuarioId } as Json, p_avisar: null });
  if (error) return { ok: false, error: esErrorIdentidad(error) ? MENSAJE_IDENTIDAD : "No se pudo registrar la decisión. Intenta de nuevo." };
  const f = data?.[0];
  if (!f || f.estado_nuevo == null) return { ok: false, error: "La solicitud ya no existe." };
  if (!["confirmada", "rechazada"].includes(f.estado_nuevo)) return { ok: false, error: "Solo se puede registrar la decisión de una solicitud ya enviada." };
  return { ok: true, estado: f.estado_nuevo };
}
