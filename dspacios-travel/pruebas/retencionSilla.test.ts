// Retención en plazo sin contrato (migración 201): vencimiento por día de
// negocio de Bogotá y validación de la captura. Funciones puras.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esRetencionSinContrato, esRetencionVencida, validarRetencion } from "../lib/vuelos/retencion.ts";
import { fechaNegocio } from "../lib/fechaNegocio.ts";

const RET = { estado: "en_plazo", numero_contrato: null, contrato_manual: null, plazo: "2026-10-03" };

test("solo es retención la silla en_plazo SIN contrato orgánico ni manual", () => {
  assert.equal(esRetencionSinContrato(RET), true);
  assert.equal(esRetencionSinContrato({ ...RET, numero_contrato: "DTM-0451" }), false, "en_plazo con contrato orgánico: es una reserva, no una retención");
  assert.equal(esRetencionSinContrato({ ...RET, contrato_manual: "EXT-1" }), false);
  assert.equal(esRetencionSinContrato({ ...RET, estado: "disponible" }), false);
});

test("vence solo cuando plazo < día de negocio: el propio día del plazo aún no vence", () => {
  assert.equal(esRetencionVencida(RET, "2026-10-03"), false, "plazo = hoy: vigente");
  assert.equal(esRetencionVencida(RET, "2026-10-04"), true, "plazo = ayer: vencida");
  assert.equal(esRetencionVencida({ ...RET, numero_contrato: "DTM-0451" }, "2026-10-09"), false, "con contrato nunca es una retención vencida");
  assert.equal(esRetencionVencida({ ...RET, plazo: null }, "2026-10-09"), false);
});

test("límite de Bogotá (UTC−5): a las 04:59 UTC del 4 todavía es 3 de octubre", () => {
  const antes = fechaNegocio(new Date("2026-10-04T04:59:59Z"));
  const despues = fechaNegocio(new Date("2026-10-04T05:00:00Z"));
  assert.equal(antes, "2026-10-03");
  assert.equal(despues, "2026-10-04");
  assert.equal(esRetencionVencida(RET, antes), false, "aunque en UTC ya sea el 4, en Bogotá el plazo del 3 no ha vencido");
  assert.equal(esRetencionVencida(RET, despues), true);
});

test("captura sin contrato: vacía, o pasajero + plazo vigente", () => {
  const hoy = "2026-10-03";
  assert.equal(validarRetencion({ pasajero_nombres: "", plazo: "" }, null, hoy), null, "vacía: se puede guardar (queda disponible)");
  assert.match(validarRetencion({ pasajero_nombres: "ANA" }, null, hoy) ?? "", /fecha de plazo/, "pasajero sin plazo: validación");
  assert.match(validarRetencion({ plazo: "2026-10-05", numero_doc: "1" }, null, hoy) ?? "", /pasajero/, "plazo sin pasajero: validación");
  assert.match(validarRetencion({ pasajero_nombres: "ANA", plazo: "2026-10-02" }, null, hoy) ?? "", /ya pasó/, "plazo anterior a hoy");
  assert.equal(validarRetencion({ pasajero_nombres: "ANA", plazo: "2026-10-03" }, null, hoy), null, "plazo de hoy: válido");
  assert.equal(validarRetencion({ pasajero_apellidos: "PEREZ", plazo: "2026-10-02" }, "2026-10-02", hoy), null,
    "corregir otros datos de una retención ya vencida sin cambiar su plazo");
});
