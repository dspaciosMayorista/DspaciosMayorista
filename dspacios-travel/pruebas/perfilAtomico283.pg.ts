// #25 · Migración 283 — guardado ATÓMICO de «Mi perfil». Integración REAL: la acción `guardarPerfilServidor` (lib/portal/perfilEdicionServidor.ts)
// habla por HTTP con PostgREST y este con Postgres, con la migración 087 real (trigger de auditoría) y la 283.
// SOLO base LOCAL desechable: la lanza supabase/scripts/test_283_perfil_atomico.sh (crea y borra todo). Nada aquí habla con Supabase remoto.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { guardarPerfilServidor as guardarReal, cargarContextoEdicion } from "../lib/portal/perfilEdicionServidor.ts";

const CT = process.env.PG283_CONTENEDOR ?? "";
const DB = process.env.PG283_BASE ?? "";
const URL_REST = process.env.PG283_POSTGREST ?? "";
const SECRETO = process.env.PG283_JWT_SECRET ?? "";
if (!CT.startsWith("pg283_") || !DB.startsWith("t283_") || !URL_REST || !SECRETO) throw new Error("Usa supabase/scripts/test_283_perfil_atomico.sh (base desechable).");

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (role: string) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
};
// supabase-js antepone /rest/v1 (el gateway de Supabase); PostgREST local sirve en la raíz.
const admin = createClient(URL_REST, jwt("service_role"), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (u, o) => fetch(String(u).replace("/rest/v1/", "/"), o) } });

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
// «Formulario abierto justo antes de guardar»: `esperado` = valores que la base tiene en ese instante (los originales que vería el editor).
// Las pruebas 2b y 5 pasan `esperado` explícito (editor abierto ANTES de que otra operación guardara).
const guardarPerfilServidor: typeof guardarReal = (adm, sesion, entrada) => {
  const e = entrada as unknown as Record<string, unknown>;
  if (e.esperado !== undefined || !sesion) return guardarReal(adm, sesion, entrada);
  const q = e.seccion === "usuario"
    ? `select json_build_object('nombre', nombre) from public.usuarios where id = '${sesion.id}'`
    : `select json_build_object('nombre', a.nombre, 'contacto', a.contacto, 'telefono', a.telefono, 'email', a.email, 'direccion', a.direccion) from public.aliados a join public.usuarios u on u.aliado_id = a.id where u.id = '${sesion.id}'`;
  const crudo = sql(q);
  return guardarReal(adm, sesion, { ...entrada, esperado: crudo ? JSON.parse(crudo) : {} } as never);
};

const UA = "00000000-0000-0000-0000-000000028201"; // titular de agencia Alfa, ficha 1
const UAG = "00000000-0000-0000-0000-000000028202"; // agente de Alfa (con aliado_id puesto: no lo hace titular)
const UB = "00000000-0000-0000-0000-000000028203"; // titular de agencia Beta, ficha 2
const UL = "00000000-0000-0000-0000-000000028204"; // titular con acceso heredado por nombre, ficha 3
const UX = "00000000-0000-0000-0000-000000028205"; // titular inactiva, ficha 4
const ses = (id: string, email: string) => ({ id, email });

before(() => {
  // Falla de auditoría PROVOCADA, solo para filas con actor (las del trigger «Sistema» no tienen actor): teléfonos centinela.
  sql(`
    create or replace function public.t283_falla() returns trigger language plpgsql as $f$
    begin
      if new.actor_id is not null and new.despues ->> 'telefono' = '3009990001' then raise exception 'auditoria rota (prueba)'; end if;
      if new.actor_id is not null and new.despues ->> 'telefono' = '3009990002' then perform pg_sleep(2.5); raise exception 'auditoria rota tras espera (prueba)'; end if;
      if new.actor_id is not null and new.despues ->> 'nombre' = 'Nombre Rompe Auditoria' then raise exception 'auditoria rota (prueba)'; end if;
      return new;
    end $f$;
    drop trigger if exists t283_falla on public.auditoria;
    create trigger t283_falla before insert on public.auditoria for each row execute function public.t283_falla();
  `);
});

beforeEach(() => {
  sql(`
    truncate public.auditoria, public.usuarios restart identity cascade;
    truncate public.aliados restart identity cascade;
    insert into public.aliados (id, nombre, nit, contacto, email, telefono, direccion, banco, numero_cuenta) values
      (1, 'Viajes Alfa SAS', '900111', 'Ana', 'ana@alfa.test', '3001112233', 'Calle 1', 'Banco A', '111'),
      (2, 'Viajes Beta SAS', '900222', 'Beto', 'beto@beta.test', '3002223344', 'Calle 2', 'Banco B', '222'),
      (3, 'Legado Tours', '900333', null, null, null, null, null, null),
      (4, 'Inactiva SAS', '900444', null, null, null, null, null, null);
    insert into public.usuarios (id, email, nombre, rol, activo, agencia_id, aliado_id, acceso_legacy_nombre) values
      ('${UA}', 'a@alfa.test', 'Viajes Alfa SAS', 'agencia', true, null, 1, false),
      ('${UAG}', 'ag@alfa.test', 'Agente Alfa', 'agencia', true, '${UA}', 1, false),
      ('${UB}', 'b@beta.test', 'Viajes Beta SAS', 'agencia', true, null, 2, false),
      ('${UL}', 'l@legado.test', 'Legado Tours', 'agencia', true, null, 3, true),
      ('${UX}', 'x@inactiva.test', 'Inactiva SAS', 'agencia', false, null, 4, false);
    truncate public.auditoria restart identity; -- el trigger registró las altas de arriba
  `);
});

const ficha = (id: number) => sql(`select telefono || '|' || coalesce(direccion,'~') || '|' || nombre || '|' || nit from public.aliados where id = ${id}`);
const nAud = (where = "true") => Number(sql(`select count(*) from public.auditoria where ${where}`));
const rpc = async (args: Record<string, unknown>) => { const r = await admin.rpc("guardar_perfil_portal", args as never); if (r.error) console.error("RPC ERROR", JSON.stringify(r.error)); return r; };

test("1 · auditoría fallida: el perfil queda intacto (ficha y usuario) y no queda rastro alguno", async () => {
  const antes = ficha(1);
  const r = await guardarPerfilServidor(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3009990001", direccion: "Dirección nueva" });
  assert.equal(r.ok, false);
  assert.equal(ficha(1), antes, "ni el teléfono ni la dirección cambiaron");
  assert.equal(nAud(), 0, "ni la fila con actor ni la del trigger «Sistema» sobrevivieron");
  const r2 = await guardarPerfilServidor(admin, ses(UB, "b@beta.test"), { seccion: "usuario", nombre: "Nombre Rompe Auditoria" });
  assert.equal(r2.ok, false);
  assert.equal(sql(`select nombre from public.usuarios where id = '${UB}'`), "Viajes Beta SAS");
  assert.equal(nAud(), 0);
  // Control: sin el teléfono centinela la misma operación SÍ se confirma → el fallo anterior fue la auditoría, no otra causa.
  assert.equal((await guardarPerfilServidor(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3009990003", direccion: "Dirección nueva" })).ok, true);
  assert.equal(ficha(1), "3009990003|Dirección nueva|Viajes Alfa SAS|900111");
});

test("2a · dos ediciones concurrentes: la que falla NO restaura valores sobre la otra", async () => {
  // A (teléfono centinela con espera) toma el bloqueo y falla tras 2,5 s; B llega durante la espera y edita el mismo campo.
  const A = guardarPerfilServidor(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3009990002" });
  await new Promise((r) => setTimeout(r, 600));
  const t0 = Date.now();
  const B = await guardarPerfilServidor(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3008887766", direccion: "Dirección de B" });
  const esperaB = Date.now() - t0;
  const a = await A;
  assert.equal(a.ok, false, "A falla");
  assert.deepEqual(B, { ok: true, cambios: ["telefono", "direccion"] }, "B se confirma");
  assert.ok(esperaB > 1200, `B esperó el bloqueo de A (esperó ${esperaB} ms): las ediciones se serializan`);
  assert.equal(ficha(1), "3008887766|Dirección de B|Viajes Alfa SAS|900111", "queda lo de B; nada de A lo pisó");
  assert.equal(nAud("actor_id is not null"), 1, "solo la auditoría de B");
  assert.equal(sql(`select despues ->> 'telefono' from public.auditoria where actor_id is not null`), "3008887766");
});

test("2b · edición hecha sobre datos ya cambiados: conflicto, sin sobrescribir al que guardó antes", async () => {
  const viejo = { p_actor_id: UA, p_actor_email: "a@alfa.test", p_seccion: "ficha", p_cambios: { telefono: "3005550000" }, p_esperado: { telefono: "3001112233" } };
  assert.deepEqual((await guardarPerfilServidor(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3004443322" })), { ok: true, cambios: ["telefono"] });
  const r = await rpc(viejo); // la pestaña desactualizada: esperaba el teléfono de antes
  assert.deepEqual(r.data, { ok: false, codigo: "conflicto" });
  assert.equal(ficha(1).split("|")[0], "3004443322");
  assert.equal(nAud("actor_id is not null"), 1);
});

test("3a · el actor sale de la sesión y solo se toca la ficha propia aunque el cuerpo traiga otra", async () => {
  const r = await guardarPerfilServidor(admin, ses(UB, "sesion-b@beta.test"), { seccion: "ficha", telefono: "3006667788", aliadoId: 1, aliado_id: 1, id: 1, nit: "999", banco: "X" } as never);
  assert.equal(r.ok, true);
  assert.equal(ficha(2).split("|")[0], "3006667788");
  assert.equal(ficha(1), "3001112233|Calle 1|Viajes Alfa SAS|900111", "la ficha de Alfa no se tocó");
  assert.equal(sql(`select nit || '|' || banco from public.aliados where id = 2`), "900222|Banco B", "campos protegidos intactos");
  assert.equal(sql(`select actor_id || '|' || actor_email || '|' || actor_nombre || '|' || actor_rol || '|' || tabla || '|' || registro_id from public.auditoria where actor_id is not null`),
    `${UB}|sesion-b@beta.test|Viajes Beta SAS|agencia|aliados|2`);
  assert.equal(nAud("actor_id is null"), 1, "el trigger 087 registró además su fila «Sistema» (sin actor), en la misma transacción");
});

test("3b · la base vuelve a verificar: agente con aliado_id, inactivo, acceso heredado, campo protegido, ficha compartida", async () => {
  const base = { p_actor_email: "x@x.test", p_esperado: {} };
  const intacto = () => assert.equal(ficha(1), "3001112233|Calle 1|Viajes Alfa SAS|900111");
  assert.deepEqual((await rpc({ ...base, p_actor_id: UAG, p_seccion: "ficha", p_cambios: { telefono: "3009998877" } })).data, { ok: false, codigo: "agente" });
  assert.deepEqual((await rpc({ ...base, p_actor_id: UX, p_seccion: "ficha", p_cambios: { telefono: "3009998877" } })).data, { ok: false, codigo: "no_autorizado" });
  assert.deepEqual((await rpc({ ...base, p_actor_id: UL, p_seccion: "usuario", p_cambios: { nombre: "Otro Nombre" }, p_esperado: { nombre: "Legado Tours" } })).data, { ok: false, codigo: "nombre_legacy" });
  assert.deepEqual((await rpc({ ...base, p_actor_id: UA, p_seccion: "ficha", p_cambios: { nit: "1" } })).data, { ok: false, codigo: "campo_no_permitido" });
  assert.deepEqual((await rpc({ ...base, p_actor_id: UA, p_seccion: "usuario", p_cambios: { rol: "superadmin" } })).data, { ok: false, codigo: "campo_no_permitido" });
  assert.deepEqual((await rpc({ ...base, p_actor_id: "00000000-0000-0000-0000-00000000ffff", p_seccion: "ficha", p_cambios: { telefono: "3009998877" } })).data, { ok: false, codigo: "no_autorizado" });
  intacto();
  sql(`insert into public.usuarios (id, email, nombre, rol, activo, agencia_id, aliado_id) values ('00000000-0000-0000-0000-000000028299', 'otra@alfa.test', 'Otra Titular', 'agencia', true, null, 1)`);
  assert.deepEqual((await rpc({ ...base, p_actor_id: UA, p_seccion: "ficha", p_cambios: { telefono: "3009998877" }, p_esperado: { telefono: "3001112233" } })).data, { ok: false, codigo: "ficha_compartida" });
  intacto();
  assert.equal(nAud("actor_id is not null"), 0);
});

test("3c · la función no es ejecutable por anon ni authenticated (solo service_role, que la llama tras autenticar la sesión)", async () => {
  for (const rol of ["anon", "authenticated"]) {
    const res = await fetch(`${URL_REST}/rpc/guardar_perfil_portal`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${jwt(rol)}`, apikey: jwt(rol) },
      body: JSON.stringify({ p_actor_id: UA, p_actor_email: "x", p_seccion: "ficha", p_cambios: { telefono: "3001230000" }, p_esperado: { telefono: "3001112233" } }),
    });
    assert.ok(res.status === 401 || res.status === 403 || res.status === 404, `${rol}: HTTP ${res.status}`);
  }
  assert.equal(ficha(1).split("|")[0], "3001112233");
});

test("4 · camino feliz: cambio y auditoría con actor se confirman juntos; sin cambios no escribe", async () => {
  const r = await guardarPerfilServidor(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", contacto: "Ana María", telefono: "+57 300 111 2299" });
  assert.deepEqual(r, { ok: true, cambios: ["contacto", "telefono"] });
  assert.equal(sql(`select contacto || '|' || telefono from public.aliados where id = 1`), "Ana María|+573001112299");
  assert.equal(sql(`select cambios -> 'telefono' ->> 'antes' || '>' || (cambios -> 'telefono' ->> 'despues') from public.auditoria where actor_id is not null`), "3001112233>+573001112299");
  const n = nAud();
  assert.deepEqual(await guardarPerfilServidor(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", contacto: "Ana María" }), { ok: true, cambios: [] });
  assert.equal(nAud(), n);
});

test("5 · recorrido completo: se abre el editor con A, otra operación guarda B, el editor anterior intenta C → conflicto; B y su auditoría intactos", async () => {
  // 1) Abrir el editor con A: lo que cargaría la página (valores originales, null incluido).
  const abierto = await cargarContextoEdicion(admin, UA);
  assert.equal(abierto.ficha?.telefono, "3001112233");
  const originales = { telefono: abierto.ficha!.telefono, direccion: abierto.ficha!.direccion };
  // 2) Otra operación (otra pestaña) guarda B.
  const b = await guardarReal(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3004445566", esperado: { telefono: originales.telefono } });
  assert.deepEqual(b, { ok: true, cambios: ["telefono"] });
  // 3) El editor anterior (abierto con A) intenta guardar C, con los originales de apertura.
  const c = await guardarReal(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3007778899", direccion: "Calle de C", esperado: originales });
  assert.equal(c.ok, false);
  assert.match((c as { error: string }).error, /cambiaron mientras editabas/);
  // 4) B y su auditoría permanecen intactos; nada de C (ni siquiera la dirección: la operación entera se rechaza).
  assert.equal(ficha(1), "3004445566|Calle 1|Viajes Alfa SAS|900111");
  assert.equal(nAud("actor_id is not null"), 1);
  assert.equal(sql(`select despues ->> 'telefono' || '|' || (cambios -> 'telefono' ->> 'antes') from public.auditoria where actor_id is not null`), "3004445566|3001112233");
  assert.equal(nAud("despues::text like '%3007778899%' or antes::text like '%3007778899%'"), 0, "ni rastro de C en la auditoría");
  // Un editor reabierto DESPUÉS de B sí puede guardar.
  const reabierto = await cargarContextoEdicion(admin, UA);
  assert.deepEqual(await guardarReal(admin, ses(UA, "a@alfa.test"), { seccion: "ficha", telefono: "3007778899", esperado: { telefono: reabierto.ficha!.telefono } }), { ok: true, cambios: ["telefono"] });
});
