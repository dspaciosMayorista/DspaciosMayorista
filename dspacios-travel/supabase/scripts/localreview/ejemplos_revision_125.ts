// REVISIÓN CONSOLIDADA — EJEMPLOS de #125 con las ACCIONES REALES de la aplicación (sin insertar a mano ningún dato de contrato) contra la base rev_revision por su gateway:
//   publica el tarifario de los paquetes 912501 (PRE BF, para configurar), 912503 (PRE BF ACTIVO) y 912504 (noches sucesivas, markup 0) y crea
//   E1) contrato «PRE BF ACTIVO»: 5 noches desde el 4 dic, 1 habitación doble, 2 adultos + 1 niño de 8 años (niño gratis por habitación),
//   E2) contrato «noches sucesivas» (R1/R2): 4→6 dic, 2 adultos + 1 niño de 8 años, dos promociones sucesivas para el MISMO niño,
//   E3) una cotización ABIERTA de «PRE BF ACTIVO» con dos niños (8 y 5 años) para que quien revisa la convierta o la mire.
// IDEMPOTENTE: si los ejemplos ya existen (cliente «Ejemplo 125»), solo vuelve a publicar los tarifarios. Solo base LOCAL desechable; lo lanza localreview.ps1 (preparar / ampliar125).
import { mock } from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CFG = { jwtSecret: process.env.REV_JWT_SECRET ?? "", serviceKey: process.env.REV_SERVICE_KEY ?? "", anonKey: process.env.REV_ANON_KEY ?? "" };
const DBN = process.env.REV_DB ?? "";
if (!CFG.jwtSecret || !CFG.serviceKey || !DBN || !(process.env.REV_URL ?? "").startsWith("http://127.0.0.1")) throw new Error("Solo local: usa localreview.ps1 preparar.");
const URL_GW = process.env.REV_URL as string;
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DBN, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();

const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown }) => void };
const MIN: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(s, c, n) { const src = MIN[s]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return n(s, c); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (p: Record<string, unknown>) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64u(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", CFG.jwtSecret).update(`${h}.${c}`).digest("base64url")}`; };
const SUPER = sql("select id from public.usuarios where email = 'superadmin@revision.test'");
const EMAIL = "superadmin@revision.test";
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


const falla = (m: string, r: unknown): never => { console.error(`FALLO ${m}: ${JSON.stringify(r)}`); process.exit(1); };
const paso = (m: string) => console.log(`== ${m}`);
const nac = (edad: number, ida: string) => `${Number(ida.slice(0, 4)) - edad}-01-01`;
const adulto = (i: number) => ({ nombres: `Adulto${i}`, apellidos: "Ejemplo 125", tipoDoc: "CC", numeroDoc: `1250${i}${i}`, fechaNacimiento: "1985-03-04", nacionalidad: "Colombiana", esInfante: false });
const menor = (edad: number, ida: string, n: number) => ({ nombres: `Menor${edad}`, apellidos: "Ejemplo 125", tipoDoc: "RC", numeroDoc: `1260${n}${edad}`, fechaNacimiento: nac(edad, ida), nacionalidad: "Colombiana", esInfante: false });
const pasajeros = (edades: number[], ida: string) => [adulto(1), adulto(2), ...edades.map((e, i) => menor(e, ida, i + 1))];
const reserva = (paquete: number, ida: string, regreso: string, edades: number[], cli: { nombres: string; apellidos: string; numeroDoc: string; email: string }) => ({
  paqueteId: paquete, bloqueoId: null, modulo: "porcion_terrestre" as const, hotelId: paquete, fechaIda: ida, fechaRegreso: regreso, categoria: "Estandar", regimen: "PAM",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: edades, cantidadMenores: edades.length,
  cliente: { ...cli, tipoDoc: "CC", telefono: "3001234567" }, tipoAsesor: "interno", asesorInterno: "Rev Venta", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "",
  pasajeros: pasajeros(edades, ida), servicios: [] as number[],
});

paso("tarifario de #125 con el motor REAL (generarTarifario)");
for (const p of [912501, 912503, 912504]) { const g = await generarTarifario(p); if (!(g as { ok?: boolean }).ok) falla(`generarTarifario(${p})`, g); }

const existentes = Number(sql("select count(*) from public.ventas where cliente ilike '%Ejemplo 125%'"));
if (existentes > 0) { console.log("== los ejemplos de #125 ya existen: no se duplican"); process.exit(0); }

paso("E1) contrato «PRE BF ACTIVO»: crearCotizacion → convertirCotizacion (2 adultos + 1 niño de 8 años)");
const e1 = await crearCotizacion(reserva(912503, "2026-12-04", "2026-12-09", [8], { nombres: "Elena", apellidos: "Ejemplo 125 PRE BF", numeroDoc: "125000001", email: "elena.125@ejemplo.test" }) as never) as { ok: boolean; id?: number; error?: string };
if (!e1.ok) falla("crearCotizacion E1", e1);
const c1 = await convertirCotizacion(e1.id!, pasajeros([8], "2026-12-04") as never, false, "Rev Venta", null, null, null) as { ok: boolean; numero?: string; numeros?: string[]; error?: string };
if (!c1.ok) falla("convertirCotizacion E1", c1);
console.log(`   E1 → cotización ${e1.id} · contrato ${c1.numero ?? (c1.numeros ?? []).join(",")}`);

paso("E2) contrato «noches sucesivas» (R1/R2): 2 adultos + 1 niño de 8 años, dos promociones para el mismo niño");
const e2 = await crearCotizacion(reserva(912504, "2026-12-04", "2026-12-06", [8], { nombres: "Mateo", apellidos: "Ejemplo 125 sucesivas", numeroDoc: "125000002", email: "mateo.125@ejemplo.test" }) as never) as { ok: boolean; id?: number; error?: string };
if (!e2.ok) falla("crearCotizacion E2", e2);
const c2 = await convertirCotizacion(e2.id!, pasajeros([8], "2026-12-04") as never, false, "Rev Venta", null, null, null) as { ok: boolean; numero?: string; numeros?: string[]; error?: string };
if (!c2.ok) falla("convertirCotizacion E2", c2);
console.log(`   E2 → cotización ${e2.id} · contrato ${c2.numero ?? (c2.numeros ?? []).join(",")}`);

paso("E3) cotización ABIERTA «PRE BF ACTIVO» con dos niños (8 y 5 años): solo uno es gratis");
const e3 = await crearCotizacion(reserva(912503, "2026-12-04", "2026-12-09", [8, 5], { nombres: "Sofía", apellidos: "Ejemplo 125 abierta", numeroDoc: "125000003", email: "sofia.125@ejemplo.test" }) as never) as { ok: boolean; id?: number; error?: string };
if (!e3.ok) falla("crearCotizacion E3", e3);
console.log(`   E3 → cotización ${e3.id} (abierta)`);
