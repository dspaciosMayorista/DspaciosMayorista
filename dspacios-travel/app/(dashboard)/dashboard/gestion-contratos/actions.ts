"use server";

// #106 · Acuses operativos MANUALES de superadmin (voucher entregado / factura enviada). Una sola acción, una sola RPC (`registrar_seguimiento_contrato`,
// migración 309). NO ejecuta ningún pago, asiento, emisión de factura ni envío de correo: solo registra que el personal reporta que ocurrió.
// Autorización: superadmin comprobado aquí Y exigido otra vez dentro de la RPC (42501). La identidad del contrato (`uid`) viaja con la petición: si el
// número ya pertenece a otro contrato, la base rechaza con CONTRATO_CAMBIO (F4601) y no escribe nada.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { esSuperadminActivo } from "@/lib/gestionContratos/acceso.server";
import { CANALES } from "@/lib/gestionContratos/canales";

export type TipoSeguimiento = "voucher_entregado" | "factura_enviada";
export type EntradaSeguimiento = { numero: string; uid: string; tipo: TipoSeguimiento; accion: "marcar" | "desmarcar"; canal?: string; nota?: string };
export type ResultadoSeguimiento = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MENSAJES: Record<string, string> = {
  "42501": "Solo superadmin puede registrar acuses operativos.",
  F4601: "El contrato cambió desde que abriste esta pantalla (otra persona lo eliminó o lo reemplazó). Recarga la lista; no se cambió nada.",
  F4702: "Ese contrato ya no tiene el documento que intentas acusar (voucher o factura). Recarga la lista.",
  F4703: "Ese acuse ya está registrado y vigente.",
  F4704: "No hay un acuse vigente que retirar. Recarga la lista.",
  "22023": "Los datos del acuse no son válidos (revisa el canal y la nota de hasta 500 caracteres).",
};

export async function registrarSeguimiento(entrada: EntradaSeguimiento): Promise<ResultadoSeguimiento> {
  // Esta función es un endpoint público de la app: se valida todo lo que llega, no se confía en el tipo declarado.
  const e = entrada as Partial<EntradaSeguimiento> | null;
  if (!e || typeof e.numero !== "string" || !e.numero.trim() || e.numero.length > 40 || typeof e.uid !== "string" || !UUID.test(e.uid)) return { ok: false, error: "Contrato no válido." };
  if (e.tipo !== "voucher_entregado" && e.tipo !== "factura_enviada") return { ok: false, error: "Tipo de acuse no válido." };
  if (e.accion !== "marcar" && e.accion !== "desmarcar") return { ok: false, error: "Acción no válida." };
  if (e.accion === "marcar" && !(CANALES as readonly string[]).includes(e.canal ?? "")) return { ok: false, error: "Indica el canal por el que se entregó o envió." };
  const nota = typeof e.nota === "string" ? e.nota.trim() : "";
  if (nota.length > 500) return { ok: false, error: "La nota admite hasta 500 caracteres." };

  const sb = await createClient();
  if (!(await esSuperadminActivo(sb))) return { ok: false, error: MENSAJES["42501"] };
  const { error } = await sb.rpc("registrar_seguimiento_contrato", {
    p_numero: e.numero, p_contrato_uid: e.uid, p_tipo: e.tipo, p_accion: e.accion,
    p_canal: e.accion === "marcar" ? e.canal : null, p_nota: nota || null,
  });
  if (error) return { ok: false, error: MENSAJES[error.code ?? ""] ?? "No se pudo registrar el acuse. Inténtalo de nuevo." };
  revalidatePath("/dashboard/gestion-contratos");
  return { ok: true };
}
