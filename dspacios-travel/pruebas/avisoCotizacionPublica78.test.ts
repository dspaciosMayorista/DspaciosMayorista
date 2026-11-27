// #78 residual — aviso interno por una cotización pública de un visitante SIN sesión (migración 340). Se prueba el cliente de la RPC con la base simulada y se fijan los
// puntos de enlace de los tres orígenes públicos. La semántica de base de datos (quién es visitante, destinatarios, idempotencia, aislamiento) está en
// supabase/scripts/test_340_aviso_cotizacion_publica.sql; los flujos reales con base están en el recorrido local descrito en docs/tecnico/crm-block2-27-28-76-78.md.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { avisarCotizacionPublica, avisarYRegistrar, leerRespuestaAvisoPublico, logAvisoPublico } from "../lib/avisos/cotizacionPublica.ts";
import { textoAviso, TIPOS_AVISO_DE_COTIZACION } from "../lib/avisos/presentacion.ts";

type RespuestaRpc = { data: unknown; error: { code?: string } | null };
function admin(respuesta: RespuestaRpc | (() => RespuestaRpc), llamadas: { fn: string; args: Record<string, unknown> }[] = []) {
  return {
    cliente: { rpc: async (fn: string, args: Record<string, unknown>) => { llamadas.push({ fn, args }); return typeof respuesta === "function" ? respuesta() : respuesta; } } as never,
    llamadas,
  };
}

describe("avisarCotizacionPublica", () => {
  test("hace UNA llamada a la función de base con solo el id de la cotización y devuelve lo que la base decidió", async () => {
    const a = admin({ data: { estado: "avisada", notificados: 2 }, error: null });
    const r = await avisarCotizacionPublica(a.cliente, 41);
    assert.deepEqual(r, { ok: true, estado: "avisada", notificados: 2 });
    assert.equal(a.llamadas.length, 1);
    assert.deepEqual(a.llamadas[0], { fn: "avisar_cotizacion_publica", args: { p_cotizacion_id: 41 } });
  });

  test("no_aplica y 0 destinatarios son resultados válidos (no un error)", async () => {
    assert.deepEqual(await avisarCotizacionPublica(admin({ data: { estado: "no_aplica", notificados: 0 }, error: null }).cliente, 7), { ok: true, estado: "no_aplica", notificados: 0 });
    assert.deepEqual(await avisarCotizacionPublica(admin({ data: { estado: "avisada", notificados: 0 }, error: null }).cliente, 7), { ok: true, estado: "avisada", notificados: 0 });
  });

  test("un id inválido no llega a la base", async () => {
    for (const id of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const a = admin({ data: { estado: "avisada", notificados: 1 }, error: null });
      assert.deepEqual(await avisarCotizacionPublica(a.cliente, id), { ok: false, codigo: "id_invalido" });
      assert.equal(a.llamadas.length, 0);
    }
  });

  test("un error de la base o una excepción devuelven un fallo con SOLO el código, sin lanzar", async () => {
    assert.deepEqual(await avisarCotizacionPublica(admin({ data: null, error: { code: "42501" } }).cliente, 9), { ok: false, codigo: "42501" });
    const lanza = admin(() => { throw new Error("detalle interno con datos del cliente"); });
    assert.deepEqual(await avisarCotizacionPublica(lanza.cliente, 9), { ok: false, codigo: "excepcion" });
  });

  test("una respuesta con forma inesperada NUNCA se toma por éxito", () => {
    for (const rara of [null, undefined, "avisada", 7, {}, { estado: "avisada" }, { estado: "avisada", notificados: "2" }, { estado: "avisada", notificados: -1 }, { estado: "avisada", notificados: 1.5 }, { estado: "otra", notificados: 1 }]) {
      assert.deepEqual(leerRespuestaAvisoPublico(rara), { ok: false, codigo: "respuesta_inesperada" }, JSON.stringify(rara));
    }
  });

  test("el log lleva solo el id de la cotización y el código (nunca datos del cliente)", async () => {
    assert.equal(logAvisoPublico(12, { ok: false, codigo: "42501" }), "[aviso_cotizacion_publica] cotizacion=12 codigo=42501");
    assert.equal(logAvisoPublico(12, { ok: false, codigo: null }), "[aviso_cotizacion_publica] cotizacion=12 codigo=desconocido");
    const previo = console.error; const lineas: string[] = [];
    console.error = (...a: unknown[]) => { lineas.push(a.join(" ")); };
    try {
      await avisarYRegistrar(admin({ data: null, error: { code: "XX000" } }).cliente, 5);
      await avisarYRegistrar(admin({ data: { estado: "avisada", notificados: 1 }, error: null }).cliente, 5);
    } finally { console.error = previo; }
    assert.deepEqual(lineas, ["[aviso_cotizacion_publica] cotizacion=5 codigo=XX000"], "solo el fallo se registra; el éxito no escribe nada");
  });
});

describe("presentación del aviso", () => {
  test("texto propio, sin datos del cliente, y el tipo apunta a la ficha de la cotización", () => {
    assert.equal(textoAviso("cotizacion_publica", "C-0042"), "Nueva cotización de un visitante del tarifario: C-0042");
    assert.ok(TIPOS_AVISO_DE_COTIZACION.includes("cotizacion_publica") && TIPOS_AVISO_DE_COTIZACION.includes("solicitud_contrato"));
    assert.ok(!TIPOS_AVISO_DE_COTIZACION.includes("soporte_pago_nuevo"), "los soportes de pago siguen apuntando al contrato");
  });
});

describe("puntos de enlace (los tres orígenes públicos)", () => {
  const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

  test("carrito del tarifario: avisa solo SIN sesión al crear y al repetir la misma intención anónima", () => {
    const s = leer("app/tarifario/checkout/actions.ts");
    assert.ok(s.includes('import { avisarYRegistrar } from "@/lib/avisos/cotizacionPublica"'));
    assert.equal((s.match(/avisarYRegistrar\(/g) ?? []).length, 2, "una llamada al crear y otra al repetir");
    assert.ok(/if \(!user\) await avisarYRegistrar\(admin, row\.id\)/.test(s), "al crear: solo si no hay usuario");
    assert.ok(/if \(actor === "anon"\) await avisarYRegistrar\(admin, data\.id\)/.test(s), "al repetir: solo si el autor verificado de la clave es anónimo");
  });

  test("solicitud de hotel a solicitud: avisa solo SIN sesión, tanto al crear como al repetir", () => {
    const s = leer("app/tarifario/solicitudHotelActions.ts");
    assert.equal((s.match(/avisarYRegistrar\(/g) ?? []).length, 2);
    assert.equal((s.match(/if \(!user\) await avisarYRegistrar\(admin, cotizacionId\)/g) ?? []).length, 2);
  });

  test("paquete dinámico: avisa solo en el canal público (nunca interno ni B2B)", () => {
    const s = leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts");
    assert.equal((s.match(/avisarYRegistrar\(/g) ?? []).length, 1);
    assert.ok(s.includes('if (canal === "publico") await avisarYRegistrar(admin, Number(id));'));
  });

  test("el aviso nunca se llama desde un flujo de aliado, de personal ni de comparativas", () => {
    const sospechosos = ["app/portal/b2b/cotizaciones/actions.ts", "app/(dashboard)/dashboard/cotizaciones/manual-actions.ts", "app/(dashboard)/dashboard/reservar/actions.ts"];
    for (const f of sospechosos) assert.ok(!leer(f).includes("avisarYRegistrar") && !leer(f).includes("avisar_cotizacion_publica"), f);
    const checkout = leer("app/tarifario/checkout/actions.ts");
    // crearComparativaCarrito / solicitarOpcionComparativa son de aliados: el único uso del helper está antes que esas funciones.
    assert.ok(checkout.indexOf("avisarYRegistrar(admin, row.id)") < checkout.indexOf("export async function crearComparativaCarrito"));
  });

  test("la migración 340 no abre ningún canal externo (sin correo, WhatsApp ni webhook)", () => {
    const sql = leer("supabase/migrations/20260601000340_aviso_cotizacion_publica.sql").replace(/^--.*$/gm, "");
    assert.ok(!/pg_net|http_|net\.http|resend|whatsapp|webhook|smtp|mailto/i.test(sql));
    assert.ok(/revoke all on function public\.avisar_cotizacion_publica\(bigint\) from public, anon, authenticated;/.test(sql));
    assert.ok(/grant execute on function public\.avisar_cotizacion_publica\(bigint\) to service_role;/.test(sql));
  });

  test("política de destinatarios: los roles de la función son EXACTAMENTE los de la RLS de cotizaciones, el alcance de agencia es el mismo y ya no depende de la lista de correos", () => {
    const sql = leer("supabase/migrations/20260601000340_aviso_cotizacion_publica.sql").replace(/^--.*$/gm, "");
    const rls = leer("supabase/migrations/20260601000154_cotizaciones_tenant_cierre.sql");
    const rolesRls = /create policy "cotizaciones: lectura" on public\.cotizaciones for select\s+using \(\s+public\.mi_rol\(\) in \(([^)]*)\)/.exec(rls)?.[1];
    const rolesFn = /r\.rol in \(([^)]*)\)/.exec(sql)?.[1];
    assert.ok(rolesRls && rolesFn, "se encontraron ambas listas");
    const norm = (x: string) => x.split(",").map((r) => r.trim().replace(/'/g, "")).sort();
    assert.deepEqual(norm(rolesFn), norm(rolesRls));
    assert.ok(/r\.rol = 'superadmin' or r\.tenant = c\.tenant/.test(sql), "superadmin global; el resto, su agencia (puede_ver_tenant_cotizacion)");
    assert.ok(!/config_solicitudes/.test(sql), "sin lista fija de correos");
  });
  test("«atendida» = convertida (estado convertida o numero_contrato); descartar no cuenta", () => {
    const sql = leer("supabase/migrations/20260601000340_aviso_cotizacion_publica.sql").replace(/^--.*$/gm, "");
    assert.ok(/c\.estado = 'convertida' or c\.numero_contrato is not null/.test(sql));
    assert.ok(!/descartada/.test(sql.slice(sql.indexOf("avisos_recientes(p_usuario"))), "descartada no interviene en atendida");
  });
});
