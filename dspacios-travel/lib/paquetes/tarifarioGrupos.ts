// #101b — Tarifario resultado agrupado por hotel → categoría × vigencia × régimen. Cada grupo es una línea compacta
// ("Doble desde") y su detalle (acomodaciones, base comisionable, impuesto y PVP) se ve en una ventana flotante. Si el
// precio cambia según la salida, el detalle separa los bloques de precio y rotula cada salida con RUTA y FECHAS.
// Funciones puras: solo LEEN lo que `generarTarifario` ya publicó; no calculan ni redondean precios.
import { precioDobleReferencia } from "./armadoPestanas.ts";

export type FilaDetalle = {
  id: number;
  modulo: string;
  hotel_nombre: string | null;
  acomodacion: string | null;
  precio_pvp: number;
  categoria: string | null;
  regimen: string | null;
  noches: number | null;
  base_comisionable: number;
  impuesto: number;
  bloqueo_label: string | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  salida_id?: number | null;
  bloqueo_id?: number | null;
  empaquetado_id?: number | null;
  temporada_ganadora: string | null;
  es_promocion: boolean | null;
  procedencia_mixta: boolean;
  moneda?: string | null;
};

const SIN_VIGENCIA = "Vigencia no registrada";
const SEP = "\u0001";

/** Vigencia de una fila: la temporada que ganó (marcada si es promoción) o "mixta" si la estadía cruzó varias. */
export function vigenciaDe(f: Pick<FilaDetalle, "temporada_ganadora" | "es_promocion" | "procedencia_mixta">): string {
  if (f.procedencia_mixta) return "Tarifa mixta";
  if (f.temporada_ganadora == null || f.temporada_ganadora.trim() === "") return SIN_VIGENCIA;
  return f.es_promocion ? `Promoción · ${f.temporada_ganadora}` : f.temporada_ganadora;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function partes(iso: string): { d: number; m: number; y: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** "15 al 20 abr" (mismo mes), "28 mar al 2 abr" (cruza de mes) y con año solo si cruza de año o falta el regreso. */
export function rangoFechas(ida: string | null | undefined, regreso: string | null | undefined): string {
  const a = ida ? partes(ida) : null;
  const b = regreso ? partes(regreso) : null;
  if (!a) return "";
  if (!b) return `${a.d} ${MESES[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${MESES[a.m - 1]} ${a.y} al ${b.d} ${MESES[b.m - 1]} ${b.y}`;
  if (a.m === b.m) return a.d === b.d ? `${a.d} ${MESES[a.m - 1]}` : `${a.d} al ${b.d} ${MESES[a.m - 1]}`;
  return `${a.d} ${MESES[a.m - 1]} al ${b.d} ${MESES[b.m - 1]}`;
}

/** Ruta de la salida sin la fecha que `generarTarifario` agrega a las salidas dinámicas ("MDE - CTG - MDE · 15/04/2030"). */
function rutaDe(label: string | null): string {
  const limpio = (label ?? "").replace(/\s*·\s*\d{2}\/\d{2}\/\d{4}\s*$/, "").trim();
  return limpio.replace(/\s*[-–]\s*/g, "–");
}

/** "MDE–CTG–MDE · 15 al 20 abr". Nunca solo la ruta: si la fila no trae fechas, lo dice. */
export function etiquetaSalida(f: Pick<FilaDetalle, "bloqueo_label" | "fecha_ida" | "fecha_regreso" | "modulo">): string {
  const ruta = rutaDe(f.bloqueo_label) || (f.modulo === "porcion_terrestre" ? "Porción terrestre" : "Salida");
  const fechas = rangoFechas(f.fecha_ida, f.fecha_regreso);
  return fechas ? `${ruta} · ${fechas}` : `${ruta} · fechas no registradas`;
}

function claveSalida(f: FilaDetalle): string {
  if (f.salida_id != null) return `s${f.salida_id}`;
  if (f.empaquetado_id != null) return `e${f.empaquetado_id}`;
  if (f.bloqueo_id != null) return `b${f.bloqueo_id}`;
  return `l${f.bloqueo_label ?? ""}|${f.fecha_ida ?? ""}|${f.fecha_regreso ?? ""}`;
}

const ORDEN_ACOM = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"];
const ordenAcom = (a: string | null) => {
  const i = ORDEN_ACOM.indexOf(a ?? "");
  return i === -1 ? ORDEN_ACOM.length : i;
};

export type LineaPrecio = { acomodacion: string | null; noches: number | null; base: number; impuesto: number; pvp: number };
/** Un bloque de precio: las acomodaciones con sus valores y las salidas que tienen EXACTAMENTE esos valores. */
export type BloquePrecio = { lineas: LineaPrecio[]; salidas: string[] };

export type GrupoTarifa = {
  clave: string;
  categoria: string;
  vigencia: string;
  regimen: string;
  dobleDesde: number | null;
  moneda: string;
  nFilas: number;
  nSalidas: number;
  /** true = el precio cambia según la salida (hay más de un bloque de precio). */
  variaPorSalida: boolean;
  bloques: BloquePrecio[];
};

/** Agrupa las filas de UN hotel por categoría × vigencia × régimen (nunca por salida). */
export function agruparPorCategoriaVigenciaRegimen(filas: readonly FilaDetalle[]): GrupoTarifa[] {
  const mapa = new Map<string, FilaDetalle[]>();
  for (const f of filas) {
    if (f.modulo === "servicios") continue;
    const clave = [f.categoria ?? "—", vigenciaDe(f), f.regimen ?? "—"].join(SEP);
    const l = mapa.get(clave);
    if (l) l.push(f); else mapa.set(clave, [f]);
  }
  const grupos: GrupoTarifa[] = [];
  for (const [clave, lista] of mapa) {
    const porSalida = new Map<string, FilaDetalle[]>();
    for (const f of lista) {
      const k = claveSalida(f);
      const l = porSalida.get(k);
      if (l) l.push(f); else porSalida.set(k, [f]);
    }
    // Firma de precio de cada salida: acomodación + valores, para juntar las salidas que cuestan lo mismo.
    const bloques = new Map<string, BloquePrecio>();
    for (const filasSalida of porSalida.values()) {
      const lineas = filasSalida
        .map((f): LineaPrecio => ({ acomodacion: f.acomodacion, noches: f.noches, base: Number(f.base_comisionable), impuesto: Number(f.impuesto), pvp: Number(f.precio_pvp) }))
        .sort((a, b) => ordenAcom(a.acomodacion) - ordenAcom(b.acomodacion) || a.pvp - b.pvp);
      const firma = lineas.map((l) => `${l.acomodacion}|${l.noches}|${l.base}|${l.impuesto}|${l.pvp}`).join(";");
      const etiqueta = etiquetaSalida(filasSalida[0]);
      const b = bloques.get(firma);
      if (b) { if (!b.salidas.includes(etiqueta)) b.salidas.push(etiqueta); } else bloques.set(firma, { lineas, salidas: [etiqueta] });
    }
    const [categoria, vigencia, regimen] = clave.split(SEP);
    const ordenados = [...bloques.values()].sort((a, b) => (a.lineas[0]?.pvp ?? 0) - (b.lineas[0]?.pvp ?? 0));
    grupos.push({
      clave, categoria, vigencia, regimen,
      dobleDesde: precioDobleReferencia(lista),
      moneda: (lista[0].moneda ?? "COP").toUpperCase(),
      nFilas: lista.length,
      nSalidas: porSalida.size,
      variaPorSalida: ordenados.length > 1,
      bloques: ordenados,
    });
  }
  return grupos.sort((a, b) => a.categoria.localeCompare(b.categoria, "es") || a.regimen.localeCompare(b.regimen, "es") || a.vigencia.localeCompare(b.vigencia, "es"));
}
