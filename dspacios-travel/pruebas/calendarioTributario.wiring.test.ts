// #43-1a — Cableado del calendario tributario (inspección de fuente).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const pagina = leer("app/(dashboard)/dashboard/contabilidad/calendario-tributario/page.tsx");
const acciones = leer("app/(dashboard)/dashboard/contabilidad/calendario-tributario/actions.ts");
const notif = leer("lib/notificaciones.ts");
const layout = leer("app/(dashboard)/layout.tsx");
const migracion = leer("supabase/migrations/20260601000215_calendario_tributario.sql");

describe("página y acciones", () => {
  test("la página exige rol contable y usa el día de negocio de Bogotá", () => {
    assert.match(pagina, /const ROLES_CONTABLES = \["superadmin", "gerencia", "administracion"\];/);
    assert.match(pagina, /if \(!ROLES_CONTABLES\.includes\(perfil\?\.rol \?\? ""\)\)/);
    assert.match(pagina, /const hoy = fechaNegocio\(\);/);
    assert.doesNotMatch(pagina, /toISOString\(\)/);
  });

  test("fechas y constancias se leen paginadas y con error visible (no listas truncadas en silencio)", () => {
    assert.equal((pagina.match(/fetchAllPaginadoConError\(/g) ?? []).length, 2);
    assert.match(pagina, /falta aplicar la migración 215/);
  });

  test("todas las acciones validan sesión y rol y operan sobre la agencia activa", () => {
    for (const fn of ["guardarObligacion", "eliminarObligacion", "guardarFechas", "registrarCumplimiento"]) {
      const ini = acciones.indexOf(`export async function ${fn}(`);
      assert.ok(ini > -1, `falta ${fn}`);
      const fin = acciones.indexOf("export async function", ini + 10);
      const cuerpo = acciones.slice(ini, fin === -1 ? undefined : fin);
      assert.match(cuerpo, /const ctx = await contexto\(\);/, `${fn} sin contexto`);
      assert.match(cuerpo, /if \(!ctx\.ok\) return/, `${fn} no corta sin permisos`);
    }
    assert.match(acciones, /tenant: await getTenant\(\)/);
  });

  test("guardar fechas: primero el upsert y después los borrados (un fallo no pierde lo cargado)", () => {
    const cuerpo = acciones.slice(acciones.indexOf("export async function guardarFechas("));
    assert.ok(cuerpo.indexOf(".upsert(") > -1 && cuerpo.indexOf(".upsert(") < cuerpo.indexOf(".delete()"));
  });
});

describe("correo diario", () => {
  test("agrega la sección tributaria sin tocar el bloque de bloqueos ni usar UTC para 'hoy'", () => {
    assert.match(notif, /secciones\.push\(\.\.\.\(await recopilarTributarias\(\)\)\);/);
    const fn = notif.slice(notif.indexOf("async function recopilarTributarias"), notif.indexOf("function html("));
    assert.match(fn, /const hoy = fechaNegocio\(\);/);
    assert.doesNotMatch(fn, /toISOString/);
    assert.match(fn, /if \(obR\.error \|\| veR\.error \|\| cuR\.error \|\| agR\.error\) return \[\];/);
    const bloqueos = notif.slice(notif.indexOf("if (flags.bloqueos)"), notif.indexOf("return secciones;"));
    assert.doesNotMatch(bloqueos, /tributari/i);
  });
});

describe("menú y migración", () => {
  test("Contabilidad lista el calendario tributario", () => {
    assert.match(layout, /\{ href: "\/dashboard\/contabilidad\/calendario-tributario", label: "Calendario tributario" \}/);
  });

  test("la 215 no siembra datos y no depende de la 204", () => {
    assert.doesNotMatch(migracion, /insert into public\.obligacion_/i);
    assert.doesNotMatch(migracion, /'contador'::rol_usuario|::rol_usuario\s*in/);
    assert.match(migracion, /mi_rol\(\)::text/);
    assert.match(migracion, /force row level security/);
  });
});
