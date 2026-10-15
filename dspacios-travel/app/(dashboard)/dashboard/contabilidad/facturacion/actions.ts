"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { rpcFinanciero, type ErrorFinanciero } from "@/lib/contabilidad/asientos";
import { formatMoneda } from "@/lib/utils";
import { getTenant } from "@/lib/tenant.server";

type Result = { ok: true } | ErrorFinanciero;

// Roles que configuran la facturación — los mismos de la RLS de
// `contrato_facturacion` ("acceso contable") y de la pantalla.
const ROLES_FACTURACION = ["superadmin", "gerencia", "administracion"];

// ─────────────────────────────────────────────────────────────────────────
// #30 / 208: la factura se emite, cambia, retira o marca a la DIAN con UNA
// operación atómica en PostgreSQL (facturar_factura / quitar_factura /
// marcar_dian_factura). Ya no hay pasos sueltos que puedan quedar a medias
// (RACE-1 / COMP-1): o se hace todo, o no cambia nada.
//   · El total y el IRT los calcula la base (`ventas.precio_venta` — en NETO,
//     el total exigible — y las CxP marcadas IRT, en pesos); lo que manda el
//     formulario solo se compara (FACT-1).
//   · El actor sale de la SESIÓN (nunca del navegador) y la RPC lo revalida:
//     activo, rol contable y agencia. Se factura solo en la agencia ACTIVA y
//     solo un contrato de esa agencia (FACT-2).
//   · Abonos fuera de libros (históricos sin asiento): la emisión exige revisar
//     el aviso (hash de la fotografía) y deja una constancia atómica. No cambia
//     Cartera ni los libros de esos abonos.
// ─────────────────────────────────────────────────────────────────────────

type Contexto = { actor: string; tenant: string };

async function contextoFactura(numeroContrato: string): Promise<{ ok: true; ctx: Contexto } | ErrorFinanciero> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Sesión no válida." };
  const { data: perfil, error: eP } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (eP) return { ok: false, error: eP.message };
  if (!perfil || perfil.activo === false || !ROLES_FACTURACION.includes(perfil.rol as string)) {
    return { ok: false, error: "No autorizado para la facturación." };
  }
  const { data: venta, error: eV } = await sb.from("ventas").select("numero_contrato, tenant").eq("numero_contrato", numeroContrato).maybeSingle();
  if (eV) return { ok: false, error: eV.message };
  if (!venta) return { ok: false, error: "El contrato no existe o no tienes acceso." };
  const tenant = (venta.tenant as string | null) ?? "mayorista";
  const activa = await getTenant();
  if (tenant !== activa) {
    return { ok: false, error: `El contrato ${numeroContrato} es de la agencia ${tenant}; cambia a esa agencia para facturarlo.` };
  }
  return { ok: true, ctx: { actor: user.id, tenant } };
}

// ── Aviso de abonos fuera de libros ───────────────────────────────────────
type RespaldoSql = { calculable: boolean; respaldado?: number; sin_respaldo?: number; exceso?: number };
type AbonoSql = {
  id: number; fecha_abono: string | null; monto_cop: number | null; valor_abono: number | null; forma_pago: string | null;
  referencia: string | null; procedencia: "historico" | "app" | "servidor"; pendiente_contabilizar: boolean;
  asiento: unknown; respaldo: RespaldoSql;
};
type ConsultaSql = {
  hash: string; requiere_revision: boolean; pendientes: number[]; factura_vigente: boolean; dian_emitida: boolean;
  fotografia: { abonos: AbonoSql[]; total_sin_respaldo_cop: number; total_exceso_cop: number; no_calculables: number };
};
export type AbonoFueraDeLibros = { id: number; fecha: string | null; valorCop: number | null; procedencia: string; pendiente: boolean; mensaje: string };
export type RevisionFueraLibros = {
  hash: string;
  abonos: AbonoFueraDeLibros[];
  totalSinRespaldo: number;
  totalExceso: number;
  noCalculables: number;
  pendientes: number[];
};

const $ = (n: number) => formatMoneda(n, "COP");
// Mensaje por abono: cuánto respalda el libro diario. No anuncia saldos de
// Clientes: emitir no los corrige (decisión del dueño).
function mensajeAbono(a: AbonoSql): string {
  const quien = `Abono #${a.id}${a.fecha_abono ? ` del ${a.fecha_abono}` : ""}`;
  if (a.pendiente_contabilizar) return `${quien}: registrado en la app y aún sin asiento; contabilízalo antes de facturar.`;
  if (!a.respaldo.calculable) return `${quien}: no se puede calcular cuánto lo respalda el libro (sin valor en pesos o asiento no estándar).`;
  const A = Number(a.monto_cop) || 0;
  const S = Number(a.respaldo.respaldado) || 0;
  const falta = Number(a.respaldo.sin_respaldo) || 0;
  const exceso = Number(a.respaldo.exceso) || 0;
  if (exceso > 0) return `${quien} por ${$(A)}: el asiento del libro registra ${$(exceso)} de más.`;
  if (S === 0) return `${quien} por ${$(A)}: no tiene asiento en el libro diario.`;
  return `${quien} por ${$(A)}: el libro respalda ${$(S)}; faltan ${$(falta)}.`;
}
function revisionDe(c: ConsultaSql): RevisionFueraLibros | null {
  if (!c.requiere_revision) return null;
  return {
    hash: c.hash,
    abonos: c.fotografia.abonos.map((a) => ({
      id: a.id, fecha: a.fecha_abono, valorCop: a.monto_cop == null ? null : Number(a.monto_cop),
      procedencia: a.procedencia, pendiente: !!a.pendiente_contabilizar, mensaje: mensajeAbono(a),
    })),
    totalSinRespaldo: Number(c.fotografia.total_sin_respaldo_cop) || 0,
    totalExceso: Number(c.fotografia.total_exceso_cop) || 0,
    noCalculables: Number(c.fotografia.no_calculables) || 0,
    pendientes: c.pendientes ?? [],
  };
}
async function consultar(numeroContrato: string, ctx: Contexto) {
  return rpcFinanciero<ConsultaSql>("consultar_factura_fuera_libros", { p_numero: numeroContrato, p_actor: ctx.actor, p_tenant: ctx.tenant });
}

// Aviso previo: abonos del contrato que el libro diario no respalda.
export async function consultarFueraLibros(numeroContrato: string): Promise<{ ok: true; revision: RevisionFueraLibros | null } | ErrorFinanciero> {
  const c = await contextoFactura(numeroContrato);
  if (!c.ok) return c;
  const r = await consultar(numeroContrato, c.ctx);
  return r.ok ? { ok: true, revision: revisionDe(r.data) } : r;
}

const revalidar = () => {
  revalidatePath("/dashboard/contabilidad/facturacion");
  revalidatePath("/dashboard/rentabilidad");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
};

// Guarda (emite o re-emite) la factura de un contrato: IRT (para terceros) e
// ingreso exento/excluido. `pvp` e `irt` llegan del formulario solo para
// COMPROBAR que la pantalla y el servidor ven lo mismo. Si hay abonos fuera de
// libros, la respuesta trae `revision` y la emisión exige `hashRevision`.
export async function guardarFacturacion(input: {
  numeroContrato: string;
  pvp: number;
  irt: number;
  ingresoExento: number;
  tipoExento?: "exento" | "excluido" | null;
  observacion?: string;
  hashRevision?: string;
  notaRevision?: string;
}): Promise<Result | (ErrorFinanciero & { revision?: RevisionFueraLibros | null })> {
  const c = await contextoFactura(input.numeroContrato);
  if (!c.ok) return c;
  const r = await rpcFinanciero<{ estado: string }>("facturar_factura", {
    p_numero: input.numeroContrato,
    p_actor: c.ctx.actor,
    p_tenant: c.ctx.tenant,
    p_pvp: Number(input.pvp) || 0,
    p_irt: Number(input.irt) || 0,
    p_ingreso_exento: Math.max(0, Number(input.ingresoExento) || 0),
    p_tipo_exento: input.tipoExento ?? null,
    p_observacion: input.observacion ?? null,
    p_hash_revision: input.hashRevision ?? null,
    p_nota_revision: input.notaRevision ?? null,
  });
  if (!r.ok) {
    // Revisión pedida o desactualizada, o abono pendiente: se devuelve el aviso
    // vigente para que la pantalla lo muestre.
    if (r.code === "F4431" || r.code === "F4430" || r.code === "F4420") {
      const q = await consultar(input.numeroContrato, c.ctx);
      return { ...r, revision: q.ok ? revisionDe(q.data) : null };
    }
    // Atómico: cualquier fallo deja la factura y los libros como estaban. Los
    // mensajes de reglas conocidas ya lo dicen; a los demás (cuenta del PUC
    // faltante, error inesperado de la base) se les agrega.
    const yaLoDice = !!r.code && ((/^F44\d\d$/.test(r.code) && r.code !== "F4416") || ["PGRST202", "42883", "55P03", "42501"].includes(r.code));
    return { ...r, error: yaLoDice ? r.error : `${r.error} La configuración quedó como estaba.` };
  }
  revalidar();
  return { ok: true };
}

// Marca un contrato como facturado y emitido a la DIAN. La marca no se deshace
// (F4434) y exige factura vigente (F4435).
export async function marcarDian(numeroContrato: string, emitida: boolean): Promise<Result> {
  const c = await contextoFactura(numeroContrato);
  if (!c.ok) return c;
  const r = await rpcFinanciero("marcar_dian_factura", { p_numero: numeroContrato, p_actor: c.ctx.actor, p_tenant: c.ctx.tenant, p_emitida: emitida });
  if (!r.ok) return r;
  revalidatePath("/dashboard/contabilidad/facturacion");
  return { ok: true };
}

// Quita la factura (el contrato vuelve al cálculo por defecto en
// rentabilidad): reversa + borrado de la configuración en una transacción.
export async function quitarFacturacion(numeroContrato: string): Promise<Result> {
  const c = await contextoFactura(numeroContrato);
  if (!c.ok) return c;
  const r = await rpcFinanciero("quitar_factura", { p_numero: numeroContrato, p_actor: c.ctx.actor, p_tenant: c.ctx.tenant });
  if (!r.ok) return r;
  revalidar();
  return { ok: true };
}

// Contabiliza los abonos recientes de la app que quedaron sin asiento (F4420),
// cada uno con su RPC atómica. No toca los históricos.
export async function contabilizarAbonosPendientes(numeroContrato: string): Promise<{ ok: true; contabilizados: number } | ErrorFinanciero> {
  const c = await contextoFactura(numeroContrato);
  if (!c.ok) return c;
  const q = await consultar(numeroContrato, c.ctx);
  if (!q.ok) return q;
  let contabilizados = 0;
  for (const id of q.data.pendientes ?? []) {
    const r = await rpcFinanciero("postear_asiento_abono", { p_abono_id: id, p_tenant: c.ctx.tenant, p_actor: c.ctx.actor });
    if (!r.ok) return { ...r, error: `Abono #${id}: ${r.error}${contabilizados ? ` (${contabilizados} ya quedaron contabilizados)` : ""}` };
    contabilizados++;
  }
  revalidar();
  return { ok: true, contabilizados };
}
