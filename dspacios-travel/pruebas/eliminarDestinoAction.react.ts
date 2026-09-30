// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Ejecuta las Server Actions REALES `eliminarDestino` y `usoDestino`
// (app/(dashboard)/dashboard/tarifario/actions.ts) con un cliente Supabase
// falso (supabaseServerStub vía reactLoader), `next/cache` registrado
// (nextCacheStub) y el predicado de rol REAL de lib/roles.ts.
// Nunca `{ ok: true }` sin que la operación haya ocurrido:
//   - rol sin permiso / rol nulo / error de rol → error, sin tocar datos;
//   - origen inexistente → error, sin DELETE ni RPC (la RPC haría `return`
//     silencioso y eso no es éxito);
//   - DELETE que afecta cero filas (RLS o ya no existe) → error;
//   - fusión: error de la RPC tal cual; y si tras la RPC el origen sigue
//     existiendo → error;
//   - 23503 conserva su mensaje; solo un éxito real revalida las rutas.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __revalidadas, __resetRevalidadas } = await import("./support/stubs/nextCacheStub.mjs");
const { eliminarDestino, usoDestino } = await import("../app/(dashboard)/dashboard/tarifario/actions.ts");

type Err = { message: string; code?: string } | null;
type Opts = {
  rol?: { data: unknown; error: Err } | "lanza";
  existe?: boolean;                 // estado inicial del destino origen
  errorLectura?: Err;               // error al leer destinos
  borrado?: { filas: number; error?: Err }; // resultado del DELETE directo
  rpcError?: Err;                   // error de fn_fusionar_destino
  rpcNoBorra?: boolean;             // la RPC "termina" pero el origen sigue
  hoteles?: number;
};

function clienteFalso(o: Opts) {
  const reg = { ops: [] as string[], rpcArgs: null as unknown };
  let existe = o.existe ?? true;
  const sb = {
    rpc(nombre: string, args?: unknown) {
      if (nombre === "mi_rol") {
        reg.ops.push("rpc mi_rol");
        if (o.rol === "lanza") return Promise.reject(new Error("red"));
        return Promise.resolve(o.rol ?? { data: "operaciones", error: null });
      }
      assert.equal(nombre, "fn_fusionar_destino");
      reg.ops.push("rpc fn_fusionar_destino");
      reg.rpcArgs = args;
      if (!o.rpcError && !o.rpcNoBorra) existe = false;
      return Promise.resolve({ data: null, error: o.rpcError ?? null });
    },
    from(tabla: string) {
      if (tabla === "hoteles") {
        return { select: () => ({ eq: async () => ({ count: o.hoteles ?? 0, error: null }) }) };
      }
      assert.equal(tabla, "destinos");
      return {
        select(cols: string) {
          assert.equal(cols, "id");
          return { eq: () => ({ maybeSingle: async () => {
            reg.ops.push("leer destino");
            return { data: o.errorLectura ? null : existe ? { id: 1 } : null, error: o.errorLectura ?? null };
          } }) };
        },
        delete() {
          return { eq: () => ({ select: async (cols: string) => {
            assert.equal(cols, "id");
            reg.ops.push("delete destino");
            const r = o.borrado ?? { filas: 1 };
            if (!r.error && r.filas > 0) existe = false;
            return { data: r.error ? null : Array.from({ length: r.filas }, () => ({ id: 1 })), error: r.error ?? null };
          } }) };
        },
      };
    },
  };
  return { sb, reg };
}

async function ejecutar(o: Opts, id = 1, reasignarA?: number) {
  const { sb, reg } = clienteFalso(o);
  __setClient(sb);
  const r = await eliminarDestino(id, reasignarA);
  return { r, reg, revalidadas: __revalidadas() };
}

afterEach(() => { __resetClient(); __resetRevalidadas(); });

const RUTAS = ["/dashboard/tarifario", "/dashboard/producto/destinos"];

// ── Borrado directo ───────────────────────────────────────────────────────

test("autorizado + contenido vacío: borra exactamente la fila y revalida", async () => {
  const { r, reg, revalidadas } = await ejecutar({});
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(reg.ops, ["rpc mi_rol", "leer destino", "delete destino"]);
  assert.deepEqual(revalidadas, RUTAS);
});

test("DELETE que afecta CERO filas (RLS o ya no estaba) → error, nunca { ok: true }", async () => {
  const { r, revalidadas } = await ejecutar({ borrado: { filas: 0 } });
  assert.deepEqual(r, { ok: false, error: "No se eliminó el destino: no tienes permiso para borrarlo o ya no existe." });
  assert.deepEqual(revalidadas, []);
});

test("23503 (destino en uso): conserva el mensaje con la pista de hoteles", async () => {
  const { r } = await ejecutar({ borrado: { filas: 0, error: { message: "fk", code: "23503" } }, hoteles: 2 });
  assert.deepEqual(r, { ok: false, error: "No se puede eliminar: el destino está en uso por 2 hotel(es). Elige a qué destino mover su contenido y vuelve a intentar." });
});

test("0 hoteles pero en uso (5 receptivos): el 23503 no inventa hoteles", async () => {
  const { r } = await ejecutar({ borrado: { filas: 0, error: { message: "fk", code: "23503" } }, hoteles: 0 });
  assert.deepEqual(r, { ok: false, error: "No se puede eliminar: el destino está en uso. Elige a qué destino mover su contenido y vuelve a intentar." });
});

// ── Permiso ───────────────────────────────────────────────────────────────

for (const [caso, rol, error] of [
  ["control_vuelo", { data: "control_vuelo", error: null }, "Tu rol no tiene permiso para eliminar destinos."],
  ["venta", { data: "venta", error: null }, "Tu rol no tiene permiso para eliminar destinos."],
  ["rol nulo (sin rol / inactivo)", { data: null, error: null }, "Tu rol no tiene permiso para eliminar destinos."],
  ["error al obtener el rol", { data: null, error: { message: "JWT expired" } }, "No se pudo verificar tu permiso para eliminar destinos. Intenta de nuevo."],
  ["excepción al obtener el rol", "lanza", "No se pudo verificar tu permiso para eliminar destinos. Intenta de nuevo."],
] as const) {
  for (const reasignarA of [undefined, 2]) {
    test(`${caso} (${reasignarA ? "fusión" : "borrado directo"}): error sin tocar datos`, async () => {
      const { r, reg, revalidadas } = await ejecutar({ rol: rol as Opts["rol"] }, 1, reasignarA);
      assert.deepEqual(r, { ok: false, error });
      assert.deepEqual(reg.ops, ["rpc mi_rol"], "ni lectura, ni DELETE, ni RPC de fusión");
      assert.deepEqual(revalidadas, []);
    });
  }
}

for (const rol of ["superadmin", "gerencia", "administracion", "operaciones"]) {
  test(`${rol}: autorizado (mismo set que la policy de destinos y fn_fusionar_destino)`, async () => {
    const { r } = await ejecutar({ rol: { data: rol, error: null } });
    assert.deepEqual(r, { ok: true });
  });
}

// ── Origen inexistente ────────────────────────────────────────────────────

test("origen inexistente, borrado directo: error, sin DELETE", async () => {
  const { r, reg } = await ejecutar({ existe: false });
  assert.deepEqual(r, { ok: false, error: "El destino ya no existe (pudo eliminarse en otra sesión). Recarga la página." });
  assert.ok(!reg.ops.includes("delete destino"));
});

test("origen inexistente, fusión: error y la RPC NO se llama (su `return` silencioso no es éxito)", async () => {
  const { r, reg, revalidadas } = await ejecutar({ existe: false }, 1, 2);
  assert.deepEqual(r, { ok: false, error: "El destino ya no existe (pudo eliminarse en otra sesión). Recarga la página." });
  assert.ok(!reg.ops.includes("rpc fn_fusionar_destino"));
  assert.deepEqual(revalidadas, []);
});

test("error al comprobar el origen: error, sin operar", async () => {
  const { r, reg } = await ejecutar({ errorLectura: { message: "timeout" } }, 1, 2);
  assert.deepEqual(r, { ok: false, error: "No se pudo comprobar el destino. Intenta de nuevo." });
  assert.deepEqual(reg.ops, ["rpc mi_rol", "leer destino"]);
});

// ── Fusión ────────────────────────────────────────────────────────────────

test("fusión (p. ej. 0 hoteles / 5 receptivos): llama la RPC de la 112, confirma que el origen ya no existe y revalida", async () => {
  const { r, reg, revalidadas } = await ejecutar({}, 1, 2);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(reg.rpcArgs, { p_origen: 1, p_destino: 2 });
  assert.deepEqual(reg.ops, ["rpc mi_rol", "leer destino", "rpc fn_fusionar_destino", "leer destino"]);
  assert.deepEqual(revalidadas, RUTAS);
});

test("fusión: el error de la RPC se devuelve tal cual (permisos y validaciones de la 112 intactos)", async () => {
  for (const mensaje of ["No autorizado para fusionar destinos.", "El destino de llegada no existe."]) {
    const { r, revalidadas } = await ejecutar({ rpcError: { message: mensaje } }, 1, 2);
    assert.deepEqual(r, { ok: false, error: mensaje });
    assert.deepEqual(revalidadas, []);
    __resetRevalidadas();
  }
});

test("fusión que 'termina' pero el origen sigue existiendo → error, nunca éxito", async () => {
  const { r, revalidadas } = await ejecutar({ rpcNoBorra: true }, 1, 2);
  assert.deepEqual(r, { ok: false, error: "La fusión no eliminó el destino. Recarga la página y revisa." });
  assert.deepEqual(revalidadas, []);
});

test("mismo destino o ids inválidos: error sin tocar Supabase", async () => {
  for (const [id, reasignarA] of [[1, 1], [0, undefined], [1.5, undefined], [-2, 3], [1, 0], [1, 2.5]] as Array<[number, number | undefined]>) {
    const { r, reg } = await ejecutar({}, id, reasignarA);
    assert.equal(r.ok, false, `${id} → ${reasignarA}`);
    assert.deepEqual(reg.ops, []);
  }
});

// ── usoDestino: permiso de tres estados ───────────────────────────────────

test("usoDestino distingue permiso si / no / desconocido (el rol no resuelto nunca se trata como sin permiso ni como autorizado)", async () => {
  const casos: Array<[Opts["rol"], string]> = [
    [{ data: "gerencia", error: null }, "si"],
    [{ data: "control_vuelo", error: null }, "no"],
    [{ data: null, error: null }, "no"],
    [{ data: null, error: { message: "JWT expired" } }, "desconocido"],
    ["lanza", "desconocido"],
  ];
  for (const [rol, permiso] of casos) {
    const conteos: Record<string, number> = {};
    const sb = {
      rpc: () => (rol === "lanza" ? Promise.reject(new Error("red")) : Promise.resolve(rol)),
      from: (tabla: string) => ({ select: () => ({ eq: async () => { conteos[tabla] = 0; return { count: 0, error: null }; } }) }),
    };
    __setClient(sb);
    const u = await usoDestino(1);
    assert.equal(u.permiso, permiso, JSON.stringify(rol));
    assert.equal(u.alcanceCompleto, permiso === "si");
  }
});
