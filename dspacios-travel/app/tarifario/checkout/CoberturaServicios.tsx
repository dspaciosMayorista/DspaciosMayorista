"use client";

// #94/#52 — Cobertura de los servicios en la cotización NORMAL (un solo hotel). La unidad hotelera única es el contexto: no se pide asignar el servicio a otra cosa.
//   · Por defecto un servicio cubre a TODOS los pasajeros del hotel. Si cubre a menos (su `pax` < pasajeros del hotel) hay que marcar a cuáles.
//   · Cada pasajero tiene una identidad estable `clave#ordinal` (lib/cotizacion/cuposEstables.ts) que sobrevive a editar el carrito; si desaparece uno marcado,
//     la cobertura queda por revisar y la cotización no se emite hasta corregirla.
//   · Los pasajeros salen de la liquidación del servidor (`cuposDeCarrito`): aquí solo se eligen, no se calcula ningún importe.
import { useEffect, useMemo, useState } from "react";
import { cuposDeCarrito } from "./actions";
import { coberturasInvalidas, reconciliarCupos, type EstadoCupos } from "@/lib/cotizacion/cuposEstables";
import type { CupoPublico } from "@/lib/cotizacion/resumenCarrito";

export type ServicioCobertura = { id: string; nombre: string; pax: number; tipo: "tour" | "manual"; indice: number; ligado: boolean };
type Seleccion = Record<string, string[]>; // servicio → ids elegidos (ausente = cobertura total)
// Lo guardado es una COMODIDAD del navegador (conservar la selección al editar), nunca una fuente de verdad: el servidor valida todo al emitir. Para no heredar
// cobertura de otra operación cada entrada: (1) cuelga del id del ítem del carrito (único por ítem), (2) lleva la huella de ESA reserva (paquete, hotel, fechas,
// categoría, régimen — no las habitaciones, que se editan) y si no coincide se descarta, (3) vence a los 14 días y (4) se purga cuando su hotel ya no está en el carrito.
type Guardado = { estado: EstadoCupos | null; seleccion: Seleccion; huella?: string; ts?: number };
const CLAVE = "cobertura94";
const VIDA_MS = 14 * 24 * 3600 * 1000;
const vacio = (): Guardado => ({ estado: null, seleccion: {} });
const tabla = (): Record<string, Guardado> => {
  try { const t = JSON.parse(window.localStorage.getItem(CLAVE) ?? "{}"); return t && typeof t === "object" && !Array.isArray(t) ? t : {}; } catch { return {}; }
};
const guardarTabla = (t: Record<string, Guardado>) => { try { window.localStorage.setItem(CLAVE, JSON.stringify(t)); } catch { /* sin almacenamiento: vive en memoria */ } };

export function leerGuardado(hotelId: string, huella: string, ahora = Date.now()): Guardado {
  const g = tabla()[hotelId];
  if (!g || g.huella !== huella || typeof g.ts !== "number" || ahora - g.ts > VIDA_MS) return vacio();
  return { estado: g.estado ?? null, seleccion: g.seleccion && typeof g.seleccion === "object" ? g.seleccion : {} };
}
const escribir = (hotelId: string, huella: string, g: Guardado) => { const t = tabla(); t[hotelId] = { ...g, huella, ts: Date.now() }; guardarTabla(t); };
/** Quita lo de hoteles que ya no están en el carrito y lo vencido. */
export function purgarGuardado(vigentes: readonly string[], ahora = Date.now()) {
  const t = tabla(); let cambio = false;
  for (const [k, g] of Object.entries(t)) {
    if (!vigentes.includes(k) || typeof g?.ts !== "number" || ahora - g.ts > VIDA_MS) { delete t[k]; cambio = true; }
  }
  if (cambio) guardarTabla(t);
}

export type CoberturaNormal = {
  panel: React.ReactNode;
  /** Qué enviar al servidor (null = nada que declarar). */
  cobertura: { cupos: Record<number, Record<string, number[]>>; tours: Record<number, { hotel: number | null; cubre?: string[] }>; manuales: Record<number, { hotel: number | null; cubre?: string[] }> } | null;
  /** Motivo por el que NO se puede emitir todavía (cobertura sin elegir, incompleta o por revisar). */
  bloqueo: string | null;
};

export function useCoberturaNormal(p: { activo: boolean; hotelId: string | null; huella: string; hotelesVigentes: readonly string[]; entrada: unknown; servicios: ServicioCobertura[]; paxHotel: number }): CoberturaNormal {
  const { activo, hotelId, huella, hotelesVigentes, entrada, servicios } = p;
  const clave = useMemo(() => (activo ? JSON.stringify(entrada) : ""), [activo, entrada]);
  // Una respuesta de cupos SOLO sirve para la entrada exacta (`clave`) que la originó. Los pasajeros, su identidad y la selección ya reconciliada viajan juntos:
  // mientras la respuesta de la entrada actual no llega, no hay cupos ni selección utilizables (nunca los de la entrada anterior).
  type Datos = { clave: string; cupos: CupoPublico[]; estado: EstadoCupos; pax: number; seleccion: Seleccion };
  const [datos, setDatos] = useState<Datos | null>(null);
  const [fallo, setFallo] = useState<{ clave: string; mensaje: string } | null>(null);
  const actual = datos && datos.clave === clave ? datos : null;
  const error = fallo && fallo.clave === clave ? fallo.mensaje : "";
  const cupos = actual?.cupos ?? null;
  const estado = actual?.estado ?? null;
  const seleccion: Seleccion = actual?.seleccion ?? {};
  const paxHotel = actual?.pax ?? p.paxHotel; // el total que cuenta el servidor (incluye menores e infantes); mientras tanto, el del carrito

  // Sin guardia de «última clave»: en StrictMode el efecto se limpia y se vuelve a montar, y la segunda ejecución DEBE pedir de nuevo.
  useEffect(() => {
    if (!activo || !hotelId || !clave) return;
    let vigente = true; // la limpieza (cambio de entrada o desmontaje) descarta cualquier respuesta atrasada de esta petición
    cuposDeCarrito(entrada).then((r) => {
      if (!vigente) return;
      if (!r.ok) { setFallo({ clave, mensaje: r.error }); return; }
      const h = r.hoteles[0];
      if (!h) { setFallo({ clave, mensaje: "No se pudieron determinar los pasajeros del hotel." }); return; }
      purgarGuardado(hotelesVigentes);
      const previo = leerGuardado(hotelId, huella);
      const rec = reconciliarCupos(previo.estado, Object.fromEntries(h.cupos.map((c) => [c.clave, c.cantidad])));
      setFallo(null);
      setDatos({ clave, cupos: h.cupos, estado: rec.estado, pax: h.paxTotal, seleccion: previo.seleccion });
      escribir(hotelId, huella, { estado: rec.estado, seleccion: previo.seleccion });
    }).catch(() => { if (vigente) setFallo({ clave, mensaje: "No se pudieron calcular los pasajeros. Intenta de nuevo." }); });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const ids = useMemo(() => (estado ? Object.entries(estado.activos).flatMap(([k, ords]) => ords.map((n) => `${k}#${n}`)) : []), [estado]);
  const etiqueta = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cupos ?? []) (estado?.activos[c.clave] ?? []).forEach((n, i) => m.set(`${c.clave}#${n}`, `${c.etiqueta} · pasajero ${i + 1}`));
    return m;
  }, [cupos, estado]);

  const parcial = (s: ServicioCobertura) => s.pax < paxHotel;
  const elegidos = (s: ServicioCobertura) => seleccion[s.id] ?? [];
  // Revisa también la selección vieja de un servicio que ya cubre a todos: no se descarta en silencio.
  const invalidas = useMemo(() => coberturasInvalidas(servicios.filter((s) => !s.ligado && (parcial(s) || (seleccion[s.id] ?? []).length > 0)).map((s) => ({ id: s.id, cubre: (seleccion[s.id] ?? []) as readonly string[] })), ids)
    .filter((m) => m.faltantes.length > 0), [servicios, seleccion, ids, paxHotel]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiarSeleccion = (cambio: (prev: Seleccion, vivos: Set<string>) => Seleccion) => {
    if (!hotelId) return;
    setDatos((d) => {
      if (!d || d.clave !== clave) return d; // solo sobre la respuesta de la entrada vigente
      const sig = cambio(d.seleccion, new Set(Object.entries(d.estado.activos).flatMap(([k, ords]) => ords.map((n) => `${k}#${n}`))));
      escribir(hotelId, huella, { estado: d.estado, seleccion: sig });
      return { ...d, seleccion: sig };
    });
  };
  const alternar = (s: ServicioCobertura, id: string) => cambiarSeleccion((prev, vivos) => {
    const base = (prev[s.id] ?? []).filter((x) => vivos.has(x)); // al corregir se descartan los pasajeros que ya no existen
    return { ...prev, [s.id]: base.includes(id) ? base.filter((x) => x !== id) : [...base, id] };
  });
  const usarTodos = (s: ServicioCobertura) => cambiarSeleccion((prev) => ({ ...prev, [s.id]: [] }));

  const lista = servicios.filter((s) => !s.ligado);
  let bloqueo: string | null = null;
  if (activo && lista.length) {
    // Sin los pasajeros de ESTA entrada solo se frena lo que los necesita (cobertura parcial); la cobertura total por defecto no depende de ellos.
    const hayParcial = lista.some(parcial);
    if (error && hayParcial) bloqueo = error;
    else if (!actual && hayParcial) bloqueo = "Calculando los pasajeros de la cotización…";
    else if (actual) {
      for (const s of lista) {
        const mal = invalidas.find((m) => m.servicio.id === s.id);
        const sel = elegidos(s);
        if (!parcial(s) && !mal) continue;
        if (mal) { bloqueo = `Revisa la cobertura de «${s.nombre}»: un pasajero que tenía marcado ya no está en la cotización.`; break; }
        if (sel.length !== s.pax) { bloqueo = `«${s.nombre}» cubre ${s.pax} de los ${paxHotel} pasajeros: marca ${s.pax} (marcados: ${sel.length}).`; break; }
      }
    }
  }

  // Solo se declara cobertura con los pasajeros de la entrada vigente.
  const cobertura: CoberturaNormal["cobertura"] = !activo || !lista.length || !estado ? null : (() => {
    const out: NonNullable<CoberturaNormal["cobertura"]> = { cupos: { 0: estado.activos }, tours: {}, manuales: {} };
    for (const s of lista) {
      const parte = { hotel: 0, ...(parcial(s) ? { cubre: elegidos(s) } : {}) };
      (s.tipo === "tour" ? out.tours : out.manuales)[s.indice] = parte;
    }
    return out;
  })();

  const panel = !activo || !lista.length ? null : (
    <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="cobertura-servicios">
      <h2 className="text-sm font-semibold text-gray-700">Pasajeros que cubre cada servicio</h2>
      <p className="mt-1 text-[11px] text-gray-400">Por defecto cada servicio cubre a todos los pasajeros del hotel ({paxHotel}). Si cubre a menos, marca a cuáles.</p>
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
      <ul className="mt-3 space-y-3">
        {lista.map((s) => {
          const mal = invalidas.some((m) => m.servicio.id === s.id);
          const sel = elegidos(s);
          return (
            <li key={s.id} data-testid="cobertura-servicio" className="rounded-lg bg-gray-50 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800">{s.nombre}</span>
                <span className="text-gray-500">{parcial(s) ? `Cubre ${s.pax} de ${paxHotel}` : `Cubre a todos (${paxHotel})`}</span>
              </div>
              {parcial(s) && cupos && (
                <fieldset className="mt-2 grid gap-1 sm:grid-cols-2">
                  <legend className="sr-only">Pasajeros cubiertos por {s.nombre}</legend>
                  {ids.map((id) => (
                    <label key={id} className="flex items-center gap-2">
                      <input type="checkbox" checked={sel.includes(id)} onChange={() => alternar(s, id)} aria-label={`${s.nombre}: ${etiqueta.get(id) ?? id}`} />
                      <span>{etiqueta.get(id) ?? id}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {mal && (
                <p className="mt-2 font-medium text-amber-700" role="alert" data-testid="cobertura-revisar">
                  Revisa la cobertura: un pasajero marcado ya no está en la cotización.
                  {!parcial(s) && <button type="button" onClick={() => usarTodos(s)} className="ml-2 underline">Cubrir a todos</button>}
                </p>
              )}
              {parcial(s) && !mal && sel.length !== s.pax && <p className="mt-2 text-gray-500">Marca {s.pax} pasajeros (marcados: {sel.length}).</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );

  return { panel, cobertura, bloqueo };
}
