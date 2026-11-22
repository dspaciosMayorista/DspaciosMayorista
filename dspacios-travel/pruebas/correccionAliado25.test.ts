// #25 (ADL-039) — Corrección de la ficha de un aliado por superadmin/gerencia, con el servidor REAL (`corregirFichaAliado`) sobre filas en memoria
// compartidas entre el cliente de lectura (service-role) y el de escritura (sesión de quien corrige, con UPDATE condicionado como lo ejecuta PostgREST).
// La auditoría con actor la escribe el disparador 087 y no se simula aquí (ver test_25_correccion_auditoria.sql, NO ejecutado sin Docker).
import { test } from "node:test";
import assert from "node:assert/strict";
import { corregirFichaAliado, MSG_SIN_PERMISO_CORRECCION, MSG_CONFLICTO_CORRECCION, MSG_NOMBRE_DUPLICADO, MSG_DOCUMENTO_DUPLICADO } from "../lib/aliados/correccionServidor.ts";
import { cambiosCorreccion, MSG_CONFIRMA_IMPACTO, MSG_RECARGA_CORRECCION } from "../lib/aliados/correccion.ts";
import { supabaseEnMemoria } from "./support/memoriaSupabase.ts";

type Fila = Record<string, unknown>;
const ACTOR = (rol: string, extra: Fila = {}) => ({ id: "staff-1", rol, activo: true, ...extra }) as { id: string; rol: string; activo: boolean | null };
const fichas = (): Fila[] => [
  { id: 7, nombre: "Laura Gomes", nit: "900.123.456-7", tipo_documento: "NIT", telefono: "3001112222", email: "laura@x.test", tipo: "freelance", pct_comision: 0.11, numero_cuenta: "1234567890" },
  { id: 8, nombre: "Beto Viajes", nit: "800.555.444-1", tipo_documento: "NIT", telefono: null, email: null, tipo: "agencia", pct_comision: 0.12, numero_cuenta: null },
];
const cuentas = (): Fila[] => [
  { id: "u-laura", nombre: "Laura Gómez", aliado_id: 7, rol: "freelance" },
  { id: "u-beto", nombre: "Beto Viajes", aliado_id: 8, rol: "agencia" },
  { id: "u-int", nombre: "Interna", aliado_id: null, rol: "gerencia" },
];

/** Cliente de escritura: UPDATE … WHERE id=… AND col=esperado … RETURNING id, tal como lo hace PostgREST; cuenta los UPDATE emitidos. */
function escritor(tabla: Fila[], contador: { updates: number }) {
  return {
    from: () => ({
      update(parche: Fila) {
        contador.updates++;
        const filtros: Array<(f: Fila) => boolean> = [];
        const api = {
          eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return api; },
          is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return api; },
          select: async () => {
            const hit = tabla.filter((f) => filtros.every((p) => p(f)));
            for (const f of hit) Object.assign(f, parche);
            return { data: hit.map((f) => ({ id: f.id })), error: null };
          },
        };
        return api;
      },
    }),
  };
}
function mundo() {
  const t = { aliados: fichas(), usuarios: cuentas() };
  const c = { updates: 0 };
  return { t, c, deps: { sb: escritor(t.aliados, c), admin: supabaseEnMemoria(t) } as never };
}
const esperado = (f: Fila) => ({ nombre: f.nombre, telefono: f.telefono, email: f.email, tipo_documento: f.tipo_documento, nit: f.nit });
const entrada = (f: Fila, cambios: Fila, extra: Fila = {}) => ({ ...cambios, esperado: esperado(f), confirmaImpacto: true, ...extra });

test("C25-1 superadmin corrige nombre, teléfono, correo y documento; cambia exactamente eso y nada más; un solo UPDATE", async () => {
  const { t, c, deps } = mundo();
  const antes = { ...t.aliados[0] };
  const r = await corregirFichaAliado(deps, ACTOR("superadmin"), 7, entrada(antes, { nombre: "Laura Gómez", telefono: "+57 300 999 8888", email: "LAURA.G@X.TEST", tipoDocumento: "CC", nit: "52123456" }));
  assert.deepEqual(r, { ok: true, cambios: ["Nombre", "Teléfono", "Correo", "Tipo de documento", "Número de documento"] });
  assert.equal(c.updates, 1);
  assert.deepEqual(
    { n: t.aliados[0].nombre, tel: t.aliados[0].telefono, e: t.aliados[0].email, td: t.aliados[0].tipo_documento, nit: t.aliados[0].nit },
    { n: "Laura Gómez", tel: "+573009998888", e: "laura.g@x.test", td: "CC", nit: "52123456" },
  );
  // Lo que NO se corrige queda intacto, y la otra ficha no se toca.
  assert.equal(t.aliados[0].pct_comision, 0.11); assert.equal(t.aliados[0].numero_cuenta, "1234567890");
  assert.deepEqual(t.aliados[1], fichas()[1]);
});

test("C25-2 gerencia también; administracion, venta, operaciones, agencia, freelance, inactivo y sin sesión NO — sin ningún UPDATE", async () => {
  assert.equal((await corregirFichaAliado(mundo().deps, ACTOR("gerencia"), 7, entrada(fichas()[0], { telefono: "3005550000" }))).ok, true);
  for (const rol of ["administracion", "operaciones", "venta", "agencia", "freelance", "cliente_final", "control_vuelo", ""]) {
    const { c, deps, t } = mundo();
    const r = await corregirFichaAliado(deps, ACTOR(rol), 7, entrada(t.aliados[0], { telefono: "3005550000" }));
    assert.deepEqual(r, { ok: false, error: MSG_SIN_PERMISO_CORRECCION }, rol);
    assert.equal(c.updates, 0, rol); assert.equal(t.aliados[0].telefono, "3001112222", rol);
  }
  for (const actor of [null, ACTOR("superadmin", { activo: false }), ACTOR("superadmin", { activo: null }), ACTOR("superadmin", { id: "" })]) {
    const { c, deps, t } = mundo();
    assert.deepEqual(await corregirFichaAliado(deps, actor, 7, entrada(t.aliados[0], { telefono: "3005550000" })), { ok: false, error: MSG_SIN_PERMISO_CORRECCION });
    assert.equal(c.updates, 0);
  }
});

test("C25-3 edición desfasada: si el campo cambió desde que se abrió el formulario (otro operador o el propio aliado) NO se escribe y se pide recargar", async () => {
  const { t, c, deps } = mundo();
  const visto = { ...t.aliados[0] };
  t.aliados[0].telefono = "3119998888"; // el aliado lo cambió desde su portal entretanto
  const r = await corregirFichaAliado(deps, ACTOR("gerencia"), 7, entrada(visto, { telefono: "3005550000" }));
  assert.deepEqual(r, { ok: false, error: MSG_CONFLICTO_CORRECCION });
  assert.equal(t.aliados[0].telefono, "3119998888", "el cambio del aliado sobrevive");
  assert.equal(c.updates, 1, "se intentó una vez y la condición no coincidió (cero filas)");
  // Un campo que NO se está corrigiendo no genera conflicto aunque haya cambiado.
  const r2 = await corregirFichaAliado(deps, ACTOR("gerencia"), 7, entrada({ ...visto, telefono: "3119998888" }, { email: "nuevo@x.test", telefono: "3119998888" }));
  assert.equal(r2.ok, true);
  assert.equal(t.aliados[0].email, "nuevo@x.test");
});

test("C25-4 un campo en null se corrige comparando contra null (IS NULL), y una ficha inexistente da conflicto, no éxito", async () => {
  const { t, deps } = mundo();
  const r = await corregirFichaAliado(deps, ACTOR("superadmin"), 8, entrada(t.aliados[1], { telefono: "3201234567", email: "beto@x.test" }));
  assert.equal(r.ok, true);
  assert.equal(t.aliados[1].telefono, "3201234567");
  assert.deepEqual(await corregirFichaAliado(deps, ACTOR("superadmin"), 999, entrada(t.aliados[1], { telefono: "3200000000" })), { ok: false, error: MSG_CONFLICTO_CORRECCION });
});

test("C25-5 duplicados: nombre (otra ficha o cuenta de otro aliado, sin tildes ni mayúsculas) y documento (con o sin puntos y guion); lo propio no cuenta", async () => {
  const { t, c, deps } = mundo();
  const ya = (x: Fila, cambios: Fila) => corregirFichaAliado(deps, ACTOR("superadmin"), 7, entrada(x, cambios));
  assert.deepEqual(await ya(t.aliados[0], { nombre: "  BETO   viajes " }), { ok: false, error: MSG_NOMBRE_DUPLICADO });          // otra ficha
  t.usuarios.push({ id: "u-x", nombre: "Marta Pérez", aliado_id: 99, rol: "freelance" });
  assert.deepEqual(await ya(t.aliados[0], { nombre: "marta perez" }), { ok: false, error: MSG_NOMBRE_DUPLICADO });                // cuenta de otro aliado
  assert.deepEqual(await ya(t.aliados[0], { nit: "8005554441" }), { ok: false, error: MSG_DOCUMENTO_DUPLICADO });                  // mismo documento sin puntos
  assert.equal(c.updates, 0);
  // Corregir la tilde del nombre propio NO choca con la cuenta enlazada a la misma ficha («Laura Gómez»), ni con su propio documento.
  assert.equal((await ya(t.aliados[0], { nombre: "Laura Gómez" })).ok, true);
  assert.equal((await ya({ ...t.aliados[0] }, { nit: "900123456-7" })).ok, true, "otro formato de SU documento no es un duplicado");
});

test("C25-6 validaciones: nombre corto, teléfono/correo/documento/tipo inválidos y claves ajenas no se escriben", async () => {
  const f = fichas()[0];
  for (const [campo, valor] of [["nombre", "ab"], ["telefono", "12"], ["telefono", "abc"], ["email", "sin-arroba"], ["nit", "12"], ["nit", "<script>"], ["tipoDocumento", "PAS"]] as const) {
    const r = cambiosCorreccion(entrada(f, { [campo]: valor }) as never);
    assert.equal(r.ok, false, `${campo}=${valor}`);
  }
  // Llaves que no son del formulario (pct_comision, activo, numero_cuenta, id, aliado_id, rol) se ignoran por construcción.
  const { t, c, deps } = mundo();
  const r = await corregirFichaAliado(deps, ACTOR("superadmin"), 7, { ...entrada(t.aliados[0], { telefono: "3005550000" }), pct_comision: 0.99, activo: false, numero_cuenta: "0", aliado_id: 8, rol: "x" } as never);
  assert.equal(r.ok, true);
  assert.equal(t.aliados[0].pct_comision, 0.11); assert.equal(t.aliados[0].numero_cuenta, "1234567890"); assert.equal(c.updates, 1);
});

test("C25-7 cambiar nombre o documento exige confirmar el alcance; teléfono/correo no; sin «esperado» no se puede detectar un cambio ajeno", async () => {
  const f = fichas()[0];
  assert.deepEqual(cambiosCorreccion({ nombre: "Laura Gómez", esperado: esperado(f) }), { ok: false, error: MSG_CONFIRMA_IMPACTO });
  assert.deepEqual(cambiosCorreccion({ nit: "52123456", esperado: esperado(f) }), { ok: false, error: MSG_CONFIRMA_IMPACTO });
  assert.equal(cambiosCorreccion({ telefono: "3005550000", esperado: esperado(f) }).ok, true);
  assert.deepEqual(cambiosCorreccion({ telefono: "3005550000" }), { ok: false, error: MSG_RECARGA_CORRECCION });
  assert.deepEqual(cambiosCorreccion({ telefono: "3005550000", esperado: { nombre: "x" } }), { ok: false, error: MSG_RECARGA_CORRECCION });
});

test("C25-8 sin cambios reales no se emite ningún UPDATE; la lectura incompleta de duplicados falla cerrado sin escribir", async () => {
  const { t, c, deps } = mundo();
  assert.deepEqual(await corregirFichaAliado(deps, ACTOR("superadmin"), 7, entrada(t.aliados[0], { nombre: "Laura Gomes", telefono: "3001112222" })), { ok: true, cambios: [] });
  assert.equal(c.updates, 0);
  const t2 = { aliados: fichas(), usuarios: cuentas() }; const c2 = { updates: 0 };
  const deps2 = { sb: escritor(t2.aliados, c2), admin: supabaseEnMemoria(t2, { fallar: (x) => (x.tabla === "usuarios" ? "error" : null) }) } as never;
  const r = await corregirFichaAliado(deps2, ACTOR("superadmin"), 7, entrada(t2.aliados[0], { nombre: "Nombre Nuevo" }));
  assert.equal(r.ok, false); assert.equal(c2.updates, 0); assert.equal(t2.aliados[0].nombre, "Laura Gomes");
});

test("C25-9 id inválido (no entero, cero, negativo, texto) se rechaza antes de leer o escribir", async () => {
  for (const id of [0, -1, 1.5, "7", null, undefined, NaN]) {
    const { c, deps, t } = mundo();
    const r = await corregirFichaAliado(deps, ACTOR("superadmin"), id as never, entrada(t.aliados[0], { telefono: "3005550000" }));
    assert.equal(r.ok, false, String(id)); assert.equal(c.updates, 0);
  }
});
