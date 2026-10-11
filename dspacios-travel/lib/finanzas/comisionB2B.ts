// Comisiones B2B (aliados_b2b) — reglas PURAS compartidas por Comisiones, la
// pestaña del contrato, Rentabilidad y la cuenta de cobro (#38). Sin base de
// datos: todo se prueba en pruebas/comisionB2BReglas.test.ts.
//
// Espejo de la migración 205: `calcularComisionFila` = comision_b2b_total(),
// `esComisionDescontada` = comision_b2b_descontada(). Si cambias una, cambia
// la otra — los triggers de la base son la última barrera.
import { calcComisionB2B, type ComisionB2B } from "@/lib/calc/finanzas";
import { estadoComisionB2B } from "@/lib/finanzas/pagosComisionB2B";

export type FilaComisionB2B = {
  id: number;
  numero_contrato: string;
  precio_venta: number | null;
  base_comision: number | null;
  base_explicita?: boolean | null;
  comision_valor?: number | null;
  pct_comision: number | null;
  recobro_total: number | null;
  pct_recobro_aliado: number | null;
  aplica_retencion: boolean | null;
  pct_retencion: number | null;
  estado?: string | null;
  descontada_en_precio?: boolean | null;
  aliado_id?: number | null;
  /** Texto del beneficiario (aliados_b2b.aliado). Solo RESTRINGE: nunca da acceso al contrato. */
  aliado?: string | null;
  tipo_aliado?: string | null;
  /** Documento del beneficiario (aliados_b2b.nit). Evidencia de pertenencia de una fila sin ficha. */
  nit?: string | null;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** Total de una fila tal como la guarda la base (misma lectura en todas las pantallas). */
export function calcularComisionFila(f: FilaComisionB2B): ComisionB2B {
  return calcComisionB2B({
    precioVenta: Number(f.precio_venta) || 0,
    baseComisionable: num(f.base_comision),
    baseExplicita: f.base_explicita === true,
    comisionValor: num(f.comision_valor),
    pctComision: Number(f.pct_comision) || 0,
    recobroTotal: Number(f.recobro_total) || 0,
    pctRecobroAliado: f.pct_recobro_aliado == null ? undefined : Number(f.pct_recobro_aliado),
    aplicaRetencion: f.aplica_retencion === true,
    pctRetencion: Number(f.pct_retencion) || 0,
  });
}

/**
 * La agencia ya descontó esta comisión del precio (reservar en modo neta).
 * Marca nueva (`descontada_en_precio`, 205) o firma legado de reservar:
 * `ventas.comision_estado = 'descontada'` + `aliados_b2b.estado = 'pagada'`.
 */
export function esComisionDescontada(
  f: Pick<FilaComisionB2B, "descontada_en_precio" | "estado">,
  comisionEstadoVenta: string | null | undefined,
): boolean {
  return f.descontada_en_precio === true || (f.estado === "pagada" && comisionEstadoVenta === "descontada");
}

export type EstadoComision = "pendiente" | "parcial" | "pagada" | "descontada" | "revision_neto";

/**
 * Fila B2B NO descontada en un contrato vendido NETO (decisión del dueño,
 * 2026-10-09): la comisión B2B del aliado ya se descontó del precio, así que
 * no corresponde una segunda comisión B2B ni abonos B2B nuevos a ella. Puede
 * existir (cargada antes, o a mano) y hasta tener abonos históricos: se
 * conserva tal cual para revisión manual. La comisión del asesor interno es
 * otra cosa (liquidación por `ventas`) y no pasa por aquí.
 */
export function esComisionEnContratoNeto(
  f: Pick<FilaComisionB2B, "descontada_en_precio" | "estado">,
  comisionEstadoVenta: string | null | undefined,
): boolean {
  return comisionEstadoVenta === "descontada" && !esComisionDescontada(f, comisionEstadoVenta);
}

/**
 * ¿Admite abonos B2B NUEVOS? Ni la descontada ni ninguna otra fila de un
 * contrato NETO. (Espejo de tg_comision_b2b_pagos_guardas en la 205.) Los
 * abonos ya registrados no se tocan.
 */
export function admiteAbonosB2B(
  f: Pick<FilaComisionB2B, "descontada_en_precio" | "estado">,
  comisionEstadoVenta: string | null | undefined,
): boolean {
  return comisionEstadoVenta !== "descontada" && !esComisionDescontada(f, comisionEstadoVenta);
}

/**
 * Estado que se muestra. Una comisión descontada SIN abonos no es un saldo por
 * pagar. Si tiene abonos (p. ej. el pago sintético que la migración 131 creó
 * para las NETO anteriores) se muestra exactamente como antes, por sus abonos:
 * no se reinterpretan. Una segunda fila B2B en un contrato NETO
 * (`enContratoNeto`) queda en "revision_neto": no es saldo por pagar ni
 * admite abonos; sus abonos históricos se siguen mostrando.
 */
export function estadoComisionFila(totalPagar: number, pagado: number, descontada: boolean, enContratoNeto = false): EstadoComision {
  if (descontada && !(pagado > 0)) return "descontada";
  if (enContratoNeto && !descontada) return "revision_neto";
  return estadoComisionB2B(totalPagar, pagado);
}

/** Saldo por pagar al aliado: 0 si está descontada en el precio o es una segunda fila B2B de un contrato NETO. */
export function saldoComisionFila(totalPagar: number, pagado: number, descontada: boolean, enContratoNeto = false): number {
  if (descontada || enContratoNeto) return 0;
  return Math.max(totalPagar - pagado, 0);
}

/**
 * Lo que la comisión le resta a la utilidad en Rentabilidad. Una descontada no
 * resta nada: `ventas.precio_venta` YA se guardó neto de esa comisión
 * (precio_venta = PVP − comisión), restarla otra vez la contaba dos veces.
 */
export function comisionParaRentabilidad(f: FilaComisionB2B, comisionEstadoVenta: string | null | undefined): number {
  if (esComisionDescontada(f, comisionEstadoVenta)) return 0;
  return calcularComisionFila(f).totalPagar;
}

// ── Edición ("De dónde sale la comisión") ─────────────────────────────────
export type EdicionComisionInput = {
  /** null = casilla vacía = sin base definida. */
  base: number | null;
  modo: "pct" | "valor";
  /** Fracción 0–1. null = casilla vacía. */
  pct: number | null;
  /** Pesos. null = casilla vacía. */
  valor: number | null;
  /** null = casilla vacía (sin recobro). */
  recobroTotal: number | null;
  /** Fracción 0–1. null = conservar el guardado. */
  pctRecobroAliado: number | null;
};

export type CambiosComision = {
  base_comision?: number | null;
  base_explicita?: boolean;
  pct_comision: number;
  comision_valor: number | null;
  recobro_total: number;
  pct_recobro_aliado?: number;
};

/** Fila legado cuya base se lee como "sin base" (0 o NULL → PVP). */
export function esBaseLegadoSinBase(f: Pick<FilaComisionB2B, "base_explicita" | "base_comision">): boolean {
  return f.base_explicita !== true && (f.base_comision == null || Number(f.base_comision) === 0);
}

/** Valor inicial de la casilla de base en el editor ("" = sin base). */
export function baseParaEditor(f: Pick<FilaComisionB2B, "base_explicita" | "base_comision">): string {
  if (esBaseLegadoSinBase(f) || f.base_comision == null) return "";
  return String(Number(f.base_comision));
}

const finito = (n: number | null) => n == null || Number.isFinite(n);

/**
 * Valida y arma el UPDATE. Reglas:
 *  · La base solo se toca si cambió. En una fila legado que se lee "sin base"
 *    (0/NULL), la casilla arranca vacía: dejarla vacía NO la cambia (el total
 *    sigue igual); escribir cualquier número, incluso 0, la vuelve explícita.
 *  · Base > PVP de la comisión se rechaza.
 *  · Por %: el % es obligatorio (0 es válido, vacío no). Borra el valor fijo.
 *  · Por valor: el valor es obligatorio (0 es válido) y se guarda al peso; el %
 *    queda solo informativo (redondeado a 4 decimales, lo que admite la
 *    columna) y no puede superar la base.
 */
export function prepararEdicionComision(
  f: FilaComisionB2B,
  e: EdicionComisionInput,
): { ok: true; cambios: CambiosComision } | { ok: false; error: string } {
  if (![e.base, e.pct, e.valor, e.recobroTotal, e.pctRecobroAliado].every(finito)) {
    return { ok: false, error: "Hay un valor que no es un número." };
  }
  const pvp = Number(f.precio_venta) || 0;
  if (e.base != null) {
    if (e.base < 0) return { ok: false, error: "La base comisionable debe ser un número ≥ 0." };
    if (e.base > pvp) return { ok: false, error: `La base comisionable no puede superar el PVP de la comisión (${pvp}).` };
  }
  if (e.recobroTotal != null && e.recobroTotal < 0) return { ok: false, error: "El recobro total debe ser un número ≥ 0." };
  if (e.pctRecobroAliado != null && (e.pctRecobroAliado < 0 || e.pctRecobroAliado > 1)) {
    return { ok: false, error: "El % del recobro para el aliado debe estar entre 0 y 100." };
  }

  const legadoSinBase = esBaseLegadoSinBase(f);
  const guardada = f.base_comision == null ? null : Number(f.base_comision);
  const baseCambia = legadoSinBase ? e.base != null : e.base !== guardada;

  const cambios: CambiosComision = {
    pct_comision: 0,
    comision_valor: null,
    recobro_total: e.recobroTotal ?? 0,
  };
  if (e.pctRecobroAliado != null) cambios.pct_recobro_aliado = e.pctRecobroAliado;
  if (baseCambia) {
    cambios.base_comision = e.base;
    cambios.base_explicita = true;
  }

  // Base con la que quedará leída la fila.
  const explicita = baseCambia ? true : f.base_explicita === true;
  const baseFinal = baseCambia ? e.base : guardada;
  const baseEfectiva = explicita ? (baseFinal ?? pvp) : (baseFinal || pvp);

  if (e.modo === "pct") {
    if (e.pct == null) return { ok: false, error: "Indica el % de comisión (escribe 0 si no hay comisión)." };
    if (e.pct < 0 || e.pct > 1) return { ok: false, error: "El % de comisión debe estar entre 0 y 100." };
    cambios.pct_comision = e.pct;
    cambios.comision_valor = null;
  } else {
    if (e.valor == null) return { ok: false, error: "Indica el valor de la comisión (escribe 0 si no hay comisión)." };
    if (e.valor < 0) return { ok: false, error: "El valor de la comisión debe ser ≥ 0." };
    if (e.valor > baseEfectiva) return { ok: false, error: "La comisión no puede superar la base comisionable." };
    cambios.comision_valor = e.valor;
    cambios.pct_comision = baseEfectiva > 0 ? Math.round((e.valor / baseEfectiva) * 10000) / 10000 : 0;
  }
  return { ok: true, cambios };
}

// ── Cuenta de cobro: qué comisiones alcanza cada quien ────────────────────
/**
 * Nombre de aliado comparable: sin tildes, minúsculas, espacios colapsados.
 * null si queda vacío (dos vacíos nunca empatan).
 */
export function normalizarNombreAliado(n: string | null | undefined): string | null {
  const x = (n ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  return x === "" ? null : x;
}

/**
 * Documento comparable: lo que va antes del guion (el dígito de verificación
 * del NIT no cuenta) y solo letras y dígitos, en mayúsculas. null si queda
 * vacío (dos vacíos nunca empatan).
 */
export function normalizarDocumento(d: string | null | undefined): string | null {
  const base = (d ?? "").split("-")[0];
  const x = base.replace(/[^0-9a-z]/gi, "").toUpperCase();
  return x === "" ? null : x;
}

/** Evidencia de que una fila SIN ficha (aliado_id null) es del usuario. */
export type EvidenciaSinFicha = {
  /** Documento de SU ficha del catálogo (aliados.nit, verificado al aprobarlo). */
  documento: string | null;
  /** Su nombre, SOLO si abrió el contrato por el respaldo legacy por nombre (193). */
  nombreLegacy: string | null;
};

/**
 * Filas que un usuario puede COBRAR de un contrato al que ya tiene acceso
 * (la decisión de acceso al contrato la toma accesoDocumentoContrato, igual
 * que siempre). Nunca se incluyen las descontadas en el precio.
 *  · Contrato vendido NETO (`ventas.comision_estado = 'descontada'`): NINGUNA,
 *    para nadie. La comisión del aliado ya se descontó del precio, y una
 *    segunda fila en ese contrato la pagaría dos veces — la misma regla con la
 *    que registrar_comision_b2b_manual (205) rechaza cualquier comisión nueva
 *    en un contrato NETO. Así el portal (que lo muestra "descontada") y la
 *    cuenta de cobro dicen lo mismo.
 *  · Interno: todas.
 *  · Aliado, fila por fila y con evidencia de PERTENENCIA (si no la hay, no se
 *    ofrece: falla cerrado; un interno la genera en su nombre):
 *      - enlazada (aliado_id): solo si es SU ficha. Nunca la de otro aliado.
 *      - sin ficha (aliado_id null): el texto libre del beneficiario
 *        (`aliado`) NO prueba nada —un homónimo escribe igual—, tampoco el
 *        nombre de su ficha ni el de `ventas`. Prueba pertenencia:
 *          · el documento de la fila (`nit`) igual al de SU ficha; o
 *          · solo si abrió el contrato por el respaldo legacy por nombre (193:
 *            bandera concedida explícitamente y solo en contratos sin NINGÚN
 *            id), el beneficiario igual a su nombre: es la misma evidencia que
 *            el dueño aceptó para todo ese contrato.
 */
export function filasCobrables<T extends FilaComisionB2B>(
  filas: T[],
  comisionEstadoVenta: string | null | undefined,
  usuario: { esInterno: boolean; aliadoId: number | null } & Partial<EvidenciaSinFicha>,
): T[] {
  if (comisionEstadoVenta === "descontada") return [];
  const vivas = filas.filter((f) => !esComisionDescontada(f, comisionEstadoVenta));
  if (usuario.esInterno) return vivas;
  const doc = normalizarDocumento(usuario.documento);
  const nombre = normalizarNombreAliado(usuario.nombreLegacy);
  return vivas.filter((f) => {
    if (f.aliado_id != null) return usuario.aliadoId != null && f.aliado_id === usuario.aliadoId;
    if (doc != null && normalizarDocumento(f.nit) === doc) return true;
    return nombre != null && normalizarNombreAliado(f.aliado) === nombre;
  });
}

/** Datos de `ventas` que intervienen en qué comisión ve un aliado. */
export type VentaComisionAliado = {
  aliado_id?: number | null;
  tipo_asesor?: string | null;
  agencia_nombre?: string | null;
  freelance_nombre?: string | null;
  modo_compra?: string | null;
  comision_b2b?: number | string | null;
  comision_estado?: string | null;
};

/**
 * La evidencia de `filasCobrables` para un aliado, a partir de lo que ya
 * resolvió la decisión de acceso. Misma regla en el portal y en la cuenta de
 * cobro.
 */
export function evidenciaSinFicha(a: {
  via: string | null | undefined;
  documentoFicha: string | null;
  nombreUsuario: string | null;
}): EvidenciaSinFicha {
  return { documento: a.documentoFicha, nombreLegacy: a.via === "nombre_legacy" ? a.nombreUsuario : null };
}

export type ComisionVisible = {
  /** Importe a mostrar; null = no hay comisión que sea del usuario. */
  total: number | null;
  /** De dónde sale: filas de aliados_b2b (autoritativas), ventas (solo sin filas), o descontada (NETO). */
  fuente: "filas" | "ventas" | "descontada" | "ninguna";
  /** Tipo de aliado de lo que cobraría (freelance → cuenta de cobro; agencia → factura). */
  tipo: string | null;
  /** Hay algo que cobrar con cuenta de cobro / factura. */
  cobrable: boolean;
  /** Ids de aliados_b2b sumados en `total` (solo con fuente "filas"). */
  ids: number[];
};

/**
 * Qué comisión ve un aliado en un contrato (listado del portal) — la MISMA
 * lectura que la cuenta de cobro (resolverComisionB2B):
 *  1. NETO descontada: el importe descontado; no se cobra, y ninguna otra
 *     fila de ese contrato tampoco (`filasCobrables` devuelve vacío).
 *  2. Filas suyas de `aliados_b2b` (filasCobrables): la suma de sus totales,
 *     tal como quedaron tras cualquier corrección. Es la fuente autoritativa.
 *  3. `ventas.comision_b2b` SOLO si el contrato no tiene ninguna fila viva en
 *     `aliados_b2b` (reservas anteriores que no la crearon). Si hay filas pero
 *     ninguna es suya, no se cae a `ventas`: podría ser un importe ya corregido.
 */
export function comisionVisibleAliado<T extends FilaComisionB2B>(
  filas: T[],
  venta: VentaComisionAliado,
  usuario: { aliadoId: number | null } & EvidenciaSinFicha,
): ComisionVisible {
  if (venta.comision_estado === "descontada") {
    const t = venta.comision_b2b == null ? null : Number(venta.comision_b2b);
    return { total: t, fuente: "descontada", tipo: venta.tipo_asesor ?? null, cobrable: false, ids: [] };
  }
  const propias = filasCobrables(filas, venta.comision_estado, { esInterno: false, ...usuario });
  if (propias.length > 0) {
    const tipos = new Set(propias.map((f) => f.tipo_aliado ?? (venta.modo_compra === "comisionable" ? venta.tipo_asesor ?? null : null)));
    const total = propias.reduce((s, f) => s + calcularComisionFila(f).totalPagar, 0);
    return { total, fuente: "filas", tipo: tipos.size === 1 ? [...tipos][0] : null, cobrable: total > 0, ids: propias.map((f) => f.id) };
  }
  const vivas = filas.filter((f) => !esComisionDescontada(f, venta.comision_estado));
  const enVentas = venta.comision_b2b == null ? 0 : Number(venta.comision_b2b);
  if (vivas.length === 0 && venta.modo_compra === "comisionable" && enVentas > 0) {
    return { total: enVentas, fuente: "ventas", tipo: venta.tipo_asesor ?? null, cobrable: true, ids: [] };
  }
  return { total: null, fuente: "ninguna", tipo: null, cobrable: false, ids: [] };
}

/**
 * Con un id explícito, esa fila (si es cobrable). Sin id: la única cobrable,
 * o la lista para elegir — nunca la "más reciente" en silencio.
 */
export function elegirFilaCobro<T extends FilaComisionB2B>(
  cobrables: T[],
  comisionId: number | null | undefined,
): { tipo: "fila"; fila: T } | { tipo: "elegir"; filas: T[] } | { tipo: "ninguna" } {
  if (comisionId != null) {
    const f = cobrables.find((x) => x.id === comisionId);
    return f ? { tipo: "fila", fila: f } : { tipo: "ninguna" };
  }
  if (cobrables.length === 1) return { tipo: "fila", fila: cobrables[0] };
  if (cobrables.length > 1) return { tipo: "elegir", filas: cobrables };
  return { tipo: "ninguna" };
}

// ── Permisos de gestión (espejo de la RLS de la 205) ──────────────────────
/** Editar y borrar comisiones y registrar/deshacer sus abonos. */
export const ROLES_GESTION_COMISION = ["superadmin", "gerencia", "administracion"] as const;
/** Crear comisiones desde la pestaña del contrato (alta). */
export const ROLES_ALTA_COMISION = ["superadmin", "gerencia", "administracion", "operaciones"] as const;
/**
 * Ver comisiones (RLS de lectura de la 205, según el tenant). control_vuelo y
 * los externos no: los aliados ven SU comisión por el portal, no por aquí.
 */
export const ROLES_LECTURA_COMISION = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;

/**
 * Qué puede hacer cada rol con las comisiones de UN contrato (pestaña
 * Comisiones). La base lo vuelve a exigir: registrar_comision_b2b_manual
 * (venta solo en su contrato B2B y sin comisión previa), RLS de edición/borrado
 * y de abonos. Esto solo decide qué se muestra.
 */
export function permisosComisionContrato(
  rol: string | null | undefined,
  esAsesorDelContrato: boolean,
): { ver: boolean; registrar: boolean; editar: boolean; borrar: boolean; soloAliadoDelContrato: boolean } {
  const r = rol ?? "";
  const ver = (ROLES_LECTURA_COMISION as readonly string[]).includes(r);
  return {
    ver,
    registrar: (ROLES_ALTA_COMISION as readonly string[]).includes(r) || (r === "venta" && esAsesorDelContrato),
    // Corregir base / % / valor / recobro: gestión, o `venta` en SU contrato
    // (y solo antes de abonos: lo exige el trigger de la 205).
    editar: (ROLES_GESTION_COMISION as readonly string[]).includes(r) || (r === "venta" && esAsesorDelContrato),
    borrar: (ROLES_GESTION_COMISION as readonly string[]).includes(r),
    // `venta`: una sola comisión, del aliado del contrato, con la retención del
    // catálogo (registrar_comision_b2b_manual lo impone en la base).
    soloAliadoDelContrato: r === "venta",
  };
}

/**
 * El asesor `venta` corrige la comisión de SU contrato (policy "edicion
 * asesor" + trigger de la 205: solo campos del cálculo y antes de abonos).
 * `esSuContrato` sale de soy_asesor_del_contrato, la MISMA función que usa la
 * policy — nunca de comparar nombres aquí.
 */
export function autorizarCorreccionAsesor(
  perfil: { rol: string | null; activo: boolean | null; tenant: string | null } | null,
  tenantComision: string | null | undefined,
  esSuContrato: boolean,
): { permitido: true } | { permitido: false; error: string } {
  if (!perfil || perfil.activo !== true) return { permitido: false, error: "Tu sesión no es válida. Vuelve a iniciar sesión." };
  if (perfil.rol !== "venta") return { permitido: false, error: "Tu rol no tiene permiso para esta acción sobre comisiones B2B." };
  if (!tenantComision || perfil.tenant !== tenantComision) return { permitido: false, error: "Comisión no encontrada o sin acceso." };
  if (!esSuContrato) return { permitido: false, error: "Solo puedes corregir la comisión de tus propios contratos." };
  return { permitido: true };
}

/** puede_ver_tenant(): estos roles operan sobre cualquier agencia. */
const ROLES_CROSS_TENANT = ["superadmin", "gerencia"];

export type PerfilComision = { rol: string | null; activo: boolean | null; tenant: string | null } | null;

export function autorizarComisionB2B(
  perfil: PerfilComision,
  tenantComision: string | null | undefined,
  roles: readonly string[],
): { permitido: true } | { permitido: false; error: string } {
  if (!perfil || perfil.activo !== true) return { permitido: false, error: "Tu sesión no es válida. Vuelve a iniciar sesión." };
  if (!perfil.rol || !roles.includes(perfil.rol)) return { permitido: false, error: "Tu rol no tiene permiso para esta acción sobre comisiones B2B." };
  if (!tenantComision) return { permitido: false, error: "Comisión no encontrada o sin acceso." };
  if (ROLES_CROSS_TENANT.includes(perfil.rol)) return { permitido: true };
  if (perfil.tenant !== tenantComision) return { permitido: false, error: "Comisión no encontrada o sin acceso." };
  return { permitido: true };
}

// ── % con el que nace una comisión automática ─────────────────────────────
/**
 * % propio del aliado; si no tiene, el parámetro general de su tipo; si el
 * parámetro falta, 12 % agencia / 11 % freelance. Un 0 explícito (del aliado o
 * del parámetro) es legítimo y se respeta — antes `||` lo cambiaba por el
 * siguiente, y `Number(undefined) ?? x` dejaba NaN.
 */
export function pctComisionAliado(pctAliado: number | null | undefined, valorParametro: unknown, tipo: string | null | undefined): number {
  if (pctAliado != null && Number.isFinite(Number(pctAliado))) return Number(pctAliado);
  const p = valorParametro == null || valorParametro === "" ? NaN : Number(valorParametro);
  if (Number.isFinite(p)) return p;
  return tipo === "agencia" ? 0.12 : 0.11;
}
