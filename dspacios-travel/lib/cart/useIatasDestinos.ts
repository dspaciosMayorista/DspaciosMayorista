"use client";

// #64 — Código IATA de los destinos del carrito, del CATÁLOGO (acción de servidor). Mientras responde (o si la consulta falla) se usa el catálogo de ciudades; si ahí
// tampoco hay un código único, el destino queda en null y la pantalla pide corregir el dato (no se infiere del nombre).
import { useEffect, useState } from "react";
import { codigoIataDeCiudad } from "@/lib/iata";

export function useIatasDestinos(destinos: readonly (string | null | undefined)[]): (destino: string | null | undefined) => string | null {
  const nombres = [...new Set(destinos.filter((d): d is string => !!d && !!d.trim()))];
  const clave = nombres.join("|");
  const [iatas, setIatas] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let vivo = true;
    import("@/app/tarifario/checkout/actions")
      .then((m) => m.codigosIataDestinos(clave ? clave.split("|") : []))
      .then((r) => { if (vivo) setIatas(r); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [clave]);
  return (destino) => (destino ? (destino in iatas ? iatas[destino] : codigoIataDeCiudad(destino)) : null);
}
