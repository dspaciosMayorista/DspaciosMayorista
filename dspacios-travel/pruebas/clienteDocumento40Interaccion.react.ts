// Se ejecuta con npm run test:react (loader React: jsdom + esbuild), no con test:unit.
//
// #40 V1 — INTERACCIÓN REAL de CotizacionManualForm.tsx (renderizado de producción, eventos DOM reales)
// con la Server Action `buscarClienteDocumento` sustituida por una frontera controlada:
//   · el botón existe solo en cotización simple + canal interno, y no consulta hasta que se pulsa;
//   · ningún dato se aplica solo: cada campo exige su clic; si ya hay texto distinto, pide confirmar;
//   · cero / una / varias observaciones, divergencia (un valor por clic, nunca fusionados),
//     lectura incompleta (has_more / valores_omitidos: no se ofrece aplicar nada);
//   · respuestas tardías descartadas al cambiar documento, tipo, canal, modo, agencia o al desmontar,
//     y fuera de orden;
//   · fallos de red / de autorización conservan la entrada manual;
//   · regresión: la creación simple sigue enviando lo escrito y lo aplicado, sin buscar nada por su cuenta.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const STUB_DATE_INPUT = new URL("./support/stubs/dateInputStub.mjs", import.meta.url).href;

// Fronteras de CotizacionManualForm.tsx: las dos Server Actions ("use server" → next/headers) y el router.
const FRONTERAS: Record<string, string> = {
  "../manual-actions": datos(`
    export async function crearCotizacionManual(x) { globalThis.__c40.creaciones.push(x); return { ok: true, id: 77 }; }
    export async function crearComparativaManual(x) { globalThis.__c40.comparativas.push(x); return { ok: true, id: 78 }; }
  `),
  "./buscar-cliente-actions": datos(`
    export async function buscarClienteDocumento(x) { globalThis.__c40.llamadas.push(x); return globalThis.__c40.buscar(x); }
  `),
  "next/navigation": datos("export function useRouter() { return { push(d) { globalThis.__c40.pushes.push(d); }, refresh() {}, replace() {} }; }"),
  "@/components/ui/DateInput": STUB_DATE_INPUT,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((context.parentURL ?? "").endsWith("/CotizacionManualForm.tsx") && FRONTERAS[specifier]) {
      return { url: FRONTERAS[specifier], shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/cotizaciones/nueva" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

// ── Frontera controlada ──────────────────────────────────────────────────────
type Resultado = Record<string, unknown>;
const c40 = {
  llamadas: [] as { tipoDoc: string; numeroDoc: string }[],
  pushes: [] as string[],
  creaciones: [] as { cliente: Record<string, string> }[],
  comparativas: [] as unknown[],
  buscar: (async (): Promise<Resultado> => ({ ok: true, estado: "sin_registro" })) as (x: { tipoDoc: string; numeroDoc: string }) => Promise<Resultado>,
};
(globalThis as unknown as { __c40: typeof c40 }).__c40 = c40;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { CotizacionManualForm } = await import("../app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx");
const h = React.createElement;

// React no debe emitir avisos (act, estado tras desmontar, claves duplicadas…) durante estas pruebas.
const avisos: string[] = [];
const consolaError = console.error;
console.error = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  c40.llamadas.length = 0; c40.pushes.length = 0; c40.creaciones.length = 0; c40.comparativas.length = 0;
  c40.buscar = async () => ({ ok: true, estado: "sin_registro" });
  document.cookie = "tenant=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  avisos.length = 0;
});
after(() => { console.error = consolaError; dom.window.close(); });

const PROPS = { asesores: [{ nombre: "Asesor Uno", email: "a1@x.test" }], aliados: [], miNombre: "Asesor Uno", miRolVenta: false, pctAliadoB2B: 0.5 };

async function montar(): Promise<HTMLElement> {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(CotizacionManualForm, PROPS)));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
/** Desmonta ahora (para la prueba de respuesta tardía tras desmontar). */
async function desmontarYa() { await desmontar?.(); desmontar = undefined; }

const tick = () => new Promise<void>((r) => setImmediate(r));
async function pulsar(el: Element) { await React.act(async () => { (el as HTMLElement).click(); await tick(); }); }
async function escribir(el: HTMLInputElement | HTMLSelectElement, valor: string) {
  await React.act(async () => {
    const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
    await tick();
  });
}
function control(c: HTMLElement, etiqueta: string): HTMLInputElement | HTMLSelectElement {
  const l = [...c.querySelectorAll("label")].find((x) => x.textContent === etiqueta);
  assert.ok(l, `no hay etiqueta "${etiqueta}"`);
  const el = l.parentElement!.querySelector("input,select");
  assert.ok(el, `la etiqueta "${etiqueta}" no tiene control`);
  return el as HTMLInputElement | HTMLSelectElement;
}
const boton = (c: HTMLElement, texto: string | RegExp) =>
  [...c.querySelectorAll("button")].find((b) => (typeof texto === "string" ? (b.textContent ?? "").trim() === texto : texto.test((b.textContent ?? "").trim()))) as HTMLButtonElement | undefined;
/** Botones de aplicar un dato encontrado (por su aria-label), sin confundirlos con otros «Usar …» del formulario. */
const RE_APLICAR = /^(Usar|Reemplazar) [^:]+: /;
const botones = (c: HTMLElement, texto: RegExp) => [...c.querySelectorAll("button")].filter((b) => texto.test((b.getAttribute("aria-label") ?? b.textContent ?? "").trim())) as HTMLButtonElement[];
const botonAplicar = (c: HTMLElement, accion: "Usar" | "Reemplazar", campo: string, valor: string) => {
  const b = c.querySelector(`button[aria-label="${accion} ${campo}: ${valor}"]`);
  assert.ok(b, `no hay botón "${accion} ${campo}: ${valor}"`);
  return b as HTMLButtonElement;
};
const texto = (c: HTMLElement) => c.textContent ?? "";
const panel = (c: HTMLElement) => c.querySelector("[data-campo]") ? c.querySelector("[aria-live='polite']") : null;
function diferido<T>() { let resolve!: (v: T) => void; const promesa = new Promise<T>((r) => { resolve = r; }); return { promesa, resolve }; }

// ── Respuestas de ejemplo (proyección de la acción) ──────────────────────────
const proc = (fuente: string, extra: Record<string, unknown> = {}) => ({ fuente, capturadoEn: "2026-10-05T15:00:00+00:00", contratoNumero: null, cotizacionId: null, ...extra });
const valor = (v: string, n = 1, p: Record<string, unknown>[] = [proc("cotizacion", { cotizacionId: 812 })]) => ({ valor: v, nCapturas: n, procedencia: p });
const campo = (c: string, valores: unknown[], extra: Record<string, unknown> = {}) => ({ campo: c, divergencia: valores.length > 1, valores, omitidos: 0, ...extra });
const encontrado = (campos: unknown[], incompleto = false): Resultado => ({ ok: true, estado: "encontrado", incompleto, campos });
const COMPLETO = encontrado([
  campo("nombres", [valor("Ana María")]), campo("apellidos", [valor("Pérez Gómez", 2, [proc("contrato_pasajero", { contratoNumero: "00-0451" })])]),
  campo("telefono", [valor("3001112233")]), campo("email", [valor("ana@correo.test")]), campo("fecha_nacimiento", [valor("1990-05-17")]),
]);

async function conDocumento(c: HTMLElement, tipo = "CC", numero = "1020304050") {
  await escribir(control(c, "Tipo doc") as HTMLSelectElement, tipo);
  await escribir(control(c, "N° documento") as HTMLInputElement, numero);
}
async function buscar(c: HTMLElement) { await pulsar(boton(c, "Buscar cliente")!); }

test("el botón existe solo en cotización simple de canal interno y exige un número", async () => {
  const c = await montar();
  assert.ok(boton(c, "Buscar cliente"), "simple + interno: visible");
  assert.equal(boton(c, "Buscar cliente")!.disabled, true, "sin número: deshabilitado");
  await escribir(control(c, "N° documento") as HTMLInputElement, "  ");
  assert.equal(boton(c, "Buscar cliente")!.disabled, true, "número en blanco: deshabilitado");
  await escribir(control(c, "N° documento") as HTMLInputElement, "1020304050");
  assert.equal(boton(c, "Buscar cliente")!.disabled, false);

  await pulsar(boton(c, "agencia")!);
  assert.equal(boton(c, "Buscar cliente"), undefined, "agencia (B2B): sin botón");
  await pulsar(boton(c, "freelance")!);
  assert.equal(boton(c, "Buscar cliente"), undefined, "freelance (B2B): sin botón");
  await pulsar(boton(c, "interno")!);
  assert.ok(boton(c, "Buscar cliente"), "de vuelta a interno");
  await pulsar(boton(c, /Cotización comparativa/)!);
  assert.equal(boton(c, "Buscar cliente"), undefined, "comparativa: sin botón");
  await pulsar(boton(c, /Cotización comparativa/)!);
  assert.ok(boton(c, "Buscar cliente"));
  assert.equal(c40.llamadas.length, 0, "nada se consulta por cambiar de modo");
});

test("escribir el documento NO consulta: solo el clic en «Buscar cliente»", async () => {
  const c = await montar();
  await conDocumento(c, "CE", "9876543");
  await escribir(control(c, "N° documento") as HTMLInputElement, "98765432");
  assert.equal(c40.llamadas.length, 0);
  await buscar(c);
  assert.deepEqual(c40.llamadas, [{ tipoDoc: "CE", numeroDoc: "98765432" }]);
});

test("sin registro: aviso claro y la entrada manual sigue intacta", async () => {
  const c = await montar();
  await escribir(control(c, "Nombres") as HTMLInputElement, "Escrito a mano");
  await conDocumento(c);
  await buscar(c);
  assert.match(texto(c), /No hay datos previos para este documento\. Continúa llenando los datos del cliente a mano\./);
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Escrito a mano");
  assert.equal(boton(c, "Buscar cliente")!.disabled, false, "se puede volver a buscar");
});

test("una observación por campo: nada se aplica solo; cada «Usar» llena únicamente su campo y deja el documento", async () => {
  c40.buscar = async () => COMPLETO;
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  // Procedencia visible.
  assert.match(texto(c), /Cotización · cotización #812/);
  assert.match(texto(c), /Pasajero de contrato · contrato 00-0451/);
  assert.match(texto(c), /2 registros/);
  // Nada aplicado todavía.
  for (const e of ["Nombres", "Apellidos", "Teléfono", "Email"]) assert.equal((control(c, e) as HTMLInputElement).value, "", e);
  assert.equal((control(c, "Fecha de nacimiento") as HTMLInputElement).value, "");

  await pulsar(botonAplicar(c, "Usar", "nombres", "Ana María"));
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Ana María");
  for (const e of ["Apellidos", "Teléfono", "Email"]) assert.equal((control(c, e) as HTMLInputElement).value, "", `${e} no se toca`);
  assert.equal((control(c, "Fecha de nacimiento") as HTMLInputElement).value, "");
  assert.equal((control(c, "Tipo doc") as HTMLSelectElement).value, "CC");
  assert.equal((control(c, "N° documento") as HTMLInputElement).value, "1020304050", "el documento es la clave: no se reescribe");

  await pulsar(botonAplicar(c, "Usar", "fecha de nacimiento", "1990-05-17"));
  assert.equal((control(c, "Fecha de nacimiento") as HTMLInputElement).value, "1990-05-17");
  assert.ok(panel(c), "el panel sigue para aplicar los demás");
  assert.equal(botonAplicar(c, "Usar", "nombres", "Ana María").disabled, true, "ya coincide");
  assert.match(botonAplicar(c, "Usar", "nombres", "Ana María").textContent ?? "", /Ya coincide/);
});

test("sustituir lo escrito exige confirmación por campo; «Conservar» no cambia nada", async () => {
  c40.buscar = async () => COMPLETO;
  const c = await montar();
  await escribir(control(c, "Nombres") as HTMLInputElement, "Escrito por el asesor");
  await escribir(control(c, "Apellidos") as HTMLInputElement, "Apellido propio");
  await conDocumento(c);
  await buscar(c);

  await pulsar(botonAplicar(c, "Reemplazar", "nombres", "Ana María"));
  const dialogo = c.querySelector("[role='alertdialog']");
  assert.ok(dialogo, "pide confirmar");
  assert.match(dialogo.textContent ?? "", /Ya escribiste «Escrito por el asesor»\. ¿Reemplazarlo por «Ana María»\?/);
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Escrito por el asesor", "aún no cambia");

  await pulsar(boton(c, "Conservar lo escrito")!);
  assert.equal(c.querySelector("[role='alertdialog']"), null);
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Escrito por el asesor");

  await pulsar(botonAplicar(c, "Reemplazar", "nombres", "Ana María"));
  await pulsar(boton(c, "Sí, reemplazar")!);
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Ana María");
  assert.equal((control(c, "Apellidos") as HTMLInputElement).value, "Apellido propio", "otro campo escrito: intacto");
  assert.equal(c.querySelector("[role='alertdialog']"), null);
});

test("la confirmación de un campo no autoriza otro: cada campo pide la suya", async () => {
  c40.buscar = async () => COMPLETO;
  const c = await montar();
  await escribir(control(c, "Nombres") as HTMLInputElement, "N propio");
  await escribir(control(c, "Apellidos") as HTMLInputElement, "A propio");
  await conDocumento(c);
  await buscar(c);
  await pulsar(botonAplicar(c, "Reemplazar", "nombres", "Ana María"));
  await pulsar(botonAplicar(c, "Reemplazar", "apellidos", "Pérez Gómez")); // abre OTRA confirmación y cierra la anterior
  assert.equal(c.querySelectorAll("[role='alertdialog']").length, 1);
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "N propio");
  assert.equal((control(c, "Apellidos") as HTMLInputElement).value, "A propio");
  await pulsar(boton(c, "Sí, reemplazar")!);
  assert.equal((control(c, "Apellidos") as HTMLInputElement).value, "Pérez Gómez");
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "N propio", "el primero nunca se confirmó");
});

test("varias observaciones divergentes: cada valor por separado, jamás fusionados", async () => {
  c40.buscar = async () => encontrado([campo("nombres", [valor("Ana", 3), valor("Anna", 1, [proc("captura_interna")])])]);
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  assert.match(texto(c), /Valores distintos: elige uno/);
  assert.ok(botonAplicar(c, "Usar", "nombres", "Ana") && botonAplicar(c, "Usar", "nombres", "Anna"));
  await pulsar(botonAplicar(c, "Usar", "nombres", "Anna"));
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Anna");
  assert.match(botonAplicar(c, "Reemplazar", "nombres", "Ana").textContent ?? "", /Reemplazar/, "la otra variante ahora pediría confirmación");
  assert.equal(c.querySelector("[role='alertdialog']"), null);
});

test("lectura incompleta (has_more o valores omitidos): se informa y NO se ofrece aplicar nada", async () => {
  for (const incompleta of [
    encontrado([campo("nombres", [valor("Ana")])], true),
    encontrado([campo("telefono", [valor("300")], { omitidos: 4 })], true),
  ]) {
    c40.buscar = async () => incompleta;
    const c = await montar();
    await escribir(control(c, "Nombres") as HTMLInputElement, "Manual");
    await conDocumento(c);
    await buscar(c);
    assert.match(texto(c), /Lectura incompleta/);
    assert.equal(botones(c, RE_APLICAR).length, 0, "ningún botón de aplicar");
    assert.equal(c.querySelector("[role='alertdialog']"), null);
    assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Manual");
    // La entrada manual sigue funcionando.
    await escribir(control(c, "Teléfono") as HTMLInputElement, "3200000000");
    assert.equal((control(c, "Teléfono") as HTMLInputElement).value, "3200000000");
    await desmontarYa();
  }
});

test("un valor que el formulario no puede recibir (fecha mal formada) se muestra pero no se ofrece", async () => {
  c40.buscar = async () => encontrado([campo("fecha_nacimiento", [valor("17/05/1990")]), campo("nombres", [valor("Ana")])]);
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  assert.equal(botones(c, /fecha de nacimiento: 17\/05\/1990/).length, 0);
  assert.match(texto(c), /no tiene un formato que el formulario pueda recibir/);
  assert.ok(botonAplicar(c, "Usar", "nombres", "Ana"));
});

test("fallos: respuesta de error y excepción de red muestran un aviso y conservan lo escrito", async () => {
  const c = await montar();
  await escribir(control(c, "Nombres") as HTMLInputElement, "Manual");
  await conDocumento(c);

  c40.buscar = async () => ({ ok: false, codigo: "no_autorizado", error: "No tienes permiso para buscar clientes por documento." });
  await buscar(c);
  assert.match(c.querySelector("[role='alert']")?.textContent ?? "", /No tienes permiso para buscar clientes por documento\./);

  c40.buscar = async () => { throw new Error("fetch failed https://x.supabase.co 1020304050"); };
  await buscar(c);
  const aviso = c.querySelector("[role='alert']")?.textContent ?? "";
  assert.match(aviso, /No se pudo consultar el documento\. Revisa tu conexión/);
  assert.ok(!aviso.includes("supabase") && !aviso.includes("1020304050"), "el error técnico no se muestra");
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Manual");
  assert.equal(boton(c, "Buscar cliente")!.disabled, false);
});

test("mientras busca: botón «Buscando…» deshabilitado (una sola consulta en vuelo)", async () => {
  const d = diferido<Resultado>();
  c40.buscar = () => d.promesa;
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  const b = boton(c, "Buscando…")!;
  assert.ok(b && b.disabled);
  await pulsar(b);
  assert.equal(c40.llamadas.length, 1);
  await React.act(async () => { d.resolve(COMPLETO); await tick(); });
  assert.ok(boton(c, "Buscar cliente"));
});

// ── Respuestas tardías ───────────────────────────────────────────────────────
async function cambioDuranteBusqueda(cambiar: (c: HTMLElement) => Promise<void>, restaurar?: (c: HTMLElement) => Promise<void>) {
  const d = diferido<Resultado>();
  c40.buscar = () => d.promesa;
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  assert.ok(boton(c, "Buscando…"));
  await cambiar(c);
  if (restaurar) await restaurar(c);
  await React.act(async () => { d.resolve(COMPLETO); await tick(); });
  return c;
}
function nadaApareció(c: HTMLElement) {
  assert.equal(c.querySelector("[data-campo]"), null, "no se pinta el resultado tardío");
  assert.equal(botones(c, RE_APLICAR).length, 0);
  for (const e of ["Nombres", "Apellidos", "Teléfono", "Email"]) assert.equal((control(c, e) as HTMLInputElement).value, "", `${e} sin datos del resultado tardío`);
  assert.ok(!/Ana María/.test(texto(c).replace(/\s+/g, " ")) , "ningún dato del resultado tardío");
  assert.ok(boton(c, "Buscar cliente"), "el botón vuelve a reposo (no queda «Buscando…»)");
}

test("tardía tras cambiar el número", async () => {
  const c = await cambioDuranteBusqueda((x) => escribir(control(x, "N° documento") as HTMLInputElement, "1020304051"));
  nadaApareció(c);
});
test("tardía tras cambiar el tipo de documento", async () => {
  const c = await cambioDuranteBusqueda((x) => escribir(control(x, "Tipo doc") as HTMLSelectElement, "CE"));
  nadaApareció(c);
});
test("tardía tras cambiar de canal (aunque se vuelva a interno antes de que llegue)", async () => {
  const c = await cambioDuranteBusqueda((x) => pulsar(boton(x, "agencia")!), (x) => pulsar(boton(x, "interno")!));
  nadaApareció(c);
});
test("tardía tras pasar a comparativa (y volver)", async () => {
  const c = await cambioDuranteBusqueda((x) => pulsar(boton(x, /Cotización comparativa/)!), (x) => pulsar(boton(x, /Cotización comparativa/)!));
  nadaApareció(c);
});
test("tardía tras cambiar la agencia activa (cookie de tenant)", async () => {
  document.cookie = "tenant=mayorista; path=/";
  const c = await cambioDuranteBusqueda(async () => { document.cookie = "tenant=minorista; path=/"; });
  nadaApareció(c);
});

test("tardía tras desmontar: no aplica nada ni emite avisos de React", async () => {
  const d = diferido<Resultado>();
  c40.buscar = () => d.promesa;
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  await desmontarYa();
  await React.act(async () => { d.resolve(COMPLETO); await tick(); });
  assert.equal(document.querySelector("[data-campo]"), null);
  assert.deepEqual(avisos, []);
  assert.equal(c.isConnected, false);
});

test("fuera de orden: la respuesta tardía de una búsqueda anterior nunca pisa a la vigente", async () => {
  const a = diferido<Resultado>();
  const b = diferido<Resultado>();
  c40.buscar = ({ numeroDoc }) => (numeroDoc === "111" ? a.promesa : b.promesa);
  const c = await montar();
  await conDocumento(c, "CC", "111");
  await buscar(c); // A (111) queda en vuelo
  await escribir(control(c, "N° documento") as HTMLInputElement, "222");
  assert.ok(boton(c, "Buscar cliente"), "cambiar el documento libera el botón de inmediato");
  await buscar(c); // B (222)
  await React.act(async () => { b.resolve(encontrado([campo("nombres", [valor("Persona Dos")])])); await tick(); });
  assert.match(texto(c), /Persona Dos/);
  await React.act(async () => { a.resolve(encontrado([campo("nombres", [valor("Persona Uno Vieja")])])); await tick(); });
  assert.ok(!/Persona Uno Vieja/.test(texto(c)), "el resultado de 111 no aparece");
  assert.match(texto(c), /Persona Dos/, "sigue el vigente");
  await pulsar(botonAplicar(c, "Usar", "nombres", "Persona Dos"));
  assert.equal((control(c, "Nombres") as HTMLInputElement).value, "Persona Dos");
  assert.equal(c40.llamadas.length, 2);
});

test("cambiar el documento con un resultado ya mostrado lo cierra: no se puede aplicar un dato de otro documento", async () => {
  c40.buscar = async () => COMPLETO;
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  assert.ok(c.querySelector("[data-campo]"));
  await escribir(control(c, "N° documento") as HTMLInputElement, "1020304051");
  assert.equal(c.querySelector("[data-campo]"), null);
  assert.equal(botones(c, RE_APLICAR).length, 0);
});

test("cambiar a B2B con un resultado mostrado lo cierra y no vuelve al regresar a interno", async () => {
  c40.buscar = async () => COMPLETO;
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  await pulsar(boton(c, "agencia")!);
  await pulsar(boton(c, "interno")!);
  assert.equal(c.querySelector("[data-campo]"), null);
});

// ── Regresión: creación simple ───────────────────────────────────────────────
async function agregarServicioYGuardar(c: HTMLElement) {
  await pulsar(boton(c, /Hotel/)!);
  await pulsar(boton(c, "Generar cotización")!);
}

test("regresión: crear sin buscar envía exactamente lo escrito y no consulta nada", async () => {
  const c = await montar();
  await escribir(control(c, "Nombres") as HTMLInputElement, "Cli");
  await escribir(control(c, "Apellidos") as HTMLInputElement, "Manual");
  await conDocumento(c, "CE", "123456");
  await escribir(control(c, "Teléfono") as HTMLInputElement, "3000000000");
  await agregarServicioYGuardar(c);
  assert.equal(c40.llamadas.length, 0);
  assert.equal(c40.creaciones.length, 1);
  assert.deepEqual(c40.creaciones[0].cliente, { nombres: "Cli", apellidos: "Manual", tipoDoc: "CE", numeroDoc: "123456", telefono: "3000000000", email: "", nacimiento: "" });
  assert.deepEqual(c40.pushes, ["/dashboard/cotizaciones/77"], "la URL de destino no lleva el documento ni datos personales");
  assert.equal(c40.comparativas.length, 0);
});

test("regresión: lo aplicado con consentimiento y lo escrito viajan juntos; lo no aplicado no viaja", async () => {
  c40.buscar = async () => COMPLETO;
  const c = await montar();
  await escribir(control(c, "Email") as HTMLInputElement, "escrito@x.test");
  await conDocumento(c);
  await buscar(c);
  await pulsar(botonAplicar(c, "Usar", "nombres", "Ana María"));
  await pulsar(botonAplicar(c, "Usar", "teléfono", "3001112233"));
  // email: se deja lo escrito (se ve «Reemplazar» pero NO se confirma); apellidos y nacimiento: no se tocan.
  await pulsar(botonAplicar(c, "Reemplazar", "email", "ana@correo.test"));
  await pulsar(boton(c, "Conservar lo escrito")!);
  await agregarServicioYGuardar(c);
  assert.equal(c40.creaciones.length, 1);
  assert.deepEqual(c40.creaciones[0].cliente, {
    nombres: "Ana María", apellidos: "", tipoDoc: "CC", numeroDoc: "1020304050", telefono: "3001112233", email: "escrito@x.test", nacimiento: "",
  });
  assert.deepEqual(c40.pushes, ["/dashboard/cotizaciones/77"]);
});

test("regresión: el canal B2B sigue creando como antes (sin búsqueda)", async () => {
  const c = await montar();
  await pulsar(boton(c, "agencia")!);
  await escribir(control(c, "Nombres") as HTMLInputElement, "Cli B2B");
  await pulsar(boton(c, /Hotel/)!);
  await pulsar(boton(c, "Generar cotización")!);
  assert.equal(c40.creaciones.length, 1);
  assert.equal(c40.llamadas.length, 0);
});

test("sin avisos de React durante toda la interacción", async () => {
  c40.buscar = async () => COMPLETO;
  const c = await montar();
  await conDocumento(c);
  await buscar(c);
  await pulsar(botonAplicar(c, "Usar", "nombres", "Ana María"));
  assert.deepEqual(avisos, []);
});
