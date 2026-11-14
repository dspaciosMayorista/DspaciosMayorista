"use client";
// #14-A — Captura del RECOBRO en el checkout del Tarifario. Solo personal autorizado y aliados con su ficha vinculada la ven; el servidor la vuelve a autorizar al crear.
//   · Aliado directo bajo comisión: ingresa el recobro; su participación sale de la configuración del sistema (solo lectura, no se envía ni se puede editar).
//   · Venta asistida (aliado elegido): recobro + distribución (valor o %) — sin distribución el recobro se queda en la base comisionable.
//   · Interno a cliente final: solo el recobro (100 % de la empresa).
//   · NETO del aliado directo: no se muestra (el aliado no captura recobro en NETO).
// El recobro viaja DENTRO de la tarifa de adulto: nunca se identifica en los documentos del cliente (este panel y la vista previa de términos son internos).
import { Coins } from "lucide-react";
import type { PartModoFormulario, TotalConRecobro } from "@/lib/cotizacion/recobroEntradaUI";
import { formatMoneda } from "@/lib/utils";

export type ModoCapturaRecobro = "aliado_directo" | "asistida" | "cliente_final";

export type EstadoRecobro = { recobroTxt: string; partModo: PartModoFormulario; partTxt: string };

const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function RecobroPanel({ modo, estado, onChange, moneda, pctParticipacion, error, totalActualizado }: {
  modo: ModoCapturaRecobro;
  estado: EstadoRecobro;
  onChange: (e: EstadoRecobro) => void;
  moneda: string | null;
  /** Aliado directo: % de participación del sistema (fracción 0–1), solo lectura. */
  pctParticipacion?: number | null;
  /** Error de lectura/validación del formulario (se muestra, no se oculta). */
  error?: string | null;
  /** Total actualizado con el recobro (cliente final): vive AQUÍ, junto al campo, y no en «Tu selección» (que el cliente puede ver): ningún texto del recobro sale de este panel interno. */
  totalActualizado?: React.ReactNode;
}) {
  const sub = (p: Partial<EstadoRecobro>) => onChange({ ...estado, ...p });
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="recobro-panel" aria-label="Recobro">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <Coins className="h-4 w-4" aria-hidden style={{ color: "var(--brand-primary)" }} />
        Recobro
      </h2>
      <p className="mb-3 text-xs text-gray-400">
        Opcional. Se suma a la tarifa de los adultos (por igual entre ellos) y no se muestra en ningún documento del cliente{moneda ? `. Importe en ${moneda}` : ""}.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl} htmlFor="recobro-total">Recobro total</label>
          <input id="recobro-total" data-testid="recobro-total" className={inp} inputMode="decimal" autoComplete="off" placeholder="0"
            value={estado.recobroTxt} onChange={(e) => sub({ recobroTxt: e.target.value })} aria-invalid={!!error} aria-describedby={error ? "recobro-error" : undefined} />
        </div>
        {modo === "asistida" && (
          <div>
            <label className={lbl} htmlFor="recobro-dist">Distribución al aliado</label>
            <div className="flex gap-1">
              <input id="recobro-dist" data-testid="recobro-dist" className={inp} inputMode="decimal" autoComplete="off" placeholder="Sin distribución"
                value={estado.partTxt} onChange={(e) => sub({ partTxt: e.target.value })} />
              <select aria-label="Tipo de distribución" data-testid="recobro-dist-modo" className="rounded-lg border border-gray-300 px-2 text-sm"
                value={estado.partModo} onChange={(e) => sub({ partModo: e.target.value === "pct" ? "pct" : "valor" })}>
                <option value="valor">Valor</option>
                <option value="pct">%</option>
              </select>
            </div>
          </div>
        )}
      </div>
      {modo === "asistida" && (
        <p className="mt-2 text-xs text-gray-400" data-testid="recobro-ayuda-asistida">
          Con distribución, ese importe del recobro es del aliado y el recobro sale de la base de su comisión. Sin distribución, el recobro entra a la base comisionable (el aliado cobra su % sobre él). Una distribución mayor que el recobro se acota al recobro.
        </p>
      )}
      {modo === "aliado_directo" && (
        <p className="mt-2 text-xs text-gray-500" data-testid="recobro-participacion-sistema">
          {pctParticipacion != null
            ? <>Tu participación en el recobro es del <b>{Math.round(pctParticipacion * 10000) / 100} %</b>, definida por D&apos;spacios Travel: no se puede cambiar desde aquí.</>
            : "Tu participación en el recobro la define D'spacios Travel."}
        </p>
      )}
      {modo === "cliente_final" && (
        <p className="mt-2 text-xs text-gray-400" data-testid="recobro-ayuda-cliente">Sin aliado, el recobro es 100 % de la empresa: no se distribuye.</p>
      )}
      {error && <p id="recobro-error" role="alert" data-testid="recobro-error" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>}
      {totalActualizado && <div className="mt-3">{totalActualizado}</div>}
    </section>
  );
}

/** #14-A — Total actualizado con el recobro (solo cliente final), ANTES de generar. Un total confirmado se distingue de un cálculo pendiente o con error: sin cifra mientras no se pueda confirmar. */
export function TotalConRecobroUI({ total }: { total: TotalConRecobro }) {
  if (total.estado === "sin_recobro") return null;
  if (total.estado === "error") {
    return <p role="alert" data-testid="total-recobro-error" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Total con recobro no disponible: {total.mensaje}</p>;
  }
  if (total.estado === "pendiente") {
    return <p role="status" data-testid="total-recobro-pendiente" className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">Total con recobro pendiente: {total.motivo}</p>;
  }
  return (
    <div className="space-y-1 rounded-lg bg-emerald-50/60 px-3 py-2" data-testid="total-recobro-confirmado">
      <p className="text-xs text-gray-600">
        {[...total.partes.map((p) => `${p.etiqueta} ${formatMoneda(p.monto, total.moneda)}`), `Recobro ${formatMoneda(total.recobro, total.moneda)}`].join(" + ")}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">Total con recobro</span>
        <span className="text-lg font-bold" data-testid="total-recobro-valor" style={{ color: "var(--brand-primary)" }}>{formatMoneda(total.total, total.moneda)}</span>
      </div>
    </div>
  );
}
