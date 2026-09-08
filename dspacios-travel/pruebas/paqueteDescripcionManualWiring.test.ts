// Descripción manual del paquete (migración 169) — verifica que la
// generación automática de "Incluye" fue reemplazada en las superficies
// exactas que la mostraban, y que el formulario administrativo del paquete
// expone los 4 campos manuales pedidos. Wiring por texto/regex contra el
// código fuente (no hay entorno de DOM en este repo).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_VISTA = "app/tarifario/VistaBooking.tsx";
const RUTA_DATOS = "lib/tarifario/datos.ts";
const RUTA_RESUMEN = "lib/tarifario/resumen.ts";
const RUTA_CONFIG_FORM = "app/(dashboard)/dashboard/paquetes/ConfigForm.tsx";
const RUTA_ACTIONS = "app/(dashboard)/dashboard/paquetes/actions.ts";
const RUTA_ID_PAGE = "app/(dashboard)/dashboard/paquetes/[id]/page.tsx";

describe("VistaBooking.tsx — la superficie que mostraba 'Incluye' ya no lo genera solo", () => {
  const src = leer(RUTA_VISTA);

  test("ya no arma la lista automática (nada de 'Tiquete aéreo'/'Hospedaje en' hardcodeados como ítems de Incluye)", () => {
    assert.doesNotMatch(src, /\["Tiquete aéreo"\]/);
    assert.doesNotMatch(src, /`Hospedaje en \$\{hotel\.hotelNombre\}`/);
  });

  test("ya no recibe/usa incluidosPorPaquete (prop vieja eliminada, no solo renombrada a medias)", () => {
    assert.doesNotMatch(src, /incluidosPorPaquete/);
  });

  test("importa seccionesDescripcion de lib/tarifario/descripcionPaquete — nunca reimplementa el parseo de líneas inline", () => {
    assert.match(src, /import \{ seccionesDescripcion, type DescripcionPaqueteRaw \} from "@\/lib\/tarifario\/descripcionPaquete";/);
  });

  test("HotelModal recibe descripcionPorPaquete y deriva `secciones` con seccionesDescripcion(...) indexado por paqueteId", () => {
    assert.match(src, /descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>/);
    const inicio = src.indexOf("const secciones =");
    assert.ok(inicio > -1, "no calcula `secciones`");
    const linea = src.slice(inicio, inicio + 150);
    assert.match(linea, /seccionesDescripcion\(descripcionPorPaquete\[opcion\.paqueteId\]\)/);
  });

  test("el render de las secciones usa encabezado fijo (s.titulo) + un <li> por ítem (s.items.map) — nunca dangerouslySetInnerHTML", () => {
    const inicio = src.indexOf("{secciones.length > 0 && (");
    assert.ok(inicio > -1, "no renderiza `secciones`");
    const bloque = src.slice(inicio, inicio + 700);
    assert.match(bloque, /secciones\.map\(\(s\) =>/);
    assert.match(bloque, /\{s\.titulo\}/);
    assert.match(bloque, /s\.items\.map\(/);
  });

  test("nunca usa dangerouslySetInnerHTML en todo el archivo", () => {
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
  });
});

describe("lib/tarifario/datos.ts y resumen.ts — la fuente de 'Incluye' ya no lee armado_servicios.incluido", () => {
  for (const ruta of [RUTA_DATOS, RUTA_RESUMEN]) {
    test(`${ruta}: ya no consulta armado_servicios con incluido=true para 'Incluye'`, () => {
      const src = leer(ruta);
      assert.doesNotMatch(src, /armado_servicios[\s\S]*incluido[\s\S]*true/);
    });

    test(`${ruta}: consulta armado_paquetes por los 4 campos programa_* y expone descripcionPorPaquete`, () => {
      const src = leer(ruta);
      assert.match(src, /programa_incluye, programa_no_incluye, programa_tarifas_especiales, programa_condiciones_comerciales/);
      assert.match(src, /descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>/);
    });
  }
});

describe("ConfigForm.tsx — 4 textareas del paquete con el texto auxiliar pedido", () => {
  const src = leer(RUTA_CONFIG_FORM);

  test("las 4 etiquetas exactas están presentes", () => {
    assert.match(src, /El programa incluye/);
    assert.match(src, /El programa no incluye/);
    assert.match(src, /Tarifas especiales/);
    assert.match(src, /Condiciones comerciales/);
  });

  test("hay 4 <textarea> ligados a programaIncluye/programaNoIncluye/programaTarifasEspeciales/programaCondicionesComerciales", () => {
    assert.match(src, /value=\{programaIncluye\}/);
    assert.match(src, /value=\{programaNoIncluye\}/);
    assert.match(src, /value=\{programaTarifasEspeciales\}/);
    assert.match(src, /value=\{programaCondicionesComerciales\}/);
  });

  test('texto auxiliar "Escribe un elemento por línea." aparece (al menos) 4 veces, una por campo', () => {
    const m = src.match(/Escribe un elemento por línea\./g);
    assert.ok(m && m.length === 4, `esperaba 4 apariciones, hubo ${m?.length ?? 0}`);
  });

  test('REQUERIDO: si las 4 están vacías, muestra "Sin descripción configurada." (solo en este formulario administrativo)', () => {
    assert.match(src, /Sin descripción configurada\./);
    const inicio = src.indexOf("Sin descripción configurada");
    const antes = src.slice(Math.max(0, inicio - 250), inicio);
    assert.match(antes, /\.some\(\(t\) => t\.trim\(\) !== ""\)/, "debe condicionar el aviso a que las 4 estén vacías");
  });
});

describe("actions.ts — PaqueteConfig/configToRow persisten los 4 campos sin transformarlos (texto libre, solo null si vacío)", () => {
  const src = leer(RUTA_ACTIONS);

  test("PaqueteConfig declara los 4 campos como string (obligatorios en el payload del formulario)", () => {
    assert.match(src, /programaIncluye: string;/);
    assert.match(src, /programaNoIncluye: string;/);
    assert.match(src, /programaTarifasEspeciales: string;/);
    assert.match(src, /programaCondicionesComerciales: string;/);
  });

  test("configToRow mapea cada campo a su columna snake_case con oNull (vacío → null, nunca string vacío guardado)", () => {
    assert.match(src, /programa_incluye: oNull\(c\.programaIncluye\)/);
    assert.match(src, /programa_no_incluye: oNull\(c\.programaNoIncluye\)/);
    assert.match(src, /programa_tarifas_especiales: oNull\(c\.programaTarifasEspeciales\)/);
    assert.match(src, /programa_condiciones_comerciales: oNull\(c\.programaCondicionesComerciales\)/);
  });
});

describe("[id]/page.tsx — el paquete cargado hidrata el formulario con los 4 campos ya guardados", () => {
  const src = leer(RUTA_ID_PAGE);

  test("mapea pq.programa_* → programa* del config del formulario", () => {
    assert.match(src, /programaIncluye: pq\.programa_incluye \?\? ""/);
    assert.match(src, /programaNoIncluye: pq\.programa_no_incluye \?\? ""/);
    assert.match(src, /programaTarifasEspeciales: pq\.programa_tarifas_especiales \?\? ""/);
    assert.match(src, /programaCondicionesComerciales: pq\.programa_condiciones_comerciales \?\? ""/);
  });
});
