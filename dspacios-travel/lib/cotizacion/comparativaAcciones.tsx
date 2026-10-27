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
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send, XCircle, ArrowRight, ShieldAlert, Info } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { elegirOpcionComparativa, solicitarOpcionComparativa } from "@/app/tarifario/checkout/actions";
import { resolverSolicitudComparativa } from "@/app/(dashboard)/dashboard/cotizaciones/manual-actions";
import type { ContextoModalidad, VistaNeto } from "@/app/(dashboard)/dashboard/cotizaciones/pagos-actions";
import { bloqueoNeto, pctTexto } from "@/lib/cotizacion/netoHija";
import type { GrupoHotel, OpcionVista } from "@/lib/cotizacion/comparativa";

export type ModoSeleccion = "checkout" | "solicitud" | "interno" | "solo_lectura";

export type ResumenHotelUI = {
  plan?: string | null;
  servicios?: { nombre: string; precio?: number | null }[];
  /** Vuelos manuales comunes: ruta, tramo, fecha y pasajeros (sin precio). Su valor ya está en el total de la opción. */
  vuelos?: { tramo: string; origen: string | null; destino: string | null; fecha: string | null; nota: string }[];
  items?: { descripcion: string; valor: number }[];
  incluye?: string | null;
  noIncluye?: string | null;
};

function nuevaClave(): string {
  try { return crypto.randomUUID(); } catch { return `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`; }
}
const etiquetaAcom = (a: string) => (a === "unica" ? "" : (ACOM_ROOM_LABEL[a as AcomRoom] ?? (a === "mixta" ? "Mixta" : a)));
const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

// ── #50 · Modalidad PVP/NETO de la hija B2B (comparativa manual, personal interno) ──
// El contexto (¿se pide elegir?, ¿qué puede mi rol?, vista previa por opción) lo calcula el servidor;
// la base decide al crear la hija. Sin B2B/aliado el contexto dice `permite: false` y nada cambia.
export type EleccionModalidad = { modalidad: "pvp" | "neto" | null; reconoce: boolean | null; autorizar: boolean };
const SIN_ELECCION: EleccionModalidad = { modalidad: null, reconoce: null, autorizar: false };
const mon = (n: number, m: string) => formatMoneda(n, m);

function useContextoModalidad(activo: boolean, token: string | null, solicitudId: number | null): ContextoModalidad | null {
  const [ctx, setCtx] = useState<ContextoModalidad | null>(null);
  useEffect(() => {
    if (!activo || (!token && !solicitudId)) return;
    let vivo = true;
    // Import PEREZOSO de la acción de servidor: solo se carga cuando el equipo elige/confirma, y un fallo
    // (sin sesión, sin red) deja la interfaz como siempre (`permite: false`).
    import("@/app/(dashboard)/dashboard/cotizaciones/pagos-actions")
      .then((m) => m.contextoModalidadNeto({ token, solicitudId }))
      .then((c) => { if (vivo) setCtx(c); })
      .catch(() => { if (vivo) setCtx({ permite: false }); });
    return () => { vivo = false; };
  }, [activo, token, solicitudId]);
  return activo ? ctx : null;
}

function vistaDe(ctx: ContextoModalidad | null, clave: string, e: EleccionModalidad): { moneda: string; v: VistaNeto } | null {
  if (!ctx || !ctx.permite || e.modalidad !== "neto" || e.reconoce === null) return null;
  const o = ctx.vista[clave];
  return o ? { moneda: o.moneda, v: e.reconoce ? o.conReconoce : o.sinReconoce } : null;
}

/** ¿Falta decidir algo, o algo lo impide, para enviar esta opción? (null = se puede). */
function motivoBloqueo(ctx: ContextoModalidad | null, clave: string, e: EleccionModalidad): string | null {
  if (!ctx || !ctx.permite) return null;
  if (e.modalidad === null) return "Elige PVP o NETO para esta venta B2B.";
  if (e.modalidad === "pvp") return null;
  if (e.reconoce === null) return "Indica si se reconoce la participación del aliado en el recobro.";
  const vista = vistaDe(ctx, clave, e);
  if (!vista) return null; // sin vista previa (p. ej. no cargó): la base decide.
  return bloqueoNeto(vista.v, ctx, e.autorizar);
}

// Una fila etiqueta/importe: la etiqueta puede partirse en varias líneas; el importe y el porcentaje NUNCA se cortan
// y quedan alineados a la derecha (escritorio y móvil).
function Fila({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className={"flex items-baseline justify-between gap-3" + (fuerte ? " border-t border-gray-200 pt-1 font-medium text-gray-700" : "")}>
      <dt className="min-w-0">{k}</dt>
      <dd className="shrink-0 whitespace-nowrap text-right tabular-nums">{v}</dd>
    </div>
  );
}

function PanelModalidad({ ctx, valor, onChange, accion = "Elegir esta opción" }: {
  ctx: ContextoModalidad | null; valor: EleccionModalidad; onChange: (e: EleccionModalidad) => void;
  /** Botón que GUARDA la modalidad (en las solicitudes es «Confirmar y crear la cotización»). */
  accion?: string;
}) {
  if (!ctx || !ctx.permite) return null;
  const radio = "flex items-start gap-2 text-sm text-gray-700";
  const entrada = "mt-0.5 shrink-0";
  return (
    <fieldset className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 text-sm print:hidden">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Precio de la venta B2B</legend>
      <p role="note" className="mb-3 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span><b className="font-semibold">Vista previa.</b>{" "}La modalidad se guarda al pulsar <b className="font-semibold">{accion}</b></span>
      </p>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <label className={radio}>
          <input type="radio" name="modalidad-b2b" className={entrada} checked={valor.modalidad === "pvp"}
            onChange={() => onChange({ modalidad: "pvp", reconoce: null, autorizar: false })} />
          <span className="min-w-0"><b className="font-semibold">PVP</b> (el aliado cobra su comisión aparte)</span>
        </label>
        <label className={radio + (ctx.puedeNeto ? "" : " opacity-50")}>
          <input type="radio" name="modalidad-b2b" className={entrada} disabled={!ctx.puedeNeto} checked={valor.modalidad === "neto"}
            onChange={() => onChange({ modalidad: "neto", reconoce: valor.reconoce, autorizar: false })} />
          <span className="min-w-0"><b className="font-semibold">NETO</b> (el aliado paga el PVP menos su descuento)</span>
        </label>
      </div>
      {!ctx.puedeNeto && <p className="mt-2 text-xs text-gray-500">El precio NETO lo fija gerencia, administración, operaciones o superadmin.</p>}
      {valor.modalidad === "neto" && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-600">¿Se reconoce la participación del aliado en el recobro?</p>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <label className={radio}>
              <input type="radio" name="reconoce-recobro" className={entrada} checked={valor.reconoce === true}
                onChange={() => onChange({ ...valor, reconoce: true, autorizar: false })} />
              <span className="min-w-0">Sí: el recobro sale de la base y su participación se suma al descuento</span>
            </label>
            <label className={radio}>
              <input type="radio" name="reconoce-recobro" className={entrada} checked={valor.reconoce === false}
                onChange={() => onChange({ ...valor, reconoce: false, autorizar: false })} />
              <span className="min-w-0">No: el recobro entra a la base de la comisión</span>
            </label>
          </div>
          {(ctx.puedeAutorizar6 || ctx.puedeAutorizar2) && (
            <label className={radio + " pt-1"}>
              <input type="checkbox" className={entrada} checked={valor.autorizar} onChange={(e) => onChange({ ...valor, autorizar: e.target.checked })} />
              <span className="min-w-0"><ShieldAlert size={14} aria-hidden className="mr-1 inline text-amber-600" />Autorizo un margen por debajo del mínimo (solo si hace falta)</span>
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}

function ResumenNeto({ ctx, clave, valor }: { ctx: ContextoModalidad | null; clave: string; valor: EleccionModalidad }) {
  const vista = vistaDe(ctx, clave, valor);
  if (!ctx || !ctx.permite || !vista) return null;
  const { v, moneda } = vista;
  const bloqueo = bloqueoNeto(v, ctx, valor.autorizar);
  return (
    <div className="mt-3 space-y-2" aria-live="polite">
      <dl className="space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        <Fila k="PVP original (precio al cliente)" v={mon(v.pvp, moneda)} />
        <Fila k="Base del descuento" v={mon(v.base, moneda)} />
        <Fila k="Comisión ordinaria" v={mon(v.ordinaria, moneda)} />
        <Fila k="Participación en el recobro" v={mon(v.participacion, moneda)} />
        <Fila k="Descuento total" v={mon(v.descuento, moneda)} fuerte />
      </dl>
      <div className="rounded-lg border-2 bg-white p-3" style={{ borderColor: "var(--brand-primary)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}>Total NETO que paga el aliado</p>
        <p className="mt-0.5 whitespace-nowrap text-2xl font-bold tabular-nums text-gray-900">{mon(v.neto, moneda)}</p>
        <dl className="mt-2 space-y-0.5 text-xs text-gray-600">
          <Fila k="Margen sobre el total NETO" v={pctTexto(v.margen)} />
          <Fila k="Mínimo exigido" v={`${v.pisoPct}\u00a0%`} />
        </dl>
      </div>
      {bloqueo && <p role="alert" className="text-xs text-amber-700">{bloqueo}</p>}
    </div>
  );
}

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
  // #50: modalidad PVP/NETO (solo comparativa manual B2B elegida por el equipo).
  const ctxMod = useContextoModalidad(modo === "interno", token, null);
  const [eleccion, setEleccion] = useState<EleccionModalidad>(SIN_ELECCION);

  function actuar(opcionRef: string, acomodacionRef: string) {
    setErr(""); setOk("");
    if (!token) { setErr("No se pudo identificar la comparativa. Recarga la página."); return; }
    if (modo === "interno") {
      const motivo = motivoBloqueo(ctxMod, `${opcionRef}/${acomodacionRef}`, eleccion);
      if (motivo) { setErr(motivo); return; }
      const mod = ctxMod && ctxMod.permite && eleccion.modalidad
        ? { modalidad: eleccion.modalidad, reconoceRecobro: eleccion.modalidad === "neto" ? eleccion.reconoce : null, autorizarMargen: eleccion.autorizar }
        : {};
      start(async () => {
        const r = await elegirOpcionComparativa({ token, opcionRef, acomodacionRef, version, clave: clave.current, cliente: null, ...mod });
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

      {modo === "interno" && !deshabilitada && !elegida && (
        <PanelModalidad ctx={ctxMod} valor={eleccion} onChange={(e) => { setEleccion(e); clave.current = nuevaClave(); }} />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {grupos.map((g) => {
          const sel: OpcionVista = g.acomodaciones.find((a) => a.acomodacionRef === acom[g.opcionRef]) ?? g.acomodaciones[0];
          const r = resumenes[`${g.opcionRef}/${sel.acomodacionRef}`] ?? resumenes[g.opcionRef] ?? {};
          const esElegida = !!elegida && elegida.opcionRef === g.opcionRef && elegida.acomodacionRef === sel.acomodacionRef;
          // Con la vista previa NETO activa, el total de la opción pasa a ser el PVP ORIGINAL (identificado y atenuado)
          // y el protagonista es el NETO del resumen. Sin vista previa NETO, el total se ve como siempre.
          const conNeto = modo === "interno" && !deshabilitada && !!vistaDe(ctxMod, `${g.opcionRef}/${sel.acomodacionRef}`, eleccion);
          return (
            <article key={g.opcionRef} className="flex min-w-0 flex-col rounded-2xl border bg-white p-4 shadow-sm"
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
              {r.vuelos && r.vuelos.length > 0 && (
                <ul className="mb-3 space-y-1 text-xs text-gray-600" data-testid="vuelos-opcion">
                  {r.vuelos.map((v, i) => <li key={i}>Vuelo {v.tramo}: {v.origen ?? "—"} → {v.destino ?? "—"}{v.fecha ? ` · ${v.fecha}` : ""} · {v.nota.replace(/^Vuelo manual · /, "")}</li>)}
                </ul>
              )}
              {r.items && r.items.length > 0 && (
                <ul className="mb-3 space-y-1 text-xs text-gray-600">
                  {r.items.map((it) => <li key={it.descripcion}>{it.descripcion}</li>)}
                </ul>
              )}

              <div className="mt-auto border-t border-gray-100 pt-3">
                {sel.tarifaPersona != null && (
                  <div className="flex items-baseline justify-between gap-3 text-xs text-gray-500">
                    <span className="min-w-0">Tarifa por persona{etiquetaAcom(sel.acomodacionRef) ? ` · ${etiquetaAcom(sel.acomodacionRef)}` : ""}</span>
                    <span className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums text-gray-700">{formatMoneda(sel.tarifaPersona, sel.moneda)}</span>
                  </div>
                )}
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className={conNeto ? "min-w-0 text-xs font-medium text-gray-500" : "min-w-0 text-sm font-medium text-gray-600"}>
                    {conNeto ? "PVP original (cliente)" : "Total de este hotel"}
                  </span>
                  {conNeto
                    ? <span className="shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-gray-500">{formatMoneda(sel.total, sel.moneda)}</span>
                    : <span className="shrink-0 whitespace-nowrap text-right text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatMoneda(sel.total, sel.moneda)}</span>}
                </div>

                {modo === "checkout" && !deshabilitada && token && (
                  <Link href={`/tarifario/checkout?comparativa=${encodeURIComponent(token)}&op=${g.opcionRef}&ac=${sel.acomodacionRef}`}
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white print:hidden" style={{ backgroundColor: "var(--brand-primary)" }}>
                    Continuar con esta opción <ArrowRight size={15} aria-hidden />
                  </Link>
                )}
                {modo === "interno" && !deshabilitada && (
                  <ResumenNeto ctx={ctxMod} clave={`${g.opcionRef}/${sel.acomodacionRef}`} valor={eleccion} />
                )}
                {modo === "interno" && !deshabilitada && (
                  <button type="button" disabled={pending || !!motivoBloqueo(ctxMod, `${g.opcionRef}/${sel.acomodacionRef}`, eleccion)} onClick={() => actuar(g.opcionRef, sel.acomodacionRef)}
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
  // #50: modalidad PVP/NETO al confirmar (una elección para la ficha; el contexto sale de una solicitud pendiente).
  const ctxMod = useContextoModalidad(puedeResolver && !hayElegida && pendientes.length > 0, null, pendientes[0]?.id ?? null);
  const [eleccion, setEleccion] = useState<EleccionModalidad>(SIN_ELECCION);

  function resolver(id: number, decision: "confirmar" | "rechazar", clave: string = "") {
    setErr("");
    if (decision === "confirmar") {
      const motivoBlq = motivoBloqueo(ctxMod, clave, eleccion);
      if (motivoBlq) { setErr(motivoBlq); return; }
    }
    claves.current[id] ??= nuevaClave();
    const mod = decision === "confirmar" && ctxMod && ctxMod.permite && eleccion.modalidad
      ? { modalidad: eleccion.modalidad, reconoceRecobro: eleccion.modalidad === "neto" ? eleccion.reconoce : null, autorizarMargen: eleccion.autorizar }
      : undefined;
    start(async () => {
      const r = await resolverSolicitudComparativa(id, decision, motivo[id] ?? "", claves.current[id], mod);
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
      {puedeResolver && !hayElegida && pendientes.length > 0 && (
        <div className="mb-3"><PanelModalidad ctx={ctxMod} valor={eleccion} accion="Confirmar y crear la cotización" onChange={(e) => { setEleccion(e); claves.current = {}; }} /></div>
      )}
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
              {puedeResolver && s.estado === "pendiente" && !hayElegida && !s.vencida && (
                <ResumenNeto ctx={ctxMod} clave={`${s.opcionRef}/${s.acomodacionRef}`} valor={eleccion} />
              )}
              {puedeResolver && s.estado === "pendiente" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!hayElegida && !s.vencida && (
                    <button type="button" disabled={pending || !!motivoBloqueo(ctxMod, `${s.opcionRef}/${s.acomodacionRef}`, eleccion)}
                      onClick={() => resolver(s.id, "confirmar", `${s.opcionRef}/${s.acomodacionRef}`)}
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
