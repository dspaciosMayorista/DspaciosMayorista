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
const { buscarHoteles } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

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


const IDA = "2030-06-10", REG = "2030-06-13";
const MODO = process.env.MEDIR_MODO ?? "legado";
const entrada = (extra: Record<string, unknown> = {}) => ({
  fechaIda: IDA, fechaRegreso: REG, adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA 102",
  ...(MODO === "nuevo" ? { numHabitaciones: 1 } : { habitaciones: [{ acom: "doble" }] }), ...extra,
});
describe("medición de consumo (#102)", () => {
  test("generar y medir 3 búsquedas idénticas de 5 hoteles + reposo", async () => {
    assert.equal((await generarTarifario(PAQ)).ok, true);
    const filas: string[] = [];
    for (const [nombre, extra] of [["2 adultos", {}], ["2 adultos + menor de 8", { cantidadMenores: 1, edadesMenores: [8] }], ["2 adultos + menor de 15", { cantidadMenores: 1, edadesMenores: [15] }]] as const) {
      const antes = solicitudes.length; const t0 = performance.now();
      const r = await buscarHoteles(entrada(extra) as never);
      const ms = Math.round(performance.now() - t0);
      const usadas = solicitudes.slice(antes);
      const por = (t: string) => usadas.filter((u) => u.startsWith("/" + t)).length;
      filas.push(`${MODO} · ${nombre}: ok=${r.ok} resultados=${r.ok ? r.resultados.length : "-"} solicitudes=${usadas.length} (hotel_acomodaciones=${por("hotel_acomodaciones")}, hoteles=${por("hoteles")}) tiempo=${ms}ms`);
    }
    for (const l of filas) console.log("[102-MEDICION] " + l);
    const fin = solicitudes.length; await new Promise((r) => setTimeout(r, 500));
    console.log("[102-MEDICION] solicitudes en reposo tras 500 ms: " + (solicitudes.length - fin));
  });
});
