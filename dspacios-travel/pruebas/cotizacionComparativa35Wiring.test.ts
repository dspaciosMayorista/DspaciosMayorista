// #35 — Cableado e invariantes de seguridad de las comparativas (lectura de código).
// Estas pruebas no ejecutan nada: fijan reglas que NO deben romperse al tocar el código.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (t: string) => t.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const MIGRACION = leer("supabase/migrations/20260601000211_cotizaciones_comparativas.sql");
// Código SQL sin comentarios (los comentarios explican qué NO se hace y mencionan esas palabras).
const SQL = MIGRACION.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

function cuerpoFuncionSql(nombre: string): string {
  const i = SQL.search(new RegExp(`create or replace function ${nombre.replace(".", "\\.")}\\(`));
  assert.notEqual(i, -1, `no se encontró ${nombre}`);
  const fin = SQL.indexOf("\n$$;", i);
  return SQL.slice(i, fin);
}

describe("migración 211 — no toca lo que el dueño dejó intacto", () => {
  test("no redefine el RPC 198 ni registrar_pago_previo ni la 206/208", () => {
    for (const f of ["convertir_cotizacion_a_contrato", "registrar_pago_previo", "anular_pago_previo", "transferir_pagos_previos_a_abonos",
      "aplicar_neto_contrato_manual", "facturar_factura", "quitar_factura", "postear_asiento_abono", "registrar_financiero_contrato"]) {
      assert.doesNotMatch(SQL, new RegExp(`create (or replace )?function (public\\.)?${f}\\b`, "i"), `la 211 no puede redefinir ${f}`);
    }
    assert.doesNotMatch(SQL, /alter function (public\.)?(convertir_cotizacion_a_contrato|registrar_pago_previo)/i);
  });
  test("no edita migraciones aplicadas: es un archivo nuevo y único con el número 211", () => {
    const f = readdirSync(join(RAIZ, "supabase/migrations")).filter((n) => n.startsWith("20260601000211_"));
    assert.deepEqual(f, ["20260601000211_cotizaciones_comparativas.sql"]);
  });
  test("NO existe un estado «elegida»: ni en CHECK, ni en funciones, ni en la app", () => {
    assert.doesNotMatch(SQL, /estado\s*(=|<>|!=|in\s*\()[^;)]*'elegida'/i, "ningún CHECK, comparación ni asignación de estado usa 'elegida'");
    assert.doesNotMatch(SQL, /set estado = 'elegida'/i);
    assert.match(SQL, /tipo in\s*\(\s*'creada','elegida'/, "'elegida' solo existe como TIPO DE EVENTO del historial");
    assert.match(SQL, /estado in \('abierta','descartada'\)/, "la madre solo conserva los estados existentes");
    for (const rel of ["lib/cotizacion/comparativa.ts", "lib/cotizacion/comparativaDocumento.tsx", "lib/cotizacion/comparativaAcciones.tsx", "app/tarifario/checkout/actions.ts"]) {
      assert.doesNotMatch(leer(rel), /estado\s*[:=]+\s*["']elegida["']/, rel);
    }
  });
});

describe("migración 211 — sin variables de sesión que falsificar", () => {
  test("ningún código SQL lee ni escribe variables de sesión", () => {
    assert.doesNotMatch(SQL, /current_setting\s*\(/i);
    assert.doesNotMatch(SQL, /set_config\s*\(/i);
    assert.doesNotMatch(SQL, /app\.(comparativa|factura|posteo)/i);
  });
  test("las excepciones de los triggers se deciden por current_user (no suplantable por un authenticated)", () => {
    assert.match(SQL, /current_user in \('authenticated', 'anon', 'service_role'\)/);
    assert.match(SQL, /current_user not in \('authenticated', 'anon', 'service_role'\)/);
  });
  test("las 7 RPC son SECURITY DEFINER con search_path fijo", () => {
    for (const f of ["crear_cotizacion_comparativa", "registrar_validacion_comparativa", "elegir_opcion_comparativa_sesion", "elegir_opcion_comparativa_publica",
      "registrar_solicitud_comparativa", "resolver_solicitud_comparativa", "comparativas_b2b_visibles"]) {
      const c = cuerpoFuncionSql(`public.${f}`);
      assert.match(c, /security definer/i, f);
      assert.match(c, /set search_path = public, pg_temp/i, f);
    }
  });
  test("los triggers son SECURITY INVOKER (la identidad de quien escribe NO se pierde)", () => {
    for (const f of ["f211_priv.tg_cotizaciones_guarda", "f211_priv.tg_servicios_guarda", "f211_priv.tg_madre_sin_dinero", "f211_priv.tg_inmutable"]) {
      assert.match(cuerpoFuncionSql(f), /security invoker/i, f);
    }
  });
});

describe("migración 211 — grants y RLS explícitos en cada tabla nueva", () => {
  const TABLAS = ["cotizacion_opciones", "cotizacion_comparativa_eventos", "cotizacion_comparativa_validaciones", "cotizacion_comparativa_solicitudes"];
  test("RLS activo en las cuatro", () => {
    for (const t of TABLAS) assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security`), t);
  });
  test("se revoca todo a anon/authenticated/service_role y no se concede nada a anon", () => {
    assert.match(SQL, /revoke all on public\.cotizacion_opciones, public\.cotizacion_comparativa_eventos,[^;]*from public, anon, authenticated, service_role/);
    assert.doesNotMatch(SQL, /grant [^;]*\bto\b[^;]*\banon\b/i);
  });
  test("authenticated solo LEE (opciones, eventos, solicitudes); service_role solo LEE tablas; ninguna escritura directa", () => {
    assert.match(SQL, /grant select on public\.cotizacion_opciones, public\.cotizacion_comparativa_eventos,\s*public\.cotizacion_comparativa_solicitudes to authenticated;/);
    assert.doesNotMatch(SQL, /grant (insert|update|delete|all)[^;]*\bon\b[^;]*(cotizacion_opciones|cotizacion_comparativa_)/i);
  });
  test("recibos: sin policy y sin grant de lectura para nadie salvo service_role", () => {
    assert.doesNotMatch(SQL, /create policy [^;]*cotizacion_comparativa_validaciones/i);
    assert.doesNotMatch(SQL, /grant select on[^;]*cotizacion_comparativa_validaciones[^;]*to authenticated/i);
  });
  test("las policies de lectura exigen rol interno Y tenant, explícitamente", () => {
    const pol = SQL.match(/create policy "comparativa_[^;]+;/g) ?? [];
    assert.equal(pol.length, 3);
    for (const p of pol) {
      assert.match(p, /mi_rol\(\) in \('superadmin','gerencia','administracion','operaciones','venta'\)/);
      assert.match(p, /puede_ver_tenant_cotizacion\(tenant\)/);
      assert.doesNotMatch(p, /puede_ver_cotizacion\(/, "no hereda: la policy es autosuficiente");
    }
  });
  test("RPC de dinero y de escritura: solo service_role; con sesión: authenticated; nunca public/anon", () => {
    assert.match(SQL, /revoke all on function public\.crear_cotizacion_comparativa\([^)]*\) from public, anon, authenticated;/);
    assert.match(SQL, /grant execute on function public\.crear_cotizacion_comparativa\([^)]*\) to service_role;/);
    assert.match(SQL, /grant execute on function public\.elegir_opcion_comparativa_publica\(uuid, text\) to service_role;/);
    assert.match(SQL, /grant execute on function public\.elegir_opcion_comparativa_sesion\(uuid, text\) to authenticated;/);
    for (const f of ["elegir_opcion_comparativa_sesion\\(uuid, text\\)", "resolver_solicitud_comparativa\\(bigint, text, text, text\\)", "comparativas_b2b_visibles\\(\\)"]) {
      assert.match(SQL, new RegExp(`revoke all on function public\\.${f} from public, anon, authenticated, service_role;`), `${f}: service_role no habla por un usuario`);
    }
    assert.match(SQL, /grant execute on function public\.comparativas_b2b_visibles\(\) to authenticated;/);
    assert.match(SQL, /revoke all on all functions in schema f211_priv from public, anon, authenticated, service_role;/);
  });
  test("la identidad de las RPC con sesión sale de auth.uid(), sin parámetro de usuario", () => {
    assert.match(cuerpoFuncionSql("public.elegir_opcion_comparativa_sesion"), /auth\.uid\(\)/);
    assert.match(cuerpoFuncionSql("public.resolver_solicitud_comparativa"), /auth\.uid\(\)/);
    assert.match(cuerpoFuncionSql("public.comparativas_b2b_visibles"), /auth\.uid\(\)/);
    assert.match(SQL, /function public\.comparativas_b2b_visibles\(\)/, "el listado no recibe ningún usuario");
    assert.doesNotMatch(SQL, /p_actor\b|p_actor jsonb/i, "no existe p_actor: ninguna identidad llega como dato");
  });
  test("la propiedad B2B nunca se decide por nombre, email ni creado_por", () => {
    for (const f of ["f211_priv.b2b_propietario", "public.comparativas_b2b_visibles"]) {
      const c = cuerpoFuncionSql(f);
      assert.doesNotMatch(c, /creado_por\b(?!_id)/i, f);
      assert.doesNotMatch(c, /\bemail\b|\bnombre\b|lower\(/i, f);
    }
  });
});

describe("app — la madre no se cobra ni se convierte (guardas de código además de los triggers)", () => {
  test("registrarPagoPrevio rechaza la comparativa ANTES de armar el snapshot (que trataría NULL como cero)", () => {
    const f = leer("app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
    const iGuarda = f.indexOf('cot.modo === "comparativa"');
    const iSnapshot = f.indexOf("construirSnapshot(");
    assert.ok(iGuarda > 0 && iSnapshot > 0 && iGuarda < iSnapshot);
    assert.ok(f.indexOf('cot.modo === "comparativa"') < f.indexOf("Number(cot.precio_venta)"));
  });
  test("convertirCotizacion, convertirCotizacionManualAContrato y la ficha no ofrecen convertir la madre", () => {
    assert.match(leer("app/(dashboard)/dashboard/reservar/actions.ts"), /cot\.modo === "comparativa"[^;]*\n?[^;]*no se convierte en contrato/);
    assert.match(leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts"), /madre\?\.modo === "comparativa"/);
    const ficha = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.ok(ficha.indexOf('c.modo === "comparativa"') > 0 && ficha.indexOf('c.modo === "comparativa"') < ficha.indexOf("<ConvertirManualBtn"));
  });
  test("nada de la UI/acciones de comparativa llama a los RPC de dinero", () => {
    for (const rel of ["lib/cotizacion/comparativa.ts", "lib/cotizacion/comparativaAcciones.tsx", "lib/cotizacion/comparativaDocumento.tsx",
      "lib/cotizacion/comparativaCheckout.tsx", "lib/cotizacion/comparativaBooking.tsx", "lib/cotizacion/comparativaServidor.ts"]) {
      assert.doesNotMatch(leer(rel), /registrar_pago_previo|convertir_cotizacion_a_contrato|transferir_pagos_previos|aplicar_neto_contrato_manual|facturar_factura/, rel);
    }
  });
});

describe("app — el token público solo lee", () => {
  test("/cot/[token] sigue resolviendo solo por share_token y su única adición es UNA llamada", () => {
    const p = leer("app/cot/[token]/page.tsx");
    assert.match(p, /await paginaPublicaComparativa\(token\)/);
    assert.doesNotMatch(p, /\.eq\("id",/);
    assert.equal([...sinComentarios(p).matchAll(/\.eq\("share_token", token\)/g)].length, 2);
    assert.doesNotMatch(p, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  });
  test("paginaPublicaComparativa resuelve por share_token y no escribe nada", () => {
    const d = leer("lib/cotizacion/comparativaDocumento.tsx");
    const i = d.indexOf("export async function paginaPublicaComparativa");
    const fn = d.slice(i);
    assert.match(fn, /\.eq\("share_token", token\)/);
    assert.doesNotMatch(fn, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
    assert.doesNotMatch(d, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/, "el documento es de solo lectura");
  });
  test("resumenOpcionComparativa (lectura pública) no escribe", () => {
    const a = leer("app/tarifario/checkout/actions.ts");
    const fn = a.slice(a.indexOf("export async function resumenOpcionComparativa"));
    assert.doesNotMatch(fn, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  });
  test("el cliente de «solicitud» solo llama a la acción de solicitud; elegir en el enlace público pasa por el checkout", () => {
    const c = leer("lib/cotizacion/comparativaAcciones.tsx");
    assert.match(c, /Link href=\{`\/tarifario\/checkout\?comparativa=/);
    assert.match(c, /modo === "checkout" && !deshabilitada && token/);
  });
});

describe("app — la identidad nunca viene del cuerpo", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const seccion = checkout.slice(checkout.indexOf("// #35 · COTIZACIONES COMPARATIVAS del tarifario"));
  test("las acciones de comparativa leen el actor de la sesión y no de inputRaw", () => {
    assert.match(seccion, /async function actorComparativa\(\)/);
    assert.match(seccion, /auth\.getUser\(\)/);
    assert.doesNotMatch(seccion, /inputRaw\.(userId|actor|canal|tenant|aliadoId|usuario)/);
    assert.doesNotMatch(seccion, /\b(d|input)\.(userId|canal|tenant|aliadoId)\b/);
  });
  test("ambas acciones públicas resuelven la comparativa por el token del enlace, jamás por un id del cuerpo", () => {
    assert.match(seccion, /\.eq\("share_token", d\.token\)/);
    assert.doesNotMatch(sinComentarios(seccion), /d\.madreId|\.eq\("id", d\./);
    const solicitar = seccion.slice(seccion.indexOf("export async function solicitarOpcionComparativa"), seccion.indexOf("export type ResumenOpcionComparativa"));
    assert.ok(solicitar.indexOf('.eq("share_token", d.token)') > 0 && solicitar.indexOf('.eq("share_token", d.token)') < solicitar.indexOf('rpc("registrar_solicitud_comparativa"'));
  });
  test("el cambio de precio no ofrece «confirmar»: la comparativa es inmutable", () => {
    assert.doesNotMatch(sinComentarios(seccion), /confirma de nuevo/i);
    assert.match(seccion, /reintentable: false/);
    assert.doesNotMatch(leer("lib/cotizacion/comparativaCheckout.tsx"), /Confirmar con el nuevo valor/);
    assert.match(leer("lib/cotizacion/comparativaCheckout.tsx"), /Generar una comparativa nueva/);
  });
  test("el consumo con sesión usa el cliente de sesión; el público, service-role", () => {
    assert.match(seccion, /actor\.canal === "publico"\s*\n?\s*\? await admin\.rpc\("elegir_opcion_comparativa_publica"/);
    assert.match(seccion, /: await sb\.rpc\("elegir_opcion_comparativa_sesion"/);
  });
  test("la IP sale de cabeceras de plataforma y solo se guarda su huella", () => {
    assert.match(seccion, /ipOrigenConfiable\(\(n\) => h\.get\(n\), \{ enVercel: process\.env\.VERCEL === "1" \}\)/);
    assert.match(seccion, /p_ip_huella: huellaIp\(ip,/);
    assert.doesNotMatch(sinComentarios(seccion), /get\(["']x-forwarded-for["']\)|x-forwarded-for/i, "el código no lee x-forwarded-for (lo escribe el cliente)");
  });
  test("no se inserta nada directo en cotizaciones desde las acciones de comparativa", () => {
    assert.doesNotMatch(seccion, /from\("cotizaciones"\)\s*\.\s*insert/);
    assert.doesNotMatch(leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts").slice(leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts").indexOf("crearComparativaManual")), /\.insert\(/);
  });
  test("crearCotizacionCarrito conserva el insert de siempre (solo se agregó `capturar`)", () => {
    assert.match(checkout, /tenant: "mayorista"/);
    assert.match(checkout, /\.insert\(filaCotizacion\)/);
    assert.match(checkout, /if \(opts\?\.capturar\)/);
  });
});

describe("app — portal B2B y listados", () => {
  const portal = leer("app/portal/b2b/page.tsx");
  test("las comparativas del aliado salen de la RPC con la SESIÓN, no por email ni nombre", () => {
    assert.match(portal, /sb\.rpc\("comparativas_b2b_visibles"\)/);
    const bloque = portal.slice(portal.indexOf("comparativas_b2b_visibles") - 600, portal.indexOf("comparativas_b2b_visibles") + 900);
    assert.doesNotMatch(bloque, /creado_por|agencia_nombre|freelance_nombre|user\.email/);
  });
  test("el listado por email excluye las madres (precio NULL se vería como $0)", () => {
    assert.match(portal, /c\.modo !== "comparativa"/);
  });
  test("el listado interno muestra «desde» y nunca un $0 para una comparativa", () => {
    const l = leer("app/(dashboard)/dashboard/cotizaciones/page.tsx");
    assert.match(l, /c\.modo === "comparativa"/);
    assert.match(l, /desdeComparativa/);
  });
});

describe("Vista Booking y formulario manual — el flujo simple sigue siendo el predeterminado", () => {
  test("el modo comparativa nace apagado en Booking y en el formulario manual", () => {
    assert.match(leer("lib/cotizacion/comparativaBooking.tsx"), /useState\(false\)/);
    assert.match(leer("app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx"), /const \[comparativa, setComparativa\] = useState\(false\)/);
  });
  test("en modo comparativa el formulario manual no muestra un total global y exige aliado del catálogo", () => {
    const f = leer("app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx");
    assert.match(f, /\{!comparativa && \(\s*\n\s*<section[^>]*>/);
    assert.match(f, /Elige el aliado del catálogo/);
  });
  test("sin emojis en la UI nueva (lucide-react)", () => {
    for (const rel of ["lib/cotizacion/comparativaAcciones.tsx", "lib/cotizacion/comparativaDocumento.tsx", "lib/cotizacion/comparativaCheckout.tsx", "lib/cotizacion/comparativaBooking.tsx"]) {
      assert.doesNotMatch(leer(rel), /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, rel);
      assert.match(leer(rel), /from "lucide-react"/, rel);
    }
  });
});
