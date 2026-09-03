"use client";

// ─────────────────────────────────────────────────────────────────────────
// Formulario mínimo de excepción a una restricción de condición de pago
// (migración 164, Commit 6). Solo se renderiza para superadmin (gate en el
// padre); el servidor (`registrarOverrideRestriccion` → RPC
// `registrar_override_restriccion`) vuelve a exigir rol=superadmin+activo,
// así que esto es solo UX — el candado real vive en el servidor y en la BD.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { registrarOverrideRestriccion } from "./condiciones-actions";
import { ShieldAlert } from "lucide-react";

export function OverrideRestriccionForm({
  numeroContrato,
  contratoCondicionId,
  restriccion,
}: {
  numeroContrato: string;
  contratoCondicionId: number;
  restriccion: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  if (ok) {
    return <p className="mt-1 text-[11px] text-green-700">Excepción registrada.</p>;
  }
  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline"
      >
        <ShieldAlert className="h-3 w-3" />
        Autorizar excepción
      </button>
    );
  }

  return (
    <div className="mt-2 w-64 rounded-lg border border-amber-200 bg-amber-50 p-2">
      <label className="block text-[10px] font-semibold uppercase text-amber-700">Motivo (obligatorio)</label>
      <textarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={2}
        maxLength={2000}
        className="mt-1 w-full rounded border border-amber-300 bg-white p-1.5 text-xs"
        placeholder="Por qué se autoriza la excepción a esta restricción…"
      />
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            const m = motivo.trim();
            if (!m) {
              setError("El motivo es obligatorio.");
              return;
            }
            startTransition(async () => {
              const res = await registrarOverrideRestriccion(numeroContrato, contratoCondicionId, restriccion, m);
              if (!res.ok) {
                setError(res.error ?? "No se pudo registrar la excepción.");
                return;
              }
              setOk(true);
            });
          }}
          className="rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Confirmar excepción"}
        </button>
        <button
          type="button"
          onClick={() => { setAbierto(false); setError(null); }}
          className="rounded px-2 py-1 text-[11px] text-gray-500 hover:underline"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
