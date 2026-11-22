// #107 / #101b — reglas puras: estado de "Seleccionar todos", mensajes de lote y agrupación del tarifario resultado.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { estadoSeleccionTodos, mensajeLote } from "../lib/paquetes/seleccionMasiva.ts";
import {
  agruparPorCategoriaVigenciaRegimen, etiquetaSalida, rangoFechas, vigenciaDe, type FilaDetalle,
} from "../lib/paquetes/tarifarioGrupos.ts";

test("estadoSeleccionTodos: vacío, parcial y completo", () => {
  assert.deepEqual(estadoSeleccionTodos(0, 0), { checked: false, indeterminate: false, siguiente: "seleccionar", etiqueta: "Seleccionar todos" });
  assert.deepEqual(estadoSeleccionTodos(3, 0), { checked: false, indeterminate: false, siguiente: "seleccionar", etiqueta: "Seleccionar todos" });
  assert.deepEqual(estadoSeleccionTodos(3, 2), { checked: false, indeterminate: true, siguiente: "seleccionar", etiqueta: "Seleccionar todos" });
  assert.deepEqual(estadoSeleccionTodos(3, 3), { checked: true, indeterminate: false, siguiente: "deseleccionar", etiqueta: "Deseleccionar todos" });
});

test("mensajeLote: éxito limpio, con omitidos, con aviso y error", () => {
  const v = { singular: "servicio", plural: "servicios", accion: "agregó" } as const;
  assert.deepEqual(mensajeLote({ ok: true, procesados: 1 }, v), { tono: "ok", texto: "Se agregó 1 servicio." });
  assert.deepEqual(mensajeLote({ ok: true, procesados: 4 }, v), { tono: "ok", texto: "Se agregó 4 servicios." });
  const parcial = mensajeLote({ ok: true, procesados: 2, omitidos: [{ id: 9, motivo: "El servicio #9 ya no existe." }] }, v);
  assert.equal(parcial.tono, "aviso");
  assert.match(parcial.texto, /Se agregó 2 servicios\. No se aplicó a 1 elemento: El servicio #9 ya no existe\./);
  const conAviso = mensajeLote({ ok: true, procesados: 2, aviso: "El tarifario no se pudo regenerar." }, { singular: "salida", plural: "salidas", accion: "vinculó" });
  assert.equal(conAviso.tono, "aviso");
  assert.match(conAviso.texto, /Se vinculó 2 salidas\. El tarifario no se pudo regenerar\./);
  assert.deepEqual(mensajeLote({ ok: false, error: "Falló." }, v), { tono: "error", texto: "Falló." });
});

test("rangoFechas: mismo mes, cruza mes, cruza año y sin regreso", () => {
  assert.equal(rangoFechas("2030-04-15", "2030-04-20"), "15 al 20 abr");
  assert.equal(rangoFechas("2030-03-28", "2030-04-02"), "28 mar al 2 abr");
  assert.equal(rangoFechas("2030-12-28", "2031-01-03"), "28 dic 2030 al 3 ene 2031");
  assert.equal(rangoFechas("2030-04-15", null), "15 abr 2030");
  assert.equal(rangoFechas(null, null), "");
});

test("etiquetaSalida: ruta + fechas, nunca solo la ruta", () => {
  assert.equal(etiquetaSalida({ modulo: "bloqueo", bloqueo_label: "MDE - CTG - MDE", fecha_ida: "2030-04-15", fecha_regreso: "2030-04-20" }), "MDE–CTG–MDE · 15 al 20 abr");
  // la salida dinámica ya trae su fecha en el label: no se duplica
  assert.equal(etiquetaSalida({ modulo: "dinamico", bloqueo_label: "MDE - CTG - MDE · 15/04/2030", fecha_ida: "2030-04-15", fecha_regreso: "2030-04-20" }), "MDE–CTG–MDE · 15 al 20 abr");
  assert.equal(etiquetaSalida({ modulo: "bloqueo", bloqueo_label: "MDE-CTG", fecha_ida: null, fecha_regreso: null }), "MDE–CTG · fechas no registradas");
});

const fila = (id: number, acom: string, pvp: number, extra: Partial<FilaDetalle> = {}): FilaDetalle => ({
  id, modulo: "bloqueo", hotel_nombre: "Hotel Uno", acomodacion: acom, precio_pvp: pvp, categoria: "ESTANDAR", regimen: "PC", noches: 5,
  base_comisionable: pvp - 100, impuesto: 100, bloqueo_label: "MDE - CTG - MDE", fecha_ida: "2030-04-15", fecha_regreso: "2030-04-20",
  bloqueo_id: 1, temporada_ganadora: "Alta", es_promocion: false, procedencia_mixta: false, moneda: "COP", ...extra,
});

test("vigenciaDe: temporada, promoción, mixta y sin dato", () => {
  assert.equal(vigenciaDe({ temporada_ganadora: "Alta", es_promocion: false, procedencia_mixta: false }), "Alta");
  assert.equal(vigenciaDe({ temporada_ganadora: "Black", es_promocion: true, procedencia_mixta: false }), "Promoción · Black");
  assert.equal(vigenciaDe({ temporada_ganadora: "Alta", es_promocion: false, procedencia_mixta: true }), "Tarifa mixta");
  assert.equal(vigenciaDe({ temporada_ganadora: null, es_promocion: null, procedencia_mixta: false }), "Vigencia no registrada");
});

test("agrupa por categoría × vigencia × régimen, no por salida; precio igual en todas las salidas = un solo bloque", () => {
  const filas = [
    fila(1, "doble", 2_000_000), fila(2, "sencilla", 3_000_000),
    fila(3, "doble", 2_000_000, { bloqueo_id: 2, fecha_ida: "2030-05-10", fecha_regreso: "2030-05-15" }),
    fila(4, "sencilla", 3_000_000, { bloqueo_id: 2, fecha_ida: "2030-05-10", fecha_regreso: "2030-05-15" }),
    fila(5, "doble", 1_500_000, { regimen: "SA" }),
    fila(6, "doble", 1_800_000, { temporada_ganadora: "Baja" }),
    { ...fila(7, "x", 1), modulo: "servicios" },
  ];
  const g = agruparPorCategoriaVigenciaRegimen(filas);
  assert.equal(g.length, 3);
  const base = g.find((x) => x.regimen === "PC" && x.vigencia === "Alta")!;
  assert.equal(base.dobleDesde, 2_000_000);
  assert.equal(base.nSalidas, 2);
  assert.equal(base.variaPorSalida, false);
  assert.equal(base.bloques.length, 1);
  assert.deepEqual(base.bloques[0].lineas.map((l) => l.acomodacion), ["sencilla", "doble"]);
  assert.equal(g.find((x) => x.regimen === "SA")!.dobleDesde, 1_500_000);
});

test("si el precio cambia por salida: bloques separados, cada uno con ruta y fechas de sus salidas", () => {
  const filas = [
    fila(1, "doble", 2_000_000),
    fila(2, "doble", 2_400_000, { bloqueo_id: 2, fecha_ida: "2030-05-10", fecha_regreso: "2030-05-15" }),
    fila(3, "doble", 2_400_000, { bloqueo_id: 3, fecha_ida: "2030-06-01", fecha_regreso: "2030-06-06" }),
  ];
  const [g] = agruparPorCategoriaVigenciaRegimen(filas);
  assert.equal(g.variaPorSalida, true);
  assert.equal(g.dobleDesde, 2_000_000);
  assert.deepEqual(g.bloques.map((b) => b.salidas), [
    ["MDE–CTG–MDE · 15 al 20 abr"],
    ["MDE–CTG–MDE · 10 al 15 may", "MDE–CTG–MDE · 1 al 6 jun"],
  ]);
});

// #126-C — un grupo base que solo conserva la tarifa de infante no debe parecer una oferta de adulto vacía.
test("grupo base solo de infante junto a su promoción: soloInfante y promoRelacionada, sin borrar filas ni cambiar precios", () => {
  const fila = (id: number, acomodacion: string, pvp: number, temporada: string, promo: boolean): FilaDetalle => ({
    id, modulo: "porcion_terrestre", hotel_nombre: "Dubai", acomodacion, precio_pvp: pvp, categoria: "Estándar", regimen: "FULL", noches: 3,
    base_comisionable: pvp, impuesto: 0, bloqueo_label: null, fecha_ida: "2030-06-10", fecha_regreso: "2030-06-13",
    temporada_ganadora: temporada, es_promocion: promo, procedencia_mixta: false, moneda: "COP",
  });
  const filas = [
    fila(1, "doble", 900_000, "PRE BF", true), fila(2, "sencilla", 1_200_000, "PRE BF", true), fila(3, "nino", 450_000, "PRE BF", true),
    fila(4, "infante", 88_000, "BASE A", false),
  ];
  const grupos = agruparPorCategoriaVigenciaRegimen(filas);
  assert.equal(grupos.length, 2);
  const base = grupos.find((g) => g.vigencia === "BASE A")!;
  const promo = grupos.find((g) => g.vigencia === "Promoción · PRE BF")!;
  assert.equal(base.soloInfante, true);
  assert.equal(base.dobleDesde, null);
  assert.equal(base.promoRelacionada, "Promoción · PRE BF");
  assert.equal(base.nFilas, 1);
  assert.equal(base.bloques[0].lineas[0].pvp, 88_000);       // la tarifa base del infante se conserva intacta
  assert.equal(promo.soloInfante, false);
  assert.equal(promo.dobleDesde, 900_000);
  assert.equal(promo.promoRelacionada, null);
});

test("#126-C: un grupo sin doble que NO es solo de infante, o un infante sin promoción hermana, no se confunde", () => {
  const f = (id: number, acomodacion: string, promo: boolean, regimen = "FULL"): FilaDetalle => ({
    id, modulo: "porcion_terrestre", hotel_nombre: "H", acomodacion, precio_pvp: 100, categoria: "A", regimen, noches: 3, base_comisionable: 100, impuesto: 0,
    bloqueo_label: null, temporada_ganadora: "BASE A", es_promocion: promo, procedencia_mixta: false,
  });
  const soloNino = agruparPorCategoriaVigenciaRegimen([f(1, "nino", false)]);
  assert.equal(soloNino[0].soloInfante, false);                         // "Sin tarifa doble" sigue aplicando
  const infanteSolo = agruparPorCategoriaVigenciaRegimen([f(2, "infante", false), f(3, "doble", true, "PAM")]);
  const g = infanteSolo.find((x) => x.regimen === "FULL")!;
  assert.equal(g.soloInfante, true);
  assert.equal(g.promoRelacionada, null);                               // la promoción es de OTRO régimen: no se enlaza
  const mixto = agruparPorCategoriaVigenciaRegimen([f(4, "infante", false), f(5, "nino", false)]);
  assert.equal(mixto[0].soloInfante, false);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #126-C · F4 (Codex ronda 3): el grupo solo-infante solo apunta a una promoción cuando las FILAS establecen que ahí están los adultos de SUS estadías.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("#126-C F4 · promoRelacionada solo cuando las filas lo establecen", () => {
  type Over = Partial<FilaDetalle>;
  let n = 0;
  const f = (acom: string, temporada: string, promo: boolean, over: Over = {}): FilaDetalle => ({
    id: ++n, modulo: "porcion_terrestre", hotel_nombre: "Dubai", acomodacion: acom, precio_pvp: acom === "infante" ? 88_000 : 900_000, categoria: "Estándar", regimen: "FULL", noches: 3,
    base_comisionable: 100, impuesto: 0, bloqueo_label: null, fecha_ida: "2030-06-10", fecha_regreso: "2030-06-13",
    temporada_ganadora: temporada, es_promocion: promo, procedencia_mixta: false, moneda: "COP", ...over,
  });
  const baseInfante = (over: Over = {}) => f("infante", "BASE ENERO", false, over);
  const relacion = (filas: FilaDetalle[]) => agruparPorCategoriaVigenciaRegimen(filas).find((g) => g.vigencia === "BASE ENERO")!;

  test("fechas DISJUNTAS: la promoción de otras fechas NO se enlaza (el caso que Codex reprodujo: enero vs diciembre)", () => {
    const filas = [
      baseInfante({ fecha_ida: "2030-01-01", fecha_regreso: "2030-01-03" }),
      f("doble", "PROMO DICIEMBRE", true, { fecha_ida: "2030-12-01", fecha_regreso: "2030-12-03" }),
    ];
    const g = relacion(filas);
    assert.equal(g.soloInfante, true);
    assert.equal(g.promoRelacionada, null);
  });

  test("OTRA SALIDA (bloqueo / salida distinta) con las mismas fechas: no se enlaza", () => {
    const g = relacion([baseInfante({ bloqueo_id: 1, bloqueo_label: "MDE-CTG-MDE" }), f("doble", "PROMO A", true, { bloqueo_id: 2, bloqueo_label: "MDE-CTG-MDE" })]);
    assert.equal(g.promoRelacionada, null);
    const g2 = relacion([baseInfante({ salida_id: 10 }), f("doble", "PROMO A", true, { salida_id: 11 })]);
    assert.equal(g2.promoRelacionada, null);
  });

  test("VARIAS promociones candidatas con adultos en la misma estadía: ambiguo → neutral (no elige la primera)", () => {
    const filas = [baseInfante(), f("doble", "PROMO UNO", true), f("doble", "PROMO DOS", true)];
    assert.equal(relacion(filas).promoRelacionada, null);
    // el orden de las filas no cambia el resultado
    assert.equal(relacion([...filas].reverse()).promoRelacionada, null);
  });

  test("un grupo promocional SIN tarifas de adulto (solo niño/infante) no es candidato", () => {
    const g = relacion([baseInfante(), f("nino", "PROMO NIÑOS", true), f("infante", "PROMO NIÑOS", true)]);
    assert.equal(g.promoRelacionada, null);
    // y si además hay una promoción real con adultos en esa estadía, se enlaza la real, no la de niños
    const g2 = relacion([baseInfante(), f("nino", "PROMO NIÑOS", true), f("doble", "PROMO ADULTOS", true)]);
    assert.equal(g2.promoRelacionada, "Promoción · PROMO ADULTOS");
  });

  test("una única candidata que cubre solo PARTE de las estadías del grupo de infante: no se afirma el enlace", () => {
    const filas = [
      baseInfante({ fecha_ida: "2030-06-10", fecha_regreso: "2030-06-13" }),
      baseInfante({ fecha_ida: "2030-07-10", fecha_regreso: "2030-07-13" }),
      f("doble", "PROMO JUNIO", true, { fecha_ida: "2030-06-10", fecha_regreso: "2030-06-13" }),
    ];
    assert.equal(relacion(filas).promoRelacionada, null);
  });

  test("dos candidatas que se reparten las estadías: ninguna cubre todas → neutral", () => {
    const filas = [
      baseInfante({ fecha_ida: "2030-06-10", fecha_regreso: "2030-06-13" }), baseInfante({ fecha_ida: "2030-07-10", fecha_regreso: "2030-07-13" }),
      f("doble", "PROMO JUNIO", true, { fecha_ida: "2030-06-10", fecha_regreso: "2030-06-13" }), f("doble", "PROMO JULIO", true, { fecha_ida: "2030-07-10", fecha_regreso: "2030-07-13" }),
    ];
    assert.equal(relacion(filas).promoRelacionada, null);
  });

  test("filas SIN identidad de estadía (sin salida y sin fechas): no se puede afirmar nada", () => {
    const g = relacion([baseInfante({ fecha_ida: null, fecha_regreso: null }), f("doble", "PROMO A", true, { fecha_ida: null, fecha_regreso: null })]);
    assert.equal(g.soloInfante, true);
    assert.equal(g.promoRelacionada, null);
  });

  test("caso aceptado: misma estadía (fechas, noches) → se enlaza la promoción; con salida/bloqueo iguales también; otra noches no", () => {
    assert.equal(relacion([baseInfante(), f("doble", "PRE BF", true), f("sencilla", "PRE BF", true)]).promoRelacionada, "Promoción · PRE BF");
    assert.equal(relacion([baseInfante({ bloqueo_id: 3 }), f("doble", "PRE BF", true, { bloqueo_id: 3 })]).promoRelacionada, "Promoción · PRE BF");
    assert.equal(relacion([baseInfante({ salida_id: 7 }), f("doble", "PRE BF", true, { salida_id: 7 })]).promoRelacionada, "Promoción · PRE BF");
    assert.equal(relacion([baseInfante({ noches: 3 }), f("doble", "PRE BF", true, { noches: 4 })]).promoRelacionada, null);
  });

  test("varias salidas todas cubiertas por UNA promoción: se enlaza; otra categoría/régimen nunca", () => {
    const salidas = [{ fecha_ida: "2030-06-10", fecha_regreso: "2030-06-13" }, { fecha_ida: "2030-07-10", fecha_regreso: "2030-07-13" }];
    const filas = [...salidas.map((s) => baseInfante(s)), ...salidas.map((s) => f("doble", "PRE BF", true, s))];
    assert.equal(relacion(filas).promoRelacionada, "Promoción · PRE BF");
    assert.equal(relacion([baseInfante(), f("doble", "PRE BF", true, { categoria: "Superior" })]).promoRelacionada, null);
    assert.equal(relacion([baseInfante(), f("doble", "PRE BF", true, { regimen: "PAM" })]).promoRelacionada, null);
  });

  test("las filas y los precios se conservan intactos en todos los casos (nada se borra ni se reescribe)", () => {
    const filas = [baseInfante({ fecha_ida: "2030-01-01", fecha_regreso: "2030-01-03" }), f("doble", "PROMO DICIEMBRE", true, { fecha_ida: "2030-12-01", fecha_regreso: "2030-12-03" })];
    const antes = JSON.stringify(filas);
    const grupos = agruparPorCategoriaVigenciaRegimen(filas);
    assert.equal(JSON.stringify(filas), antes, "la entrada no se muta");
    assert.equal(grupos.reduce((s, g) => s + g.nFilas, 0), 2);
    assert.equal(relacion(filas).bloques[0].lineas[0].pvp, 88_000);
    assert.equal(grupos.find((g) => g.esPromocion)!.dobleDesde, 900_000);
  });
});
