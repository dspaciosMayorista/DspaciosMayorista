import type { LogoAliadoDoc } from "@/lib/aliados/logo";

// #32 (ADL-039) — Marca del aliado en SUS cotizaciones. El logo es presentación: el emisor legal (razón social, NIT, RNT de `agencias`) sigue visible
// y sin cambios en `EmisorLinea`. Se muestra sobre una tarjeta blanca porque el archivo del aliado puede traer fondo claro u oscuro.

export function LogoAliado({ logo, className = "h-12" }: { logo: LogoAliadoDoc; className?: string }) {
  return (
    <div className="inline-flex max-w-[200px] items-center self-start rounded-md bg-white px-2 py-1" data-testid="logo-aliado">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.src} alt={`Logo de ${logo.nombre}`} className={`${className} max-w-full w-auto object-contain`} />
    </div>
  );
}

/** Franja del emisor legal: se imprime siempre que el logo del aliado ocupe el lugar principal de la marca. */
export function EmisorLinea({ razonSocial, nit, rnt, aliado }: { razonSocial: string; nit: string; rnt: string; aliado: string }) {
  return (
    <div className="border-b border-gray-200 bg-gray-50 px-5 py-1.5 text-center text-[10px] leading-snug text-gray-600 md:px-8" data-testid="emisor-linea">
      Cotización presentada por <strong>{aliado}</strong>, emitida por <strong>{razonSocial}</strong> · NIT {nit} · RNT {rnt}. El logo es del aliado que presenta la cotización; la agencia emisora y responsable es la indicada.
    </div>
  );
}
