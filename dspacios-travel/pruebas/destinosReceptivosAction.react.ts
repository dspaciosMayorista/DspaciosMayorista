// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Ejecuta la Server Action REAL `listarReceptivosDestino`
// (app/(dashboard)/dashboard/producto/destinos/actions.ts) con un cliente
// Supabase falso (supabaseServerStub vía reactLoader) y el predicado de rol
// REAL de lib/roles.ts:
//   - consulta EXACTA: servicios_adicionales, solo id/nombre/destino_id,
//     destino_id = ESE destino, categoría de receptivo, orden por nombre+id,
//     paginada — el mismo criterio que el conteo de la tarjeta;
//   - rol primero: control_vuelo / rol nulo → sin_permiso SIN consultar;
//     error o excepción de rol → error SIN consultar;
//   - falla cerrado: data null tras una página válida, fila de OTRO destino o
//     sin destino, fila sin nombre, error de PostgREST → error (nunca "ok" con
//     una lista incompleta o vacía);
//   - solo id y nombre salen del servidor.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { listarReceptivosDestino } = await import("../app/(dashboard)/dashboard/producto/destinos/actions.ts");

type Respuesta = { data: unknown; error: unknown } | null | undefined | Error;

function clienteFalso(opts: { rol: Respuesta | "lanza"; paginas?: Respuesta[] }) {
  const reg = { consultas: 0, rangos: [] as Array<[number, number]>, cadena: [] as unknown[] };
  let i = 0;
  const paginas = opts.paginas ?? [];
  const sb = {
    rpc(nombre: string) {
      assert.equal(nombre, "mi_rol");
      if (opts.rol === "lanza") return Promise.reject(new Error("red"));
      return Promise.resolve(opts.rol);
    },
    from(tabla: string) {
      assert.equal(tabla, "servicios_adicionales");
      reg.consultas += 1;
      const b = {
        select(c: string) { reg.cadena.push(["select", c]); return b; },
        eq(c: string, v: unknown) { reg.cadena.push(["eq", c, v]); return b; },
        in(c: string, v: unknown) { reg.cadena.push(["in", c, v]); return b; },
        order(c: string) { reg.cadena.push(["order", c]); return b; },
        range(desde: number, hasta: number) {
          reg.rangos.push([desde, hasta]);
          const p = i < paginas.length ? paginas[i++] : { data: [], error: null };
          return p instanceof Error ? Promise.reject(p) : Promise.resolve(p);
        },
      };
      return b;
    },
  };
  return { sb, reg };
}

async function ejecutar(destinoId: number, opts: Parameters<typeof clienteFalso>[0]) {
  const { sb, reg } = clienteFalso(opts);
  __setClient(sb);
  const r = await listarReceptivosDestino(destinoId);
  return { r, reg };
}

const fila = (id: number, nombre: string, destino_id: unknown = 3) => ({ id, nombre, destino_id });

afterEach(() => __resetClient());

test("rol autorizado: consulta exacta (solo ese destino, solo receptivos, id/nombre) y devuelve solo id+nombre", async (t) => {
  t.mock.method(console, "error", () => {});
  const { r, reg } = await ejecutar(3, {
    rol: { data: "operaciones", error: null },
    paginas: [{ data: [fila(501, "City tour"), fila(500, "Traslado aeropuerto")], error: null }],
  });
  assert.deepEqual(r, { estado: "ok", receptivos: [{ id: 501, nombre: "City tour" }, { id: 500, nombre: "Traslado aeropuerto" }] });
  const porPagina = [
    ["select", "id, nombre, destino_id"],
    ["eq", "destino_id", 3],
    ["in", "categoria", ["tour_traslado"]],
    ["order", "nombre"],
    ["order", "id"],
  ];
  assert.deepEqual(reg.cadena, [...porPagina, ...porPagina], "cada página repite los mismos filtros");
  assert.deepEqual(reg.rangos, [[0, 999], [2, 1001]], "paginada, avanza por filas reales");
});

test("0 receptivos verificados: ok con lista vacía (el servidor lo confirmó)", async () => {
  const { r } = await ejecutar(3, { rol: { data: "superadmin", error: null }, paginas: [{ data: [], error: null }] });
  assert.deepEqual(r, { estado: "ok", receptivos: [] });
});

test("más de 1000 receptivos: recorre todas las páginas", async () => {
  const p1 = Array.from({ length: 1000 }, (_, k) => fila(k + 1, `R${k + 1}`));
  const { r, reg } = await ejecutar(3, {
    rol: { data: "gerencia", error: null },
    paginas: [{ data: p1, error: null }, { data: [fila(2000, "Último")], error: null }],
  });
  assert.equal(r.estado, "ok");
  assert.equal(r.estado === "ok" ? r.receptivos.length : 0, 1001);
  assert.deepEqual(reg.rangos, [[0, 999], [1000, 1999], [1001, 2000]]);
});

const sinConsultar: Array<[string, Respuesta | "lanza", string]> = [
  ["control_vuelo", { data: "control_vuelo", error: null }, "sin_permiso"],
  ["venta", { data: "venta", error: null }, "sin_permiso"],
  ["rol nulo", { data: null, error: null }, "sin_permiso"],
  ["error al obtener el rol", { data: null, error: { message: "JWT expired" } }, "error"],
  ["excepción al obtener el rol", "lanza", "error"],
];
for (const [caso, rol, esperado] of sinConsultar) {
  test(`${caso}: ${esperado} y NO consulta servicios_adicionales`, async (t) => {
    t.mock.method(console, "error", () => {});
    const { r, reg } = await ejecutar(3, { rol, paginas: [{ data: [fila(1, "X")], error: null }] });
    assert.deepEqual(r, { estado: esperado });
    assert.equal(reg.consultas, 0);
  });
}

const pagina1000 = () => Array.from({ length: 1000 }, (_, k) => fila(k + 1, `R${k + 1}`));
const fallos: Array<[string, Respuesta[]]> = [
  ["data null sin error tras una página válida", [{ data: pagina1000(), error: null }, { data: null, error: null }]],
  ["fila de OTRO destino", [{ data: [fila(1, "Ajeno", 4)], error: null }]],
  ["fila sin destino (servicio general)", [{ data: [fila(1, "General", null)], error: null }]],
  ["fila sin nombre", [{ data: [{ id: 1, destino_id: 3 }], error: null }]],
  ["error de PostgREST", [{ data: null, error: { message: "permission denied" } }]],
  ["rechazo de la consulta", [new Error("socket cerrado")]],
];
for (const [caso, paginas] of fallos) {
  test(`${caso}: error (nunca 'ok' con lista incompleta o vacía) y se registra`, async (t) => {
    const errores = t.mock.method(console, "error", () => {});
    const { r } = await ejecutar(3, { rol: { data: "administracion", error: null }, paginas });
    assert.deepEqual(r, { estado: "error" });
    assert.ok(errores.mock.callCount() > 0);
  });
}

test("destinoId inválido: error sin tocar Supabase", async () => {
  for (const id of [0, -1, 1.5, Number.NaN, "3" as unknown as number]) {
    const { r, reg } = await ejecutar(id, { rol: { data: "superadmin", error: null } });
    assert.deepEqual(r, { estado: "error" });
    assert.equal(reg.consultas, 0);
  }
});
