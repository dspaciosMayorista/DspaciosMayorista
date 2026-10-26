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

const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { reconciliarFinancieroPendienteCron } = await import("../app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts");
const { cargarTablasPvp88 } = await import("../lib/programas/estanciaHotelDatos88.ts");
const { cotizarEstanciaDesdePvp } = await import("../lib/programas/precioReserva57.ts");

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
function limpiar() {
  // Los triggers de inmutabilidad (condiciones congeladas) impiden borrar contratos: la limpieza entre pruebas los desactiva (solo esta sesión).
  sql(`
    set session_replication_role = replica;
    drop trigger if exists zz_falla on public.contrato_programa_estancia_costo;
    drop trigger if exists zz_falla on public.contrato_programa_estancia;
    drop trigger if exists zz_falla on public.cuentas_por_pagar;
    drop trigger if exists zz_falla on public.ventas;
    drop trigger if exists zz_falla on public.asiento_lineas;
    drop trigger if exists zz_falla on public.contrato_hoteles;
    delete from public.asiento_lineas;
    delete from public.asientos_contables;
    -- Con los triggers apagados tampoco corren las FK en cascada: se vacía cada tabla que cuelga del contrato.
    do $d$ declare t text; begin
      for t in select c.table_name from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'numero_contrato' and x.table_type = 'BASE TABLE' and c.table_name <> 'ventas'
      loop execute format('delete from public.%I', t); end loop;
    end $d$;
    delete from public.ventas;
    update public.programas set proveedor_asistencia_id = 24555, asistencia_medica_dia = 4 where id = ${PID};
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
