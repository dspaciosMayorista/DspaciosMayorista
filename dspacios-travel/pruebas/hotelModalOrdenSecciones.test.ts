// Orden interno de HotelModal (app/tarifario/VistaBooking.tsx): la tarjeta de
// detalle de un hotel "persona" (motor interno) debe mostrar sus secciones en
// el orden Salidas -> Motor interno -> Incluye -> Servicios add-on. Wiring
// por texto/regex contra el código fuente (no hay entorno de DOM en este
// repo, mismo patrón que paqueteDescripcionManualWiring.test.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_VISTA = "app/tarifario/VistaBooking.tsx";

describe("HotelModal — orden Salidas -> Motor interno -> Incluye -> Servicios add-on", () => {
  const src = leer(RUTA_VISTA);
  const idxInicio = src.indexOf("function HotelModal({");
  assert.notEqual(idxInicio, -1, "no encuentra HotelModal");
  const idxFin = src.indexOf("function TarjetaUnidadBusqueda(", idxInicio);
  assert.notEqual(idxFin, -1, "no encuentra el siguiente componente para acotar el cuerpo");
  const cuerpo = src.slice(idxInicio, idxFin);

  const idxSalidas = cuerpo.indexOf("Elige tu salida");
  const idxMotorInterno = cuerpo.indexOf("Motor interno:");
  const idxIncluye = cuerpo.indexOf("{secciones.length > 0 && (");
  const idxAddon = cuerpo.indexOf("{addons.length > 0 && (");

  test("las 4 secciones existen dentro de HotelModal", () => {
    assert.notEqual(idxSalidas, -1, "falta el bloque de Salidas ('Elige tu salida')");
    assert.notEqual(idxMotorInterno, -1, "falta el bloque de Motor interno (Selector/SelectorPorFechas)");
    assert.notEqual(idxIncluye, -1, "falta el bloque de Incluye (secciones)");
    assert.notEqual(idxAddon, -1, "falta el bloque de Servicios add-on (addons)");
  });

  test("aparecen en el orden exacto: Salidas < Motor interno < Incluye < Servicios add-on", () => {
    assert.ok(idxSalidas < idxMotorInterno, "Salidas debe ir antes que Motor interno");
    assert.ok(idxMotorInterno < idxIncluye, "Motor interno debe ir antes que Incluye");
    assert.ok(idxIncluye < idxAddon, "Incluye debe ir antes que Servicios add-on");
  });

  test("Servicios add-on sigue apareciendo después de Incluye (regla explícita)", () => {
    assert.ok(idxIncluye < idxAddon);
  });

  test("el motor interno (Selector/SelectorPorFechas) sigue completo: ambas ramas siguen presentes", () => {
    const bloqueMotor = cuerpo.slice(idxMotorInterno, idxIncluye);
    assert.match(bloqueMotor, /<SelectorPorFechas/);
    assert.match(bloqueMotor, /<Selector\b/);
    assert.match(bloqueMotor, /onAgregar=\{\(item\) => \{/);
  });
});
