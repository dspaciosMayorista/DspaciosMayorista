// #82 — la ficha del hotel aporta SOLO información general; las tarifas son del paquete (migración 280). Categoría y plan son texto propio del paquete.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const { armarPaqueteCalc, opcionesDelPaquete } = await import("../lib/paqueteDinamico/modelo.ts");
const { liquidarPaquete, validarPaquete } = await import("../lib/paqueteDinamico/calculo.ts");
const { normalizarOpcionHotel, opcionesOfrecidas, filtrarOpciones, MAX_OPCION_HOTEL } = await import("../lib/paqueteDinamico/opcionesHotel.ts");

const cab = { id: 1, nombre: "P", moneda: "COP", esquema: "neta_markup", pvp_modo: null, pct_mk: 0.2, usa_vuelo: false, usa_hotel: true, usa_servicios: false, noches: 3, pvp_general: null, total_declarado: null } as never;
const NETO = { sencilla: 800_000, doble: 500_000, triple: 450_000, multiple: 400_000, nino: 250_000, nino2: 250_000, infante: 0 };
const fila = (o: Record<string, unknown> = {}) => ({ id: 9, hotel_id: 5, nombre: "Ficha con tarifario", categoria: "Suite nueva", regimen: "Plan propio", descripcion: null, foto_url: null, proveedor: "", neto: NETO, pvp: {}, pvp_general: null, ...o }) as never;
const comp = { habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0 };

test("migración 280: nueva, aditiva, con preflight/postcheck/rollback; no edita 274–279", () => {
  const dir = "supabase/migrations";
  const m = readdirSync(dir).filter((x) => x.includes("000280_"));
  assert.deepEqual(m, ["20260601000280_paquete_dinamico_ficha_sin_tarifario.sql"]);
  const sql = sinComentarios(leer(`${dir}/${m[0]}`)).replace(/^s*--.*$/gm, "");
  const fn = sql.split("create or replace function public.tg_din_hotel_vinculable")[0];
  for (const t of ["hotel_temporadas", "tarifa_hotel", "hotel_tarifas_unidad", "hotel_calculadora"]) assert.doesNotMatch(fn, new RegExp(t), `la guarda no consulta ${t}`);
  assert.match(fn, /h\.activo is true/);
  assert.match(sql, /drop trigger if exists trg_din_hotel_moneda/); assert.match(sql, /drop function if exists public\.tg_din_hotel_moneda\(\)/);
  assert.match(sql, /char_length\(coalesce\(categoria, ''\)\) <= 80 and char_length\(coalesce\(regimen, ''\)\) <= 80/);
  assert.doesNotMatch(sql, /categorias_habitacion|planes_alimentacion|update public\.hoteles|insert into public\.hoteles/, "no escribe en el catálogo ni en la ficha");
  for (const s of ["preflight", "postcheck", "rollback", "test"]) assert.ok(readdirSync("supabase/scripts").some((x) => x.startsWith(`${s}_280_`)), s);
  const rb = leer("supabase/scripts/rollback_280_paquete_dinamico_ficha_sin_tarifario.sql");
  assert.match(rb, /not exists \(select 1 from public\.hotel_temporadas/); assert.match(rb, /create trigger trg_din_hotel_moneda/); assert.match(rb, /drop constraint if exists paquete_din_hoteles_texto_check/);
});

test("selector, acción y formulario: ninguno rechaza ni oculta una ficha por tarifario ni por moneda", () => {
  const cat = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/catalogos.ts"));
  const act = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  const form = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
  assert.match(cat, /rpc\("hoteles_vinculables_din"/);
  assert.match(act, /rpc\("hotel_vinculable_din"/);
  assert.doesNotMatch(act, /no tener vigencias ni tarifas/); assert.doesNotMatch(act, /El hotel «.*» está en/);
  assert.doesNotMatch(form, /h\.moneda/); assert.doesNotMatch(form, /const hotelesDest = .*moneda/);
  assert.match(form, /const hotelesDest = hoteles\.filter\(\(h\) => e\.destinoId != null && h\.destino_id === e\.destinoId\)/);
  assert.match(form, /<ComboHotel hoteles=\{hotelesDest\.map/); assert.doesNotMatch(form, /Usar ficha de hotel existente/);
});

test("el paquete nunca lee ni copia las tarifas, vigencias ni la calculadora de la ficha", () => {
  const archivos = ["lib/paqueteDinamico/fichas.ts", "lib/paqueteDinamico/cargarPublico.ts", "lib/paqueteDinamico/modelo.ts", "lib/paqueteDinamico/calculo.ts", "lib/paqueteDinamico/publico.ts", "lib/paqueteDinamico/cotizacion.ts",
    "app/(dashboard)/dashboard/paquetes/total/actions.ts", "app/(dashboard)/dashboard/paquetes/total/catalogos.ts", "app/tarifario/checkout/dinamico/actions.ts"];
  for (const f of archivos) assert.doesNotMatch(sinComentarios(leer(f)), /tarifa_hotel|hotel_temporadas|hotel_tarifas_unidad|hotel_calculadora|tarifario_resultado|liquidarHotel/, f);
});

test("COTIZAR: el precio sale solo del paquete aunque la ficha tenga otra tarifa (la ficha ni entra al cálculo)", () => {
  const [op] = opcionesDelPaquete(cab, [fila()], [], []);
  const r = liquidarPaquete(op.calc, comp);
  assert.equal(r.total, Math.round(500_000 / 0.8) * 2, "doble: neto del paquete / (1-mk) × 2 personas");
  // Otra fila vinculada a la MISMA ficha con otros importes da otro precio: el precio depende de lo guardado en el paquete, no de hotel_id.
  const otro = liquidarPaquete(armarPaqueteCalc(cab, fila({ neto: { ...NETO, doble: 1_000_000 } }), null, []), comp);
  assert.equal(otro.total, Math.round(1_000_000 / 0.8) * 2);
});

test("PUBLICAR/COTIZAR: un hotel vinculado sin tarifas propias no se puede publicar ni cotizar", () => {
  const sin = armarPaqueteCalc(cab, fila({ neto: {} }), null, []);
  assert.match(validarPaquete(sin)[0], /Falta el precio del hotel/);
  assert.throws(() => liquidarPaquete(sin, comp), /Falta el precio del hotel/);
  const parcial = armarPaqueteCalc(cab, fila({ neto: { doble: 500_000 } }), null, []);
  assert.ok(validarPaquete(parcial).length > 0);
  const act = leer("app/(dashboard)/dashboard/paquetes/total/actions.ts");
  assert.match(act, /for \(const m of validarPaquete\(o\.calc\)\) msgs\.add/, "publicar valida cada opción con el cálculo");
});

test("categoría y plan: texto propio — se elige uno conocido o se escribe uno nuevo, sin distinguir mayúsculas ni tildes", () => {
  const cats = ["Estándar", "Suite"];
  assert.equal(normalizarOpcionHotel("  estandar  ", cats), "Estándar");
  assert.equal(normalizarOpcionHotel("Vista   al  mar", cats), "Vista al mar");
  assert.equal(normalizarOpcionHotel("", cats), ""); assert.equal(normalizarOpcionHotel(null, cats), "");
  assert.deepEqual(opcionesOfrecidas(["Suite"], ["suite", "Estándar"], ["Vista al mar", ""]), ["Suite", "Estándar", "Vista al mar"]);
  assert.deepEqual(filtrarOpciones(["Estándar", "Suite Junior"], "estan"), ["Estándar"]);
  assert.equal(MAX_OPCION_HOTEL, 80);
  const act = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  assert.doesNotMatch(act, /no existe en el catálogo|no está configurada en la ficha/);
  assert.match(act, /MAX_OPCION_HOTEL/);
});

test("un valor nuevo solo se guarda en paquete_din_hoteles: el servidor no escribe en el catálogo ni en la ficha", () => {
  const act = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  assert.doesNotMatch(act, /from\("(categorias_habitacion|planes_alimentacion|hotel_categorias|hotel_regimenes)"\)\.(insert|upsert|update)/);
  assert.doesNotMatch(act, /from\("hoteles"\)\.(insert|upsert|update)/);
  assert.match(act, /categoria: h\.categoria \|\| null, regimen: h\.regimen \|\| null/);
  const p = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/[id]/page.tsx"));
  assert.match(p, /categoria/);
});
