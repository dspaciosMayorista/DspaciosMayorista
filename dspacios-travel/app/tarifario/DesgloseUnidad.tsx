import { desgloseInformativoUnidad, type CargoMenorUnidad } from "@/lib/reservar/cargosMenoresUnidad";
import { formatMoneda } from "@/lib/utils";

// O-2 — lectura adulto/menores de un alojamiento por unidad, con las mismas piezas del total (el precio de la unidad sigue siendo la autoridad).
// Solo informa: no crea tarifas por persona, no cambia el total y no se guarda en cotizaciones ni documentos.
export function DesgloseUnidad({ precioVenta, moneda, ocupacion, menores, className }: {
  precioVenta: number;
  moneda: string;
  ocupacion: readonly { acom: string; adultos: number }[];
  menores?: readonly CargoMenorUnidad[];
  className?: string;
}) {
  const d = desgloseInformativoUnidad({ precioVenta, ocupacion, menores });
  if (!d) return null;
  const m = (n: number) => formatMoneda(n, moneda || "COP");
  return (
    <dl data-testid="desglose-unidad" className={className ?? "mt-1.5 space-y-0.5 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500"}>
      <div className="flex justify-between gap-2" data-testid="desglose-base">
        <dt>Base de la unidad{d.menoresSinCargo > 0 ? ` (incluye ${d.menoresSinCargo} menor${d.menoresSinCargo === 1 ? "" : "es"} sin cargo propio)` : ""}</dt>
        <dd className="tabular-nums font-medium">{m(d.baseUnidad)}</dd>
      </div>
      {d.equivalentePorAdulto != null ? (
        <div className="pl-3 text-slate-400" data-testid="desglose-equivalente">
          {d.adultos} adulto{d.adultos === 1 ? "" : "s"} · equivalente informativo ≈ {m(d.equivalentePorAdulto)} {d.adultos === 1 ? "por adulto" : "c/u"} (base ÷ {d.adultos}; el precio real es por unidad, no por persona)
        </div>
      ) : (
        <div className="pl-3 text-slate-400" data-testid="desglose-sin-equivalente">
          {d.adultos} adulto{d.adultos === 1 ? "" : "s"} · {d.sinEquivalente === "habitaciones_distintas" ? "habitaciones con tarifas distintas: no se reparte entre adultos" : d.sinEquivalente === "menor_paga_como_adulto" ? "hay menores que pagan como adulto: no se reparte entre adultos" : "sin equivalente por adulto"}
        </div>
      )}
      {d.cargosPropios > 0 && (
        <div className="flex justify-between gap-2" data-testid="desglose-cargos">
          <dt>+ Cargos propios de menores (ya suman al total)</dt>
          <dd className="tabular-nums font-medium">{m(d.cargosPropios)}</dd>
        </div>
      )}
      <div className="flex justify-between gap-2 border-t border-slate-200 pt-0.5 font-semibold text-slate-600" data-testid="desglose-total">
        <dt>Total de la reserva</dt>
        <dd className="tabular-nums">{m(d.total)}</dd>
      </div>
    </dl>
  );
}
