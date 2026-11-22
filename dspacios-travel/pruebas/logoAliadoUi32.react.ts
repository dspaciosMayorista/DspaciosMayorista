// Se ejecuta con npm run test:react (loader del arnés + jsdom).
// #32 — Interfaz REAL del logo del aliado («Mi perfil» y Aliados interno): vista previa por la ruta autorizada, subir/cambiar/quitar, rechazo de >1 MB sin viaje,
// mensajes de éxito/error, sin permiso (solo explicación, ningún control) y cero solicitudes en reposo (Aliados interno pide la vista previa solo al abrir).
import { montar, clic, esperar, dom } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { RESP_OK } from "./support/respOk.ts";

// El interno importa Server Actions: se sustituyen por un doble que cuenta las llamadas.
import * as nodeModule from "node:module";
type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/aliados\/logo-actions$/.test(specifier) && /LogoAliadoInterno/.test(context.parentURL ?? "")) {
      return { url: `data:text/javascript,${encodeURIComponent(`
        export async function subirLogoAliadoInterno(fd) { globalThis.__l32.subidas.push(fd); return globalThis.__l32.resp; }
        export async function retirarLogoAliadoInterno(id) { globalThis.__l32.retiros.push(id); return { ok: true }; }
      `)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const l32 = { subidas: [] as FormData[], retiros: [] as number[], resp: { ok: true } as unknown };
(globalThis as unknown as { __l32: typeof l32 }).__l32 = l32;

const { LogoAliado } = await import("../components/portal/LogoAliado.tsx");
const { LogoAliadoInterno } = await import("../components/aliados/LogoAliadoInterno.tsx");

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; l32.subidas.length = 0; l32.retiros.length = 0; l32.resp = { ok: true }; });
after(() => dom.window.close());
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

async function elegirArchivo(c: Element, bytes: number, nombre = "logo.png") {
  const React = await import("react");
  const input = c.querySelector('input[type="file"]') as HTMLInputElement;
  const f = new dom.window.File([new Uint8Array(bytes)], nombre, { type: "image/png" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await React.act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  return f;
}
async function conLogo(c: Element) {
  const React = await import("react");
  const img = c.querySelector("img")!;
  await React.act(async () => { img.dispatchEvent(new dom.window.Event("load")); });
}

test("la vista previa pide la ruta AUTORIZADA (no una URL del bucket) y, cargada, ofrece «Cambiar logo» y «Quitar»", async () => {
  const m = await montar(h(LogoAliado, { nombre: "Laura Gómez", src: "/portal/b2b/perfil/logo", puedeCambiar: true, subir: async () => (RESP_OK), retirar: async () => (RESP_OK) }));
  desmontar = m.desmontar;
  const img = m.contenedor.querySelector("img")!;
  assert.match(img.getAttribute("src")!, /^\/portal\/b2b\/perfil\/logo\?v=0$/);
  assert.equal(img.getAttribute("alt"), "Logo de Laura Gómez");
  assert.doesNotMatch(m.contenedor.innerHTML, /supabase|aliado-logos|storage\/v1/i);
  await conLogo(m.contenedor);
  assert.match(txt(m.contenedor), /Cambiar logo/);
  assert.match(txt(m.contenedor), /Quitar/);
  assert.match(txt(m.contenedor), /La agencia emisora y sus datos legales no cambian/);
});

test("sin logo (la ruta responde 404 y la imagen falla): «Sin logo» y «Subir logo», sin botón de quitar", async () => {
  const React = await import("react");
  const m = await montar(h(LogoAliado, { nombre: "Laura", src: "/portal/b2b/perfil/logo", puedeCambiar: true, subir: async () => (RESP_OK), retirar: async () => (RESP_OK) }));
  desmontar = m.desmontar;
  await React.act(async () => { m.contenedor.querySelector("img")!.dispatchEvent(new dom.window.Event("error")); });
  assert.match(txt(m.contenedor), /Sin logo/);
  assert.match(txt(m.contenedor), /Subir logo/);
  assert.doesNotMatch(txt(m.contenedor), /Quitar/);
  assert.equal(m.contenedor.querySelector("img"), null);
});

test("subir: envía el archivo (y el aliado elegido en Aliados), muestra el éxito y recarga la vista previa con otra versión", async () => {
  const llamadas: FormData[] = [];
  const m = await montar(h(LogoAliado, { nombre: "X", src: "/dashboard/aliados/logo/7", puedeCambiar: true, extra: { aliadoId: "7" },
    subir: async (fd: FormData) => { llamadas.push(fd); return RESP_OK; }, retirar: async () => (RESP_OK) }));
  desmontar = m.desmontar;
  const f = await elegirArchivo(m.contenedor, 2048);
  await esperar(() => llamadas.length > 0);
  assert.equal(llamadas.length, 1);
  assert.equal((llamadas[0].get("logo") as File).name, f.name);
  assert.equal(llamadas[0].get("aliadoId"), "7");
  await esperar(() => /Logo actualizado/.test(txt(m.contenedor)));
  assert.match(txt(m.contenedor.querySelector('[role="status"]')), /Logo actualizado/);
  assert.match(m.contenedor.querySelector("img")!.getAttribute("src")!, /\?v=1$/, "la vista previa se vuelve a pedir con otra versión");
});

test("más de 1 MB: se rechaza en el navegador, con su mensaje, SIN llamar al servidor", async () => {
  const llamadas: FormData[] = [];
  const m = await montar(h(LogoAliado, { nombre: "X", src: "/p", puedeCambiar: true, subir: async (fd: FormData) => { llamadas.push(fd); return RESP_OK; }, retirar: async () => (RESP_OK) }));
  desmontar = m.desmontar;
  await elegirArchivo(m.contenedor, 1_048_577);
  assert.equal(llamadas.length, 0);
  assert.match(txt(m.contenedor.querySelector('[role="alert"]')), /no puede superar 1 MB/);
});

test("el servidor rechaza (tipo falso, sin permiso): se muestra SU mensaje y la vista previa no cambia", async () => {
  const m = await montar(h(LogoAliado, { nombre: "X", src: "/p", puedeCambiar: true, subir: async () => ({ ok: false, error: "El logo debe ser una imagen PNG o JPG." }), retirar: async () => (RESP_OK) }));
  desmontar = m.desmontar;
  await elegirArchivo(m.contenedor, 100, "x.png");
  await esperar(() => !!m.contenedor.querySelector('[role="alert"]'));
  assert.match(txt(m.contenedor.querySelector('[role="alert"]')), /imagen PNG o JPG/);
  assert.match(m.contenedor.querySelector("img")!.getAttribute("src")!, /\?v=0$/);
});

test("quitar: llama a retirar una vez, confirma y pasa a «Sin logo»", async () => {
  const retiros: number[] = [];
  const m = await montar(h(LogoAliado, { nombre: "X", src: "/p", puedeCambiar: true, subir: async () => (RESP_OK), retirar: async () => { retiros.push(1); return RESP_OK; } }));
  desmontar = m.desmontar;
  await conLogo(m.contenedor);
  const quitar = [...m.contenedor.querySelectorAll("button")].find((b) => /Quitar/.test(b.textContent ?? ""));
  await clic(quitar, "Quitar");
  await esperar(() => /Logo retirado/.test(txt(m.contenedor)));
  assert.equal(retiros.length, 1);
  assert.match(txt(m.contenedor), /Sin logo/);
});

test("sin permiso para cambiarlo (agente, ficha compartida): la razón con candado y NINGÚN control para subir o quitar", async () => {
  const m = await montar(h(LogoAliado, { nombre: "X", src: "/p", puedeCambiar: false, motivo: "La ficha de la agencia solo la edita su titular.", subir: async () => (RESP_OK), retirar: async () => (RESP_OK) }));
  desmontar = m.desmontar;
  await conLogo(m.contenedor);
  assert.match(txt(m.contenedor), /solo la edita su titular/);
  assert.equal(m.contenedor.querySelector('input[type="file"]'), null);
  assert.equal(m.contenedor.querySelectorAll("button").length, 0);
});

test("Aliados interno: cerrado no pide nada (0 imágenes, 0 llamadas); al abrir pide la vista previa de ESE aliado y sube con su id", async () => {
  const m = await montar(h(LogoAliadoInterno, { aliadoId: 12, nombre: "Viajes Sol" }));
  desmontar = m.desmontar;
  assert.equal(m.contenedor.querySelector("img"), null, "en reposo no hay solicitud de imagen");
  assert.match(txt(m.contenedor), /Logo de marca/);
  await clic(m.contenedor.querySelector("button"), "Logo de marca");
  assert.match(m.contenedor.querySelector("img")!.getAttribute("src")!, /^\/dashboard\/aliados\/logo\/12\?v=0$/);
  await elegirArchivo(m.contenedor, 500);
  await esperar(() => l32.subidas.length > 0);
  assert.equal(l32.subidas.length, 1);
  assert.equal(l32.subidas[0].get("aliadoId"), "12");
});

// Regresión (hallada al revisar la captura): un logo que da 404 ANTES de hidratar no dispara onError; el componente debe leer el estado real de la imagen al montar.
async function conImagenYaTerminada(naturalWidth: number, fn: () => Promise<void>) {
  const proto = dom.window.HTMLImageElement.prototype as unknown as Record<string, unknown>;
  const antes = { complete: Object.getOwnPropertyDescriptor(proto, 'complete'), naturalWidth: Object.getOwnPropertyDescriptor(proto, 'naturalWidth') };
  Object.defineProperty(proto, 'complete', { get: () => true, configurable: true });
  Object.defineProperty(proto, 'naturalWidth', { get: () => naturalWidth, configurable: true });
  try { await fn(); } finally {
    for (const [k, d] of Object.entries(antes)) { if (d) Object.defineProperty(proto, k, d); else delete proto[k]; }
  }
}
test('imagen que ya dio 404 antes de montar (sin onError): se muestra «Sin logo» y «Subir logo», sin imagen rota', async () => {
  await conImagenYaTerminada(0, async () => {
    const m = await montar(h(LogoAliado, { nombre: 'Laura Gómez', src: '/portal/b2b/perfil/logo', puedeCambiar: true, subir: async () => RESP_OK, retirar: async () => RESP_OK }));
    desmontar = m.desmontar;
    assert.match(txt(m.contenedor), /Sin logo/);
    assert.match(txt(m.contenedor), /Subir logo/);
    assert.equal(m.contenedor.querySelector('img'), null, 'no queda la imagen rota con su texto alternativo');
  });
});
test('imagen que ya cargó antes de montar (sin onLoad): se ofrece «Cambiar logo» y «Quitar»', async () => {
  await conImagenYaTerminada(120, async () => {
    const m = await montar(h(LogoAliado, { nombre: 'Laura Gómez', src: '/portal/b2b/perfil/logo', puedeCambiar: true, subir: async () => RESP_OK, retirar: async () => RESP_OK }));
    desmontar = m.desmontar;
    assert.match(txt(m.contenedor), /Cambiar logo/);
    assert.match(txt(m.contenedor), /Quitar/);
  });
});
