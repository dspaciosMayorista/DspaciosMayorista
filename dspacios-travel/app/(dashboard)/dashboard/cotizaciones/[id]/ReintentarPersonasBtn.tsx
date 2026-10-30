"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, UserX } from "lucide-react";

// #42 (C7): aviso PERSISTENTE de la ficha cuando el titular o un pasajero identificado de la
// cotización no tiene puesto en el registro de personas (lo calcula la página; no es una marca).
// "Reintentar" llama a la acción de servidor que reconstruye los puestos desde el payload
// guardado; la base vuelve a comprobar actor, tenant y estado.
export function ReintentarPersonasBtn({
  pendientes,
  reintentar,
}: {
  pendientes: number;
  reintentar: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function onClick() {
    setErr("");
    start(async () => {
      const r = await reintentar();
      if (r.ok) router.refresh();
      else setErr(r.error);
    });
  }

  return (
    <div role="status" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2">
          <UserX size={16} aria-hidden />
          Personas pendientes de registrar en CRM ({pendientes}).
        </p>
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          <RotateCw size={14} aria-hidden className={pending ? "animate-spin" : ""} />
          {pending ? "Reintentando…" : "Reintentar"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  );
}
