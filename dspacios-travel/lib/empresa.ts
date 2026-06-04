// ─────────────────────────────────────────────────────────────────────────
// Información de la empresa (marca blanca / white-label)
// ─────────────────────────────────────────────────────────────────────────
// Una sola fila (id = 1) en `empresa_config`. Centraliza la marca: nombre,
// logo, datos tributarios (cabecera del contrato), cuenta bancaria y las
// políticas/condiciones editables. Si no hay fila, se usan los GENÉRICOS.
// ─────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type EmpresaConfig = {
  nombre_comercial: string;
  tagline: string;
  logo_url: string | null;
  logo_white_url: string | null;
  logo_icon_url: string | null;
  color_primary: string;
  color_accent: string;
  razon_social: string;
  nit: string;
  dv: string;
  regimen: string;
  rnt: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  email: string;
  sitio_web: string;
  banco: string;
  cuenta_tipo: string;
  cuenta_numero: string;
  cuenta_titular: string;
  ciudad_emision: string;
  jurisdiccion: string;
  politica_pago: string;
  politica_cancelacion: string;
  terminos_condiciones: string;
  nota_contrato: string;
};

/** Genéricos: lo que ve un comprador "en blanco" antes de configurar nada. */
export const EMPRESA_DEFAULT: EmpresaConfig = {
  nombre_comercial: "Tu Agencia de Viajes",
  tagline: "Agencia de Viajes y Turismo",
  logo_url: "/marca/logo-generico.svg",
  logo_white_url: "/marca/logo-generico-white.svg",
  logo_icon_url: "/marca/logo-generico.svg",
  color_primary: "#1D7C9A",
  color_accent: "#26BBD9",
  razon_social: "",
  nit: "",
  dv: "",
  regimen: "",
  rnt: "",
  direccion: "",
  ciudad: "",
  telefono: "",
  email: "",
  sitio_web: "",
  banco: "",
  cuenta_tipo: "",
  cuenta_numero: "",
  cuenta_titular: "",
  ciudad_emision: "",
  jurisdiccion: "",
  politica_pago: "",
  politica_cancelacion: "",
  terminos_condiciones: "",
  nota_contrato: "",
};

const CAMPOS = Object.keys(EMPRESA_DEFAULT) as (keyof EmpresaConfig)[];

/** Mezcla una fila parcial de la BD con los genéricos (nunca deja nulos vacíos). */
export function normalizeEmpresa(row: Record<string, unknown> | null | undefined): EmpresaConfig {
  const out = { ...EMPRESA_DEFAULT };
  if (row) {
    for (const k of CAMPOS) {
      const v = row[k];
      if (v !== null && v !== undefined && v !== "") {
        // @ts-expect-error asignación campo a campo (mismo tipo string)
        out[k] = v;
      }
    }
  }
  return out;
}

/** Lee la config de empresa (fila 1). Si no hay fila, devuelve los genéricos. */
export async function getEmpresaConfig(
  sb: SupabaseClient<Database>
): Promise<EmpresaConfig> {
  try {
    const { data } = await sb.from("empresa_config").select("*").eq("id", 1).maybeSingle();
    return normalizeEmpresa(data as Record<string, unknown> | null);
  } catch {
    return { ...EMPRESA_DEFAULT };
  }
}

/** Nombre legal para el clausulado (razón social si existe, si no el comercial). */
export function nombreLegal(e: EmpresaConfig): string {
  return (e.razon_social || e.nombre_comercial || "LA AGENCIA").trim();
}

/** Línea de cuenta bancaria armada desde la config. */
export function lineaCuenta(e: EmpresaConfig): string {
  const partes = [e.banco, e.cuenta_tipo, e.cuenta_numero].filter(Boolean);
  return partes.length ? partes.join(" ") : "—";
}

/**
 * Reemplaza los tokens del clausulado por los datos de la empresa:
 *   {{EMPRESA}}  → nombre legal (mayúsculas)
 *   {{CUENTA}}   → banco + tipo + número
 *   {{CORREO}}   → email
 *   {{CIUDAD}}   → ciudad / jurisdicción
 */
export function aplicarEmpresa(texto: string, e: EmpresaConfig): string {
  return texto
    .replaceAll("{{EMPRESA}}", nombreLegal(e).toUpperCase())
    .replaceAll("{{CUENTA}}", lineaCuenta(e))
    .replaceAll("{{CORREO}}", e.email || "—")
    .replaceAll("{{CIUDAD}}", e.jurisdiccion || e.ciudad || "—");
}
