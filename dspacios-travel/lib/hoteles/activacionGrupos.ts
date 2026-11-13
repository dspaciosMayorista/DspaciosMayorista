// #43/#60 entrega 3c — Revisión de «Aplicar a la venta» y de «Volver a todos los días» (puro, sin lecturas).
// Todo sale de UNA lectura (`grupos_dias_alcance`, migración 299). Lo que la base exige o rechaza (habilitaciones,
// empates, reglas de edad, sugerencias obsoletas, compra cerrada) lo calcula la base; aquí solo se presenta y se
// arma el payload EXACTO. Lo vigente sigue vendiéndose hasta confirmar; nada se habilita sin confirmar una por una.
import {
  ACOMS, CAMPOS_EXTRA, DIAS, explicarCelda, extrasDe, formatNeto, netosDe, textoDias,
  type ConfigGrupos, type Extras, type FilaNetos, type GrupoCfg,
} from "./alcanceGrupos.ts";

export type VigenteCfg = FilaNetos & Extras & { id: number; grupo_id: string; tipo_habitacion: string; alimentacion: string };
export type Habilitacion = {
  grupo_id: string; grupo: string; tipo_habitacion: string; alimentacion: string; acomodacion: string;
  nuevo: number | null; hoy: number | null;
};
/** Conflicto que devuelve la base (`_grupos_43_empates`, 299): un empate por rango de noches; un par cuyo cruce
 *  supera 1.096 noches y por eso NO se verificó (bloquea igual); o el aviso de que la lista se recortó a 200. */
export type Empate =
  | {
      tipo?: "empate" | "no_verificable";
      a: { id: number; nombre: string; con_grupos: boolean }; b: { id: number; nombre: string; con_grupos: boolean };
      prioridad: number; tipo_habitacion: string | null; alimentacion: string | null; acomodacion: string | null;
      desde: string; hasta: string; noches: number;
    }
  | { tipo: "truncado"; total: number; mostrados: number };
export type AlcanceGrupos = ConfigGrupos & {
  estado: "preparado" | "activo";
  compra_cerrada: boolean;
  vigentes: VigenteCfg[];
  habilitaciones: Habilitacion[];
  empates: Empate[];
  edades_conflicto: { tipo_habitacion: string; alimentacion: string; reglas: { grupo: string; regla: string }[] }[];
  obsoletas: { grupo: string; tipo_habitacion: string; alimentacion: string }[];
  dias_sin_grupo: number[];
  pendientes: number;
  otras_con_grupos: number;
  /** Paquetes de porción terrestre activos que usan el hotel (299). */
  paquetes_porcion?: number;
  /** Entrega 4 (300): promociones por grupo vinculadas a esta vigencia, con sus reglas, y conflictos de prioridad. */
  promociones_reglas?: PromoVinculada[];
  promociones_conflictos?: ConflictoPromo[];
};

export type PromoVinculada = {
  id: number; nombre: string; tipo: string; unidad: string | null; prioridad: number;
  reglas: { grupo_id: string | null; grupo: string | null; valor: number; dias: number[] | null }[];
};
export type ConflictoPromo =
  | { tipo: "conflicto"; a: string; b: string; prioridad: number; base: string; noche: string; grupo: string | null }
  | { tipo: "no_verificable"; a: string; b: string; prioridad: number; base: string; desde: string; hasta: string };

const valorPromo = (p: PromoVinculada, v: number) =>
  p.tipo === "descuento_pct" ? `−${v} %` : `−${formatNeto(v)} ${p.unidad === "habitacion_noche" ? "por habitación y noche" : "por persona y noche"}`;
/** Una línea por promoción vinculada: qué grupos y días descuenta y cuáles conservan la base. */
export function textoPromoVinculada(p: PromoVinculada, grupos: readonly GrupoCfg[]): string {
  const conRegla = p.reglas.map((r) => `${r.grupo ?? "todos los días"} ${valorPromo(p, Number(r.valor))}${r.dias ? ` (solo ${textoDias(r.dias)})` : ""}`);
  const sin = grupos.filter((g) => !p.reglas.some((r) => r.grupo_id === g.id)).map((g) => g.nombre);
  return `«${p.nombre}» (prioridad ${p.prioridad}): ${conRegla.join("; ") || "sin reglas: no aplica"}${sin.length ? `; ${sin.join(", ")} sin regla: conserva la base` : ""}.`;
}
export function textoConflictoPromo(c: ConflictoPromo): string {
  if (c.tipo === "no_verificable") return `No se puede verificar si «${c.a}» y «${c.b}» (prioridad ${c.prioridad}) coinciden: su cruce va del ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}, más de 1.096 noches. Acota las fechas o cambia la prioridad de una.`;
  return `«${c.a}» y «${c.b}» tienen la misma prioridad (${c.prioridad}) sobre ${c.base} y pueden aplicar la misma noche (por ejemplo el ${fechaCorta(c.noche)}${c.grupo ? `, ${c.grupo}` : ""}). Cambia la prioridad de una, o sus fechas, días, régimen o compra.`;
}

const ETIQUETA_ACOM: Record<string, string> = Object.fromEntries(ACOMS.map((a) => [a.col.replace("neto_", ""), a.etiqueta]));
export const etiquetaAcom = (acom: string) => ETIQUETA_ACOM[acom] ?? acom;
export const claveHabilitacion = (h: Pick<Habilitacion, "grupo_id" | "tipo_habitacion" | "alimentacion" | "acomodacion">) =>
  `${h.grupo_id}|${h.tipo_habitacion}|${h.alimentacion}|${h.acomodacion}`;
const fmt = (v: number | null | undefined) => (v == null ? "vacío" : formatNeto(Number(v)));
const fmtExtra = (v: string | number | null) => (v == null ? "vacío" : typeof v === "number" ? String(v) : `«${v}»`);
const nombresDias = (dias: readonly number[]) => [...dias].sort((x, y) => x - y).map((d) => DIAS[d - 1]?.nombre ?? "?").join(", ");
const fechaCorta = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

export function textoEmpate(e: Empate): string {
  if (e.tipo === "truncado") return `Hay ${e.total - e.mostrados} conflicto(s) más que no se listan (se muestran ${e.mostrados}). Resuelve los de arriba y vuelve a revisar.`;
  const rango = e.desde === e.hasta ? `el ${fechaCorta(e.desde)}` : `del ${fechaCorta(e.desde)} al ${fechaCorta(e.hasta)}`;
  if (e.tipo === "no_verificable") {
    return `No se pueden verificar empates entre ${e.a.nombre} y ${e.b.nombre} (las dos con prioridad ${e.prioridad}): comparten ${e.noches.toLocaleString("es-CO")} noches ${rango}, más de las 1.096 que se revisan. Acota las fechas de una de las dos.`;
  }
  return `Empate de prioridad entre ${e.a.nombre} y ${e.b.nombre} (las dos con prioridad ${e.prioridad}): ${e.tipo_habitacion} / ${e.alimentacion} · ${etiquetaAcom(e.acomodacion ?? "")}, ${rango}. Cambia la prioridad, las fechas, los días o el régimen de una de las dos.`;
}

export type LineaActivacion = { tipo: "nuevo" | "cambio" | "quita" | "info"; texto: string };
export type PlanActivacion = {
  primera: boolean;
  lineas: LineaActivacion[];
  bloqueos: string[];
  avisos: string[];
  habilitaciones: (Habilitacion & { clave: string; texto: string })[];
  confirmacion: string;
};

/** Qué hará «Aplicar a la venta», comparando la propuesta de cada grupo con lo que hoy se vende ESOS días: la tarifa
 *  del grupo si ya se vende por grupos, o la tarifa «todos los días» si no. */
export function planActivacion(a: AlcanceGrupos): PlanActivacion {
  const primera = a.estado !== "activo";
  const lineas: LineaActivacion[] = [];
  const combos = new Set<string>();
  const clave = (c: string, r: string) => `${c}\u001f${r}`;
  for (const p of a.propuestas) combos.add(clave(p.tipo_habitacion, p.alimentacion));
  for (const v of a.vigentes) combos.add(clave(v.tipo_habitacion, v.alimentacion));
  for (const o of a.origen) combos.add(clave((o.tipo_habitacion ?? "").trim(), (o.alimentacion ?? "").trim()));
  const origenDe = (c: string, r: string) =>
    a.origen.filter((o) => (o.tipo_habitacion ?? "").trim() === c && (o.alimentacion ?? "").trim() === r).at(-1) ?? null;
  let cambios = 0;
  for (const g of a.grupos) {
    const dias = textoDias(g.dias);
    for (const k of [...combos].sort()) {
      const [c, r] = k.split("\u001f");
      const nuevo = a.propuestas.find((p) => p.grupo_id === g.id && p.tipo_habitacion === c && p.alimentacion === r) ?? null;
      const ref = g.activo ? (a.vigentes.find((v) => v.grupo_id === g.id && v.tipo_habitacion === c && v.alimentacion === r) ?? null) : origenDe(c, r);
      const donde = `${g.nombre} (${dias}) · ${c} / ${r}`;
      if (!nuevo && !ref) continue;
      if (!nuevo) {
        lineas.push({ tipo: "quita", texto: `${donde}: deja de venderse (sin tarifa en la propuesta, no se vende esos días).` });
        cambios++; continue;
      }
      const ant = ref ? netosDe(ref) : null, nue = netosDe(nuevo);
      for (const ac of ACOMS) {
        const x = ant ? ant[ac.col] : null, y = nue[ac.col];
        if (x === y) continue;
        const efecto = y == null || y === 0 ? ` — ${explicarCelda(ac.tipo, y).texto}` : "";
        lineas.push({ tipo: ref ? "cambio" : "nuevo", texto: `${donde} · ${ac.etiqueta}: ${ref ? fmt(x) : "no se vendía"} → ${fmt(y)}${efecto}` });
        cambios++;
      }
      const ea: Extras = ref ? extrasDe(ref) : extrasDe({}), en = extrasDe(nuevo);
      for (const ce of CAMPOS_EXTRA) {
        if (ea[ce.col] === en[ce.col]) continue;
        lineas.push({ tipo: "cambio", texto: `${donde} · ${ce.etiqueta}: ${fmtExtra(ea[ce.col])} → ${fmtExtra(en[ce.col])}` });
        cambios++;
      }
    }
  }
  const nuevosGrupos = a.grupos.filter((g) => !g.activo);
  if (primera && a.origen.length) {
    lineas.unshift({ tipo: "info", texto: `Las ${a.origen.length} tarifa(s) «todos los días» de ${a.vigencia.nombre} dejan de venderse: desde que confirmes, cada noche se vende con la tarifa del grupo que cubre ese día.` });
  }
  if (nuevosGrupos.length) {
    lineas.unshift({ tipo: "info", texto: `Pasan a venderse los grupos: ${nuevosGrupos.map((g) => `${g.nombre} (${textoDias(g.dias)})`).join(", ")}.` });
  }

  const bloqueos: string[] = [];
  if (a.compra_cerrada) bloqueos.push(`La vigencia ${a.vigencia.nombre} tiene la compra cerrada: sus tarifas se conservan y no se cambian.`);
  if (a.propuestas.length === 0) bloqueos.push("Ningún grupo tiene tarifas en la propuesta: no hay nada que aplicar (sin tarifa no se vende).");
  if (!primera && a.pendientes === 0) bloqueos.push("No hay cambios pendientes: lo que se vende ya es igual a la propuesta.");
  for (const o of a.obsoletas) bloqueos.push(`La sugerencia aceptada en ${o.grupo} · ${o.tipo_habitacion} / ${o.alimentacion} ya no coincide con la tarifa actual: vuelve a revisarla en la propuesta.`);
  for (const e of a.edades_conflicto) {
    bloqueos.push(`${e.tipo_habitacion} / ${e.alimentacion}: la regla de edad no coincide entre grupos (${e.reglas.map((x) => `${x.grupo}: ${x.regla}`).join("; ")}). Usa la misma en todos los grupos de esa combinación.`);
  }
  for (const e of a.empates) bloqueos.push(textoEmpate(e));
  for (const c of a.promociones_conflictos ?? []) bloqueos.push(textoConflictoPromo(c));

  const avisos: string[] = [];
  // Entrega 4: las promociones por grupo vinculadas solo actúan sobre grupos que SE VENDEN. Al aplicar por primera vez
  // EMPIEZAN a aplicarse; en una actualización siguen. Se nombran con sus reglas para que nada quede oculto.
  const vinculadas = a.promociones_reglas ?? [];
  if (vinculadas.length) {
    avisos.push(`${primera ? "Al confirmar EMPIEZAN a aplicarse" : "Siguen aplicándose"} las promociones por grupo de ${a.vigencia.nombre}, solo en las noches que gane esta vigencia: ${vinculadas.map((p) => textoPromoVinculada(p, a.grupos)).join(" ")}`);
  }
  if (a.dias_sin_grupo.length) {
    avisos.push(`Los ${nombresDias(a.dias_sin_grupo)} no los cubre ningún grupo: quedan fuera de la cobertura de ${a.vigencia.nombre}; esas noches podría venderlas otra vigencia aplicable o quedar sin venta.`);
  }
  if (a.promociones.length) {
    avisos.push(`Promociones calculadas desde ${a.vigencia.nombre} (${a.promociones.map((p) => p.temporada).join(", ")}): conservan sus precios actuales (calculados sobre la tarifa «todos los días»), aplican solo en las noches que gane ${a.vigencia.nombre} y la calculadora general deja de regenerarlas. Para descontar por grupo, créalas como promociones por grupo.`);
  }
  if (primera && a.otras_con_grupos === 0) {
    avisos.push("El «Desde» publicado de la porción terrestre de este hotel deja de mostrarse hasta que exista el «Desde» por estadía real: con precios distintos por día no se publica un «desde» aproximado. Las cotizaciones por fechas siguen funcionando.");
  }
  if ((a.paquetes_porcion ?? 0) > 0) {
    avisos.push(`Este hotel está en ${a.paquetes_porcion} paquete(s) de porción terrestre activo(s): mientras se venda por grupos NO se podrán regenerar (hasta el «Desde» por estadía real) y DEJARÁN DE MOSTRARSE en el tarifario (su publicación anterior queda oculta, no se venden precios viejos). Al confirmar se informará cuáles no se regeneraron.`);
  }
  avisos.push("Al confirmar se regeneran los tarifarios de los paquetes de este hotel. Una estadía se vende solo si todas sus noches tienen precio.");

  const habilitaciones = a.habilitaciones.map((h) => ({
    ...h, clave: claveHabilitacion(h),
    texto: `${h.grupo} · ${h.tipo_habitacion} / ${h.alimentacion} · ${etiquetaAcom(h.acomodacion)}: hoy no se vende (${h.hoy == null ? "sin tarifa" : fmt(h.hoy)}) → se venderá a ${fmt(h.nuevo)}`,
  }));
  const confirmacion = primera
    ? `Se pondrá a la venta ${a.vigencia.nombre} por grupos de días (${a.grupos.map((g) => `${g.nombre}: ${textoDias(g.dias)}`).join(" · ")}), con ${cambios} cambio(s) frente a lo que hoy se vende${habilitaciones.length ? ` y ${habilitaciones.length} acomodación(es) que pasan a venderse` : ""}.`
    : `Se aplicarán a la venta ${cambios} cambio(s) de ${a.vigencia.nombre}${habilitaciones.length ? `, ${habilitaciones.length} de ellos ponen a la venta acomodaciones que hoy no se venden` : ""}. Lo demás sigue igual.`;
  return { primera, lineas, bloqueos, avisos, habilitaciones, confirmacion };
}

/** ¿Se puede confirmar? Sin bloqueos y con TODAS las habilitaciones confirmadas una por una. */
export function puedeAplicar(plan: PlanActivacion, confirmadas: ReadonlySet<string>): boolean {
  return plan.bloqueos.length === 0 && plan.habilitaciones.every((h) => confirmadas.has(h.clave));
}
/** Payload EXACTO de las habilitaciones confirmadas (la base exige que sean exactamente las que calcula). */
export const payloadHabilitaciones = (plan: PlanActivacion, confirmadas: ReadonlySet<string>) =>
  plan.habilitaciones.filter((h) => confirmadas.has(h.clave))
    .map((h) => ({ grupo_id: h.grupo_id, tipo_habitacion: h.tipo_habitacion, alimentacion: h.alimentacion, acomodacion: h.acomodacion }));

export type OpcionVolver = { grupo_id: string; texto: string };
export type ComboVolver = { tipo_habitacion: string; alimentacion: string; opciones: OpcionVolver[] };
export type PlanVolver = { combos: ComboVolver[]; avisos: string[] };

/** «Volver a todos los días»: por cada combinación que hoy se vende por grupos, de qué grupo se conserva la tarifa
 *  (o ninguno). Nada viene elegido. */
export function planVolver(cfg: ConfigGrupos & { vigentes?: VigenteCfg[] }): PlanVolver {
  const vig = cfg.vigentes ?? [];
  const activos = new Map<string, GrupoCfg>(cfg.grupos.filter((g) => g.activo).map((g) => [g.id, g]));
  const claves = [...new Set(vig.map((v) => `${v.tipo_habitacion}\u001f${v.alimentacion}`))].sort();
  const combos = claves.map((k) => {
    const [c, r] = k.split("\u001f");
    const opciones = vig.filter((v) => v.tipo_habitacion === c && v.alimentacion === r && activos.has(v.grupo_id)).map((v) => {
      const g = activos.get(v.grupo_id)!;
      const netos = ACOMS.filter((ac) => v[ac.col] != null).map((ac) => `${ac.etiqueta} ${formatNeto(Number(v[ac.col]))}`).join(", ");
      return { grupo_id: v.grupo_id, texto: `La de ${g.nombre} (${textoDias(g.dias)}): ${netos || "sin netos"}` };
    });
    return { tipo_habitacion: c, alimentacion: r, opciones };
  });
  const cubiertos = new Set([...activos.values()].flatMap((g) => g.dias));
  const sinGrupo = DIAS.filter((d) => !cubiertos.has(d.n)).map((d) => d.n);
  const avisos = [
    `La tarifa elegida se venderá TODOS los días de ${cfg.vigencia.nombre}; las demás tarifas por grupo dejan de venderse (quedan en el historial).`,
    ...(sinGrupo.length ? [`Los ${nombresDias(sinGrupo)}, que hoy no cubre ningún grupo, pasarán a venderse con esta vigencia.`] : []),
    "Una combinación marcada «No conservar» deja de venderse en esta vigencia.",
    "Los grupos quedan preparados (no se venden), con su propuesta, para poder aplicarlos de nuevo. Se regeneran los tarifarios de los paquetes de este hotel.",
    // Entrega 4: las promociones por grupo dejan de aplicar (sus reglas son por grupo y los grupos dejan de venderse).
    ...((cfg as { promociones_reglas?: PromoVinculada[] }).promociones_reglas?.length
      ? [`Las promociones por grupo de ${cfg.vigencia.nombre} DEJAN DE APLICAR (sus reglas son por grupo): ${((cfg as { promociones_reglas?: PromoVinculada[] }).promociones_reglas ?? []).map((p) => `«${p.nombre}»`).join(", ")}. Quedan guardadas y vuelven a aplicar si se aplican de nuevo los grupos.`]
      : []),
  ];
  return { combos, avisos };
}

/** Elecciones completas (una por combinación) o null si falta alguna. `null` como valor = no conservar. */
export function payloadVolver(plan: PlanVolver, elecciones: Readonly<Record<string, string | null | undefined>>) {
  const out = [];
  for (const c of plan.combos) {
    const k = `${c.tipo_habitacion}\u001f${c.alimentacion}`;
    if (!(k in elecciones) || elecciones[k] === undefined) return null;
    out.push({ tipo_habitacion: c.tipo_habitacion, alimentacion: c.alimentacion, grupo_id: elecciones[k] ?? null });
  }
  return out;
}
export const claveComboVolver = (c: Pick<ComboVolver, "tipo_habitacion" | "alimentacion">) => `${c.tipo_habitacion}\u001f${c.alimentacion}`;

/** Resultado de regenerar los tarifarios del hotel tras cambiar la venta (misma forma que `ResultadoRegeneracionHotel`). */
export type Regeneracion = { paquetes: number | null; actualizados: number; enCurso: number; fallidos: { paqueteId: number; error: string }[] };
/** Qué se puede afirmar de la publicación: nunca «todo actualizado» si algo falló o no se pudo consultar. */
export function textoRegeneracion(r: Regeneracion | undefined): { ok: boolean; texto: string } {
  if (!r || r.paquetes === null) {
    return { ok: false, texto: "No se pudo comprobar qué paquetes usan este hotel: sus tarifarios pueden estar desactualizados. Regenéralos desde Paquetes." };
  }
  if (r.paquetes === 0) return { ok: true, texto: "Este hotel no está en ningún paquete activo: no había tarifarios que regenerar." };
  const partes: string[] = [];
  if (r.actualizados) partes.push(`${r.actualizados} tarifario(s) regenerado(s)`);
  if (r.enCurso) partes.push(`${r.enCurso} en publicación por lotes (se terminan de publicar solos)`);
  if (r.fallidos.length) {
    partes.push(`${r.fallidos.length} NO se pudieron regenerar (paquete ${r.fallidos.map((f) => `#${f.paqueteId}`).join(", ")}): regenéralos desde Paquetes`);
  }
  return { ok: r.fallidos.length === 0, texto: `Paquetes de este hotel: ${partes.join("; ")}.` };
}
