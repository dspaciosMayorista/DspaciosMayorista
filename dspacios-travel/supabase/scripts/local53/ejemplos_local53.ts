// EJEMPLOS COMPLETOS de la revisión local del #53, creados con las ACCIONES REALES de la aplicación (sin insertar a mano ningún dato del contrato) contra la base local53 por su gateway:
//   1) Contrato COP de porción terrestre: crearCotizacion → convertirCotizacion (hotel, pasajeros, fechas, ítem del paquete y condición congelada del hotel salen de la conversión real).
//   2) Cotización USD (oferta #63, 2 adultos = USD 1.000) que se DEJA ABIERTA, en el paso de conversión: quien revisa elige COP y escribe la TRM en la interfaz.
//   3) Contrato MANUAL (crearContrato, el mismo camino del formulario) con ítem de paquete, hotel y pasajeros, SIN condiciones congeladas de proveedor, y un acuerdo de mínimo del 20 % fijado con la acción real.
// Solo SIEMBRA el catálogo (`semilla_local53_catalogo.sql`) y llama a las acciones; no simula precios. Solo base LOCAL desechable.
// Uso (desde dspacios-travel/, con el entorno local53 en marcha):
//   node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs --test --test-force-exit --test-reporter=dot supabase/scripts/local53/ejemplos_local53.ts
import { mock } from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CFG = JSON.parse(readFileSync(`${process.env.LOCALAPPDATA}/dspacios-local53/config.json`, "utf8")) as { jwtSecret: string; serviceKey: string; anonKey: string };
const URL_GW = "http://127.0.0.1:54353";
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "dspacios_local53", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();

const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown }) => void };
const MIN: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(s, c, n) { const src = MIN[s]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return n(s, c); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (p: Record<string, unknown>) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64u(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", CFG.jwtSecret).update(`${h}.${c}`).digest("base64url")}`; };
const SUPER = sql("select id from public.usuarios where email = 'superadmin@local53.test'");
const EMAIL = "superadmin@local53.test";
const { cabecerasIdentidad } = await import("../../../lib/contrato/identidad.ts");
const cliente = (token: string, usuario?: { id: string; email: string }, headers: Record<string, string> = {}) => {
  const sb = crearClienteSupabase(URL_GW, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
};
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_GW; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = CFG.anonKey; process.env.SUPABASE_SERVICE_ROLE_KEY = CFG.serviceKey;
mock.module("@/lib/supabase/server", { namedExports: { createClient: async (id?: Record<string, string>) => cliente(jwt({ role: "authenticated", sub: SUPER, aud: "authenticated" }), { id: SUPER, email: EMAIL }, cabecerasIdentidad(id)) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: (id?: Record<string, string>) => cliente(CFG.serviceKey, undefined, cabecerasIdentidad(id)) } });
// La agencia activa (cookie «tenant») se puede cambiar con globalThis.__tenant: solo el paso 5 (importador histórico) la pone en «minorista».
const COOKIES = { get: (n: string) => (n === "tenant" && (globalThis as { __tenant?: string }).__tenant ? { name: n, value: (globalThis as { __tenant?: string }).__tenant } : undefined), getAll: () => [] as unknown[], set: () => undefined, delete: () => undefined, has: () => false };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { generarTarifario } = await import("../../../app/(dashboard)/dashboard/paquetes/actions.ts");
const { crearCotizacion, convertirCotizacion } = await import("../../../app/(dashboard)/dashboard/reservar/actions.ts");
const { crearContrato } = await import("../../../app/(dashboard)/dashboard/contratos/actions.ts");
const { importarHistorico } = await import("../../../app/(dashboard)/dashboard/contratos/importar/actions.ts");
const { fijarMinimoConfirmacion } = await import("../../../app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");

const PASOS = (process.env.EJ_PASOS ?? "0,1,2,3").split(",");
const falla = (m: string, r: unknown): never => { console.error(`FALLO ${m}: ${JSON.stringify(r)}`); process.exit(1); };
const paso = (m: string) => console.log(`== ${m}`);

if (PASOS.includes("0")) {
paso("catálogo + asesor sintéticos");
sql(`insert into public.asesores (nombre, email, rol, activo) values ('Local Venta', 'venta@local53.test', 'venta', true) on conflict do nothing;`);
execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "dspacios_local53", "-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: readFileSync(new URL("./semilla_local53_catalogo.sql", import.meta.url), "utf8"), encoding: "utf8" });

paso("tarifario con el motor REAL (generarTarifario)");
for (const p of [5301, 5302]) { const g = await generarTarifario(p); if (!(g as { ok?: boolean }).ok) falla(`generarTarifario(${p})`, g); }
}

const pax = (prefijo: string, doc: number) => [0, 1].map((i) => ({ nombres: `${prefijo}${i + 1}`, apellidos: "Ejemplo", tipoDoc: "CC", numeroDoc: String(doc + i), fechaNacimiento: i === 0 ? "1985-04-12" : "1987-09-30", nacionalidad: "Colombiana", esInfante: false }));
const entrada = (paquete: number, hotel: number, salida: number | null, modulo: "porcion_terrestre" | "dinamico", cli: { nombres: string; apellidos: string; numeroDoc: string; email: string }, personas: ReturnType<typeof pax>) => ({
  paqueteId: paquete, bloqueoId: null, salidaId: salida, modulo, hotelId: hotel, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", categoria: "Estandar", regimen: "Desayuno",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
  cliente: { ...cli, tipoDoc: "CC", telefono: "3001234567" }, tipoAsesor: "interno", asesorInterno: "Local Venta", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: personas, servicios: [] as number[],
});

let cotCop: { ok: boolean; id?: number } = { ok: true }; let convCop: { ok: boolean; numero?: string; numeros?: string[] } = { ok: true }; let cotUsd: { ok: boolean; id?: number } = { ok: true };
if (PASOS.includes("1")) {
paso("1) contrato COP: crearCotizacion → convertirCotizacion (acciones reales)");
cotCop = await crearCotizacion(entrada(5301, 5301, null, "porcion_terrestre", { nombres: "Marta", apellidos: "Ejemplo COP", numeroDoc: "52000111", email: "marta.cop@ejemplo.test" }, pax("Cop", 52000111)) as never) as { ok: boolean; id?: number };
if (!cotCop.ok) falla("crearCotizacion COP", cotCop);
convCop = await convertirCotizacion(cotCop.id!, pax("Cop", 52000111) as never, false, "Local Venta", null, null, null) as { ok: boolean; numero?: string; numeros?: string[] };
if (!convCop.ok) falla("convertirCotizacion COP", convCop);
}

if (PASOS.includes("2")) {
paso("2) cotización USD (oferta #63) creada y DEJADA ABIERTA para que quien revisa elija COP y escriba la TRM");
cotUsd = await crearCotizacion(entrada(5302, 5302, 5302, "dinamico", { nombres: "Julián", apellidos: "Ejemplo USD", numeroDoc: "80000222", email: "julian.usd@ejemplo.test" }, pax("Usd", 80000222)) as never) as { ok: boolean; id?: number };
if (!cotUsd.ok) falla("crearCotizacion USD", cotUsd);
}

let manual: { ok: boolean; numero?: string; error?: string } = { ok: true };
if (PASOS.includes("3")) {
paso("3) contrato MANUAL (crearContrato) con ítem de paquete, hotel y pasajeros, sin condiciones congeladas");
manual = await crearContrato({
  tipoPaquete: "dinamico", paqueteId: null, bloqueoId: null, cliente: "Laura Ejemplo Manual", clienteDocumento: "1020304050", clienteTelefono: "3009876543", clienteDireccion: "Calle 10 # 20-30, Medellín",
  destino: "CARTAGENA", fechaSalida: "2030-04-10", fechaRegreso: "2030-04-14", fechaEmision: "2026-11-15", asistenciaMedica: false, planNombre: "Paquete manual Cartagena", toursTraslados: "",
  asesorNombre: "Local Venta", asesorCargo: "Asesor/a", asesorCc: "", asesorTel: "",
  pasajeros: [
    { nombres: "Laura", apellidos: "Ejemplo Manual", tipoId: "CC", identificacion: "1020304050", fechaNacimiento: "1990-06-01", esInfante: false },
    { nombres: "Pedro", apellidos: "Ejemplo Manual", tipoId: "CC", identificacion: "1020304051", fechaNacimiento: "1988-02-15", esInfante: false },
  ],
  hoteles: [{ nombre: "Hotel Manual Cartagena 53", categoria: "Estándar", proveedor: "Hotel USD Ejemplo 53", ciudad: "Cartagena", alimentacion: "Desayuno", acomodacion: "Doble", detalleAcomodacion: "", fechaIngreso: "2030-04-10", fechaSalida: "2030-04-14", costo: 1_600_000 }],
  vuelos: [], items: [{ descripcion: "Paquete Cartagena 4 días / 3 noches, 2 adultos", adultos: 2, ninos: 0, tarifaAdulto: 1_250_000, tarifaNino: 0 }], tipoVenta: "interno",
} as never) as { ok: boolean; numero?: string; error?: string };
if (!manual.ok) falla("crearContrato (manual)", manual);
const uidManual = sql(`select contrato_uid from public.ventas where numero_contrato = '${manual.numero}'`);
const acuerdo = await fijarMinimoConfirmacion(manual.numero!, "porcentaje", 20, "acuerdo explícito del ejemplo manual", { [manual.numero!]: uidManual });
if (!acuerdo.ok) falla("fijarMinimoConfirmacion (manual)", acuerdo);
}

// 4) INVESTIGACIÓN (no forma parte de los ejemplos; EJ_PASOS=4): ¿puede el camino real crear un contrato con precio > 0 y SIN ítems? Se intenta con la acción real y se informa el resultado.
if (PASOS.includes("4")) {
  paso("4) investigación: crearContrato con precio por tarifa de hotel pero SIN ítems de paquete (items: [])");
  const base = {
    tipoPaquete: "dinamico", paqueteId: null, bloqueoId: null, cliente: "Investigación Sin Items", clienteDocumento: "", clienteTelefono: "", clienteDireccion: "", destino: "CARTAGENA",
    fechaSalida: "2030-05-10", fechaRegreso: "2030-05-13", fechaEmision: "2026-11-15", asistenciaMedica: false, planNombre: "", toursTraslados: "", asesorNombre: "Local Venta", asesorCargo: "", asesorCc: "", asesorTel: "",
    pasajeros: [], hoteles: [{ nombre: "Hotel Investigación", categoria: "Estándar", proveedor: "Hotel USD Ejemplo 53", ciudad: "Cartagena", alimentacion: "Desayuno", acomodacion: "Doble", detalleAcomodacion: "", fechaIngreso: "2030-05-10", fechaSalida: "2030-05-13", costo: 900_000 }],
    vuelos: [], items: [] as unknown[], tipoVenta: "interno",
  };
  const r = await crearContrato(base as never) as { ok: boolean; numero?: string; error?: string };
  console.log("RESULTADO sin ítems:", JSON.stringify(r));
  if (r.ok) console.log("CREADO:", sql(`select 'precio=' || precio_venta || ' items=' || (select count(*) from public.contrato_items i where i.numero_contrato = v.numero_contrato) from public.ventas v where numero_contrato = '${r.numero}'`));
  const r2 = await crearContrato({ ...base, items: [{ descripcion: "", adultos: 0, ninos: 0, tarifaAdulto: 500_000, tarifaNino: 0 }] } as never) as { ok: boolean; numero?: string; error?: string };
  console.log("RESULTADO ítem con 0 pasajeros y tarifa:", JSON.stringify(r2));
  if (r2.ok) console.log("CREADO:", sql(`select 'precio=' || precio_venta || ' items=' || (select count(*) from public.contrato_items i where i.numero_contrato = v.numero_contrato) from public.ventas v where numero_contrato = '${r2.numero}'`));
}
// 5) INVESTIGACIÓN (EJ_PASOS=5): el importador de histórico de MINORISTA (camino real y soportado) escribe ventas, abonos y CxP pero NINGÚN ítem del contrato: precio > 0 sin ítems.
if (PASOS.includes("5")) {
  paso("5) investigación: importador histórico minorista (importarHistorico) → contrato con precio y sin ítems");
  (globalThis as { __tenant?: string }).__tenant = "minorista";
  const rel = ["", "00-0901", "05 SEP 2026", "10 DIC 2026", "$ 3.000.000", "AVIANCA", "$ 800.000", "HOTEL IMPORTADO SAS", "$ 1.500.000", "", "", "", "", "", ""].join("	");
  const pag = ["00-0901", "Asesor Importado", "Titular Importado", "123456", "05 SEP 2026", "$ 3.000.000", "06 SEP 2026", "$ 1.000.000", "$ 2.000.000", "Bancolombia"].join("	");
  const r = await importarHistorico(rel, pag);
  console.log("RESULTADO importarHistorico:", JSON.stringify(r));
  (globalThis as { __tenant?: string }).__tenant = undefined;
  console.log("IMPORTADO:", sql(`select numero_contrato || ' ' || tenant || ' precio=' || precio_venta || ' ' || moneda || ' items=' || (select count(*) from public.contrato_items i where i.numero_contrato = v.numero_contrato) || ' abonos=' || (select count(*) from public.abonos a where a.numero_contrato = v.numero_contrato) from public.ventas v where tenant = 'minorista' order by created_at desc limit 1`));
}
const numCop = convCop.numero ?? convCop.numeros?.[0];
console.log("\n=== RESUMEN ===");
console.log(JSON.stringify({ cotizacionUsd: cotUsd.id, contratoCop: numCop, contratoManual: manual.numero, cotizacionCop: cotCop.id }));
for (const n of [numCop ?? "DTM-0001", manual.numero ?? ""].filter(Boolean)) {
  console.log(n, sql(`select 'precio=' || precio_venta || ' ' || moneda || ' estado=' || estado || ' items=' || (select count(*) from public.contrato_items i where i.numero_contrato = v.numero_contrato) || ' hoteles=' || (select count(*) from public.contrato_hoteles h where h.numero_contrato = v.numero_contrato) || ' pasajeros=' || (select count(*) from public.contrato_pasajeros p where p.numero_contrato = v.numero_contrato) || ' condiciones=' || (select count(*) from public.contrato_condiciones c where c.numero_contrato = v.numero_contrato) from public.ventas v where numero_contrato = '${n}'`));
}
console.log("cotización USD:", sql(`select 'id=' || id || ' ' || moneda || ' ' || precio_venta || ' estado=' || estado || ' oferta63=' || ((payload ? 'oferta63')::text) from public.cotizaciones where moneda = 'USD' order by id desc limit 1`));
process.exit(0);
