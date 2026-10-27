// PR #409 — blackouts con alcance («entrada» | «viaje»), rango del viaje con noches adicionales, validación de ambos extremos y estado del itinerario.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blackoutQueAplica, bloquea, mensajeBlackout, normalizarAlcance, rangoViaje, validarBlackoutsParaGuardar,
  type BlackoutPrograma, type BlackoutEntrada,
} from "../lib/programas/blackouts409.ts";
import { estadoItinerario, fechaRegresoEstancia } from "../lib/programas/estanciaHotel88.ts";

const b = (ini: string | null, fin: string | null, alcance?: string | null, motivo = "Feria"): BlackoutPrograma => ({ fecha_inicio: ini, fecha_fin: fin, alcance, motivo });

// ── Alcance «entrada» (el de siempre y el de TODO blackout existente) ──────────
test("entrada: inicio y fin son inclusivos; el día anterior y el posterior pasan", () => {
  const x = b("2027-03-05", "2027-03-10", "entrada");
  const viaje5 = (entrada: string) => bloquea(x, rangoViaje(entrada, 4));
  assert.equal(viaje5("2027-03-04"), false, "un día antes: aunque el viaje cruce el blackout, solo cuenta la ENTRADA");
  assert.equal(viaje5("2027-03-05"), true, "inicio inclusivo");
  assert.equal(viaje5("2027-03-07"), true, "dentro");
  assert.equal(viaje5("2027-03-10"), true, "fin inclusivo");
  assert.equal(viaje5("2027-03-11"), false, "un día después");
});

test("compatibilidad: un blackout cargado antes (alcance null/undefined/desconocido) se comporta como «entrada»", () => {
  for (const a of [null, undefined, "", "entrada", "otra-cosa"]) {
    assert.equal(normalizarAlcance(a), "entrada", String(a));
    assert.equal(bloquea(b("2027-03-05", "2027-03-10", a), rangoViaje("2027-03-01", 7)), false, `${a}: el viaje cruza pero la entrada está libre`);
    assert.equal(bloquea(b("2027-03-05", "2027-03-10", a), rangoViaje("2027-03-06", 7)), true, `${a}: la entrada cae dentro`);
  }
  assert.equal(normalizarAlcance("viaje"), "viaje");
});

test("una fila con un solo extremo no bloquea nada (como antes), y nunca lanza", () => {
  for (const f of [b("2027-03-05", null), b(null, "2027-03-10"), b(null, null)]) {
    assert.equal(bloquea(f, rangoViaje("2027-03-06", 3)), false);
    assert.equal(bloquea({ ...f, alcance: "viaje" }, rangoViaje("2027-03-06", 3)), false);
  }
});

// ── Alcance «viaje» ───────────────────────────────────────────────────────────
test("viaje: se bloquea si el blackout TOCA cualquier día entre la entrada y el regreso, ambos incluidos", () => {
  // Viaje: 01/03 → 08/03 (7 noches).
  const rango = rangoViaje("2027-03-01", 7);
  assert.deepEqual(rango, { desde: "2027-03-01", hasta: "2027-03-08" });
  const v = (ini: string, fin: string) => bloquea(b(ini, fin, "viaje"), rango);
  assert.equal(v("2027-02-20", "2027-02-28"), false, "termina el día anterior a la entrada");
  assert.equal(v("2027-02-25", "2027-03-01"), true, "termina el día de la entrada");
  assert.equal(v("2027-03-03", "2027-03-04"), true, "cae en medio del viaje");
  assert.equal(v("2027-02-01", "2027-04-01"), true, "envuelve todo el viaje");
  assert.equal(v("2027-03-08", "2027-03-12"), true, "empieza el día de regreso (inclusivo)");
  assert.equal(v("2027-03-09", "2027-03-12"), false, "empieza el día siguiente al regreso");
});

test("viaje con NOCHES ADICIONALES: el regreso se corre y el blackout posterior a la estancia incluida empieza a bloquear", () => {
  // Estancia incluida: 3 noches (01/03 → 04/03). Blackout solo el 06/03.
  const x = b("2027-03-06", "2027-03-06", "viaje");
  const regreso = (k: number) => fechaRegresoEstancia("2027-03-01", 3, k);
  const quePasa = (k: number) => bloquea(x, { desde: "2027-03-01", hasta: regreso(k) });
  assert.deepEqual([0, 1, 2, 3].map((k) => regreso(k)), ["2027-03-04", "2027-03-05", "2027-03-06", "2027-03-07"]);
  assert.deepEqual([0, 1, 2, 3].map(quePasa), [false, false, true, true], "con 2 noches extra el regreso (06/03) toca el blackout");
  // La misma cuenta que usan la reserva y la calculadora (`rangoViaje(entrada, incluidas + adicionales)`).
  assert.deepEqual([0, 1, 2, 3].map((k) => bloquea(x, rangoViaje("2027-03-01", 3 + k))), [false, false, true, true]);
});

test("blackoutQueAplica filtra por alcance y devuelve el primero que bloquea; el mensaje dice qué bloquea", () => {
  const lista = [b("2027-03-02", "2027-03-03", "viaje", "Feria"), b("2027-03-01", "2027-03-01", "entrada", "Cierre")];
  const rango = rangoViaje("2027-03-01", 5);
  assert.equal(blackoutQueAplica(lista, rango)?.motivo, "Feria");
  assert.equal(blackoutQueAplica(lista, rango, "entrada")?.motivo, "Cierre");
  assert.equal(blackoutQueAplica(lista, rango, "viaje")?.motivo, "Feria");
  assert.equal(blackoutQueAplica([], rango), null);
  assert.equal(mensajeBlackout(lista[1], rango), "La fecha cae en un blackout (Cierre).");
  assert.match(mensajeBlackout(lista[0], rango), /El viaje del 01\/03\/2027 al 06\/03\/2027 cae en un blackout \(Feria\).*02\/03\/2027 y el 03\/03\/2027/);
});

test("rangoViaje sin noches (o inválidas) es solo la entrada", () => {
  for (const n of [null, undefined, 0, -2, 1.5]) assert.deepEqual(rangoViaje("2027-03-01", n as never), { desde: "2027-03-01", hasta: "2027-03-01" }, String(n));
});

// ── Validación al guardar ───────────────────────────────────────────────────────
const f = (o: Partial<BlackoutEntrada> = {}): BlackoutEntrada => ({ fechaInicio: "2027-03-01", fechaFin: "2027-03-02", motivo: "", ciudad: "", alcance: "entrada", ...o });

test("al guardar: ambos extremos obligatorios, reales, inicio ≤ fin y alcance conocido", () => {
  assert.equal(validarBlackoutsParaGuardar([f(), f({ alcance: "viaje" }), f({ fechaFin: "2027-03-01" })]), null, "inicio = fin es válido");
  assert.match(validarBlackoutsParaGuardar([f({ fechaFin: "" })]) ?? "", /blackout 1 necesita fecha de inicio y de fin/);
  assert.match(validarBlackoutsParaGuardar([f({ fechaInicio: "" })]) ?? "", /blackout 1 necesita fecha de inicio y de fin/);
  assert.match(validarBlackoutsParaGuardar([f(), f({ fechaInicio: "2027-02-30" })]) ?? "", /blackout 2 tiene una fecha que no existe/);
  assert.match(validarBlackoutsParaGuardar([f({ fechaFin: "2027-13-01" })]) ?? "", /fecha que no existe/);
  assert.match(validarBlackoutsParaGuardar([f({ fechaInicio: "2027-03-09", fechaFin: "2027-03-01" })]) ?? "", /termina \(01\/03\/2027\) antes de empezar \(09\/03\/2027\)/);
  assert.match(validarBlackoutsParaGuardar([f({ alcance: "siempre" })]) ?? "", /Elige el alcance/);
  assert.match(validarBlackoutsParaGuardar([f({ alcance: "" })]) ?? "", /Elige el alcance/);
  // Solo una fila TOTALMENTE en blanco se ignora: una con solo ciudad (o fechas de espacios + motivo) se rechaza, no se descarta en silencio.
  const blanca = { fechaInicio: "", fechaFin: "", motivo: "", ciudad: "", alcance: "entrada" };
  assert.equal(validarBlackoutsParaGuardar([blanca, { ...blanca, fechaInicio: "  ", motivo: " ", ciudad: " " }]), null, "filas en blanco se ignoran");
  assert.match(validarBlackoutsParaGuardar([{ ...blanca, ciudad: "Cusco" }]) ?? "", /blackout 1 necesita fecha de inicio y de fin/);
  assert.match(validarBlackoutsParaGuardar([{ ...blanca, fechaInicio: "  ", motivo: "x" }]) ?? "", /necesita fecha de inicio y de fin/);
  assert.match(validarBlackoutsParaGuardar([f({ fechaInicio: " 2027-03-01" })]) ?? "", /fecha que no existe/, "una fecha con espacios no es una fecha real");
});

test("al guardar: las filas totalmente vacías se ignoran, pero una fila solo con motivo se rechaza (nunca se guarda a medias)", () => {
  assert.equal(validarBlackoutsParaGuardar([f({ fechaInicio: "", fechaFin: "", motivo: "  " }), f()]), null);
  assert.match(validarBlackoutsParaGuardar([f({ fechaInicio: "", fechaFin: "", motivo: "algo" })]) ?? "", /necesita fecha de inicio y de fin/);
});

// ── Itinerario 1..N ────────────────────────────────────────────────────────────
const dias = (...n: number[]) => n.map((dia) => ({ dia }));

test("estadoItinerario: completo solo con los días 1..N exactos", () => {
  assert.deepEqual(estadoItinerario(dias(1, 2, 3, 4), 4), { completo: true, faltantes: [], repetidos: [], fuera: [], mensaje: null });
  assert.deepEqual(estadoItinerario(dias(4, 2, 1, 3), 4).completo, true, "el orden no importa");
});

test("estadoItinerario: faltantes, repetidos y fuera de rango se reportan y el mensaje los nombra", () => {
  const e = estadoItinerario(dias(1, 2, 2, 5, 9), 5);
  assert.equal(e.completo, false);
  assert.deepEqual(e.faltantes, [3, 4]);
  assert.deepEqual(e.repetidos, [2]);
  assert.deepEqual(e.fuera, [9]);
  assert.match(e.mensaje ?? "", /faltan los días 3, 4; se repiten los días 2; hay días fuera de 1–5 \(9\)/);
  assert.match(e.mensaje ?? "", /antes de calcular, publicar o reservar/);
});

test("estadoItinerario: sin itinerario cargado faltan TODOS los días; sin días en la cabecera no se puede validar", () => {
  assert.deepEqual(estadoItinerario([], 3).faltantes, [1, 2, 3]);
  for (const n of [null, 0, -1, 2.5]) {
    const e = estadoItinerario(dias(1, 2), n as never);
    assert.equal(e.completo, false, String(n));
    assert.match(e.mensaje ?? "", /no tiene configurados sus días/);
  }
});
