import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cotizarUnidadAlojamiento,
  esBloqueado,
  type TarifaAlojamiento,
} from "../lib/calc/unidadAlojamiento.ts";

// ─────────────────────────────────────────────────────────────────────────
// PR #299 (continuación) — "modelo tarifario del hotel" (persona | unidad,
// migración 174) + mejoras administrativas del editor de fase 2 Bernalo:
//   1) migración 174 (default 'persona', CHECK binario, sin tocar tarifas)
//   2) `actualizarModeloTarifarioHotel` (validación server-side del enum,
//      solo toca `hoteles`)
//   3) render condicional en page.tsx / HotelDetalleClient
//   5) simulador de cálculo ("Probar cálculo") — llama al motor real
//
// El componente `.tsx` no se puede `import`ar aquí (JSX, sin transformar por
// el strip-types de Node) y las Server Actions dependen de `next/headers`
// (sin contexto de request en este runner) — mismo patrón ya usado en
// `pruebas/tarifaAlojamientoEditor.test.ts`: se afirma el CABLEADO por texto
// fuente (qué se llama, con qué filtros, en qué orden) en vez de ejecutar la
// acción real contra una base. El motor `cotizarUnidadAlojamiento` en cambio
// SÍ es TypeScript puro sin JSX — el simulador se prueba tanto por cableado
// (que el componente lo llama) como en comportamiento real (que el motor,
// invocado exactamente como lo invoca el componente, produce los resultados
// esperados con varias unidades/menores y bloquea cuando corresponde).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const sinComentarios = (fuente: string) =>
  fuente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linea) => !/^\s*(\/\/|--)/.test(linea))
    .join("\n");

function cuerpoDeFuncion(fuente: string, nombre: string): string {
  const patrones = [
    new RegExp(`export\\s+async\\s+function\\s+${nombre}\\s*\\(`),
    new RegExp(`async\\s+function\\s+${nombre}\\s*\\(`),
    new RegExp(`export\\s+function\\s+${nombre}\\s*\\(`),
    new RegExp(`function\\s+${nombre}\\s*\\(`),
  ];
  let inicio = -1;
  for (const p of patrones) {
    const m = fuente.match(p);
    if (m && m.index != null) { inicio = m.index; break; }
  }
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
  // Algunos archivos de este repo tienen terminadores CRLF (Windows) y otros
  // LF — el cierre a nivel de columna 0 se busca tolerando ambos.
  const cierreMatch = fuente.slice(inicio).match(/\r?\n\}\r?\n/);
  assert.notEqual(cierreMatch, null, `no se encontró el cierre de ${nombre}`);
  return fuente.slice(inicio, inicio + (cierreMatch!.index ?? 0));
}

const ARCHIVOS = {
  migracion174: "supabase/migrations/20260601000174_hotel_modelo_tarifario.sql",
  accionesHotel: "app/(dashboard)/dashboard/producto/hoteles/actions.ts",
  modeloEditor: "app/(dashboard)/dashboard/producto/hoteles/[id]/ModeloTarifarioEditor.tsx",
  page: "app/(dashboard)/dashboard/producto/hoteles/[id]/page.tsx",
  detalleClient: "app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx",
  tarifasUnidadEditor: "app/(dashboard)/dashboard/producto/hoteles/[id]/TarifasUnidadEditor.tsx",
};

const fuentes = Object.fromEntries(
  Object.entries(ARCHIVOS).map(([k, rel]) => [k, sinComentarios(leer(rel))])
) as Record<keyof typeof ARCHIVOS, string>;

const fuenteMigracion174Cruda = leer(ARCHIVOS.migracion174);

// ── 1) Migración 174 ────────────────────────────────────────────────────
describe("migración 174 — hoteles.modelo_tarifario", () => {
  test("agrega la columna con default 'persona', NOT NULL, sin tocar tarifa_hotel/hotel_tarifas_unidad en su cuerpo SQL", () => {
    assert.match(fuenteMigracion174Cruda, /add column if not exists modelo_tarifario text not null default 'persona'/);
    assert.doesNotMatch(fuenteMigracion174Cruda, /\bupdate\s+public\.tarifa_hotel\b/i);
    assert.doesNotMatch(fuenteMigracion174Cruda, /\bupdate\s+public\.hotel_tarifas_unidad\b/i);
    assert.doesNotMatch(fuenteMigracion174Cruda, /\binsert\s+into\s+public\.tarifa_hotel\b/i);
    assert.doesNotMatch(fuenteMigracion174Cruda, /\binsert\s+into\s+public\.hotel_tarifas_unidad\b/i);
    assert.doesNotMatch(fuenteMigracion174Cruda, /\bdelete\s+from\s+public\.tarifa_hotel\b/i);
    assert.doesNotMatch(fuenteMigracion174Cruda, /\bdelete\s+from\s+public\.hotel_tarifas_unidad\b/i);
  });

  test("el CHECK limita el valor exactamente a persona | unidad", () => {
    assert.match(fuenteMigracion174Cruda, /check\s*\(modelo_tarifario in \('persona', 'unidad'\)\)/);
  });

  test("NOT NULL DEFAULT 'persona' sobre una columna nueva: Postgres backfillea automáticamente TODAS las filas existentes — no hace falta (ni aparece) un UPDATE manual", () => {
    // La ausencia de cualquier UPDATE/backfill manual (ya verificada arriba)
    // es justamente lo que garantiza que ningún hotel existente pueda quedar
    // con la columna en null o en un valor distinto de 'persona': el propio
    // motor de Postgres aplica el default a cada fila ya existente cuando la
    // columna nace NOT NULL DEFAULT.
    assert.match(fuenteMigracion174Cruda, /not null default 'persona'/);
  });

  test("transaccional (begin/commit) e idempotente (add column if not exists + verificación de definición compatible antes del CHECK)", () => {
    assert.match(fuenteMigracion174Cruda, /^begin;/m);
    assert.match(fuenteMigracion174Cruda, /^commit;/m);
    assert.match(fuenteMigracion174Cruda, /add column if not exists modelo_tarifario/);
    assert.match(fuenteMigracion174Cruda, /if not found then\s*\n\s*alter table public\.hoteles\s*\n\s*add constraint hoteles_modelo_tarifario_check/);
  });

  test("documenta la decisión comercial en el comentario de columna", () => {
    assert.match(fuenteMigracion174Cruda, /comment on column public\.hoteles\.modelo_tarifario is/);
    assert.match(fuenteMigracion174Cruda, /un solo editor\/modelo activo/i);
  });

  test("preflight, postcheck y rollback existen para la 174", () => {
    for (const rel of [
      "supabase/scripts/preflight_174_hotel_modelo_tarifario.sql",
      "supabase/scripts/postcheck_174_hotel_modelo_tarifario.sql",
      "supabase/scripts/rollback_174_hotel_modelo_tarifario.sql",
    ]) {
      assert.doesNotThrow(() => leer(rel), `falta ${rel}`);
    }
  });

  test("el postcheck verifica que TODOS los hoteles existentes quedaron en 'persona' y que tarifa_hotel/hotel_tarifas_unidad no cambiaron de conteo", () => {
    const postcheck = leer("supabase/scripts/postcheck_174_hotel_modelo_tarifario.sql");
    assert.match(postcheck, /group by modelo_tarifario/);
    assert.match(postcheck, /tarifa_hotel_total/);
    assert.match(postcheck, /hotel_tarifas_unidad_total/);
  });
});

// ── 2) Server Action: validación + único touch a `hoteles` ─────────────
describe("actualizarModeloTarifarioHotel — validación server-side, cliente de sesión, solo toca hoteles", () => {
  test("valida el enum ANTES de cualquier escritura — un valor fuera de persona/unidad nunca llega al update", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.accionesHotel, "actualizarModeloTarifarioHotel");
    const posValidacion = cuerpo.search(/MODELOS_TARIFARIOS/);
    const posCreateClient = cuerpo.search(/createClient\(\)/);
    const posUpdate = cuerpo.search(/\.update\(/);
    assert.notEqual(posValidacion, -1);
    assert.notEqual(posCreateClient, -1);
    assert.notEqual(posUpdate, -1);
    assert.ok(posValidacion < posCreateClient, "la validación del enum debe ocurrir antes de crear el cliente/tocar la base");
    assert.ok(posValidacion < posUpdate, "la validación del enum debe ocurrir antes del update");
    assert.match(cuerpo, /return\s*\{\s*ok:\s*false/);
  });

  test("el enum válido son EXACTAMENTE 'persona' y 'unidad' — ninguna otra cadena", () => {
    assert.match(fuentes.accionesHotel, /const MODELOS_TARIFARIOS = \["persona", "unidad"\] as const/);
  });

  test("nunca usa createAdminClient / service_role — solo el cliente de sesión", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.accionesHotel, "actualizarModeloTarifarioHotel");
    assert.doesNotMatch(cuerpo, /createAdminClient/i);
    assert.doesNotMatch(cuerpo, /service_role/i);
    assert.match(cuerpo, /await createClient\(\)/);
  });

  test("solo actualiza la tabla hoteles — nunca menciona tarifa_hotel ni hotel_tarifas_unidad en su cuerpo", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.accionesHotel, "actualizarModeloTarifarioHotel");
    assert.match(cuerpo, /\.from\("hoteles"\)/);
    assert.doesNotMatch(cuerpo, /tarifa_hotel/);
    assert.doesNotMatch(cuerpo, /hotel_tarifas_unidad/);
    // Exactamente un touch de base: un solo `.update(` en todo el cuerpo.
    const updates = cuerpo.match(/\.update\(/g) ?? [];
    assert.equal(updates.length, 1);
  });

  test("el update solo escribe la columna modelo_tarifario (no reescribe ningún otro campo del hotel)", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.accionesHotel, "actualizarModeloTarifarioHotel");
    assert.match(cuerpo, /\.update\(\{\s*modelo_tarifario:\s*modelo as ModeloTarifarioHotel\s*\}\)/);
  });

  test("exige EXACTAMENTE una fila afectada: .select(\"id\") tras el update, 0 filas y >1 fila fallan cerrado con mensaje", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.accionesHotel, "actualizarModeloTarifarioHotel");
    // El .update(...) encadena .eq(...).select("id") — se lee `data` para
    // contar filas, no se confía en la ausencia de `error` como éxito.
    assert.match(cuerpo, /\.update\(\{\s*modelo_tarifario:\s*modelo as ModeloTarifarioHotel\s*\}\)\s*\.eq\("id", hotelId\)\s*\.select\("id"\)/);
    assert.match(cuerpo, /if\s*\(!data\s*\|\|\s*data\.length\s*===\s*0\)/);
    assert.match(cuerpo, /if\s*\(data\.length\s*>\s*1\)/);
    // Cada rama de fila-count incorrecta devuelve ok:false con un mensaje —
    // nunca se cae en el ok:true del final por descarte.
    const ramaCero = cuerpo.slice(cuerpo.search(/if\s*\(!data\s*\|\|\s*data\.length\s*===\s*0\)/));
    assert.match(ramaCero.slice(0, ramaCero.indexOf("}") + 1), /ok:\s*false/);
    const ramaMasDeUna = cuerpo.slice(cuerpo.search(/if\s*\(data\.length\s*>\s*1\)/));
    assert.match(ramaMasDeUna.slice(0, ramaMasDeUna.indexOf("}") + 1), /ok:\s*false/);
    // El chequeo de filas ocurre ANTES del único ok:true de la función.
    const posChequeoCero = cuerpo.search(/data\.length\s*===\s*0/);
    const posOkTrue = cuerpo.search(/return\s*\{\s*ok:\s*true\s*\}/);
    assert.ok(posChequeoCero !== -1 && posOkTrue !== -1 && posChequeoCero < posOkTrue);
  });

  test("conserva el cliente de sesión y un único update sobre hoteles también con el nuevo chequeo de filas", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.accionesHotel, "actualizarModeloTarifarioHotel");
    assert.match(cuerpo, /await createClient\(\)/);
    assert.doesNotMatch(cuerpo, /createAdminClient/i);
    const updates = cuerpo.match(/\.update\(/g) ?? [];
    assert.equal(updates.length, 1);
    assert.match(cuerpo, /\.from\("hoteles"\)/);
  });
});

// ── 3) Render condicional (page.tsx / HotelDetalleClient) ──────────────
describe("render condicional de los dos editores de tarifas", () => {
  test("page.tsx solo renderiza TarifasUnidadEditor cuando modeloTarifario === 'unidad'", () => {
    assert.match(fuentes.page, /\{modeloTarifario === "unidad" && \(\s*<TarifasUnidadEditor/);
  });

  test("page.tsx pasa mostrarTarifaPersona = (modeloTarifario === 'persona') a HotelDetalleClient", () => {
    assert.match(fuentes.page, /mostrarTarifaPersona=\{modeloTarifario === "persona"\}/);
  });

  test("page.tsx nunca asume 'unidad' sin que la columna lo diga — falla cerrado hacia 'persona'", () => {
    assert.match(fuentes.page, /const modeloTarifario: ModeloTarifario = h\.modelo_tarifario === "unidad" \? "unidad" : "persona"/);
  });

  test("HotelDetalleClient renderiza TemporadasBox SIEMPRE (no condicionado a mostrarTarifaPersona) y TarifasBox solo si mostrarTarifaPersona", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.detalleClient, "HotelDetalleClient");
    assert.match(cuerpo, /<TemporadasBox/);
    // TemporadasBox no debe estar envuelto en el condicional de mostrarTarifaPersona.
    assert.doesNotMatch(cuerpo, /mostrarTarifaPersona\s*&&\s*\(?\s*<TemporadasBox/);
    assert.match(cuerpo, /\{mostrarTarifaPersona\s*&&\s*\(\s*<TarifasBox/);
  });

  test("mostrarTarifaPersona tiene default true — ningún otro llamador existente queda sin la sección por omitir la prop", () => {
    assert.match(fuentes.detalleClient, /mostrarTarifaPersona\s*=\s*true/);
  });

  test("ModeloTarifarioEditor persiste con el server action (cliente de sesión, vía Server Action) y refresca la página tras guardar", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.modeloEditor, "cambiar");
    assert.match(cuerpo, /actualizarModeloTarifarioHotel\(hotelId, valor\)/);
    assert.match(cuerpo, /router\.refresh\(\)/);
  });
});

// ── 4) Tabla de "Tarifas por unidad" — columnas comerciales, no el UUID ──
describe("tabla de tarifas por unidad — prioriza columnas comerciales", () => {
  test("el encabezado es exactamente Temporada | Categoría | Alimentación | Cobro | Valor base | Comisión | Capacidad | Estado | acciones", () => {
    const encabezados = [...fuentes.tarifasUnidadEditor.matchAll(/<th className="[^"]*">([^<]*)<\/th>/g)].map((m) => m[1].trim());
    assert.deepEqual(encabezados, ["Temporada", "Categoría", "Alimentación", "Cobro", "Valor base", "Comisión", "Capacidad", "Estado", ""]);
  });

  test("el tarifa_id (identidad técnica) NO aparece como columna de la tabla principal — solo en el detalle", () => {
    // La única aparición de `tarifa.id` fuera de la sección de detalle debe
    // ser dentro de `key={f.id}`/lógica de estado, nunca como celda visible
    // de la fila principal.
    const cuerpoTabla = fuentes.tarifasUnidadEditor.slice(
      fuentes.tarifasUnidadEditor.indexOf("<thead>"),
      fuentes.tarifasUnidadEditor.indexOf("function FilaDetalle")
    );
    assert.doesNotMatch(cuerpoTabla, /\{f\.tarifa\.id\}/);
  });

  test("hay un botón 'Ver detalle' por fila que alterna un estado detalleId", () => {
    assert.match(fuentes.tarifasUnidadEditor, /setDetalleId\(detalleId === f\.id \? null : f\.id\)/);
    assert.match(fuentes.tarifasUnidadEditor, /\{detalleId === f\.id \? "Ocultar detalle" : "Ver detalle"\}/);
  });

  test("FilaDetalle muestra versión/identidad, valor base, pax incluidos, capacidad, niño/infante cuando aplica, periodicidad, suplementos, reglas de edad y fuente", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "FilaDetalle");
    assert.match(cuerpo, /Versión \/ identidad/);
    assert.match(cuerpo, /t\.id/);
    assert.match(cuerpo, /Valor base/);
    assert.match(cuerpo, /Comisión/);
    assert.match(cuerpo, /Pax incluidos/);
    assert.match(cuerpo, /Capacidad mín\.\/máx\./);
    assert.match(cuerpo, /Niño \/ Infante/);
    assert.match(cuerpo, /periodicidadInfante/);
    assert.match(cuerpo, /Suplementos/);
    assert.match(cuerpo, /Reglas de edad/);
    assert.match(cuerpo, /Fuente/);
    assert.match(cuerpo, /Estado/);
  });

  test("no hay cards anidadas: FilaDetalle es una fila de tabla (colSpan) sobre el mismo <table>, no un componente Card aparte", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "FilaDetalle");
    assert.match(cuerpo, /<tr /);
    assert.match(cuerpo, /colSpan=\{9\}/);
    assert.doesNotMatch(cuerpo, /<Card/i);
  });
});

// ── 5) Simulador de cálculo ("Probar cálculo") ──────────────────────────
describe("SimuladorCalculo — cableado: usa el motor real, no persiste, no reimplementa fórmulas", () => {
  test("importa cotizarUnidadAlojamiento directamente desde el motor puro", () => {
    assert.match(fuentes.tarifasUnidadEditor, /import\s*\{[^}]*cotizarUnidadAlojamiento[^}]*\}\s*from\s*"@\/lib\/calc\/unidadAlojamiento"/);
  });

  test("no calcula al abrir el detalle: el resultado nace en null y cotizarUnidadAlojamiento solo se llama DENTRO de calcular()", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "SimuladorCalculo");
    assert.match(cuerpo, /useState<ResultadoCotizacionUnidad \| null>\(null\)/);
    const posCalcularDecl = cuerpo.search(/function calcular\(\)/);
    assert.notEqual(posCalcularDecl, -1);
    // Ninguna llamada a cotizarUnidadAlojamiento ANTES de la declaración de
    // calcular() — si la hubiera, se ejecutaría en cada render, no al pulsar
    // el botón.
    const antesDeCalcular = cuerpo.slice(0, posCalcularDecl);
    assert.doesNotMatch(antesDeCalcular, /cotizarUnidadAlojamiento\(/);
    // Dentro de calcular() sí se llama, exactamente una vez.
    const cierreCalcular = cuerpo.slice(posCalcularDecl).match(/\r?\n  \}\r?\n/);
    assert.notEqual(cierreCalcular, null);
    const cuerpoCalcular = cuerpo.slice(posCalcularDecl, posCalcularDecl + (cierreCalcular!.index ?? 0));
    assert.match(cuerpoCalcular, /cotizarUnidadAlojamiento\(\{\s*tarifa,\s*distribucion,\s*noches:/);
    const llamadas = cuerpo.match(/cotizarUnidadAlojamiento\(/g) ?? [];
    assert.equal(llamadas.length, 1, "cotizarUnidadAlojamiento debe llamarse una única vez, dentro de calcular()");
  });

  test("el botón Calcular invoca directamente calcular() (que a su vez llama al motor real)", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "SimuladorCalculo");
    assert.match(cuerpo, /<Button onClick=\{calcular\}[^>]*>Calcular<\/Button>/);
  });

  test("cambiar noches, adultos, menores o unidades limpia el resultado anterior (setResultado(null) antes de cada set de entrada)", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "SimuladorCalculo");
    // Los dos únicos wrappers de escritura de entrada limpian el resultado
    // antes de escribir el nuevo valor.
    assert.match(cuerpo, /const limpiarYSetNoches = \(v: string\) => \{ setResultado\(null\); setNoches\(v\); \};/);
    assert.match(cuerpo, /const limpiarYSetUnidades = \(v: SimUnidad\[\]\) => \{ setResultado\(null\); setUnidades\(v\); \};/);
    // El input de noches, agregar/quitar unidad y agregar/quitar menor pasan
    // TODOS por esos wrappers — nunca por setNoches/setUnidades directo.
    assert.match(cuerpo, /onChange=\{\(e\) => limpiarYSetNoches\(e\.target\.value\)\}/);
    assert.match(cuerpo, /limpiarYSetUnidades\(\[\.\.\.unidades, simUnidadVacia\(\)\]\)/);
    assert.match(cuerpo, /limpiarYSetUnidades\(unidades\.filter\(/);
    assert.match(cuerpo, /setUnidad\(i, \{ menores: \[\.\.\.u\.menores, ""\] \}\)/);
    assert.match(cuerpo, /setUnidad\(i, \{ menores: u\.menores\.filter\(/);
    // `setUnidad` (usado por adultos y por editar/quitar un menor) en sí
    // mismo delega en limpiarYSetUnidades — nunca llama setUnidades crudo.
    assert.match(cuerpo, /const setUnidad = \(i: number, patch: Partial<SimUnidad>\) =>\s*\r?\n\s*limpiarYSetUnidades\(/);
    // Ningún JSX de este componente llama setNoches/setUnidades sin pasar
    // primero por los wrappers (evita que un cambio futuro reintroduzca una
    // escritura de entrada que no limpie el resultado).
    assert.doesNotMatch(cuerpo, /onChange=\{\(e\) => setNoches\(/);
    assert.doesNotMatch(cuerpo, /onClick=\{\(\) => setUnidades\(/);
  });

  test("campos vacíos del simulador (noches/adultos/edades) se traducen con el mismo numRequerido — nunca 0/1 inventado", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "SimuladorCalculo");
    assert.match(cuerpo, /numRequerido\(u\.adultos\)/);
    assert.match(cuerpo, /numRequerido\(edad\)/);
    assert.match(cuerpo, /numRequerido\(noches\)/);
    assert.doesNotMatch(cuerpo, /Number\(noches\)\s*\|\|/);
    assert.doesNotMatch(cuerpo, /Number\(u\.adultos\)\s*\|\|/);
  });

  test("el error real del motor solo se muestra tras el intento (resultado != null envuelve el bloque de bloqueado/éxito)", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "SimuladorCalculo");
    assert.match(cuerpo, /\{resultado != null && \(/);
    assert.match(cuerpo, /esBloqueado\(resultado\)/);
    assert.match(cuerpo, /resultado\.mensaje/);
    assert.match(cuerpo, /resultado\.codigo/);
  });

  test("no persiste nada: no llama ninguna Server Action de escritura desde el simulador", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "SimuladorCalculo");
    for (const accion of [
      "crearTarifaUnidadBorrador",
      "actualizarTarifaUnidadBorrador",
      "publicarTarifaUnidad",
      "duplicarTarifaUnidadVersion",
      "eliminarTarifaUnidadBorrador",
      "inactivarTarifaUnidad",
    ]) {
      assert.doesNotMatch(cuerpo, new RegExp(accion));
    }
  });

  test("muestra el desglose real del motor: unidad de cobro, cantidad de unidades, desglose, menores clasificados, suplementos aplicados, totales y capacidad utilizada", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.tarifasUnidadEditor, "SimuladorCalculo");
    for (const campo of [
      "resultado.unidadCobro",
      "resultado.cantidadUnidades",
      "resultado.desglose",
      "resultado.menoresClasificados",
      "resultado.suplementosAplicados",
      "resultado.capacidadUtilizada",
      "resultado.totalBrutoPorNoche",
      "resultado.totalBrutoPorEstadia",
      "resultado.totalNeto",
    ]) {
      assert.ok(cuerpo.includes(campo), `falta mostrar ${campo}`);
    }
  });

  test("ronda 9 — sin alias con los nombres viejos: totalNetoPorNoche/totalPorEstadia no existen como identificadores en el componente", () => {
    // `fuentes.tarifasUnidadEditor` ya viene sin comentarios (`sinComentarios`
    // en el ARCHIVOS map de arriba), así que cualquier coincidencia acá sería
    // código real, no la nota histórica del motor.
    assert.doesNotMatch(fuentes.tarifasUnidadEditor, /\btotalNetoPorNoche\b/);
    assert.doesNotMatch(fuentes.tarifasUnidadEditor, /\btotalPorEstadia\b/);
    assert.match(fuentes.tarifasUnidadEditor, /\btotalBrutoPorNoche\b/);
    assert.match(fuentes.tarifasUnidadEditor, /\btotalBrutoPorEstadia\b/);
  });

  test("ronda 9 — la etiqueta visible ya no dice \"Total neto/noche (bruto)\" (ambigua); dice \"Total bruto/noche\"", () => {
    assert.doesNotMatch(fuentes.tarifasUnidadEditor, /Total neto\/noche/);
    assert.match(fuentes.tarifasUnidadEditor, /Total bruto\/noche/);
  });
});

// ── 6) Textos y orden comercial (ajuste puntual) ────────────────────────
describe("texto sin referencias a la Tarifa neta oculta + orden comercial de la tabla", () => {
  test("no queda ninguna referencia visible (ni en comentarios) a \"Tarifa neta\" ... \"de arriba\" en TarifasUnidadEditor.tsx", () => {
    assert.doesNotMatch(fuentes.tarifasUnidadEditor, /Tarifa neta[\s\S]{0,40}de arriba/i);
    assert.doesNotMatch(fuentes.tarifasUnidadEditor, /&quot;Tarifa neta&quot;/);
  });

  test("el texto explica que es el modelo tarifario activo del hotel y que cada fila define su unidad de cobro", () => {
    assert.match(fuentes.tarifasUnidadEditor, /modelo tarifario activo/i);
    assert.match(fuentes.tarifasUnidadEditor, /unidad de cobro/i);
  });

  test("filasOrdenadas ordena por temporada → categoría → alimentación → unidadCobro → versionTarifario, NUNCA por tarifa.id como criterio principal", () => {
    const cuerpo = fuentes.tarifasUnidadEditor;
    const inicio = cuerpo.search(/const filasOrdenadas = \[\.\.\.filas\]\.sort/);
    assert.notEqual(inicio, -1);
    const cierre = cuerpo.indexOf(");", inicio);
    const bloqueSort = cuerpo.slice(inicio, cierre);
    const posTemporada = bloqueSort.search(/a\.tarifa\.temporada, b\.tarifa\.temporada/);
    const posCategoria = bloqueSort.search(/a\.tarifa\.categoria, b\.tarifa\.categoria/);
    const posAlimentacion = bloqueSort.search(/a\.tarifa\.alimentacion, b\.tarifa\.alimentacion/);
    const posUnidadCobro = bloqueSort.search(/a\.tarifa\.unidadCobro, b\.tarifa\.unidadCobro/);
    const posVersion = bloqueSort.search(/a\.tarifa\.versionTarifario, b\.tarifa\.versionTarifario/);
    for (const pos of [posTemporada, posCategoria, posAlimentacion, posUnidadCobro, posVersion]) assert.notEqual(pos, -1);
    assert.ok(posTemporada < posCategoria);
    assert.ok(posCategoria < posAlimentacion);
    assert.ok(posAlimentacion < posUnidadCobro);
    assert.ok(posUnidadCobro < posVersion);
    // tarifa.id nunca aparece en el criterio de orden.
    assert.doesNotMatch(bloqueSort, /tarifa\.id/);
  });

  test("comparar() empuja null/undefined al final de cada nivel (no rompe con temporada/categoría/alimentación sin definir)", () => {
    const cuerpo = fuentes.tarifasUnidadEditor;
    assert.match(cuerpo, /if \(a == null && b == null\) return 0;/);
    assert.match(cuerpo, /if \(a == null\) return 1;/);
    assert.match(cuerpo, /if \(b == null\) return -1;/);
  });
});

// ── 5b) El motor real, invocado exactamente como lo invoca el simulador ──
// (comportamiento, no solo cableado) — demuestra que distribuciones con
// varias unidades y menores funcionan, y que un resultado bloqueado es
// observable con su mensaje.
describe("motor real vía la misma forma de llamada que usa el simulador", () => {
  const tarifaHabitacion: TarifaAlojamiento = {
    id: "hab-doble-alta",
    versionTarifario: "bernalo-2026",
    unidadCobro: "habitacion",
    comisionPct: 0,
    valores: { adulto: 400_000 },
    capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
    suplementos: [
      { tipo: "adulto_adicional", valor: 80_000 },
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 40_000 },
    ],
    reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 }] },
    temporada: "ALTA",
    categoria: "Doble",
    alimentacion: "PC",
  };

  test("varias unidades con adultos y menores mixtos: cotiza correctamente y refleja cada unidad en capacidadUtilizada", () => {
    const resultado = cotizarUnidadAlojamiento({
      tarifa: tarifaHabitacion,
      distribucion: {
        unidades: [
          { adultos: 2, menores: [{ edadAnios: 6 }] },
          { adultos: 3, menores: [] },
        ],
      },
      noches: 3,
    });
    assert.equal(esBloqueado(resultado), false);
    if (esBloqueado(resultado)) return;
    assert.equal(resultado.cantidadUnidades, 2);
    assert.equal(resultado.capacidadUtilizada.length, 2);
    assert.equal(resultado.capacidadUtilizada[0].adultos, 2);
    assert.equal(resultado.capacidadUtilizada[0].menores, 1);
    assert.equal(resultado.capacidadUtilizada[1].adultos, 3);
    assert.ok(resultado.totalNeto > 0);
  });

  test("una edad sin regla que la cubra bloquea con edad_fuera_de_regla y un mensaje explicable", () => {
    const resultado = cotizarUnidadAlojamiento({
      tarifa: tarifaHabitacion,
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 15 }] }] },
      noches: 2,
    });
    assert.equal(esBloqueado(resultado), true);
    if (!esBloqueado(resultado)) return;
    assert.equal(resultado.codigo, "edad_fuera_de_regla");
    assert.ok(resultado.mensaje.length > 0);
  });

  test("un campo vacío traducido por numRequerido (NaN) bloquea con configuracion_invalida — nunca calcula con 0/1 inventado", () => {
    const resultado = cotizarUnidadAlojamiento({
      tarifa: tarifaHabitacion,
      distribucion: { unidades: [{ adultos: NaN, menores: [] }] },
      noches: 3,
    });
    assert.equal(esBloqueado(resultado), true);
    if (!esBloqueado(resultado)) return;
    assert.equal(resultado.codigo, "configuracion_invalida");
  });
});
