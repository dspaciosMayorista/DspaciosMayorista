// #78 — «Solicitar contrato»: la Server Action REAL del portal (`app/portal/b2b/cotizaciones/actions.ts`) con la sesión y la RPC simuladas, y las reglas puras de presentación.
// Se prueba: el aliado sale de la SESIÓN (un id ajeno que mande el navegador no cambia el actor), sin sesión/otro rol no se llama a la RPC, cada código de error de la base
// se traduce a un mensaje claro, una respuesta rara nunca se presenta como éxito, y el texto cuenta la verdad cuando no hay responsables configurados.
// La semántica de base de datos (propiedad, idempotencia, reemplazo tras cambios, destinatarios, aislamiento) está en supabase/scripts/test_323_solicitud_contrato.sql.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// `next` no publica mapa "exports": en ESM plano sus subrutas no resuelven (mismo truco que cambiarTenant237).
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/cache" ? s + ".js" : s, c); }'));

type Ctx = { estado: string; userId?: string };
let ctx: Ctx;
const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
let respuestaRpc: { data: unknown; error: { code?: string; message?: string } | null };
let revalidados: string[] = [];

mock.module("@/lib/portal/b2bPortalServidor", { namedExports: { resolverContextoPortal: async () => ctx } });
mock.module("@/lib/supabase/admin", {
  namedExports: { createAdminClient: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return respuestaRpc; } }) },
});
mock.module("next/cache", { namedExports: { revalidatePath: (p: string) => { revalidados.push(p); } } });

const { solicitarContratoCotizacion } = await import("../app/portal/b2b/cotizaciones/actions.ts");
const { mensajeErrorSolicitud, textoSolicitud, textoResultado, puedeSolicitarContrato } = await import("../lib/portal/solicitudContrato.ts");
const { textoAviso } = await import("../lib/avisos/presentacion.ts");

beforeEach(() => {
  ctx = { estado: "ok", userId: "u-aliado" }; rpcs.length = 0; revalidados = [];
  respuestaRpc = { data: { estado: "solicitada", id: 1, notificados: 2 }, error: null };
});

describe("acción solicitarContratoCotizacion", () => {
  test("camino feliz: una sola RPC con el actor de la SESIÓN; refresca la pestaña", async () => {
    assert.deepEqual(await solicitarContratoCotizacion(41), { ok: true, estado: "solicitada", notificados: 2 });
    assert.deepEqual(rpcs, [{ fn: "solicitar_contrato_cotizacion", args: { p_cotizacion_id: 41, p_actor: "u-aliado" } }]);
    assert.deepEqual(revalidados, ["/portal/b2b/cotizaciones"]);
  });

  test("sin sesión de aliado (visitante, pendiente o interno) no se llama a la base", async () => {
    for (const estado of ["visitante", "pendiente", "interno"]) {
      ctx = { estado };
      const r = await solicitarContratoCotizacion(41);
      assert.equal(r.ok, false);
      assert.equal(rpcs.length, 0);
    }
  });

  test("id inválido (0, negativo, decimal, NaN): ni se resuelve la sesión ni se llama a la base", async () => {
    for (const id of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal((await solicitarContratoCotizacion(id)).ok, false);
    assert.equal(rpcs.length, 0);
  });

  test("cada código de error de la base se traduce; ninguno se presenta como éxito ni revalida", async () => {
    const esperado: Record<string, RegExp> = {
      F4601: /no puede solicitar/, F4602: /No encontramos esa cotización/, F4603: /ya es un contrato/, F4604: /no admite/, F4605: /venció/, F4606: /salida ya pasó/,
    };
    for (const [code, patron] of Object.entries(esperado)) {
      respuestaRpc = { data: null, error: { code, message: "SOLICITUD_X: detalle interno" } };
      const r = await solicitarContratoCotizacion(7);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, patron);
      assert.doesNotMatch((r as { error: string }).error, /SOLICITUD_X|detalle interno/, "no se filtra el texto de la base");
    }
    assert.deepEqual(revalidados, []);
  });

  test("un error desconocido o una respuesta con forma rara son un fallo genérico, nunca «solicitada»", async () => {
    respuestaRpc = { data: null, error: { code: "XX000", message: "boom" } };
    assert.match(((await solicitarContratoCotizacion(7)) as { error: string }).error, /No pudimos registrar tu solicitud/);
    for (const data of [null, {}, { estado: "otra" }, "ok"]) {
      respuestaRpc = { data, error: null };
      assert.equal((await solicitarContratoCotizacion(7)).ok, false);
    }
    assert.deepEqual(revalidados, []);
  });

  test("idempotencia y reemplazo se reportan tal cual los decide la base", async () => {
    respuestaRpc = { data: { estado: "ya_solicitada", notificados: 2 }, error: null };
    assert.deepEqual(await solicitarContratoCotizacion(7), { ok: true, estado: "ya_solicitada", notificados: 2 });
    respuestaRpc = { data: { estado: "reemplazada", notificados: 0 }, error: null };
    assert.deepEqual(await solicitarContratoCotizacion(7), { ok: true, estado: "reemplazada", notificados: 0 });
  });
});

describe("presentación", () => {
  test("honestidad con 0 responsables: se dice que quedó registrada pero nadie fue avisado", () => {
    assert.match(textoSolicitud({ notificados: 2 }, "20 nov 2026"), /Avisamos a D'spacios dentro de la plataforma/);
    const sin = textoSolicitud({ notificados: 0 }, "20 nov 2026");
    assert.match(sin, /Quedó registrado/);
    assert.match(sin, /no hay responsables configurados/);
    assert.doesNotMatch(sin, /Avisamos a D'spacios/);
    assert.match(textoResultado({ estado: "solicitada", notificados: 0 }), /contacta a tu asesor/);
    assert.doesNotMatch(textoResultado({ estado: "solicitada", notificados: 0 }), /Avisamos/);
    assert.match(textoResultado({ estado: "ya_solicitada", notificados: 2 }), /no ha cambiado/);
  });

  test("solo una cotización vigente y simple admite el botón", () => {
    assert.equal(puedeSolicitarContrato("vigente", "simple"), true);
    assert.equal(puedeSolicitarContrato("vigente", null), true);
    for (const e of ["convertida", "elegida", "salida_pasada", "vencida"] as const) assert.equal(puedeSolicitarContrato(e, "simple"), false, e);
    assert.equal(puedeSolicitarContrato("vigente", "comparativa"), false);
  });

  test("mensajes de error sin código: genérico", () => {
    assert.match(mensajeErrorSolicitud(undefined), /No pudimos registrar/);
    assert.match(mensajeErrorSolicitud("OTRO"), /No pudimos registrar/);
  });

  test("el aviso interno nombra la cotización (no un contrato) y no revela cliente ni montos", () => {
    const t = textoAviso("solicitud_contrato", "C-0042");
    assert.equal(t, "Solicitud de contrato de un aliado: cotización C-0042");
    assert.doesNotMatch(t, /\$|COP|USD/);
  });
});
