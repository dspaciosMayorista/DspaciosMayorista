// F6 (revisión del dueño 2026-11-26) — acciones REALES de los formularios manuales (cotización dinámica, comparativa y contrato manual) contra PostgreSQL + PostgREST locales y DESECHABLES.
// Lo lanza supabase/scripts/test_f6_95_formularios.sh (no corre en `npm run test:*`). Se prueba, con persistencia leída de nuevo:
//   B95-13  hotel del catálogo de OTRO destino → se rechaza y no se crea nada; destino fuera del catálogo / ausente → se rechaza; el nombre canónico del destino pisa el texto.
//   B95-14  regreso anterior a la salida → se rechaza en las tres acciones (cotización simple, comparativa, contrato manual).
//   B95-15  infantes (dato + Adults Only), compra directa vs plataforma: quién queda como PROVEEDOR de la obligación (CxP / prevista) tras la conversión real, y en contrato_hoteles (migración 346).
//   B95-20  «1 doble» como texto libre / 3 adultos en una doble → se rechaza; la acomodación guardada se DERIVA de la estructura de habitaciones.
// Lo único simulado: la sesión (auth.getUser; el cliente de sesión es PostgREST real con JWT `authenticated`), la numeración (RPC real), el contexto de cotización/contrato y efectos laterales ajenos.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.F6_CONTENEDOR ?? "";
const DB = process.env.F6_BASE ?? "";
const PGRST = process.env.F6_POSTGREST ?? "";
const SECRETO = process.env.F6_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan F6_*: usa supabase/scripts/test_f6_95_formularios.sh.");

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
const UID_SUPER = "00000000-0000-0000-0000-000000960001";
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-96";
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_SUPER, session_id: sidDe(UID_SUPER) }), { id: UID_SUPER, email: `${UID_SUPER}@x.test` });

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => ({ ok: true, tenant: "mayorista", rol: "superadmin", sb: clienteSesion() }) } });
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

// CONTROL NEGATIVO (F6_CONTROL_NEGATIVO=1): sin la validación del servidor (pasa todo, como antes de esta entrega) los casos de rechazo y de proveedor DEBEN fallar: demuestra que las pruebas detectan el defecto.
if (process.env.F6_CONTROL_NEGATIVO === "1") {
  mock.module("@/lib/catalogo/prepararManual", { namedExports: {
    prepararServiciosManual: async (_c: unknown, i: { servicios: unknown[] }) => ({ ok: true, destino: "texto cualquiera", destinoId: undefined, servicios: i.servicios }),
    prepararHotelesContrato: async (_c: unknown, i: { hoteles: Record<string, unknown>[] }) => ({ ok: true, destino: null, hoteles: i.hoteles.map((h) => ({ ...h, compraOrigen: null, plataformaCompra: null, aviso: null })) }),
  } });
}
const { crearCotizacionManual, crearComparativaManual, convertirCotizacionManualAContrato } = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const { registrarPagoPrevio } = await import("../app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
const { crearContrato } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");

// ── Semilla sintética (ids 96xxx; nada de datos reales) ──────────────────────────────────────────────
const DEST_A = 96001, DEST_B = 96002, PROV = 96001, H_ISLA = 96001, H_COSTA = 96002, H_ADULTOS = 96003;
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_SUPER}', 'super96@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_SUPER}', 'super96@x.test', 'Super 96', 'superadmin', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (${DEST_A}, 'ISLA F6'), (${DEST_B}, 'COSTA F6') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (${PROV}, 'Hoteles Isla F6') on conflict do nothing;
    -- Hotel Isla: destino A, CON proveedor configurado. Hotel Costa: destino B, SIN proveedor. Hotel Solo Adultos: destino A, adults_only.
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
      (${H_ISLA}, ${DEST_A}, 'Hotel Isla F6', ${PROV}, 'COP', 0, 2, 3, 10, 1, 6, true, false),
      (${H_COSTA}, ${DEST_B}, 'Hotel Costa F6', null, 'COP', 0, 2, 3, 10, 1, 6, true, false),
      (${H_ADULTOS}, ${DEST_A}, 'Hotel Solo Adultos F6', ${PROV}, 'COP', 0, 2, 3, 10, 1, 6, true, true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values
      (${H_ISLA}, 'doble', 2, 4, 0, 0, 0, 2, 0, 1), (${H_ISLA}, 'sencilla', 1, 2, 0, 0, 0, 1, 0, 1),
      (${H_COSTA}, 'doble', 2, 4, 0, 0, 0, 2, 0, 1), (${H_ADULTOS}, 'doble', 2, 2, 0, 0, 0, 0, 0, 0);
  `);
});

const cuentaCot = () => Number(sql(`select count(*) from public.cotizaciones`));
const cuentaVentas = () => Number(sql(`select count(*) from public.ventas`));
const CLIENTE = { nombres: "Titular", apellidos: "Sintético F6", tipoDoc: "CC", numeroDoc: "960123456", telefono: "3001112233", email: "titular.f6@example.com", nacimiento: "1985-05-20" };
const hotelFila = (extra: Record<string, unknown> = {}) => ({
  tipo: "hotel", plataforma: "", nombre: "Hotel Isla F6", proveedor: "", costoNeto: 1_000_000, modo: "mk", pctMarkup: 20, ta: 0,
  catalogoId: H_ISLA, categoria: "Estándar", regimen: "PC", compra: "directa", habitaciones: { doble: 1 }, ...extra,
});
const aereo = { tipo: "aereo", plataforma: "Despegar", nombre: "Avianca", proveedor: "", costoNeto: 400_000, modo: "ta", pctMarkup: 0, ta: 50_000 };
const entrada = (extra: Record<string, unknown> = {}, servicios: unknown[] = [hotelFila(), aereo]) => ({
  cliente: CLIENTE, destino: "texto cualquiera", destinoId: DEST_A, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, moneda: "COP", ninos: 0, infantes: 0, tarifaNino: 0, recobro: 0, recobroAliado: 0,
  tipoAsesor: "interno", asesorInterno: "Asesor F6", agenciaNombre: "", freelanceNombre: "", plazo: "", vigenciaHasta: "", observaciones: "", incluye: "", noIncluye: "", servicios, ...extra,
});
/** Proveedor(es) de las obligaciones de un contrato cuyo servicio coincide: la CxP ya materializada o la prevista (aún no exigible); sin duplicados. */
const proveedorDeObligacion = (n: string, patron: string) => sql(`
  select coalesce(string_agg(distinct p, ',' || ' '), '-') from (
    select proveedor p from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and servicio like ${lit(patron)}
    union all select payload->>'proveedor' from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)} and clase = 'cxp' and payload->>'servicio' like ${lit(patron)}) q`);
const err = (r: unknown) => (r as { error?: string }).error ?? "";
const ok = (r: unknown) => (r as { ok: boolean }).ok === true;

describe("B95-13/14/15/20 · cotización dinámica: rechazos del servidor (no se crea nada)", () => {
  const rechaza = async (nombre: string, extra: Record<string, unknown>, servicios: unknown[] | undefined, patron: RegExp) => {
    const antes = cuentaCot();
    const r = await crearCotizacionManual(entrada(extra, servicios) as never);
    assert.equal(ok(r), false, `${nombre}: debe rechazarse (${JSON.stringify(r)})`);
    assert.match(err(r), patron, nombre);
    assert.equal(cuentaCot(), antes, `${nombre}: no se creó ninguna cotización`);
  };
  test("hotel del catálogo de OTRO destino (el reportado: un hotel que no es del destino elegido)", async () => rechaza("otro destino", {}, [hotelFila({ nombre: "Hotel Costa F6", catalogoId: H_COSTA, compra: "plataforma", plataforma: "Despegar" }), aereo], /no pertenece al destino elegido/));
  test("destino ausente o fuera del catálogo", async () => {
    await rechaza("sin destino", { destinoId: null }, undefined, /Elige el destino/);
    await rechaza("destino inexistente", { destinoId: 99999999 }, undefined, /ya no existe en el catálogo/);
  });
  test("regreso anterior a la salida", async () => rechaza("fechas", { fechaIda: "2030-03-10", fechaRegreso: "2030-03-09" }, undefined, /fecha de regreso no puede ser anterior/));
  test("acomodación como TEXTO libre («1 doble») sin estructura, y 3 adultos en 1 doble", async () => {
    await rechaza("texto libre", {}, [hotelFila({ habitaciones: undefined, acomodacion: "1 doble" }), aereo], /Indica las habitaciones/);
    await rechaza("3 adultos en 1 doble", { pax: 3 }, undefined, /alojan 2 adulto\(s\); el viaje tiene 3/);
    await rechaza("1 adulto en 1 doble", { pax: 1 }, undefined, /necesitan 2 adulto/);
  });
  test("niños/infantes frente a la capacidad del hotel; infante sin adulto; Adults Only con infantes", async () => {
    await rechaza("3 niños en 1 doble", { ninos: 3, tarifaNino: 100_000 }, undefined, /máximo 2 niño\(s\)/);
    await rechaza("2 infantes en 1 doble", { infantes: 2 }, undefined, /máximo 1 infante\(s\)/);
    await rechaza("infante sin adulto", { pax: 0, infantes: 1 }, [hotelFila({ habitaciones: { doble: 1 } }), aereo], /al menos un adulto/);
    await rechaza("Adults Only + infante", { infantes: 1 }, [hotelFila({ nombre: "Hotel Solo Adultos F6", catalogoId: H_ADULTOS, habitaciones: { doble: 1 } }), aereo], /solo para adultos/);
  });
  test("origen de la compra: sin elegir, plataforma sin nombre, directa sin proveedor configurado ni escrito (nunca cae a la plataforma)", async () => {
    await rechaza("sin origen", {}, [hotelFila({ compra: undefined }), aereo], /Indica cómo se compra/);
    await rechaza("plataforma sin nombre", {}, [hotelFila({ compra: "plataforma", plataforma: "  " }), aereo], /escribe el nombre de la plataforma/);
    await rechaza("directa sin proveedor", { destinoId: DEST_B }, [hotelFila({ nombre: "Hotel Costa F6", catalogoId: H_COSTA, compra: "directa", plataforma: "Despegar", proveedor: "" }), aereo], /Compra directa de «Hotel Costa F6»: no hay proveedor/);
  });
});

describe("B95-15/20 · cotización dinámica válida → conversión real → proveedor de la obligación", () => {
  const prevista = proveedorDeObligacion;
  async function pagarYConvertir(id: number, total: number) {
    for (const [ref, valor] of [["a", Math.round(total / 2)], ["b", total - Math.round(total / 2)]] as const) {
      const p = await registrarPagoPrevio(id, { moneda: "COP", formaPago: "transferencia", referencia: `F6-${id}-${ref}`, valor }, `f6-${id}-${ref}`);
      assert.equal(ok(p), true, JSON.stringify(p));
    }
    const c = await convertirCotizacionManualAContrato(id);
    assert.equal(ok(c), true, JSON.stringify(c));
    return (c as { numero: string }).numero;
  }

  test("PLATAFORMA: la plataforma es el proveedor a pagar; el hotel conserva su nombre; la acomodación sale de la estructura; infantes quedan como dato", async () => {
    const r = await crearCotizacionManual(entrada({ infantes: 1 }, [hotelFila({ compra: "plataforma", plataforma: " Despegar ", proveedor: "Proveedor que NO debe usarse", acomodacion: "texto libre que se ignora" }), aereo]) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    const id = (r as { id: number }).id;
    const fila = JSON.parse(sql(`select row_to_json(s)::text from public.cotizacion_servicios s where cotizacion_id = ${id} and tipo_servicio = 'hotel'`));
    assert.equal(fila.nombre_servicio, "Hotel Isla F6", "la identidad del hotel no se reemplaza por la plataforma");
    assert.equal(fila.proveedor, "Despegar");
    assert.equal(fila.plataforma, "Despegar");
    const cot = JSON.parse(sql(`select row_to_json(c)::text from (select destino, payload, detalle from public.cotizaciones where id = ${id}) c`));
    assert.equal(cot.destino, "ISLA F6", "el nombre canónico del catálogo pisa el texto del navegador");
    const sv = cot.payload.servicios.find((s: { tipo: string }) => s.tipo === "hotel");
    assert.deepEqual([sv.compra, sv.acomodacion, sv.habitaciones.doble, sv.catalogoId], ["plataforma", "1 hab Doble", 1, H_ISLA]);
    assert.equal(cot.payload.infantes, 1);
    assert.equal(cot.detalle.venta.infantes, 1);
    const total = Number(sql(`select precio_venta from public.cotizaciones where id = ${id}`));
    const n = await pagarYConvertir(id, total);
    assert.equal(prevista(n, "Hotel%"), "Despegar", "la obligación del hotel se paga a la plataforma, no al proveedor del hotel");
  });

  test("DIRECTA: sin proveedor escrito se usa el configurado del hotel en el catálogo; la plataforma queda vacía", async () => {
    const r = await crearCotizacionManual(entrada({}, [hotelFila({ compra: "directa", plataforma: "Despegar", proveedor: "" }), aereo]) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    const id = (r as { id: number }).id;
    const fila = JSON.parse(sql(`select row_to_json(s)::text from public.cotizacion_servicios s where cotizacion_id = ${id} and tipo_servicio = 'hotel'`));
    assert.deepEqual([fila.proveedor, fila.plataforma], ["Hoteles Isla F6", null]);
    const total = Number(sql(`select precio_venta from public.cotizaciones where id = ${id}`));
    const n = await pagarYConvertir(id, total);
    assert.equal(prevista(n, "Hotel%"), "Hoteles Isla F6");
  });

  test("DIRECTA con un proveedor ESCRITO a mano para un hotel sin proveedor configurado: se acepta (explícito) y se usa ese", async () => {
    const r = await crearCotizacionManual(entrada({ destinoId: DEST_B }, [hotelFila({ nombre: "Hotel Costa F6", catalogoId: H_COSTA, compra: "directa", proveedor: "Operador Escrito F6" }), aereo]) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    assert.equal(sql(`select proveedor from public.cotizacion_servicios where cotizacion_id = ${(r as { id: number }).id} and tipo_servicio = 'hotel'`), "Operador Escrito F6");
  });

  test("hotel MANUAL (fuera del catálogo): se acepta con compra y habitaciones válidas; sin vínculo de catálogo", async () => {
    const r = await crearCotizacionManual(entrada({}, [hotelFila({ nombre: "Posada Nativa F6", catalogoId: null, compra: "plataforma", plataforma: "Booking", habitaciones: { doble: 1 } }), aereo]) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    const sv = JSON.parse(sql(`select payload->'servicios'->0 from public.cotizaciones where id = ${(r as { id: number }).id}`));
    assert.deepEqual([sv.nombre, sv.catalogoId ?? null, sv.compra], ["Posada Nativa F6", null, "plataforma"]);
  });
});

describe("B95-13/14/15/20 · comparativa: cada hotel se valida y se resuelve por separado", () => {
  const dos = (b: Record<string, unknown>) => [
    hotelFila({ opcionRef: "A", compra: "directa", habitaciones: { doble: 1 } }),
    hotelFila({ opcionRef: "B", nombre: "Hotel Costa F6", catalogoId: H_COSTA, costoNeto: 1_200_000, compra: "plataforma", plataforma: "Despegar", habitaciones: { doble: 1 }, ...b }), aereo,
  ];
  test("una opción con un hotel de otro destino se rechaza y no crea la comparativa", async () => {
    const antes = cuentaCot();
    const r = await crearComparativaManual(entrada({}, dos({})) as never);
    assert.equal(ok(r), false);
    assert.match(err(r), /Hotel Costa F6» del catálogo no pertenece al destino elegido|no pertenece al destino elegido/);
    assert.equal(cuentaCot(), antes);
  });
  test("regreso anterior a la salida también se rechaza en la comparativa", async () => {
    const r = await crearComparativaManual(entrada({ fechaIda: "2030-03-10", fechaRegreso: "2030-03-02" }, dos({ catalogoId: null, nombre: "Hotel manual B" })) as never);
    assert.match(err(r), /fecha de regreso no puede ser anterior/);
  });
  test("válida: opción A directa (proveedor del catálogo) y opción B manual por plataforma; cada fila con su proveedor", async () => {
    const r = await crearComparativaManual(entrada({ ninos: 0, tarifaNinoPorOpcion: undefined }, dos({ catalogoId: null, nombre: "Hotel manual B" })) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    const filas = sql(`select string_agg(coalesce(opcion_ref,'-') || ':' || nombre_servicio || ':' || coalesce(proveedor,'-'), ' | ' order by orden) from public.cotizacion_servicios where cotizacion_id = ${(r as { id: number }).id} and tipo_servicio = 'hotel'`);
    assert.equal(filas, "A:Hotel Isla F6:Hoteles Isla F6 | B:Hotel manual B:Despegar");
  });
});

describe("B95-14/15/20 · contrato manual (crearContrato real, migración 346)", () => {
  const pax = (n: number) => Array.from({ length: n }, (_, i) => ({ nombres: `Pax${i + 1}`, apellidos: "F6", tipoId: "CC", identificacion: `9601${i}`, fechaNacimiento: "1990-01-01", esInfante: false }));
  const contrato = (extra: Record<string, unknown> = {}, hotel: Record<string, unknown> = {}) => ({
    tipoPaquete: "dinamico" as const, paqueteId: null, bloqueoId: null, cliente: "Cliente F6", clienteDocumento: "", clienteTelefono: "", clienteDireccion: "",
    destino: "texto del navegador", destinoId: DEST_A, fechaSalida: "2030-03-01", fechaRegreso: "2030-03-04", fechaEmision: "2030-02-01", asistenciaMedica: false, planNombre: "", toursTraslados: "",
    asesorNombre: "Asesor F6", asesorCargo: "", asesorCc: "", asesorTel: "", pasajeros: pax(2), vuelos: [],
    hoteles: [{ nombre: "Hotel Isla F6", categoria: "Estándar", proveedor: "", ciudad: "ISLA F6", alimentacion: "PC", acomodacion: "texto libre ignorado", detalleAcomodacion: "vista al mar", fechaIngreso: "2030-03-01", fechaSalida: "2030-03-04",
      costo: 1_500_000, catalogoHotelId: H_ISLA, compra: "directa", habitaciones: { doble: 1 }, ...hotel }],
    items: [{ descripcion: "Paquete F6", adultos: 2, ninos: 0, tarifaAdulto: 1_500_000, tarifaNino: 0 }], tipoVenta: "interno" as const, aliadoId: null, bncModo: "fijo" as const, bncFijo: 0, ...extra,
  });
  const rechaza = async (nombre: string, c: unknown, patron: RegExp) => {
    const antes = cuentaVentas();
    const r = await crearContrato(c as never);
    assert.equal(ok(r), false, `${nombre}: ${JSON.stringify(r)}`);
    assert.match(err(r), patron, nombre);
    assert.equal(cuentaVentas(), antes, `${nombre}: no se creó ningún contrato`);
  };
  test("rechazos: regreso anterior, hotel de otro destino, sin destino, 3 pasajeros en 1 doble, sin origen de compra", async () => {
    await rechaza("fechas", contrato({ fechaRegreso: "2030-02-27" }), /fecha de regreso no puede ser anterior/);
    await rechaza("otro destino", contrato({}, { nombre: "Hotel Costa F6", catalogoHotelId: H_COSTA, proveedor: "X" }), /no pertenece al destino elegido/);
    await rechaza("sin destino", contrato({ destinoId: null }), /Elige el destino/);
    await rechaza("3 pasajeros adultos en 1 doble", contrato({ pasajeros: pax(3) }), /alojan 2 adulto\(s\); el viaje tiene 3/);
    await rechaza("sin origen de compra", contrato({}, { compra: undefined }), /Indica cómo se compra/);
  });
  test("válido por PLATAFORMA: contrato_hoteles guarda origen/plataforma, el proveedor es la plataforma, la acomodación sale de la estructura y la CxP va a la plataforma", async () => {
    const r = await crearContrato(contrato({}, { compra: "plataforma", plataforma: "Despegar", proveedor: "no se usa" }) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    const n = (r as { numero: string }).numero;
    const h = JSON.parse(sql(`select row_to_json(h)::text from public.contrato_hoteles h where numero_contrato = ${lit(n)}`));
    assert.deepEqual([h.nombre, h.proveedor, h.compra_origen, h.plataforma, h.acomodacion, h.detalle_acomodacion], ["Hotel Isla F6", "Despegar", "plataforma", "Despegar", "1 hab Doble", "vista al mar"]);
    assert.equal(sql(`select destino from public.ventas where numero_contrato = ${lit(n)}`), "ISLA F6");
    assert.equal(proveedorDeObligacion(n, "Hotel%"), "Despegar", "la obligación del hotel (prevista o ya materializada) se paga a la plataforma");
  });
  test("válido DIRECTO: el proveedor es el del hotel en el catálogo y no queda plataforma", async () => {
    const r = await crearContrato(contrato({}, { compra: "directa", plataforma: "Despegar" }) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    const n = (r as { numero: string }).numero;
    const h = JSON.parse(sql(`select row_to_json(h)::text from public.contrato_hoteles h where numero_contrato = ${lit(n)}`));
    assert.deepEqual([h.proveedor, h.compra_origen, h.plataforma], ["Hoteles Isla F6", "directa", null]);
    assert.equal(proveedorDeObligacion(n, "Hotel%"), "Hoteles Isla F6");
  });
  test("lo que el navegador mande en compraOrigen/plataformaCompra se descarta (solo cuenta lo que decide el servidor)", async () => {
    const r = await crearContrato(contrato({}, { compra: "directa", compraOrigen: "plataforma", plataformaCompra: "Intruso" }) as never);
    assert.equal(ok(r), true, JSON.stringify(r));
    const h = JSON.parse(sql(`select row_to_json(h)::text from public.contrato_hoteles h where numero_contrato = ${lit((r as { numero: string }).numero)}`));
    assert.deepEqual([h.compra_origen, h.plataforma], ["directa", null]);
  });
});
