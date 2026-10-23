// #22 — "Tarifas por persona" del detalle de hotel: legible y operable en
// celular y escritorio, en tarifas activas e históricas.
//
// Monta el `HotelDetalleClient` REAL (con las Server Actions simuladas). jsdom no
// calcula layout: la ausencia de scroll horizontal y de celdas fuera de vista se
// midió aparte en Chromium real (Playwright) a 320/375/844/1024/1100/1280/1440 px.
// Aquí se fija el contrato que hace posible ese resultado: una fila por
// combinación, todos los importes presentes, notas visibles como texto (no solo
// en `title`), acciones con nombre accesible y umbral de apilado sincronizado.
//
// Uso directo (no está en package.json):
//   node --experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/tarifasHotelMovil.react.ts
import { test, describe, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- React necesita los globales del DOM en esta prueba.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
// Base UI (selectores del formulario de temporadas) consulta `Element`/`Node` globales.
global.Element = dom.window.Element;
global.Node = dom.window.Node;
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom no trae ResizeObserver (lo usa ResponsiveTableShell): sin mediciones, la tabla queda en su estado inicial.
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };

// `next` no publica mapa "exports": en ESM plano "next/navigation" no resuelve.
register(
  "data:text/javascript," +
    encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'),
);
mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {} }) } });

const llamadas: { fn: string; args: unknown[] }[] = [];
const accion = (fn: string) => async (...args: unknown[]) => { llamadas.push({ fn, args }); return { ok: true }; };
mock.module(new URL("../app/(dashboard)/dashboard/producto/hoteles/actions.ts", import.meta.url).href, {
  namedExports: Object.fromEntries(
    ["crearTemporada", "actualizarTemporada", "eliminarTemporada", "copiarTemporadasDesdeHotel", "crearTarifa", "actualizarTarifa", "eliminarTarifa"]
      .map((n) => [n, accion(n)]),
  ),
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { HotelDetalleClient } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx");
type Props = Parameters<typeof HotelDetalleClient>[0];

const RUTA = "app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx";
const fuente = readFileSync(new URL(`../${RUTA}`, import.meta.url), "utf8");

const temporadas = [
  { id: 1, nombre: "TEMPORADA MEDIA", fecha_inicio: "2026-10-01", fecha_fin: "2099-12-14", compra_inicio: "2026-06-01", compra_fin: "2099-12-10", tipo: "tarifa" },
  { id: 2, nombre: "PROMO OCTUBRE", fecha_inicio: "2026-10-01", fecha_fin: "2099-10-31", compra_inicio: "2026-09-01", compra_fin: "2099-10-31", tipo: "descuento_pct", descuento_valor: 15 },
  { id: 3, nombre: "TEMPORADA BAJA 2025", fecha_inicio: "2025-02-01", fecha_fin: "2025-06-30", compra_inicio: "2025-01-01", compra_fin: "2025-06-30", tipo: "tarifa" },
];
const fila = (id: number, temporada: string, extra: Record<string, unknown> = {}) => ({
  id, tipo_habitacion: "Habitación Superior Vista al Mar", alimentacion: "TODO INCLUIDO PREMIUM", temporada,
  neto_sencilla: 2268000, neto_doble: 1494000, neto_triple: 1356000, neto_multiple: 1260000,
  neto_nino: 744000, neto_nino2: 310000, neto_infante: 95000, nota_infante: "Comparte cama con los padres",
  precio_final_autoritativo: false, temporada_base: null, notas: null, ...extra,
});
const tarifas = [
  fila(11, "TEMPORADA MEDIA", { notas: "No reembolsable. Mínimo 4 noches en fin de año." }),
  fila(12, "PROMO OCTUBRE", { precio_final_autoritativo: true, temporada_base: "TEMPORADA MEDIA" }),
  fila(21, "TEMPORADA BAJA 2025"),
];
const props = (extra: Partial<Props> = {}): Props => ({
  hotelId: 7, categorias: ["Habitación Superior Vista al Mar"], regimenes: ["TODO INCLUIDO PREMIUM"],
  temporadas: temporadas as Props["temporadas"], tarifas: tarifas as Props["tarifas"], otrosHoteles: [], ...extra,
});

let contenedor: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
before(() => { contenedor = document.createElement("div"); document.body.appendChild(contenedor); });
beforeEach(() => { llamadas.length = 0; root = createRoot(contenedor); });
afterEach(() => act(() => root.unmount()));
after(() => contenedor.remove());

const montar = (p: Props) => act(() => root.render(React.createElement(HotelDetalleClient, p)));
const tablas = () => [...contenedor.querySelectorAll("table")];
const filas = (t: HTMLTableElement) => [...t.querySelectorAll("tbody > tr")] as HTMLTableRowElement[];
const etiquetas = (tr: HTMLTableRowElement) => [...tr.children].map((td) => td.getAttribute("data-label"));
function clic(el: Element) {
  act(() => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
}

describe("#22 tabla Tarifas por persona — contenido completo por fila", () => {
  test("activas e históricas: una fila por combinación con sus 7 acomodaciones y acciones", () => {
    montar(props());
    const [activas, historicas] = tablas();
    assert.ok(activas && historicas, "deben existir la tabla de activas y la del histórico");
    assert.equal(filas(activas).length, 2);
    assert.equal(filas(historicas).length, 1);
    for (const tr of [...filas(activas), ...filas(historicas)]) {
      assert.deepEqual(etiquetas(tr), ["Tarifa", "Sencilla", "Doble", "Triple", "Múltiple", "Niño 1", "Niño 2", "Infante", "Acciones"]);
      const texto = tr.textContent ?? "";
      for (const v of ["2.268.000", "1.494.000", "1.356.000", "1.260.000", "744.000", "310.000", "95.000"]) {
        assert.ok(texto.includes(v), `falta el importe ${v}`);
      }
      assert.ok(texto.includes("Habitación Superior Vista al Mar") && texto.includes("TODO INCLUIDO PREMIUM"));
    }
  });

  test("Adults Only: sin columnas de niño/infante, con las 4 de adulto y acciones", () => {
    montar(props({ adultsOnly: true }));
    for (const tr of filas(tablas()[0])) {
      assert.deepEqual(etiquetas(tr), ["Tarifa", "Sencilla", "Doble", "Triple", "Múltiple", "Acciones"]);
      assert.ok(!(tr.textContent ?? "").includes("Infante:"), "la nota de infante no aparece en Adults Only");
    }
  });

  test("temporada, Promo/Base y 'desde' van en la misma celda; la condición de la tarifa se ve completa", () => {
    montar(props());
    const [conNota, promo] = filas(tablas()[0]);
    const celdaNota = conNota.children[0] as HTMLElement;
    assert.match(celdaNota.textContent ?? "", /TEMPORADA MEDIA\s*Base/);
    const nota = [...celdaNota.querySelectorAll("div")].find((d) => d.textContent === "No reembolsable. Mínimo 4 noches en fin de año.");
    assert.ok(nota, "la condición se muestra entera como texto");
    assert.ok(!nota.className.includes("truncate"), "ya no se recorta con truncate");
    assert.match(promo.children[0].textContent ?? "", /PROMO OCTUBRE\s*Promo\s*desde TEMPORADA MEDIA/);
  });

  test("la nota de infante es texto visible (antes solo `title`) y el asterisco queda pegado al importe", () => {
    montar(props());
    const tr = filas(tablas()[0])[0];
    assert.ok((tr.children[0].textContent ?? "").includes("* Infante: Comparte cama con los padres"));
    const infante = tr.querySelector('td[data-label="Infante"]')!;
    assert.equal(infante.children.length, 1, "importe y asterisco van en un solo elemento (no se separan al apilar)");
  });

  test("apilada, la primera celda tiene un solo bloque hijo (si no, cada línea se volvía una columna angosta)", () => {
    montar(props());
    for (const t of tablas()) {
      for (const tr of filas(t)) assert.equal(tr.children[0].children.length, 1);
    }
  });
});

describe("#22 acciones operables por tacto y teclado", () => {
  test("Editar y Eliminar son botones con nombre accesible propio de la fila", () => {
    montar(props());
    const tr = filas(tablas()[0])[0];
    const botones = [...tr.querySelectorAll('td[data-label="Acciones"] button')];
    assert.deepEqual(botones.map((b) => b.getAttribute("aria-label")), [
      "Editar tarifa Habitación Superior Vista al Mar · TODO INCLUIDO PREMIUM · TEMPORADA MEDIA",
      "Eliminar tarifa Habitación Superior Vista al Mar · TODO INCLUIDO PREMIUM · TEMPORADA MEDIA",
    ]);
    for (const b of botones) assert.match(b.className, /\bh-10\b/, "objetivo táctil de 40px");
    assert.equal(contenedor.querySelector("thead .sr-only")?.textContent, "Acciones");
  });

  test("Editar carga la fila en el formulario, lo trae a la vista y pone el foco en el primer campo", () => {
    let vistas = 0;
    const proto = dom.window.HTMLElement.prototype as unknown as { scrollIntoView?: () => void };
    const previo = proto.scrollIntoView;
    proto.scrollIntoView = () => { vistas++; };
    try {
      montar(props());
      const historica = filas(tablas()[1])[0];
      clic(historica.querySelector('button[aria-label^="Editar tarifa"]')!);
      const seccion = [...contenedor.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent?.startsWith("Tarifas por persona"))!;
      const selects = [...seccion.querySelectorAll("select")] as HTMLSelectElement[];
      assert.equal(selects[0].value, "Habitación Superior Vista al Mar");
      assert.equal(selects[2].value, "TEMPORADA BAJA 2025");
      assert.equal(vistas, 1, "el formulario se desplaza a la vista");
      assert.ok(document.activeElement === selects[0], "el foco queda en Categoría");
      assert.ok([...contenedor.querySelectorAll("button")].some((b) => b.textContent === "Guardar cambios"));
    } finally {
      proto.scrollIntoView = previo;
    }
  });

  test("Eliminar pide confirmación y llama eliminarTarifa con la fila y el hotel", async () => {
    const previo = dom.window.confirm;
    let respuesta = false;
    dom.window.confirm = () => respuesta;
    (global as unknown as { confirm: () => boolean }).confirm = () => respuesta;
    try {
      montar(props());
      const boton = filas(tablas()[0])[1].querySelector('button[aria-label^="Eliminar tarifa"]')!;
      clic(boton);
      assert.equal(llamadas.length, 0, "cancelar no elimina");
      respuesta = true;
      await act(async () => { boton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
      assert.deepEqual(llamadas, [{ fn: "eliminarTarifa", args: [12, 7] }]);
    } finally {
      dom.window.confirm = previo;
    }
  });

  test("las temporadas conservan su enlace de texto Eliminar (DelBtn sin variante de ícono)", () => {
    montar(props());
    const textuales = [...contenedor.querySelectorAll("button")].filter((b) => b.textContent === "Eliminar" && !b.getAttribute("aria-label"));
    assert.ok(textuales.length >= 1);
  });
});

describe("#22 cableado — umbral de apilado sincronizado y sin tocar ResponsiveTableShell", () => {
  test("minWidth de ResponsiveTableShell y min-w-[…] del <table> son el mismo número en ambos casos", () => {
    const m = fuente.match(/<ResponsiveTableShell minWidth=\{adultsOnly \? (\d+) : (\d+)\}/);
    assert.ok(m, "minWidth depende de adultsOnly");
    const t = fuente.match(/adultsOnly \? "min-w-\[(\d+)px\]" : "min-w-\[(\d+)px\]"/);
    assert.ok(t, "el <table> declara el mismo par de anchos");
    assert.deepEqual([m[1], m[2]], [t[1], t[2]]);
    // Medido en Chromium con importes de 8 dígitos: 558 (Adults Only) y 788 (con niños).
    assert.ok(Number(m[1]) >= 558 && Number(m[2]) >= 788);
    // Debe caber en el contenedor real del detalle (max-w-5xl con padding ≈ 932 px en el histórico).
    assert.ok(Number(m[2]) <= 932);
  });

  test("activas e históricas usan la misma tablaTarifas", () => {
    assert.match(fuente, /\{tablaTarifas\(activas\)\}/);
    assert.match(fuente, /\{tablaTarifas\(historicas\)\}/);
  });

  test("ResponsiveTableShell no cambió", () => {
    const shell = readFileSync(new URL("../components/ui/ResponsiveTableShell.tsx", import.meta.url), "utf8");
    assert.match(shell, /const \{ ref, stack \} = useStackTabla\(minWidth\);/);
  });
});
