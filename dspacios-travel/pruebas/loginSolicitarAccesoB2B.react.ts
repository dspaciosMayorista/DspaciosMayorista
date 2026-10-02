// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT del enlace "Solicitar acceso B2B" del login
// (`app/(auth)/login/LoginClient.tsx`, el componente de producción tal cual):
//   - Con la pestaña B2B (la inicial) el enlace es visible, apunta al registro
//     EXISTENTE (/portal/registro) y avisa que el acceso requiere aprobación.
//   - Va junto al formulario de ingreso (después del botón de ingresar, antes
//     de "Continuar con Google") y en la columna que se ve en móvil Y
//     escritorio (no dentro de la columna de contexto `hidden lg:flex`).
//   - En la pestaña Admin NO existe (ni el bloque ni ningún enlace al registro);
//     al volver a B2B reaparece.
//   - Seguir el enlace es navegación normal por href: no envía el formulario,
//     no toca Supabase Auth y no dispara router.push.
//   - El selector B2B/Admin es solo presentación: los manejadores de ingreso
//     nunca leen la pestaña elegida (comprobado sobre el código fuente).
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/login", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { LoginClient } = await import("../app/(auth)/login/LoginClient.tsx");
const { __pushes } = await import("./support/stubs/nextNavigationStub.mjs");
const { __llamadas: llamadasSupabase } = await import("./support/stubs/supabaseClientStub.mjs");
const { __llamadas: llamadasCodigo } = await import("./support/stubs/loginActionsStub.mjs");
const { act, createElement: h } = React;

const TEXTO_ENLACE = "Solicitar acceso B2B";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(props: { quickLoginEnabled?: boolean; inactivoInicial?: boolean } = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(h(LoginClient, { quickLoginEnabled: props.quickLoginEnabled ?? false, inactivoInicial: props.inactivoInicial ?? false })),
  );
}

const enlaceSolicitud = () =>
  [...container.querySelectorAll("a")].find((a) => a.textContent?.trim() === TEXTO_ENLACE) as HTMLAnchorElement | undefined;
const enlacesAlRegistro = () => [...container.querySelectorAll('a[href="/portal/registro"]')];
const bloque = () => container.querySelector<HTMLElement>('[data-testid="solicitar-acceso-b2b"]');
const pestana = (nombre: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.includes(nombre))!;
const botonGoogle = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Continuar con Google"))!;

async function clic(el: HTMLElement) {
  await act(async () => el.click());
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  __pushes.length = 0;
  llamadasSupabase.length = 0;
  llamadasCodigo.length = 0;
});
after(() => dom.window.close());

test("pestaña B2B (inicial): el enlace es visible, va al registro existente y avisa la aprobación interna", async () => {
  await render();
  assert.equal(pestana("Portal B2B").getAttribute("aria-selected"), "true", "la pestaña inicial es B2B");

  const enlace = enlaceSolicitud();
  assert.ok(enlace, "debe existir el enlace 'Solicitar acceso B2B'");
  assert.equal(enlace!.getAttribute("href"), "/portal/registro");
  assert.equal(enlacesAlRegistro().length, 1, "un solo enlace al registro");

  const texto = bloque()!.textContent ?? "";
  assert.match(texto, /aprobaci[oó]n/i, "debe decir que el acceso requiere aprobación");
  assert.match(texto, /no es inmediato/i, "debe dejar claro que no da acceso automático");
  // El ícono es decorativo (lucide, nunca emoji): el nombre accesible del
  // enlace es solo su texto.
  assert.ok(enlace!.querySelector("svg[aria-hidden]"), "ícono lucide decorativo");
});

test("ubicación: junto al formulario de ingreso, antes de Google, y en la columna visible en móvil y escritorio", async () => {
  await render();
  const enlace = enlaceSolicitud()!;
  const form = container.querySelector("form")!;
  assert.ok(!form.contains(enlace), "el enlace no va DENTRO del formulario (no puede enviarlo)");
  assert.ok(form.compareDocumentPosition(enlace) & Node.DOCUMENT_POSITION_FOLLOWING, "va después del formulario");
  assert.ok(enlace.compareDocumentPosition(botonGoogle()) & Node.DOCUMENT_POSITION_FOLLOWING, "va antes de 'Continuar con Google'");

  // Ningún ancestro lo oculta por breakpoint: la columna de contexto es
  // `hidden lg:flex` (solo escritorio); la de autenticación se ve siempre.
  for (let el: HTMLElement | null = enlace; el && el !== container; el = el.parentElement) {
    const clases = (el.getAttribute("class") ?? "").split(/\s+/);
    assert.ok(!clases.includes("hidden"), `ancestro oculto en móvil: <${el.tagName.toLowerCase()} class="${el.getAttribute("class")}">`);
    assert.ok(!clases.some((c) => /^(sm|md|lg|xl):hidden$/.test(c)), "ancestro oculto en escritorio");
  }
});

test("pestaña Admin: el enlace no existe; al volver a B2B reaparece", async () => {
  await render();
  await clic(pestana("Portal Admin"));
  assert.equal(pestana("Portal Admin").getAttribute("aria-selected"), "true");
  assert.equal(enlaceSolicitud(), undefined, "no debe mostrarse en Admin");
  assert.equal(bloque(), null, "tampoco el bloque con el aviso");
  assert.equal(enlacesAlRegistro().length, 0, "ningún enlace al registro en Admin");
  assert.doesNotMatch(container.textContent ?? "", /Solicitar acceso/i);

  await clic(pestana("Portal B2B"));
  assert.ok(enlaceSolicitud(), "reaparece al volver a B2B");
  assert.equal(enlacesAlRegistro().length, 1);
});

test("navegación: seguir el enlace es un href normal — no envía el login, no toca Auth ni router.push", async () => {
  await render();
  let enviado = false;
  container.querySelector("form")!.addEventListener("submit", () => { enviado = true; });

  // jsdom no navega: se intercepta el clic en el documento para leer a dónde
  // iría el navegador (el href del ancla) sin pedirle una navegación real.
  let destino: string | null = null;
  const interceptar = (e: Event) => {
    const a = (e.target as Element).closest("a");
    if (a) { destino = a.getAttribute("href"); e.preventDefault(); }
  };
  document.addEventListener("click", interceptar);
  try {
    await clic(enlaceSolicitud()!);
  } finally {
    document.removeEventListener("click", interceptar);
  }

  assert.equal(destino, "/portal/registro");
  assert.equal(enviado, false, "no envía el formulario de ingreso");
  assert.deepEqual(llamadasSupabase, [], "no crea cliente de Supabase ni intenta autenticar");
  assert.deepEqual(__pushes, [], "no hay navegación programática");
  assert.deepEqual(llamadasCodigo, [], "no usa el acceso por código");
});

test("cambiar de pestaña no autoriza nada: no toca Auth, no navega y el aviso de cuenta desactivada se mantiene", async () => {
  await render({ inactivoInicial: true });
  await clic(pestana("Portal Admin"));
  await clic(pestana("Portal B2B"));
  await clic(pestana("Portal Admin"));
  assert.deepEqual(llamadasSupabase, []);
  assert.deepEqual(__pushes, []);
  assert.match(container.textContent ?? "", /Tu cuenta está desactivada/);
});

test("el selector B2B/Admin es solo presentación: ningún manejador de ingreso lee la pestaña elegida", () => {
  const fuente = readFileSync(new URL("../app/(auth)/login/LoginClient.tsx", import.meta.url), "utf8");
  const tramo = (desde: string, hasta: string) => {
    const i = fuente.indexOf(desde);
    const j = fuente.indexOf(hasta, i + desde.length);
    assert.ok(i >= 0 && j > i, `no se encontró el tramo ${desde} → ${hasta}`);
    return fuente.slice(i, j);
  };
  const manejadores = {
    handleCodigo: tramo("async function handleCodigo", "async function handleSubmit"),
    handleSubmit: tramo("async function handleSubmit", "async function handleGoogle"),
    handleGoogle: tramo("async function handleGoogle", "\n  return ("),
  };
  for (const [nombre, cuerpo] of Object.entries(manejadores)) {
    assert.doesNotMatch(cuerpo, /portalSeleccionado|contenido\./, `${nombre} no debe depender de la pestaña`);
  }
  // El destino tras autenticar sale SOLO del rol real del perfil.
  assert.match(manejadores.handleSubmit, /perfil\?\.rol === "agencia"/);
  assert.match(manejadores.handleSubmit, /perfil\.activo === false/);
});
