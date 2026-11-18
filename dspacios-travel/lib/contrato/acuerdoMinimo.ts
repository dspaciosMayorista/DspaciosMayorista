import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { interpretarLecturaAcuerdo, type LecturaAcuerdo } from "@/lib/contrato/reglaConfirmacion";

// Último acuerdo de mínimo de confirmación del contrato (#53, migración 307), leído con service-role DESPUÉS de que la página autorizó el contrato
// (la tabla es solo de roles internos; los documentos por token y el rol `venta` también deben ver el mínimo vigente).
// F5: distingue AUSENCIA VERIFICADA de FALLO DE LECTURA. Un fallo (error de PostgREST, clave de servidor ausente, fila ilegible) NUNCA se trata como «sin acuerdo»: quien llama no debe mostrar ni usar otro mínimo.
// identidad:n/a — solo lectura de un dato de configuración del contrato
export async function cargarAcuerdoMinimo(numero: string): Promise<LecturaAcuerdo> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { estado: "error", motivo: "falta la clave de servidor" };
  try {
    const r = await createAdminClient()
      .from("contrato_minimo_acuerdo" as never)
      .select("tipo, porcentaje, importe, moneda")
      .eq("numero_contrato", numero)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    return interpretarLecturaAcuerdo({ data: r.data, error: r.error });
  } catch (e) {
    return { estado: "error", motivo: e instanceof Error ? e.message : "excepción de lectura" };
  }
}
