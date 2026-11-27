"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { estadoTarifariosDeHotel, reanudarTarifariosDeHotel } from "../../../paquetes/actions";

// #103 (H2/R2-5/R3-3): estado de la actualización de tarifarios LEÍDO de la base. El servidor lo calcula al cargar la página; después este componente lo sigue con la acción ESTRECHA `estadoTarifariosDeHotel`
// (una lectura de la deuda persistida), NUNCA con `router.refresh()` periódico: refrescar re-ejecuta toda la página del hotel (categorías, tarifas, calculadoras, otros hoteles, fotos, proveedores, historial).
//  · reanudación automática ACOTADA (R2-5): al abrir, con trabajo pendiente, NINGÚN cálculo vivo y el cambio más antiguo pasada la gracia (`reanudarSolo`), se reanuda solo (máx. REANUDAR_MAX veces por vista;
//    un segundo intento solo tras una lectura posterior, nunca seguido del primero);
//  · seguimiento: una lectura estrecha cada 15 s, máx. SONDEO_MAX lecturas (≈5 min visibles). UNA operación a la vez (temporizador encadenado: la siguiente lectura se programa al TERMINAR la anterior, y nunca se
//    solapa con una reanudación); con la pestaña OCULTA no se hace ninguna lectura ni se gasta cupo, y al volver se lee de inmediato si ya pasó el intervalo; tras SONDEO_ERRORES_MAX fallos seguidos se detiene y lo dice;
//  · UNA SOLA recarga completa (`router.refresh()`), cuando la lectura confirma que ya no hay trabajo pendiente: es lo que actualiza el resto de la página. Sin deuda el componente no se monta: no hay sondeo en reposo.
//  · varias pestañas: cada pestaña VISIBLE tiene su propio sondeo (no hay coordinación entre pestañas): el costo crece linealmente con las pestañas visibles, cada una acotada por SONDEO_MAX.
export const SONDEO_MS = 15_000, SONDEO_MAX = 20, SONDEO_ERRORES_MAX = 3, REANUDAR_MAX = 2;

type Estado = { texto: string; hayPorReanudar: boolean; reanudarSolo: boolean };
type Lectura = { ok: false } | { ok: true; terminado: true } | { ok: true; terminado: false; estado: Estado };

export function EstadoTarifarios({ hotelId, texto, hayPorReanudar, reanudarSolo = false }: { hotelId: number; texto: string; hayPorReanudar: boolean; reanudarSolo?: boolean }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [auto, setAuto] = useState(false);
  const [estado, setEstado] = useState<Estado>({ texto, hayPorReanudar, reanudarSolo });
  const [detenido, setDetenido] = useState(false);
  const intentos = useRef(0);          // automatic resumes started in this page view
  const enVuelo = useRef(false);       // one read OR one resume at a time (they never overlap)
  const lecturas = useRef(0), errores = useRef(0), terminado = useRef(false), vivo = useRef(true), ultimaLectura = useRef(0);
  const reiniciar = useRef<() => void>(() => {});

  // a new server render (another edit refreshed the page) is a fresh observation: take its state and start a new polling budget
  useEffect(() => { setEstado({ texto, hayPorReanudar, reanudarSolo }); lecturas.current = 0; errores.current = 0; setDetenido(false); }, [texto, hayPorReanudar, reanudarSolo]);

  /** One NARROW read of the persisted state. A finished debt triggers the single full refresh. Never throws. */
  async function leer(): Promise<Lectura> {
    ultimaLectura.current = Date.now();
    try {
      const r = await estadoTarifariosDeHotel(hotelId);
      if (!r.ok) return { ok: false };
      if (!r.texto) { terminado.current = true; if (vivo.current) router.refresh(); return { ok: true, terminado: true }; }
      const e: Estado = { texto: r.texto, hayPorReanudar: r.porReanudar > 0, reanudarSolo: r.reanudarSolo };
      if (vivo.current) setEstado(e);
      return { ok: true, terminado: false, estado: e };
    } catch { return { ok: false }; }
  }

  async function reanudar(esAuto: boolean) {
    if (enVuelo.current) return;
    enVuelo.current = true; if (esAuto) setAuto(true);
    try {
      const r = await reanudarTarifariosDeHotel(hotelId, Date.now(), { automatica: esAuto });
      if (!r.ok) setMsg({ tipo: "error", texto: r.error });
      else if (r.fallidos.length) setMsg({ tipo: "error", texto: `No se pudo actualizar ${r.fallidos.length} paquete(s). Inténtalo de nuevo; si persiste, avisa a soporte.` });
      else setMsg({ tipo: "ok", texto: esAuto ? "Tarifarios completados automáticamente." : "Tarifarios actualizados." });
    } catch { setMsg({ tipo: "error", texto: "No se pudo completar la actualización. Inténtalo de nuevo." }); }
    finally { setAuto(false); }
    const l = await leer();  // what is owed NOW decides: the banner follows it, and only a finished debt refreshes the whole page
    enVuelo.current = false;
    if (!esAuto && l.ok && !l.terminado) reiniciar.current();   // a person acted: a follow-up that had stopped starts again
  }

  // automatic completion on opening (bounded)
  useEffect(() => { if (reanudarSolo && intentos.current < REANUDAR_MAX && !enVuelo.current) { intentos.current++; void reanudar(true); } }, [reanudarSolo]);   // eslint-disable-line react-hooks/exhaustive-deps

  // bounded follow-up: chained timeout (never overlapping), paused while the tab is hidden
  useEffect(() => {
    vivo.current = true;
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const parar = () => { if (temporizador) { clearTimeout(temporizador); temporizador = null; } };
    const oculta = () => document.visibilityState === "hidden";
    const agotado = () => lecturas.current >= SONDEO_MAX || errores.current >= SONDEO_ERRORES_MAX;
    const programar = (ms = SONDEO_MS) => {
      parar();
      if (!vivo.current || terminado.current) return;
      if (agotado()) { setDetenido(true); return; }
      temporizador = setTimeout(turno, ms);
    };
    async function turno() {
      temporizador = null;
      if (!vivo.current || terminado.current || oculta()) return;      // hidden: no read, no budget; becoming visible re-arms it
      if (enVuelo.current) return void programar();                    // a resume is running: try again after the interval, without spending budget
      enVuelo.current = true; lecturas.current++;
      const l = await leer();
      enVuelo.current = false;
      errores.current = l.ok ? 0 : errores.current + 1;
      if (!vivo.current || terminado.current) return;
      // second automatic attempt only from a LATER read that still says it is owed (never right after the first)
      if (l.ok && !l.terminado && l.estado.reanudarSolo && intentos.current < REANUDAR_MAX) { intentos.current++; void reanudar(true); }
      programar();
    }
    const alCambiarVisibilidad = () => {
      if (oculta() || !vivo.current || terminado.current || temporizador || enVuelo.current || agotado()) return;
      const espera = SONDEO_MS - (Date.now() - ultimaLectura.current);
      if (espera <= 0) void turno(); else programar(espera);
    };
    reiniciar.current = () => { lecturas.current = 0; errores.current = 0; setDetenido(false); if (!oculta()) programar(); };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    programar();
    return () => { vivo.current = false; parar(); document.removeEventListener("visibilitychange", alCambiarVisibilidad); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** «Ver estado»: a person asked, so ONE narrow read (not a page refresh); it also restarts a follow-up that had stopped. */
  async function verEstado() {
    if (enVuelo.current) return;
    enVuelo.current = true;
    const l = await leer();
    enVuelo.current = false;
    if (!l.ok) { setMsg({ tipo: "error", texto: "No se pudo consultar el estado. Inténtalo de nuevo." }); return; }
    setMsg(null);
    if (!l.terminado) reiniciar.current();
  }

  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="estado-tarifarios">
      <span className="flex-1">{auto ? "Completando la actualización de tarifarios automáticamente…" : estado.texto}</span>
      <button type="button" disabled={pendiente || auto} onClick={estado.hayPorReanudar ? () => empezar(() => reanudar(false)) : () => empezar(() => verEstado())} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${pendiente || auto ? "animate-spin" : ""}`} aria-hidden /> {pendiente || auto ? "Actualizando…" : estado.hayPorReanudar ? "Actualizar ahora" : "Ver estado"}
      </button>
      {detenido && !msg && <span className="w-full text-amber-800">El seguimiento automático se detuvo. Pulsa «{estado.hayPorReanudar ? "Actualizar ahora" : "Ver estado"}» para consultar de nuevo.</span>}
      {msg && <span role={msg.tipo === "error" ? "alert" : undefined} className={msg.tipo === "error" ? "w-full text-red-700" : "w-full text-emerald-700"}>{msg.texto}</span>}
    </div>
  );
}
