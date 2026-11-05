// #82 — información del hotel del paquete (estrellas, descripción, ubicación): validación de forma, copia desde la ficha, migración 279 y publicación.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const { validarEntradaPaqueteTotal } = await import("../lib/paqueteDinamico/entrada.ts");
const { ENTRADA_VACIA } = { ENTRADA_VACIA: {
  nombre: "P", destinoId: 1, multidestino: false, destinosExtra: [], moneda: "COP", esquema: "neta_markup", pvpModo: null, pctMkPct: 20, usaVuelo: false, usaHotel: true, usaServicios: false, noches: 3,
  compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null, descripcion: "", incluye: "", noIncluye: "", vuelos: [], hoteles: [], servicios: [],
} } as { ENTRADA_VACIA: Parameters<typeof validarEntradaPaqueteTotal>[0] };
const hotel = (o: Record<string, unknown> = {}) => ({ hotelId: 5, nombre: "H", categoria: "", regimen: "", descripcion: "", fotoUrl: "", proveedor: "", estrellas: null, ubicacion: "", neto: {}, pvp: {}, pvpGeneral: null, capacidadNinos: null, edadInfanteMax: null, edadNinoMax: null, ...o });
const val = (o: Record<string, unknown>) => validarEntradaPaqueteTotal({ ...ENTRADA_VACIA, hoteles: [hotel(o)] as never });

test("estrellas: vacías (sin dato) o enteros de 1 a 5; ubicación hasta 500 caracteres", () => {
  assert.deepEqual(val({ estrellas: null }), []);
  for (const e of [1, 3, 5]) assert.deepEqual(val({ estrellas: e }), []);
  for (const e of [0, 6, 2.5, -1]) assert.match(val({ estrellas: e })[0], /estrellas deben ser un número entero de 1 a 5/);
  assert.match(val({ ubicacion: "x".repeat(501) })[0], /ubicación es demasiado larga/);
  assert.deepEqual(val({ ubicacion: "x".repeat(500) }), []);
});

test("el guardado conserva los tres datos: la fila del hotel, la RPC y la lectura al editar los llevan", () => {
  const a = leer("app/(dashboard)/dashboard/paquetes/total/actions.ts");
  assert.match(a, /estrellas: h\.estrellas, ubicacion: h\.ubicacion\.trim\(\) \|\| null/);
  assert.match(a, /descripcion: h\.descripcion \|\| null/);
  const p = leer("app/(dashboard)/dashboard/paquetes/total/[id]/page.tsx");
  assert.match(p, /estrellas: x\.estrellas == null \? null : Number\(x\.estrellas\), ubicacion: str\(x\.ubicacion\)/);
});

test("con ficha, el servidor copia estrellas/descripcion/ubicacion de hoteles (no del navegador) y no inventa si la ficha no los tiene", () => {
  const a = leer("app/(dashboard)/dashboard/paquetes/total/actions.ts");
  assert.match(a, /cargarInfoHotelesFicha\(adm, fichaIds\)/);
  assert.match(a, /estrellas: f\?\.estrellas \?\? h\.estrellas, descripcion: f\?\.descripcion \|\| h\.descripcion, ubicacion: f\?\.ubicacion \|\| h\.ubicacion/);
  const f = leer("lib/paqueteDinamico/fichas.ts");
  assert.match(f, /from\("hoteles"\)\.select\("id, estrellas, descripcion, ubicacion"\)/);
  assert.match(f, /x\.estrellas >= 1 && x\.estrellas <= 5 \? x\.estrellas : null/);
  const c = leer("app/(dashboard)/dashboard/paquetes/total/catalogos.ts");
  assert.match(c, /cargarInfoHotelesFicha\(admin,/);
  assert.match(leer("app/(dashboard)/dashboard/paquetes/total/PaqueteTotalForm.tsx"), /estrellas: h\?\.estrellas \?\? null, ubicacion: h\?\.ubicacionFicha \?\? ""/);
});

test("la vista pública lleva estrellas y ubicación (nunca netos) y la tarjeta usa los componentes del hotel normal", () => {
  const pub = leer("lib/paqueteDinamico/publico.ts");
  assert.match(pub, /estrellas: h\.estrellas \?\? null, ubicacion: h\.ubicacion\?\.trim\(\) \?\? ""/);
  const t = leer("app/tarifario/PorDinamicos.tsx");
  assert.match(t, /import \{ Categoria, DescripcionHotelExpandible, UbicacionHotel \} from "\.\/tarjetaHotelCompartida"/);
  assert.match(t, /<Categoria estrellas=\{h\.estrellas\}/); assert.match(t, /<DescripcionHotelExpandible texto=\{h\.descripcion\}/); assert.match(t, /<UbicacionHotel hotelNombre=\{h\.nombre\} ubicacion=\{h\.ubicacion\}/);
});

test("migración 279: nueva, aditiva, con preflight/postcheck/rollback; no toca 274–278 (el 278 es de #90, ya en main)", () => {
  const dir = "supabase/migrations";
  const m = readdirSync(dir).filter((x) => x.includes("000279_"));
  assert.deepEqual(m, ["20260601000279_paquete_dinamico_hotel_info.sql"]);
  assert.deepEqual(readdirSync(dir).filter((x) => x.includes("000278_")), ["20260601000278_hotel_reglas_descuento.sql"], "el 278 es el de #90");
  const sql = leer(`${dir}/${m[0]}`);
  assert.match(sql, /add column if not exists estrellas smallint/); assert.match(sql, /add column if not exists ubicacion text/);
  assert.match(sql, /estrellas is null or estrellas between 1 and 5/);
  assert.match(sql, /security invoker/); assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /capacidad_ninos, edad_infante_max, edad_nino_max, estrellas, ubicacion, orden/);
  assert.match(sql, /pvp_infante/); assert.match(sql, /multidestino/); // conserva todo lo de la 277
  for (const s of ["preflight", "postcheck", "rollback"]) assert.ok(readdirSync("supabase/scripts").some((x) => x.startsWith(`${s}_279_`)), s);
  const rb = leer("supabase/scripts/rollback_279_paquete_dinamico_hotel_info.sql");
  assert.match(rb, /drop column if exists estrellas/); assert.match(rb, /drop column if exists ubicacion/);
  assert.doesNotMatch(rb.split("begin;")[1].split("alter table")[0], /estrellas/, "la función restaurada es la de la 277");
  // 274–278 intactas respecto de HEAD
  const cambios = execFileSync("git", ["status", "--porcelain", "--", ...["274", "275", "276", "277", "278"].map((n) => `supabase/migrations/20260601000${n}_*`)], { encoding: "utf8" });
  assert.equal(cambios.trim(), "", "las migraciones 274–278 no se editaron");
});
