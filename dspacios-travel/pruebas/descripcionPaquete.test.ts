// lib/tarifario/descripcionPaquete.ts — descripción manual del paquete
// (migración 169): reemplaza la generación automática de "Incluye".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  lineasDeTexto, seccionesDescripcion, descripcionVacia,
  idsPaqueteBernaloFaltantes, filaArmadoPaqueteADescripcion, filasArmadoPaqueteADescripcionPorPaquete,
  fusionarDescripcionPaquete, type DescripcionPaqueteRaw,
} from "../lib/tarifario/descripcionPaquete.ts";

describe("lineasDeTexto — un elemento por línea, solo líneas no vacías", () => {
  test("null/undefined/'' → []", () => {
    assert.deepEqual(lineasDeTexto(null), []);
    assert.deepEqual(lineasDeTexto(undefined), []);
    assert.deepEqual(lineasDeTexto(""), []);
  });

  test("texto simple de varias líneas", () => {
    assert.deepEqual(lineasDeTexto("Desayuno buffet\nTraslados\nImpuestos"), [
      "Desayuno buffet",
      "Traslados",
      "Impuestos",
    ]);
  });

  test("líneas vacías intermedias se descartan (no generan ítems vacíos)", () => {
    assert.deepEqual(lineasDeTexto("A\n\nB\n\n\nC"), ["A", "B", "C"]);
  });

  test("líneas de solo espacios se tratan como vacías", () => {
    assert.deepEqual(lineasDeTexto("A\n   \nB"), ["A", "B"]);
  });

  test("recorta espacios al inicio/fin de cada línea, pero conserva tildes y caracteres internos", () => {
    assert.deepEqual(lineasDeTexto("  Traslado aeropuerto-hotel  \n  Alimentación (PAM)  "), [
      "Traslado aeropuerto-hotel",
      "Alimentación (PAM)",
    ]);
  });

  test("acepta CRLF (\\r\\n) igual que LF", () => {
    assert.deepEqual(lineasDeTexto("Uno\r\nDos\r\nTres"), ["Uno", "Dos", "Tres"]);
  });

  test("texto de una sola línea sin salto", () => {
    assert.deepEqual(lineasDeTexto("Solo una línea"), ["Solo una línea"]);
  });
});

describe("seccionesDescripcion — encabezados fijos, solo las secciones con contenido", () => {
  test("las 4 secciones vacías/null → []", () => {
    assert.deepEqual(seccionesDescripcion(null), []);
    assert.deepEqual(seccionesDescripcion(undefined), []);
    assert.deepEqual(
      seccionesDescripcion({ incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null }),
      []
    );
    assert.deepEqual(
      seccionesDescripcion({ incluye: "", noIncluye: "  ", tarifasEspeciales: null, condicionesComerciales: undefined as unknown as string }),
      []
    );
  });

  test("REQUERIDO: solo 'incluye' configurado → una sola sección 'El programa incluye'", () => {
    const d: DescripcionPaqueteRaw = { incluye: "Desayuno\nTraslados", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null };
    assert.deepEqual(seccionesDescripcion(d), [{ titulo: "El programa incluye", items: ["Desayuno", "Traslados"] }]);
  });

  test("REQUERIDO: las 4 secciones con contenido, en orden fijo El programa incluye/El programa no incluye/Tarifas especiales/Condiciones comerciales", () => {
    const d: DescripcionPaqueteRaw = {
      incluye: "A",
      noIncluye: "B",
      tarifasEspeciales: "C",
      condicionesComerciales: "D",
    };
    assert.deepEqual(seccionesDescripcion(d), [
      { titulo: "El programa incluye", items: ["A"] },
      { titulo: "El programa no incluye", items: ["B"] },
      { titulo: "Tarifas especiales", items: ["C"] },
      { titulo: "Condiciones comerciales", items: ["D"] },
    ]);
  });

  test("una sección vacía en medio de otras con contenido se omite (nunca un encabezado con lista vacía)", () => {
    const d: DescripcionPaqueteRaw = { incluye: "A", noIncluye: null, tarifasEspeciales: "C", condicionesComerciales: null };
    assert.deepEqual(seccionesDescripcion(d), [
      { titulo: "El programa incluye", items: ["A"] },
      { titulo: "Tarifas especiales", items: ["C"] },
    ]);
  });
});

describe("descripcionVacia — true solo si las 4 secciones no tienen contenido", () => {
  test("null/undefined → true", () => {
    assert.equal(descripcionVacia(null), true);
    assert.equal(descripcionVacia(undefined), true);
  });

  test("las 4 en blanco (null o solo espacios) → true", () => {
    assert.equal(
      descripcionVacia({ incluye: null, noIncluye: "   ", tarifasEspeciales: "", condicionesComerciales: null }),
      true
    );
  });

  test("con al menos una línea real en cualquiera de las 4 → false", () => {
    assert.equal(
      descripcionVacia({ incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: "No reembolsable" }),
      false
    );
  });
});

// Helpers puros extraídos del hueco de descripción para paquetes Bernalo
// (auditoría posterior a la tarjeta completa del motor externo) — antes
// vivían inline en app/tarifario/page.tsx / lib/tarifario/datosBernalo.ts,
// solo verificables por inspección de texto. Ahora se prueban con ejecución
// real, sin ningún mock de Supabase/Next.

describe("idsPaqueteBernaloFaltantes — paqueteId reales de hotelesBernalo sin descripción cargada todavía", () => {
  test("descarta los paqueteId que YA existen en descripcionPorPaqueteLegacy (nunca sobrescribe al flujo persona)", () => {
    const hotelesBernalo = [{ paqueteId: 1 }, { paqueteId: 2 }, { paqueteId: 3 }];
    const legacy: Record<number, DescripcionPaqueteRaw> = {
      2: { incluye: "ya cargado", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    assert.deepEqual(idsPaqueteBernaloFaltantes(hotelesBernalo, legacy), [1, 3]);
  });

  test("deduplica: varias ofertas del mismo paqueteId (distintos hoteles de un mismo paquete) producen un solo id, sin pedirlo dos veces", () => {
    const hotelesBernalo = [{ paqueteId: 7 }, { paqueteId: 7 }, { paqueteId: 8 }, { paqueteId: 7 }];
    assert.deepEqual(idsPaqueteBernaloFaltantes(hotelesBernalo, {}), [7, 8]);
  });

  test("lista vacía de hotelesBernalo → [] (nunca consulta nada de más)", () => {
    assert.deepEqual(idsPaqueteBernaloFaltantes([], {}), []);
  });

  test("todos los paqueteId ya tienen descripción → [] (nada que consultar)", () => {
    const hotelesBernalo = [{ paqueteId: 1 }, { paqueteId: 2 }];
    const legacy: Record<number, DescripcionPaqueteRaw> = {
      1: { incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
      2: { incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    assert.deepEqual(idsPaqueteBernaloFaltantes(hotelesBernalo, legacy), []);
  });

  test("un paqueteId con descripción explícitamente vacía (las 4 columnas en null) sigue contando como 'ya cargado' — nunca se re-consulta solo porque esté vacía", () => {
    const hotelesBernalo = [{ paqueteId: 5 }];
    const legacy: Record<number, DescripcionPaqueteRaw> = {
      5: { incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    assert.deepEqual(idsPaqueteBernaloFaltantes(hotelesBernalo, legacy), []);
  });

  test("preserva el orden de primera aparición", () => {
    const hotelesBernalo = [{ paqueteId: 30 }, { paqueteId: 10 }, { paqueteId: 20 }, { paqueteId: 10 }];
    assert.deepEqual(idsPaqueteBernaloFaltantes(hotelesBernalo, {}), [30, 10, 20]);
  });
});

describe("filaArmadoPaqueteADescripcion / filasArmadoPaqueteADescripcionPorPaquete — mapeo fila cruda → DescripcionPaqueteRaw", () => {
  test("mapea las 4 columnas programa_* a los 4 campos de DescripcionPaqueteRaw, sin transformar el contenido", () => {
    const fila = {
      id: 42,
      programa_incluye: "Desayuno",
      programa_no_incluye: "Bebidas alcohólicas",
      programa_tarifas_especiales: "Niño gratis hasta 5 años",
      programa_condiciones_comerciales: "No reembolsable",
    };
    assert.deepEqual(filaArmadoPaqueteADescripcion(fila), {
      incluye: "Desayuno",
      noIncluye: "Bebidas alcohólicas",
      tarifasEspeciales: "Niño gratis hasta 5 años",
      condicionesComerciales: "No reembolsable",
    });
  });

  test("columnas en null se preservan como null (nunca se inventa contenido ni se convierte a string vacío)", () => {
    const fila = { id: 1, programa_incluye: null, programa_no_incluye: null, programa_tarifas_especiales: null, programa_condiciones_comerciales: null };
    assert.deepEqual(filaArmadoPaqueteADescripcion(fila), { incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null });
  });

  test("filasArmadoPaqueteADescripcionPorPaquete indexa por id — varias filas producen un Record con una clave por paqueteId", () => {
    const filas = [
      { id: 1, programa_incluye: "A", programa_no_incluye: null, programa_tarifas_especiales: null, programa_condiciones_comerciales: null },
      { id: 2, programa_incluye: null, programa_no_incluye: "B", programa_tarifas_especiales: null, programa_condiciones_comerciales: null },
    ];
    assert.deepEqual(filasArmadoPaqueteADescripcionPorPaquete(filas), {
      1: { incluye: "A", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
      2: { incluye: null, noIncluye: "B", tarifasEspeciales: null, condicionesComerciales: null },
    });
  });

  test("array vacío → Record vacío", () => {
    assert.deepEqual(filasArmadoPaqueteADescripcionPorPaquete([]), {});
  });
});

describe("fusionarDescripcionPaquete — legacy SIEMPRE gana, sin mutar ninguno de los dos objetos de entrada", () => {
  test("combina ids disjuntos de ambas fuentes", () => {
    const nuevas: Record<number, DescripcionPaqueteRaw> = {
      1: { incluye: "de Bernalo", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    const legacy: Record<number, DescripcionPaqueteRaw> = {
      2: { incluye: "de persona", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    assert.deepEqual(fusionarDescripcionPaquete(nuevas, legacy), {
      1: { incluye: "de Bernalo", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
      2: { incluye: "de persona", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    });
  });

  test("REQUERIDO: si por algún motivo coinciden ids en las dos fuentes, legacy (flujo persona) gana siempre — defensa en profundidad", () => {
    const nuevas: Record<number, DescripcionPaqueteRaw> = {
      9: { incluye: "version Bernalo (nunca debe quedar esta)", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    const legacy: Record<number, DescripcionPaqueteRaw> = {
      9: { incluye: "version persona (debe ganar)", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    assert.deepEqual(fusionarDescripcionPaquete(nuevas, legacy), legacy);
  });

  test("nunca muta los objetos de entrada — ambos quedan intactos después de fusionar", () => {
    const nuevas: Record<number, DescripcionPaqueteRaw> = {
      1: { incluye: "A", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    const legacy: Record<number, DescripcionPaqueteRaw> = {
      2: { incluye: "B", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null },
    };
    const nuevasAntes = JSON.stringify(nuevas);
    const legacyAntes = JSON.stringify(legacy);
    const resultado = fusionarDescripcionPaquete(nuevas, legacy);
    assert.equal(JSON.stringify(nuevas), nuevasAntes, "el argumento `nuevas` no debe mutarse");
    assert.equal(JSON.stringify(legacy), legacyAntes, "el argumento `legacy` no debe mutarse");
    assert.notEqual(resultado, nuevas, "el resultado debe ser un objeto NUEVO, no una referencia a `nuevas`");
    assert.notEqual(resultado, legacy, "el resultado debe ser un objeto NUEVO, no una referencia a `legacy`");
  });

  test("ambos vacíos → {}", () => {
    assert.deepEqual(fusionarDescripcionPaquete({}, {}), {});
  });
});
