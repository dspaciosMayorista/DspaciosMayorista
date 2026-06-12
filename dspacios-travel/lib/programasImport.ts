// ───────────────────────────────────────────────────────────────────────────
// Importador de programas: parsea el texto crudo que envía el proveedor (Word /
// PDF copiado) y lo convierte en las secciones estructuradas del programa.
// Es una función PURA y testeable — no toca la base de datos.
//
// Cubre los formatos reales vistos en los archivos de ejemplo:
//   · "8 DÍAS / 7 NOCHES", "10 Días / 09 Noches", "4 Días / 3 Noches"
//   · encabezados de día: "DÍA 01 - ESTAMBUL", "Día 1. SANTIAGO DE CHILE",
//     "DÍA 1 - VIERNES - BOGOTÁ – PANAMÁ", "Día 2.  Grand Cañón / Las Vegas"
//   · línea de ruta (ciudades separadas por – / · , ) bajo el título
//   · bloques "INCLUYE" / "NO INCLUYE" / "Los Precios Incluyen:" /
//     "El programa no incluye:"
// ───────────────────────────────────────────────────────────────────────────

export type DiaParsed = {
  dia: number;
  titulo: string;
  desayuno: boolean;
  almuerzo: boolean;
  cena: boolean;
  descripcion: string;
};

export type ProgramaParsed = {
  nombre: string | null;
  dias: number | null;
  noches: number | null;
  ruta: string | null;
  ciudades: string[];
  itinerario: DiaParsed[];
  incluye: string[];
  noIncluye: string[];
};

const norm = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();

// Separadores de ciudades en una línea de ruta.
const CITY_SPLIT = /\s*[–—\-/·•|]\s*|\s+\/\s+/;

function quitarAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Detecta "8 DÍAS / 7 NOCHES" o "10 Días / 09 Noches" en una línea.
function parseDiasNoches(line: string): { dias: number; noches: number } | null {
  const l = quitarAcentos(line).toLowerCase();
  const m = l.match(/(\d{1,2})\s*dias?\s*[/y\-]?\s*(\d{1,2})\s*noches?/);
  if (m) return { dias: Number(m[1]), noches: Number(m[2]) };
  return null;
}

// Reconoce el encabezado de un día. Devuelve { dia, titulo, resto } o null.
// Acepta: "DÍA 01 - ESTAMBUL...", "Día 1. SANTIAGO", "DIA 5 — A – B",
// pegado o no a la descripción ("DÍA 02 - ESTAMBULDESAYUNO...").
function parseEncabezadoDia(line: string): { dia: number; titulo: string; resto: string } | null {
  const l = norm(line);
  // "DÍA"/"Día"/"DIA" + número + separador (. - – :) + resto
  const m = l.match(/^d[íi]a\s*0*(\d{1,2})\s*[.\-–—:)]*\s*(.*)$/i);
  if (!m) return null;
  const dia = Number(m[1]);
  let resto = m[2] ?? "";
  // El "título" es el tramo en MAYÚSCULAS / nombres de ciudad antes de que
  // empiece la prosa. Heurística: hasta el primer punto, o hasta "DESAYUNO"/
  // "Desayuno"/"Alojamiento" si viene pegado, o las primeras ~8 palabras en mayúsculas.
  let titulo = "";
  // Caso pegado: "ESTAMBULDESAYUNO" → cortar antes de palabra de prosa típica.
  const cutWords = ["DESAYUNO", "Desayuno", "Alojamiento", "Llegada", "Arribo", "Salida", "Hoy", "Tras", "Después", "Temprano", "Por la", "En la", "A la", "Resto"];
  let cutIdx = -1;
  for (const w of cutWords) {
    const idx = resto.indexOf(w);
    if (idx > 0 && (cutIdx === -1 || idx < cutIdx)) cutIdx = idx;
  }
  if (cutIdx > 0) {
    titulo = resto.slice(0, cutIdx).replace(/[.\-–—:]+$/, "").trim();
    resto = resto.slice(cutIdx).trim();
  } else {
    // Sin prosa pegada: el título es la primera oración corta.
    const dot = resto.indexOf(".");
    if (dot > 0 && dot <= 60) {
      titulo = resto.slice(0, dot).trim();
      resto = resto.slice(dot + 1).trim();
    } else {
      titulo = resto.trim();
      resto = "";
    }
  }
  return { dia, titulo: norm(titulo), resto: norm(resto) };
}

function detectarComidas(texto: string): { desayuno: boolean; almuerzo: boolean; cena: boolean } {
  const t = quitarAcentos(texto).toLowerCase();
  return {
    desayuno: /\bdesayuno|lunch-?box|media pension|pension completa|todo incluido/.test(t),
    almuerzo: /\balmuerzo|media pension|pension completa|todo incluido/.test(t),
    cena: /\bcena\b|pension completa|todo incluido/.test(t),
  };
}

const RE_INCLUYE = /^(.*\b)?(incluy|los precios incluyen|el programa incluye|incluido)/i;
const RE_NO_INCLUYE = /^(.*\b)?(no incluy|el programa no incluye|los precios no incluyen|no incluido)/i;
const RE_ITINERARIO = /^itinerario\b/i;

// Encabezados que CIERRAN un bloque de incluye/no-incluye (vuelven a "none").
// Evita que la lista se trague tablas de precios, hoteles, notas y condiciones.
const RE_STOP_BLOQUE =
  /^(precios?\b|tarifas?\b|hoteles?\s+(seleccionados|de recogida|previstos|definitivos)|hoteles?\b|salidas?\b|fechas?\s+de|valor(es)?\b|suplement|a[ñn]o\b|mes\b|temporada)/i;

// Prefijos de etiqueta que cierran el bloque AUNQUE la línea sea larga
// (ej. "Notas: ...párrafo largo...", "Política de cancelación: ...").
const RE_STOP_PREFIX = /^(notas?\s*:|nota\s*:|condiciones|pol[íi]tica|importante\s*:|observaciones)/i;

// Ruido típico de tablas pegadas (celdas sueltas: solo números, "Doble",
// nombres de meses, etc.). No son ítems de una lista de inclusiones.
const MESES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const RE_RUIDO_TABLA = new RegExp(
  `^(\\$?[\\d.,]+|doble|triple|cu[áa]drupl?e?|quad|sencill[oa]|ni[ñn][oa]|salidas?|${MESES})\\.?$`,
  "i"
);

function esItemLista(t: string): boolean {
  if (!t) return false;
  if (RE_RUIDO_TABLA.test(t)) return false;
  // Líneas demasiado cortas sin letras (celdas numéricas) → ruido.
  if (t.length <= 2) return false;
  return true;
}

/** Parsea el texto crudo del proveedor en secciones estructuradas. */
export function parsearPrograma(textoRaw: string): ProgramaParsed {
  const lines = textoRaw
    .split(/\r?\n/)
    .map((l) => norm(l))
    .filter((l) => l.length > 0);

  const out: ProgramaParsed = {
    nombre: null,
    dias: null,
    noches: null,
    ruta: null,
    ciudades: [],
    itinerario: [],
    incluye: [],
    noIncluye: [],
  };

  // 1) Nombre = primera línea no vacía (típicamente el título del programa).
  if (lines.length) out.nombre = lines[0];

  // 2) Días / noches en cualquiera de las primeras líneas.
  for (const l of lines.slice(0, 6)) {
    const dn = parseDiasNoches(l);
    if (dn) {
      out.dias = dn.dias;
      out.noches = dn.noches;
      break;
    }
  }

  // 3) Ruta: línea cerca del inicio con varias ciudades separadas por – / ·,
  //    que NO sea la de días/noches ni un encabezado de día.
  for (let i = 1; i < Math.min(lines.length, 8); i++) {
    const l = lines[i];
    if (parseDiasNoches(l)) continue;
    if (parseEncabezadoDia(l)) break;
    if (RE_ITINERARIO.test(l)) break;
    const partes = l.split(CITY_SPLIT).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 2 && l.length < 160 && !/incluy/i.test(l)) {
      out.ruta = l.replace(/^visitando:?\s*/i, "").trim();
      out.ciudades = partes.filter((p) => !/^visitando$/i.test(p));
      break;
    }
  }

  // 4) Recorrido por secciones: itinerario (días) e incluye/no incluye.
  type Modo = "none" | "itinerario" | "incluye" | "no_incluye";
  let modo: Modo = "none";
  let actual: DiaParsed | null = null;
  const pushDia = () => {
    if (actual) {
      actual.descripcion = norm(actual.descripcion);
      const c = detectarComidas(actual.titulo + " " + actual.descripcion);
      actual.desayuno = c.desayuno;
      actual.almuerzo = c.almuerzo;
      actual.cena = c.cena;
      out.itinerario.push(actual);
      actual = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const enc = parseEncabezadoDia(l);

    if (enc) {
      pushDia();
      modo = "itinerario";
      actual = {
        dia: enc.dia,
        titulo: enc.titulo,
        desayuno: false,
        almuerzo: false,
        cena: false,
        descripcion: enc.resto,
      };
      continue;
    }

    // Cambios de sección por encabezado.
    if (RE_NO_INCLUYE.test(l) && l.length < 60) {
      pushDia();
      modo = "no_incluye";
      continue;
    }
    if (RE_INCLUYE.test(l) && l.length < 60) {
      pushDia();
      modo = "incluye";
      continue;
    }
    if (RE_ITINERARIO.test(l) && l.length < 30) {
      modo = "itinerario";
      continue;
    }

    // Dentro de un bloque de inclusiones, un encabezado de otra sección lo cierra.
    if (
      (modo === "incluye" || modo === "no_incluye") &&
      (RE_STOP_PREFIX.test(l) || (RE_STOP_BLOQUE.test(l) && l.length < 50))
    ) {
      modo = "none";
      continue;
    }

    // Acumular contenido según el modo.
    if (modo === "itinerario" && actual) {
      actual.descripcion += (actual.descripcion ? " " : "") + l;
    } else if (modo === "incluye") {
      const t = l.replace(/^[•\-*✓·]\s*/, "").trim();
      if (esItemLista(t)) out.incluye.push(t);
    } else if (modo === "no_incluye") {
      const t = l.replace(/^[•\-*✕·]\s*/, "").trim();
      if (esItemLista(t)) out.noIncluye.push(t);
    }
  }
  pushDia();

  // Si no se detectaron noches pero sí el último día, inferir.
  if (out.dias == null && out.itinerario.length) {
    out.dias = Math.max(...out.itinerario.map((d) => d.dia));
    if (out.noches == null && out.dias > 0) out.noches = out.dias - 1;
  }

  return out;
}
