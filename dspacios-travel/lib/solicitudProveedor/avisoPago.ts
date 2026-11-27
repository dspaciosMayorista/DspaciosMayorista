// #103 (D) — supplier PAYMENT notice: the e-mail body (HTML + plain text) and its totals, built ONLY from persisted rows (`cxp_pagos` joined to their `cuentas_por_pagar`). PURE.
// Each `cxp_pagos` row is one payment applied to one obligation (one reservation/service line) — that row IS the allocation. Nothing here splits an amount: a payment covering several reservations
// arrives as several lines; a partial payment shows the amount of THIS payment next to the obligation total and the cumulative paid, both persisted numbers.
import { escaparHtml, mensajeAdicionalHtml } from "./nucleo.ts";

export type LineaPago = {
  pagoId: number; numeroContrato: string; servicio: string | null; tipoProveedor: string | null; fecha: string;
  /** Amount of THIS payment, in the obligation's currency (cxp_pagos.valor). */ valor: number; moneda: "COP" | "USD";
  /** Rate recorded with the payment (1 for COP). */ trm: number;
  /** cuentas_por_pagar.valor_total, same currency. */ valorObligacion: number;
  /** Sum of ALL payments recorded for the obligation (cxp_pagos), same currency. */ pagadoAcumulado: number;
};
export type AdjuntoAviso = { nombre: string; bytes: number };
export type DatosAvisoPago = { proveedor: string; referencia: string | null; lineas: LineaPago[]; adjuntos: AdjuntoAviso[]; /** Optional note for THIS send (H103-13), above the table; never replaces it. */ mensaje?: string | null };
export type CorreoPago = { asunto: string; html: string; texto: string; totales: { moneda: "COP" | "USD"; total: number; equivalenteCop: number | null }[] };

const COLOR = "#1D7C9A";
const TD = "padding:6px 10px;border:1px solid #ddd;vertical-align:top";
const TH = `${TD};background:#f6f9fb;font-weight:bold;text-align:left`;
const fecha = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : iso);
const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const dinero = (n: number, m: "COP" | "USD"): string => `${m === "USD" ? "USD " : "COP "}${new Intl.NumberFormat("es-CO", { minimumFractionDigits: m === "USD" ? 2 : 0, maximumFractionDigits: 2 }).format(n)}`;
const kb = (b: number): string => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Totals per currency (never mixed) and, for USD, the peso equivalent actually paid (Σ valor × TRM of each payment). */
export function totalesPago(lineas: readonly LineaPago[]): CorreoPago["totales"] {
  const out: CorreoPago["totales"] = [];
  for (const m of ["COP", "USD"] as const) {
    const ls = lineas.filter((l) => l.moneda === m);
    if (!ls.length) continue;
    out.push({ moneda: m, total: redondear(ls.reduce((a, l) => a + l.valor, 0)), equivalenteCop: m === "USD" ? redondear(ls.reduce((a, l) => a + l.valor * l.trm, 0)) : null });
  }
  return out;
}

export function construirCorreoPago(d: DatosAvisoPago): CorreoPago {
  const lineas = [...d.lineas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numeroContrato.localeCompare(b.numeroContrato) || a.pagoId - b.pagoId);
  const totales = totalesPago(lineas);
  const fechas = [...new Set(lineas.map((l) => l.fecha))];
  const asunto = `Aviso de pago · ${d.proveedor} · ${fechas.length === 1 ? fecha(fechas[0]) : `${fecha(fechas[0])} a ${fecha(fechas[fechas.length - 1])}`}${d.referencia ? ` · Ref. ${d.referencia}` : ""}`;
  const cab = ["Reserva", "Servicio", "Fecha de pago", "Valor de este pago", "Obligación total", "Pagado acumulado"];
  const filas = lineas.map((l) => [
    l.numeroContrato, [l.tipoProveedor, l.servicio].filter(Boolean).join(" · ") || "—", fecha(l.fecha),
    l.moneda === "USD" ? `${dinero(l.valor, "USD")} (TRM ${l.trm} = ${dinero(redondear(l.valor * l.trm), "COP")})` : dinero(l.valor, "COP"),
    dinero(l.valorObligacion, l.moneda), dinero(l.pagadoAcumulado, l.moneda),
  ]);
  const intro = `Les informamos que realizamos ${lineas.length === 1 ? "el siguiente pago" : "los siguientes pagos"}${d.referencia ? ` (referencia ${d.referencia})` : ""}. ${d.adjuntos.length ? "Adjuntamos el soporte." : ""} Por favor confirmen la recepción respondiendo a este correo.`.replace(/\s+/g, " ").trim();
  const filaTotales = totales.map((t) => `Total ${t.moneda}: ${dinero(t.total, t.moneda)}${t.equivalenteCop != null ? ` (equivalente pagado en pesos: ${dinero(t.equivalenteCop, "COP")})` : ""}`);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:820px">
<p>Hola, equipo de <b>${escaparHtml(d.proveedor)}</b>.</p>
<p>${escaparHtml(intro)}</p>
${d.mensaje ? `<p data-testid="mensaje-adicional" style="margin:8px 0;padding:8px 12px;border-left:3px solid ${COLOR};background:#f6f9fb">${mensajeAdicionalHtml(d.mensaje)}</p>
` : ""}<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:13px">
<tr><td colspan="${cab.length}" style="background:${COLOR};color:#fff;padding:10px;font-weight:bold;text-align:center;letter-spacing:.5px">AVISO DE PAGO</td></tr>
<tr>${cab.map((c) => `<th style="${TH}">${escaparHtml(c)}</th>`).join("")}</tr>
${filas.map((f) => `<tr>${f.map((c) => `<td style="${TD}">${escaparHtml(c)}</td>`).join("")}</tr>`).join("\n")}
${filaTotales.map((t) => `<tr><td colspan="${cab.length}" style="${TD};background:#f6f9fb;font-weight:bold;text-align:right">${escaparHtml(t)}</td></tr>`).join("\n")}
</table>
${d.adjuntos.length ? `<p style="margin-top:14px;font-size:13px"><b>Soportes adjuntos:</b> ${d.adjuntos.map((a) => `${escaparHtml(a.nombre)} (${kb(a.bytes)})`).join("; ")}</p>` : ""}
<p style="font-size:12px;color:#555">«Valor de este pago» es el monto pagado en esa fecha; «Pagado acumulado» suma todos los pagos registrados para esa obligación.</p>
</div>`;
  const txt = [
    intro, "", ...(d.mensaje ? [d.mensaje, ""] : []), "AVISO DE PAGO",
    ...filas.map((f, i) => `${i + 1}. ${f.map((c, j) => `${cab[j]}: ${c}`).join(" | ")}`),
    "", ...filaTotales,
    ...(d.adjuntos.length ? ["", `Soportes adjuntos: ${d.adjuntos.map((a) => `${a.nombre} (${kb(a.bytes)})`).join("; ")}`] : []),
  ].join("\n") + "\n";
  return { asunto, html, texto: txt, totales };
}
