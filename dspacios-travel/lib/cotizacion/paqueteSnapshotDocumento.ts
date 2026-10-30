// Snapshot de reparto del paquete para el DOCUMENTO de una cotización (solo servidor).
// Las cotizaciones nuevas lo traen en `detalle.paqueteSnapshot`; las anteriores se reconstruyen desde su `payload` congelado (a cuántos pasajeros cubre cada adicional y, en NETO, su
// parte del plan). El payload no sale de aquí: el documento solo recibe el resumen derivado, sin comisión, impuesto ni plan. Si algo no cuadra, el documento lo descarta (compara
// textos, precios y totales con sus propias líneas) y muestra el total.
import { netoTotalExigibleDeDetalle } from "@/lib/cotizacion/asistidaB2B";
import { snapshotPaqueteDePayload, type SnapshotPaquete } from "@/lib/cotizacion/tarifaPaquete";

type DetalleSnapshot = { paqueteSnapshot?: SnapshotPaquete | null; b2bExterno?: { netoTotalExigible?: number } };
// El cliente tipado de Supabase hace la inferencia infinita en un parámetro estructural: se tipa lo mínimo que se usa.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SelectPayload = { from: (t: "cotizaciones") => any };

/** `payload` ya leído (ficha interna). */
export function snapshotDelDocumento(d: DetalleSnapshot, payload: unknown): SnapshotPaquete | null {
  if (d.paqueteSnapshot) return d.paqueteSnapshot;
  return snapshotPaqueteDePayload(payload, netoTotalExigibleDeDetalle(d.b2bExterno));
}

/** Enlace público: solo lee el payload cuando el detalle no trae el snapshot, y únicamente por el mismo `share_token`. */
export async function snapshotDelDocumentoPublico(
  sb: SelectPayload,
  token: string,
  d: DetalleSnapshot,
): Promise<SnapshotPaquete | null> {
  if (d.paqueteSnapshot) return d.paqueteSnapshot;
  const { data } = (await sb.from("cotizaciones").select("payload").eq("share_token", token).maybeSingle()) as { data: { payload: unknown } | null };
  return snapshotDelDocumento(d, data?.payload ?? null);
}
