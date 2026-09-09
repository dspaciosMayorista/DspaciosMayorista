const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ResultadoVigencia =
  | { ok: true; vigencia: string }
  | { ok: false; error: string };

export function fechaISOValida(fecha: string): boolean {
  const m = FECHA_ISO.exec(fecha);
  if (!m) return false;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export function hoyBogota(ahora = new Date()): string {
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

export function sumarDiasISO(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return d.toISOString().slice(0, 10);
}

/**
 * Resuelve la vigencia sin permitir que sobreviva al viaje. Una fecha
 * explícita inválida se rechaza; el valor automático sí se recorta a la salida.
 */
export function resolverVigenciaCotizacion(args: {
  hoy: string;
  fechaSalida?: string | null;
  vigenciaSolicitada?: string | null;
  diasPorDefecto?: number;
}): ResultadoVigencia {
  const { hoy, fechaSalida, vigenciaSolicitada } = args;
  if (!fechaISOValida(hoy)) return { ok: false, error: "Fecha actual inválida." };
  if (fechaSalida && !fechaISOValida(fechaSalida)) return { ok: false, error: "Fecha de salida inválida." };
  if (fechaSalida && fechaSalida < hoy) return { ok: false, error: "La fecha de salida ya pasó." };

  const solicitada = vigenciaSolicitada?.trim() || null;
  if (solicitada) {
    if (!fechaISOValida(solicitada)) return { ok: false, error: "Fecha de vigencia inválida." };
    if (solicitada < hoy) return { ok: false, error: "La vigencia no puede ser anterior a hoy." };
    if (fechaSalida && solicitada > fechaSalida) {
      return { ok: false, error: "La vigencia no puede ser posterior a la fecha de salida." };
    }
    return { ok: true, vigencia: solicitada };
  }

  const calculada = sumarDiasISO(hoy, Math.max(0, Math.trunc(args.diasPorDefecto ?? 1)));
  return { ok: true, vigencia: fechaSalida && calculada > fechaSalida ? fechaSalida : calculada };
}

export function vigenciaInicial(hoy: string, fechaSalida: string | null | undefined, diasPorDefecto: number): string {
  const r = resolverVigenciaCotizacion({ hoy, fechaSalida, diasPorDefecto });
  return r.ok ? r.vigencia : hoy;
}
