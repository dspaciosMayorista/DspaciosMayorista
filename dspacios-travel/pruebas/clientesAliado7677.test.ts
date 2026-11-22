// #76/#77 (bloque Portal B2B) — «Mis clientes»: asociación al aliado, aislamiento entre aliados, libreta propia y acceso interno.
// Se ejecuta el código real de lectura/escritura contra una base en memoria que HACE CUMPLIR la unicidad (aliado_id, clave); solo la frontera (Supabase) está simulada.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { readFileSync } from "node:fs";

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {} export function revalidateTag() {}")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";

import { crearBaseFalsa, type Fila } from "./support/clientesAliadoFalso.ts";
import {
  claveCliente, validarCliente, combinarClientes, paginarClientes, normalizarBusquedaClientes, type ClienteVista,
} from "../lib/portal/clientesAliado.ts";
import { accesoClientesAliados, aliadoElegido } from "../lib/crm/clientesAliadosAcceso.ts";

let base = crearBaseFalsa({});
let sesion: Record<string, unknown> = {};
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => base } });
mock.module("@/lib/portal/b2bPortalServidor", { namedExports: { resolverContextoPortal: async () => sesion } });
const srv = await import("../lib/portal/clientesAliadoServidor.ts");
const { guardarCliente } = await import("../app/portal/b2b/clientes/actions.ts");

const A = 7, B = 8;
function datos(): Record<string, Fila[]> {
  return {
    ventas: [
      { numero_contrato: "00-0001", aliado_id: A, b2b_usuario_id: null, cliente: "María Pérez", destino: "CARTAGENA", fecha_salida: "2026-12-10", estado: "confirmado", fecha_venta: "2026-11-01", tenant: "mayorista" },
      { numero_contrato: "00-0002", aliado_id: null, b2b_usuario_id: "uA", cliente: "maria perez", destino: "SANTA MARTA", fecha_salida: "2027-01-05", estado: "pendiente", fecha_venta: "2026-11-10", tenant: "mayorista" },
      { numero_contrato: "00-0003", aliado_id: B, b2b_usuario_id: null, cliente: "Juan Gómez", destino: "SAN ANDRES", fecha_salida: "2026-12-20", estado: "confirmado", fecha_venta: "2026-11-02", tenant: "mayorista" },
      // Contrato antiguo: el aliado figura SOLO por nombre. Sin id no se asigna por inferencia.
      { numero_contrato: "00-0004", aliado_id: null, b2b_usuario_id: null, agencia_nombre: "Viajes A", cliente: "Legado SA", destino: "CALI", fecha_salida: "2026-10-01", estado: "confirmado", fecha_venta: "2026-09-01", tenant: "mayorista" },
      { numero_contrato: "MIN-0005", aliado_id: A, b2b_usuario_id: null, cliente: "Luis Mina", destino: "CARTAGENA", fecha_salida: "2026-12-01", estado: "confirmado", fecha_venta: "2026-11-03", tenant: "minorista" },
    ],
    cotizaciones: [
      { id: 1, codigo: "COT-1", payload: { b2bAsistido: { aliado_id: String(A) } }, aliado_id: null, creado_por: "staff@dspacios.test", cliente: "Ana Ríos", destino: "CARTAGENA", fecha_salida: "2026-12-15", estado: "enviada", modo: "manual", created_at: "2026-11-05T10:00:00Z", tenant: "mayorista" },
      { id: 2, codigo: "COT-2", payload: { b2bAsistido: { aliado_id: String(B) } }, aliado_id: null, creado_por: "staff@dspacios.test", cliente: "Beto Díaz", destino: "CALI", fecha_salida: null, estado: "enviada", modo: "manual", created_at: "2026-11-06T10:00:00Z", tenant: "mayorista" },
      { id: 3, codigo: "COT-3", payload: null, aliado_id: null, creado_por: "a@aliados.test", cliente: "Ana Rios", destino: "CARTAGENA", fecha_salida: "2026-12-16", estado: "enviada", modo: "tarifario", created_at: "2026-11-07T10:00:00Z", tenant: "mayorista" },
      { id: 4, codigo: "COT-4", payload: null, aliado_id: A, creado_por: "staff@dspacios.test", cliente: "Descartado", destino: "CALI", fecha_salida: null, estado: "descartada", modo: "manual", created_at: "2026-11-08T10:00:00Z", tenant: "mayorista" },
      { id: 5, codigo: "COT-5", payload: null, aliado_id: null, creado_por: "b@aliados.test", cliente: "Ana Ríos", destino: "CALI", fecha_salida: null, estado: "enviada", modo: "tarifario", created_at: "2026-11-09T10:00:00Z", tenant: "mayorista" },
    ],
    aliado_clientes: [
      { id: 1, aliado_id: A, tenant: "mayorista", nombre: "María Pérez", clave: "maria perez", tipo_documento: "CC", documento: "1010", email: "m@cliente.test", telefono: "3001112222", notas: null, actualizado_en: "2026-11-02T10:00:00.000Z" },
      { id: 2, aliado_id: B, tenant: "mayorista", nombre: "Ana Rios", clave: "ana rios", tipo_documento: null, documento: null, email: "ana-de-b@cliente.test", telefono: null, notas: "solo de B", actualizado_en: "2026-11-02T10:00:00.000Z" },
    ],
    usuarios: [
      { id: "uA", email: "a@aliados.test", aliado_id: A, rol: "freelance" },
      { id: "uB", email: "b@aliados.test", aliado_id: B, rol: "agencia" },
    ],
  };
}
const ambitoA = { aliadoId: A, userIds: ["uA"], emails: ["a@aliados.test"], tenants: null };
const ambitoB = { aliadoId: B, userIds: ["uB"], emails: ["b@aliados.test"], tenants: null };
const nombres = (cs: ClienteVista[]) => cs.map((c) => c.clave).sort();
const ok = (r: { ok: boolean }) => { assert.equal(r.ok, true); return r as unknown as { ok: true; clientes: ClienteVista[] }; };

beforeEach(() => { base = crearBaseFalsa(datos()); sesion = { estado: "ok", userId: "uA", email: "a@aliados.test", aliadoId: A, agenciaId: null, tenant: "mayorista" }; });

describe("#76/#77 pura: clave, validación, unión y páginas", () => {
  test("la clave ignora tildes, mayúsculas y puntuación; vacía si no es texto", () => {
    assert.equal(claveCliente("  MARÍA   Pérez. "), "maria perez");
    assert.equal(claveCliente("Peña, José"), "pena jose");
    assert.equal(claveCliente(null), "");
  });
  test("validación: autorización obligatoria, documento con tipo, correo/teléfono/notas con límites", () => {
    const base = { nombre: "Laura Gil", autorizacion: true };
    assert.equal(validarCliente(base).ok, true);
    assert.equal(validarCliente({ ...base, autorizacion: false }).ok, false);
    assert.equal(validarCliente({ ...base, autorizacion: "true" }).ok, false, "solo el booleano true cuenta");
    assert.equal(validarCliente({ ...base, nombre: "ab" }).ok, false);
    assert.equal(validarCliente({ ...base, documento: "123456" }).ok, false, "documento sin tipo");
    assert.equal(validarCliente({ ...base, tipoDocumento: "XX", documento: "123456" }).ok, false);
    assert.equal(validarCliente({ ...base, email: "no-es-correo" }).ok, false);
    assert.equal(validarCliente({ ...base, telefono: "abc" }).ok, false);
    assert.equal(validarCliente({ ...base, notas: "x".repeat(501) }).ok, false);
    const v = validarCliente({ ...base, tipoDocumento: "cc", documento: "1 010", email: " L@X.CO ", telefono: "+57 300 111 2222" });
    assert.ok(v.ok);
    assert.deepEqual(
      { t: v.valor.tipo_documento, d: v.valor.documento, e: v.valor.email, c: v.valor.clave },
      { t: "CC", d: "1010", e: "l@x.co", c: "laura gil" },
    );
  });
  test("la unión es por clave, un contrato solo cuenta una vez, filas sin nombre se descartan y lo último va primero", () => {
    const v = combinarClientes(
      [],
      [
        { numero_contrato: "1", cliente: "Ana Ríos", destino: null, fecha_salida: "2026-01-01", estado: "x", fecha_venta: "2026-01-02" },
        { numero_contrato: "1", cliente: "Ana Ríos", destino: null, fecha_salida: "2026-01-01", estado: "x", fecha_venta: "2026-01-02" },
        { numero_contrato: "2", cliente: "  ", destino: null, fecha_salida: null, estado: null },
        { numero_contrato: "3", cliente: "Zeta", destino: null, fecha_salida: null, estado: null, fecha_venta: "2026-05-01" },
      ],
      [{ id: 9, codigo: null, cliente: "ana rios", destino: null, fecha_salida: null, estado: "e", created_at: "2026-03-03T00:00:00Z" }],
    );
    assert.deepEqual(v.map((c) => [c.clave, c.contratos.length, c.cotizaciones.length, c.ultima]), [["zeta", 1, 0, "2026-05-01"], ["ana rios", 1, 1, "2026-03-03"]]);
  });
  test("páginas: nunca más de `tam`, la página se ajusta al rango y la búsqueda filtra por nombre o contacto guardado", () => {
    const lista = combinarClientes(Array.from({ length: 45 }, (_, i) => ({ id: i + 1, nombre: `Cliente ${String(i).padStart(2, "0")}`, clave: "", tipo_documento: null, documento: null, email: i === 7 ? "especial@x.co" : null, telefono: null, notas: null, actualizado_en: "t" })), [], []);
    const p1 = paginarClientes(lista, null, 1);
    assert.deepEqual([p1.items.length, p1.total, p1.paginas], [20, 45, 3]);
    assert.equal(paginarClientes(lista, null, 99).pagina, 3);
    assert.equal(paginarClientes(lista, null, -4).pagina, 1);
    assert.equal(paginarClientes(lista, null, NaN).pagina, 1);
    assert.equal(paginarClientes(lista, "especial@x.co", 1).total, 1);
    assert.equal(paginarClientes(lista, "cliente 07", 1).total, 1);
    assert.equal(normalizarBusquedaClientes("  \u0007 x ".repeat(1)), "x");
    assert.equal(normalizarBusquedaClientes("a".repeat(200))!.length, 80);
  });
});

describe("#76/#77 lectura: cada aliado ve solo lo suyo", () => {
  test("A: une libreta + contratos + cotizaciones por id/correo propios; nada de B, nada por nombre, nada descartado", async () => {
    const cs = ok(await srv.leerClientesAliado(base, ambitoA)).clientes;
    assert.deepEqual(nombres(cs), ["ana rios", "luis mina", "maria perez"]);
    const maria = cs.find((c) => c.clave === "maria perez")!;
    assert.deepEqual(maria.contratos.map((c) => c.numero_contrato).sort(), ["00-0001", "00-0002"], "por ficha y por usuario, sin duplicar");
    assert.equal(maria.guardado?.email, "m@cliente.test");
    const ana = cs.find((c) => c.clave === "ana rios")!;
    assert.deepEqual(ana.cotizaciones.map((c) => c.id).sort(), [1, 3], "asistida (plan congelado) + directa (su correo); NO la COT-5 de B");
    assert.equal(ana.guardado, null, "la libreta de B para «Ana Rios» NO se le filtra a A");
    const todo = JSON.stringify(cs);
    for (const ajeno of ["Juan", "Beto", "Legado", "Descartado", "ana-de-b", "solo de B"]) assert.ok(!todo.includes(ajeno), `A no debe ver «${ajeno}»`);
  });
  test("B: lo suyo, con SU libreta; nada de A (aislamiento simétrico)", async () => {
    const cs = ok(await srv.leerClientesAliado(base, ambitoB)).clientes;
    assert.deepEqual(nombres(cs), ["ana rios", "beto diaz", "juan gomez"]);
    assert.equal(cs.find((c) => c.clave === "ana rios")!.guardado?.email, "ana-de-b@cliente.test");
    assert.deepEqual(cs.find((c) => c.clave === "ana rios")!.cotizaciones.map((c) => c.id), [5]);
    assert.ok(!JSON.stringify(cs).includes("Mina") && !JSON.stringify(cs).includes("m@cliente.test"));
  });
  test("un aliado sin ficha en la sesión no tiene ámbito (no se lista nada)", () => {
    assert.equal(srv.ambitoDeSesion({ aliadoId: null, userId: "uX", email: "x@x.test" }), null);
    assert.deepEqual(srv.ambitoDeSesion({ aliadoId: A, userId: "uA", email: null }), { aliadoId: A, userIds: ["uA"], emails: [], tenants: null });
  });
  test("lectura incompleta o fallida: ok:false y ningún cliente (la pantalla avisa, no dice «no tienes»)", async () => {
    for (const tabla of ["aliado_clientes", "ventas", "cotizaciones"]) {
      const falla = crearBaseFalsa(datos(), { fallar: (t) => t === tabla });
      assert.deepEqual(await srv.leerClientesAliado(falla, ambitoA), { ok: false }, tabla);
    }
  });
  test("fan-out acotado: 6 lecturas por visita con datos pequeños (1 libreta + 2 ventas + 3 cotizaciones), ninguna escritura", async () => {
    await srv.leerClientesAliado(base, ambitoA);
    assert.equal(base.llamadas.length, 6);
    assert.ok(base.llamadas.every((l) => l.op === "select"));
  });
});

describe("#76/#77 acceso interno (CRM): mismo contenido, agencias respetadas", () => {
  test("el personal ve lo MISMO que el aliado (por la ficha y sus usuarios) y solo en sus agencias", async () => {
    const amb = await srv.ambitoDeAliado(base, A, null);
    assert.deepEqual(amb, { aliadoId: A, userIds: ["uA"], emails: ["a@aliados.test"], tenants: null });
    assert.deepEqual(nombres(ok(await srv.leerClientesAliado(base, amb!)).clientes), ["ana rios", "luis mina", "maria perez"]);
    const solo = await srv.ambitoDeAliado(base, A, ["mayorista"]);
    assert.deepEqual(nombres(ok(await srv.leerClientesAliado(base, solo!)).clientes), ["ana rios", "maria perez"], "administración/operaciones de mayorista no ven el contrato de minorista");
  });
  test("roles y agencias: superadmin/gerencia ambas; administración/operaciones solo la propia; venta, B2B, inactivos y sin agencia no entran", () => {
    assert.deepEqual(accesoClientesAliados({ rol: "superadmin", activo: true, tenant: "mayorista" }), { ok: true, tenants: null });
    assert.deepEqual(accesoClientesAliados({ rol: "gerencia", activo: true, tenant: "minorista" }), { ok: true, tenants: null });
    assert.deepEqual(accesoClientesAliados({ rol: "administracion", activo: true, tenant: "minorista" }), { ok: true, tenants: ["minorista"] });
    assert.deepEqual(accesoClientesAliados({ rol: "operaciones", activo: true, tenant: "mayorista" }), { ok: true, tenants: ["mayorista"] });
    for (const rol of ["venta", "agencia", "freelance", "cliente_final", "control_vuelo", "x"]) assert.deepEqual(accesoClientesAliados({ rol, activo: true, tenant: "mayorista" }), { ok: false }, rol);
    assert.deepEqual(accesoClientesAliados({ rol: "gerencia", activo: false, tenant: "mayorista" }), { ok: false });
    assert.deepEqual(accesoClientesAliados({ rol: "operaciones", activo: true, tenant: null }), { ok: false });
    assert.deepEqual(accesoClientesAliados(null), { ok: false });
  });
  test("`?aliado=` solo vale si el id está en la lista cargada", () => {
    assert.equal(aliadoElegido("7", [7, 8]), 7);
    assert.equal(aliadoElegido(["8", "7"], [7, 8]), 8);
    for (const raw of ["99", "-1", "7.5", "abc", "", undefined]) assert.equal(aliadoElegido(raw, [7, 8]), null, String(raw));
  });
});

describe("#76/#77 escritura (acción real): el aliado sale de la sesión", () => {
  const nuevo = (o: Record<string, unknown> = {}) => ({ nombre: "Laura Gil", telefono: "3001234567", autorizacion: true, ...o });
  const libreta = () => base.tablas.aliado_clientes;

  test("crea en la libreta del aliado de la sesión; ignora un aliado_id/tenant que mande el navegador", async () => {
    const r = await guardarCliente({ ...nuevo(), aliado_id: B, tenant: "minorista" } as never);
    assert.equal(r.ok, true);
    const fila = libreta().find((f) => f.nombre === "Laura Gil")!;
    assert.deepEqual([fila.aliado_id, fila.tenant, fila.clave, fila.autorizacion_datos, fila.creado_por], [A, "mayorista", "laura gil", true, "uA"]);
  });
  test("duplicado por nombre del MISMO aliado se rechaza; el mismo nombre en OTRO aliado es otro cliente", async () => {
    assert.equal((await guardarCliente(nuevo())).ok, true);
    const dup = await guardarCliente(nuevo({ nombre: "LAURA  gil" }));
    assert.deepEqual(dup, { ok: false, error: "Ya tienes un cliente guardado con ese nombre." });
    sesion = { ...sesion, userId: "uB", aliadoId: B };
    assert.equal((await guardarCliente(nuevo())).ok, true);
    assert.equal(libreta().filter((f) => f.clave === "laura gil").length, 2);
  });
  test("editar: con la versión vista funciona; con una versión vieja es conflicto y no cambia nada", async () => {
    const id = 1, esperado = "2026-11-02T10:00:00.000Z";
    assert.equal((await guardarCliente({ ...nuevo({ nombre: "María Pérez", telefono: "3009998888" }), id, esperado })).ok, true);
    assert.equal(libreta().find((f) => f.id === id)!.telefono, "3009998888");
    const viejo = await guardarCliente({ ...nuevo({ nombre: "María Pérez", telefono: "3000000000" }), id, esperado });
    assert.equal(viejo.ok, false);
    assert.equal(libreta().find((f) => f.id === id)!.telefono, "3009998888", "la edición con versión vieja no pisa la nueva");
  });
  test("A NO puede editar un cliente de B aunque conozca su id (filtro por ficha de la sesión)", async () => {
    const antes = JSON.stringify(libreta().find((f) => f.id === 2));
    const r = await guardarCliente({ ...nuevo({ nombre: "Ana Rios", email: "robado@x.test" }), id: 2, esperado: "2026-11-02T10:00:00.000Z" });
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(libreta().find((f) => f.id === 2)), antes);
  });
  test("rechazos: sin sesión de aliado, sin ficha, agente de agencia, sin autorización o datos inválidos; nada se guarda", async () => {
    const n0 = libreta().length;
    sesion = { estado: "visitante" };
    assert.equal((await guardarCliente(nuevo())).ok, false);
    sesion = { estado: "ok", userId: "uA", email: "a@aliados.test", aliadoId: null, agenciaId: null, tenant: "mayorista" };
    assert.equal((await guardarCliente(nuevo())).ok, false);
    sesion = { estado: "ok", userId: "uAg", email: "ag@aliados.test", aliadoId: A, agenciaId: "uA", tenant: "mayorista" };
    assert.equal((await guardarCliente(nuevo())).ok, false, "un agente lee pero no administra la libreta");
    sesion = { estado: "ok", userId: "uA", email: "a@aliados.test", aliadoId: A, agenciaId: null, tenant: "mayorista" };
    assert.equal((await guardarCliente(nuevo({ autorizacion: false }))).ok, false);
    assert.equal((await guardarCliente(nuevo({ email: "mal" }))).ok, false);
    assert.equal((await guardarCliente(null as never)).ok, false);
    assert.equal(libreta().length, n0);
  });
  test("un cliente nuevo aparece en la lectura del propio aliado y no en la del otro", async () => {
    await guardarCliente(nuevo());
    assert.ok(nombres(ok(await srv.leerClientesAliado(base, ambitoA)).clientes).includes("laura gil"));
    assert.ok(!nombres(ok(await srv.leerClientesAliado(base, ambitoB)).clientes).includes("laura gil"));
  });
});

describe("#76/#77 cableado de las páginas (el comportamiento está probado arriba; esto solo fija el ORDEN de las guardas)", () => {
  const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  test("CRM «Clientes de aliados»: valida rol/agencia ANTES de abrir el cliente de servicio y no escribe nada", () => {
    const src = leer("app/(crm)/crm/clientes-aliados/page.tsx");
    assert.ok(src.indexOf("accesoClientesAliados(perfil)") > 0 && src.indexOf("accesoClientesAliados(perfil)") < src.indexOf("createAdminClient()"));
    assert.ok(!/\.(insert|update|delete|upsert)\(/.test(src), "solo lectura");
    assert.ok(!/crm_contactos|crm_campan|personas/.test(src.replace(/\/\/.*$/gm, "")), "no cruza con Contactos, campañas ni personas");
  });
  test("«Mis clientes» (portal): el aliado sale de la sesión; la página no lee el aliado de la URL", () => {
    const src = leer("app/portal/b2b/clientes/page.tsx");
    assert.ok(/resolverContextoPortal\(\)/.test(src) && /ambitoDeSesion\(ctx\)/.test(src));
    assert.ok(!/searchParams[\s\S]{0,200}aliado/i.test(src.replace(/ctx\.aliado/g, "")), "ningún parámetro de la URL elige aliado");
    const acc = leer("app/portal/b2b/clientes/actions.ts");
    assert.ok(!/aliado_id|aliadoId\s*:\s*i\./.test(acc.replace(/ctx\.aliadoId/g, "")), "la acción no lee el aliado del formulario");
  });
  test("la lista de contratos del CRM (#68) sigue sin service-role: la propiedad por aliado se ve en «Clientes de aliados»", () => {
    assert.ok(!/createAdminClient/.test(leer("app/(crm)/crm/clientes-contratos/page.tsx")));
  });
  test("migración 322: solo service_role, sin políticas, auditoría y un nombre por aliado; no toca crm_contactos ni personas", () => {
    const sql = leer("supabase/migrations/20260601000322_clientes_aliado.sql").replace(/--.*$/gm, "");
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on table public\.aliado_clientes from public, anon, authenticated/);
    assert.ok(!/create policy/i.test(sql));
    assert.match(sql, /unique \(aliado_id, clave\)/);
    assert.match(sql, /autorizacion_datos boolean not null check \(autorizacion_datos\)/);
    assert.ok(!/(alter|insert into|update|delete from)\s+(table\s+)?public\.(crm_contactos|personas)/i.test(sql));
  });
});
