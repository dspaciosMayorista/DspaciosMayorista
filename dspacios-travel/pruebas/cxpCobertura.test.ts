import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  faltantesCxP,
  planReconciliacionCxpServicios,
  type CxpExistente,
  type CostosContrato,
  type CxpServicioExistente,
  type ServicioObjetivo,
} from "../lib/reservar/cxpCobertura.ts";

// ───────────────────────────────────────────────────────────────────────────
// Revisión del PR #294 — DINERO. Estas pruebas ejecutan la lógica REAL con
// cifras, no inspeccionan texto: `faltantesCxP` y
// `planReconciliacionCxpServicios` son puras y deciden si se crea/borra una
// obligación de pago.
//
// Incluyen CONTROLES NEGATIVOS que reproducen la regla ANTERIOR (la que había
// en `asegurarCuentasPorPagar` antes de esta revisión) y demuestran que esa
// regla SÍ producía la cuenta duplicada: si alguien vuelve a esa regla, las
// pruebas de "no duplica" fallan.
// ───────────────────────────────────────────────────────────────────────────

const SIN_COSTOS: CostosContrato = {
  costo_hotel: 0, costo_aereo: 0, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0,
};

/**
 * REGLA ANTERIOR (la que se corrige), reproducida tal cual para el control
 * negativo: "si no existe ninguna CxP con este tipo_proveedor y la columna de
 * costo es > 0, crea una fila por el TOTAL de la columna".
 */
function faltantesReglaVieja(existentes: readonly CxpExistente[], costos: CostosContrato) {
  const yaTiene = new Set((existentes.map((r) => r.tipo_proveedor).filter(Boolean)) as string[]);
  const out: { tipo: string; valor: number }[] = [];
  if (!yaTiene.has("hotel") && costos.costo_hotel > 0) out.push({ tipo: "hotel", valor: costos.costo_hotel });
  if (!yaTiene.has("aereo") && costos.costo_aereo > 0) out.push({ tipo: "aereo", valor: costos.costo_aereo });
  if (!yaTiene.has("receptivo") && costos.costo_receptivo > 0) out.push({ tipo: "receptivo", valor: costos.costo_receptivo });
  if (!yaTiene.has("asistencia") && costos.costo_asistencia > 0) out.push({ tipo: "asistencia", valor: costos.costo_asistencia });
  if (!yaTiene.has("otro") && costos.otros_costos > 0) out.push({ tipo: "otro", valor: costos.otros_costos });
  return out;
}

describe("faltantesCxP — 1. DOBLE CxP: servicio categorizado 'otro' (regresión que introducía el PR #294)", () => {
  // Reserva con UN servicio opcional categorizado "otro", costo neto $100.000.
  // El flujo de Reservar crea su CxP con tipo_proveedor="otro" (mapeo correcto
  // por categoría) y suma su costo a `costo_receptivo` (esa columna agrega
  // TODOS los servicios, sin importar la categoría).
  const existentes: CxpExistente[] = [{ tipo_proveedor: "otro", valor_total: 100_000 }];
  const costos: CostosContrato = { ...SIN_COSTOS, costo_receptivo: 100_000 };

  test("CONTROL NEGATIVO: la regla vieja creaba una SEGUNDA cuenta de $100.000 por el mismo dinero", () => {
    const viejo = faltantesReglaVieja(existentes, costos);
    assert.deepEqual(viejo, [{ tipo: "receptivo", valor: 100_000 }]);
    // Total de obligaciones con la regla vieja: 100.000 (real) + 100.000 (fantasma) = 200.000
    const totalViejo = 100_000 + viejo.reduce((a, f) => a + f.valor, 0);
    assert.equal(totalViejo, 200_000, "la regla vieja duplicaba la obligación");
  });

  test("regla nueva: no falta nada — el dinero ya está cubierto", () => {
    assert.deepEqual(faltantesCxP(existentes, costos), []);
    const totalNuevo = 100_000 + faltantesCxP(existentes, costos).reduce((a, f) => a + f.valor, 0);
    assert.equal(totalNuevo, 100_000, "la obligación total debe seguir siendo el costo real");
  });
});

describe("faltantesCxP — 2. servicio categorizado 'asistencia' (mismo defecto, ya presente antes del PR)", () => {
  const existentes: CxpExistente[] = [{ tipo_proveedor: "asistencia", valor_total: 50_000 }];
  const costos: CostosContrato = { ...SIN_COSTOS, costo_receptivo: 50_000 };

  test("CONTROL NEGATIVO: la regla vieja duplicaba $50.000", () => {
    assert.deepEqual(faltantesReglaVieja(existentes, costos), [{ tipo: "receptivo", valor: 50_000 }]);
  });
  test("regla nueva: nada que crear", () => {
    assert.deepEqual(faltantesCxP(existentes, costos), []);
  });
});

describe("faltantesCxP — 3. cobertura PARCIAL: ni duplica ni enmascara", () => {
  // Un servicio INCLUIDO (tour, $30.000) + un opcional ($70.000): las dos CxP
  // existen y `costo_receptivo` = 100.000 → nada falta.
  test("incluido + opcional, ambos con CxP: faltante 0", () => {
    const existentes: CxpExistente[] = [
      { tipo_proveedor: "receptivo", valor_total: 30_000 },
      { tipo_proveedor: "otro", valor_total: 70_000 },
    ];
    assert.deepEqual(faltantesCxP(existentes, { ...SIN_COSTOS, costo_receptivo: 100_000 }), []);
  });

  test("solo existe la CxP del incluido ($30.000) y el costo total es $100.000 → falta EXACTAMENTE $70.000", () => {
    const existentes: CxpExistente[] = [{ tipo_proveedor: "receptivo", valor_total: 30_000 }];
    const faltan = faltantesCxP(existentes, { ...SIN_COSTOS, costo_receptivo: 100_000 });
    assert.deepEqual(faltan, [{ tipo: "receptivo", valor: 70_000 }]);
    // La regla vieja habría creado $0 (enmascarando el costo real faltante).
    assert.deepEqual(faltantesReglaVieja(existentes, { ...SIN_COSTOS, costo_receptivo: 100_000 }), []);
  });

  test("la cobertura se reparte entre columnas: receptivo 100k cubierto, asistencia 50k descubierto", () => {
    const existentes: CxpExistente[] = [{ tipo_proveedor: "otro", valor_total: 100_000 }];
    const faltan = faltantesCxP(existentes, { ...SIN_COSTOS, costo_receptivo: 100_000, costo_asistencia: 50_000 });
    assert.deepEqual(faltan, [{ tipo: "asistencia", valor: 50_000 }]);
  });
});

describe("faltantesCxP — 4. contrato manual/importado (sin CxP de servicio): comportamiento IGUAL al de antes", () => {
  test("tres columnas con costo y ninguna CxP → tres filas con su monto propio", () => {
    const costos: CostosContrato = { ...SIN_COSTOS, costo_receptivo: 100_000, costo_asistencia: 50_000, otros_costos: 20_000 };
    assert.deepEqual(faltantesCxP([], costos), [
      { tipo: "receptivo", valor: 100_000 },
      { tipo: "asistencia", valor: 50_000 },
      { tipo: "otro", valor: 20_000 },
    ]);
    // Idéntico a la regla vieja en este caso — no hay regresión funcional.
    assert.deepEqual(faltantesReglaVieja([], costos), faltantesCxP([], costos));
  });
});

describe("faltantesCxP — 5. hotel y aéreo conservan la regla por existencia", () => {
  test("sin CxP de hotel → se crea por el costo completo", () => {
    assert.deepEqual(faltantesCxP([], { ...SIN_COSTOS, costo_hotel: 1_200_000 }), [{ tipo: "hotel", valor: 1_200_000 }]);
  });
  test("con CxP de hotel (aunque el valor difiera) → no se agrega complemento fantasma", () => {
    const existentes: CxpExistente[] = [{ tipo_proveedor: "hotel", valor_total: 900_000 }];
    assert.deepEqual(faltantesCxP(existentes, { ...SIN_COSTOS, costo_hotel: 1_200_000 }), []);
  });
  test("la CxP de hotel NO cubre costos de servicio (bolsas separadas)", () => {
    const existentes: CxpExistente[] = [{ tipo_proveedor: "hotel", valor_total: 1_000_000 }];
    assert.deepEqual(faltantesCxP(existentes, { ...SIN_COSTOS, costo_hotel: 1_000_000, costo_receptivo: 80_000 }), [
      { tipo: "receptivo", valor: 80_000 },
    ]);
  });
});

describe("faltantesCxP — 6. datos corruptos nunca inventan ni ocultan dinero", () => {
  test("valor_total null/NaN cuenta como 0 cobertura (no oculta el costo)", () => {
    const existentes: CxpExistente[] = [{ tipo_proveedor: "receptivo", valor_total: null }];
    assert.deepEqual(faltantesCxP(existentes, { ...SIN_COSTOS, costo_receptivo: 40_000 }), [{ tipo: "receptivo", valor: 40_000 }]);
  });
  test("valor_total negativo no aumenta el faltante", () => {
    const existentes: CxpExistente[] = [{ tipo_proveedor: "receptivo", valor_total: -999 }];
    assert.deepEqual(faltantesCxP(existentes, { ...SIN_COSTOS, costo_receptivo: 40_000 }), [{ tipo: "receptivo", valor: 40_000 }]);
  });
  test("un tipo desconocido no cuenta como cobertura de servicio", () => {
    const existentes: CxpExistente[] = [{ tipo_proveedor: "cualquier-cosa", valor_total: 40_000 }];
    assert.deepEqual(faltantesCxP(existentes, { ...SIN_COSTOS, costo_receptivo: 40_000 }), [{ tipo: "receptivo", valor: 40_000 }]);
  });
  test("sin costos no se crea nada, haya o no CxP", () => {
    assert.deepEqual(faltantesCxP([], SIN_COSTOS), []);
    assert.deepEqual(faltantesCxP([{ tipo_proveedor: "receptivo", valor_total: 10 }], SIN_COSTOS), []);
  });
});

// ── Reconciliación al EDITAR los servicios de un contrato (item 7) ─────────

function obj(servicioId: number, costoNeto: number, nombre = `Servicio ${servicioId}`): ServicioObjetivo {
  return { servicioId, nombre, costoNeto, tipoProveedor: "receptivo", proveedor: "Prov", aplicaRetencion: false, pctRetencion: 0 };
}
function cxp(id: number, servicio_id: number | null, valor_total: number | null, tieneMovimientos = false): CxpServicioExistente {
  return { id, servicio_id, valor_total, tieneMovimientos };
}

describe("planReconciliacionCxpServicios — 7. editar servicios mueve las CxP con el contrato", () => {
  test("servicio agregado → insertar (una sola vez, por su costo real)", () => {
    const plan = planReconciliacionCxpServicios([], [obj(5, 120_000)]);
    assert.equal(plan.insertar.length, 1);
    assert.equal(plan.insertar[0].servicioId, 5);
    assert.equal(plan.insertar[0].costoNeto, 120_000);
    assert.deepEqual(plan.eliminar, []);
    assert.deepEqual(plan.bloqueados, []);
  });

  test("servicio quitado (sin movimientos) → eliminar su CxP", () => {
    const plan = planReconciliacionCxpServicios([cxp(11, 5, 120_000)], []);
    assert.deepEqual(plan.eliminar, [{ id: 11, servicioId: 5 }]);
    assert.deepEqual(plan.insertar, []);
  });

  test("servicio que sigue pero cambió de costo → actualizar (nunca insertar otra fila)", () => {
    const plan = planReconciliacionCxpServicios([cxp(11, 5, 120_000)], [obj(5, 150_000)]);
    assert.deepEqual(plan.insertar, []);
    assert.deepEqual(plan.eliminar, []);
    assert.equal(plan.actualizar.length, 1);
    assert.equal(plan.actualizar[0].id, 11);
    assert.equal(plan.actualizar[0].valor, 150_000);
  });

  test("servicio que sigue con el MISMO costo → no se toca nada", () => {
    const plan = planReconciliacionCxpServicios([cxp(11, 5, 120_000)], [obj(5, 120_000)]);
    assert.deepEqual(plan, { insertar: [], actualizar: [], eliminar: [], bloqueados: [] });
  });

  test("BLOQUEO: quitar un servicio cuya CxP ya tiene pagos/retenciones no se elimina — se reporta", () => {
    const plan = planReconciliacionCxpServicios([cxp(11, 5, 120_000, true)], []);
    assert.deepEqual(plan.eliminar, [], "nunca se borra una obligación con dinero movido");
    assert.deepEqual(plan.bloqueados, [{ id: 11, servicioId: 5 }]);
  });

  test("las CxP sin servicio_id (hotel/aéreo/manuales/legado) NUNCA se tocan", () => {
    const existentes = [cxp(1, null, 1_000_000), cxp(2, null, 500_000), cxp(11, 5, 120_000)];
    const plan = planReconciliacionCxpServicios(existentes, [obj(5, 120_000)]);
    assert.deepEqual(plan.eliminar, []);
    assert.deepEqual(plan.actualizar, []);
    assert.deepEqual(plan.insertar, []);
  });

  test("cambio mixto: uno se queda, uno se agrega, uno se quita — cada uno una sola vez", () => {
    const plan = planReconciliacionCxpServicios(
      [cxp(11, 5, 120_000), cxp(12, 6, 80_000)],
      [obj(5, 120_000), obj(7, 45_000)]
    );
    assert.deepEqual(plan.insertar.map((i) => i.servicioId), [7]);
    assert.deepEqual(plan.eliminar, [{ id: 12, servicioId: 6 }]);
    assert.deepEqual(plan.actualizar, []);
  });

  test("un servicio seleccionado que quedó en costo 0 no deja una CxP en $0 viva", () => {
    const plan = planReconciliacionCxpServicios([cxp(11, 5, 120_000)], [obj(5, 0)]);
    assert.deepEqual(plan.eliminar, [{ id: 11, servicioId: 5 }]);
    assert.deepEqual(plan.insertar, []);
  });

  test("servicio nuevo con costo 0 no crea una CxP vacía", () => {
    const plan = planReconciliacionCxpServicios([], [obj(9, 0)]);
    assert.deepEqual(plan.insertar, []);
  });

  test("filas duplicadas del mismo servicio: la sobrante se elimina, nunca se deja doble obligación", () => {
    const plan = planReconciliacionCxpServicios([cxp(11, 5, 120_000), cxp(12, 5, 120_000)], [obj(5, 120_000)]);
    assert.deepEqual(plan.eliminar, [{ id: 12, servicioId: 5 }]);
  });
});
