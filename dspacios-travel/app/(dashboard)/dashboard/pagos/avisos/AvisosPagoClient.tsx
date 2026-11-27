"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Paperclip, Send } from "lucide-react";
import { ETIQUETA_ESTADO, type EstadoSolicitud } from "@/lib/solicitudProveedor/nucleo";
import type { PagoListado } from "@/lib/solicitudProveedor/cargar";
import { dinero } from "@/lib/solicitudProveedor/avisoPago";
import { MensajeAdicional } from "@/components/solicitudProveedor/MensajeAdicional";
import { enviarAvisoPago, pagosDelProveedor, previsualizarAvisoPago, reintentarAvisoPago, subirSoportePago, type VistaPreviaPago } from "./actions";

export type AvisoHistorial = { id: number; proveedor: string | null; estado: EstadoSolicitud; destinatarios: string[]; asunto: string; referencia: string | null; error_envio: string | null; enviada_en: string | null; entregada_en: string | null; respondida_en: string | null; created_at: string };
const fecha = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(iso)) : "—");

export function AvisosPagoClient({ proveedores, historial, correoHabilitado, modoCaptura }: { proveedores: string[]; historial: AvisoHistorial[]; correoHabilitado: boolean; modoCaptura: boolean }) {
  const router = useRouter();
  const [proveedor, setProveedor] = useState("");
  const [pagos, setPagos] = useState<PagoListado[]>([]);
  const [selPagos, setSelPagos] = useState<number[]>([]);
  const [selSoportes, setSelSoportes] = useState<number[]>([]);
  const [referencia, setReferencia] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [correos, setCorreos] = useState("");
  const [vista, setVista] = useState<VistaPreviaPago | null>(null);
  const [nuevaVersion, setNuevaVersion] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const guardia = useRef(false);
  const archivo = useRef<HTMLInputElement>(null);

  async function envolver(f: () => Promise<void>) {
    if (guardia.current) return;
    guardia.current = true; setOcupado(true); setMsg(null);
    try { await f(); } catch { setMsg({ tipo: "error", texto: "No se pudo completar la acción. Intenta de nuevo." }); } finally { guardia.current = false; setOcupado(false); }
  }
  const cargar = (p: string) => envolver(async () => {
    setProveedor(p); setPagos([]); setSelPagos([]); setSelSoportes([]); setVista(null);
    if (!p) return;
    const r = await pagosDelProveedor(p);
    if (r.ok) setPagos(r.pagos); else setMsg({ tipo: "error", texto: r.error });
  });
  const alternar = (arr: number[], id: number, set: (x: number[]) => void) => { set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]); setVista(null); };
  const entrada = () => ({ proveedor, pagoIds: selPagos, soporteIds: selSoportes, referencia, ...(mensaje.trim() ? { mensaje } : {}) });

  const reintentar = (id: number) => envolver(async () => {
    const r = await reintentarAvisoPago(id);
    setMsg(r.ok ? { tipo: "ok", texto: r.mensaje } : { tipo: "error", texto: r.error });
    router.refresh();
  });
  const subir = () => envolver(async () => {
    const f = archivo.current?.files?.[0];
    if (!f) return setMsg({ tipo: "error", texto: "Elige un archivo (PDF, JPG o PNG, máx. 5 MB)." });
    if (!selPagos.length) return setMsg({ tipo: "error", texto: "Marca primero los pagos que respalda el archivo." });
    const fd = new FormData(); fd.set("archivo", f); fd.set("pagoIds", JSON.stringify(selPagos));
    const r = await subirSoportePago(fd);
    setMsg(r.ok ? { tipo: "ok", texto: r.mensaje } : { tipo: "error", texto: r.error });
    if (r.ok) { if (archivo.current) archivo.current.value = ""; const p = await pagosDelProveedor(proveedor); if (p.ok) setPagos(p.pagos); }
  });
  const previsualizar = () => envolver(async () => { const v = await previsualizarAvisoPago(entrada()); setVista(v); if (!v.ok) setMsg({ tipo: "error", texto: v.error }); });
  const enviar = () => envolver(async () => {
    const r = await enviarAvisoPago({ ...entrada(), destinatarios: correos, reenviar: nuevaVersion });
    setMsg(r.ok ? { tipo: "ok", texto: r.mensaje } : { tipo: "error", texto: r.error });
    if (r.ok) { router.refresh(); const p = await pagosDelProveedor(proveedor); if (p.ok) setPagos(p.pagos); }
  });

  return (
    <div className="space-y-4">
      {!correoHabilitado && <p role="note" className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">El envío por correo todavía no está habilitado: puedes preparar la vista previa y guardar soportes, pero no enviar.</p>}
      {modoCaptura && <p className="text-[11px] text-amber-700">Modo de captura local: el correo NO sale de esta máquina.</p>}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <label htmlFor="av-proveedor" className="mb-1 block text-[11px] font-medium text-gray-500">Proveedor</label>
        <select id="av-proveedor" value={proveedor} onChange={(e) => void cargar(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm sm:max-w-sm">
          <option value="">— Elige un proveedor con pagos registrados —</option>{proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        {proveedor && (
          <div className="mt-4 overflow-x-auto">
            {pagos.length === 0 ? <p className="text-xs text-gray-500">Este proveedor no tiene pagos registrados.</p> : (
              <table className="w-full min-w-[640px] text-left text-sm" data-testid="pagos-aviso">
                <thead><tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500"><th className="py-1 pr-2" scope="col"><span className="sr-only">Incluir</span></th><th scope="col">Reserva</th><th scope="col">Servicio</th><th scope="col">Fecha</th><th scope="col" className="text-right">Valor</th><th scope="col" className="pl-3">Soportes</th></tr></thead>
                <tbody>
                  {pagos.map((p) => (
                    <tr key={p.pagoId} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2"><input type="checkbox" aria-label={`Incluir el pago ${p.pagoId} de ${p.numeroContrato}`} checked={selPagos.includes(p.pagoId)} onChange={() => alternar(selPagos, p.pagoId, setSelPagos)} /></td>
                      <td className="py-2 font-mono text-xs">{p.numeroContrato}</td><td className="py-2 text-xs text-gray-600">{p.servicio ?? "—"}</td><td className="py-2 text-xs">{p.fecha}</td>
                      <td className="py-2 text-right text-xs">{dinero(p.valor, p.moneda)}{p.yaAvisado && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">ya avisado</span>}</td>
                      <td className="py-2 pl-3 text-xs">{p.soportes.length === 0 ? <span className="text-gray-400">sin soporte</span> : p.soportes.map((s) => (
                        <label key={s.id} className="flex items-center gap-1"><input type="checkbox" checked={selSoportes.includes(s.id)} onChange={() => alternar(selSoportes, s.id, setSelSoportes)} /> <Paperclip className="h-3 w-3" aria-hidden /> {s.nombre}</label>))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {proveedor && pagos.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs font-medium text-gray-700">Subir soporte de los pagos marcados</p>
              <input ref={archivo} type="file" accept="application/pdf,image/png,image/jpeg" aria-label="Archivo de soporte" className="mt-2 block w-full text-xs" />
              <button type="button" disabled={ocupado} onClick={() => void subir()} className="mt-2 rounded-lg border border-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] disabled:opacity-40">Guardar soporte</button>
            </div>
            <div className="space-y-2">
              <div><label htmlFor="av-ref" className="mb-0.5 block text-[11px] text-gray-500">Referencia del pago (opcional)</label><input id="av-ref" value={referencia} maxLength={120} onChange={(e) => { setReferencia(e.target.value); setVista(null); }} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" /></div>
              <MensajeAdicional id="av-mensaje" valor={mensaje} onChange={(t) => { setMensaje(t); setVista(null); }} />
              <div><label htmlFor="av-correos" className="mb-0.5 block text-[11px] text-gray-500">Correo(s) del proveedor (máx. 5, separados por coma)</label><input id="av-correos" value={correos} onChange={(e) => setCorreos(e.target.value)} inputMode="email" autoComplete="off" className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" /></div>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="button" disabled={ocupado || !selPagos.length} onClick={() => void previsualizar()} className="flex items-center gap-1.5 rounded-lg border border-[var(--brand-primary)] px-3 py-2 text-xs font-medium text-[var(--brand-primary)] disabled:opacity-40"><Eye className="h-3.5 w-3.5" aria-hidden /> Vista previa</button>
              <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={nuevaVersion} onChange={(e) => setNuevaVersion(e.target.checked)} /> Enviar como versión nueva (el proveedor pudo recibir ya uno igual)</label>
              <button type="button" disabled={ocupado || !vista?.ok || !correoHabilitado} onClick={() => void enviar()} className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"><Send className="h-3.5 w-3.5" aria-hidden /> {ocupado ? "Procesando…" : "Enviar aviso"}</button>
            </div>
          </div>
        )}
        {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`mt-3 text-xs ${msg.tipo === "error" ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
        {vista?.ok && (
          <div className="mt-3 rounded-lg border border-gray-200" data-testid="vista-previa-pago">
            <p className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600"><b>Asunto:</b> {vista.asunto}{vista.yaAvisados.length > 0 && <span className="ml-2 text-amber-700">· {vista.yaAvisados.length} pago(s) ya se avisaron antes</span>}</p>
            <iframe title="Vista previa del aviso de pago" sandbox="" srcDoc={vista.html} className="h-72 w-full bg-white" />
            <details className="border-t border-gray-200 px-3 py-2 text-xs text-gray-600"><summary className="cursor-pointer font-medium">Versión en texto plano</summary><pre className="mt-2 whitespace-pre-wrap font-sans">{vista.texto}</pre></details>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">Avisos enviados</h2>
        {historial.length === 0 ? <p className="mt-2 text-xs text-gray-400">Todavía no se ha enviado ningún aviso de pago.</p> : (
          <ul className="mt-2 divide-y divide-gray-100">{historial.map((h) => (
            <li key={h.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-gray-800">{h.proveedor}</span><span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">{ETIQUETA_ESTADO[h.estado]}</span><span className="text-xs text-gray-400">{h.destinatarios.join(", ")}</span></div>
              <p className="text-[11px] text-gray-500">{h.asunto} · Enviada: {fecha(h.enviada_en)} · Entregada: {fecha(h.entregada_en)} · Respondió: {fecha(h.respondida_en)}</p>
              {(h.estado === "fallida" || h.estado === "incierta") && h.error_envio && <p className="text-xs text-amber-700">{h.error_envio}</p>}
              {h.estado === "incierta" && <p className="text-xs text-amber-700">No se sabe si salió. Verifica con el proveedor; para volver a enviarlo usa «Enviar como versión nueva» en el formulario.</p>}
              {correoHabilitado && (h.estado === "fallida" || h.estado === "enviando") && <button type="button" disabled={ocupado} onClick={() => void reintentar(h.id)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40">Reintentar envío</button>}
            </li>))}</ul>
        )}
      </section>
    </div>
  );
}
