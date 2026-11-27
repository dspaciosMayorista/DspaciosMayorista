// #76 — Registro B2B con CÓDIGO DE REFERIDO a través de Auth REAL local: las Server Actions reales (`iniciarRegistroB2B`, `confirmarCodigoYSolicitarB2B`, `continuarRegistroB2B`) contra GoTrue v2.197 de verdad
// (createUser, envío del código por Mailpit, verifyOtp real, signInWithPassword real), PostgREST y PostgreSQL con las migraciones 340/341/342. Nada de Auth está simulado.
// Lo lanza supabase/scripts/test_76_registro_auth_real.sh (levanta la pila de supabase/scripts/real_62/pila.sh sobre una base desechable y la baja al terminar). NUNCA contra una base real.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const GW = process.env.REAL76_GATEWAY ?? "", ANON = process.env.REAL76_ANON ?? "", SERVICE = process.env.REAL76_SERVICE ?? "", MAIL = process.env.REAL76_CORREO ?? "";
const CT = process.env.REAL76_CONTENEDOR ?? "", DB = process.env.REAL76_BASE ?? "";
if (!GW || !ANON || !SERVICE || !MAIL || !CT || !DB || DB === "postgres") throw new Error("Faltan REAL76_*: usa supabase/scripts/test_76_registro_auth_real.sh.");
process.env.NEXT_PUBLIC_SUPABASE_URL = GW;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const num = (q: string) => Number(sql(q));
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Último código de verificación enviado a ese correo (Mailpit local; el proyecto no envía nada fuera). */
async function codigoDe(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const lista = (await (await fetch(`http://127.0.0.1:${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`)).json()) as { messages?: { ID: string; Created: string }[] };
    const m = (lista.messages ?? []).sort((a, b) => b.Created.localeCompare(a.Created))[0];
    if (m) {
      const det = (await (await fetch(`http://127.0.0.1:${MAIL}/api/v1/message/${m.ID}`)).json()) as { Text?: string };
      const c = /\b(\d{6,8})\b/.exec(det.Text ?? "")?.[1];
      if (c) return c;
    }
    await dormir(500);
  }
  throw new Error("No llegó el código a Mailpit para " + email);
}

const A = await import("../app/portal/registro/actions.ts");
const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { createClienteSinSesion } = await import("../lib/supabase/sinSesion.ts");

const corrida = randomBytes(3).toString("hex");
let n = 0;
const nuevo = (extra: Partial<Parameters<typeof A.iniciarRegistroB2B>[0]> = {}) => {
  n++;
  const email = `reg76-${corrida}-${n}@real.test`;
  return { email, form: { tipo: "freelance", nombre: `Freelance Real ${corrida} ${n}`, nit: `7600${n}${corrida.slice(0, 2)}`, tipoDocumento: "CC", contacto: "", email, telefono: "", ciudad: "", notas: "", aceptaNotificaciones: true, password: "secreta123", passwordConfirm: "secreta123", ...extra } };
};
const datosDe = (f: ReturnType<typeof nuevo>["form"]) => { const { password: _p, passwordConfirm: _c, ...d } = f; return d; };
const solicitud = (email: string) => sql(`select coalesce(s.codigo_referido, '-') || '|' || s.referido_estado || '|' || s.estado from public.b2b_solicitudes s where s.email = '${email}'`);
const cuentas = (email: string) => num(`select count(*) from auth.users where email = '${email}'`);

before(() => {
  sql(`
    insert into public.referidores (id, tenant, nombre) overriding system value values (9701, 'mayorista', 'Odair Referidor Real') on conflict (id) do nothing;
    insert into public.referidor_codigos (codigo, referidor_id, pct, activo) values ('ODAIR-2', 9701, 0.02, true) on conflict (codigo) do nothing;`);
});

describe("registro B2B con código de referido sobre Auth REAL", () => {
  test("R1 un código con formato inválido se rechaza ANTES de crear la cuenta (ni usuario en Auth ni correo)", async () => {
    const { email, form } = nuevo({ codigoReferido: "a b" });
    const r = await A.iniciarRegistroB2B(form);
    assert.equal(r.ok, false); assert.match((r as { error: string }).error, /El código de referido usa de 4 a 20/);
    assert.equal(cuentas(email), 0);
  });

  test("R2 camino feliz: la cuenta nace SIN verificar e inactiva, el código viaja como TEXTO normalizado en el estado del servidor, y solo con el código de Auth se crea la solicitud con el CANDIDATO (sin asignar nada)", async () => {
    const { email, form } = nuevo({ codigoReferido: "  odair-2 " });
    const asignaciones = num("select count(*) from public.aliado_referidores");
    assert.deepEqual(await A.iniciarRegistroB2B(form), { ok: true });
    assert.equal(sql(`select (email_confirmed_at is null)::text from auth.users where email = '${email}'`), "true");
    assert.equal(sql(`select activo::text from public.usuarios where email = '${email}'`), "false");
    assert.equal(sql(`select datos ->> 'codigo_referido' from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where u.email = '${email}'`), "ODAIR-2");
    assert.equal(solicitud(email), "", "antes del código no existe solicitud");
    const codigo = await codigoDe(email);
    // Aunque el formulario del paso 2 trajera OTRO código, manda el guardado por el servidor en el paso 1.
    const r = await A.confirmarCodigoYSolicitarB2B({ ...datosDe(form), codigoReferido: "OTRO-9", codigo });
    assert.deepEqual(r, { ok: true });
    assert.equal(solicitud(email), "ODAIR-2|candidato|pendiente");
    assert.equal(num("select count(*) from public.aliado_referidores"), asignaciones, "el candidato NO asigna nada");
    assert.equal(sql(`select activo::text from public.usuarios where email = '${email}'`), "false", "la cuenta sigue inactiva hasta que la apruebe un humano");
    // El candidato se resuelve HOY contra la regla guardada (lectura de quien aprueba), sin que el aliado haya declarado referidor ni porcentaje.
    const adm = createAdminClient();
    const ger = await adm.auth.admin.createUser({ email: `ger76-${corrida}@real.test`, password: "secreta123", email_confirm: true });
    sql(`update public.usuarios set rol = 'gerencia', activo = true, tenant = 'mayorista' where id = '${ger.data.user!.id}'`);
    const { data, error } = await (adm as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: { codigo: string; referidor_nombre: string | null; pct: number | null; referido_estado: string }[]; error: unknown }> }).rpc("referidos_candidatos", { p_actor: ger.data.user!.id });
    assert.equal(error, null);
    const c = data.find((x) => x.codigo === "ODAIR-2" && x.referidor_nombre === "Odair Referidor Real");
    assert.ok(c && c.pct === 0.02 && c.referido_estado === "candidato", JSON.stringify(data));
  });

  test("R3 sin código: el registro sigue igual, sin candidato", async () => {
    const { email, form } = nuevo();
    assert.deepEqual(await A.iniciarRegistroB2B(form), { ok: true });
    assert.deepEqual(await A.confirmarCodigoYSolicitarB2B({ ...datosDe(form), codigo: await codigoDe(email) }), { ok: true });
    assert.equal(solicitud(email), "-|sin_codigo|pendiente");
  });

  test("R4 un código de verificación INCORRECTO cuenta como intento fallido y no pierde el candidato; el correcto después sí completa", async () => {
    const { email, form } = nuevo({ codigoReferido: "ODAIR-2" });
    assert.deepEqual(await A.iniciarRegistroB2B(form), { ok: true });
    const real = await codigoDe(email);
    const mal = real === "000000" ? "111111" : "000000";
    const r = await A.confirmarCodigoYSolicitarB2B({ ...datosDe(form), codigo: mal });
    assert.equal(r.ok, false);
    assert.equal(sql(`select fallos::text from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where u.email = '${email}'`), "1");
    assert.equal(solicitud(email), "", "sin código correcto no hay solicitud");
    assert.deepEqual(await A.confirmarCodigoYSolicitarB2B({ ...datosDe(form), codigo: real }), { ok: true });
    assert.equal(solicitud(email), "ODAIR-2|candidato|pendiente");
  });

  test("R5 registro INTERRUMPIDO tras verificar el correo: se reanuda con correo + contraseña y conserva el código del paso 1 aunque la reanudación no lo traiga", async () => {
    const { email, form } = nuevo({ codigoReferido: "ODAIR-2" });
    assert.deepEqual(await A.iniciarRegistroB2B(form), { ok: true });
    const codigo = await codigoDe(email);
    // Interrupción: Auth confirma el correo, pero la solicitud NO se llegó a crear (la persona cerró la pestaña).
    const v = await createClienteSinSesion().auth.verifyOtp({ email, token: codigo, type: "signup" });
    assert.equal(v.error, null);
    assert.equal(solicitud(email), "");
    const otra = await A.iniciarRegistroB2B(form);
    assert.equal(otra.ok, false); assert.equal((otra as { continuar?: boolean }).continuar, true, "no se reemplaza ni se borra la cuenta verificada: se continúa");
    // Una contraseña equivocada NO completa el registro de otra persona.
    const mala = await A.continuarRegistroB2B({ email, password: "incorrecta" });
    assert.equal(mala.ok, false); assert.equal(solicitud(email), "");
    const { nombre: _n, nit: _t, email: _e, ...sinDatos } = datosDe(form);
    const ok = await A.continuarRegistroB2B({ email, password: "secreta123", ...sinDatos, codigoReferido: "" });
    assert.deepEqual(ok, { ok: true });
    assert.equal(solicitud(email), "ODAIR-2|candidato|pendiente", "el código capturado en el paso 1 se conserva");
    assert.deepEqual(await A.continuarRegistroB2B({ email, password: "secreta123" }), { ok: true });
    assert.equal(num(`select count(*) from public.b2b_solicitudes where email = '${email}'`), 1, "idempotente: no se duplica");
  });

  test("R6 un usuario EXISTENTE (activo) no se toca: registrarse con su correo y un código devuelve «Ya existe una cuenta» y no cambia nada", async () => {
    const { email, form } = nuevo({ codigoReferido: "ODAIR-2" });
    const adm = createAdminClient();
    const u = await adm.auth.admin.createUser({ email, password: "otra-clave-1", email_confirm: true });
    sql(`update public.usuarios set rol = 'agencia', activo = true, nombre = 'Existente ${corrida}' where id = '${u.data.user!.id}'`);
    const r = await A.iniciarRegistroB2B({ ...form, nombre: `Otro nombre ${corrida}` });
    assert.equal(r.ok, false); assert.match((r as { error: string }).error, /Ya existe una cuenta/);
    assert.equal(sql(`select activo::text || '|' || rol::text || '|' || nombre from public.usuarios where email = '${email}'`), `true|agencia|Existente ${corrida}`);
    assert.equal(num(`select count(*) from public.registro_b2b_estado r join auth.users x on x.id = r.usuario_id where x.email = '${email}'`), 0);
    assert.equal(solicitud(email), "");
  });
});
