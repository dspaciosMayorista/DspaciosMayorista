"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check } from "lucide-react";
import { revisarAlertaCompra } from "@/lib/avisos/actions";
import type { AlertaCompraVista } from "@/lib/avisos/alertasCompra";

// B3-02 — Alertas de fin de compra en el área de ALERTAS del tablero (ya no en la campana). Se leen una vez por carga (sin sondeo); «Revisado» saca la alerta de la vista activa de ESTA persona.
// Una alerta revisada no vuelve mientras la fecha de fin no cambie; si cambia la fecha (o se desactiva y reactiva la fuente) nace una alerta nueva, sin revisar.
export function AlertasCompra({ alertas: inicial, total: totalInicial }: { alertas: AlertaCompraVista[]; total: number }) {
  const router = useRouter();
  const [alertas, setAlertas] = useState(inicial);
  const [total, setTotal] = useState(totalInicial);
  const [error, setError] = useState("");
  const [pendiente, start] = useTransition();

  function revisar(id: number) {
    setError("");
    start(async () => {
      const r = await revisarAlertaCompra(id);
      if (!r.ok) { setError("No se pudo marcar como revisada. Recarga el tablero e inténtalo de nuevo."); return; }
      const quedan = alertas.filter((a) => a.id !== id);
      setAlertas(quedan);
      setTotal((t) => Math.max(0, t - 1));
      if (total - 1 > quedan.length) router.refresh();   // había más alertas de las que caben en la lista: se trae la siguiente tanda
    });
  }

  if (alertas.length === 0) return null;
  return (
    <div id="alertas-compra" className="mt-3 rounded-lg border p-3" style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }} data-testid="alertas-compra">
      <p className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--dash-ink)" }}>
        <CalendarClock size={14} aria-hidden="true" /> Vigencias de compra por terminar ({total})
      </p>
      <ul className="mt-2 divide-y" style={{ borderColor: "var(--dash-border)" }}>
        {alertas.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2" style={{ borderColor: "var(--dash-border)" }} data-testid="alerta-compra">
            <Link href={a.href} prefetch={false} className="min-w-0 flex-1 basis-60 text-xs font-medium hover:underline [overflow-wrap:anywhere]" style={{ color: "var(--dash-primary)" }}>{a.texto}</Link>
            <button type="button" onClick={() => revisar(a.id)} disabled={pendiente} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-60" style={{ borderColor: "var(--dash-border)", color: "var(--dash-ink)" }} aria-label={`Marcar como revisado: ${a.texto}`}>
              <Check size={13} aria-hidden="true" /> Revisado
            </button>
          </li>
        ))}
      </ul>
      {total > alertas.length && <p className="mt-1.5 text-[11px]" style={{ color: "var(--dash-ink-muted)" }} data-testid="alertas-compra-recortado">Se muestran {alertas.length} de {total}: al revisar una aparece la siguiente.</p>}
      {error && <p role="alert" className="mt-1.5 text-xs" style={{ color: "var(--dash-danger)" }}>{error}</p>}
      <p className="mt-1.5 text-[11px]" style={{ color: "var(--dash-ink-muted)" }}>«Revisado» solo saca la alerta de tu vista. Si cambia la fecha de fin de esa vigencia, aparece una alerta nueva.</p>
    </div>
  );
}
