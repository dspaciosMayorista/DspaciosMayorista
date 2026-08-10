"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { actualizarFotoServicio } from "./actions";

const MAX_MB = 8;
const BUCKET = "servicio-fotos";

// Miniatura clicable: sube (o reemplaza) la única foto del servicio. Se lee en
// vivo desde el tarifario público, así que no hace falta regenerar nada.
export function ServicioFotoCell({ servicioId, fotoUrl }: { servicioId: number; fotoUrl: string | null }) {
  const router = useRouter();
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");

  async function subir(file: File) {
    setErr("");
    if (!file.type.startsWith("image/")) { setErr("Solo imágenes."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`Máx ${MAX_MB} MB.`); return; }
    setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${servicioId}/foto-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
      const r = await actualizarFotoServicio(servicioId, pub.publicUrl);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally { setSubiendo(false); }
  }

  return (
    <div title={err || "Cambiar foto"}>
      <label className="relative block h-10 w-10 cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-50 hover:border-[var(--brand-accent)]">
        {fotoUrl ? (
          <Image src={fotoUrl} alt="" fill sizes="40px" className="object-cover" unoptimized />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[9px] text-gray-400">
            {subiendo ? "…" : "+"}
          </span>
        )}
        <input type="file" className="hidden" disabled={subiendo} accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ""; }} />
      </label>
      {err && <p className="mt-1 max-w-[80px] text-[10px] text-red-600">{err}</p>}
    </div>
  );
}
