// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Ejecuta la PÁGINA real de Producto → Destinos (`page.tsx`, Server
// Component) con un cliente Supabase falso y renderiza su HTML:
//   - rol autorizado: consulta servicios_adicionales (solo destino_id,
//     categoría de receptivo, con destino) y muestra el conteo, incluido un
//     "0 receptivos" verificado;
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

async function renderPagina(opts: Parameters<typeof clienteFalso>[0]) {
  const { sb, reg } = clienteFalso(opts);
  __setClient(sb);
  const html = renderToStaticMarkup(await DestinosPage());
  const texto = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return { html, texto, reg };
}

const insigniasReceptivos = (texto: string) => [...texto.matchAll(/\b\d+ receptivos?\b/g)].map((m) => m[0]);

function listadoIntacto(texto: string) {
  assert.ok(texto.includes("CARTAGENA") && texto.includes("SANTA MARTA"), "el listado de destinos se renderiza");
  assert.ok(texto.includes("1 hotel") && texto.includes("0 hoteles"), "las insignias de hoteles siguen");
}

afterEach(() => __resetClient());

for (const rol of ["superadmin", "gerencia", "administracion", "operaciones"]) {
  test(`${rol}: consulta receptivos (solo destino_id, receptivo, con destino) y muestra el conteo, incluido un 0 verificado`, async (t) => {
    t.mock.method(console, "error", () => {});
    const { texto, reg } = await renderPagina({
      rol: { data: rol, error: null },
      paginas: [{ data: [{ destino_id: 1 }, { destino_id: 1 }], error: null }],
    });
    listadoIntacto(texto);
    assert.deepEqual(reg.rpc, ["mi_rol"]);
    // Una consulta por página: la de datos (2 filas) y la vacía que cierra,
    // que arranca donde terminaron las filas REALES recibidas.
    assert.deepEqual(reg.rangos, [[0, 999], [2, 1001]]);
    assert.equal(reg.consultasServicios, reg.rangos.length);
    const cadenaPorPagina = [
      ["select", "destino_id"],
      ["in", "categoria", ["tour_traslado"]],
      ["not", "destino_id", "is", null],
      ["order", "id"],
    ];
    assert.deepEqual(reg.cadena, [...cadenaPorPagina, ...cadenaPorPagina], "cada página: solo destino_id, receptivo, con destino, orden total");
    assert.deepEqual(insigniasReceptivos(texto), ["2 receptivos", "0 receptivos"]);
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
    const { texto, reg } = await renderPagina({ rol, paginas: [{ data: [{ destino_id: 1 }], error: null }] });
    listadoIntacto(texto);
    assert.equal(reg.consultasServicios, 0, "la consulta paginada ni se inicia");
    assert.deepEqual(reg.rangos, []);
    assert.deepEqual(insigniasReceptivos(texto), [], "ni '0 receptivos' ni ningún conteo");
    const esError = caso.startsWith("error") || caso.startsWith("excepción");
    assert.equal(errores.mock.callCount() > 0, esError, esError ? "el fallo de rol se registra" : "sin permiso no es un error");
  });
}

const paginaLlena = () => Array.from({ length: 1000 }, (_, k) => ({ destino_id: k % 2 === 0 ? 1 : 2 }));
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
    const { texto, reg } = await renderPagina({ rol: { data: "superadmin", error: null }, paginas });
    listadoIntacto(texto);
    assert.equal(reg.rangos.length, paginas.length, "se detiene en la página anómala");
    assert.deepEqual(insigniasReceptivos(texto), [], "ni 0 ni 500/1000 parciales");
    assert.ok(errores.mock.callCount() > 0, "el fallo se registra en el log");
  });
}

// Guarda del propio arnés: el render sí sabe mostrar el conteo cuando todo va bien.
test("control del arnés: sin anomalías, 2 páginas válidas se suman completas", async (t) => {
  t.mock.method(console, "error", () => {});
  const { texto, reg } = await renderPagina({
    rol: { data: "operaciones", error: null },
    paginas: [{ data: paginaLlena(), error: null }, { data: [{ destino_id: 2 }], error: null }],
  });
  assert.deepEqual(reg.rangos, [[0, 999], [1000, 1999], [1001, 2000]], "avanza por filas reales recibidas");
  assert.deepEqual(insigniasReceptivos(texto), ["500 receptivos", "501 receptivos"]);
});
