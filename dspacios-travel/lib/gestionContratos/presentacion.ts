// #106 · Texto, tono y enlaces de cada celda de Gestión de contratos. PURO (sin I/O): lo prueban pruebas/gestionContratos106.test.ts.
// Reglas que esta capa NO puede romper (pedidas por el dueño):
//   · «Entrega registrada» y «Envío registrado» salen SOLO de un acuse manual vigente y se rotulan «manualmente»; un voucher generado o una factura emitida nunca se presentan como entregados/enviados, ni el acuse como recibido/aceptado.
//   · Una comisión NETO ya descontada del precio NO es una comisión pendiente de pago.
//   · Un dato desconocido (sin total) se dice «sin total», jamás se pinta como cero.
import { formatMonedaDocumento } from "@/lib/utils";
import { numeroVisible } from "@/lib/tenant";
import type { Tono } from "@/components/EstadoBadge";
import type { ClaseComision, FilaGestion } from "./tipos";

export type Vista = { texto: string; tono: Tono; detalle?: string };

/** «2026-11-12» → «12/11/2026» sin pasar por Date (evita el corrimiento de zona horaria de las fechas sin hora). */
export function fechaCorta(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** Instante del acuse en hora de Bogotá, p. ej. «12/11/2026 10:30». */
export function fechaHoraBogota(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}

export function dinero(valor: number | null, moneda: string): string {
  return valor == null ? "—" : formatMonedaDocumento(valor, moneda);
}

export const NOMBRE_AGENCIA = { mayorista: "Mayorista", minorista: "Minorista" } as const;

export function saldoVista(f: FilaGestion): Vista {
  if (f.saldoClase === "sin_total" || f.total == null) return { texto: "Sin total", tono: "neutral", detalle: "El contrato no tiene un total de cobro registrado." };
  if (f.estadoGrupo === "cancelado") {
    return f.pagado > 0
      ? { texto: "Cancelado", tono: "crit", detalle: `Cancelado con ${dinero(f.pagado, f.monedaCobro)} pagados: no hay saldo exigible.` }
      : { texto: "Cancelado", tono: "crit", detalle: "Cancelado: no hay saldo exigible." };
  }
  if (f.saldoClase === "sobrepago") return { texto: "Sobrepagado", tono: "orange", detalle: `Pagado de más: ${dinero(Math.abs(f.saldo ?? 0), f.monedaCobro)}.` };
  if (f.saldoClase === "pagado") return { texto: "Pagado", tono: "ok" };
  return { texto: dinero(f.saldo, f.monedaCobro), tono: "warn", detalle: "Saldo por cobrar" };
}

/** Paso 1 del voucher: ¿existe? (generado/preparado en el sistema). No dice nada de la entrega. */
export function voucherGeneracionVista(f: FilaGestion): Vista {
  const v = f.voucher;
  if (v.n === 0) return { texto: "No generado", tono: "neutral", detalle: "Todavía no se ha generado ningún voucher." };
  return {
    texto: `Generado (${v.n})`, tono: "info",
    detalle: v.acuseAnterior ? "Incluye un voucher nuevo generado después de la entrega registrada." : "Preparado en el sistema; haberlo generado no prueba que se haya entregado.",
  };
}

/** Paso 2 del voucher: la entrega, que SOLO existe si un superadmin registró el acuse manual. */
export function voucherEntregaVista(f: FilaGestion): Vista {
  const v = f.voucher;
  switch (v.entrega) {
    case "sin_voucher": return { texto: "Sin voucher", tono: "neutral", detalle: "No hay voucher cuya entrega registrar." };
    case "pendiente":
      return v.acuseAnterior
        ? { texto: "Entrega sin registrar (voucher nuevo)", tono: "warn", detalle: `Se generó un voucher después de la entrega registrada (${acuseTexto(v.en, v.actor, v.canal)}). Esa entrega sigue en el historial; registra la del voucher nuevo.` }
        : { texto: "Entrega sin registrar", tono: "warn", detalle: "No consta que se haya entregado." };
    case "entregado": return { texto: "Entrega registrada manualmente", tono: "info", detalle: `${acuseTexto(v.en, v.actor, v.canal)}. Acuse del personal: no prueba que el cliente lo recibiera ni lo aceptara.` };
  }
}

/** Paso 1 de la factura: validación DIAN. «Emitida» = validada en la DIAN, sin excepción. */
export function facturaEmisionVista(f: FilaGestion): Vista {
  const x = f.factura;
  // Un asiento contable o un número antiguo NO prueban la validación: se dicen tal cual.
  if (x.estado === "sin_validar") {
    const partes = [x.contable ? "hay asiento contable" : null, x.registros > 0 ? `${x.registros} registro${x.registros === 1 ? "" : "s"} con N°` : null].filter(Boolean);
    return { texto: "Pendiente de validación DIAN", tono: "warn", detalle: `${partes.join(" · ")}; no consta la validación DIAN, así que no se cuenta como emitida.` };
  }
  if (!x.emitida) return { texto: "Sin factura", tono: "neutral" };
  const extra = [x.contable ? "contabilizada" : null, x.registros > 0 ? `${x.registros} registro${x.registros === 1 ? "" : "s"} con N°` : null].filter(Boolean);
  return { texto: "Emitida (validada por la DIAN)", tono: "ok", detalle: extra.length ? extra.join(" · ") : undefined };
}

/** Paso 2 de la factura: el envío, que SOLO existe si un superadmin registró el acuse manual. */
export function facturaEnvioVista(f: FilaGestion): Vista {
  const x = f.factura;
  switch (x.envio) {
    case "sin_factura": return { texto: "—", tono: "neutral" };
    case "pendiente": return { texto: "Envío sin registrar", tono: "warn", detalle: "La factura existe; no consta que se haya enviado al cliente." };
    case "enviada": return { texto: "Envío registrado manualmente", tono: "info", detalle: `${acuseTexto(x.en, x.actor, x.canal)}. Acuse del personal: no prueba que el cliente la recibiera ni la aceptara.` };
    case "desactualizada": return { texto: "Acuse de envío desactualizado", tono: "orange", detalle: "La factura cambió después del acuse; vuelve a revisar el envío." };
  }
}

function acuseTexto(en: string | null, actor: string | null, canal: string | null): string {
  return [`${fechaHoraBogota(en)}`, actor ? `por ${actor}` : null, canal ? `vía ${canal}` : null].filter(Boolean).join(" ");
}

const COMISION: Record<ClaseComision, Vista> = {
  pagada: { texto: "Pagada", tono: "ok" },
  parcial: { texto: "Pago parcial", tono: "warn" },
  pendiente: { texto: "Pendiente de pago", tono: "warn" },
  descontada: { texto: "Descontada en el precio (NETO)", tono: "info", detalle: "El aliado ya la descontó del precio: no hay comisión por pagar." },
  revision_neto: { texto: "NETO: revisar fila", tono: "orange", detalle: "Contrato NETO con una fila de comisión no descontada: revisión manual, no es saldo por pagar." },
  retenida: { texto: "Retenida (revisión contable)", tono: "orange", detalle: "La comisión está retenida hasta que contabilidad concilie." },
  prevista: { texto: "Prevista al confirmar", tono: "info", detalle: "Tiene un plan de comisión sellado; se exigirá al confirmar el contrato." },
  sin_definir: { texto: "Sin definir", tono: "warn", detalle: "Venta B2B sin comisión registrada ni plan." },
  no_aplica: { texto: "No aplica", tono: "neutral", detalle: "Sin aliado B2B (la comisión del asesor interno se liquida por asesor y mes)." },
};
export function comisionVista(clase: ClaseComision): Vista { return COMISION[clase]; }

export type Enlace = { clave: "contrato" | "pagos" | "vouchers" | "facturacion" | "comisiones"; etiqueta: string; href: string };

/** Enlaces directos a la ficha del contrato (tenant-agnóstica: abre aunque la agencia activa sea la otra). */
export function enlacesDe(f: Pick<FilaGestion, "numero" | "comision">): Enlace[] {
  const base = `/dashboard/contratos/${encodeURIComponent(f.numero)}`;
  const e: Enlace[] = [
    { clave: "contrato", etiqueta: "Contrato", href: base },
    { clave: "pagos", etiqueta: "Pagos", href: `${base}?tab=cartera` },
    { clave: "vouchers", etiqueta: "Vouchers", href: `${base}#vouchers` },
    { clave: "facturacion", etiqueta: "Facturación", href: `${base}?tab=facturacion` },
  ];
  if (f.comision.clase !== "no_aplica") e.push({ clave: "comisiones", etiqueta: "Comisiones", href: `${base}?tab=comisiones` });
  return e;
}

export function numeroMostrado(numero: string): string { return numeroVisible(numero); }

/**
 * ¿Qué acuses admite hoy un voucher o una factura? Ofrece solo lo que la base aceptaría: marcar exige que el documento exista
 * (`hayDocumento`) y que no haya ya un acuse vigente; retirar exige un acuse registrado (vigente o desactualizado).
 */
export function accionesSeguimiento(estado: FilaGestion["voucher"]["entrega"] | FilaGestion["factura"]["envio"], hayDocumento: boolean): { marcar: boolean; retirar: boolean } {
  switch (estado) {
    case "pendiente": return { marcar: hayDocumento, retirar: false };
    case "desactualizada": return { marcar: hayDocumento, retirar: true };
    case "entregado":
    case "enviada": return { marcar: false, retirar: true };
    default: return { marcar: false, retirar: false };
  }
}
