import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { aplicarFiltrosPostCarga } from "../lib/tarifario/filtrosPostCarga.ts";
import { hoyISO } from "../lib/calc/paquetes.ts";

// EJECUCIÓN REAL de aplicarFiltrosPostCarga() — factorización de los 3
// filtros que antes vivían solo dentro de cargarDatosTarifario() (vigencia
// por hotel+categoría+régimen, salidas de bloqueo/dinámico ya pasadas,
// empaquetados desactivados/vencidos), compartida ahora por
// lib/tarifario/resumen.ts (Tier 1) y app/tarifario/detalle-actions.ts
// (Tier 2). Debe comportarse EXACTAMENTE igual sin importar cuál de los dos
// la llame — estas pruebas verifican los 3 filtros por separado y combinados.

type Fila = { data: unknown[] | null; error: unknown };
function clienteFalso(tablas: Record<string, Fila>) {
  function builder(tabla: string) {
    return {
      select() { return this; }, eq() { return this; }, in() { return this; },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        const cfg = tablas[tabla] ?? { data: [], error: null };
        resolve({ data: cfg.data, error: cfg.error });
      },
    };
  }
  return { from: builder } as unknown as SupabaseClient<Database>;
}

function fechaEnBogota(offsetDias: number): string {
  const ms = Date.now() + offsetDias * 86400000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const AYER = fechaEnBogota(-1);
const MANIANA = fechaEnBogota(1);
void hoyISO;

type FilaTest = {
  modulo: string; hotel_id: number | null; categoria: string | null; regimen: string | null;
  fecha_ida: string | null; fecha_regreso: string | null; noches: number | null; empaquetado_id: number | null;
};
function filaBase(overrides: Partial<FilaTest>): FilaTest {
  return { modulo: "bloqueo", hotel_id: 1, categoria: null, regimen: null, fecha_ida: MANIANA, fecha_regreso: null, noches: 3, empaquetado_id: null, ...overrides };
}

describe("aplicarFiltrosPostCarga() — sin admin (service-role no configurado)", () => {
  test("sin admin: no aplica vigencia (pasa tal cual), pero SÍ oculta bloqueo/dinamico vencidos y filas con empaquetado_id (fallo cerrado)", async () => {
    const filas = [
      filaBase({ fecha_ida: AYER }),
      filaBase({ fecha_ida: MANIANA }),
      filaBase({ empaquetado_id: 99 }),
    ];
    const r = await aplicarFiltrosPostCarga(null, filas);
    assert.equal(r.filas.length, 1, "solo sobrevive la fila de bloqueo con fecha futura y sin empaquetado_id");
    assert.equal(r.filas[0].fecha_ida, MANIANA);
  });
});

describe("aplicarFiltrosPostCarga() — filtro de fecha ya pasada", () => {
  test("bloqueo con fecha_ida de ayer: se oculta", async () => {
    const r = await aplicarFiltrosPostCarga(null, [filaBase({ modulo: "bloqueo", fecha_ida: AYER })]);
    assert.equal(r.filas.length, 0);
  });
  test("dinamico con fecha_ida de ayer: se oculta (mismo criterio que bloqueo)", async () => {
    const r = await aplicarFiltrosPostCarga(null, [filaBase({ modulo: "dinamico", fecha_ida: AYER })]);
    assert.equal(r.filas.length, 0);
  });
  test("porcion_terrestre con fecha_ida de ayer: NO se oculta (solo aplica a bloqueo/dinamico)", async () => {
    const r = await aplicarFiltrosPostCarga(null, [filaBase({ modulo: "porcion_terrestre", fecha_ida: AYER })]);
    assert.equal(r.filas.length, 1);
  });
  test("servicios sin fecha_ida: nunca se oculta por este filtro", async () => {
    const r = await aplicarFiltrosPostCarga(null, [filaBase({ modulo: "servicios", fecha_ida: null })]);
    assert.equal(r.filas.length, 1);
  });
});

// `hotel_id: null` en las 3 pruebas de abajo A PROPÓSITO: una fila con
// modulo="bloqueo"+hotel_id sería "verificable" para `filtrarTarifarioVencidas`
// (ver esFilaHotelVerificable en vigencia.ts) y, sin hotel_temporadas/
// tarifa_hotel configuradas en este cliente falso, quedaría oculta por ESE
// filtro (fail-closed) — esto probaría accidentalmente el filtro de vigencia,
// no el de empaquetados. `hotel_id: null` aísla el filtro bajo prueba.
describe("aplicarFiltrosPostCarga() — empaquetados", () => {
  test("empaquetado activo y vigente: se conserva", async () => {
    const admin = clienteFalso({ empaquetados: { data: [{ id: 1, activo: true, compra_inicio: null, compra_fin: null }], error: null } });
    const r = await aplicarFiltrosPostCarga(admin, [filaBase({ hotel_id: null, empaquetado_id: 1 })]);
    assert.equal(r.filas.length, 1);
    assert.equal(r.errorEmpaquetado, null);
  });
  test("empaquetado inactivo: se oculta", async () => {
    const admin = clienteFalso({ empaquetados: { data: [{ id: 1, activo: false, compra_inicio: null, compra_fin: null }], error: null } });
    const r = await aplicarFiltrosPostCarga(admin, [filaBase({ hotel_id: null, empaquetado_id: 1 })]);
    assert.equal(r.filas.length, 0);
  });
  test("error técnico consultando empaquetados: fallo cerrado (oculta), y reporta errorEmpaquetado", async () => {
    const admin = clienteFalso({ empaquetados: { data: null, error: { message: "boom" } } });
    const r = await aplicarFiltrosPostCarga(admin, [filaBase({ hotel_id: null, empaquetado_id: 1 })]);
    assert.equal(r.filas.length, 0);
    assert.ok(r.errorEmpaquetado);
  });
});

describe("aplicarFiltrosPostCarga() — vigencia por hotel+categoría+régimen (reusa filtrarTarifarioVencidas)", () => {
  test("hotel_temporadas/tarifa_hotel vacías: no hay vigencia real → filas de hotel se ocultan (fail-closed, comportamiento heredado de filtrarTarifarioVencidas)", async () => {
    const admin = clienteFalso({});
    const r = await aplicarFiltrosPostCarga(admin, [filaBase({ modulo: "bloqueo", hotel_id: 10, categoria: "Estandar", regimen: "PC" })]);
    assert.equal(r.filas.length, 0);
    assert.equal(r.errorVigencia, null, "sin datos NO es un error técnico — es fail-closed de negocio, no debe reportarse como error");
  });
});

describe("aplicarFiltrosPostCarga() — combinación de los 3 filtros a la vez", () => {
  test("una fila que sobrevive los 3 filtros llega intacta al final", async () => {
    const admin = clienteFalso({
      hotel_temporadas: { data: [{ hotel_id: 10, nombre: "ALTA", fecha_inicio: "2020-01-01", fecha_fin: "2030-01-01", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null }], error: null },
      tarifa_hotel: { data: [{ hotel_id: 10, tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA", neto_sencilla: 100000, neto_doble: 100000, neto_triple: null, neto_multiple: null }], error: null },
      empaquetados: { data: [], error: null },
    });
    const filas = [filaBase({ modulo: "bloqueo", hotel_id: 10, categoria: "Estandar", regimen: "PC", fecha_ida: MANIANA, empaquetado_id: null })];
    const r = await aplicarFiltrosPostCarga(admin, filas);
    assert.equal(r.filas.length, 1, "vigente, fecha futura, sin empaquetado — debe sobrevivir los 3 filtros");
  });
});
