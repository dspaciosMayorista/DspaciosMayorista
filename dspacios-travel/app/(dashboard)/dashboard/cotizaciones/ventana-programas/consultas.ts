// ===========================================================================
// Ventana de Programas - server actions (Fase B, SOLO LECTURA).
//
// Este archivo es la FRONTERA de confianza de la pantalla. Cada action:
//   1. valida sesion y rol POR SI MISMA (no confia en la ruta ni en el proxy),
//   2. valida la entrada a mano (el repo no usa zod),
//   3. arma el contexto de lectura con el cliente de servidor (anon + cookies,
//      que respeta RLS). NUNCA `service_role`, NUNCA cliente admin,
//   4. llama a `lib/salesbot`, que aplica el gate de publicacion,
//   5. devuelve el DTO seguro, SIN `traza`.
//
// Lo que este archivo NO hace, y hay tests que loVERIFY:
//   · no escribe: ni `.insert`, `.update`, `.upsert`, `.delete`
//   · no llama `revalidatePath` (no hay nada que revalidar)
//   · no importa `lib/crm` ni toca `crm_leads` / `crm_lead_actividades` /
//     `crm_contactos`
//   · no llama Meta, WhatsApp, Instagram, webhooks ni ninguna API externa
//   · no invoca `pvpPrograma`: el PVP llega ya calculado por la capa de lectura
// ===========================================================================

"use server";

import { getTenant } from "@/lib/tenant.server";
import { createClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/constants";
import { salesbotBuscarProgramas, salesbotDetallePrograma } from "@/lib/salesbot/programas";
import { salesbotConsultarDisponibilidad } from "@/lib/salesbot/respuestas";
import type { SalesbotConsultaError, SalesbotError } from "@/lib/salesbot/types";

import { generarBorrador } from "./plantillas.ts";
import {
  normalizarEntrada,
  ROLES_PILOTO_VENTANA,
  type ErrorVentana,
  type FuenteBorrador,
  type GenerarBorradorResultado,
  type ResultadoBusquedaVentana,
  type ResultadoDetalleVentana,
} from "./tiposVista.ts";

/**
 * Los roles validos viven en `tiposVista.ts` (`ROLES_PILOTO_VENTANA`), no aqui:
 * un archivo "use server" solo puede exportar funciones async. La lista es la
 * misma que aplica la pagina, para que las dos capas no puedan divergir.
 */
const SIN_ACCESO = "No tienes acceso a la ventana de programas.";
const SIN_SESION = "No autenticado.";

// ─── Autenticacion y rol ───────────────────────────────────────────────────

type SesionPiloto =
  | { ok: true; sb: Awaited<ReturnType<typeof createClient>>; rol: Rol }
  | { ok: false; error: string };

/**
 * Valida sesion y rol en el servidor. El proxy y el layout ya filtran, pero
 * una server action se puede invocar directamente: la pagina no es la unica
 * puerta. Patron tomado de `app/cms/actions.ts`.
 */
async function exigirPiloto(): Promise<SesionPiloto> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: SIN_SESION };

  const { data: perfil } = await sb
    .from("usuarios")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();

  const rol = (perfil?.rol ?? null) as Rol | null;
  if (!rol || !ROLES_PILOTO_VENTANA.includes(rol)) return { ok: false, error: SIN_ACCESO };

  return { ok: true, sb, rol };
}

// ─── Traduccion de errores ────────────────────────────────────────────────

/**
 * Quita `traza`. En Fase A `traza` es "solo para log, nunca sale hacia el
 * cliente", y el usuario final de esta pantalla es un asesor, no un
 *VIAJERO: el mismo contrato aplica con mas razon. El panel recibe codigo,
 * mensaje y si escala; el porque tecnico se queda en el log del servidor.
 */
function aErrorVentana(e: SalesbotError): ErrorVentana {
  return {
    ok: false,
    codigo: e.error.codigo,
    mensaje: e.error.mensaje,
    escalable: e.error.escalable,
  };
}

function desdeConsulta(e: SalesbotConsultaError): FuenteBorrador {
  return { clase: "error", codigo: e.codigo, mensaje: e.mensaje, escalable: e.escalable };
}

// ─── Acciones ──────────────────────────────────────────────────────────────

/** Paso 3-4 del flujo: lista programas publicados que coinciden. */
export async function buscarProgramasVentana(
  entrada: unknown,
): Promise<ResultadoBusquedaVentana> {
  const sesion = await exigirPiloto();
  if (!sesion.ok) return { ok: false, codigo: "CONSULTA_FALLIDA", mensaje: sesion.error, escalable: false };

  const normal = normalizarEntrada(entrada);
  if ("error" in normal) {
    return { ok: false, codigo: "FALTAN_DATOS_USUARIO", mensaje: normal.error, escalable: false };
  }

  const ctx = { sb: sesion.sb, tenant: await getTenant() };
  const r = await salesbotBuscarProgramas(
    {
      destino: normal.destino || undefined,
      texto: normal.texto || undefined,
      tipoTransporte: normal.tipoTransporte,
      limite: 12,
    },
    ctx,
  );

  if (!r.ok) return aErrorVentana(r);
  return {
    ok: true,
    programas: r.datos.programas,
    noConsultado: [...r.datos.no_consultado],
  };
}

/** Paso 5 del flujo: detalle con gate de publicacion. */
export async function consultarDetalleVentana(id: unknown): Promise<ResultadoDetalleVentana> {
  const sesion = await exigirPiloto();
  if (!sesion.ok) return { ok: false, codigo: "CONSULTA_FALLIDA", mensaje: sesion.error, escalable: false };

  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return {
      ok: false,
      codigo: "PROGRAMA_NO_PUBLICADO",
      mensaje: "Ese programa no esta disponible.",
      escalable: false,
    };
  }

  const ctx = { sb: sesion.sb, tenant: await getTenant() };
  const r = await salesbotDetallePrograma(n, ctx);
  if (!r.ok) return aErrorVentana(r);
  return { ok: true, detalle: r.datos };
}

/**
 * Paso 6: redacta la respuesta sugerida.
 *
 * Consulta por su cuenta en vez de confiar en datos que le manda el navegador:
 * el borrador se construye a partir de lo que el servidor leyo ahora.
 */
export async function generarBorradorVentana(entrada: unknown): Promise<GenerarBorradorResultado> {
  const sesion = await exigirPiloto();
  if (!sesion.ok) return { ok: false, codigo: "CONSULTA_FALLIDA", mensaje: sesion.error, escalable: false };

  const normal = normalizarEntrada(entrada);
  if ("error" in normal) {
    return { ok: false, codigo: "FALTAN_DATOS_USUARIO", mensaje: normal.error, escalable: false };
  }

  const ctx = { sb: sesion.sb, tenant: await getTenant() };

  // Disponibilidad y "otro" no consultan nada: son abstenciones por diseno, y
  // no necesitan programa, fecha ni pax para responder.
  let fuente: FuenteBorrador | undefined;

  if (normal.tipoConsulta === "disponibilidad") {
    fuente = desdeConsulta(salesbotConsultarDisponibilidad(ctx).error);
  } else if (normal.tipoConsulta === "programas") {
    const r = await salesbotBuscarProgramas(
      {
        destino: normal.destino || undefined,
        texto: normal.texto || undefined,
        tipoTransporte: normal.tipoTransporte,
        limite: 12,
      },
      ctx,
    );
    fuente = r.ok ? { clase: "busqueda", datos: r.datos } : desdeConsulta(r.error);
  } else {
    if (normal.programaId == null) {
      return {
        ok: false,
        codigo: "FALTAN_DATOS_USUARIO",
        mensaje: "Elige un programa del catalogo.",
        escalable: false,
      };
    }
    const r = await salesbotDetallePrograma(normal.programaId, ctx);
    fuente = r.ok ? { clase: "detalle", datos: r.datos } : desdeConsulta(r.error);
  }

  return { ok: true, borrador: generarBorrador(normal, fuente) };
}