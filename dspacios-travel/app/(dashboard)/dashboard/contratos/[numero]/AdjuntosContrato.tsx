"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Lock } from "lucide-react";
import { registrarAdjunto, urlFirmadaAdjunto, eliminarAdjunto } from "./adjuntos-actions";

export type Adjunto = {
  id: number; tipo: string; nombre: string | null; path: string;
  size_bytes: number | null; subido_por: string | null; created_at: string;
};

const TIPOS = [
  { value: "cedula", label: "Cédula" },
  { value: "pago", label: "Soporte de pago" },
  { value: "abono", label: "Soporte de abono" },
  { value: "otro", label: "Otro" },
];
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]));
const MAX_MB = 10;

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// `puedeEditar` false = un asesor consultando el contrato de un colega. Ve la
// lista (saber qué soportes existen es información de gestión) pero no sube
// ni elimina. La RLS de `contrato_adjuntos` y las policies de Storage de la
// migración 148 imponen lo mismo del lado del servidor: esto es para que no
// haya botones que solo sirven para recibir un error.
export function AdjuntosContrato({ numeroContrato, adjuntos, puedeEditar = true }: { numeroContrato: string; adjuntos: Adjunto[]; puedeEditar?: boolean }) {
  const router = useRouter();
  const [tipo, setTipo] = useState("cedula");
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");

  const total = adjuntos.reduce((s, a) => s + (a.size_bytes ?? 0), 0);

  async function subir(file: File) {
    setErr("");
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`El archivo supera ${MAX_MB} MB. Comprímelo o súbelo más liviano.`); return; }
    setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "bin";
      const path = `${numeroContrato}/${tipo}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("contratos").upload(path, file, { upsert: false });
      if (error) throw error;
      const r = await registrarAdjunto({ numeroContrato, tipo, nombre: file.name, path, sizeBytes: file.size });
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir el archivo.");
    } finally { setSubiendo(false); }
  }

  return (
    <section className="mt-8 rounded-xl border border-gray-300 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700">Adjuntos del contrato</p>
        {puedeEditar && <span className="text-xs text-gray-400">{adjuntos.length} archivo(s) · {fmtBytes(total)}</span>}
      </div>

      {puedeEditar && (
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <label className="inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          {subiendo ? "Subiendo…" : "Subir archivo"}
          <input type="file" className="hidden" disabled={subiendo} accept="image/*,application/pdf"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ""; }} />
        </label>
        <span className="text-xs text-gray-400">Cédula, soporte de pago/abono. PDF o imagen, máx {MAX_MB} MB.</span>
      </div>
      )}
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      {adjuntos.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Archivo</th>
              <th className="px-3 py-2">Tamaño</th><th className="px-3 py-2">Subido por</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>{adjuntos.map((a) => <Fila key={a.id} a={a} numeroContrato={numeroContrato} puedeEditar={puedeEditar} />)}</tbody>
          </table>
        </div>
      ) : puedeEditar ? (
        <p className="rounded-lg border-2 border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">Aún no hay adjuntos.</p>
      ) : (
        // En solo lectura la lista SIEMPRE llega vacía: `contrato_adjuntos`
        // está limitada a contratos propios desde la migración 142. Decir "aún
        // no hay adjuntos" sería afirmar algo que no se sabe — el contrato
        // puede tener la cédula y los soportes de pago cargados. Se dice lo que
        // de verdad pasa.
        <div className="flex items-start gap-3 rounded-lg border-2 border-dashed border-gray-200 px-4 py-5">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-600">Adjuntos protegidos</p>
            <p className="mt-0.5 text-gray-400">
              Cédulas y soportes de pago solo los consulta el asesor responsable del contrato.
              Desde aquí no se puede saber si tiene archivos cargados.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Fila({ a, numeroContrato, puedeEditar }: { a: Adjunto; numeroContrato: string; puedeEditar: boolean }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function descargar() {
    setBusy(true);
    const r = await urlFirmadaAdjunto(a.path);
    setBusy(false);
    if (r.ok) window.open(r.url, "_blank"); else alert(r.error);
  }

  return (
    <tr className="border-t border-gray-50">
      <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{TIPO_LABEL[a.tipo] ?? a.tipo}</span></td>
      <td className="px-3 py-2 text-gray-700">{a.nombre ?? a.path.split("/").pop()}</td>
      <td className="px-3 py-2 text-gray-500">{fmtBytes(a.size_bytes)}</td>
      <td className="px-3 py-2 text-gray-500">{a.subido_por ?? "—"}</td>
      <td className="px-3 py-2 text-gray-500">{a.created_at.slice(0, 10)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={descargar} disabled={busy} className="mr-3 text-xs font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
          {busy ? "…" : "Descargar"}
        </button>
        {puedeEditar && (
          <button type="button" disabled={pending}
            onClick={() => { if (confirm("¿Eliminar este adjunto?")) start(() => { void eliminarAdjunto(a.id, a.path, numeroContrato); }); }}
            className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
        )}
      </td>
    </tr>
  );
}
