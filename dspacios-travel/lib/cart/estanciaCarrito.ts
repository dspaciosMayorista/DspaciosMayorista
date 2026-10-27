// Estancia de un hotel del carrito tal como quedó GUARDADA en el ítem: fecha de entrada, fecha de salida y noches. Módulo puro (lo usa el panel del carrito).
// Nunca se inventa un dato: una fecha ausente o inválida queda en null y se muestra «por confirmar»; las noches salen del ítem y, solo si faltan y están
// las dos fechas, de la diferencia entre ellas.
type ConEstancia =
  | { modeloTarifario: "unidad"; salida?: { tipo?: string; fechaIda?: string | null; fechaRegreso?: string | null } | null }
  | { modeloTarifario?: undefined; fechaIda?: string | null; fechaRegreso?: string | null; noches?: number | null };

export type Estancia = { entrada: string | null; salida: string | null; noches: number | null };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Fecha ISO real (calendario) o null. */
const fechaValida = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m = ISO.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? v : null;
};

export function estanciaDeHotel(it: ConEstancia): Estancia {
  // Hotel por unidad: solo la salida «sin vuelo» guarda fechas en el ítem; bloqueo y empaquetado no, y no se buscan en otro lado.
  const origen = it.modeloTarifario === "unidad"
    ? (it.salida?.tipo === "sin_vuelo" ? { ida: it.salida.fechaIda, regreso: it.salida.fechaRegreso, noches: null } : { ida: null, regreso: null, noches: null })
    : { ida: it.fechaIda, regreso: it.fechaRegreso, noches: it.noches };
  const entrada = fechaValida(origen.ida), salida = fechaValida(origen.regreso);
  let noches: number | null = typeof origen.noches === "number" && Number.isInteger(origen.noches) && origen.noches > 0 ? origen.noches : null;
  if (noches == null && entrada && salida) {
    const dias = Math.round((Date.parse(`${salida}T00:00:00Z`) - Date.parse(`${entrada}T00:00:00Z`)) / 86_400_000);
    noches = dias > 0 ? dias : null;
  }
  return { entrada, salida, noches };
}

/** «15 oct 2030» (sin zona horaria: la fecha ISO se lee tal cual). */
export function fechaCorta(iso: string): string {
  const m = ISO.exec(iso)!;
  return `${+m[3]} ${MESES[+m[2] - 1]} ${m[1]}`;
}

/** «Entrada 15 oct 2030 · Salida 18 oct 2030 · 3 noches»; lo que falta dice «por confirmar» (no se rellena con otra fecha). */
export function lineaEstancia(e: Estancia): string {
  const partes = [
    e.entrada ? `Entrada ${fechaCorta(e.entrada)}` : "Entrada por confirmar",
    e.salida ? `Salida ${fechaCorta(e.salida)}` : "Salida por confirmar",
  ];
  if (e.noches != null) partes.push(`${e.noches} noche${e.noches === 1 ? "" : "s"}`);
  return partes.join(" · ");
}
