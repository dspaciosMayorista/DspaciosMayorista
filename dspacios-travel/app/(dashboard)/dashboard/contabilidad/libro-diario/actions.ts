"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant.server";

type Result = { ok: true } | { ok: false; error: string };
const TOL = 1;

export type LineaAsiento = {
  id: number;
  cuenta_id: number;
  cuenta_codigo: string;
  cuenta_nombre: string;
  tercero: string | null;
  descripcion: string | null;
  debe: number;
  haber: number;
};

export type Asiento = {
  id: number;
  numero: number;
  fecha: string;
  descripcion: string;
  origen: string;
  referencia: string | null;
  lineas: LineaAsiento[];
};

export async function listarAsientos(filtro?: { desde?: string; hasta?: string }): Promise<
  { ok: true; asientos: Asiento[] } | { ok: false; error: string }
> {
  const sb = await createClient();
  const tenant = await getTenant();
  let q = sb.from("asientos_contables").select("id, numero, fecha, descripcion, origen, referencia").eq("tenant", tenant).order("numero", { ascending: false });
  if (filtro?.desde) q = q.gte("fecha", filtro.desde);
  if (filtro?.hasta) q = q.lte("fecha", filtro.hasta);
  const { data: asientos, error } = await q;
  if (error) return { ok: false, error: error.message };
  const ids = (asientos ?? []).map((a) => a.id);
  if (!ids.length) return { ok: true, asientos: [] };

  const { data: lineas } = await sb
    .from("asiento_lineas")
    .select("id, asiento_id, cuenta_id, tercero, descripcion, debe, haber, puc_cuentas(codigo, nombre)")
    .in("asiento_id", ids);

  type LineaRaw = { id: number; asiento_id: number; cuenta_id: number; tercero: string | null; descripcion: string | null; debe: number; haber: number; puc_cuentas: { codigo: string; nombre: string } | null };
  const porAsiento = new Map<number, LineaAsiento[]>();
  for (const l of (lineas ?? []) as unknown as LineaRaw[]) {
    const arr = porAsiento.get(l.asiento_id) ?? [];
    arr.push({
      id: l.id, cuenta_id: l.cuenta_id, cuenta_codigo: l.puc_cuentas?.codigo ?? "—", cuenta_nombre: l.puc_cuentas?.nombre ?? "—",
      tercero: l.tercero, descripcion: l.descripcion, debe: Number(l.debe) || 0, haber: Number(l.haber) || 0,
    });
    porAsiento.set(l.asiento_id, arr);
  }

  return {
    ok: true,
    asientos: (asientos ?? []).map((a) => ({
      id: a.id, numero: a.numero, fecha: a.fecha, descripcion: a.descripcion, origen: a.origen, referencia: a.referencia,
      lineas: porAsiento.get(a.id) ?? [],
    })),
  };
}

// Valida que las líneas de un asiento cuadren (partida doble): cada línea es
// SOLO débito o SOLO crédito (no ambos, no ninguno), y el total debe = total
// haber. Compartido por el registro manual y el automático.
function validarLineas(lineas: { debe: number; haber: number }[]): string | null {
  if (lineas.length < 2) return "Un asiento necesita al menos 2 líneas.";
  let totalDebe = 0, totalHaber = 0;
  for (const l of lineas) {
    const debe = Number(l.debe) || 0, haber = Number(l.haber) || 0;
    if (debe > 0 && haber > 0) return "Una línea no puede tener débito y crédito a la vez.";
    if (debe <= 0 && haber <= 0) return "Cada línea necesita un valor en débito o en crédito.";
    totalDebe += debe; totalHaber += haber;
  }
  if (Math.abs(totalDebe - totalHaber) > TOL) return `El asiento no cuadra: débito ${totalDebe.toLocaleString("es-CO")} vs crédito ${totalHaber.toLocaleString("es-CO")}.`;
  return null;
}

async function siguienteNumero(sb: Awaited<ReturnType<typeof createClient>>, tenant: string): Promise<number> {
  const { data } = await sb.from("asientos_contables").select("numero").eq("tenant", tenant).order("numero", { ascending: false }).limit(1).maybeSingle();
  return (data?.numero ?? 0) + 1;
}

export async function crearAsiento(input: {
  fecha: string;
  descripcion: string;
  referencia?: string;
  lineas: { cuentaId: number; tercero?: string; descripcion?: string; debe: number; haber: number }[];
}): Promise<Result> {
  if (!input.fecha) return { ok: false, error: "Indica la fecha del asiento." };
  if (!input.descripcion.trim()) return { ok: false, error: "Indica la descripción del asiento." };
  const err = validarLineas(input.lineas);
  if (err) return { ok: false, error: err };

  const sb = await createClient();
  const tenant = await getTenant();
  const numero = await siguienteNumero(sb, tenant);
  const { data: { user } } = await sb.auth.getUser();

  const { data: asiento, error: e1 } = await sb.from("asientos_contables").insert({
    tenant, numero, fecha: input.fecha, descripcion: input.descripcion.trim(),
    origen: "manual", referencia: input.referencia?.trim() || null, usuario_email: user?.email ?? null,
  }).select("id").single();
  if (e1 || !asiento) return { ok: false, error: e1?.message ?? "No se pudo crear el asiento." };

  const { error: e2 } = await sb.from("asiento_lineas").insert(
    input.lineas.map((l) => ({
      tenant, asiento_id: asiento.id, cuenta_id: l.cuentaId,
      tercero: l.tercero?.trim() || null, descripcion: l.descripcion?.trim() || null,
      debe: Number(l.debe) || 0, haber: Number(l.haber) || 0,
    }))
  );
  if (e2) { await sb.from("asientos_contables").delete().eq("id", asiento.id); return { ok: false, error: e2.message }; }

  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}

export async function eliminarAsiento(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: asiento } = await sb.from("asientos_contables").select("origen").eq("id", id).maybeSingle();
  if (!asiento) return { ok: false, error: "Asiento no encontrado." };
  if (asiento.origen !== "manual") {
    return { ok: false, error: "Este asiento se generó automáticamente desde otro módulo — deshazlo desde ahí (ej. Conciliaciones) para mantener todo consistente." };
  }
  const { error } = await sb.from("asientos_contables").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}

// Cuentas habilitadas para recibir movimiento (para el selector del formulario).
export async function listarCuentasMovimiento(): Promise<{ ok: true; cuentas: { id: number; codigo: string; nombre: string }[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const tenant = await getTenant();
  const { data, error } = await sb.from("puc_cuentas").select("id, codigo, nombre").eq("tenant", tenant).eq("permite_movimiento", true).eq("activa", true).order("codigo");
  if (error) return { ok: false, error: error.message };
  return { ok: true, cuentas: data ?? [] };
}
