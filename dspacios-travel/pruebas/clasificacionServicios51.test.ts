// #51 / B95-2 — included-service obligations survive later package edits and unreadable catalogs. Expected values are worked out by hand.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clasificarObligacionesServicio, nombresOpcionalesDelContrato, categoriaDesdeTipoProveedor } from "../lib/reservar/clasificacionServiciosContrato.ts";
import { planReconciliacionCxpServicios } from "../lib/reservar/cxpCobertura.ts";

const ob = (id: number, servicio_id: number | null, servicio: string, valor: number, tipo = "receptivo") =>
  ({ id, servicio_id, valor_total: valor, tieneMovimientos: false, servicio, tipo_proveedor: tipo });

// Reserved with: asistencia (id 5, INCLUDED, 40.000) and a tour (id 7, optional chosen, 90.000 -> line «Servicio · Tour Rosario»).
const existentes = [ob(-1, 5, "Asistencia médica", 40000, "asistencia"), ob(-2, 7, "Tour Rosario", 90000)];
const lineas = ["Hotel Caribe — Estándar", "Servicio · Tour Rosario — CARTAGENA"];

test("today's behaviour is unchanged when the catalog still says the same thing", () => {
  const c = clasificarObligacionesServicio({ existentes, incluidosCatalogo: new Set([5]), objetivoIds: new Set(), descripcionesItems: lineas });
  assert.deepEqual(c.conservadas.map((e) => e.servicio_id), [5]);
  assert.deepEqual(c.editables.map((e) => e.servicio_id), [7]);
});

test("package edited later: the included service is reclassified as optional in the catalog -> its obligation is still kept (the contract never showed it as a chosen optional)", () => {
  const c = clasificarObligacionesServicio({ existentes, incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: lineas });
  assert.deepEqual(c.conservadas.map((e) => e.servicio_id), [5]);
  const plan = planReconciliacionCxpServicios(c.editables, []); // user clears every optional
  assert.deepEqual(plan.eliminar.map((e) => e.servicioId), [7], "only the optional is removed");
});

test("package edited later: the included service was REMOVED from the package (empty catalog) -> kept, with its cost and type from its own obligation", () => {
  const c = clasificarObligacionesServicio({ existentes, incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: lineas });
  const costos = c.conservadas.map((e) => ({ tipo: e.tipo_proveedor, costo: Number(e.valor_total) }));
  assert.deepEqual(costos, [{ tipo: "asistencia", costo: 40000 }]);
});

test("unreadable catalog treated as empty must NOT delete the included obligation (the finding's exact input: {id:77, servicio_id:5, 40.000}, empty target)", () => {
  const c = clasificarObligacionesServicio({ existentes: [ob(77, 5, "Asistencia médica", 40000, "asistencia")], incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: [] });
  assert.equal(c.editables.length, 0);
  assert.equal(planReconciliacionCxpServicios(c.editables, []).eliminar.length, 0);
});

test("a deselected optional is removable only with the contract's own evidence (its line), including the transfer-scope suffix", () => {
  const e = [ob(-3, 9, "Traslado aeropuerto", 30000)];
  const con = clasificarObligacionesServicio({ existentes: e, incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: ["Servicio · Traslado aeropuerto (Aeropuerto → Hotel) — CARTAGENA"] });
  assert.equal(con.editables.length, 1);
  const sin = clasificarObligacionesServicio({ existentes: e, incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: ["Hotel X"] });
  assert.equal(sin.editables.length, 0);
});

test("accents/case do not break the optional-line match; null servicio_id rows stay with the plan as before", () => {
  const c = clasificarObligacionesServicio({ existentes: [ob(-4, 11, "ASISTENCIA Médica", 1000), ob(12, null, "Manual", 5)], incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: ["Servicio · asistencia medica · 2 pax"] });
  assert.equal(c.editables.length, 2);
  assert.ok(nombresOpcionalesDelContrato(["Servicio · Tour Ñandú · 2027-03-10 → 2027-03-14 · 2 pax"]).has("tour nandu"));
});

// ── R2-2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("R2-2 audit case: reserved included {id:77, servicio_id:5, 40.000}, package no longer includes it, no optional line, new selection = service 5 at 10.000 -> the obligation is NOT editable, nothing is updated, the overlap is reported", () => {
  const e = [ob(77, 5, "Asistencia médica", 40000, "asistencia")];
  const c = clasificarObligacionesServicio({ existentes: e, incluidosCatalogo: new Set(), objetivoIds: new Set([5]), descripcionesItems: ["Hotel Caribe — Estándar"], catalogoNombres: new Map([[5, "Asistencia médica"]]) });
  assert.equal(c.editables.length, 0, "a new selection must not release a historical included obligation");
  assert.deepEqual(c.conservadas.map((x) => x.id), [77]);
  assert.deepEqual(c.conflictos.map((x) => x.id), [77], "the ambiguous overlap is reported so the edit is rejected, never merged or duplicated");
  const plan = planReconciliacionCxpServicios(c.editables, []);
  assert.equal(plan.actualizar.length + plan.eliminar.length + plan.insertar.length, 0, "the 40.000 stays exactly as it was");
});

test("R2-2 sequence: select -> (rejected) -> remove again: the conserved 40.000 survives and no conflict remains once the service is not selected", () => {
  const e = [ob(77, 5, "Asistencia médica", 40000, "asistencia")];
  const quitar = clasificarObligacionesServicio({ existentes: e, incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: [], catalogoNombres: new Map([[5, "Asistencia médica"]]) });
  assert.equal(quitar.conflictos.length, 0);
  assert.deepEqual(quitar.conservadas.map((x) => x.valor_total), [40000]);
});

test("R2-2 identity: a legitimately chosen optional (its own line, unique name) stays editable and re-selecting it is NOT a conflict", () => {
  const e = [ob(-2, 7, "Tour Rosario", 90000)];
  const c = clasificarObligacionesServicio({ existentes: e, incluidosCatalogo: new Set(), objetivoIds: new Set([7]), descripcionesItems: ["Servicio · Tour Rosario — CARTAGENA"], catalogoNombres: new Map([[7, "Tour Rosario"]]) });
  assert.deepEqual(c.editables.map((x) => x.id), [-2]);
  assert.equal(c.conflictos.length, 0);
});

test("R2-2 identity: homonyms do not release money — an included «Asistencia» (id 5) is kept when another package service (id 9) has the same display name and a line exists", () => {
  const e = [ob(77, 5, "Asistencia", 40000, "asistencia")];
  const c = clasificarObligacionesServicio({ existentes: e, incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: ["Servicio · Asistencia · 2 pax"], catalogoNombres: new Map([[5, null], [9, "Asistencia"]]) });
  assert.equal(c.editables.length, 0);
  assert.deepEqual(c.conservadas.map((x) => x.id), [77]);
});

test("R2-2 identity: one line but two obligations with the same name (different servicio_id) -> the name does not say which was the optional: both are kept", () => {
  const e = [ob(-1, 5, "Asistencia", 40000, "asistencia"), ob(-2, 9, "Asistencia", 5000, "asistencia")];
  const c = clasificarObligacionesServicio({ existentes: e, incluidosCatalogo: new Set(), objetivoIds: new Set(), descripcionesItems: ["Servicio · Asistencia · 2 pax"] });
  assert.equal(c.editables.length, 0);
  assert.equal(c.conservadas.length, 2);
});

test("R2-2 wiring: the action rejects the overlap BEFORE planning/any write and passes the catalog names", () => {
  const src = fs.readFileSync("app/(dashboard)/dashboard/contratos/actions.ts", "utf8").replace(/\r\n/g, "\n");
  const i = src.indexOf("export async function actualizarServiciosContrato");
  const cuerpo = src.slice(i, src.indexOf("\nexport async function", i + 10));
  assert.ok(cuerpo.includes("clasif.conflictos.length"));
  assert.ok(cuerpo.indexOf("clasif.conflictos.length") < cuerpo.indexOf("planReconciliacionCxpServicios("));
  assert.ok(cuerpo.indexOf("clasif.conflictos.length") < cuerpo.indexOf("pendiente_aplicar_servicios"));
  assert.ok(cuerpo.includes("catalogoNombres:"));
});

test("type mapping for the summary", () => {
  assert.equal(categoriaDesdeTipoProveedor("asistencia"), "asistencia");
  assert.equal(categoriaDesdeTipoProveedor("receptivo"), "tour_traslado");
  assert.equal(categoriaDesdeTipoProveedor(null), "otro");
});

test("wiring: actualizarServiciosContrato fails closed on the catalog, the previstas and the items reads BEFORE any write, and classifies through the pure module", () => {
  const src = fs.readFileSync("app/(dashboard)/dashboard/contratos/actions.ts", "utf8").replace(/\r\n/g, "\n");
  const i = src.indexOf("export async function actualizarServiciosContrato");
  const cuerpo = src.slice(i, src.indexOf("\nexport async function", i + 10));
  for (const marca of ["catErr", "prevErr", "oldItemsErr", "clasificarObligacionesServicio("]) assert.ok(cuerpo.includes(marca), marca);
  assert.ok(cuerpo.indexOf("if (catErr)") < cuerpo.indexOf("pendiente_aplicar_servicios"), "catalog check before the transaction");
  assert.ok(!/existentesCxp\s*\.filter\(\(e\) => e\.servicio_id != null && incluidosIds\.has/.test(cuerpo), "the catalog-only classification is gone");
});
