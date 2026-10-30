import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  agruparPorHotel, estadoTarifarioVista, normalizarPestana, pestanasVisibles, precioDobleReferencia, servicioSeleccionable,
  type TipoPaquete,
} from "../lib/paquetes/armadoPestanas.ts";

// #101 — reglas puras de la pantalla de armado en pestañas. La interfaz real se prueba en armadoPestanas101.react.ts.

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("pestanasVisibles", () => {
  const casos: [TipoPaquete, string[]][] = [
    ["bloqueo", ["config", "vuelos", "hoteles", "servicios", "tarifario"]],
    ["dinamico", ["config", "vuelos", "hoteles", "servicios", "tarifario"]],
    ["porcion_terrestre", ["config", "hoteles", "servicios", "tarifario"]],
    ["servicios", ["config", "servicios", "tarifario"]],
  ];
  for (const [tipo, esperado] of casos) {
    test(`${tipo}: ${esperado.join(" | ")}`, () => assert.deepEqual(pestanasVisibles(tipo), esperado));
  }
});

describe("normalizarPestana", () => {
  test("acepta una pestaña que el tipo muestra", () => {
    assert.equal(normalizarPestana("tarifario", "bloqueo"), "tarifario");
    assert.equal(normalizarPestana("vuelos", "dinamico"), "vuelos");
  });
  test("cualquier otra cosa cae en Configuración", () => {
    for (const v of [undefined, null, "", "otra", 5, ["vuelos"], "VUELOS"]) assert.equal(normalizarPestana(v, "bloqueo"), "config");
    assert.equal(normalizarPestana("vuelos", "porcion_terrestre"), "config");
    assert.equal(normalizarPestana("hoteles", "servicios"), "config");
  });
});

describe("estadoTarifarioVista", () => {
  test("listo = publicado; pendiente/recalculando/desconocido = desactualizado; fallido = fallido con su error", () => {
    assert.equal(estadoTarifarioVista("listo", null).clave, "publicado");
    assert.equal(estadoTarifarioVista("pendiente", null).clave, "desactualizado");
    assert.equal(estadoTarifarioVista("recalculando", null).clave, "desactualizado");
    assert.equal(estadoTarifarioVista("algo-raro", null).clave, "desactualizado");
    assert.equal(estadoTarifarioVista(null, null).clave, "desactualizado");
    const f = estadoTarifarioVista("fallido", "  Error técnico  ");
    assert.equal(f.clave, "fallido");
    assert.equal(f.detalle, "Error técnico");
  });
  test("fallido sin tarifario_error igual lo dice", () => {
    assert.match(estadoTarifarioVista("fallido", "").detalle ?? "", /No se pudo generar/);
  });
  test("publicado en un paquete inactivo avisa que no es visible", () => {
    assert.match(estadoTarifarioVista("listo", null, false).detalle ?? "", /inactivo/);
    assert.equal(estadoTarifarioVista("listo", null, true).detalle, null);
  });
});

describe("precioDobleReferencia", () => {
  test("es el menor PVP doble > 0; nunca niño, infante ni sencilla", () => {
    const filas = [
      { acomodacion: "nino", precio_pvp: 1 }, { acomodacion: "infante", precio_pvp: 0 }, { acomodacion: "sencilla", precio_pvp: 5 },
      { acomodacion: "doble", precio_pvp: 900 }, { acomodacion: "doble", precio_pvp: 700 }, { acomodacion: "doble", precio_pvp: 0 },
    ];
    assert.equal(precioDobleReferencia(filas), 700);
  });
  test("sin doble publicada → null", () => {
    assert.equal(precioDobleReferencia([{ acomodacion: "nino", precio_pvp: 10 }]), null);
    assert.equal(precioDobleReferencia([]), null);
  });
});

describe("agruparPorHotel", () => {
  const f = (id: number, hotel: string | null, acom: string, pvp: number, modulo = "bloqueo") => ({ id, modulo, hotel_nombre: hotel, acomodacion: acom, precio_pvp: pvp });
  test("agrupa por hotel en orden alfabético, sin servicios, con el doble de cada uno", () => {
    const g = agruparPorHotel([
      f(1, "Zeta", "doble", 300), f(2, "Alfa", "doble", 200), f(3, "Alfa", "nino", 50), f(4, "Alfa", "doble", 150),
      f(5, null, "sencilla", 9), f(6, "Alfa", "doble", 1, "servicios"),
    ]);
    assert.deepEqual(g.map((x) => x.hotel), ["Alfa", "Zeta", "—"]);
    assert.deepEqual(g.map((x) => x.filas.length), [3, 1, 1]);
    assert.deepEqual(g.map((x) => x.dobleDesde), [150, 300, null]);
  });
});

describe("servicioSeleccionable", () => {
  test("necesita tarifa por persona o rangos de grupo", () => {
    assert.equal(servicioSeleccionable({ precio_persona: 0, servicio_tarifa_pax: [] }), true, "$0 es una tarifa (gratis), no ausencia");
    assert.equal(servicioSeleccionable({ precio_persona: null, servicio_tarifa_pax: [{}] }), true);
    assert.equal(servicioSeleccionable({ precio_persona: null, servicio_tarifa_pax: [] }), false);
    assert.equal(servicioSeleccionable({ precio_persona: null }), false);
  });
});

describe("cableado: solo interfaz", () => {
  const cliente = leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
  const pagina = leer("app/(dashboard)/dashboard/paquetes/[id]/page.tsx");
  test("ArmadoClient no importa acciones nuevas: las mismas de siempre", () => {
    const imp = cliente.match(/import \{([^}]*)\} from "\.\.\/actions";/);
    assert.ok(imp);
    const nombres = imp[1].split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !s.startsWith("type "));
    assert.deepEqual(nombres.sort(), ["generarTarifario", "getTarifasHotel", "setHotel", "setHotelFiltros", "setHotelPrioridad", "setServicio", "setServicios", "setTodosHoteles", "setTodosVuelos", "setVuelo"].sort());
  });
  test("page.tsx entrega la pestaña (?tab=) y el estado del tarifario leído de armado_paquetes", () => {
    assert.match(pagina, /searchParams\?: Promise<\{ tab\?: string \| string\[\] \}>/);
    assert.match(pagina, /pestanaInicial=\{pestanaInicial \?\? null\}/);
    assert.match(pagina, /tarifario_estado/);
    assert.match(pagina, /tarifario_error/);
    assert.match(pagina, /tarifario_snapshot_publicable/);
  });
  test("sin emojis ni caracteres de flecha como íconos en la pantalla", () => {
    assert.doesNotMatch(cliente, /[✕▾▸]/);
  });
});
