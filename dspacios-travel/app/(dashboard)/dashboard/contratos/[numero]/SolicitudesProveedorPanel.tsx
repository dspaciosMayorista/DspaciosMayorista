"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Mail, MailCheck, MailWarning, Send } from "lucide-react";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { MensajeAdicional } from "@/components/solicitudProveedor/MensajeAdicional";
import { ETIQUETA_ESTADO, RANGO, type EstadoSolicitud } from "@/lib/solicitudProveedor/nucleo";
import { enviarSolicitudProveedor, marcarAvisosLeidos, previsualizarSolicitudProveedor, registrarDecisionProveedor, reintentarEnvioSolicitudProveedor, type CandidataCodigo, type VistaPrevia } from "./solicitud-proveedor-actions";

export type ProveedorOpcion = { proveedor: string; clase: "hotel" | "servicios"; estancias?: { id: number; nombre: string; ingreso: string | null; salida: string | null }[]; servicios?: number };
export type SolicitudFila = {
  id: number; proveedor: string | null; destinatarios: string[]; estado: EstadoSolicitud; error_envio: string | null; codigo_texto?: string | null; codigo_promocion?: string | null;
  enviada_en: string | null; entregada_en: string | null; respondida_en: string | null; confirmada_en: string | null; created_at: string;
};
type Respuesta = { solicitudId: number; creada: string; de?: string; texto?: string; asunto?: string };

const fecha = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(iso)) : null);
const COLOR: Record<EstadoSolicitud, string> = {
  enviando: "bg-gray-100 text-gray-600", incierta: "bg-amber-100 text-amber-800", enviada: "bg-sky-50 text-sky-700", entregada: "bg-sky-100 text-sky-800", respondida: "bg-amber-100 text-amber-800",
  confirmada: "bg-emerald-100 text-emerald-800", rechazada: "bg-red-100 text-red-700", fallida: "bg-red-100 text-red-700",
};

export function SolicitudesProveedorPanel({ numero, identidad, proveedores, solicitudes, respuestas, sinLeer, correoHabilitado, modoCaptura }: {
  numero: string; identidad: IdentidadContrato; proveedores: ProveedorOpcion[]; solicitudes: SolicitudFila[]; respuestas: Respuesta[]; sinLeer: number; correoHabilitado: boolean; modoCaptura: boolean;
}) {
  const router = useRouter();
  const [proveedor, setProveedor] = useState(proveedores[0]?.proveedor ?? "");
  const [correos, setCorreos] = useState("");
  const [hotelId, setHotelId] = useState<number | null>(null);
  const [eleccion, setEleccion] = useState<{ codigoId: number | null; sinPromocion: boolean }>({ codigoId: null, sinPromocion: false });
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [mensaje, setMensaje] = useState("");   // optional note for THIS send (H103-13); changing it makes the preview stale (send stays off until it is regenerated)
  const [mensajeVista, setMensajeVista] = useState("");   // the note the current preview was built with
  // Which rows of this supplier the request carries (default: everything). Sending the stays of two hotels with different promotion codes needs one request per hotel.
  const [marcadas, setMarcadas] = useState<number[] | null>(null);          // null = every stay
  const [conServicios, setConServicios] = useState(true);
  const vistaVigente = !!vista?.ok && mensajeVista === mensaje;
  const actual = proveedores.find((x) => x.proveedor === proveedor);
  const estancias = actual?.estancias ?? [], nServicios = actual?.servicios ?? 0;
  const idsMarcados = marcadas ?? estancias.map((e) => e.id);
  const seleccion = (): { estanciaIds: number[]; servicios: boolean } | null => (marcadas == null && conServicios ? null : { estanciaIds: idsMarcados, servicios: conServicios });
  const reiniciarEleccion = () => { setVista(null); setHotelId(null); setEleccion({ codigoId: null, sinPromocion: false }); };
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const guardia = useRef(false);   // síncrona: un doble clic nunca manda dos solicitudes

  async function ejecutar(accion: () => Promise<{ ok: true; mensaje: string } | { ok: false; error: string }>) {
    if (guardia.current) return;
    guardia.current = true; setOcupado(true); setMsg(null);
    try {
      const r = await accion();
      setMsg(r.ok ? { tipo: "ok", texto: r.mensaje } : { tipo: "error", texto: r.error });
      if (r.ok) router.refresh();
    } catch { setMsg({ tipo: "error", texto: "No se pudo completar la acción. Intenta de nuevo." }); }
    finally { guardia.current = false; setOcupado(false); }
  }

  async function previsualizar(h: number | null = hotelId, e = eleccion) {
    if (guardia.current || !proveedor) return;
    guardia.current = true; setOcupado(true); setMsg(null);
    try {
      const v = await previsualizarSolicitudProveedor(numero, proveedor, identidad, h, { codigoId: e.codigoId, sinPromocion: e.sinPromocion }, seleccion(), mensaje);
      setVista(v); setMensajeVista(mensaje);
      // The suggestion is only a convenience: when the contract's hotel matches ONE catalog hotel it is pre-selected, the sender can still change it.
      if (v.hotelesSugeridos?.length === 1 && h == null) { setHotelId(v.hotelesSugeridos[0].id); guardia.current = false; setOcupado(false); return void previsualizar(v.hotelesSugeridos[0].id, e); }
      if (!v.ok) setMsg({ tipo: "error", texto: v.error });
    } catch { setMsg({ tipo: "error", texto: "No se pudo generar la vista previa." }); }
    finally { guardia.current = false; setOcupado(false); }
  }
  const elegir = (e: { codigoId: number | null; sinPromocion: boolean }) => { setEleccion(e); void previsualizar(hotelId, e); };
  const enviar = () => {
    if (!proveedor) return setMsg({ tipo: "error", texto: "Elige el proveedor." });
    void ejecutar(() => enviarSolicitudProveedor(numero, proveedor, correos, identidad, hotelId, { codigoId: eleccion.codigoId, sinPromocion: eleccion.sinPromocion }, false, seleccion(), mensaje));
  };
  const candidatas: CandidataCodigo[] = vista?.candidatas ?? [];

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="solicitudes-proveedor-titulo" data-testid="solicitudes-proveedor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="solicitudes-proveedor-titulo" className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Mail className="h-4 w-4" aria-hidden /> Solicitudes a proveedores por correo</h2>
        {sinLeer > 0 && (
          <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => marcarAvisosLeidos(numero, identidad))} className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            <MailCheck className="h-3.5 w-3.5" aria-hidden /> {sinLeer} respuesta(s) nueva(s) · marcar leídas
          </button>
        )}
      </div>

      {!correoHabilitado ? (
        <p role="note" className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600"><MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> El envío por correo todavía no está habilitado. Se activará cuando se definan el remitente, la dirección de respuesta y quién recibe los avisos.</p>
      ) : !proveedores.length ? (
        <p role="note" className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">Este contrato no tiene hoteles ni servicios con proveedor asignado: asigna el proveedor para poder enviarle la solicitud.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
            <div>
              <label htmlFor="sp-proveedor" className="mb-1 block text-[11px] font-medium text-gray-500">Proveedor</label>
              <select id="sp-proveedor" value={proveedor} onChange={(e) => { setProveedor(e.target.value); setMarcadas(null); setConServicios(true); reiniciarEleccion(); }} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
                {proveedores.map((p) => <option key={p.proveedor} value={p.proveedor}>{p.proveedor} · {p.clase === "hotel" ? "Hotel" : "Servicios"}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sp-correos" className="mb-1 block text-[11px] font-medium text-gray-500">Correo(s) del proveedor (máx. 5, separados por coma)</label>
              <input id="sp-correos" value={correos} onChange={(e) => setCorreos(e.target.value)} inputMode="email" autoComplete="off" placeholder="reservas@hotel.com" className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
          </div>

          {estancias.length + (nServicios > 0 ? 1 : 0) > 1 && (
            <fieldset className="rounded-lg border border-gray-200 p-3" data-testid="estancias-solicitud">
              <legend className="px-1 text-xs font-semibold text-gray-700">Estancias de esta solicitud</legend>
              <p className="mb-2 text-[11px] text-gray-500">La solicitud lleva solo lo que marques. Si dos hoteles tienen promociones con código distinto, envía una solicitud por hotel.</p>
              {estancias.map((e) => (
                <label key={e.id} className="flex items-center gap-2 py-0.5 text-sm text-gray-800">
                  <input type="checkbox" checked={idsMarcados.includes(e.id)} onChange={(ev) => { const base = marcadas ?? estancias.map((x) => x.id); setMarcadas(ev.target.checked ? [...base, e.id] : base.filter((x) => x !== e.id)); reiniciarEleccion(); }} />
                  <span>{e.nombre}</span> <span className="text-xs text-gray-500">{[e.ingreso, e.salida].filter(Boolean).join(" → ")}</span>
                </label>
              ))}
              {nServicios > 0 && (
                <label className="flex items-center gap-2 py-0.5 text-sm text-gray-800">
                  <input type="checkbox" checked={conServicios} onChange={(ev) => { setConServicios(ev.target.checked); reiniciarEleccion(); }} /> <span>Servicios ({nServicios})</span>
                </label>
              )}
            </fieldset>
          )}

          {vista?.hotelesSugeridos && vista.hotelesSugeridos.length > 0 && (
            <div>
              <label htmlFor="sp-hotel" className="mb-1 block text-[11px] font-medium text-gray-500">Hotel del catálogo (para el código de promoción)</label>
              <select id="sp-hotel" value={hotelId ?? ""} onChange={(e) => { const h = e.target.value ? Number(e.target.value) : null; setHotelId(h); setEleccion({ codigoId: null, sinPromocion: false }); void previsualizar(h, { codigoId: null, sinPromocion: false }); }} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm sm:max-w-sm">
                <option value="">— Ninguno —</option>
                {vista.hotelesSugeridos.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
              </select>
            </div>
          )}

          {hotelId != null && candidatas.length > 0 && (
            <fieldset className="rounded-lg border border-amber-200 bg-amber-50/60 p-3" data-testid="codigo-promocion">
              <legend className="px-1 text-xs font-semibold text-amber-900">Código de promoción exigido por el hotel</legend>
              <p className="mb-2 text-[11px] text-amber-900">Si estas fechas caen en una promoción con código, elige cuál usar; si la reserva no usa la promoción, indícalo. No se envía sin una de las dos opciones.</p>
              {candidatas.map((c) => (
                <label key={c.codigoId} className="flex items-center gap-2 py-0.5 text-sm text-gray-800">
                  <input type="radio" name="codigo-promo" checked={eleccion.codigoId === c.codigoId} onChange={() => elegir({ codigoId: c.codigoId, sinPromocion: false })} />
                  <span>{c.nombre}</span> {c.codigoCargado ? <span className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-gray-700">{c.codigo}</span> : <span className="text-xs text-red-600">código sin digitar</span>}
                </label>
              ))}
              <label className="flex items-center gap-2 py-0.5 text-sm text-gray-800">
                <input type="radio" name="codigo-promo" checked={eleccion.sinPromocion} onChange={() => elegir({ codigoId: null, sinPromocion: true })} /> Esta reserva no usa la promoción
              </label>
            </fieldset>
          )}

          <MensajeAdicional id="sp-mensaje" valor={mensaje} onChange={setMensaje} />
          {vista?.ok && !vistaVigente && <p role="note" className="text-[11px] text-amber-700">El mensaje adicional cambió: genera de nuevo la vista previa para ver y enviar la versión actual.</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void previsualizar()} disabled={ocupado || !proveedor} className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--brand-primary)] px-3 py-2 text-xs font-medium text-[var(--brand-primary)] disabled:opacity-40">
              <Eye className="h-3.5 w-3.5" aria-hidden /> Vista previa
            </button>
            <button type="button" onClick={enviar} disabled={ocupado || !proveedor || !vistaVigente} className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
              <Send className="h-3.5 w-3.5" aria-hidden /> {ocupado ? "Procesando…" : "Enviar solicitud"}
            </button>
          </div>
          {modoCaptura && <p className="text-[11px] text-amber-700">Modo de captura local: el correo NO sale de esta máquina.</p>}

          {vista?.ok && (
            <div className="rounded-lg border border-gray-200" data-testid="vista-previa-solicitud">
              <p className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600"><b>Asunto:</b> {vista.asunto}</p>
              <iframe title="Vista previa del correo" sandbox="" srcDoc={vista.html} className="h-80 w-full bg-white" />
              <details className="border-t border-gray-200 px-3 py-2 text-xs text-gray-600"><summary className="cursor-pointer font-medium">Versión en texto plano</summary><pre className="mt-2 whitespace-pre-wrap font-sans">{vista.texto}</pre></details>
            </div>
          )}
        </div>
      )}
      {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`mt-2 text-xs ${msg.tipo === "error" ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}

      {solicitudes.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100">
          {solicitudes.map((s) => {
            const resp = respuestas.filter((r) => r.solicitudId === s.id);
            const puedeDecidir = RANGO[s.estado] >= 2 && s.estado !== "fallida";
            return (
              <li key={s.id} className="py-3 text-sm" data-testid={`solicitud-${s.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{s.proveedor ?? "Proveedor"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${COLOR[s.estado]}`}>{ETIQUETA_ESTADO[s.estado]}</span>
                  <span className="text-xs text-gray-400">{s.destinatarios.join(", ")}</span>
                  {s.codigo_texto && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700" title={s.codigo_promocion ?? undefined}>Código {s.codigo_texto}</span>}
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  {[`Enviada: ${fecha(s.enviada_en) ?? "—"}`, `Entregada: ${fecha(s.entregada_en) ?? "—"}`, `Respondió: ${fecha(s.respondida_en) ?? "—"}`, `Decisión registrada: ${fecha(s.confirmada_en) ?? "—"}`].join(" · ")}
                </p>
                {(s.estado === "fallida" || s.estado === "incierta") && s.error_envio && <p className={`mt-1 text-xs ${s.estado === "fallida" ? "text-red-600" : "text-amber-700"}`}>{s.error_envio}</p>}
                {s.estado === "incierta" && <p className="mt-1 text-xs text-amber-700">No se sabe si el correo salió. Verifica con el proveedor antes de reenviar: «Reenviar como nueva» crea una solicitud nueva.</p>}
                {resp.map((r, i) => (
                  <blockquote key={i} className="mt-2 border-l-2 border-amber-300 bg-amber-50/50 px-3 py-1.5 text-xs text-gray-700">
                    <span className="font-medium">{r.de ?? "Proveedor"}</span> · {fecha(r.creada)}<br />{r.texto ?? "(sin texto)"}
                  </blockquote>
                ))}
                <div className="mt-2 flex flex-wrap gap-2">
                  {puedeDecidir && (
                    <>
                      <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => registrarDecisionProveedor(numero, s.id, "confirmacion", identidad))} className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 disabled:opacity-40">Registrar: el proveedor confirmó</button>
                      <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => registrarDecisionProveedor(numero, s.id, "rechazo", identidad))} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-40">Registrar: el proveedor rechazó</button>
                    </>
                  )}
                  {correoHabilitado && s.proveedor && (s.estado === "fallida" || s.estado === "enviando") && (
                    <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => reintentarEnvioSolicitudProveedor(numero, s.id, identidad))} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40">Reintentar envío</button>
                  )}
                  {correoHabilitado && s.proveedor && s.estado !== "fallida" && s.estado !== "enviando" && (
                    <button type="button" disabled={ocupado} onClick={() => {
                      // A new version is an EXPLICIT, REVIEWED send of the CURRENT data: the preview of this supplier must have been generated first.
                      if (proveedor !== s.proveedor || !vistaVigente) { setMsg({ tipo: "error", texto: "Para crear una versión nueva elige este proveedor, escribe los correos y genera la vista previa del contenido actual; luego vuelve a pulsar «Reenviar como nueva»." }); return; }
                      if (confirm("Se enviará una NUEVA solicitud con el contenido actual de la vista previa (la anterior queda en el historial). ¿Continuar?")) void ejecutar(() => enviarSolicitudProveedor(numero, s.proveedor!, correos, identidad, hotelId, { codigoId: eleccion.codigoId, sinPromocion: eleccion.sinPromocion }, true, seleccion(), mensaje));
                    }} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40">Reenviar como nueva</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-gray-400">«Entregada» significa que el servidor del proveedor aceptó el correo; «Respondió» que llegó una respuesta asociada a esta solicitud; la confirmación del servicio la registra una persona de la agencia.</p>
    </section>
  );
}
