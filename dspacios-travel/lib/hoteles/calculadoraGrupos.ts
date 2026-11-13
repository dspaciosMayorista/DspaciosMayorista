// #43/#60 entrega 3b — Calculadoras (Dubai, Mixta, Corporativa) por GRUPO de días. Puro, sin lecturas.
//
// No hay fórmulas nuevas: el grupo se calcula con los MISMOS generadores de `lib/calc/calculadoras.ts`,
// con los parámetros GENERALES guardados de la calculadora del hotel y las BASES propias del grupo
// (cada base conserva todas sus opciones: edades, suplementos y condiciones propias en Dubai; valores por
// régimen en Mixta; tarifa de habitación en Corporativa). Las promociones por grupo NO se calculan aquí
// (entrega 4). El resultado va a la PROPUESTA del grupo (295), que el motor no lee (activación = 3c).
//
// La revisión compara el cálculo con lo que hay y exige resolver explícitamente, antes de confirmar:
//   · edades: si la calculadora fija una regla de edad (Dubai) distinta de la que quedaría vigente;
//   · condiciones: si la calculadora trae una condición (p. ej. «Tarifa no incluye impuestos.») distinta;
//   · habilitaciones: cada acomodación que antes NO se vendía y el cálculo dejaría a la venta.
// Nada viene preseleccionado; nada se completa desde otros grupos ni desde la tarifa actual.
import {
  generarTarifasDubai, generarTarifasMixta, generarTarifasCorporativa, aplicarAdultsOnly,
  type DubaiParams, type DubaiBase, type MixtaParams, type MixtaBase, type CorporativaParams, type CalcTipo, type FilaParaGuardar,
} from "../calc/calculadoras.ts";
import {
  ACOMS, EXTRAS_VACIOS, claveCombo, extrasDe, netosDe, planPropuesta, sugerencia, formatNeto, validarEdades,
  type ColNeto, type ConfigGrupos, type Extras, type FilaNetos, type FilaPropuesta, type PlanPropuesta,
} from "./alcanceGrupos.ts";

export type BaseDubaiGrupo = Omit<DubaiBase, "temporada">;
export type BaseMixtaGrupo = Omit<MixtaBase, "temporada">;
export type BaseCorporativaGrupo = { categoria: string; precio: number };
/** Bases de UN grupo tal como se guardan (sin vigencia: la da el grupo). Mixta va por régimen. */
export type BasesGrupo = BaseDubaiGrupo[] | Record<string, BaseMixtaGrupo[]> | BaseCorporativaGrupo[];
export type ParamsCalculadora = DubaiParams | MixtaParams | CorporativaParams;
/** `generales`: parámetros de la fórmula PROPIOS del grupo (migración 298); null = usa los generales del hotel. */
export type GeneralesGrupo = Record<string, unknown>;
export type BasesGuardadasGrupo = { tipo: CalcTipo; bases: BasesGrupo; version: number; generales?: GeneralesGrupo | null };

export const definesEdades = (tipo: CalcTipo) => tipo === "dubai";

/** Bases del grupo a partir de los parámetros del formulario (solo lo que tiene valor). */
export function basesDeParams(tipo: CalcTipo, params: ParamsCalculadora): BasesGrupo {
  if (tipo === "mixta") {
    const p = params as MixtaParams;
    const out: Record<string, BaseMixtaGrupo[]> = {};
    for (const [regimen, lista] of Object.entries(p.bases_por_regimen ?? {})) {
      const bases = (lista ?? []).map((b) => ({
        categoria: b.categoria, sencilla: Number(b.sencilla) || 0, doble: Number(b.doble) || 0, triple: Number(b.triple) || 0,
        multiple: Number(b.multiple) || 0, nino: Number(b.nino) || 0, nino2: b.nino2 ?? null, infante: b.infante ?? null,
      }));
      if (bases.length) out[regimen] = bases;
    }
    return out;
  }
  const lista = (params as DubaiParams | CorporativaParams).bases ?? [];
  if (tipo === "corporativa") return lista.filter((b) => Number(b.precio) > 0).map((b) => ({ categoria: b.categoria, precio: Number(b.precio) }));
  // JSON ida y vuelta: copia profunda sin claves `undefined` (las bases se guardan tal cual en jsonb).
  return (lista as DubaiBase[]).filter((b) => Number(b.precio) > 0).map((b) => {
    const copia = JSON.parse(JSON.stringify(b)) as Partial<DubaiBase>;
    delete copia.temporada;
    return copia as BaseDubaiGrupo;
  });
}

/** Parámetros para calcular (y para abrir el formulario) con los generales guardados y las bases del grupo. */
export function paramsDelGrupo(tipo: CalcTipo, general: ParamsCalculadora, vigencia: string, bases: BasesGrupo | null): ParamsCalculadora {
  const t = vigencia.trim();
  if (tipo === "mixta") {
    const g = general as MixtaParams;
    const por: Record<string, MixtaBase[]> = {};
    for (const [r, lista] of Object.entries((bases ?? {}) as Record<string, BaseMixtaGrupo[]>)) por[r] = lista.map((b) => ({ ...b, temporada: t }));
    return { ...g, bases: por[g.regimen] ?? [], bases_por_regimen: por };
  }
  const lista = ((bases ?? []) as (BaseDubaiGrupo | BaseCorporativaGrupo)[]).map((b) => ({ ...b, temporada: t }));
  if (tipo === "corporativa") return { ...(general as CorporativaParams), bases: lista as CorporativaParams["bases"] };
  return { ...(general as DubaiParams), bases: lista as DubaiBase[], promos: [] };
}

/** Tarifas del grupo con los generadores existentes (sin promociones), ya con la regla Adults Only. */
export function calcularGrupo(tipo: CalcTipo, general: ParamsCalculadora, vigencia: string, bases: BasesGrupo, adultsOnly: boolean): FilaParaGuardar[] {
  const p = paramsDelGrupo(tipo, general, vigencia, bases);
  const t = vigencia.trim();
  let filas;
  if (tipo === "dubai") filas = generarTarifasDubai(p as DubaiParams);
  else if (tipo === "corporativa") filas = generarTarifasCorporativa(p as CorporativaParams);
  else {
    // Mixta calcula UN régimen por corrida: se corre una vez por cada régimen con bases, SIN contexto de
    // vigencias (así no deriva promociones).
    const m = p as MixtaParams;
    filas = Object.keys(m.bases_por_regimen ?? {}).flatMap((r) =>
      generarTarifasMixta({ ...m, regimen: r, bases: m.bases_por_regimen?.[r] ?? [], bases_por_regimen: undefined }));
  }
  return aplicarAdultsOnly(filas.filter((f) => f.temporada.trim() === t && !f.precio_final_autoritativo), adultsOnly);
}

// ── Revisión ─────────────────────────────────────────────────────────────────────────
export type DecisionCelda = "habilitar" | "sin_venta";
/** `celdas`: clave `combo|columna`; `aplicar`: clave `combo|edades`, `combo|notas` o `combo|nota_infante`. */
export type Decisiones = { celdas: Record<string, DecisionCelda>; aplicar: Record<string, boolean> };
export const DECISIONES_VACIAS: Decisiones = { celdas: {}, aplicar: {} };
export type Habilitacion = { clave: string; col: ColNeto; etiqueta: string; antes: number | null; nuevo: number; decision?: DecisionCelda };
export type Conflicto = { clave: string; campo: "edades" | "notas" | "nota_infante"; antes: string; nuevo: string; obligatorio: boolean; aplicado: boolean };
export type ComboRevision = {
  combo: string; categoria: string; regimen: string;
  /** Con qué se compara la disponibilidad: la propuesta guardada, si no la tarifa actual («todos los días»). */
  referencia: "propuesta" | "tarifa_actual" | "ninguna";
  habilitaciones: Habilitacion[]; conflictos: Conflicto[];
  /** Ninguna habitación quedaría a la venta: no se envía. */
  omitida?: boolean;
};
export type RevisionCalculo = {
  combos: ComboRevision[];
  pendientes: string[];          // impiden confirmar
  avisos: string[];              // informativos
  filas: FilaPropuesta[];        // EXACTAMENTE lo que se envía
  plan: PlanPropuesta;           // anterior → nuevo, celda por celda (mismo cálculo que el panel de grupos)
};

const fmt = (v: number | null) => (v == null ? "vacío" : formatNeto(v));
const textoEdades = (e: (number | null)[]) =>
  e.every((x) => x == null) ? "regla general del hotel" : `infante ${e[0]}–${e[1]} · niño ${e[2]}–${e[3]}`;
const vende = (tipo: (typeof ACOMS)[number]["tipo"], v: number | null) => (tipo === "habitacion" ? v != null && v > 0 : v != null);

export function revisarCalculo(cfg: ConfigGrupos, grupoId: string, tipo: CalcTipo, calculadas: FilaParaGuardar[], decisiones: Decisiones): RevisionCalculo {
  const combos: ComboRevision[] = [], pendientes: string[] = [], avisos: string[] = [], filas: FilaPropuesta[] = [];
  const categoriasCalculadas = new Set<string>();
  for (const f of calculadas) {
    const cat = f.tipo_habitacion.trim(), reg = f.alimentacion.trim();
    if (!cfg.categorias.includes(cat) || !cfg.regimenes.includes(reg)) {
      avisos.push(`${cat} / ${reg}: no está configurada en el hotel; no se lleva a la propuesta.`);
      continue;
    }
    categoriasCalculadas.add(cat);
    const combo = claveCombo(grupoId, cat, reg);
    const previa = cfg.propuestas.find((p) => p.grupo_id === grupoId && p.tipo_habitacion === cat && p.alimentacion === reg);
    const actual = previa ? null : sugerencia(cfg, cat, reg).fila;
    const referencia: ComboRevision["referencia"] = previa ? "propuesta" : actual ? "tarifa_actual" : "ninguna";
    const refNetos = previa ? netosDe(previa) : actual ? netosDe(actual) : null;
    const calc = Object.fromEntries(ACOMS.map((a) => [a.col, (f as unknown as Record<string, number | null>)[a.col] ?? null])) as FilaNetos;
    const netos: FilaNetos = { ...calc };
    const donde = `${cat} / ${reg}`;

    // Disponibilidad: lo que antes no se vendía y el cálculo pondría a la venta exige decisión explícita.
    const habilitaciones: Habilitacion[] = [];
    for (const a of ACOMS) {
      if (a.tipo === "infante") continue;   // infante vacío = viaja gratis: un precio es un cambio de precio, no una habilitación
      const antes = refNetos ? refNetos[a.col] : null, nuevo = calc[a.col];
      if (vende(a.tipo, antes) || !vende(a.tipo, nuevo)) continue;
      const clave = `${combo}|${a.col}`, decision = decisiones.celdas[clave];
      habilitaciones.push({ clave, col: a.col, etiqueta: a.etiqueta, antes, nuevo: nuevo as number, decision });
      if (!decision) pendientes.push(`${donde} · ${a.etiqueta}: hoy no se vende; elige mantenerla sin venta o habilitarla a ${fmt(nuevo)}.`);
      else if (decision === "sin_venta") netos[a.col] = previa ? (previa[a.col] == null ? null : Number(previa[a.col])) : null;
    }
    // Sin ninguna HABITACIÓN a la venta la combinación no se vende (un precio de niño o infante solo no basta): no se
    // envía y sus notas/edades no se revisan (no se guardan). Sus habilitaciones siguen visibles para cambiar la decisión.
    if (!ACOMS.some((a) => a.tipo === "habitacion" && vende(a.tipo, netos[a.col]))) {
      combos.push({ combo, categoria: cat, regimen: reg, referencia, habilitaciones, conflictos: [], omitida: true });
      avisos.push(`${donde}: ninguna habitación queda a la venta; no se lleva a la propuesta${previa ? " (la guardada queda igual)" : ""}.`);
      continue;
    }

    // Notas y edades: omitidas = se conservan. Solo se envían si se aceptan explícitamente.
    const prev = previa ? extrasDe(previa) : EXTRAS_VACIOS;
    const conflictos: Conflicto[] = [];
    const nuevos: Partial<Extras> = {};
    if (definesEdades(tipo)) {
      const calcE = [f.edad_infante_min ?? null, f.edad_infante_max ?? null, f.edad_nino_min ?? null, f.edad_nino_max ?? null];
      const prevE = [prev.edad_infante_min, prev.edad_infante_max, prev.edad_nino_min, prev.edad_nino_max];
      if (calcE.some((v, i) => v !== prevE[i])) {
        const clave = `${combo}|edades`, aplicado = !!decisiones.aplicar[clave];
        conflictos.push({ clave, campo: "edades", antes: textoEdades(prevE), nuevo: textoEdades(calcE), obligatorio: true, aplicado });
        if (aplicado) Object.assign(nuevos, { edad_infante_min: calcE[0], edad_infante_max: calcE[1], edad_nino_min: calcE[2], edad_nino_max: calcE[3] });
        else pendientes.push(`${donde}: el precio se calculó con ${textoEdades(calcE)} y la propuesta quedaría con ${textoEdades(prevE)}. Aplica las edades del cálculo o ajusta la base.`);
      }
    }
    const calcN = (f.notas ?? "").trim() || null;
    if (calcN && calcN !== prev.notas) {
      const clave = `${combo}|notas`, aplicado = !!decisiones.aplicar[clave];
      conflictos.push({ clave, campo: "notas", antes: prev.notas ?? "vacío", nuevo: calcN, obligatorio: true, aplicado });
      if (aplicado) nuevos.notas = calcN;
      else pendientes.push(`${donde}: el cálculo trae la condición «${calcN}»${prev.notas ? ` y la propuesta tiene «${prev.notas}»` : " y la propuesta no la tiene"}. Aplícala (reemplaza la nota) o ajusta la base.`);
    }
    const calcNI = (f.nota_infante ?? "").trim() || null;
    if (calcNI && calcNI !== prev.nota_infante) {
      const clave = `${combo}|nota_infante`, aplicado = !!decisiones.aplicar[clave];
      conflictos.push({ clave, campo: "nota_infante", antes: prev.nota_infante ?? "vacío", nuevo: calcNI, obligatorio: false, aplicado });
      if (aplicado) nuevos.nota_infante = calcNI;
    }
    const extras = Object.keys(nuevos).length ? { ...prev, ...nuevos } : undefined;
    if (extras) { const e = validarEdades(extras); if (e) pendientes.push(`${donde}: ${e}`); }

    combos.push({ combo, categoria: cat, regimen: reg, referencia, habilitaciones, conflictos });
    filas.push({ grupo_id: grupoId, tipo_habitacion: cat, alimentacion: reg, netos, origen_tarifa_id: null, ...(extras ? { extras } : {}) });
  }
  for (const c of cfg.categorias) if (!categoriasCalculadas.has(c)) avisos.push(`${c}: sin base en este grupo; no se calcula y su propuesta queda igual.`);
  return { combos, pendientes, avisos, filas, plan: planPropuesta(cfg, "actualizar", null, filas) };
}

/** Decisión para todas las habilitaciones pendientes o no (acción explícita «aplicar a todas»). */
export function decidirTodas(rev: RevisionCalculo, decisiones: Decisiones, d: DecisionCelda): Decisiones {
  const celdas = { ...decisiones.celdas };
  for (const c of rev.combos) for (const h of c.habilitaciones) celdas[h.clave] = d;
  return { ...decisiones, celdas };
}

/** Texto canónico de unas bases (claves ordenadas): `jsonb` reordena las claves al guardar, así que comparar
 *  con JSON.stringify diría «cambiaron» al reabrir unas bases idénticas. */
export function claveBases(b: unknown): string {
  const orden = (v: unknown): unknown => Array.isArray(v) ? v.map(orden)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, orden((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(orden(b));
}

// ── Parámetros de la fórmula propios del grupo (migración 298) ───────────────────────────
// Solo FÓRMULA: modificadores, suplementos (incluido FULL), IVA, pax, persona/niño adicional, impuesto y
// descuento de la tarifa (Corporativa, «Dinámica»: es parte de la fórmula, no una promoción). Nunca
// promociones ni bases: una promoción comercial no puede entrar como «parámetro» del grupo.
export const CLAVES_GENERALES: Record<CalcTipo, readonly string[]> = {
  dubai: ["regimen_base", "modificadores", "suplementos", "infante_nota"],
  mixta: ["iva_pct", "acom", "nino", "pax", "infante_nota"],
  corporativa: ["regimen_base", "persona_adicional", "nino_adicional", "impuesto_pct", "descuento_pct", "suplementos_regimen", "infante_nota"],
};

/** Los parámetros de la fórmula de unos params (del formulario o del hotel), sin bases ni promociones. */
export function generalesDeParams(tipo: CalcTipo, params: ParamsCalculadora): GeneralesGrupo {
  const p = params as unknown as Record<string, unknown>;
  return JSON.parse(JSON.stringify(Object.fromEntries(CLAVES_GENERALES[tipo].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))));
}

/** Generales con los que se calcula el grupo: los propios (si los tiene) sobre los del hotel; sin promociones. */
export function generalesEfectivos(tipo: CalcTipo, hotel: ParamsCalculadora, propios: GeneralesGrupo | null | undefined): ParamsCalculadora {
  const base = { ...(hotel as unknown as Record<string, unknown>) };
  if (tipo === "dubai") base.promos = [];
  return (propios ? { ...base, ...generalesDeParams(tipo, propios as unknown as ParamsCalculadora) } : base) as unknown as ParamsCalculadora;
}

const ETIQUETA: Record<string, string> = {
  "regimen_base": "Régimen base", "infante_nota": "Nota de infante",
  "modificadores.sencilla_pct": "Sencilla %", "modificadores.pax3_pct": "3er pax %", "modificadores.pax4_pct": "4to pax %",
  "modificadores.nino_pct": "Niño 1 %", "modificadores.nino2_pct": "Niño 2 %", "modificadores.infante_pct": "Infante %",
  "iva_pct": "IVA %", "nino.iva": "Niño/infante con IVA", "persona_adicional": "Persona adicional", "nino_adicional": "Niño adicional",
  "impuesto_pct": "Impuesto %", "descuento_pct": "Descuento de la tarifa % (fórmula, no es promoción)",
};
/** Pares «etiqueta → valor» de unos generales, para mostrarlos y compararlos (suplementos por régimen). */
function aplanar(tipo: CalcTipo, g: GeneralesGrupo): Map<string, string> {
  const out = new Map<string, string>();
  const val = (v: unknown) => (typeof v === "number" ? formatNeto(v) : typeof v === "boolean" ? (v ? "sí" : "no") : v == null || v === "" ? "vacío" : String(v));
  for (const [k, v] of Object.entries(g)) {
    if (k === "suplementos" && Array.isArray(v)) {
      for (const s of v as { regimen: string; monto: number }[]) out.set(`Suplemento ${s.regimen}`, val(s.monto));
    } else if (k === "suplementos_regimen" && Array.isArray(v)) {
      for (const s of v as { regimen: string; adulto: number; nino: number }[]) {
        out.set(`Suplemento ${s.regimen} adulto`, val(s.adulto)); out.set(`Suplemento ${s.regimen} niño`, val(s.nino));
      }
    } else if (k === "acom" && v && typeof v === "object") {
      for (const [a, c] of Object.entries(v as Record<string, { modo: string; iva: boolean }>)) out.set(`${a}: modo / IVA`, `${c.modo === "hab" ? "por habitación" : "por persona"} / ${c.iva ? "con IVA" : "sin IVA"}`);
    } else if (k === "pax" && v && typeof v === "object") {
      for (const [a, n] of Object.entries(v as Record<string, number>)) out.set(`Pax por habitación ${a}`, val(n));
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out.set(ETIQUETA[`${k}.${k2}`] ?? `${k}.${k2}`, val(v2));
    } else out.set(ETIQUETA[k] ?? k, val(v));
  }
  if (tipo === "dubai" && !out.has("Niño 2 %")) out.set("Niño 2 %", "sin configurar");
  return out;
}

/** Texto de referencia de unos generales (p. ej. los del hotel), en una línea. */
export const resumenGenerales = (tipo: CalcTipo, g: GeneralesGrupo) => [...aplanar(tipo, g)].map(([k, v]) => `${k}: ${v}`).join(" · ");

/** Qué cambia en los parámetros de la fórmula del grupo al confirmar (anterior → nuevo), sobre los efectivos. */
export function cambiosGenerales(tipo: CalcTipo, hotel: ParamsCalculadora, antes: GeneralesGrupo | null | undefined, despues: GeneralesGrupo | null): string[] {
  const lineas: string[] = [];
  if (!!antes !== !!despues) {
    lineas.push(`Parámetros de la fórmula del grupo: ${antes ? "propios" : "los generales del hotel"} → ${despues ? "propios del grupo (los del hotel no cambian)" : "los generales del hotel"}.`);
  }
  const a = aplanar(tipo, generalesDeParams(tipo, generalesEfectivos(tipo, hotel, antes))), d = aplanar(tipo, generalesDeParams(tipo, generalesEfectivos(tipo, hotel, despues)));
  for (const k of new Set([...a.keys(), ...d.keys()])) if (a.get(k) !== d.get(k)) lineas.push(`${k}: ${a.get(k) ?? "vacío"} → ${d.get(k) ?? "vacío"}`);
  return lineas;
}
