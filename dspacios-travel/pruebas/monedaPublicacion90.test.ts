// #90 Entrega D / #93 — moneda de publicación elegida y TRM condicional (módulo puro).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ETIQUETA_SIN_CONVERSION_90,
  evaluarPublicacion90,
  mensajeEvaluacion90,
  textoEstadoTrm90,
  trmValida90,
  type FuenteMoneda90,
} from "../lib/reservar/monedaPublicacion90.ts";

const hotel = (moneda: string | null, nombre = "H1"): FuenteMoneda90 => ({ tipo: "hotel", nombre, moneda });
const serv = (moneda: string | null, nombre = "Tour"): FuenteMoneda90 => ({ tipo: "servicio", nombre, moneda });
const sal = (moneda: string | null, nombre = "MDE-CTG"): FuenteMoneda90 => ({ tipo: "salida", nombre, moneda });
const vuelo = (moneda: string | null, nombre = "L93FYZ"): FuenteMoneda90 => ({ tipo: "vuelo", nombre, moneda });

describe("#93 modo cop_trm_63: la TRM solo se exige si algo está en USD", () => {
  test("todo COP sin TRM: publica y dice 'No requiere conversión'", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: null, fuentes: [hotel("COP"), serv("COP"), sal("COP")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.requiereTrm, false);
    assert.equal(ev.estadoTrm, "no_requiere");
    assert.equal(ev.trm, null);
    assert.equal(textoEstadoTrm90(ev), ETIQUETA_SIN_CONVERSION_90);
  });
  test("todo COP con TRM vacía o '': igual publica (no se inventa ninguna TRM)", () => {
    for (const trm of [undefined, "", "  "]) {
      const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm, fuentes: [hotel("COP")] });
      assert.equal(ev.ok, true, String(trm));
      assert.equal(ev.trm, null);
    }
  });
  test("una fuente USD (hotel) sin TRM: bloquea y nombra el componente", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: null, fuentes: [hotel("USD", "Decameron"), serv("COP")] });
    assert.equal(ev.ok, false);
    assert.equal(ev.requiereTrm, true);
    assert.equal(ev.estadoTrm, "falta");
    assert.deepEqual(ev.bloqueos.map((b) => b.codigo), ["trm_faltante"]);
    assert.match(mensajeEvaluacion90(ev), /Falta la TRM/);
    assert.match(mensajeEvaluacion90(ev), /Hotel Decameron/);
  });
  test("USD en servicio, en salida manual o en salida vinculada (su moneda real): cada una exige TRM", () => {
    for (const f of [serv("USD"), sal("USD")]) {
      const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: null, fuentes: [hotel("COP"), f] });
      assert.equal(ev.ok, false, f.tipo);
      assert.equal(ev.estadoTrm, "falta");
    }
  });
  test("TRM 0, negativa, texto o booleano NO cuentan; nunca se cae a 1", () => {
    for (const trm of [0, -5, "abc", true, Number.NaN]) {
      const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm, fuentes: [hotel("USD")] });
      assert.equal(ev.ok, false, String(trm));
      assert.equal(ev.trm, null);
      assert.ok(["falta", "invalida"].includes(ev.estadoTrm), String(trm));
    }
    assert.equal(trmValida90(1), 1, "1 solo si el usuario lo escribió; no hay default");
    assert.equal(trmValida90(null), null);
    for (const mala of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "abc", 1e11, "100000000000", 1e20]) assert.equal(trmValida90(mala), null, String(mala));
    assert.equal(trmValida90(99999999999.99), 99999999999.99, "el tope es exclusivo");
  });
  test("USD con TRM positiva: publica y la TRM es la guardada", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: "3987.65", fuentes: [hotel("USD"), sal("COP")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.trm, 3987.65);
    assert.equal(ev.estadoTrm, "ok");
  });
  test("cambio posterior COP→USD: lo que publicaba sin TRM deja de poder publicarse", () => {
    const antes = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: null, fuentes: [hotel("COP"), serv("COP")] });
    const despues = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: null, fuentes: [hotel("COP"), serv("USD", "Tour VIP")] });
    assert.equal(antes.ok, true);
    assert.equal(despues.ok, false);
    assert.match(mensajeEvaluacion90(despues), /Servicio Tour VIP/);
  });
  test("un vuelo de Bloqueo/Sistema del armado no entra a la oferta del modo 63", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: null, fuentes: [hotel("COP"), vuelo("USD")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.requiereTrm, false);
  });
});

describe("#90 (234) modo cop_trm_63 publicando en USD: COP / TRM solo si hay fuentes en COP", () => {
  test("USD→USD SIN TRM: publica y dice 'No requiere conversión' (nada que convertir; la provisional se congela al contratar)", () => {
    for (const trm of [null, undefined, "", 0, "abc"]) {
      const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "USD", trm, fuentes: [hotel("USD"), serv("USD"), sal("USD")] });
      assert.equal(ev.ok, true, String(trm));
      assert.equal(ev.monedaPublicacion, "USD");
      assert.equal(ev.requiereTrm, false);
      assert.equal(ev.estadoTrm, "no_requiere");
      assert.equal(textoEstadoTrm90(ev), ETIQUETA_SIN_CONVERSION_90);
    }
  });
  test("USD→USD con TRM configurada: publica y la TRM guardada es la de la oferta", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "USD", trm: 4000, fuentes: [hotel("USD"), serv("USD"), sal("USD")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.requiereTrm, false);
    assert.equal(ev.trm, 4000);
    assert.equal(ev.estadoTrm, "ok");
    assert.equal(textoEstadoTrm90(ev), ETIQUETA_SIN_CONVERSION_90);
  });
  test("COP→USD con TRM: publica; los componentes en COP son los que se convierten", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "USD", trm: "3987.65", fuentes: [hotel("USD"), sal("COP", "BOG-MDE")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.trm, 3987.65);
    assert.deepEqual(ev.componentesCop, ["Salida BOG-MDE"]);
  });
  for (const trm of [null, undefined, "", 0, -4000, "abc", true]) {
    test(`USD con una fuente en COP y sin TRM válida (${JSON.stringify(trm) ?? "undefined"}) bloquea (nunca TRM 1)`, () => {
      const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "USD", trm, fuentes: [hotel("USD"), sal("COP", "BOG-MDE")] });
      assert.equal(ev.ok, false);
      assert.equal(ev.requiereTrm, true);
      assert.ok(["trm_faltante", "trm_invalida"].includes(ev.bloqueos[0].codigo), ev.bloqueos[0].codigo);
      assert.equal(ev.trm, null);
      assert.match(mensajeEvaluacion90(ev), /COP/);
      assert.match(textoEstadoTrm90(ev), /Falta la TRM|TRM inválida/);
    });
  }
  test("USD→COP (publicación COP con fuentes en USD) sigue como antes: TRM obligatoria solo si hay USD", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: 4000, fuentes: [hotel("USD"), sal("COP")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.monedaPublicacion, "COP");
    assert.equal(ev.requiereTrm, true);
  });
  test("modo 63 sin moneda elegida (paquetes anteriores a la 233) sigue siendo COP", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: null, trm: null, fuentes: [hotel("COP")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.monedaPublicacion, "COP");
    assert.equal(ev.requiereTrm, false);
  });
  test("una fuente sin moneda válida sigue bloqueando también en USD", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "USD", trm: 4000, fuentes: [hotel("USD"), serv(null, "Tour")] });
    assert.equal(ev.ok, false);
    assert.equal(ev.bloqueos[0].codigo, "moneda_fuente_invalida");
  });
  test("fuera del modo 63 publicar en USD con fuentes en COP sigue rechazado (no hay conversión de siempre)", () => {
    const ev = evaluarPublicacion90({ modo: "legacy", monedaPublicacion: "USD", trm: 4000, fuentes: [hotel("COP")] });
    assert.equal(ev.ok, false);
  });
});

describe("#90 D: fuera del modo 63 la moneda se elige y la mezcla se rechaza", () => {
  test("publicación USD con fuentes uniformes USD: publica y no pide TRM", () => {
    const ev = evaluarPublicacion90({ modo: "legacy", monedaPublicacion: "USD", trm: null, fuentes: [hotel("USD"), serv("USD"), sal("USD")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.requiereTrm, false);
    assert.equal(ev.monedaPublicacion, "USD");
  });
  test("publicación COP con fuentes uniformes COP: publica", () => {
    assert.equal(evaluarPublicacion90({ modo: "legacy", monedaPublicacion: "COP", trm: null, fuentes: [hotel("COP"), vuelo("COP")] }).ok, true);
  });
  test("mezcla COP/USD fuera del modo 63: rechazada, con los componentes que la causan", () => {
    const ev = evaluarPublicacion90({ modo: "legacy", monedaPublicacion: "USD", trm: null, fuentes: [hotel("USD"), vuelo("COP", "L93FYZ")] });
    assert.equal(ev.ok, false);
    assert.deepEqual(ev.bloqueos.map((b) => b.codigo), ["mezcla_fuera_modo63"]);
    assert.deepEqual(ev.bloqueos[0].componentes, ["Vuelo L93FYZ"]);
  });
  test("fuentes uniformes en OTRA moneda que la elegida: subcaso detenido (depende de E4), sin importes inventados", () => {
    const ev = evaluarPublicacion90({ modo: "legacy", monedaPublicacion: "COP", trm: 4000, fuentes: [hotel("USD"), serv("USD")] });
    assert.equal(ev.ok, false);
    assert.deepEqual(ev.bloqueos.map((b) => b.codigo), ["conversion_no_disponible"]);
    assert.match(mensajeEvaluacion90(ev), /E4/);
    assert.equal(ev.trm, null, "fuera del modo 63 la TRM del paquete no se usa");
  });
  test("sin moneda elegida: no se deriva de los hoteles", () => {
    for (const m of [null, undefined, "", "EUR", "usd"]) {
      const ev = evaluarPublicacion90({ modo: "legacy", monedaPublicacion: m, trm: null, fuentes: [hotel("USD")] });
      assert.equal(ev.ok, false, String(m));
      assert.equal(ev.monedaPublicacion, null);
      assert.equal(ev.bloqueos[0].codigo, "sin_moneda");
    }
  });
  test("en el modo de siempre la moneda de una salida dinámica NO cuenta (solo se acredita para el modo 63; por defecto es COP)", () => {
    const ev = evaluarPublicacion90({ modo: "legacy", monedaPublicacion: "USD", trm: null, fuentes: [hotel("USD"), sal("COP"), sal(null)] });
    assert.equal(ev.ok, true, mensajeEvaluacion90(ev));
  });
  test("el modo 63 sin moneda guardada publica en COP por definición del modo (no es una deducción desde las fuentes)", () => {
    const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: null, trm: null, fuentes: [hotel("COP")] });
    assert.equal(ev.ok, true);
    assert.equal(ev.monedaPublicacion, "COP");
  });
  test("una fuente sin moneda acreditada (null) bloquea en ambos modos; no se asume COP", () => {
    for (const modo of ["legacy", "cop_trm_63"] as const) {
      const ev = evaluarPublicacion90({ modo, monedaPublicacion: "COP", trm: 4000, fuentes: [hotel("COP"), serv(null, "Spa")] });
      assert.equal(ev.ok, false, modo);
      assert.ok(ev.bloqueos.some((b) => b.codigo === "moneda_fuente_invalida"), modo);
    }
  });
});

describe("paridad: la misma entrada da el mismo veredicto (panel, generador, cotización)", () => {
  test("es determinista y no depende del orden de las fuentes", () => {
    const f = [hotel("USD", "A"), serv("COP", "B"), sal("COP", "C")];
    const a = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: 4000, fuentes: f });
    const b = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: 4000, fuentes: [...f].reverse() });
    assert.equal(a.ok, b.ok);
    assert.equal(a.requiereTrm, b.requiereTrm);
    assert.equal(a.trm, b.trm);
    assert.deepEqual([...a.componentesUsd].sort(), [...b.componentesUsd].sort());
  });
});
