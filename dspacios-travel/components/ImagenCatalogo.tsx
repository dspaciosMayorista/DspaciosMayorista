"use client";

import { useState } from "react";

// Photo of a catalog card (Programas cover, Receptivo photo). Fills its positioned parent, which must reserve the
// space (aspect-ratio or fixed height) so nothing shifts while the image loads.
//  - `prioridad`: the single above-the-fold image (eager + fetchpriority high). Everything else is lazy.
//  - A missing or failed image shows the same «Sin foto» placeholder; one failure = one placeholder, never a retry.
export function ImagenCatalogo({ src, alt, prioridad = false, className = "" }: { src: string | null | undefined; alt: string; prioridad?: boolean; className?: string }) {
  const [fallida, setFallida] = useState<string | null>(null);
  if (!src || fallida === src) {
    return <div className="flex h-full w-full items-center justify-center text-sm text-gray-300" data-testid="imagen-sin-foto">Sin foto</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // An <img> that failed before hydration never fires React's onError: look at it once on mount.
      ref={(el) => { if (el && el.complete && el.naturalWidth === 0) setFallida(src); }}
      src={src}
      alt={alt}
      loading={prioridad ? "eager" : "lazy"}
      fetchPriority={prioridad ? "high" : "auto"}
      decoding="async"
      onError={() => setFallida(src)}
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
    />
  );
}
