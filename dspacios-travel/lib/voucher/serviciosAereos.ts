import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuentaServiciosAereosVigentes } from "@/lib/voucher/serviciosAereosPuro";

// Rev2 B1-05: cuántos servicios aéreos VIGENTES tiene el contrato (un voucher aéreo por servicio; los «retirado» ya no existen). Una sola lectura acotada, SOLO después de autorizar la apertura del voucher
// (el aliado ya pasó acceso + pago; el interno, la RLS). `null` = no se pudo leer: el documento no afirma ninguna cantidad y deja la nota general.
// identidad:n/a — solo lectura
export async function contarServiciosAereos(numero: string): Promise<number | null> {
  try {
    const { data, error } = await createAdminClient().from("vouchers").select("id, estado").eq("numero_contrato", numero).eq("tipo", "vuelo").limit(100);
    return error ? null : cuentaServiciosAereosVigentes(data ?? []);
  } catch { return null; }
}
