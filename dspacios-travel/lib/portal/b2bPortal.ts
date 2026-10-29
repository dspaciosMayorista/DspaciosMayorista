/**
 * LÓGICA PURA DEL PORTAL B2B (#65)
 *
 * Aquí no hay I/O ni decisión de autorización: `lib/auth/contratosPortalB2B.ts`
 * (propiedad) y `lib/auth/participacionComisionB2B.ts` (participación) ya
 * decidieron QUÉ contratos ve el aliado. Este archivo solo reparte ese conjunto
 * en pestañas y calcula los indicadores del inicio, de modo que inicio y
 * pestañas salen SIEMPRE de los mismos registros autorizados.
 *
 * Dos relaciones con un contrato, que no se mezclan:
 *   · "propio"        — es del aliado (id de usuario, ficha del catálogo o, con
 *                       acceso legacy explícito, nombre). Ve cartera y documentos.
 *   · "participacion" — solo cobra una comisión en él (`aliados_b2b.aliado_id`).
 *                       Una venta puede tener comisiones de más de un aliado, así
 *                       que esto NO lo hace dueño: ve que existe y su comisión,
 *                       nada del cliente, sus pagos ni sus documentos.
 */
import { cobroDeVenta } from "@/lib/finanzas/cobro";
import { abiertaConSalidaPasada, cotizacionVencida } from "@/lib/cotizacion/vigencia";

export type Relacion = "propio" | "participacion";
export type Origen = "directa" | "asistida";

export type VentaPortal = {
  numero_contrato: string;
  tenant?: string | null;
  cliente?: string | null;
  destino?: string | null;
  fecha_salida?: string | null;
  estado?: string | null;
  modo_compra?: string | null;
  b2b_usuario_id?: string | null;
  precio_venta?: number | string | null;
  moneda?: string | null;
  moneda_cobro?: string | null;
  trm_cobro?: number | string | null;
  total_cobro?: number | string | null;
  share_token?: string | null;
  relacion: Relacion;
};

/** Directa = la generó el propio aliado desde el portal. Todo lo demás (lo armó personal interno, Minorista, participación) es asistida. */
export function origenVenta(v: Pick<VentaPortal, "relacion" | "b2b_usuario_id">, usuarioId: string): Origen {
  return v.relacion === "propio" && !!v.b2b_usuario_id && v.b2b_usuario_id === usuarioId ? "directa" : "asistida";
}

const num = (x: unknown) => { const n = Number(x ?? 0); return Number.isFinite(n) ? n : 0; };

export type FilaCartera = {
  numero_contrato: string;
  tenant: string | null;
  cliente: string | null;
  destino: string | null;
  fecha_salida: string | null;
  estado: string | null;
  moneda: string;
  valor: number;
  pagado: number;
  saldo: number;
};

export type AbonoPortal = { id: number; numero_contrato: string; fecha_abono: string | null; valor_abono: number | string | null; forma_pago: string | null };

/** Valor y saldo en la MONEDA DE COBRO (mismo cálculo que el portal anterior y el estado de cuenta); la cartera solo existe para contratos propios. */
export function carteraDe(ventas: VentaPortal[], abonos: AbonoPortal[]): FilaCartera[] {
  const pagado = new Map<string, number>();
  for (const a of abonos) pagado.set(a.numero_contrato, (pagado.get(a.numero_contrato) ?? 0) + num(a.valor_abono));
  return ventas
    .filter((v) => v.relacion === "propio")
    .map((v) => {
      const cobro = cobroDeVenta(v as never);
      const p = pagado.get(v.numero_contrato) ?? 0;
      return {
        numero_contrato: v.numero_contrato, tenant: v.tenant ?? null, cliente: v.cliente ?? null, destino: v.destino ?? null,
        fecha_salida: v.fecha_salida ?? null, estado: v.estado ?? null,
        moneda: cobro.moneda, valor: cobro.total, pagado: p, saldo: cobro.total - p,
      };
    });
}

/** «Con saldo»: lo que aún se debe. «Pagos»: contratos con abonos registrados (el historial se arma aparte). */
export function partirCartera(filas: FilaCartera[], abonos: AbonoPortal[]) {
  const conAbonos = new Set(abonos.map((a) => a.numero_contrato));
  return {
    conSaldo: filas.filter((f) => f.saldo > 0),
    pagos: filas.filter((f) => conAbonos.has(f.numero_contrato)),
  };
}

/** Suma por moneda: nunca se mezclan monedas en un solo total. */
export function sumarPorMoneda(items: { moneda: string; monto: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.moneda] = (out[i.moneda] ?? 0) + i.monto;
  return out;
}

export type CotizacionPortal = {
  id: number;
  estado: string;
  modo?: string | null;
  fecha_salida?: string | null;
  vigencia_hasta?: string | null;
  numero_contrato?: string | null;
  /** Comparativa de la que ya se eligió una opción (existe su cotización hija): deja de estar pendiente. */
  elegida?: boolean;
};

export type EstadoCotizacion = "convertida" | "elegida" | "salida_pasada" | "vencida" | "vigente";

export function estadoCotizacion(c: CotizacionPortal, hoy: string): EstadoCotizacion {
  if (c.estado === "convertida" && c.numero_contrato) return "convertida";
  if (c.elegida) return "elegida";
  if (abiertaConSalidaPasada({ estado: c.estado, fecha_salida: c.fecha_salida ?? null }, hoy)) return "salida_pasada";
  if (cotizacionVencida(c.vigencia_hasta ?? null, hoy)) return "vencida";
  return "vigente";
}

/** Un contrato anulado o cancelado no cuenta como salida: ni en «Próximas salidas», ni en la gráfica, ni en el indicador de 30 días. */
export function contratoAnulado(v: Pick<VentaPortal, "estado">): boolean {
  return /anul|cancel/i.test(v.estado ?? "");
}

/** Salidas con fecha de contratos PROPIOS no anulados: única fuente de las tres vistas de salidas del inicio. */
export function salidasVigentes(ventas: VentaPortal[]): VentaPortal[] {
  return ventas.filter((v) => v.relacion === "propio" && !!v.fecha_salida && !contratoAnulado(v));
}

export type ResumenInicio = {
  cotizacionesVigentes: number;
  ventasPropias: number;
  ventasParticipacion: number;
  contratosConSaldo: number;
  saldoPorMoneda: Record<string, number>;
  comisionPorCobrarPorMoneda: Record<string, number>;
  salidasProximas: number;
};

export function resumenInicio(a: {
  ventas: VentaPortal[];
  cartera: FilaCartera[];
  cotizaciones: CotizacionPortal[];
  comisiones: { moneda: string; monto: number }[];
  hoy: string;
  diasProximos?: number;
}): ResumenInicio {
  const dias = a.diasProximos ?? 30;
  const limite = new Date(`${a.hoy}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + dias);
  const tope = limite.toISOString().slice(0, 10);
  const conSaldo = a.cartera.filter((f) => f.saldo > 0);
  return {
    cotizacionesVigentes: a.cotizaciones.filter((c) => estadoCotizacion(c, a.hoy) === "vigente").length,
    ventasPropias: a.ventas.filter((v) => v.relacion === "propio").length,
    ventasParticipacion: a.ventas.filter((v) => v.relacion === "participacion").length,
    contratosConSaldo: conSaldo.length,
    saldoPorMoneda: sumarPorMoneda(conSaldo.map((f) => ({ moneda: f.moneda, monto: f.saldo }))),
    comisionPorCobrarPorMoneda: sumarPorMoneda(a.comisiones),
    salidasProximas: salidasVigentes(a.ventas).filter((v) => (v.fecha_salida as string) >= a.hoy && (v.fecha_salida as string) <= tope).length,
  };
}

export type DocumentosContrato = {
  numero_contrato: string;
  tenant: string | null;
  /** Enlace público del contrato (`/c/[token]`); null si el contrato no tiene token. */
  contratoToken: string | null;
  /** Vouchers con contenido generado (`/voucher/[token]`). */
  vouchers: { token: string; tipo: string | null }[];
  /** Siempre existe para un contrato propio (aunque no tenga abonos). */
  estadoCuenta: true;
  recibos: { id: number; fecha: string | null }[];
};

export type VoucherPortal = { numero_contrato: string; tipo: string | null; share_token: string | null; contenido: unknown };

/** Una fila por contrato PROPIO; un documento sin fuente real queda vacío (la pantalla muestra «No disponible», nunca un enlace). */
export function documentosDe(ventas: VentaPortal[], vouchers: VoucherPortal[], abonos: AbonoPortal[]): DocumentosContrato[] {
  return ventas
    .filter((v) => v.relacion === "propio")
    .map((v) => ({
      numero_contrato: v.numero_contrato,
      tenant: v.tenant ?? null,
      contratoToken: v.share_token ? String(v.share_token) : null,
      vouchers: vouchers
        .filter((x) => x.numero_contrato === v.numero_contrato && !!x.share_token && x.contenido != null)
        .map((x) => ({ token: String(x.share_token), tipo: x.tipo ?? null })),
      estadoCuenta: true as const,
      recibos: abonos
        .filter((a) => a.numero_contrato === v.numero_contrato)
        .map((a) => ({ id: a.id, fecha: a.fecha_abono ?? null })),
    }));
}

export type ComparativaBase = {
  id: number; estado: string; fecha_salida: string | null; vigencia_hasta: string | null;
  hija: { codigo: string; estado: string; numero_contrato: string | null } | null;
};

/** Una comparativa cuenta como cotización con la MISMA regla de estado (inicio y pestaña no pueden diferir). */
export function comparativaComoCotizacion(c: ComparativaBase): CotizacionPortal {
  return { id: c.id, estado: c.estado, fecha_salida: c.fecha_salida, vigencia_hasta: c.vigencia_hasta, numero_contrato: c.hija?.numero_contrato ?? null, elegida: !!c.hija };
}

export type MetaComparativa = { propietario_id: string | null; aliado_id: number | null };

/**
 * Directa = la creó el propio aliado (`propietario_id` = su usuario). Asistida = está asignada a SU ficha
 * (`aliado_id`) y la creó otra persona. Solo IDs verificados: una comparativa cuya procedencia no se puede
 * comprobar no se muestra (queda en `sinVerificar`), nunca se adivina.
 */
export function clasificarComparativas<T extends { id: number }>(
  filas: T[], meta: Map<number, MetaComparativa>, userId: string, aliadoId: number | null,
): { directas: T[]; asistidas: T[]; sinVerificar: number } {
  const directas: T[] = [], asistidas: T[] = [];
  let sinVerificar = 0;
  for (const c of filas) {
    const m = meta.get(c.id);
    if (!m) { sinVerificar++; continue; }
    if (m.propietario_id === userId) directas.push(c);
    else if (aliadoId != null && m.aliado_id === aliadoId) asistidas.push(c);
    else sinVerificar++;
  }
  return { directas, asistidas, sinVerificar };
}
