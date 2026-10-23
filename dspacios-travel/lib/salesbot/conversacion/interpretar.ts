// Intérprete DETERMINISTA de la conversación guiada (#56). Puro: reconoce
// variantes razonables de palabras y acentos (todo pasa por `normalizarTexto`)
// y, ante una intención, fecha o cantidad ambigua, NO adivina: devuelve
// candidatos para que el flujo pregunte.
import { ACOM_ROOMS, type AcomRoom } from "@/lib/acomodaciones";
import { normalizarTexto } from "@/lib/salesbot/consulta";
import type { ProductoConversacion } from "@/lib/salesbot/conversacion/contrato";

export const normalizar = normalizarTexto;

// ── Números ──────────────────────────────────────────────────────────────

const PALABRAS_NUMERO: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
const NUM = "(\\d{1,2}|cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
const aNumero = (t: string): number => (/^\d+$/.test(t) ? Number(t) : PALABRAS_NUMERO[t]);

const SENAL_AMBIGUA = /\b(unos|unas|aprox\w*|mas o menos|varios|varias|algunos|algunas|no se|tal vez|quizas|entre)\b|\d+\s*(o|a|-)\s*\d+/;

export type Cantidad = { tipo: "ok"; n: number } | { tipo: "ambigua" } | { tipo: "ninguna" };

/** Una cantidad única ("2", "dos", "2 adultos"). "2 o 3", "unos 4" o dos números distintos son ambiguos. */
export function interpretarCantidad(texto: string): Cantidad {
  const t = normalizar(texto);
  if (SENAL_AMBIGUA.test(t)) return { tipo: "ambigua" };
  const nums = [...t.matchAll(new RegExp(`\\b${NUM}\\b`, "g"))].map((m) => aNumero(m[1]));
  const distintos = [...new Set(nums)];
  if (!distintos.length) return { tipo: "ninguna" };
  if (distintos.length > 1) return { tipo: "ambigua" };
  return { tipo: "ok", n: distintos[0] };
}

/** Adultos dichos explícitamente en una frase ("para 2 adultos"). */
export function adultosEnFrase(texto: string): number | null {
  const m = normalizar(texto).match(new RegExp(`\\b${NUM}\\s+(adultos?|personas?|pax)\\b`));
  return m ? aNumero(m[1]) : null;
}

/** Posición en la última lista: "2", "la 2", "el segundo", "la primera". */
export function interpretarPosicion(texto: string, largo: number): number | null {
  const t = normalizar(texto);
  const ORD: Record<string, number> = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5 };
  const m = t.match(/^(?:(?:el|la|opcion|numero|n)\s*)?(\d{1,2})$/) ?? t.match(/^(?:el|la)?\s*(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa])(?:\s+opcion)?$/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ORD[m[1]];
  return n >= 1 && n <= largo ? n : null;
}

// ── Producto y comandos ──────────────────────────────────────────────────

const FUERTES: Record<ProductoConversacion, RegExp[]> = {
  programa: [/\bprogramas?\b/, /\bcircuitos?\b/, /\brecorridos?\b/],
  bloqueo: [/\bbloqueos?\b/, /\bcon vuelos?\b/, /\bvuelos? negociados?\b/, /\bcharter\b/, /\b(con|incluye) (aereo|tiquetes?)\b/],
  porcion: [/\bporcion(es)?\b/, /\bterrestre\b/, /\bsolo (hotel|alojamiento)\b/, /\bsin vuelos?\b/],
};
const DEBILES: Partial<Record<ProductoConversacion, RegExp[]>> = { porcion: [/\bhotel(es)?\b/, /\balojamiento\b/] };
const NO_DISPONIBLES: { producto: "servicios" | "dinamico"; re: RegExp }[] = [
  { producto: "dinamico", re: /\bdinamicos?\b|\bvuelo por sistema\b|\bsalidas? dinamicas?\b/ },
  { producto: "servicios", re: /\btours?\b|\btraslados?\b|\bexcursion(es)?\b|\breceptivos?\b|\bservicios?\b/ },
];

export type IntencionProducto =
  | { tipo: "ok"; producto: ProductoConversacion }
  | { tipo: "ambigua"; candidatos: ProductoConversacion[] }
  | { tipo: "no_disponible"; producto: "servicios" | "dinamico" }
  | { tipo: "ninguna" };

export function interpretarProducto(texto: string): IntencionProducto {
  const t = normalizar(texto);
  const fuertes = (Object.keys(FUERTES) as ProductoConversacion[]).filter((p) => FUERTES[p].some((r) => r.test(t)));
  if (fuertes.length === 1) return { tipo: "ok", producto: fuertes[0] };
  if (fuertes.length > 1) return { tipo: "ambigua", candidatos: fuertes };
  const nd = NO_DISPONIBLES.find((x) => x.re.test(t));
  if (nd) return { tipo: "no_disponible", producto: nd.producto };
  if (/\bpaquetes?\b/.test(t)) return { tipo: "ambigua", candidatos: ["bloqueo", "porcion"] };
  const debiles = (Object.keys(DEBILES) as ProductoConversacion[]).filter((p) => DEBILES[p]!.some((r) => r.test(t)));
  if (debiles.length === 1) return { tipo: "ok", producto: debiles[0] };
  return { tipo: "ninguna" };
}

export type CampoCorregible = "producto" | "destino" | "fechas" | "adultos" | "habitaciones" | "menores" | "combo" | "seleccion";

export type Comando =
  | { tipo: "reiniciar" }
  | { tipo: "asesor" }
  | { tipo: "ayuda" }
  | { tipo: "agencia"; nombre: string | null }
  | { tipo: "corregir"; campo: CampoCorregible }
  | null;

const CAMPOS: { campo: CampoCorregible; re: RegExp }[] = [
  { campo: "producto", re: /\b(producto|tipo de (viaje|producto|paquete))\b/ },
  { campo: "destino", re: /\b(destinos?|ciudad(es)?|lugar(es)?)\b/ },
  { campo: "fechas", re: /\b(fechas?|dias?)\b/ },
  { campo: "adultos", re: /\badultos?\b/ },
  { campo: "habitaciones", re: /\b(habitacion(es)?|cuartos?|acomodacion(es)?)\b/ },
  { campo: "menores", re: /\b(menores|ninos?|ninas?|edad(es)?|infantes?)\b/ },
  { campo: "combo", re: /\b(plan(es)?|categorias?|regimen(es)?|alimentacion)\b/ },
  { campo: "seleccion", re: /\b(opcion(es)?|hotel(es)?|programa|oferta|salida)\b/ },
];

export function interpretarComando(texto: string): Comando {
  const t = normalizar(texto);
  if (/\b(empezar|comenzar|iniciar)( de nuevo| otra vez| de cero)\b|\breiniciar\b|\bnueva consulta\b|\bborrar todo\b|\bvolver a empezar\b/.test(t)) return { tipo: "reiniciar" };
  if (/\basesora?\b|\bhablar con (alguien|una persona)\b|\bhumano\b/.test(t)) return { tipo: "asesor" };
  if (/^(ayuda|\?|que puedes hacer|como funciona)$/.test(t)) return { tipo: "ayuda" };
  const ag = t.match(/^(?:es (?:para )?(?:una |la )?)?(?:agencia|freelance)\b\s*(.*)$/);
  if (ag) return { tipo: "agencia", nombre: ag[1].trim() || null };
  if (/\b(cambiar|corregir|modificar|cambia|corrige|editar|otra|otro|otras|otros)\b/.test(t)) {
    const c = CAMPOS.find((x) => x.re.test(t));
    if (c) return { tipo: "corregir", campo: c.campo };
  }
  return null;
}

/** "Cualquier destino", "todos", "no importa". */
export function esCualquiera(texto: string): boolean {
  return /^(cualquier(a)?( destino)?|todos?( los destinos)?|no importa|sin preferencia|me da igual|da igual)$/.test(normalizar(texto));
}

export function esNegacionMenores(texto: string): boolean {
  return /^(no|ninguno|ninguna|0|cero|sin (ninos|menores|ninas)|solo adultos|no viajan( menores| ninos)?|no hay( menores| ninos)?)$/.test(normalizar(texto));
}

// ── Destino ──────────────────────────────────────────────────────────────

export type Destino = { tipo: "ok"; destino: string } | { tipo: "ambiguo"; candidatos: string[] } | { tipo: "ninguno" };

/** Destino entre los publicados (Porción): exacto o por coincidencia de palabras, sin tildes. */
export function destinoEnLista(texto: string, lista: readonly string[]): Destino {
  const t = normalizar(texto);
  if (!t) return { tipo: "ninguno" };
  const exacto = lista.filter((d) => normalizar(d) === t);
  if (exacto.length === 1) return { tipo: "ok", destino: exacto[0] };
  const contiene = lista.filter((d) => {
    const n = normalizar(d);
    return n.length >= 3 && (` ${t} `.includes(` ${n} `) || (t.length >= 4 && n.includes(t)));
  });
  if (contiene.length === 1) return { tipo: "ok", destino: contiene[0] };
  if (contiene.length > 1) return { tipo: "ambiguo", candidatos: contiene.slice(0, 6) };
  return { tipo: "ninguno" };
}

/** Destino libre dicho en una frase ("bloqueo a san andres", "programas en europa"). */
export function destinoEnFrase(texto: string): string | null {
  const t = normalizar(texto);
  const m = t.match(/\b(?:a|en|hacia|para|de)\s+([a-z][a-z ]{2,40}?)(?=\s+(?:del|desde|el|para|con|por|y|entre|\d)\b|$)/);
  if (!m) return null;
  const d = m[1].trim();
  if (/^(programas?|bloqueos?|porcion|hotel(es)?|vuelos?|adultos?|personas?|cualquier.*)$/.test(d)) return null;
  return d;
}

/** Limpia una respuesta de destino libre ("quiero ir a Europa" → "europa"). */
export function limpiarDestinoLibre(texto: string): string | null {
  let t = normalizar(texto)
    .replace(/^(quiero|queremos|busco|buscamos|me interesa|nos interesa)\s+(ir\s+)?/, "")
    .replace(/^(a|en|hacia|para)\s+/, "")
    .trim();
  t = t.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= 80 ? t : null;
}

// ── Fechas ───────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};
const MES = `(${Object.keys(MESES).sort((a, b) => b.length - a.length).join("|")})`;

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function fechaReal(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const f = iso(y, m, d);
  return new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f ? f : null;
}
const anio = (t: string | undefined) => (t == null ? null : t.length === 2 ? 2000 + Number(t) : Number(t));

/** Una fecha mencionada: exacta, con candidatos (día/mes intercambiables o sin año) o inválida. */
export type FechaMencionada = { tipo: "ok"; fecha: string } | { tipo: "ambigua"; candidatos: string[] } | { tipo: "invalida" } | { tipo: "pasada" };

export type Fechas = { menciones: FechaMencionada[]; mesSinDia: boolean };

/**
 * Extrae fechas en el orden en que aparecen: ISO, dd/mm/aaaa (convención
 * colombiana, con aviso si día y mes son intercambiables), "10 de marzo de
 * 2027" y rangos "del 10 al 13 de marzo de 2027". Sin año, la fecha es
 * ambigua (el año siguiente posible y el próximo). Un mes sin día también.
 */
export function extraerFechas(texto: string, hoy: string): Fechas {
  const t = normalizar(texto);
  const hallados: { pos: number; m: FechaMencionada }[] = [];
  const usados: [number, number][] = [];
  const libre = (i: number, j: number) => !usados.some(([a, b]) => i < b && j > a);
  const marca = (i: number, j: number) => usados.push([i, j]);
  const hoyY = Number(hoy.slice(0, 4));
  const sinAnio = (mes: number, dia: number): FechaMencionada => {
    const cands = [hoyY, hoyY + 1].map((y) => fechaReal(y, mes, dia)).filter((f): f is string => !!f && f >= hoy);
    return cands.length ? { tipo: "ambigua", candidatos: cands } : { tipo: "invalida" };
  };

  // Rango con mes en palabras: "del 10 al 13 de marzo de 2027".
  for (const m of t.matchAll(new RegExp(`\\b(?:del?\\s+)?(\\d{1,2})\\s+(?:al|a|hasta el|-)\\s+(\\d{1,2})\\s+(?:de\\s+)?${MES}(?:\\s+(?:de|del)?\\s*(\\d{4}))?\\b`, "g"))) {
    const i = m.index!, j = i + m[0].length;
    if (!libre(i, j)) continue;
    marca(i, j);
    const mes = MESES[m[3]], y = anio(m[4]);
    for (const [k, d] of [[0, Number(m[1])], [1, Number(m[2])]] as const) {
      const f = y ? fechaReal(y, mes, d) : null;
      hallados.push({ pos: i + k, m: y ? (f ? { tipo: "ok", fecha: f } : { tipo: "invalida" }) : sinAnio(mes, d) });
    }
  }
  // ISO.
  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const i = m.index!, j = i + m[0].length;
    if (!libre(i, j)) continue;
    marca(i, j);
    const f = fechaReal(Number(m[1]), Number(m[2]), Number(m[3]));
    hallados.push({ pos: i, m: f ? { tipo: "ok", fecha: f } : { tipo: "invalida" } });
  }
  // Numérica dd/mm[/aaaa]. Si alguna del mismo texto solo es válida como dd/mm (día > 12),
  // esa convención resuelve las demás: "10/03/2027 al 13/03/2027" no es ambiguo.
  const numericas = [...t.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?\b/g)];
  const convencionDM = numericas.some((m) => Number(m[1]) > 12 && Number(m[2]) <= 12);
  for (const m of numericas) {
    const i = m.index!, j = i + m[0].length;
    if (!libre(i, j)) continue;
    marca(i, j);
    const a = Number(m[1]), b = Number(m[2]), y = anio(m[3]);
    if (!y) {
      hallados.push({ pos: i, m: sinAnio(b, a) });
      continue;
    }
    const dm = fechaReal(y, b, a);
    const md = !convencionDM && a !== b && a <= 12 && b <= 12 ? fechaReal(y, a, b) : null;
    if (dm && md) hallados.push({ pos: i, m: { tipo: "ambigua", candidatos: [dm, md] } });
    else hallados.push({ pos: i, m: dm ? { tipo: "ok", fecha: dm } : { tipo: "invalida" } });
  }
  // "10 de marzo de 2027" / "10 marzo".
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?${MES}(?:\\s+(?:de|del)?\\s*(\\d{4}))?\\b`, "g"))) {
    const i = m.index!, j = i + m[0].length;
    if (!libre(i, j)) continue;
    marca(i, j);
    const mes = MESES[m[2]], d = Number(m[1]), y = anio(m[3]);
    const f = y ? fechaReal(y, mes, d) : null;
    hallados.push({ pos: i, m: y ? (f ? { tipo: "ok", fecha: f } : { tipo: "invalida" }) : sinAnio(mes, d) });
  }
  const restante = usados.reduce((s, [a, b]) => s.slice(0, a) + " ".repeat(b - a) + s.slice(b), t);
  const mesSinDia = new RegExp(`\\b${MES}\\b`).test(restante);
  // Una fecha anterior a hoy no se cotiza: se marca, nunca se corrige sola.
  const vigente = (m: FechaMencionada): FechaMencionada => {
    if (m.tipo === "ok") return m.fecha < hoy ? { tipo: "pasada" } : m;
    if (m.tipo === "ambigua") {
      const c = m.candidatos.filter((f) => f >= hoy);
      return c.length ? { tipo: "ambigua", candidatos: c } : { tipo: "pasada" };
    }
    return m;
  };
  return { menciones: hallados.sort((x, y) => x.pos - y.pos).map((h) => vigente(h.m)), mesSinDia };
}

// ── Habitaciones y menores ───────────────────────────────────────────────

const TIPO_HAB: { acom: AcomRoom; re: string }[] = [
  { acom: "sencilla", re: "sencillas?|individual(?:es)?|simples?|singles?" },
  { acom: "doble", re: "dobles?" },
  { acom: "triple", re: "triples?" },
  { acom: "multiple", re: "multiples?|cuadruples?" },
];

export type Habitaciones = { tipo: "ok"; habitaciones: Partial<Record<AcomRoom, number>> } | { tipo: "ambigua" } | { tipo: "invalida" } | { tipo: "ninguna" };

/** "1 doble", "dos dobles y una sencilla", "una triple". Un número sin tipo es ambiguo. */
export function interpretarHabitaciones(texto: string): Habitaciones {
  const t = normalizar(texto);
  if (SENAL_AMBIGUA.test(t)) return { tipo: "ambigua" };
  const h: Partial<Record<AcomRoom, number>> = {};
  let hallado = false;
  let resto = t;
  for (const { acom, re } of TIPO_HAB) {
    for (const m of t.matchAll(new RegExp(`(?:\\b${NUM}\\s+)?(?:habitacion(?:es)?\\s+)?\\b(?:${re})\\b`, "g"))) {
      hallado = true;
      const n = m[1] ? aNumero(m[1]) : 1;
      h[acom] = (h[acom] ?? 0) + n;
      resto = resto.replace(m[0], " ");
    }
  }
  if (!hallado) return new RegExp(`\\b${NUM}\\b`).test(t) ? { tipo: "ambigua" } : { tipo: "ninguna" };
  if (new RegExp(`\\b${NUM}\\b`).test(resto.replace(/\b(y|habitacion(es)?|de|con|una?)\b/g, ""))) return { tipo: "ambigua" };
  const vals = Object.values(h) as number[];
  if (vals.some((n) => !Number.isInteger(n) || n < 1 || n > 10) || vals.reduce((s, n) => s + n, 0) > 10) return { tipo: "invalida" };
  return { tipo: "ok", habitaciones: h };
}

/**
 * Habitaciones dentro de una frase larga ("… para 2 adultos, 1 doble"): solo
 * toma las frases con tipo de habitación y deja fuera los demás números
 * (fechas, adultos). La respuesta directa a "¿cuántas habitaciones?" usa
 * `interpretarHabitaciones`, que es estricta.
 */
export function habitacionesEnFrase(texto: string): Partial<Record<AcomRoom, number>> | null {
  const t = normalizar(texto);
  const h: Partial<Record<AcomRoom, number>> = {};
  for (const { acom, re } of TIPO_HAB) {
    for (const m of t.matchAll(new RegExp(`(?:\\b${NUM}\\s+)?(?:habitacion(?:es)?\\s+)?\\b(?:${re})\\b`, "g"))) {
      h[acom] = (h[acom] ?? 0) + (m[1] ? aNumero(m[1]) : 1);
    }
  }
  const vals = Object.values(h) as number[];
  if (!vals.length || vals.some((n) => !Number.isInteger(n) || n < 1 || n > 10) || vals.reduce((s, n) => s + n, 0) > 10) return null;
  return h;
}

export type Menores = { tipo: "ok"; edades: number[] } | { tipo: "ambigua"; motivo: "sin_edades" | "cantidad_no_coincide" } | { tipo: "invalida" } | { tipo: "ninguna" };

/** "sin menores" → []; "5 y 9", "un niño de 5 y otro de 9", "2 niños de 4 y 7". "2 niños" sin edades es ambiguo. */
export function interpretarMenores(texto: string): Menores {
  const t = normalizar(texto);
  if (esNegacionMenores(t)) return { tipo: "ok", edades: [] };
  if (SENAL_AMBIGUA.test(t.replace(/\d+\s*(?:-|a)\s*\d+\s*anos/g, ""))) return { tipo: "ambigua", motivo: "sin_edades" };
  // Conteo explícito ("2 niños", "dos menores"); "un niño de 5" no es un conteo, es una edad.
  const conteo = t.match(/\b(\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(?:ninos?|ninas?|menores|infantes?|bebes?|hijos?)\b/);
  const sinConteo = conteo ? t.replace(conteo[0], " ") : t;
  const edades = [...sinConteo.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
  if (!edades.length) return conteo || /\b(ninos?|ninas?|menores|infantes?|bebes?)\b/.test(t) ? { tipo: "ambigua", motivo: "sin_edades" } : { tipo: "ninguna" };
  if (edades.length > 12 || edades.some((e) => e > 17)) return { tipo: "invalida" };
  if (conteo && aNumero(conteo[1]) !== edades.length) return { tipo: "ambigua", motivo: "cantidad_no_coincide" };
  return { tipo: "ok", edades };
}

export { ACOM_ROOMS };
