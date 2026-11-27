// #13 — Avisos de fin de vigencia de compra: reglas puras con expectativas calculadas a mano (hoy = 2026-11-25 en Bogotá).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hoyBogota } from "../lib/cotizacion/vigencia.ts";
import {
  avisosEmpaquetados, avisosPaquetes, avisosPaquetesTotales, avisosSalidas, diasEntre, esFuenteCompra, estadoCompra, etiquetaDias, normalizarDias, ordenarAvisos, rutaVentana, ventanaAviso,
} from "../lib/paquetes/vencimientoCompra.ts";

const HOY = "2026-11-25";

describe("#13 fechas y estados (America/Bogota)", () => {
  test("diasEntre cruza mes, año y bisiesto sin zona horaria", () => {
    assert.equal(diasEntre("2026-11-25", "2026-11-28"), 3);
    assert.equal(diasEntre("2026-11-28", "2026-12-02"), 4);
    assert.equal(diasEntre("2026-12-30", "2027-01-02"), 3);
    assert.equal(diasEntre("2028-02-28", "2028-03-01"), 2);
    assert.equal(diasEntre("2026-11-25", "2026-11-24"), -1);
    assert.equal(diasEntre("2026-02-30", "2026-03-01"), null, "fecha inexistente = inválida");
  });
  test("la fecha de negocio es la de Bogotá, no la UTC: a las 21:30 de Bogotá el servidor ya está en el día siguiente", () => {
    assert.equal(hoyBogota(new Date("2026-11-26T02:30:00Z")), "2026-11-25");
    assert.equal(hoyBogota(new Date("2026-11-25T04:59:00Z")), "2026-11-24");
    assert.equal(hoyBogota(new Date("2026-11-25T05:00:00Z")), "2026-11-25");
    // A esa hora un fin de compra «2026-11-25» sigue siendo HOY (la compra aún es válida), no «vencido» como diría la fecha UTC (26).
    assert.equal(estadoCompra(hoyBogota(new Date("2026-11-26T02:30:00Z")), "2026-11-25", 5), "vence_hoy");
  });
  test("estadoCompra: vencida / hoy / por vencer (límite inclusive) / vigente / sin fecha", () => {
    assert.equal(estadoCompra(HOY, "2026-11-24", 5), "vencida");
    assert.equal(estadoCompra(HOY, "2026-11-25", 5), "vence_hoy");
    assert.equal(estadoCompra(HOY, "2026-11-30", 5), "por_vencer", "hoy + 5 está dentro");
    assert.equal(estadoCompra(HOY, "2026-12-01", 5), "vigente", "hoy + 6 queda fuera");
    assert.equal(estadoCompra(HOY, null, 5), "sin_fecha");
    assert.equal(estadoCompra(HOY, "2026-02-30", 5), "sin_fecha", "nunca se infiere vigente ni vencida con un dato inválido");
  });
  test("normalizarDias: ausente = 5 (no 0), entero ≥ 0, tope 365", () => {
    assert.equal(normalizarDias(null), 5); assert.equal(normalizarDias(undefined), 5); assert.equal(normalizarDias(""), 5);
    assert.equal(normalizarDias(0), 0); assert.equal(normalizarDias("7"), 7); assert.equal(normalizarDias(-1), 5); assert.equal(normalizarDias(2.5), 5); assert.equal(normalizarDias(900), 365);
  });
  test("ventanaAviso y etiquetaDias", () => {
    assert.deepEqual(ventanaAviso(HOY, 5), { desde: "2026-11-25", hasta: "2026-11-30" });
    assert.deepEqual(ventanaAviso("2026-12-29", 5), { desde: "2026-12-29", hasta: "2027-01-03" });
    assert.deepEqual([etiquetaDias(0), etiquetaDias(1), etiquetaDias(3)], ["Vence hoy", "Vence mañana", "Vence en 3 días"]);
  });
});

describe("#13 qué se avisa en cada variante", () => {
  test("paquete: solo activos con fin de compra dentro de [hoy, hoy+días]; vencidos, lejanos y sin fecha no avisan", () => {
    const filas = [
      { id: 1, nombre: "Cartagena 4N", activo: true, fecha_compra_fin: "2026-11-27" },
      { id: 2, nombre: "Inactivo", activo: false, fecha_compra_fin: "2026-11-27" },
      { id: 3, nombre: "Vencido", activo: true, fecha_compra_fin: "2026-11-24" },
      { id: 4, nombre: "Lejano", activo: true, fecha_compra_fin: "2026-12-10" },
      { id: 5, nombre: "Sin fecha", activo: true, fecha_compra_fin: null },
      { id: 6, nombre: "Hoy", activo: true, fecha_compra_fin: "2026-11-25" },
      { id: 7, nombre: "Límite", activo: true, fecha_compra_fin: "2026-11-30" },
    ];
    const r = ordenarAvisos(avisosPaquetes(filas, HOY, 5));
    assert.deepEqual(r.map((a) => [a.clave, a.dias]), [["paquete:6", 0], ["paquete:1", 2], ["paquete:7", 5]]);
    assert.equal(r[1].ruta, "/dashboard/paquetes/1?tab=config");
  });
  test("salida dinámica: exige salida activa Y paquete activo; el enlace va a la pestaña Vuelos del paquete", () => {
    const base = { paquete_id: 9, fecha_ida: "2027-01-10", fecha_regreso: "2027-01-14" };
    const r = avisosSalidas([
      { id: 1, ...base, activo: true, compra_fin: "2026-11-26", paquete: { nombre: "Miami dinámico", activo: true } },
      { id: 2, ...base, activo: false, compra_fin: "2026-11-26", paquete: { nombre: "Miami dinámico", activo: true } },
      { id: 3, ...base, activo: true, compra_fin: "2026-11-26", paquete: { nombre: "Miami dinámico", activo: false } },
      { id: 4, ...base, activo: true, compra_fin: "2026-11-26", paquete: null },
    ], HOY, 5);
    assert.deepEqual(r.map((a) => a.clave), ["salida_dinamica:1"]);
    assert.equal(r[0].ruta, "/dashboard/paquetes/9?tab=vuelos");
    assert.match(r[0].detalle, /2027-01-10 → 2027-01-14/);
  });
  test("empaquetado: solo si está vinculado a algún paquete ACTIVO; el aviso nombra (sin repetir y en orden) a esos paquetes y enlaza al empaquetado", () => {
    const r = avisosEmpaquetados([
      { id: 5, activo: true, compra_fin: "2026-11-29", ruta: "MDE - CTG - MDE", fecha_ida: "2027-02-01", paquetes: [{ id: 2, nombre: "Zeta", activo: true }, { id: 1, nombre: "Alfa", activo: true }, { id: 3, nombre: "Alfa", activo: true }, { id: 4, nombre: "Apagado", activo: false }] },
      { id: 6, activo: true, compra_fin: "2026-11-29", ruta: "BOG - MIA", fecha_ida: "2027-02-01", paquetes: [] },
      { id: 7, activo: true, compra_fin: "2026-11-29", ruta: "BOG - MIA", fecha_ida: "2027-02-01", paquetes: [{ id: 4, nombre: "Apagado", activo: false }] },
      { id: 8, activo: false, compra_fin: "2026-11-29", ruta: "X", fecha_ida: "2027-02-01", paquetes: [{ id: 1, nombre: "Alfa", activo: true }] },
    ], HOY, 5);
    assert.deepEqual(r.map((a) => a.clave), ["empaquetado:5"]);
    assert.match(r[0].detalle, /paquetes: Alfa, Zeta$/);
    assert.equal(r[0].ruta, "/dashboard/vuelos/empaquetados/5");
  });
  test("paquete dinámico total: solo activo Y publicado (un borrador no se vende, no hay nada que avisar)", () => {
    const r = avisosPaquetesTotales([
      { id: 1, nombre: "Total A", activo: true, publicado: true, compra_fin: "2026-11-26" },
      { id: 2, nombre: "Total B", activo: true, publicado: false, compra_fin: "2026-11-26" },
      { id: 3, nombre: "Total C", activo: false, publicado: true, compra_fin: "2026-11-26" },
    ], HOY, 5);
    assert.deepEqual(r.map((a) => [a.clave, a.ruta]), [["paquete_total:1", "/dashboard/paquetes/total/1"]]);
  });
  test("orden determinista: por fecha, luego nombre, luego clave", () => {
    const a = (clave: string, nombre: string, dias: number) => ({ fuente: "paquete" as const, clave, nombre, detalle: "", compraFin: "", dias, ruta: "" });
    assert.deepEqual(ordenarAvisos([a("c", "B", 2), a("a", "B", 1), a("b", "A", 2)]).map((x) => x.clave), ["a", "b", "c"]);
  });
});

describe("#13 rutas de cada ventana (una sola fuente para el panel y la campana global)", () => {
  test("cada fuente enlaza a la pantalla donde se corrige ESA vigencia", () => {
    assert.equal(rutaVentana("paquete", 7), "/dashboard/paquetes/7?tab=config");
    assert.equal(rutaVentana("salida_dinamica", 7), "/dashboard/paquetes/7?tab=vuelos");
    assert.equal(rutaVentana("empaquetado", 9), "/dashboard/vuelos/empaquetados/9");
    assert.equal(rutaVentana("paquete_total", 3), "/dashboard/paquetes/total/3");
  });
  test("esFuenteCompra solo acepta las cuatro fuentes reales", () => {
    for (const ok of ["paquete", "salida_dinamica", "empaquetado", "paquete_total"]) assert.equal(esFuenteCompra(ok), true);
    for (const mal of ["", "otra", null, undefined, 3]) assert.equal(esFuenteCompra(mal), false);
  });
});
