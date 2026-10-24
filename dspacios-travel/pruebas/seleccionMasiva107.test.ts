// #107 / #101b — reglas puras: estado de "Seleccionar todos", mensajes de lote y agrupación del tarifario resultado.
import { test } from "node:test";
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
