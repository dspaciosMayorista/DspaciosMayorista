"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { guardarImagenPrograma } from "../actions";

type Campo = "portada_url" | "flyer_url" | "historia_url";
const MAX_MB = 10;

const PIEZAS: { campo: Campo; titulo: string; ayuda: string }[] = [
  { campo: "portada_url", titulo: "Portada (fondo del programa)", ayuda: "Imagen de fondo del encabezado y las tarjetas. Se ajusta sola a la vista pública (recomendado horizontal, 1600×900)." },
  { campo: "flyer_url", titulo: "Flyer", ayuda: "Pieza ya diseñada (cuadrada). El cliente la descarga desde el documento." },
  { campo: "historia_url", titulo: "Historia (IG)", ayuda: "Pieza vertical 1080×1920. El cliente la descarga desde el documento." },
];

export function ProgramaImagenes({
  programaId,
  valores,
}: {
  programaId: number;
  valores: { portada_url: string | null; flyer_url: string | null; historia_url: string | null };
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Imágenes y piezas (portada, flyer, historia)</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-gray-100 p-4 sm:grid-cols-3">
          {PIEZAS.map((p) => (
            <Uploader key={p.campo} programaId={programaId} campo={p.campo} titulo={p.titulo} ayuda={p.ayuda} url={valores[p.campo]} />
          ))}
        </div>
      )}
    </section>
  );
}

function Uploader({ programaId, campo, titulo, ayuda, url }: { programaId: number; campo: Campo; titulo: string; ayuda: string; url: string | null }) {
  const router = useRouter();
  const [subiendo, setSubiendo] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  async function subir(file: File) {
    setErr("");
    if (!file.type.startsWith("image/")) { setErr("Solo imágenes (JPG, PNG, WebP)."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`La imagen supera ${MAX_MB} MB.`); return; }
    setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${programaId}/${campo}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("programas").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: pub } = sb.storage.from("programas").getPublicUrl(path);
      const r = await guardarImagenPrograma(programaId, campo, pub.publicUrl);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir.");
    } finally { setSubiendo(false); }
  }

  function quitar() {
    start(async () => { await guardarImagenPrograma(programaId, campo, null); router.refresh(); });
  }

  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className="text-xs font-semibold text-gray-700">{titulo}</p>
      <p className="mt-0.5 text-[11px] text-gray-400">{ayuda}</p>

      <div className="mt-2 flex aspect-video items-center justify-center overflow-hidden rounded-md bg-gray-50">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={titulo} className="h-full w-full object-contain" />
        ) : (
          <span className="text-[11px] text-gray-400">Sin imagen</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          {subiendo ? "Subiendo…" : url ? "Cambiar" : "Subir"}
          <input type="file" className="hidden" disabled={subiendo} accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ""; }} />
        </label>
        {url && (
          <>
            <a href={`${url}?download`} className="text-xs text-[var(--brand-accent)] hover:underline">Descargar</a>
            <button type="button" onClick={quitar} disabled={pending} className="text-xs text-red-500 hover:underline">Quitar</button>
          </>
        )}
      </div>
      {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
    </div>
  );
}
