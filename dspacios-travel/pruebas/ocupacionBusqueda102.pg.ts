// #102 · Ocupación de la búsqueda general, Vista tabla y noche adicional — trayecto REAL contra PostgreSQL por HTTP, SIN simular el motor de precios:
//   generarTarifario (publica el tarifario) → buscarHoteles (Server Action REAL, mismo motor de Vista Booking y de la Vista tabla) → cotizarPorFechas y
//   computarReserva (motor de la tarjeta interna y de la reserva) para comprobar que los tres dan el MISMO valor.
// Lo ÚNICO simulado: la sesión (auth.getUser; el cliente "de sesión" es un cliente PostgREST real con JWT `authenticated`) y efectos laterales ajenos.
// SOLO base LOCAL desechable. No corre en `npm run test:*`: la lanza supabase/scripts/test_102_ocupacion.sh (variables PG102_*).
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
  throw new Error("Faltan PG102_BASE (desechable), PG102_POSTGREST y PG102_JWT_SECRET: usa supabase/scripts/test_102_ocupacion.sh.");
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
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { buscarHoteles, cotizarPorFechas } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { computarReserva } = await import("../lib/reservar/computo.ts");

// ── Semilla SINTÉTICA ──────────────────────────────────────────────────────
// Destino CARTAGENA 102 · paquete de porción de 3 noches · mk 20 % · sin impuesto. Cifras elegidas para que cada PVP por persona sea exacto:
//   PVP persona (3 noches) = neto/noche × 3 ÷ 0,8.   ALTA (01/01–30/06/2030): sencilla 160.000 · doble 100.000 · triple 96.000 · múltiple 80.000 · Niño 1 40.000 · Niño 2 24.000 · infante 16.000
//   BAJA (01/07–31/12/2030) = 60 % de ALTA. Promoción «5 de julio»: −20 % solo esa noche.
const PAQ = 10201;
const H = { A: 10201, B: 10202, C: 10203, D: 10204, E: 10205 } as const;
const NOMBRE: Record<number, string> = { 10201: "Hotel A (niño hasta 12)", 10202: "Hotel B (niño hasta 17)", 10203: "Hotel C (sin múltiple)", 10204: "Hotel D (solo adultos)", 10205: "Hotel E (edades por temporada)" };
const netos = (f: number) => `${160000 * f}, ${100000 * f}, ${96000 * f}, ${80000 * f}, ${40000 * f}, ${24000 * f}, ${16000 * f}`;

before(() => {
  const acom = (h: number, tipos: string[]) => tipos.map((t) => ({
    sencilla: `(${h}, 'sencilla', 1, 2, 1, 1, 0, 1, 0, 1)`, doble: `(${h}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2)`,
    triple: `(${h}, 'triple', 3, 4, 3, 3, 0, 1, 0, 1)`, multiple: `(${h}, 'multiple', 4, 5, 4, 4, 0, 1, 0, 1)`,
  } as Record<string, string>)[t]).join(", ");
  const filaTarifa = (h: number, temp: string, f: number, extra = "") =>
    `(${h}, 'Estandar', 'Desayuno', '${temp}', ${netos(f)}${extra})`;
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin102@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin102@x.test', 'Admin 102', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (10201, 'CARTAGENA 102') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (10201, 'Proveedor Hotel 102') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
      (${H.A}, 10201, '${NOMBRE[H.A]}', 10201, 'COP', 0, 2, 3, 12, 1, 6, true, false),
      (${H.B}, 10201, '${NOMBRE[H.B]}', 10201, 'COP', 0, 2, 3, 17, 1, 6, true, false),
      (${H.C}, 10201, '${NOMBRE[H.C]}', 10201, 'COP', 0, 2, 3, 12, 1, 6, true, false),
      (${H.D}, 10201, '${NOMBRE[H.D]}', 10201, 'COP', null, null, null, null, 1, 6, true, true),
      (${H.E}, 10201, '${NOMBRE[H.E]}', 10201, 'COP', 0, 2, 3, 12, 1, 6, true, false);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values
      ${acom(H.A, ["sencilla", "doble", "triple", "multiple"])}, ${acom(H.B, ["sencilla", "doble", "triple", "multiple"])},
      ${acom(H.C, ["sencilla", "doble", "triple"])}, ${acom(H.D, ["sencilla", "doble"])}, ${acom(H.E, ["sencilla", "doble", "triple", "multiple"])};
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
      ${[H.A, H.B, H.C, H.D, H.E].map((h) => `(${h}, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa'), (${h}, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa')`).join(", ")};
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
      values (${H.A}, 'PROMO 5 JULIO', '2030-07-05', '2030-07-05', 5, 'descuento_pct', 20);
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante) values
      ${filaTarifa(H.A, "ALTA", 1)}, ${filaTarifa(H.A, "BAJA", 0.6)}, ${filaTarifa(H.B, "ALTA", 1)}, ${filaTarifa(H.B, "BAJA", 0.6)},
      ${filaTarifa(H.C, "ALTA", 1)}, ${filaTarifa(H.C, "BAJA", 0.6)}, ${filaTarifa(H.D, "ALTA", 1)}, ${filaTarifa(H.D, "BAJA", 0.6)},
      ${filaTarifa(H.E, "ALTA", 1)}, ${filaTarifa(H.E, "BAJA", 0.6)},
      -- La promoción necesita SU propia fila materializada (el sistema no deriva precios de una base): −20 % sobre la BAJA.
      ${filaTarifa(H.A, "PROMO 5 JULIO", 0.48)};
    update public.tarifa_hotel set neto_triple = null, neto_multiple = null where hotel_id = ${H.D};
    update public.tarifa_hotel set neto_multiple = null where hotel_id = ${H.C};
    -- Hotel E: la ALTA clasifica niños hasta 12 años y la BAJA hasta 17 → una estadía que cruza ambas NO tiene una regla de edad única.
    update public.tarifa_hotel set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 12 where hotel_id = ${H.E} and temporada = 'ALTA';
    update public.tarifa_hotel set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 17 where hotel_id = ${H.E} and temporada = 'BAJA';
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ}, 'Porción 102', 'porcion_terrestre', 3, 10201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
      select ${PAQ}, h, array['Estandar'], array['Desayuno'] from unnest(array[${Object.values(H).join(",")}]) h;
  `);
});
after(() => { console.log(`\n[102] solicitudes totales al API de datos durante la prueba: ${solicitudes.length}`); });

type Hallado = Awaited<ReturnType<typeof buscarHoteles>>;
const IDA = "2030-06-10", REG = "2030-06-13";
async function buscar(over: Record<string, unknown> = {}): Promise<Extract<Hallado, { ok: true }>> {
  const r = await buscarHoteles({ fechaIda: IDA, fechaRegreso: REG, numHabitaciones: 1, adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA 102", nocheAdicional: true, ...over });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<Hallado, { ok: true }>;
}
const de = (r: Extract<Hallado, { ok: true }>, h: number) => r.resultados.find((x) => x.hotelId === h);

describe("generación del tarifario sintético", () => {
  test("se publica el paquete de porción con los cinco hoteles", async () => {
    const g = await generarTarifario(PAQ);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.equal(sql(`select count(distinct hotel_id) from public.tarifario_resultado_publicable where paquete_id = ${PAQ}`), "5");
  });
});

describe("1 habitación: 2, 3 y 4 adultos", () => {
  test("2 adultos → Doble (2 × 375.000); 3 → Triple; 4 → Múltiple solo en hoteles que lo venden", async () => {
    const dos = await buscar();
    const a = de(dos, H.A)!;
    assert.equal(a.total, 750000);
    assert.deepEqual(a.combos[0].habitaciones, { doble: 1 });
    assert.equal(a.combos[0].resumenHabitaciones, "1 Doble");
    assert.deepEqual(a.combos[0].desglose?.map((l) => [l.clase, l.cantidad, l.tarifa, l.subtotal]), [["adulto", 2, 375000, 750000]]);

    const tres = await buscar({ adultos: 3 });
    assert.equal(de(tres, H.A)!.total, 3 * 360000);
    assert.deepEqual(de(tres, H.A)!.combos[0].habitaciones, { triple: 1 });
    assert.ok(de(tres, H.C), "Hotel C sí vende Triple");
    assert.equal(de(tres, H.D), undefined, "Hotel D (solo adultos, sin tarifa Triple) no ofrece 3 adultos en 1 habitación");

    const cuatro = await buscar({ adultos: 4 });
    assert.equal(de(cuatro, H.A)!.total, 4 * 300000);
    assert.deepEqual(de(cuatro, H.A)!.combos[0].habitaciones, { multiple: 1 });
    assert.equal(de(cuatro, H.C), undefined, "Hotel C no vende Múltiple: no se inventa una ocupación");
    assert.equal(de(cuatro, H.D), undefined);
    assert.ok(de(cuatro, H.B) && de(cuatro, H.E));
  });
  test("5 adultos en 1 habitación: ningún hotel puede (sin reparto), con el motivo real", async () => {
    const r = await buscar({ adultos: 5 });
    assert.equal(r.resultados.length, 0);
    assert.match(r.diagnostico ?? "", /no se pueden repartir en 1 habitación/);
  });
});

describe("varias habitaciones: viajeros conservados y reparto válido", () => {
  test("3 adultos en 2 habitaciones → Doble + Sencilla", async () => {
    const r = await buscar({ numHabitaciones: 2, adultos: 3 });
    const a = de(r, H.A)!;
    assert.deepEqual(a.combos[0].habitaciones, { doble: 1, sencilla: 1 });
    assert.equal(a.total, 750000 + 600000);
    assert.equal(a.combos[0].asignacion?.reduce((s, h) => s + h.adultos, 0), 3);
  });
  test("4 adultos en 2 habitaciones → 2 Dobles; 6 adultos en 2 → 2 Triples", async () => {
    assert.equal(de(await buscar({ numHabitaciones: 2, adultos: 4 }), H.A)!.total, 1500000);
    const seis = await buscar({ numHabitaciones: 2, adultos: 6 });
    assert.deepEqual(de(seis, H.A)!.combos[0].habitaciones, { triple: 2 });
  });
  test("más habitaciones que viajeros se rechaza ANTES de leer el catálogo (cero solicitudes)", async () => {
    const antes = solicitudes.length;
    const r = await buscarHoteles({ fechaIda: IDA, fechaRegreso: REG, numHabitaciones: 3, adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA 102" });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /cada habitación necesita al menos una persona/);
    assert.equal(solicitudes.length - antes, 0, "una consulta imposible no toca la base");
    for (const mala of [{ numHabitaciones: 0 }, { numHabitaciones: 9 }, { numHabitaciones: 1.5 }, { numHabitaciones: "2" }, { adultos: 0 }, { adultos: 2.5 }]) {
      const n = solicitudes.length;
      const x = await buscarHoteles({ fechaIda: IDA, fechaRegreso: REG, numHabitaciones: 1, adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA 102", ...mala });
      assert.equal(x.ok, false, JSON.stringify(mala));
      assert.equal(solicitudes.length - n, 0, `entrada inválida ${JSON.stringify(mala)} no debe consultar la base`);
    }
  });
  test("indicar a la vez numHabitaciones y habitaciones[] o ninguna de las dos se rechaza", async () => {
    const a = await buscarHoteles({ fechaIda: IDA, fechaRegreso: REG, numHabitaciones: 1, habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA 102" });
    assert.equal(a.ok, false);
    const b = await buscarHoteles({ fechaIda: IDA, fechaRegreso: REG, adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA 102" });
    assert.equal(b.ok, false);
  });
});

describe("2 adultos + un menor de 15 años + 1 habitación: depende de cada hotel", () => {
  test("Hotel A cobra TRES adultos en Triple; Hotel B cobra Doble + Niño 1", async () => {
    const r = await buscar({ cantidadMenores: 1, edadesMenores: [15] });
    const a = de(r, H.A)!, b = de(r, H.B)!;
    assert.equal(a.total, 3 * 360000);
    assert.deepEqual(a.combos[0].habitaciones, { triple: 1 });
    assert.deepEqual(a.combos[0].edadesComoAdulto, [15], "la edad real se conserva");
    assert.deepEqual(a.combos[0].edadesMenores, []);
    assert.equal(b.total, 750000 + 150000);
    assert.deepEqual(b.combos[0].habitaciones, { doble: 1 });
    assert.deepEqual(b.combos[0].edadesMenores, [15]);
    assert.equal(b.combos[0].menores.nino, 1);
    assert.equal(de(r, H.D), undefined, "Hotel D es solo adultos: no acepta menores");
    // Hotel C (niño hasta 12) también lo cobra como adulto y sí vende Triple
    assert.equal(de(r, H.C)!.total, 3 * 360000);
  });
  test("fronteras de edad: 12 es niño y 13 es adulto en el Hotel A; 17 es niño en el B", async () => {
    const doce = await buscar({ cantidadMenores: 1, edadesMenores: [12] });
    assert.equal(de(doce, H.A)!.total, 750000 + 150000);
    const trece = await buscar({ cantidadMenores: 1, edadesMenores: [13] });
    assert.equal(de(trece, H.A)!.total, 3 * 360000);
    assert.equal(de(trece, H.B)!.total, 750000 + 150000);
    const diecisiete = await buscar({ cantidadMenores: 1, edadesMenores: [17] });
    assert.equal(de(diecisiete, H.A)!.total, 3 * 360000);
    assert.equal(de(diecisiete, H.B)!.total, 750000 + 150000);
  });
  test("tres menores con tarifas distintas: infante (1 año), Niño 1 (5) y Niño 2 (8) en una Doble", async () => {
    const r = await buscar({ cantidadMenores: 3, edadesMenores: [1, 5, 8] });
    const b = de(r, H.B)!.combos[0];
    assert.deepEqual(b.desglose?.map((l) => [l.clase, l.cantidad, l.tarifa, !!l.menorDeDos]), [["adulto", 2, 375000, false], ["infante", 1, 60000, true], ["nino", 1, 150000, false], ["nino2", 1, 90000, false]]);
    assert.equal(b.total, 750000 + 60000 + 150000 + 90000);
    assert.equal(b.desglose?.reduce((s, l) => s + l.subtotal, 0), b.total, "el desglose suma exactamente el total");
    assert.deepEqual(b.desglose?.filter((l) => l.edades).map((l) => l.edades), [[1], [5], [8]]);
  });
});

describe("noche adicional: exactamente UNA noche, con la fecha de esa noche", () => {
  test("misma temporada: 250.000 (2 adultos) = total(4 noches) − total(3 noches)", async () => {
    const r = await buscar();
    const n = de(r, H.A)!.combos[0].nocheAdicional!;
    assert.equal(n.estado, "ok");
    assert.equal(n.estado === "ok" && n.total, 250000);
    const cuatro = await buscar({ fechaRegreso: "2030-06-14", nocheAdicional: false });
    assert.equal(de(cuatro, H.A)!.total - de(r, H.A)!.total, 250000, "la estadía de 4 noches de Vista Booking = estadía + noche adicional");
    assert.equal(n.estado === "ok" && n.desglose?.[0].tarifa, 125000, "tarifa de ADULTO de ESA noche (no un promedio de las 3)");
  });
  test("la noche cae en otra temporada: se cobra la de ESA fecha, no la del paquete", async () => {
    const r = await buscar({ fechaIda: "2030-06-28", fechaRegreso: "2030-07-01" });
    const n = de(r, H.A)!.combos[0].nocheAdicional!;
    assert.equal(n.estado === "ok" && n.total, 2 * 75000, "noche del 1 de julio (BAJA): 60.000 ÷ 0,8 por persona");
    assert.notEqual(n.estado === "ok" && n.total, 250000);
  });
  test("la noche tiene una promoción de un solo día: se aplica solo a esa noche", async () => {
    const r = await buscar({ fechaIda: "2030-07-02", fechaRegreso: "2030-07-05" });
    const n = de(r, H.A)!.combos[0].nocheAdicional!;
    assert.equal(n.estado === "ok" && n.total, 2 * 60000, "noche del 5 de julio: 60.000 −20 % = 48.000 ÷ 0,8 por persona");
    const normal = await buscar({ fechaIda: "2030-07-01", fechaRegreso: "2030-07-04" });
    assert.equal((de(normal, H.A)!.combos[0].nocheAdicional as { total: number }).total, 2 * 75000, "la noche del 4 de julio NO tiene la promoción");
  });
  test("menores incluidos: la noche adicional trae tarifa de adulto y de cada menor", async () => {
    const r = await buscar({ cantidadMenores: 1, edadesMenores: [8] });
    const n = de(r, H.A)!.combos[0].nocheAdicional!;
    assert.equal(n.estado === "ok" && n.total, 2 * 125000 + 50000);
    assert.deepEqual(n.estado === "ok" && n.desglose?.map((l) => [l.clase, l.tarifa]), [["adulto", 125000], ["nino", 50000]]);
  });
  test("la noche fuera de toda temporada se declara no disponible, sin inventar precio", async () => {
    const r = await buscar({ fechaIda: "2030-12-28", fechaRegreso: "2030-12-31" });
    const n = de(r, H.A)!.combos[0].nocheAdicional!;
    assert.equal(n.estado === "ok" && n.total, 2 * 75000, "31/12 aún tiene temporada BAJA");
    // La estadía 29/12→1/1 (noches 29, 30 y 31 de diciembre) sí tiene tarifa; la noche adicional sería la del 1/1/2031, fuera de toda temporada.
    const fin = await buscar({ fechaIda: "2030-12-29", fechaRegreso: "2031-01-01" });
    const sinTarifa = de(fin, H.A)!.combos[0].nocheAdicional!;
    assert.equal(sinTarifa.estado, "no_disponible");
    assert.match(sinTarifa.estado === "no_disponible" ? sinTarifa.motivo : "", /no tiene tarifa vigente/);
  });
  test("sin pedirla, la búsqueda general no calcula ni devuelve la noche adicional", async () => {
    const r = await buscar({ nocheAdicional: false });
    assert.equal(de(r, H.A)!.combos[0].nocheAdicional, undefined);
  });
});

describe("política de edades ambigua: hotel EN REVISIÓN, nunca una tarifa inventada", () => {
  test("Hotel E: la estadía cruza dos temporadas con reglas de edad distintas", async () => {
    const r = await buscar({ fechaIda: "2030-06-29", fechaRegreso: "2030-07-02", cantidadMenores: 1, edadesMenores: [15] });
    assert.equal(de(r, H.E), undefined);
    assert.deepEqual(r.enRevision?.map((h) => h.hotelId), [H.E]);
    const dentro = await buscar({ cantidadMenores: 1, edadesMenores: [15] });
    assert.ok(de(dentro, H.E), "dentro de una sola temporada la regla es única y sí se evalúa");
    // La estadía de 3 noches es ALTA pura, pero la noche adicional (1 de julio) cruza a la BAJA: se dice por qué, sin inventar el valor.
    const noche = de(await buscar({ fechaIda: "2030-06-28", fechaRegreso: "2030-07-01", cantidadMenores: 1, edadesMenores: [15] }), H.E)!.combos[0].nocheAdicional!;
    assert.equal(noche.estado, "no_disponible");
    assert.match(noche.estado === "no_disponible" ? noche.motivo : "", /reglas de edad/);
  });
});

describe("acuerdo entre la búsqueda, la tarjeta interna y la reserva", () => {
  test("mismo total en buscarHoteles, cotizarPorFechas (tarjeta) y computarReserva, incluida la edad que el hotel cobra como adulto", async () => {
    for (const edad of [8, 15]) {
      const r = await buscar({ cantidadMenores: 1, edadesMenores: [edad], nocheAdicional: false });
      for (const h of [H.A, H.B]) {
        const x = de(r, h)!, c = x.combos[0];
        const tarjeta = await cotizarPorFechas({ paqueteId: PAQ, hotelId: h, fechaIda: IDA, fechaRegreso: REG });
        assert.equal(tarjeta.ok, true);
        const combo = (tarjeta as { combos: { categoria: string; regimen: string; precios: Record<string, number> }[] }).combos.find((k) => k.categoria === c.categoria && k.regimen === c.regimen)!;
        const adultosTarjeta = Object.entries(c.habitaciones ?? {}).reduce((s, [a, n]) => s + n * ({ sencilla: 1, doble: 2, triple: 3, multiple: 4 } as Record<string, number>)[a] * combo.precios[a], 0);
        const menoresTarjeta = c.edadesMenores?.length ? combo.precios.nino : 0;
        assert.equal(adultosTarjeta + menoresTarjeta, x.total, `tarjeta interna, hotel ${h}, edad ${edad}`);
        const comp = await computarReserva(clienteSesion() as never, {
          paqueteId: PAQ, bloqueoId: null, modulo: "porcion_terrestre", hotelId: h, fechaIda: IDA, fechaRegreso: REG,
          categoria: c.categoria, regimen: c.regimen, habitaciones: c.habitaciones ?? {}, ninos: 0, ninos2: 0, infantes: 0,
          edadesMenores: c.edadesMenores ?? [], cantidadMenores: (c.edadesMenores ?? []).length,
          cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1", telefono: "3", email: "a@x.test" },
          tipoAsesor: "interno", asesorInterno: "Admin 102", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [],
        } as never);
        assert.equal(comp.ok, true, JSON.stringify(comp));
        assert.equal(comp.ok && comp.data.precioVenta, x.total, `reserva, hotel ${h}, edad ${edad}`);
      }
    }
  });
});

describe("consumo: solicitudes por búsqueda (el hotel no agrega consultas)", () => {
  test("política de ocupación y de edades de TODOS los hoteles en 2 solicitudes (lote), una vez por búsqueda", async () => {
    const antes = solicitudes.length;
    await buscar({ nocheAdicional: true });
    const usadas = solicitudes.slice(antes);
    const por = (t: string) => usadas.filter((u) => u.startsWith(`/${t}`)).length;
    console.log(`[102] solicitudes de UNA búsqueda (5 hoteles, con noche adicional): ${usadas.length} · hotel_acomodaciones=${por("hotel_acomodaciones")} · hoteles=${por("hoteles")} · tarifa_hotel=${por("tarifa_hotel")}`);
    assert.equal(por("hotel_acomodaciones"), 1);
    assert.equal(por("hoteles"), 1);
    assert.equal(por("tarifa_hotel"), 5, "una por hotel (carga previa del motor), SIN repetir para la noche adicional");
    // Reposo: después de terminar, nada más se solicita.
    const fin = solicitudes.length;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(solicitudes.length, fin, "en reposo no hay solicitudes");
  });
});
