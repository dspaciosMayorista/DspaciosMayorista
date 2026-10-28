"use client";

// ─────────────────────────────────────────────────────────────────────────
// #35 — «Continuar con esta opción» en el checkout público.
//
// El enlace de la comparativa (`/cot/<token>`) solo LEE. Para continuar con un
// hotel el visitante llega aquí: el servidor vuelve a validar identidad, datos
// requeridos, comparativa, opción, acomodación, versión, vigencia, moneda,
// precio y disponibilidad, RELIQUIDA con el motor real y recién entonces crea
// la cotización de la opción elegida (`elegirOpcionComparativa`). Nada de lo
// que se ve aquí autoriza por sí solo: es una pantalla, no un permiso.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { formatoExacto, textoReparto } from "@/lib/contrato/repartoTarifa";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import {
  elegirOpcionComparativa, resumenOpcionComparativa, type ResumenOpcionComparativa, type ResultadoEleccion,
} from "@/app/tarifario/checkout/actions";

const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

function nuevaClave(): string {
  try { return crypto.randomUUID(); } catch { return `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`; }
}

export function ContinuarComparativa({ token, opcionRef, acomodacionRef }: { token: string; opcionRef: string; acomodacionRef: string }) {
  const [resumen, setResumen] = useState<ResumenOpcionComparativa | null>(null);
  const [errCarga, setErrCarga] = useState("");
  const [cargando, setCargando] = useState(true);
  const [c, setC] = useState({ nombres: "", apellidos: "", numeroDoc: "", telefono: "", email: "" });
  const [err, setErr] = useState("");
  // La comparativa es inmutable: si el precio cambió no hay nada que "confirmar"; hay que generar una nueva.
  const [desactualizada, setDesactualizada] = useState(false);
  const [hecho, setHecho] = useState<Extract<ResultadoEleccion, { ok: true }> | null>(null);
  const [pending, start] = useTransition();
  // Una clave por intento de pantalla: un doble clic o un reintento tras perder la
  // respuesta recupera la MISMA elección en vez de crear otra.
  const clave = useRef<string>(nuevaClave());

  useEffect(() => {
    let vivo = true;
    resumenOpcionComparativa(token, opcionRef, acomodacionRef)
      .then((r) => { if (!vivo) return; if (r.ok) setResumen(r.datos); else setErrCarga(r.error); })
      .catch(() => { if (vivo) setErrCarga("No pudimos cargar la comparativa. Inténtalo de nuevo."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [token, opcionRef, acomodacionRef]);

  function continuar() {
    if (!resumen) return;
    setErr("");
    start(async () => {
      const r = await elegirOpcionComparativa({
        token, opcionRef: resumen.opcionRef, acomodacionRef: resumen.acomodacionRef,
        version: resumen.version, clave: clave.current, cliente: c,
      });
      if (r.ok) { setHecho(r); return; }
      if (r.tipo === "precio_actualizado") {
        setDesactualizada(true);
        setErr(r.error);
        return;
      }
      setErr(r.error);
      if (r.reintentable) clave.current = nuevaClave();
    });
  }

  if (cargando) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Cargando la opción…</div>;
  }
  if (hecho) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
          <CheckCircle2 className="mx-auto text-green-600" size={28} />
          <h2 className="mt-1 text-lg font-semibold text-green-800">Elegiste esta opción</h2>
          <p className="mt-1 text-sm text-green-700">Tu cotización: {hecho.codigo}</p>
          <p className="mt-1 text-xs text-green-700">Un asesor continuará contigo con los pasos siguientes. Este paso no genera ningún cobro ni contrato.</p>
        </div>
        {hecho.url && (
          <a href={hecho.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium hover:bg-gray-50" style={{ color: "var(--brand-primary)" }}>
            <span>Ver / descargar cotización {hecho.codigo}</span><ExternalLink size={16} />
          </a>
        )}
      </div>
    );
  }
  if (errCarga || !resumen) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <AlertTriangle size={16} className="mb-1 inline" /> {errCarga || "Esta comparativa ya no está disponible."}
        <Link href="/tarifario" className="mt-2 block font-medium" style={{ color: "var(--brand-primary)" }}>Volver al tarifario →</Link>
      </div>
    );
  }
  const acomLabel = ACOM_ROOM_LABEL[resumen.acomodacionRef as AcomRoom] ?? resumen.acomodacionRef;
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Opción que vas a elegir</h2>
        <div className="font-medium text-gray-800">{resumen.etiqueta}</div>
        <div className="text-xs text-gray-500">
          {resumen.destino ?? ""}{resumen.fechaSalida ? ` · ${resumen.fechaSalida} → ${resumen.fechaRegreso ?? ""}` : ""}
          {resumen.pax ? ` · ${resumen.pax} pax` : ""}{resumen.acomodacionRef !== "unica" ? ` · Acomodación ${acomLabel}` : ""}
        </div>
        <div className="mt-3 flex items-end justify-between border-t border-gray-100 pt-3">
          <span className="text-sm text-gray-500">{resumen.tarifa ? `${resumen.tarifa.etiqueta}${resumen.tarifa.soloHotel ? " (alojamiento)" : ""}: ${textoReparto(resumen.tarifa.reparto, (n) => formatoExacto(n, resumen.moneda))}` : ""}</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatoExacto(resumen.total, resumen.moneda)}</span>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Elegir un hotel no suma las demás opciones ni genera un cobro. Validamos el valor y la disponibilidad en este momento.</p>
        {resumen.vencida && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Esta comparativa venció. Pide una nueva a tu asesor.</p>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Tus datos</h2>
        <p className="mb-3 text-xs text-gray-400">Son obligatorios si no iniciaste sesión; si eres asesor o aliado se usa tu sesión.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl} htmlFor="cmp-nombres">Nombres</label><input id="cmp-nombres" className={inp} value={c.nombres} onChange={(e) => setC({ ...c, nombres: e.target.value })} /></div>
          <div><label className={lbl} htmlFor="cmp-apellidos">Apellidos</label><input id="cmp-apellidos" className={inp} value={c.apellidos} onChange={(e) => setC({ ...c, apellidos: e.target.value })} /></div>
          <div><label className={lbl} htmlFor="cmp-doc">Documento</label><input id="cmp-doc" className={inp} value={c.numeroDoc} onChange={(e) => setC({ ...c, numeroDoc: e.target.value })} /></div>
          <div><label className={lbl} htmlFor="cmp-tel">Teléfono / WhatsApp</label><input id="cmp-tel" className={inp} value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className={lbl} htmlFor="cmp-mail">Correo</label><input id="cmp-mail" type="email" className={inp} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
        </div>
        {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        {desactualizada ? (
          <Link href="/tarifario" className="mt-4 block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
            Generar una comparativa nueva
          </Link>
        ) : (
          <button type="button" onClick={continuar} disabled={pending || resumen.vencida}
            className="mt-4 w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Validando…" : "Continuar con esta opción"}
          </button>
        )}
      </section>
    </div>
  );
}
