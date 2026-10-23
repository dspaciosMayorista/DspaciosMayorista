// Calendario tributario por agencia (#43-1a, migración 215) — lógica pura,
// compartida por la página de Contabilidad y el correo diario de alertas.
//
// Nada de esto conoce tarifas ni calendarios de la DIAN: las obligaciones, su
// periodicidad y las fechas por dígito del NIT se cargan desde la UI cada año.

export type Periodicidad = "mensual" | "bimestral" | "cuatrimestral" | "semestral" | "anual";
export type ReglaDigitos = 0 | 1 | 2;

export const PERIODICIDADES: { valor: Periodicidad; etiqueta: string; periodos: number }[] = [
  { valor: "mensual", etiqueta: "Mensual", periodos: 12 },
  { valor: "bimestral", etiqueta: "Bimestral", periodos: 6 },
  { valor: "cuatrimestral", etiqueta: "Cuatrimestral", periodos: 3 },
  { valor: "semestral", etiqueta: "Semestral", periodos: 2 },
  { valor: "anual", etiqueta: "Anual", periodos: 1 },
];

export const REGLAS_DIGITOS: { valor: ReglaDigitos; etiqueta: string }[] = [
  { valor: 0, etiqueta: "Misma fecha para todos" },
  { valor: 1, etiqueta: "Último dígito del NIT" },
  { valor: 2, etiqueta: "Últimos dos dígitos del NIT" },
];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
  "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function esPeriodicidad(v: unknown): v is Periodicidad {
  return PERIODICIDADES.some((p) => p.valor === v);
}

export function periodosPorAnio(p: Periodicidad): number {
  return PERIODICIDADES.find((x) => x.valor === p)?.periodos ?? 1;
}

/** "Enero 2026", "Bimestre 3 (may–jun) 2026", "Cuatrimestre 1 (ene–abr) 2026", "Año 2026". */
export function etiquetaPeriodo(p: Periodicidad, periodo: number, anio: number): string {
  if (p === "mensual") return `${MESES_LARGOS[periodo - 1] ?? `Mes ${periodo}`} ${anio}`;
  if (p === "anual") return `Año ${anio}`;
  const meses = 12 / periodosPorAnio(p);
  const ini = MESES[(periodo - 1) * meses] ?? "?";
  const fin = MESES[periodo * meses - 1] ?? "?";
  const nombre = p === "bimestral" ? "Bimestre" : p === "cuatrimestral" ? "Cuatrimestre" : "Semestre";
  return `${nombre} ${periodo} (${ini}–${fin}) ${anio}`;
}

/**
 * Dígitos del NIT que eligen la fecha: `*` si la regla es 0; el último o los
 * dos últimos dígitos del NIT SIN dígito de verificación si es 1 o 2. `null`
 * cuando la regla los necesita y el NIT falta o no tiene dígitos suficientes.
 * El NIT llega como en `agencias.nit` (puede traer puntos, espacios o "-DV").
 */
export function digitosNit(nit: string | null | undefined, regla: ReglaDigitos): string | null {
  if (regla === 0) return "*";
  const base = (nit ?? "").split("-")[0].replace(/\D/g, "");
  if (base.length < regla) return null;
  return base.slice(-regla);
}

export type Obligacion = {
  id: number;
  nombre: string;
  periodicidad: Periodicidad;
  reglaDigitos: ReglaDigitos;
  diasAviso: number;
  requierePago: boolean;
  activa: boolean;
};
export type Vencimiento = { obligacionId: number; anio: number; periodo: number; digitos: string; fecha: string };
export type Cumplimiento = {
  obligacionId: number; anio: number; periodo: number;
  presentadaEn: string | null; pagadaEn: string | null; nota?: string | null;
};

export type EstadoVencimiento = "cumplida" | "falta_pago" | "vencida" | "proxima" | "futura";

export type ItemCalendario = {
  obligacionId: number;
  obligacion: string;
  requierePago: boolean;
  anio: number;
  periodo: number;
  etiqueta: string;
  fecha: string;
  diasRestantes: number;
  estado: EstadoVencimiento;
  presentadaEn: string | null;
  pagadaEn: string | null;
};

/** Días entre dos fechas ISO (b − a), sin zona horaria: ambas son días calendario. */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function estadoDe(
  o: Pick<Obligacion, "requierePago" | "diasAviso">,
  fecha: string, hoy: string, c: Pick<Cumplimiento, "presentadaEn" | "pagadaEn"> | undefined,
): EstadoVencimiento {
  const presentada = !!c?.presentadaEn;
  const pagada = !!c?.pagadaEn;
  if (presentada && (!o.requierePago || pagada)) return "cumplida";
  if (presentada) return "falta_pago";
  const dias = diasEntre(hoy, fecha);
  if (dias < 0) return "vencida";
  if (dias <= o.diasAviso) return "proxima";
  return "futura";
}

/**
 * Vencimientos de la agencia: para cada obligación ACTIVA y cada periodo con
 * fecha cargada, la fecha que corresponde al NIT de la agencia. Devuelve
 * además las obligaciones que no se pueden resolver (falta el NIT o no hay
 * fecha para sus dígitos), para mostrarlas como pendientes de configurar y
 * no como "sin vencimientos".
 */
export function resolverVencimientos(args: {
  obligaciones: Obligacion[];
  vencimientos: Vencimiento[];
  cumplimientos: Cumplimiento[];
  nit: string | null | undefined;
  hoy: string;
}): { items: ItemCalendario[]; sinResolver: { obligacionId: number; obligacion: string; motivo: string }[] } {
  const items: ItemCalendario[] = [];
  const sinResolver: { obligacionId: number; obligacion: string; motivo: string }[] = [];
  const cump = new Map(args.cumplimientos.map((c) => [`${c.obligacionId}|${c.anio}|${c.periodo}`, c]));

  for (const o of args.obligaciones) {
    if (!o.activa) continue;
    const dig = digitosNit(args.nit, o.reglaDigitos);
    if (dig === null) {
      sinResolver.push({ obligacionId: o.id, obligacion: o.nombre, motivo: "Falta el NIT de la agencia (Datos de la agencia)." });
      continue;
    }
    const propias = args.vencimientos.filter((v) => v.obligacionId === o.id);
    const aplicables = propias.filter((v) => v.digitos === dig && v.periodo <= periodosPorAnio(o.periodicidad));
    if (propias.length > 0 && aplicables.length === 0) {
      sinResolver.push({ obligacionId: o.id, obligacion: o.nombre, motivo: `No hay fechas cargadas para los dígitos ${dig}.` });
    } else if (propias.length === 0) {
      sinResolver.push({ obligacionId: o.id, obligacion: o.nombre, motivo: "No hay fechas de vencimiento cargadas." });
    }
    for (const v of aplicables) {
      const c = cump.get(`${o.id}|${v.anio}|${v.periodo}`);
      items.push({
        obligacionId: o.id, obligacion: o.nombre, requierePago: o.requierePago,
        anio: v.anio, periodo: v.periodo, etiqueta: etiquetaPeriodo(o.periodicidad, v.periodo, v.anio),
        fecha: v.fecha, diasRestantes: diasEntre(args.hoy, v.fecha),
        estado: estadoDe(o, v.fecha, args.hoy, c),
        presentadaEn: c?.presentadaEn ?? null, pagadaEn: c?.pagadaEn ?? null,
      });
    }
  }
  items.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.obligacion.localeCompare(b.obligacion));
  return { items, sinResolver };
}

/** Lo que hay que avisar: vencidas sin cumplir, presentadas sin pagar y próximas dentro del aviso. */
export function alertasTributarias(items: ItemCalendario[]): ItemCalendario[] {
  return items.filter((i) => i.estado === "vencida" || i.estado === "proxima" || i.estado === "falta_pago");
}

export const ETIQUETA_ESTADO: Record<EstadoVencimiento, string> = {
  cumplida: "Cumplida",
  falta_pago: "Presentada, falta pago",
  vencida: "Vencida",
  proxima: "Próxima",
  futura: "Programada",
};

/** Valida una fila de fechas antes de guardarla (la base lo vuelve a validar). */
export function validarVencimiento(
  o: Pick<Obligacion, "periodicidad" | "reglaDigitos">,
  v: Pick<Vencimiento, "periodo" | "digitos" | "fecha">,
): string | null {
  if (!Number.isInteger(v.periodo) || v.periodo < 1 || v.periodo > periodosPorAnio(o.periodicidad)) {
    return `Periodo ${v.periodo} fuera de rango para una obligación ${o.periodicidad}.`;
  }
  const ok = o.reglaDigitos === 0 ? v.digitos === "*" : o.reglaDigitos === 1 ? /^[0-9]$/.test(v.digitos) : /^[0-9]{2}$/.test(v.digitos);
  if (!ok) return `Los dígitos "${v.digitos}" no corresponden a la regla de la obligación.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.fecha)) return "Fecha inválida.";
  return null;
}

/** Dígitos posibles de una regla, en el orden en que la DIAN publica el calendario (1…9, 0). */
export function digitosDeRegla(regla: ReglaDigitos): string[] {
  if (regla === 0) return ["*"];
  if (regla === 1) return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  return Array.from({ length: 100 }, (_, i) => String((i + 1) % 100).padStart(2, "0"));
}
