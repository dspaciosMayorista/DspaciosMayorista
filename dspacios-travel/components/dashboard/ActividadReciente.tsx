import { Activity } from "lucide-react";
import { UMBRAL_RECIENTE_MIN } from "@/lib/actividad/actividadReciente";
import type { ResumenActividad } from "@/lib/actividad/consulta";
import { PresenciaModal } from "./PresenciaModal";

// #11 / B3-01 — Presencia reciente: recuadro COMPACTO con los conteos (un agregado) y un botón que abre el modal con el detalle paginado por persona (personal interno / aliados B2B).
// La página decide cuándo montarlo (solo superadmin; la base lo exige otra vez). Componente de SERVIDOR sin sondeo: el detalle se carga solo al abrir el modal.
export function ActividadReciente({ resumen, error }: { resumen: ResumenActividad | null; error: boolean }) {
  const caja = { backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" } as const;
  return (
    <section className="mt-5 rounded-lg border p-4" style={caja} data-testid="actividad-reciente" aria-labelledby="actividad-reciente-titulo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="actividad-reciente-titulo" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>
          <Activity size={14} aria-hidden="true" /> Presencia reciente
        </h2>
        {resumen && !error && <PresenciaModal personalTotal={resumen.personal_total} aliadosTotal={resumen.aliados_total} />}
      </div>
      {error || !resumen ? (
        <p role="status" className="mt-2 text-sm" style={{ color: "var(--dash-ink-muted)" }} data-testid="actividad-error">No se pudo leer la presencia del equipo y los aliados. El resto del tablero no se ve afectado.</p>
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--dash-ink-muted)" }} data-testid="presencia-resumen">
          En los últimos {UMBRAL_RECIENTE_MIN} min: {resumen.personal_recientes} del personal · {resumen.aliados_recientes} {resumen.aliados_recientes === 1 ? "aliado" : "aliados"} · {resumen.sin_observacion} sin observación todavía.
          {" "}Es la última actividad observada, no una conexión en vivo; el detalle por persona está en «Ver presencia».
        </p>
      )}
    </section>
  );
}
