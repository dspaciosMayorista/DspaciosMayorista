// #14-A — Recobro desde el carrito del Tarifario: reglas PURAS (sin I/O). NO inventa fórmulas: reutiliza `acuerdoComision`/`participacionAliado` (#97) y `repartir` (#50,
// «mayor resto; el sobrante a la menor posición»). Aquí solo se compone lo que el carrito añade respecto de la cotización dinámica:
//
//   1. RECOBRO: va DENTRO de la tarifa de ADULTO (invisible en los documentos del cliente). Con varios hoteles se reparte POR IGUAL entre TODOS los adultos del carrito
//      (decisión del dueño); el centavo que sobra de la división se asigna de forma determinista al adulto de menor posición (primer adulto del primer hotel) con el mismo
//      `repartir`, así los contratos reciben EXACTAMENTE el recobro (nunca queda dinero sin asignar).
//   2. PARTICIPACIÓN del aliado: se reparte entre los contratos con el mismo `repartir`, en unidades de moneda enteras (como #97: la participación es un importe entero).
//   3. ACUERDO por contrato: `acuerdoComision` con total = PVP del contrato (incluye su parte de recobro). La condición «el recobro sale de la base» se evalúa por contrato, sobre su
//      participación final (> 0), igual que en #97.
//   4. NETO por persona: la comisión ORDINARIA se reparte entre adultos y niños con `repartir` según el peso de cada tarifa (la del adulto SIN recobro cuando éste sale de la base;
//      CON recobro cuando se queda en ella); la PARTICIPACIÓN se descuenta de los adultos que llevan el recobro, en proporción a su parte. La suma de las tarifas NETO es EXACTAMENTE
//      el total exigible (`PVP − (ordinaria + participación)`).
//   5. Liquidación honesta del recobro: lo que la empresa conserva NETO es `recobro − (comisión total − comisión que habría sin recobro)`. Sin participación el recobro entra a la base y
//      el aliado cobra el % sobre él (p. ej. 10 % de 100.000 = 10.000 más): la empresa NO conserva íntegros los 100.000.
//
// Todo el dinero interno en CENTAVOS ENTEROS (BigInt), como `netoHija.ts`.
import { acuerdoComision, participacionAliado, type ParticipacionRecobro } from "./acuerdoComision.ts";
import { aCentavos, repartir } from "./netoHija.ts";

const B0 = BigInt(0);
const aPesos = (c: bigint): number => Number(c) / 100;

export type ResultadoRecobro<T> = { ok: true; valor: T } | { ok: false; error: string };

/** El % de participación del aliado directo sale del parámetro `recobro_pct_aliado_b2b`; ausente o fuera de [0, 1] ⇒ error (no hay constante de respaldo). */
export function pctParticipacionDeParametro(valor: unknown): ResultadoRecobro<number> {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() !== "" ? Number(valor) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return { ok: false, error: "La distribución del recobro con el aliado no está configurada correctamente (parámetro recobro_pct_aliado_b2b). Contacta a administración." };
  }
  return { ok: true, valor: n };
}

/** Recobro del formulario: finito, ≥ 0 y con a lo sumo 2 decimales (como cualquier importe). El navegador nunca es autoridad: se valida de nuevo en el servidor. */
export function validarRecobro(crudo: unknown): ResultadoRecobro<number> {
  if (crudo === null || crudo === undefined || (typeof crudo === "string" && crudo.trim() === "")) return { ok: true, valor: 0 };
  const n = typeof crudo === "number" ? crudo : Number(String(crudo).trim());
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "El recobro debe ser un número mayor o igual a 0." };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: "El recobro admite como máximo dos decimales." };
  return { ok: true, valor: Math.round(n * 100) / 100 };
}

export type UnidadRecobro = { ref: string; adultos: number };
export type RepartoRecobro = { porAdulto: bigint[]; porUnidad: Record<string, bigint>; total: bigint };

/**
 * Reparte el recobro POR IGUAL entre todos los adultos del carrito (en el orden de las unidades). `repartir` con pesos iguales: el cociente entero para todos y el sobrante de a un
 * centavo por posición, empezando por la MENOR (primer adulto del primer hotel). Σ porAdulto = recobro, siempre.
 */
export function repartirRecobroEntreAdultos(recobro: number, unidades: readonly UnidadRecobro[]): ResultadoRecobro<RepartoRecobro> {
  const total = aCentavos(recobro);
  const n = unidades.reduce((s, u) => s + Math.max(Math.trunc(u.adultos), 0), 0);
  if (total === B0) return { ok: true, valor: { porAdulto: Array.from({ length: n }, () => B0), porUnidad: Object.fromEntries(unidades.map((u) => [u.ref, B0])), total } };
  if (n < 1) return { ok: false, error: "El recobro se carga a la tarifa de adulto: el carrito necesita al menos un adulto." };
  const porAdulto = repartir(total, Array.from({ length: n }, () => BigInt(1)));
  const porUnidad: Record<string, bigint> = {};
  let i = 0;
  for (const u of unidades) {
    let s = B0;
    for (let k = 0; k < Math.max(Math.trunc(u.adultos), 0); k++) s += porAdulto[i++];
    porUnidad[u.ref] = (porUnidad[u.ref] ?? B0) + s;
  }
  return { ok: true, valor: { porAdulto, porUnidad, total } };
}

export type EntradaContrato = {
  clave: string;
  /** PVP del contrato SIN recobro (centavos). */
  pvpCent: bigint;
  /** Base no comisionable del contrato (centavos). */
  bncCent: bigint;
  /** Parte del recobro que cae en este contrato (centavos), de `repartirRecobroEntreAdultos`. */
  recobroCent: bigint;
};

export type AcuerdoContrato = {
  clave: string;
  /** PVP con recobro: lo que paga el cliente en PVP. */
  totalCent: bigint;
  recobroCent: bigint;
  /** Participación del aliado (unidades enteras de moneda, en centavos). */
  participacionCent: bigint;
  baseCent: bigint;
  ordinariaCent: bigint;
  totalAliadoCent: bigint;
  /** El recobro salió de la base (participación > 0 en ESTE contrato). */
  excluyeRecobro: boolean;
  /** NETO: lo que paga el cliente = PVP con recobro − (ordinaria + participación). */
  exigibleNetoCent: bigint;
  /** Lo que la empresa conserva del recobro DESPUÉS de lo que éste le cuesta en comisión (ver cabecera, punto 5). */
  recobroNetoEmpresaCent: bigint;
  /** Comisión que habría SIN recobro (sobre PVP − BNC): referencia para explicar la liquidación. */
  comisionSinRecobroCent: bigint;
};

/**
 * Acuerdo por contrato. `participacion` es la del carrito completo (valor o %), ya validada contra el recobro total; se reparte entre los contratos en unidades enteras de moneda con el
 * mismo `repartir` (peso = su parte del recobro): Σ participaciones = participación total, exacta. `pct` es la fracción de comisión del aliado (ya resuelta en servidor).
 */
export function acuerdosPorContrato(args: {
  contratos: readonly EntradaContrato[];
  recobroTotal: number;
  participacion: ParticipacionRecobro | null;
  pct: number;
}): ResultadoRecobro<AcuerdoContrato[]> {
  const { contratos, recobroTotal, pct } = args;
  if (!(pct >= 0 && pct <= 1) || !Number.isFinite(pct)) return { ok: false, error: "El porcentaje de comisión del aliado no es válido." };
  const recobroCents = contratos.reduce((s, c) => s + c.recobroCent, B0);
  if (recobroCents !== aCentavos(recobroTotal)) return { ok: false, error: "El recobro repartido no suma el recobro total." };
  const partTotal = args.participacion ? participacionAliado(recobroTotal, args.participacion) : 0; // acotada a [0, recobro]
  const partTotalCent = aCentavos(partTotal);
  // Normalmente es un importe ENTERO de moneda (#97) y se reparte en unidades enteras. Si el tope [0, recobro] la dejó en el recobro completo y éste trae centavos, la participación ES el
  // recobro: se reparte en centavos con los mismos pesos (cada contrato recibe exactamente su parte del recobro).
  const pesosRecobro = contratos.map((c) => c.recobroCent);
  let partPorContrato = repartir(partTotalCent, pesosRecobro);
  if (partTotalCent % BigInt(100) === B0) {
    const enteras = repartir(partTotalCent / BigInt(100), pesosRecobro).map((x) => x * BigInt(100));
    // Importe entero por contrato SOLO si ninguno supera su propio recobro (un contrato con poco recobro no puede recibir un peso entero de más: el acuerdo lo recortaría y el dinero
    // quedaría sin asignar); si alguno lo superaría, se reparte en centavos (nunca excede la parte del recobro de cada contrato, porque la participación total ≤ recobro total).
    if (enteras.every((x, i) => x <= contratos[i].recobroCent)) partPorContrato = enteras;
  }
  if (partPorContrato.reduce((s, x) => s + x, B0) !== partTotalCent) return { ok: false, error: "La participación repartida no suma la participación total." };

  const out: AcuerdoContrato[] = contratos.map((c, i) => {
    const totalCent = c.pvpCent + c.recobroCent;
    const participacion = aPesos(partPorContrato[i]);
    const a = acuerdoComision({ total: aPesos(totalCent), bnc: aPesos(c.bncCent), recobroTotal: aPesos(c.recobroCent), participacion, pct });
    const sin = acuerdoComision({ total: aPesos(c.pvpCent), bnc: aPesos(c.bncCent), recobroTotal: 0, participacion: 0, pct });
    const ordinariaCent = aCentavos(a.ordinaria), partCent = aCentavos(a.participacion), totalAliadoCent = ordinariaCent + partCent;
    const sinCent = aCentavos(sin.ordinaria);
    return {
      clave: c.clave, totalCent, recobroCent: c.recobroCent, participacionCent: partCent, baseCent: aCentavos(a.base), ordinariaCent, totalAliadoCent,
      excluyeRecobro: a.excluyeRecobro, exigibleNetoCent: totalCent - totalAliadoCent, recobroNetoEmpresaCent: c.recobroCent - (totalAliadoCent - sinCent), comisionSinRecobroCent: sinCent,
    };
  });
  return { ok: true, valor: out };
}

export type PersonaNeto = {
  tipo: "adulto" | "nino" | "nino2" | "infante";
  /** Tarifa PVP de la persona SIN recobro (centavos). */
  pvpCent: bigint;
  /** Recobro que lleva esta persona en su tarifa (solo adultos; centavos). */
  recobroCent: bigint;
  /** Peso para repartir la comisión ordinaria: normalmente `pvpCent − su parte del BNC`. Si falta, `pvpCent`. */
  pesoCent?: bigint;
};

export type TarifaNetoPersona = { indice: number; tipo: PersonaNeto["tipo"]; pvpConRecobroCent: bigint; descuentoOrdinariaCent: bigint; descuentoParticipacionCent: bigint; netoCent: bigint };

/**
 * Tarifas NETO por persona de UN contrato. La ordinaria se reparte entre TODAS las personas (adultos y niños) con `repartir`; si el recobro se quedó en la base (participación 0) cada
 * adulto pesa CON su recobro, si salió de la base pesa SIN él. La participación se descuenta de los adultos que llevan el recobro, en proporción a su parte. Σ neto = exigible, exacto.
 */
export function tarifasNetoPorPersona(args: {
  personas: readonly PersonaNeto[];
  ordinariaCent: bigint;
  participacionCent: bigint;
  excluyeRecobro: boolean;
}): ResultadoRecobro<TarifaNetoPersona[]> {
  const { personas, ordinariaCent, participacionCent, excluyeRecobro } = args;
  const pesos = personas.map((p) => (p.pesoCent ?? p.pvpCent) + (excluyeRecobro ? B0 : p.recobroCent));
  if (ordinariaCent > B0 && pesos.every((w) => w <= B0)) return { ok: false, error: "No hay tarifas sobre las que repartir la comisión." };
  const ord = repartir(ordinariaCent, pesos);
  const pesosPart = personas.map((p) => (p.tipo === "adulto" ? p.recobroCent : B0));
  if (participacionCent > B0 && pesosPart.every((w) => w <= B0)) return { ok: false, error: "La participación del recobro necesita adultos que lleven el recobro." };
  const par = repartir(participacionCent, pesosPart);
  return {
    ok: true,
    valor: personas.map((p, i) => {
      const conRecobro = p.pvpCent + p.recobroCent;
      return { indice: i, tipo: p.tipo, pvpConRecobroCent: conRecobro, descuentoOrdinariaCent: ord[i], descuentoParticipacionCent: par[i], netoCent: conRecobro - ord[i] - par[i] };
    }),
  };
}

// ── Entrada del formulario y decisión en servidor ───────────────────────────────────────────────────────────────────────────────────────────────────

export type EntradaRecobro = { total: number; participacion: ParticipacionRecobro | null; participacionEnviada: boolean };

/** Lee `recobro` del cuerpo de la solicitud. Ausente ⇒ sin recobro. Cualquier forma extraña se RECHAZA (nunca se interpreta como 0 en silencio). */
export function leerRecobroEntrada(raw: unknown): ResultadoRecobro<EntradaRecobro> {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  const r = o?.recobro;
  if (r === undefined || r === null) return { ok: true, valor: { total: 0, participacion: null, participacionEnviada: false } };
  if (typeof r !== "object" || Array.isArray(r)) return { ok: false, error: "El recobro enviado no es válido." };
  const x = r as Record<string, unknown>;
  const t = validarRecobro(x.total);
  if (!t.ok) return t;
  const p = x.participacion;
  if (p === undefined || p === null) return { ok: true, valor: { total: t.valor, participacion: null, participacionEnviada: false } };
  if (typeof p !== "object" || Array.isArray(p)) return { ok: false, error: "La distribución del recobro enviada no es válida." };
  const q = p as Record<string, unknown>;
  if (q.modo === "valor") {
    const v = typeof q.valor === "number" ? q.valor : Number(String(q.valor ?? "").trim());
    if (!Number.isFinite(v) || v < 0) return { ok: false, error: "El valor de la distribución del recobro debe ser un número mayor o igual a 0." };
    return { ok: true, valor: { total: t.valor, participacion: { modo: "valor", valor: v }, participacionEnviada: true } };
  }
  if (q.modo === "pct") {
    const v = typeof q.pct === "number" ? q.pct : Number(String(q.pct ?? "").trim());
    if (!Number.isFinite(v) || v < 0 || v > 1) return { ok: false, error: "El porcentaje de distribución del recobro debe estar entre 0 y 100 %." };
    return { ok: true, valor: { total: t.valor, participacion: { modo: "pct", pct: v }, participacionEnviada: true } };
  }
  return { ok: false, error: "La distribución del recobro enviada no es válida." };
}

/** Quién captura, resuelto por el SERVIDOR (nunca del navegador): venta asistida a un aliado, cotización interna a cliente final, aliado directo con su plan, u otro (sin permiso). */
export type CapturaRecobro = "asistida" | "interno_cliente_final" | "aliado_directo" | "sin_permiso";

export type RecobroDecidido = { total: number; participacion: number; pct_participacion: number | null; origen_participacion: "formulario" | "parametro" };

/**
 * Autoriza y resuelve el recobro:
 *  · sin recobro (total 0) ⇒ nada (una distribución enviada sin recobro se ignora);
 *  · venta asistida: la distribución la fija el personal (valor o %), 0 si no la envía (el recobro se queda en la base);
 *  · interno a cliente final: el recobro es 100 % empresa; una distribución > 0 se RECHAZA;
 *  · aliado directo: la distribución sale SOLO del parámetro (\`pctParametro\`, leído y validado en servidor); cualquier distribución enviada por el aliado se RECHAZA;
 *  · cualquier otro (visitante, B2C con sesión, rol sin permiso, aliado sin ficha vinculada) ⇒ error.
 */
export function decidirRecobro(args: { entrada: EntradaRecobro; captura: CapturaRecobro; pctParametro?: ResultadoRecobro<number> | null }): ResultadoRecobro<RecobroDecidido | null> {
  const { entrada, captura } = args;
  if (!(entrada.total > 0)) return { ok: true, valor: null };
  if (captura === "sin_permiso") return { ok: false, error: "El recobro solo lo puede capturar el personal autorizado o un aliado con su ficha vinculada." };
  if (captura === "interno_cliente_final") {
    if (entrada.participacionEnviada && participacionAliado(entrada.total, entrada.participacion!) > 0) return { ok: false, error: "Sin aliado, el recobro es de la empresa: no se distribuye." };
    return { ok: true, valor: { total: entrada.total, participacion: 0, pct_participacion: null, origen_participacion: "formulario" } };
  }
  if (captura === "aliado_directo") {
    if (entrada.participacionEnviada) return { ok: false, error: "La distribución del recobro con el aliado la define la configuración del sistema; no se puede enviar desde el formulario." };
    const pct = args.pctParametro;
    if (!pct) return { ok: false, error: "La distribución del recobro con el aliado no está configurada correctamente (parámetro recobro_pct_aliado_b2b). Contacta a administración." };
    if (!pct.ok) return pct;
    return { ok: true, valor: { total: entrada.total, participacion: participacionAliado(entrada.total, { modo: "pct", pct: pct.valor }), pct_participacion: pct.valor, origen_participacion: "parametro" } };
  }
  // asistida
  const p = entrada.participacion;
  const importe = p ? participacionAliado(entrada.total, p) : 0;
  return { ok: true, valor: { total: entrada.total, participacion: importe, pct_participacion: p?.modo === "pct" ? p.pct : importe > 0 ? importe / entrada.total : 0, origen_participacion: "formulario" } };
}

export type FilaAdulto = { adultos: number; tarifa_adulto: number; [k: string]: unknown };

/**
 * Suma el recobro de CADA adulto (centavos, en el orden de los adultos de la unidad) a las filas de adulto del documento. Las filas de adultos con el mismo recobro se conservan; si dentro de
 * una fila los adultos llevan centavos distintos se parte en filas contiguas (la suma de cada fila y del documento es EXACTA). El documento nunca nombra el recobro.
 */
export function aplicarRecobroAFilasAdulto<T extends FilaAdulto>(filas: readonly T[], porAdultoCent: readonly bigint[]): ResultadoRecobro<T[]> {
  const n = filas.reduce((s, f) => s + Math.max(Math.trunc(f.adultos), 0), 0);
  if (n !== porAdultoCent.length) return { ok: false, error: "El recobro por adulto no coincide con los adultos de la cotización." };
  const out: T[] = [];
  let i = 0;
  for (const f of filas) {
    const k = Math.max(Math.trunc(f.adultos), 0);
    if (k === 0) { out.push(f); continue; }
    const tramo = porAdultoCent.slice(i, i + k); i += k;
    let ini = 0;
    while (ini < k) {
      let fin = ini + 1;
      while (fin < k && tramo[fin] === tramo[ini]) fin++;
      out.push({ ...f, adultos: fin - ini, tarifa_adulto: Math.round((aCentavos(f.tarifa_adulto) + tramo[ini] > B0 ? Number(aCentavos(f.tarifa_adulto) + tramo[ini]) : 0)) / 100 });
      ini = fin;
    }
  }
  return { ok: true, valor: out };
}

// ── Conversión: recobro de cada unidad ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Recobro por adulto DENTRO de una unidad: el de la unidad repartido por igual (el centavo sobrante al primer adulto). Coincide con el reparto global del carrito (los adultos con +1 centavo son un prefijo). */
export function recobroPorAdultoDeUnidad(recobroUnidadCent: bigint, adultos: number): bigint[] {
  const n = Math.max(Math.trunc(adultos), 0);
  if (n === 0) return [];
  return repartir(recobroUnidadCent, Array.from({ length: n }, () => BigInt(1)));
}

export type LineaRecobro = { clave: string; recobro: number };

/**
 * Lee `payload.recobroCliente` (recobro de una cotización INTERNA a cliente final, sin aliado). Ausente ⇒ sin recobro. Presente pero malformado, con un plan B2B a la vez, con líneas que no sean
 * hoteles de la cotización o que no sumen el total ⇒ error: nunca se convierte «como si no hubiera recobro» ni se inventa un reparto.
 */
export function leerRecobroClienteDePayload(payload: unknown, clavesHoteles: readonly string[], hayPlanB2B: boolean): ResultadoRecobro<{ total: number; lineas: LineaRecobro[] } | null> {
  const o = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  const r = o?.recobroCliente;
  if (r === undefined || r === null) return { ok: true, valor: null };
  const malo = { ok: false as const, error: "El recobro guardado en la cotización está incompleto o no es consistente; no se puede convertir. Genera una cotización nueva desde el tarifario." };
  if (hayPlanB2B || typeof r !== "object" || Array.isArray(r)) return malo;
  const x = r as Record<string, unknown>;
  if (typeof x.total !== "number" || !Number.isFinite(x.total) || x.total <= 0 || !Array.isArray(x.lineas) || !x.lineas.length) return malo;
  const lineas: LineaRecobro[] = [];
  const vistas = new Set<string>();
  for (const l of x.lineas) {
    const y = typeof l === "object" && l !== null ? (l as Record<string, unknown>) : null;
    if (!y || typeof y.clave !== "string" || !clavesHoteles.includes(y.clave) || vistas.has(y.clave) || typeof y.recobro !== "number" || !Number.isFinite(y.recobro) || y.recobro < 0) return malo;
    vistas.add(y.clave); lineas.push({ clave: y.clave, recobro: y.recobro });
  }
  if (lineas.reduce((s, l) => s + aCentavos(l.recobro), B0) !== aCentavos(x.total)) return malo;
  return { ok: true, valor: { total: x.total, lineas } };
}
