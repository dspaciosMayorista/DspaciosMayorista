"use server";

// ─────────────────────────────────────────────────────────────────────────
// #40 V1 · Búsqueda explícita del CLIENTE por tipo y número de documento al crear una cotización
// dinámica simple de canal interno. Solo envuelve la RPC `buscar_personas_documento` (214/219) con el
// cliente de SESIÓN: nunca service_role. La RPC decide de nuevo actor, rol, tenant y qué capturas
// puede ver ese actor (D-3=N2); esta acción no sustituye ese filtro, lo precede:
//
//   1. sesión real  → sin usuario, nada.
//   2. perfil activo (`activo === true`, falla cerrado) con rol de consulta de personas
//      (superadmin, gerencia, administracion, operaciones, venta). control_vuelo y los roles B2B
//      quedan fuera aunque el botón se les mostrara.
//   3. tenant resuelto en el servidor con la misma regla que `getTenant()`: solo el superadmin
//      alterna agencia por cookie; los demás quedan en la suya. Se pasa SIEMPRE explícito (gerencia y
//      superadmin lo exigen en la RPC) y nunca viene del navegador.
//   4. documento COMPLETO según la gramática de consulta de #32 antes de tocar la base.
//
// No registra el documento ni ningún dato personal (ni en logs ni en la URL: es una Server Action con
// cuerpo POST). Los errores de la base no viajan al navegador.
// ─────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_TENANT, esTenant, resolverTenantActivo, type Tenant } from "@/lib/tenant";
import { cabeOriginal, ErrorEntradaDocumento, normalizarDocumento } from "@/lib/personas/identidad";
import { ROLES_CONSULTA_PERSONAS } from "@/lib/personas/fuentes";
import { buscarPersonasDocumento, LIMITE_MAX_OBSERVACIONES } from "@/lib/personas/consulta";
import type { RespuestaBusquedaPersonas } from "@/lib/personas/consulta";

/** Campos de la RPC que el formulario de cotización sabe recibir (el resto se ignora). */
// (Un archivo "use server" solo puede exportar funciones async: la lista es local y se exportan tipos.)
const CAMPOS_CLIENTE_COTIZACION = ["nombres", "apellidos", "telefono", "email", "fecha_nacimiento"] as const;
export type CampoClienteCotizacion = (typeof CAMPOS_CLIENTE_COTIZACION)[number];

/** De dónde salió un valor (lo que la RPC ya autorizó mostrar a este actor). */
export type ProcedenciaCliente = {
  fuente: string;
  capturadoEn: string | null;
  contratoNumero: string | null;
  cotizacionId: number | null;
};

export type ValorCliente = { valor: string; nCapturas: number; procedencia: ProcedenciaCliente[] };

export type CampoCliente = {
  campo: CampoClienteCotizacion;
  divergencia: boolean;
  valores: ValorCliente[];
  /** Valores distintos que la RPC no detalló (más de 10). */
  omitidos: number;
};

export type ResultadoBuscarCliente =
  | { ok: true; estado: "sin_registro" }
  | { ok: true; estado: "encontrado"; incompleto: boolean; campos: CampoCliente[] }
  | { ok: false; codigo: "no_autorizado" | "formato" | "consulta"; error: string };

const MSG_NO_AUTORIZADO = "No tienes permiso para buscar clientes por documento.";
const MSG_FORMATO = "Escribe un tipo y un número de documento completos y válidos. Para NIT, solo la base, sin dígito de verificación.";
const MSG_CONSULTA = "No se pudo consultar el documento. Intenta de nuevo o continúa llenando los datos a mano.";

const MAX_PROCEDENCIAS_POR_VALOR = 3;

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

type Actor = { tenant: Tenant };

/** Sesión + perfil activo + rol de consulta + tenant. `null` = no autorizado (sin distinguir el motivo). */
async function actorAutorizado(sb: Awaited<ReturnType<typeof createClient>>): Promise<Actor | null> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil, error } = await sb
    .from("usuarios")
    .select("rol, activo, tenant")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !perfil) return null;
  // Falla cerrado: solo `true` exacto es "activo" (igual que resolverContextoCotizacion).
  if (perfil.activo !== true) return null;
  const rol = String(perfil.rol ?? "");
  if (!(ROLES_CONSULTA_PERSONAS as readonly string[]).includes(rol)) return null;
  // Un usuario que no es superadmin necesita su propio tenant válido: no se rellena con "mayorista".
  if (rol !== "superadmin" && !esTenant(perfil.tenant)) return null;
  const ck = (await cookies()).get(COOKIE_TENANT)?.value;
  return { tenant: resolverTenantActivo({ rol, tenant: perfil.tenant }, ck) };
}

/** Proyección mínima y sin identificadores internos (ni persona, ni captura, ni actor) de la respuesta de la RPC. */
function proyectar(r: RespuestaBusquedaPersonas): ResultadoBuscarCliente {
  if (!esObjeto(r) || !Array.isArray(r.observaciones) || !Array.isArray(r.variantes)) {
    return { ok: false, codigo: "consulta", error: MSG_CONSULTA };
  }
  if (r.error === "formato_no_admitido") return { ok: false, codigo: "formato", error: MSG_FORMATO };
  if (!r.persona || !(Number(r.total) > 0)) return { ok: true, estado: "sin_registro" };

  const campos: CampoCliente[] = [];
  for (const campo of CAMPOS_CLIENTE_COTIZACION) {
    const variante = r.variantes.find((v) => esObjeto(v) && v.campo === campo);
    if (!variante || !Array.isArray(variante.valores)) continue;
    const valores: ValorCliente[] = [];
    for (const v of variante.valores) {
      if (!esObjeto(v) || typeof v.valor !== "string" || v.valor === "") continue;
      const procedencia = new Map<string, ProcedenciaCliente>();
      for (const o of r.observaciones) {
        if (o.campo !== campo || o.valor !== v.valor) continue;
        const clave = `${o.fuente}|${o.contrato_numero ?? ""}|${o.cotizacion_id ?? ""}`;
        const previa = procedencia.get(clave);
        const fecha = typeof o.capturado_en === "string" ? o.capturado_en : null;
        if (!previa || (fecha && (!previa.capturadoEn || fecha > previa.capturadoEn))) {
          procedencia.set(clave, {
            fuente: String(o.fuente),
            capturadoEn: fecha,
            contratoNumero: o.contrato_numero ?? null,
            cotizacionId: typeof o.cotizacion_id === "number" ? o.cotizacion_id : null,
          });
        }
      }
      valores.push({
        valor: v.valor,
        nCapturas: Number(v.n_capturas) || 0,
        procedencia: [...procedencia.values()]
          .sort((a, b) => (b.capturadoEn ?? "").localeCompare(a.capturadoEn ?? ""))
          .slice(0, MAX_PROCEDENCIAS_POR_VALOR),
      });
    }
    if (!valores.length) continue;
    campos.push({
      campo,
      divergencia: variante.divergencia === true || variante.n_valores > 1,
      valores,
      omitidos: Math.max(Number(variante.valores_omitidos) || 0, 0),
    });
  }

  // Lectura incompleta: hay más observaciones que las de la página o valores sin detallar. No se
  // sabe si lo mostrado es todo lo que dice el registro, así que el cliente no ofrece aplicar nada.
  const incompleto = r.has_more === true || campos.some((c) => c.omitidos > 0);
  return { ok: true, estado: "encontrado", incompleto, campos };
}

export async function buscarClienteDocumento(entrada: { tipoDoc: string; numeroDoc: string }): Promise<ResultadoBuscarCliente> {
  try {
    const sb = await createClient();
    const actor = await actorAutorizado(sb);
    if (!actor) return { ok: false, codigo: "no_autorizado", error: MSG_NO_AUTORIZADO };

    // La entrada llega por red: no se confía en su forma.
    const tipoDoc = esObjeto(entrada) ? entrada.tipoDoc : undefined;
    const numeroDoc = esObjeto(entrada) ? entrada.numeroDoc : undefined;
    if (typeof tipoDoc !== "string" || typeof numeroDoc !== "string" || !cabeOriginal(tipoDoc) || !cabeOriginal(numeroDoc)) {
      return { ok: false, codigo: "formato", error: MSG_FORMATO };
    }
    try {
      // Misma gramática que la RPC: solo se consulta una clave completa (tipo del catálogo + número válido).
      const g = normalizarDocumento({ tipo: tipoDoc, numero: numeroDoc, nitDvEstructurado: null, modo: "consulta" });
      if (g.estado !== "documentada") return { ok: false, codigo: "formato", error: MSG_FORMATO };
    } catch (e) {
      if (e instanceof ErrorEntradaDocumento) return { ok: false, codigo: "formato", error: MSG_FORMATO };
      throw e;
    }

    const r = await buscarPersonasDocumento(sb, {
      tenant: actor.tenant,
      tipoDoc,
      numero: numeroDoc,
      limite: LIMITE_MAX_OBSERVACIONES,
      offset: 0,
    });
    if (!r.ok) return { ok: false, codigo: "consulta", error: MSG_CONSULTA };
    return proyectar(r.data);
  } catch {
    // Nunca se reenvía el texto del error (podría nombrar objetos de la base ni el documento).
    return { ok: false, codigo: "consulta", error: MSG_CONSULTA };
  }
}
