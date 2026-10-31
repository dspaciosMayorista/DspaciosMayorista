// Lectura/escritura de la 262 con un cliente DOBLE (no hay base): comprueba validación previa, tolerancia a esquema ausente, restauración si falla el
// insert y que nunca se derive un precio del otro alcance. No prueba contra Postgres (la migración no está aplicada).
import { test } from "node:test";
import assert from "node:assert/strict";
import { guardarClasificacion, leerClasificacion, leerPreciosAlcance, reemplazarPreciosAlcance, MENSAJE_262_NO_APLICADA } from "../lib/servicios/alcanceDatos.ts";

type Resp = { data?: unknown; error?: { code?: string; message?: string } | null };
/** Cliente doble: cada `from(tabla)` devuelve un encadenable cuyo `await` resuelve la respuesta programada para (tabla, operación). */
function doble(resp: Record<string, Resp | Resp[]>) {
  const llamadas: { tabla: string; op: string; arg?: unknown }[] = [];
  return {
    llamadas,
    from(tabla: string) {
      let op = "select"; let arg: unknown;
      const q: any = {
        select() { op = "select"; return q; }, update(a: unknown) { op = "update"; arg = a; return q; }, delete() { op = "delete"; return q; }, insert(a: unknown) { op = "insert"; arg = a; return q; },
        eq() { return q; }, order() { return q; }, maybeSingle() { return q; },
        then(res: (r: Resp) => void) {
          llamadas.push({ tabla, op, arg });
          const r = resp[`${tabla}:${op}`]; const una = Array.isArray(r) ? r.shift() : r;
          res(una ?? { data: [], error: null });
        },
      };
      return q;
    },
  };
}

test("leerClasificacion: sin la 262 (columna inexistente) responde «no disponible», no error", async () => {
  const sb = doble({ "servicios_adicionales:select": { error: { code: "42703" } } });
  assert.deepEqual(await leerClasificacion(sb, 1), { ok: true, disponible: false });
});

test("guardarClasificacion: un combo sin declarar traslado se rechaza ANTES de tocar la base", async () => {
  const sb = doble({});
  const r = await guardarClasificacion(sb, 1, { tipo_receptivo: "combo", combo_incluye_traslado: null });
  assert.equal(r.ok, false); assert.equal(sb.llamadas.length, 0);
});

test("guardarClasificacion: un tour limpia los campos del combo; sin la 262 avisa que falta aplicarla", async () => {
  const sb = doble({ "servicios_adicionales:update": { error: null } });
  assert.deepEqual(await guardarClasificacion(sb, 1, { tipo_receptivo: "tour" }), { ok: true });
  assert.deepEqual(sb.llamadas[0].arg, { tipo_receptivo: "tour", combo_incluye_traslado: null, combo_traslado_alcance: null });
  const sin = doble({ "servicios_adicionales:update": { error: { code: "42703" } } });
  assert.deepEqual(await guardarClasificacion(sin, 1, { tipo_receptivo: "traslado" }), { ok: false, error: MENSAJE_262_NO_APLICADA });
});

test("leerPreciosAlcance: tabla inexistente = no disponible; con datos convierte numéricos", async () => {
  assert.deepEqual(await leerPreciosAlcance(doble({ "servicio_precio_alcance:select": { error: { code: "42P01" } } }), 5), { ok: true, disponible: false });
  const r = await leerPreciosAlcance(doble({ "servicio_precio_alcance:select": { data: [{ id: "1", alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: "45000.00" }] } }), 5);
  assert.deepEqual(r.ok && r.disponible && r.datos, [{ id: 1, alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 45000 }]);
});

/** Doble con rpc: registra la llamada y devuelve la respuesta programada. */
function dobleRpc(error: { code?: string; message?: string } | null) {
  const llamadas: { fn: string; args: any }[] = [];
  return { llamadas, from: () => { throw new Error("no debe usar from()"); }, rpc(fn: string, args: unknown) { llamadas.push({ fn, args }); return Promise.resolve({ error }); } };
}

test("reemplazarPreciosAlcance: valida antes (rangos cruzados) y no llama a la base", async () => {
  const sb = dobleRpc(null);
  const r = await reemplazarPreciosAlcance(sb as never, 5, [
    { alcance: "trayecto", pax_desde: 1, pax_hasta: 4, precio: 1 }, { alcance: "trayecto", pax_desde: 4, pax_hasta: 8, precio: 2 },
  ]);
  assert.equal(r.ok, false); assert.equal(sb.llamadas.length, 0);
});

test("reemplazarPreciosAlcance: UNA sola llamada atómica, cada alcance con SU precio (ida y regreso no se calcula del trayecto)", async () => {
  const sb = dobleRpc(null);
  const r = await reemplazarPreciosAlcance(sb as never, 5, [{ alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 45000 }, { alcance: "ida_regreso", pax_desde: null, pax_hasta: null, precio: 80000 }]);
  assert.deepEqual(r, { ok: true });
  assert.equal(sb.llamadas.length, 1);
  assert.equal(sb.llamadas[0].fn, "reemplazar_precios_alcance");
  assert.equal(sb.llamadas[0].args.p_temporada_id, 5);
  assert.deepEqual(sb.llamadas[0].args.p_filas.map((f: any) => [f.alcance, f.precio]), [["trayecto", 45000], ["ida_regreso", 80000]], "80.000 ≠ 2 × 45.000");
});

test("reemplazarPreciosAlcance: errores de la base se traducen; sin la RPC avisa que falta aplicar la migración y no escribe", async () => {
  assert.deepEqual(await reemplazarPreciosAlcance(dobleRpc({ code: "42883" }) as never, 5, []), { ok: false, error: MENSAJE_262_NO_APLICADA });
  assert.deepEqual(await reemplazarPreciosAlcance(dobleRpc({ code: "PGRST202" }) as never, 5, []), { ok: false, error: MENSAJE_262_NO_APLICADA });
  const cruce = await reemplazarPreciosAlcance(dobleRpc({ code: "23P01", message: "El rango 1 a 4 se cruza" }) as never, 5, [{ alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 1 }]);
  assert.deepEqual(cruce, { ok: false, error: "El rango 1 a 4 se cruza" });
  const general = await reemplazarPreciosAlcance(dobleRpc({ code: "22023", message: "GENERAL es la tarifa histórica" }) as never, 5, []);
  assert.equal(general.ok === false && /histórica/.test(general.error), true);
  const otro = await reemplazarPreciosAlcance(dobleRpc({ code: "XX000" }) as never, 5, []);
  assert.equal(otro.ok === false && /conservaron los anteriores/.test(otro.error), true);
});
