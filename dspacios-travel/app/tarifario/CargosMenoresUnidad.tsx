import type { CargoMenorUnidad } from "@/lib/reservar/cargosMenoresUnidad";
import { textoCargoMenor } from "@/lib/reservar/cargosMenoresUnidad";
import { formatMoneda } from "@/lib/utils";

// #126-B — qué se cobra por cada menor en un alojamiento por unidad. El total de la reserva es el de la unidad; aquí solo se aclara
// la edad/clase de cada menor y si va incluido, tiene un cargo propio (por noche o por estadía) o paga como adulto.
export function CargosMenoresUnidad({ menores, moneda, className }: { menores?: readonly CargoMenorUnidad[]; moneda: string; className?: string }) {
  if (!menores || menores.length === 0) return null;
  return (
    <ul data-testid="menores-unidad" className={className ?? "mt-1 space-y-0.5 text-[11px] text-slate-500"}>
      {menores.map((m, i) => (
        <li key={i} data-testid="menor-unidad" data-cobro={m.cobro}>
          {menores.some((o) => o.habitacion !== menores[0].habitacion) ? `Hab. ${m.habitacion} · ` : ""}
          {textoCargoMenor(m, (n) => formatMoneda(n, moneda || "COP"))}
        </li>
      ))}
    </ul>
  );
}
