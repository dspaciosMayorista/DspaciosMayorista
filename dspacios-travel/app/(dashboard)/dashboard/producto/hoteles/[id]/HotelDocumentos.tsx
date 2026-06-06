"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { registrarDocumentoHotel, urlFirmadaDocumentoHotel, eliminarDocumentoHotel } from "./documentos-actions";

export type DocumentoHotel = {
  id: number; tipo: string; nombre: string | null; path: string;
  size_bytes: number | null; subido_por: string | null; created_at: string;
};

const TIPOS = [
  { value: "tarifario", label: "Tarifario del hotel" },
  { value: "acuerdo", label: "Acuerdo / contrato" },
  { value: "otro", label: "Otro" },
];
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]));
const MAX_MB = 10;

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function HotelDocumentos({ hotelId, documentos }: { hotelId: number; documentos: DocumentoHotel[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState("tarifario");
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");

  const total = documentos.reduce((s, d) => s + (d.size_bytes ?? 0), 0);

  async function subir(file: File) {
    setErr("");
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`El archivo supera ${MAX_MB} MB. Comprímelo o súbelo más liviano.`); return; }
    setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "bin";
      const path = `${hotelId}/${tipo}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("hoteles").upload(path, file, { upsert: false });
      if (error) throw error;
      const r = await registrarDocumentoHotel({ hotelId, tipo, nombre: file.name, path, sizeBytes: file.size });
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir el archivo.");
    } finally { setSubiendo(false); }
  }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">
          Documentos del hotel <span className="font-normal text-gray-400">({documentos.length})</span>
        </span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500">Respaldo del origen de las tarifas: sube el PDF que envía el hotel (tarifario, acuerdo…).</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Tipo</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label className="inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
              {subiendo ? "Subiendo…" : "Cargar documento"}
              <input type="file" className="hidden" disabled={subiendo} accept="image/*,application/pdf"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ""; }} />
            </label>
            <span className="text-xs text-gray-400">PDF o imagen, máx {MAX_MB} MB.</span>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}

          {documentos.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                  <th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Archivo</th>
                  <th className="px-3 py-2">Tamaño</th><th className="px-3 py-2">Subido por</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2"></th>
                </tr></thead>
                <tbody>{documentos.map((d) => <Fila key={d.id} d={d} hotelId={hotelId} />)}</tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg border-2 border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">Aún no hay documentos.</p>
          )}
          {documentos.length > 0 && <p className="text-right text-xs text-gray-400">Total: {fmtBytes(total)}</p>}
        </div>
      )}
    </section>
  );
}

function Fila({ d, hotelId }: { d: DocumentoHotel; hotelId: number }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function descargar() {
    setBusy(true);
    const r = await urlFirmadaDocumentoHotel(d.path);
    setBusy(false);
    if (r.ok) window.open(r.url, "_blank"); else alert(r.error);
  }

  return (
    <tr className="border-t border-gray-50">
      <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{TIPO_LABEL[d.tipo] ?? d.tipo}</span></td>
      <td className="px-3 py-2 text-gray-700">{d.nombre ?? d.path.split("/").pop()}</td>
      <td className="px-3 py-2 text-gray-500">{fmtBytes(d.size_bytes)}</td>
      <td className="px-3 py-2 text-gray-500">{d.subido_por ?? "—"}</td>
      <td className="px-3 py-2 text-gray-500">{d.created_at.slice(0, 10)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={descargar} disabled={busy} className="mr-3 text-xs font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
          {busy ? "…" : "Descargar"}
        </button>
        <button type="button" disabled={pending}
          onClick={() => { if (confirm("¿Eliminar este documento?")) start(() => { void eliminarDocumentoHotel(d.id, d.path, hotelId); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}
