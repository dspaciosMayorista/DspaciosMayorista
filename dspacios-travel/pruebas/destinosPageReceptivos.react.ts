// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Ejecuta la PÁGINA real de Producto → Destinos (`page.tsx`, Server
// Component) con un cliente Supabase falso y renderiza su HTML:
//   - rol autorizado: consulta servicios_adicionales (id, nombre, destino_id;
//     categoría de receptivo, con destino; orden nombre+id) y muestra el
//     conteo, incluido un "0 receptivos" verificado;
//   - de ESAS mismas filas salen las listas precargadas que recibe
//     DestinosLista: solo destinos chicos (≤ LIMITE_PRECARGA_POR_DESTINO),
//     nunca en un fallo;
//   - control_vuelo / rol nulo / error o excepción al obtener el rol: NO
//     consulta servicios_adicionales y NO muestra conteo;
//   - página mal formada (data null sin error) o rechazo DESPUÉS de páginas
//     válidas: sin conteo (ni 0 ni parcial);
//   - en todos los casos el listado de destinos se renderiza igual.
// `@/lib/supabase/server` (en page.tsx y en lib/roles.ts) se sustituye por
// supabaseServerStub.mjs vía reactLoader; el predicado de rol es el REAL
// (`puedeEscribir("producto", rol)` de lib/roles.ts).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { renderToStaticMarkup } = await import("react-dom/server");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { default: DestinosPage } = await import("../app/(dashboard)/dashboard/producto/destinos/page.tsx");
const { DestinosLista } = await import("../app/(dashboard)/dashboard/producto/destinos/DestinosLista.tsx");
const { LIMITE_PRECARGA_POR_DESTINO } = await import("../lib/producto/receptivos.ts");

const DESTINOS = [
  { id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", hoteles: [{ id: 10, nombre: "Hotel Uno" }] },
  { id: 2, nombre: "SANTA MARTA", codigo_iata: "SMR", pais: "Colombia", hoteles: [] },
];

type Respuesta = { data: unknown; error: unknown } | null | undefined | Error;

function clienteFalso(opts: { rol: Respuesta | "lanza"; paginas?: Respuesta[] }) {
  const reg = { rpc: [] as string[], consultasServicios: 0, rangos: [] as Array<[number, number]>, cadena: [] as unknown[] };
  let i = 0;
  const paginas = opts.paginas ?? [];
  const sb = {
    rpc(nombre: string) {
      reg.rpc.push(nombre);
      if (opts.rol === "lanza") return Promise.reject(new Error("red caída al pedir mi_rol"));
      return Promise.resolve(opts.rol);
    },
    from(tabla: string) {
      if (tabla === "destinos") {
        return { select: () => ({ order: async () => ({ data: DESTINOS, error: null }) }) };
      }
      if (tabla === "servicios_adicionales") {
        reg.consultasServicios += 1;
        const b = {
          select(c: string) { reg.cadena.push(["select", c]); return b; },
          in(c: string, v: unknown) { reg.cadena.push(["in", c, v]); return b; },
          not(c: string, op: string, v: unknown) { reg.cadena.push(["not", c, op, v]); return b; },
          order(c: string) { reg.cadena.push(["order", c]); return b; },
          range(desde: number, hasta: number) {
            reg.rangos.push([desde, hasta]);
            // Sin `??`: una respuesta null/undefined debe llegar tal cual.
            const p = i < paginas.length ? paginas[i++] : { data: [], error: null };
            return p instanceof Error ? Promise.reject(p) : Promise.resolve(p);
          },
        };
        return b;
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    },
  };
  return { sb, reg };
}

// Props que la página le entrega a <DestinosLista> (recorriendo el árbol de
// elementos que devuelve el Server Component, antes de renderizarlo).
type PropsLista = { receptivosPorDestino: Record<number, number> | null; receptivosPrecargados: Record<number, { id: number; nombre: string }[]> | null };
function propsDeLista(el: unknown): PropsLista | null {
  if (!el || typeof el !== "object") return null;
  if (Array.isArray(el)) { for (const x of el) { const r = propsDeLista(x); if (r) return r; } return null; }
  const e = el as { type?: unknown; props?: { children?: unknown } };
  if (e.type === DestinosLista) return e.props as unknown as PropsLista;
  return propsDeLista(e.props?.children);
}

async function renderPagina(opts: Parameters<typeof clienteFalso>[0]) {
  const { sb, reg } = clienteFalso(opts);
  __setClient(sb);
  const arbol = await DestinosPage();
  const props = propsDeLista(arbol);
  assert.ok(props, "la página renderiza DestinosLista");
  const html = renderToStaticMarkup(arbol);
  const texto = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return { html, texto, reg, props: props! };
}

// Fila tal como la devuelve la consulta de la página.
const fila = (id: number, destino_id: number) => ({ id, nombre: `Receptivo ${id}`, destino_id });

const insigniasReceptivos = (texto: string) => [...texto.matchAll(/\b\d+ receptivos?\b/g)].map((m) => m[0]);

function listadoIntacto(texto: string) {
  assert.ok(texto.includes("CARTAGENA") && texto.includes("SANTA MARTA"), "el listado de destinos se renderiza");
  assert.ok(texto.includes("1 hotel") && texto.includes("0 hoteles"), "las insignias de hoteles siguen");
}

afterEach(() => __resetClient());

for (const rol of ["superadmin", "gerencia", "administracion", "operaciones"]) {
  test(`${rol}: consulta receptivos (id/nombre/destino, receptivo, con destino) y muestra el conteo, incluido un 0 verificado`, async (t) => {
    t.mock.method(console, "error", () => {});
    const { texto, reg, props } = await renderPagina({
      rol: { data: rol, error: null },
      paginas: [{ data: [fila(1, 1), fila(2, 1)], error: null }],
    });
    listadoIntacto(texto);
    assert.deepEqual(reg.rpc, ["mi_rol"]);
    // Una consulta por página: la de datos (2 filas) y la vacía que cierra,
    // que arranca donde terminaron las filas REALES recibidas.
    assert.deepEqual(reg.rangos, [[0, 999], [2, 1001]]);
    assert.equal(reg.consultasServicios, reg.rangos.length);
    const cadenaPorPagina = [
      ["select", "id, nombre, destino_id"],
      ["in", "categoria", ["tour_traslado"]],
      ["not", "destino_id", "is", null],
      ["order", "nombre"],
      ["order", "id"],
    ];
    assert.deepEqual(reg.cadena, [...cadenaPorPagina, ...cadenaPorPagina], "cada página: id/nombre/destino, receptivo, con destino, orden total");
    assert.deepEqual(insigniasReceptivos(texto), ["2 receptivos", "0 receptivos"]);
    // Mismas filas → conteo y lista precargada coinciden; el destino en 0 no se precarga (no hay lista que abrir).
    assert.deepEqual(props.receptivosPorDestino, { 1: 2, 2: 0 });
    assert.deepEqual(props.receptivosPrecargados, { 1: [{ id: 1, nombre: "Receptivo 1" }, { id: 2, nombre: "Receptivo 2" }] });
  });
}

const sinPermiso: Array<[string, Respuesta | "lanza"]> = [
  ["control_vuelo", { data: "control_vuelo", error: null }],
  ["rol nulo (sin rol / inactivo)", { data: null, error: null }],
  ["error al obtener el rol", { data: null, error: { message: "JWT expired" } }],
  ["excepción al obtener el rol", "lanza"],
];

for (const [caso, rol] of sinPermiso) {
  test(`${caso}: NO consulta servicios_adicionales, no muestra conteo y conserva el listado`, async (t) => {
    const errores = t.mock.method(console, "error", () => {});
    const { texto, reg, props } = await renderPagina({ rol, paginas: [{ data: [fila(1, 1)], error: null }] });
    assert.equal(props.receptivosPrecargados, null, "sin permiso/rol: nada precargado");
    assert.equal(props.receptivosPorDestino, null);
    listadoIntacto(texto);
    assert.equal(reg.consultasServicios, 0, "la consulta paginada ni se inicia");
    assert.deepEqual(reg.rangos, []);
    assert.deepEqual(insigniasReceptivos(texto), [], "ni '0 receptivos' ni ningún conteo");
    const esError = caso.startsWith("error") || caso.startsWith("excepción");
    assert.equal(errores.mock.callCount() > 0, esError, esError ? "el fallo de rol se registra" : "sin permiso no es un error");
  });
}

const paginaLlena = () => Array.from({ length: 1000 }, (_, k) => fila(k + 1, k % 2 === 0 ? 1 : 2));
const fallosDeConsulta: Array<[string, Respuesta[]]> = [
  ["data null sin error después de una página válida", [{ data: paginaLlena(), error: null }, { data: null, error: null }]],
  ["respuesta ausente después de una página válida", [{ data: paginaLlena(), error: null }, undefined]],
  ["fila mal formada después de una página válida", [{ data: paginaLlena(), error: null }, { data: [{ id: 3 }], error: null }]],
  ["rechazo después de una página válida", [{ data: paginaLlena(), error: null }, new Error("socket cerrado")]],
  ["error de PostgREST en la primera página", [{ data: null, error: { message: "permission denied" } }]],
  ["data null sin error en la primera página", [{ data: null, error: null }]],
];

for (const [caso, paginas] of fallosDeConsulta) {
  test(`superadmin + ${caso}: sin conteo (ni 0 ni parcial), listado intacto, fallo registrado`, async (t) => {
    const errores = t.mock.method(console, "error", () => {});
    const { texto, reg, props } = await renderPagina({ rol: { data: "superadmin", error: null }, paginas });
    assert.equal(props.receptivosPrecargados, null, "fallo: ninguna lista precargada (ni vacía ni parcial)");
    listadoIntacto(texto);
    assert.equal(reg.rangos.length, paginas.length, "se detiene en la página anómala");
    assert.deepEqual(insigniasReceptivos(texto), [], "ni 0 ni 500/1000 parciales");
    assert.ok(errores.mock.callCount() > 0, "el fallo se registra en el log");
  });
}

// Guarda del propio arnés: el render sí sabe mostrar el conteo cuando todo va bien.
test("control del arnés: sin anomalías, 2 páginas válidas se suman completas", async (t) => {
  t.mock.method(console, "error", () => {});
  const { texto, reg, props } = await renderPagina({
    rol: { data: "operaciones", error: null },
    paginas: [{ data: paginaLlena(), error: null }, { data: [fila(5000, 2)], error: null }],
  });
  assert.deepEqual(reg.rangos, [[0, 999], [1000, 1999], [1001, 2000]], "avanza por filas reales recibidas");
  assert.deepEqual(insigniasReceptivos(texto), ["500 receptivos", "501 receptivos"]);
  // Muchos receptivos (> LIMITE_PRECARGA_POR_DESTINO): contados, NO precargados (se piden al abrir).
  assert.deepEqual(props.receptivosPrecargados, {});
});

test("precarga limitada: 1 y 5 receptivos viajan con la página; con más del límite solo el conteo", async (t) => {
  t.mock.method(console, "error", () => {});
  const muchos = Array.from({ length: LIMITE_PRECARGA_POR_DESTINO + 1 }, (_, k) => fila(100 + k, 2));
  const { texto, props, reg } = await renderPagina({
    rol: { data: "gerencia", error: null },
    paginas: [{ data: [fila(1, 1), ...muchos], error: null }],
  });
  assert.equal(reg.rangos.length, 2, "cero consultas extra: los nombres vienen en la misma consulta del conteo");
  assert.deepEqual(insigniasReceptivos(texto), ["1 receptivo", `${LIMITE_PRECARGA_POR_DESTINO + 1} receptivos`]);
  assert.deepEqual(Object.keys(props.receptivosPrecargados ?? {}), ["1"]);
  assert.deepEqual(props.receptivosPrecargados?.[1], [{ id: 1, nombre: "Receptivo 1" }]);

  const cinco = Array.from({ length: 5 }, (_, k) => fila(10 + k, 1));
  const r2 = await renderPagina({ rol: { data: "gerencia", error: null }, paginas: [{ data: cinco, error: null }] });
  assert.equal(r2.props.receptivosPrecargados?.[1]?.length, 5);
  assert.equal(r2.props.receptivosPorDestino?.[1], 5, "insignia y lista salen de las mismas filas");
});
