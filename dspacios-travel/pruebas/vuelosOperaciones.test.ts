// Funciones puras de las operaciones de inventario de Vuelos (tareas 2 y 3):
//  - lib/vuelos/operaciones.ts: modo de mover, identificador de operación,
//    traducción de errores de la base y matriz DIR-1 para la interfaz.
//  - lib/vuelos/historial.ts: dos cifras distintas (cupos activos vs
//    movimientos históricos) y el texto del historial.
//  - lib/vuelos/stats.ts: conteo de movimientos por record.
// La autoridad está en la base (migración 194); esto solo evita llamadas
// inútiles y presenta los datos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  esModoMover, esOperacionId, esIdPositivo, mensajeErrorRpc, transicionesManuales, esEstadoManual, nuevaOperacionId,
} from "../lib/vuelos/operaciones.ts";
import { agruparHistorial, describirEntrada, esSillaActiva, type MovimientoFila } from "../lib/vuelos/historial.ts";
import { movimientosPorBloqueo } from "../lib/vuelos/stats.ts";

describe("modo de mover y operación", () => {
  test("solo los dos modos exactos; nada por defecto", () => {
    assert.equal(esModoMover("solo_datos"), true);
    assert.equal(esModoMover("con_cupo"), true);
    for (const v of [undefined, null, "", "SOLO_DATOS", "auto", "datos", 1, {}]) assert.equal(esModoMover(v), false, String(v));
  });
  test("identificador de operación: uuid", () => {
    assert.equal(esOperacionId(nuevaOperacionId()), true);
    assert.notEqual(nuevaOperacionId(), nuevaOperacionId());
    for (const v of ["", "123", "6f1c1f8e-2b0a-4c1e-9d2a-0b1c2d3e4f5", null, undefined, 42]) assert.equal(esOperacionId(v), false, String(v));
  });
  test("ids positivos enteros", () => {
    assert.equal(esIdPositivo(3), true);
    for (const v of [0, -1, 1.5, NaN, "3", null]) assert.equal(esIdPositivo(v), false, String(v));
  });
});

describe("errores de la base", () => {
  test("lock timeout → reintentar, sin afirmar que se aplicó", () => {
    const m = mensajeErrorRpc({ code: "55P03", message: "canceling statement due to lock timeout" });
    assert.match(m.error, /No se aplicó nada/);
    assert.equal(m.tarifaDistinta, false);
  });
  test("deadlock y función inexistente", () => {
    assert.match(mensajeErrorRpc({ code: "40P01", message: "deadlock detected" }).error, /no se aplicó/);
    assert.match(mensajeErrorRpc({ code: "PGRST202", message: "x" }).error, /migración de base de datos \(194 a 197\)/);
    assert.match(mensajeErrorRpc({ code: "42883", message: "function public.mover_pasajero does not exist" }).error, /migración de base de datos \(194 a 197\)/);
  });
  test("tarifa distinta: se marca y se quita el prefijo técnico", () => {
    const m = mensajeErrorRpc({ code: "P0001", message: "TARIFA_DISTINTA: La tarifa neta del record destino es distinta." });
    assert.deepEqual(m, { error: "La tarifa neta del record destino es distinta.", tarifaDistinta: true });
  });
  test("mensaje de negocio tal cual; vacío → genérico", () => {
    assert.equal(mensajeErrorRpc({ message: "Sin permiso sobre el contrato de esta silla." }).error, "Sin permiso sobre el contrato de esta silla.");
    assert.equal(mensajeErrorRpc(null).error, "No se pudo completar la operación.");
  });
});

describe("matriz DIR-1 (interfaz; la base la vuelve a validar)", () => {
  const valores = (e: string) => transicionesManuales(e).map((o) => o.value);
  test("Disponible (y cambio_entrante) → No vendida o Devuelta", () => {
    assert.deepEqual(valores("disponible"), ["no_vendida", "devuelta"]);
    assert.deepEqual(valores("cambio_entrante"), ["no_vendida", "devuelta"]);
    assert.ok(transicionesManuales("disponible").every((o) => !o.requiereDevolucionReal));
  });
  test("No vendida → Disponible, o Devuelta SOLO con devolución real", () => {
    assert.deepEqual(transicionesManuales("no_vendida"), [
      { value: "disponible", label: "Disponible", requiereDevolucionReal: false },
      { value: "devuelta", label: "Devuelta", requiereDevolucionReal: true },
    ]);
  });
  test("Devuelta es definitiva; en plazo, confirmada, cambio y retirada no tienen cambio manual", () => {
    for (const e of ["devuelta", "en_plazo", "confirmada", "cambio", "retirada"]) assert.deepEqual(valores(e), [], e);
  });
  test("solo tres estados son manuales", () => {
    assert.deepEqual(["disponible", "no_vendida", "devuelta", "confirmada", "en_plazo", "retirada"].map(esEstadoManual),
      [true, true, true, false, false, false]);
  });
});

describe("dos cifras: cupos activos y movimientos históricos", () => {
  test("cambio y retirada son historial, no cupos", () => {
    assert.deepEqual(["disponible", "cambio_entrante", "en_plazo", "confirmada", "devuelta", "no_vendida", "cambio", "retirada", null]
      .map(esSillaActiva), [true, true, true, true, true, true, false, false, false]);
  });

  // Ejemplo del diseño: Y (id 1) tenía 10, X (id 2) tenía 6; se trasladan 2 de Y a X.
  const base = { motivo: null, registrado_por: "Javier", contrato_manual: null };
  const filas: MovimientoFila[] = [
    { ...base, id: 11, tipo: "traslado_cupo", operacion_id: "op-1", fecha_movimiento: "2026-09-30T10:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2,
      numero_silla_origen: 10, numero_silla_destino: 8, numero_contrato: null, cupos_origen_antes: 10, cupos_origen_despues: 8, cupos_destino_antes: 6, cupos_destino_despues: 8 },
    { ...base, id: 12, tipo: "traslado_cupo", operacion_id: "op-1", fecha_movimiento: "2026-09-30T10:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2,
      numero_silla_origen: 9, numero_silla_destino: 7, numero_contrato: null, cupos_origen_antes: 10, cupos_origen_despues: 8, cupos_destino_antes: 6, cupos_destino_despues: 8 },
    { ...base, id: 13, tipo: "mover_datos", operacion_id: "op-2", fecha_movimiento: "2026-09-30T11:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2,
      numero_silla_origen: 3, numero_silla_destino: 5, numero_contrato: "DTM-0451" },
    { ...base, id: 14, tipo: "retiro_cupo", operacion_id: "op-3", fecha_movimiento: "2026-09-30T12:00:00Z", bloqueo_origen_id: 2, bloqueo_destino_id: null,
      numero_silla_origen: 4, cupos_origen_antes: 8, cupos_origen_despues: 7 },
    { ...base, id: 15, tipo: null, fecha_movimiento: "2026-01-01T00:00:00Z", bloqueo_origen_id: 3, bloqueo_destino_id: 1, motivo: "viejo" },
  ];

  test("el historial se agrupa por operación y conserva cupos antes/después", () => {
    const h = agruparHistorial(filas);
    assert.equal(h.length, 4);
    assert.deepEqual([h[0]!.tipo, h[0]!.sillas, h[0]!.numerosOrigen, h[0]!.numerosDestino, h[0]!.cuposOrigen, h[0]!.cuposDestino],
      ["traslado_cupo", 2, [9, 10], [7, 8], [10, 8], [6, 8]]);
    assert.deepEqual(h[1]!.contratos, ["DTM-0451"]);
    assert.equal(h[3]!.tipo, "legado", "filas anteriores a la 194 se muestran como legado");
  });

  test("el texto depende del record desde el que se mira", () => {
    const [tras, datos, retiro, legado] = agruparHistorial(filas);
    const rec = (id: number | null) => ({ 1: "Y", 2: "X", 3: "Z" } as Record<number, string>)[id ?? 0] ?? "—";
    assert.equal(describirEntrada(tras!, 1, rec), "Salieron 2 cupo(s) libre(s) hacia X");
    assert.equal(describirEntrada(tras!, 2, rec), "Entraron 2 cupo(s) libre(s) desde Y");
    assert.match(describirEntrada(datos!, 1, rec), /su silla quedó libre aquí.*DTM-0451/);
    assert.match(describirEntrada(datos!, 2, rec), /en un cupo libre de este record/);
    assert.equal(describirEntrada(retiro!, 2, rec), "Cupo retirado (1)");
    assert.equal(describirEntrada(legado!, 1, rec), "Entró desde Z (cambio Z → Y)");
  });

  test("movimientos por record: cuentan en origen y destino, nunca dos veces en el mismo", () => {
    const m = movimientosPorBloqueo(filas);
    assert.deepEqual(Object.fromEntries(m), { 1: 4, 2: 4, 3: 1 });
    assert.deepEqual(Object.fromEntries(movimientosPorBloqueo([{ bloqueo_origen_id: 5, bloqueo_destino_id: 5 }])), { 5: 1 });
    assert.equal(movimientosPorBloqueo(null).size, 0);
  });
});
