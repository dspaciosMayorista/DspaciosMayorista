// #25 (ADL-039) — Historial de los datos del PROPIO aliado, con el cargador REAL contra una base en memoria (la RLS de `auditoria` no se ejercita aquí:
// la autorización de esta ruta es código, con service-role). Cubre: aislamiento A/B, agente/inactivo/interno/sin sesión, enmascarado bancario, campos
// internos ocultos, sin identidad del personal, gemelas del portal, acotación y número de lecturas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cargarHistorialPropio, TOPE_HISTORIAL } from "../lib/portal/historialPropio.ts";
import { supabaseEnMemoria } from "./support/memoriaSupabase.ts";

type Fila = Record<string, unknown>;
const U_A = "u-aaaa", U_B = "u-bbbb";
const usuario = (id: string, aliado: number | null, extra: Fila = {}): Fila => ({ id, rol: "freelance", activo: true, agencia_id: null, aliado_id: aliado, ...extra });
let seq = 0;
const aud = (tabla: string, registro: string, cambios: Fila, extra: Fila = {}): Fila => ({
  id: ++seq, tabla, registro_id: registro, creado_en: `2026-11-${String(10 + (seq % 15)).padStart(2, "0")}T10:00:00Z`, actor_email: "staff-secreto@dspacios.test",
  actor_nombre: "Operadora Interna", actor_rol: "gerencia", accion: "UPDATE", despues: {}, cambios, ...extra,
});
const par = (antes: unknown, despues: unknown) => ({ antes, despues });

function mundo(extra: Fila[] = []) {
  const tablas: Record<string, Fila[]> = {
    usuarios: [
      usuario(U_A, 7), usuario(U_B, 8),
      usuario("u-agente", 7, { rol: "agencia", agencia_id: "u-titular" }), usuario("u-inact", 7, { activo: false }),
      usuario("u-venta", null, { rol: "venta" }), usuario("u-sinficha", null),
    ],
    auditoria: [
      aud("aliados", "7", { telefono: par("3001112222", "3009998888") }),
      aud("aliados", "7", { numero_cuenta: par("1234567890", "9876543210"), banco: par("A", "B") }, { actor_nombre: "Otra Persona" }),
      aud("aliados", "7", { pct_comision: par(0.1, 0.12), aplica_retencion: par(false, true), activo: par(true, false) }), // solo internos: no se muestran
      aud("aliados", "7", { nombre: par("Laura Gomes", "Laura Gómez") }),
      aud("aliados", "8", { telefono: par("3110000000", "3120000000") }),
      aud("usuarios", U_A, { nombre: par("Laura G", "Laura Gómez") }),
      aud("usuarios", U_A, { email: par("a@x.test", "b@x.test"), rol: par("freelance", "agencia") }), // campos de la cuenta que no se muestran
      aud("usuarios", U_B, { nombre: par("Beto", "Alberto") }),
      aud("aliados", "7", {}, { accion: "INSERT", cambios: null }),
      aud("usuarios", U_A, {}, { accion: "INSERT", cambios: null }),
      ...extra,
    ],
  };
  return tablas;
}
function cuenta(tablas: Record<string, Fila[]>, opts = {}) {
  const base = supabaseEnMemoria(tablas, opts);
  const lecturas: string[] = [];
  return { admin: { from: (t: string) => { lecturas.push(t); return base.from(t); } } as never, lecturas };
}
const txt = (r: unknown) => JSON.stringify(r);

test("H25-1 el aliado A ve SOLO el historial de su ficha y de su nombre; nada de B", async () => {
  const { admin } = cuenta(mundo());
  const r = await cargarHistorialPropio(admin, U_A);
  assert.equal(r.estado, "ok");
  if (r.estado !== "ok") return;
  const campos = r.lineas.flatMap((l) => l.cambios.map((c) => c.campo)).sort();
  assert.deepEqual(campos, ["Banco", "Nombre", "Nombre", "Número de cuenta", "Teléfono"]);
  assert.ok(!txt(r).includes("3120000000") && !txt(r).includes("Alberto"), "ni el teléfono ni el nombre de B");
  assert.equal(r.lineas.filter((l) => l.accion === "Alta").length, 1, "solo el alta de la ficha; el alta de la cuenta no se muestra");
});

test("H25-2 el aliado B ve lo suyo y no lo de A (simétrico)", async () => {
  const { admin } = cuenta(mundo());
  const r = await cargarHistorialPropio(admin, U_B);
  assert.equal(r.estado, "ok");
  if (r.estado !== "ok") return;
  assert.deepEqual(r.lineas.flatMap((l) => l.cambios.map((c) => `${c.campo}:${c.despues}`)).sort(), ["Nombre:Alberto", "Teléfono:3120000000"]);
  assert.ok(!txt(r).includes("3009998888") && !txt(r).includes("Gómez"));
});

test("H25-3 la cuenta bancaria solo con los últimos cuatro dígitos y no se filtra ningún valor completo", async () => {
  const { admin } = cuenta(mundo());
  const r = await cargarHistorialPropio(admin, U_A);
  const s = txt(r);
  assert.ok(s.includes("****7890") && s.includes("****3210"));
  assert.ok(!s.includes("1234567890") && !s.includes("9876543210"));
});

test("H25-4 sin identidad del personal interno y sin campos internos (comisión, retención, activo, rol, correo de la cuenta)", async () => {
  const { admin } = cuenta(mundo());
  const s = txt(await cargarHistorialPropio(admin, U_A));
  for (const prohibido of ["staff-secreto", "Operadora Interna", "Otra Persona", "gerencia", "actor", "% de comisión", "Aplica retención", "Activo", "Correo", "a@x.test", "agencia"]) {
    assert.ok(!s.includes(prohibido), `no debe aparecer «${prohibido}»`);
  }
});

test("H25-5 el origen se distingue: portal (_via) frente a interno; las filas gemelas del portal cuentan una vez", async () => {
  const t = mundo([
    aud("aliados", "7", { direccion: par("Calle 1", "Calle 2") }, { creado_en: "2026-11-30T09:00:00Z" }),
    aud("aliados", "7", { direccion: par("Calle 1", "Calle 2") }, { creado_en: "2026-11-30T09:00:00Z", despues: { _via: "portal_b2b_perfil" }, actor_nombre: "Laura" }),
  ]);
  const r = await cargarHistorialPropio(cuenta(t).admin, U_A);
  if (r.estado !== "ok") throw new Error("estado");
  const dir = r.lineas.filter((l) => l.cambios.some((c) => c.campo === "Dirección"));
  assert.equal(dir.length, 1);
  assert.equal(dir[0].origen, "portal");
  assert.equal(r.lineas.find((l) => l.cambios.some((c) => c.campo === "Teléfono"))?.origen, "interno");
  assert.equal(r.lineas[0].fecha, "2026-11-30T09:00:00Z", "más reciente primero");
});

test("H25-6 no aplica a agentes, cuentas inactivas, roles internos, sin ficha pero con cuenta ni usuario inexistente; nunca se consulta auditoría", async () => {
  for (const id of ["u-agente", "u-inact", "u-venta", "u-no-existe", "", null]) {
    const { admin, lecturas } = cuenta(mundo());
    assert.deepEqual(await cargarHistorialPropio(admin, id as string | null), { estado: "no_aplica" }, String(id));
    assert.ok(!lecturas.includes("auditoria"), `${id}: no debe leer auditoría`);
  }
  // Cuenta activa sin ficha: solo su nombre, jamás la ficha de otro.
  const r = await cargarHistorialPropio(cuenta(mundo()).admin, "u-sinficha");
  assert.deepEqual(r, { estado: "ok", lineas: [] });
});

test("H25-7 un fallo de lectura se avisa como error, nunca como «sin cambios»", async () => {
  for (const tabla of ["usuarios", "auditoria"]) {
    const { admin } = cuenta(mundo(), { fallar: (c: { tabla: string }) => (c.tabla === tabla ? "error" : null) });
    assert.deepEqual(await cargarHistorialPropio(admin, U_A), { estado: "error" }, tabla);
  }
  const { admin } = cuenta(mundo(), { fallar: (c: { tabla: string }) => (c.tabla === "auditoria" ? "lanzar" : null) });
  assert.deepEqual(await cargarHistorialPropio(admin, U_A), { estado: "error" }, "una excepción de red no tumba la página del perfil ni se presenta como vacío");
});

test("H25-8 acotado: máximo 100 filas por lectura y exactamente 3 lecturas por apertura (usuario + ficha + cuenta), sin sondeo", async () => {
  const muchas: Fila[] = Array.from({ length: 250 }, (_, i) => aud("aliados", "7", { telefono: par(`30${i}`, `31${i}`) }, { creado_en: `2026-12-01T00:${String(i % 60).padStart(2, "0")}:00Z` }));
  const { admin, lecturas } = cuenta(mundo(muchas));
  const r = await cargarHistorialPropio(admin, U_A);
  assert.equal(r.estado, "ok");
  if (r.estado !== "ok") return;
  assert.ok(r.lineas.filter((l) => l.cambios.some((c) => c.campo === "Teléfono")).length <= TOPE_HISTORIAL);
  assert.deepEqual(lecturas, ["usuarios", "auditoria", "auditoria"]);
});
