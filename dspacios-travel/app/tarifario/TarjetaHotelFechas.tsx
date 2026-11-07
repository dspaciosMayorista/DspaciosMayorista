"use client";

// #90 — Elegir fechas DESDE la tarjeta pública del hotel (la de «desde»): el cliente escoge fechas (porción terrestre) o una salida con fecha concreta (bloqueo, empaquetado, salida dinámica)
// y la tarjeta muestra el precio calculado para ESAS fechas junto con la regla EBB 1/2/3 o Long Stay que realmente ganó. Precio y etiqueta llegan juntos, del mismo cálculo
// (`cotizarTarjetaHotel`), y se guardan como UN solo valor: nunca se muestra una etiqueta de otro cálculo junto a un precio nuevo. Sin fechas, la tarjeta conserva su «desde» sin etiqueta.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DateInput } from "@/components/ui/DateInput";
import type { FilaResumen } from "@/lib/tarifario/resumen";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { cotizarTarjetaHotel, type TarjetaCotizada } from "./cotizarTarjetaActions";

type Cotizar = (input: unknown) => Promise<TarjetaCotizada>;
type Exito = Extract<TarjetaCotizada, { ok: true }>;

/** Lo que el cliente eligió en la tarjeta y el modal «Ver opciones» debe conservar (fechas de porción, o salida con su cotización vigente: nunca una vencida). */
export type SeleccionTarjeta =
  | { tipo: "porcion"; paqueteId: number; fechaIda: string; fechaRegreso: string }
  | { tipo: "salida"; paqueteId: number; salida: SalidaTarjeta; cot: Exito | null };

export type SalidaTarjeta = {
  clave: string; modulo: "bloqueo" | "dinamico";
  bloqueoId: number | null; empaquetadoId: number | null; salidaId: number | null;
  fechaIda: string; fechaRegreso: string | null; noches: number | null;
  combos: { categoria: string; regimen: string }[];
};

const fmt = (iso: string | null) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");
const nombreCombo = (f: FilaResumen) => `${f.categoria ?? ""}|||${f.regimen ?? ""}`;

/** Combinaciones categoría/régimen con tarifa doble publicada (la base del «desde»). */
function combosDe(filas: readonly FilaResumen[]): { categoria: string; regimen: string }[] {
  const m = new Map<string, { categoria: string; regimen: string }>();
  for (const f of filas) if (f.precio_doble != null && f.categoria && f.regimen) m.set(nombreCombo(f), { categoria: f.categoria, regimen: f.regimen });
  return [...m.values()];
}

/** Salidas con fecha concreta de la tarjeta (bloqueo/empaquetado/dinámico), de la más próxima a la más lejana; las ya vencidas no se ofrecen. */
export function salidasDeTarjeta(filas: readonly FilaResumen[], hoy: string): SalidaTarjeta[] {
  const porClave = new Map<string, FilaResumen[]>();
  for (const f of filas) {
    if ((f.modulo !== "bloqueo" && f.modulo !== "dinamico") || !f.fecha_ida || f.fecha_ida < hoy) continue;
    const k = [f.modulo, f.bloqueo_id ?? "", f.empaquetado_id ?? "", f.salida_id ?? "", f.fecha_ida].join("|");
    (porClave.get(k) ?? porClave.set(k, []).get(k)!).push(f);
  }
  const out: SalidaTarjeta[] = [];
  for (const [clave, lista] of porClave) {
    const f = lista[0];
    const combos = combosDe(lista);
    if (!combos.length) continue;
    out.push({ clave, modulo: f.modulo as "bloqueo" | "dinamico", bloqueoId: f.bloqueo_id, empaquetadoId: f.empaquetado_id, salidaId: f.salida_id, fechaIda: f.fecha_ida!, fechaRegreso: f.fecha_regreso, noches: f.noches, combos });
  }
  return out.sort((a, b) => a.fechaIda.localeCompare(b.fechaIda));
}

export type CotizacionTarjeta = {
  /** Controles de fechas/salida para colgar de la tarjeta. */
  controles: ReactNode;
  /** Precio por persona (doble) para las fechas elegidas, vigente HOY; null mientras no haya fechas, se esté recalculando o el día haya cambiado. */
  precio: { total: number; moneda: string; rotulo: string } | null;
  /** Regla que ganó en ESE mismo cálculo (null = sin descuento o sin fechas). */
  etiqueta: { etiqueta: string } | null;
  calculando: boolean;
  /** Selección actual (null = sin fechas ni salida elegidas). */
  seleccion: SeleccionTarjeta | null;
};

export function useCotizacionTarjeta({ filas, paqueteId, hotelId, ventana, cotizar = cotizarTarjetaHotel, hoy = hoyBogota }: {
  filas: readonly FilaResumen[]; paqueteId: number; hotelId: number;
  ventana?: { min: string | null; max: string | null }; cotizar?: Cotizar; hoy?: () => string;
}): CotizacionTarjeta {
  const esPorcion = filas.some((f) => f.modulo === "porcion_terrestre");
  const [dia, setDia] = useState(() => hoy());
  const [fIda, setFIda] = useState("");
  const [fReg, setFReg] = useState("");
  const [claveSalida, setClaveSalida] = useState("");
  const [cot, setCot] = useState<{ sel: string; res: Exito } | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState("");
  const secuencia = useRef(0);

  // El día de negocio puede cambiar con la pestaña abierta: se re-evalúa al volver a la pestaña y cada minuto.
  useEffect(() => {
    const revisar = () => setDia(hoy());
    const t = setInterval(revisar, 60_000);
    (t as unknown as { unref?: () => void }).unref?.(); // en Node (pruebas) no retiene el proceso; en el navegador no existe
    document.addEventListener("visibilitychange", revisar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", revisar); };
  }, [hoy]);

  const salidas = useMemo(() => (esPorcion ? [] : salidasDeTarjeta(filas, dia)), [esPorcion, filas, dia]);
  const combosPorcion = useMemo(() => combosDe(filas), [filas]);
  const minIda = ventana?.min && ventana.min > dia ? ventana.min : dia;

  const ejecutar = useCallback(async (sel: string, input: Record<string, unknown>) => {
    const mia = ++secuencia.current;
    setPendiente(true); setError("");
    try {
      const r = await cotizar(input);
      if (mia !== secuencia.current) return; // respuesta de una selección anterior: se descarta
      // `r.motivos` solo llega del servidor para roles internos (ver cotizarTarjetaActions.ts);
      // público y B2B reciben siempre `undefined` y ven exactamente el mensaje genérico.
      if (r.ok) setCot({ sel, res: r });
      else { setCot(null); setError(r.motivos?.length ? `${r.error} Motivo: ${r.motivos.join(" · ")}` : r.error); }
    } catch {
      if (mia === secuencia.current) { setCot(null); setError("No pudimos calcular el precio. Intenta de nuevo."); }
    } finally {
      if (mia === secuencia.current) setPendiente(false);
    }
  }, [cotizar]);

  const seleccionActual = useCallback((): { sel: string; input: Record<string, unknown> } | null => {
    if (esPorcion) {
      if (!fIda || !fReg || !combosPorcion.length) return null;
      return { sel: `p|${fIda}|${fReg}`, input: { modulo: "porcion_terrestre", paqueteId, hotelId, fechaIda: fIda, fechaRegreso: fReg, combos: combosPorcion } };
    }
    const s = salidas.find((x) => x.clave === claveSalida);
    if (!s) return null;
    return { sel: `s|${s.clave}`, input: { modulo: s.modulo, paqueteId, hotelId, bloqueoId: s.bloqueoId, empaquetadoId: s.empaquetadoId, salidaId: s.salidaId, combos: s.combos } };
  }, [esPorcion, fIda, fReg, combosPorcion, salidas, claveSalida, paqueteId, hotelId]);

  // Precio y etiqueta valen solo para la selección vigente Y para el día en que se calcularon.
  const sel = seleccionActual();
  const vigente = cot != null && sel != null && cot.sel === sel.sel && cot.res.fechaCalculo === dia;
  // El día cambió (o la selección ya no coincide): se descarta el par completo y se recalcula; nunca queda una etiqueta de ayer junto a un precio nuevo.
  useEffect(() => {
    if (cot && sel && cot.sel === sel.sel && cot.res.fechaCalculo !== dia && !pendiente) {
      const { sel: clave, input } = sel;
      queueMicrotask(() => { void ejecutar(clave, input); }); // fuera del cuerpo del efecto: el recálculo actualiza estado de forma asíncrona
    }
  }, [cot, sel, dia, pendiente, ejecutar]);

  function limpiar() { secuencia.current++; setCot(null); setError(""); setPendiente(false); }
  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs";

  const controles = (
    <div className="mt-3 space-y-2" data-testid="fechas-tarjeta" onClick={(e) => e.stopPropagation()}>
      {esPorcion ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-[11px] text-gray-500">Ida
              <DateInput aria-label="Ida" type="date" value={fIda} min={minIda} max={ventana?.max ?? undefined} className={inputCls}
                onValueChange={(v) => { setFIda(v); if (fReg && v && fReg <= v) setFReg(""); limpiar(); }} />
            </label>
            <label className="min-w-0 text-[11px] text-gray-500">Regreso
              <DateInput aria-label="Regreso" type="date" value={fReg} min={fIda || minIda} max={ventana?.max ?? undefined} className={inputCls}
                onValueChange={(v) => { setFReg(v); limpiar(); }} />
            </label>
          </div>
          <button type="button" disabled={pendiente || !fIda || !fReg} onClick={() => { const s = seleccionActual(); if (s) void ejecutar(s.sel, s.input); }}
            className="w-full rounded-lg border border-[var(--brand-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-accent)] disabled:opacity-50">
            {pendiente ? "Calculando…" : "Ver precio para estas fechas"}
          </button>
        </>
      ) : salidas.length > 0 ? (
        <label className="block text-[11px] text-gray-500">Salida
          <select aria-label="Elige tu salida" value={claveSalida} className={inputCls}
            onChange={(e) => {
              const k = e.target.value; setClaveSalida(k); limpiar();
              const s = salidas.find((x) => x.clave === k);
              if (s) void ejecutar(`s|${s.clave}`, { modulo: s.modulo, paqueteId, hotelId, bloqueoId: s.bloqueoId, empaquetadoId: s.empaquetadoId, salidaId: s.salidaId, combos: s.combos });
            }}>
            <option value="">Elige una salida para ver tu precio</option>
            {salidas.map((s) => <option key={s.clave} value={s.clave}>{fmt(s.fechaIda)} → {fmt(s.fechaRegreso)}{s.noches ? ` · ${s.noches}N` : ""}</option>)}
          </select>
        </label>
      ) : null}
      {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
    </div>
  );

  const r = vigente ? cot!.res : null;
  const salidaSel = esPorcion ? undefined : salidas.find((x) => x.clave === claveSalida);
  const seleccion: SeleccionTarjeta | null = esPorcion
    ? (fIda && fReg ? { tipo: "porcion", paqueteId, fechaIda: fIda, fechaRegreso: fReg } : null)
    : (salidaSel ? { tipo: "salida", paqueteId, salida: salidaSel, cot: r } : null);
  return {
    controles, seleccion,
    precio: r ? { total: r.precio, moneda: r.moneda, rotulo: `${fmt(r.fechaIda)} → ${fmt(r.fechaRegreso)}${r.noches ? ` · ${r.noches}N` : ""}` } : null,
    etiqueta: r?.descuentoHotel ? { etiqueta: r.descuentoHotel.etiqueta } : null,
    calculando: pendiente || (cot != null && sel != null && cot.sel === sel.sel && !vigente),
  };
}
