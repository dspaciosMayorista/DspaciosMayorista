import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combinarHoras, horarioCambio, horasDelRecorrido } from "../lib/reservar/horasRecorrido.ts";
import { construirContextoServicios, calcularResultadoServicio, resolverLiquidacionServicioPuntual, separarFranjas, type FilaTemporadaConFranjas } from "../lib/reservar/liquidacionServicio.ts";

// Cliente falso mínimo: from(t).select().eq("id", n).maybeSingle() sobre filas en memoria.
function adminFalso(tablas: Record<string, Record<string, unknown>[]>, fallar = false) {
  return {
    from(tabla: string) {
      return {
        select() {
          return { eq(_c: string, id: number) { return { maybeSingle: async () => (fallar ? { data: null, error: { message: "boom" } } : { data: (tablas[tabla] ?? []).find((f) => f.id === id) ?? null, error: null }) }; } };
        },
      };
    },
  } as never;
}

describe("horas del recorrido (de dónde sale la hora de llegada/salida)", () => {
  const tablas = {
    bloqueos_vuelo: [{ id: 1, hora_llegada_ida: "21:35:00", hora_salida_reg: "05:10:00" }, { id: 2, hora_llegada_ida: null, hora_salida_reg: "no sé" }],
    salidas_dinamicas: [{ id: 9, hora_llegada_ida: "7:05 pm", hora_salida_reg: "" }],
  };
  test("bloqueo: llegada del vuelo de ida y salida del vuelo de regreso, normalizadas a HH:MM", async () => {
    assert.deepEqual(await horasDelRecorrido(adminFalso(tablas), { modulo: "bloqueo", bloqueoId: 1 }), { ok: true, horas: { llegada: "21:35", salida: "05:10" } });
  });
  test("hora vacía o ilegible = sin hora (no se supone ninguna)", async () => {
    assert.deepEqual(await horasDelRecorrido(adminFalso(tablas), { modulo: "bloqueo", bloqueoId: 2 }), { ok: true, horas: {} });
  });
  test("salida dinámica", async () => {
    assert.deepEqual(await horasDelRecorrido(adminFalso(tablas), { modulo: "dinamico", bloqueoId: null, salidaId: 9 }), { ok: true, horas: { llegada: "19:05" } });
  });
  test("porción terrestre no guarda horas", async () => {
    assert.deepEqual(await horasDelRecorrido(adminFalso(tablas), { modulo: "porcion_terrestre", bloqueoId: null }), { ok: true, horas: {} });
  });
  test("un error de lectura se devuelve (no se traga como «sin hora»)", async () => {
    const r = await horasDelRecorrido(adminFalso(tablas, true), { modulo: "bloqueo", bloqueoId: 1 });
    assert.equal(r.ok, false);
  });
  test("las horas del vuelo (servidor) mandan sobre las del navegador; la capturada solo completa", () => {
    assert.deepEqual(combinarHoras({ llegada: "10:00", salida: "12:00" }, { llegada: "21:35" }), { llegada: "21:35", salida: "12:00" });
    assert.deepEqual(combinarHoras(undefined, {}), {});
  });
});

describe("el horario cambió después de cotizar", () => {
  test("detecta el tramo que cambió, incluso si ahora no hay hora", () => {
    assert.deepEqual(horarioCambio({ llegada: "21:00", salida: "10:00" }, { llegada: "21:00", salida: "04:00" }, ["llegada", "salida"]), ["salida"]);
    assert.deepEqual(horarioCambio({ llegada: "21:00" }, {}, ["llegada"]), ["llegada"]);
    assert.deepEqual(horarioCambio({ llegada: "21:00" }, { llegada: "21:00" }, ["llegada"]), []);
  });
  test("cambio de horario que cruza la franja cambia el precio => la conversión debe pedir recotizar", () => {
    const filas: FilaTemporadaConFranjas[] = [{
      id: 7, servicio_id: 1, nombre: "V", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", precio_persona: null,
      servicio_suplementos_franja: [{ id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "llegada", tipo: "monto", valor: 40_000, cobro: "grupo" }],
    }];
    const { temporadas, franjas } = separarFranjas(filas);
    const ctx = construirContextoServicios({
      paquetes: [{ id: 10, pct_mk: 0.2 }], armado: [{ paquete_id: 10, servicio_id: 1, modo: "grupo" }],
      servicios: [{ id: 1, precio_persona: null, recargo_individual: null, liquidacion: null, moneda: "COP" }],
      grupos: [{ servicio_id: 1, pax_desde: 1, pax_hasta: 8, precio: 300_000, temporada: "V" }], temporadas, franjas,
    });
    const par = { servicioId: 1, paqueteId: 10, nombre: "T", destino: null, descripcion: null };
    const fecha = new Date("2026-06-10T00:00:00");
    const cotizado = calcularResultadoServicio(par, ctx, fecha, 2, 3, { llegada: "14:00" });
    const tras = calcularResultadoServicio(par, ctx, fecha, 2, 3, { llegada: "22:30" });
    assert.ok(cotizado && tras);
    assert.ok(tras.total > cotizado.total, "el vuelo pasó a llegar de noche: el suplemento sube el precio");
    assert.deepEqual(horarioCambio(cotizado.horasCotizadas, { llegada: "22:30" }, ["llegada"]), ["llegada"]);
  });
});

describe("paridad publicado / cotizado / contratado (mismas horas)", () => {
  test("la búsqueda y el checkout (puntual) dan el MISMO total y los mismos suplementos", () => {
    const filas: FilaTemporadaConFranjas[] = [{
      id: 7, servicio_id: 1, nombre: "V", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", precio_persona: 90_000, recargo_individual: 10_000,
      servicio_suplementos_franja: [{ id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "porcentaje", valor: 15, cobro: "grupo" }],
    }];
    const sep = separarFranjas(filas);
    const servicios = [{ id: 1, precio_persona: null, recargo_individual: null, liquidacion: null, moneda: "COP" }];
    const par = { servicioId: 1, paqueteId: 10, nombre: "T", destino: null, descripcion: null };
    const fecha = new Date("2026-06-10T00:00:00");
    const horas = { llegada: "23:00", salida: "06:00" }; // salida a las 06:00 NO entra (fin excluido)
    const ctx = construirContextoServicios({ paquetes: [{ id: 10, pct_mk: 0.25 }], armado: [{ paquete_id: 10, servicio_id: 1, modo: "persona" }], servicios, grupos: [], ...sep });
    const busqueda = calcularResultadoServicio(par, ctx, fecha, 2, 4, horas);
    const puntual = resolverLiquidacionServicioPuntual({
      par, fechaIdaDate: fecha, numNoches: 2, pax: 4, filaTarifarioEncontrada: true, filaTarifarioError: null,
      paquete: { id: 10, pct_mk: 0.25 }, paqueteError: null, armado: { paquete_id: 10, servicio_id: 1, modo: "persona" }, armadoError: null,
      servicio: servicios[0], servicioError: null, grupos: [], gruposError: null, ...sep, temporadasError: null, horas,
    });
    assert.ok(busqueda && puntual.ok);
    assert.deepEqual(puntual.ok && puntual.resultado, busqueda);
    assert.deepEqual(busqueda.suplementos, [{ tramo: "llegada", hora: "23:00" }]);
    // 90.000 × 4 = 360.000 de base; 15 % = 54.000 de suplemento (solo la llegada); neto 414.000; margen 25 % => 552.000.
    assert.equal(busqueda.total, 552_000);
  });
});

describe("cableado: cotización y conversión usan las mismas funciones", () => {
  const checkout = readFileSync(new URL("../app/tarifario/checkout/actions.ts", import.meta.url), "utf8");
  const reservar = readFileSync(new URL("../app/(dashboard)/dashboard/reservar/actions.ts", import.meta.url), "utf8");
  const costos = readFileSync(new URL("../lib/reservar/costosObligacionesCarrito.ts", import.meta.url), "utf8");
  test("el checkout guarda las horas cotizadas en el payload del tour y deriva las del vuelo en el servidor", () => {
    assert.match(checkout, /horasDelRecorrido\(adminHoras/);
    assert.match(checkout, /horas: resultado\.resultado\.horasCotizadas/);
  });
  test("la conversión compara el horario ANTES de numerar y el costo/CxP se liquida con las horas vigentes", () => {
    const iCompara = reservar.indexOf("horarioCambio(t.horas, vigentes");
    const iNumera = reservar.indexOf("const idsServiciosObl = new Set<number>();");
    assert.ok(iCompara > -1 && iCompara < iNumera, "la comparación de horarios va antes de la revisión de obligaciones y de numerar");
    assert.match(reservar, /recotiza antes de generar el contrato/);
    assert.equal((reservar.match(/horas: horasVigentesTour\.get\(t\.__idx\)/g) ?? []).length, 2, "revisión previa y creación de CxP usan las mismas horas");
  });
  test("el costo/CxP usa la misma función que la venta (costoNetoServicio) y no la tarifa GENERAL", () => {
    assert.match(costos, /costoNetoServicio\(/);
    assert.doesNotMatch(costos, /\.eq\("temporada", "GENERAL"\)|GENERAL"\)/);
  });
});
