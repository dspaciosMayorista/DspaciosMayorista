// B3-01 / B3-02 — COMPONENTES REALES (jsdom) del tablero: (1) alertas de fin de compra con «Revisado» y (2) modal de presencia paginado. Lo que se comprueba es lo que la persona vive:
//   · «Revisado» quita SOLO esa alerta y solo si el servidor confirma; un fallo se dice y la alerta se queda.
//   · La presencia NO pide nada al cargar el tablero; abrir = 1 petición; cambiar de página / pestaña / búsqueda = 1 petición cada una; teclear NO pide; en reposo no hay más peticiones (sin sondeo).
import { test, describe, mock, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head><title>t</title></head><body></body></html>", { url: "http://localhost/dashboard", pretendToBeVisual: true });
const w = dom.window as unknown as Window & typeof globalThis;
Object.assign(globalThis, { window: w, document: w.document, HTMLElement: w.HTMLElement, Element: w.Element, Node: w.Node, getComputedStyle: w.getComputedStyle.bind(w), IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
(w as unknown as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(globalThis as unknown as Record<string, unknown>).ResizeObserver = (w as unknown as Record<string, unknown>).ResizeObserver;
Element.prototype.scrollIntoView = () => {};

// Server Actions reales arrastran next/headers: se sustituyen en el borde (la regla probada vive en los componentes y en la prueba con base).
const revisiones: number[] = [];
let revisarOk = true;
mock.module(new URL("../lib/avisos/actions.ts", import.meta.url).href, {
  namedExports: { revisarAlertaCompra: async (id: number) => { revisiones.push(id); return { ok: revisarOk }; }, sondearAvisos: async () => ({ nuevos: [], noLeidos: 0, recientes: [] }), marcarAvisosLeidos: async () => ({ ok: true }) },
});
mock.module(new URL("../app/(dashboard)/dashboard/actividad-actions.ts", import.meta.url).href, { namedExports: { cargarPaginaActividad: async () => ({ ok: false }) } });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { AlertasCompra } = await import("../components/dashboard/AlertasCompra.tsx");
const { PresenciaModal } = await import("../components/dashboard/PresenciaModal.tsx");
const { act, createElement: h } = React;
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const raices: { raiz: ReturnType<typeof createRoot>; el: HTMLElement }[] = [];
async function montar(nodo: React.ReactElement) {
  const el = document.createElement("div"); document.body.append(el);
  const raiz = createRoot(el); raices.push({ raiz, el });
  await act(async () => { raiz.render(nodo); await tick(); });
  return el;
}
afterEach(async () => { for (const r of raices.splice(0)) { await act(async () => r.raiz.unmount()); r.el.remove(); } document.body.innerHTML = ""; });
after(() => dom.window.close());

const alerta = (id: number, texto: string, href: string) => ({ id, texto, href });
const clic = async (el: Element) => act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await tick(); });

describe("B3-02 alertas de fin de compra en el tablero", () => {
  const A = [alerta(1, "Compra por vencer · vigencia de hotel: Hotel Sol · Alta · Vence hoy (26/11/2026)", "/dashboard/producto/hoteles/12?tab=temporadas&vigencia=77"), alerta(2, "Compra por vencer · empaquetado: MDE - CTG · Vence mañana (27/11/2026)", "/dashboard/vuelos/empaquetados/5"), alerta(3, "Compra por vencer · paquete: Cartagena 4N · Vence en 2 días (28/11/2026)", "/dashboard/paquetes/3?tab=config")];
  test("cada alerta enlaza al objeto que POSEE la vigencia y trae su botón «Revisado»", async () => {
    const el = await montar(h(AlertasCompra, { alertas: A, total: 3 }));
    const filas = [...el.querySelectorAll('[data-testid="alerta-compra"]')];
    assert.equal(filas.length, 3);
    assert.deepEqual(filas.map((f) => f.querySelector("a")!.getAttribute("href")), A.map((a) => a.href));
    assert.equal(el.querySelectorAll("button").length, 3);
    assert.match(el.textContent ?? "", /Vigencias de compra por terminar \(3\)/);
  });
  test("«Revisado» quita SOLO esa alerta (por id), baja el contador y no toca las demás", async () => {
    revisiones.length = 0; revisarOk = true;
    const el = await montar(h(AlertasCompra, { alertas: A, total: 3 }));
    await clic(el.querySelectorAll("button")[1]);
    assert.deepEqual(revisiones, [2]);
    assert.deepEqual([...el.querySelectorAll('[data-testid="alerta-compra"] a')].map((a) => a.getAttribute("href")), [A[0].href, A[2].href]);
    assert.match(el.textContent ?? "", /\(2\)/);
  });
  test("si el servidor NO confirma, la alerta se queda y se dice (no se finge que quedó revisada)", async () => {
    revisiones.length = 0; revisarOk = false;
    const el = await montar(h(AlertasCompra, { alertas: A, total: 3 }));
    await clic(el.querySelectorAll("button")[0]);
    assert.equal(el.querySelectorAll('[data-testid="alerta-compra"]').length, 3);
    assert.match(el.querySelector('[role="alert"]')?.textContent ?? "", /No se pudo marcar como revisada/);
    revisarOk = true;
  });
  test("con más alertas que las mostradas lo dice; sin alertas no pinta nada", async () => {
    let el = await montar(h(AlertasCompra, { alertas: A, total: 45 }));
    assert.match(el.querySelector('[data-testid="alertas-compra-recortado"]')?.textContent ?? "", /Se muestran 3 de 45/);
    el = await montar(h(AlertasCompra, { alertas: [], total: 0 }));
    assert.equal(el.innerHTML, "");
  });
});

describe("B3-01 presencia en un modal paginado", () => {
  const fila = (n: number, rol: string, visto: string | null) => ({ usuario_id: `u${n}`, nombre: `Persona ${n}`, email: `p${n}@x.test`, rol, tenant: "mayorista", aliado: rol === "agencia" ? `Aliado ${n}` : null, visto_en: visto, ultima_actividad: null, eventos_ventana: 0, eventos_24h: 0, ultimo_ingreso: null, total: 0 });
  type Pedido = { grupo?: unknown; busqueda?: unknown; pagina?: unknown };
  function servidor(nInterno: number, nAliado: number) {
    const pedidos: Pedido[] = [];
    const cargar = async (p: Pedido) => {
      pedidos.push({ ...p });
      const todos = p.grupo === "aliado" ? Array.from({ length: nAliado }, (_, i) => fila(1000 + i, "agencia", null)) : Array.from({ length: nInterno }, (_, i) => fila(i + 1, "operaciones", i === 0 ? new Date().toISOString() : null));
      const q = String(p.busqueda ?? "").toLowerCase();
      const coinciden = q ? todos.filter((f) => f.nombre.toLowerCase().includes(q)) : todos;
      const pagina = coinciden.slice(Number(p.pagina) * 20, Number(p.pagina) * 20 + 20).map((f) => ({ ...f, total: coinciden.length }));
      return { ok: true as const, filas: pagina, total: coinciden.length };
    };
    return { pedidos, cargar: cargar as unknown as Parameters<typeof PresenciaModal>[0]["cargar"] };
  }
  const enDocumento = (sel: string) => document.querySelector(sel);   // el diálogo va en un portal, fuera del contenedor
  const filasVisibles = () => document.querySelectorAll('[data-testid="actividad-fila"]').length;

  test("al CARGAR el tablero no se pide nada; abrir pide UNA página (≤ 20 filas) aunque haya 1000 personas; en reposo no hay más peticiones", async () => {
    const s = servidor(1000, 5);
    const el = await montar(h(PresenciaModal, { personalTotal: 1000, aliadosTotal: 5, cargar: s.cargar }));
    assert.equal(s.pedidos.length, 0, "montar el tablero no consulta presencia");
    await clic(el.querySelector('[data-testid="presencia-abrir"]')!);
    assert.equal(s.pedidos.length, 1); assert.deepEqual(s.pedidos[0], { grupo: "interno", busqueda: "", pagina: 0 });
    assert.equal(filasVisibles(), 20, "una página, no 1000");
    assert.match(enDocumento('[data-testid="presencia-rango"]')!.textContent ?? "", /1–20 de 1000/);
    await act(async () => { await tick(300); });
    assert.equal(s.pedidos.length, 1, "sin sondeo: reposo = 0 peticiones");
  });
  test("pestañas: «Aliados B2B» pide su grupo desde la página 0; paginar pide la siguiente; teclear NO pide, Buscar sí (1 petición)", async () => {
    const s = servidor(45, 12);
    const el = await montar(h(PresenciaModal, { personalTotal: 45, aliadosTotal: 12, cargar: s.cargar }));
    await clic(el.querySelector('[data-testid="presencia-abrir"]')!);
    await clic(enDocumento('[data-testid="presencia-siguiente"]')!);
    assert.deepEqual(s.pedidos.at(-1), { grupo: "interno", busqueda: "", pagina: 1 });
    assert.match(enDocumento('[data-testid="presencia-rango"]')!.textContent ?? "", /21–40 de 45/);
    await clic(enDocumento('[data-testid="presencia-tab-aliado"]')!);
    assert.deepEqual(s.pedidos.at(-1), { grupo: "aliado", busqueda: "", pagina: 0 });
    assert.equal(filasVisibles(), 12);
    assert.match(document.body.textContent ?? "", /Aliado 1000/, "el aliado se nombra");
    const antes = s.pedidos.length;
    const caja = enDocumento('[data-testid="presencia-buscar"]') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value")!.set!;
      for (const t of ["1", "10", "1005"]) { set.call(caja, t); caja.dispatchEvent(new w.Event("input", { bubbles: true })); await tick(5); }
    });
    assert.equal(s.pedidos.length, antes, "teclear no consulta");
    await act(async () => { caja.form!.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await tick(); });
    assert.equal(s.pedidos.length, antes + 1); assert.deepEqual(s.pedidos.at(-1), { grupo: "aliado", busqueda: "1005", pagina: 0 });
    assert.equal(filasVisibles(), 1);
  });
  test("sin coincidencias lo dice; un error de lectura se dice (no se disfraza de lista vacía); el pie aclara que no es conexión en vivo", async () => {
    const s = servidor(3, 0);
    const el = await montar(h(PresenciaModal, { personalTotal: 3, aliadosTotal: 0, cargar: s.cargar }));
    await clic(el.querySelector('[data-testid="presencia-abrir"]')!);
    assert.match(document.body.textContent ?? "", /no una conexión continua/);
    const caja = enDocumento('[data-testid="presencia-buscar"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value")!.set!.call(caja, "zzz"); caja.dispatchEvent(new w.Event("input", { bubbles: true })); await tick(5); });
    await act(async () => { caja.form!.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await tick(); });
    assert.match(enDocumento('[data-testid="presencia-vacio"]')?.textContent ?? "", /Ninguna persona coincide/);
    const falla = (async () => ({ ok: false as const })) as unknown as Parameters<typeof PresenciaModal>[0]["cargar"];
    const el2 = await montar(h(PresenciaModal, { personalTotal: 1, aliadosTotal: 0, cargar: falla }));
    await clic(el2.querySelector('[data-testid="presencia-abrir"]')!);
    assert.ok(document.querySelectorAll('[data-testid="actividad-error"]').length >= 1);
  });
});
