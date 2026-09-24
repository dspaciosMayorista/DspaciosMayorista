"use server";

// ─────────────────────────────────────────────────────────────────────────
// Búsqueda interna de pasajero por documento EXACTO, para reutilizar datos
// demográficos al crear un contrato nuevo (Minorista y Mayorista) sin tener
// que retipear a alguien que ya viajó. NO es un directorio: llama al RPC
// `buscar_pasajero_por_documento` (migración 187), que filtra por los MISMOS
// permisos/tenant que ya protegen cada contrato — un asesor `venta` nunca ve
// pasajeros de contratos ajenos, y ningún rol externo (B2B/anónimo) pasa del
// primer chequeo dentro del propio RPC (no depende de que esta función, ni
// el front-end, hagan bien el filtro — ver supabase/scripts/
// test_187_seguridad_rls.sql).
//
// Se llama con el cliente de sesión real (createClient, cookies del usuario
// autenticado) — nunca con el cliente admin — para que `mi_rol()`/
// `puede_ver_contrato()` evalúen al usuario real, no a un actor sintético.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";

export type PasajeroEncontrado = {
  nombre: string;
  nombres: string | null;
  apellidos: string | null;
  fechaNacimiento: string | null;
  nacionalidad: string | null;
  vecesVisto: number;
  ultimoContrato: string | null;
  ultimaFecha: string | null;
};

export type BuscarPasajeroResultado =
  | { ok: true; resultados: PasajeroEncontrado[] }
  | { ok: false; error: string };

export async function buscarPasajeroPorDocumento(
  tipoId: string,
  identificacion: string
): Promise<BuscarPasajeroResultado> {
  const ident = identificacion.trim();
  if (!ident) return { ok: true, resultados: [] };

  const sb = await createClient();
  const { data, error } = await sb.rpc("buscar_pasajero_por_documento", {
    p_tipo_id: tipoId.trim() || "CC",
    p_identificacion: ident,
  });

  if (error) {
    // Mensaje genérico: no repetir el detalle crudo de Postgres (puede
    // incluir "Sin permiso para buscar pasajeros." cuando el rol no es
    // interno, que sí es útil mostrar tal cual).
    return { ok: false, error: error.message || "No se pudo buscar el pasajero." };
  }

  type Fila = {
    nombre: string;
    nombres: string | null;
    apellidos: string | null;
    fecha_nacimiento: string | null;
    nacionalidad: string | null;
    veces_visto: number;
    ultimo_contrato: string | null;
    ultima_fecha: string | null;
  };

  const filas = (data ?? []) as unknown as Fila[];
  return {
    ok: true,
    resultados: filas.map((f) => ({
      nombre: f.nombre,
      nombres: f.nombres,
      apellidos: f.apellidos,
      fechaNacimiento: f.fecha_nacimiento,
      nacionalidad: f.nacionalidad,
      vecesVisto: Number(f.veces_visto) || 0,
      ultimoContrato: f.ultimo_contrato,
      ultimaFecha: f.ultima_fecha,
    })),
  };
}
