import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Wiring de TEXTO sobre las tres rutas de tarifario tras la ronda "carga
// bajo demanda" (medición real de preview: la caché compartida de la ronda
// anterior fue rechazada por Next — "items over 2MB can not be cached" —
// tras cachear el catálogo completo, 17.197 filas/~11,1 MB, en una sola
// consulta). Esta ronda ELIMINA esa caché (lib/tarifario/catalogoCache.ts,
// lib/tarifario/catalogoCompartidoFabrica.ts ya no existen) y reemplaza la
// carga completa por paginación/búsqueda server-side real
// (lib/tarifario/consulta.ts). No ejecuta el código (server-only,
// next/headers, Supabase con sesión real) — verifica que la estructura
// pedida está realmente en el código, no solo en la intención. La lógica de
// datos en sí (paginación, filtros, enriquecimiento) tiene su propia
// ejecución REAL en tarifarioConsulta.test.ts, tarifarioBuscarPaginaCompleta.test.ts
// y tarifarioVistaClienteHelpers.test.ts.
function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

const RESERVAR = "app/(dashboard)/dashboard/reservar/page.tsx";
const TARIFARIO_INTERNO = "app/(dashboard)/dashboard/tarifario/page.tsx";
const TARIFARIO_PUBLICO = "app/tarifario/page.tsx";
const TARIFARIO_PUBLIC_COMPONENT = "app/tarifario/TarifarioPublic.tsx";
const TODAS = [RESERVAR, TARIFARIO_INTERNO, TARIFARIO_PUBLICO];

// ── CONTROL NEGATIVO obligatorio: la caché de catálogo completo de la ronda
//    anterior no existe más, y NADA en el repo vuelve a conectar el cargador
//    de TODO el catálogo (`cargarFilasTarifarioPaginado`/`cargarDatosTarifario`,
//    sin filtros ni límite) a la carga INICIAL de ninguna de las 3 rutas. ────
describe("CONTROL NEGATIVO — el cargador de catálogo COMPLETO nunca vuelve a conectarse a la carga inicial de las 3 rutas", () => {
  test("lib/tarifario/catalogoCache.ts y catalogoCompartidoFabrica.ts (caché de ~11 MB, rechazada por Next) ya NO existen en el repo", () => {
    const archivos = readdirSync(new URL("../lib/tarifario/", import.meta.url).pathname);
    assert.ok(!archivos.includes("catalogoCache.ts"), "la caché de catálogo completo debe estar eliminada, no reemplazada por otra caché del mismo bloque");
    assert.ok(!archivos.includes("catalogoCompartidoFabrica.ts"));
  });

  test("ninguna de las 3 páginas, ni TarifarioPublic.tsx, importan de '@/lib/tarifario/catalogoCache' (archivo eliminado)", () => {
    for (const ruta of [...TODAS, TARIFARIO_PUBLIC_COMPONENT]) {
      const src = leer(ruta);
      assert.doesNotMatch(src, /from ["']@\/lib\/tarifario\/catalogoCache["']/, `${ruta} no debe importar de la caché eliminada`);
    }
  });

  test("ninguna de las 3 páginas importa/invoca cargarDatosTarifario (el loader SIN paginar) ni cargarFilasTarifarioPaginado (el bucle sin límite) para su carga inicial", () => {
    for (const ruta of TODAS) {
      const src = leer(ruta);
      assert.doesNotMatch(src, /\bcargarDatosTarifario\(/, `${ruta} no debe llamar cargarDatosTarifario() — trae el catálogo completo`);
      assert.doesNotMatch(src, /\bcargarFilasTarifarioPaginado\(/, `${ruta} no debe llamar cargarFilasTarifarioPaginado() directo — ese bucle no tiene límite ni filtro`);
    }
  });

  test("/dashboard/reservar: no importa ninguna función de lib/tarifario/consulta.ts ni lib/tarifario/datos.ts en su propio page.tsx — la búsqueda vive SOLO en TarifarioPublic (Server Action), nunca se precarga desde el servidor de esta página", () => {
    const src = leer(RESERVAR);
    assert.doesNotMatch(src, /from ["']@\/lib\/tarifario\/consulta["']/);
    assert.doesNotMatch(src, /from ["']@\/lib\/tarifario\/datos["']/);
  });
});

describe("/dashboard/reservar — carga inicial CERO tarifario, búsqueda 100% bajo demanda", () => {
  const src = leer(RESERVAR);

  test("pasa filasIniciales={[]} y cargaInicial={false} a TarifarioPublic — el CTA 'Buscar' decide cuándo se pide la primera página, nunca el servidor al entrar", () => {
    assert.match(src, /filasIniciales=\{\[\]\}/);
    assert.match(src, /cargaInicial=\{false\}/);
  });

  test("liberarVencidas() se conserva (independiente de si se precarga tarifario o no)", () => {
    assert.match(src, /await liberarVencidas\(\)/);
    assert.match(src, /registrarEtapa\(FLUJO, flujoId, "liberar_vencidas"/);
  });

  test("getProgramasResumen(sb, false) se sigue trayendo eager — los programas no son parte del problema de las ~17.000 filas de tarifario_resultado", () => {
    assert.match(src, /getProgramasResumen\(sb, false\)/);
  });

  test("puedeReservar se pasa fijo (permite reservar)", () => {
    assert.match(src, /<TarifarioPublic[\s\S]*?\bpuedeReservar\b/);
  });
});

describe("/tarifario (público) — primera página pequeña server-side, resto progresivo", () => {
  const src = leer(TARIFARIO_PUBLICO);

  test("usa buscarPaginaTarifarioCompleta con modulo:\"bloqueo\" y PAGE_SIZE_BLOQUEO (documentado, ~57x más chico que las 17.197 filas del incidente) — no el catálogo completo", () => {
    assert.match(src, /import\s*\{\s*buscarPaginaTarifarioCompleta\s*\}\s*from\s*"@\/lib\/tarifario\/datos"/);
    assert.match(src, /modulo:\s*"bloqueo"/);
    assert.match(src, /PAGE_SIZE_BLOQUEO/);
  });

  test("pasa filasIniciales/totalInicial/cargaInicial (no `filas=`) a TarifarioPublic — el resto del catálogo se pide bajo demanda desde el navegador", () => {
    assert.match(src, /<TarifarioPublic[\s\S]*?filasIniciales=\{filasVisibles\}/);
    assert.match(src, /totalInicial=\{total\}/);
    assert.match(src, /cargaInicial(?!=\{false\})/, "cargaInicial debe quedar en `true` (sin `={false}`) para el visitante público");
  });

  test("mantiene export const revalidate = 120 (caché ISR pre-existente, sin cambios) y su nota de que hoy no tiene efecto", () => {
    assert.match(src, /export const revalidate = 120/);
    assert.match(src, /fuerza el\s*\n\/\/ renderizado dinámico por-request/);
  });

  test("auth.getUser() sigue dentro de resolverSesion(), ANTES de cargar datos — SECUENCIAL vía orquestarCargaPublica", () => {
    const idxOrq = src.indexOf("orquestarCargaPublica({");
    const idxResolverSesion = src.indexOf("resolverSesion: async () =>", idxOrq);
    const idxAuth = src.indexOf("sb.auth.getUser()", idxResolverSesion);
    assert.ok(idxOrq > -1 && idxResolverSesion > idxOrq && idxAuth > idxResolverSesion);
  });

  test("los arrays de roles de esAgencia/puedeReservar quedan EXACTAMENTE iguales — no se tocaron permisos/roles esta ronda", () => {
    assert.match(src, /\["agencia", "freelance", "superadmin", "operaciones", "gerencia", "administracion"\]\.includes\(perfil\.rol\)/);
    assert.match(src, /\["superadmin", "operaciones", "gerencia", "administracion", "venta", "agencia", "freelance"\]\.includes\(perfil\.rol\)/);
  });

  test("VISITANTE ANÓNIMO = estado normal: la rama `user` ausente SIN `authError` nunca llama registrarErrorTecnico — solo authError/perfilError (fallo TÉCNICO real) lo hacen", () => {
    // Extrae el cuerpo de resolverSesion completo.
    const idxInicio = src.indexOf("resolverSesion: async () =>");
    const idxFin = src.indexOf("cargarTarifario:", idxInicio);
    const cuerpo = src.slice(idxInicio, idxFin);
    // Las dos (y ÚNICAS) llamadas a registrarErrorTecnico dentro de resolverSesion
    // deben estar condicionadas a authError/perfilError, nunca a la ausencia de user.
    const llamadas = [...cuerpo.matchAll(/registrarErrorTecnico\(FLUJO, flujoId, "autenticacion_perfil", "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(llamadas.sort(), ["error_auth_getUser", "error_consulta_perfil"].sort(), "solo 2 caminos de error técnico real dentro de resolverSesion — ninguno por 'sin sesión'");
    // El branch `else if (user)` es el único que entra a evaluar perfil; sin
    // user, ninguna de esas dos líneas se alcanza (visitante anónimo normal).
    assert.match(cuerpo, /else if \(user\) \{/);
  });

  test("un fallo de carga del tarifario (`!resDatos.ok`) aborta con mensaje público fijo — nunca dice 'Tarifario en preparación'", () => {
    assert.match(src, /if \(!resDatos\.ok\)/);
    assert.match(src, /MSG_ERROR_CARGAR_TARIFARIO/);
  });
});

describe("/dashboard/tarifario — tabla server-paginada real, filtros vía searchParams (GET)", () => {
  const src = leer(TARIFARIO_INTERNO);

  test("ya NO usa TarifarioPublic/VistaBooking (componente pesado, pensado para explorar/reservar) — es una tabla propia, más simple, coherente con 'vista interna de solo lectura'", () => {
    assert.doesNotMatch(src, /TarifarioPublic/);
  });

  test("usa buscarPaginaTarifarioLiviana(sb, filtrosRaw) — página acotada y filtrada en la base, nunca el catálogo entero", () => {
    assert.match(src, /import\s*\{[^}]*buscarPaginaTarifarioLiviana[^}]*\}\s*from\s*"@\/lib\/tarifario\/consulta"/);
    assert.match(src, /buscarPaginaTarifarioLiviana\(sb, filtrosRaw\)/);
  });

  test("lee page/q/modulo/destino/categoria/regimen de `searchParams` (Promise, server-side) — un filtro nuevo o 'Siguiente' es una consulta fresca, no una recarga completa", () => {
    assert.match(src, /searchParams:\s*Promise<Record<string, string \| undefined>>/);
    assert.match(src, /sp\.page/);
    assert.match(src, /sp\.q/);
    assert.match(src, /sp\.modulo/);
    assert.match(src, /sp\.destino/);
    assert.match(src, /sp\.categoria/);
    assert.match(src, /sp\.regimen/);
  });

  test("el formulario de filtros es GET (server-driven, sin JS de cliente) y el link de 'Siguiente'/'Anterior' arma la URL conservando los filtros activos", () => {
    assert.match(src, /<form[^>]*method="get"/);
    assert.match(src, /const qs = \(extra: Record<string, string \| number>\) => \{/);
  });

  test("un fallo de la consulta paginada (`!res.ok`) aborta con mensaje público fijo — nunca dice 'no hay tarifas'", () => {
    assert.match(src, /if \(!res\.ok\)/);
    assert.match(src, /MSG_ERROR_CARGAR_TARIFARIO/);
    assert.match(src, /registrarErrorTecnico\(FLUJO, flujoId, "consulta_pagina"/);
  });
});

describe("TarifarioPublic.tsx — carga progresiva real (búsqueda server-side + 'Cargar más'), nunca todo el catálogo de una vez", () => {
  const src = leer(TARIFARIO_PUBLIC_COMPONENT);

  test("recibe filasIniciales/totalInicial (no `filas` obligatorio) — la carga inicial puede ser pequeña o vacía, según la ruta", () => {
    assert.match(src, /filasIniciales: FilaTarifario\[\]/);
    assert.match(src, /totalInicial\?: number/);
    const idxExport = src.indexOf("export function TarifarioPublic({");
    const idxCierreProps = src.indexOf("}) {", idxExport);
    const bloquePropsExportadas = src.slice(idxExport, idxCierreProps);
    assert.doesNotMatch(bloquePropsExportadas, /\bfilas: FilaTarifario\[\];/, "el componente EXPORTADO ya no debe declarar `filas` obligatoria (todo el catálogo de una vez) — los sub-componentes internos (PorSalida/TablaHorizontal/etc.) sí siguen recibiendo `filas` como prop normal, eso no cambió");
  });

  test("importa buscarPaginaTarifarioAccion (Server Action) — la búsqueda real vive en el servidor, el cliente nunca replica el cálculo", () => {
    assert.match(src, /import\s*\{\s*buscarPaginaTarifarioAccion\s*\}\s*from\s*"\.\/tarifario-actions"/);
  });

  test("cambiar q/fCat/fReg/moduloActivo dispara ejecutarBusqueda(1, \"reemplazar\") — reinicia la página, nunca acumula sobre un filtro viejo", () => {
    assert.match(src, /\[q, fCat, fReg, moduloActivo\]/, "el efecto de búsqueda debe reaccionar a los 4 campos que definen la búsqueda");
    assert.match(src, /function buscar\(\)[\s\S]{0,120}ejecutarBusqueda\(1, "reemplazar"\)/);
  });

  test("'Cargar más' pide la SIGUIENTE página (pagina + 1) en modo 'agregar' — nunca vuelve a pedir desde la página 1", () => {
    assert.match(src, /function cargarMas\(\)[\s\S]{0,120}ejecutarBusqueda\(pagina \+ 1, "agregar"\)/);
  });

  test("/dashboard/reservar (cargaInicial=false): antes de buscar se muestra un CTA explícito, nunca un listado vacío disfrazado de 'sin resultados'", () => {
    assert.match(src, /mostrarCta = !haBuscado && vista !== "programas"/);
    assert.match(src, /Buscar tarifas/);
  });

  test("el enriquecimiento (fotos/cupos/info/etc.) se fusiona con lo ya cargado en 'agregar' y se REEMPLAZA por completo en 'reemplazar' — usa fusionarEnriquecimiento (lib puro, probado con ejecución real aparte)", () => {
    assert.match(src, /import\s*\{[\s\S]*?fusionarEnriquecimiento[\s\S]*?\}\s*from\s*"@\/lib\/tarifario\/vistaClienteHelpers"/);
    assert.match(src, /fusionarEnriquecimiento\(prev, nuevoEnr\)/);
  });

  test("errores de búsqueda se muestran (errorCarga) — nunca se ocultan ni se confunden con 'sin resultados'", () => {
    assert.match(src, /errorCarga/);
  });
});

describe("iniciarCronometro() — ninguna de las tres páginas llama performance.now()/Math.round() directo (regla react-hooks/purity del linter de React Compiler)", () => {
  for (const [nombre, ruta] of [
    ["/tarifario (público)", TARIFARIO_PUBLICO],
    ["/dashboard/tarifario", TARIFARIO_INTERNO],
    ["/dashboard/reservar", RESERVAR],
  ] as const) {
    test(`${nombre}: usa iniciarCronometro() en vez de performance.now()/Math.round() directo`, () => {
      const src = leer(ruta);
      assert.doesNotMatch(src, /performance\.now\(\)/, `${ruta} no debe llamar performance.now() directo`);
      assert.doesNotMatch(src, /Math\.round\(/, `${ruta} no debe llamar Math.round() directo`);
      assert.match(src, /iniciarCronometro/, `${ruta} debe usar iniciarCronometro()`);
    });
  }
});

describe("'preparacion_servidor' — instrumentación uniforme en las 3 rutas (filas iniciales/consultas/duración/cantidad devuelta, pedido en la verificación)", () => {
  for (const [nombre, ruta] of [
    ["/tarifario (público)", TARIFARIO_PUBLICO],
    ["/dashboard/tarifario", TARIFARIO_INTERNO],
    ["/dashboard/reservar", RESERVAR],
  ] as const) {
    test(`${nombre}: registra la etapa "preparacion_servidor"`, () => {
      const src = leer(ruta);
      assert.match(src, /registrarEtapa\(FLUJO, flujoId, "preparacion_servidor"/, `${ruta} debe registrar "preparacion_servidor"`);
    });
  }

  test("/dashboard/tarifario: registrarDatoPagina de consulta_pagina reporta filas/total/page/pageSize (cantidad devuelta, para verificar en preview que la primera respuesta es chica)", () => {
    const src = leer(TARIFARIO_INTERNO);
    assert.match(src, /filas=\$\{res\.filas\.length\} total=\$\{res\.total\} page=\$\{res\.page\} pageSize=\$\{res\.pageSize\}/);
  });

  test("/tarifario y /dashboard/reservar: registrarDatoPagina de la carga reporta filas de la página/total (vía datos.ts, ya probado con ejecución real)", () => {
    const srcPublico = leer(TARIFARIO_PUBLICO);
    assert.match(srcPublico, /filas_pagina=\$\{filasVisibles\.length\} total=\$\{total\} page=\$\{page\} pageSize=\$\{pageSize\}/);
  });
});

describe("loading.tsx — las dos rutas internas tienen su loading state (skeleton mientras se realiza la consulta)", () => {
  test("app/(dashboard)/dashboard/reservar/loading.tsx existe y exporta un default", () => {
    const src = leer("app/(dashboard)/dashboard/reservar/loading.tsx");
    assert.match(src, /export default function/);
  });

  test("app/(dashboard)/dashboard/tarifario/loading.tsx existe y exporta un default", () => {
    const src = leer("app/(dashboard)/dashboard/tarifario/loading.tsx");
    assert.match(src, /export default function/);
  });
});

describe("Ninguna de las tres rutas paraleliza una ESCRITURA junto a una LECTURA independiente", () => {
  test("/dashboard/reservar: liberarVencidas (escribe sillas/ventas) se ejecuta con su propio await, aislada de la carga de programas", () => {
    const src = leer(RESERVAR);
    const idxLiberar = src.indexOf("await liberarVencidas()");
    const idxProgramas = src.indexOf("getProgramasResumen(sb, false)");
    assert.ok(idxLiberar > -1 && idxProgramas > idxLiberar, "liberarVencidas debe completarse (await) antes de leer programas, no correr en paralelo con una lectura que podría verse afectada");
  });
});
