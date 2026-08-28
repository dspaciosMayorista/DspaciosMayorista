import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Wiring de TEXTO (mismo patrón que pruebas/medicionFlujoWiring.test.ts y
// pruebas/numeracionOrdenWiring.test.ts) sobre las tres rutas del incidente
// de ~13s: /dashboard/reservar, /dashboard/tarifario y /tarifario. No
// ejecuta el código (server-only, next/headers, Supabase con sesión real) —
// verifica que la estructura de concurrencia/secuencialidad pedida está
// realmente en el código, no solo en la intención.
//
// ⚠️ Revisión posterior — defecto "PRUEBA REAL DE CONCURRENCIA" confirmado:
// este archivo solo prueba TEXTO (que el código tenga la forma correcta).
// La prueba de concurrencia REAL (con promesas diferidas, demostrando que
// las tareas de verdad arrancan solapadas y que la secuencia liberarVencidas
// → carga concurrente se respeta) vive en
// pruebas/tarifarioOrquestacion.test.ts, sobre la función PURA
// `lib/tarifario/orquestacion.ts` que las 3 páginas usan — este archivo
// queda como guarda ADICIONAL (confirma que las páginas de verdad llaman al
// orquestador con los argumentos correctos), no como única prueba.
function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

const RESERVAR = "app/(dashboard)/dashboard/reservar/page.tsx";
const TARIFARIO_INTERNO = "app/(dashboard)/dashboard/tarifario/page.tsx";
const TARIFARIO_PUBLICO = "app/tarifario/page.tsx";

describe("/dashboard/reservar — usa orquestarCargaReservar() (liberarVencidas SECUENCIAL antes del par concurrente)", () => {
  const src = leer(RESERVAR);

  test("importa orquestarCargaReservar de lib/tarifario/orquestacion", () => {
    assert.match(src, /import\s*\{\s*orquestarCargaReservar\s*\}\s*from\s*"@\/lib\/tarifario\/orquestacion"/);
  });

  test("liberarVencidas() se llama DENTRO del cierre `liberarVencidas` del orquestador, con su propio await", () => {
    const idxOrq = src.indexOf("orquestarCargaReservar({");
    const idxLiberarProp = src.indexOf("liberarVencidas: async () =>", idxOrq);
    const idxLiberarCall = src.indexOf("await liberarVencidas()", idxLiberarProp);
    assert.ok(idxOrq > -1, "no se encontró la llamada a orquestarCargaReservar");
    assert.ok(idxLiberarProp > -1 && idxLiberarProp > idxOrq, "no se encontró el cierre liberarVencidas: async () => ...");
    assert.ok(idxLiberarCall > -1 && idxLiberarCall > idxLiberarProp, "liberarVencidas() debe invocarse con await dentro de ese cierre");
  });

  test("liberarVencidas se mide como su propia etapa 'liberar_vencidas', separada de 'tarifario_y_programas'", () => {
    assert.match(src, /registrarEtapa\(FLUJO, flujoId, "liberar_vencidas"/);
    assert.match(src, /registrarEtapa\(\s*FLUJO, flujoId, "tarifario_y_programas"/);
  });

  test("cargarDatosTarifario() y getProgramasResumen() se pasan como cierres `cargarTarifario`/`cargarProgramas` al MISMO orquestador (arrancan concurrentes una vez liberarVencidas termina)", () => {
    const idxOrq = src.indexOf("orquestarCargaReservar({");
    const idxCierre = src.indexOf("});", idxOrq);
    const bloque = src.slice(idxOrq, idxCierre);
    assert.match(bloque, /cargarTarifario:\s*\(\)\s*=>\s*cargarDatosTarifario\(sb, FLUJO, flujoId\)/);
    assert.match(bloque, /cargarProgramas:\s*\(\)\s*=>\s*getProgramasResumen\(sb, false\)/, "interno: activos aunque no publicados — el argumento false debe preservarse");
  });

  test("puedeReservar se pasa como prop fija (permite reservar) — sin cambios respecto al comportamiento previo", () => {
    assert.match(src, /<TarifarioPublic[\s\S]*?\bpuedeReservar\b/);
  });
});

describe("/dashboard/tarifario — usa orquestarCargaInterna(); NO usa cargarDatosTarifario() (evita el payload/consultas extra de Vista Booking)", () => {
  const src = leer(TARIFARIO_INTERNO);

  test("importa orquestarCargaInterna de lib/tarifario/orquestacion", () => {
    assert.match(src, /import\s*\{\s*orquestarCargaInterna\s*\}\s*from\s*"@\/lib\/tarifario\/orquestacion"/);
  });

  test("no importa ni invoca cargarDatosTarifario (solo se menciona en comentarios explicando la decisión)", () => {
    assert.doesNotMatch(src, /import\s*\{[^}]*cargarDatosTarifario/, "no debe importar cargarDatosTarifario");
    assert.doesNotMatch(src, /cargarDatosTarifario\(sb/, "no debe invocar cargarDatosTarifario(sb, ...)");
  });

  test("usa el cargador liviano compartido cargarFilasTarifarioPaginado con su propio set de columnas", () => {
    assert.match(src, /import\s*\{\s*cargarFilasTarifarioPaginado\s*\}\s*from\s*"@\/lib\/tarifario\/paginacion"/);
    assert.match(src, /cargarFilasTarifarioPaginado[^(]*\(sb, COLUMNAS_LIVIANAS\)/);
  });

  test("carga_paginada + filtro_vigencia (cierre `cargarTarifario`) y getProgramasResumen (cierre `cargarProgramas`) se pasan al MISMO orquestador", () => {
    const idxOrq = src.indexOf("orquestarCargaInterna({");
    assert.ok(idxOrq > -1, "no se encontró la llamada a orquestarCargaInterna");
    const idxCierre = src.indexOf("});", idxOrq);
    const bloque = src.slice(idxOrq, idxCierre);
    assert.match(bloque, /cargarFilasTarifarioPaginado/);
    assert.match(bloque, /filtrarTarifarioVencidas/);
    assert.match(bloque, /cargarProgramas:\s*\(\)\s*=>\s*getProgramasResumen\(sb, false\)/, "interno: activos aunque no publicados");
  });

  test("no pasa la prop puedeReservar a TarifarioPublic — depende del default false del componente (no permite reservar)", () => {
    const idxJsx = src.indexOf("<TarifarioPublic");
    const bloqueJsx = src.slice(idxJsx, src.indexOf("/>", idxJsx));
    assert.doesNotMatch(bloqueJsx, /puedeReservar/);
  });

  test("reutiliza filtrarTarifarioVencidas de lib/tarifario/vigencia (compartido, no reimplementado)", () => {
    assert.match(src, /import\s*\{\s*filtrarTarifarioVencidas\s*\}\s*from\s*"@\/lib\/tarifario\/vigencia"/);
  });

  test("un fallo de paginación (`!pag.ok`) aborta con mensaje público fijo — nunca dice 'aún no hay tarifas'", () => {
    assert.match(src, /if \(!pag\.ok\)/);
    assert.match(src, /MSG_ERROR_CARGAR_TARIFARIO/);
    assert.match(src, /registrarErrorTecnico\(FLUJO, flujoId, "carga_paginada"/);
  });
});

describe("/tarifario (público) — usa orquestarCargaPublica() (sesión SECUENCIAL antes del trío concurrente); autorización y puedeReservar sin cambios", () => {
  const src = leer(TARIFARIO_PUBLICO);

  test("importa orquestarCargaPublica de lib/tarifario/orquestacion", () => {
    assert.match(src, /import\s*\{\s*orquestarCargaPublica\s*\}\s*from\s*"@\/lib\/tarifario\/orquestacion"/);
  });

  test("mantiene export const revalidate = 120 (caché ISR pre-existente, sin cambios)", () => {
    assert.match(src, /export const revalidate = 120/);
  });

  test("documenta que revalidate=120 hoy NO tiene efecto — auth.getUser() sin condición fuerza render dinámico (verificado con `ƒ` en el build)", () => {
    assert.match(src, /fuerza el\s*\n\/\/ renderizado dinámico por-request/);
  });

  test("auth.getUser() se llama DENTRO del cierre `resolverSesion` del orquestador, ANTES de la carga de datos", () => {
    const idxOrq = src.indexOf("orquestarCargaPublica({");
    const idxResolverSesion = src.indexOf("resolverSesion: async () =>", idxOrq);
    const idxAuth = src.indexOf("sb.auth.getUser()", idxResolverSesion);
    assert.ok(idxOrq > -1, "no se encontró la llamada a orquestarCargaPublica");
    assert.ok(idxResolverSesion > -1 && idxResolverSesion > idxOrq, "no se encontró el cierre resolverSesion");
    assert.ok(idxAuth > -1 && idxAuth > idxResolverSesion, "auth.getUser() debe estar dentro de resolverSesion");
  });

  test("los arrays de roles de esAgencia/puedeReservar quedan EXACTAMENTE iguales a como estaban", () => {
    assert.match(
      src,
      /\["agencia", "freelance", "superadmin", "operaciones", "gerencia", "administracion"\]\.includes\(perfil\.rol\)/
    );
    assert.match(
      src,
      /\["superadmin", "operaciones", "gerencia", "administracion", "venta", "agencia", "freelance"\]\.includes\(perfil\.rol\)/
    );
  });

  test("cargarDatosTarifario, getProgramasResumen(sb, true) y config_sitio se pasan como cierres al MISMO orquestador (arrancan concurrentes una vez la sesión resuelve)", () => {
    const idxOrq = src.indexOf("orquestarCargaPublica({");
    const idxCierre = src.indexOf("});", idxOrq);
    const bloque = src.slice(idxOrq, idxCierre);
    assert.match(bloque, /cargarTarifario:\s*\(\)\s*=>\s*cargarDatosTarifario\(sb, FLUJO, flujoId\)/);
    assert.match(bloque, /cargarProgramas:\s*\(\)\s*=>\s*getProgramasResumen\(sb, true\)/, "público: SOLO publicados — el argumento true debe preservarse");
    assert.match(bloque, /cargarConfigSitio:[\s\S]*?config_sitio/);
  });

  test("puedeReservar/esAgencia se calculan solo a partir de la sesión (dentro de resolverSesion), nunca en el trío concurrente", () => {
    const idxResolverSesion = src.indexOf("resolverSesion: async () =>");
    const idxFinResolverSesion = src.indexOf("cargarTarifario:", idxResolverSesion);
    const bloqueSesion = src.slice(idxResolverSesion, idxFinResolverSesion);
    assert.match(bloqueSesion, /puedeReservar = /, "puedeReservar debe calcularse dentro del cierre de sesión");
  });

  test("pasa puedeReservar (variable calculada de la sesión) como prop a TarifarioPublic, tal como antes", () => {
    assert.match(src, /<TarifarioPublic[\s\S]*?puedeReservar=\{puedeReservar\}/);
  });

  test("un fallo de carga del tarifario (`!resDatos.ok`) aborta con mensaje público fijo — nunca dice 'Tarifario en preparación'", () => {
    assert.match(src, /if \(!resDatos\.ok\)/);
    assert.match(src, /MSG_ERROR_CARGAR_TARIFARIO/);
  });
});

describe("Ninguna de las tres rutas paraleliza una ESCRITURA junto a una LECTURA independiente", () => {
  test("/dashboard/reservar: liberarVencidas (escribe sillas/ventas) nunca se pasa como cierre `cargarTarifario`/`cargarProgramas` (los únicos que arrancan concurrentes)", () => {
    const src = leer(RESERVAR);
    const idxOrq = src.indexOf("orquestarCargaReservar({");
    const idxCargarTarifario = src.indexOf("cargarTarifario:", idxOrq);
    const idxCierre = src.indexOf("});", idxOrq);
    const bloqueConcurrente = src.slice(idxCargarTarifario, idxCierre);
    assert.doesNotMatch(bloqueConcurrente, /liberarVencidas\(\)/, "liberarVencidas() no debe invocarse dentro del tramo concurrente");
  });
});

describe("iniciarCronometro() — ninguna de las tres páginas llama performance.now()/Math.round() directo (regla react-hooks/purity del linter de React Compiler)", () => {
  for (const [nombre, ruta] of [
    ["/tarifario (público)", TARIFARIO_PUBLICO],
    ["/dashboard/tarifario", TARIFARIO_INTERNO],
    ["/dashboard/reservar", RESERVAR],
  ] as const) {
    test(`${nombre}: usa iniciarCronometro() en vez de performance.now()/Math.round() directo en el cuerpo del Server Component`, () => {
      const src = leer(ruta);
      assert.doesNotMatch(src, /performance\.now\(\)/, `${ruta} no debe llamar performance.now() directo (usar iniciarCronometro())`);
      assert.doesNotMatch(src, /Math\.round\(/, `${ruta} no debe llamar Math.round() directo (ya lo hace iniciarCronometro())`);
      assert.match(src, /iniciarCronometro/, `${ruta} debe importar/usar iniciarCronometro()`);
    });
  }
});

describe("'total' fue renombrada a 'preparacion_servidor' en las tres páginas (revisión posterior, defecto \"MEDICIÓN 'TOTAL' INCORRECTA\")", () => {
  for (const [nombre, ruta] of [
    ["/tarifario (público)", TARIFARIO_PUBLICO],
    ["/dashboard/tarifario", TARIFARIO_INTERNO],
    ["/dashboard/reservar", RESERVAR],
  ] as const) {
    test(`${nombre}: ya no queda ninguna etapa literal "total" — se usa "preparacion_servidor"`, () => {
      const src = leer(ruta);
      assert.doesNotMatch(src, /registrarEtapa\(FLUJO, flujoId, "total"/, `${ruta} no debe registrar la etapa "total"`);
      assert.doesNotMatch(src, /registrarDatoPagina\(\s*FLUJO, flujoId, "total"/, `${ruta} no debe registrar datos bajo la etapa "total"`);
      assert.match(src, /registrarEtapa\(FLUJO, flujoId, "preparacion_servidor"/, `${ruta} debe registrar "preparacion_servidor"`);
    });

    test(`${nombre}: el comentario junto a "preparacion_servidor" aclara que NO incluye serialización RSC/transmisión/hidratación/pintado`, () => {
      const src = leer(ruta);
      assert.match(src, /NO incluye[\s\S]{0,400}serializaci[oó]n RSC/i);
    });
  }
});

describe("Costo de la propia instrumentación — cada valor se estima UNA sola vez y se reutiliza (revisión posterior)", () => {
  for (const [nombre, ruta] of [
    ["/tarifario (público)", TARIFARIO_PUBLICO],
    ["/dashboard/tarifario", TARIFARIO_INTERNO],
    ["/dashboard/reservar", RESERVAR],
  ] as const) {
    test(`${nombre}: usa medirPayloadSiHabilitado() (gateado por env var), nunca tamanoAproximadoBytes() directo repetido`, () => {
      const src = leer(ruta);
      assert.match(src, /import\s*\{[^}]*medirPayloadSiHabilitado[^}]*\}\s*from\s*"@\/lib\/observabilidad\/medicion"/, `${ruta} debe importar medirPayloadSiHabilitado`);
      assert.doesNotMatch(src, /tamanoAproximadoBytes\(/, `${ruta} no debe llamar tamanoAproximadoBytes() directo — eso serializa sin gate ni reuso`);
    });

    test(`${nombre}: cada estimación (datos/filas, programas) se calcula en UNA sola constante y se reusa`, () => {
      const src = leer(ruta);
      const llamadas = [...src.matchAll(/medirPayloadSiHabilitado\(/g)];
      // Como máximo una llamada por valor distinto que se estima (datos/filas
      // y programas) — nunca más de 2 en total en ninguna de las 3 páginas.
      assert.ok(llamadas.length <= 2, `${ruta}: medirPayloadSiHabilitado() se llamó ${llamadas.length} veces — cada valor debe estimarse una sola vez y reutilizarse`);
    });
  }
});

describe("loading.tsx — las dos rutas internas tienen su loading state (route segment nuevo, sin convención previa en el repo)", () => {
  test("app/(dashboard)/dashboard/reservar/loading.tsx existe y exporta un default", () => {
    const src = leer("app/(dashboard)/dashboard/reservar/loading.tsx");
    assert.match(src, /export default function/);
  });

  test("app/(dashboard)/dashboard/tarifario/loading.tsx existe y exporta un default", () => {
    const src = leer("app/(dashboard)/dashboard/tarifario/loading.tsx");
    assert.match(src, /export default function/);
  });
});
