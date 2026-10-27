// #88 · migraciones 244 y 245 — trayecto REAL por HTTP contra PostgreSQL:
//   reservarPrograma (app/(dashboard)/dashboard/reservar/actions.ts, SIN simulaciones de dinero) de un programa por hotel y vigencia con
//   noches adicionales → PostgREST propio → ventas / numeración / contrato_items / contrato_hoteles / foto de la estancia / registro de costo /
//   registrar_financiero_contrato / contrato_financiero_pendiente → CxP con su equivalente COP (CHECK de la 236) → devengo contable REAL
//   (postearAsientoCxP → asientos_contables) → reversión y reconciliación ante fallos inyectados con triggers de la base.
// Lo ÚNICO simulado: el módulo de numeración (su RPC real se invoca igual) y la sesión (auth.getUser): el cliente "de sesión" es un cliente
// PostgREST real con un JWT `authenticated` de un usuario real de la base (RLS incluida).
//
// SOLO base LOCAL desechable. No corre en `npm run test:*`: la lanza supabase/scripts/test_245_app_programa_hotel.sh.
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG245_CONTENEDOR ?? "pg245e88";
const DB = process.env.PG245_BASE ?? "";
const PGRST = process.env.PG245_POSTGREST ?? "";
const SECRETO = process.env.PG245_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG245_BASE (desechable), PG245_POSTGREST y PG245_JWT_SECRET: usa supabase/scripts/test_245_app_programa_hotel.sh.");
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
const UID_ADMIN = "00000000-0000-0000-0000-000000245003";
const TOKEN_SERVICIO = jwt({ role: "service_role" });

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-245";

const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN }), { id: UID_ADMIN, email: "admin245@x.test" });

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8" }).trim();
}
const fila = (q: string) => sql(q).split("|");

const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", {
  namedExports: {
    siguienteNumeroContrato: async (tenant: string) => {
      const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant });
      return interpretarRespuestaNumeroContrato(data, error as never);
    },
  },
});
mock.module("@/lib/cotizacion/acceso", {
  namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
// Contexto de creación (sesión + rol + tenant): se entrega la sesión REAL de un usuario `administracion` (su RLS aplica a las lecturas); la autorización no es lo que se prueba aquí.
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => ({ ok: true, tenant: "mayorista", rol: "administracion", sb: clienteSesion() }) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { reservarPrograma, terminosB2BPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { guardarBlackouts, setPublicado, calcularVistaPreviaPrograma, guardarDias, guardarCabecera, importarDesdeTexto } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
const { getProgramaDetalle } = await import("../lib/programas.ts");
const { reconciliarFinancieroPendienteCron } = await import("../app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts");
const { cargarTablasPvp88 } = await import("../lib/programas/estanciaHotelDatos88.ts");
const { cotizarEstanciaDesdePvp, totalDesdePrecios } = await import("../lib/programas/precioReserva57.ts");

// ── Semilla ───────────────────────────────────────────────────────────────
const PID = 24501;
const HID = 24501;
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin245@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin245@x.test', 'Admin 245', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values
      (24509, 'Operador Andes 245', false, 0), (24555, 'Asistencia Global 245', false, 0), (24577, 'Hoteles Playa 245', false, 0) on conflict do nothing;
    insert into public.programas (id, nombre, subtitulo, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, modo_precio, dias, noches, proveedor_id, proveedor_asistencia_id,
        tipo_transporte, incluye_aereo, edad_nino_min, edad_nino_max, edad_infante_max)
      values (${PID}, 'Caribe terrestre 245', 'Cartagena', 'USD', 0.15, 0.03, 4, 'hotel', 4, 3, 24509, 24555, 'ninguno', false, 2, 11, 1) on conflict do nothing;
    insert into public.programa_hoteles (id, programa_id, orden, nombre, zona, tipo_habitacion, max_pax_habitacion, max_menores_habitacion)
      values (${HID}, ${PID}, 0, 'Hotel Centro', 'Centro', 'Estándar', 4, 2) on conflict do nothing;
    insert into public.programa_hotel_precios (hotel_id, desde, hasta, modalidad_servicios, bajo_solicitud, neto_sencilla, neto_doble, neto_triple, neto_nino)
      values (${HID}, '2027-03-01', '2027-03-31', 'privado', false, 800, 600, 520, 400);
    insert into public.programa_hotel_noches (hotel_id, desde, hasta, unidad_cobro, neto_sencilla, neto_doble, neto_triple, neto_nino) values
      (${HID}, '2027-03-01', '2027-03-04', 'persona', 130, 100, 90, 60),
      (${HID}, '2027-03-05', '2027-03-31', 'persona', 150, 120, 100, 70);
    insert into public.programa_dias (programa_id, dia, titulo, desayuno, almuerzo, cena, descripcion) values
      (${PID}, 1, 'Llegada', false, false, true, 'Traslado al hotel'), (${PID}, 2, 'Tour ciudad', true, true, false, 'Tour de ciudad'),
      (${PID}, 3, 'Playa', true, false, false, 'Día de playa'), (${PID}, 4, 'Salida', true, false, false, 'Traslado al aeropuerto');
    create or replace function public.zz_falla_245() returns trigger language plpgsql as $f$ begin raise exception 'FALLA_INYECTADA_245'; end $f$;
  `);
});

/** Deja la base sin contratos ni triggers de fallo entre pruebas. */
function limpiar(conservarBlackouts = false) {
  // Los triggers de inmutabilidad (condiciones congeladas) impiden borrar contratos: la limpieza entre pruebas los desactiva (solo esta sesión).
  sql(`
    set session_replication_role = replica;
    drop trigger if exists zz_falla on public.contrato_programa_estancia_costo;
    drop trigger if exists zz_falla on public.contrato_programa_estancia;
    drop trigger if exists zz_falla on public.cuentas_por_pagar;
    drop trigger if exists zz_falla on public.ventas;
    drop trigger if exists zz_falla on public.asiento_lineas;
    drop trigger if exists zz_falla on public.contrato_hoteles;
    drop trigger if exists zz_falla on public.aliados_b2b;
    drop trigger if exists zz_falla on public.contrato_pasajeros;
    drop trigger if exists zz_falla on public.contrato_items;
    drop trigger if exists zz_falla3 on public.ventas;
    delete from public.asiento_lineas;
    delete from public.asientos_contables;
    -- Con los triggers apagados tampoco corren las FK en cascada: se vacía cada tabla que cuelga del contrato.
    do $d$ declare t text; begin
      for t in select c.table_name from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'numero_contrato' and x.table_type = 'BASE TABLE' and c.table_name <> 'ventas'
      loop execute format('delete from public.%I', t); end loop;
    end $d$;
    delete from public.ventas;
    ${conservarBlackouts ? "" : `delete from public.programa_blackouts where programa_id in (${PID}, 24502);`}
    update public.programas set proveedor_asistencia_id = 24555, asistencia_medica_dia = 4, publicado = false where id in (${PID}, 24502);
    -- Itinerario de los dos programas de prueba SIEMPRE completo (1..N exacto) al empezar cada caso: los casos que lo rompen no se filtran a los demás.
    delete from public.programa_dias where programa_id in (${PID}, 24502);
    insert into public.programa_dias (programa_id, dia, titulo, desayuno, almuerzo, cena, descripcion)
      select p.id, d, 'Día ' || d, false, false, false, 'x' from (values (${PID}, 4), (24502, 8)) p(id, n), generate_series(1, p.n) d;
  `);
}
const fallaEn = (tabla: string, evento: "insert" | "delete") =>
  sql(`create trigger zz_falla before ${evento} on public.${tabla} for each row execute function public.zz_falla_245();`);
beforeEach(() => limpiar());

const CLIENTE = { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" };
const entrada = (k: number, over: Record<string, unknown> = {}) => ({
  programaId: PID, categoriaId: 0, fechaIda: "2027-03-01", paxPorAcom: { doble: 1 }, ninos: 0, cliente: CLIENTE,
  tipoAsesor: "interno" as const, asesorInterno: "Asesor 245", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "2027-02-01", pasajeros: [] as never[], precioConfirmado: 0, trmCosto: 4000 as number | string | null,
  estancia: { hotelId: HID, modalidad: "privado" as const, nochesAdicionales: k }, ...over,
});
/** El importe que mostraría la ficha (solo PVP) para la selección: lo que el formulario confirma. */
async function importeFicha(k: number): Promise<number> {
  const sb = clienteLocal(TOKEN_SERVICIO);
  const { data: prog } = await sb.from("programas").select("*").eq("id", PID).single();
  const r = await cargarTablasPvp88(sb as never, PID, prog as never);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("tablas");
  const c = cotizarEstanciaDesdePvp(r.tablas[0], 3, { modalidad: "privado", fechaEntrada: "2027-03-01", nochesAdicionales: k, habitaciones: { doble: 1 }, ninos: 0 });
  if (!c.ok) throw new Error(c.error);
  assert.equal(c.ok, true);
  return c.total;
}
async function reservar(k: number, over: Record<string, unknown> = {}) {
  const precio = await importeFicha(k);
  return reservarPrograma(entrada(k, { precioConfirmado: precio, ...over }) as never);
}
const cuenta = (tabla: string) => Number(sql(`select count(*) from public.${tabla}`));
const sinResiduos = (que: string) => {
  for (const t of ["ventas", "contrato_items", "contrato_hoteles", "contrato_programa_estancia", "contrato_programa_estancia_costo", "cuentas_por_pagar", "asientos_contables", "contrato_financiero_pendiente"]) {
    assert.equal(cuenta(t), 0, `${que}: no debe quedar nada en ${t}`);
  }
};

describe("#88 · reservarPrograma contra Postgres/PostgREST real", () => {
  test("P1 reserva completa (3 noches adicionales): contrato, foto, registro de costo, CxP con equivalente COP y asiento, sin pendientes", async () => {
    const r = await reservar(3);
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const n = r.numero;
    const [precio, receptivo, asistencia, estado, regreso, moneda] = fila(`select precio_venta, costo_receptivo, costo_asistencia, financiero_estado, fecha_regreso, moneda from public.ventas where numero_contrato = '${n}'`);
    assert.deepEqual([Number(precio), Number(receptivo), Number(asistencia), estado, regreso, moneda], [2354, 1880, 56, "completo", "2027-03-07", "USD"]);
    const [noches, precioNoches] = fila(`select noches_adicionales, precio_noches from public.contrato_programa_estancia where numero_contrato = '${n}'`);
    assert.deepEqual([Number(noches), Number(precioNoches)], [3, 858]);
    const [aTot, aNoches, provA, trm, mon] = fila(`select asistencia_total, asistencia_noches, proveedor_asistencia_id, trm_costo, moneda from public.contrato_programa_estancia_costo where numero_contrato = '${n}'`);
    assert.deepEqual([Number(aTot), Number(aNoches), Number(provA), Number(trm), mon], [56, 24, 24555, 4000, "USD"]);
    // CxP: las dos en USD, con la TRM única de costos y su equivalente COP coherente (la base lo exige con el CHECK de la 236).
    const cxp = sql(`select string_agg(tipo_proveedor || '|' || valor_total || '|' || moneda || '|' || trm_costo || '|' || valor_cop_costo, ';' order by tipo_proveedor) from public.cuentas_por_pagar where numero_contrato = '${n}'`);
    assert.equal(cxp, "asistencia|56.00|USD|4000.0000|224000.00;programa|1880.00|USD|4000.0000|7520000.00");
    // Devengo real: el asiento de cada CxP mueve el equivalente en pesos, nunca el nominal en dólares.
    const asientos = sql(`select string_agg(l_sum.debe || '/' || l_sum.haber, ';' order by l_sum.debe) from public.asientos_contables a join lateral (select sum(debe) debe, sum(haber) haber from public.asiento_lineas where asiento_id = a.id) l_sum on true where a.origen = 'cxp'`);
    const montos = (asientos ?? "").split(";");
    assert.deepEqual(montos, ["224000.00/224000.00", "7520000.00/7520000.00"]);
    assert.equal(cuenta("contrato_financiero_pendiente"), 0);
  });

  test("P2 sin TRM de costos (o inválida) en un programa USD: se rechaza ANTES de numerar y no escribe nada", async () => {
    const antes = sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'");
    for (const trmCosto of [null, "", "abc", 0, -4000]) {
      const r = await reservar(1, { trmCosto });
      assert.equal(r.ok, false, String(trmCosto));
      assert.match(r.ok ? "" : r.error, /TRM/);
    }
    sinResiduos("sin TRM");
    assert.equal(sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'"), antes);
  });

  test("P3 asistencia con costo pero sin proveedor configurado: se rechaza antes de numerar", async () => {
    sql(`update public.programas set proveedor_asistencia_id = null where id = ${PID}`);
    const r = await reservar(2);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /asistencia/i);
    sinResiduos("sin proveedor de asistencia");
  });

  test("P4 la base impide que un programa por hotel lleve aéreo (restricción de la 245), con o sin pasar por la app", () => {
    assert.throws(() => sql(`update public.programas set tipo_transporte = 'aereo' where id = ${PID}`), /programas_modo_hotel_terrestre_chk/);
    assert.throws(() => sql(`update public.programas set incluye_aereo = true where id = ${PID}`), /programas_modo_hotel_terrestre_chk/);
  });

  for (const [etiqueta, tabla] of [["la foto de la estancia", "contrato_programa_estancia"], ["el registro de costo", "contrato_programa_estancia_costo"], ["los hoteles del contrato", "contrato_hoteles"]] as const) {
    test(`P5 si falla ${etiqueta}: no hay éxito, no queda contrato usable ni residuos, y el reintento crea UN solo contrato`, async () => {
      fallaEn(tabla, "insert");
      const r = await reservar(3);
      assert.equal(r.ok, false, JSON.stringify(r));
      sinResiduos(`falla en ${tabla}`);
      limpiar();
      const r2 = await reservar(3);
      assert.equal(r2.ok, true, JSON.stringify(r2));
      assert.equal(cuenta("ventas"), 1, "el reintento crea exactamente un contrato");
      assert.equal(cuenta("cuentas_por_pagar"), 2, "y exactamente dos CxP (sin duplicados)");
      assert.equal(cuenta("contrato_programa_estancia"), 1);
      assert.equal(cuenta("contrato_programa_estancia_costo"), 1);
    });
  }

  test("P6 si falla una CxP dentro de la escritura financiera atómica: se revierte el contrato completo (sin CxP parciales) y el reintento sale limpio", async () => {
    fallaEn("cuentas_por_pagar", "insert");
    const r = await reservar(3);
    assert.equal(r.ok, false, JSON.stringify(r));
    sinResiduos("falla en cuentas_por_pagar");
    limpiar();
    const r2 = await reservar(3);
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(cuenta("cuentas_por_pagar"), 2);
  });

  test("P7 si falla la escritura financiera Y la reversión: el contrato nace pendiente, no se anuncia éxito, y la reconciliación lo deja completo o revertido, nunca duplicado", async () => {
    fallaEn("cuentas_por_pagar", "insert");
    sql(`create trigger zz_falla2 before delete on public.ventas for each row execute function public.zz_falla_245()`);
    const r = await reservar(3);
    sql(`drop trigger if exists zz_falla2 on public.ventas`);
    sql(`drop trigger if exists zz_falla on public.cuentas_por_pagar`);
    assert.equal(r.ok, false, JSON.stringify(r));
    // Quedó un contrato marcado pendiente (no usable) con su carga durable para reconciliar.
    assert.equal(sql("select count(*) from public.ventas where financiero_estado = 'pendiente'"), "1");
    assert.equal(sql("select count(*) from public.contrato_financiero_pendiente"), "1");
    const rec = await reconciliarFinancieroPendienteCron(process.env.CRON_SECRET!, 0);
    assert.equal(rec.ok, true, JSON.stringify(rec));
    const [ventas, estado] = fila("select count(*), coalesce(max(financiero_estado), '-') from public.ventas");
    console.log(`[P7] reconciliación → ${Number(ventas) === 1 ? "contrato completado (" + estado + ")" : "contrato revertido"}; resultado=${JSON.stringify(rec)}`);
    if (Number(ventas) === 1) {
      assert.equal(estado, "completo");
      assert.equal(cuenta("cuentas_por_pagar"), 2, "completar no duplica las CxP");
      assert.equal(cuenta("contrato_programa_estancia"), 1);
      assert.equal(cuenta("contrato_programa_estancia_costo"), 1);
    } else {
      sinResiduos("reconciliación revirtió");
    }
    assert.equal(cuenta("contrato_financiero_pendiente"), 0, "no queda carga pendiente");
    // Un segundo ciclo de reconciliación no cambia nada.
    const antes = [cuenta("ventas"), cuenta("cuentas_por_pagar"), cuenta("asientos_contables")];
    await reconciliarFinancieroPendienteCron(process.env.CRON_SECRET!, 0);
    assert.deepEqual([cuenta("ventas"), cuenta("cuentas_por_pagar"), cuenta("asientos_contables")], antes);
  });

  test("P8 si falla el asiento contable (best-effort por diseño): el contrato y sus CxP quedan completos y el fallo se reporta como advertencia, no como éxito silencioso", async () => {
    fallaEn("asiento_lineas", "insert");
    const r = await reservar(1);
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    assert.ok((r.advertencias ?? []).length > 0, "el fallo del asiento no se oculta");
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = '${r.numero}'`), "completo");
    assert.equal(cuenta("cuentas_por_pagar"), 2);
  });

});

// ── PR #409 · venta B2B de Programas (PVP y NETO) contra la base real ──────────────────────────────────────────────────────────────────────
// Usa la RPC REAL registrar_comision_b2b_reserva (migración 205), la RLS y los CHECK de la 236/245. Cubre modo hotel (244/245) y un programa por salida.
const AL_PVP = 24591; // agencia, 10 % propio
const AL_ALTA = 24592; // agencia, 60 % propio (el exigible en NETO queda por debajo del costo)
const AL_FREE = 24593; // freelance sin % propio → parámetro general o 11 %
const PID_SAL = 24502;
describe("PR #409 · reservarPrograma B2B (PVP / NETO) contra Postgres/PostgREST real", () => {
  before(() => {
    sql(`
      insert into public.aliados (id, nombre, tipo, pct_comision, activo, nit, tipo_documento) values
        (${AL_PVP}, 'Viajes Sol 245', 'agencia', 0.10, true, '900123456', 'NIT'),
        (${AL_ALTA}, 'Agencia Comision Alta 245', 'agencia', 0.60, true, '900777000', 'NIT'),
        (${AL_FREE}, 'Freelance Luna 245', 'freelance', null, true, '52111222', 'CC') on conflict do nothing;
      insert into public.programas (id, nombre, subtitulo, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, modo_precio, dias, noches, proveedor_id, edad_nino_min, edad_nino_max, edad_infante_max, tipo_transporte, incluye_aereo)
        values (${PID_SAL}, 'Circuito Andino 245', null, 'USD', 0.15, 0.03, 4, 'salida', 8, 7, 24509, 2, 11, 1, 'ninguno', false) on conflict do nothing;
      insert into public.programa_dias (programa_id, dia, titulo, desayuno, almuerzo, cena, descripcion)
        select ${PID_SAL}, d, 'Día ' || d, false, false, false, 'x' from generate_series(1, 8) d where not exists (select 1 from public.programa_dias where programa_id = ${PID_SAL});
      insert into public.programa_salidas (programa_id, orden, etiqueta, fecha_desde, fecha_hasta, bajo_solicitud, neto_sencilla, neto_doble, neto_triple, neto_nino)
        select ${PID_SAL}, 0, 'Marzo', '2027-03-01', '2027-03-08', false, 1400, 1000, 900, 700 where not exists (select 1 from public.programa_salidas where programa_id = ${PID_SAL});
    `);
  });

  const B2B = (aliadoId: number | null, modoCompra: "comisionable" | "neta" | undefined, tipoAsesor: "agencia" | "freelance" = "agencia") => ({ tipoAsesor, aliadoId, modoCompra });
  const venta = (n: string) => fila(`select precio_venta, modo_compra, comision_b2b, comision_estado, aliado_id, tipo_asesor, coalesce(agencia_nombre,''), coalesce(freelance_nombre,''), cliente, coalesce(cliente_documento,''), coalesce(titular_nombre,''), coalesce(titular_documento,''), financiero_estado from public.ventas where numero_contrato = '${n}'`);
  const comisionFila = (n: string) => fila(`select aliado, precio_venta, base_comision, pct_comision, estado, descontada_en_precio from public.aliados_b2b where numero_contrato = '${n}'`);

  // Programa por SALIDA (no hotel): PVP que mostraría la ficha para 1 habitación doble.
  async function importeSalida(): Promise<number> {
    const det = await getProgramaDetalle(clienteLocal(TOKEN_SERVICIO) as never, PID_SAL);
    assert.ok(det);
    const precios = det!.salidas[0].precios;
    const adultos = precios.filter((p) => p.acomodacion !== "nino" && p.pvp != null).map((p) => ({ acomodacion: p.acomodacion, pvp: p.pvp }));
    return totalDesdePrecios({ adultos, precioNino: precios.find((p) => p.acomodacion === "nino")?.pvp ?? null, habitaciones: { doble: 1 }, ninos: 0 });
  }
  const entradaSalida = (precioConfirmado: number, over: Record<string, unknown> = {}) => ({
    programaId: PID_SAL, categoriaId: 0, salidaId: Number(sql(`select id from public.programa_salidas where programa_id = ${PID_SAL}`)), fechaIda: "2027-03-01",
    paxPorAcom: { doble: 1 }, ninos: 0, cliente: CLIENTE, tipoAsesor: "interno" as const, asesorInterno: "Asesor 245", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
    plazo: "2027-02-01", pasajeros: [] as never[], precioConfirmado, ...over,
  });

  test("B1 modo hotel a PVP: cobra el total, comisión pendiente (RPC real), cliente = la persona, aliado del catálogo y contrato completo", async () => {
    const r = await reservar(3, B2B(AL_PVP, "comisionable"));
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const [precio, modo, comision, estadoCom, aliado, tipo, agencia, , cliente, docCliente, titular, , fin] = venta(r.numero);
    assert.deepEqual([Number(precio), modo, Number(comision), estadoCom, Number(aliado), tipo, agencia, cliente, docCliente, titular, fin],
      [2354, "comisionable", 235, "pendiente", AL_PVP, "agencia", "Viajes Sol 245", "Ana Ruiz", "1010", "", "completo"]);
    assert.deepEqual(comisionFila(r.numero), ["Viajes Sol 245", "2354.00", "2354.00", "0.1000", "pendiente", "f"]);
    assert.equal(cuenta("cuentas_por_pagar"), 2, "las CxP al proveedor no cambian con la modalidad");
  });

  test("B2 modo hotel a NETO: cobra PVP − comisión, cliente = el aliado, la persona es el titular, y la comisión queda descontada (RPC real)", async () => {
    const r = await reservar(3, B2B(AL_PVP, "neta"));
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const [precio, modo, comision, estadoCom, aliado, , agencia, , cliente, docCliente, titular, docTitular, fin] = venta(r.numero);
    assert.deepEqual([Number(precio), modo, Number(comision), estadoCom, Number(aliado), agencia, cliente, docCliente, titular, docTitular, fin],
      [2119, "neta", 235, "descontada", AL_PVP, "Viajes Sol 245", "Viajes Sol 245", "900123456", "Ana Ruiz", "1010", "completo"]);
    assert.deepEqual(comisionFila(r.numero), ["Viajes Sol 245", "2354.00", "2354.00", "0.1000", "pagada", "t"]);
  });

  test("B3 NETO sin restricción adicional: con una comisión del 60 % el exigible queda por debajo del costo y la reserva se genera igual", async () => {
    const r = await reservar(3, B2B(AL_ALTA, "neta"));
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const [precio, , comision] = venta(r.numero);
    assert.deepEqual([Number(precio), Number(comision)], [2354 - 1412, 1412]);
    assert.ok(Number(precio) < 1880 + 56, "exigible 942 < costo 1.936");
    assert.equal(comisionFila(r.numero)[4], "pagada");
  });

  test("B4 sin elegir PVP o NETO, o sin aliado: se rechaza antes de numerar y sin residuos", async () => {
    const sinModo = await reservar(3, B2B(AL_PVP, undefined));
    assert.equal(sinModo.ok, false);
    assert.match(sinModo.ok ? "" : sinModo.error, /PVP.*NETO/);
    const sinAliado = await reservar(3, B2B(null, "comisionable"));
    assert.equal(sinAliado.ok, false);
    sinResiduos("sin modalidad / sin aliado");
    assert.equal(cuenta("aliados_b2b"), 0);
  });

  test("B5 REVERSIÓN por fallo de comisión (modo hotel): no hay éxito, el contrato se revierte completo sin residuos, y el reintento crea UN contrato con UNA comisión", async () => {
    fallaEn("aliados_b2b", "insert");
    const r = await reservar(3, B2B(AL_PVP, "neta"));
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.ok ? "" : r.error, /comisi/i);
    sinResiduos("falla de comisión B2B");
    assert.equal(cuenta("aliados_b2b"), 0);
    limpiar();
    const r2 = await reservar(3, B2B(AL_PVP, "neta"));
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(cuenta("ventas"), 1);
    assert.equal(cuenta("aliados_b2b"), 1);
    assert.equal(cuenta("cuentas_por_pagar"), 2, "sin CxP duplicadas");
  });

  test("B6 programa por SALIDA (no hotel) a PVP y a NETO: la RPC real acepta la comisión (la venta nace en curso) y el contrato queda completo", async () => {
    const pvp = await importeSalida();
    const a = await reservarPrograma(entradaSalida(pvp, B2B(AL_PVP, "comisionable")) as never);
    assert.equal(a.ok, true, JSON.stringify(a));
    if (!a.ok) return;
    const va = venta(a.numero);
    assert.deepEqual([Number(va[0]), va[1], Number(va[2]), va[3], va[8], va[12]], [pvp, "comisionable", Math.round(pvp * 0.1), "pendiente", "Ana Ruiz", "completo"]);
    assert.equal(comisionFila(a.numero)[4], "pendiente");
    limpiar();
    const b = await reservarPrograma(entradaSalida(pvp, B2B(AL_PVP, "neta")) as never);
    assert.equal(b.ok, true, JSON.stringify(b));
    if (!b.ok) return;
    const vb = venta(b.numero);
    assert.deepEqual([Number(vb[0]), vb[1], vb[3], vb[8], vb[10], vb[12]], [pvp - Math.round(pvp * 0.1), "neta", "descontada", "Viajes Sol 245", "Ana Ruiz", "completo"]);
    assert.equal(comisionFila(b.numero)[4], "pagada");
  });

  test("B7 REVERSIÓN por fallo de comisión en un programa por SALIDA: se revierte el contrato (y sus hijas), y el reintento sale limpio", async () => {
    const pvp = await importeSalida();
    fallaEn("aliados_b2b", "insert");
    const r = await reservarPrograma(entradaSalida(pvp, B2B(AL_PVP, "comisionable")) as never);
    assert.equal(r.ok, false, JSON.stringify(r));
    for (const t of ["ventas", "contrato_items", "cuentas_por_pagar", "aliados_b2b"]) assert.equal(cuenta(t), 0, `no debe quedar nada en ${t}`);
    limpiar();
    const r2 = await reservarPrograma(entradaSalida(pvp, B2B(AL_PVP, "comisionable")) as never);
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(cuenta("ventas"), 1);
    assert.equal(cuenta("aliados_b2b"), 1);
  });

  // PR #409 — la venta B2B fuera del modo hotel conserva financiero_estado = 'pendiente' hasta terminar pasajeros e ítems, y se revierte COMPLETA si algo falla.
  const PASAJEROS_SAL = [
    { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false, responsableIndex: null },
    { nombres: "Luis", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "2020", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false, responsableIndex: null },
  ];
  const HIJOS = ["ventas", "aliados_b2b", "contrato_pasajeros", "contrato_items", "cuentas_por_pagar", "contrato_hoteles", "contrato_servicios", "asientos_contables"];
  const sinVentaNiComisionNiHijos = (que: string) => { for (const t of HIJOS) assert.equal(cuenta(t), 0, `${que}: no debe quedar nada en ${t}`); };

  for (const [etiqueta, tabla] of [["pasajeros", "contrato_pasajeros"], ["ítems", "contrato_items"]] as const) {
    test(`B6${tabla === "contrato_pasajeros" ? "a" : "b"} fallo forzado en ${etiqueta} (salida B2B): termina sin venta, comisión ni hijos, y el reintento sale limpio y completo`, async () => {
      const pvp = await importeSalida();
      fallaEn(tabla, "insert");
      const r = await reservarPrograma(entradaSalida(pvp, { ...B2B(AL_PVP, "neta"), pasajeros: PASAJEROS_SAL }) as never);
      assert.equal(r.ok, false, JSON.stringify(r));
      sinVentaNiComisionNiHijos(`falla en ${tabla}`);
      limpiar();
      const r2 = await reservarPrograma(entradaSalida(pvp, { ...B2B(AL_PVP, "neta"), pasajeros: PASAJEROS_SAL }) as never);
      assert.equal(r2.ok, true, JSON.stringify(r2));
      if (!r2.ok) return;
      assert.equal(venta(r2.numero)[12], "completo");
      assert.equal(cuenta("ventas"), 1);
      assert.equal(cuenta("aliados_b2b"), 1);
      assert.equal(cuenta("contrato_pasajeros"), 2);
    });
  }

  test("B6c si la reversión TAMBIÉN falla: se comunica con el número de contrato y la venta sigue 'pendiente' (nunca 'completo')", async () => {
    const pvp = await importeSalida();
    fallaEn("contrato_pasajeros", "insert");
    sql(`create trigger zz_falla2 before delete on public.ventas for each row execute function public.zz_falla_245()`);
    const r = await reservarPrograma(entradaSalida(pvp, { ...B2B(AL_PVP, "comisionable"), pasajeros: PASAJEROS_SAL }) as never);
    sql(`drop trigger if exists zz_falla2 on public.ventas`);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.ok ? "" : r.error, /quedó creado a medias y no se pudo deshacer/);
    assert.equal(sql("select financiero_estado from public.ventas"), "pendiente", "no se marcó completo antes de terminar las escrituras obligatorias");
  });

  test("B6d si falla la transición a 'completo': se revierte el contrato pendiente (sin venta, comisión ni hijos)", async () => {
    const pvp = await importeSalida();
    sql(`create trigger zz_falla3 before update of financiero_estado on public.ventas for each row when (new.financiero_estado = 'completo') execute function public.zz_falla_245()`);
    const r = await reservarPrograma(entradaSalida(pvp, { ...B2B(AL_PVP, "comisionable"), pasajeros: PASAJEROS_SAL }) as never);
    sql(`drop trigger if exists zz_falla3 on public.ventas`);
    assert.equal(r.ok, false, JSON.stringify(r));
    sinVentaNiComisionNiHijos("falla la transición a completo");
  });

  test("B6e la venta B2B por salida permanece 'pendiente' mientras se escriben pasajeros e ítems y solo después pasa a 'completo'", async () => {
    const pvp = await importeSalida();
    // Un trigger en contrato_items registra el estado de la venta en el momento de insertar los ítems.
    sql(`
      create table if not exists public.zz_estado_visto (estado text);
      create or replace function public.zz_ver_estado() returns trigger language plpgsql as $f$ begin insert into public.zz_estado_visto select financiero_estado from public.ventas where numero_contrato = new.numero_contrato; return new; end $f$;
      create trigger zz_ver after insert on public.contrato_items for each row execute function public.zz_ver_estado();
    `);
    try {
      const r = await reservarPrograma(entradaSalida(pvp, { ...B2B(AL_PVP, "comisionable"), pasajeros: PASAJEROS_SAL }) as never);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(sql("select string_agg(distinct estado, ',') from public.zz_estado_visto"), "pendiente");
      if (r.ok) assert.equal(venta(r.numero)[12], "completo");
    } finally {
      sql("drop trigger if exists zz_ver on public.contrato_items; drop table if exists public.zz_estado_visto; drop function if exists public.zz_ver_estado()");
    }
  });

  test("B8 freelance sin % propio: el % sale del parámetro general o del 11 % por defecto, y queda en freelance_nombre", async () => {
    const r = await reservar(3, B2B(AL_FREE, "comisionable", "freelance"));
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const [precio, , comision, , , tipo, agencia, freelance] = venta(r.numero);
    assert.deepEqual([tipo, agencia, freelance], ["freelance", "", "Freelance Luna 245"]);
    const pct = Number(comisionFila(r.numero)[3]);
    assert.ok(pct > 0 && pct < 0.5, `pct ${pct}`);
    assert.equal(Number(comision), Math.round(Number(precio) * pct));
  });

  test("B9 la vista previa de términos (terminosB2BPrograma) lee de la base real y NO escribe nada", async () => {
    const precio = await importeFicha(3);
    for (const modo of ["comisionable", "neta"] as const) {
      const t = await terminosB2BPrograma({ ...entrada(3, { precioConfirmado: precio, ...B2B(AL_PVP, modo) }), pasajeros: [] } as never);
      assert.equal(t.ok, true, JSON.stringify(t));
      if (t.ok) assert.deepEqual([t.terminos.pvp, t.terminos.comision, t.terminos.total_exigible, t.terminos.pct_origen], [2354, 235, modo === "neta" ? 2119 : 2354, "aliado"]);
    }
    sinResiduos("vista previa de términos");
    assert.equal(cuenta("aliados_b2b"), 0);
  });
});

// ── PR #409 · blackouts con alcance, itinerario completo y publicación contra la base real (migración 247 incluida) ──────────────────────────────
describe("PR #409 · blackouts (entrada / viaje), itinerario 1..N y publicación contra Postgres/PostgREST real", () => {
  // Programa por SALIDA (24502, 8 días → regreso a las 7 noches): mismos ayudantes que el bloque B2B (que vive en otro describe).
  async function importeSalida(): Promise<number> {
    const det = await getProgramaDetalle(clienteLocal(TOKEN_SERVICIO) as never, 24502);
    assert.ok(det);
    const precios = det!.salidas[0].precios;
    const adultos = precios.filter((p) => p.acomodacion !== "nino" && p.pvp != null).map((p) => ({ acomodacion: p.acomodacion, pvp: p.pvp }));
    return totalDesdePrecios({ adultos, precioNino: precios.find((p) => p.acomodacion === "nino")?.pvp ?? null, habitaciones: { doble: 1 }, ninos: 0 });
  }
  const entradaSalida = (precioConfirmado: number) => ({
    programaId: 24502, categoriaId: 0, salidaId: Number(sql("select id from public.programa_salidas where programa_id = 24502")), fechaIda: "2027-03-01",
    paxPorAcom: { doble: 1 }, ninos: 0, cliente: CLIENTE, tipoAsesor: "interno" as const, asesorInterno: "Asesor 245", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
    plazo: "2027-02-01", pasajeros: [] as never[], precioConfirmado,
  });
  const seqMayorista = () => sql("select last_value || ':' || is_called from public.contrato_seq_mayorista");
  const blackout = (programa: number, ini: string, fin: string, alcance?: "entrada" | "viaje") =>
    sql(alcance
      ? `insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, motivo, alcance) values (${programa}, '${ini}', '${fin}', 'bloqueo', '${alcance}')`
      : `insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, motivo) values (${programa}, '${ini}', '${fin}', 'bloqueo')`);
  const rechaza = async (k: number, patron: RegExp, que: string) => {
    const antes = seqMayorista();
    const r = await reservar(k);
    assert.equal(r.ok, false, `${que}: ${JSON.stringify(r)}`);
    assert.match(r.ok ? "" : r.error, patron, que);
    assert.equal(seqMayorista(), antes, `${que}: NO se consumió número de contrato`);
    sinResiduos(que);
  };
  const acepta = async (k: number, que: string) => {
    const r = await reservar(k);
    assert.equal(r.ok, true, `${que}: ${JSON.stringify(r)}`);
    limpiar(true);
  };

  test("G1 guardarBlackouts (Server Action + RPC real): guarda con su alcance y reemplaza; cada entrada inválida se rechaza SIN borrar los anteriores", async () => {
    const ok = await guardarBlackouts(PID, [
      { fechaInicio: "2027-06-01", fechaFin: "2027-06-05", motivo: "Feria", ciudad: "", alcance: "viaje" },
      { fechaInicio: "2027-07-01", fechaFin: "2027-07-01", motivo: "", ciudad: "" },
    ]);
    assert.deepEqual(ok, { ok: true });
    assert.equal(sql(`select string_agg(fecha_inicio || ':' || alcance, ',' order by fecha_inicio) from public.programa_blackouts where programa_id = ${PID}`), "2027-06-01:viaje,2027-07-01:entrada");
    const huella = () => sql(`select string_agg(id || ':' || fecha_inicio || ':' || fecha_fin || ':' || alcance, ',' order by id) from public.programa_blackouts where programa_id = ${PID}`);
    const antes = huella();
    const invalidos: [string, { fechaInicio: string; fechaFin: string; motivo: string; ciudad: string; alcance?: string }[], RegExp][] = [
      ["un solo extremo", [{ fechaInicio: "2027-08-01", fechaFin: "", motivo: "", ciudad: "" }], /fecha de inicio y de fin/],
      ["fecha inexistente", [{ fechaInicio: "2027-02-30", fechaFin: "2027-03-01", motivo: "", ciudad: "" }], /no existe/],
      ["inicio después del fin", [{ fechaInicio: "2027-08-09", fechaFin: "2027-08-01", motivo: "", ciudad: "" }], /antes de empezar/],
      ["alcance desconocido", [{ fechaInicio: "2027-08-01", fechaFin: "2027-08-02", motivo: "", ciudad: "", alcance: "siempre" }], /alcance/],
      ["solo motivo", [{ fechaInicio: "", fechaFin: "", motivo: "algo", ciudad: "" }], /fecha de inicio y de fin/],
      ["solo ciudad (no se descarta en silencio)", [{ fechaInicio: "", fechaFin: "", motivo: "", ciudad: "Cusco" }], /fecha de inicio y de fin/],
      ["fecha con espacios", [{ fechaInicio: " 2027-08-01", fechaFin: "2027-08-02", motivo: "", ciudad: "" }], /no existe/],
      ["una buena y una mala en la lista", [{ fechaInicio: "2027-08-01", fechaFin: "2027-08-02", motivo: "", ciudad: "" }, { fechaInicio: "2027-08-05", fechaFin: "", motivo: "", ciudad: "" }], /blackout 2/],
    ];
    for (const [que, filas, patron] of invalidos) {
      const r = await guardarBlackouts(PID, filas);
      assert.equal(r.ok, false, que);
      assert.match(r.ok ? "" : r.error, patron, que);
      assert.equal(huella(), antes, `${que}: los blackouts anteriores siguen intactos`);
    }
  });

  test("G2 la BASE también es atómica: una entrada inválida en la MITAD del arreglo (que la app no vería) revierte todo y no borra los anteriores", async () => {
    blackout(PID, "2027-06-01", "2027-06-05", "viaje");
    const antes = sql(`select count(*) || ':' || min(id) from public.programa_blackouts where programa_id = ${PID}`);
    const { error } = await clienteSesion().rpc("guardar_programa_blackouts", {
      p_programa_id: PID,
      p_blackouts: [{ fecha_inicio: "2027-09-01", fecha_fin: "2027-09-02" }, { fecha_inicio: "2027-02-30", fecha_fin: "2027-03-01" }, { fecha_inicio: "2027-10-01", fecha_fin: "2027-10-02" }] as never,
    });
    assert.ok(error, "la RPC rechaza");
    assert.match(error?.message ?? "", /fecha que no existe/);
    assert.equal(sql(`select count(*) || ':' || min(id) from public.programa_blackouts where programa_id = ${PID}`), antes);
  });

  test("G2b la BASE rechaza elementos que no son objeto, fechas con espacios/formato libre y no-arreglos, sin reemplazar las filas", async () => {
    blackout(PID, "2027-06-01", "2027-06-05", "viaje");
    const huella = () => sql(`select string_agg(id || ':' || fecha_inicio || ':' || fecha_fin || ':' || alcance, ',' order by id) from public.programa_blackouts where programa_id = ${PID}`);
    const antes = huella();
    const buena = { fecha_inicio: "2027-09-01", fecha_fin: "2027-09-02" };
    for (const [que, lista, patron] of [
      ["elemento de texto", [buena, "x"], /no es válido \(se esperaba un objeto/],
      ["elemento null", [buena, null], /no es válido \(se esperaba un objeto/],
      ["elemento numérico", [buena, 7], /no es válido \(se esperaba un objeto/],
      ["fecha sin ceros (2027-9-1)", [{ fecha_inicio: "2027-9-1", fecha_fin: "2027-09-02" }], /formato inválido|fecha con formato/],
      ["fecha en formato libre", [{ fecha_inicio: "1/9/2027", fecha_fin: "2/9/2027" }], /formato inválido|fecha con formato/],
      ["no es un arreglo", { fecha_inicio: "2027-09-01" }, /./],
    ] as const) {
      const { error } = await clienteSesion().rpc("guardar_programa_blackouts", { p_programa_id: PID, p_blackouts: lista as never });
      assert.ok(error, `${que}: la RPC rechaza`);
      assert.match(error?.message ?? "", patron, que);
      assert.equal(huella(), antes, `${que}: las filas anteriores siguen intactas`);
    }
  });

  test("G3 fronteras de la fecha de ENTRADA (alcance entrada): inicio y fin son inclusivos; el día anterior y el posterior pasan; un blackout viejo sin alcance se comporta igual", async () => {
    blackout(PID, "2027-03-05", "2027-03-10"); // sin alcance explícito = entrada (como los cargados antes de la 247)
    for (const entrada of ["2027-03-05", "2027-03-10"]) {
      const antes = seqMayorista();
      const r = await reservarPrograma((await entradaConFecha(entrada)) as never);
      assert.equal(r.ok, false, entrada);
      assert.match(r.ok ? "" : r.error, /La fecha cae en un blackout/, entrada);
      assert.equal(seqMayorista(), antes);
      sinResiduos(`entrada ${entrada}`);
    }
    // 04/03 (un día antes): el blackout es de ENTRADA, así que aunque el viaje lo cruce, se reserva.
    const r = await reservarPrograma((await entradaConFecha("2027-03-04")) as never);
    assert.equal(r.ok, true, JSON.stringify(r));
    limpiar(true);
    const r2 = await reservarPrograma((await entradaConFecha("2027-03-11")) as never);
    assert.equal(r2.ok, true, JSON.stringify(r2));
  });

  test("G4 alcance VIAJE en modo hotel: incluye las noches adicionales (regreso inclusive) y sus fronteras exactas, sin consumir número al rechazar", async () => {
    // Entrada 01/03, 3 noches incluidas → regreso 04/03; con k noches adicionales, regreso = 04/03 + k.
    blackout(PID, "2027-03-06", "2027-03-06", "viaje");
    await acepta(0, "k=0 (regreso 04/03): el blackout del 06/03 no toca el viaje");
    await acepta(1, "k=1 (regreso 05/03): tampoco");
    await rechaza(2, /El viaje del 01\/03\/2027 al 06\/03\/2027 cae en un blackout/, "k=2 (regreso 06/03): el día de regreso cuenta (frontera inclusiva)");
    await rechaza(3, /cae en un blackout/, "k=3 (regreso 07/03): el viaje cruza el blackout");
    limpiar();
    blackout(PID, "2027-03-07", "2027-03-07", "viaje");
    await acepta(2, "k=2: el blackout del 07/03 queda un día después del regreso");
    await rechaza(3, /cae en un blackout/, "k=3: ahora el regreso (07/03) coincide con el blackout");
  });

  test("G5 alcance VIAJE: se bloquea si el blackout toca la ENTRADA o cualquier día intermedio, y no si termina el día antes de entrar", async () => {
    blackout(PID, "2027-02-20", "2027-02-28", "viaje");
    await acepta(0, "termina un día antes de la entrada");
    limpiar();
    blackout(PID, "2027-02-25", "2027-03-01", "viaje");
    await rechaza(0, /cae en un blackout/, "termina el día de la entrada");
    limpiar();
    blackout(PID, "2027-03-02", "2027-03-03", "viaje");
    await rechaza(0, /cae en un blackout/, "cae en medio del viaje aunque la entrada esté libre");
    limpiar();
    blackout(PID, "2027-03-02", "2027-03-03", "entrada");
    await acepta(0, "el MISMO rango con alcance «entrada» no bloquea (la entrada está libre)");
  });

  test("G6 programa por SALIDA (no hotel): el viaje dura días−1 noches (regreso 08/03) y se aplican los dos alcances", async () => {
    const pvp = await importeSalida();
    const intenta = (ok: boolean, que: string) => async () => {
      const antes = seqMayorista();
      const r = await reservarPrograma(entradaSalida(pvp) as never);
      assert.equal(r.ok, ok, `${que}: ${JSON.stringify(r)}`);
      if (!ok) { assert.equal(seqMayorista(), antes, `${que}: sin número`); assert.equal(cuenta("ventas"), 0); }
      limpiar();
    };
    blackout(24502, "2027-03-09", "2027-03-10", "viaje");
    await intenta(true, "un blackout el día siguiente al regreso no toca el viaje")();
    limpiar();
    blackout(24502, "2027-03-08", "2027-03-08", "viaje");
    await intenta(false, "el día de regreso (08/03) bloquea")();
    limpiar();
    blackout(24502, "2027-03-05", "2027-03-06", "entrada");
    await intenta(true, "alcance entrada a mitad del viaje no bloquea")();
    limpiar();
    blackout(24502, "2027-03-05", "2027-03-06", "viaje");
    await intenta(false, "alcance viaje a mitad del viaje bloquea")();
  });

  test("G7 itinerario incompleto (día 3 ausente): NO se reserva en NINGÚN modo, ni sin noches adicionales, y no se consume número", async () => {
    sql(`delete from public.programa_dias where programa_id = ${PID} and dia = 3`);
    await rechaza(0, /faltan los días 3/, "modo hotel sin noches adicionales");
    await rechaza(2, /faltan los días 3/, "modo hotel con noches adicionales");
    limpiar();
    sql("delete from public.programa_dias where programa_id = 24502 and dia = 5");
    const pvp = await importeSalida();
    const antes = seqMayorista();
    const r = await reservarPrograma(entradaSalida(pvp) as never);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /faltan los días 5/);
    assert.equal(seqMayorista(), antes);
    assert.equal(cuenta("ventas"), 0);
  });

  test("G8 itinerario con días repetidos o fuera de 1..N también se rechaza (hotel y salida)", async () => {
    sql(`insert into public.programa_dias (programa_id, dia, titulo) values (${PID}, 2, 'Día 2 repetido')`);
    await rechaza(0, /se repiten los días 2/, "repetido");
    limpiar();
    sql(`delete from public.programa_dias where programa_id = ${PID}`);
    sql(`insert into public.programa_dias (programa_id, dia, titulo) values (${PID}, 1, 'a'), (${PID}, 2, 'b'), (${PID}, 3, 'c'), (${PID}, 9, 'fuera')`);
    await rechaza(0, /fuera de 1–4/, "fuera de rango");
  });

  test("G9 PUBLICAR exige el itinerario completo (Server Action real); despublicar siempre se puede", async () => {
    sql(`delete from public.programa_dias where programa_id = ${PID} and dia = 2`);
    const r = await setPublicado(PID, true);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.ok ? "" : r.error, /faltan los días 2/);
    assert.equal(sql(`select publicado from public.programas where id = ${PID}`), "f", "no quedó publicado");
    sql(`insert into public.programa_dias (programa_id, dia, titulo) values (${PID}, 2, 'Día 2')`);
    assert.deepEqual(await setPublicado(PID, true), { ok: true, id: PID });
    assert.equal(sql(`select publicado from public.programas where id = ${PID}`), "t");
    // Un publicado heredado con el itinerario incompleto (hoy la base ya no deja crearlo): se simula apagando el trigger SOLO en esa sesión.
    sql(`alter table public.programa_dias disable trigger trg_programa_dias_itinerario_publicado; delete from public.programa_dias where programa_id = ${PID} and dia = 2; alter table public.programa_dias enable trigger trg_programa_dias_itinerario_publicado;`);
    assert.deepEqual(await setPublicado(PID, false), { ok: true, id: PID }, "despublicar no exige itinerario");
    assert.equal(sql(`select publicado from public.programas where id = ${PID}`), "f");
  });

  test("G10 la CALCULADORA (vista previa) aplica la misma regla: itinerario incompleto y blackout de viaje con noches adicionales, sin escribir nada", async () => {
    const hoteles = [{
      id: HID, nombre: "Hotel Centro", zona: "Centro", tipoHabitacion: "Estándar", maxPaxHabitacion: "4", maxMenoresHabitacion: "2", proveedorId: null,
      base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: { sencilla: "800", doble: "600", triple: "520", multiple: "", nino: "400" } }],
      noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: { sencilla: "130", doble: "100", triple: "90", multiple: "", nino: "60" } }],
    }];
    const sel = (k: number) => ({ hotelIndex: 0, modalidad: "privado", fechaEntrada: "2027-03-01", nochesAdicionales: k, habitaciones: { doble: 1 }, ninos: 0, infantes: 0 });
    const antes = [cuenta("ventas"), cuenta("cuentas_por_pagar"), seqMayorista()];
    const bien = await calcularVistaPreviaPrograma(PID, hoteles as never, sel(2));
    assert.equal(bien.ok, true, JSON.stringify(bien));
    blackout(PID, "2027-03-06", "2027-03-06", "viaje");
    const k1 = await calcularVistaPreviaPrograma(PID, hoteles as never, sel(1));
    assert.equal(k1.ok, true, "k=1 (regreso 05/03) no toca el blackout");
    const k2 = await calcularVistaPreviaPrograma(PID, hoteles as never, sel(2));
    assert.equal(k2.ok, false);
    assert.match(k2.ok ? "" : k2.causa, /cae en un blackout/);
    sql(`delete from public.programa_dias where programa_id = ${PID} and dia = 3`);
    const inc = await calcularVistaPreviaPrograma(PID, hoteles as never, sel(0));
    assert.equal(inc.ok, false);
    assert.match(inc.ok ? "" : inc.causa, /faltan los días 3/);
    assert.deepEqual([cuenta("ventas"), cuenta("cuentas_por_pagar"), seqMayorista()], antes, "calcular no escribe ni numera");
  });

  // ── Un programa PUBLICADO no puede quedar con el itinerario incompleto (app + trigger + RPC reales) ──
  const filasDias = () => sql(`select string_agg(dia || ':' || coalesce(titulo, ''), ',' order by dia) || '|' || (select dias from public.programas where id = ${PID}) from public.programa_dias where programa_id = ${PID}`);
  const diaUI = (dia: number) => ({ dia, titulo: `Nuevo ${dia}`, desayuno: true, almuerzo: false, cena: false, descripcion: "d" });
  const publicar = () => sql(`update public.programas set publicado = true where id = ${PID}`);

  test("G11 guardarDias (Server Action + RPC real): un publicado no queda incompleto (mensaje claro, filas intactas); despublicado el borrador incompleto sí se guarda", async () => {
    publicar();
    const antes = filasDias();
    const inc = await guardarDias(PID, [diaUI(1), diaUI(2), diaUI(4)]);
    assert.equal(inc.ok, false);
    assert.match(inc.ok ? "" : inc.error, /publicado.*itinerario incompleto.*faltan los días 3.*Despublícalo primero/);
    assert.equal(filasDias(), antes, "el itinerario publicado no se tocó");
    const rep = await guardarDias(PID, [diaUI(1), diaUI(2), diaUI(2), diaUI(3), diaUI(4)]);
    assert.equal(rep.ok, false);
    assert.match(rep.ok ? "" : rep.error, /se repiten los días 2/);
    assert.equal(filasDias(), antes);
    const sinNumero = await guardarDias(PID, [diaUI(1), { ...diaUI(2), dia: Number.NaN }, diaUI(3), diaUI(4)]);
    assert.equal(sinNumero.ok, false, "una fila con contenido pero sin día no se descarta en silencio");
    assert.equal(filasDias(), antes);
    assert.deepEqual(await guardarDias(PID, [1, 2, 3, 4].map(diaUI)), { ok: true }, "completo se guarda");
    assert.equal(filasDias(), "1:Nuevo 1,2:Nuevo 2,3:Nuevo 3,4:Nuevo 4|4");
    // Despublicado: el borrador incompleto SÍ se guarda, y entonces no se puede publicar.
    sql(`update public.programas set publicado = false where id = ${PID}`);
    assert.deepEqual(await guardarDias(PID, [diaUI(1), diaUI(2)]), { ok: true });
    assert.equal(filasDias(), "1:Nuevo 1,2:Nuevo 2|4");
    const pub = await setPublicado(PID, true);
    assert.equal(pub.ok, false);
    assert.match(pub.ok ? "" : pub.error, /faltan los días 3, 4/);
  });

  test("G12 la BASE protege aunque no pase por la app: con un publicado, borrar/duplicar/renumerar un día o cambiar el total por PostgREST o SQL directo se rechaza; despublicar primero lo permite", async () => {
    publicar();
    const antes = filasDias();
    const intentos: [string, () => Promise<{ message: string } | null>][] = [
      ["borrar el día 2 (PostgREST, sesión del usuario)", async () => (await clienteSesion().from("programa_dias").delete().eq("programa_id", PID).eq("dia", 2)).error],
      ["bajar el total (PostgREST)", async () => (await clienteSesion().from("programas").update({ dias: 3 }).eq("id", PID)).error],
      ["RPC con itinerario incompleto", async () => (await clienteSesion().rpc("guardar_programa_dias", { p_programa_id: PID, p_dias: [{ dia: 1 }, { dia: 2 }] as never })).error],
    ];
    for (const [que, f] of intentos) {
      const e = await f();
      assert.ok(e, `${que}: debe rechazarse`);
      assert.match(e?.message ?? "", /itinerario quedaría incompleto/, que);
      assert.equal(filasDias(), antes, `${que}: nada cambió`);
    }
    assert.throws(() => sql(`delete from public.programa_dias where programa_id = ${PID} and dia = 4`), /itinerario quedaría incompleto/, "SQL directo");
    assert.equal(filasDias(), antes);
    // Una edición ajena al itinerario sigue permitida, y despublicar habilita el borrador incompleto.
    sql(`update public.programas set nombre = nombre || ' ' where id = ${PID}`);
    sql(`update public.programas set publicado = false where id = ${PID}`);
    sql(`delete from public.programa_dias where programa_id = ${PID} and dia = 4`);
    assert.equal(sql(`select count(*) from public.programa_dias where programa_id = ${PID}`), "3");
  });

  test("G13 guardarCabecera: cambiar el total de días de un publicado que lo deja incompleto se rechaza (nada cambia); despublicado se puede", async () => {
    // guardarCabecera sobrescribe toda la cabecera con la entrada mínima de la prueba: se respalda la fila y se restaura al final.
    sql(`drop table if exists public.zz_g13; create table public.zz_g13 as select * from public.programas where id = ${PID}`);
    try {
      publicar();
      const cab = (dias: number) => ({ nombre: "Programa hotel 245", dias, noches: dias - 1 }) as never;
      const antes = filasDias();
      for (const n of [5, 3]) {
        const r = await guardarCabecera(PID, cab(n));
        assert.equal(r.ok, false, `total ${n}`);
        assert.match(r.ok ? "" : r.error, /publicado.*(faltan los días 5|fuera de 1–3)/, `total ${n}`);
        assert.equal(filasDias(), antes, `total ${n}: sin cambios`);
      }
      sql(`update public.programas set publicado = false where id = ${PID}`);
      assert.equal((await guardarCabecera(PID, cab(5))).ok, true, "borrador: se puede cambiar el total");
      assert.equal(sql(`select dias from public.programas where id = ${PID}`), "5");
    } finally {
      sql(`
        update public.programas set publicado = false where id = ${PID};
        do $d$ declare c text; begin
          for c in select column_name from information_schema.columns where table_schema = 'public' and table_name = 'programas' and column_name <> 'id' and is_generated = 'NEVER' loop
            execute format('update public.programas p set %1$I = b.%1$I from public.zz_g13 b where p.id = b.id', c);
          end loop;
        end $d$;
        drop table public.zz_g13;`);
    }
  });

  test("G14 importarDesdeTexto en un publicado: valida el resultado antes de escribir y cambia total + días en UNA transacción", async () => {
    publicar();
    const antes = filasDias();
    const salto = "3 días / 2 noches\nDía 1: Lima\nLlegada\nDía 3: Regreso\nSalida";
    const mal = await importarDesdeTexto(PID, salto, { itinerario: true, ruta: false, inclusiones: false, diasNoches: true });
    assert.equal(mal.ok, false);
    assert.match(mal.ok ? "" : mal.error, /publicado.*faltan los días 2/);
    assert.equal(filasDias(), antes, "ni días ni total cambiaron");
    const solo = await importarDesdeTexto(PID, "3 días / 2 noches", { itinerario: false, ruta: false, inclusiones: false, diasNoches: true });
    assert.equal(solo.ok, false, "cambiar solo el total deja un día fuera de rango");
    assert.equal(filasDias(), antes);
    const bien = "3 días / 2 noches\nDía 1: Lima\nLlegada\nDía 2: Cusco\nTour\nDía 3: Regreso\nSalida";
    assert.deepEqual(await importarDesdeTexto(PID, bien, { itinerario: true, ruta: false, inclusiones: false, diasNoches: true }), { ok: true });
    assert.equal(sql(`select count(*) from public.programa_dias where programa_id = ${PID}`), "3");
    assert.equal(sql(`select dias from public.programas where id = ${PID}`), "3");
    assert.equal(sql(`select publicado from public.programas where id = ${PID}`), "t", "sigue publicado y completo");
  });
});

/** Entrada de un programa por hotel con una fecha de entrada dada (sin noches adicionales). */
async function entradaConFecha(fecha: string) {
  return entrada(0, { fechaIda: fecha, precioConfirmado: await importeFicha(0) });
}
