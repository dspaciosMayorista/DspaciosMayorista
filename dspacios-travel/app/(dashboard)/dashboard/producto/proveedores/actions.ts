"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type TipoProveedor = "hotelero" | "aereo" | "servicios";

export async function crearProveedor(input: {
  tipo: TipoProveedor;
  nombre: string;
  razonSocial: string;
  nit: string;
  ciudad: string;
  contacto: string;
  datosPago: string;
  politicaReservas: string;
  aplicaRetencion: boolean;
  pctRetencion: number;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("proveedores").insert({
    tipo: input.tipo,
    nombre: input.nombre.trim(),
    razon_social: oNull(input.razonSocial),
    nit: oNull(input.nit),
    ciudad: oNull(input.ciudad),
    contacto: oNull(input.contacto),
    datos_pago: oNull(input.datosPago),
    politica_reservas: oNull(input.politicaReservas),
    aplica_retencion: input.aplicaRetencion,
    pct_retencion: input.pctRetencion,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/proveedores");
  return { ok: true };
}

export async function eliminarProveedor(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("proveedores").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/proveedores");
  return { ok: true };
}

// ── Carga masiva (CSV) ─────────────────────────────────────────────────────
const TIPOS_VALIDOS = ["hotelero", "aereo", "servicios"];
const toBool = (s?: string) => /^(s[ií]|si|true|1|x)$/i.test((s || "").trim());

function normTipo(s?: string): TipoProveedor | null {
  const v = (s || "").trim().toLowerCase();
  if (TIPOS_VALIDOS.includes(v)) return v as TipoProveedor;
  if (v.startsWith("hotel")) return "hotelero";
  if (v.includes("aere") || v.includes("aére") || v.includes("vuelo") || v.includes("aéreo")) return "aereo";
  if (v.includes("serv")) return "servicios";
  return null;
}

export async function cargarProveedoresMasivo(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.nombre || "").trim();
    if (!nombre) { errores.push(`Fila ${linea}: falta nombre.`); continue; }
    const tipo = normTipo(r.tipo);
    if (!tipo) { errores.push(`Fila ${linea} (${nombre}): tipo "${r.tipo ?? ""}" inválido (hotelero/aereo/servicios).`); continue; }
    const pct = Number((r.pct_retencion || "").replace(",", ".").replace(/[^\d.]/g, "")) || 0;
    const aplicaRet = toBool(r.aplica_retencion) || pct > 0;
    const { error } = await sb.from("proveedores").insert({
      tipo,
      nombre,
      razon_social: oNull(r.razon_social || ""),
      nit: oNull(r.nit || ""),
      ciudad: oNull(r.ciudad || ""),
      contacto: oNull(r.contacto || ""),
      datos_pago: oNull(r.datos_pago || ""),
      politica_reservas: oNull(r.politica_reservas || ""),
      aplica_retencion: aplicaRet,
      pct_retencion: pct / 100,
    });
    if (error) { errores.push(`Fila ${linea} (${nombre}): ${error.message}`); continue; }
    insertados++;
  }
  revalidatePath("/dashboard/producto/proveedores");
  return { ok: errores.length === 0, insertados, errores };
}
