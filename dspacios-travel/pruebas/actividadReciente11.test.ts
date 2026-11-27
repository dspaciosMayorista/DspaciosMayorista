// #11 — Presencia reciente observada (personal interno Y aliados B2B): clasificación, rótulos y decisión de envío del navegador. Puro; America/Bogota; jamás «en línea».
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { UMBRAL_RECIENTE_MIN, esAliado, etiquetaNivel, fechaHoraBogota, haceTexto, minutosDesde, nivelPresencia, resumenPresencia, type FilaActividad } from "../lib/actividad/actividadReciente.ts";
import { INTERVALO_PING_MS, REINTENTO_TRAS_ERROR_MS, debePingar, errorDefinitivo, ultimoTrasError } from "../lib/presencia/ping.ts";

const AHORA = new Date("2026-11-25T15:00:00Z"); // 10:00 en Bogotá

describe("#11 clasificación de la presencia observada", () => {
  test("ventana de frescura de 10 min (límite inclusivo); mismo día de Bogotá = hoy; antes = antes de hoy; sin dato = ninguna", () => {
    assert.equal(UMBRAL_RECIENTE_MIN, 10);
    assert.equal(nivelPresencia(AHORA, "2026-11-25T14:50:00Z"), "reciente", "10 min exactos cuentan");
    assert.equal(nivelPresencia(AHORA, "2026-11-25T14:49:00Z"), "hoy", "11 min ya no es reciente");
    assert.equal(nivelPresencia(AHORA, "2026-11-24T20:00:00Z"), "antes");
    assert.equal(nivelPresencia(AHORA, null), "ninguna");
    assert.equal(nivelPresencia(AHORA, "no-es-fecha"), "ninguna");
  });
  test("la frontera de «hoy» es la medianoche de BOGOTÁ, no la UTC", () => {
    assert.equal(nivelPresencia(AHORA, "2026-11-25T04:00:00Z"), "antes", "23:00 del 24 en Bogotá");
    assert.equal(nivelPresencia(AHORA, "2026-11-25T05:00:00Z"), "hoy", "00:00 del 25 en Bogotá");
  });
  test("fechaHoraBogota: 14:32 UTC = 09:32 Bogotá, con fecha y hora", () => {
    assert.equal(fechaHoraBogota("2026-11-25T14:32:00Z"), "25/11/2026 09:32");
    assert.equal(fechaHoraBogota("2026-11-26T04:30:00Z"), "25/11/2026 23:30");
    assert.equal(fechaHoraBogota(null), "—"); assert.equal(fechaHoraBogota("x"), "—");
  });
  test("haceTexto y marca futura (reloj desfasado) sin minutos negativos", () => {
    assert.equal(haceTexto(AHORA, "2026-11-25T14:48:00Z"), "hace 12 min");
    assert.equal(haceTexto(AHORA, "2026-11-25T12:00:00Z"), "hace 3 h");
    assert.equal(haceTexto(AHORA, "2026-11-23T15:00:00Z"), "hace 2 días");
    assert.equal(minutosDesde(AHORA, "2026-11-25T15:30:00Z"), 0);
  });
  test("ningún rótulo afirma conexión: «observada», nunca «en línea»/«conectado»", () => {
    for (const n of ["reciente", "hoy", "antes", "ninguna"] as const) assert.doesNotMatch(etiquetaNivel(n), /en l[ií]nea|conectad|online/i);
    assert.equal(etiquetaNivel("reciente"), "Actividad observada en los últimos 10 min");
    assert.equal(etiquetaNivel("ninguna"), "Sin actividad observada todavía");
  });
  test("aliados y personal: esAliado y resumen separado por grupo; el total viene de la base (puede superar lo mostrado)", () => {
    assert.deepEqual([esAliado("agencia"), esAliado("freelance"), esAliado("operaciones"), esAliado("cliente_final")], [true, true, false, false]);
    const f = (rol: string, visto: string | null, total = 3): FilaActividad => ({ usuario_id: rol + visto, nombre: "n", email: "e", rol, tenant: "mayorista", aliado: null, visto_en: visto, ultima_actividad: null, eventos_ventana: 0, eventos_24h: 0, ultimo_ingreso: null, total });
    assert.deepEqual(resumenPresencia([f("venta", "2026-11-25T14:55:00Z"), f("agencia", "2026-11-25T14:58:00Z"), f("freelance", "2026-11-25T11:00:00Z"), f("gerencia", null)], AHORA, ),
      { recientesPersonal: 1, recientesAliados: 1, hoy: 1, sinObservacion: 1, mostrados: 4, total: 4 });
    assert.equal(resumenPresencia([f("venta", null, 250)], AHORA).total, 250);
  });
});

describe("#11 cuándo avisa el navegador (sin temporizadores, solo pestaña visible)", () => {
  const t0 = 1_000_000_000_000;
  test("pestaña oculta o sesión detenida: nunca; visible y sin envío previo: sí", () => {
    assert.equal(debePingar(t0, false, { ultimo: 0, detenido: false }), false, "oculta no cuenta como actividad");
    assert.equal(debePingar(t0, true, { ultimo: 0, detenido: true }), false);
    assert.equal(debePingar(t0, true, { ultimo: 0, detenido: false }), true);
  });
  test("a lo sumo uno cada 5 min: 4:59 no, 5:00 sí; un reloj atrasado (último en el futuro) no bloquea para siempre", () => {
    assert.equal(INTERVALO_PING_MS, 300_000);
    assert.equal(debePingar(t0 + 299_999, true, { ultimo: t0, detenido: false }), false);
    assert.equal(debePingar(t0 + 300_000, true, { ultimo: t0, detenido: false }), true);
    assert.equal(debePingar(t0, true, { ultimo: t0 + 3_600_000, detenido: false }), true);
  });
  test("tras un error: el siguiente intento a 1 min (no inmediato, no 5 min), y un rechazo de permiso detiene la sesión", () => {
    const u = ultimoTrasError(t0);
    assert.equal(debePingar(t0 + REINTENTO_TRAS_ERROR_MS - 1, true, { ultimo: u, detenido: false }), false);
    assert.equal(debePingar(t0 + REINTENTO_TRAS_ERROR_MS, true, { ultimo: u, detenido: false }), true);
    assert.equal(errorDefinitivo({ code: "42501" }), true); assert.equal(errorDefinitivo({ status: 401 }), true); assert.equal(errorDefinitivo({ code: "PGRST301" }), true);
    assert.equal(errorDefinitivo({ code: "57014" }), false); assert.equal(errorDefinitivo(null), false);
  });
});
