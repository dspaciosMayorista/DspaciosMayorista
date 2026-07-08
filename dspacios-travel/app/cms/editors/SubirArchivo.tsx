"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { subirArchivoWeb } from "../upload";

// Campo reutilizable: pegar una URL (incluido link de Drive) O subir un archivo
// al bucket 'web-cms'. Al subir, setea la URL pública devuelta en `value`.
export function SubirArchivo({
  value,
  onChange,
  carpeta = "img",
  placeholder = "https://… o link de Drive",
  accept = "image/*,application/pdf",
}: {
  value: string;
  onChange: (url: string) => void;
  carpeta?: string;
  placeholder?: string;
  accept?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    const fd = new FormData();
    fd.set("file", file);
    fd.set("carpeta", carpeta);
    start(async () => {
      try {
        const r = await subirArchivoWeb(fd);
        if (r.ok) onChange(r.url);
        else setErr(r.error);
      } catch {
        setErr("No se pudo subir el archivo (muy pesado o falla de conexión).");
      } finally {
        if (ref.current) ref.current.value = "";
      }
    });
  }

  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Upload size={13} /> {pending ? "Subiendo…" : "Subir archivo"}
        </button>
        {value ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[#1D7C9A] underline"
          >
            ver
          </a>
        ) : null}
        <input
          ref={ref}
          type="file"
          accept={accept}
          onChange={onFile}
          className="hidden"
        />
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
