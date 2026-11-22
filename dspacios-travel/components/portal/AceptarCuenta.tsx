"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { aceptarCuentaCobro } from "@/app/portal/comision/[numero]/acciones";

/** #98 — Aceptar electrónicamente ESTA versión (el hash identifica el contenido que la persona está viendo). Una sola llamada al pulsar; sin sondeo. */
export function AceptarCuenta({ numero, comisionId, hash }: { numero: string; comisionId: number | null; hash: string }) {
  const router = useRouter();
  const [declaro, setDeclaro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const aceptar = () => {
    setError(null);
    iniciar(async () => {
      const r = await aceptarCuentaCobro({ numero, comisionId, hash });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  };

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm print:hidden" aria-labelledby="aceptar-cuenta-titulo">
      <h2 id="aceptar-cuenta-titulo" className="font-semibold text-gray-800">Aceptar esta cuenta de cobro</h2>
      <p className="mt-1 text-xs text-gray-500">
        Al aceptar, esta versión queda congelada con tu imagen de firma. Si cambia la comisión, la retención o tus datos, se generará una versión nueva que necesitará una nueva aceptación.
        Es una aceptación electrónica, no una firma digital certificada.
      </p>
      <label className="mt-3 flex items-start gap-2 text-xs text-gray-700">
        <input type="checkbox" className="mt-0.5" checked={declaro} onChange={(e) => setDeclaro(e.target.checked)} disabled={pendiente} />
        <span>Revisé los valores y datos de este documento y acepto electrónicamente esta versión con mi imagen de firma.</span>
      </label>
      <button
        type="button"
        onClick={aceptar}
        disabled={!declaro || pendiente}
        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: "var(--brand-primary)" }}
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {pendiente ? "Guardando…" : "Aceptar y firmar esta versión"}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
