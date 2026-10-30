// #88 / PR #409 — correcciones de capacidad, tarifas publicadas y noches ligadas a las vigencias base.
// Estas pruebas se escribieron ANTES del arreglo: reproducen (1) un hotel de máximo 2 personas que deja cargar
// y publicar Triple/Múltiple, (2) niño con max_menores = 0, y (3) tarifas de noche con fechas inventadas.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clavesIncompatibles, conflictosHotel, opcionesVigenciaBase, validarHotelesParaGuardar, vacioPorAcom,
  type HotelEstancia, type HotelParaGuardar, type NocheTarifaFila, type BaseHotelFila, type PorAcom,
} from "../lib/programas/estanciaHotel88.ts";
import { construirTablaHotelPvp, desdeDobleHoteles, type ProgramaPrecioCabecera } from "../lib/programas/precioReserva57.ts";

const PROGRAMA: ProgramaPrecioCabecera = { moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4 };
const por = (o: Partial<PorAcom>): PorAcom => ({ ...vacioPorAcom(), ...o });
const MARZO = { desde: "2027-03-01", hasta: "2027-03-31" };

const hotel = (over: Partial<HotelParaGuardar> = {}): HotelParaGuardar => ({
  nombre: "Hotel Centro", maxPaxHabitacion: 2, maxMenoresHabitacion: 1,
  base: [{ ...MARZO, modalidad: "privado", neto: por({ sencilla: 800, doble: 600 }) }],
  noches: [{ ...MARZO, unidad: "persona", neto: por({ sencilla: 100, doble: 80 }) }],
  ...over,
});

// ── 1. Capacidad ────────────────────────────────────────────────────────────
test("máximo 2 por habitación: no se puede guardar una tarifa base Triple ni Múltiple", () => {
  const triple = hotel({ base: [{ ...MARZO, modalidad: "privado", neto: por({ doble: 600, triple: 520 }) }] });
  assert.match(validarHotelesParaGuardar([triple]) ?? "", /Triple.*máximo 2 persona/i);
  const multiple = hotel({ base: [{ ...MARZO, modalidad: "privado", neto: por({ doble: 600, multiple: 400 }) }] });
  assert.match(validarHotelesParaGuardar([multiple]) ?? "", /Múltiple.*máximo 2 persona/i);
});

test("máximo 2 por habitación: tampoco en la tarifa de noche adicional", () => {
  const h = hotel({ noches: [{ ...MARZO, unidad: "habitacion", neto: por({ doble: 180, triple: 250 }) }] });
  assert.match(validarHotelesParaGuardar([h]) ?? "", /Triple.*máximo 2 persona/i);
});

test("máximo 4 por habitación sigue admitiendo Triple y Múltiple; sin tope admite todo", () => {
  const base = [{ ...MARZO, modalidad: "privado", neto: por({ doble: 600, triple: 520, multiple: 400 }) }];
  assert.equal(validarHotelesParaGuardar([hotel({ maxPaxHabitacion: 4, base })]), null);
  assert.equal(validarHotelesParaGuardar([hotel({ maxPaxHabitacion: null, base })]), null);
});

test("max_menores_habitacion = 0: no se acepta tarifa de niño (base ni noche por persona)", () => {
  const base = [{ ...MARZO, modalidad: "privado", neto: por({ doble: 600, nino: 400 }) }];
  assert.match(validarHotelesParaGuardar([hotel({ maxMenoresHabitacion: 0, base })]) ?? "", /menor/i);
  const noches = [{ ...MARZO, unidad: "persona", neto: por({ doble: 80, nino: 50 }) }];
  assert.match(validarHotelesParaGuardar([hotel({ maxMenoresHabitacion: 0, noches })]) ?? "", /menor/i);
  assert.equal(validarHotelesParaGuardar([hotel({ maxMenoresHabitacion: 1, base, noches })]), null);
});

test("clavesIncompatibles lista cada tarifa cargada que el hotel no admite (para mostrarla, no descartarla en silencio)", () => {
  const h = { maxPaxHabitacion: 2, maxMenoresHabitacion: 0 };
  assert.deepEqual(clavesIncompatibles(h, por({ sencilla: 1, doble: 2, triple: 3, multiple: 4, nino: 5 })), ["triple", "multiple", "nino"]);
  assert.deepEqual(clavesIncompatibles(h, por({ doble: 2 })), []);
  assert.deepEqual(clavesIncompatibles({ maxPaxHabitacion: null, maxMenoresHabitacion: null }, por({ multiple: 4, nino: 5 })), []);
});

// ── 1b. Lo ya guardado (filas antiguas) no se publica ──────────────────────────
test("tarifario/ficha pública: filas antiguas Triple/Múltiple/Niño de un hotel que ya no las admite no salen en la tabla", () => {
  const h: HotelEstancia = { id: 1, nombre: "Hotel Centro", zona: null, tipoHabitacion: null, maxPaxHabitacion: 2, maxMenoresHabitacion: 0, proveedorId: null };
  const base: BaseHotelFila[] = [{ id: 1, hotelId: 1, ...MARZO, modalidad: "privado", bajoSolicitud: false, neto: por({ sencilla: 800, doble: 600, triple: 520, multiple: 400, nino: 300 }) }];
  const noches: NocheTarifaFila[] = [{ id: 1, hotelId: 1, ...MARZO, unidad: "persona", neto: por({ doble: 80, triple: 70, multiple: 60, nino: 50 }) }];
  const t = construirTablaHotelPvp(PROGRAMA, h, base, noches);
  for (const k of ["triple", "multiple", "nino"] as const) {
    assert.equal(t.base[0].pvp[k], null, `base ${k}`);
    assert.equal(t.noches[0].pvp[k], null, `noche ${k}`);
  }
  assert.ok(t.base[0].pvp.doble != null && t.noches[0].pvp.doble != null, "lo compatible se conserva");
  assert.ok(desdeDobleHoteles([t]) != null);
});

// ── 2. Noches ligadas a las vigencias base ──────────────────────────────────
test("una tarifa de noche debe corresponder EXACTAMENTE a una vigencia base del hotel (no se inventan fechas)", () => {
  const inventada = hotel({ noches: [{ desde: "2027-03-05", hasta: "2027-03-20", unidad: "persona", neto: por({ doble: 80 }) }] });
  assert.match(validarHotelesParaGuardar([inventada]) ?? "", /vigencia base/i);
  assert.equal(validarHotelesParaGuardar([hotel()]), null);
});

test("privado y regular con las mismas fechas ofrecen UNA sola vigencia para la noche", () => {
  const h = hotel({
    base: [
      { ...MARZO, modalidad: "privado", neto: por({ doble: 600 }) },
      { ...MARZO, modalidad: "regular", neto: por({ doble: 450 }) },
    ],
  });
  const o = opcionesVigenciaBase(h.base);
  assert.equal(o.opciones.length, 1);
  assert.deepEqual(o.opciones[0], { ...MARZO, modalidades: ["privado", "regular"] });
  assert.deepEqual(o.conflictos, []);
  assert.equal(validarHotelesParaGuardar([h]), null);
});

test("vigencias base que no coinciden entre modalidades: conflicto visible y no se guardan noches", () => {
  const h = hotel({
    base: [
      { ...MARZO, modalidad: "privado", neto: por({ doble: 600 }) },
      { desde: "2027-03-01", hasta: "2027-03-15", modalidad: "regular", neto: por({ doble: 450 }) },
    ],
  });
  const o = opcionesVigenciaBase(h.base);
  assert.ok(o.conflictos.length > 0);
  assert.match(validarHotelesParaGuardar([h]) ?? "", /no coinciden|no coincide/i);
  // Sin noches adicionales cargadas, las bases pueden diferir (no hay nada ligado).
  assert.equal(validarHotelesParaGuardar([{ ...h, noches: [] }]), null);
});

test("editar o quitar una vigencia base usada por una noche deja la tarifa huérfana: se rechaza", () => {
  const editada = hotel({ base: [{ desde: "2027-03-01", hasta: "2027-03-20", modalidad: "privado", neto: por({ doble: 600 }) }] });
  assert.match(validarHotelesParaGuardar([editada]) ?? "", /vigencia base/i);
  const quitada = hotel({ base: [] });
  assert.match(validarHotelesParaGuardar([quitada]) ?? "", /vigencia base/i);
  assert.ok(conflictosHotel(quitada).length > 0);
});
