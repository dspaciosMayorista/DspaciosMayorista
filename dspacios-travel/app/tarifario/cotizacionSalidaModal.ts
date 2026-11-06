"use client";

// #90 — Precio de la salida ACTIVA dentro de «Ver opciones». Cada salida elegida en el modal se calcula con la misma acción que la tarjeta
// (`cotizarTarjetaHotel` → `computarReserva`): importes por acomodación, total y etiqueta EBB/Long Stay salen del mismo resultado.
// Una cotización por salida (nunca todas de golpe), guardada por clave: una respuesta tardía de otra salida solo llena SU casilla y no toca la activa.
// Vale solo el día de negocio de Bogotá en que se calculó; si el día cambia con el modal abierto, caduca y se recalcula.
import { useCallback, useEffect, useRef, useState } from "react";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { cotizarTarjetaHotel, type TarjetaCotizada } from "./cotizarTarjetaActions";

export type CotizadaSalida = Extract<TarjetaCotizada, { ok: true }>;
export type EstadoCotizacionSalida = "ninguna" | "cargando" | "ok" | "error";
export type CotizacionSalida = { estado: EstadoCotizacionSalida; cot: CotizadaSalida | null; error: string; reintentar: () => void };

type FilaSalida = {
  modulo?: string | null; bloqueo_id?: number | null; empaquetado_id?: number | null; salida_id?: number | null; fecha_ida?: string | null;
  acomodacion?: string | null; categoria?: string | null; regimen?: string | null; precio_pvp?: number | null;
};

/** Misma clave que usa la tarjeta para identificar una salida (SalidaTarjeta.clave): permite reutilizar su cotización como semilla. */
export const claveSalidaFila = (f: FilaSalida) => [f.modulo ?? "", f.bloqueo_id ?? "", f.empaquetado_id ?? "", f.salida_id ?? "", f.fecha_ida ?? ""].join("|");

/** Entrada de la acción para UNA salida a partir de sus filas de detalle: categorías/regímenes con tarifa doble (la base del «desde»). null = no hay con qué cotizar. */
export function entradaSalida(filas: readonly FilaSalida[], paqueteId: number, hotelId: number): { clave: string; input: Record<string, unknown> } | null {
  const f = filas[0];
  if (!f || (f.modulo !== "bloqueo" && f.modulo !== "dinamico")) return null;
  const combos = new Map<string, { categoria: string; regimen: string }>();
  for (const x of filas) if (x.acomodacion === "doble" && (x.precio_pvp ?? 0) > 0 && x.categoria && x.regimen) combos.set(`${x.categoria}|||${x.regimen}`, { categoria: x.categoria, regimen: x.regimen });
  if (!combos.size) return null;
  return {
    clave: claveSalidaFila(f),
    input: { modulo: f.modulo, paqueteId, hotelId, bloqueoId: f.bloqueo_id ?? null, empaquetadoId: f.empaquetado_id ?? null, salidaId: f.salida_id ?? null, combos: [...combos.values()] },
  };
}

export function useCotizacionSalidaModal({ activa, semilla = null, cotizar = cotizarTarjetaHotel, hoy = hoyBogota }: {
  /** Salida a calcular; null = el modal conserva los precios publicados (sin selección). */
  activa: { clave: string; input: Record<string, unknown> } | null;
  /** Cotización que la tarjeta ya calculó para su salida (se reutiliza si es de hoy). */
  semilla?: { clave: string; cot: CotizadaSalida | null } | null;
  cotizar?: (input: unknown) => Promise<TarjetaCotizada>;
  hoy?: () => string;
}): CotizacionSalida & { cotizadaDe: (clave: string) => CotizadaSalida | null } {
  const [dia, setDia] = useState(() => hoy());
  const [cache, setCache] = useState<Record<string, CotizadaSalida>>({});
  const [errores, setErrores] = useState<Record<string, { dia: string; msg: string }>>({});
  const [intento, setIntento] = useState(0);
  const pedidas = useRef(new Set<string>());
  const entrada = useRef(activa);
  useEffect(() => { entrada.current = activa; }, [activa]);

  useEffect(() => {
    const revisar = () => setDia(hoy());
    const t = setInterval(revisar, 60_000);
    (t as unknown as { unref?: () => void }).unref?.(); // en Node (pruebas) no retiene el proceso
    document.addEventListener("visibilitychange", revisar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", revisar); };
  }, [hoy]);

  const cotizadaDe = useCallback((k: string): CotizadaSalida | null => {
    const c = cache[k] ?? (semilla?.clave === k ? semilla.cot : null);
    return c && c.fechaCalculo === dia ? c : null;
  }, [cache, semilla, dia]);

  const clave = activa?.clave ?? null;
  const vigente = clave != null ? cotizadaDe(clave) : null;
  // El error vale solo el dia de negocio en que ocurrio: al cambiar el dia caduca y se vuelve a cotizar.
  const error = clave != null && errores[clave]?.dia === dia ? errores[clave].msg : "";

  useEffect(() => {
    if (!activa || vigente || error) return;
    const marca = `${activa.clave}|${dia}|${intento}`;
    if (pedidas.current.has(marca)) return;
    pedidas.current.add(marca);
    const k = activa.clave;
    const falla = (msg: string) => setErrores((e) => ({ ...e, [k]: { dia, msg } }));
    cotizar(activa.input).then(
      // `r.motivos` solo llega del servidor para roles internos (ver cotizarTarjetaActions.ts);
      // público y B2B reciben siempre `undefined` y ven exactamente el mismo mensaje genérico.
      (r) => { if (r.ok) setCache((c) => ({ ...c, [k]: r })); else falla(r.motivos?.length ? `${r.error} Motivo: ${r.motivos.join(" · ")}` : r.error); },
      () => falla("No pudimos calcular el precio. Intenta de nuevo."),
    );
  }, [activa, vigente, error, dia, intento, cotizar]);

  const reintentar = useCallback(() => {
    const a = entrada.current;
    if (a) setErrores((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== a.clave)));
    setIntento((i) => i + 1);
  }, []);

  const estado: EstadoCotizacionSalida = clave == null ? "ninguna" : vigente ? "ok" : error ? "error" : "cargando";
  return { estado, cot: vigente, error, reintentar, cotizadaDe };
}

export type CotizacionFila = { estado: "cargando" } | { estado: "error"; mensaje: string } | { estado: "ok"; cot: CotizadaSalida };

/**
 * Vista tabla: cotiza, con el mismo motor, los hoteles de UNA salida seleccionada (una entrada por hotel; cada una cubre todas sus categorías/regímenes).
 * Solo se piden las entradas recibidas (nunca otras salidas), como máximo `concurrencia` a la vez, y cada resultado vale el día de negocio en que se calculó.
 */
export function useCotizacionesHoteles({ entradas, concurrencia = 3, cotizar = cotizarTarjetaHotel, hoy = hoyBogota }: {
  entradas: readonly { clave: string; input: Record<string, unknown> }[];
  concurrencia?: number;
  cotizar?: (input: unknown) => Promise<TarjetaCotizada>;
  hoy?: () => string;
}): { de: (clave: string) => CotizacionFila; reintentar: (clave: string) => void } {
  const [dia, setDia] = useState(() => hoy());
  const [cache, setCache] = useState<Record<string, CotizadaSalida>>({});
  const [errores, setErrores] = useState<Record<string, { dia: string; msg: string }>>({});
  const pedidas = useRef(new Set<string>());
  const enVuelo = useRef(0);

  useEffect(() => {
    const revisar = () => setDia(hoy());
    const t = setInterval(revisar, 60_000);
    (t as unknown as { unref?: () => void }).unref?.();
    document.addEventListener("visibilitychange", revisar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", revisar); };
  }, [hoy]);

  const vigenteDe = useCallback((k: string) => (cache[k]?.fechaCalculo === dia ? cache[k] : null), [cache, dia]);
  const errorDe = useCallback((k: string) => (errores[k]?.dia === dia ? errores[k].msg : ""), [errores, dia]);

  useEffect(() => {
    for (const e of entradas) {
      if (enVuelo.current >= concurrencia) break;
      if (vigenteDe(e.clave) || errorDe(e.clave)) continue;
      const marca = `${e.clave}|${dia}`;
      if (pedidas.current.has(marca)) continue;
      pedidas.current.add(marca);
      enVuelo.current++;
      const k = e.clave;
      cotizar(e.input).then(
        // `r.motivos` solo llega del servidor para roles internos (ver cotizarTarjetaActions.ts).
        (r) => { enVuelo.current--; if (r.ok) setCache((c) => ({ ...c, [k]: r })); else setErrores((x) => ({ ...x, [k]: { dia, msg: r.motivos?.length ? `${r.error} Motivo: ${r.motivos.join(" · ")}` : r.error } })); },
        () => { enVuelo.current--; setErrores((x) => ({ ...x, [k]: { dia, msg: "No pudimos calcular el precio. Intenta de nuevo." } })); },
      );
    }
  }, [entradas, concurrencia, vigenteDe, errorDe, dia, cotizar]);

  const de = useCallback((k: string): CotizacionFila => {
    const v = vigenteDe(k);
    if (v) return { estado: "ok", cot: v };
    const m = errorDe(k);
    return m ? { estado: "error", mensaje: m } : { estado: "cargando" };
  }, [vigenteDe, errorDe]);

  const reintentar = useCallback((k: string) => {
    pedidas.current.delete(`${k}|${dia}`);
    setErrores((x) => Object.fromEntries(Object.entries(x).filter(([c]) => c !== k)));
  }, [dia]);

  return { de, reintentar };
}
