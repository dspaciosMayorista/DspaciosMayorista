"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { duplicarPaquete } from "./actions";

/** #61: duplica el paquete como borrador inactivo y sin publicar, y abre la copia para revisar fechas y precios. */
export function DuplicarPaqueteBtn({ id, nombre }: { id: number; nombre: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setMsg(null);
          const r = await duplicarPaquete(id);
          if (!r.ok) { setMsg(r.error); return; }
          router.push(`/dashboard/paquetes/${r.id}?duplicado=1${r.omitidas ? `&omitidas=${r.omitidas}` : ""}`);
        })}
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[var(--brand-primary)] disabled:opacity-50"
        aria-label={`Duplicar el paquete ${nombre}`}
        data-testid="duplicar-paquete"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {pending ? "Duplicando…" : "Duplicar"}
      </button>
      {msg && <span role="alert" className="mt-1 max-w-xs text-right text-xs text-red-600">{msg}</span>}
    </span>
  );
}
