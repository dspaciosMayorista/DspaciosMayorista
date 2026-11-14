// #86 · El COMPONENTE REAL de la campana de avisos (components/avisos/CampanaAvisos.tsx) en un DOM (jsdom) con navegador simulado:
// Notification (permiso y registro de lo mostrado), localStorage, AudioContext con la política de autoplay (solo arranca dentro de un gesto) y un
// «servidor» de avisos que reclama de forma atómica como la función avisos_reclamar. Lo que se prueba es lo que el usuario vive:
//   activar → recargar → recibir un aviso · sonido «en espera» tras recargar y cómo se arma con el gesto · dos pestañas sin duplicar notificación ni sonido ·
//   reclamar NO marca leído · abrir un aviso lo marca leído · una instancia oculta no sondea.
import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head><title>Cartera</title></head><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window as unknown as Window & typeof globalThis;

// ── Navegador simulado ────────────────────────────────────────────────────
let permisoRespuesta: NotificationPermission = "granted";
const mostradas: { titulo: string; body: string; tag: string }[] = [];
class NotifFalsa {
  static permission: NotificationPermission = "default";
  static async requestPermission() { NotifFalsa.permission = permisoRespuesta; return NotifFalsa.permission; }
  constructor(titulo: string, opts: { body: string; tag: string }) { mostradas.push({ titulo, body: opts.body, tag: opts.tag }); }
}
let gestoActivo = false;           // la política de autoplay: un AudioContext solo se reanuda DENTRO de un gesto de la persona
let contextosCreados = 0;
let pitidos = 0;
class AudioFalso {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = {};
  constructor() { contextosCreados++; if (gestoActivo) this.state = "running"; }
  async resume() { if (gestoActivo) this.state = "running"; }
  createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, start() { pitidos++; }, stop() {} }; }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
}
Object.assign(globalThis, {
  window: w, document: w.document, HTMLElement: w.HTMLElement, Element: w.Element, Node: w.Node, getComputedStyle: w.getComputedStyle.bind(w),
  Notification: NotifFalsa, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
});
(w as unknown as Record<string, unknown>).Notification = NotifFalsa;
(w as unknown as Record<string, unknown>).AudioContext = AudioFalso;
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });

// ── «Servidor» de avisos (misma semántica que las funciones de la 281) ────
type Av = { id: number; tipo: "soporte_pago_nuevo" | "soporte_pago_reemplazado"; numero_contrato: string; creado_en: string; leido: boolean; notificado: boolean };
let avisos: Av[] = [];
let llamadas = 0;
const vista = (a: Av) => ({ id: a.id, tipo: a.tipo, numero_contrato: a.numero_contrato, creado_en: a.creado_en, leido: a.leido, href: `/dashboard/contratos/${a.numero_contrato}` });
const servidor = {
  async sondear(reclamar: boolean) {
    llamadas++;
    // atómico: lo que una llamada reclama no lo recibe la otra (como avisos_reclamar con skip locked)
    const nuevos = reclamar ? avisos.filter((a) => !a.notificado && !a.leido) : [];
    for (const a of nuevos) a.notificado = true;
    return { nuevos: nuevos.map(vista), noLeidos: avisos.filter((a) => !a.leido).length, recientes: [...avisos].sort((x, y) => y.id - x.id).slice(0, 10).map(vista) };
  },
  async marcar(ids?: number[]) { for (const a of avisos) if (!ids || ids.includes(a.id)) { a.leido = true; a.notificado = true; } return { ok: true }; },
};
const nuevoAviso = (id: number, tipo: Av["tipo"] = "soporte_pago_nuevo") => avisos.push({ id, tipo, numero_contrato: `DTM-${8100 + id}`, creado_en: "2026-11-07T15:00:00Z", leido: false, notificado: false });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const stub = await import("./support/stubs/avisosActionsStub.mjs");
const { CampanaAvisos } = await import("../components/avisos/CampanaAvisos.tsx");
const { act, createElement: h } = React;
stub.__setServidor(servidor);

// ── Utilidades ────────────────────────────────────────────────────────────
type Pestana = { raiz: ReturnType<typeof createRoot>; contenedor: HTMLElement };
const pestanas: Pestana[] = [];
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));
async function montar(opts: { oculta?: boolean } = {}): Promise<Pestana> {
  const contenedor = document.createElement("div");
  if (opts.oculta) contenedor.style.display = "none";
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  await act(async () => { raiz.render(h(CampanaAvisos)); await tick(); });
  const p = { raiz, contenedor }; pestanas.push(p); return p;
}
async function desmontar(p: Pestana) { await act(async () => p.raiz.unmount()); p.contenedor.remove(); pestanas.splice(pestanas.indexOf(p), 1); }
/** Un gesto de la persona: durante el despacho de ESTE evento un AudioContext puede arrancar. */
async function gesto(el: Element, tipo = "click") {
  await act(async () => {
    gestoActivo = true;
    el.dispatchEvent(new w.MouseEvent(tipo, { bubbles: true }));
    await tick();
    gestoActivo = false;
  });
}
const boton = (p: Pestana, texto: string | RegExp) => [...p.contenedor.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent?.includes(texto) : texto.test(b.textContent ?? "")))!;
const abrirCampana = async (p: Pestana) => { if (!p.contenedor.querySelector('[role="region"]')) await gesto(p.contenedor.querySelector('button[aria-haspopup="true"]')!); };
const estadoSonido = (p: Pestana) => p.contenedor.querySelector("[data-estado-sonido]")?.getAttribute("data-estado-sonido");
/** Que todas las pestañas sondeen ahora (volver a la pestaña / foco). */
async function sondeoAhora() { await act(async () => { w.dispatchEvent(new w.Event("focus")); await tick(40); }); }

beforeEach(() => {
  avisos = []; llamadas = 0; mostradas.length = 0; contextosCreados = 0; pitidos = 0; gestoActivo = false;
  permisoRespuesta = "granted"; NotifFalsa.permission = "default"; w.localStorage.clear(); document.title = "Cartera";
});
afterEach(async () => { for (const p of [...pestanas]) await desmontar(p); });
after(() => dom.window.close());

test("activar → recargar → recibir un aviso: la preferencia persiste, el AudioContext vuelve a null y el sonido queda EN ESPERA hasta un gesto", async () => {
  // 1 · activar (el clic es el gesto)
  let tab = await montar();
  await abrirCampana(tab);
  await gesto(boton(tab, "Activar avisos del navegador y sonido"));
  assert.equal(w.localStorage.getItem("avisos:navegador-activado"), "1", "la preferencia queda guardada");
  assert.equal(NotifFalsa.permission, "granted");
  assert.equal(contextosCreados, 1, "el clic creó el AudioContext");
  assert.equal(pitidos, 1, "pitido de confirmación: el sonido sí puede producirse porque hubo gesto");
  assert.equal(estadoSonido(tab), "listo");

  // 2 · recargar: se pierde el AudioContext, no la preferencia ni el permiso
  await desmontar(tab);
  contextosCreados = 0; pitidos = 0;
  tab = await montar();
  assert.equal(contextosCreados, 0, "tras recargar el AudioContext empieza en null: nadie lo creó sin un gesto");

  // 3 · llega un aviso con el sonido todavía en espera
  nuevoAviso(1);
  await sondeoAhora();
  assert.equal(mostradas.length, 1, "la notificación SÍ se muestra (permiso concedido y preferencia guardada)");
  assert.match(mostradas[0].body, /Nuevo soporte de pago en el contrato/);
  assert.equal(mostradas[0].tag, "aviso-1");
  assert.equal(pitidos, 0, "sin gesto no hay sonido: no se intenta ni se promete");
  assert.equal(document.title, "(1) Cartera");
  await abrirCampana(tab);
  assert.equal(estadoSonido(tab), "en-espera");
  assert.match(tab.contenedor.textContent ?? "", /Sonido en espera.*primer clic o tecla/);
  assert.equal(avisos[0].leido, false, "reclamar para notificar no marcó leído");

  // 4 · el primer gesto en la página arma el sonido; el siguiente aviso ya suena (una vez)
  await gesto(document.body, "pointerdown");
  assert.equal(contextosCreados, 1);
  assert.equal(estadoSonido(tab), "listo");
  nuevoAviso(2, "soporte_pago_reemplazado");
  await sondeoAhora();
  assert.equal(mostradas.length, 2);
  assert.match(mostradas[1].body, /Se reemplazó un soporte de pago/);
  assert.equal(pitidos, 1);
});

test("tras recargar, el botón «Activar el sonido ahora» también arma el sonido (alternativa al clic en la página)", async () => {
  let tab = await montar();
  await abrirCampana(tab);
  await gesto(boton(tab, "Activar avisos del navegador y sonido"));
  await desmontar(tab); contextosCreados = 0; pitidos = 0;
  tab = await montar(); await abrirCampana(tab);
  assert.equal(estadoSonido(tab), "en-espera");
  await gesto(boton(tab, "Activar el sonido ahora"));
  assert.equal(estadoSonido(tab), "listo");
  assert.equal(contextosCreados, 1);
});

test("sin gesto el AudioContext queda suspendido y NO se promete sonido (el aviso llega como notificación)", async () => {
  let tab = await montar();
  await abrirCampana(tab);
  await gesto(boton(tab, "Activar avisos del navegador y sonido"));
  await desmontar(tab); contextosCreados = 0; pitidos = 0;
  tab = await montar();
  // llega un aviso y la persona NO ha hecho ningún gesto en esta carga
  nuevoAviso(1); await sondeoAhora(); nuevoAviso(2); await sondeoAhora();
  assert.equal(mostradas.length, 2);
  assert.equal(pitidos, 0);
  assert.equal(contextosCreados, 0);
});

test("dos pestañas abiertas: cada aviso se notifica UNA vez y suena UNA vez; el contador es el mismo en ambas", async () => {
  const a = await montar(); await abrirCampana(a);
  await gesto(boton(a, "Activar avisos del navegador y sonido"));
  const b = await montar();                              // segunda pestaña: mismo almacenamiento (preferencia) y permiso
  await gesto(b.contenedor.querySelector('button[aria-haspopup="true"]')!);   // arma su audio con un gesto
  await gesto(document.body, "pointerdown");
  pitidos = 0; mostradas.length = 0;
  nuevoAviso(1);
  await sondeoAhora();                                   // ambas sondean a la vez
  assert.equal(mostradas.length, 1, "una sola notificación entre las dos pestañas");
  assert.equal(pitidos, 1, "un solo sonido entre las dos pestañas");
  for (const t of [a, b]) assert.equal(t.contenedor.querySelector('button[aria-haspopup="true"]')!.getAttribute("aria-label"), "Avisos, 1 sin leer");
  assert.equal(avisos[0].leido, false, "reclamar nunca marca leído");
  // un sondeo posterior no repite nada
  await sondeoAhora();
  assert.equal(mostradas.length, 1);
  assert.equal(pitidos, 1);
});

test("abrir un aviso lo marca leído (solo ese); «Marcar todo como leído» marca el resto; el título se restaura", async () => {
  const tab = await montar(); await abrirCampana(tab);
  await gesto(boton(tab, "Activar avisos del navegador y sonido"));
  nuevoAviso(1); nuevoAviso(2);
  await sondeoAhora();
  assert.equal(document.title, "(2) Cartera");
  assert.deepEqual(avisos.map((x) => x.leido), [false, false]);
  await abrirCampana(tab);
  const enlace = [...tab.contenedor.querySelectorAll("a")].find((x) => x.getAttribute("href") === "/dashboard/contratos/DTM-8101")!;
  await act(async () => { enlace.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); await tick(40); });
  assert.deepEqual(avisos.map((x) => x.leido), [true, false], "abrir marca leído solo ese aviso");
  assert.equal(document.title, "(1) Cartera");
  await abrirCampana(tab);
  await gesto(boton(tab, "Marcar todo como leído"));
  await tick(40);
  assert.deepEqual(avisos.map((x) => x.leido), [true, true]);
  assert.equal(document.title, "Cartera");
});

test("permiso denegado: no se reclama (el aviso queda para el contador y la lista) y no hay notificación ni sonido", async () => {
  permisoRespuesta = "denied";
  const tab = await montar(); await abrirCampana(tab);
  await gesto(boton(tab, "Activar avisos del navegador y sonido"));
  assert.equal(w.localStorage.getItem("avisos:navegador-activado"), null);
  nuevoAviso(1);
  await sondeoAhora();
  assert.equal(mostradas.length, 0);
  assert.equal(pitidos, 0);
  assert.equal(avisos[0].notificado, false, "no se reclamó: sigue disponible para una pestaña con permiso");
  assert.equal(document.title, "(1) Cartera", "contador y título funcionan sin permiso");
  assert.match(tab.contenedor.textContent ?? "", /bloqueó las notificaciones/);
});

test("una instancia oculta por CSS (p. ej. el encabezado móvil en escritorio) no sondea", async () => {
  await montar({ oculta: true });
  await sondeoAhora();
  assert.equal(llamadas, 0);
  await montar();
  await sondeoAhora();
  assert.ok(llamadas > 0);
});
