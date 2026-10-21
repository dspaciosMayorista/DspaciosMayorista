// ─────────────────────────────────────────────────────────────────────────
// #50 — Precio NETO de la hija manual de una comparativa: cálculo PURO.
//
// Es el ESPEJO en TypeScript de `p50_priv.calcular`, `p50_priv.repartir` y
// `p50_priv.evaluar_margen` (migración 222). La base de datos es la autoridad:
// decide al sellar la hija y otra vez antes de la 198. Esto sirve para la vista
// previa del formulario y para probar la paridad TS-SQL con los mismos vectores.
//
// Todo en CENTAVOS ENTEROS (BigInt), igual que en SQL: nada de coma flotante en
// el dinero. Reglas (bitácora de #50):
//   · Base del descuento = PVP − tiquetes − recobro (si se reconoce la
//     participación del aliado; si no, el recobro entra a la base). Los niños
//     entran. Tiquete = toda fila `aereo`.
//   · Comisión ordinaria = round(base × %), a la unidad de moneda (como #30).
//   · Participación = min(recobroAliado, recobro), solo si se reconoce.
//   · Descuento = ordinaria + participación. Con descuento 0 NO hay NETO.
//   · Margen sobre el TOTAL: (NETO − costo total de TODAS las filas) / NETO ≥ 6 %
//     con la tolerancia de medio peso de `margenContrato.ts`; solo tiquetes:
//     2 % EXACTO. NETO < costo total o costo total 0 ⇒ rechazo sin excepción.
//   · El reparto por fila solo alimenta el snapshot de condiciones de pago.
// ─────────────────────────────────────────────────────────────────────────
import { evaluarMargenContrato, ROLES_EXCEPCION_MARGEN } from "../contrato/margenContrato.ts";

// BigInt(...) y no literales 0n: el target del proyecto es ES2017.
const B0 = BigInt(0);
const B1 = BigInt(1);

export const ROLES_FIJAN_NETO: readonly string[] = ["superadmin", "gerencia", "administracion", "operaciones"];
export const MARGEN_BPS_NETO = 600;
export const MARGEN_BPS_SOLO_TIQUETES = 200;
/** Tolerancia de medio peso del 6 % (igual que `evaluarMargenContrato`), en centavos. */
export const TOLERANCIA_CENTAVOS = BigInt(50);
/** Solo superadmin autoriza bajar del 2 % de la venta de solo tiquetes. */
export const ROLES_AUTORIZAN_SOLO_TIQUETES: readonly string[] = ["superadmin"];

export type Modalidad = "pvp" | "neto";

export type ServicioNeto = {
  id?: number | null;
  /** Orden dentro de la cotización (el reparto usa (orden, id)). */
  orden: number;
  /** aereo / hotel / traslado / asistencia / otro. */
  tipo: string;
  /** PVP de la fila (moneda de la cotización). */
  valor: number;
  costoNeto: number;
};

export type EntradaNeto = {
  servicios: ServicioNeto[];
  /** `cotizaciones.precio_venta` de la hija. */
  precioVenta: number;
  recobro: number;
  ninos: number;
  tarifaNino: number;
  /** Participación del aliado en el recobro tal como la declaró la cotización. */
  recobroAliado: number;
  reconoceRecobro: boolean;
  /** Fracción de comisión del aliado (0.12 = 12 %); 4 decimales como la columna. */
  pct: number;
};

export type FilaNeto = { orden: number; servicioId: number | null; tipo: string; pvp: bigint; descuento: bigint; neto: bigint };

export type ResultadoNeto = {
  precio: bigint;
  tiquetes: bigint;
  recobro: bigint;
  ninos: bigint;
  recAli: bigint;
  base: bigint;
  ordinaria: bigint;
  participacion: bigint;
  descuento: bigint;
  neto: bigint;
  costos: bigint;
  soloTiquetes: boolean;
  filas: FilaNeto[];
};

/** Dinero (número con ≤ 2 decimales) → centavos enteros. */
export function aCentavos(x: number | null | undefined): bigint {
  const n = Number(x);
  return Number.isFinite(n) ? BigInt(Math.round(n * 100)) : B0;
}
/** Centavos → unidades de moneda (para mostrar o comparar con `numeric(15,2)`). */
export function aUnidades(c: bigint): number {
  return Number(c) / 100;
}

const max0 = (v: bigint) => (v < B0 ? B0 : v);

/** Reparto exacto en centavos: mayor resto; el sobrante a la menor posición. Pesos ≤ 0 no reciben. */
export function repartir(total: bigint, pesos: bigint[]): bigint[] {
  const n = pesos.length;
  if (n === 0) return [];
  if (total <= B0) return pesos.map(() => B0);
  const p = pesos.map(max0);
  const suma = p.reduce((a, b) => a + b, B0);
  if (suma === B0) return pesos.map(() => B0);
  const out: bigint[] = [];
  const resto: bigint[] = [];
  let asignado = B0;
  for (let i = 0; i < n; i++) {
    const v = total * p[i];
    const base = v / suma;
    out.push(base);
    resto.push(v - base * suma);
    asignado += base;
  }
  let falta = total - asignado;
  const usado = new Set<number>();
  while (falta > B0) {
    let mejor = -1;
    for (let j = 0; j < n; j++) {
      if (p[j] > B0 && !usado.has(j) && (mejor === -1 || resto[j] > resto[mejor])) mejor = j;
    }
    if (mejor === -1) break;
    out[mejor] += B1;
    usado.add(mejor);
    falta -= B1;
  }
  return out;
}

/**
 * Comisión ordinaria: round(base × pct) a la unidad de moneda, en centavos (mitad hacia arriba).
 * Todo en enteros: el único flotante es `pct` (4 decimales), que se pasa a puntos base con Math.round
 * (exacto para los 10 001 valores posibles); el producto base × bp y el redondeo son BigInt, como el
 * `round(numeric)` de SQL. Nunca se redondea un producto en coma flotante.
 */
export function comisionOrdinaria(baseCent: bigint, pct: number): bigint {
  const bp = BigInt(Math.round(pct * 10000)); // pct con 4 decimales, igual que numeric(5,4)
  const den = BigInt(1000000); // 100 (centavos) × 10 000 (bp)
  const unidades = (baseCent * bp + den / BigInt(2)) / den;
  return unidades * BigInt(100);
}

export function calcularNetoHija(e: EntradaNeto): ResultadoNeto {
  const precio = aCentavos(e.precioVenta);
  const recobro = aCentavos(Math.max(Number(e.recobro) || 0, 0));
  const ninos = aCentavos(Math.max(Math.floor(Number(e.ninos) || 0), 0) * Math.max(Number(e.tarifaNino) || 0, 0));
  const recAliPedido = aCentavos(Math.max(Number(e.recobroAliado) || 0, 0));
  const recAli = recAliPedido < recobro ? recAliPedido : recobro;
  const costos = (e.servicios ?? []).reduce((s, x) => s + aCentavos(x.costoNeto), B0);

  // Filas con valor > 0 en el orden de p39_priv.componentes_manual: (orden, id).
  const filasBase = [...(e.servicios ?? [])]
    .filter((s) => Number(s.valor) > 0)
    .sort((a, b) => a.orden - b.orden || (a.id ?? 0) - (b.id ?? 0));
  let tiquetes = B0;
  let nTick = 0;
  for (const s of filasBase) {
    if (s.tipo === "aereo") { tiquetes += aCentavos(s.valor); nTick++; }
  }

  const pesos: bigint[] = [];
  const pos: number[] = []; // índice de fila (≥ 0), -1 = niños, -2 = recobro
  filasBase.forEach((s, i) => {
    if (s.tipo !== "aereo") { pesos.push(aCentavos(s.valor)); pos.push(i); }
  });
  if (ninos > B0) { pesos.push(ninos); pos.push(-1); }
  if (!e.reconoceRecobro && recobro > B0) { pesos.push(recobro); pos.push(-2); }
  const sumaPesos = pesos.reduce((a, b) => a + b, B0);

  const base = max0(precio - tiquetes - (e.reconoceRecobro ? recobro : B0));
  const ordinaria = sumaPesos > B0 && e.pct > 0 ? comisionOrdinaria(base, e.pct) : B0;
  const participacion = e.reconoceRecobro ? recAli : B0;
  const descuento = ordinaria + participacion;
  const neto = precio - descuento;

  const partes = repartir(ordinaria, pesos);
  const desc = filasBase.map(() => B0);
  pos.forEach((p, k) => { if (p >= 0) desc[p] = partes[k]; });
  const filas: FilaNeto[] = filasBase.map((s, i) => {
    const pvp = aCentavos(s.valor);
    return { orden: i, servicioId: s.id ?? null, tipo: s.tipo, pvp, descuento: desc[i], neto: pvp - desc[i] };
  });

  return {
    precio, tiquetes, recobro, ninos, recAli, base, ordinaria, participacion, descuento, neto, costos,
    soloTiquetes: filasBase.length > 0 && nTick === filasBase.length, filas,
  };
}

export type EvaluacionNeto = {
  pisoBps: number;
  costoCero: boolean;
  bajoCosto: boolean;
  cumple: boolean;
  /** (NETO − costos) / NETO, 6 decimales (como SQL). */
  margen: number;
};

/**
 * Espejo de `p50_priv.evaluar_margen`. 6 %: (NETO + 0,5) × 0,94 ≥ costos.
 * Solo tiquetes: NETO × 0,98 ≥ costos, EXACTO (sin tolerancia).
 */
export function evaluarMargenNeto(netoCent: bigint, costosCent: bigint, soloTiquetes: boolean): EvaluacionNeto {
  const pisoBps = soloTiquetes ? MARGEN_BPS_SOLO_TIQUETES : MARGEN_BPS_NETO;
  const costoCero = costosCent <= B0;
  const bajoCosto = costosCent > B0 && netoCent < costosCent;
  let cumple = false;
  if (!costoCero) {
    cumple = soloTiquetes
      ? netoCent * BigInt(9800) >= costosCent * BigInt(10000)
      : (netoCent + TOLERANCIA_CENTAVOS) * BigInt(9400) >= costosCent * BigInt(10000);
  }
  const margen = netoCent > B0 ? Math.round((Number(netoCent - costosCent) / Number(netoCent)) * 1e6) / 1e6 : 0;
  return { pisoBps, costoCero, bajoCosto, cumple, margen };
}

/** El 6 % también se puede medir con la función de #30 (aviso previo del formulario). */
export function evaluarMargenNetoConContrato(netoUnidades: number, costosUnidades: number) {
  return evaluarMargenContrato({ modo: "neto", ingreso: netoUnidades, costos: costosUnidades });
}

/** Porcentaje con coma decimal (6,78 %): para mensajes e interfaz. */
export function pctTexto(fraccion: number): string {
  return `${(fraccion * 100).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

export function puedeFijarNeto(rol: string | null | undefined): boolean {
  return !!rol && ROLES_FIJAN_NETO.includes(rol);
}
/** Espejo de `p50_priv.rol_autoriza_margen`. */
export function puedeAutorizarMargen(rol: string | null | undefined, soloTiquetes: boolean): boolean {
  const roles = soloTiquetes ? ROLES_AUTORIZAN_SOLO_TIQUETES : ROLES_EXCEPCION_MARGEN;
  return !!rol && roles.includes(rol);
}

export type DecisionNeto =
  | { ok: true; autorizado: boolean }
  | { ok: false; codigo: "SIN_DESCUENTO" | "COSTO_CERO" | "BAJO_COSTO" | "MARGEN_BAJO" | "ROL_NO_AUTORIZA"; mensaje: string };

/** Mismas decisiones y mismo orden que `p50_priv.sellar_hija` (después de resolver aliado y rol). */
export function decidirNeto(
  r: ResultadoNeto,
  ctx: { rol: string | null | undefined; autorizarMargen: boolean },
): DecisionNeto {
  if (r.descuento <= B0) {
    return { ok: false, codigo: "SIN_DESCUENTO", mensaje: "Con descuento 0 no hay precio NETO; esta venta se hace a PVP." };
  }
  const ev = evaluarMargenNeto(r.neto, r.costos, r.soloTiquetes);
  if (ev.costoCero) {
    return { ok: false, codigo: "COSTO_CERO", mensaje: "El costo total de la cotización es 0; no se puede fijar un precio NETO." };
  }
  if (ev.bajoCosto) {
    return { ok: false, codigo: "BAJO_COSTO", mensaje: "El total NETO queda por debajo del costo total; no se autoriza para ningún rol." };
  }
  if (!ev.cumple) {
    const quien = r.soloTiquetes ? "superadmin" : "superadmin o administración";
    if (!ctx.autorizarMargen) {
      return { ok: false, codigo: "MARGEN_BAJO", mensaje: `El margen (${pctTexto(ev.margen)}) no cubre el mínimo del ${ev.pisoBps / 100} %. Requiere autorización de ${quien}.` };
    }
    if (!puedeAutorizarMargen(ctx.rol, r.soloTiquetes)) {
      return { ok: false, codigo: "ROL_NO_AUTORIZA", mensaje: `Tu rol no puede autorizar un margen por debajo del mínimo; lo autoriza ${quien}.` };
    }
    return { ok: true, autorizado: true };
  }
  return { ok: true, autorizado: false };
}

// ── Entrada de las acciones de servidor (llega como `unknown` desde el navegador) ──
export type EntradaModalidad = { modalidad: Modalidad; reconoceRecobro: boolean | null; autorizarMargen: boolean };

/**
 * Lee los campos de modalidad de la entrada de una acción. `null` = la entrada no trae
 * modalidad (se conserva el comportamiento de siempre); un valor mal formado es un error.
 * No decide permisos: eso lo hace la base con el rol real de la sesión.
 */
export function leerEntradaModalidad(raw: unknown): { ok: true; datos: EntradaModalidad | null } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: true, datos: null };
  const r = raw as Record<string, unknown>;
  if (r.modalidad === undefined || r.modalidad === null) return { ok: true, datos: null };
  if (r.modalidad !== "pvp" && r.modalidad !== "neto") return { ok: false, error: "La modalidad debe ser PVP o NETO." };
  let reconoce: boolean | null = null;
  if (r.modalidad === "neto") {
    if (typeof r.reconoceRecobro !== "boolean") return { ok: false, error: "Indica si se reconoce la participación del aliado en el recobro." };
    reconoce = r.reconoceRecobro;
  }
  return { ok: true, datos: { modalidad: r.modalidad, reconoceRecobro: reconoce, autorizarMargen: r.autorizarMargen === true } };
}

/** Mensajes de la base que merecen mostrarse tal cual (ya vienen en español claro). */
export function mensajeNeto(raw: string | null | undefined): string | null {
  const t = String(raw ?? "");
  const m = /(?:^|\n|: )(NETO: [^\n]+)/.exec(t);
  return m ? m[1].trim() : null;
}

// ── Interfaz: ¿qué impide elegir esta opción en NETO? ─────────────────────
export type VistaNetoBasica = {
  hayDescuento: boolean;
  costoCero: boolean;
  bajoCosto: boolean;
  cumple: boolean;
  soloTiquetes: boolean;
  /** Fracción (0,0678 = 6,78 %). */
  margen: number;
  pisoPct: number;
};

/**
 * Motivo que bloquea el botón, o null si se puede enviar. Mismo orden de decisiones que
 * `decidirNeto`/`p50_priv.sellar_hija`; la base vuelve a decidir con el rol real.
 */
export function bloqueoNeto(
  v: VistaNetoBasica,
  rol: { puedeAutorizar6: boolean; puedeAutorizar2: boolean },
  autorizar: boolean,
): string | null {
  if (!v.hayDescuento) return "Con descuento 0 no hay precio NETO; esta venta se hace a PVP.";
  if (v.costoCero) return "El costo total es 0: no se puede fijar un precio NETO.";
  if (v.bajoCosto) return "El total NETO queda por debajo del costo total; no se autoriza para ningún rol.";
  if (!v.cumple) {
    const puede = v.soloTiquetes ? rol.puedeAutorizar2 : rol.puedeAutorizar6;
    const quien = v.soloTiquetes ? "superadmin" : "superadmin o administración";
    const margen = pctTexto(v.margen);
    if (!puede) return `El margen (${margen}) no cubre el mínimo del ${v.pisoPct} %; lo autoriza ${quien}.`;
    if (!autorizar) return `El margen (${margen}) no cubre el mínimo del ${v.pisoPct} %: marca la autorización para continuar.`;
  }
  return null;
}
