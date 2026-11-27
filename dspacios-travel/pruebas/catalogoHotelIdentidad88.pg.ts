// H88-01/02/03 — la información del hotel del catálogo (estrellas, clasificación, descripción, ubicación, fotos) se lee SIEMPRE por el id guardado del hotel, nunca por nombre, y en vivo.
// Recorrido REAL de los cargadores de producción (Bernalo/unidad, presentación de paquetes dinámicos) → PostgREST propio → PostgreSQL local. Solo base DESECHABLE:
//   sh supabase/scripts/test_pg_local.sh pgrevc rev_consolidada_base PG188 pruebas/catalogoHotelIdentidad88.pg.ts      (con PG_REACT=1)
// Fixture sintético: tres fichas con el MISMO nombre «Hotel Gemelo Playa» (A, B, C) en el mismo destino. Expectativas escritas a mano (ver cada prueba).
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG188_CONTENEDOR ?? "";
const DB = process.env.PG188_BASE ?? "";
const PGRST = process.env.PG188_POSTGREST ?? "";
const SECRETO = process.env.PG188_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG188_*: usa supabase/scripts/test_pg_local.sh con el prefijo PG188.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: `data:text/javascript,${encodeURIComponent("export {}")}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* sigue */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const TOKEN_SERVICIO = jwt({ role: "service_role" });
const fetchReal = globalThis.fetch;
let peticiones = 0;
const fetchLocal: typeof fetch = (input, init) => { peticiones++; return fetchReal(String(input).replace("/rest/v1/", "/"), init); };
const clienteServicio = () => crearClienteSupabase(PGRST, TOKEN_SERVICIO, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteServicio() } });
function sql(q: string): string {
  try {
    return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) { throw new Error(`SQL falló: ${String((e as { stderr?: unknown }).stderr ?? e).slice(0, 600)}`); }
}

const { cargarInfoHotelesBernalo } = await import("../lib/tarifario/datosBernalo.ts");
const { cargarPresentacionHoteles } = await import("../lib/paqueteDinamico/fichas.ts");
const { presentacionDelHotel } = await import("../lib/paqueteDinamico/publico.ts");

let A = 0, B = 0, C = 0;
const FOTO = (h: string, n: string) => `https://fotos.local/${h}/${n}.jpg`;
before(() => {
  sql(`insert into public.destinos (nombre) values ('DESTINO 188') on conflict do nothing;`);
  const dest = sql(`select id from public.destinos where nombre = 'DESTINO 188'`);
  const mk = (est: string, cla: string, des: string, ubi: string) => sql(`insert into public.hoteles (destino_id, nombre, estrellas, clasificacion, descripcion, ubicacion) values (${dest}, 'Hotel Gemelo Playa', ${est}, ${cla}, ${des}, ${ubi}) returning id`).split("\n")[0];
  A = Number(mk("5", "null", "'Frente al mar A'", "'Bocagrande A'"));
  B = Number(mk("3", "'Posada'", "'Interior B'", "'Centro B'"));
  C = Number(mk("null", "null", "null", "null"));
  // Fotos: A tiene portada con orden POSTERIOR (la portada debe ir primero igual); B una sola; C ninguna.
  sql(`insert into public.hotel_fotos (hotel_id, path, url, orden, es_portada) values
    (${A}, 'a1', '${FOTO("A", "dos")}', 0, false), (${A}, 'a2', '${FOTO("A", "portada")}', 5, true), (${B}, 'b1', '${FOTO("B", "unica")}', 0, true);`);
});
after(() => { try { sql(`delete from public.hotel_fotos where hotel_id in (${A},${B},${C}); delete from public.hoteles where id in (${A},${B},${C});`); } catch { /* base desechable */ } });

test("identidad por id: tres fichas con el MISMO nombre devuelven cada una SU información (nada se mezcla por nombre)", async () => {
  const r = await cargarInfoHotelesBernalo([A, B, C]);
  assert.equal(r.errorInfo, null); assert.equal(r.errorFotos, null);
  assert.deepEqual(Object.keys(r.infoPorHotel).map(Number).sort((x, y) => x - y), [A, B, C]);
  assert.equal(r.infoPorHotel[A].estrellas, 5); assert.equal(r.infoPorHotel[A].descripcion, "Frente al mar A"); assert.equal(r.infoPorHotel[A].ubicacion, "Bocagrande A");
  assert.equal(r.infoPorHotel[B].estrellas, 3); assert.equal(r.infoPorHotel[B].clasificacion, "Posada"); assert.equal(r.infoPorHotel[B].descripcion, "Interior B");
  // C no tiene nada: queda vacío, NO toma lo de A ni de B aunque se llamen igual.
  assert.equal(r.infoPorHotel[C].estrellas, null); assert.equal(r.infoPorHotel[C].descripcion, null); assert.equal(r.infoPorHotel[C].ubicacion, null);
  assert.equal(r.fotosPorHotel[A], FOTO("A", "portada")); assert.equal(r.fotosPorHotel[B], FOTO("B", "unica")); assert.equal(r.fotosPorHotel[C], undefined);
  assert.deepEqual(r.galeriaPorHotel[A], [FOTO("A", "portada"), FOTO("A", "dos")], "la portada va primero aunque su orden sea posterior");
  assert.deepEqual(r.galeriaPorHotel[B], [FOTO("B", "unica")]);
});

test("pedir solo la ficha A no trae nada de B ni de C (acotado por los ids pedidos)", async () => {
  const r = await cargarInfoHotelesBernalo([A]);
  assert.deepEqual(Object.keys(r.infoPorHotel).map(Number), [A]);
  assert.deepEqual(Object.keys(r.galeriaPorHotel).map(Number), [A]);
});

test("presentación de paquetes dinámicos: misma identidad por id, y el catálogo gana sobre una copia vieja guardada en el paquete (solo hoteles vinculados)", async () => {
  const cat = await cargarPresentacionHoteles(clienteServicio() as never, [A, B]);
  assert.deepEqual([...cat.keys()].sort((x, y) => x - y), [A, B]);
  assert.equal(cat.get(A)!.estrellas, 5); assert.equal(cat.get(B)!.clasificacion, "Posada");
  // Fila del paquete con una copia VIEJA (2★, otra descripción) vinculada a B: se muestra lo de B del catálogo.
  const vinculado = presentacionDelHotel({ hotel_id: B, descripcion: "Copia vieja", foto_url: null, estrellas: 2, ubicacion: "Vieja" } as never, cat.get(B));
  assert.equal(vinculado.estrellas, 3); assert.equal(vinculado.descripcion, "Interior B"); assert.equal(vinculado.ubicacion, "Centro B"); assert.deepEqual(vinculado.fotos, [FOTO("B", "unica")]);
  // Hotel MANUAL (sin hotel_id) con el mismo nombre que una ficha: conserva exactamente lo guardado; el catálogo no se le aplica.
  const manual = presentacionDelHotel({ hotel_id: null, descripcion: "Manual propio", foto_url: "https://fotos.local/manual.jpg", estrellas: 2, ubicacion: "Manual" } as never, cat.get(A));
  assert.equal(manual.estrellas, 2); assert.equal(manual.descripcion, "Manual propio"); assert.deepEqual(manual.fotos, ["https://fotos.local/manual.jpg"]);
  // Ficha vinculada sin datos (C): queda lo guardado en el paquete, nunca lo de A/B.
  const vacio = await cargarPresentacionHoteles(clienteServicio() as never, [C]);
  const sinDatos = presentacionDelHotel({ hotel_id: C, descripcion: "Guardada en el paquete", foto_url: null, estrellas: null, ubicacion: "" } as never, vacio.get(C));
  assert.equal(sinDatos.descripcion, "Guardada en el paquete"); assert.equal(sinDatos.estrellas, null);
});

test("un cambio en el catálogo se ve en la SIGUIENTE lectura (no hay copia que refrescar) y no toca a la ficha gemela", async () => {
  sql(`update public.hoteles set estrellas = 4, descripcion = 'Frente al mar A (renovado)' where id = ${A};
       insert into public.hotel_fotos (hotel_id, path, url, orden, es_portada) values (${A}, 'a3', '${FOTO("A", "nueva")}', 9, false);`);
  const r = await cargarInfoHotelesBernalo([A, B]);
  assert.equal(r.infoPorHotel[A].estrellas, 4); assert.equal(r.infoPorHotel[A].descripcion, "Frente al mar A (renovado)");
  assert.ok(r.galeriaPorHotel[A].includes(FOTO("A", "nueva")));
  assert.equal(r.infoPorHotel[B].estrellas, 3); assert.equal(r.infoPorHotel[B].descripcion, "Interior B");
  const cat = await cargarPresentacionHoteles(clienteServicio() as never, [A]);
  assert.equal(cat.get(A)!.estrellas, 4);
});

test("consumo: las lecturas son por LOTE de ids (no por hotel): 3 hoteles y 60 hoteles piden la misma cantidad de consultas", async () => {
  const masivos: number[] = [];
  for (let i = 0; i < 57; i++) masivos.push(Number(sql(`insert into public.hoteles (destino_id, nombre) select destino_id, 'Hotel Relleno ' || ${i} from public.hoteles where id = ${A} returning id`)));
  try {
    peticiones = 0; await cargarInfoHotelesBernalo([A, B, C]); const con3 = peticiones;
    peticiones = 0; await cargarInfoHotelesBernalo([A, B, C, ...masivos]); const con60 = peticiones;
    assert.equal(con60, con3, `3 hoteles = ${con3} consultas; 60 hoteles = ${con60}`);
    assert.ok(con3 <= 3, `lectura por lote: ${con3} consultas (hoteles + fotos)`);
  } finally { sql(`delete from public.hoteles where id in (${masivos.join(",")})`); }
});
