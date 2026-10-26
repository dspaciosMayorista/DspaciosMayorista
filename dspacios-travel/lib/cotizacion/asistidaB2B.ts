// #102 — Cotización ASISTIDA B2B desde el carrito del Tarifario: reglas PURAS (sin I/O).
//
// Un empleado de Mayorista cotiza el carrito para un aliado identificado (agencia o freelance) del catálogo
// `aliados`, en una de dos modalidades:
//   · "comisionable" (PVP con comisión): el comprador paga el PVP; la comisión queda PENDIENTE.
//   · "neta" (NETO): el comprador paga PVP − comisión; la comisión queda DESCONTADA y no se paga dos veces.
//
// Aquí NO se inventa ninguna fórmula: la comisión sale de `planComisionReserva` (#38/#30, espejo de la migración 205:
// base = máximo(PVP − impuesto, 0), % propio del aliado o parámetro general si es NULL, un 0 explícito se respeta) y el % de
// `pctComisionAliado`. Lo nuevo es (1) QUIÉN puede asistir, (2) el CONGELADO de los términos dentro de la cotización y
// (3) la comparación de ese congelado contra lo vivo al convertir, que rechaza antes de numerar en vez de recalcular en silencio.
//
// El navegador solo ELIGE (aliado + modalidad). Nada de lo que mande —canal, porcentaje, base, total— es autoridad.
import { pctComisionAliado } from "@/lib/finanzas/comisionB2B";
import { planComisionReserva, type ModoCompra, type PlanComisionReserva } from "@/lib/reservar/comisionReserva";

/**
 * Roles que pueden ASISTIR una venta B2B (lista explícita, decisión del dueño). No se deriva de ROLES_INTERNOS: `control_vuelo`
 * es interno pero no comercial. `venta` conoce los términos comerciales de la cotización (aliado, %, comisión, total exigible)
 * y elige PVP/NETO; no gana ningún acceso nuevo a costos ni márgenes internos.
 */
export const ROLES_ASISTENCIA_B2B = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;
export type RolAsistenciaB2B = (typeof ROLES_ASISTENCIA_B2B)[number];

/** El carrito del Tarifario es un producto exclusivo de Mayorista (la cotización nace con este tenant fijo). */
export const TENANT_ASISTENCIA_B2B = "mayorista";

export type TipoAliadoB2B = "agencia" | "freelance";
export type OrigenPctB2B = "aliado" | "general" | "defecto";

/** Una unidad cotizada (hotel/bloqueo o servicio) con lo que aporta al PVP y al impuesto no comisionable. */
export type LineaB2B = { clave: string; pvp: number; impuesto: number };

export type PlanB2BCotizacion = {
  version: 1;
  aliado_id: number;
  /** Solo para mostrar; la autoridad es `aliado_id` (se vuelve a leer del catálogo al convertir). */
  aliado_nombre: string;
  tipo_asesor: TipoAliadoB2B;
  modo_compra: ModoCompra;
  moneda: string;
  pvp: number;
  impuesto: number;
  base: number;
  pct: number;
  pct_origen: OrigenPctB2B;
  comision: number;
  comision_estado: "pendiente" | "descontada";
  /** Lo que se le cobra al comprador: PVP en comisionable, PVP − comisión en neta. */
  total_exigible: number;
  /** Una línea por unidad (`item-N` / `tour-N`): permite comparar por grupo cuando se convierte "1 contrato por destino". */
  lineas: LineaB2B[];
  /** Empleado que asistió (autor interno). El beneficiario es SIEMPRE el aliado. */
  asistido_por: { id: string; email: string | null; rol: RolAsistenciaB2B };
  congelado_en: string;
};

const EPS = 0.005;
const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const MENSAJE_TERMINOS_CAMBIARON =
  "Los términos B2B de esta cotización cambiaron desde que se cotizó (precio, impuesto, porcentaje de comisión o aliado). No se creó ningún contrato: genera una cotización nueva desde el tarifario para congelar los valores vigentes.";
export const MENSAJE_COTIZACION_B2B_INVALIDA =
  "Los términos B2B guardados en esta cotización están incompletos o no son consistentes; no se puede convertir. Genera una cotización nueva desde el tarifario.";
export const MENSAJE_SIN_PERMISO_B2B = "Tu rol no puede cotizar ni convertir ventas B2B asistidas.";

// ── Quién puede asistir ─────────────────────────────────────────────────────

export type PerfilAsistencia = { rol: string | null | undefined; activo: boolean | null | undefined; tenant: string | null | undefined };

/**
 * Autoridad del ACTOR (sale de la sesión + `usuarios`, nunca del navegador): usuario activo, rol de la lista explícita y agencia
 * Mayorista (superadmin opera sobre cualquiera). Falla cerrado ante cualquier dato ausente.
 */
export function autorizarActorAsistenciaB2B(
  perfil: PerfilAsistencia | null | undefined,
): { ok: true; rol: RolAsistenciaB2B; superadmin: boolean } | { ok: false; error: string } {
  if (!perfil || perfil.activo !== true) return { ok: false, error: "Tu sesión no es válida. Vuelve a iniciar sesión." };
  const rol = perfil.rol;
  if (typeof rol !== "string" || !(ROLES_ASISTENCIA_B2B as readonly string[]).includes(rol)) return { ok: false, error: MENSAJE_SIN_PERMISO_B2B };
  const superadmin = rol === "superadmin";
  if (!superadmin && perfil.tenant !== TENANT_ASISTENCIA_B2B) {
    return { ok: false, error: "La venta B2B asistida solo está disponible para el personal de Mayorista." };
  }
  return { ok: true, rol: rol as RolAsistenciaB2B, superadmin };
}

// ── Entrada del navegador (solo ELIGE) ───────────────────────────────────────

export type EntradaAsistencia = { aliadoId: number; modo: ModoCompra };

/**
 * `asistencia` ausente / null / `{canal:"b2c"}` ⇒ cotización B2C de siempre. `{canal:"b2b", aliadoId, modo}` ⇒ B2B asistida.
 * Cualquier otra forma se rechaza (nunca se interpreta como B2C en silencio). Esto NO autoriza nada: ver `autorizarActorAsistenciaB2B`.
 */
export function leerAsistenciaB2BEntrada(raw: unknown): { ok: true; asistencia: EntradaAsistencia | null } | { ok: false; error: string } {
  if (!esObjeto(raw) || raw.asistencia === undefined || raw.asistencia === null) return { ok: true, asistencia: null };
  const a = raw.asistencia;
  if (!esObjeto(a)) return { ok: false, error: "La venta asistida no es válida." };
  if (a.canal === "b2c") return { ok: true, asistencia: null };
  if (a.canal !== "b2b") return { ok: false, error: "Elige si la venta es para un cliente final (B2C) o para un aliado (B2B)." };
  const id = a.aliadoId;
  if (!(typeof id === "number" && Number.isInteger(id) && id > 0)) return { ok: false, error: "Elige el aliado (agencia o freelance) de la venta B2B." };
  if (a.modo !== "comisionable" && a.modo !== "neta") return { ok: false, error: "Elige la modalidad de la venta B2B: PVP con comisión o NETO." };
  return { ok: true, asistencia: { aliadoId: id, modo: a.modo } };
}

// ── Aliado (catálogo) y porcentaje ───────────────────────────────────────────

export type FilaAliadoCatalogo = {
  id: number | null | undefined;
  nombre: string | null | undefined;
  tipo: string | null | undefined;
  pct_comision: number | string | null | undefined;
  activo: boolean | null | undefined;
};

export type AliadoAsistencia = { id: number; nombre: string; tipo: TipoAliadoB2B; pctAliado: number | null };

/** El aliado existe, está ACTIVO y es agencia o freelance. El tipo sale del catálogo, no del navegador. */
export function evaluarAliadoAsistencia(fila: FilaAliadoCatalogo | null | undefined): { ok: true; aliado: AliadoAsistencia } | { ok: false; error: string } {
  if (!fila || !(typeof fila.id === "number" && fila.id > 0)) return { ok: false, error: "El aliado elegido no existe en el catálogo." };
  if (fila.activo !== true) return { ok: false, error: "El aliado elegido está inactivo; no se le pueden cotizar ventas." };
  if (fila.tipo !== "agencia" && fila.tipo !== "freelance") return { ok: false, error: "El aliado elegido no es una agencia ni un freelance." };
  const nombre = (fila.nombre ?? "").trim();
  if (!nombre) return { ok: false, error: "El aliado elegido no tiene nombre en el catálogo." };
  const pct = fila.pct_comision == null || fila.pct_comision === "" ? null : Number(fila.pct_comision);
  return { ok: true, aliado: { id: fila.id, nombre, tipo: fila.tipo, pctAliado: pct != null && Number.isFinite(pct) ? pct : null } };
}

/**
 * % con el que nace la comisión y DE DÓNDE sale: el propio del aliado (un 0 explícito se respeta), si no el parámetro general
 * de su tipo, si no el 12 % agencia / 11 % freelance. El número lo calcula `pctComisionAliado` (la misma función que usan
 * `resolverAliadoReserva` y la base); aquí solo se etiqueta el origen con los MISMOS predicados.
 */
export function resolverPctB2B(pctAliado: number | null | undefined, valorParametro: unknown, tipo: TipoAliadoB2B): { pct: number; origen: OrigenPctB2B } {
  const propio = pctAliado != null && Number.isFinite(Number(pctAliado));
  const param = valorParametro == null || valorParametro === "" ? NaN : Number(valorParametro);
  const origen: OrigenPctB2B = propio ? "aliado" : Number.isFinite(param) ? "general" : "defecto";
  return { pct: pctComisionAliado(pctAliado, valorParametro, tipo), origen };
}

export const ETIQUETA_ORIGEN_PCT: Record<OrigenPctB2B, string> = {
  aliado: "Porcentaje propio del aliado",
  general: "Porcentaje general del sistema",
  defecto: "Porcentaje por defecto (el parámetro general no está configurado)",
};
export const ETIQUETA_MODO_B2B: Record<ModoCompra, string> = { comisionable: "PVP con comisión", neta: "NETO" };

// ── Construcción y consistencia del plan congelado ───────────────────────────

function sumarLineas(lineas: readonly LineaB2B[]): { pvp: number; impuesto: number } {
  return { pvp: redondear2(lineas.reduce((s, l) => s + l.pvp, 0)), impuesto: redondear2(lineas.reduce((s, l) => s + l.impuesto, 0)) };
}

function lineasValidas(lineas: readonly LineaB2B[]): boolean {
  if (!lineas.length) return false;
  const claves = new Set<string>();
  for (const l of lineas) {
    if (!l || typeof l.clave !== "string" || !l.clave || claves.has(l.clave)) return false;
    claves.add(l.clave);
    if (!finito(l.pvp) || l.pvp < 0 || !finito(l.impuesto) || l.impuesto < 0) return false;
  }
  return true;
}

function pctValido(pct: number): boolean {
  return Number.isFinite(pct) && pct >= 0 && pct <= 1;
}

export function construirPlanB2B(args: {
  aliado: AliadoAsistencia;
  pct: number;
  pctOrigen: OrigenPctB2B;
  modo: ModoCompra;
  moneda: string;
  lineas: readonly LineaB2B[];
  actor: { id: string; email: string | null; rol: RolAsistenciaB2B };
  congeladoEn: string;
}): { ok: true; plan: PlanB2BCotizacion } | { ok: false; error: string } {
  if (!lineasValidas(args.lineas)) return { ok: false, error: "No se pudieron determinar los valores de la cotización para la venta B2B." };
  if (!pctValido(args.pct)) return { ok: false, error: "El porcentaje de comisión del aliado está fuera de rango (0 a 100 %); corrígelo en el catálogo de aliados." };
  const { pvp, impuesto } = sumarLineas(args.lineas);
  if (!(pvp > 0)) return { ok: false, error: "La cotización no tiene un total mayor que cero; no se puede asistir como venta B2B." };
  const r = planComisionReserva({ modoCompra: args.modo, precioVenta: pvp, impuesto, pct: args.pct });
  if (!r.ok) return { ok: false, error: r.error };
  const p = r.plan;
  return {
    ok: true,
    plan: {
      version: 1,
      aliado_id: args.aliado.id,
      aliado_nombre: args.aliado.nombre,
      tipo_asesor: args.aliado.tipo,
      modo_compra: args.modo,
      moneda: args.moneda,
      pvp,
      impuesto,
      base: p.base,
      pct: args.pct,
      pct_origen: args.pctOrigen,
      comision: p.comision ?? 0,
      comision_estado: p.comisionEstado === "descontada" ? "descontada" : "pendiente",
      total_exigible: p.precioFinal,
      lineas: args.lineas.map((l) => ({ clave: l.clave, pvp: l.pvp, impuesto: l.impuesto })),
      asistido_por: args.actor,
      congelado_en: args.congeladoEn,
    },
  };
}

/**
 * Lee lo guardado en `cotizaciones.payload.b2bAsistido`. Ausente ⇒ cotización B2C/legada (`plan: null`). PRESENTE pero malformada
 * o inconsistente (comisión, base, total o líneas que no cuadran con su propio %) ⇒ error: nunca se convierte "como B2C".
 */
export function leerPlanB2BDePayload(payload: unknown): { ok: true; plan: PlanB2BCotizacion | null } | { ok: false; error: string } {
  if (!esObjeto(payload) || !("b2bAsistido" in payload) || payload.b2bAsistido == null) return { ok: true, plan: null };
  const p = payload.b2bAsistido;
  const malo = { ok: false as const, error: MENSAJE_COTIZACION_B2B_INVALIDA };
  if (!esObjeto(p) || p.version !== 1) return malo;
  const aliadoId = p.aliado_id;
  if (!(typeof aliadoId === "number" && Number.isInteger(aliadoId) && aliadoId > 0)) return malo;
  if (p.tipo_asesor !== "agencia" && p.tipo_asesor !== "freelance") return malo;
  if (p.modo_compra !== "comisionable" && p.modo_compra !== "neta") return malo;
  if (typeof p.moneda !== "string" || !p.moneda) return malo;
  if (p.pct_origen !== "aliado" && p.pct_origen !== "general" && p.pct_origen !== "defecto") return malo;
  for (const k of ["pvp", "impuesto", "base", "pct", "comision", "total_exigible"] as const) if (!finito(p[k])) return malo;
  if (!Array.isArray(p.lineas)) return malo;
  const lineas: LineaB2B[] = [];
  for (const l of p.lineas) {
    if (!esObjeto(l) || typeof l.clave !== "string" || !finito(l.pvp) || !finito(l.impuesto)) return malo;
    lineas.push({ clave: l.clave, pvp: l.pvp, impuesto: l.impuesto });
  }
  if (!lineasValidas(lineas) || !pctValido(p.pct as number)) return malo;
  const a = p.asistido_por;
  if (!esObjeto(a) || typeof a.id !== "string" || !(ROLES_ASISTENCIA_B2B as readonly string[]).includes(a.rol as string)) return malo;
  // Consistencia interna: el congelado debe poder reconstruirse desde sus propias líneas y su propio %.
  const { pvp, impuesto } = sumarLineas(lineas);
  const esperado = planComisionReserva({ modoCompra: p.modo_compra as ModoCompra, precioVenta: pvp, impuesto, pct: p.pct as number });
  if (!esperado.ok || esperado.plan.comision == null) return malo;
  const e = esperado.plan;
  const cuadra = Math.abs((p.pvp as number) - pvp) <= EPS && Math.abs((p.impuesto as number) - impuesto) <= EPS
    && Math.abs((p.base as number) - e.base) <= EPS && Math.abs((p.comision as number) - e.comision!) <= EPS
    && Math.abs((p.total_exigible as number) - e.precioFinal) <= EPS
    && p.comision_estado === e.comisionEstado;
  if (!cuadra) return malo;
  return {
    ok: true,
    plan: {
      version: 1, aliado_id: aliadoId, aliado_nombre: typeof p.aliado_nombre === "string" ? p.aliado_nombre : "",
      tipo_asesor: p.tipo_asesor, modo_compra: p.modo_compra as ModoCompra, moneda: p.moneda, pvp, impuesto, base: e.base, pct: p.pct as number,
      pct_origen: p.pct_origen, comision: e.comision!, comision_estado: e.comisionEstado === "descontada" ? "descontada" : "pendiente",
      total_exigible: e.precioFinal, lineas,
      asistido_por: { id: a.id as string, email: typeof a.email === "string" ? a.email : null, rol: a.rol as RolAsistenciaB2B },
      congelado_en: typeof p.congelado_en === "string" ? p.congelado_en : "",
    },
  };
}

// ── Conversión: congelado vs. vivo ───────────────────────────────────────────

/**
 * El aliado y su % VIVOS deben ser los congelados. Cambió el aliado (otro, inactivo, otro tipo) o su porcentaje ⇒ se rechaza.
 * Un cambio de solo el ORIGEN del % (p. ej. el aliado fija explícitamente el mismo número del general) no mueve dinero y no se rechaza.
 */
export function compararAliadoConCongelado(plan: PlanB2BCotizacion, vivo: { aliadoId: number; tipo: TipoAliadoB2B; pct: number }): { ok: true } | { ok: false; error: string } {
  if (vivo.aliadoId !== plan.aliado_id || vivo.tipo !== plan.tipo_asesor || Math.abs(vivo.pct - plan.pct) > 1e-9) {
    return { ok: false, error: MENSAJE_TERMINOS_CAMBIARON };
  }
  return { ok: true };
}

/** Cada unidad que se va a contratar debe valer EXACTAMENTE lo congelado (PVP e impuesto) y estar en la misma moneda. */
export function compararLineasConCongeladas(plan: PlanB2BCotizacion, vivas: readonly LineaB2B[], monedaConversion: string): { ok: true } | { ok: false; error: string } {
  if (monedaConversion !== plan.moneda) return { ok: false, error: MENSAJE_TERMINOS_CAMBIARON };
  for (const v of vivas) {
    const c = plan.lineas.find((l) => l.clave === v.clave);
    if (!c) return { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA };
    if (!finito(v.pvp) || !finito(v.impuesto) || Math.abs(v.pvp - c.pvp) > EPS || Math.abs(v.impuesto - c.impuesto) > EPS) {
      return { ok: false, error: MENSAJE_TERMINOS_CAMBIARON };
    }
  }
  return { ok: true };
}


/**
 * Cobertura EXACTA: las claves de TODAS las unidades de la cotización (sumadas entre los grupos de la conversión, ya convertidos o pendientes) deben
 * coincidir exactamente UNA vez con las líneas del plan congelado. `compararLineasConCongeladas` solo mira cada grupo por separado y no puede ver una
 * unidad que falta (un tour quitado del payload dejaría la comisión calculada sobre menos PVP del congelado), repetida o en dos grupos a la vez.
 * Se evalúa ANTES de reservar número: conserva la conversión «por destino» (cada grupo aporta sus claves) y sus reintentos (los grupos ya convertidos
 * siguen aportando las suyas, así que el conjunto completo se verifica en cada intento).
 */
export function verificarCoberturaLineasB2B(plan: PlanB2BCotizacion, clavesPorGrupo: readonly (readonly string[])[]): { ok: true } | { ok: false; error: string } {
  const vistas = new Set<string>();
  for (const claves of clavesPorGrupo) {
    for (const k of claves) {
      if (typeof k !== "string" || !k || vistas.has(k)) return { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA };
      vistas.add(k);
    }
  }
  if (vistas.size !== plan.lineas.length || plan.lineas.some((l) => !vistas.has(l.clave))) return { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA };
  return { ok: true };
}
/**
 * Plan de UN contrato (grupo) con los términos CONGELADOS: mismo modo y % que la cotización, PVP e impuesto de las unidades del grupo.
 * Con un solo contrato coincide exactamente con el congelado; con "1 contrato por destino" cada uno redondea su propia comisión
 * (diferencia máxima de medio peso/dólar por contrato frente a la suma congelada).
 */
export function planDeGrupoB2B(plan: PlanB2BCotizacion, lineasDelGrupo: readonly LineaB2B[]): { ok: true; plan: PlanComisionReserva } | { ok: false; error: string } {
  if (!lineasValidas(lineasDelGrupo)) return { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA };
  const { pvp, impuesto } = sumarLineas(lineasDelGrupo);
  return planComisionReserva({ modoCompra: plan.modo_compra, precioVenta: pvp, impuesto, pct: plan.pct });
}

// ── Documentos ───────────────────────────────────────────────────────────────

/**
 * Lo único que un documento EXTERNO (cotización imprimible / enlace público) puede saber del plan: el total exigible en NETO.
 * Nunca el PVP original ni la comisión (regla #30); en PVP con comisión el documento es el de siempre. null = documento normal.
 */
export function netoTotalExigibleParaDocumento(plan: PlanB2BCotizacion | null | undefined): number | null {
  return plan && plan.modo_compra === "neta" ? plan.total_exigible : null;
}

/**
 * Lectura del dato externo-seguro que `crearCotizacionCarrito` deja en `detalle.b2bExterno` (derivado de `netoTotalExigibleParaDocumento`).
 * Los documentos del comprador leen SOLO esto —nunca `payload`—: un valor ausente, no numérico o ≤ 0 se ignora (documento normal).
 */
export function netoTotalExigibleDeDetalle(b2bExterno: unknown): number | null {
  if (!esObjeto(b2bExterno)) return null;
  const n = b2bExterno.netoTotalExigible;
  return finito(n) && n > 0 ? n : null;
}
