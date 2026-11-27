// #103 (B) — STRUCTURED supplier-request e-mail, built from authoritative reservation data (NOT the customer's voucher). PURE: no I/O, every value escaped. Produces the HTML (tables, inline
// styles — mail clients ignore classes) AND the plain-text alternative from the SAME data object, so both always say the same thing. Prices, costs and commissions are never part of the data.
// The field list and presentation are PROPOSED to the owner (see the delivery report); they are not assumed final.
import { escaparHtml, asuntoSolicitud, mensajeAdicionalHtml } from "./nucleo.ts";

export type HotelSolicitud = { nombre: string; ciudad: string | null; categoria: string | null; ingreso: string | null; salida: string | null; noches: number | null; acomodacion: string | null; detalleAcomodacion: string | null; alimentacion: string | null };
export type ServicioSolicitud = { tipo: string; descripcion: string; alcance: string | null };
export type PasajeroSolicitud = { nombre: string; edad: number | null };
export type DatosSolicitud = {
  numero: string; proveedor: string; clase: "hotel" | "servicios";
  titular: string | null; destino: string | null; salida: string | null; regreso: string | null; pax: number | null;
  hoteles: HotelSolicitud[]; servicios: ServicioSolicitud[]; pasajeros: PasajeroSolicitud[];
  /** Promotion code to quote (already validated), or null. */
  codigo: { texto: string; promocion: string } | null;
  /** Optional note added by the sender for THIS send (H103-13): shown above the tables, never replaces them. Absent/null = the original message. */
  mensaje?: string | null;
};
export type CorreoSolicitud = { asunto: string; html: string; texto: string };

const COLOR = "#1D7C9A";
const TD = "padding:6px 10px;border:1px solid #ddd;vertical-align:top";
const TH = `${TD};background:#f6f9fb;font-weight:bold;text-align:left`;
const v = (x: string | number | null | undefined): string => (x == null || String(x).trim() === "" ? "—" : String(x).trim());
const fecha = (iso: string | null): string => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : v(iso));
const ALCANCE: Record<string, string> = { llegada: "Llegada", salida: "Salida", ida_regreso: "Ida y regreso" };

function tabla(titulo: string, cabeceras: string[], filas: string[][]): string {
  if (!filas.length) return "";
  return `<h3 style="margin:18px 0 6px;font-size:14px;color:${COLOR}">${escaparHtml(titulo)}</h3>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#222">
<tr>${cabeceras.map((c) => `<th style="${TH}">${escaparHtml(c)}</th>`).join("")}</tr>
${filas.map((f) => `<tr>${f.map((c) => `<td style="${TD}">${escaparHtml(c)}</td>`).join("")}</tr>`).join("\n")}
</table>`;
}

/** Plain-text table: one line per row, «Column: value» pairs, so it stays readable without any layout. */
function texto(titulo: string, cabeceras: string[], filas: string[][]): string {
  if (!filas.length) return "";
  return `${titulo.toUpperCase()}\n${filas.map((f, i) => `${filas.length > 1 ? `${i + 1}. ` : ""}${f.map((c, j) => `${cabeceras[j]}: ${c}`).join(" | ")}`).join("\n")}\n`;
}

export function construirCorreoSolicitud(d: DatosSolicitud): CorreoSolicitud {
  const general: string[][] = [
    ["Reserva", v(d.numero)], ["Proveedor", v(d.proveedor)], ["Titular", v(d.titular)], ["Destino", v(d.destino)],
    ["Viaje", `${fecha(d.salida)} al ${fecha(d.regreso)}`], ["Pasajeros", v(d.pax)],
    ...(d.codigo ? [["Código de promoción", d.codigo.texto], ["Promoción", d.codigo.promocion]] : []),
  ];
  const hoteles = d.hoteles.map((h) => [v(h.nombre), v(h.ciudad), v(h.categoria), fecha(h.ingreso), fecha(h.salida), v(h.noches), [v(h.acomodacion), h.detalleAcomodacion ? h.detalleAcomodacion : ""].filter(Boolean).join(" — "), v(h.alimentacion)]);
  const cabH = ["Hotel", "Ciudad", "Categoría", "Ingreso", "Salida", "Noches", "Habitación", "Alimentación"];
  const servicios = d.servicios.map((s) => [v(s.tipo), v(s.descripcion), s.alcance ? (ALCANCE[s.alcance] ?? s.alcance) : "—"]);
  const cabS = ["Tipo", "Servicio", "Alcance"];
  const pasajeros = d.pasajeros.map((p, i) => [String(i + 1), v(p.nombre), p.edad == null ? "—" : `${p.edad} años`]);
  const cabP = ["N.º", "Nombre", "Edad al ingreso"];
  const asunto = asuntoSolicitud(d.numero, d.proveedor);
  const intro = `Les enviamos la solicitud de servicio de la reserva ${d.numero}. Por favor respondan a este correo confirmando el servicio o indicando cualquier cambio.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:760px">
<p>Hola${d.proveedor ? `, equipo de <b>${escaparHtml(d.proveedor)}</b>` : ""}.</p>
<p>${escaparHtml(intro)}</p>
${d.mensaje ? `<p data-testid="mensaje-adicional" style="margin:8px 0;padding:8px 12px;border-left:3px solid ${COLOR};background:#f6f9fb">${mensajeAdicionalHtml(d.mensaje)}</p>
` : ""}${d.codigo ? `<p style="margin:12px 0;padding:10px 12px;border:2px solid ${COLOR};border-radius:6px;font-size:15px"><b>Código de promoción:</b> <span style="font-family:monospace;font-size:16px">${escaparHtml(d.codigo.texto)}</span><br><span style="font-size:12px;color:#555">${escaparHtml(d.codigo.promocion)}</span></p>` : ""}
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:13px">
<tr><td colspan="2" style="background:${COLOR};color:#fff;padding:10px;font-weight:bold;text-align:center;letter-spacing:.5px">SOLICITUD DE SERVICIO</td></tr>
${general.map(([k, val]) => `<tr><td style="${TH};width:34%">${escaparHtml(k)}</td><td style="${TD}">${escaparHtml(val)}</td></tr>`).join("\n")}
</table>
${tabla("Alojamiento", cabH, hoteles)}${tabla("Servicios", cabS, servicios)}${tabla("Pasajeros", cabP, pasajeros)}
</div>`;
  const txt = [
    intro, "",
    ...(d.mensaje ? [d.mensaje, ""] : []),
    ...(d.codigo ? [`CÓDIGO DE PROMOCIÓN: ${d.codigo.texto}  (${d.codigo.promocion})`, ""] : []),
    "SOLICITUD DE SERVICIO", ...general.map(([k, val]) => `${k}: ${val}`), "",
    texto("Alojamiento", cabH, hoteles), texto("Servicios", cabS, servicios), texto("Pasajeros", cabP, pasajeros),
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim() + "\n";
  return { asunto, html, texto: txt };
}
