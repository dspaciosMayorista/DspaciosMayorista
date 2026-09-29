// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Prueba de la Server Action REAL `generarVouchersServicios`
// (contratos/[numero]/voucher-actions.ts) con un cliente Supabase falso:
//   - El voucher solo muestra proveedores_datos_sensibles.voucher_contacto.
//   - proveedores.contacto (puede ser un número INTERNO) nunca se usa como
//     respaldo: si voucher_contacto falta, está vacío o solo tiene espacios,
//     el voucher queda con el texto neutro y sin ningún número.
//   - La consulta del paquete ya ni siquiera pide `contacto` del catálogo.
// El cliente falso devuelve `contacto` de todas formas (como si la consulta lo
// pidiera), para demostrar que el valor no llega al voucher aunque estuviera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __setClient } from "./support/stubs/supabaseServerStub.mjs";
import { __resetRevalidadas } from "./support/stubs/nextCacheStub.mjs";
import { generarVouchersServicios } from "../app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts";

const CONTACTO_INTERNO = "INTERNO 300 999 0000";
const NEUTRO = "Podrá encontrar al proveedor de servicios en el punto de encuentro indicado.";

type Fila = Record<string, unknown>;
type Consulta = { tabla: string; select?: string; filtros: string[] };

function clienteFalso(sensibles: Fila[]) {
  const consultas: Consulta[] = [];
  const insertados: Fila[] = [];
  const datos: Record<string, Fila[] | Fila | null> = {
    ventas: {
      numero_contrato: "00-9191", paquete_armado_id: 7, precio_venta: 100, fecha_salida: "2026-10-01",
      fecha_regreso: "2026-10-04", tipo_asesor: "interno", asesor: "Asesor", destino: "SAN ANDRES",
      cliente: "Cliente Prueba", pax: 2, hotel: "Hotel X", plan_nombre: null,
    },
    contrato_hoteles: [],
    contrato_items: [],
    contrato_pasajeros: [],
    usuarios: { rol: "superadmin" },
    armado_servicios: [
      { incluido: true, servicios_adicionales: { nombre: "Traslado aeropuerto", categoria: "traslado",
        proveedores: { id: 1, nombre: "Operador Uno", contacto: CONTACTO_INTERNO } } },
      { incluido: true, servicios_adicionales: { nombre: "Tour isla", categoria: "tour",
        proveedores: { id: 2, nombre: "Operador Dos", contacto: CONTACTO_INTERNO } } },
    ],
    proveedores_datos_sensibles: sensibles,
    vouchers: [],
  };

  function builder(tabla: string) {
    const c: Consulta = { tabla, filtros: [] };
    consultas.push(c);
    let unico = false;
    const resultado = () => {
      const d = datos[tabla] ?? null;
      return { data: unico ? (Array.isArray(d) ? d[0] ?? null : d) : d, error: null };
    };
    const b: Record<string, unknown> = {
      select(cols: string) { c.select = cols; return b; },
      eq(col: string, v: unknown) { c.filtros.push(`${col}=${String(v)}`); return b; },
      neq(col: string, v: unknown) { c.filtros.push(`${col}!=${String(v)}`); return b; },
      in(col: string, v: unknown[]) { c.filtros.push(`${col} in ${v.join(",")}`); return b; },
      not() { return b; },
      order() { return b; },
      delete() { return b; },
      single() { unico = true; return b; },
      maybeSingle() { unico = true; return b; },
      insert(filas: Fila[]) { insertados.push(...filas); return Promise.resolve({ error: null }); },
      then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
        return Promise.resolve(resultado()).then(ok, ko);
      },
    };
    return b;
  }

  const sb = {
    from: builder,
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
  };
  return { sb, consultas, insertados };
}

async function generar(sensibles: Fila[]) {
  const f = clienteFalso(sensibles);
  __resetRevalidadas();
  __setClient(f.sb);
  const r = await generarVouchersServicios("00-9191");
  assert.deepEqual(r, { ok: true, creados: 2 });
  const porProveedor = new Map(f.insertados.map((v) => [v.proveedor as string, v.contenido as Record<string, unknown>]));
  return { ...f, porProveedor };
}

test("sin voucher_contacto (null, vacío o solo espacios) el voucher no revela el contacto interno", async () => {
  for (const [etiqueta, sensibles] of [
    ["sin fila sensible", []],
    ["voucher_contacto null", [{ proveedor_id: 1, voucher_contacto: null }, { proveedor_id: 2, voucher_contacto: null }]],
    ["voucher_contacto vacío/espacios", [{ proveedor_id: 1, voucher_contacto: "" }, { proveedor_id: 2, voucher_contacto: "   " }]],
  ] as const) {
    const { insertados, porProveedor } = await generar([...sensibles]);
    assert.equal(insertados.length, 2, `${etiqueta}: un voucher por proveedor`);
    assert.doesNotMatch(JSON.stringify(insertados), /INTERNO 300 999 0000/, `${etiqueta}: el contacto interno no aparece en ningún voucher`);
    assert.equal(porProveedor.get("Operador Uno")?.infoImportante, NEUTRO, `${etiqueta}: texto neutro`);
    assert.equal(porProveedor.get("Operador Dos")?.infoImportante, NEUTRO, `${etiqueta}: texto neutro`);
  }
});

test("con voucher_contacto, el voucher usa ese número (y solo ese)", async () => {
  const { insertados, porProveedor } = await generar([
    { proveedor_id: 1, voucher_contacto: " +57 320 111 2222 " },
    { proveedor_id: 2, voucher_contacto: null },
  ]);
  assert.match(String(porProveedor.get("Operador Uno")?.infoImportante), /comunicarse al \+57 320 111 2222\.$/);
  assert.equal(porProveedor.get("Operador Dos")?.infoImportante, NEUTRO, "el otro proveedor no hereda nada");
  assert.doesNotMatch(JSON.stringify(insertados), /INTERNO 300 999 0000/);
});

test("la consulta del paquete no pide proveedores.contacto; el contacto sale solo de la tabla sensible", async () => {
  const { consultas } = await generar([]);
  const arm = consultas.find((q) => q.tabla === "armado_servicios");
  assert.ok(arm?.select, "consulta armado_servicios");
  assert.match(arm.select, /proveedores\(id, nombre\)/);
  assert.doesNotMatch(arm.select, /contacto/);
  const sens = consultas.find((q) => q.tabla === "proveedores_datos_sensibles");
  assert.equal(sens?.select, "proveedor_id, voucher_contacto");
  assert.ok(sens?.filtros.includes("tenant=mayorista"));
});
