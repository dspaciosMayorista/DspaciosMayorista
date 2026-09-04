"use server";

// ─────────────────────────────────────────────────────────────────────────
// Excepciones a restricciones de condiciones de pago del contrato (migración
// 164, Commit 6). `contrato_condiciones` es PERMANENTE e INMUTABLE (candado
// de BD): esta acción NUNCA la toca. Lo único que hace es dejar un registro
// de auditoría, solo-append, en `restriccion_overrides` — que la presentación
// (`lib/contrato/condicionesContrato.ts`) usa para dejar de mostrar la fila
// como restringida, sin que la condición original se haya movido ni un bit.
//
// Autorización: SOLO superadmin (más estricta que el resto de la migración
// 164, que admite superadmin/administracion/gerencia/operaciones). El RPC
// `registrar_override_restriccion` re-verifica rol+activo+tenant server-side
// — esta Server Action solo filtra temprano para no exponer el formulario a
// quien de todas formas el RPC va a rechazar.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function sesionSuperadmin(): Promise<{ userId: string } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  if (perfil?.rol !== "superadmin") return null;
  return { userId: user.id };
}

/** Mensajes "seguros": nunca fugan detalle crudo de PostgreSQL al navegador. */
function mensajeSeguro(msg: string): string {
  const m = String(msg ?? "").trim();
  if (!m) return "No se pudo registrar la excepción. Inténtalo de nuevo.";
  if (/(duplicate key|violates (foreign key|not-null|check) constraint|constraint "|relation "|pg_|sqlstate|serialization failure|contradice la política|new row violates)/i.test(m)) {
    return "No se pudo registrar la excepción por un conflicto de datos. Reintenta.";
  }
  return m;
}

export async function registrarOverrideRestriccion(
  numeroContrato: unknown,
  contratoCondicionId: unknown,
  restriccionAfectada: unknown,
  motivo: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await sesionSuperadmin();
  if (!sesion) {
    return { ok: false, error: "No autorizado: solo superadmin puede autorizar una excepción a una restricción." };
  }

  const numero = typeof numeroContrato === "string" ? numeroContrato.trim() : "";
  if (!numero) return { ok: false, error: "Contrato inválido." };
  const condicionId = Number(contratoCondicionId);
  if (!Number.isFinite(condicionId) || condicionId <= 0) {
    return { ok: false, error: "Condición inválida." };
  }
  const afectada = typeof restriccionAfectada === "string" ? restriccionAfectada.trim() : "";
  if (!afectada) return { ok: false, error: "Indica qué restricción se está exceptuando." };
  const motivoTexto = typeof motivo === "string" ? motivo.trim() : "";
  if (!motivoTexto) return { ok: false, error: "El motivo de la excepción es obligatorio." };
  if (motivoTexto.length > 2000) return { ok: false, error: "El motivo es demasiado largo." };

  const admin = createAdminClient();
  const rpc = await admin.rpc("registrar_override_restriccion", {
    p_numero_contrato: numero,
    p_contrato_condicion_id: condicionId,
    p_restriccion_afectada: afectada,
    p_motivo: motivoTexto,
    p_usuario_id: sesion.userId,
  });
  if (rpc.error) return { ok: false, error: mensajeSeguro(rpc.error.message) };

  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}
