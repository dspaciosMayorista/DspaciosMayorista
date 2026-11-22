"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Paperclip, Pencil, Plus, Trash2, Users } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { adjuntarEvidenciaCotizacion, guardarPasajerosAliado, retirarEvidenciaCotizacion } from "@/app/portal/b2b/cotizaciones/preparacion-actions";
import {
  errorPasajerosAliado, MAX_EVIDENCIAS_COTIZACION, pasajeroAliadoVacio, resumenPasajeroAliado, sinFilasVacias,
  type PasajeroAliado, type PreparacionCotizacion,
} from "@/lib/portal/preparacionContrato";
import { TIPOS_DOC_PASAJERO, ETIQUETA_TIPO_DOC } from "@/lib/personas/tiposDocumento";
import type { TipoDocPersona } from "@/lib/personas/identidad";
import { formatFechaLarga } from "@/lib/utils";
import { capacidadCaptura, notaCaptura, puedeAgregarCaptura, universoDeViajeros } from "@/lib/reservar/universoViajeros";

const inp = "w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-[#1D7C9A]";
const lbl = "mb-0.5 block text-[11px] text-gray-500";
const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/**
 * O-3 — preparación OPCIONAL de la solicitud: comprobantes (evidencia que verá el personal antes de registrar un pago; NO es un pago) y pasajeros adicionales.
 * Nada aquí solicita el contrato ni registra dinero. El estado mostrado viene del servidor; los mensajes, de la respuesta del servidor.
 */
export function PanelPreparacionContrato({ cotizacionId, pax, prep, hoy }: { cotizacionId: number; pax: number | null; prep: PreparacionCotizacion; hoy: string }) {
  const [pendiente, iniciar] = useTransition();
  const [msgEv, setMsgEv] = useState<{ ok: boolean; texto: string } | null>(null);
  const [msgPa, setMsgPa] = useState<{ ok: boolean; texto: string } | null>(null);
  // Cada fila lleva una llave estable y su estado abierta/compacta: quitar o reabrir una fila no pierde lo escrito en las demás. Las ya completas nacen compactas; las vacías o incompletas, abiertas.
  const llave = useRef(0);
  const nueva = (p: PasajeroAliado, abierta: boolean) => ({ k: llave.current++, p, abierta });
  const [filas, setFilas] = useState(() => prep.pasajeros.map((p) => nueva(p, !p.nombres.trim() || !p.apellidos.trim())));
  const pasajeros = filas.map((f) => f.p);
  const abrir = (k: number, abierta: boolean) => setFilas((l) => l.map((f) => (f.k === k ? { ...f, abierta } : f)));
  const archivo = useRef<HTMLInputElement>(null);
  const universo = prep.universo ?? universoDeViajeros(pax);
  const maxAdic = capacidadCaptura(universo); // lo que se puede GUARDAR aquí (universo acotado por el límite técnico de 30)
  const puedeAgregar = puedeAgregarCaptura(universo, filas.length + 1); // +1: el titular, que ya se capturó en el checkout
  const lleno = prep.evidencias.length >= MAX_EVIDENCIAS_COTIZACION;

  const adjuntar = () => {
    const f = archivo.current?.files?.[0];
    if (!f) { setMsgEv({ ok: false, texto: "Elige un archivo." }); return; }
    const fd = new FormData(); fd.set("cotizacionId", String(cotizacionId)); fd.set("archivo", f);
    iniciar(async () => {
      setMsgEv(null);
      const r = await adjuntarEvidenciaCotizacion(fd);
      setMsgEv(r.ok ? { ok: true, texto: "Comprobante adjunto. Lo verá el personal antes de registrar tu pago." } : { ok: false, texto: r.error });
      if (r.ok && archivo.current) archivo.current.value = "";
    });
  };
  const retirar = (id: number) => iniciar(async () => {
    setMsgEv(null);
    const r = await retirarEvidenciaCotizacion(id);
    setMsgEv(r.ok ? { ok: true, texto: "Comprobante retirado." } : { ok: false, texto: r.error });
  });
  const set = (llaveFila: number, k: keyof PasajeroAliado, v: string) => setFilas((l) => l.map((f) => (f.k === llaveFila ? { ...f, p: { ...f.p, [k]: v } } : f)));
  const guardar = () => {
    const lista = sinFilasVacias(pasajeros);
    const e = errorPasajerosAliado(lista, hoy, 2);
    if (e) {
      // Lo inválido nunca queda escondido: se abren las filas con error y el mensaje las nombra.
      setFilas((l) => l.map((f) => (errorPasajerosAliado([f.p], hoy) ? { ...f, abierta: true } : f)));
      setMsgPa({ ok: false, texto: e }); return;
    }
    iniciar(async () => {
      setMsgPa(null);
      const r = await guardarPasajerosAliado(cotizacionId, lista);
      if (r.ok) setFilas(lista.map((x) => nueva(x, false)));
      setMsgPa(r.ok ? { ok: true, texto: r.guardados ? `Guardamos ${r.guardados} pasajero(s) adicional(es). El personal los recibirá sin volver a escribirlos.` : "No hay pasajeros adicionales guardados." } : { ok: false, texto: r.error });
    });
  };

  return (
    <details className="rounded-lg border border-gray-200 bg-white" data-testid="preparacion-contrato">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs font-semibold text-[#1D7C9A]">
        <span className="inline-flex items-center gap-1"><Paperclip aria-hidden size={13} /> Preparar la solicitud (opcional)</span>
        <span className="font-normal text-gray-500" data-testid="preparacion-resumen">{prep.evidencias.length} comprobante(s) · {prep.pasajeros.length} pasajero(s) adicional(es)</span>
      </summary>
      <div className="grid gap-4 border-t border-gray-100 p-3 md:grid-cols-2">
        <section aria-label="Comprobantes" className="min-w-0 text-left">
          <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-700"><FileText aria-hidden size={13} /> Comprobantes de pago</h4>
          <p className="mb-2 text-[11px] text-gray-500">El personal autorizado verá estos archivos antes de registrar tu pago. <strong>Adjuntar un comprobante no registra ni aprueba ningún pago.</strong> PDF, JPG o PNG, hasta {MAX_EVIDENCIAS_COTIZACION}.</p>
          {prep.evidencias.length > 0 && (
            <ul className="mb-2 space-y-1" data-testid="evidencias-lista">
              {prep.evidencias.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded border border-gray-100 px-2 py-1 text-xs">
                  <span className="min-w-0 truncate" title={e.nombre_original}>{e.nombre_original} <span className="text-gray-400">· {kb(e.size_bytes)} · {formatFechaLarga(e.subido_en.slice(0, 10))}</span></span>
                  <button type="button" onClick={() => retirar(e.id)} disabled={pendiente} aria-label={`Retirar ${e.nombre_original}`} className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 aria-hidden size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={archivo} type="file" accept="application/pdf,image/jpeg,image/png" aria-label="Archivo del comprobante" disabled={pendiente || lleno} className="min-w-0 max-w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1" />
            <button type="button" onClick={adjuntar} disabled={pendiente || lleno} data-testid="adjuntar-evidencia"
              className="inline-flex items-center gap-1 rounded-lg border border-[#1D7C9A] px-2 py-1 text-xs font-semibold text-[#1D7C9A] hover:bg-[rgba(29,124,154,0.08)] disabled:opacity-50">
              <Paperclip aria-hidden size={13} /> {pendiente ? "Enviando…" : "Adjuntar comprobante"}
            </button>
          </div>
          {lleno && <p className="mt-1 text-[11px] text-gray-500">Llegaste al máximo de {MAX_EVIDENCIAS_COTIZACION} comprobantes; retira uno para adjuntar otro.</p>}
          {msgEv && <p role="status" className={`mt-1 text-[11px] ${msgEv.ok ? "text-[#3f7d63]" : "text-red-600"}`}>{msgEv.texto}</p>}
        </section>

        <section aria-label="Pasajeros adicionales" className="min-w-0 text-left">
          <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-700"><Users aria-hidden size={13} /> Pasajeros adicionales</h4>
          {!prep.captura.ok ? (
            <p className="text-[11px] text-gray-500" data-testid="sin-captura-pasajeros">{prep.captura.motivo}</p>
          ) : maxAdic === 0 ? (
            <p className="text-[11px] text-gray-500">Esta cotización es para un solo viajero: el titular que ya registraste.</p>
          ) : (
            <>
              <p className="mb-2 text-[11px] text-gray-500">Opcional. Puedes dejar nombre y apellido ahora y completar el documento y la fecha de nacimiento después; el personal recibirá lo que escribas sin volver a digitarlo. Hasta {maxAdic} además del titular.</p>
              <div className="space-y-2">
                {filas.map(({ k, p, abierta }, i) => {
                  const res = resumenPasajeroAliado(p);
                  return !abierta ? (
                    <div key={k} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-gray-100 px-2 py-1.5" data-testid="pasajero-aliado-resumen">
                      <div className="min-w-0 text-xs">
                        <span className="font-semibold text-gray-600">Pasajero {i + 2}</span> <span className="text-gray-800">{res.titulo}</span>
                        {res.detalle && <span className="text-gray-500"> · {res.detalle}</span>}
                        {res.faltan.length > 0 && <span className="ml-1 text-amber-700" data-testid="pasajero-faltan">Faltan: {res.faltan.join(", ")}</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => abrir(k, true)} aria-label={`Editar pasajero ${i + 2}`} data-testid="editar-pasajero" className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1D7C9A] hover:underline"><Pencil aria-hidden size={12} /> Editar</button>
                        <button type="button" onClick={() => setFilas((l) => l.filter((f) => f.k !== k))} aria-label={`Quitar pasajero ${i + 2}`} className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:underline"><Trash2 aria-hidden size={12} /> Quitar</button>
                      </div>
                    </div>
                  ) : (
                  <fieldset key={k} className="rounded-lg border border-gray-100 p-2" data-testid="pasajero-aliado">
                    <legend className="px-1 text-[11px] font-semibold text-gray-500">Pasajero {i + 2}</legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div><label className={lbl}>Nombres</label><input className={inp} value={p.nombres} onChange={(e) => set(k, "nombres", e.target.value)} maxLength={100} /></div>
                      <div><label className={lbl}>Apellidos</label><input className={inp} value={p.apellidos} onChange={(e) => set(k, "apellidos", e.target.value)} maxLength={100} /></div>
                      <div><label className={lbl}>Tipo doc</label>
                        <select className={inp} value={p.tipoDoc} onChange={(e) => set(k, "tipoDoc", e.target.value)}>
                          <option value="">—</option>
                          {TIPOS_DOC_PASAJERO.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO_DOC[t as TipoDocPersona]}</option>)}
                        </select></div>
                      <div><label className={lbl}>N° doc</label><input className={inp} value={p.numeroDoc} onChange={(e) => set(k, "numeroDoc", e.target.value)} maxLength={30} inputMode="text" /></div>
                      <div className="sm:col-span-2"><label className={lbl}>Nacimiento</label><DateInput aria-label={`Nacimiento pasajero ${i + 2}`} type="date" className="w-full" value={p.fechaNacimiento} max={hoy} onValueChange={(v) => set(k, "fechaNacimiento", v)} /></div>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      {p.nombres.trim() && p.apellidos.trim() && !errorPasajerosAliado([p], hoy) && (
                        <button type="button" onClick={() => abrir(k, false)} data-testid="compactar-pasajero" className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Listo</button>
                      )}
                      <button type="button" onClick={() => setFilas((l) => l.filter((f) => f.k !== k))} className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:underline"><Trash2 aria-hidden size={12} /> Quitar</button>
                    </div>
                  </fieldset>
                  );
                })}
              </div>
              {notaCaptura(universo, filas.length + 1) && <p className="mt-2 text-[11px] text-gray-500" data-testid="nota-universo">{notaCaptura(universo, filas.length + 1)}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {puedeAgregar && (
                  <button type="button" onClick={() => setFilas((l) => [...l, nueva(pasajeroAliadoVacio(), true)])} disabled={pendiente} data-testid="agregar-pasajero"
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Plus aria-hidden size={13} /> Agregar pasajero</button>
                )}
                <button type="button" onClick={guardar} disabled={pendiente} data-testid="guardar-pasajeros"
                  className="inline-flex items-center gap-1 rounded-lg border border-[#1D7C9A] px-2 py-1 text-xs font-semibold text-[#1D7C9A] hover:bg-[rgba(29,124,154,0.08)] disabled:opacity-50">{pendiente ? "Guardando…" : "Guardar pasajeros"}</button>
              </div>
              {msgPa && <p role="status" className={`mt-1 text-[11px] ${msgPa.ok ? "text-[#3f7d63]" : "text-red-600"}`}>{msgPa.texto}</p>}
            </>
          )}
        </section>
      </div>
    </details>
  );
}
