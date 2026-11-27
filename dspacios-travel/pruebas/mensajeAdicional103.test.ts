// H103-13 — the optional per-send note above the structured supplier request / payment notice. Pure: cleaning rules, escaping, placement, and «without a note the message is exactly the old one».
// Expected values are written by hand from the rules (max 600, plain text, escaped, above the tables), not read back from the code under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { construirCorreoSolicitud, type DatosSolicitud } from "../lib/solicitudProveedor/documento.ts";
import { construirCorreoPago, type LineaPago } from "../lib/solicitudProveedor/avisoPago.ts";
import { limpiarMensajeAdicional, MAX_MENSAJE_ADICIONAL } from "../lib/solicitudProveedor/nucleo.ts";

const BASE: DatosSolicitud = {
  numero: "DTM-0451", proveedor: "Hotel Sol", clase: "hotel", titular: "Ana Pérez", destino: "CARTAGENA", salida: "2027-03-26", regreso: "2027-03-30", pax: 2,
  hoteles: [{ nombre: "Hotel Sol", ciudad: "Cartagena", categoria: "Superior", ingreso: "2027-03-26", salida: "2027-03-30", noches: 4, acomodacion: "Doble", detalleAcomodacion: null, alimentacion: "Desayuno" }],
  servicios: [], pasajeros: [{ nombre: "Ana Pérez", edad: 41 }], codigo: null,
};
const NOTA = "Late check-in 22:00.\nSegunda <b>línea</b> & \"x\"";
const PARRAFO = /<p data-testid="mensaje-adicional"[^>]*>[\s\S]*?<\/p>\n/;

test("N1 cleaning: empty / blank / null / undefined → no note; CRLF → LF; control characters dropped; 3+ blank lines collapse; outer whitespace trimmed", () => {
  for (const x of [null, undefined, "", "   ", "\n\t \r\n"]) assert.deepEqual(limpiarMensajeAdicional(x), { ok: true, v: null });
  assert.deepEqual(limpiarMensajeAdicional("  a\r\nb\u0007c\n\n\n\nd  "), { ok: true, v: "a\nbc\n\nd" });
});

test("N2 bound: exactly 600 characters pass; 601 is an ERROR that names the limit (never a silent cut); a non-string is refused", () => {
  assert.equal(MAX_MENSAJE_ADICIONAL, 600);
  const ok = limpiarMensajeAdicional("x".repeat(600)); assert.equal(ok.ok && ok.v?.length, 600);
  const largo = limpiarMensajeAdicional("x".repeat(601)); assert.equal(largo.ok, false); if (!largo.ok) assert.match(largo.error, /supera 600 caracteres \(tiene 601\)/);
  assert.equal(limpiarMensajeAdicional(123 as unknown).ok, false);
  assert.equal(limpiarMensajeAdicional("   " + "y".repeat(600) + "   ").ok, true, "the bound counts the trimmed text");
});

test("N3 request: no note (absent, null, '') is EXACTLY the old message in HTML and text; with a note the ONLY difference is the inserted note", () => {
  const sin = construirCorreoSolicitud(BASE);
  for (const sinNota of [{ ...BASE, mensaje: null }, { ...BASE, mensaje: "" }, { ...BASE, mensaje: undefined }]) assert.deepEqual(construirCorreoSolicitud(sinNota), sin);
  assert.doesNotMatch(sin.html + sin.texto, /mensaje-adicional|Late check-in/);
  const con = construirCorreoSolicitud({ ...BASE, mensaje: NOTA });
  assert.equal(con.asunto, sin.asunto, "subject unchanged");
  assert.equal(con.html.replace(PARRAFO, ""), sin.html, "HTML: removing the note leaves the old message");
  assert.equal(con.texto.replace(`${NOTA}\n\n`, ""), sin.texto, "text: removing the note leaves the old message");
});

test("N4 request: the note is ESCAPED (no live markup), keeps its line breaks, and sits after the intro and BEFORE the tables; the plain text keeps the raw characters", () => {
  const con = construirCorreoSolicitud({ ...BASE, mensaje: NOTA });
  assert.ok(con.html.includes("Late check-in 22:00.<br>Segunda &lt;b&gt;línea&lt;/b&gt; &amp; &quot;x&quot;"));
  assert.doesNotMatch(con.html, /<b>línea<\/b>/);
  const i = (t: string, s: string) => t.indexOf(s);
  assert.ok(i(con.html, "Les enviamos la solicitud") < i(con.html, "mensaje-adicional") && i(con.html, "mensaje-adicional") < i(con.html, "SOLICITUD DE SERVICIO"));
  assert.ok(i(con.texto, "Les enviamos la solicitud") < i(con.texto, "Late check-in") && i(con.texto, "Late check-in") < i(con.texto, "SOLICITUD DE SERVICIO"));
  assert.ok(con.texto.includes("Segunda <b>línea</b> & \"x\""));
  for (const hecho of ["DTM-0451", "Hotel Sol", "26/03/2027", "Ana Pérez", "41 años"]) { assert.ok(con.html.includes(hecho)); assert.ok(con.texto.includes(hecho)); }
});

test("N5 the note never displaces the promotion code box or the supplier identity", () => {
  const con = construirCorreoSolicitud({ ...BASE, codigo: { texto: "PROMO-ABC", promocion: "Semana Santa" }, mensaje: NOTA });
  assert.match(con.html, /Código de promoción:<\/b> <span[^>]*>PROMO-ABC<\/span>/); assert.match(con.texto, /CÓDIGO DE PROMOCIÓN: PROMO-ABC\s+\(Semana Santa\)/);
  assert.ok(con.html.indexOf("mensaje-adicional") < con.html.indexOf("Código de promoción"), "note, then the code box, then the tables");
  assert.match(con.html, /equipo de <b>Hotel Sol<\/b>/);
});

const LINEA: LineaPago = { pagoId: 1, numeroContrato: "DTM-1141", servicio: "Hotel Sol", tipoProveedor: "hotel", fecha: "2027-02-10", valor: 400000, moneda: "COP", trm: 1, valorObligacion: 1000000, pagadoAcumulado: 400000 };
test("N6 payment notice: same rules — absent note is the old message; with a note only the paragraph is added above the table; totals and attachments list untouched", () => {
  const dato = { proveedor: "Hotel Sol", referencia: "TRF-1", lineas: [LINEA], adjuntos: [{ nombre: "comprobante.pdf", bytes: 2048 }] };
  const sin = construirCorreoPago(dato);
  assert.deepEqual(construirCorreoPago({ ...dato, mensaje: null }), sin); assert.deepEqual(construirCorreoPago({ ...dato, mensaje: "" }), sin);
  const con = construirCorreoPago({ ...dato, mensaje: NOTA });
  assert.equal(con.asunto, sin.asunto); assert.deepEqual(con.totales, sin.totales);
  assert.equal(con.html.replace(PARRAFO, ""), sin.html); assert.equal(con.texto.replace(`${NOTA}\n\n`, ""), sin.texto);
  assert.ok(con.html.indexOf("mensaje-adicional") < con.html.indexOf("AVISO DE PAGO"));
  assert.ok(con.html.includes("Segunda &lt;b&gt;línea&lt;/b&gt;"));
});
