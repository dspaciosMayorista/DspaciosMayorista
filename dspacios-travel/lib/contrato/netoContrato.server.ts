// #30 — ¿El contrato está vendido en NETO? Lo necesita el documento imprimible
// para no mostrar ni cobrar el PVP completo (ver lib/contrato/presentacionValores.ts).
//
// Frontera service-role, igual que `habitacionesBernaloDeContrato`: el rol
// `venta` lee el contrato por `ventas_basica`, que (a propósito, migración 144)
// no trae `comision_estado`/`comision_b2b`. Esta función:
//   · se llama SOLO después de que la página ya autorizó el acceso a ese número
//     de contrato con el cliente de la sesión (RLS);
//   · devuelve únicamente el total exigible (`precio_venta`, que quien abre el
//     documento ya ve) o null — nunca la comisión ni el PVP original.
// Solo servidor: usa la llave service-role y no se importa desde un componente
// cliente.
import { createAdminClient } from "@/lib/supabase/admin";
import { esVentaNetoDescontada } from "@/lib/finanzas/netoB2B";

type ClienteLectura = Pick<ReturnType<typeof createAdminClient>, "from">;

/** `cliente` solo se inyecta en pruebas; en la app siempre es service-role. */
export async function netoTotalExigibleDeContrato(
  numeroContrato: string,
  cliente?: ClienteLectura,
): Promise<number | null> {
  const admin = cliente ?? createAdminClient();
  const { data, error } = await admin
    .from("ventas")
    .select("precio_venta, comision_estado")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  // Sin respuesta no se adivina: caer a "no es NETO" volvería a imprimir el PVP
  // completo como total a pagar. Mejor que la página falle.
  if (error) throw new Error(`No se pudo determinar la modalidad del contrato ${numeroContrato}.`);
  if (!data || !esVentaNetoDescontada(data)) return null;
  return Math.max(0, Number(data.precio_venta) || 0);
}
