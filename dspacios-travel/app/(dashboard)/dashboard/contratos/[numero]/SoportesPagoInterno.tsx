"use client";

// Soportes de pago del aliado (#86) — vista del PERSONAL INTERNO en la ficha del contrato. Abrir vigentes, consultar el historial (reemplazados, retirados y rechazados siguen
// disponibles; nada se borra) y, para quien tiene permiso, RECHAZAR un soporte vigente con un motivo obligatorio (S339-02). Un soporte no es un pago: rechazarlo, igual que subirlo,
// no registra ni aprueba nada y no cambia ningún saldo. El rechazado sale de la vista activa y libera su cupo; el aliado recibe un correo y lo corrige desde su portal.
import { useState, useTransition } from "react";
import { Ban, ExternalLink, FileText, Image as ImagenIcono, RefreshCw } from "lucide-react";
import { urlSoporteInterno, rechazarSoporte, reintentarAvisoRechazo } from "./soportes-actions";
import { estaExcedido, maximoSoportes } from "@/lib/soportes/archivo";
import { MOTIVO_MAX } from "@/lib/soportes/rechazo";
import type { IdentidadContrato } from "@/lib/contrato/identidad";

export type SoporteInterno = {
  id: number; nombre_original: string; mime: string; size_bytes: number; subido_en: string;
  vigente: boolean; motivo_retiro: "reemplazo" | "retiro" | "rechazo" | null; retirado_en: string | null; nota_retiro: string | null; reemplaza_id: number | null;
  /** 345: soporte rechazado que esta fila corrige. */
  corrige_id?: number | null;
  /** 345: quien retiró/rechazó (su id; el nombre llega aparte en `nombres`). */
  retirado_por?: string | null;
};
/** Estado del correo al aliado por un rechazo (tabla soporte_rechazo_aviso; solo lo ve quien puede rechazar). */
export type AvisoRechazo = { estado: "pendiente" | "enviando" | "enviado" | "fallido" | "sin_destinatario"; intentos: number; error?: string | null };

const kb = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);
const fecha = (iso: string) => new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
const TEXTO_AVISO: Record<AvisoRechazo["estado"], string> = {
  pendiente: "Aviso al aliado: pendiente de envío", enviando: "Aviso al aliado: enviándose", enviado: "Aviso al aliado: enviado por correo",
  fallido: "Aviso al aliado: el correo no salió", sin_destinatario: "Aviso al aliado: sin cuenta de aliado con correo",
};

export function SoportesPagoInterno({ soportes, abonos, identidad, puedeRechazar = false, avisos = {}, nombres = {} }: {
  soportes: SoporteInterno[]; abonos: number; identidad?: IdentidadContrato; puedeRechazar?: boolean;
  avisos?: Record<number, AvisoRechazo>; nombres?: Record<string, string>;
}) {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [rechazando, setRechazando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pend, iniciar] = useTransition();
  const vigentes = soportes.filter((s) => s.vigente);
  const rechazados = soportes.filter((s) => s.motivo_retiro === "rechazo");
  const historial = soportes.filter((s) => !s.vigente && s.motivo_retiro !== "rechazo");
  const pendientesCorreccion = rechazados.filter((r) => !soportes.some((x) => x.corrige_id === r.id));
  if (soportes.length === 0) return null;

  async function abrir(id: number) {
    setError("");
    const r = await urlSoporteInterno(id);
    if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer"); else setError(r.error);
  }
  function confirmarRechazo(id: number) {
    setError(""); setInfo("");
    iniciar(async () => {
      const r = await rechazarSoporte(id, motivo, identidad ?? {});
      if (!r.ok) { setError(r.error); return; }
      setRechazando(null); setMotivo(""); setInfo(`Soporte rechazado. ${r.aviso.mensaje}`);
    });
  }
  function reintentar(id: number) {
    setError(""); setInfo("");
    iniciar(async () => {
      const r = await reintentarAvisoRechazo(id);
      if (!r.ok) setError(r.error); else setInfo(r.aviso.mensaje);
    });
  }
  const icono = (s: SoporteInterno) => s.mime === "application/pdf" ? <FileText size={16} aria-hidden className="shrink-0 text-gray-400" /> : <ImagenIcono size={16} aria-hidden className="shrink-0 text-gray-400" />;
  const abrirBtn = (s: SoporteInterno) => (
    <button type="button" onClick={() => void abrir(s.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-[#1D7C9A] hover:bg-gray-50">
      <ExternalLink size={14} aria-hidden /> Abrir
    </button>
  );
  const etiquetaRetiro = (s: SoporteInterno) => (s.motivo_retiro === "reemplazo" ? "reemplazado" : s.motivo_retiro === "rechazo" ? "rechazado" : "retirado");
  const fila = (s: SoporteInterno) => (
    <li key={s.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {icono(s)}
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm text-gray-800" title={s.nombre_original}>{s.nombre_original}</p>
          <p className="text-[11px] text-gray-400">
            {kb(s.size_bytes)} · subido {fecha(s.subido_en)}
            {!s.vigente && s.retirado_en && <> · {etiquetaRetiro(s)} {fecha(s.retirado_en)}{s.nota_retiro ? ` · «${s.nota_retiro}»` : ""}</>}
            {s.reemplaza_id && <> · sustituye al soporte #{s.reemplaza_id}</>}
            {s.corrige_id && <> · corrige el soporte rechazado #{s.corrige_id}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {abrirBtn(s)}
          {s.vigente && puedeRechazar && (
            <button type="button" disabled={pend} onClick={() => { setRechazando(s.id); setMotivo(""); setError(""); setInfo(""); }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-[#C0392B] hover:bg-red-50 disabled:opacity-50">
              <Ban size={14} aria-hidden /> Rechazar
            </button>
          )}
        </div>
      </div>
      {rechazando === s.id && (
        <form className="mt-2 space-y-2 rounded-lg bg-red-50/60 p-3" onSubmit={(e) => { e.preventDefault(); confirmarRechazo(s.id); }}>
          <label className="block text-xs font-medium text-gray-700" htmlFor={`motivo-${s.id}`}>Motivo del rechazo (obligatorio; el aliado lo verá)</label>
          <textarea id={`motivo-${s.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MOTIVO_MAX} rows={3} required
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Ej.: El archivo corresponde a otro contrato / no se lee el valor transferido." />
          <p className="text-[11px] text-gray-500">Rechazar no registra ni cambia ningún pago. El archivo queda en el historial y el aliado recibe un correo con el motivo para subir el soporte correcto.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pend || motivo.trim() === ""} className="rounded-lg bg-[#C0392B] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{pend ? "Rechazando…" : "Confirmar rechazo"}</button>
            <button type="button" disabled={pend} onClick={() => setRechazando(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">Cancelar</button>
          </div>
        </form>
      )}
    </li>
  );
  const filaRechazado = (s: SoporteInterno) => {
    const correccion = soportes.find((x) => x.corrige_id === s.id);
    const av = avisos[s.id];
    return (
      <li key={s.id} className="rounded-lg border border-red-100 bg-white px-3 py-2" data-testid={`rechazado-${s.id}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {icono(s)}
          <div className="min-w-0 flex-1 basis-48">
            <p className="truncate text-sm text-gray-800" title={s.nombre_original}>{s.nombre_original}</p>
            <p className="text-[11px] text-gray-500">
              Rechazado {s.retirado_en ? fecha(s.retirado_en) : ""}{s.retirado_por && nombres[s.retirado_por] ? ` por ${nombres[s.retirado_por]}` : ""} · motivo: «{s.nota_retiro}»
            </p>
            <p className="text-[11px] text-gray-400">
              {correccion ? `Corregido con el soporte #${correccion.id} (${fecha(correccion.subido_en)})` : "Pendiente de corrección por el aliado"}
              {av && <> · {TEXTO_AVISO[av.estado]}{av.estado === "fallido" || av.estado === "pendiente" ? ` (intentos: ${av.intentos} de 5)` : ""}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {abrirBtn(s)}
            {puedeRechazar && av && (av.estado === "fallido" || av.estado === "pendiente") && av.intentos < 5 && (
              <button type="button" disabled={pend} onClick={() => reintentar(s.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <RefreshCw size={14} aria-hidden /> Reintentar aviso
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className="mt-8 rounded-xl border border-gray-300 bg-white p-4 shadow-sm sm:p-5" aria-label="Soportes de pago del aliado">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700">Soportes de pago del aliado</p>
        <span className="text-xs text-gray-500">Vigentes {vigentes.length} de {maximoSoportes(abonos)} permitidos ({abonos} {abonos === 1 ? "abono registrado" : "abonos registrados"} + 1 adicional)</span>
      </div>
      {estaExcedido(vigentes.length, abonos) && (
        <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Hay más soportes vigentes de los permitidos (p. ej. tras anular un abono). No se descartó ninguna evidencia; el aliado puede reemplazar o retirar, no agregar.
        </p>
      )}
      {!estaExcedido(vigentes.length, abonos) && vigentes.length > abonos && (
        <p role="status" className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Hay más soportes vigentes que abonos registrados: el aliado puede haber adjuntado la evidencia de un pago aún sin registrar. Revisa los soportes y registra el abono que corresponda; no se sabe a cuál abono pertenece cada soporte.
        </p>
      )}
      <p className="mb-2 text-[11px] text-gray-400">Un soporte no registra ni aprueba un pago: es evidencia que adjunta el aliado. El historial conserva cada archivo reemplazado, retirado o rechazado.</p>
      {vigentes.length > 0 && <ul className="space-y-2">{vigentes.map(fila)}</ul>}
      {vigentes.length === 0 && <p className="text-xs text-gray-500">No hay soportes vigentes.</p>}
      {rechazados.length > 0 && (
        <details className="mt-3" open={pendientesCorreccion.length > 0 && info !== ""}>
          <summary className="cursor-pointer text-xs font-medium text-[#C0392B]">
            Rechazados ({rechazados.length}){pendientesCorreccion.length > 0 ? ` · ${pendientesCorreccion.length} pendiente(s) de corrección` : " · todos corregidos"}
          </summary>
          <ul className="mt-2 space-y-2">{rechazados.map(filaRechazado)}</ul>
        </details>
      )}
      {historial.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-600">Historial conservado ({historial.length})</summary>
          <ul className="mt-2 space-y-2">{historial.map(fila)}</ul>
        </details>
      )}
      {info && <p role="status" className="mt-2 text-xs text-green-700">{info}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-[#C0392B]">{error}</p>}
    </section>
  );
}
