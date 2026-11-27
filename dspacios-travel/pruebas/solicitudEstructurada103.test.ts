// #103 (B, C, D, E) — pure logic: structured supplier request (HTML + plain text), required promotion codes, payment-notice relation, Svix signature, Resend event mapping, transport payloads.
// Expected values are written by hand from the rules in the brief / provider documentation, not read back from the code under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { construirCorreoSolicitud, type DatosSolicitud } from "../lib/solicitudProveedor/documento.ts";
import { nochesDeEstancia, nochesDeVigencia, resolverCodigo, vigenciasQueExigenCodigo, type VigenciaConCodigo } from "../lib/solicitudProveedor/codigos.ts";
import { construirCorreoPago, totalesPago, type LineaPago } from "../lib/solicitudProveedor/avisoPago.ts";
import { firmaSvixValida, normalizarEventoResend } from "../lib/solicitudProveedor/nucleo.ts";
import { transporteCaptura, transporteResend } from "../lib/solicitudProveedor/transporte.ts";

const BASE: DatosSolicitud = {
  numero: "DTM-0451", proveedor: "Hotel <b>Sol</b> & Mar", clase: "hotel", titular: "Ana \"Q\" Pérez", destino: "CARTAGENA", salida: "2027-03-26", regreso: "2027-03-30", pax: 3,
  hoteles: [{ nombre: "Hotel Sol & Mar", ciudad: "Cartagena", categoria: "Superior", ingreso: "2027-03-26", salida: "2027-03-30", noches: 4, acomodacion: "Doble", detalleAcomodacion: "1 hab doble + 1 niño", alimentacion: "Todo incluido" }],
  servicios: [{ tipo: "traslado", descripcion: "Traslado aeropuerto <hotel>", alcance: "ida_regreso" }],
  pasajeros: [{ nombre: "Ana Pérez", edad: 41 }, { nombre: "Luis Pérez", edad: 9 }, { nombre: "<script>x</script>", edad: null }],
  codigo: null,
};

test("B1 the structured request has an HTML table AND a plain-text alternative built from the same data; every value is escaped; no class attributes or scripts", () => {
  const c = construirCorreoSolicitud(BASE);
  assert.match(c.asunto, /Reserva DTM-0451/);
  assert.match(c.html, /<table/); assert.doesNotMatch(c.html, /class=|<script/i);
  assert.match(c.html, /Hotel &lt;b&gt;Sol&lt;\/b&gt; &amp; Mar/); assert.match(c.html, /&lt;script&gt;x&lt;\/script&gt;/); assert.match(c.html, /Traslado aeropuerto &lt;hotel&gt;/);
  // same facts in both parts
  for (const hecho of ["DTM-0451", "26/03/2027", "30/03/2027", "Superior", "Todo incluido", "Ana Pérez", "41 años", "Ida y regreso"]) {
    assert.ok(c.html.includes(hecho), `html: ${hecho}`); assert.ok(c.texto.includes(hecho), `text: ${hecho}`);
  }
  assert.doesNotMatch(c.texto, /&lt;|&amp;|<table|<td/, "plain text has no HTML entities or table tags");
  assert.match(c.texto, /Traslado aeropuerto <hotel>/, "plain text keeps the raw characters, not HTML entities");
});

test("B2 the request never carries prices, costs, commissions or the customer's voucher wording", () => {
  const c = construirCorreoSolicitud(BASE);
  assert.doesNotMatch(c.html + c.texto, /precio|costo|comisi|neto|PVP|voucher/i);
});

test("C-email the promotion code is shown prominently in HTML and in plain text; absent when there is none", () => {
  const con = construirCorreoSolicitud({ ...BASE, codigo: { texto: "PROMO-2027-ABC", promocion: "Semana Santa 2027" } });
  assert.match(con.html, /Código de promoción:<\/b> <span[^>]*>PROMO-2027-ABC<\/span>/); assert.match(con.texto, /CÓDIGO DE PROMOCIÓN: PROMO-2027-ABC\s+\(Semana Santa 2027\)/);
  const sin = construirCorreoSolicitud(BASE);
  assert.doesNotMatch(sin.html + sin.texto, /PROMO|código de promoción/i);
});

const V = (o: Partial<VigenciaConCodigo> & { codigoId: number; vigenciaId: number; nombre: string }): VigenciaConCodigo => ({ hotelId: 7, fechaInicio: null, fechaFin: null, rangos: [], blackouts: [], requerido: true, codigo: "COD", ...o });

test("C1 stay nights = check-in … night before check-out; reversed/invalid dates → none", () => {
  assert.deepEqual(nochesDeEstancia("2027-12-30", "2028-01-02"), ["2027-12-30", "2027-12-31", "2028-01-01"], "crosses the year boundary");
  assert.deepEqual(nochesDeEstancia("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29"], "leap day");
  assert.deepEqual(nochesDeEstancia("2027-03-30", "2027-03-26"), []); assert.deepEqual(nochesDeEstancia(null, "2027-03-26"), []); assert.deepEqual(nochesDeEstancia("2027-02-31", "2027-03-05"), []);
});

test("C2 coverage uses the validity's ranges MINUS its own exclusions; a code applies only when at least one occupied night is sold by that validity", () => {
  const v = V({ codigoId: 1, vigenciaId: 11, nombre: "Promo marzo", rangos: [{ fecha_inicio: "2027-03-01", fecha_fin: "2027-03-31" }], blackouts: [{ fecha_inicio: "2027-03-25", fecha_fin: "2027-03-28" }] });
  assert.equal(nochesDeVigencia(v).has("2027-03-26"), false, "excluded night is not sold");
  assert.equal(vigenciasQueExigenCodigo([v], 7, "2027-03-26", "2027-03-28").length, 0, "stay entirely inside the exclusion → the promotion does not cover it");
  assert.equal(vigenciasQueExigenCodigo([v], 7, "2027-03-26", "2027-03-30").length, 1, "night of the 28th is outside the exclusion and inside the validity");
  assert.equal(vigenciasQueExigenCodigo([v], 7, "2027-04-02", "2027-04-05").length, 0, "outside the validity");
  assert.equal(vigenciasQueExigenCodigo([v], 8, "2027-03-29", "2027-03-31").length, 0, "another hotel's configuration never applies");
  assert.equal(vigenciasQueExigenCodigo([V({ codigoId: 2, vigenciaId: 12, nombre: "x", fechaInicio: "2027-03-01", fechaFin: "2027-03-31", requerido: false })], 7, "2027-03-10", "2027-03-12").length, 0, "not required → not enforced");
});

test("C3 the sender must choose explicitly: send blocked until a covering code is chosen or «no promotion» is declared; wrong hotel/promotion/missing code rejected", () => {
  const a = V({ codigoId: 1, vigenciaId: 11, nombre: "Promo A", fechaInicio: "2027-03-01", fechaFin: "2027-03-31", codigo: "AAA-1" });
  const b = V({ codigoId: 2, vigenciaId: 12, nombre: "Promo B", fechaInicio: "2027-07-01", fechaFin: "2027-07-31", codigo: "BBB-2" });
  const otroHotel = V({ codigoId: 3, vigenciaId: 13, nombre: "Promo de otro hotel", hotelId: 99, fechaInicio: "2027-03-01", fechaFin: "2027-03-31", codigo: "ZZZ-9" });
  const sinDigitar = V({ codigoId: 4, vigenciaId: 14, nombre: "Promo sin código", fechaInicio: "2027-03-01", fechaFin: "2027-03-31", codigo: null });
  const todas = [a, b, otroHotel, sinDigitar];
  const base = { candidatas: todas, hotelId: 7, ingreso: "2027-03-10", salida: "2027-03-13" };
  const nada = resolverCodigo({ ...base, eleccion: {} });
  assert.equal(nada.ok, false); if (!nada.ok) assert.match(nada.error, /exige(n)? código/);
  const ok = resolverCodigo({ ...base, eleccion: { codigoId: 1 } });
  assert.deepEqual(ok, { ok: true, codigo: { codigoId: 1, hotelId: 7, texto: "AAA-1", promocion: "Promo A" }, sinPromocion: false });
  const sinPromo = resolverCodigo({ ...base, eleccion: { sinPromocion: true } }); assert.deepEqual(sinPromo, { ok: true, codigo: null, sinPromocion: true });
  for (const [eleccion, patron] of [[{ codigoId: 2 }, /no cubre las fechas/], [{ codigoId: 3 }, /no pertenece al hotel/], [{ codigoId: 4 }, /Falta digitar el código/], [{ codigoId: 1, sinPromocion: true }, /no ambas/], [{ codigoId: 555 }, /no pertenece al hotel/]] as const) {
    const r = resolverCodigo({ ...base, eleccion }); assert.equal(r.ok, false, JSON.stringify(eleccion)); if (!r.ok) assert.match(r.error, patron);
  }
  // no covering promotion → nothing required; a code that does not apply is still refused
  const fuera = { ...base, ingreso: "2027-09-01", salida: "2027-09-04" };
  assert.deepEqual(resolverCodigo({ ...fuera, eleccion: {} }), { ok: true, codigo: null, sinPromocion: false });
  assert.equal(resolverCodigo({ ...fuera, eleccion: { codigoId: 1 } }).ok, false);
  // codes differ per validity: the same hotel with two covering validities offers both and requires a choice
  const dos = resolverCodigo({ candidatas: [a, V({ ...a, codigoId: 5, vigenciaId: 15, nombre: "Promo A2", codigo: "A2-2" })], hotelId: 7, ingreso: "2027-03-10", salida: "2027-03-13", eleccion: {} });
  assert.equal(dos.ok, false); if (!dos.ok) assert.match(dos.error, /2 promociones/);
});

const L = (o: Partial<LineaPago> & { pagoId: number; numeroContrato: string }): LineaPago => ({ servicio: "Hotel", tipoProveedor: "hotel", fecha: "2027-01-15", valor: 1000000, moneda: "COP", trm: 1, valorObligacion: 1000000, pagadoAcumulado: 1000000, ...o });

test("D1 payment relation: several reservations, a partial payment and USD with TRM are shown exactly as persisted; totals per currency are never mixed; nothing is split", () => {
  const lineas = [
    L({ pagoId: 1, numeroContrato: "DTM-0001", valor: 1500000, valorObligacion: 4000000, pagadoAcumulado: 1500000 }),       // partial: 1.5M of 4M
    L({ pagoId: 2, numeroContrato: "DTM-0002", valor: 2500000, valorObligacion: 2500000, pagadoAcumulado: 2500000 }),
    L({ pagoId: 3, numeroContrato: "DTM-0003", valor: 100, moneda: "USD", trm: 4000, valorObligacion: 300, pagadoAcumulado: 100 }),  // USD 100 paid at 4.000 = COP 400.000
    L({ pagoId: 4, numeroContrato: "DTM-0003", valor: 50, moneda: "USD", trm: 4100, valorObligacion: 300, pagadoAcumulado: 150, fecha: "2027-01-20" }),
  ];
  const t = totalesPago(lineas);
  assert.deepEqual(t, [{ moneda: "COP", total: 4000000, equivalenteCop: null }, { moneda: "USD", total: 150, equivalenteCop: 605000 }], "COP 1.5M+2.5M; USD 100+50, pesos 100×4000 + 50×4100");
  const c = construirCorreoPago({ proveedor: "Hotel Sol", referencia: "TRF-889", lineas, adjuntos: [{ nombre: "comprobante.pdf", bytes: 20480 }] });
  assert.match(c.asunto, /Aviso de pago · Hotel Sol · 15\/01\/2027 a 20\/01\/2027 · Ref\. TRF-889/);
  for (const hecho of ["DTM-0001", "DTM-0002", "DTM-0003", "Obligación total", "Pagado acumulado", "TRF-889", "comprobante.pdf (20 KB)", "TRM 4000", "TRM 4100"]) assert.ok(c.html.includes(hecho) && c.texto.includes(hecho), hecho);
  assert.match(c.texto, /Total COP: COP 4\.000\.000/); assert.match(c.texto, /Total USD: USD 150,00 \(equivalente pagado en pesos: COP 605\.000\)/);
  assert.doesNotMatch(c.html + c.texto, /undefined|NaN/);
});

test("D2 a single payment with no attachment says so honestly; the intro does not promise an attachment that is not there", () => {
  const c = construirCorreoPago({ proveedor: "Receptivo X", referencia: null, lineas: [L({ pagoId: 9, numeroContrato: "DTM-0009" })], adjuntos: [] });
  assert.match(c.texto, /el siguiente pago/); assert.doesNotMatch(c.texto + c.html, /Adjuntamos|Soportes adjuntos/); assert.doesNotMatch(c.asunto, /Ref\./);
});

test("E1 Svix signature (Resend webhooks): valid, tampered body, wrong secret, stale timestamp, missing parts, multiple signatures", () => {
  // Independent construction following the documented scheme (not via the function under test): key = base64-decoded part after «whsec_», signed content = id.timestamp.body.
  const clave = Buffer.from("clave-de-prueba-0123456789abcdef"); const secreto = `whsec_${clave.toString("base64")}`;
  const id = "msg_2abc", ts = "1796000000", cuerpo = '{"type":"email.delivered","data":{"email_id":"e1"}}';
  const firma = createHmac("sha256", clave).update(`${id}.${ts}.${cuerpo}`).digest("base64");
  const ahoraMs = Number(ts) * 1000 + 60_000;
  const ok = (o: Partial<Parameters<typeof firmaSvixValida>[0]> = {}) => firmaSvixValida({ id, timestamp: ts, firma: `v1,${firma}`, cuerpoCrudo: cuerpo, secreto, ahoraMs, ...o });
  assert.equal(ok(), true);
  assert.equal(ok({ firma: `v1,AAAA v1,${firma}` }), true, "any of several signatures");
  assert.equal(ok({ cuerpoCrudo: cuerpo + " " }), false); assert.equal(ok({ secreto: `whsec_${Buffer.from("otra").toString("base64")}` }), false);
  assert.equal(ok({ ahoraMs: Number(ts) * 1000 + 10 * 60_000 }), false, "older than 5 min");
  for (const k of ["id", "timestamp", "firma", "secreto"] as const) assert.equal(ok({ [k]: undefined }), false, `missing ${k}`);
  assert.equal(ok({ firma: `v2,${firma}` }), false, "unknown version");
});

test("E2 Resend events map to neutral events; dedupe = Svix id; received replies are correlated by the token in `to`; unknown types are ignored", () => {
  const token = "T".repeat(32);
  const entrega = normalizarEventoResend({ type: "email.delivered", data: { email_id: "re_1", to: ["prov@hotel.com"] } }, "msg_A");
  assert.deepEqual([entrega?.tipo, entrega?.dedupe, entrega?.externoId, entrega?.token], ["entrega", "msg_A", "re_1", null]);
  const rebote = normalizarEventoResend({ type: "email.bounced", data: { email_id: "re_1", bounce: { message: "buzón lleno" } } }, "msg_B");
  assert.equal(rebote?.tipo, "rebote"); assert.equal(rebote?.resumen.error, "buzón lleno");
  const resp = normalizarEventoResend({ type: "email.received", data: { email_id: "in_9", from: "Prov <prov@hotel.com>", to: [`respuestas+${token}@dspacios.test`], subject: "Re: Solicitud" } }, "msg_C");
  assert.deepEqual([resp?.tipo, resp?.token, resp?.resumen.asunto], ["respuesta", token, "Re: Solicitud"]);
  assert.equal(normalizarEventoResend({ type: "email.opened", data: {} }, "msg_D"), null); assert.equal(normalizarEventoResend({ type: "email.delivered" }, ""), null); assert.equal(normalizarEventoResend(null, "x"), null);
});

test("E3 transports carry the plain-text part and attachments; ambiguous failures are flagged uncertain, clear rejections are not; idempotency is declared", async () => {
  const capturas: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = (estado: number, cuerpo: unknown = { ID: "m1", id: "r1" }) => (async (url: string | URL | Request, init?: RequestInit) => { capturas.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: (init?.headers ?? {}) as Record<string, string> }); return new Response(JSON.stringify(cuerpo), { status: estado }); }) as typeof fetch;
  const m = { de: "a@b.test", para: ["p@x.test"], responderA: "r@b.test", asunto: "S", html: "<p>h</p>", texto: "t", adjuntos: [{ nombre: "c.pdf", contentType: "application/pdf", base64: "QUJD" }], claveIdempotencia: "k:v1" };
  const cap = transporteCaptura("http://127.0.0.1:18025", f(200)); assert.equal(cap.idempotente, false);
  assert.deepEqual(await cap.enviar(m), { ok: true, mensajeId: "m1" });
  assert.equal(capturas[0].body.Text, "t"); assert.deepEqual(capturas[0].body.Attachments, [{ Filename: "c.pdf", Content: "QUJD", ContentType: "application/pdf" }]);
  const res = transporteResend("key", f(200)); assert.equal(res.idempotente, true); assert.ok(res.ventanaIdempotenciaMs < 24 * 3600_000);
  await res.enviar(m);
  const rs = capturas[1]; assert.equal(rs.url, "https://api.resend.com/emails"); assert.equal(rs.body.text, "t"); assert.deepEqual(rs.body.attachments, [{ filename: "c.pdf", content: "QUJD" }]); assert.equal(rs.headers["Idempotency-Key"], "k:v1");
  for (const [estado, incierto] of [[400, false], [422, false], [429, false], [500, true], [503, true], [409, true]] as const) {
    const r = await transporteResend("key", f(estado, {})).enviar(m); assert.equal(r.ok, false); if (!r.ok) assert.equal(!!r.incierto, incierto, String(estado));
  }
  const caido = await transporteResend("key", (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch).enviar(m);
  assert.equal(caido.ok, false); if (!caido.ok) assert.equal(caido.incierto, true, "a network failure may have reached the provider");
});
