// #40 · H0 — la ficha CRM ya no interpola el documento/email del contacto en un filtro `.or(...)`.
//
// Se ejecuta la función REAL `cargarVentasDeContacto` contra un cliente simulado que registra cada
// llamada del constructor de consultas; el simulado NO tiene `.or`, así que cualquier regresión a ese
// estilo falla en la propia prueba. Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cargarVentasDeContacto, condicionesVentasDeContacto, escaparLike, fusionarVentas, COLUMNAS_FICHA_VENTAS,
  type VentaFicha,
} from "../lib/crm/fichaVentas.ts";

const venta = (numero: string, fecha: string | null, extra: Partial<VentaFicha> = {}): VentaFicha => ({
  numero_contrato: numero, fecha_venta: fecha, destino: "CARTAGENA", precio_venta: 1_000_000, estado: "confirmado", ...extra,
});

type Llamada = { tabla: string; op: string; args: unknown[] };

/** Cliente simulado: `.or` no existe. Cada consulta devuelve las filas configuradas para su condición. */
function clienteSimulado(respuestas: (cond: { op: string; col: string; val: string }) => { data: unknown; error?: unknown }) {
  const llamadas: Llamada[] = [];
  const sb = {
    from(tabla: string) {
      llamadas.push({ tabla, op: "from", args: [tabla] });
      let cond: { op: string; col: string; val: string } | null = null;
      const b = {
        select(cols: string) { llamadas.push({ tabla, op: "select", args: [cols] }); return b; },
        eq(col: string, val: string) { llamadas.push({ tabla, op: "eq", args: [col, val] }); cond = { op: "eq", col, val }; return b; },
        ilike(col: string, val: string) { llamadas.push({ tabla, op: "ilike", args: [col, val] }); cond = { op: "ilike", col, val }; return b; },
        order(col: string, o: unknown) { llamadas.push({ tabla, op: "order", args: [col, o] }); return b; },
        then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
          return Promise.resolve(respuestas(cond!)).then(ok, ko);
        },
      };
      return b;
    },
  };
  return { sb: sb as never, llamadas };
}

describe("escaparLike", () => {
  test("backslash, % y _ pasan a ser literales", () => {
    assert.equal(escaparLike("100%_ok\\x"), "100\\%\\_ok\\\\x");
  });
  test("* (comodín de PostgREST en like/ilike) se vuelve un solo carácter, nunca un comodín libre", () => {
    assert.equal(escaparLike("a*b"), "a_b");
    assert.ok(!escaparLike("**").includes("*"));
  });
  test("texto normal intacto", () => {
    assert.equal(escaparLike("Ana María Pérez"), "Ana María Pérez");
  });
});

describe("condicionesVentasDeContacto — misma semántica de antes", () => {
  test("documento y email: dos igualdades exactas literales", () => {
    assert.deepEqual(condicionesVentasDeContacto({ documento: "123", email: "a@b.co", nombre: "Ana" }), [
      { columna: "cliente_documento", operador: "eq", valor: "123" },
      { columna: "cliente_email", operador: "eq", valor: "a@b.co" },
    ]);
  });
  test("solo documento, o solo email", () => {
    assert.equal(condicionesVentasDeContacto({ documento: "123", email: null, nombre: "Ana" }).length, 1);
    assert.deepEqual(condicionesVentasDeContacto({ documento: null, email: "a@b.co", nombre: "Ana" })[0].columna, "cliente_email");
  });
  test("sin documento ni email: nombre con ilike y comodines escapados", () => {
    assert.deepEqual(condicionesVentasDeContacto({ documento: null, email: null, nombre: "Ana_100%" }), [
      { columna: "cliente", operador: "ilike", valor: "%Ana\\_100\\%%" },
    ]);
  });
  test("con documento o email, el nombre NO se usa (no se ensancha el cruce)", () => {
    for (const c of [{ documento: "1", email: null }, { documento: null, email: "x@y.z" }]) {
      assert.ok(condicionesVentasDeContacto({ ...c, nombre: "Ana" }).every((k) => k.columna !== "cliente"));
    }
  });
  test("vacíos: ninguna condición", () => {
    assert.deepEqual(condicionesVentasDeContacto({ documento: "", email: "", nombre: "" }), []);
    assert.deepEqual(condicionesVentasDeContacto({ documento: null, email: null, nombre: null }), []);
  });
});

describe("fusionarVentas", () => {
  test("no repite contratos y ordena por fecha descendente (sin fecha primero, como Postgres)", () => {
    const r = fusionarVentas([
      [venta("00-0001", "2026-01-10"), venta("00-0002", "2026-03-10")],
      [venta("00-0002", "2026-03-10"), venta("00-0003", null), venta("00-0004", "2026-02-01")],
    ]);
    assert.deepEqual(r.map((v) => v.numero_contrato), ["00-0003", "00-0002", "00-0004", "00-0001"]);
  });
  test("misma fecha: desempate estable por contrato descendente", () => {
    const r = fusionarVentas([[venta("00-0005", "2026-05-05"), venta("00-0006", "2026-05-05")]]);
    assert.deepEqual(r.map((v) => v.numero_contrato), ["00-0006", "00-0005"]);
  });
  test("listas vacías", () => {
    assert.deepEqual(fusionarVentas([]), []);
    assert.deepEqual(fusionarVentas([[], []]), []);
  });
});

describe("cargarVentasDeContacto — consultas literales", () => {
  const ESPECIALES_DOC = ["123,cliente.ilike.%", "1),precio_venta.gt.0", "9*9", "a\\b", "x'y\"z", "1.020.304", " 77 ", "(1,2)", "1;drop table ventas"];
  const ESPECIALES_EMAIL = ["a@b.co,estado.eq.x", "a+b@c.co", "o'brien@x.co", "x@y.z)", "%@%", "a b@c.co"];

  for (const doc of ESPECIALES_DOC) {
    test(`documento ${JSON.stringify(doc)} viaja LITERAL a .eq y no cambia la forma de la consulta`, async () => {
      const { sb, llamadas } = clienteSimulado(() => ({ data: [] }));
      await cargarVentasDeContacto(sb, { documento: doc, email: null, nombre: "Ana" });
      assert.deepEqual(llamadas.filter((l) => l.op === "eq").map((l) => l.args), [["cliente_documento", doc]]);
      assert.deepEqual(llamadas.map((l) => l.op), ["from", "select", "eq", "order"]);
      assert.deepEqual(llamadas.find((l) => l.op === "select")!.args, [COLUMNAS_FICHA_VENTAS]);
    });
  }

  for (const email of ESPECIALES_EMAIL) {
    test(`email ${JSON.stringify(email)} viaja LITERAL a .eq`, async () => {
      const { sb, llamadas } = clienteSimulado(() => ({ data: [] }));
      await cargarVentasDeContacto(sb, { documento: null, email, nombre: "Ana" });
      assert.deepEqual(llamadas.filter((l) => l.op === "eq").map((l) => l.args), [["cliente_email", email]]);
    });
  }

  test("documento y email: dos consultas separadas, sin fusionarlos en un mismo filtro", async () => {
    const { sb, llamadas } = clienteSimulado(() => ({ data: [] }));
    await cargarVentasDeContacto(sb, { documento: "1,2", email: "a@b.co,c", nombre: null });
    assert.equal(llamadas.filter((l) => l.op === "from").length, 2);
    assert.deepEqual(llamadas.filter((l) => l.op === "eq").map((l) => l.args), [["cliente_documento", "1,2"], ["cliente_email", "a@b.co,c"]]);
  });

  test("deduplica contratos que coinciden por documento Y por email", async () => {
    const { sb } = clienteSimulado((c) => ({
      data: c.col === "cliente_documento"
        ? [venta("00-0001", "2026-01-01"), venta("00-0002", "2026-02-01")]
        : [venta("00-0002", "2026-02-01"), venta("00-0003", "2026-03-01")],
    }));
    const r = await cargarVentasDeContacto(sb, { documento: "123", email: "a@b.co", nombre: null });
    assert.deepEqual(r.map((v) => v.numero_contrato), ["00-0003", "00-0002", "00-0001"]);
  });

  test("fallback por nombre: un solo ilike con comodines escapados", async () => {
    const { sb, llamadas } = clienteSimulado(() => ({ data: [venta("00-0009", "2026-04-04")] }));
    const r = await cargarVentasDeContacto(sb, { documento: null, email: null, nombre: "Ana_%\\*" });
    assert.deepEqual(llamadas.filter((l) => l.op === "ilike").map((l) => l.args), [["cliente", "%Ana\\_\\%\\\\_%"]]);
    assert.equal(llamadas.filter((l) => l.op === "eq").length, 0);
    assert.deepEqual(r.map((v) => v.numero_contrato), ["00-0009"]);
  });

  test("sin documento, email ni nombre: no consulta nada", async () => {
    const { sb, llamadas } = clienteSimulado(() => ({ data: [venta("x", null)] }));
    assert.deepEqual(await cargarVentasDeContacto(sb, { documento: null, email: null, nombre: null }), []);
    assert.equal(llamadas.length, 0);
  });

  test("una consulta con error cuenta como sin filas (como antes), sin lanzar", async () => {
    const { sb } = clienteSimulado((c) => (c.col === "cliente_documento" ? { data: null, error: { code: "42501" } } : { data: [venta("00-0007", "2026-07-07")] }));
    const r = await cargarVentasDeContacto(sb, { documento: "1", email: "a@b.co", nombre: null });
    assert.deepEqual(r.map((v) => v.numero_contrato), ["00-0007"]);
  });

  test("permisos: solo lee `ventas` con el cliente recibido; nada de escritura ni de otras tablas", async () => {
    const { sb, llamadas } = clienteSimulado(() => ({ data: [] }));
    await cargarVentasDeContacto(sb, { documento: "1", email: "a@b.co", nombre: "Ana" });
    assert.ok(llamadas.every((l) => l.tabla === "ventas"));
    assert.ok(llamadas.every((l) => ["from", "select", "eq", "order"].includes(l.op)));
  });
});

describe("cableado de la página", () => {
  const leer = (r: string) => readFileSync(new URL(r, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const pagina = leer("../app/(crm)/crm/[id]/page.tsx");
  const lib = leer("../lib/crm/fichaVentas.ts");
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\s\/\/.*$/, "").replace(/^\s*\/\/.*$/, "")).join("\n");

  test("ni la página ni el módulo usan .or( con texto del contacto", () => {
    assert.ok(!/\.or\(/.test(sinComentarios(pagina)));
    assert.ok(!/\.or\(/.test(sinComentarios(lib)));
  });
  test("la página delega en cargarVentasDeContacto y no interpola `${c.documento}`/`${c.email}`", () => {
    assert.match(pagina, /import \{ cargarVentasDeContacto \} from "@\/lib\/crm\/fichaVentas";/);
    assert.match(pagina, /await cargarVentasDeContacto\(sb, c\)/);
    assert.ok(!/\$\{c\.(documento|email)\}/.test(pagina));
    assert.ok(!/sb\.from\("ventas"\)/.test(pagina), "la consulta de ventas vive solo en el módulo");
  });
  test("el cálculo de «Total comprado» no cambia: solo ventas no canceladas", () => {
    assert.match(pagina, /const vigentes = ventas\.filter\(\(v\) => !\["cancelado", "cancelada"\]\.includes\(\(v\.estado \?\? ""\)\.toLowerCase\(\)\)\);/);
    assert.match(pagina, /const totalComprado = vigentes\.reduce\(\(s, v\) => s \+ \(Number\(v\.precio_venta\) \|\| 0\), 0\);/);
  });
});
