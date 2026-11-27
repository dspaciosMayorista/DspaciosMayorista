// REV2 (B95-15/18, 2026-11-26) — acciones REALES contra PostgreSQL + PostgREST desechables (supabase/scripts/test_rev2_95docs.sh; no corre en `npm run test:*`). Derivado de r2Acciones95.pg.ts (misma semilla y mocks de frontera).
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
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${HOT}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
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

const { inclusionesDeContrato } = await import("../lib/contrato/inclusionesContrato.ts");
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

describe("REV2 · B95-15/18 · conversión de la opción elegida conserva hotel, plan, acomodación, niño e inclusiones", () => {
  const uuidv4 = (n: number) => `00000000-0000-4000-8000-${String(950000000000 + n)}`;
  let seq = 100;
  const catalogo = () => sql(`select md5(string_agg(x, '|' order by x)) from (
      select 'h:' || row_to_json(h)::text x from public.hoteles h where id = ${HOT}
      union all select 'a:' || row_to_json(a)::text from public.hotel_acomodaciones a where hotel_id = ${HOT}
      union all select 't:' || row_to_json(t)::text from public.tarifa_hotel t where hotel_id = ${HOT}
      union all select 'p:' || row_to_json(p)::text from public.armado_hoteles p where hotel_id = ${HOT}) z`);

  const entrada = (e: Esc, conCatalogo: boolean) => ({
    cliente: { nombres: "Titular", apellidos: "Sintético", tipoDoc: "CC", numeroDoc: "900123456", telefono: "3001112233", email: "titular.sintetico@example.com", nacimiento: "1985-05-20" },
    destino: "Cartagena", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: e.pax, moneda: e.moneda, ninos: 1, tarifaNino: 0, recobro: 0, recobroAliado: 0,
    tipoAsesor: "interno", asesorInterno: "Asesor 95", agenciaNombre: "", freelanceNombre: "", plazo: "", vigenciaHasta: "", observaciones: "", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "", nombre: "Avianca", proveedor: "", costoNeto: e.aereo, modo: "ta", pctMarkup: 0, ta: e.ta },
      // La opción A parte del catálogo (hotel #HOT: «Estandar» / «Desayuno» / «doble») y el asesor EDITA la copia: categoría «Superior», régimen «PAM», acomodación «Triple».
      { tipo: "hotel", plataforma: "", nombre: "Hotel A", proveedor: "", costoNeto: e.hotelA, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "A", categoria: "Superior", regimen: "PAM", acomodacion: "Triple", ...(conCatalogo ? { catalogoId: HOT } : {}) },
      { tipo: "hotel", plataforma: "", nombre: "Hotel B", proveedor: "", costoNeto: e.hotelB, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "B", categoria: "Estándar", regimen: "PC", acomodacion: "Doble" },
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

  const hoteles = (n: string) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(h) order by orden), '[]'::json)::text from (select nombre, categoria, ciudad, alimentacion, acomodacion, detalle_acomodacion, fecha_ingreso::text fecha_ingreso, fecha_salida::text fecha_salida, proveedor, compra_origen, plataforma, orden from public.contrato_hoteles where numero_contrato = ${lit(n)}) h`)) as { nombre: string; categoria: string | null; ciudad: string | null; alimentacion: string | null; acomodacion: string | null; detalle_acomodacion: string | null; fecha_ingreso: string | null; fecha_salida: string | null; proveedor: string | null; compra_origen: string | null; plataforma: string | null }[];
  const SIN_347 = process.env.R2_SIN_347 === "1";
  // Texto propio de cada opción (presentación editada antes de generar la comparativa): lo que la opción elegida INCLUYE no puede perderse ni mezclarse con el de la otra.
  const PRESENTACION = { "A/unica": { incluye: "Tiquetes aéreos Avianca\nDesayuno buffet A\nSeguro hotelero A", noIncluye: "Propinas A" }, "B/unica": { incluye: "Tiquetes aéreos Avianca\nPlan completo B\nTraslados B", noIncluye: "Impuesto de salida B" } };
  // B95-13/15/20: el destino se elige del catálogo (id; su nombre canónico pisa el texto), cada hotel declara cómo se compró y su estructura de habitaciones (el texto de la acomodación lo deriva el servidor).
  // Dos hoteles del catálogo (el niño solo cabe en habitaciones configuradas): Hotel Uno 95 (HOT, ya sembrado) y Hotel Dos 95 (HOT2), ambos con proveedor configurado y habitaciones doble/triple que admiten niños.
  const HOT2 = 9512;
  before(() => {
    sql(`
      insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
        values (${HOT2}, ${DEST}, 'Hotel Dos 95', ${PROV}, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
      insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values
        (${HOT2}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${HOT2}, 'triple', 3, 4, 3, 3, 0, 1, 0, 1), (${HOT}, 'triple', 3, 4, 3, 3, 0, 1, 0, 1) on conflict do nothing;
    `);
  });
  const entradaConTextos = (e: Esc, conCatalogo: boolean) => {
    const base = entrada(e, conCatalogo);
    const habitaciones = e.pax === 3 ? { triple: 1 } : { doble: 1 };
    // A: compra DIRECTA a Hotel Uno 95 (el proveedor lo pone el catálogo); B: por PLATAFORMA (Booking) sobre Hotel Dos 95 (la plataforma es el proveedor a pagar).
    const servicios = base.servicios.map((s) => (s.tipo !== "hotel" ? s : (s as { opcionRef?: string }).opcionRef === "A" ? { ...s, catalogoId: HOT, compra: "directa", habitaciones } : { ...s, catalogoId: HOT2, compra: "plataforma", plataforma: "Booking", habitaciones }));
    return { ...base, servicios, destinoId: DEST, presentacion: PRESENTACION };
  };

  async function recorrerConTextos(e: Esc, opcion: "A" | "B", conCatalogo: boolean) {
    uidSesion = UID_SUPER;
    const total = opcion === "A" ? e.totalA : e.totalB;
    const c = await crearComparativaManual(entradaConTextos(e, conCatalogo) as never);
    assert.equal(c.ok, true, JSON.stringify(c));
    const madre = sql(`select share_token || '|' || version from public.cotizaciones where id = ${(c as { id: number }).id}`).split("|");
    const el = await elegirOpcionComparativa({ token: madre[0], opcionRef: opcion, acomodacionRef: "unica", version: Number(madre[1]), clave: uuidv4(++seq) });
    assert.equal(el.ok, true, JSON.stringify(el));
    const hijaId = (el as { hijaId: number }).hijaId;
    await pagar(hijaId, total, e.moneda, `${e.id}-${opcion}-f7`);
    const conv = await convertirCotizacionManualAContrato(hijaId);
    assert.equal(conv.ok, true, JSON.stringify(conv));
    return { hijaId, numero: (conv as { numero: string }).numero, total };
  }

  for (const e of [ESCENARIOS[0], ESCENARIOS[3]]) {
    for (const opcion of ["A", "B"] as const) {
      const conCatalogo = opcion === "A"; // A = compra directa (proveedor del catálogo); B = por plataforma
      test(`${e.id} · opción ${opcion}: el contrato trae EL hotel elegido (categoría, plan, acomodación, fechas), la tarifa REAL del niño y las inclusiones de ESA opción`, async (t) => {
        const nino = opcion === "A" ? e.ninoA : e.ninoB;
        const r = await recorrerConTextos(e, opcion, conCatalogo);
        const f = filas(r.numero);
        const hs = hoteles(r.numero);
        t.diagnostic(`contrato ${r.numero}: hoteles=${JSON.stringify(hs)} · líneas=${JSON.stringify(f.items.map((i) => [i.descripcion.slice(0, 20), i.adultos, i.ninos, i.tarifa_adulto, i.tarifa_nino]))}`);
        // Totales y niño real (conservado desde la hija).
        assert.equal(sumaLineas(f.items), centavos(r.total), "las líneas guardadas suman el precio");
        const paquete = f.items.find((i) => i.descripcion.startsWith("PAQUETE TURÍSTICO A "))!;
        assert.equal(paquete.ninos, 1);
        assert.equal(centavos(Number(paquete.tarifa_nino)), centavos(nino), "tarifa REAL del niño de la opción");
        // Hotel elegido → contrato_hoteles (solo con la 347; con R2_SIN_347=1 es el control NEGATIVO: no hay hotel).
        if (SIN_347) { assert.equal(hs.length, 0, "control negativo: sin la 347 el contrato NO trae su hotel"); return; }
        assert.equal(hs.length, 1, "UN hotel: el elegido, nunca el de la otra opción");
        const esperado = opcion === "A" ? { nombre: "Hotel A", categoria: "Superior", alimentacion: "PAM" } : { nombre: "Hotel B", categoria: "Estándar", alimentacion: "PC" };
        assert.deepEqual({ nombre: hs[0].nombre, categoria: hs[0].categoria, alimentacion: hs[0].alimentacion }, esperado);
        assert.match(String(hs[0].acomodacion), e.pax === 3 ? /triple/i : /doble/i, "la acomodación sale de la estructura de habitaciones que declaró la opción");
        assert.equal(hs[0].ciudad, "CARTAGENA 95", "un solo hotel = viaje completo: ciudad = el destino del catálogo");
        assert.equal(hs[0].fecha_ingreso, "2030-03-01");
        assert.equal(hs[0].fecha_salida, "2030-03-04");
        // Origen de la compra: directa → el proveedor configurado del hotel (catálogo); plataforma → la plataforma ES el proveedor a pagar y no se mezcla con el hotel.
        if (conCatalogo) { assert.equal(hs[0].compra_origen, "directa"); assert.equal(hs[0].proveedor, "Proveedor 95"); assert.equal(hs[0].plataforma, null); }
        else { assert.equal(hs[0].compra_origen, "plataforma"); assert.equal(hs[0].plataforma, "Booking"); assert.equal(hs[0].proveedor, "Booking", "la plataforma es el proveedor a pagar, no el proveedor configurado del hotel"); }
        // Inclusiones de LA opción, por el helper real que usan las rutas /contrato y /c (service-role tras autorizar).
        const inc = await inclusionesDeContrato(r.numero);
        const P = PRESENTACION[`${opcion}/unica` as "A/unica"];
        assert.equal(inc.incluye, P.incluye, "Incluye = el de la opción elegida");
        assert.equal(inc.noIncluye, P.noIncluye, "No incluye = el de la opción elegida");
        const otra = PRESENTACION[`${opcion === "A" ? "B" : "A"}/unica` as "A/unica"];
        assert.ok(!String(inc.incluye).includes(otra.incluye.split("\n")[1]), "nada prestado de la otra opción");
        volcar(`rev2_${e.id}_${opcion}`, { escenario: e.id, opcion, moneda: e.moneda, total: r.total, incluye: inc.incluye, noIncluye: inc.noIncluye }, r.numero, r.hijaId);
      });
    }
  }

  test("conversión repetida (reintento): no duplica los hoteles del contrato", async () => {
    if (SIN_347) return;
    uidSesion = UID_SUPER;
    const r = await recorrerConTextos(ESCENARIOS[0], "B", true);
    const antes = JSON.stringify(hoteles(r.numero));
    const otra = await convertirCotizacionManualAContrato(r.hijaId);
    assert.deepEqual(otra, { ok: true, numero: r.numero });
    assert.equal(JSON.stringify(hoteles(r.numero)), antes);
    assert.equal(hoteles(r.numero).length, 1);
  });

  test("cotización SIMPLE con dos hoteles: ambos viajan; sin ciudad ni fechas inventadas (no se sabe a qué noches corresponde cada uno)", async () => {
    if (SIN_347) return;
    uidSesion = UID_SUPER;
    const e = ESCENARIOS[1];
    const base = entrada(e, false);
    const habitaciones = { doble: 1 };
    const input = {
      ...base, destinoId: DEST, ninos: 0, tarifaNino: 0,
      servicios: [base.servicios[0],
        { tipo: "hotel", plataforma: "Despegar", nombre: "Hotel Uno Simple", proveedor: "", costoNeto: 400_000, modo: "ta", pctMarkup: 0, ta: 0, categoria: "Superior", regimen: "PAM", compra: "plataforma", habitaciones, catalogoId: HOT },
        { tipo: "hotel", plataforma: "Booking", nombre: "Hotel Dos Simple", proveedor: "", costoNeto: 400_000, modo: "ta", pctMarkup: 0, ta: 0, categoria: "Estándar", regimen: "PC", compra: "plataforma", habitaciones, catalogoId: HOT2 }],
    };
    const c = await crearCotizacionManual(input as never);
    assert.equal(c.ok, true, JSON.stringify(c));
    const hijaId = (c as { id: number }).id;
    const total = Number(sql(`select precio_venta from public.cotizaciones where id = ${hijaId}`));
    await pagar(hijaId, total, "COP", "simple-2h");
    const conv = await convertirCotizacionManualAContrato(hijaId);
    assert.equal(conv.ok, true, JSON.stringify(conv));
    const hs = hoteles((conv as { numero: string }).numero);
    assert.deepEqual(hs.map((h) => [h.nombre, h.categoria, h.alimentacion, h.ciudad, h.fecha_ingreso, h.fecha_salida, h.compra_origen, h.plataforma, h.proveedor]),
      [["Hotel Uno Simple", "Superior", "PAM", null, null, null, "plataforma", "Despegar", "Despegar"], ["Hotel Dos Simple", "Estándar", "PC", null, null, null, "plataforma", "Booking", "Booking"]]);
  });

});
