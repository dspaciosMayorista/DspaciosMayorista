// #13 — Lectura acotada de las vigencias de compra por vencer (cuatro fuentes, ver vencimientoCompra.ts). Solo lectura; el cliente lo decide quien llama:
// el digest diario usa service-role; la pantalla de Paquetes usa la sesión del usuario (la RLS de cada tabla sigue aplicando).
//
// Trabajo acotado por diseño: 4 consultas por ejecución (no por paquete), cada una filtrada por la ventana [hoy, hoy + días] y por TODA la elegibilidad EN LA CONSULTA (la fuente activa y, para salidas y empaquetados,
// el paquete activo vinculado, con INNER JOIN): el tope de LIMITE filas se aplica DESPUÉS de excluir lo no elegible, así que un candidato excluido nunca desplaza a uno elegible. Si una consulta alcanza el tope se devuelve
// `truncado = true` aunque la lista quede vacía (la pantalla lo dice); nunca se pagina sin fin ni se descarta en silencio.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  avisosEmpaquetados, avisosPaquetes, avisosPaquetesTotales, avisosSalidas, normalizarDias, ordenarAvisos, ventanaAviso,
  type AvisoCompra, type FilaEmpaquetado, type FilaPaquete, type FilaPaqueteTotal, type FilaSalida,
} from "./vencimientoCompra.ts";

export const LIMITE_AVISOS_COMPRA = 200;

export type ResultadoAvisosCompra = { ok: true; avisos: AvisoCompra[]; truncado: boolean } | { ok: false; error: string };

// El cliente se tipa laxo a propósito: las cuatro tablas tienen RLS distinta y el resultado se normaliza a `Fila*` antes de usarse.
type Cliente = Pick<SupabaseClient, "from">;

type Rel<T> = T | T[] | null;
const uno = <T,>(v: Rel<T> | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function cargarAvisosCompra(cliente: Cliente, hoy: string, diasEntrada: number): Promise<ResultadoAvisosCompra> {
  const dias = normalizarDias(diasEntrada);
  const { desde, hasta } = ventanaAviso(hoy, dias);
  const tope = LIMITE_AVISOS_COMPRA + 1;

  const [pq, sal, emp, tot] = await Promise.all([
    cliente.from("armado_paquetes").select("id, nombre, activo, fecha_compra_fin").eq("activo", true).gte("fecha_compra_fin", desde).lte("fecha_compra_fin", hasta).order("fecha_compra_fin").limit(tope),
    cliente.from("salidas_dinamicas").select("id, paquete_id, activo, compra_fin, fecha_ida, fecha_regreso, armado_paquetes!inner(nombre, activo)").eq("activo", true).eq("armado_paquetes.activo", true).gte("compra_fin", desde).lte("compra_fin", hasta).order("compra_fin").limit(tope),
    cliente.from("empaquetados").select("id, activo, compra_fin, ruta, fecha_ida, armado_empaquetados!inner(armado_paquetes!inner(id, nombre, activo))").eq("activo", true).eq("armado_empaquetados.armado_paquetes.activo", true).gte("compra_fin", desde).lte("compra_fin", hasta).order("compra_fin").limit(tope),
    cliente.from("paquete_din").select("id, nombre, activo, publicado, compra_fin").eq("activo", true).eq("publicado", true).gte("compra_fin", desde).lte("compra_fin", hasta).order("compra_fin").limit(tope),
  ]);
  // Un error de lectura NUNCA se presenta como «no hay avisos»: quien llama debe distinguirlo.
  for (const [nombre, r] of [["paquetes", pq], ["salidas dinámicas", sal], ["empaquetados", emp], ["paquetes dinámicos totales", tot]] as const) {
    if (r.error) return { ok: false, error: `No se pudieron leer las vigencias de ${nombre}.` };
  }

  const filasPq = (pq.data ?? []) as FilaPaquete[];
  const filasSal = ((sal.data ?? []) as unknown as (Omit<FilaSalida, "paquete"> & { armado_paquetes: Rel<{ nombre: string; activo: boolean }> })[]).map((r) => ({ ...r, paquete: uno(r.armado_paquetes) })) as FilaSalida[];
  const filasEmp = ((emp.data ?? []) as unknown as (Omit<FilaEmpaquetado, "paquetes"> & { armado_empaquetados: { armado_paquetes: Rel<{ id: number; nombre: string; activo: boolean }> }[] | null })[]).map((r) => ({
    ...r,
    paquetes: (r.armado_empaquetados ?? []).map((a) => uno(a.armado_paquetes)).filter((p): p is { id: number; nombre: string; activo: boolean } => p !== null),
  })) as FilaEmpaquetado[];
  const filasTot = (tot.data ?? []) as FilaPaqueteTotal[];

  const truncado = [filasPq, filasSal, filasEmp, filasTot].some((f) => f.length > LIMITE_AVISOS_COMPRA);
  const avisos = ordenarAvisos([
    ...avisosPaquetes(filasPq.slice(0, LIMITE_AVISOS_COMPRA), hoy, dias),
    ...avisosSalidas(filasSal.slice(0, LIMITE_AVISOS_COMPRA), hoy, dias),
    ...avisosEmpaquetados(filasEmp.slice(0, LIMITE_AVISOS_COMPRA), hoy, dias),
    ...avisosPaquetesTotales(filasTot.slice(0, LIMITE_AVISOS_COMPRA), hoy, dias),
  ]);
  return { ok: true, avisos, truncado };
}
