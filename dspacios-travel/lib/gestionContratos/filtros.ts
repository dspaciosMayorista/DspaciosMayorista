// #106 · Gestión integral de contratos (superadmin). Filtros de la pantalla: lectura PURA y validada de la URL (sin I/O).
// La URL es la única fuente de verdad (enlaces compartibles, «atrás» del navegador, filtros que sobreviven a la navegación). Toda clave y valor se
// valida contra listas blancas; un valor inválido se DESCARTA y se avisa (nunca se manda tal cual a la base ni se interpreta como otra cosa).

export const POR_PAGINA = 25;
export const PAGINA_MAXIMA = 10_000;

export const AGENCIAS = ["mayorista", "minorista"] as const;
export const ESTADOS = ["pendiente", "confirmado", "cancelado", "otro"] as const;
export const SALDOS = ["con_saldo", "pagado", "sobrepago", "sin_total"] as const;
export const MONEDAS = ["COP", "USD"] as const;
export const VOUCHERS = ["con", "sin"] as const;
export const ENTREGAS = ["pendiente", "entregado"] as const;
export const FACTURAS = ["emitida", "sin_emitir"] as const;
export const ENVIOS = ["pendiente", "enviada", "desactualizada"] as const;
export const COMISIONES = ["pendiente", "parcial", "pagada", "descontada", "revision_neto", "retenida", "prevista", "sin_definir", "no_aplica"] as const;
export const ORDENES = ["venta_desc", "venta_asc", "salida_asc", "salida_desc", "saldo_desc", "numero_asc"] as const;

export type FiltrosGestion = {
  agencia?: (typeof AGENCIAS)[number];
  numero?: string;
  cliente?: string;
  ventaDesde?: string;
  ventaHasta?: string;
  salidaDesde?: string;
  salidaHasta?: string;
  estado?: (typeof ESTADOS)[number];
  saldo?: (typeof SALDOS)[number];
  moneda?: (typeof MONEDAS)[number];
  voucher?: (typeof VOUCHERS)[number];
  entrega?: (typeof ENTREGAS)[number];
  factura?: (typeof FACTURAS)[number];
  envio?: (typeof ENVIOS)[number];
  comision?: (typeof COMISIONES)[number];
  orden: (typeof ORDENES)[number];
};

export type EntradaUrl = Record<string, string | string[] | undefined>;

// Nombre en la URL → clave del filtro. (Cortos y en español: son lo que el superadmin ve y comparte.)
const PARAMS = {
  agencia: "agencia", numero: "numero", cliente: "cliente", venta_desde: "ventaDesde", venta_hasta: "ventaHasta", salida_desde: "salidaDesde",
  salida_hasta: "salidaHasta", estado: "estado", saldo: "saldo", moneda: "moneda", voucher: "voucher", entrega: "entrega", factura: "factura",
  envio: "envio", comision: "comision", orden: "orden",
} as const;

// Clave del filtro → clave que entiende `fn_gestion_contratos` (migración 309).
const CLAVE_RPC: Record<string, string> = {
  agencia: "tenant", numero: "numero", cliente: "cliente", ventaDesde: "venta_desde", ventaHasta: "venta_hasta", salidaDesde: "salida_desde",
  salidaHasta: "salida_hasta", estado: "estado", saldo: "saldo", moneda: "moneda_cobro", voucher: "voucher", entrega: "voucher_entrega",
  factura: "factura", envio: "factura_envio", comision: "comision",
};

const LISTAS: Record<string, readonly string[]> = {
  agencia: AGENCIAS, estado: ESTADOS, saldo: SALDOS, moneda: MONEDAS, voucher: VOUCHERS, entrega: ENTREGAS, factura: FACTURAS, envio: ENVIOS,
  comision: COMISIONES, orden: ORDENES,
};
const FECHAS = new Set(["ventaDesde", "ventaHasta", "salidaDesde", "salidaHasta"]);
const TEXTOS = new Set(["numero", "cliente"]);
const LARGO_TEXTO = 60;

/** Una fecha YYYY-MM-DD REAL (rechaza 2026-02-30, 2026-13-01 y formatos distintos; no «corrige» nada en silencio). */
export function esFechaValida(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(y, mo - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d;
}

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Quita caracteres de control y espacios sobrantes; el recorte a LARGO_TEXTO evita URLs/consultas descomunales. */
function limpiarTexto(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LARGO_TEXTO);
}

export function entero(v: string | undefined): number {
  if (v == null || !/^\d{1,6}$/.test(v)) return 1;
  return Math.min(Math.max(parseInt(v, 10), 1), PAGINA_MAXIMA);
}

export type ParseoFiltros = { filtros: FiltrosGestion; pagina: number; avisos: string[] };

export function parsearFiltros(entrada: EntradaUrl): ParseoFiltros {
  const filtros: FiltrosGestion = { orden: "venta_desc" };
  const avisos: string[] = [];
  const f = filtros as Record<string, string>;
  for (const [param, clave] of Object.entries(PARAMS)) {
    const crudo = primero(entrada[param]);
    if (crudo == null || crudo === "") continue;
    if (TEXTOS.has(clave)) {
      const t = limpiarTexto(crudo);
      if (t) f[clave] = t;
    } else if (FECHAS.has(clave)) {
      if (esFechaValida(crudo)) f[clave] = crudo;
      else avisos.push(`La fecha «${limpiarTexto(crudo)}» no es válida y se ignoró.`);
    } else if (LISTAS[clave].includes(crudo)) {
      f[clave] = crudo;
    } else {
      avisos.push(`El valor «${limpiarTexto(crudo)}» del filtro ${param} no es válido y se ignoró.`);
    }
  }
  if (filtros.ventaDesde && filtros.ventaHasta && filtros.ventaDesde > filtros.ventaHasta) avisos.push("El rango de fecha de compra está invertido (desde es posterior a hasta): no habrá resultados.");
  if (filtros.salidaDesde && filtros.salidaHasta && filtros.salidaDesde > filtros.salidaHasta) avisos.push("El rango de fecha de viaje está invertido (desde es posterior a hasta): no habrá resultados.");
  return { filtros, pagina: entero(primero(entrada.pagina)), avisos };
}

/** Objeto de filtros para `fn_gestion_contratos` (solo claves presentes; el orden va aparte). */
export function aFiltrosRpc(filtros: FiltrosGestion): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(filtros)) {
    if (clave === "orden" || valor == null || valor === "") continue;
    out[CLAVE_RPC[clave]] = String(valor);
  }
  return out;
}

/** Query string (con «?» o vacío) que reproduce los filtros; `orden` por defecto y página 1 no se escriben. */
export function aQuery(filtros: FiltrosGestion, pagina = 1): string {
  const p = new URLSearchParams();
  for (const [param, clave] of Object.entries(PARAMS)) {
    const v = (filtros as Record<string, string | undefined>)[clave];
    if (v == null || v === "") continue;
    if (clave === "orden" && v === "venta_desc") continue;
    p.set(param, v);
  }
  if (pagina > 1) p.set("pagina", String(Math.min(pagina, PAGINA_MAXIMA)));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hayFiltros(filtros: FiltrosGestion): boolean {
  return Object.entries(filtros).some(([k, v]) => !(k === "orden" && v === "venta_desc") && v != null && v !== "");
}

export function totalPaginas(total: number): number {
  return Math.max(1, Math.ceil(total / POR_PAGINA));
}
