"use client";

// ─────────────────────────────────────────────────────────────────────────
// #35 — Interfaz de una comparativa: elegir una opción y atender solicitudes.
//
// `SelectorOpciones` muestra, por hotel, el selector de acomodación con la
// tarifa por persona y el TOTAL PROPIO de esa acomodación. No hay total global:
// los hoteles son alternativas, nunca se suman. Elegir NO concede permisos de
// conversión ni cobra nada: lleva al flujo normal con la opción escogida.
//
// Según el contexto (`modo`) el botón hace una de tres cosas, siempre pasando
// por una acción de servidor que valida todo de nuevo:
//   · checkout  → lleva al checkout público, que reliquida y crea la opción;
//   · solicitud → registra una SOLICITUD que confirma una persona del equipo;
//   · interno   → el equipo elige directamente (sesión + recibo de un solo uso).
// El enlace público (`token`) solo sirve para LEER y para llegar al checkout.
// ─────────────────────────────────────────────────────────────────────────
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send, XCircle, ArrowRight } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { elegirOpcionComparativa, solicitarOpcionComparativa } from "@/app/tarifario/checkout/actions";
import { resolverSolicitudComparativa } from "@/app/(dashboard)/dashboard/cotizaciones/manual-actions";
import type { GrupoHotel, OpcionVista } from "@/lib/cotizacion/comparativa";

export type ModoSeleccion = "checkout" | "solicitud" | "interno" | "solo_lectura";

export type ResumenHotelUI = {
  plan?: string | null;
  servicios?: { nombre: string; precio?: number | null }[];
  items?: { descripcion: string; valor: number }[];
  incluye?: string | null;
  noIncluye?: string | null;
};

function nuevaClave(): string {
  try { return crypto.randomUUID(); } catch { return `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`; }
}
const etiquetaAcom = (a: string) => (a === "unica" ? "" : (ACOM_ROOM_LABEL[a as AcomRoom] ?? (a === "mixta" ? "Mixta" : a)));
const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export function SelectorOpciones({
  version, token, grupos, resumenes, modo, deshabilitada, motivoDeshabilitada, elegida,
}: {
  version: number; token: string | null; grupos: GrupoHotel[];
  resumenes: Record<string, ResumenHotelUI>; modo: ModoSeleccion;
  deshabilitada: boolean; motivoDeshabilitada?: string;
  elegida: { codigo: string; opcionRef: string; acomodacionRef: string } | null;
}) {
  const router = useRouter();
  // Acomodación elegida por hotel (por defecto la más económica, primera del grupo).
  const [acom, setAcom] = useState<Record<string, string>>(() => Object.fromEntries(grupos.map((g) => [g.opcionRef, g.acomodaciones[0]?.acomodacionRef ?? "unica"])));
  const [abierta, setAbierta] = useState<string | null>(null);
  const [c, setC] = useState({ nombre: "", telefono: "", email: "", nota: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [pending, start] = useTransition();
  const clave = useRef<string>(nuevaClave());

  function actuar(opcionRef: string, acomodacionRef: string) {
    setErr(""); setOk("");
    if (!token) { setErr("No se pudo identificar la comparativa. Recarga la página."); return; }
    if (modo === "interno") {
      start(async () => {
        const r = await elegirOpcionComparativa({ token, opcionRef, acomodacionRef, version, clave: clave.current, cliente: null });
        if (r.ok) { router.refresh(); return; }
        setErr(r.error);
        if (r.reintentable) clave.current = nuevaClave();
      });
    } else if (modo === "solicitud") {
      start(async () => {
        const r = await solicitarOpcionComparativa({ token, opcionRef, acomodacionRef, version, clave: clave.current, contacto: c });
        if (r.ok) { setOk(r.actualizada ? "Actualizamos tu solicitud con esta opción. Un asesor te contactará." : "Recibimos tu solicitud. Un asesor te contactará para confirmar."); setAbierta(null); return; }
        setErr(r.error);
        clave.current = nuevaClave();
      });
    }
  }

  return (
    <div className="space-y-4">
      {elegida && (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
          Ya hay una opción elegida ({elegida.opcionRef}{etiquetaAcom(elegida.acomodacionRef) ? ` · ${etiquetaAcom(elegida.acomodacionRef)}` : ""}): cotización {elegida.codigo}.
        </p>
      )}
      {deshabilitada && motivoDeshabilitada && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{motivoDeshabilitada}</p>}
      {ok && <p role="status" className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />{ok}</p>}
      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {grupos.map((g) => {
          const sel: OpcionVista = g.acomodaciones.find((a) => a.acomodacionRef === acom[g.opcionRef]) ?? g.acomodaciones[0];
          const r = resumenes[`${g.opcionRef}/${sel.acomodacionRef}`] ?? resumenes[g.opcionRef] ?? {};
          const esElegida = !!elegida && elegida.opcionRef === g.opcionRef && elegida.acomodacionRef === sel.acomodacionRef;
          return (
            <article key={g.opcionRef} className="flex flex-col rounded-2xl border bg-white p-4 shadow-sm"
              style={esElegida ? { borderColor: "var(--brand-success)" } : { borderColor: "#e5e7eb" }}>
              <header className="mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Opción {g.opcionRef}</p>
                <h3 className="text-base font-semibold text-gray-800">{g.etiqueta}</h3>
                {r.plan && <p className="text-xs text-gray-500">{r.plan}</p>}
              </header>

              {g.acomodaciones.length > 1 && (
                <div className="mb-3">
                  <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`acom-${g.opcionRef}`}>Acomodación</label>
                  <select id={`acom-${g.opcionRef}`} value={sel.acomodacionRef} className={inp}
                    onChange={(e) => setAcom({ ...acom, [g.opcionRef]: e.target.value })}>
                    {g.acomodaciones.map((a) => (
                      <option key={a.acomodacionRef} value={a.acomodacionRef}>{etiquetaAcom(a.acomodacionRef) || "Acomodación"} — {formatMoneda(a.total, a.moneda)}</option>
                    ))}
                  </select>
                </div>
              )}

              {r.servicios && r.servicios.length > 0 && (
                <ul className="mb-3 space-y-1 text-xs text-gray-600">
                  {r.servicios.map((s) => <li key={s.nombre}>+ {s.nombre}</li>)}
                </ul>
              )}
              {r.items && r.items.length > 0 && (
                <ul className="mb-3 space-y-1 text-xs text-gray-600">
                  {r.items.map((it) => <li key={it.descripcion}>{it.descripcion}</li>)}
                </ul>
              )}

              <div className="mt-auto border-t border-gray-100 pt-3">
                {sel.tarifaPersona != null && (
                  <div className="flex items-baseline justify-between text-xs text-gray-500">
                    <span>Tarifa por persona{etiquetaAcom(sel.acomodacionRef) ? ` · ${etiquetaAcom(sel.acomodacionRef)}` : ""}</span>
                    <span className="font-medium tabular-nums text-gray-700">{formatMoneda(sel.tarifaPersona, sel.moneda)}</span>
                  </div>
                )}
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-gray-600">Total de este hotel</span>
                  <span className="text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatMoneda(sel.total, sel.moneda)}</span>
                </div>

                {modo === "checkout" && !deshabilitada && token && (
                  <Link href={`/tarifario/checkout?comparativa=${encodeURIComponent(token)}&op=${g.opcionRef}&ac=${sel.acomodacionRef}`}
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white print:hidden" style={{ backgroundColor: "var(--brand-primary)" }}>
                    Continuar con esta opción <ArrowRight size={15} aria-hidden />
                  </Link>
                )}
                {modo === "interno" && !deshabilitada && (
                  <button type="button" disabled={pending} onClick={() => actuar(g.opcionRef, sel.acomodacionRef)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 print:hidden" style={{ backgroundColor: "var(--brand-primary)" }}>
                    {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />} Elegir esta opción
                  </button>
                )}
                {modo === "solicitud" && !deshabilitada && (
                  abierta === `${g.opcionRef}/${sel.acomodacionRef}` ? (
                    <div className="mt-3 space-y-2 print:hidden">
                      <p className="text-[11px] text-gray-500">Déjanos tus datos: un asesor confirmará esta opción contigo. No genera cobro.</p>
                      <input className={inp} placeholder="Tu nombre" aria-label="Tu nombre" value={c.nombre} onChange={(e) => setC({ ...c, nombre: e.target.value })} />
                      <input className={inp} placeholder="Teléfono / WhatsApp" aria-label="Teléfono" value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} />
                      <input className={inp} type="email" placeholder="Correo (opcional si das teléfono)" aria-label="Correo" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
                      <textarea className={inp} rows={2} placeholder="Nota (opcional)" aria-label="Nota" value={c.nota} onChange={(e) => setC({ ...c, nota: e.target.value })} />
                      <div className="flex gap-2">
                        <button type="button" disabled={pending} onClick={() => actuar(g.opcionRef, sel.acomodacionRef)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
                          {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />} Enviar solicitud
                        </button>
                        <button type="button" onClick={() => setAbierta(null)} className="rounded-lg border border-gray-300 px-3 text-sm text-gray-600">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setErr(""); setOk(""); setAbierta(`${g.opcionRef}/${sel.acomodacionRef}`); }}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-semibold print:hidden"
                      style={{ borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }}>
                      Solicitar esta opción
                    </button>
                  )
                )}
                {esElegida && <p className="mt-2 text-center text-xs font-medium text-green-700">Opción elegida</p>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export type SolicitudUI = {
  id: number; estado: string; opcionRef: string; acomodacionRef: string; etiqueta: string; nombre: string;
  telefono: string | null; email: string | null; nota: string | null; creada: string; vencida: boolean;
};

/** Panel interno: confirmar o rechazar las solicitudes de clientes/aliados. */
export function PanelSolicitudes({ solicitudes, puedeResolver, hayElegida }: { solicitudes: SolicitudUI[]; puedeResolver: boolean; hayElegida: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [motivo, setMotivo] = useState<Record<number, string>>({});
  const claves = useRef<Record<number, string>>({});
  const pendientes = solicitudes.filter((s) => s.estado === "pendiente");

  function resolver(id: number, decision: "confirmar" | "rechazar") {
    setErr("");
    claves.current[id] ??= nuevaClave();
    start(async () => {
      const r = await resolverSolicitudComparativa(id, decision, motivo[id] ?? "", claves.current[id]);
      if (r.ok) { router.refresh(); return; }
      setErr(r.error);
      delete claves.current[id];
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Solicitudes ({pendientes.length} pendientes)</h2>
      <p className="mb-3 text-xs text-gray-400">
        Varias personas pueden solicitar a la vez: ninguna bloquea la comparativa. Confirmar una crea la cotización de esa opción; las demás pendientes quedan superadas.
      </p>
      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      {solicitudes.length === 0 ? <p className="text-sm text-gray-400">Sin solicitudes.</p> : (
        <ul className="space-y-3">
          {solicitudes.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-100 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-gray-800">{s.nombre}</span>
                  <span className="ml-2 text-xs text-gray-500">Opción {s.opcionRef} · {s.etiqueta}{etiquetaAcom(s.acomodacionRef) ? ` · ${etiquetaAcom(s.acomodacionRef)}` : ""}</span>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{s.vencida && s.estado === "pendiente" ? "vencida" : s.estado}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{[s.telefono, s.email].filter(Boolean).join(" · ")} · {s.creada}</p>
              {s.nota && <p className="mt-1 text-xs text-gray-600">{s.nota}</p>}
              {puedeResolver && s.estado === "pendiente" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!hayElegida && !s.vencida && (
                    <button type="button" disabled={pending} onClick={() => resolver(s.id, "confirmar")}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
                      <CheckCircle2 size={14} aria-hidden /> Confirmar y crear la cotización
                    </button>
                  )}
                  <input className="min-w-[10rem] flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs" placeholder="Motivo (opcional)" aria-label="Motivo del rechazo"
                    value={motivo[s.id] ?? ""} onChange={(e) => setMotivo({ ...motivo, [s.id]: e.target.value })} />
                  <button type="button" disabled={pending} onClick={() => resolver(s.id, "rechazar")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-50">
                    <XCircle size={14} aria-hidden /> Rechazar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
