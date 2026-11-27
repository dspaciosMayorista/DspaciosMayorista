// R2 (#51 / #33) — acciones REALES de la app contra PostgreSQL + PostgREST locales y desechables. Lo lanza supabase/scripts/test_r2_95_acciones.sh (no corre en `npm run test:*`).
//   R2-2  reserva con un servicio INCLUIDO → el paquete lo reclasifica / lo quita después → se elige ese mismo servicio como opcional → se quita otra vez.
//   R2-3  comparativa manual → opción elegida (hija) → contrato con titular/pasajero sintéticos → documento del cliente leído de nuevo (niño gratis y niño con tarifa).
// Lo único simulado: la sesión (auth.getUser; el cliente de sesión es PostgREST real con JWT `authenticated`), la numeración (RPC real), el contexto de cotización y efectos laterales ajenos. Dinero, catálogo, RLS, RPC y triggers: reales.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG95_CONTENEDOR ?? "";
const DB = process.env.PG95_BASE ?? "";
const PGRST = process.env.PG95_POSTGREST ?? "";
const SECRETO = process.env.PG95_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG95_*: usa supabase/scripts/test_r2_95_acciones.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/headers": "export async function headers() { return new Map([['host', 'localhost']]); } export async function cookies() { return { get: () => undefined, getAll: () => [] }; }",
  "next/navigation": "export function notFound() { throw new Error('NEXT_NOT_FOUND'); } export function redirect(u) { throw new Error('REDIRECT ' + u); } export function useRouter() { return {}; }",
};
registerHooks({ resolve(specifier, context, nextResolve) {
  const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", ".tsx", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* sigue */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_SUPER = "00000000-0000-0000-0000-000000950001";
const UID_ADMIN = "00000000-0000-0000-0000-000000950002";
const UID_OPS = "00000000-0000-0000-0000-000000950003";
let uidSesion = UID_SUPER;
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-95";
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: uidSesion, session_id: sidDe(uidSesion) }), { id: uidSesion, email: `${uidSesion}@x.test` });

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, interno: true, tenant: "mayorista" }), autorizaTenant: () => true } });
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", {
  namedExports: { siguienteNumeroContrato: async (tenant: string) => { const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant }); return interpretarRespuestaNumeroContrato(data, error as never); } },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { crearCotizacion, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { actualizarServiciosContrato } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { identidadDe } = await import("../lib/contrato/identidad.ts");
const { leerLineaServicio } = await import("../lib/contrato/serviciosDocumento.ts");

// ── Semilla común ─────────────────────────────────────────────────────────
const DEST = 9501, PROV = 9501, HOT = 9501, PAQ = 9501, S_ASIS = 9502, S_TOUR = 9503;
const ALTA = (s: number) => 950000 + s;
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_SUPER}', 'super95@x.test'), ('${UID_ADMIN}', 'admin95@x.test'), ('${UID_OPS}', 'ops95@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID_SUPER}', 'super95@x.test', 'Super 95', 'superadmin', true, 'mayorista'),
      ('${UID_ADMIN}', 'admin95@x.test', 'Admin 95', 'administracion', true, 'mayorista'),
      ('${UID_OPS}', 'ops95@x.test', 'Ops 95', 'operaciones', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA 95') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (${PROV}, 'Proveedor 95') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HOT}, ${DEST}, 'Hotel Uno 95', ${PROV}, 'COP', 0, 5, 6, 12, 1, 6, true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${HOT}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${HOT}, 'triple', 3, 5, 3, 3, 0, 2, 0, 2);   -- F6: la Triple permite los escenarios de 3 adultos con el hotel del catálogo
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (${HOT}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
      values (${HOT}, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 50000, 30000, 40000);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ}, 'Porción 95', 'porcion_terrestre', 3, ${DEST}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PAQ}, ${HOT}, array['Estandar'], array['Desayuno']);
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values
      (${S_ASIS}, 'Asistencia médica 95', ${PROV}, ${DEST}, 30000, 'asistencia', 'COP', 'persona', 'paquete', 'asistencia_medica'),
      (${S_TOUR}, 'Tour clasificado 95', ${PROV}, ${DEST}, 40000, 'tour_traslado', 'COP', 'persona', 'paquete', 'tour');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values
      (${ALTA(S_ASIS)}, ${S_ASIS}, 'ALTA', '2030-01-01', '2030-12-31', 30000), (${ALTA(S_TOUR)}, ${S_TOUR}, 'ALTA', '2030-01-01', '2030-12-31', 40000);
    -- asistencia INCLUIDA en el paquete; el tour es un opcional
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ}, ${S_ASIS}, 'persona', true), (${PAQ}, ${S_TOUR}, 'persona', false);
  `);
});

const PAX = Array.from({ length: 4 }, (_, i) => ({ nombres: `Pax${i + 1}`, apellidos: "Prueba", tipoDoc: "CC", numeroDoc: `${1000 + i}`, fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false }));
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
const individual = (servicios: number[]) => ({
  paqueteId: PAQ, bloqueoId: null, salidaId: null, modulo: "porcion_terrestre", hotelId: HOT, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", categoria: "Estandar", regimen: "Desayuno",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0, cliente: { ...CLIENTE, tipoDoc: "CC" }, tipoAsesor: "interno", asesorInterno: "Asesor 95",
  agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: PAX.slice(0, 2), servicios,
});

describe("R2-2 · un servicio incluido en la reserva no se vuelve editable por una selección nueva", () => {
  const resumen = (n: string) => sql(`select coalesce(precio_venta,0)::bigint || '|' || coalesce(costo_receptivo,0)::bigint || '|' || coalesce(costo_asistencia,0)::bigint || '|' || coalesce(asistencia_medica::text,'-') || '|' || coalesce(tours_traslados::text,'-') from public.ventas where numero_contrato = ${lit(n)}`);
  const obligaciones = (n: string) => sql(`select coalesce(string_agg(servicio_id || ':' || tipo || ':' || v::bigint, ',' order by servicio_id, tipo), '-') from (
      select servicio_id, tipo_proveedor tipo, valor_total v from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and servicio_id is not null
      union all
      select (payload->>'servicio_id')::bigint, payload->>'tipo_proveedor', (payload->>'valor_total')::numeric from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)} and clase = 'cxp' and materializada_en is null) o`);
  const lineas = (n: string) => sql(`select coalesce(string_agg(descripcion || '=' || (adultos * tarifa_adulto + ninos * tarifa_nino)::bigint, ' ; ' order by orden, id), '-') from public.contrato_items where numero_contrato = ${lit(n)}`);
  const lineasServicio = (n: string) => sql(`select coalesce(string_agg(descripcion, ' ; ' order by orden, id), '-') from public.contrato_items where numero_contrato = ${lit(n)} and descripcion like 'Servicio · %'`);
  const estado = (n: string) => `resumen=${resumen(n)} · obligaciones=${obligaciones(n)} · líneas servicio=${lineasServicio(n)}`;
  async function reservar(): Promise<string> {
    const g = await generarTarifario(PAQ); assert.equal(g.ok, true, JSON.stringify(g));
    const c = await crearCotizacion(individual([]) as never) as { ok: boolean; id?: number; error?: string };
    assert.equal(c.ok, true, c.error);
    const r = await convertirCotizacion(c.id!, PAX.slice(0, 2) as never, false, "Asesor 95", null, "COP", null) as { ok: boolean; numero?: string; error?: string };
    assert.equal(r.ok, true, r.error);
    return r.numero!;
  }
  const republicar = async () => { const g = await generarTarifario(PAQ); assert.equal(g.ok, true, JSON.stringify(g)); };
  const idc = (n: string) => identidadDe(n, sql(`select contrato_uid from public.ventas where numero_contrato = ${lit(n)}`));

  test("la reserva deja la asistencia INCLUIDA (30.000 × 2 pax = 60.000) en costo_asistencia, con su obligación y la bandera de asistencia", async (t) => {
    uidSesion = UID_SUPER;
    const n = await reservar();
    t.diagnostic(`reserva ${n}: ${estado(n)}`);
    const [, rec, asis, flag] = resumen(n).split("|");
    assert.equal(Number(asis), 60000, "costo_asistencia = la asistencia incluida");
    assert.equal(Number(rec), 0);
    assert.match(obligaciones(n), new RegExp(`${S_ASIS}:asistencia:60000`));
    assert.ok(flag !== "-" && flag !== "false" && flag !== "No", `bandera de asistencia activa (${flag})`);
  });

  test("AUDITORÍA: el paquete reclasifica la asistencia como opcional DESPUÉS de reservar → elegirla como opcional se RECHAZA y no cambia nada; quitar la selección la conserva", async (t) => {
    uidSesion = UID_SUPER;
    const n = await reservar();
    const antes = estado(n), lineasAntes = lineas(n);
    t.diagnostic(`antes: ${antes}`);
    // El paquete cambia después de la reserva: la asistencia deja de ser «incluida».
    // Caso de la auditoría (40.000 → 10.000): además de reclasificarse, el servicio cambia de precio en el catálogo (aquí 60.000 → 10.000 para 2 pax).
    sql(`update public.servicio_temporadas set precio_persona = 5000 where id = ${ALTA(S_ASIS)}; update public.servicios_adicionales set precio_persona = 5000 where id = ${S_ASIS}`);
    sql(`update public.armado_servicios set incluido = false where paquete_id = ${PAQ} and servicio_id = ${S_ASIS}`);
    await republicar();   // editar el paquete invalida la publicación: el asesor la vuelve a generar y el servicio queda publicado como OPCIONAL
    try {
      // 1) Elegir exactamente ese servicio como opcional: solapamiento ambiguo → rechazo explícito, sin escribir.
      const r = await actualizarServiciosContrato(n, [S_ASIS], idc(n));
      t.diagnostic(`elegir la asistencia como opcional → ${JSON.stringify(r)}`);
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /ya tiene una obligación/);
      assert.equal(estado(n), antes, "costos, obligaciones, bandera y líneas idénticos tras el rechazo");
      assert.equal(lineas(n), lineasAntes);
      assert.match(obligaciones(n), new RegExp(`${S_ASIS}:asistencia:60000`), "la obligación de 60.000 sigue intacta (no 10.000 ni 30.000)");
      // 2) Quitar la selección (guardar sin opcionales): la obligación histórica NO se borra y el costo/bandera se conservan.
      const q = await actualizarServiciosContrato(n, [], idc(n));
      assert.deepEqual(q, { ok: true });
      t.diagnostic(`quitar la selección → ${estado(n)}`);
      assert.equal(resumen(n).split("|")[2], "60000", "costo_asistencia sigue en 60.000");
      assert.match(obligaciones(n), new RegExp(`${S_ASIS}:asistencia:60000`));
      assert.equal(resumen(n).split("|")[3], antes.split("|")[3], "la bandera de asistencia no cambió");
      assert.equal(lineasServicio(n), "-", "no hay línea de servicio opcional");
    } finally {
      sql(`update public.armado_servicios set incluido = true where paquete_id = ${PAQ} and servicio_id = ${S_ASIS}; update public.servicio_temporadas set precio_persona = 30000 where id = ${ALTA(S_ASIS)}; update public.servicios_adicionales set precio_persona = 30000 where id = ${S_ASIS}`);
    }
  });

  test("el servicio incluido se QUITA del paquete después de reservar: el tour opcional se agrega y se quita y la asistencia histórica (60.000, bandera) sobrevive en cada paso", async (t) => {
    uidSesion = UID_SUPER;
    const n = await reservar();
    const base = resumen(n).split("|");
    sql(`delete from public.armado_servicios where paquete_id = ${PAQ} and servicio_id = ${S_ASIS}`);
    await republicar();
    try {
      const a = await actualizarServiciosContrato(n, [S_TOUR], idc(n));
      assert.deepEqual(a, { ok: true });
      t.diagnostic(`con el tour: ${estado(n)}`);
      const [precio1, rec1, asis1, flag1] = resumen(n).split("|");
      assert.equal(Number(rec1), 80000, "costo_receptivo = tour 40.000 × 2 pax");
      assert.equal(Number(asis1), 60000, "la asistencia histórica no se pierde");
      assert.equal(flag1, base[3]);
      assert.ok(Number(precio1) > Number(base[0]), "el precio sube con el tour");
      assert.match(obligaciones(n), new RegExp(`${S_ASIS}:asistencia:60000`));
      assert.match(obligaciones(n), new RegExp(`${S_TOUR}:receptivo:80000`));
      assert.match(lineasServicio(n), /Servicio · Tour clasificado 95/);
      const b = await actualizarServiciosContrato(n, [], idc(n));
      assert.deepEqual(b, { ok: true });
      t.diagnostic(`sin el tour: ${estado(n)}`);
      assert.equal(resumen(n), base.join("|"), "volvió exactamente al estado de la reserva (precio, costos, bandera)");
      assert.doesNotMatch(obligaciones(n), new RegExp(`${S_TOUR}:`));
      assert.match(obligaciones(n), new RegExp(`${S_ASIS}:asistencia:60000`));
      assert.equal(lineasServicio(n), "-");
    } finally {
      sql(`insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ}, ${S_ASIS}, 'persona', true) on conflict do nothing`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R3 · comparativa manual (y cotización simple) → hija de la opción elegida → pago previo → contrato → documento del cliente (filas persistidas releídas)
//   R3-1: el contrato debe sumar EXACTAMENTE su precio (líneas por persona + línea de ajuste de redondeo); pagado por completo → saldo 0.
//   R3-2: la categoría / régimen / acomodación EDITADOS del hotel elegido llegan al contrato («Servicio / Plan»); el catálogo no cambia.
// Totales a mano en cada escenario (aéreo común + hotel + niño). Adultos redondeados a la unidad de la moneda (peso / centavo); el residuo va en «Ajuste de redondeo del reparto del hotel».
const { crearComparativaManual, crearCotizacionManual, convertirCotizacionManualAContrato } = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const { elegirOpcionComparativa } = await import("../app/tarifario/checkout/actions.ts");
const { identidadDe: _idx } = await import("../lib/contrato/identidad.ts");
void _idx;
const { registrarPagoPrevio } = await import("../app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
const { registrarAbono } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
import fs from "node:fs";
import path from "node:path";
const EVID = process.env.PG95_EVIDENCIA ?? "";
const centavos = (n: number) => Math.round(n * 100);
const AJUSTE = "Ajuste de redondeo del reparto del hotel";

type Esc = {
  id: string; moneda: "COP" | "USD"; pax: number; aereo: number; ta: number; hotelA: number; hotelB: number; ninoA: number; ninoB: number;
  totalA: number; totalB: number;
  /** Ajuste esperado en la línea de redondeo por opción (0 = no hay línea). */
  ajusteA: number; ajusteB: number;
};
const ESCENARIOS: Esc[] = [
  // 1.330.455 entre 2 adultos = 665.227,5 → 665.228 por adulto → ajuste −1; B: 1.580.455 − 150.000 = 1.430.455 → 715.227,5 → 715.228 → ajuste −1.
  { id: "cop_impar_nino_gratis_y_pago", moneda: "COP", pax: 2, aereo: 500_000, ta: 30_455, hotelA: 800_000, hotelB: 900_000, ninoA: 0, ninoB: 150_000, totalA: 1_330_455, totalB: 1_580_455, ajusteA: -1, ajusteB: -1 },
  // Todo par: 1.330.000 / 2 = 665.000 exacto; B 1.430.000 / 2 = 715.000 exacto → sin línea de ajuste.
  { id: "cop_par", moneda: "COP", pax: 2, aereo: 500_000, ta: 30_000, hotelA: 800_000, hotelB: 900_000, ninoA: 0, ninoB: 150_000, totalA: 1_330_000, totalB: 1_580_000, ajusteA: 0, ajusteB: 0 },
  // 3 adultos: A 1.330.456 / 3 = 443.485,33 → 443.485 (×3 = 1.330.455) → ajuste +1; B 1.430.455 / 3 = 476.818,33 → 476.818 (×3 = 1.430.454) → ajuste +1.
  { id: "cop_tres_adultos", moneda: "COP", pax: 3, aereo: 500_000, ta: 30_455, hotelA: 800_001, hotelB: 900_000, ninoA: 0, ninoB: 150_000, totalA: 1_330_456, totalB: 1_580_455, ajusteA: 1, ajusteB: 1 },
  // USD con centavos: 3 adultos. A: 530 + 801 = 1.331 → 443,6666… → 443,67 (×3 = 1.331,01) → ajuste −0,01. B: 530 + 902 = 1.432 → 477,3333… → 477,33 (×3 = 1.431,99) → ajuste +0,01; niño 150,55 → total 1.582,55.
  { id: "usd_centavos", moneda: "USD", pax: 3, aereo: 500, ta: 30, hotelA: 801, hotelB: 902, ninoA: 0, ninoB: 150.55, totalA: 1331, totalB: 1582.55, ajusteA: -0.01, ajusteB: 0.01 },
];

describe("R3 · comparativa → hija elegida → contrato → documento del cliente (exactitud y copia del hotel)", () => {
  const uuidv4 = (n: number) => `00000000-0000-4000-8000-${String(950000000000 + n)}`;
  let seq = 100;
  const catalogo = () => sql(`select md5(string_agg(x, '|' order by x)) from (
      select 'h:' || row_to_json(h)::text x from public.hoteles h where id = ${HOT}
      union all select 'a:' || row_to_json(a)::text from public.hotel_acomodaciones a where hotel_id = ${HOT}
      union all select 't:' || row_to_json(t)::text from public.tarifa_hotel t where hotel_id = ${HOT}
      union all select 'p:' || row_to_json(p)::text from public.armado_hoteles p where hotel_id = ${HOT}) z`);

  const habitacionesDe = (e: Esc) => (e.pax === 3 ? { triple: 1 } : { doble: 1 });
  const textoHab = (e: Esc) => (e.pax === 3 ? "1 hab Triple" : "1 hab Doble");
  const entrada = (e: Esc, conCatalogo: boolean) => ({
    cliente: { nombres: "Titular", apellidos: "Sintético", tipoDoc: "CC", numeroDoc: "900123456", telefono: "3001112233", email: "titular.sintetico@example.com", nacimiento: "1985-05-20" },
    destino: "Cartagena", destinoId: DEST, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: e.pax, moneda: e.moneda, ninos: 1, tarifaNino: 0, recobro: 0, recobroAliado: 0,
    tipoAsesor: "interno", asesorInterno: "Asesor 95", agenciaNombre: "", freelanceNombre: "", plazo: "", vigenciaHasta: "", observaciones: "", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "", nombre: "Avianca", proveedor: "", costoNeto: e.aereo, modo: "ta", pctMarkup: 0, ta: e.ta },
      // La opción A parte del catálogo (hotel #HOT: «Estandar» / «Desayuno» / «doble») y el asesor EDITA la copia: categoría «Superior», régimen «PAM».
      // F6 (B95-15/20): la acomodación ya NO es texto libre: se declaran las habitaciones (3 adultos → 1 Triple; 2 → 1 Doble) y el servidor deriva «1 hab Triple» / «1 hab Doble»; el origen de la compra es por plataforma.
      { tipo: "hotel", plataforma: "Despegar", nombre: "Hotel A", proveedor: "", costoNeto: e.hotelA, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "A", categoria: "Superior", regimen: "PAM", compra: "plataforma", habitaciones: habitacionesDe(e), ...(conCatalogo ? { catalogoId: HOT } : {}) },
      { tipo: "hotel", plataforma: "Despegar", nombre: "Hotel B", proveedor: "", costoNeto: e.hotelB, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "B", categoria: "Estándar", regimen: "PC", compra: "plataforma", habitaciones: habitacionesDe(e) },
    ],
    tarifaNinoPorOpcion: { A: e.ninoA, B: e.ninoB },
  });

  async function pagar(hijaId: number, total: number, moneda: "COP" | "USD", clave: string) {
    const base = { moneda, formaPago: "transferencia", ...(moneda === "USD" ? { trm: 4000 } : {}) };
    // Primer pago (congela la condición) por la mitad; después se completa hasta el mínimo exigido; si el mínimo es el total, el pago es completo.
    const mitad = Math.round((total / 2) * 100) / 100;
    const p1 = await registrarPagoPrevio(hijaId, { ...base, referencia: `R3-${clave}-1`, valor: mitad }, `pago1-${hijaId}-${clave}`);
    assert.equal(p1.ok, true, JSON.stringify(p1));
    const exigido = Number(sql(`select monto_exigido_total_cop from public.cotizaciones where id = ${hijaId}`));
    const trm = moneda === "USD" ? 4000 : 1;
    const exigidoMoneda = Math.round((exigido / trm) * 100) / 100;
    const falta = Math.max(0, Math.round((exigidoMoneda - mitad) * 100) / 100);
    if (falta > 0) { const p2 = await registrarPagoPrevio(hijaId, { ...base, referencia: `R3-${clave}-2`, valor: falta }, `pago2-${hijaId}-${clave}`); assert.equal(p2.ok, true, JSON.stringify(p2)); }
    return { exigidoMoneda, pagado: mitad + falta };
  }

  type ItemFila = { id?: number; descripcion: string; adultos: number; ninos: number; tarifa_adulto: number | string; tarifa_nino: number | string; orden?: number; modo_precio?: string };
  const filas = (n: string) => ({
    venta: JSON.parse(sql(`select row_to_json(v)::text from (select numero_contrato, cliente, cliente_documento, estado, moneda, precio_venta, pax, fecha_salida, fecha_regreso, asesor, tipo_asesor, tenant, destino, plan_nombre, hotel, tours_traslados, asistencia_medica from public.ventas where numero_contrato = ${lit(n)}) v`)),
    items: JSON.parse(sql(`select coalesce(json_agg(row_to_json(i) order by orden, id), '[]'::json)::text from (select id, numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden, modo_precio, valor_total from public.contrato_items where numero_contrato = ${lit(n)}) i`)) as ItemFila[],
    pasajeros: JSON.parse(sql(`select coalesce(json_agg(row_to_json(p) order by orden), '[]'::json)::text from (select * from public.contrato_pasajeros where numero_contrato = ${lit(n)}) p`)),
    hoteles: JSON.parse(sql(`select coalesce(json_agg(row_to_json(h) order by orden), '[]'::json)::text from (select * from public.contrato_hoteles where numero_contrato = ${lit(n)}) h`)),
    pagado: Number(sql(`select coalesce(sum(valor_abono), 0)::text from public.abonos where numero_contrato = ${lit(n)}`)),
  });
  const sumaLineas = (items: { adultos: number; ninos: number; tarifa_adulto: number | string; tarifa_nino: number | string; modo_precio?: string }[]) =>
    items.filter((i) => (i.modo_precio ?? "por_persona") === "por_persona").reduce((s, i) => s + centavos(Number(i.adultos) * Number(i.tarifa_adulto)) + centavos(Number(i.ninos) * Number(i.tarifa_nino)), 0);

  // Paga el SALDO del contrato con la acción real `registrarAbono` (el contrato ya está convertido y confirmado con el mínimo): queda pagado por completo.
  async function pagarSaldo(numero: string, moneda: "COP" | "USD", clave: string) {
    const f = filas(numero);
    const saldo = (centavos(Number(f.venta.precio_venta)) - centavos(f.pagado)) / 100;
    if (saldo <= 0) return { saldo: 0 };
    const trm = moneda === "USD" ? 4000 : undefined;
    const idc = identidadDe(numero, sql(`select contrato_uid from public.ventas where numero_contrato = ${lit(numero)}`));
    const r = await registrarAbono(numero, moneda === "USD" ? Math.round(saldo * 4000 * 100) / 100 : saldo, "transferencia", `R3-saldo-${clave}`, trm, undefined, undefined, uuidv4(++seq), idc, moneda === "USD" ? "USD" : undefined);
    assert.equal((r as { ok: boolean }).ok, true, JSON.stringify(r));
    return { saldo };
  }

  async function recorrer(e: Esc, opcion: "A" | "B", conCatalogo: boolean) {
    uidSesion = UID_SUPER;
    const total = opcion === "A" ? e.totalA : e.totalB;
    const nino = opcion === "A" ? e.ninoA : e.ninoB;
    const c = await crearComparativaManual(entrada(e, conCatalogo) as never);
    assert.equal(c.ok, true, JSON.stringify(c));
    const madreId = (c as { id: number }).id;
    const madre = sql(`select share_token || '|' || version || '|' || modo from public.cotizaciones where id = ${madreId}`).split("|");
    const el = await elegirOpcionComparativa({ token: madre[0], opcionRef: opcion, acomodacionRef: "unica", version: Number(madre[1]), clave: uuidv4(++seq) });
    assert.equal(el.ok, true, JSON.stringify(el));
    const hijaId = (el as { hijaId: number }).hijaId;
    const hija = sql(`select (precio_venta * 100)::bigint || '|' || (payload->>'ninos') || '|' || (payload->>'tarifaNino') from public.cotizaciones where id = ${hijaId}`).split("|").map(Number);
    assert.deepEqual(hija, [centavos(total), 1, nino], "la hija conserva el total exacto, la cantidad y la tarifa del niño de la opción elegida");
    const pago = await pagar(hijaId, total, e.moneda, `${e.id}-${opcion}`);
    const conv = await convertirCotizacionManualAContrato(hijaId);
    assert.equal(conv.ok, true, JSON.stringify(conv));
    return { madreId, hijaId, numero: (conv as { numero: string }).numero, pago, total, nino };
  }

  function volcar(nombre: string, extra: Record<string, unknown>, n: string, hijaId: number) {
    if (!EVID) return;
    fs.mkdirSync(EVID, { recursive: true });
    const f = filas(n);
    const cot = JSON.parse(sql(`select row_to_json(c)::text from (select id, codigo, modo, tipo, estado, moneda, precio_venta, pax, cliente, destino, fecha_salida, fecha_regreso, vigencia_hasta, detalle, payload from public.cotizaciones where id = ${hijaId}) c`));
    fs.writeFileSync(path.join(EVID, `${nombre}.json`), JSON.stringify({ contexto: extra, ...f, cotizacion_hija: cot }, null, 2));
  }

  for (const e of ESCENARIOS) {
    for (const opcion of ["A", "B"] as const) {
      test(`${e.id} · opción ${opcion}: el contrato suma EXACTAMENTE ${opcion === "A" ? e.totalA : e.totalB} ${e.moneda} y conserva niño, titular y la copia editada del hotel`, async (t) => {
        const total = opcion === "A" ? e.totalA : e.totalB;
        const ajusteEsperado = opcion === "A" ? e.ajusteA : e.ajusteB;
        const nino = opcion === "A" ? e.ninoA : e.ninoB;
        const antesCatalogo = catalogo();
        const r = await recorrer(e, opcion, opcion === "A");
        const f = filas(r.numero);
        t.diagnostic(`contrato ${r.numero}: precio=${f.venta.precio_venta} · pagado=${f.pagado} (exigido ${r.pago.exigidoMoneda}) · plan=${JSON.stringify(f.venta.plan_nombre)} · líneas=${JSON.stringify(f.items.map((i) => [i.descripcion.slice(0, 22), i.adultos, i.ninos, i.tarifa_adulto, i.tarifa_nino]))}`);
        // ── R3-1: persistido == elegido == líneas, al centavo
        assert.equal(centavos(Number(f.venta.precio_venta)), centavos(total), "ventas.precio_venta es el total exacto de la opción elegida");
        assert.equal(sumaLineas(f.items), centavos(total), "las líneas por persona + ajuste suman EXACTAMENTE el precio del contrato");
        const aj = f.items.filter((i) => i.descripcion === AJUSTE);
        if (ajusteEsperado === 0) assert.equal(aj.length, 0, "total divisible: no hay línea de ajuste");
        else { assert.equal(aj.length, 1); assert.equal(centavos(Number(aj[0].tarifa_adulto)), centavos(ajusteEsperado), "el residuo exacto, en la unidad de la moneda"); assert.equal(aj[0].adultos, 1); assert.equal(aj[0].ninos, 0); }
        const paquete = f.items.find((i) => i.descripcion.startsWith("PAQUETE TURÍSTICO A "));
        assert.ok(paquete, "se conserva la fila agrupada del paquete");
        assert.equal(paquete!.adultos, e.pax);
        assert.equal(paquete!.ninos, 1, "la fila agrupada conserva el niño");
        assert.equal(centavos(Number(paquete!.tarifa_nino)), centavos(nino), "la tarifa del niño es la REAL de la opción, no un promedio");
        // saldo: lo pagado cubre el mínimo exigido; el saldo del documento = precio − pagado, sin residuos inventados
        const pagadoC = centavos(f.pagado);
        assert.ok(pagadoC <= centavos(total), "no se pagó más que el total");
        assert.equal(centavos(total) - pagadoC, centavos(total - f.pagado), "saldo exacto");
        // ── R3-2: titular + copia editada del hotel (solo el elegido) y catálogo intacto
        assert.ok(f.pasajeros.length >= 1, "titular persistido como pasajero");
        const plan = String(f.venta.plan_nombre ?? "");
        if (opcion === "A") assert.equal(plan, `Hotel A · Superior · PAM · ${textoHab(e)}`, "la copia EDITADA (categoría «Superior» y régimen «PAM», no los del catálogo «Estandar/Desayuno») llega al contrato; la acomodación sale de las habitaciones");
        else assert.equal(plan, `Hotel B · Estándar · PC · ${textoHab(e)}`);
        assert.ok(!plan.includes(opcion === "A" ? "Hotel B" : "Hotel A"), "solo viaja el hotel elegido");
        // Con la 347 (REV2 f95docs) la conversión SÍ escribe el hotel elegido: una fila, la de la opción, y nada de la otra.
        assert.deepEqual(f.hoteles.map((x: { nombre: string }) => x.nombre), [opcion === "A" ? "Hotel A" : "Hotel B"], "contrato_hoteles trae solo el hotel de la opción elegida");
        assert.equal(catalogo(), antesCatalogo, "el catálogo (hotel, acomodaciones, tarifas, paquete) quedó idéntico");
        volcar(`${e.id}_${opcion}_parcial`, { escenario: e.id, opcion, moneda: e.moneda, ajusteEsperado, fase: "parcial", ...r }, r.numero, r.hijaId);
        // Pagado por COMPLETO con la acción real: el saldo debe ser exactamente 0 (nunca un residuo de redondeo).
        const p = await pagarSaldo(r.numero, e.moneda, `${e.id}-${opcion}`);
        const g = filas(r.numero);
        t.diagnostic(`saldo pagado ${p.saldo} → pagado=${g.pagado}`);
        assert.equal(centavos(g.pagado), centavos(total), "pagado por completo = el precio exacto");
        assert.equal(centavos(Number(g.venta.precio_venta)) - centavos(g.pagado), 0, "saldo exacto 0");
        assert.equal(sumaLineas(g.items) - centavos(g.pagado), 0, "las líneas del documento menos lo pagado = 0");
        volcar(`${e.id}_${opcion}_completo`, { escenario: e.id, opcion, moneda: e.moneda, ajusteEsperado, fase: "completo", ...r }, r.numero, r.hijaId);
      });
    }
  }

  test("cotización SIMPLE (no comparativa): misma conversión, mismas líneas exactas (cop_tres_adultos) y la copia editada del hotel", async (t) => {
    uidSesion = UID_SUPER;
    const e = ESCENARIOS[2];
    const base = entrada(e, false);
    const input = { ...base, ninos: 1, tarifaNino: 0, servicios: [base.servicios[0], base.servicios[1]] };
    const c = await crearCotizacionManual(input as never);
    assert.equal(c.ok, true, JSON.stringify(c));
    const hijaId = (c as { id: number }).id;
    await pagar(hijaId, e.totalA, "COP", "simple");
    const conv = await convertirCotizacionManualAContrato(hijaId);
    assert.equal(conv.ok, true, JSON.stringify(conv));
    const n = (conv as { numero: string }).numero;
    const f = filas(n);
    t.diagnostic(`simple ${n}: plan=${JSON.stringify(f.venta.plan_nombre)} líneas=${JSON.stringify(f.items.map((i) => [i.descripcion.slice(0, 22), i.tarifa_adulto]))}`);
    assert.equal(sumaLineas(f.items), centavos(e.totalA));
    assert.equal(f.venta.plan_nombre, `Hotel A · Superior · PAM · ${textoHab(e)}`);
    assert.equal(f.items.filter((i) => i.descripcion === AJUSTE).length, 1);
    volcar("simple_cop_tres_adultos_A", { escenario: "simple", total: e.totalA }, n, hijaId);
  });

  test("conversión repetida (reintento): no duplica la línea de ajuste ni cambia nada", async () => {
    uidSesion = UID_SUPER;
    const e = ESCENARIOS[0];
    const r = await recorrer(e, "A", false);
    const antes = JSON.stringify(filas(r.numero).items);
    const otra = await convertirCotizacionManualAContrato(r.hijaId);
    assert.deepEqual(otra, { ok: true, numero: r.numero });
    assert.equal(JSON.stringify(filas(r.numero).items), antes);
  });

  test("los contratos HISTÓRICOS no se reescriben: un contrato anterior con líneas que suman +1 queda tal cual tras nuevas conversiones", async () => {
    // Contrato «anterior a la 333»: se fabrica con la forma que dejaba la base (una línea redondeada, sin ajuste) en un número propio.
    sql(`insert into public.ventas (numero_contrato, tenant, cliente, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, fecha_salida, fecha_regreso)
         values ('DTM-9333', 'mayorista', 'Historico 333', 'confirmado', 'Asesor 95', 1330455, 'COP', 'dinamico', 'completo', '2030-03-01', '2030-03-04');
         insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden) values ('DTM-9333', 'PAQUETE TURÍSTICO A CARTAGENA DEL 01/03/2030 AL 04/03/2030', 2, 0, 665228, 0, 0);`);
    const antes = sql(`select md5(string_agg(row_to_json(i)::text, '|' order by id)) from public.contrato_items i where numero_contrato = 'DTM-9333'`);
    await recorrer(ESCENARIOS[0], "A", false);
    assert.equal(sql(`select md5(string_agg(row_to_json(i)::text, '|' order by id)) from public.contrato_items i where numero_contrato = 'DTM-9333'`), antes, "el contrato histórico conserva sus líneas");
    assert.equal(sql(`select count(*) from public.contrato_items where numero_contrato = 'DTM-9333' and descripcion = ${lit(AJUSTE)}`), "0");
  });
});
