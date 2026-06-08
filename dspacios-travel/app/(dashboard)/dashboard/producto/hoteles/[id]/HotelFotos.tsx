"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { registrarFotoHotel, marcarPortadaFotoHotel, eliminarFotoHotel } from "./fotos-actions";

export type FotoHotel = {
  id: number; path: string; url: string; orden: number; es_portada: boolean;
};

const MAX_MB = 8;

export function HotelFotos({ hotelId, fotos }: { hotelId: number; fotos: FotoHotel[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");

  async function subir(file: File) {
    setErr("");
    if (!file.type.startsWith("image/")) { setErr("Solo imágenes (JPG, PNG, WebP)."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`La imagen supera ${MAX_MB} MB.`); return; }
    setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${hotelId}/foto-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("hotel-fotos").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: pub } = sb.storage.from("hotel-fotos").getPublicUrl(path);
      const r = await registrarFotoHotel({ hotelId, path, url: pub.publicUrl });
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally { setSubiendo(false); }
  }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">
          Fotos del hotel <span className="font-normal text-gray-400">({fotos.length})</span>
        </span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500">
            Se muestran en el tarifario público (vista dinámica tipo Booking). La <b>portada</b> es la imagen principal.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
              {subiendo ? "Subiendo…" : "Agregar foto"}
              <input type="file" className="hidden" disabled={subiendo} accept="image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ""; }} />
            </label>
            <span className="text-xs text-gray-400">JPG/PNG/WebP, máx {MAX_MB} MB.</span>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}

          {fotos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {fotos.map((f) => <Tarjeta key={f.id} f={f} hotelId={hotelId} />)}
            </div>
          ) : (
            <p className="rounded-lg border-2 border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">Aún no hay fotos.</p>
          )}
        </div>
      )}
    </section>
  );
}

function Tarjeta({ f, hotelId }: { f: FotoHotel; hotelId: number }) {
  const [pending, start] = useTransition();
  return (
    <div className="group relative overflow-hidden rounded-lg border border-gray-200">
      <div className="relative aspect-[4/3] w-full bg-gray-100">
        <Image src={f.url} alt="Foto del hotel" fill sizes="200px" className="object-cover" unoptimized />
      </div>
      {f.es_portada && (
        <span className="absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          Portada
        </span>
      )}
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px]">
        {!f.es_portada ? (
          <button type="button" disabled={pending} onClick={() => start(() => { void marcarPortadaFotoHotel(f.id, hotelId); })}
            className="font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
            Hacer portada
          </button>
        ) : <span className="text-gray-400">Principal</span>}
        <button type="button" disabled={pending}
          onClick={() => { if (confirm("¿Eliminar esta foto?")) start(() => { void eliminarFotoHotel(f.id, f.path, hotelId); }); }}
          className="text-gray-400 hover:text-red-500">Eliminar</button>
      </div>
    </div>
  );
}
