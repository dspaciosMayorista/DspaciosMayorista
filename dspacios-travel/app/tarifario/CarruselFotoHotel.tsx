"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Una foto a la vez (sin reproducción automática) con flechas y contador.
// Con una sola foto no hay controles; sin fotos queda «Sin foto». Los controles
// son hermanos —nunca hijos— de lo que sea clicable en la tarjeta: el llamador
// decide qué va debajo (`children` = capa de clic o etiquetas).
export function CarruselFotoHotel({
  fotos, alt, fondo, sizes = "(max-width:1024px) 50vw, 33vw", className = "object-cover", children,
}: {
  fotos: readonly string[];
  alt: string;
  /** Si hay video, reemplaza la foto y no hay controles. */
  fondo?: React.ReactNode;
  sizes?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  // Al cambiar de hotel (otra galería) se vuelve a la primera foto.
  const clave = JSON.stringify(fotos);
  const [est, setEst] = useState({ clave, i: 0 });
  const i = est.clave === clave ? Math.min(est.i, Math.max(fotos.length - 1, 0)) : 0;
  const ir = (d: number) => setEst({ clave, i: (i + d + fotos.length) % fotos.length });
  const flecha = "absolute top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-gray-100">
      {fondo ?? (fotos.length ? (
        <Image key={fotos[i]} src={fotos[i]} alt={alt} fill sizes={sizes} className={className} unoptimized />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
      ))}
      {children}
      {!fondo && fotos.length > 1 && (
        <>
          <button type="button" aria-label={`Foto anterior de ${alt}`} onClick={() => ir(-1)} className={`${flecha} left-2`}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label={`Foto siguiente de ${alt}`} onClick={() => ir(1)} className={`${flecha} right-2`}>
            <ChevronRight className="h-4 w-4" />
          </button>
          <span aria-live="polite" className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
            {i + 1} / {fotos.length}
          </span>
        </>
      )}
    </div>
  );
}
