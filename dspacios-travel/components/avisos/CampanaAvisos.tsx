"use client";

// Campana de avisos internos (#86). Sondeo cada 30 s (sin Realtime, sin avisos con el navegador cerrado).
// Notificación del navegador y sonido SOLO con el permiso concedido y la activación de la persona (clic). Contador y título funcionan siempre.
// Una sola pestaña "reclama" cada aviso en el servidor (atómico) → ni notificación ni sonido repetidos con varias pestañas abiertas.
// Reclamar NO marca leído: el aviso sigue en el contador y la lista hasta que la persona lo abra o pulse «Marcar todo como leído».
//
// SONIDO Y RECARGA. La preferencia («activado») se guarda en localStorage y el permiso de notificaciones lo recuerda el navegador, pero un
// AudioContext NO sobrevive a una recarga y el navegador solo deja crearlo/reanudarlo DENTRO de un gesto de la persona (política de autoplay).
// Por eso, tras recargar el sonido queda «en espera»: se arma con el primer clic o tecla en la página (listener de una sola vez) o con el botón.
// Mientras no esté en marcha NO se promete ni se intenta sonar: el aviso llega igual como notificación, contador y título.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, Check } from "lucide-react";
import { sondearAvisos, marcarAvisosLeidos } from "@/lib/avisos/actions";
import { INTERVALO_SONDEO_MS, SONDEO_VACIO, debeReclamar, textoAviso, tituloPestana, type RespuestaSondeo } from "@/lib/avisos/presentacion";
import { numeroVisible } from "@/lib/tenant";

const CLAVE_ACTIVADO = "avisos:navegador-activado";
type Permiso = NotificationPermission | "no-soportado";
type Sonido = "listo" | "en-espera" | "no-disponible";

const leerPermiso = (): Permiso => (typeof window !== "undefined" && "Notification" in window ? Notification.permission : "no-soportado");
function leerActivado(): boolean { try { return window.localStorage.getItem(CLAVE_ACTIVADO) === "1"; } catch { return false; } }
function guardarActivado(v: boolean) { try { window.localStorage.setItem(CLAVE_ACTIVADO, v ? "1" : "0"); } catch { /* sin almacenamiento: queda solo en esta sesión */ } }

/** ¿Está oculta por CSS (display:none en ella o en un ancestro)? Una instancia oculta (p. ej. la del encabezado móvil en escritorio) no sondea. */
function estaOculto(el: HTMLElement | null): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) if (window.getComputedStyle(n).display === "none") return true;
  return false;
}

export function CampanaAvisos({ className = "" }: { className?: string }) {
  const [datos, setDatos] = useState<RespuestaSondeo>(SONDEO_VACIO);
  const [abierto, setAbierto] = useState(false);
  const [permiso, setPermiso] = useState<Permiso>("default");
  const [activado, setActivado] = useState(false);
  const [sonido, setSonido] = useState<Sonido>("en-espera");
  const [mensaje, setMensaje] = useState("");
  const raiz = useRef<HTMLDivElement>(null);
  const enCurso = useRef(false);
  const audio = useRef<AudioContext | null>(null);   // empieza en null en CADA carga de página
  const permisoRef = useRef<Permiso>("default");
  const activadoRef = useRef(false);

  /** Crea/reanuda el AudioContext. Solo funciona dentro de un gesto de la persona; devuelve si quedó en marcha. */
  const armarAudio = useCallback(async (): Promise<boolean> => {
    try {
      if (!audio.current) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) { setSonido("no-disponible"); return false; }
        audio.current = new Ctx();
      }
      if (audio.current.state === "suspended") await audio.current.resume();
      const ok = audio.current.state === "running";
      setSonido(ok ? "listo" : "en-espera");
      return ok;
    } catch { setSonido("en-espera"); return false; }
  }, []);

  useEffect(() => {
    const p = leerPermiso(); const a = leerActivado();
    permisoRef.current = p; activadoRef.current = a;
    queueMicrotask(() => { setPermiso(p); setActivado(a); }); // el estado del navegador solo se conoce en el cliente
    if (!(p === "granted" && a)) return;
    // Tras recargar: el sonido se arma con el primer gesto en la página (una sola vez); hasta entonces queda «en espera».
    const gesto = () => { void armarAudio(); };
    document.addEventListener("pointerdown", gesto, { once: true, capture: true });
    document.addEventListener("keydown", gesto, { once: true, capture: true });
    return () => { document.removeEventListener("pointerdown", gesto, true); document.removeEventListener("keydown", gesto, true); };
  }, [armarAudio]);

  const pitar = useCallback(() => {
    try {
      const ctx = audio.current;
      if (!ctx || ctx.state !== "running") return false; // sin gesto previo no hay sonido: no se intenta ni se promete
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = 880; g.gain.value = 0.08;
      osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.18);
      return true;
    } catch { return false; }
  }, []);

  const sondear = useCallback(async () => {
    if (estaOculto(raiz.current)) return; // otra instancia visible ya sondea
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      const r = await sondearAvisos(debeReclamar(permisoRef.current, activadoRef.current));
      setDatos(r);
      if (r.nuevos.length > 0 && debeReclamar(permisoRef.current, activadoRef.current)) {
        for (const n of r.nuevos) {
          try { new Notification("D'spacios Travel", { body: textoAviso(n.tipo, numeroVisible(n.numero_contrato)), tag: `aviso-${n.id}` }); } catch { /* algunos navegadores móviles no permiten new Notification */ }
        }
        pitar();
      }
    } catch { /* sin red: se reintenta en el siguiente ciclo */ } finally { enCurso.current = false; }
  }, [pitar]);

  useEffect(() => {
    void sondear();
    const t = setInterval(() => void sondear(), INTERVALO_SONDEO_MS);
    const alVolver = () => { if (document.visibilityState === "visible") void sondear(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", alVolver); window.removeEventListener("focus", alVolver); };
  }, [sondear]);

  // Contador en el título de la pestaña (todas las pestañas lo reflejan: viene del conteo, no del reclamo).
  useEffect(() => {
    if (estaOculto(raiz.current)) return;
    document.title = tituloPestana(document.title, datos.noLeidos);
    return () => { document.title = tituloPestana(document.title, 0); };
  }, [datos]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);

  async function activar() {
    setMensaje("");
    if (!("Notification" in window)) { setMensaje("Este navegador no admite notificaciones. El contador y el título siguen funcionando."); return; }
    const sonoro = armarAudio(); // este clic ES el gesto que permite el sonido
    const p = await Notification.requestPermission();
    setPermiso(p); permisoRef.current = p;
    if (p === "granted") {
      setActivado(true); activadoRef.current = true; guardarActivado(true);
      const ok = await sonoro; if (ok) pitar();
      setMensaje(ok ? "Avisos del navegador y sonido activados en este equipo." : "Avisos del navegador activados. El sonido no está disponible en este navegador.");
    } else {
      setMensaje(p === "denied" ? "El navegador bloqueó las notificaciones. Puedes habilitarlas en la configuración del sitio; mientras tanto verás el contador y el título." : "No se activaron los avisos del navegador.");
    }
  }
  function desactivar() { setActivado(false); activadoRef.current = false; guardarActivado(false); setMensaje("Avisos del navegador desactivados."); }

  async function leerTodo() { await marcarAvisosLeidos(); await sondear(); }
  /** Abrir un aviso lo marca leído (solo ese). Reclamarlo para notificar nunca lo marcó. */
  function alAbrir(id: number) { setAbierto(false); void marcarAvisosLeidos([id]).then(() => sondear()); }

  const n = datos.noLeidos;
  const textoSonido = sonido === "listo" ? "Sonido activo." : sonido === "no-disponible" ? "Este navegador no permite sonido; recibirás la notificación sin él."
    : "Sonido en espera: se activa con el primer clic o tecla en esta página (el navegador lo exige tras recargar). Mientras tanto verás la notificación sin sonido.";
  return (
    <div ref={raiz} className={`relative ${className}`}>
      <button
        type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-haspopup="true"
        aria-label={n > 0 ? `Avisos, ${n} sin leer` : "Avisos, sin pendientes"}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white/80 text-gray-600 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#26BBD9]"
      >
        {n > 0 ? <BellRing size={18} aria-hidden /> : <Bell size={18} aria-hidden />}
        {n > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#C0392B] px-1 text-center text-[10px] font-bold leading-[18px] text-white">{n > 99 ? "99+" : n}</span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">{n > 0 ? `${n} avisos sin leer` : ""}</span>
      {abierto && (
        <div role="region" aria-label="Avisos" className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-700">Avisos</p>
            {n > 0 && (
              <button type="button" onClick={() => void leerTodo()} className="inline-flex items-center gap-1 text-xs font-medium text-[#1D7C9A] hover:underline">
                <Check size={14} aria-hidden /> Marcar todo como leído
              </button>
            )}
          </div>
          {datos.recientes.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-500">Sin avisos por ahora.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {datos.recientes.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} onClick={() => alAbrir(a.id)} className={`block rounded-lg px-2 py-1.5 text-xs hover:bg-gray-50 ${a.leido ? "text-gray-500" : "font-semibold text-gray-800"}`}>
                    {textoAviso(a.tipo, numeroVisible(a.numero_contrato))}
                    <span className="block text-[11px] font-normal text-gray-400">{new Date(a.creado_en).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-gray-100 pt-2">
            {permiso !== "no-soportado" && !(permiso === "granted" && activado) && (
              <button type="button" onClick={() => void activar()} className="w-full rounded-lg bg-[#1D7C9A] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                Activar avisos del navegador y sonido
              </button>
            )}
            {permiso === "granted" && activado && (
              <>
                <p data-estado-sonido={sonido} className="mb-2 text-[11px] leading-snug text-gray-500">{textoSonido}</p>
                {sonido === "en-espera" && (
                  <button type="button" onClick={() => void armarAudio()} className="mb-2 w-full rounded-lg bg-[#1D7C9A] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Activar el sonido ahora</button>
                )}
                <button type="button" onClick={desactivar} className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Desactivar avisos del navegador</button>
              </>
            )}
            <p className="mt-2 text-[11px] leading-snug text-gray-400">
              Los avisos llegan mientras tengas esta aplicación abierta; con algunas pestañas en segundo plano pueden tardar cerca de un minuto o más. Con el navegador cerrado no llegan avisos.
            </p>
            {mensaje && <p role="status" className="mt-1 text-[11px] text-gray-600">{mensaje}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
