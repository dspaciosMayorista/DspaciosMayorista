// Se ejecuta con test:react. Edición de usuarios existentes: acción REAL (actualizarUsuario)
// contra un service-role simulado (sin tocar usuarios reales) + lógica pura de efectos.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";
const { actualizarUsuario } = await import("../app/(dashboard)/dashboard/usuarios/actions.ts");
const { crearUsuario, crearAliadoB2B, buscarFichasAliado } = await import("../app/(dashboard)/dashboard/usuarios/actions.ts");
const { efectosDeCambio, diferencias, grupoDeRol } = await import("../lib/usuarios/edicion.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
const sesion = (rol: string, id = "u-actor", perfil: Fila | null | "error" = { activo: true }) => ({
  auth: { getUser: async () => ({ data: { user: { id } } }) },
  from: () => { const a = { select: () => a, eq: () => a, single: async () => (perfil === "error" ? { data: null, error: { message: "x" } } : { data: perfil && { rol, ...perfil }, error: null }) }; return a; },
});
const B2B = { nombre: "Viajes Sur", rol: "agencia", activo: true, tenant: "mayorista", aliado_id: 7, pct_comision: 0.12, acceso_legacy_nombre: false };
const INT = { nombre: "Ana", rol: "venta", activo: true, tenant: "mayorista", aliado_id: null, pct_comision: null, acceso_legacy_nombre: false };

type Opc = { ficha?: Fila | null; fichaError?: boolean; dup?: boolean; dupError?: boolean; updError?: boolean };
function admin(actual: Fila | null, o: Opc = {}) {
  const updates: { patch: Fila; id: unknown }[] = [];
  const tablas: string[] = [];
  const sb = { from(tabla: string) {
    tablas.push(tabla);
    let upd: Fila | null = null; const f: Record<string, unknown> = {};
    const res = () => {
      if (upd) { updates.push({ patch: upd, id: f.id }); return o.updError ? { data: null, error: { message: "x" } } : { data: [{ id: f.id }], error: null }; }
      if (tabla === "aliados") return o.fichaError ? { data: null, error: { message: "x" } } : { data: o.ficha === undefined ? [{ id: 7, tipo: "agencia" }] : (o.ficha ? [o.ficha] : []), error: null };
      if (o.dupError) return { data: null, error: { message: "x" } };
      return { data: o.dup ? { id: "otro" } : null, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api, in: () => api, ilike: () => api, neq: () => api, limit: () => api,
      eq: (k: string, v: unknown) => { f[k] = v; return api; },
      update: (p: Fila) => { upd = p; return api; },
      maybeSingle: async () => res(),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (tabla === "usuarios" && !upd && actual !== undefined && !("__dup" in f)) {
          // lectura del usuario objetivo (select con .limit(1))
          return Promise.resolve({ data: actual ? [actual] : [], error: null }).then(ok, ko);
        }
        return Promise.resolve(res()).then(ok, ko);
      },
    };
    return api;
  } };
  return { sb, updates, tablas };
}
afterEach(() => { __resetClient(); __resetAdmin(); });
const act = (rol: string, a: ReturnType<typeof admin>, id = "u-actor") => { __setClient(sesion(rol, id) as never); __setAdmin(a.sb); };
const err = (r: { ok: boolean }) => (r as unknown as { error: string }).error;

test("sin rol de gestión: rechaza y no lee ni escribe", async () => {
  const a = admin(INT); act("venta", a);
  assert.equal((await actualizarUsuario("u1", { nombre: "X" })).ok, false);
  assert.equal(a.tablas.length, 0);
});

test("llamada directa con correo o contraseña → rechazada, nada escrito", async () => {
  for (const extra of [{ email: "x@y.co" }, { password: "nueva123" }, { acceso_legacy_nombre: true }, { id: "otro" }]) {
    const a = admin(INT); act("superadmin", a);
    const r = await actualizarUsuario("u1", { nombre: "Nuevo", ...extra } as never);
    assert.equal(r.ok, false);
    assert.match(err(r), /No se puede modificar/);
    assert.equal(a.updates.length, 0);
  }
});

test("edita nombre/estado: solo envía lo que cambió (nunca email ni acceso legacy)", async () => {
  const a = admin(INT); act("administracion", a);
  assert.deepEqual(await actualizarUsuario("u1", { nombre: "  Ana Paz ", activo: false, rol: "venta" }), { ok: true });
  assert.deepEqual(a.updates[0].patch, { nombre: "Ana Paz", activo: false });
  assert.equal(a.updates[0].id, "u1");
});

test("conserva vínculos: renombrar un B2B no toca aliado_id ni acceso legacy", async () => {
  const a = admin(B2B); act("superadmin", a);
  assert.deepEqual(await actualizarUsuario("u1", { nombre: "Viajes Sur SAS" }), { ok: true });
  assert.deepEqual(Object.keys(a.updates[0].patch), ["nombre"]);
});

test("elevación: administración no asigna superadmin ni edita a un superadmin", async () => {
  let a = admin(INT); act("administracion", a);
  assert.match(err(await actualizarUsuario("u1", { rol: "superadmin" })), /Solo superadmin/);
  a = admin({ ...INT, rol: "superadmin" }); act("administracion", a);
  assert.match(err(await actualizarUsuario("u1", { nombre: "Z" })), /Solo superadmin/);
  assert.equal(a.updates.length, 0);
  a = admin(INT); act("superadmin", a);
  assert.equal((await actualizarUsuario("u1", { rol: "superadmin" })).ok, true);
});

test("tenant: solo superadmin mueve de agencia; no puedes cambiar tu propio rol ni desactivarte", async () => {
  let a = admin(INT); act("administracion", a);
  assert.match(err(await actualizarUsuario("u1", { tenant: "minorista" })), /superadmin/);
  a = admin(INT); act("superadmin", a);
  assert.equal((await actualizarUsuario("u1", { tenant: "minorista" })).ok, true);
  a = admin(INT); act("superadmin", a, "u1");
  assert.match(err(await actualizarUsuario("u1", { activo: false })), /propio rol/);
  assert.match(err(await actualizarUsuario("u1", { rol: "gerencia" })), /propio rol/);
});

test("rol B2B ↔ ficha: ficha de otro tipo, inexistente o en rol interno → rechaza", async () => {
  let a = admin(B2B, { ficha: { id: 9, tipo: "freelance" } }); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { aliado_id: 9 })), /tipo freelance/);
  a = admin(B2B, { ficha: null }); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { aliado_id: 9 })), /no existe/);
  a = admin(INT); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { aliado_id: 9 })), /Solo agencia o freelance/);
  assert.match(err(await actualizarUsuario("u1", { pct_comision: 0.1 })), /solo aplica/);
  a = admin(B2B, { ficha: { id: 9, tipo: "agencia" } }); act("superadmin", a);
  assert.equal((await actualizarUsuario("u1", { aliado_id: 9 })).ok, true);
  assert.deepEqual(a.updates[0].patch, { aliado_id: 9 });
});

test("cambiar a rol B2B con ficha de otro tipo se rechaza; falla de lectura detiene todo", async () => {
  let a = admin(B2B, { ficha: { id: 7, tipo: "agencia" } }); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { rol: "freelance" })), /tipo agencia/);
  a = admin(B2B, { fichaError: true }); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { aliado_id: 9 })), /No se guardó nada/);
  a = admin(B2B, { dupError: true }); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { nombre: "Otro" })), /No se guardó nada/);
  assert.equal(a.updates.length, 0);
});

test("nombre B2B duplicado se rechaza; usuario inexistente y comisión fuera de rango también", async () => {
  let a = admin(B2B, { dup: true }); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { nombre: "Otro" })), /Ya existe un aliado/);
  a = admin(null); act("superadmin", a);
  assert.match(err(await actualizarUsuario("zz", { nombre: "A" })), /No se encontró/);
  a = admin(B2B); act("superadmin", a);
  assert.match(err(await actualizarUsuario("u1", { pct_comision: 1.5 })), /entre 0 y 100/);
});

test("efectos: se describen rol, estado, ficha y agencia; el nombre aclara que no concede acceso", () => {
  const nf = (id: number | null) => (id === null ? "sin ficha" : `F${id}`);
  const e = efectosDeCambio(B2B, { ...B2B, rol: "venta", activo: false, tenant: "minorista", aliado_id: null, nombre: "Z" }, nf).join(" | ");
  assert.match(e, /deja el portal B2B/); assert.match(e, /no podrá iniciar sesión/);
  assert.match(e, /minorista/); assert.match(e, /F7 → sin ficha.*no se reasignan/); assert.match(e, /No reasigna fichas ni contratos/);
  assert.deepEqual(efectosDeCambio(B2B, B2B, nf), []);
  assert.deepEqual(diferencias(B2B, { ...B2B, nombre: " Viajes Sur " }), {});
});

test("clasificación por rol real", () => {
  assert.equal(grupoDeRol("agencia"), "b2b"); assert.equal(grupoDeRol("freelance"), "b2b");
  assert.equal(grupoDeRol("venta"), "internos"); assert.equal(grupoDeRol("control_vuelo"), "internos");
  assert.equal(grupoDeRol("cliente_final"), "otros");
});

test("gestión con cuenta INACTIVA (administración y superadmin): ninguna acción lee ni escribe", async () => {
  for (const rol of ["administracion", "superadmin"]) for (const perfil of [{ activo: false }, { activo: null }, {}, null, "error"] as const) {
    const a = admin(INT); __setAdmin(a.sb); __setClient(sesion(rol, "u-actor", perfil as never) as never);
    const base = { tipo: "agencia" as const, nombre: "N", email: "n@x.co", password: "secreta1", tipoDocumento: "NIT", documento: "1", contacto: "", telefono: "", enlace: { modo: "nueva" as const } };
    const rs = [
      await actualizarUsuario("u1", { nombre: "X" }),
      await crearUsuario({ email: "x@y.co", password: "secreta1", nombre: "X", rol: "venta" }),
      await crearAliadoB2B(base),
      await buscarFichasAliado("1"),
    ];
    assert.deepEqual(rs.map((r) => r.ok), [false, false, false, false], `${rol} ${JSON.stringify(perfil)}`);
    assert.equal(a.tablas.length, 0, "ni siquiera lee con el cliente de servicio");
  }
});

test("cuenta con acceso heredado por nombre: el nombre NO cambia y no se toca el vínculo", async () => {
  const LEG = { ...B2B, acceso_legacy_nombre: true };
  let a = admin(LEG); act("superadmin", a);
  const r = await actualizarUsuario("u1", { nombre: "Otra Agencia SAS" });
  assert.equal(r.ok, false);
  assert.match(err(r), /acceso heredado por nombre.*Concilia primero/);
  assert.equal(a.updates.length, 0);
  // otros campos siguen editables y la acción nunca escribe el flag ni la ficha por su cuenta
  a = admin(LEG); act("superadmin", a);
  assert.equal((await actualizarUsuario("u1", { activo: false })).ok, true);
  assert.deepEqual(a.updates[0].patch, { activo: false });
  // un nombre idéntico (sin cambio real) tampoco escribe nada
  a = admin(LEG); act("superadmin", a);
  assert.deepEqual(await actualizarUsuario("u1", { nombre: " Viajes Sur " }), { ok: true });
  assert.equal(a.updates.length, 0);
});

test("efectos: el aviso del nombre no promete lo que no se cumple", () => {
  const nf = () => "x";
  const normal = efectosDeCambio(B2B, { ...B2B, nombre: "Z" }, nf, false).join(" ");
  assert.match(normal, /No reasigna fichas ni contratos; esta cuenta no tiene acceso heredado/);
  assert.doesNotMatch(normal, /solo cambia la etiqueta/);
  assert.match(efectosDeCambio(B2B, { ...B2B, nombre: "Z" }, nf, true).join(" "), /Bloqueado.*Concilia primero/);
});