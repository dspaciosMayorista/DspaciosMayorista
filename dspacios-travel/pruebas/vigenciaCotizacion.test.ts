import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fechaISOValida,
  hoyBogota,
  resolverVigenciaCotizacion,
  sumarDiasISO,
  vigenciaInicial,
} from "../lib/cotizacion/vigencia.ts";

const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("vigencia de cotizaciones", () => {
  const hoy = "2026-09-09";

  test("viaje hoy: la vigencia automática vence hoy", () => {
    assert.deepEqual(
      resolverVigenciaCotizacion({ hoy, fechaSalida: hoy, diasPorDefecto: 1 }),
      { ok: true, vigencia: hoy },
    );
  });

  test("viaje mañana: la vigencia automática vence mañana", () => {
    assert.deepEqual(
      resolverVigenciaCotizacion({ hoy, fechaSalida: "2026-09-10", diasPorDefecto: 3 }),
      { ok: true, vigencia: "2026-09-10" },
    );
  });

  test("viaje posterior: conserva el plazo automático", () => {
    assert.deepEqual(
      resolverVigenciaCotizacion({ hoy, fechaSalida: "2026-09-30", diasPorDefecto: 3 }),
      { ok: true, vigencia: "2026-09-12" },
    );
  });

  test("salida pasada: rechaza la cotización", () => {
    const r = resolverVigenciaCotizacion({ hoy, fechaSalida: "2026-09-08" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /salida ya pasó/);
  });

  test("vigencia explícita posterior a la salida: rechaza y no recorta en silencio", () => {
    const r = resolverVigenciaCotizacion({
      hoy,
      fechaSalida: "2026-09-09",
      vigenciaSolicitada: "2026-09-10",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /posterior a la fecha de salida/);
  });

  test("vigencia explícita en la salida: acepta", () => {
    assert.deepEqual(
      resolverVigenciaCotizacion({
        hoy,
        fechaSalida: "2026-09-09",
        vigenciaSolicitada: "2026-09-09",
      }),
      { ok: true, vigencia: "2026-09-09" },
    );
  });

  test("vigencia anterior a hoy: rechaza", () => {
    const r = resolverVigenciaCotizacion({
      hoy,
      fechaSalida: "2026-09-20",
      vigenciaSolicitada: "2026-09-08",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /anterior a hoy/);
  });

  test("valida calendarios y suma a través de fin de mes", () => {
    assert.equal(fechaISOValida("2026-02-29"), false);
    assert.equal(fechaISOValida("2028-02-29"), true);
    assert.equal(sumarDiasISO("2026-09-30", 1), "2026-10-01");
  });

  test("usa el día civil de Bogotá, no UTC", () => {
    assert.equal(hoyBogota(new Date("2026-09-10T04:30:00Z")), "2026-09-09");
  });

  test("la ayuda de UI también recorta el valor inicial", () => {
    assert.equal(vigenciaInicial(hoy, hoy, 3), hoy);
  });
});

describe("cableado de vigencia", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  const reservaForm = leer("app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx");
  const manualForm = leer("app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx");
  const editor = leer("app/(dashboard)/dashboard/cotizaciones/[id]/VigenciaCotizacion.tsx");
  const detalle = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");

  test("las tres creaciones usan el resolvedor compartido", () => {
    for (const src of [checkout, reservar, manual]) {
      assert.match(src, /resolverVigenciaCotizacion\(/);
    }
  });

  test("carrito resuelve contra la primera salida real", () => {
    assert.match(checkout, /fechaSalida: fechaIda/);
    assert.doesNotMatch(checkout, /vig\.setDate\(vig\.getDate\(\) \+ 1\)/);
  });

  test("Reservar y manual validan la fecha explícita en servidor", () => {
    assert.match(reservar, /vigenciaSolicitada: opts\?\.vigenciaHasta/);
    assert.match(manual, /vigenciaSolicitada: input\.vigenciaHasta/);
  });

  test("la edición relee fecha_salida antes de actualizar", () => {
    const inicio = reservar.indexOf("export async function actualizarVigenciaCotizacion");
    const bloque = reservar.slice(inicio, reservar.indexOf("export async function descartarCotizacion", inicio));
    assert.match(bloque, /select\("fecha_salida"\)/);
    assert.match(bloque, /fechaSalida: cot\.fecha_salida/);
    assert.match(bloque, /vigencia_hasta: vigenciaRes\.vigencia/);
  });

  test("los calendarios exponen la salida como máximo", () => {
    assert.match(reservaForm, /max=\{fechaSalidaCotizacion \?\? undefined\}/);
    assert.match(manualForm, /max=\{fechaIda \|\| undefined\}/);
    assert.match(editor, /max=\{fechaSalida \?\? undefined\}/);
    assert.match(detalle, /fechaSalida=\{c\.fecha_salida\}/);
  });
});
