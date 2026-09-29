import { test } from "node:test";
import assert from "node:assert/strict";
import { __setClient } from "./support/stubs/supabaseServerStub.mjs";
import { __revalidadas, __resetRevalidadas } from "./support/stubs/nextCacheStub.mjs";
import {
  crearProveedor, actualizarProveedor, cargarProveedoresMasivo,
  type ProveedorInput,
} from "../app/(dashboard)/dashboard/producto/proveedores/actions.ts";

const input: ProveedorInput = {
  tipo: "hotelero", nombre: "  Hotel Beta  ", razonSocial: " Beta SAS ",
  nit: " 123 ", ciudad: " Bogotá ", contacto: " Ana ",
  banco: " Banco Uno ", tipoCuenta: " Ahorros ", numeroCuenta: " 987 ",
  politicaReservas: " 50% anticipo ", voucherContacto: " 300123 ",
  aplicaRetencion: true, pctRetencion: 0.025, clasificacion: "costo",
};

const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = [];

function configurar(error: { message: string } | null = null) {
  llamadas.length = 0;
  __resetRevalidadas();
  __setClient({
    async rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ nombre, args });
      return { data: error ? null : 42, error };
    },
  });
}

test("crear llama a la RPC atomica con catalogo y sensibles y revalida", async () => {
  configurar();
  assert.deepEqual(await crearProveedor(input), { ok: true });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]?.nombre, "guardar_proveedor");
  assert.equal(llamadas[0]?.args.p_id, undefined);
  assert.deepEqual(llamadas[0]?.args.p_proveedor, {
    tipo: "hotelero", nombre: "Hotel Beta", razon_social: "Beta SAS", nit: "123",
    ciudad: "Bogotá", contacto: "Ana", banco: "Banco Uno", tipo_cuenta: "Ahorros",
    numero_cuenta: "987", politica_reservas: "50% anticipo", voucher_contacto: "300123",
    aplica_retencion: true, pct_retencion: 0.025, clasificacion: "costo",
  });
  assert.deepEqual(__revalidadas(), ["/dashboard/producto/proveedores"]);
});

test("actualizar pasa el id a la RPC; un fallo no revalida", async () => {
  configurar({ message: "Sin permiso" });
  assert.deepEqual(await actualizarProveedor(9, input), { ok: false, error: "Sin permiso" });
  assert.equal(llamadas[0]?.nombre, "guardar_proveedor");
  assert.equal(llamadas[0]?.args.p_id, 9);
  assert.deepEqual(__revalidadas(), []);
});

test("CSV conserva el conteo parcial y envia cada fila valida por la RPC", async () => {
  configurar();
  const resultado = await cargarProveedoresMasivo([
    { tipo: "hotelero", nombre: "Hotel CSV", nit: "111", banco: "Banco CSV", pct_retencion: "2.5" },
    { tipo: "invalido", nombre: "Otro" },
  ]);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.insertados, 1);
  assert.equal(resultado.errores.length, 1);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]?.nombre, "guardar_proveedor");
  assert.deepEqual(llamadas[0]?.args.p_proveedor, {
    tipo: "hotelero", nombre: "Hotel CSV", razon_social: null, nit: "111",
    ciudad: null, contacto: null, banco: "Banco CSV", tipo_cuenta: null,
    numero_cuenta: null, politica_reservas: null, aplica_retencion: true,
    pct_retencion: 0.025,
  });
  assert.deepEqual(__revalidadas(), ["/dashboard/producto/proveedores"]);
});

test("nombre vacio no invoca la RPC", async () => {
  configurar();
  assert.deepEqual(await crearProveedor({ ...input, nombre: " " }), {
    ok: false, error: "El nombre es obligatorio.",
  });
  assert.deepEqual(llamadas, []);
  assert.deepEqual(__revalidadas(), []);
});
