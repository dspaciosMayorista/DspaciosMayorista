// Ficha CRM (#40 · H0) — consulta de ventas de un contacto, sin interpolar texto en filtros.
//
// Antes la ficha armaba `.or("cliente_documento.eq.<doc>,cliente_email.eq.<email>")` con el
// documento y el email del contacto pegados en el filtro. Ese texto puede venir de formularios
// públicos (el checkout del tarifario crea contactos): una coma o un paréntesis ahí cambia la forma
// del filtro de PostgREST. Ahora cada condición es una consulta con un solo operador y el valor viaja
// literal (`.eq`/`.ilike`); los resultados se fusionan sin repetir contratos.
//
// No cambia permisos: lee la misma tabla `ventas` con el cliente de sesión que recibe, así que la
// RLS decide qué filas llegan (un `venta` sigue sin leer la tabla base, ver migración 144).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const COLUMNAS_FICHA_VENTAS = "numero_contrato, fecha_venta, destino, precio_venta, estado";

export type VentaFicha = {
  numero_contrato: string;
  fecha_venta: string | null;
  destino: string | null;
  precio_venta: number | null;
  estado: string | null;
};

export type ContactoParaVentas = { documento: string | null; email: string | null; nombre: string | null };

export type CondicionVentas = {
  columna: "cliente_documento" | "cliente_email" | "cliente";
  operador: "eq" | "ilike";
  valor: string;
};

/**
 * Escapa un texto para usarlo DENTRO de un patrón `ilike`: `\`, `%` y `_` pasan a ser literales.
 * PostgREST además trata `*` como alias de `%` en los operadores like/ilike y no admite escaparlo;
 * se sustituye por `_` (un solo carácter cualquiera), que ensancha como mucho una posición y nunca
 * convierte el texto en un comodín de longitud libre.
 */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
}

/**
 * Qué se consulta, con la misma semántica de antes: documento y/o email (igualdad exacta); solo si
 * no hay ninguno de los dos, el nombre (contiene, sin distinguir mayúsculas).
 */
export function condicionesVentasDeContacto(c: ContactoParaVentas): CondicionVentas[] {
  const out: CondicionVentas[] = [];
  if (c.documento) out.push({ columna: "cliente_documento", operador: "eq", valor: c.documento });
  if (c.email) out.push({ columna: "cliente_email", operador: "eq", valor: c.email });
  if (out.length === 0 && c.nombre) out.push({ columna: "cliente", operador: "ilike", valor: `%${escaparLike(c.nombre)}%` });
  return out;
}

/**
 * Une los resultados de varias consultas sin repetir contratos y los deja por fecha de venta
 * descendente (los sin fecha primero, como el orden descendente de Postgres). El desempate por
 * número de contrato hace el orden determinista.
 */
export function fusionarVentas(listas: readonly (readonly VentaFicha[])[]): VentaFicha[] {
  const porContrato = new Map<string, VentaFicha>();
  for (const lista of listas) {
    for (const v of lista) if (!porContrato.has(v.numero_contrato)) porContrato.set(v.numero_contrato, v);
  }
  return [...porContrato.values()].sort((a, b) => {
    if (a.fecha_venta !== b.fecha_venta) {
      if (a.fecha_venta === null) return -1;
      if (b.fecha_venta === null) return 1;
      return a.fecha_venta < b.fecha_venta ? 1 : -1;
    }
    return a.numero_contrato < b.numero_contrato ? 1 : a.numero_contrato > b.numero_contrato ? -1 : 0;
  });
}

/**
 * Ventas de un contacto. Una consulta por condición, todas de solo lectura sobre `ventas`. Un error
 * de una consulta equivale a "sin filas" (como antes, que ignoraba el error del único `.or`).
 */
export async function cargarVentasDeContacto(sb: SupabaseClient<Database>, c: ContactoParaVentas): Promise<VentaFicha[]> {
  const condiciones = condicionesVentasDeContacto(c);
  const listas = await Promise.all(
    condiciones.map(async (cond) => {
      const base = sb.from("ventas").select(COLUMNAS_FICHA_VENTAS);
      const filtrada = cond.operador === "eq" ? base.eq(cond.columna, cond.valor) : base.ilike(cond.columna, cond.valor);
      const { data } = await filtrada.order("fecha_venta", { ascending: false });
      return (data ?? []) as unknown as VentaFicha[];
    })
  );
  return fusionarVentas(listas);
}
