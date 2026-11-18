// O1 · la foto de un receptivo publicado la lee el servidor con el cliente de servicio (solo id + foto_url de los ids publicados) para que la vean visitante, aliado e interno.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { leerFotosServicios } from "../lib/tarifario/fotosServicio.ts";

function cliente(nombre: string, bitacora: string[], filas: { id: number; foto_url: string | null }[] | null, error: { message: string } | null = null) {
  return {
    from(tabla: string) {
      return { select(cols: string) { return { in(col: string, ids: number[]) { bitacora.push(`${nombre}:${tabla}:${cols}:${col}:${ids.join(",")}`); return Promise.resolve({ data: filas, error }); } }; } };
    },
  } as never;
}

describe("O1 · leerFotosServicios", () => {
  test("con cliente de servicio lee SOLO id y foto_url de los ids publicados (no la sesión del visitante)", async () => {
    const b: string[] = [];
    const r = await leerFotosServicios(cliente("sesion", b, []), cliente("admin", b, [{ id: 7, foto_url: "https://x/7.webp" }]), [7, 9]);
    assert.deepEqual(b, ["admin:servicios_adicionales:id, foto_url:id:7,9"]);
    assert.deepEqual(r, { data: [{ id: 7, foto_url: "https://x/7.webp" }], error: null });
  });
  test("sin cliente de servicio se conserva la lectura con la sesión", async () => {
    const b: string[] = [];
    await leerFotosServicios(cliente("sesion", b, []), null, [3]);
    assert.deepEqual(b, ["sesion:servicios_adicionales:id, foto_url:id:3"]);
  });
  test("sin ids no se hace ninguna consulta", async () => {
    const b: string[] = [];
    const r = await leerFotosServicios(cliente("sesion", b, null), cliente("admin", b, null), []);
    assert.deepEqual(b, []);
    assert.deepEqual(r, { data: [], error: null });
  });
  test("un error de lectura se devuelve como error (el llamador lo registra y sigue sin fotos)", async () => {
    const r = await leerFotosServicios(cliente("s", [], null), cliente("a", [], null, { message: "boom" }), [1]);
    assert.equal(r.error?.message, "boom");
    assert.equal(r.data, null);
  });
});
