"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Lock, Trash2 } from "lucide-react";

type Resp = { ok: true } | { ok: false; error: string };
export type PropsLogoAliado = {
  /** Nombre del aliado (texto alternativo de la vista previa). */
  nombre: string;
  /** Ruta AUTORIZADA que sirve el logo (nunca una URL pública del bucket). */
  src: string;
  puedeCambiar: boolean;
  /** Por qué no puede cambiarlo (se muestra con candado). */
  motivo?: string | null;
  subir: (fd: FormData) => Promise<Resp>;
  retirar: () => Promise<Resp>;
  /** Campo extra del formulario (solo Aliados interno: el aliado elegido en la fila). */
  extra?: Record<string, string>;
};

const MAX = 1_048_576;
const CAJA = "rounded-xl border border-gray-200 bg-white p-4";

/** #32 — Logo del aliado: vista previa + subir/cambiar/quitar. El servidor valida el tipo real del archivo y la elegibilidad; aquí solo se evita el viaje inútil. */
export function LogoAliado(p: PropsLogoAliado) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const imagen = useRef<HTMLImageElement>(null);
  const [version, setVersion] = useState(0);
  const [hay, setHay] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  // Una imagen que ya terminó (cargó o dio 404) ANTES de la hidratación no dispara onLoad/onError: se lee su estado real al montar y tras cada cambio de versión.
  useEffect(() => {
    const i = imagen.current;
    if (i && i.complete) setHay(i.naturalWidth > 0);
  }, [version]);

  function elegido(f: File | undefined) {
    setMsg(null);
    if (!f) return;
    if (f.size > MAX) { setMsg({ ok: false, texto: "El logo no puede superar 1 MB." }); if (input.current) input.current.value = ""; return; }
    const fd = new FormData();
    fd.set("logo", f);
    for (const [k, v] of Object.entries(p.extra ?? {})) fd.set(k, v);
    empezar(async () => {
      const r = await p.subir(fd);
      if (input.current) input.current.value = "";
      if (r.ok) { setMsg({ ok: true, texto: "Logo actualizado." }); setHay(null); setVersion((v) => v + 1); router.refresh(); }
      else setMsg({ ok: false, texto: r.error });
    });
  }
  function quitar() {
    setMsg(null);
    empezar(async () => {
      const r = await p.retirar();
      if (r.ok) { setMsg({ ok: true, texto: "Logo retirado." }); setHay(false); setVersion((v) => v + 1); router.refresh(); }
      else setMsg({ ok: false, texto: r.error });
    });
  }

  return (
    <section className={CAJA} aria-labelledby="ed-logo" data-testid="logo-aliado-editor">
      <h2 id="ed-logo" className="mb-1 text-sm font-semibold text-gray-700">Logo en tus cotizaciones</h2>
      <p className="mb-3 text-xs text-gray-500">Tu logo aparece como marca principal de tus cotizaciones. La agencia emisora y sus datos legales no cambian.</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-44 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2">
          {hay === false ? (
            <span className="text-xs text-gray-400">Sin logo</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img ref={imagen} src={`${p.src}${p.src.includes("?") ? "&" : "?"}v=${version}`} alt={`Logo de ${p.nombre || "tu empresa"}`} className="max-h-full max-w-full object-contain" onLoad={() => setHay(true)} onError={() => setHay(false)} />
          )}
        </div>
        {p.puedeCambiar ? (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" id="logo-aliado-archivo" disabled={pendiente} onChange={(e) => elegido(e.target.files?.[0])} />
            <label htmlFor="logo-aliado-archivo" className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white ${pendiente ? "opacity-60" : ""}`} style={{ backgroundColor: "var(--brand-primary)" }}>
              <ImagePlus className="h-4 w-4" aria-hidden /> {hay ? "Cambiar logo" : "Subir logo"}
            </label>
            {hay === true && (
              <button type="button" disabled={pendiente} onClick={quitar} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-60">
                <Trash2 className="h-4 w-4" aria-hidden /> Quitar
              </button>
            )}
            <span className="text-[11px] text-gray-400">PNG o JPG, máximo 1 MB.</span>
          </div>
        ) : (
          p.motivo && <p className="flex items-start gap-1.5 text-xs text-gray-500"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{p.motivo}</p>
        )}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.texto}</p>}
    </section>
  );
}
