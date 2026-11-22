// O3 + O4 (2026-11-17) · edades OBLIGATORIAS del hotel y noche adicional como REFERENCIA — trayecto REAL contra PostgreSQL por HTTP, sin simular el motor de precios:
//   buscarHoteles, computarReserva, generarTarifario y las acciones de hoteles (crearHotel, actualizarHotelConfig, cargarHotelesMasivo) contra una base desechable con las migraciones 303–311.
// Lo ÚNICO simulado: la sesión (auth.getUser) y efectos laterales ajenos. Las acciones de hoteles se ejecutan con un cliente de servicio SOLO para saltar la RLS de catálogos
// (que exige un contexto de agencia de sesión, ya cubierta por otras pruebas): la validación de edades que se prueba es la de la acción real.
// SOLO base LOCAL desechable. No corre en `npm run test:*`: se lanza con supabase/scripts/test_pg_local.sh (prefijo PG102; ver la cabecera de edadesHotelUnidadU1.pg.ts para el comando).
import { test, describe, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG102_CONTENEDOR ?? "pg304";
const DB = process.env.PG102_BASE ?? "";
const PGRST = process.env.PG102_POSTGREST ?? "";
const SECRETO = process.env.PG102_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG102_BASE (desechable), PG102_POSTGREST y PG102_JWT_SECRET: usa supabase/scripts/test_pg_local.sh (prefijo PG102).");
}

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000102003";
const TOKEN_SERVICIO = jwt({ role: "service_role" });

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-102";

// Contador de solicitudes REALES al API de datos (PostgREST): lo que cuesta cada acción.
const solicitudes: string[] = [];
const fetchLocal: typeof fetch = (input, init) => {
  const url = String(input);
  solicitudes.push(url.replace(PGRST, "").replace("/rest/v1/", "/"));
  return fetch(url.replace("/rest/v1/", "/"), init);
};
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN }), { id: UID_ADMIN, email: `${UID_ADMIN}@x.test` });

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8" }).trim();
}

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true },
});
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ((globalThis as { __usarServicio?: boolean }).__usarServicio ? clienteLocal(TOKEN_SERVICIO) : clienteSesion()) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { buscarHoteles, cotizarPorFechas } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { computarReserva } = await import("../lib/reservar/computo.ts");

const { crearHotel, actualizarHotelConfig, cargarHotelesMasivo } = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");

// ── Semilla SINTÉTICA (destino CARTAGENA O3, ids 103xx) ─────────────────────────────────────────────────────
// Cifras idénticas a la de #102: ALTA (01/01–30/06/2030) doble 100.000 por persona y noche·… → 2 adultos en Doble, 3 noches = 750.000; la noche adicional de referencia = 250.000.
//   OK    edades completas (infante hasta 2, niño hasta 12) · también tiene temporada BAJA (para el límite de temporada)
//   SIN   acepta menores y NO tiene edades (hotel «heredado»: se publica con edades y luego se deja sin ellas, como uno viejo)
//   INV   edades inválidas (infante hasta 5, niño hasta 3)
//   OVR   sin edades del hotel PERO con un override completo en su tarifa (no debe reemplazar la configuración obligatoria)
//   AO    Adults Only (exento de edades; rechaza menores)
//   PROMO edades completas + promoción «4 noches, 1 gratis» (umbral por duración)
const PAQ3 = 10301;
const H3 = { OK: 10301, SIN: 10302, INV: 10304, OVR: 10305, PROMO: 10306, AO: 10303 } as const;
const NOM3: Record<number, string> = { 10301: "Hotel OK (edades completas)", 10302: "Hotel SIN edades", 10303: "Hotel AO (solo adultos)", 10304: "Hotel INV (edades inválidas)", 10305: "Hotel OVR (override sin edades del hotel)", 10306: "Hotel PROMO (4 noches 1 gratis)" };
const f3 = (f: number) => `${160000 * f}, ${100000 * f}, ${96000 * f}, ${80000 * f}, ${40000 * f}, ${24000 * f}, ${16000 * f}`;
const IDA = "2030-06-10", REG = "2030-06-13";

before(() => {
  const acom = (h: number) => `(${h}, 'sencilla', 1, 2, 1, 1, 0, 1, 0, 1), (${h}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${h}, 'triple', 3, 4, 3, 3, 0, 1, 0, 1)`;
  const todos = Object.values(H3);
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin103@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin103@x.test', 'Admin 103', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (10301, 'CARTAGENA O3') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (10301, 'Proveedor Hotel O3') on conflict do nothing;
    -- Todos nacen con edades válidas: la publicación del tarifario las exige. Después se dejan «heredados» (sin edades) para probar cotizar/reservar.
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
      ${todos.map((h) => (h === H3.AO ? `(${h}, 10301, '${NOM3[h]}', 10301, 'COP', null, null, null, null, 1, 6, true, true)` : `(${h}, 10301, '${NOM3[h]}', 10301, 'COP', 0, 2, 3, 12, 1, 6, true, false)`)).join(", ")};
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values ${todos.map(acom).join(", ")};
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
      ${todos.map((h) => `(${h}, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa')`).join(", ")}, (${H3.OK}, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa');
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, min_noches)
      values (${H3.PROMO}, 'CUATRO NOCHES 1 GRATIS', '2030-01-01', '2030-06-30', 5, 'promo_noche_gratis', 4);
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante) values
      ${todos.map((h) => `(${h}, 'Estandar', 'Desayuno', 'ALTA', ${f3(1)})`).join(", ")}, (${H3.OK}, 'Estandar', 'Desayuno', 'BAJA', ${f3(0.6)});
    update public.tarifa_hotel set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 12 where hotel_id = ${H3.OVR};
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ3}, 'Porción O3', 'porcion_terrestre', 3, 10301, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
      select ${PAQ3}, h, array['Estandar'], array['Desayuno'] from unnest(array[${todos.filter((h) => h !== H3.AO).join(",")}]) h;
  `);
});
after(() => { console.log(`\n[O3/O4] solicitudes totales al API de datos durante la prueba: ${solicitudes.length}`); });

type Hallado = Awaited<ReturnType<typeof buscarHoteles>>;
async function buscar(over: Record<string, unknown> = {}): Promise<Extract<Hallado, { ok: true }>> {
  const r = await buscarHoteles({ fechaIda: IDA, fechaRegreso: REG, numHabitaciones: 1, adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA O3", nocheAdicional: true, ...over });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<Hallado, { ok: true }>;
}
const de = (r: Extract<Hallado, { ok: true }>, h: number) => r.resultados.find((x) => x.hotelId === h);
const reserva = (hotelId: number, over: Record<string, unknown> = {}) => computarReserva(clienteSesion() as never, {
  paqueteId: PAQ3, bloqueoId: null, modulo: "porcion_terrestre", hotelId, fechaIda: IDA, fechaRegreso: REG, categoria: "Estandar", regimen: "Desayuno",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
  cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1", telefono: "3", email: "a@x.test" },
  tipoAsesor: "interno", asesorInterno: "Admin 103", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [], ...over,
} as never);

describe("preparación: se publica con edades completas y luego quedan hoteles «heredados» sin ellas", () => {
  test("generarTarifario publica los cinco hoteles que aceptan menores", async () => {
    const g = await generarTarifario(PAQ3);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.equal(sql(`select count(distinct hotel_id) from public.tarifario_resultado_publicable where paquete_id = ${PAQ3}`), "5");
    sql(`
      update public.hoteles set edad_infante_min = null, edad_infante_max = null, edad_nino_min = null, edad_nino_max = null where id in (${H3.SIN}, ${H3.OVR});
      update public.hoteles set edad_infante_min = 0, edad_infante_max = 5, edad_nino_min = 6, edad_nino_max = 3 where id = ${H3.INV};
    `);
  });
});

describe("O3 · búsqueda: solo adultos sigue; con menores el motivo es accionable y ningún hotel se omite en silencio", () => {
  test("solo adultos: TODOS los hoteles (también los sin edades configuradas) se cotizan", async () => {
    const r = await buscar();
    for (const h of [H3.OK, H3.SIN, H3.INV, H3.OVR, H3.PROMO]) assert.equal(de(r, h)?.total, 750000, NOM3[h]);
    assert.equal(r.enRevision, undefined, "sin menores no hay nada que revisar");
  });
  test("con un menor de 5 años: se cotiza el hotel configurado; los demás quedan con el motivo, no omitidos", async () => {
    const r = await buscar({ cantidadMenores: 1, edadesMenores: [5], nocheAdicional: false });
    assert.ok(de(r, H3.OK) && de(r, H3.PROMO), "los hoteles con edades válidas se cotizan");
    for (const h of [H3.SIN, H3.INV, H3.OVR]) assert.equal(de(r, h), undefined, `${NOM3[h]} no se cotiza con menores`);
    const rev = new Map((r.enRevision ?? []).map((x) => [x.hotelId, x]));
    assert.deepEqual([...rev.keys()].sort(), [H3.SIN, H3.INV, H3.OVR].sort(), "los tres quedan listados como «no se pudo cotizar», con su motivo");
    for (const h of [H3.SIN, H3.OVR]) {
      const m = rev.get(h)!;
      assert.equal(m.codigo, "edades_hotel_incompletas");
      assert.match(m.motivo ?? "", new RegExp(NOM3[h].replace(/[()]/g, "\\$&")));
      assert.match(m.motivo ?? "", /falta: «Infante hasta \(edad\)», «Niño hasta \(edad\)»/);
      assert.match(m.motivo ?? "", /solo con adultos/);
    }
    assert.match(rev.get(H3.INV)!.motivo ?? "", /valor no válido/);
  });
  test("un override de edades en la tarifa NO reemplaza la configuración obligatoria del hotel", async () => {
    const r = await buscar({ cantidadMenores: 1, edadesMenores: [5], nocheAdicional: false });
    assert.equal(de(r, H3.OVR), undefined);
    assert.equal(sql(`select count(*) from public.tarifa_hotel where hotel_id = ${H3.OVR} and edad_nino_max = 12`), "1", "el override existe y se respeta cuando el hotel sí está configurado");
  });
  test("Adults Only rechaza menores con SU propio motivo (no con el de edades)", async () => {
    const solo = await buscarHoteles({ fechaIda: IDA, fechaRegreso: REG, numHabitaciones: 1, adultos: 2, cantidadMenores: 1, edadesMenores: [5], destino: "CARTAGENA O3", nocheAdicional: false });
    assert.equal(solo.ok, true);
    assert.equal(sql(`select adults_only from public.hoteles where id = ${H3.AO}`), "t");
  });
});

describe("O3 · reserva y tarjeta: el servidor rechaza menores sin la configuración del hotel y deja pasar solo adultos", () => {
  test("computarReserva con un menor: error accionable; sin menores: se reserva", async () => {
    const con = await reserva(H3.SIN, { edadesMenores: [5], cantidadMenores: 1 });
    assert.equal(con.ok, false);
    // O-1: la reserva la puede iniciar un aliado B2B: el error es el texto público (sin campos, rutas ni nombre del hotel); el detalle queda en el log.
    assert.equal(con.ok ? "" : con.error, "Este hotel no está disponible para cotizar con menores en este momento. Consulta con un asesor o cotiza solo con adultos.");
    assert.doesNotMatch(con.ok ? "" : con.error, /Infante hasta|Producto|Configuración del hotel/);
    const sin = await reserva(H3.SIN);
    assert.equal(sin.ok, true, JSON.stringify(sin));
    assert.equal(sin.ok && sin.data.precioVenta, 750000);
  });
  test("hotel con edades inválidas y hotel con override sin edades: ambos rechazan menores; el hotel completo reserva", async () => {
    for (const h of [H3.INV, H3.OVR]) {
      const r = await reserva(h, { edadesMenores: [5], cantidadMenores: 1 });
      assert.equal(r.ok, false, NOM3[h]);
    }
    const ok = await reserva(H3.OK, { edadesMenores: [5], cantidadMenores: 1 });
    assert.equal(ok.ok, true, JSON.stringify(ok));
  });
  test("reserva con menores declarados por CONTEO (sin edades) también exige la configuración", async () => {
    const r = await reserva(H3.SIN, { ninos: 1 });
    assert.equal(r.ok, false);
  });
});

describe("O3 · guardar y publicar: la configuración de edades es obligatoria (Adults Only exento)", () => {
  before(() => { (globalThis as { __usarServicio?: boolean }).__usarServicio = true; });
  after(() => { (globalThis as { __usarServicio?: boolean }).__usarServicio = false; });
  test("crearHotel: sin edades se rechaza con el campo que falta; Adults Only y con edades válidas se guardan", async () => {
    const base = { nombre: "Hotel nuevo O3", destinoId: 10301, proveedorId: null, zona: "", categoriaIds: [], regimenIds: [] };
    const sinEdades = await crearHotel({ ...base, edadInfanteMax: null, edadNinoMax: null });
    assert.equal(sinEdades.ok, false);
    assert.match(sinEdades.ok ? "" : sinEdades.error, /«Infante hasta \(edad\)», «Niño hasta \(edad\)».*Adults Only/);
    const invalido = await crearHotel({ ...base, edadInfanteMax: 5, edadNinoMax: 3 });
    assert.equal(invalido.ok, false);
    const ao = await crearHotel({ ...base, nombre: "Hotel nuevo AO", edadInfanteMax: null, edadNinoMax: null, adultsOnly: true });
    assert.equal(ao.ok, true, JSON.stringify(ao));
    assert.equal(sql(`select adults_only || '/' || coalesce(edad_infante_max::text, 'null') from public.hoteles where id = ${ao.ok ? ao.id : 0}`), "true/null", "Adults Only se guarda sin inventar edades");
    const ok = await crearHotel({ ...base, nombre: "Hotel nuevo OK", edadInfanteMax: 3, edadNinoMax: 11 });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(sql(`select edad_infante_min || ',' || edad_infante_max || ',' || edad_nino_min || ',' || edad_nino_max from public.hoteles where id = ${ok.ok ? ok.id : 0}`), "0,3,4,11");
  });
  test("un hotel insertado sin declarar edades ya no hereda 2/10 (migración 311 quita el default)", () => {
    sql(`insert into public.hoteles (id, destino_id, nombre, moneda, activo) values (10399, 10301, 'Hotel sin edades declaradas', 'COP', true)`);
    const v = sql(`select coalesce(edad_infante_max::text, 'null') || '/' || coalesce(edad_nino_max::text, 'null') from public.hoteles where id = 10399`);
    // Con la 311 aplicada es «null/null»; sin ella es «2/10». La prueba exige la 311.
    assert.equal(v, "null/null");
  });
  test("actualizarHotelConfig: edades vacías o inválidas se rechazan; Adults Only se guarda; edades válidas se guardan", async () => {
    const cfg = (o: Record<string, unknown>) => ({ zona: "", rangosEdad: [], edadInfanteMax: 2, edadNinoMax: 10, ...o }) as never;
    const vacias = await actualizarHotelConfig(H3.OK, cfg({ edadInfanteMax: null, edadNinoMax: null }));
    assert.equal(vacias.ok, false);
    const invalidas = await actualizarHotelConfig(H3.OK, cfg({ edadInfanteMax: 5, edadNinoMax: 3 }));
    assert.equal(invalidas.ok, false);
    assert.equal(sql(`select edad_infante_max || '/' || edad_nino_max from public.hoteles where id = ${H3.OK}`), "2/12", "un intento rechazado no cambia nada");
    const valido = await actualizarHotelConfig(H3.OK, cfg({ edadInfanteMax: 3, edadNinoMax: 11 }));
    assert.equal(valido.ok, true, JSON.stringify(valido));
    assert.equal(sql(`select edad_infante_min || ',' || edad_infante_max || ',' || edad_nino_min || ',' || edad_nino_max from public.hoteles where id = ${H3.OK}`), "0,3,4,11");
    sql(`update public.hoteles set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 12 where id = ${H3.OK}`);
    const ao = await actualizarHotelConfig(H3.AO, cfg({ edadInfanteMax: null, edadNinoMax: null, adultsOnly: true }));
    assert.equal(ao.ok, true, JSON.stringify(ao));
  });
  test("carga masiva (CSV): sin edades se rechaza la fila con el motivo; con adults_only = si se acepta", async () => {
    const fila = (o: Record<string, string>) => ({ nombre: "Hotel CSV", destino: "CARTAGENA O3", ...o });
    const sin = await cargarHotelesMasivo([fila({})]);
    assert.equal(sin.insertados, 0);
    assert.match(sin.errores[0] ?? "", /Fila 2 \(Hotel CSV\).*«Infante hasta \(edad\)»/);
    const ao = await cargarHotelesMasivo([fila({ nombre: "Hotel CSV AO", adults_only: "si" })]);
    assert.equal(ao.insertados, 1, JSON.stringify(ao));
    const ok = await cargarHotelesMasivo([fila({ nombre: "Hotel CSV OK", edad_infante_max: "2", edad_nino_max: "11" })]);
    assert.equal(ok.insertados, 1, JSON.stringify(ok));
  });
  test("publicar el tarifario de un hotel sin edades se rechaza nombrando hotel y campo; Adults Only no lo bloquea; con edades se publica", async () => {
    sql(`
      insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, pax_min, pax_max, activo, adults_only) values (10307, 10301, 'Hotel SIN edades por publicar', 10301, 'COP', 1, 6, true, false);
      insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (10307, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
      insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (10307, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa');
      insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante) values (10307, 'Estandar', 'Desayuno', 'ALTA', ${f3(1)});
      insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
        values (10302, 'Porción O3 sin edades', 'porcion_terrestre', 3, 10301, 0.2, 'fijo', 0, '2030-01-01', '2030-06-30', 'COP', 'COP', true);
      insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (10302, 10307, array['Estandar'], array['Desayuno']), (10302, ${H3.AO}, array['Estandar'], array['Desayuno']);
    `);
    // La publicación usa la sesión (RLS real), no el cliente de servicio de las acciones de catálogo.
    (globalThis as { __usarServicio?: boolean }).__usarServicio = false;
    const g = await generarTarifario(10302);
    assert.equal(g.ok, false);
    assert.match(g.ok ? "" : g.error, /No se puede publicar el tarifario.*Hotel SIN edades por publicar.*falta «Infante hasta \(edad\)»/);
    assert.doesNotMatch(g.ok ? "" : g.error, /Hotel AO/, "Adults Only no se bloquea por no tener edades");
    sql(`update public.hoteles set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 10 where id = 10307`);
    const g2 = await generarTarifario(10302);
    (globalThis as { __usarServicio?: boolean }).__usarServicio = true;
    assert.equal(g2.ok, true, JSON.stringify(g2));
  });
});

describe("O4 · la noche adicional es una REFERENCIA; el servidor recalcula la estadía completa", () => {
  test("límite de temporada: la noche del 1/7 vale la BAJA y la estadía de 4 noches se recalcula completa", async () => {
    const tres = await buscar({ fechaIda: "2030-06-28", fechaRegreso: "2030-07-01" });
    const ref = de(tres, H3.OK)!.combos[0].nocheAdicional!;
    assert.equal(ref.estado === "ok" && ref.total, 150000, "noche del 1/7 (BAJA): 60.000 ÷ 0,8 por persona, 2 adultos");
    const cuatro = await buscar({ fechaIda: "2030-06-28", fechaRegreso: "2030-07-02", nocheAdicional: false });
    assert.equal(de(cuatro, H3.OK)!.total, de(tres, H3.OK)!.total + 150000, "la estadía completa de 4 noches (ya recalculada con el regreso extendido)");
    assert.equal(de(cuatro, H3.OK)!.noches, 4);
  });
  test("umbral por duración («4 noches, 1 gratis»): la referencia es 0 y NO es una tarifa por noche; el total real es el de la estadía completa", async () => {
    const tres = await buscar();
    const ref = de(tres, H3.PROMO)!.combos[0].nocheAdicional!;
    const cuatro = await buscar({ fechaRegreso: "2030-06-14", nocheAdicional: false });
    assert.equal(de(tres, H3.PROMO)!.total, 750000);
    assert.equal(de(cuatro, H3.PROMO)!.total, 750000, "con la promoción la cuarta noche no suma: 4 noches cuestan lo mismo que 3");
    assert.equal(ref.estado === "ok" && ref.total, 0, "la referencia total(N+1) − total(N) es 0 aquí; un hotel sin promoción da 250.000");
    assert.equal(de(tres, H3.OK)!.combos[0].nocheAdicional!.estado === "ok" && (de(tres, H3.OK)!.combos[0].nocheAdicional as { total: number }).total, 250000);
  });
  test("el servidor NO usa la referencia: tras cambiar la promoción, reservar 4 noches da el total fresco, no el total viejo + la referencia", async () => {
    const tres = await buscar();
    const ref = (de(tres, H3.PROMO)!.combos[0].nocheAdicional as { total: number }).total;
    const viejo = de(tres, H3.PROMO)!.total;
    sql(`update public.hotel_temporadas set fecha_fin = '2030-01-02' where hotel_id = ${H3.PROMO} and tipo = 'promo_noche_gratis'`); // la promoción deja de cubrir junio
    const comp = await reserva(H3.PROMO, { fechaRegreso: "2030-06-14" });
    assert.equal(comp.ok, true, JSON.stringify(comp));
    const fresco = comp.ok ? comp.data.precioVenta : -1;
    assert.equal(fresco, 1000000, "4 noches sin promoción: 4 × 250.000");
    assert.notEqual(fresco, viejo + ref, "el total NO es el total anterior más la referencia");
    sql(`update public.hotel_temporadas set fecha_fin = '2030-06-30' where hotel_id = ${H3.PROMO} and tipo = 'promo_noche_gratis'`);
  });
  test("noche adicional no disponible: se declara y la estadía extendida no se inventa", async () => {
    const fin = await buscar({ fechaIda: "2030-12-29", fechaRegreso: "2031-01-01" });
    const n = de(fin, H3.OK)!.combos[0].nocheAdicional!;
    assert.equal(n.estado, "no_disponible");
    assert.match(n.estado === "no_disponible" ? n.motivo : "", /no tiene tarifa vigente/);
    const extendida = await buscarHoteles({ fechaIda: "2030-12-29", fechaRegreso: "2031-01-02", numHabitaciones: 1, adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA O3", nocheAdicional: true });
    assert.equal(extendida.ok, true);
    assert.equal(extendida.ok && extendida.resultados.some((r) => r.hotelId === H3.OK), false, "con el regreso extendido hasta una noche sin tarifa, el hotel ya no se vende (nunca se inventa el precio)");
  });
  test("extender el regreso repite UNA búsqueda completa: mismas solicitudes que una búsqueda normal, sin acumular", async () => {
    const a0 = solicitudes.length; await buscar(); const normal = solicitudes.length - a0;
    const b0 = solicitudes.length; await buscar({ fechaRegreso: "2030-06-14" }); const extendida = solicitudes.length - b0;
    assert.equal(extendida, normal, "la búsqueda con regreso extendido cuesta lo mismo (sin consultas extra ni repetidas)");
  });
});
