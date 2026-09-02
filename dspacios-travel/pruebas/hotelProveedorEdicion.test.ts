import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { normalizarProveedorHotelId } from "../lib/hoteles/proveedor.ts";

describe("edicion del proveedor hotelero", () => {
  test("normaliza asignacion, limpieza y ausencia sin confundir sus efectos", () => {
    assert.deepEqual(normalizarProveedorHotelId(42), { ok: true, proveedorId: 42 });
    assert.deepEqual(normalizarProveedorHotelId(null), { ok: true, proveedorId: null });
    assert.deepEqual(normalizarProveedorHotelId(undefined), { ok: true, proveedorId: undefined });
  });

  test("rechaza ids manipulados", () => {
    for (const valor of [0, -1, 1.5, Number.NaN, "42", {}, []]) {
      assert.equal(normalizarProveedorHotelId(valor).ok, false);
    }
  });

  test("la accion valida el tipo hotelero y solo actualiza proveedor_id", () => {
    const src = readFileSync(new URL("../app/(dashboard)/dashboard/producto/hoteles/actions.ts", import.meta.url), "utf8");
    assert.match(src, /normalizarProveedorHotelId\(input\.proveedorId\)/);
    assert.match(src, /\.eq\("tipo", "hotelero"\)/);
    assert.match(src, /proveedor_id: proveedor\.proveedorId/);
  });

  test("la pagina y el editor cargan, muestran y envian el proveedor", () => {
    const page = readFileSync(new URL("../app/(dashboard)/dashboard/producto/hoteles/[id]/page.tsx", import.meta.url), "utf8");
    const editor = readFileSync(new URL("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelConfigEditor.tsx", import.meta.url), "utf8");
    assert.match(page, /from\("proveedores"\).*eq\("tipo", "hotelero"\)/);
    assert.match(page, /proveedorId: h\.proveedor_id \?\? null/);
    assert.match(editor, /Proveedor hotelero/);
    assert.match(editor, /proveedorId: proveedorId === "" \? null : Number\(proveedorId\)/);
  });
});
