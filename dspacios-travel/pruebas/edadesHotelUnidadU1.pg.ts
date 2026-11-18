// U1 (2026-11-17) · la configuración de edades del HOTEL es obligatoria también para hoteles por UNIDAD (Bernalo): una regla de edad explícita en la tarifa no la reemplaza.
//   Trayecto REAL contra PostgreSQL por HTTP: tarifasUnidadActions (crear/actualizar/duplicar/publicar), computarReservaBernalo y buscarAlojamientosUnidadPorFechas, sin simular el motor de precios.
// Lo ÚNICO simulado: la sesión (auth.getUser) y efectos laterales ajenos. Base LOCAL desechable; no corre en `npm run test:*`.
// Lanzar (desde dspacios-travel/): sh supabase/scripts/test_pg_local.sh pg304 g106_base PG102 pruebas/edadesHotelUnidadU1.pg.ts <migraciones 303, 304, 307, 308, 309 y 311 en supabase/migrations/>
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


mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true },
});
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
// Cliente de servicio SOLO para saltar la RLS de catálogos (exige un contexto de agencia de sesión que otras pruebas ya cubren): la validación de edades que se prueba es la de la acción real.
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteLocal(TOKEN_SERVICIO) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { crearTarifaUnidadBorrador, actualizarTarifaUnidadBorrador, duplicarTarifaUnidadVersion, publicarTarifaUnidad } =
  await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/tarifasUnidadActions.ts");
const { computarReservaBernalo } = await import("../lib/reservar/computoReservaBernalo.ts");
const { buscarAlojamientosUnidadPorFechas } = await import("../app/tarifario/busquedaUnidadActions.ts");
const { validarHabitacionesOcupacion } = await import("../lib/reservar/ocupacionPorHabitacion.ts");

// ── Semilla SINTÉTICA: destino CARTAGENA U1 (ids 1031x), todos los hoteles con modelo tarifario «unidad» ────────────────────────────────────────────────
//   OK    edades válidas (infante hasta 2, niño hasta 10)           · tarifa con reglas explícitas legítimas
//   NULO  acepta menores y NO tiene edades                         · nace así: no se puede crear ni publicar ninguna tarifa
//   INV   edades inválidas (infante hasta 5, niño hasta 3)          · idem
//   AO    Adults Only (exento de edades, rechaza menores)
//   LEG   «heredado»: tarifa publicada cuando el hotel estaba bien; después se le quitan las edades (tarifa ya publicada)
//   LEG2  «heredado» con edades inválidas
const DEST = 10311, PAQ = 10311;
const H = { OK: 10311, NULO: 10312, INV: 10313, AO: 10314, LEG: 10315, LEG2: 10316 } as const;
const NOM: Record<number, string> = { 10311: "U1 Hotel OK", 10312: "U1 Hotel NULO", 10313: "U1 Hotel INV", 10314: "U1 Hotel AO", 10315: "U1 Hotel LEG", 10316: "U1 Hotel LEG2" };
const IDA = "2030-06-10", REG = "2030-06-13";
const REGLAS = [
  { categoria: "infante" as const, edadMinAnios: 0, edadMaxAnios: 2 },
  { categoria: "nino" as const, edadMinAnios: 3, edadMaxAnios: 10 },
  { categoria: "adulto" as const, edadMinAnios: 11, edadMaxAnios: 17 },
];
const entrada = (version: string, over: Record<string, unknown> = {}) => ({
  versionTarifario: version, temporada: "ALTA", comisionPct: 20, categoria: "Estandar", alimentacion: "PAM", unidadCobro: "persona" as const, valorBase: 100000,
  nino: 50000, infante: 0, periodicidadInfante: "por_noche" as const, capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 0 },
  suplementos: { adultoAdicional: null, personaSola: null, menorAdicionalNino: null, menorAdicionalInfante: null },
  reglasEdad: REGLAS, fuenteDocumento: null, fuentePagina: null, ...over,
});

before(() => {
  const todos = Object.values(H);
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin103@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin103@x.test', 'Admin 103', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA U1') on conflict do nothing;
    insert into public.proveedores (id, nombre, tipo) values (10311, 'Proveedor Hotel U1', 'hotelero') on conflict do nothing;
    insert into public.categorias_habitacion (nombre) values ('Estandar') on conflict do nothing;
    insert into public.planes_alimentacion (codigo, nombre) values ('PAM', 'Pension alimenticia media') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, modelo_tarifario, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
      ${todos.map((h) => {
        const ages = h === H.NULO || h === H.AO ? "null, null, null, null" : h === H.INV ? "0, 5, 6, 3" : "0, 2, 3, 10";
        return `(${h}, ${DEST}, '${NOM[h]}', 10311, 'COP', 'unidad', ${ages}, 1, 6, true, ${h === H.AO ? "true" : "false"})`;
      }).join(", ")};
    insert into public.hotel_categorias (hotel_id, categoria_id) select h, (select id from public.categorias_habitacion where nombre = 'Estandar') from unnest(array[${todos.join(",")}]) h;
    insert into public.hotel_regimenes (hotel_id, plan_id) select h, (select id from public.planes_alimentacion where codigo = 'PAM') from unnest(array[${todos.join(",")}]) h;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) select h, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa' from unnest(array[${todos.join(",")}]) h;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ}, 'Porción U1', 'porcion_terrestre', 3, ${DEST}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) select ${PAQ}, h, array['Estandar'], array['PAM'] from unnest(array[${todos.join(",")}]) h;
  `);
});

const contar = (patron: RegExp) => solicitudes.filter((u) => patron.test(u)).length;
const habitaciones = (menores: number[]) => {
  const v = validarHabitacionesOcupacion([{ id: "h1", acom: "doble", adultos: 2, cantidadMenores: menores.length, edadesMenores: menores }]);
  assert.equal(v.ok, true, JSON.stringify(v));
  return (v as { ok: true; habitaciones: never[] }).habitaciones;
};
const cotizar = (hotelId: number, menores: number[]) => computarReservaBernalo({
  paqueteId: PAQ, hotelId, categoria: "Estandar", alimentacion: "PAM", salida: { tipo: "sin_vuelo", fechaIda: IDA, fechaRegreso: REG }, habitaciones: habitaciones(menores),
} as never);
const payload = (hotelId: number) => sql(`select payload::text from public.hotel_tarifas_unidad where hotel_id = ${hotelId} and estado = 'publicada' order by id desc limit 1`);

describe("U1 · crear y publicar una tarifa por unidad: las reglas explícitas NO reemplazan la configuración de edades del hotel", () => {
  test("hotel sin edades + reglas explícitas: la creación se rechaza nombrando el hotel y los campos (no hay borrador)", async () => {
    const r = await crearTarifaUnidadBorrador(H.NULO, entrada("u1-nulo"));
    assert.equal(r.ok, false, JSON.stringify(r));
    const e = (r as { error: string }).error;
    assert.match(e, /U1 Hotel NULO/);
    assert.match(e, /Infante hasta/);
    assert.match(e, /Niño hasta/);
    assert.match(e, /solo con adultos/);
    assert.equal(sql(`select count(*) from public.hotel_tarifas_unidad where hotel_id = ${H.NULO}`), "0");
  });
  test("hotel con edades inválidas + reglas explícitas: se rechaza con «valor no válido»", async () => {
    const r = await crearTarifaUnidadBorrador(H.INV, entrada("u1-inv"));
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match((r as { error: string }).error, /valor no válido/);
    assert.equal(sql(`select count(*) from public.hotel_tarifas_unidad where hotel_id = ${H.INV}`), "0");
  });
  test("hotel válido + override legítimo: se crea y se publica, y la regla explícita queda tal cual (no se sobrescribe)", async () => {
    const c = await crearTarifaUnidadBorrador(H.OK, entrada("u1-ok", { reglasEdad: [{ categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 }, { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 12 }, { categoria: "adulto", edadMinAnios: 13, edadMaxAnios: 17 }] }));
    assert.equal(c.ok, true, JSON.stringify(c));
    const p = await publicarTarifaUnidad((c as { id: number }).id, H.OK);
    assert.equal(p.ok, true, JSON.stringify(p));
    const reglas = JSON.parse(payload(H.OK)).reglaMenores.reglas as { categoria: string; edadMaxAnios: number }[];
    assert.deepEqual(reglas.map((x) => x.edadMaxAnios), [3, 12, 17], "el override del hotel válido es la clasificación efectiva de la tarifa");
  });
  test("Adults Only: exento de edades — se crea y se publica sin configuración de edades", async () => {
    const c = await crearTarifaUnidadBorrador(H.AO, entrada("u1-ao"));
    assert.equal(c.ok, true, JSON.stringify(c));
    const p = await publicarTarifaUnidad((c as { id: number }).id, H.AO);
    assert.equal(p.ok, true, JSON.stringify(p));
  });
  test("tarifa publicada con el hotel bien configurado y luego «heredada» sin edades: actualizar, duplicar y publicar otro borrador se rechazan", async () => {
    for (const h of [H.LEG, H.LEG2]) {
      const c = await crearTarifaUnidadBorrador(h, entrada(`u1-leg-${h}`));
      assert.equal(c.ok, true, JSON.stringify(c));
      const p = await publicarTarifaUnidad((c as { id: number }).id, h);
      assert.equal(p.ok, true, JSON.stringify(p));
    }
    // un borrador adicional de LEG, creado mientras el hotel todavía estaba bien (documento en borrador)
    const borrador = await crearTarifaUnidadBorrador(H.LEG, entrada("u1-leg-borrador", { temporada: "ALTA", valorBase: 105000 }));
    assert.equal(borrador.ok, true, JSON.stringify(borrador));
    const idBorrador = (borrador as { id: number }).id;
    const idPublicada = Number(sql(`select id from public.hotel_tarifas_unidad where hotel_id = ${H.LEG} and estado = 'publicada'`));
    const antes = payload(H.LEG);
    sql(`
      update public.hoteles set edad_infante_min = null, edad_infante_max = null, edad_nino_min = null, edad_nino_max = null where id = ${H.LEG};
      update public.hoteles set edad_infante_min = 0, edad_infante_max = 5, edad_nino_min = 6, edad_nino_max = 3 where id = ${H.LEG2};
    `);
    const pub = await publicarTarifaUnidad(idBorrador, H.LEG);
    assert.equal(pub.ok, false, JSON.stringify(pub));
    assert.match((pub as { error: string }).error, /U1 Hotel LEG/);
    const act = await actualizarTarifaUnidadBorrador(idBorrador, H.LEG, entrada("u1-leg-borrador", { valorBase: 110000 }));
    assert.equal(act.ok, false, JSON.stringify(act));
    const dup = await duplicarTarifaUnidadVersion(idPublicada, H.LEG, "u1-leg-v2");
    assert.equal(dup.ok, false, JSON.stringify(dup));
    assert.equal(sql(`select estado from public.hotel_tarifas_unidad where id = ${idBorrador}`), "borrador", "el borrador no se publicó");
    assert.equal(payload(H.LEG), antes, "la tarifa publicada existente (documento histórico) no se modificó");
  });
});

describe("U1 · cotizar y reservar (computarReservaBernalo) con tarifas YA publicadas", () => {
  test("solo adultos: el hotel «heredado» sin edades sigue cotizando, con el MISMO precio que el hotel con edades inválidas", async () => {
    const ok = await cotizar(H.OK, []);
    const leg = await cotizar(H.LEG, []);
    const leg2 = await cotizar(H.LEG2, []);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(leg.ok, true, JSON.stringify(leg));
    assert.equal(leg2.ok, true, JSON.stringify(leg2));
    assert.equal((leg as { precioVenta: number }).precioVenta, (leg2 as { precioVenta: number }).precioVenta);
    assert.ok((ok as { precioVenta: number }).precioVenta > 0);
  });
  test("con un menor: el hotel sin edades / con edades inválidas rechaza con el motivo accionable (hotel y campos)", async () => {
    const a = await cotizar(H.LEG, [5]);
    assert.equal(a.ok, false);
    assert.equal((a as { codigo: string }).codigo, "edades_hotel_incompletas");
    assert.match((a as { mensaje: string }).mensaje, /U1 Hotel LEG/);
    assert.match((a as { mensaje: string }).mensaje, /Infante hasta/);
    const b = await cotizar(H.LEG2, [5]);
    assert.equal((b as { codigo: string }).codigo, "edades_hotel_incompletas");
    assert.match((b as { mensaje: string }).mensaje, /valor no válido/);
  });
  test("con un menor: el hotel configurado cotiza (la regla explícita publicada es la clasificación efectiva)", async () => {
    const r = await cotizar(H.OK, [5]);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  test("Adults Only rechaza menores con su propio código y cotiza solo adultos", async () => {
    const a = await cotizar(H.AO, [5]);
    assert.equal((a as { codigo: string }).codigo, "hotel_solo_adultos");
    const b = await cotizar(H.AO, []);
    assert.equal(b.ok, true, JSON.stringify(b));
  });
  test("recursos: el rechazo por edades no agrega consultas (usa la fila del hotel ya leída)", async () => {
    solicitudes.length = 0;
    await cotizar(H.LEG, [5]);
    assert.equal(contar(/\/hoteles\?/), 0, "no hay una lectura aparte de `hoteles`: la configuración viaja con la consulta de armado_hoteles");
    assert.equal(solicitudes.length, 2, `el rechazo ocurre tras 2 lecturas (paquete y hotel vinculado): ${solicitudes.join(" | ")}`);
  });
});

describe("U1 · búsqueda por unidad: con menores el hotel sin edades se explica; solo adultos continúa", () => {
  const buscar = (menores: number[]) => buscarAlojamientosUnidadPorFechas({
    fechaIda: IDA, fechaRegreso: REG, destino: "CARTAGENA U1", destinoId: DEST, habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: menores.length, edadesMenores: menores,
  });
  test("solo adultos: disponible también el hotel sin edades; nada en revisión", async () => {
    const r = await buscar([]);
    assert.equal(r.ok, true, JSON.stringify(r));
    const ok = r as Extract<typeof r, { ok: true }>;
    const dispo = new Set(ok.disponibilidad.filter((d) => d.estado === "disponible").map((d) => d.hotelId));
    for (const h of [H.OK, H.LEG, H.LEG2, H.AO]) assert.ok(dispo.has(h), `${NOM[h]} disponible`);
    assert.deepEqual(ok.enRevision, []);
  });
  test("con un menor: los hoteles sin edades válidas quedan EN REVISIÓN con motivo (no omitidos en silencio) y el configurado sigue", async () => {
    const r = await buscar([5]);
    assert.equal(r.ok, true, JSON.stringify(r));
    const ok = r as Extract<typeof r, { ok: true }>;
    const rev = new Map(ok.enRevision.map((x) => [x.hotelId, x]));
    assert.deepEqual([...rev.keys()].sort(), [H.LEG, H.LEG2].sort());
    for (const h of [H.LEG, H.LEG2]) {
      assert.equal(rev.get(h)!.codigo, "edades_hotel_incompletas");
      assert.match(rev.get(h)!.motivo, new RegExp(NOM[h]));
    }
    const estado = new Map(ok.disponibilidad.map((d) => [d.hotelId, d.estado]));
    assert.equal(estado.get(H.OK), "disponible");
    assert.equal(estado.get(H.AO), "sin_disponibilidad", "Adults Only rechaza menores por su propia regla");
    assert.equal(estado.has(H.LEG), false, "el hotel sin edades no se declara disponible ni sin disponibilidad");
    assert.equal(ok.incompleto, false, "es un veredicto con fundamento, no una búsqueda incompleta");
  });
});
