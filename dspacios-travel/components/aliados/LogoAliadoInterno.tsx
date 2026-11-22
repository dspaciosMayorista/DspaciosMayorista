"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { LogoAliado } from "@/components/portal/LogoAliado";
import { retirarLogoAliadoInterno, subirLogoAliadoInterno } from "@/app/(dashboard)/dashboard/aliados/logo-actions";

/** #32 — Control de Aliados (superadmin/gerencia): se monta dentro de la fila EXPANDIDA del aliado. No pide nada hasta que se pulsa el botón (cero solicitudes en reposo). */
export function LogoAliadoInterno({ aliadoId, nombre }: { aliadoId: number; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
        <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Logo de marca
      </button>
    );
  }
  return (
    <LogoAliado
      nombre={nombre}
      src={`/dashboard/aliados/logo/${aliadoId}`}
      puedeCambiar
      subir={subirLogoAliadoInterno}
      retirar={() => retirarLogoAliadoInterno(aliadoId)}
      extra={{ aliadoId: String(aliadoId) }}
    />
  );
}
