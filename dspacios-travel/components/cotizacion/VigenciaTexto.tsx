import { formatFechaLarga } from "@/lib/utils";
import { cotizacionVencida } from "@/lib/cotizacion/vigencia";

// #40 E3: misma lectura de la vigencia en listado y ficha. Solo una cotización ABIERTA se marca vencida; la histórica sin fecha muestra "—"
// (nunca se infiere un vencimiento) y una convertida o descartada conserva su fecha sin alarma.
export function VigenciaTexto({ vigencia, estado, hoy }: { vigencia: string | null; estado: string; hoy: string }) {
  const vencida = estado === "abierta" && cotizacionVencida(vigencia, hoy);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{vigencia ? formatFechaLarga(vigencia) : "—"}</span>
      {vencida && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">Vencida</span>}
    </span>
  );
}
