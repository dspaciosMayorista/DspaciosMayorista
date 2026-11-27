// #103 — supplier requests by email: pure core. Correlation token, recipient validation, idempotency key, neutral event normalisation (stable dedupe), HMAC signature, mail modes (nothing leaves the
// machine unless explicitly configured) and the email-safe document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validarDestinatarios, claveEnvio, generarToken, direccionRespuesta, tokenDeDirecciones, normalizarEvento, firmaValida, RANGO } from "../lib/solicitudProveedor/nucleo.ts";
import { configCorreo, esLoopback, modoCorreo, transporteCaptura } from "../lib/solicitudProveedor/transporte.ts";

test("recipients: validated, lowercased, de-duplicated, 1–5, no header injection", () => {
  assert.deepEqual(validarDestinatarios(" Reservas@Hotel.com; reservas@hotel.com,\n ventas@hotel.co "), { ok: true, destinatarios: ["reservas@hotel.com", "ventas@hotel.co"] });
  for (const mal of ["", "   ", "sin-arroba", "a@b", "x@y.com\r\nBcc: z@z.com", "a@b.com,,@x.com", "<script>@x.com"]) assert.equal(validarDestinatarios(mal).ok, false, mal);
  assert.equal(validarDestinatarios("a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com").ok, false, "max 5");
});

test("idempotency key: same inputs → same key (order of recipients irrelevant); any change in recipients/content/voucher/version → different key", () => {
  const base = { voucherId: 7, numero: "00-0451", destinatarios: ["a@x.com", "b@x.com"], contenido: { hotel: "H" }, version: 1 };
  const k = claveEnvio(base);
  assert.equal(claveEnvio({ ...base, destinatarios: ["b@x.com", "A@x.com"] }), k);
  assert.notEqual(claveEnvio({ ...base, destinatarios: ["a@x.com"] }), k);
  assert.notEqual(claveEnvio({ ...base, contenido: { hotel: "H2" } }), k);
  assert.notEqual(claveEnvio({ ...base, voucherId: 8 }), k);
  assert.notEqual(claveEnvio({ ...base, version: 2 }), k);
  assert.match(k, /^[0-9a-f]{40}:v1$/);
  assert.equal(claveEnvio({ ...base, contenido: { b: 1, a: { y: [1, { q: 2, p: 3 }], x: 0 } } }), claveEnvio({ ...base, contenido: { a: { x: 0, y: [1, { p: 3, q: 2 }] }, b: 1 } }), "key order never changes the key (jsonb reorders keys)");
});

test("correlation token: unguessable, e-mail safe, round-trips through the plus-addressed Reply-To, ignores look-alikes", () => {
  const t = generarToken(); assert.match(t, /^[A-Za-z0-9_-]{32}$/); assert.notEqual(t, generarToken());
  const d = direccionRespuesta("respuestas@dspaciostravel.com", t);
  assert.equal(d, `respuestas+${t}@dspaciostravel.com`);
  assert.equal(tokenDeDirecciones(["otro@x.com", d]), t);
  assert.equal(tokenDeDirecciones([`Proveedor <${d}>`]), t, "display-name form");
  assert.equal(tokenDeDirecciones(["respuestas+corto@x.com", "respuestas@x.com", "a+b+c@x.com"]), null, "short / untagged / malformed ignored");
  assert.equal(direccionRespuesta("respuestas+viejo@x.com", t), `respuestas+${t}@x.com`, "a tag already in the base is replaced, not stacked");
});

test("events: neutral body → normalised; the SAME delivery twice has the SAME dedupe; unknown shapes are ignored", () => {
  const t = generarToken();
  const body = { tipo: "respuesta", para: [`respuestas+${t}@d.com`], de: "hotel@h.com", asunto: "Re: x", texto: "Confirmado".repeat(500) };
  const a = normalizarEvento(body)!, b = normalizarEvento({ ...body })!;
  assert.equal(a.tipo, "respuesta"); assert.equal(a.token, t); assert.equal(a.dedupe, b.dedupe); assert.match(a.dedupe, /^h:/);
  assert.equal(a.resumen.texto!.length, 2000, "reply text is truncated: a pointer, not a mailbox replica");
  assert.notEqual(normalizarEvento({ ...body, texto: "otra respuesta" })!.dedupe, a.dedupe, "a different reply is a different event");
  assert.equal(normalizarEvento({ tipo: "entrega", evento_id: "evt_1", token: t })!.dedupe, "evt_1", "provider event id wins");
  assert.equal(normalizarEvento({ tipo: "entrega", token: "demasiado-corto" })!.token, null, "bad token ignored");
  for (const mal of [null, undefined, "x", 5, {}, { tipo: "borrar_todo" }, []]) assert.equal(normalizarEvento(mal), null);
});

test("webhook signature: HMAC-SHA256 of the RAW body, constant time, fails closed", () => {
  const cuerpo = JSON.stringify({ tipo: "entrega" }), s = "secreto-local";
  const firma = createHmac("sha256", s).update(cuerpo).digest("hex");
  assert.equal(firmaValida(cuerpo, firma, s), true);
  assert.equal(firmaValida(cuerpo, `sha256=${firma.toUpperCase()}`, s), true);
  assert.equal(firmaValida(cuerpo + " ", firma, s), false, "body tampered");
  assert.equal(firmaValida(cuerpo, firma, "otro"), false);
  assert.equal(firmaValida(cuerpo, firma, undefined), false, "no secret configured → never valid");
  assert.equal(firmaValida(cuerpo, null, s), false);
  assert.equal(firmaValida(cuerpo, "abc", s), false, "different length");
});

test("state ranks mirror the SQL function (only forward; confirmation > reply > delivery > sent)", () => {
  assert.ok(RANGO.enviada < RANGO.entregada && RANGO.entregada < RANGO.respondida && RANGO.respondida < RANGO.confirmada);
  assert.equal(RANGO.fallida, RANGO.enviando); assert.equal(RANGO.incierta, RANGO.enviando); assert.equal(RANGO.confirmada, RANGO.rechazada);
});

test("mail modes: OFF by default; capture only accepts this machine; live needs every owner decision", () => {
  assert.equal(modoCorreo({}), "off"); assert.equal(modoCorreo({ SOLICITUD_PROVEEDOR_EMAIL: "cualquier cosa" }), "off");
  const off = configCorreo({}); assert.equal(off.ok, false); if (!off.ok) assert.match(off.error, /no está habilitado/);
  assert.equal(configCorreo({ SOLICITUD_PROVEEDOR_EMAIL: "captura" }).ok, false, "capture needs its URL");
  assert.equal(configCorreo({ SOLICITUD_PROVEEDOR_EMAIL: "captura", SOLICITUD_PROVEEDOR_CAPTURA_URL: "https://mail.externo.com" }).ok, false, "a non-loopback capture URL is refused");
  assert.equal(configCorreo({ SOLICITUD_PROVEEDOR_EMAIL: "captura", SOLICITUD_PROVEEDOR_CAPTURA_URL: "http://127.0.0.1:18025" }).ok, true);
  const v = configCorreo({ SOLICITUD_PROVEEDOR_EMAIL: "vivo" }); assert.equal(v.ok, false);
  if (!v.ok) { assert.match(v.error, /RESEND_API_KEY/); assert.match(v.error, /SOLICITUD_PROVEEDOR_REMITENTE/); assert.match(v.error, /SOLICITUD_PROVEEDOR_RESPONDER_A/); assert.doesNotMatch(v.error, /re_|sk_/); }
  assert.equal(configCorreo({ SOLICITUD_PROVEEDOR_EMAIL: "vivo", RESEND_API_KEY: "k", SOLICITUD_PROVEEDOR_REMITENTE: "a@b.com", SOLICITUD_PROVEEDOR_RESPONDER_A: "r@b.com" }).ok, true);
  assert.equal(esLoopback("http://localhost:8025"), true); assert.equal(esLoopback("http://[::1]:8025"), true); assert.equal(esLoopback("http://127.0.0.1.evil.com"), false); assert.equal(esLoopback("nope"), false);
  assert.throws(() => transporteCaptura("https://api.resend.com"), /esta máquina/);
});

