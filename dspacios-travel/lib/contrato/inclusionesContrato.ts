// B95-18 (owner 2026-11-26) — «Incluye / No incluye» de un contrato convertido desde una cotización (la opción elegida de una comparativa, una cotización manual o la de un carrito).
// El contrato no guarda estos textos: viven en la cotización de origen (`ventas.cotizacion_id` → `cotizaciones.detalle.incluye / noIncluye`, congelados al cotizar). Hasta ahora ninguna ruta de contrato los pasaba
// al documento y la conversión «perdía» lo que la opción incluía. Solo SERVIDOR y SOLO después de que la ruta autorizó el contrato (sesión con RLS o `share_token`): lee con service-role y devuelve únicamente
// los dos textos (nunca el detalle, el payload, costos ni comisiones). Sin cotización de origen, sin textos o ante un error de lectura → null (el documento queda como siempre; el error se registra, no se oculta).
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarErrorTecnico } from "@/lib/observabilidad/medicion";

export type InclusionesContrato = { incluye: string | null; noIncluye: string | null };
const VACIO: InclusionesContrato = { incluye: null, noIncluye: null };
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export async function inclusionesDeContrato(numero: string): Promise<InclusionesContrato> {
  try {
    const sb = createAdminClient();
    const { data: venta, error: e1 } = await sb.from("ventas").select("cotizacion_id").eq("numero_contrato", numero).maybeSingle();
    if (e1) { registrarErrorTecnico("contrato_documento", numero, "inclusiones", "venta", e1); return VACIO; }
    const id = (venta as { cotizacion_id?: number | null } | null)?.cotizacion_id;
    if (!id) return VACIO;
    const { data, error: e2 } = await sb.from("cotizaciones").select("incluye:detalle->>incluye, noIncluye:detalle->>noIncluye").eq("id", id).maybeSingle();
    if (e2) { registrarErrorTecnico("contrato_documento", numero, "inclusiones", "cotizacion", e2); return VACIO; }
    const r = data as unknown as { incluye?: unknown; noIncluye?: unknown } | null;
    return { incluye: texto(r?.incluye), noIncluye: texto(r?.noIncluye) };
  } catch (e) {
    registrarErrorTecnico("contrato_documento", numero, "inclusiones", "excepcion", e);
    return VACIO;
  }
}
