// S339-02 / 345 · lo que la PERSONA ve y puede hacer: la tarjeta interna de soportes (rechazar con motivo obligatorio, sección «Rechazados», reintento del aviso) y la tarjeta del aliado
// (aviso rojo con el motivo y «Corregir soporte»). Las Server Actions son dobles controlables: su comportamiento real contra la base está probado en soportesRechazo345.pg.ts.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = globalThis as unknown as { __sr345: { llamadas: unknown[][]; respuestas: Record<string, (...a: unknown[]) => Promise<unknown>> } };
G.__sr345 = { llamadas: [], respuestas: {} };
const stub = (nombres: string[]) => nombres.map((n) => `export async function ${n}(...a) { globalThis.__sr345.llamadas.push(['${n}', ...a.map((x) => (x && typeof x.get === 'function' && typeof x.entries === 'function' ? { formData: Object.fromEntries([...x.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'FILE:' + v.name])) } : x))]); return globalThis.__sr345.respuestas['${n}'](...a); }`).join("\n");
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./soportes-actions" && /SoportesPagoInterno/.test(padre)) return { url: datos(stub(["urlSoporteInterno", "rechazarSoporte", "reintentarAvisoRechazo"])), shortCircuit: true };
    if (specifier === "@/app/portal/b2b/cartera/soportes-actions") return { url: datos(stub(["subirSoporte", "reemplazarSoporte", "retirarSoporte", "corregirSoporte", "urlSoporteAliado"])), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, File: dom.window.File, FormData: dom.window.FormData, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { SoportesPagoInterno } = await import("../app/(dashboard)/dashboard/contratos/[numero]/SoportesPagoInterno.tsx");
const { SoportesPago } = await import("../components/portal/SoportesPago.tsx");

const R = G.__sr345.respuestas;
const llamadas = (n: string) => G.__sr345.llamadas.filter((l) => l[0] === n);
let root: ReturnType<typeof createRoot> | undefined; let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = undefined; container?.remove(); G.__sr345.llamadas.length = 0; });
after(() => dom.window.close());
async function montar(el: unknown) {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container); await act(async () => { root!.render(el as never); });
}
const texto = () => container.textContent ?? "";
const boton = (re: RegExp) => [...container.querySelectorAll("button, label")].find((b) => re.test(b.textContent ?? "")) as HTMLElement | undefined;
const escribir = async (el: HTMLTextAreaElement, v: string) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!; set.call(el, v); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); };
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };

const base = { size_bytes: 120_000, subido_en: "2026-11-20T15:00:00Z", reemplaza_id: null, retirado_en: null, nota_retiro: null, motivo_retiro: null, vigente: true, mime: "application/pdf" } as const;
const vigente = { ...base, id: 11, nombre_original: "transferencia-A.pdf" };
const rechazado = { ...base, id: 10, nombre_original: "mal-contrato.pdf", vigente: false, motivo_retiro: "rechazo" as const, retirado_en: "2026-11-21T16:30:00Z", nota_retiro: "Es de otro contrato", retirado_por: "u-ger" };

test("interno: «Rechazar» solo existe para quien puede; sin permiso no hay botón ni formulario", async () => {
  await montar(h(SoportesPagoInterno, { soportes: [vigente], abonos: 1, puedeRechazar: false }));
  assert.equal(boton(/Rechazar/), undefined);
  await act(async () => { root!.unmount(); }); container.remove();
  await montar(h(SoportesPagoInterno, { soportes: [vigente], abonos: 1, puedeRechazar: true }));
  assert.ok(boton(/Rechazar/));
});

test("interno: el motivo es obligatorio (Confirmar deshabilitado hasta escribirlo); confirma con el motivo y la identidad del contrato; muestra el resultado del aviso", async () => {
  R.rechazarSoporte = async () => ({ ok: true, aviso: { estado: "enviado", enviados: 2, mensaje: "Aviso enviado a 2 cuenta(s) del aliado." } });
  await montar(h(SoportesPagoInterno, { soportes: [vigente], abonos: 1, puedeRechazar: true, identidad: { "DTM-1": "uid-1" } }));
  await clic(boton(/^\s*Rechazar/)!);
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  assert.ok(ta, "aparece el campo de motivo"); assert.match(texto(), /obligatorio/);
  const confirmar = boton(/Confirmar rechazo/) as HTMLButtonElement;
  assert.equal(confirmar.disabled, true, "sin motivo no se puede confirmar");
  await escribir(ta, "   ");
  assert.equal((boton(/Confirmar rechazo/) as HTMLButtonElement).disabled, true, "solo espacios tampoco");
  await escribir(ta, "  Es de otro contrato  ");
  assert.equal((boton(/Confirmar rechazo/) as HTMLButtonElement).disabled, false);
  assert.equal(ta.maxLength, 500);
  assert.match(texto(), /Rechazar no registra ni cambia ningún pago/, "se aclara ANTES de confirmar");
  await clic(boton(/Confirmar rechazo/)!);
  assert.deepEqual(llamadas("rechazarSoporte"), [["rechazarSoporte", 11, "  Es de otro contrato  ", { "DTM-1": "uid-1" }]], "el servidor recorta; la interfaz envía el texto y la identidad");
  assert.match(texto(), /Soporte rechazado\. Aviso enviado a 2 cuenta\(s\) del aliado\./);
});

test("interno: un rechazo que el servidor niega muestra el error y no oculta nada", async () => {
  R.rechazarSoporte = async () => ({ ok: false, error: "Ese soporte ya cambió (otro reemplazo, retiro o rechazo se adelantó). Actualiza la página." });
  await montar(h(SoportesPagoInterno, { soportes: [vigente], abonos: 1, puedeRechazar: true }));
  await clic(boton(/^\s*Rechazar/)!);
  await escribir(container.querySelector("textarea") as HTMLTextAreaElement, "motivo");
  await clic(boton(/Confirmar rechazo/)!);
  assert.match(container.querySelector("[role=alert]")?.textContent ?? "", /ya cambió/);
  assert.match(texto(), /transferencia-A\.pdf/);
});

test("interno: el rechazado sale de la lista activa y vive en «Rechazados» (archivo, motivo, quién, cuándo, aviso, estado de corrección); NO en el historial común", async () => {
  await montar(h(SoportesPagoInterno, { soportes: [vigente, rechazado], abonos: 1, puedeRechazar: true, avisos: { 10: { estado: "enviado", intentos: 1 } }, nombres: { "u-ger": "Gerente Uno" } }));
  const activa = container.querySelector("ul") as HTMLUListElement;
  assert.match(activa.textContent ?? "", /transferencia-A\.pdf/); assert.ok(!(activa.textContent ?? "").includes("mal-contrato.pdf"), "el rechazado no está en la lista activa");
  assert.match(texto(), /Vigentes 1 de 2 permitidos/, "el rechazado no cuenta como vigente");
  const det = container.querySelector("details")!;
  assert.match(det.querySelector("summary")!.textContent ?? "", /Rechazados \(1\) · 1 pendiente\(s\) de corrección/);
  const r = container.querySelector("[data-testid=rechazado-10]")!.textContent ?? "";
  for (const esperado of ["mal-contrato.pdf", "Rechazado", "por Gerente Uno", "«Es de otro contrato»", "Pendiente de corrección por el aliado", "Aviso al aliado: enviado por correo"]) assert.ok(r.includes(esperado), `«${esperado}» en el rechazado`);
  assert.equal(container.querySelectorAll("details").length, 1, "sin segundo historial: el rechazado no se duplica");
});

test("interno: aviso fallido → «Reintentar aviso» (solo con permiso y por debajo de 5 intentos); corregido → muestra el soporte que lo corrige", async () => {
  R.reintentarAvisoRechazo = async () => ({ ok: true, aviso: { estado: "enviado", enviados: 1, mensaje: "Aviso enviado a 1 cuenta(s) del aliado." } });
  await montar(h(SoportesPagoInterno, { soportes: [vigente, rechazado], abonos: 1, puedeRechazar: true, avisos: { 10: { estado: "fallido", intentos: 2 } } }));
  assert.match(texto(), /el correo no salió \(intentos: 2 de 5\)/);
  await clic(boton(/Reintentar aviso/)!);
  assert.deepEqual(llamadas("reintentarAvisoRechazo"), [["reintentarAvisoRechazo", 10]]);
  assert.match(texto(), /Aviso enviado a 1 cuenta\(s\)/);
  await act(async () => { root!.unmount(); }); container.remove();
  await montar(h(SoportesPagoInterno, { soportes: [vigente, rechazado], abonos: 1, puedeRechazar: false, avisos: { 10: { estado: "fallido", intentos: 2 } } }));
  assert.equal(boton(/Reintentar aviso/), undefined, "sin permiso no hay reintento");
  await act(async () => { root!.unmount(); }); container.remove();
  await montar(h(SoportesPagoInterno, { soportes: [vigente, rechazado], abonos: 1, puedeRechazar: true, avisos: { 10: { estado: "fallido", intentos: 5 } } }));
  assert.equal(boton(/Reintentar aviso/), undefined, "agotados los 5 intentos no se ofrece reintentar");
  await act(async () => { root!.unmount(); }); container.remove();
  const correccion = { ...base, id: 11, nombre_original: "bueno.pdf", corrige_id: 10 };
  await montar(h(SoportesPagoInterno, { soportes: [correccion, rechazado], abonos: 1, puedeRechazar: true }));
  assert.match(container.querySelector("summary")!.textContent ?? "", /todos corregidos/);
  assert.match(container.querySelector("[data-testid=rechazado-10]")!.textContent ?? "", /Corregido con el soporte #11/);
  assert.match(texto(), /corrige el soporte rechazado #10/);
});

const contrato = (extra: object = {}) => ({ numero: "DTM-9301", cliente: "Cliente 9301", abonos: 1, soportes: [{ id: 11, nombre_original: "otro.pdf", mime: "application/pdf", size_bytes: 1000, subido_en: "2026-11-20T15:00:00Z" }], identidad: { "DTM-9301": "uid" }, ...extra });
const rech = [{ id: 10, nombre_original: "mal-contrato.pdf", motivo: "Es de otro contrato", rechazado_en: "2026-11-21T16:30:00Z" }];

test("aliado: ve el soporte rechazado con el motivo y «Corregir soporte»; elegir el archivo llama a corregirSoporte con el id del rechazado", async () => {
  R.corregirSoporte = async () => ({ ok: true });
  await montar(h(SoportesPago, { contratos: [contrato({ rechazados: rech })], maximo: 4_000_000, maximoTexto: "4 MB" }));
  const r = container.querySelector("[data-testid=rechazado-10]")!;
  for (const esperado of ["Soporte rechazado por el equipo", "mal-contrato.pdf", "Motivo: Es de otro contrato", "no registra ni cambia ningún pago"]) assert.ok((r.textContent ?? "").includes(esperado), esperado);
  const input = r.querySelector("input[type=file]") as HTMLInputElement;
  assert.equal(input.disabled, false);
  const f = new dom.window.File(["%PDF-1.4 x"], "bueno.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.deepEqual(llamadas("corregirSoporte"), [["corregirSoporte", { formData: { archivo: "FILE:bueno.pdf", id: "10" } }, { "DTM-9301": "uid" }]]);
  assert.equal(llamadas("reemplazarSoporte").length + llamadas("subirSoporte").length, 0, "no usa las otras acciones");
  assert.match(texto(), /Soporte corregido enviado/);
});

test("aliado: sin cupo (lleno por otros soportes) «Corregir» se deshabilita y explica la salida (reemplazar uno); sin rechazos no hay aviso", async () => {
  await montar(h(SoportesPago, { contratos: [contrato({ rechazados: rech, soportes: [1, 2].map((i) => ({ id: 20 + i, nombre_original: `v${i}.pdf`, mime: "application/pdf", size_bytes: 1000, subido_en: "2026-11-20T15:00:00Z" })) })], maximo: 4_000_000, maximoTexto: "4 MB" }));
  const r = container.querySelector("[data-testid=rechazado-10]")!;
  assert.equal((r.querySelector("input[type=file]") as HTMLInputElement).disabled, true);
  assert.match(r.textContent ?? "", /reemplaza uno de ellos con el archivo correcto/);
  await act(async () => { root!.unmount(); }); container.remove();
  await montar(h(SoportesPago, { contratos: [contrato()], maximo: 4_000_000, maximoTexto: "4 MB" }));
  assert.equal(container.querySelector("[data-testid^=rechazado-]"), null);
  assert.ok(!texto().includes("rechazado por el equipo"));
});
