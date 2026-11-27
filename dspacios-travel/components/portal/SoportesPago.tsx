"use client";

// Soportes de pago del aliado (#86). Tarjetas por contrato (sin tablas ni scroll horizontal), mismo patrón que Mis ventas/Cartera de #441.
// Un soporte NO es un pago: no cambia abonos ni saldos. El límite (soportes vigentes ≤ pagos registrados + 1 adicional) lo impone la base de datos;
// aquí solo se explica y se evitan clics inútiles. Reemplazar y retirar conservan el historial y el archivo anterior (visible para el equipo interno).
import { useRef, useState, useTransition } from "react";
import { FileText, Image as ImagenIcono, Paperclip, RefreshCw, Trash2, ExternalLink, AlertTriangle } from "lucide-react";
import { subirSoporte, reemplazarSoporte, retirarSoporte, corregirSoporte, urlSoporteAliado } from "@/app/portal/b2b/cartera/soportes-actions";
import { estaExcedido, cabeUnoNuevo, maximoSoportes } from "@/lib/soportes/archivo";
import { numeroVisible } from "@/lib/tenant";
import type { IdentidadContrato } from "@/lib/contrato/identidad";

export type SoporteVista = { id: number; nombre_original: string; mime: string; size_bytes: number; subido_en: string };
/** S339-02: soporte que el equipo RECHAZÓ y aún no tiene corrección (con el motivo que escribió quien lo rechazó). */
export type SoporteRechazadoVista = { id: number; nombre_original: string; motivo: string; rechazado_en: string };
export type ContratoSoportes = { numero: string; cliente: string | null; abonos: number; soportes: SoporteVista[]; rechazados?: SoporteRechazadoVista[]; identidad: IdentidadContrato };

const kb = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

export function SoportesPago({ contratos, maximo, maximoTexto }: { contratos: ContratoSoportes[]; maximo: number; maximoTexto: string }) {
  if (contratos.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-300 bg-white/70 p-6 text-center text-sm text-gray-500">Aún no tienes contratos propios a los que adjuntar soportes de pago.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Adjunta el comprobante de tus pagos (PDF, JPG o PNG, máximo <strong>{maximoTexto}</strong> por archivo). Puedes tener hasta un soporte vigente por cada pago registrado del contrato
        y uno adicional, para un pago que el equipo aún no ha registrado; un solo archivo puede reunir varios pagos. Subir un soporte no registra ni aprueba un pago, ni cambia el saldo: el equipo lo revisa y registra el pago.
      </p>
      <ul className="space-y-3">
        {contratos.map((c) => <li key={c.numero}><TarjetaContrato c={c} maximo={maximo} /></li>)}
      </ul>
    </div>
  );
}

function TarjetaContrato({ c, maximo }: { c: ContratoSoportes; maximo: number }) {
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pend, iniciar] = useTransition();
  const inputNuevo = useRef<HTMLInputElement>(null);
  const vigentes = c.soportes.length;
  const rechazados = c.rechazados ?? [];
  const excedido = estaExcedido(vigentes, c.abonos);
  const permitidos = maximoSoportes(c.abonos);
  const puedeSubir = cabeUnoNuevo(vigentes, c.abonos);

  const correr = (f: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    iniciar(async () => {
      setMsg(null);
      const r = await f();
      setMsg(r.ok ? { tipo: "ok", texto: ok } : { tipo: "error", texto: r.error ?? "No se pudo completar la acción." });
    });

  function alElegir(e: React.ChangeEvent<HTMLInputElement>, reemplazaId?: number, corrigeId?: number) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > maximo) { setMsg({ tipo: "error", texto: `El archivo supera el máximo permitido de ${kb(maximo)}.` }); return; }
    const fd = new FormData();
    fd.set("archivo", f);
    if (corrigeId) { fd.set("id", String(corrigeId)); correr(() => corregirSoporte(fd, c.identidad), "Soporte corregido enviado. El equipo lo revisará."); }
    else if (reemplazaId) { fd.set("id", String(reemplazaId)); correr(() => reemplazarSoporte(fd, c.identidad), "Soporte reemplazado. El anterior queda en el historial del equipo."); }
    else { fd.set("numero", c.numero); correr(() => subirSoporte(fd, c.identidad), "Soporte subido."); }
  }

  async function abrir(id: number) {
    setMsg(null);
    const r = await urlSoporteAliado(id, c.identidad);
    if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer"); else setMsg({ tipo: "error", texto: r.error });
  }

  return (
    <article className="rounded-xl border border-gray-200 bg-white/80 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="font-mono text-sm font-semibold text-[#1D7C9A]">{numeroVisible(c.numero)}</h3>
          <p className="truncate text-xs text-gray-500">{c.cliente ?? "—"}</p>
        </div>
        <p className="text-xs text-gray-600" aria-live="polite">
          Soportes vigentes: <strong>{vigentes}</strong> de <strong>{permitidos}</strong> permitidos
          <span className="block text-[11px] text-gray-400 sm:text-right">{c.abonos} {c.abonos === 1 ? "pago registrado" : "pagos registrados"} + 1 adicional</span>
        </p>
      </header>

      {excedido && (
        <p role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Hay más soportes vigentes de los permitidos (por ejemplo, tras corregir un pago). No se pierde nada: puedes reemplazar o retirar soportes, pero no agregar nuevos hasta que cuadren.
        </p>
      )}

      {rechazados.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Soportes rechazados por el equipo">
          {rechazados.map((r) => (
            <li key={r.id} data-testid={`rechazado-${r.id}`} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[#C0392B]"><AlertTriangle size={16} aria-hidden /> Soporte rechazado por el equipo</p>
              <p className="mt-1 truncate text-sm text-gray-800" title={r.nombre_original}>{r.nombre_original} <span className="text-[11px] text-gray-500">· {new Date(r.rechazado_en).toLocaleDateString("es-CO", { dateStyle: "medium" })}</span></p>
              <p className="mt-1 text-sm text-gray-800"><strong>Motivo:</strong> {r.motivo}</p>
              <p className="mt-1 text-[11px] text-gray-500">Sube el archivo correcto: el rechazado queda en el historial del equipo y no cuenta como vigente. Corregir no registra ni cambia ningún pago.</p>
              <div className="mt-2">
                <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#1D7C9A] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 ${pend || !puedeSubir ? "pointer-events-none opacity-40" : ""}`}>
                  <RefreshCw size={14} aria-hidden /> Corregir soporte
                  <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={pend || !puedeSubir} onChange={(e) => alElegir(e, undefined, r.id)} />
                </label>
                {!puedeSubir && <p className="mt-1 text-[11px] text-gray-500">Ya tienes todos los soportes vigentes permitidos: reemplaza uno de ellos con el archivo correcto, o espera a que se registre un pago.</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {vigentes > 0 && (
        <ul className="mt-3 space-y-2">
          {c.soportes.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
              {s.mime === "application/pdf" ? <FileText size={18} aria-hidden className="shrink-0 text-gray-400" /> : <ImagenIcono size={18} aria-hidden className="shrink-0 text-gray-400" />}
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm text-gray-800" title={s.nombre_original}>{s.nombre_original}</p>
                <p className="text-[11px] text-gray-400">{kb(s.size_bytes)} · {new Date(s.subido_en).toLocaleDateString("es-CO", { dateStyle: "medium" })}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void abrir(s.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-[#1D7C9A] hover:bg-gray-50">
                  <ExternalLink size={14} aria-hidden /> Abrir
                </button>
                <label className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 ${pend ? "pointer-events-none opacity-50" : ""}`}>
                  <RefreshCw size={14} aria-hidden /> Reemplazar
                  <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={pend} onChange={(e) => alElegir(e, s.id)} />
                </label>
                <button
                  type="button" disabled={pend}
                  onClick={() => { if (window.confirm("¿Retirar este soporte? Dejará de estar vigente; el equipo conserva el archivo y su historial.")) correr(() => retirarSoporte(s.id, undefined, c.identidad), "Soporte retirado."); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-[#C0392B] hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={14} aria-hidden /> Retirar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button" disabled={pend || !puedeSubir} onClick={() => inputNuevo.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D7C9A] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Paperclip size={14} aria-hidden /> {pend ? "Procesando…" : "Subir soporte"}
        </button>
        <input ref={inputNuevo} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} onChange={(e) => alElegir(e)} />
        {puedeSubir && vigentes >= c.abonos && <p className="text-xs text-gray-500">{c.abonos === 0 ? "Aún no hay pagos registrados: puedes adjuntar un soporte y el equipo registrará el pago." : "Tienes un soporte vigente por cada pago registrado: este es el soporte adicional, para un pago aún sin registrar."}</p>}
        {!puedeSubir && <p className="text-xs text-gray-500">Ya usaste todos los soportes permitidos (uno por cada pago registrado y uno adicional). Para subir otro, reemplaza o retira uno, o espera a que se registre un pago.</p>}
      </div>

      {msg && (
        <p role={msg.tipo === "error" ? "alert" : "status"} className={`mt-2 text-xs ${msg.tipo === "error" ? "text-[#C0392B]" : "text-green-700"}`}>{msg.texto}</p>
      )}
    </article>
  );
}
