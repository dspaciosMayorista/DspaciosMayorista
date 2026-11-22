// Se ejecuta con npm run test:react (loader del arnés + jsdom).
// #25 (ADL-039) — Interfaz REAL de (a) la corrección de la ficha por superadmin/gerencia (envía lo que la persona vio como «esperado», no inventa un cambio
// de tipo de documento, encadena correcciones sin choque consigo misma, muestra el rechazo del servidor) y (b) «Historial de tus datos» del portal
// (componente de servidor real sobre una base en memoria: sin identidad del personal, sin comisión, enmascarado, estados vacío/error/agente).
import { montar, escribir, clic, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./actions" && padre.endsWith("/aliados/CorreccionAliado.tsx")) {
      return { url: `data:text/javascript,${encodeURIComponent(`
        export async function corregirDatosAliado(id, entrada) { globalThis.__c25.llamadas.push({ id, entrada }); return globalThis.__c25.resp(id, entrada); }
      `)}`, shortCircuit: true };
    }
    if (specifier === "@/lib/supabase/admin" && padre.endsWith("/components/portal/HistorialPerfil.tsx")) {
      return { url: pathToFileURL(join(process.cwd(), "pruebas", "support", "stubs", "supabaseAdminStub.mjs")).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
type Llamada = { id: number; entrada: Record<string, unknown> };
const c25 = { llamadas: [] as Llamada[], resp: (_id: number, _e: Record<string, unknown>): unknown => ({ ok: true, cambios: ["Teléfono"] }) };
(globalThis as unknown as { __c25: typeof c25 }).__c25 = c25;

const React = await import("react");
const { CorreccionAliado } = await import("../app/(dashboard)/dashboard/aliados/CorreccionAliado.tsx");
const { HistorialPerfil } = await import("../components/portal/HistorialPerfil.tsx");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");
const h = React.createElement;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; c25.llamadas.length = 0; c25.resp = () => ({ ok: true, cambios: ["Teléfono"] }); __resetAdmin(); });
after(() => dom.window.close());

const FICHA = { id: 7, nombre: "Laura Gomes", nit: "900.123.456-7", tipo_documento: "NIT", telefono: "3001112222", email: "laura@x.test" };
const FICHA_SIN_TIPO = { ...FICHA, tipo_documento: null, email: null, telefono: null };
async function abrir(a: unknown = FICHA) {
  usarBD({});
  const m = await montar(h(CorreccionAliado, { a } as never));
  desmontar = m.desmontar;
  const abrirBtn = [...m.contenedor.querySelectorAll("button")].find((b) => txt(b) === "Corregir");
  await clic(abrirBtn, "Corregir");
  return m.contenedor;
}
const campo = (raiz: Element, sufijo: string) => raiz.querySelector(`input[id^="cor-${sufijo}-"]`) as HTMLInputElement;
const guardar = (raiz: Element) => [...raiz.querySelectorAll("button")].find((b) => /Guardar corrección/.test(txt(b)));
const esperar = () => React.act(async () => { await new Promise((r) => setTimeout(r, 5)); });

test("U25-1 el formulario no se muestra hasta pulsar «Corregir»; nada se envía al abrir", async () => {
  usarBD({});
  const m = await montar(h(CorreccionAliado, { a: FICHA } as never)); desmontar = m.desmontar;
  assert.equal(m.contenedor.querySelector('input[id^="cor-nombre-"]'), null);
  assert.equal(c25.llamadas.length, 0);
});

test("U25-2 corregir el teléfono envía lo que se VIO como «esperado» (valores crudos), sin tocar tipo de documento ni pedir confirmación de alcance", async () => {
  const raiz = await abrir();
  await escribir(campo(raiz, "tel"), "3005550000");
  assert.equal(raiz.querySelector('input[type="checkbox"]'), null, "teléfono/correo no exigen confirmar el alcance");
  await clic(guardar(raiz), "guardar");
  await esperar();
  assert.equal(c25.llamadas.length, 1);
  const e = c25.llamadas[0].entrada;
  assert.equal(c25.llamadas[0].id, 7);
  assert.equal(e.telefono, "3005550000"); assert.equal(e.nombre, "Laura Gomes"); assert.equal(e.nit, "900.123.456-7");
  assert.equal(e.tipoDocumento, undefined, "el tipo de documento no cambió: no se envía");
  assert.deepEqual(e.esperado, { nombre: "Laura Gomes", telefono: "3001112222", email: "laura@x.test", tipo_documento: "NIT", nit: "900.123.456-7" });
  assert.match(txt(raiz), /Corregido: Teléfono/);
});

test("U25-3 un documento sin tipo guardado se ve como NIT pero NO se envía como cambio (null → NIT sería un cambio inventado)", async () => {
  const raiz = await abrir(FICHA_SIN_TIPO);
  await escribir(campo(raiz, "nombre"), "Laura Gómez");
  await clic(guardar(raiz), "guardar");
  await esperar();
  const e = c25.llamadas[0].entrada;
  assert.equal(e.tipoDocumento, undefined);
  assert.deepEqual(e.esperado, { nombre: "Laura Gomes", telefono: null, email: null, tipo_documento: null, nit: "900.123.456-7" });
});

test("U25-4 cambiar nombre o documento muestra la casilla de alcance y la envía; marcarla se refleja en la llamada", async () => {
  // El servidor real exige la confirmación (MSG_CONFIRMA_IMPACTO); el doble lo imita para que el estado de la interfaz sea el real.
  c25.resp = (_id, e) => (e.confirmaImpacto === true ? { ok: true, cambios: ["Nombre"] } : { ok: false, error: "Confirma que entiendes el alcance del cambio de nombre o documento." });
  const raiz = await abrir();
  await escribir(campo(raiz, "nombre"), "Laura Gómez");
  const casilla = raiz.querySelector('input[type="checkbox"]') as HTMLInputElement;
  assert.ok(casilla, "aparece al tocar nombre o documento");
  assert.match(txt(raiz), /aparecerá en los documentos nuevos del aliado/);
  await clic(guardar(raiz), "guardar sin confirmar");
  await esperar();
  assert.equal(c25.llamadas[0].entrada.confirmaImpacto, false);
  await clic(casilla, "confirmar");
  await clic(guardar(raiz), "guardar confirmado");
  await esperar();
  assert.equal(c25.llamadas[1].entrada.confirmaImpacto, true);
});

test("U25-5 tras guardar, la base pasa a lo guardado: una segunda corrección no choca con la primera", async () => {
  const raiz = await abrir();
  await escribir(campo(raiz, "tel"), "3005550000");
  await clic(guardar(raiz), "guardar 1"); await esperar();
  await escribir(campo(raiz, "mail"), "nuevo@x.test");
  await clic(guardar(raiz), "guardar 2"); await esperar();
  assert.equal(c25.llamadas.length, 2);
  assert.equal((c25.llamadas[1].entrada.esperado as Record<string, unknown>).telefono, "3005550000", "lo guardado en la primera es lo «visto» en la segunda");
});

test("U25-6 el rechazo del servidor (sin permiso, conflicto, duplicado) se muestra como alerta y NO cambia la base local", async () => {
  c25.resp = () => ({ ok: false, error: "Solo superadmin y gerencia pueden corregir los datos de un aliado." });
  const raiz = await abrir();
  await escribir(campo(raiz, "tel"), "3005550000");
  await clic(guardar(raiz), "guardar"); await esperar();
  assert.match(txt(raiz.querySelector('[role="alert"]')), /Solo superadmin y gerencia/);
  c25.resp = () => ({ ok: true, cambios: ["Teléfono"] });
  await clic(guardar(raiz), "reintentar"); await esperar();
  assert.equal((c25.llamadas[1].entrada.esperado as Record<string, unknown>).telefono, "3001112222", "tras un rechazo el «esperado» sigue siendo lo que se vio al abrir");
});

// ── Historial de tus datos (portal) ─────────────────────────────────────────
const ficha = (extra: Record<string, unknown>) => ({ id: 1, tabla: "aliados", registro_id: "7", creado_en: "2026-11-05T15:00:00Z", actor_email: "staff-secreto@dspacios.test", actor_nombre: "Ana Interna", actor_rol: "gerencia", accion: "UPDATE", despues: {}, cambios: {}, ...extra });
async function historial(tablas: Record<string, Record<string, unknown>[]>, userId = "u-a") {
  __setAdmin(supabaseEnMemoria(tablas));
  return renderToStaticMarkup(await HistorialPerfil({ userId }) as never).replace(/<!-- -->/g, "").replace(/\s+/g, " ");
}
const U = [{ id: "u-a", rol: "freelance", activo: true, agencia_id: null, aliado_id: 7 }, { id: "u-ag", rol: "agencia", activo: true, agencia_id: "u-t", aliado_id: 7 }];

test("U25-7 «Historial de tus datos»: origen legible, campos con antes → después, banco enmascarado; sin personal interno, comisión ni datos de otro aliado", async () => {
  const s = await historial({ usuarios: U, auditoria: [
    ficha({ id: 1, cambios: { telefono: { antes: "3001112222", despues: "3009998888" } }, despues: { _via: "portal_b2b_perfil" } }),
    ficha({ id: 2, creado_en: "2026-11-06T15:00:00Z", cambios: { nit: { antes: "900123", despues: "900124" }, numero_cuenta: { antes: "1111222233", despues: "4444555566" }, pct_comision: { antes: 0.1, despues: 0.12 } } }),
    ficha({ id: 3, registro_id: "8", cambios: { telefono: { antes: "1", despues: "2" } } }),
  ] });
  assert.match(s, /Historial de tus datos/);
  assert.match(s, /Hecho desde tu portal/); assert.match(s, /Corregido por D&#x27;spacios|Corregido por D'spacios/);
  assert.match(s, /Teléfono:.*3001112222.*→.*3009998888/);
  assert.match(s, /Documento:.*900123.*→.*900124/);
  assert.match(s, /\*\*\*\*5566/);
  for (const prohibido of ["staff-secreto", "Ana Interna", "gerencia", "% de comisión", "4444555566", "1111222233"]) assert.ok(!s.includes(prohibido), prohibido);
  assert.ok(s.indexOf("Documento") < s.indexOf("Teléfono"), "el más reciente primero");
});

test("U25-8 estados: vacío, error de lectura (aviso, no «sin cambios») y agente/otro rol (no se muestra la sección)", async () => {
  assert.match(await historial({ usuarios: U, auditoria: [] }), /Aún no hay cambios registrados/);
  __setAdmin(supabaseEnMemoria({ usuarios: U, auditoria: [] }, { fallar: (c: { tabla: string }) => (c.tabla === "auditoria" ? "error" : null) }));
  const err = renderToStaticMarkup(await HistorialPerfil({ userId: "u-a" }) as never);
  assert.match(err, /No pudimos cargar tu historial/); assert.doesNotMatch(err, /Aún no hay cambios/);
  assert.equal(await historial({ usuarios: U, auditoria: [ficha({ cambios: { telefono: { antes: "1", despues: "2" } } })] }, "u-ag"), "");
  assert.equal(await historial({ usuarios: U, auditoria: [] }, "u-desconocido"), "");
});
