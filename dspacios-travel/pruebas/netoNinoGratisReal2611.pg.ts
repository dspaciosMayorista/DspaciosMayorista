// Owner correction batch 2026-11-18 · gap G4 — REAL NETO free-child flow (B2B-assisted quotation → conversion → persisted data), with the REAL pricing engine and the #125 fixture.
//   semilla_revision_125.sql (hotels 9125xx, promotion «PRE BF ACTIVO» with one free child per room) → generarTarifario (real) → crearSolicitudReserva (cart checkout, B2B assisted NETO,
//   agency 10 %) → convertirCotizacionCarrito → persisted items / frozen summary read back. NOTHING about pricing, the free child or the NETO plan is simulated: only the cookie/session plumbing.
// The suite exposes the exact persisted rows so the lead can RENDER the real documents (FIX-DOCS' structure) from them: set G4_OUT=<file.json> to dump them.
// SOLO base LOCAL desechable: launch with
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg304 plantilla304 PG262 pruebas/netoNinoGratisReal2611.pg.ts supabase/migrations/20260601000303_*.sql … 311_*.sql supabase/scripts/localreview/semilla_revision_125.sql
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG262_CONTENEDOR ?? "pg304";
const DB = process.env.PG262_BASE ?? "";
const PGRST = process.env.PG262_POSTGREST ?? "";
const SECRETO = process.env.PG262_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG262_BASE (desechable), PG262_POSTGREST y PG262_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const U = { VENTA: "00000000-0000-0000-0000-000000262001", ADMIN: "00000000-0000-0000-0000-000000262002" } as const;
const SESIONES: Record<string, { rol: string; tenant: string; email: string; nombre: string }> = {
  [U.VENTA]: { rol: "venta", tenant: "mayorista", email: "u262_venta@x.test", nombre: "Usuario 262 venta" },
  [U.ADMIN]: { rol: "administracion", tenant: "mayorista", email: "u262_admin@x.test", nombre: "Usuario 262 admin" },
};
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion: string = U.ADMIN;
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: uidSesion }), { id: uidSesion, email: SESIONES[uidSesion].email });
function psql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const sql = (q: string) => psql(q);
const json = <T = Record<string, unknown>>(q: string): T => JSON.parse(sql(q)) as T;
const num = (v: unknown) => Number(v);

const { autorizaTenant } = await import("../lib/cotizacion/accesoPuro.ts");
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: false, tenant: SESIONES[uidSesion].tenant }), autorizaTenant } });
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async (tenant: string) => { const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant }); return interpretarRespuestaNumeroContrato(data, error as never); } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[], set: () => undefined };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

const AG = 26201; // agency, 10 % of its own
const nac = (edad: number) => `${2026 - edad}-01-01`;
const ADULTOS = [1, 2].map((i) => ({ nombres: `Adulto${i}`, apellidos: "Neto 262", tipoDoc: "CC", numeroDoc: `2620${i}${i}`, fechaNacimiento: "1985-03-04", nacionalidad: "Colombiana", esInfante: false }));
const menor = (edad: number, n: number) => ({ nombres: `Menor${edad}`, apellidos: "Neto 262", tipoDoc: "RC", numeroDoc: `2621${n}${edad}`, fechaNacimiento: nac(edad), nacionalidad: "Colombiana", esInfante: false });
const CLIENTE = { nombres: "Cliente", apellidos: "Neto 262", tipoDoc: "CC", numeroDoc: "262000", telefono: "3001234567", email: "neto262@example.com" };

before(async () => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(SESIONES).map(([id, s]) => `('${id}', '${s.email}')`).join(", ")} on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ${Object.entries(SESIONES).map(([id, s]) => `('${id}', '${s.email}', '${s.nombre}', '${s.rol}', true, '${s.tenant}')`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.aliados (id, nombre, tipo, pct_comision, activo) values (${AG}, 'Agencia Neto 262', 'agencia', 0.10, true) on conflict (id) do nothing;
  `);
  uidSesion = U.ADMIN;
  const g = (await generarTarifario(912503)) as { ok?: boolean; error?: string };
  assert.equal(g.ok, true, `generarTarifario(912503): ${g.error}`);
});

/** Cart item for «PRE BF ACTIVO» (912503): 4 → 9 Dec 2026, one double room, 2 adults + the given children's ages. */
const item = (edades: number[]) => ({
  itemId: "h912503", modulo: "porcion_terrestre", paqueteId: 912503, hotelId: 912503, bloqueoId: null, hotelNombre: "Hotel PRE BF 125 ACTIVO", destino: "DEMO 125", categoria: "Estandar", regimen: "PAM",
  fechaIda: "2026-12-04", fechaRegreso: "2026-12-09", noches: 5, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2 + edades.length, precio: 1, edadesMenores: edades, cantidadMenores: edades.length,
});
type RespCot = { ok: boolean; error?: string; cotizacion?: { id: number }; b2bAsistido?: Record<string, unknown> };
async function cotizar(edades: number[], asistencia: Record<string, unknown> | undefined): Promise<RespCot> {
  uidSesion = U.ADMIN;
  return (await crearSolicitudReserva({ items: [item(edades)], tours: [], cliente: CLIENTE, ...(asistencia ? { asistencia } : {}) } as never)) as unknown as RespCot;
}
async function convertir(id: number, edades: number[]) {
  uidSesion = U.ADMIN;
  return (await convertirCotizacionCarrito(id, { agrupar: "todo", pasajeros: [...ADULTOS, ...edades.map((e, i) => menor(e, i + 1))], asesorInterno: SESIONES[U.ADMIN].nombre,
    asignaciones: [Array.from({ length: 2 + edades.length }, (_, i) => i + 1)], asignacionesTours: [], monedaCobro: "COP" } as never)) as { ok: boolean; error?: string; numeros?: string[] };
}
const items = (n: string) => json<Record<string, unknown>[]>(`select coalesce(json_agg(row_to_json(t) order by orden, id), '[]'::json)::text from (select id, orden, descripcion, modo_precio, adultos, ninos, tarifa_adulto, tarifa_nino, valor_total from public.contrato_items where numero_contrato = '${n}') t`);
const ventaDe = (n: string) => json<Record<string, unknown>>(`select row_to_json(t)::text from (select numero_contrato, estado, precio_venta, impuesto, comision_b2b, comision_estado, modo_compra, canal, aliado_id, moneda from public.ventas where numero_contrato = '${n}') t`);
const resumenDe = (n: string) => sql(`select coalesce((select resumen::text from public.contrato_resumen_precios where numero_contrato = '${n}'), 'null')`);
const cotDe = (id: number) => json<Record<string, unknown>>(`select row_to_json(t)::text from (select id, estado, payload, detalle from public.cotizaciones where id = ${id}) t`);
const salida: Record<string, unknown> = {};

describe("G4 · NETO asistido con niño gratis (motor REAL): cotización → contrato → datos persistidos", () => {
  test("N0 la cotización PVP de referencia reproduce el ejemplo del dueño (C-0005): 2 adultos + niño de 8 (gratis) + niño de 5 (paga) = 1.757.000", async () => {
    const r = await cotizar([8, 5], undefined);
    assert.equal(r.ok, true, r.error);
    const c = cotDe(r.cotizacion!.id);
    const total = num(sql(`select precio_venta from public.cotizaciones where id = ${r.cotizacion!.id}`));
    assert.equal(total, 1_757_000, "2 × 732.000 + (366.000 − 366.000) + 293.000 = 1.757.000 (cálculo a mano en el documento de aceptación)");
    salida.pvp_cotizacion = { id: r.cotizacion!.id, total, estado: c.estado };
  });

  test("N1 NETO con agencia 10 %: la comisión descontada es 10 % × 1.757.000 = 175.700 y lo exigible 1.581.300; el contrato nace con ese precio y la comisión DESCONTADA", async () => {
    const r = await cotizar([8, 5], { canal: "b2b", aliadoId: AG, modo: "neta" });
    assert.equal(r.ok, true, r.error);
    const plan = r.b2bAsistido as { pvp?: number; comision?: number; total_exigible?: number } | undefined;
    assert.deepEqual({ pvp: num(plan?.pvp), com: num(plan?.comision), exigible: num(plan?.total_exigible) }, { pvp: 1_757_000, com: 175_700, exigible: 1_581_300 });
    const c = await convertir(r.cotizacion!.id, [8, 5]);
    assert.equal(c.ok, true, c.error);
    const n = c.numeros![0];
    const v = ventaDe(n);
    assert.deepEqual({ precio: num(v.precio_venta), com: num(v.comision_b2b), estado_com: v.comision_estado, modo: v.modo_compra, canal: v.canal, moneda: v.moneda },
      { precio: 1_581_300, com: 175_700, estado_com: "descontada", modo: "neta", canal: "B2B", moneda: "COP" });
    const its = items(n);
    // The persisted items are exposed for the real document render: the signed free-child line must exist and Σ(items) must equal the PVP of the offer.
    const suma = its.reduce((s, i) => s + (i.modo_precio === "total" ? num(i.valor_total) : num(i.adultos) * num(i.tarifa_adulto) + num(i.ninos) * num(i.tarifa_nino)), 0);
    assert.equal(Math.round(suma * 100) / 100, 1_757_000, "Σ ítems almacenados = PVP original (la vista de cliente en NETO prorratea hasta el exigible)");
    assert.ok(its.some((i) => String(i.descripcion).includes("Niño gratis por habitación")), "la línea firmada del niño gratis se guarda (solo presentación la pliega)");
    salida.neto_cotizacion = { id: r.cotizacion!.id, plan, payload: cotDe(r.cotizacion!.id).payload };
    salida.neto_contrato = { numero: n, venta: v, items: its, resumen_precios: resumenDe(n) };
  });

  test("N2 un solo niño de 8 años, NETO: 1.464.000 PVP → comisión 146.400 → exigible 1.317.600; se guarda también la línea firmada (misma forma de DTM-0003)", async () => {
    const r = await cotizar([8], { canal: "b2b", aliadoId: AG, modo: "neta" });
    assert.equal(r.ok, true, r.error);
    const plan = r.b2bAsistido as { pvp?: number; comision?: number; total_exigible?: number } | undefined;
    assert.deepEqual({ pvp: num(plan?.pvp), com: num(plan?.comision), exigible: num(plan?.total_exigible) }, { pvp: 1_464_000, com: 146_400, exigible: 1_317_600 });
    const c = await convertir(r.cotizacion!.id, [8]);
    assert.equal(c.ok, true, c.error);
    const n = c.numeros![0];
    assert.equal(num(ventaDe(n).precio_venta), 1_317_600);
    salida.neto_un_nino = { numero: n, items: items(n), resumen_precios: resumenDe(n) };
  });
});

describe("G4 · ruta RESERVAR (contratos DTM-0003/0004 del dueño): ¿qué se sella por niño? (motor real, PVP)", () => {
  const reserva = (edades: number[]) => ({
    paqueteId: 912503, bloqueoId: null, modulo: "porcion_terrestre" as const, hotelId: 912503, fechaIda: "2026-12-04", fechaRegreso: "2026-12-09", categoria: "Estandar", regimen: "PAM",
    habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: edades, cantidadMenores: edades.length,
    cliente: { ...CLIENTE, numeroDoc: "262111" }, tipoAsesor: "interno", asesorInterno: SESIONES[U.ADMIN].nombre, agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "",
    pasajeros: [...ADULTOS, ...edades.map((e, i) => menor(e, i + 1))], servicios: [] as number[],
  });
  test("N3 un niño gratis (8 años): contrato 1.464.000 con la línea firmada −366.000; se lee qué dato por niño queda sellado (resumen de precios) además de la línea", async () => {
    uidSesion = U.ADMIN;
    const { crearCotizacion, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
    const q = (await crearCotizacion(reserva([8]) as never)) as { ok: boolean; id?: number; error?: string };
    assert.equal(q.ok, true, q.error);
    const c = (await convertirCotizacion(q.id!, [...ADULTOS, menor(8, 1)] as never, false, SESIONES[U.ADMIN].nombre, null, null, null)) as { ok: boolean; numero?: string; numeros?: string[]; error?: string };
    assert.equal(c.ok, true, c.error);
    const n = c.numero ?? c.numeros![0];
    assert.equal(num(ventaDe(n).precio_venta), 1_464_000, "2 × 732.000 + (366.000 − 366.000)");
    const its = items(n);
    assert.ok(its.some((i) => String(i.descripcion).includes("Niño gratis por habitación") && num(i.tarifa_adulto) === -366_000), "línea firmada −366.000");
    const resumen = resumenDe(n);
    const cot = cotDe(q.id!);
    const payloadTexto = JSON.stringify(cot.payload ?? {});
    salida.reservar_un_nino = { numero: n, items: its, resumen_precios: resumen, tiene_resumen_sellado: resumen !== "null", cotizacion_payload_claves: Object.keys((cot.payload ?? {}) as object), cotizacion_payload_tiene_condonado_por_nino: /condonado|beneficioNinoGratis|ninoGratis/i.test(payloadTexto), cotizacion_detalle: cot.detalle };
  });
});

test("volcado de los datos persistidos para el render real de documentos (G4_OUT)", () => {
  if (process.env.G4_OUT) writeFileSync(process.env.G4_OUT, JSON.stringify(salida, null, 2));
  assert.ok(salida.neto_contrato, "se persistió el contrato NETO");
});
