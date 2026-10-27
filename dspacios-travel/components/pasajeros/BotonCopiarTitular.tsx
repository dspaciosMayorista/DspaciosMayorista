"use client";

// PR #409 — Botón «Copiar datos del cliente» de cada pasajero. La copia solo puede estar en UN pasajero: en el resto el botón queda
// inhabilitado (con la razón a la vista) y en el marcado se convierte en «Deshacer copia».
import { puedeCopiarTitular, type CopiaTitular } from "@/lib/personas/copiaTitular";

export function BotonCopiarTitular({
  indice, copia, onCopiar, onDeshacer, etiqueta = "Copiar datos del cliente",
}: {
  indice: number;
  copia: CopiaTitular;
  onCopiar: () => void;
  onDeshacer: () => void;
  etiqueta?: string;
}) {
  const esteTieneLaCopia = copia?.indice === indice;
  const habilitado = puedeCopiarTitular(copia, indice);
  return (
    <button
      type="button"
      onClick={esteTieneLaCopia ? onDeshacer : onCopiar}
      disabled={!habilitado}
      title={habilitado ? undefined : `Los datos del cliente ya se copiaron en el pasajero ${(copia?.indice ?? 0) + 1}. Deshaz esa copia para usarla aquí.`}
      className="text-xs hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
      style={habilitado ? { color: "var(--brand-accent)" } : undefined}
    >
      {esteTieneLaCopia ? "Deshacer copia" : etiqueta}
    </button>
  );
}
