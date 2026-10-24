// ─────────────────────────────────────────────────────────────────────────
// #90 Entrega D — lectura de las FUENTES GUARDADAS de un paquete que REALMENTE aportan al precio, con su moneda real.
//
// Lo usan el panel del armado y la cotización de la oferta #63. `generarTarifario` ya tiene estas mismas filas en memoria y llama a la misma
// función pura (`fuentesQueAportan90`, ver aporteFuentes90.ts): los tres dan el mismo veredicto porque aplican los mismos predicados
// (vigencia, fechas, destino aéreo permitido, elegibilidad y copia de una vinculada) a las mismas lecturas. Una fuente que el generador
// descarta NO se cuenta. Espejo en SQL: `public.p63_requiere_trm` (migración 233).
//
// Solo se leen columnas de identidad, fechas, vigencia y moneda de las fuentes (id, nombre, ruta, record, moneda…) y, de un Empaquetado
// vinculado, el precio de reventa y el fee (R y F, que ya viajan al tarifario): nunca el costo neto (`tarifa_proveedor`).
// Un error de lectura NUNCA se interpreta como "sin fuentes en USD": devuelve error y quien llama rechaza.
// ─────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerInfoFuentes, motivoRechazoFuente, resolverDestinosAereosPaquete } from "../paquetes/destinosAereos67.ts";
import { fuentesQueAportan90, type BloqueoVinculado90, type EmpaquetadoVinculado90, type HotelFila90, type PermiteDestino, type SalidaFila90, type ServicioFila90 } from "./aporteFuentes90.ts";
import type { FuenteMoneda90 } from "./monedaPublicacion90.ts";
import type { FuenteEmpaquetado63 } from "./ofertaDinamica63.ts";
import { hoyBogota } from "./origen.ts";
import { seleccionarSalidasVigentes } from "./salidaDinamicaVigente.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>;

export type ResultadoFuentes90 = { ok: true; fuentes: FuenteMoneda90[] } | { ok: false; error: string };

export const ERROR_LECTURA_FUENTES_90 = "No se pudieron leer las fuentes del paquete para validar su moneda. Intenta nuevamente.";

const unicos = (ids: (number | null | undefined)[]): number[] => [...new Set(ids.filter((x): x is number => typeof x === "number"))];

/** Filas por id; sin ids no consulta. `null` = error de lectura. */
async function porIds<T extends { id: number }>(ids: number[], consulta: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<Map<number, T> | null> {
  const mapa = new Map<number, T>();
  if (!ids.length) return mapa;
  const { data, error } = await consulta();
  if (error) return null;
  for (const f of (data ?? []) as T[]) mapa.set(f.id, f);
  return mapa;
}

const COLUMNAS_SALIDA = "id, activo, compra_inicio, compra_fin, fecha_ida, fecha_regreso, ruta, aerolinea, moneda, valor_tiquete, fee_infante, empaquetado_id";
const COLUMNAS_EMPAQUETADO = "id, activo, record, compra_inicio, compra_fin, fecha_ida, fecha_regreso, ruta, aerolinea, moneda, tarifa_para_empaquetar, fee_infante";

export async function cargarFuentesMoneda90(
  sb: Cliente,
  paqueteId: number,
  ctx: { tipo: string; modo63: boolean; hoy?: string }
): Promise<ResultadoFuentes90> {
  const hoy = ctx.hoy ?? hoyBogota(new Date());
  const [hot, srv, vue, emp, sal] = await Promise.all([
    sb.from("armado_hoteles").select("hotel_id").eq("paquete_id", paqueteId),
    sb.from("armado_servicios").select("servicio_id").eq("paquete_id", paqueteId),
    sb.from("armado_vuelos").select("bloqueo_id").eq("paquete_id", paqueteId),
    sb.from("armado_empaquetados").select("empaquetado_id").eq("paquete_id", paqueteId),
    ctx.tipo === "dinamico" ? sb.from("salidas_dinamicas").select(COLUMNAS_SALIDA).eq("paquete_id", paqueteId) : Promise.resolve({ data: [], error: null }),
  ]);
  if (hot.error || srv.error || vue.error || emp.error || sal.error) return { ok: false, error: ERROR_LECTURA_FUENTES_90 };

  const hotelIds = unicos(((hot.data ?? []) as { hotel_id: number }[]).map((x) => x.hotel_id));
  const servicioIds = unicos(((srv.data ?? []) as { servicio_id: number }[]).map((x) => x.servicio_id));
  const bloqueoIds = unicos(((vue.data ?? []) as { bloqueo_id: number }[]).map((x) => x.bloqueo_id));
  const empaquetadoArmadoIds = unicos(((emp.data ?? []) as { empaquetado_id: number }[]).map((x) => x.empaquetado_id));
  const salidas = (sal.data ?? []) as SalidaFila90[];
  // Misma selección que el generador: solo las salidas vigentes pueden aportar (y solo ellas hacen necesaria la guarda de destino aéreo).
  const vinculadasVigentes = ctx.tipo === "dinamico"
    ? (seleccionarSalidasVigentes(salidas as never, hoy) as unknown as { vigentes: SalidaFila90[] }).vigentes.filter((s) => s.empaquetado_id != null)
    : [];
  const empaquetadoVinculadoIds = unicos(salidas.map((s) => s.empaquetado_id));

  const idsEmpaquetados = unicos([...empaquetadoArmadoIds, ...empaquetadoVinculadoIds]);
  const [hoteles, servicios, bloqueos, empaquetados] = await Promise.all([
    porIds<HotelFila90>(hotelIds, () => sb.from("hoteles").select("id, nombre, moneda, modelo_tarifario").in("id", hotelIds)),
    porIds<ServicioFila90>(servicioIds, () => sb.from("servicios_adicionales").select("id, nombre, moneda").in("id", servicioIds)),
    porIds<BloqueoVinculado90>(bloqueoIds, () => sb.from("bloqueos_vuelo").select("id, record, ruta, fecha_ida, fecha_regreso, moneda").in("id", bloqueoIds)),
    porIds<FuenteEmpaquetado63 & { id: number }>(idsEmpaquetados, () => sb.from("empaquetados").select(COLUMNAS_EMPAQUETADO).in("id", idsEmpaquetados)),
  ]);
  if (!hoteles || !servicios || !bloqueos || !empaquetados) return { ok: false, error: ERROR_LECTURA_FUENTES_90 };

  // Guarda de destino aéreo permitido (#67/220): solo en Bloqueo con vuelos vinculados y en Dinámico con salidas vinculadas vigentes,
  // igual que el generador. Fuera de esos casos todo destino pasa.
  let permite: PermiteDestino = () => true;
  const aplicaBloqueo = ctx.tipo === "bloqueo" && bloqueoIds.length + empaquetadoArmadoIds.length > 0;
  if (aplicaBloqueo || vinculadasVigentes.length) {
    const ef = await resolverDestinosAereosPaquete(sb as never, paqueteId);
    if (!ef.ok) return { ok: false, error: ERROR_LECTURA_FUENTES_90 };
    if (!ef.efectivos.ok) return { ok: false, error: `${aplicaBloqueo ? "Bloqueo" : "Dinámico"}: ${ef.efectivos.error}` };
    const permitidos = ef.efectivos.ids;
    const fuentesAereas = aplicaBloqueo
      ? [...bloqueoIds.map((id) => ({ tipo: "bloqueo" as const, id })), ...empaquetadoArmadoIds.map((id) => ({ tipo: "empaquetado" as const, id }))]
      : unicos(vinculadasVigentes.map((s) => s.empaquetado_id)).map((id) => ({ tipo: "empaquetado" as const, id }));
    const info = await leerInfoFuentes(sb as never, fuentesAereas);
    if (!info.ok) return { ok: false, error: ERROR_LECTURA_FUENTES_90 };
    permite = (t, id) => motivoRechazoFuente(permitidos, info.info.get(`${t}:${id}`) ?? null) === null;
  }

  const vinculados = new Map<number, FuenteEmpaquetado63>();
  for (const id of empaquetadoVinculadoIds) {
    const f = empaquetados.get(id);
    if (f) vinculados.set(id, f);
  }
  return {
    ok: true,
    fuentes: fuentesQueAportan90({
      tipo: ctx.tipo,
      modo63: ctx.modo63,
      hoy,
      hoteles: hotelIds.map((id) => hoteles.get(id)).filter((h): h is HotelFila90 => !!h),
      servicios: servicioIds.map((id) => servicios.get(id)).filter((s): s is ServicioFila90 => !!s),
      bloqueos: bloqueoIds.map((id) => bloqueos.get(id) ?? null),
      empaquetados: empaquetadoArmadoIds.map((id) => (empaquetados.get(id) as EmpaquetadoVinculado90 | undefined) ?? null),
      salidas,
      fuentesVinculadas: vinculados,
      permite,
    }),
  };
}
