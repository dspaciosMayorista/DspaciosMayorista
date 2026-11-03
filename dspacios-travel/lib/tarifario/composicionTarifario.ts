// Composición del precio de un tarifario PUBLICADO (hotel, vuelo, servicios incluidos, markup, redondeo por acomodación), guardada al generar el tarifario
// en `tarifario_resultado_composicion` (migración 273: tabla privada, solo service_role). Una fila por estadía × hotel × categoría × régimen × origen.
// La cotización de bloqueo/empaquetado/salida la LEE (no la recalcula) y solo la usa si el precio de cada línea es exactamente el publicado.
// Módulo sin dependencias de Next: las funciones de I/O reciben el cliente ya creado (se prueban con un cliente falso).

import type { BaseMotor } from "../cotizacion/composicionPrecio.ts";

export type OrigenClave = "b" | "e" | "s" | "p";

/** Llave natural de la estadía publicada. Debe ser idéntica al generar (fila publicada) y al cotizar (fila leída). */
export function claveComposicion(a: { origen: OrigenClave; origenId: number | null; hotelId: number; categoria: string; regimen: string; fechaIda: string; noches: number }): string {
  return [`${a.origen}${a.origenId ?? ""}`, a.hotelId, a.categoria, a.regimen, a.fechaIda, a.noches].join("|");
}

/** Origen de la cotización (`resolverOrigenVuelo`) → letra de la llave. «ninguno» = porción terrestre (nunca se compone: su precio es «desde»). */
export function origenDeClave(o: { tipo: "bloqueo" | "empaquetado" | "salida" | "ninguno"; id?: number }): { origen: OrigenClave; origenId: number | null } {
  if (o.tipo === "bloqueo") return { origen: "b", origenId: o.id ?? null };
  if (o.tipo === "empaquetado") return { origen: "e", origenId: o.id ?? null };
  if (o.tipo === "salida") return { origen: "s", origenId: o.id ?? null };
  return { origen: "p", origenId: null };
}

/** Origen de una fila publicada (bloqueo / empaquetado / salida dinámica / ninguno) → letra e id de la llave. */
export function origenClaveDeFila(bloqueoId: number | null, empaquetadoId: number | null, salidaId: number | null): { origen: OrigenClave; origenId: number | null } {
  if (bloqueoId != null) return { origen: "b", origenId: bloqueoId };
  if (empaquetadoId != null) return { origen: "e", origenId: empaquetadoId };
  if (salidaId != null) return { origen: "s", origenId: salidaId };
  return { origen: "p", origenId: null };
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Lectura estricta de lo guardado; null si no es una base válida (la cotización dirá que no se conservó). */
export function leerBaseGuardada(raw: unknown): BaseMotor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!esNum(r.pctMk) || !esNum(r.impuesto) || !esNum(r.vuelo) || !esNum(r.feeInfante) || (r.vueloNeto != null && !esNum(r.vueloNeto))) return null;
  if (!Array.isArray(r.servicios) || typeof r.netos !== "object" || r.netos === null || typeof r.pvps !== "object" || r.pvps === null) return null;
  const servicios: BaseMotor["servicios"] = [];
  for (const s of r.servicios) {
    const x = s as Record<string, unknown>;
    if (typeof x?.nombre !== "string" || !esNum(x.neto) || !esNum(x.netoMenor)) return null;
    const o = x.origen as { monto?: unknown; montoMenor?: unknown; moneda?: unknown } | undefined;
    if (o != null && (!esNum(o.monto) || !esNum(o.montoMenor) || typeof o.moneda !== "string")) return null;
    servicios.push({ nombre: x.nombre, neto: x.neto, netoMenor: x.netoMenor, ...(o ? { origen: { monto: o.monto as number, montoMenor: o.montoMenor as number, moneda: o.moneda as string } } : {}) });
  }
  const netos: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.netos as Record<string, unknown>)) { if (!esNum(v)) return null; netos[k] = v; }
  const pvps: NonNullable<BaseMotor["pvps"]> = {};
  for (const [k, v] of Object.entries(r.pvps as Record<string, unknown>)) {
    const x = v as { pvp?: unknown; pvpMenor2?: unknown };
    if (!esNum(x?.pvp) || (x.pvpMenor2 != null && !esNum(x.pvpMenor2))) return null;
    pvps[k] = { pvp: x.pvp, pvpMenor2: x.pvpMenor2 == null ? null : (x.pvpMenor2 as number) };
  }
  const netosOrigen: NonNullable<BaseMotor["netosOrigen"]> = {};
  if (r.netosOrigen != null) {
    if (typeof r.netosOrigen !== "object") return null;
    for (const [k, v] of Object.entries(r.netosOrigen as Record<string, unknown>)) {
      const x = v as { monto?: unknown; moneda?: unknown };
      if (!esNum(x?.monto) || typeof x.moneda !== "string") return null;
      netosOrigen[k] = { monto: x.monto, moneda: x.moneda };
    }
  }
  if (r.trm != null && !esNum(r.trm)) return null;
  const f = r.fijo as { mayor2?: unknown; menor2?: unknown } | undefined;
  return {
    pctMk: r.pctMk, impuesto: r.impuesto, vuelo: r.vuelo, vueloNeto: r.vueloNeto == null ? null : (r.vueloNeto as number), feeInfante: r.feeInfante,
    servicios, netos, pvps, ...(f ? { fijo: { mayor2: f.mayor2 === true, menor2: f.menor2 === true } } : {}),
    trm: r.trm == null ? null : (r.trm as number), ...(Object.keys(netosOrigen).length ? { netosOrigen } : {}),
  };
}

// Cliente de Supabase tipado de forma mínima (el encadenado real lo valida el cliente; las pruebas usan uno falso).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = { from: (t: string) => any };

export type ComposicionCombo = { clave: string; base: BaseMotor };

/**
 * Guarda las composiciones de UNA generación (antes de publicarla). Mejor esfuerzo: el tarifario no depende de esto; si falla, las cotizaciones de esa
 * generación dirán que el desglose no fue conservado. Limpia las generaciones anteriores a la VIGENTE (nunca la que hoy se vende).
 */
export async function guardarComposicionesTarifario(admin: unknown, a: { paqueteId: number; generacion: number; vigente: number | null; combos: ComposicionCombo[] }): Promise<{ ok: boolean; guardadas: number }> {
  const sb = admin as Cliente;
  let guardadas = 0;
  const TAM = 200;
  for (let i = 0; i < a.combos.length; i += TAM) {
    const lote = a.combos.slice(i, i + TAM).map((c) => ({ paquete_id: a.paqueteId, generacion: a.generacion, clave: c.clave, composicion: c.base }));
    const { error } = await sb.from("tarifario_resultado_composicion").upsert(lote, { onConflict: "paquete_id,generacion,clave" });
    if (error) { console.error(`composicion_tarifario: no se guardó el lote ${i / TAM} (paquete ${a.paqueteId})`); return { ok: false, guardadas }; }
    guardadas += lote.length;
  }
  if (a.vigente != null) {
    const { error } = await sb.from("tarifario_resultado_composicion").delete().eq("paquete_id", a.paqueteId).lt("generacion", a.vigente);
    if (error) console.error(`composicion_tarifario: no se limpiaron generaciones anteriores (paquete ${a.paqueteId})`);
  }
  return { ok: true, guardadas };
}

/** Composición de la generación PUBLICADA para una estadía. El llamador ya autorizó la cotización; null = no se conservó (o ilegible). */
export async function leerComposicionTarifario(admin: unknown, a: { paqueteId: number; generacionPublicada: number | null; clave: string }): Promise<BaseMotor | null> {
  if (a.generacionPublicada == null) return null;
  const sb = admin as Cliente;
  const { data, error } = await sb.from("tarifario_resultado_composicion").select("composicion").eq("paquete_id", a.paqueteId).eq("generacion", a.generacionPublicada).eq("clave", a.clave).maybeSingle();
  if (error || !data) return null;
  return leerBaseGuardada((data as { composicion: unknown }).composicion);
}
