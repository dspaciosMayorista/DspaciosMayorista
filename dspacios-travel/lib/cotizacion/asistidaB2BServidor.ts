import type { createClient } from "@/lib/supabase/server";
import type { ModoCompra } from "@/lib/reservar/comisionReserva";
import {
  autorizarActorAsistenciaB2B, compararAliadoConCongelado, evaluarAliadoAsistencia, resolverPctB2B,
  type AliadoAsistencia, type EntradaAsistencia, type OrigenPctB2B, type PlanB2BCotizacion, type RolAsistenciaB2B, type TipoAliadoB2B,
} from "@/lib/cotizacion/asistidaB2B";

// #102 — Resolución EN SERVIDOR de quién asiste y para quién. Todo sale de la sesión autenticada + `usuarios` + el catálogo
// `aliados`: del navegador solo llega la ELECCIÓN (id de aliado y modalidad). Se lee con el cliente de SESIÓN (la RLS sigue siendo
// una segunda barrera) — no hace falta service-role: los cinco roles autorizados leen `aliados` y `parametros_tributarios`.
type Sb = Awaited<ReturnType<typeof createClient>>;

export type ActorAsistencia = { id: string; email: string | null; rol: RolAsistenciaB2B; superadmin: boolean };
export type AliadoResuelto = AliadoAsistencia & { pct: number; pctOrigen: OrigenPctB2B };
export type ContextoAsistenciaB2B = { actor: ActorAsistencia; aliado: AliadoResuelto; modo: ModoCompra };
export type AliadoListado = { id: number; nombre: string; tipo: TipoAliadoB2B; pct: number; pctOrigen: OrigenPctB2B };

const ERROR_SESION = "Tu sesión no es válida. Vuelve a iniciar sesión.";
const ERROR_ESQUEMA_ACTIVO =
  "La base de datos todavía no tiene el estado activo de los aliados (migración 238); la venta B2B asistida no está disponible hasta aplicarla.";

const parametroDe = (tipo: TipoAliadoB2B) => (tipo === "agencia" ? "COMISION_AGENCIA" : "COMISION_FREELANCE");

/** Usuario de la sesión, activo, con rol de la lista explícita y agencia Mayorista (superadmin opera sobre cualquiera). */
export async function resolverActorAsistencia(sb: Sb): Promise<{ ok: true; actor: ActorAsistencia } | { ok: false; error: string }> {
  const { data: { user }, error: errUser } = await sb.auth.getUser();
  if (errUser || !user) return { ok: false, error: ERROR_SESION };
  const { data: perfil, error: errPerfil } = await sb.from("usuarios").select("rol, activo, tenant, email").eq("id", user.id).maybeSingle();
  if (errPerfil) return { ok: false, error: ERROR_SESION };
  const aut = autorizarActorAsistenciaB2B(perfil);
  if (!aut.ok) return aut;
  return { ok: true, actor: { id: user.id, email: perfil?.email ?? user.email ?? null, rol: aut.rol, superadmin: aut.superadmin } };
}

function errorLecturaAliados(e: { code?: string | null; message?: string | null } | null | undefined): string {
  if (e?.code === "42703" || /column .*activo/i.test(e?.message ?? "")) return ERROR_ESQUEMA_ACTIVO;
  return "No se pudo leer el catálogo de aliados. Intenta de nuevo en unos minutos.";
}

/**
 * El aliado elegido, tal como está HOY en el catálogo: existe, está activo, es agencia o freelance, y su % (propio, general o por
 * defecto). Si el aliado no tiene % propio y el parámetro general no se puede leer, no se adivina (la base lo recalcularía distinto).
 */
export async function resolverAliadoAsistencia(sb: Sb, aliadoId: number): Promise<{ ok: true; aliado: AliadoResuelto } | { ok: false; error: string }> {
  const { data: fila, error } = await sb.from("aliados").select("id, nombre, tipo, pct_comision, activo").eq("id", aliadoId).maybeSingle();
  if (error) return { ok: false, error: errorLecturaAliados(error) };
  const ev = evaluarAliadoAsistencia(fila);
  if (!ev.ok) return ev;
  let valorParametro: unknown = null;
  if (ev.aliado.pctAliado == null) {
    const { data: p, error: ep } = await sb.from("parametros_tributarios").select("valor").eq("parametro", parametroDe(ev.aliado.tipo)).maybeSingle();
    if (ep) return { ok: false, error: "No se pudo leer el porcentaje de comisión general; no se cotiza la venta B2B." };
    valorParametro = p?.valor ?? null;
  }
  const { pct, origen } = resolverPctB2B(ev.aliado.pctAliado, valorParametro, ev.aliado.tipo);
  return { ok: true, aliado: { ...ev.aliado, pct, pctOrigen: origen } };
}

/** Crear la cotización: actor autorizado + aliado válido + modalidad elegida. Se llama ANTES de crear nada. */
export async function prepararAsistenciaB2B(sb: Sb, entrada: EntradaAsistencia): Promise<{ ok: true; contexto: ContextoAsistenciaB2B } | { ok: false; error: string }> {
  const a = await resolverActorAsistencia(sb);
  if (!a.ok) return a;
  const al = await resolverAliadoAsistencia(sb, entrada.aliadoId);
  if (!al.ok) return al;
  return { ok: true, contexto: { actor: a.actor, aliado: al.aliado, modo: entrada.modo } };
}

/**
 * Selector del checkout para el personal que puede asistir: aliados ACTIVOS (agencia/freelance) con su % vigente y de dónde sale.
 * Un usuario sin permiso (aliado B2B, cliente, visitante) recibe `puede: false` y ninguna lista.
 */
export async function listarAliadosParaAsistencia(sb: Sb): Promise<{ ok: true; puede: false } | { ok: true; puede: true; aliados: AliadoListado[] } | { ok: false; error: string }> {
  const a = await resolverActorAsistencia(sb);
  if (!a.ok) return { ok: true, puede: false };
  const { data, error } = await sb.from("aliados").select("id, nombre, tipo, pct_comision, activo").eq("activo", true).in("tipo", ["agencia", "freelance"]).order("nombre");
  if (error) return { ok: false, error: errorLecturaAliados(error) };
  const { data: params, error: ep } = await sb.from("parametros_tributarios").select("parametro, valor").in("parametro", ["COMISION_AGENCIA", "COMISION_FREELANCE"]);
  if (ep) return { ok: false, error: "No se pudo leer el porcentaje de comisión general." };
  const valor = (p: string) => (params ?? []).find((x) => x.parametro === p)?.valor ?? null;
  const aliados: AliadoListado[] = [];
  for (const fila of data ?? []) {
    const ev = evaluarAliadoAsistencia(fila);
    if (!ev.ok) continue;
    const { pct, origen } = resolverPctB2B(ev.aliado.pctAliado, valor(parametroDe(ev.aliado.tipo)), ev.aliado.tipo);
    aliados.push({ id: ev.aliado.id, nombre: ev.aliado.nombre, tipo: ev.aliado.tipo, pct, pctOrigen: origen });
  }
  return { ok: true, puede: true, aliados };
}

/**
 * Convertir: el aliado y su % de HOY deben ser los congelados en la cotización. Rechaza (antes de numerar nada) si el aliado cambió,
 * se desactivó, cambió de tipo o cambió su porcentaje.
 */
export async function verificarAliadoVivoParaConversion(sb: Sb, plan: PlanB2BCotizacion): Promise<{ ok: true; aliado: AliadoResuelto } | { ok: false; error: string }> {
  const al = await resolverAliadoAsistencia(sb, plan.aliado_id);
  if (!al.ok) return al;
  const cmp = compararAliadoConCongelado(plan, { aliadoId: al.aliado.id, tipo: al.aliado.tipo, pct: al.aliado.pct });
  if (!cmp.ok) return cmp;
  return { ok: true, aliado: al.aliado };
}
