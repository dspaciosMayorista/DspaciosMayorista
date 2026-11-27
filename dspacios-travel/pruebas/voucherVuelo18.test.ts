// #18 — voucher de servicio aéreo: constructor puro + cableado. Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { construirVoucherVuelo, construirVouchersVuelo, tramosDeFila, esVoucherVuelo, NO_REGISTRADO, type FilaVueloBasica } from "../lib/voucher/vuelo.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const fila = (o: Partial<FilaVueloBasica>): FilaVueloBasica => ({
  id: 1, record: null, servicio_aereo: null, aerolinea: null, direccion: null, origen_codigo: null, origen_ciudad: null, destino_codigo: null, destino_ciudad: null, numero_vuelo: null, fecha_salida: null,
  hora_salida: null, hora_llegada: null, servicios: null, orden: 0, vuelo_ida: null, vuelo_regreso: null, hora_salida_ida: null, hora_llegada_ida: null,
  hora_salida_reg: null, hora_llegada_reg: null, fecha_regreso: null, ...o,
});
const base = { pasajeros: ["Ana Pérez", " ", "Luis Gómez"], titular: "Ana Pérez", nReserva: "DTM-0001", vendedor: "Asesora", emision: "2030-10-01" };

describe("construirVoucherVuelo", () => {
  test("sin tramos guardados no se emite un voucher vacío", () => {
    assert.equal(construirVoucherVuelo({ ...base, filas: [] }), null);
  });

  test("ida y regreso completos: un tramo por fila, horas HH:mm y nada que falte", () => {
    const v = construirVoucherVuelo({
      ...base, filas: [
        fila({ orden: 1, direccion: "regreso", aerolinea: "Aerolínea X", numero_vuelo: "XX2", origen_codigo: "CTG", destino_codigo: "BOG", fecha_salida: "2030-10-18", hora_salida: "18:40:00", hora_llegada: "20:10:00", servicios: "Maleta 23 kg" }),
        fila({ orden: 0, direccion: "ida", aerolinea: "Aerolínea X", numero_vuelo: "XX1", origen_codigo: "BOG", origen_ciudad: "Bogotá", destino_codigo: "CTG", fecha_salida: "2030-10-15", hora_salida: "06:05:00", hora_llegada: "07:30:00", servicios: "Maleta 23 kg" }),
      ],
    })!;
    assert.deepEqual(v.tramos.map((t) => t.tipo), ["Ida", "Regreso"], "se ordena por `orden`");
    assert.equal(v.tramos[0].horaSalida, "06:05");
    assert.equal(v.tramos[0].origen, "Bogotá (BOG)");
    assert.equal(v.tramos[1].numeroVuelo, "XX2");
    assert.deepEqual(v.datosFaltantes.filter((d) => d.startsWith("Tramo 2")), []);
    assert.deepEqual(v.pasajeros, ["Ana Pérez", "Luis Gómez"], "los nombres vacíos se descartan");
  });

  test("datos ausentes: «No registrado» explícito, listados y nunca inventados", () => {
    const v = construirVoucherVuelo({ ...base, filas: [fila({ direccion: "ida", origen_codigo: "BOG", destino_codigo: "CTG" })] })!;
    const t = v.tramos[0];
    for (const k of ["aerolinea", "numeroVuelo", "fecha", "horaSalida", "horaLlegada", "equipaje"] as const) assert.equal(t[k], NO_REGISTRADO, k);
    assert.equal(t.origen, "BOG");
    assert.ok(v.datosFaltantes.includes("Tramo 1 (ida): número de vuelo"));
    assert.ok(!JSON.stringify(v).includes("00:00"), "no se inventa una hora");
  });

  test("fila anterior a la 135 (ida+regreso juntos) se separa en dos tramos con origen/destino invertidos", () => {
    const f = fila({ aerolinea: "Vieja", origen_codigo: "MDE", destino_codigo: "CTG", fecha_salida: "2030-01-10", vuelo_ida: "AV10", hora_salida_ida: "08:00", hora_llegada_ida: "09:00", vuelo_regreso: "AV11", hora_salida_reg: "17:00", fecha_regreso: "2030-01-13" });
    const r = tramosDeFila(f);
    assert.deepEqual(r.map((x) => x.tramo.tipo), ["Ida", "Regreso"]);
    assert.equal(r[1].tramo.origen, "CTG");
    assert.equal(r[1].tramo.destino, "MDE");
    assert.equal(r[1].tramo.horaLlegada, NO_REGISTRADO, "el regreso sin hora de llegada no la inventa");
  });

  test("RC-2: editar SOLO la ida de una fila heredada (campos modernos llenos) conserva el regreso guardado; guardar sin cambios tampoco lo pierde", () => {
    const heredada = fila({ aerolinea: "Vieja", origen_codigo: "MDE", destino_codigo: "CTG", fecha_salida: "2030-01-10", vuelo_ida: "LG100", hora_salida_ida: "08:00", hora_llegada_ida: "09:00", vuelo_regreso: "LG200", hora_salida_reg: "17:00", hora_llegada_reg: "18:00", fecha_regreso: "2030-01-13" });
    const antes = tramosDeFila(heredada).map((x) => x.tramo.numeroVuelo);
    assert.deepEqual(antes, ["LG100", "LG200"]);
    // Lo que deja el editor operativo (RPC guardar_tramos_contrato): solo columnas modernas del tramo de ida; las heredadas no se tocan.
    const sinCambios = { ...heredada, direccion: null, numero_vuelo: null, hora_salida: null };
    assert.deepEqual(tramosDeFila(sinCambios).map((x) => x.tramo.numeroVuelo), ["LG100", "LG200"], "guardar sin cambios");
    const editada = { ...heredada, direccion: "ida", numero_vuelo: "LG111", hora_salida: "08:00", hora_llegada: "09:30" };
    const r = tramosDeFila(editada);
    assert.deepEqual(r.map((x) => x.tramo.numeroVuelo), ["LG111", "LG200"], "tras editar la ida el regreso heredado sigue en el itinerario");
    assert.deepEqual(r.map((x) => x.tramo.tipo), ["Ida", "Regreso"]);
    assert.equal(r[1].tramo.fecha, "2030-01-13"); assert.equal(r[1].tramo.horaSalida, "17:00"); assert.equal(r[1].tramo.origen, "CTG"); assert.equal(r[1].tramo.destino, "MDE");
    // Control negativo: una fila moderna normal (sin columnas heredadas) NO inventa regreso, y un regreso moderno propio no se duplica.
    assert.equal(tramosDeFila(fila({ direccion: "ida", numero_vuelo: "XX1", origen_codigo: "BOG", destino_codigo: "CTG" })).length, 1);
    assert.equal(tramosDeFila(fila({ direccion: "regreso", numero_vuelo: "XX2", origen_codigo: "CTG", destino_codigo: "BOG" })).length, 1);
  });

  test("RC-2: el voucher del servicio lista ida editada y regreso heredado en orden (mismo servicio, mismo conteo de tramos)", () => {
    const editada = fila({ id: 7, servicio_aereo: "s1", orden: 0, direccion: "ida", numero_vuelo: "LG111", origen_codigo: "MDE", destino_codigo: "CTG", fecha_salida: "2030-01-10", vuelo_regreso: "LG200", fecha_regreso: "2030-01-13", hora_salida_reg: "17:00" });
    const { servicios } = construirVouchersVuelo({ ...base, filas: [editada] });
    assert.equal(servicios.length, 1);
    assert.deepEqual(servicios[0].contenido.tramos.map((t) => t.numeroVuelo), ["LG111", "LG200"]);
    assert.deepEqual(servicios[0].tramos, [7], "la identidad del servicio y de la fila no cambia: el regreso es parte de la MISMA fila");
  });

  test("ADL-041: sin PNR guardado el contenido no trae el campo (y no se rotula «No registrado»); con PNR guardado lo lleva", () => {
    const v = construirVoucherVuelo({ ...base, filas: [fila({ direccion: "ida", numero_vuelo: "XX1" })] })!;
    assert.doesNotMatch(JSON.stringify(v), /record|pnr/i);
    assert.equal(construirVoucherVuelo({ ...base, filas: [fila({ direccion: "ida", numero_vuelo: "XX1", record: " abc123 " })] })!.tramos[0].pnr, "ABC123");
    assert.equal(esVoucherVuelo(v), true);
    assert.equal(esVoucherVuelo({ hotel: "x" }), false);
    assert.equal(esVoucherVuelo(null), false);
  });
});

describe("cableado del voucher de vuelo", () => {
  const acciones = leer("app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
  const generador = acciones.slice(acciones.indexOf("export async function generarVoucherVuelo"), acciones.indexOf("export async function actualizarVoucher"));

  test("lee la vista básica (que enmascara el record a quien no gestiona el contrato), nunca la tabla base", () => {
    assert.match(generador, /from\("contrato_vuelos_basica"\)\.select\("id, record, /);
    assert.doesNotMatch(generador, /from\("contrato_vuelos"\)/);
  });

  test("regenerar servicios ya no borra los vouchers de vuelo ni de hotel", () => {
    assert.match(acciones, /\.not\("tipo", "in", "\(hotel,vuelo\)"\)/);
    assert.doesNotMatch(acciones, /\.neq\("tipo", "hotel"\);/);
  });

  test("regenerar el de vuelo es UNA llamada atómica para TODOS los servicios (migración 338), que solo toca su propio tipo, y no se emite vacío", () => {
    assert.match(generador, /sb\.rpc\("guardar_vouchers_vuelo"/);
    assert.doesNotMatch(generador, /\.delete\(\)/);
    assert.match(generador, /if \(!servicios\.length\) return \{ ok: false/);
  });

  test("la página del token distingue el tipo, rotula «Voucher Vuelo» y decide el PNR con el pago (ADL-041)", () => {
    const p = leer("app/voucher/[token]/page.tsx");
    assert.match(p, /vuelo: "Voucher Vuelo"/);
    assert.match(p, /esVoucherVuelo\(cRaw\)/);
    assert.match(p, /vueloVisible\(cRaw, r\.modo, r\.voucher\.numero_contrato, contratoPagadoCompleto\)/);
    assert.doesNotMatch(p, /cRaw\.pnr|\.pnr\b/, "la página nunca lee el PNR por su cuenta: solo lo que devuelve vueloVisible");
  });
});
