import { createClient } from "@/lib/supabase/server";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { modoCorreo } from "@/lib/solicitudProveedor/transporte";
import { SolicitudesProveedorPanel, type SolicitudFila } from "./SolicitudesProveedorPanel";
import { proveedoresDelContrato } from "@/lib/solicitudProveedor/cargar";

// #103 — carga propia (una lectura de solicitudes, una de respuestas, una de avisos): no toca el Promise.all de la página del contrato. Si las tablas aún no existen (migración 328 sin aplicar) o el rol no
// las ve (RLS), la sección no se muestra: nunca rompe el contrato.
export async function SolicitudesProveedorSeccion({ numero, identidad }: { numero: string; identidad: IdentidadContrato }) {
  const sb = await createClient(identidad);
  const { data: filas, error } = await sb.from("solicitudes_proveedor")
    .select("id, proveedor, destinatarios, estado, error_envio, codigo_texto, codigo_promocion, enviada_en, entregada_en, respondida_en, confirmada_en, created_at")
    .eq("numero_contrato", numero).order("created_at", { ascending: false });
  if (error) return null;
  const ids = (filas ?? []).map((f) => f.id);
  const [{ data: respuestas }, { data: avisos }] = await Promise.all([
    ids.length ? sb.from("solicitud_proveedor_eventos").select("solicitud_id, resumen, created_at").eq("tipo", "respuesta").in("solicitud_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { solicitud_id: number; resumen: unknown; created_at: string }[] }),
    ids.length ? sb.from("solicitud_proveedor_avisos").select("solicitud_id").is("leido_en", null).in("solicitud_id", ids) : Promise.resolve({ data: [] as { solicitud_id: number }[] }),
  ]);
  const modo = modoCorreo();
  // Quien no puede ver solicitudes (rol sin acceso) y no hay nada que mostrar: la sección no aparece.
  const proveedores = await proveedoresDelContrato(sb, numero);
  if (!(filas ?? []).length && !proveedores.length) return null;
  return (
    <SolicitudesProveedorPanel
      numero={numero} identidad={identidad} proveedores={proveedores} correoHabilitado={modo !== "off"} modoCaptura={modo === "captura"}
      solicitudes={(filas ?? []) as unknown as SolicitudFila[]}
      respuestas={(respuestas ?? []).map((r) => ({ solicitudId: r.solicitud_id, creada: r.created_at, ...((r.resumen ?? {}) as { de?: string; texto?: string; asunto?: string }) }))}
      sinLeer={(avisos ?? []).length}
    />
  );
}
