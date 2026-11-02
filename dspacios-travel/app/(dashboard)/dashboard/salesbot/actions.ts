"use server";

// Acción de servidor de la conversación guiada de SalesBot (#56). Cada turno:
//   · revalida sesión, usuario activo, rol y tenant ANTES de tocar cualquier
//     dato (misma regla que las consultas: 5 roles internos, solo Mayorista);
//   · trata el estado y la entrada del navegador como no confiables
//     (`avanzar` los sanea y revalida toda selección contra el servidor);
//   · usa SOLO las consultas ya saneadas de SalesBot.
// No guarda nada: ni base de datos, ni URL, ni logs con el texto del usuario.
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { generarFlujoId, registrarErrorTecnico } from "@/lib/observabilidad/medicion";
import { resolverAccesoConsulta } from "@/lib/salesbot/acceso";
import { buscarProgramas, detallePrograma, listarAgencias, porcentajeAgencia } from "@/lib/salesbot/lectura";
import {
  buscarBloqueos,
  buscarPorcion,
  cotizarBloqueo,
  cotizarPorcion,
  destinosPorcionDisponibles,
  MENSAJE_NO_AUTORIZADO_PAQUETES,
  ofertaBloqueoPorClave,
  prepararConsultaPaquetes,
} from "@/lib/salesbot/paquetes/lectura";
import { crearSello, type Respuesta } from "@/lib/salesbot/contrato";
import { estadoInicial, type RespuestaConversacion } from "@/lib/salesbot/conversacion/contrato";
import { avanzar, type ServiciosConversacion } from "@/lib/salesbot/conversacion/flujo";

const FLUJO = "salesbot_conversacion";
const MENSAJE_ERROR = "No fue posible continuar en este momento. Intenta de nuevo o consulta al asesor.";

/** ¿La sesión puede usar SalesBot? Misma regla que las consultas; nunca confía en el navegador. */
async function autorizar(flujoId: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, motivo: MENSAJE_NO_AUTORIZADO_PAQUETES.sin_sesion };
  const { data: perfil, error } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (error) {
    registrarErrorTecnico(FLUJO, flujoId, "autorizar", "error_consulta_perfil", error);
    return { ok: false, motivo: MENSAJE_ERROR };
  }
  const acceso = resolverAccesoConsulta(perfil ? { rol: (perfil.rol as string | null) ?? null, activo: perfil.activo } : null, await getTenant());
  return acceso.ok ? { ok: true } : { ok: false, motivo: MENSAJE_NO_AUTORIZADO_PAQUETES[acceso.motivo] };
}

/** Las consultas de paquetes comparten un contexto (catálogo leído una vez por turno). */
function servicios(): ServiciosConversacion {
  let preparado: ReturnType<typeof prepararConsultaPaquetes> | null = null;
  const paquetes = () => (preparado ??= prepararConsultaPaquetes());
  const sinContexto = <T>(fuente: "buscarBloqueos" | "cotizarBloqueo" | "buscarPorcion" | "cotizarPorcion", p: { codigo: "no_autorizado" | "error_tecnico"; motivo: string }): Respuesta<T> => ({
    ok: false,
    codigo: p.codigo,
    motivo: p.motivo,
    sello: crearSello(fuente),
  });
  return {
    buscarProgramas,
    detallePrograma,
    listarAgencias,
    porcentajeAgencia,
    buscarBloqueos: async (e) => {
      const p = await paquetes();
      return p.ok ? buscarBloqueos(p.ctx, e) : sinContexto("buscarBloqueos", p);
    },
    ofertaBloqueo: async (clave) => {
      const p = await paquetes();
      return p.ok ? ofertaBloqueoPorClave(p.ctx, clave) : null;
    },
    cotizarBloqueo: async (e) => {
      const p = await paquetes();
      return p.ok ? cotizarBloqueo(p.ctx, e) : sinContexto("cotizarBloqueo", p);
    },
    destinosPorcion: async () => {
      const p = await paquetes();
      return p.ok ? destinosPorcionDisponibles(p.ctx) : null;
    },
    buscarPorcion: async (e) => {
      const p = await paquetes();
      return p.ok ? buscarPorcion(p.ctx, e) : sinContexto("buscarPorcion", p);
    },
    cotizarPorcion: async (e) => {
      const p = await paquetes();
      return p.ok ? cotizarPorcion(p.ctx, e) : sinContexto("cotizarPorcion", p);
    },
  };
}

/** Un turno de la conversación. `estado` y `entrada` vienen del navegador: no son fuente de verdad. */
export async function conversar(estado: unknown, entrada: unknown): Promise<RespuestaConversacion> {
  const flujoId = generarFlujoId();
  try {
    const a = await autorizar(flujoId);
    if (!a.ok) return { ok: false, estado: estadoInicial(), mensajes: [{ texto: a.motivo, aviso: true }] };
    return await avanzar(estado, entrada, servicios(), fechaNegocio(new Date()));
  } catch (error) {
    // Solo el error técnico: nunca el texto del usuario ni el estado.
    registrarErrorTecnico(FLUJO, flujoId, "turno", "excepcion", error instanceof Error ? new Error(error.name) : new Error("desconocido"));
    return { ok: false, estado: estadoInicial(), mensajes: [{ texto: MENSAJE_ERROR, aviso: true }] };
  }
}
