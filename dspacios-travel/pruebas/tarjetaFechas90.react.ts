// Se ejecuta con npm run test:react (loader del arnés). Interacción REAL (jsdom + eventos DOM) de la tarjeta pública del hotel (TarjetaHotelCard, la de «Anticipo del 30 %»).
//
// #90 · El cliente elige fechas (porción) o una salida con fecha concreta (bloqueo / empaquetado / dinámica) DESDE la tarjeta y ve ahí el precio calculado y la regla que ganó
// (EBB 1/2/3 o Long Stay). Sin fechas: «desde» sin etiqueta. Precio y etiqueta son UN valor (misma cotización): al cambiar de fecha, de salida o de día se descartan juntos.
// La corrección de los importes frente a la regla se prueba con las acciones reales en descuentoHotelMonedas90 / tarjetaBusquedaPromo90 / composicionRecorrido; aquí, la presentación.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- globals de jsdom para React/ReactDOM
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { TarjetaHotelConFechas } = await import("../app/tarifario/VistaBooking.tsx");
const { formatMoneda } = await import("../lib/utils.ts");
const h = React.createElement;

type Exito = { ok: true; precio: number; moneda: string; categoria: string; regimen: string; fechaIda: string; fechaRegreso: string; noches: number; fechaCalculo: string; descuentoHotel: { etiqueta: string; tipo: "ebb" | "long_stay"; umbral: number; pct: number } | null; combos: unknown[] };
const DESC = {
  ebb1: { etiqueta: "EBB 1 · 30+ días · 18 %", tipo: "ebb", umbral: 30, pct: 18 } as const,
  ebb2: { etiqueta: "EBB 2 · 60+ días · 23 %", tipo: "ebb", umbral: 60, pct: 23 } as const,
  ebb3: { etiqueta: "EBB 3 · 90+ días · 28 %", tipo: "ebb", umbral: 90, pct: 28 } as const,
  ls: { etiqueta: "Long Stay · 25 %", tipo: "long_stay", umbral: 4, pct: 25 } as const,
};
const exito = (precio: number, descuentoHotel: Exito["descuentoHotel"], dia = "2030-01-01", extra: Partial<Exito> = {}): Exito => ({
  ok: true, precio, moneda: "COP", categoria: "Estándar King", regimen: "FULL", fechaIda: "2030-10-15", fechaRegreso: "2030-10-19", noches: 4, fechaCalculo: dia, descuentoHotel, combos: [], ...extra,
});

const fila = (o: Record<string, unknown>) => ({
  modulo: "bloqueo", paquete_id: 61, paquete_nombre: "Paquete", bloqueo_id: null, bloqueo_label: null, empaquetado_id: null, salida_id: null, hotel_id: 72, hotel_nombre: "Grand Sirenis San Andrés",
  servicio_id: null, servicio_nombre: null, destino_id: 1, destino_nombre: "San Andrés", categoria: "Estándar King", regimen: "FULL", fecha_ida: null, fecha_regreso: null, noches: null, moneda: "COP",
  precio_sencilla: null, precio_doble: 1_280_000, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null, precio_infante: null, ...o,
}) as never;
const FILAS_PORCION = [fila({ modulo: "porcion_terrestre" })];
const FILAS_BLOQUEO = [fila({ bloqueo_id: 5, fecha_ida: "2030-10-15", fecha_regreso: "2030-10-19", noches: 4 }), fila({ bloqueo_id: 6, fecha_ida: "2030-12-01", fecha_regreso: "2030-12-05", noches: 4 })];
const FILAS_EMPAQ = [fila({ empaquetado_id: 8, fecha_ida: "2030-10-15", fecha_regreso: "2030-10-19", noches: 4 })];
const FILAS_DIN = [fila({ modulo: "dinamico", salida_id: 9, fecha_ida: "2030-10-15", fecha_regreso: "2030-10-19", noches: 4 })];

let contenedor: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
before(() => { contenedor = document.createElement("div"); document.body.appendChild(contenedor); });
after(() => { if (root) act(() => root!.unmount()); root = null; }); // libera el intervalo de la tarjeta: sin esto el proceso de prueba no termina
async function montar(filas: unknown[], cotizar: (i: unknown) => Promise<unknown>, hoy: () => string = () => "2030-01-01") {
  if (root) { act(() => root!.unmount()); }
  root = createRoot(contenedor);
  await act(async () => {
    root!.render(h(TarjetaHotelConFechas as never, {
      card: { filas, paqueteId: 61, hotelId: 72 }, ventana: { min: null, max: null }, cotizar, hoy,
      onClick: () => {}, foto: null, hotelNombre: "Grand Sirenis San Andrés", destino: "San Andrés", estrellas: 4, petFriendly: true, tieneCondicion: true, desde: 1_280_000, moneda: "COP",
    }));
  });
}
const texto = () => contenedor.textContent ?? "";
const etiquetas = () => [...contenedor.querySelectorAll('[data-testid="etiqueta-descuento-hotel"]')].map((e) => e.textContent?.trim());
const q = (sel: string) => contenedor.querySelector(sel);
function escribir(label: string, valor: string) {
  const el = contenedor.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  assert.ok(el, `falta el campo ${label}`);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
  act(() => { el.dispatchEvent(new window.Event("input", { bubbles: true })); });
}
function elegirSalida(valor: string) {
  const el = contenedor.querySelector('select[aria-label="Elige tu salida"]') as HTMLSelectElement;
  assert.ok(el, "falta el selector de salida");
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(el, valor);
  return act(async () => { el.dispatchEvent(new window.Event("change", { bubbles: true })); });
}
const boton = () => [...contenedor.querySelectorAll("button")].find((b) => /Ver precio para estas fechas/.test(b.textContent ?? ""))!;
const clic = (el: Element) => act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
const diferido = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>((r) => { res = r; }); return { p, res }; };

describe("sin fechas: la tarjeta conserva su «desde» y no afirma ninguna promoción", () => {
  test("«desde» visible, sin etiqueta, junto a las demás etiquetas (Pet friendly, condiciones)", async () => {
    await montar(FILAS_PORCION, async () => { throw new Error("no debe cotizar sin fechas"); });
    assert.ok(q('[data-testid="precio-desde"]'));
    assert.match(q('[data-testid="precio-desde"]')!.textContent ?? "", /desde/i);
    assert.equal(etiquetas().length, 0);
    assert.doesNotMatch(texto(), /EBB|Long Stay/);
    assert.match(texto(), /Pet friendly/i);
    assert.ok(q('[data-testid="fechas-tarjeta"]'), "ofrece elegir fechas desde la tarjeta");
  });
  test("porción: sin completar ida y regreso no se puede pedir el precio", async () => {
    await montar(FILAS_PORCION, async () => { throw new Error("no debe cotizar"); });
    assert.equal((boton() as HTMLButtonElement).disabled, true);
    escribir("Ida", "2030-10-15");
    assert.equal((boton() as HTMLButtonElement).disabled, true);
  });
});

describe("porción terrestre: elegir fechas en la tarjeta", () => {
  const CASOS: [string, Exito][] = [
    ["EBB 1", exito(1_050_000, DESC.ebb1)], ["EBB 2", exito(980_000, DESC.ebb2)], ["EBB 3", exito(900_000, DESC.ebb3)],
    ["Long Stay ganador", exito(1_120_000, DESC.ls)], ["sin descuento", exito(1_280_000, null)],
  ];
  for (const [nombre, r] of CASOS) {
    test(`${nombre}: precio y etiqueta juntos, el importe visible es el del cálculo`, async () => {
      const llamadas: unknown[] = [];
      await montar(FILAS_PORCION, async (i) => { llamadas.push(i); return r; });
      escribir("Ida", "2030-10-15"); escribir("Regreso", "2030-10-19");
      await clic(boton());
      assert.equal(llamadas.length, 1);
      assert.deepEqual(llamadas[0], { modulo: "porcion_terrestre", paqueteId: 61, hotelId: 72, fechaIda: "2030-10-15", fechaRegreso: "2030-10-19", combos: [{ categoria: "Estándar King", regimen: "FULL" }] });
      const precio = q('[data-testid="precio-fechas"]');
      assert.ok(precio, "se muestra el precio para las fechas");
      assert.ok((precio!.textContent ?? "").includes(formatMoneda(r.precio, "COP")));
      assert.match(precio!.textContent ?? "", /15\/10 → 19\/10 · 4N/);
      assert.equal(q('[data-testid="precio-desde"]'), null, "el «desde» cede su lugar al precio de las fechas");
      assert.deepEqual(etiquetas(), r.descuentoHotel ? [r.descuentoHotel.etiqueta] : []);
      // La etiqueta vive en la misma zona que el resto de las etiquetas del hotel.
      if (r.descuentoHotel) assert.match(q('[data-testid="etiqueta-descuento-hotel"]')!.parentElement!.textContent ?? "", /Grand Sirenis San Andrés[^]*Pet friendly/i);
    });
  }
  test("cambiar una fecha descarta de inmediato el par (precio y etiqueta) y vuelve a cotizar: nunca queda una etiqueta de otras fechas", async () => {
    const pend = diferido<Exito>();
    const respuestas: (Exito | Promise<Exito>)[] = [exito(900_000, DESC.ebb3), pend.p];
    await montar(FILAS_PORCION, async () => respuestas.shift()!);
    escribir("Ida", "2030-10-15"); escribir("Regreso", "2030-10-19"); await clic(boton());
    assert.deepEqual(etiquetas(), [DESC.ebb3.etiqueta]);
    escribir("Regreso", "2030-10-20"); // cambio de fecha: el par anterior ya no vale
    assert.equal(etiquetas().length, 0); assert.equal(q('[data-testid="precio-fechas"]'), null); assert.ok(q('[data-testid="precio-desde"]'));
    await clic(boton());
    assert.ok(q('[data-testid="precio-calculando"]'), "mientras llega el cálculo nuevo: «Calculando…», sin etiqueta");
    assert.equal(etiquetas().length, 0);
    await act(async () => { pend.res(exito(1_120_000, DESC.ls, "2030-01-01", { fechaRegreso: "2030-10-20", noches: 5 })); });
    assert.deepEqual(etiquetas(), [DESC.ls.etiqueta]);
    assert.ok((q('[data-testid="precio-fechas"]')!.textContent ?? "").includes(formatMoneda(1_120_000, "COP")));
  });
  test("una respuesta tardía de una selección anterior se descarta", async () => {
    const lenta = diferido<Exito>(); const rapida = diferido<Exito>();
    const cola = [lenta.p, rapida.p];
    await montar(FILAS_PORCION, async () => cola.shift()!);
    escribir("Ida", "2030-10-15"); escribir("Regreso", "2030-10-19"); await clic(boton());
    escribir("Regreso", "2030-10-20"); await clic(boton());
    await act(async () => { rapida.res(exito(980_000, DESC.ebb2, "2030-01-01", { fechaRegreso: "2030-10-20", noches: 5 })); });
    await act(async () => { lenta.res(exito(900_000, DESC.ebb3)); });
    assert.deepEqual(etiquetas(), [DESC.ebb2.etiqueta]);
    assert.ok((q('[data-testid="precio-fechas"]')!.textContent ?? "").includes(formatMoneda(980_000, "COP")));
  });
  test("si no se puede calcular: mensaje claro, sin etiqueta y el «desde» intacto", async () => {
    await montar(FILAS_PORCION, async () => ({ ok: false, error: "No pudimos calcular el precio para esas fechas. Elige otras o intenta de nuevo." }));
    escribir("Ida", "2030-10-15"); escribir("Regreso", "2030-10-19"); await clic(boton());
    assert.match(q('[role="alert"]')!.textContent ?? "", /No pudimos calcular/);
    assert.equal(etiquetas().length, 0); assert.ok(q('[data-testid="precio-desde"]'));
  });
});

describe("bloqueo, empaquetado y salida dinámica con fecha concreta", () => {
  const ORIGENES: [string, unknown[], Record<string, unknown>][] = [
    ["bloqueo", FILAS_BLOQUEO, { modulo: "bloqueo", bloqueoId: 5, empaquetadoId: null, salidaId: null }],
    ["empaquetado", FILAS_EMPAQ, { modulo: "bloqueo", bloqueoId: null, empaquetadoId: 8, salidaId: null }],
    ["salida dinámica", FILAS_DIN, { modulo: "dinamico", bloqueoId: null, empaquetadoId: null, salidaId: 9 }],
  ];
  for (const [nombre, filas, esperado] of ORIGENES) {
    test(`${nombre}: elegir la salida cotiza esa fecha y muestra precio + etiqueta del mismo cálculo`, async () => {
      const llamadas: unknown[] = [];
      await montar(filas, async (i) => { llamadas.push(i); return exito(980_000, DESC.ebb2); });
      assert.ok(q('[data-testid="precio-desde"]'), "antes de elegir salida: «desde», sin etiqueta");
      assert.equal(etiquetas().length, 0);
      const sel = contenedor.querySelector('select[aria-label="Elige tu salida"]') as HTMLSelectElement;
      await elegirSalida(sel.options[1].value);
      assert.equal(llamadas.length, 1);
      assert.deepEqual(llamadas[0], { paqueteId: 61, hotelId: 72, combos: [{ categoria: "Estándar King", regimen: "FULL" }], ...esperado });
      assert.deepEqual(etiquetas(), [DESC.ebb2.etiqueta]);
      assert.ok((q('[data-testid="precio-fechas"]')!.textContent ?? "").includes(formatMoneda(980_000, "COP")));
    });
  }
  test("las salidas ya vencidas no se ofrecen", async () => {
    await montar([fila({ bloqueo_id: 4, fecha_ida: "2029-01-10", fecha_regreso: "2029-01-14", noches: 4 }), ...FILAS_BLOQUEO], async () => exito(1, null));
    const sel = contenedor.querySelector('select[aria-label="Elige tu salida"]') as HTMLSelectElement;
    assert.equal(sel.options.length, 3, "placeholder + 2 salidas vigentes");
  });
  test("cambiar de salida descarta el par anterior y cotiza la nueva", async () => {
    const respuestas = [exito(900_000, DESC.ebb3), exito(1_280_000, null, "2030-01-01", { fechaIda: "2030-12-01", fechaRegreso: "2030-12-05" })];
    await montar(FILAS_BLOQUEO, async () => respuestas.shift()!);
    const sel = contenedor.querySelector('select[aria-label="Elige tu salida"]') as HTMLSelectElement;
    await elegirSalida(sel.options[1].value);
    assert.deepEqual(etiquetas(), [DESC.ebb3.etiqueta]);
    await elegirSalida(sel.options[2].value);
    assert.equal(etiquetas().length, 0, "la salida nueva no tiene descuento: no queda la etiqueta de la anterior");
    assert.ok((q('[data-testid="precio-fechas"]')!.textContent ?? "").includes(formatMoneda(1_280_000, "COP")));
  });
});

describe("el día de negocio cambió: precio y etiqueta caducan juntos y se recalculan", () => {
  test("al volver a la pestaña con otro día: «Calculando…» sin etiqueta vieja; luego el par nuevo", async () => {
    let dia = "2030-01-01";
    const pend = diferido<Exito>();
    const respuestas: (Exito | Promise<Exito>)[] = [exito(900_000, DESC.ebb3, "2030-01-01"), pend.p];
    const llamadas: unknown[] = [];
    await montar(FILAS_BLOQUEO, async (i) => { llamadas.push(i); return respuestas.shift()!; }, () => dia);
    const sel = contenedor.querySelector('select[aria-label="Elige tu salida"]') as HTMLSelectElement;
    await elegirSalida(sel.options[1].value);
    assert.deepEqual(etiquetas(), [DESC.ebb3.etiqueta]);
    dia = "2030-01-02"; // pasó la medianoche de Bogotá con la pestaña abierta
    await act(async () => { document.dispatchEvent(new window.Event("visibilitychange")); });
    assert.equal(llamadas.length, 2, "se recalculó con la misma salida");
    assert.deepEqual(llamadas[1], llamadas[0]);
    assert.equal(etiquetas().length, 0, "la etiqueta de ayer ya no se muestra");
    assert.equal(q('[data-testid="precio-fechas"]'), null);
    assert.ok(q('[data-testid="precio-calculando"]'));
    await act(async () => { pend.res(exito(980_000, DESC.ebb2, "2030-01-02")); });
    assert.deepEqual(etiquetas(), [DESC.ebb2.etiqueta]);
    assert.ok((q('[data-testid="precio-fechas"]')!.textContent ?? "").includes(formatMoneda(980_000, "COP")));
  });
});
