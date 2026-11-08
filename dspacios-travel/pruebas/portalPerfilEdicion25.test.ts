// #25 — edición de «Mi perfil». FIXTURES LOCALES: base en memoria con dos agencias, un freelance, un agente y una cuenta con acceso heredado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guardarPerfilServidor as guardarReal, type AdminPerfil } from "../lib/portal/perfilEdicionServidor.ts";
import { permisosPerfil, validarCampoFicha, normalizarNombre } from "../lib/portal/perfilEdicion.ts";

type Fila = Record<string, unknown>;

// Equivale a «abrir el formulario justo antes de guardar»: `esperado` = valores que hay en ese momento. Las pruebas de edición desfasada
// pasan `esperado` explícito (ver más abajo) y entonces no se rellena.
let dbActual: ReturnType<typeof baseDatos> | null = null;
const guardarPerfilServidor: typeof guardarReal = (admin, sesion, entrada) => {
  const e = entrada as unknown as Record<string, unknown>;
  if (e.esperado !== undefined || !sesion || !dbActual) return guardarReal(admin, sesion, entrada);
  const u = dbActual.usuarios.find((x) => x.id === sesion.id);
  const f = dbActual.aliados.find((x) => x.id === u?.aliado_id);
  const origen = e.seccion === "usuario" ? u : f;
  const esperado: Fila = {};
  for (const k of ["nombre", "contacto", "telefono", "email", "direccion"]) esperado[k] = origen?.[k] ?? null;
  return guardarReal(admin, sesion, { ...entrada, esperado } as never);
};
function baseDatos() {
  return {
    usuarios: [
      { id: "ua", email: "a@a.test", rol: "agencia", activo: true, agencia_id: null, aliado_id: 1, acceso_legacy_nombre: false, nombre: "Viajes Alfa SAS" },
      { id: "ua-ag", email: "ag@a.test", rol: "agencia", activo: true, agencia_id: "ua", aliado_id: null, acceso_legacy_nombre: false, nombre: "Agente Alfa" },
      { id: "ua-ag2", email: "ag2@a.test", rol: "agencia", activo: true, agencia_id: "ua", aliado_id: 1, acceso_legacy_nombre: false, nombre: "Agente Con Ficha" }, // aliado_id NO lo hace titular
      { id: "ub", email: "b@b.test", rol: "agencia", activo: true, agencia_id: null, aliado_id: 2, acceso_legacy_nombre: false, nombre: "Viajes Beta SAS" },
      { id: "uf", email: "f@f.test", rol: "freelance", activo: true, agencia_id: null, aliado_id: 3, acceso_legacy_nombre: false, nombre: "Freelance Fulano" },
      { id: "ul", email: "l@l.test", rol: "agencia", activo: true, agencia_id: null, aliado_id: 4, acceso_legacy_nombre: true, nombre: "Legado Tours" },
      { id: "ui", email: "i@i.test", rol: "agencia", activo: false, agencia_id: null, aliado_id: 5, acceso_legacy_nombre: false, nombre: "Inactiva" },
      { id: "uv", email: "v@v.test", rol: "venta", activo: true, agencia_id: null, aliado_id: null, acceso_legacy_nombre: false, nombre: "Asesor Interno" },
    ] as Fila[],
    aliados: [
      { id: 1, nombre: "Viajes Alfa SAS", contacto: "Ana", telefono: "3001112233", email: "ana@alfa.test", direccion: "Calle 1", nit: "900111", banco: "B1", numero_cuenta: "111", pct_retencion: 0.11 },
      { id: 2, nombre: "Viajes Beta SAS", contacto: "Beto", telefono: "3002223344", email: "beto@beta.test", direccion: "Calle 2", nit: "900222", banco: "B2", numero_cuenta: "222", pct_retencion: 0 },
      { id: 3, nombre: "Freelance Fulano", contacto: null, telefono: "3003334455", email: "f@f.test", direccion: null, nit: "123", banco: null, numero_cuenta: null, pct_retencion: 0 },
      { id: 4, nombre: "Legado Tours", contacto: null, telefono: null, email: null, direccion: null, nit: "900444", banco: null, numero_cuenta: null, pct_retencion: 0 },
    ] as Fila[],
    auditoria: [] as Fila[],
  };
}
type Db = ReturnType<typeof baseDatos>;

function falso(db: Db, opts: { fallarAuditoria?: boolean } = {}) {
  dbActual = db;
  const escrituras: { tabla: string; payload: Fila; id: unknown }[] = [];
  const base = {
    from: (tabla: string) => {
      const st: { op: string; payload?: Fila; filtros: ((r: Fila) => boolean)[]; head?: boolean; count?: boolean; ord?: string; rango?: [number, number] } = { op: "select", filtros: [] };
      const filas = () => (db as unknown as Record<string, Fila[]>)[tabla].filter((r) => st.filtros.every((f) => f(r)));
      const ejecutar = () => {
        const todas = filas();
        if (st.op === "insert") {
          if (opts.fallarAuditoria && tabla === "auditoria") return { data: null, error: { message: "x" }, count: null };
          (db as unknown as Record<string, Fila[]>)[tabla].push(st.payload!);
          return { data: null, error: null, count: null };
        }
        if (st.op === "update") {
          for (const r of todas) { Object.assign(r, st.payload); escrituras.push({ tabla, payload: st.payload!, id: r.id }); }
          return { data: todas.map((r) => ({ id: r.id })), error: null, count: null };
        }
        const orden = st.ord ? [...todas].sort((a, b) => String(a[st.ord!]).localeCompare(String(b[st.ord!]))) : todas;
        const pag = st.rango ? orden.slice(st.rango[0], st.rango[1] + 1) : orden;
        return { data: st.head ? null : pag, error: null, count: st.count ? todas.length : null };
      };
      const q: any = {
        select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.count) st.count = true; if (o?.head) st.head = true; return q; },
        update: (p: Fila) => { st.op = "update"; st.payload = p; return q; },
        insert: (p: Fila) => { st.op = "insert"; st.payload = p; return q; },
        eq: (c: string, v: unknown) => { st.filtros.push((r) => r[c] === v); return q; },
        neq: (c: string, v: unknown) => { st.filtros.push((r) => r[c] !== v); return q; },
        in: (c: string, v: unknown[]) => { st.filtros.push((r) => v.includes(r[c])); return q; },
        is: (c: string, v: unknown) => { st.filtros.push((r) => (r[c] ?? null) === v); return q; },
        order: (c: string) => { st.ord = c; return q; },
        range: (d: number, h: number) => { st.rango = [d, h]; return q; },
        maybeSingle: () => { const r = ejecutar(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : null, error: r.error }); },
        then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(res, rej),
      };
      return q;
    },
  };
  // Doble de la RPC `guardar_perfil_portal` (migración 283) para probar la capa TS: aplica el cambio y la auditoría juntos y, si la
  // auditoría falla, no deja nada. El comportamiento REAL de la transacción lo prueban pruebas/perfilAtomico283.pg.ts contra Postgres.
  const rpc = async (_fn: string, a: Record<string, unknown>) => {
    const u = db.usuarios.find((x) => x.id === a.p_actor_id);
    const cambios = a.p_cambios as Fila;
    const esFicha = a.p_seccion === "ficha";
    const fila = esFicha ? db.aliados.find((x) => x.id === u?.aliado_id) : u;
    if (!u || !fila) return { data: { ok: false, codigo: "no_autorizado" }, error: null };
    const esperado = a.p_esperado as Fila;
    for (const k of Object.keys(cambios)) if ((esperado[k] ?? null) !== (fila[k] ?? null)) return { data: { ok: false, codigo: "conflicto" }, error: null };
    if (opts.fallarAuditoria) return { data: null, error: { message: "auditoria" } }; // transacción revertida: la fila no se tocó
    const antes: Fila = {}; for (const k of Object.keys(cambios)) antes[k] = fila[k] ?? null;
    Object.assign(fila, cambios);
    escrituras.push({ tabla: esFicha ? "aliados" : "usuarios", payload: cambios, id: fila.id });
    const cam: Fila = {}; for (const k of Object.keys(cambios)) cam[k] = { antes: antes[k], despues: cambios[k] };
    db.auditoria.push({ actor_id: a.p_actor_id, actor_email: a.p_actor_email, actor_nombre: u.nombre, actor_rol: u.rol, accion: "UPDATE", tabla: esFicha ? "aliados" : "usuarios", registro_id: String(fila.id), antes, despues: cambios, cambios: cam });
    return { data: { ok: true, cambios: Object.keys(cambios) }, error: null };
  };
  const admin: AdminPerfil = { ...base, rpc };
  return { admin, escrituras };
}
const ses = (id: string) => ({ id, email: `${id}@s.test` });
const ficha = (db: Db, id: number) => db.aliados.find((a) => a.id === id)!;

test("titular de agencia edita su ficha: solo esa ficha cambia y la auditoría identifica al usuario", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  const r = await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", telefono: "+57 300 999 8877", direccion: "  Carrera 7  ", contacto: "Ana María" });
  assert.deepEqual(r, { ok: true, cambios: ["contacto", "telefono", "direccion"] });
  assert.equal(ficha(db, 1).telefono, "+573009998877");
  assert.equal(ficha(db, 1).direccion, "Carrera 7");
  assert.equal(ficha(db, 2).telefono, "3002223344"); // la otra agencia no se toca
  assert.ok(escrituras.every((e) => e.tabla === "aliados" && e.id === 1));
  const a = db.auditoria[0];
  assert.equal(a.actor_id, "ua"); assert.equal(a.actor_email, "ua@s.test"); assert.equal(a.actor_nombre, "Viajes Alfa SAS"); assert.equal(a.actor_rol, "agencia");
  assert.equal(a.tabla, "aliados"); assert.equal(a.registro_id, "1"); assert.equal(a.accion, "UPDATE");
  assert.deepEqual((a.cambios as Record<string, unknown>).telefono, { antes: "3001112233", despues: "+573009998877" });
});

test("campos protegidos e identificadores del formulario se ignoran (rol, aliado_id, NIT, banco, comisión, tenant…)", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  const hostil = { seccion: "ficha", telefono: "3004445566", aliado_id: 2, id: 2, nit: "999", banco: "X", numero_cuenta: "9", pct_retencion: 0.5, pct_comision: 0.9, rol: "superadmin", activo: false, tenant: "minorista", acceso_legacy_nombre: true, email_acceso: "x@x.test" };
  const r = await guardarPerfilServidor(admin, ses("ua"), hostil as never);
  assert.equal(r.ok, true);
  assert.deepEqual(escrituras.map((e) => [e.tabla, e.id, Object.keys(e.payload)]), [["aliados", 1, ["telefono"]]]);
  assert.equal(ficha(db, 1).nit, "900111"); assert.equal(ficha(db, 2).telefono, "3002223344");
  assert.equal(db.usuarios.find((u) => u.id === "ua")!.rol, "agencia");
});

test("tener aliado_id NO convierte en titular: un agente con ficha enlazada no edita la ficha", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  const r = await guardarPerfilServidor(admin, ses("ua-ag2"), { seccion: "ficha", telefono: "3009998877" });
  assert.equal(r.ok, false);
  assert.equal(escrituras.length, 0); assert.equal(db.auditoria.length, 0);
  assert.equal(permisosPerfil(db.usuarios[2] as never, false).puedeFicha, false);
});

test("agente sin ficha: no edita ficha, sí su propio nombre (sin tocar a la agencia)", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  assert.equal((await guardarPerfilServidor(admin, ses("ua-ag"), { seccion: "ficha", nombre: "Otra", confirmaNombreFicha: true })).ok, false);
  assert.equal(escrituras.length, 0);
  assert.deepEqual(await guardarPerfilServidor(admin, ses("ua-ag"), { seccion: "usuario", nombre: "Agente Alfa Renombrado" }), { ok: true, cambios: ["nombre"] });
  assert.deepEqual(escrituras.map((e) => [e.tabla, e.id]), [["usuarios", "ua-ag"]]);
  assert.equal(ficha(db, 1).nombre, "Viajes Alfa SAS");
  assert.equal(db.auditoria[0].actor_id, "ua-ag");
});

test("acceso heredado por nombre: el nombre de usuario queda bloqueado y nada se escribe", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  const r = await guardarPerfilServidor(admin, ses("ul"), { seccion: "usuario", nombre: "Otro Nombre" });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /contratos anteriores/);
  assert.equal(escrituras.length, 0);
  // los demás datos de la ficha siguen editables
  assert.equal((await guardarPerfilServidor(admin, ses("ul"), { seccion: "ficha", telefono: "3001234567" })).ok, true);
  // acceso_legacy desconocido (null) también se trata como bloqueado
  assert.equal(permisosPerfil({ ...(db.usuarios[0] as never as object), acceso_legacy_nombre: null } as never, false).puedeNombreUsuario, false);
});

test("cambiar el nombre de la ficha exige confirmación explícita (cuenta de cobro)", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  const sin = await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", nombre: "Viajes Alfa Internacional SAS" });
  assert.equal(sin.ok, false); assert.match((sin as { error: string }).error, /cuenta de cobro/); assert.equal(escrituras.length, 0);
  const con = await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", nombre: "Viajes Alfa Internacional SAS", confirmaNombreFicha: true });
  assert.deepEqual(con, { ok: true, cambios: ["nombre"] });
  assert.equal(ficha(db, 1).nombre, "Viajes Alfa Internacional SAS");
  // sin cambio de nombre no se pide confirmación
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", telefono: "3005556677" })).ok, true);
});

test("nombre duplicado (sin tildes/mayúsculas) de otro aliado o usuario se rechaza; el propio se permite", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", nombre: "  VIAJES  beta sas ", confirmaNombreFicha: true })).ok, false);
  assert.equal((await guardarPerfilServidor(admin, ses("ua-ag"), { seccion: "usuario", nombre: "viajes alfa sas" })).ok, false); // nombre de la ficha de su agencia: no se duplica
  assert.equal((await guardarPerfilServidor(admin, ses("uf"), { seccion: "usuario", nombre: "Freelance Fulano" })).ok, true); // el propio = sin cambios
  assert.equal(escrituras.length, 0);
  assert.equal(normalizarNombre(" Árbol  Ñandú "), "arbol nandu");
});

test("validaciones: nombre, teléfono, correo, longitudes; opcionales vacíos pasan a null", async () => {
  assert.deepEqual(validarCampoFicha("telefono", "(300) 123-4567"), { ok: true, valor: "3001234567" });
  assert.equal(validarCampoFicha("telefono", "123").ok, false);
  assert.equal(validarCampoFicha("telefono", "abc1234567").ok, false);
  assert.deepEqual(validarCampoFicha("email", " ANA@Alfa.TEST "), { ok: true, valor: "ana@alfa.test" });
  assert.equal(validarCampoFicha("email", "no-es-correo").ok, false);
  assert.equal(validarCampoFicha("direccion", "x".repeat(201)).ok, false);
  assert.equal(validarCampoFicha("contacto", "x".repeat(121)).ok, false);
  assert.deepEqual(validarCampoFicha("direccion", "   "), { ok: true, valor: null });
  const db = baseDatos(); const { admin } = falso(db);
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", nombre: "ab", confirmaNombreFicha: true })).ok, false);
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", direccion: "" })).ok, true);
  assert.equal(ficha(db, 1).direccion, null);
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", email: "mal" })).ok, false);
});

test("freelance: edita su ficha sin persona de contacto (no aplica); otras agencias intactas", async () => {
  const db = baseDatos(); const { admin } = falso(db);
  const r = await guardarPerfilServidor(admin, ses("uf"), { seccion: "ficha", contacto: "Nadie", direccion: "Calle 9" });
  assert.deepEqual(r, { ok: true, cambios: ["direccion"] });
  assert.equal(ficha(db, 3).contacto, null);
});

test("ficha compartida por otra cuenta titular: no se edita por implicación", async () => {
  const db = baseDatos();
  db.usuarios.push({ id: "ua-otra", email: "o@a.test", rol: "agencia", activo: true, agencia_id: null, aliado_id: 1, acceso_legacy_nombre: false, nombre: "Otra Titular" });
  const { admin, escrituras } = falso(db);
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", telefono: "3001230000" })).ok, false);
  assert.equal(escrituras.length, 0);
});

test("sin sesión, usuario inexistente, inactivo o interno: sin permiso y sin escrituras", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  for (const s of [null, ses("nadie"), ses("ui"), ses("uv")]) {
    assert.equal((await guardarPerfilServidor(admin, s, { seccion: "ficha", telefono: "3001230000" })).ok, false);
    assert.equal((await guardarPerfilServidor(admin, s, { seccion: "usuario", nombre: "Hackeado" })).ok, false);
  }
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "otra" } as never)).ok, false);
  assert.equal(escrituras.length, 0);
});

test("si la auditoría falla (doble de la RPC) la capa TS devuelve error y no queda nada escrito", async () => {
  const db = baseDatos(); const { admin } = falso(db, { fallarAuditoria: true });
  const r = await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", telefono: "3009990000" });
  assert.equal(r.ok, false);
  assert.equal(ficha(db, 1).telefono, "3001112233");
  assert.equal(db.auditoria.length, 0);
  const r2 = await guardarPerfilServidor(admin, ses("uf"), { seccion: "usuario", nombre: "Fulano Nuevo Nombre" });
  assert.equal(r2.ok, false);
  assert.equal(db.usuarios.find((u) => u.id === "uf")!.nombre, "Freelance Fulano");
});

test("sin cambios: no escribe ni audita", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  assert.deepEqual(await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", telefono: "3001112233", email: "ana@alfa.test" }), { ok: true, cambios: [] });
  assert.equal(escrituras.length, 0); assert.equal(db.auditoria.length, 0);
});

test("aislamiento: cada titular solo toca su ficha aunque mande la del otro", async () => {
  const db = baseDatos(); const { admin } = falso(db);
  await guardarPerfilServidor(admin, ses("ub"), { seccion: "ficha", telefono: "3006667788", aliadoId: 1, aliado_id: 1 } as never);
  assert.equal(ficha(db, 2).telefono, "3006667788");
  assert.equal(ficha(db, 1).telefono, "3001112233");
});

test("cableado: la acción lee la identidad de la sesión y el formulario no envía campos protegidos", () => {
  const a = readFileSync(new URL("../app/portal/b2b/perfil/actions.ts", import.meta.url), "utf8");
  assert.match(a, /auth\.getUser\(\)/);
  assert.doesNotMatch(a, /entrada\??\.(rol|aliado|activo|tenant|nit|banco|id)\b/);
  const e = readFileSync(new URL("../app/portal/b2b/perfil/PerfilEditor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(e, /aliado_id|aliadoId|rol:|activo|tenant|nit|banco|numero_cuenta|pct_/);
});

test("edición desfasada: el formulario abierto con A, otra operación guarda B, guardar C → conflicto y B intacto (con su auditoría)", async () => {
  const db = baseDatos(); const { admin } = falso(db);
  const A = { telefono: "3001112233" };
  assert.equal((await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", telefono: "3004445566", esperado: { telefono: A.telefono } } as never)).ok, true); // B
  const r = await guardarPerfilServidor(admin, ses("ua"), { seccion: "ficha", telefono: "3007778899", esperado: { telefono: A.telefono } } as never); // C sobre A
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambiaron mientras editabas/);
  assert.equal(ficha(db, 1).telefono, "3004445566");
  assert.equal(db.auditoria.length, 1);
  assert.equal((db.auditoria[0].despues as Fila).telefono, "3004445566");
});

test("el original viene del formulario, no de la lectura al guardar: sin `esperado` (o con uno inválido) no se guarda nada", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  for (const esperado of [undefined, null, [], { nombre: 5 }, {}, { telefono: undefined }, { telefono: "x".repeat(401) }]) {
    const entrada = { seccion: "ficha", telefono: "3009998877", ...(esperado === undefined ? {} : { esperado }) } as never;
    // esperado === undefined → el envoltorio de la prueba lo rellenaría: se llama a la función real para probar el rechazo.
    const r = await guardarReal(admin, ses("ua"), entrada);
    assert.equal(r.ok, false, JSON.stringify(esperado));
  }
  assert.equal((await guardarReal(admin, ses("ua-ag"), { seccion: "usuario", nombre: "Nuevo Nombre" } as never)).ok, false);
  assert.equal(escrituras.length, 0);
});

test("solo cuenta lo que la persona tocó: un campo igual al original no se valida ni se envía", async () => {
  const db = baseDatos(); db.aliados[0].telefono = "dato viejo no válido"; // legado inválido que la persona no toca
  const { admin, escrituras } = falso(db);
  const r = await guardarReal(admin, ses("ua"), { seccion: "ficha", telefono: "dato viejo no válido", direccion: "Calle 99", esperado: { telefono: "dato viejo no válido", direccion: "Calle 1" } } as never);
  assert.deepEqual(r, { ok: true, cambios: ["direccion"] });
  assert.deepEqual(escrituras.map((e) => Object.keys(e.payload)), [["direccion"]]);
});

test("el original no autoriza ni elige la ficha: un esperado ajeno solo produce conflicto, nunca acceso", async () => {
  const db = baseDatos(); const { admin, escrituras } = falso(db);
  const r = await guardarReal(admin, ses("ub"), { seccion: "ficha", telefono: "3001230000", aliado_id: 1, esperado: { telefono: "3001112233" } } as never); // esperado de la ficha de Alfa
  assert.equal(r.ok, false);
  assert.equal(escrituras.length, 0);
  assert.equal(ficha(db, 1).telefono, "3001112233");
});
