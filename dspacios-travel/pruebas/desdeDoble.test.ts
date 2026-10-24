import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { desdeDoble, desdeDobleSegunMoneda, desdeListadoPorPaquete, desdeDobleDetallePrograma, type FilaListado } from "../lib/tarifario/desdeDoble.ts";
import { minRoomPvpResumen } from "../lib/tarifario/resumenCliente.ts";
import type { FilaResumen } from "../lib/tarifario/resumen.ts";

// TASKS #92/#114: el «Desde» sale SOLO de una tarifa DOBLE publicable, por moneda, dentro de las filas que se ofrecen.

// Fila de resumen mínima: sencilla/infante más baratas que la doble a propósito.
const fila = (o: Partial<FilaResumen> & { paquete_id?: number }): FilaResumen =>
  ({ modulo: "bloqueo", paquete_id: 1, moneda: "COP", precio_sencilla: 90, precio_doble: 100, precio_triple: 95, precio_multiple: 94,
    precio_nino: 10, precio_nino2: 20, precio_infante: 0, desde_adulto: 90, desde_general: 0.5, ...o }) as FilaResumen;

describe("desdeDoble (tarjeta de hotel)", () => {
  test("toma la DOBLE aunque sencilla, triple, niño o infante sean más baratos", () => {
    const filas = [fila({}), fila({ precio_doble: 120, precio_sencilla: 50 })];
    assert.equal(desdeDoble(filas, "COP"), 100);
    assert.equal(minRoomPvpResumen(filas), 90, "el mínimo anterior daba la sencilla: ese es el defecto que se corrige");
  });
  test("varias salidas/temporadas: el menor DOBLE entre las filas ofrecidas", () => {
    const filas = [fila({ precio_doble: 300, fecha_ida: "2026-12-01" }), fila({ precio_doble: 250, fecha_ida: "2027-01-10" }), fila({ precio_doble: 410 })];
    assert.equal(desdeDoble(filas, "COP"), 250);
  });
  test("una salida filtrada fuera del conjunto no influye", () => {
    const ofrecidas = [fila({ precio_doble: 300 })];
    assert.equal(desdeDoble(ofrecidas, "COP"), 300);
  });
  test("sin DOBLE publicable (null, 0, negativa o NaN) → null («Consultar»), nunca otra acomodación", () => {
    assert.equal(desdeDoble([fila({ precio_doble: null }), fila({ precio_doble: 0 }), fila({ precio_doble: -5 }), fila({ precio_doble: NaN })], "COP"), null);
    assert.equal(desdeDoble([], "COP"), null);
  });
  test("nunca mezcla monedas: COP no ve USD y viceversa", () => {
    const filas = [fila({ moneda: "COP", precio_doble: 2_000_000 }), fila({ moneda: "USD", precio_doble: 500 })];
    assert.equal(desdeDoble(filas, "COP"), 2_000_000);
    assert.equal(desdeDoble(filas, "USD"), 500);
    assert.equal(desdeDoble([fila({ moneda: "USD", precio_doble: 500 })], "COP"), null);
  });
  test("moneda ausente o en minúsculas se normaliza (COP por defecto)", () => {
    assert.equal(desdeDoble([fila({ moneda: null, precio_doble: 80 }), fila({ moneda: "usd", precio_doble: 5 })], "cop"), 80);
    assert.equal(desdeDoble([fila({ moneda: "usd", precio_doble: 5 })], "USD"), 5);
  });
});

describe("desdeDobleSegunMoneda", () => {
  test("un importe por moneda, COP primero, sin convertir", () => {
    const r = desdeDobleSegunMoneda([fila({ moneda: "USD", precio_doble: 700 }), fila({ moneda: "USD", precio_doble: 650 }), fila({ moneda: "COP", precio_doble: 3_000_000 })]);
    assert.deepEqual(r, [{ moneda: "COP", valor: 3_000_000 }, { moneda: "USD", valor: 650 }]);
  });
  test("vacío si ninguna fila tiene DOBLE", () => {
    assert.deepEqual(desdeDobleSegunMoneda([fila({ precio_doble: null })]), []);
  });
});

describe("desdeListadoPorPaquete (listado de paquetes, #114)", () => {
  const f = (o: Partial<FilaListado>): FilaListado => ({ paquete_id: 1, modulo: "bloqueo", moneda: "COP", precio_doble: 100, desde_general: 1, ...o });
  test("usa DOBLE y no desde_general (que incluye infante/niño)", () => {
    const m = desdeListadoPorPaquete([f({ desde_general: 0.01 }), f({ paquete_id: 2, modulo: "porcion_terrestre", precio_doble: 400, desde_general: 20 })]);
    assert.deepEqual(m.get(1), [{ moneda: "COP", valor: 100 }]);
    assert.deepEqual(m.get(2), [{ moneda: "COP", valor: 400 }]);
  });
  test("Empaquetados/Dinámico con COP y USD en el mismo paquete: dos importes separados", () => {
    const m = desdeListadoPorPaquete([f({ modulo: "dinamico", moneda: "USD", precio_doble: 300 }), f({ modulo: "dinamico", moneda: "COP", precio_doble: 1_200_000 })]);
    assert.deepEqual(m.get(1), [{ moneda: "COP", valor: 1_200_000 }, { moneda: "USD", valor: 300 }]);
  });
  test("paquete sin DOBLE no aparece en el mapa («Consultar») aunque tenga sencilla/infante", () => {
    const m = desdeListadoPorPaquete([f({ precio_doble: null, desde_general: 5 })]);
    assert.equal(m.has(1), false);
  });
  test("Servicios (sin acomodación): conserva su desde por persona, por moneda", () => {
    const m = desdeListadoPorPaquete([f({ paquete_id: 3, modulo: "servicios", precio_doble: null, desde_general: 80_000 }), f({ paquete_id: 3, modulo: "servicios", moneda: "USD", precio_doble: null, desde_general: 25 })]);
    assert.deepEqual(m.get(3), [{ moneda: "COP", valor: 80_000 }, { moneda: "USD", valor: 25 }]);
  });
});

describe("cableado de las pantallas (texto fuente)", async () => {
  const { readFileSync } = await import("node:fs");
  const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  test("Vista Booking calcula la tarjeta con desdeDoble y ya no usa el mínimo de adulto", () => {
    const s = leer("app/tarifario/VistaBooking.tsx");
    assert.match(s, /c\.desde = desdeDoble\(c\.filas, c\.moneda\)/);
    assert.doesNotMatch(s, /minRoomPvp/);
  });
  test("el listado de paquetes ya no lee desde_general ni formatea con formatCOP", () => {
    const page = leer("app/(dashboard)/dashboard/paquetes/page.tsx");
    const lista = leer("app/(dashboard)/dashboard/paquetes/PaquetesListado.tsx");
    assert.match(page, /desdeListadoPorPaquete\(/);
    assert.doesNotMatch(page, /desde_general/);
    assert.doesNotMatch(lista, /formatCOP/);
  });
});

describe("desdeDobleDetallePrograma (ficha y documento de Programas)", () => {
  const pr = (acomodacion: string, pvp: number | null) => ({ acomodacion, pvp });
  test("toma el menor PVP DOBLE entre categorías y salidas; sencilla/triple no cuentan", () => {
    const det = { categorias: [{ precios: [pr("sencilla", 10), pr("doble", 200)] }], salidas: [{ precios: [pr("doble", 150), pr("triple", 5)] }] };
    assert.equal(desdeDobleDetallePrograma(det), 150);
  });
  test("DOBLE sin PVP (bajo solicitud / null / 0) → null («Consultar»)", () => {
    const det = { categorias: [{ precios: [pr("doble", null), pr("doble", 0), pr("sencilla", 10)] }], salidas: [] };
    assert.equal(desdeDobleDetallePrograma(det), null);
  });
});

describe("Programas: ninguna superficie rotula «Desde» un desde_precio manual (#92)", async () => {
  const { readFileSync } = await import("node:fs");
  const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  // Solo código: los comentarios pueden nombrar el campo para explicar por qué ya no se usa.
  const codigo = (r: string) =>
    leer(r)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
  test("la ficha no usa p.desde_precio y cae a «Consultar» sin DOBLE", () => {
    const s = codigo("app/tarifario/programa/[id]/page.tsx");
    assert.doesNotMatch(s, /desde_precio/);
    assert.ok(s.includes("desdeDobleDetallePrograma(det)"));
    assert.match(s, /Consultar/);
  });
  test("el documento no usa p.desde_precio y muestra «Consultar» sin DOBLE", () => {
    const s = codigo("app/tarifario/programa/[id]/doc/page.tsx");
    assert.doesNotMatch(s, /desde_precio/);
    assert.ok(s.includes("desdeDobleDetallePrograma(det)"));
    assert.match(s, /Consultar/);
  });
  test("el resumen ya no deja ganar al manual y filtra bajo_solicitud en categorías", () => {
    const s = codigo("lib/programas.ts");
    assert.doesNotMatch(s, /desdeManual/);
    assert.ok(s.includes('.select("categoria_id, acomodacion, neto, bajo_solicitud")'));
  });
});
