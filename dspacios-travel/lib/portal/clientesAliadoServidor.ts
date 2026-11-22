/**
 * #76/#77 — «Mis clientes» (servidor). Lecturas y escrituras con service-role, así que LA AUTORIZACIÓN ES CÓDIGO:
 *   · el aliado sale SIEMPRE de la sesión (usuario → `usuarios.aliado_id`); ningún parámetro del cliente elige ficha;
 *   · toda lectura/escritura lleva `aliado_id = <ficha de la sesión>` (clave de aislamiento entre aliados);
 *   · lo derivado se ata a ids explícitos (ventas.aliado_id, b2b_usuario_id, plan B2B congelado, cotizaciones.aliado_id, correo del propio usuario):
 *     jamás por nombre de aliado, y los contratos antiguos sin vínculo NO se reasignan por inferencia.
 * Lecturas completas y paginadas (`leerTodoConConteo`): ante cualquier anomalía devuelven `ok:false` y NINGÚN cliente (la pantalla avisa en vez de decir «no tienes»).
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import {
  combinarClientes, validarCliente, type ClienteGuardado, type ClienteVista, type ContratoCliente, type CotizacionCliente, type EntradaCliente,
} from "@/lib/portal/clientesAliado";

// Sintaxis de método (bivariante): acepta el cliente tipado de Supabase.
export type AdminClientes = { from(tabla: string): any };

/** Qué pertenece a un aliado: su ficha + sus usuarios (ids y correos). `tenants` null = sin filtro (el aliado ve lo suyo en ambas agencias). */
export type AmbitoClientes = { aliadoId: number; userIds: string[]; emails: string[]; tenants: string[] | null };

const COL_VENTA = "numero_contrato, cliente, destino, fecha_salida, estado, fecha_venta";
const COL_COT = "id, codigo, cliente, destino, fecha_salida, estado, modo, created_at";
const COL_GUARDADO = "id, nombre, clave, tipo_documento, documento, email, telefono, notas, actualizado_en";

type Pagina<T> = PromiseLike<PaginaConConteo<T>>;
async function todo<T>(consulta: (d: number, h: number) => Pagina<T>, valida: (f: T) => boolean): Promise<T[] | null> {
  const r = await leerTodoConConteo<T>(consulta, PAGINA_FILAS, valida);
  return r.completa ? r.filas : null;
}

export type LecturaClientes = { ok: true; clientes: ClienteVista[] } | { ok: false };

export async function leerClientesAliado(admin: AdminClientes, a: AmbitoClientes): Promise<LecturaClientes> {
  try {
    const ten = (q: any) => (a.tenants ? q.in("tenant", a.tenants) : q);
    const guardados = await todo<ClienteGuardado>((d, h) =>
      ten(admin.from("aliado_clientes").select(COL_GUARDADO, { count: "exact" }).eq("aliado_id", a.aliadoId)).order("id", { ascending: true }).range(d, h), (f) => typeof f?.id === "number");

    if (!guardados) return { ok: false };
    const contratos = new Map<string, ContratoCliente>();
    const ventasQ: ((d: number, h: number) => Pagina<ContratoCliente>)[] = [
      (d, h) => ten(admin.from("ventas").select(COL_VENTA, { count: "exact" }).eq("aliado_id", a.aliadoId)).order("numero_contrato", { ascending: true }).range(d, h),
    ];
    if (a.userIds.length) ventasQ.push((d, h) => ten(admin.from("ventas").select(COL_VENTA, { count: "exact" }).in("b2b_usuario_id", a.userIds)).order("numero_contrato", { ascending: true }).range(d, h));
    for (const q of ventasQ) {
      const filas = await todo<ContratoCliente>(q, (f) => typeof f?.numero_contrato === "string");
      if (!filas) return { ok: false };
      for (const f of filas) contratos.set(f.numero_contrato, f);
    }

    const cots = new Map<number, CotizacionCliente & { modo?: string | null }>();
    const cotQ: ((d: number, h: number) => Pagina<CotizacionCliente & { modo?: string | null }>)[] = [
      (d, h) => ten(admin.from("cotizaciones").select(COL_COT, { count: "exact" }).eq("payload->b2bAsistido->>aliado_id", String(a.aliadoId))).order("id", { ascending: true }).range(d, h),
      (d, h) => ten(admin.from("cotizaciones").select(COL_COT, { count: "exact" }).eq("aliado_id", a.aliadoId)).order("id", { ascending: true }).range(d, h),
    ];
    if (a.emails.length) cotQ.push((d, h) => ten(admin.from("cotizaciones").select(COL_COT, { count: "exact" }).in("creado_por", a.emails)).order("id", { ascending: true }).range(d, h));
    for (const q of cotQ) {
      const filas = await todo(q, (f) => typeof f?.id === "number");
      if (!filas) return { ok: false };
      for (const f of filas) if (f.estado !== "descartada") cots.set(f.id, f);
    }
    return { ok: true, clientes: combinarClientes(guardados, [...contratos.values()], [...cots.values()]) };
  } catch {
    return { ok: false };
  }
}

/** Ámbito del aliado de una sesión del portal: su ficha, su usuario y su correo. */
export function ambitoDeSesion(ctx: { aliadoId: number | null; userId: string; email: string | null }): AmbitoClientes | null {
  if (ctx.aliadoId == null) return null;
  return { aliadoId: ctx.aliadoId, userIds: [ctx.userId], emails: ctx.email ? [ctx.email] : [], tenants: null };
}

/** Ámbito de un aliado visto por personal interno: los usuarios de esa ficha (1 lectura acotada) y las agencias que el actor puede ver. */
export async function ambitoDeAliado(admin: AdminClientes, aliadoId: number, tenants: string[] | null): Promise<AmbitoClientes | null> {
  const r = await admin.from("usuarios").select("id, email").eq("aliado_id", aliadoId).in("rol", ["agencia", "freelance"]).limit(200);
  if (r.error || !Array.isArray(r.data)) return null;
  const filas = r.data as { id: string; email: string | null }[];
  return { aliadoId, userIds: filas.map((u) => u.id), emails: filas.map((u) => u.email).filter((e): e is string => !!e), tenants };
}

export type SesionEscritura = { userId: string; aliadoId: number | null; agenciaId: string | null; tenant: string | null };
export type RespuestaCliente = { ok: true; id: number } | { ok: false; error: string };

const NO_AUTORIZADO = "Tu cuenta no puede guardar clientes todavía. Pide a D'spacios que enlace tu usuario a tu ficha de aliado.";
const DUPLICADO = "Ya tienes un cliente guardado con ese nombre.";
const CONFLICTO = "Este cliente cambió mientras lo editabas o ya no existe. Recarga la página e inténtalo de nuevo.";
const ERROR_GENERAL = "No se pudo guardar. Intenta de nuevo.";

/** Crea (sin `id`) o edita (con `id` y la versión `esperado` = `actualizado_en` que vio el usuario) un cliente de la libreta DEL ALIADO DE LA SESIÓN. */
export async function guardarClienteAliado(
  admin: AdminClientes, s: SesionEscritura, entrada: EntradaCliente & { id?: unknown; esperado?: unknown }
): Promise<RespuestaCliente> {
  // Un agente de agencia (agencia_id) lee, pero la libreta la administra el titular o el freelance.
  if (s.aliadoId == null || s.agenciaId) return { ok: false, error: NO_AUTORIZADO };
  const v = validarCliente(entrada);
  if (!v.ok) return v;
  const base = { ...v.valor, autorizacion_datos: true, actualizado_por: s.userId, actualizado_en: new Date().toISOString() };
  try {
    if (entrada.id === undefined || entrada.id === null) {
      const r = await admin.from("aliado_clientes")
        .insert({ ...base, aliado_id: s.aliadoId, tenant: s.tenant === "minorista" ? "minorista" : "mayorista", creado_por: s.userId })
        .select("id").single();
      if (r.error) return { ok: false, error: r.error.code === "23505" ? DUPLICADO : ERROR_GENERAL };
      return { ok: true, id: (r.data as { id: number }).id };
    }
    const id = Number(entrada.id);
    if (!Number.isInteger(id) || id < 1 || typeof entrada.esperado !== "string") return { ok: false, error: CONFLICTO };
    // `aliado_id` en el filtro: aunque el cliente mande el id de un cliente AJENO, no coincide ninguna fila.
    const r = await admin.from("aliado_clientes").update(base)
      .eq("id", id).eq("aliado_id", s.aliadoId).eq("actualizado_en", entrada.esperado).select("id");
    if (r.error) return { ok: false, error: r.error.code === "23505" ? DUPLICADO : ERROR_GENERAL };
    if (!Array.isArray(r.data) || r.data.length !== 1) return { ok: false, error: CONFLICTO };
    return { ok: true, id };
  } catch {
    return { ok: false, error: ERROR_GENERAL };
  }
}
