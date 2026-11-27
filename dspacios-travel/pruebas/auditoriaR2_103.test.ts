// #103 — Codex round-2 reproducers (docs/tecnico/evidence-h103-r2-codex-probes.mjs), ported to the SAME in-memory boundaries and asserting the CORRECTED behaviour. No network, no SQL.
// Each case keeps its healthy control next to the injected failure so a pass cannot be an artefact of an unreachable code path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarSolicitud } from "../lib/solicitudProveedor/cargar.ts";
import { enviarSolicitud, reintentarEnvio } from "../lib/solicitudProveedor/servicio.ts";

type Estado = { eqs: Record<string, unknown>; ins: unknown };
function query(result: (s: Estado, single: boolean) => unknown) {
  const state: Estado = { eqs: {}, ins: null };
  const q: Record<string, unknown> = {
    select() { return q; }, eq(k: string, v: unknown) { state.eqs[k] = v; return q; }, in() { return q; }, order() { return q; }, like() { return q; },
    insert(v: unknown) { state.ins = v; return q; }, upsert() { return q; },
    async maybeSingle() { return result(state, true); },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve(result(state, false)).then(resolve, reject); },
  };
  return q;
}
function cliente(opts: { falla?: string; hoteles?: { id: number; nombre: string }[]; filas?: { nombre: string; fecha_ingreso: string; fecha_salida: string }[] } = {}) {
  const hoteles = opts.hoteles ?? [{ id: 1, nombre: "Hotel A" }, { id: 2, nombre: "Unrelated hotel B" }];
  const filas = opts.filas ?? [{ nombre: "Hotel A", fecha_ingreso: "2027-01-02", fecha_salida: "2027-01-04" }];
  return { from(tabla: string) { return query((state, single) => {
    if (opts.falla === tabla) return { data: null, error: { code: "injected", message: `${tabla} query failed` } };
    let data: unknown = [];
    if (tabla === "ventas") data = { tenant: "mayorista", cliente: "Demo", destino: null, fecha_salida: "2027-01-02", fecha_regreso: "2027-01-04", pax: 2 };
    if (tabla === "contrato_hoteles") data = filas.map((f) => ({ ...f, ciudad: null, categoria: null, alimentacion: null, acomodacion: null, detalle_acomodacion: null, orden: 1 }));
    if (tabla === "contrato_servicios" || tabla === "contrato_pasajeros") data = [];
    if (tabla === "hoteles") data = single ? { id: state.eqs.id, nombre: "x" } : hoteles;
    if (tabla === "hotel_codigos_promocion") data = [{ id: 10, hotel_id: 1, vigencia_id: 100, requerido: true, codigo: "REQUIRED-A" }];
    if (tabla === "hotel_temporadas") data = [{ id: 100, nombre: "Promo A", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", rangos: [], blackouts: [] }];
    return { data, error: null };
  }); } } as never;
}

test("R2-3 a failed code-catalogue / validity / hotel / contract read fails CLOSED; the healthy control still demands the code; a genuine no-code case still passes", async () => {
  const control = await armarSolicitud(cliente(), "DEMO", "Supplier", 1, {});
  assert.equal(control.ok, false); if (!control.ok) assert.match(control.error, /exige.*código/);
  for (const tabla of ["hotel_codigos_promocion", "hotel_temporadas", "hoteles", "contrato_hoteles", "contrato_pasajeros", "ventas"]) {
    for (const hotelId of [1, null]) {
      const r = await armarSolicitud(cliente({ falla: tabla }), "DEMO", "Supplier", hotelId, { sinPromocion: true });
      assert.equal(r.ok, false, `${tabla} (hotel ${hotelId}) must block the send`);
    }
  }
  const fuera = await armarSolicitud(cliente({ filas: [{ nombre: "Hotel A", fecha_ingreso: "2027-06-02", fecha_salida: "2027-06-04" }] }), "DEMO", "Supplier", 1, {});
  assert.equal(fuera.ok, true); if (fuera.ok) assert.equal(fuera.codigo, null);
});

test("R2-4 an existing UNRELATED hotel is rejected (the healthy hotel A control is unchanged); no catalogue hotel + a name match with a covering code is rejected", async () => {
  const b = await armarSolicitud(cliente(), "DEMO", "Supplier", 2, {});
  assert.equal(b.ok, false); if (!b.ok) assert.match(b.error, /no corresponde a ningún hotel de esta reserva/);
  const nulo = await armarSolicitud(cliente(), "DEMO", "Supplier", null, {});
  assert.equal(nulo.ok, false); if (!nulo.ok) assert.match(nulo.error, /selecciona el hotel/);
  const a = await armarSolicitud(cliente(), "DEMO", "Supplier", 1, { codigoId: 10 });
  assert.equal(a.ok, true); if (a.ok) assert.equal(a.codigo?.texto, "REQUIRED-A");
});

const T = { idempotente: true, ventanaIdempotenciaMs: 23 * 3600_000 };
function adminEnMemoria(fila: Record<string, unknown>, trozo: { rpc?: number } = {}) {
  const estado = { ...fila };
  return { from() { return query((s) => (s.ins ? { data: null, error: { code: "23505", message: "dup" } } : { data: estado, error: null })); },
    async rpc(nombre: string) { return nombre === "reclamar_envio_solicitud_proveedor" ? { data: trozo.rpc ?? 2, error: null } : { data: [{ estado_nuevo: "enviada" }], error: null }; } } as never;
}
const cfg = { modo: "captura" as const, remitente: "a@example.test", responderA: "b@example.test" };
const horas = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const filaFallida = (h: number, ambiguo: boolean) => ({ id: 1, tipo: "solicitud", estado: "fallida", ambiguo, created_at: horas(h), envio_iniciado_en: horas(h), destinatarios: ["demo@example.test"], token_respuesta: "x".repeat(32), clave_envio: "k", asunto: "S", payload: { html: "<p>original</p>", texto: "original", adjuntos: [], pagoIds: [] }, intentos: 1 });

test("R2-1 a 25-hour-old AMBIGUOUS failure never reaches the provider again (identical click or retry-by-id); a clear failure and an in-window ambiguity still retry", async () => {
  let envios = 0; const transporte = { ...T, async enviar() { envios++; return { ok: true as const, mensajeId: "m" }; } };
  const entrada = { tipo: "pago" as const, numero: null, contratoUid: null, tenant: "mayorista", proveedor: "Supplier", contenido: { payment: 1 }, destinatarios: ["demo@example.test"], correo: { asunto: "Demo", html: "Demo", texto: "Demo" }, creadoPor: null };
  const click = await enviarSolicitud({ admin: adminEnMemoria(filaFallida(25, true)), transporte, config: cfg }, entrada);
  assert.equal(click.ok, false); assert.equal(envios, 0, "an identical click on an existing failed request does not call the provider (it points to the retry)");
  const viejo = await reintentarEnvio({ admin: adminEnMemoria(filaFallida(25, true)), transporte, config: cfg }, 1);
  assert.equal(viejo.ok, false); assert.equal(envios, 0, "ambiguous + expired window → no provider call");
  const claro = await reintentarEnvio({ admin: adminEnMemoria(filaFallida(25, false)), transporte, config: cfg }, 1);
  assert.equal(claro.ok, true); assert.equal(envios, 1, "a clear (known unsent) failure may be retried at any age");
  const dentro = await reintentarEnvio({ admin: adminEnMemoria(filaFallida(2, true)), transporte, config: cfg }, 1);
  assert.equal(dentro.ok, true); assert.equal(envios, 2, "an ambiguous failure inside the window is retried (same key)");
  const sinIdem = await reintentarEnvio({ admin: adminEnMemoria(filaFallida(1, true)), transporte: { idempotente: false, ventanaIdempotenciaMs: 0, async enviar() { envios++; return { ok: true as const, mensajeId: "m" }; } }, config: cfg }, 1);
  assert.equal(sinIdem.ok, false); assert.equal(envios, 2, "a provider that does not deduplicate never gets an ambiguous retry");
});

test("R2-2 the retry sends the STORED message (html/text/recipients), whatever the current data says", async () => {
  const vistos: { html: string; para: string[] }[] = [];
  const r = await reintentarEnvio({ admin: adminEnMemoria(filaFallida(1, false)), transporte: { ...T, async enviar(m) { vistos.push({ html: m.html, para: m.para }); return { ok: true as const, mensajeId: "m" }; } }, config: cfg }, 1);
  assert.equal(r.ok, true); assert.deepEqual(vistos, [{ html: "<p>original</p>", para: ["demo@example.test"] }]);
  const sinPayload = await reintentarEnvio({ admin: adminEnMemoria({ ...filaFallida(1, false), payload: {} }), transporte: { ...T, async enviar() { throw new Error("no debe enviar"); } }, config: cfg }, 1);
  assert.equal(sinPayload.ok, false, "a request without its frozen message is not rebuilt from current data");
});

// ── R3-2 · Codex round-3 probe (docs/tecnico/evidence-h103-r3-multistay.mjs) ported to the same in-memory boundary: one supplier, Hotel A and Hotel B, each with a covering REQUIRED code ──────────────────────
function clienteMulti() {
  const hoteles = [{ id: 1, nombre: "Hotel A" }, { id: 2, nombre: "Hotel B" }];
  return { from(tabla: string) {
    const q: Record<string, unknown> = { select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, async maybeSingle() { return { data: { tenant: "mayorista", cliente: "Demo", pax: 2 }, error: null }; },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        let data: unknown[] = [];
        if (tabla === "hoteles") data = hoteles;
        if (tabla === "contrato_hoteles") data = hoteles.map((h) => ({ ...h, ciudad: null, categoria: null, alimentacion: null, acomodacion: null, detalle_acomodacion: null, orden: h.id, fecha_ingreso: "2027-01-02", fecha_salida: "2027-01-04" }));
        if (tabla === "hotel_codigos_promocion") data = hoteles.map((h) => ({ id: h.id * 10, hotel_id: h.id, vigencia_id: h.id * 100, requerido: true, codigo: `CODE-${h.id}` }));
        if (tabla === "hotel_temporadas") data = hoteles.map((h) => ({ id: h.id * 100, nombre: `Promo ${h.nombre}`, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", rangos: [], blackouts: [] }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      } };
    return q;
  } } as never;
}

test("R3-2 the auditor's probe: the full request is blocked, but EACH hotel's stay now succeeds on its own with its own code; the message and the data carry only that stay; cross choices stay rejected", async () => {
  const todo = await armarSolicitud(clienteMulti(), "DEMO", "Same supplier", 1, { codigoId: 10 });
  assert.equal(todo.ok, false); if (!todo.ok) assert.match(todo.error, /otro hotel[\s\S]*solicitud aparte/);
  for (const [id, nombre, otro] of [[1, "Hotel A", "Hotel B"], [2, "Hotel B", "Hotel A"]] as const) {
    const r = await armarSolicitud(clienteMulti(), "DEMO", "Same supplier", id, { codigoId: id * 10 }, { estanciaIds: [id], servicios: false });
    assert.equal(r.ok, true, `${nombre} alone`); if (!r.ok) continue;
    assert.equal(r.codigo?.texto, `CODE-${id}`); assert.deepEqual(r.datos.hoteles.map((h) => h.nombre), [nombre]);
    for (const t of [r.correo.html, r.correo.texto, JSON.stringify(r.datos)]) { assert.match(t, new RegExp(`CODE-${id}|${nombre}`)); assert.doesNotMatch(t, new RegExp(`CODE-${id === 1 ? 2 : 1}|${otro}`), `${nombre}: nothing of ${otro}`); }
  }
  // the other stay's hotel, or the other hotel's code, is still rejected; unrelated hotel too
  const cruz = await armarSolicitud(clienteMulti(), "DEMO", "Same supplier", 2, { codigoId: 20 }, { estanciaIds: [1], servicios: false }); assert.equal(cruz.ok, false);
  const codigoAjeno = await armarSolicitud(clienteMulti(), "DEMO", "Same supplier", 1, { codigoId: 20 }, { estanciaIds: [1], servicios: false }); assert.equal(codigoAjeno.ok, false);
  const inexistente = await armarSolicitud(clienteMulti(), "DEMO", "Same supplier", 1, { codigoId: 10 }, { estanciaIds: [1, 99], servicios: false }); assert.equal(inexistente.ok, false);
  const vacia = await armarSolicitud(clienteMulti(), "DEMO", "Same supplier", null, {}, { estanciaIds: [], servicios: false }); assert.equal(vacia.ok, false);
});
