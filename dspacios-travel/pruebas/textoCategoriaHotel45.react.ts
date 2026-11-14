// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// #45 (303) — descripción y «qué incluye» por categoría DENTRO de cada hotel:
//   · editor de la ficha de Producto: guarda solo en la fila hotel×categoría, sin tocar el nombre global;
//   · guardar las categorías del hotel ya no borra los textos de las categorías que se conservan;
//   · ficha del tarifario: muestra el texto de la categoría elegida y nada si no hay texto.
import { montar, clic, botonConTexto, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { HotelCategoriasRegimenesEditor } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelCategoriasRegimenesEditor.tsx");
const { actualizarHotelCategoriasRegimenes, actualizarTextoCategoriaHotel } = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
const { TextoCategoriaHotel, TextosCategoriaProvider } = await import("../app/tarifario/TextoCategoriaHotel.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

// `escribir` del arnés es solo para <input>: mismo mecanismo para <textarea>.
async function escribirArea(el: Element, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

const CATS = [{ id: 1, nombre: "Estándar" }, { id: 2, nombre: "Superior" }];
const semilla = () => ({
  categorias_habitacion: CATS.map((c) => ({ ...c })),
  hotel_categorias: [
    { hotel_id: 10, categoria_id: 1, descripcion: null, incluye: null },
    { hotel_id: 10, categoria_id: 2, descripcion: "Con balcón", incluye: "Minibar" },
    { hotel_id: 20, categoria_id: 2, descripcion: "Sin balcón", incluye: null },
  ],
});

test("editor: Editar → guardar escribe solo la fila de ese hotel y esa categoría", async () => {
  const bd = usarBD(semilla());
  const m = await montar(h(HotelCategoriasRegimenesEditor, {
    hotelId: 10, todasCategorias: CATS, todosRegimenes: [], categoriaIds: [1, 2], regimenIds: [],
    textosCategoria: { 1: { descripcion: "", incluye: "" }, 2: { descripcion: "Con balcón", incluye: "Minibar" } },
  }));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, /Categorías de habitación y regímenes/), "abrir sección");
  const fila1 = m.contenedor.querySelector('[data-testid="texto-categoria-1"]')!;
  assert.match(fila1.textContent ?? "", /Sin descripción para este hotel/);
  await clic(botonConTexto(fila1, /Editar/), "Editar Estándar");
  await escribirArea(fila1.querySelector("textarea#desc-1")!, "Vista al jardín");
  await escribirArea(fila1.querySelector("textarea#inc-1")!, "Wi-Fi\nCaja fuerte");
  await clic(botonConTexto(fila1, /^Guardar$/), "Guardar");
  const filas = bd.filas("hotel_categorias");
  assert.deepEqual(filas.find((f) => f.hotel_id === 10 && f.categoria_id === 1), { hotel_id: 10, categoria_id: 1, descripcion: "Vista al jardín", incluye: "Wi-Fi\nCaja fuerte" });
  assert.equal(filas.find((f) => f.hotel_id === 20)?.descripcion, "Sin balcón", "otro hotel con la misma categoría no cambia");
  assert.equal(bd.filas("categorias_habitacion").find((c) => c.id === 1)?.nombre, "Estándar", "el nombre global no se toca");
});

test("acción: textos vacíos guardan null; categoría no asignada al hotel se rechaza; ids inválidos se rechazan", async () => {
  const bd = usarBD(semilla());
  assert.deepEqual(await actualizarTextoCategoriaHotel(10, 2, "   ", ""), { ok: true });
  assert.deepEqual(bd.filas("hotel_categorias").find((f) => f.hotel_id === 10 && f.categoria_id === 2), { hotel_id: 10, categoria_id: 2, descripcion: null, incluye: null });
  assert.equal((await actualizarTextoCategoriaHotel(20, 1, "x", "")).ok, false);
  assert.equal((await actualizarTextoCategoriaHotel(10, 0, "x", "")).ok, false);
  assert.equal((await actualizarTextoCategoriaHotel(10, 2, "x".repeat(2001), "")).ok, false);
});

test("guardar categorías: conserva los textos de las que se mantienen y quita solo las desmarcadas", async () => {
  const bd = usarBD(semilla());
  assert.equal((await actualizarHotelCategoriasRegimenes(10, [2], [])).ok, true);
  const del10 = bd.filas("hotel_categorias").filter((f) => f.hotel_id === 10);
  assert.deepEqual(del10.map((f) => f.categoria_id), [2]);
  assert.equal(del10[0].descripcion, "Con balcón", "la descripción de Superior en este hotel se conserva");
  assert.equal(bd.filas("hotel_categorias").filter((f) => f.hotel_id === 20).length, 1, "otro hotel intacto");
  assert.equal((await actualizarHotelCategoriasRegimenes(10, [2.5 as unknown as number], [])).ok, false, "id no entero rechazado");
});

test("ficha del tarifario: muestra la categoría elegida de ESE hotel y nada si no hay texto", () => {
  const textos = { 10: { Superior: { descripcion: "Con balcón", incluye: "Minibar\nCaja fuerte" } }, 20: { Superior: { descripcion: "Sin balcón", incluye: null } } };
  const html = (hotelId: number, categoria: string) => renderToStaticMarkup(h(TextosCategoriaProvider, { textos }, h(TextoCategoriaHotel, { hotelId, categoria })));
  const a = html(10, "Superior");
  assert.match(a, /Con balcón/);
  assert.match(a, /<li>Minibar<\/li><li>Caja fuerte<\/li>/);
  assert.match(html(20, "Superior"), /Sin balcón/);
  assert.equal(html(10, "Estándar"), "");
  assert.equal(renderToStaticMarkup(h(TextoCategoriaHotel, { hotelId: 10, categoria: "Superior" })), "", "sin proveedor no se muestra nada");
});
