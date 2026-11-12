// #43/#60 incremento 3 — Vista previa, textos de confirmación y mensajes del editor de grupos de días
// (puro, sin lecturas). Todo lo que se calcula aquí es en memoria: editar y revisar no hace solicitudes.
// La configuración llega de la RPC `grupos_dias_config` (migración 295). Nada de esto activa grupos:
// las tarifas por grupo son una PROPUESTA que el motor no lee.
//
// Importes: un solo formato de edición, sin ambigüedad (convención colombiana): COMA decimal y PUNTO
// solo como separador de miles en grupos de tres. `formatNeto` y `leerNeto` son inversas exactas; un
// texto ambiguo como «123.45» se rechaza en vez de leerse como 12345.

export const DIAS = [
  { n: 1, corto: "L", nombre: "lunes" }, { n: 2, corto: "M", nombre: "martes" }, { n: 3, corto: "X", nombre: "miércoles" },
  { n: 4, corto: "J", nombre: "jueves" }, { n: 5, corto: "V", nombre: "viernes" }, { n: 6, corto: "S", nombre: "sábado" },
  { n: 7, corto: "D", nombre: "domingo" },
] as const;

export const ACOMS = [
  { col: "neto_sencilla", etiqueta: "Sencilla", tipo: "habitacion" },
  { col: "neto_doble", etiqueta: "Doble", tipo: "habitacion" },
  { col: "neto_triple", etiqueta: "Triple", tipo: "habitacion" },
  { col: "neto_multiple", etiqueta: "Múltiple", tipo: "habitacion" },
  { col: "neto_nino", etiqueta: "Niño 1", tipo: "nino" },
  { col: "neto_nino2", etiqueta: "Niño 2", tipo: "nino" },
  { col: "neto_infante", etiqueta: "Infante", tipo: "infante" },
] as const;
export type ColNeto = (typeof ACOMS)[number]["col"];
export type FilaNetos = Record<ColNeto, number | null>;

export const CAMPOS_EXTRA = [
  { col: "nota_infante", etiqueta: "Nota de infante", tipo: "texto" },
  { col: "notas", etiqueta: "Notas", tipo: "texto" },
  { col: "edad_infante_min", etiqueta: "Infante desde (edad)", tipo: "edad" },
  { col: "edad_infante_max", etiqueta: "Infante hasta (edad)", tipo: "edad" },
  { col: "edad_nino_min", etiqueta: "Niño desde (edad)", tipo: "edad" },
  { col: "edad_nino_max", etiqueta: "Niño hasta (edad)", tipo: "edad" },
] as const;
export type ColExtra = (typeof CAMPOS_EXTRA)[number]["col"];
export type Extras = { nota_infante: string | null; notas: string | null; edad_infante_min: number | null; edad_infante_max: number | null; edad_nino_min: number | null; edad_nino_max: number | null };

export type GrupoCfg = { id: string; nombre: string; dias: number[]; activo: boolean };
export type PropuestaCfg = FilaNetos & Extras & { id: number; grupo_id: string; tipo_habitacion: string; alimentacion: string; origen_tarifa_id: number | null };
export type OrigenCfg = FilaNetos & Extras & { id: number; tipo_habitacion: string | null; alimentacion: string | null; huella: string };
export type ConfigGrupos = {
  vigencia: { id: number; nombre: string; hotel_id: number; tipo: string; nombre_repetido: boolean };
  hotel: { id: number; modelo_tarifario: string };
  categorias: string[];
  regimenes: string[];
  grupos: GrupoCfg[];
  propuestas: PropuestaCfg[];
  origen: OrigenCfg[];
  promociones: { temporada: string; filas: number }[];
  huella: string;
  /** Bases de calculadora de cada grupo (297, `grupos_dias_config_bases`): lo que el borrado debe confirmar. */
  bases?: BaseGrupoResumen[];
};
export type BaseGrupoResumen = { grupo_id: string; tipo: string; version: number; categorias: number };
const NOMBRE_CALC: Record<string, string> = { dubai: "Dubai", mixta: "Mixta", corporativa: "Corporativa" };
/** Bases del grupo tal como las vio la vista previa del borrado: es lo que su confirmación exige reencontrar. */
export const basesRevisadasDe = (cfg: ConfigGrupos, grupoId: string) =>
  (cfg.bases ?? []).filter((b) => b.grupo_id === grupoId).map((b) => ({ tipo: b.tipo, version: b.version }));
export type ModoPropuesta = "actualizar" | "reemplazar_grupo" | "reemplazar_vigencia";
/** Fila que se envía. `extras` ausente = notas y edades OMITIDAS (en «actualizar» se conservan las guardadas);
 *  presente = se fijan exactamente esos valores (null = borrado intencional). */
export type FilaPropuesta = { grupo_id: string; tipo_habitacion: string; alimentacion: string; netos: FilaNetos; origen_tarifa_id: number | null; extras?: Extras };
export type GrupoEditado = { id?: string; nombre: string; dias: number[] };

export const NETOS_VACIOS: FilaNetos = Object.fromEntries(ACOMS.map((a) => [a.col, null])) as FilaNetos;
export const EXTRAS_VACIOS: Extras = { nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null };
export const claveCombo = (grupo: string, cat: string, reg: string) => JSON.stringify([grupo, cat, reg]);
export const textoDias = (dias: readonly number[]) =>
  [...dias].sort((a, b) => a - b).map((d) => DIAS[d - 1]?.corto ?? "?").join(" ");

/** Importe para mostrar y editar: miles con punto, decimales con coma (123.45 → «123,45»; 120000 → «120.000»). */
export function formatNeto(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  const [ent, dec] = String(Math.abs(Number(n))).split(".");
  return `${Number(n) < 0 ? "-" : ""}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${dec ? `,${dec}` : ""}`;
}

/** Lee un neto escrito: vacío = sin precio (nunca se completa). Acepta «120000», «120.000», «123,45», «1.234,5».
 *  Rechaza lo ambiguo (p. ej. «123.45»: el punto solo separa miles) y los negativos. */
export function leerNeto(texto: string): { ok: true; valor: number | null } | { ok: false; error: string } {
  const t = texto.trim();
  if (t === "") return { ok: true, valor: null };
  if (!/^(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/.test(t)) {
    return { ok: false, error: `«${texto}» no es un neto válido: usa coma para decimales y punto solo para miles (ej. 123,45 o 120.000).` };
  }
  return { ok: true, valor: Number(t.replace(/\./g, "").replace(",", ".")) };
}

/** Edad escrita: vacío = sin dato; entero 0–17. */
export function leerEdad(texto: string): { ok: true; valor: number | null } | { ok: false; error: string } {
  const t = texto.trim();
  if (t === "") return { ok: true, valor: null };
  if (!/^\d{1,2}$/.test(t) || Number(t) > 17) return { ok: false, error: `«${texto}» no es una edad válida (entero de 0 a 17).` };
  return { ok: true, valor: Number(t) };
}

const EDADES_TODAS_O_NINGUNA = "Las cuatro edades (infante y niño, desde y hasta) van todas o ninguna.";

/** Las mismas reglas que las restricciones de la 295 (edades_todas_o_ninguna y edades_rangos), con mensajes
 *  concretos para validarlas ANTES de enviar. Devuelve todos los incumplimientos, o null si son válidas. */
export function validarEdades(e: Extras): string | null {
  const { edad_infante_min: im, edad_infante_max: iM, edad_nino_min: nm, edad_nino_max: nM } = e;
  const n = [im, iM, nm, nM].filter((x) => x != null).length;
  if (n === 0) return null;
  if (n !== 4) return EDADES_TODAS_O_NINGUNA;
  const errores: string[] = [];
  if (im !== 0) errores.push("La edad de infante debe comenzar en 0.");
  if (iM! < im!) errores.push(`La edad final del infante (${iM}) no puede ser menor que la inicial (${im}).`);
  if (nm !== iM! + 1) errores.push(`La edad inicial del niño debe ser ${iM! + 1}, porque infante termina en ${iM}.`);
  if (nM! < nm!) errores.push(`La edad final del niño (${nM}) no puede ser menor que la inicial (${nm}).`);
  if (nM! > 17) errores.push("La edad final del niño no puede pasar de 17.");
  return errores.length ? errores.join(" ") : null;
}

/** Traduce un rechazo de la base a un mensaje para el usuario: nunca muestra nombres de tablas ni de
 *  restricciones. Los mensajes propios de las RPC (ya en español y sin nombres técnicos) pasan tal cual. */
export function mensajeErrorBase(message: string | null | undefined): string {
  const m = message ?? "";
  if (/edades_rangos/.test(m)) {
    return "Las edades no son válidas: infante empieza en 0, el niño empieza justo después del último año de infante, cada «hasta» es mayor o igual que su «desde» y niño llega como máximo a 17.";
  }
  if (/edades_todas_o_ninguna/.test(m)) return EDADES_TODAS_O_NINGUNA;
  if (/algun_neto/.test(m)) return "Cada combinación necesita al menos un neto.";
  if (m === "" || /constraint|restricci[oó]n|relation|relaci[oó]n «|violates|syntax|sintaxis|column|columna/i.test(m)) {
    return "No se pudo guardar: algún dato no cumple las reglas de la tarifa. Revisa los valores e inténtalo de nuevo.";
  }
  return m;
}

/** Mensaje de una celda: distingue habitación sin precio, niño nulo, niño en 0 e infante sin tarifa (§3.4). */
export function explicarCelda(tipo: (typeof ACOMS)[number]["tipo"], valor: number | null): { texto: string; vende: boolean } {
  if (tipo === "habitacion") {
    if (valor == null) return { texto: "Sin precio: esta habitación no se venderá con este grupo.", vende: false };
    if (valor === 0) return { texto: "0 en habitación significa «no aplica»: no se venderá.", vende: false };
    return { texto: "Se venderá a este neto.", vende: true };
  }
  if (tipo === "nino") {
    if (valor == null) return { texto: "Sin tarifa de niño: no se venderá con niños de esta edad.", vende: false };
    if (valor === 0) return { texto: "Niño gratis (0).", vende: true };
    return { texto: "Se venderá a este neto.", vende: true };
  }
  if (valor == null) return { texto: "Sin tarifa de infante: el infante viaja gratis (regla actual).", vende: true };
  if (valor === 0) return { texto: "Infante gratis (0).", vende: true };
  return { texto: "Se venderá a este neto.", vende: true };
}

/** Sugerencia por combinación: la tarifa «todos los días» de la vigencia. Si hay duplicadas no se elige ninguna. */
export function sugerencia(cfg: ConfigGrupos, cat: string, reg: string): { fila: OrigenCfg | null; duplicada: boolean } {
  const filas = cfg.origen.filter((o) => (o.tipo_habitacion ?? "").trim() === cat && (o.alimentacion ?? "").trim() === reg);
  return filas.length === 1 ? { fila: filas[0], duplicada: false } : { fila: null, duplicada: filas.length > 1 };
}
export const netosDe = (p: FilaNetos): FilaNetos => Object.fromEntries(ACOMS.map((a) => [a.col, p[a.col] == null ? null : Number(p[a.col])])) as FilaNetos;
export const extrasDe = (p: Partial<Extras>): Extras => ({
  nota_infante: p.nota_infante ?? null, notas: p.notas ?? null,
  edad_infante_min: p.edad_infante_min ?? null, edad_infante_max: p.edad_infante_max ?? null,
  edad_nino_min: p.edad_nino_min ?? null, edad_nino_max: p.edad_nino_max ?? null,
});
export const tieneExtras = (e: Extras) => CAMPOS_EXTRA.some((c) => e[c.col] != null);

const vacia = (n: FilaNetos) => ACOMS.every((a) => n[a.col] == null);
const fmtCelda = (v: number | null) => (v == null ? "vacío" : formatNeto(v));
const fmtExtra = (v: string | number | null) => (v == null ? "vacío" : typeof v === "number" ? String(v) : `«${v}»`);

export type LineaCambio = { tipo: "nuevo" | "cambio" | "quita"; texto: string };
export type PlanPropuesta = {
  filas: FilaPropuesta[];             // EXACTAMENTE lo que se envía a la RPC
  lineas: LineaCambio[];              // EXACTAMENTE lo que hará: una línea por celda o campo que cambia
  nuevas: number; cambiadas: number; quitadas: number; reescritasSinCambio: number;
  sinCambios: boolean;
};

/** Qué hará guardar la propuesta en cada modo, comparado con lo guardado. `editadas` = filas que el
 *  usuario tocó (actualizar) o el contenido completo del alcance (reemplazos). La vista previa y el
 *  payload salen del mismo cálculo: `lineas` describe `filas` + lo que se elimina. */
export function planPropuesta(cfg: ConfigGrupos, modo: ModoPropuesta, grupoId: string | null, editadas: FilaPropuesta[]): PlanPropuesta {
  const nombreG = (id: string) => cfg.grupos.find((g) => g.id === id)?.nombre ?? "?";
  const donde = (g: string, c: string, r: string) => `${nombreG(g)} · ${c} / ${r}`;
  const existentes = new Map(cfg.propuestas.map((p) => [claveCombo(p.grupo_id, p.tipo_habitacion, p.alimentacion), p]));
  const enAlcance = (g: string) => modo === "reemplazar_vigencia" || (modo === "reemplazar_grupo" && g === grupoId);
  const lineas: LineaCambio[] = [];
  const filas: FilaPropuesta[] = [];
  const traidas = new Set<string>();
  let nuevas = 0, cambiadas = 0, quitadas = 0, reescritas = 0;
  const describirQuitada = (p: PropuestaCfg) => {
    const antes = ACOMS.filter((a) => p[a.col] != null).map((a) => `${a.etiqueta} ${formatNeto(Number(p[a.col]))}`);
    const ex = tieneExtras(extrasDe(p)) ? " y sus notas/edades" : "";
    lineas.push({ tipo: "quita", texto: `Se elimina la propuesta ${donde(p.grupo_id, p.tipo_habitacion, p.alimentacion)} (antes: ${antes.join(", ") || "sin netos"})${ex}.` });
    quitadas++;
  };
  for (const f of editadas) {
    if (modo === "reemplazar_grupo" && f.grupo_id !== grupoId) continue;
    const k = claveCombo(f.grupo_id, f.tipo_habitacion, f.alimentacion);
    traidas.add(k);
    const previa = existentes.get(k);
    if (vacia(f.netos)) {
      if (previa) { describirQuitada(previa); if (modo === "actualizar") filas.push(f); }
      continue;
    }
    const prevNetos = previa ? netosDe(previa) : null;
    const prevExtras = previa ? extrasDe(previa) : EXTRAS_VACIOS;
    const lineasFila: LineaCambio[] = [];
    for (const a of ACOMS) {
      const ant = prevNetos ? prevNetos[a.col] : null, nue = f.netos[a.col];
      if (prevNetos ? ant === nue : nue == null) continue;
      const efecto = nue == null || nue === 0 ? ` — ${explicarCelda(a.tipo, nue).texto}` : "";
      lineasFila.push({ tipo: previa ? "cambio" : "nuevo", texto: `${donde(f.grupo_id, f.tipo_habitacion, f.alimentacion)} · ${a.etiqueta}: ${previa ? fmtCelda(ant) : "sin propuesta"} → ${fmtCelda(nue)}${efecto}` });
    }
    // Notas y edades: solo cuentan si se envían (omitidas = se conservan en «actualizar»).
    const extrasFinales = f.extras ?? (modo === "actualizar" ? prevExtras : EXTRAS_VACIOS);
    for (const c of CAMPOS_EXTRA) {
      const ant = prevExtras[c.col], nue = extrasFinales[c.col];
      if (ant === nue) continue;
      lineasFila.push({ tipo: previa ? "cambio" : "nuevo", texto: `${donde(f.grupo_id, f.tipo_habitacion, f.alimentacion)} · ${c.etiqueta}: ${fmtExtra(ant)} → ${fmtExtra(nue)}${nue == null ? " (se borra)" : ""}` });
    }
    const origenCambia = (previa?.origen_tarifa_id ?? null) !== f.origen_tarifa_id;
    if (origenCambia) lineasFila.push({ tipo: previa ? "cambio" : "nuevo", texto: `${donde(f.grupo_id, f.tipo_habitacion, f.alimentacion)}: ${f.origen_tarifa_id == null ? "deja de marcarse como sugerencia aceptada" : "se marca como sugerencia aceptada de la tarifa actual"}` });
    if (lineasFila.length === 0) {
      if (modo !== "actualizar") { filas.push(f); reescritas++; }  // un reemplazo reescribe también lo que no cambia
      continue;
    }
    filas.push(f);
    lineas.push(...lineasFila);
    if (previa) cambiadas++; else nuevas++;
  }
  if (modo !== "actualizar") for (const [k, p] of existentes) if (enAlcance(p.grupo_id) && !traidas.has(k)) describirQuitada(p);
  return { filas, lineas, nuevas, cambiadas, quitadas, reescritasSinCambio: reescritas, sinCambios: nuevas + cambiadas + quitadas === 0 };
}

/** Payload EXACTO de la RPC a partir del plan: los netos siempre presentes (vacío = null intencional), el
 *  origen siempre presente, y notas/edades solo si la fila los trae (omitidos = se conservan). */
export function payloadFilas(filas: FilaPropuesta[]): Record<string, unknown>[] {
  return filas.map((f) => ({
    grupo_id: f.grupo_id, tipo_habitacion: f.tipo_habitacion, alimentacion: f.alimentacion,
    ...f.netos, origen_tarifa_id: f.origen_tarifa_id, ...(f.extras ?? {}),
  }));
}

/** Cobertura que tendría la vigencia AL ACTIVAR (hoy nada cambia): días sin grupo y combinaciones sin habitación. */
export function coberturaPrevista(cfg: ConfigGrupos, grupos: { id?: string; nombre: string; dias: number[] }[], propuestas: { grupo_id: string; tipo_habitacion: string; alimentacion: string; netos: FilaNetos }[]) {
  const cubiertos = new Set(grupos.flatMap((g) => g.dias));
  const diasSinGrupo = DIAS.filter((d) => !cubiertos.has(d.n)).map((d) => d.nombre);
  const porGrupo = grupos.filter((g) => g.id).map((g) => {
    let sinHabitacion = 0;
    for (const c of cfg.categorias) for (const r of cfg.regimenes) {
      const p = propuestas.find((x) => x.grupo_id === g.id && x.tipo_habitacion === c && x.alimentacion === r);
      if (!p || ACOMS.filter((a) => a.tipo === "habitacion").every((a) => !p.netos[a.col])) sinHabitacion++;
    }
    return { grupo: g.nombre, combinaciones: cfg.categorias.length * cfg.regimenes.length, sinHabitacion };
  });
  return { diasSinGrupo, porGrupo };
}

export type PlanGrupos = { altas: GrupoEditado[]; cambios: GrupoEditado[]; errores: string[] };

/** Validación y diferencias del editor de grupos (la base vuelve a validar todo). */
export function planGrupos(cfg: ConfigGrupos, editados: GrupoEditado[]): PlanGrupos {
  const errores: string[] = [];
  const nombres = new Set<string>();
  const usados = new Map<number, string>();
  for (const g of editados) {
    const nombre = g.nombre.trim();
    if (!nombre) errores.push("Cada grupo necesita un nombre.");
    else if (nombres.has(nombre.toLowerCase())) errores.push(`El nombre «${nombre}» está repetido.`);
    nombres.add(nombre.toLowerCase());
    if (g.dias.length === 0) errores.push(`El grupo «${nombre || "sin nombre"}» no tiene días.`);
    for (const d of g.dias) {
      const otro = usados.get(d);
      if (otro !== undefined) errores.push(`El ${DIAS[d - 1].nombre} está en «${otro}» y en «${nombre}».`);
      usados.set(d, nombre);
    }
  }
  const previos = new Map(cfg.grupos.map((g) => [g.id, g]));
  const altas = editados.filter((g) => !g.id);
  const cambios = editados.filter((g) => {
    const p = g.id ? previos.get(g.id) : undefined;
    return p && (p.nombre !== g.nombre.trim() || textoDias(p.dias) !== textoDias(g.dias));
  });
  return { altas, cambios, errores };
}

/** Texto concreto del borrado (V.4): solo el grupo y SUS propuestas; nada comercial se toca. */
export function textoBorrado(cfg: ConfigGrupos, grupoId: string): string[] {
  const g = cfg.grupos.find((x) => x.id === grupoId);
  if (!g) return ["El grupo ya no existe: recarga."];
  const props = cfg.propuestas.filter((p) => p.grupo_id === grupoId);
  const lineas = [
    `Se borrará el grupo «${g.nombre}» (${textoDias(g.dias)}) de la vigencia ${cfg.vigencia.nombre} y ${props.length === 1 ? "su única propuesta de tarifa" : `sus ${props.length} propuestas de tarifa`}.`,
    ...props.map((p) => `· ${p.tipo_habitacion} / ${p.alimentacion}: ${ACOMS.filter((a) => p[a.col] != null).map((a) => `${a.etiqueta} ${formatNeto(Number(p[a.col]))}`).join(", ")}${tieneExtras(extrasDe(p)) ? " (con notas/edades)" : ""}`),
    "No se borran ni se modifican promociones, tarifas vigentes ni otra configuración comercial: hoy la vigencia se sigue vendiendo exactamente igual.",
    "Al activar en el futuro, esos días quedarían fuera de la cobertura de esta vigencia: podría aplicar otra vigencia o no venderse.",
  ];
  const bases = (cfg.bases ?? []).filter((b) => b.grupo_id === grupoId);
  if (bases.length) {
    lineas.push(`También se borran sus bases de calculadora (valores de entrada del grupo): ${bases.map((b) =>
      `${NOMBRE_CALC[b.tipo] ?? b.tipo} (${b.categorias} base${b.categorias === 1 ? "" : "s"}, versión ${b.version})`).join(", ")}. Si alguien las cambia antes de confirmar, el borrado se rechaza y no se borra nada.`);
  }
  if (cfg.promociones.length) lineas.push(`Dependencias informativas para la activación: ${cfg.promociones.map((p) => `${p.temporada} (${p.filas} tarifa${p.filas === 1 ? "" : "s"})`).join(", ")}. No se tocan.`);
  return lineas;
}

/** ¿El error de la base es una confirmación desactualizada (SQLSTATE PT409)? */
export function esDesactualizada(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!error && (error.code === "PT409" || /CONFIG_DESACTUALIZADA/.test(error.message ?? ""));
}

/** Mensaje claro para el rechazo de la base al borrar una vigencia que tiene grupos preparados. */
export function mensajeBorrarVigenciaConGrupos(error: { message?: string | null } | null | undefined): string | null {
  return /hotel_temporada_grupos_temporada_id_fkey/.test(error?.message ?? "")
    ? "Esta vigencia tiene grupos de días preparados. Bórralos primero desde «Grupos de días»; las tarifas actuales no se tocan."
    : null;
}
