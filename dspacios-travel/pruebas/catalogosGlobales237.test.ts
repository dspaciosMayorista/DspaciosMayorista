import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  codigoDeErrorContexto,
  mensajeCatalogoDenegado,
  sessionIdDeAccessToken,
} from "../lib/auth/sesionJwt.ts";

// #5 D8/D9 (migración 237). Parte pura y cableado estático de la capa de aplicación.
// La frontera real (RLS/RPC con sesiones de Auth) la prueba
// supabase/scripts/pruebas_237/harness.mjs contra un Supabase local.

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (payload: unknown) => `${b64({ alg: "HS256" })}.${b64(payload)}.firma`;
const SID = "0f3c2b1a-9d8e-4c7b-a6f5-123456789abc";

test("sessionIdDeAccessToken: extrae el claim session_id válido", () => {
  assert.equal(sessionIdDeAccessToken(token({ session_id: SID, sub: "x" })), SID);
  assert.equal(sessionIdDeAccessToken(token({ session_id: SID.toUpperCase() })), SID);
});

test("sessionIdDeAccessToken: falla cerrado ante token ausente, malformado o sin claim UUID", () => {
  for (const t of [null, undefined, "", "a.b", "a.b.c.d", token({}), token({ session_id: 7 }),
    token({ session_id: "no-es-uuid" }), token({ session_id: `${SID}; drop table` }), "x.%%%.y"]) {
    assert.equal(sessionIdDeAccessToken(t as string | null), null, String(t));
  }
});

test("codigoDeErrorContexto: solo reconoce los códigos de las RPC; lo demás es 'error'", () => {
  assert.equal(codigoDeErrorContexto(null), "ok");
  for (const c of ["ya_iniciada", "sesion_inexistente", "usuario_inactivo", "agencia_no_permitida",
    "agencia_invalida", "fuera_de_ventana", "sin_contexto"]) {
    assert.equal(codigoDeErrorContexto({ message: c }), c);
  }
  assert.equal(codigoDeErrorContexto({ message: "permission denied for table x" }), "error");
  assert.equal(codigoDeErrorContexto({}), "error");
});

test("mensajeCatalogoDenegado: distingue Minorista de sesión desincronizada", () => {
  assert.match(mensajeCatalogoDenegado({ agenciaActivaCookie: "minorista", sincronizado: true }), /Cambia a Mayorista/);
  assert.match(mensajeCatalogoDenegado({ agenciaActivaCookie: "mayorista", sincronizado: false }), /Cierra sesión/);
  assert.match(mensajeCatalogoDenegado({ agenciaActivaCookie: "mayorista", sincronizado: true }), /solo se editan desde la agencia Mayorista/);
});

// ── Cableado ────────────────────────────────────────────────────────────────
const CATALOGOS: Record<string, string[]> = {
  "app/(dashboard)/dashboard/aliados/actions.ts": ["crearAliado", "actualizarAliado", "eliminarAliado"],
  "app/(dashboard)/dashboard/producto/proveedores/actions.ts": ["crearProveedor", "actualizarProveedor", "eliminarProveedor"],
  "app/(dashboard)/dashboard/producto/aerolineas/actions.ts": ["crearAerolinea", "eliminarAerolinea", "actualizarAerolinea", "crearTarifaAerolinea", "eliminarTarifaAerolinea"],
  "app/(dashboard)/dashboard/configuracion/actions.ts": ["crearRangoEdad", "eliminarRangoEdad", "crearAsesor", "actualizarAsesor", "eliminarAsesor", "crearFormaPago", "eliminarFormaPago", "actualizarParametro"],
  "app/(dashboard)/dashboard/producto/servicios/actions.ts": ["crearTemporadaServicio", "actualizarTemporadaServicio", "eliminarTemporadaServicio", "actualizarFotoServicio", "crearServicio", "actualizarServicio", "eliminarServicio"],
};

test("Server Actions de catálogos globales consultan la compuerta de la base antes de escribir", () => {
  for (const [rel, nombres] of Object.entries(CATALOGOS)) {
    const src = leer(rel);
    assert.match(src, /exigirEscrituraCatalogoGlobal/, rel);
    for (const n of nombres) {
      const i = src.indexOf(`export async function ${n}(`);
      assert.ok(i >= 0, `${rel}: falta ${n}`);
      const cuerpo = src.slice(i, i + 900);
      const compuerta = cuerpo.indexOf("exigirEscrituraCatalogoGlobal()");
      assert.ok(compuerta > 0, `${n}: sin compuerta`);
      // La compuerta va antes de cualquier acceso a datos.
      const dato = cuerpo.search(/\.from\(|\.rpc\(|createClient\(\)/);
      assert.ok(dato < 0 || compuerta < dato, `${n}: la compuerta debe ir antes de tocar datos`);
    }
  }
});

test("la compuerta consulta la base (RPC), no la cookie, y falla cerrado", () => {
  const src = leer("lib/auth/contextoAgencia.ts");
  assert.match(src, /rpc\("puede_escribir_catalogo_global"\)/);
  assert.match(src, /!error && data === true/);
  // Caminos a ok:true: la respuesta afirmativa de la base, o la función AÚN no desplegada
  // (solo PGRST202/42883: código desplegado antes que la 237). Cualquier otro error falla cerrado.
  assert.equal((src.match(/return \{ ok: true \}/g) ?? []).length, 2);
  assert.match(src, /FUNCION_AUSENTE = new Set\(\["PGRST202", "42883"\]\)/);
});

test("el contexto solo se crea al autenticar: login, OAuth y atajo por código", () => {
  assert.match(leer("app/(auth)/login/LoginClient.tsx"), /iniciarContextoSesion\(\)/);
  assert.match(leer("app/(auth)/login/actions.ts"), /iniciarContextoAgencia\(\)/);
  assert.match(leer("app/auth/callback/route.ts"), /iniciarContextoAgencia\(\)/);
  // La acción expuesta al navegador no recibe argumentos: no hay identidad que el cliente declare.
  assert.match(leer("app/(auth)/login/contexto-actions.ts"), /iniciarContextoSesion\(\): Promise<\{ ok: boolean \}>/);
});

test("cambiar de agencia mueve primero el contexto de la sesión", () => {
  const src = leer("app/(dashboard)/tenant-actions.ts");
  assert.match(src, /cambiarContextoAgencia\(t\)/);
  assert.ok(src.indexOf("cambiarContextoAgencia(t)") < src.indexOf("cookies()).set"));
});

test("las RPC de contexto no se exponen a la sesión del usuario en el código", () => {
  const src = leer("lib/auth/contextoAgencia.ts");
  // Solo el cliente service-role las invoca; el cliente de sesión jamás.
  assert.equal((src.match(/createAdminClient\(\)\.rpc\("(iniciar|cambiar)_contexto_agencia"/g) ?? []).length, 2);
  assert.doesNotMatch(src, /sb\.rpc\("(iniciar|cambiar)_contexto_agencia"/);
  assert.match(src, /^import "server-only";/);
});

test("la migración 237 registra los catálogos D9 y las cuatro funciones definer guardadas", () => {
  const sql = leer("supabase/migrations/20260601000237_catalogos_globales_frontera_mayorista.sql");
  for (const t of ["aliados", "asesores", "formas_pago", "rangos_edad", "parametros_tributarios"]) {
    assert.match(sql, new RegExp(`'${t}'`), t);
  }
  assert.equal((sql.match(/create or replace function public\.(fn_fusionar_destino|generar_tarifas_hotel_calculadora|reemplazar_tarifas_hotel_calculadora|aprobar_solicitud_b2b)/gi) ?? []).length, 4);
  assert.match(sql, /as restrictive for insert/);
  assert.match(sql, /as restrictive for update/);
  assert.match(sql, /as restrictive for delete/);
});
