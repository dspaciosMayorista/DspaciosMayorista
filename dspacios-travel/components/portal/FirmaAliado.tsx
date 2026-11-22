"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { guardarFirma } from "@/app/portal/b2b/perfil/firma-actions";

const TAM_MAX = 512 * 1024;

/** #98 — Imagen de firma del aliado freelance (PNG/JPG, máx. 512 KB). La vista previa llega como data URI desde el servidor; no hay URL pública. */
export function FirmaAliado({ imagen, vigenteDesde }: { imagen: string | null; vigenteDesde: string | null }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const subir = () => {
    setError(null); setOk(false);
    const f = entrada.current?.files?.[0];
    if (!f) { setError("Elige una imagen de tu firma."); return; }
    if (f.size > TAM_MAX) { setError("La imagen no puede superar 512 KB."); return; }
    const form = new FormData();
    form.set("firma", f);
    iniciar(async () => {
      const r = await guardarFirma(form);
      if (r.ok) { setOk(true); if (entrada.current) entrada.current.value = ""; router.refresh(); } else setError(r.error);
    });
  };

  return (
    <section className="min-w-0 rounded-xl border border-gray-100 bg-white p-4" aria-labelledby="firma-aliado-titulo">
      <h2 id="firma-aliado-titulo" className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-700"><PenLine className="h-4 w-4" aria-hidden="true" />Mi firma</h2>
      <p className="text-xs text-gray-500">
        Se usa para aceptar tus cuentas de cobro. Sube una imagen PNG o JPG de tu firma (máx. 512 KB). Aceptar una cuenta de cobro es una aceptación electrónica de una versión del documento, no una firma digital certificada.
      </p>
      <div className="mt-3 flex min-h-20 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 p-2">
        {imagen
          // eslint-disable-next-line @next/next/no-img-element -- data URI (bucket privado)
          ? <img src={imagen} alt="Tu firma actual" className="max-h-20 max-w-full object-contain" />
          : <span className="text-xs text-gray-400">Aún no has subido tu firma.</span>}
      </div>
      {vigenteDesde && <p className="mt-1 text-[11px] text-gray-400">Vigente desde {vigenteDesde}. Las cuentas ya aceptadas conservan la firma con la que se aceptaron.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={entrada} type="file" accept="image/png,image/jpeg" aria-label="Imagen de tu firma" className="min-w-0 max-w-full text-xs" disabled={pendiente} />
        <button type="button" onClick={subir} disabled={pendiente} className="min-h-10 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
          {pendiente ? "Subiendo…" : imagen ? "Reemplazar firma" : "Subir firma"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      {ok && <p role="status" className="mt-2 text-xs text-green-700">Firma guardada.</p>}
    </section>
  );
}
