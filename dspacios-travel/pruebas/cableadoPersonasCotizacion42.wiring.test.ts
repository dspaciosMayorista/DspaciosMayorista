// #42 (migración 219) — cableado estático entre la migración, la librería, las acciones, la UI, los
// scripts y el workflow. No reemplaza al runner SQL/API (eso corre en GitHub Actions): detecta que
// una pieza diverja de las otras o que vuelva un patrón prohibido sin que nadie lo note.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAMPOS_PASAJERO, CAMPOS_TITULAR, FUENTES_PERSONA_219, NIVELES_CAPTURA_219, ROLES_PARTICIPANTE,
} from "../lib/personas/fuentes.ts";

const raiz = new URL("../", import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, raiz), "utf8").replace(/\r\n/g, "\n");
const migracion = leer("supabase/migrations/20260601000219_personas_cotizaciones.sql");
const sql = migracion.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const checkout = leer("app/tarifario/checkout/actions.ts");
const checkoutPage = leer("app/tarifario/checkout/page.tsx");
const fichaPage = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
const titularEditor = leer("app/(dashboard)/dashboard/cotizaciones/[id]/TitularEditor.tsx");
const consulta = leer("lib/personas/consulta.ts");
const tipos = leer("types/database.ts");
const runner = leer("supabase/scripts/test_219_personas_cotizaciones.sh");
const workflow = readFileSync(new URL("../../.github/workflows/test-personas-cotizaciones-42.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Cuerpo de una función exportada o local (desde su firma hasta el inicio de la siguiente función de nivel superior). */
function cuerpo(src: string, nombre: string): string {
  const re = new RegExp(`\\n(export )?async function ${nombre}\\(`);
  const m = re.exec(src);
  assert.ok(m, `no está la función ${nombre}`);
  const desde = m.index + 1;
  const siguiente = src.slice(desde + 10).search(/\n(export )?(async )?function |\nexport (type|const) |\n\/\/ ═+/);
  return siguiente < 0 ? src.slice(desde) : src.slice(desde, desde + 10 + siguiente);
}
function listaIn(fragmento: string, columna: string): string[] {
  const m = fragmento.match(new RegExp(`${columna} in \\(([^)]*)\\)`));
  assert.ok(m, `no se encontró "${columna} in (...)"`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}
function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

describe("catálogos: TS y CHECK de la 219 son los mismos", () => {
  test("fuentes y niveles de persona_capturas (N2: pasajero_cotizacion)", () => {
    assert.deepEqual(listaIn(sql.slice(sql.indexOf("add constraint persona_capturas_fuente_check")), "check \\(fuente"), [...FUENTES_PERSONA_219]);
    assert.deepEqual(listaIn(sql.slice(sql.indexOf("add constraint persona_capturas_nivel_check")), "check \\(nivel"), [...NIVELES_CAPTURA_219]);
  });
  test("roles del puesto", () => {
    assert.deepEqual(listaIn(sql.slice(sql.indexOf("create table if not exists public.cotizacion_participantes")), "check \\(rol"), [...ROLES_PARTICIPANTE]);
  });
  test("campos por puesto (C1) iguales en la fachada y en el módulo", () => {
    const f = sql.slice(sql.indexOf("function p214_priv.validar_campos_participante"));
    const tit = f.match(/when 'titular' then array\[([^\]]*)\]/);
    const pas = f.match(/when 'pasajero' then array\[([^\]]*)\]/);
    assert.ok(tit && pas);
    const lista = (s: string) => s.split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
    assert.deepEqual(lista(tit[1]), [...CAMPOS_TITULAR]);
    assert.deepEqual(lista(pas[1]), [...CAMPOS_PASAJERO]);
  });
});

describe("migración 219: lo que el contrato exige y lo que prohíbe", () => {
  test("no redefine la creación manual de #39 ni toca 216/217, la 198 o la frontera", () => {
    for (const prohibido of ["function public.crear_cotizacion_manual", "p39_priv.", "convertir_cotizacion_a_contrato",
                             "trg_cot_frontera_39", "on public.cotizaciones\n  for each"]) {
      assert.ok(!sql.includes(prohibido), `la 219 contiene ${prohibido}`);
    }
    assert.ok(!/create (or replace )?trigger[^;]*on public\.cotizaciones/i.test(sql), "la 219 no crea disparadores en cotizaciones");
  });
  test("ningún trg_auditoria en la tabla de vínculo y nadie llama a promover_persona", () => {
    assert.ok(!/create trigger trg_auditoria|fn_auditoria/i.test(sql));
    // promover_persona solo aparece en el GRANT que la 214 ya tenía (se conserva); nadie la invoca.
    assert.ok(!/(select|perform|from)[^;]*promover_persona\(/i.test(sql));
    assert.equal((sql.match(/promover_persona\(/g) ?? []).length, 1);
  });
  test("las tres fachadas: SECURITY DEFINER, search_path fijo y EXECUTE solo service_role", () => {
    for (const f of ["registrar_personas_cotizacion", "actualizar_titular_cotizacion", "sellar_creador_cotizacion"]) {
      assert.ok(new RegExp(`function public\\.${f}\\([\\s\\S]*?security definer\\s*\\nset search_path = pg_catalog, pg_temp`).test(sql), f);
      assert.ok(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s*\\n\\s*from public, anon, authenticated, service_role;`).test(sql), `revoke ${f}`);
    }
    assert.ok(/grant execute on function\s*\n\s*public\.registrar_personas_cotizacion\(bigint, uuid, jsonb\),\s*\n\s*public\.actualizar_titular_cotizacion\(bigint, uuid, jsonb, integer, uuid\),\s*\n\s*public\.sellar_creador_cotizacion\(bigint, uuid\)\s*\n\s*to service_role;/.test(sql));
  });
  test("la lista del CRM es para authenticated y su actor sale de auth.uid()", () => {
    assert.ok(sql.includes("grant execute on function public.crm_personas_cotizacion_buscar(text, text, integer, integer) to authenticated;"));
    assert.ok(/function public\.crm_personas_cotizacion_buscar[\s\S]*?v_uid := auth\.uid\(\);/.test(sql));
  });
  test("UN solo filtro de visibilidad: la consulta 214 y la lista usan p214_priv.captura_visible", () => {
    const usos = sql.match(/p214_priv\.captura_visible\(c\.id, c\.tenant, c\.fuente, c\.nivel, c\.contrato_numero, c\.cotizacion_id,/g) ?? [];
    assert.equal(usos.length, 2);
    assert.ok(sql.includes("drop function if exists p214_priv.captura_visible(text, text, text, text, text);"));
  });
  test("la consulta 214 sigue cerrada a B2B (solo los 5 roles internos)", () => {
    const b = sql.slice(sql.indexOf("create or replace function public.buscar_personas_documento"));
    assert.deepEqual(listaIn(b, "v_rol not"), ["superadmin", "gerencia", "administracion", "operaciones", "venta"]);
  });
  test("escritores generalizados por DROP + CREATE (sin dos firmas que se vuelvan ambiguas)", () => {
    for (const f of ["validar_entrada_captura(uuid, text, text, text, text, text, bigint)",
                     "captura_coincide(uuid, uuid, text, text, text, text, text, text, bigint, jsonb)",
                     "upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text)"]) {
      assert.ok(sql.includes(`drop function if exists p214_priv.${f};`), f);
    }
  });
  test("la fuente cotizacion no entra directo por la API: upsert_persona la rechaza fuera de las fachadas", () => {
    assert.ok(/if current_user in \('anon', 'authenticated', 'service_role'\) then\s*\n\s*raise exception 'fuente_solo_por_fachada'/.test(sql));
  });
  test("primer candado = la cotización (mismo orden que pagos y conversión)", () => {
    for (const f of ["registrar_personas_cotizacion", "actualizar_titular_cotizacion", "sellar_creador_cotizacion"]) {
      const c = sql.slice(sql.indexOf(`function public.${f}`));
      const primerFor = c.indexOf("for update");
      assert.ok(primerFor > 0 && c.slice(0, primerFor).includes("from public.cotizaciones c"), `${f}: el primer FOR UPDATE no es sobre cotizaciones`);
    }
  });
});

describe("acciones: C2 y C7", () => {
  const altas: [string, string, string][] = [
    ["reservar/actions.ts", reservar, "crearCotizacion"],
    ["manual-actions.ts", manual, "crearCotizacionManual"],
    ["manual-actions.ts", manual, "crearComparativaManual"],
    ["manual-actions.ts", manual, "resolverSolicitudComparativa"],
    ["checkout/actions.ts", checkout, "crearCotizacionCarrito"],
    ["checkout/actions.ts", checkout, "crearComparativaCarrito"],
    ["checkout/actions.ts", checkout, "elegirOpcionComparativa"],
  ];
  test("cada alta de C2 llama a la fachada y NO ignora su resultado", () => {
    for (const [archivo, src, fn] of altas) {
      const c = cuerpo(src, fn);
      assert.ok(c.includes("altaPersonasCotizacion("), `${archivo} ${fn} no registra personas`);
      assert.ok(/if \(!alta\.ok\)/.test(c), `${archivo} ${fn} ignora el resultado de la fachada`);
      assert.ok(c.includes("logPersonasCotizacion("), `${archivo} ${fn} no deja log sin PII`);
    }
  });
  test("Reservar asigna los refs ANTES del insert y persiste ESE objeto", () => {
    const c = cuerpo(reservar, "crearCotizacion");
    const ref = c.indexOf("asignarRefsPasajeros(");
    const ins = c.indexOf('.from("cotizaciones").insert(');
    assert.ok(ref > 0 && ins > ref, "los refs deben asignarse antes del insert");
    assert.ok(c.includes("payload: inputPersistido as unknown as Json"));
    assert.ok(/fila: \{ id: row\.id, tenant: tenantCotizacion, tipo: "tarifario", payload: inputPersistido/.test(c), "el alta se arma desde lo persistido");
  });
  test("sello nuevo SOLO en Reservar y checkout (la manual usa el de #39)", () => {
    assert.ok(/sellar: true/.test(cuerpo(reservar, "crearCotizacion")));
    assert.ok(/sellar: true/.test(cuerpo(checkout, "crearCotizacionCarrito")));
    for (const fn of ["crearCotizacionManual", "crearComparativaManual", "resolverSolicitudComparativa"]) {
      assert.ok(!/sellar: true/.test(cuerpo(manual, fn)), fn);
    }
  });
  test("el editor de titular ya no hace UPDATE directo: va por la fachada", () => {
    const c = cuerpo(manual, "actualizarTitularCotizacionManual");
    assert.ok(!c.includes(".update("), "UPDATE directo de cotizaciones en el editor");
    const rpc = c.indexOf('admin.rpc("actualizar_titular_cotizacion"');
    assert.ok(rpc > 0, "el editor no llama a la fachada");
    assert.ok(c.search(/autorizaTenant\(ctx, cot\.tenant\)/) < rpc, "escribe antes de validar el tenant");
    assert.ok(c.includes("mensajePersonas(codigoErrorPersonas(error?.message))"), "errores sin traducir");
    assert.ok(!c.includes('|| "CC"') && !c.includes("|| 'CC'"), "reapareció el CC por defecto");
  });
  test("ningún 'CC' supuesto en el titular de la ficha ni del editor", () => {
    assert.ok(!/tipoDoc: payload\.cliente\?\.tipoDoc \?\? "CC"/.test(fichaPage.slice(fichaPage.indexOf("<TitularEditor"))));
    assert.ok(!/useState[^\n]*"CC"/.test(titularEditor));
  });
  test("checkout: el tipo sale de la entrada cruda validada contra el catálogo, nunca del CC forzado", () => {
    for (const fn of ["crearSolicitudReserva", "crearComparativaCarrito"]) {
      const c = cuerpo(checkout, fn);
      assert.ok(c.includes("tipoDocCheckout(inputRaw, TIPOS_DOC_PERSONA)"), fn);
    }
    const carrito = cuerpo(checkout, "crearCotizacionCarrito");
    assert.ok(/fila: \{ id: row\.id, tenant: "mayorista", tipo: "carrito", payload: filaCotizacion\.payload/.test(carrito),
      "el alta del carrito se arma desde el payload persistido (cliente real), no desde el ReservaInput con CC forzado");
    assert.ok(checkoutPage.includes("TIPOS_DOC_PERSONA.map"), "el formulario pide el tipo");
  });
  test("solo lib/personas/consulta.ts llama a las RPC de la 219 (y el editor de titular a la suya)", () => {
    // Lista blanca explícita: cualquier otro archivo que llame a una fachada hace fallar esta prueba.
    const permitidos: Record<string, string[]> = {
      registrar_personas_cotizacion: ["lib/personas/consulta.ts"],
      sellar_creador_cotizacion: ["lib/personas/consulta.ts"],
      crm_personas_cotizacion_buscar: ["lib/personas/consulta.ts"],
      actualizar_titular_cotizacion: ["app/(dashboard)/dashboard/cotizaciones/manual-actions.ts"],
    };
    const raizApp = fileURLToPath(raiz);
    let encontrados = 0;
    for (const dir of ["app", "lib", "components"]) {
      for (const f of archivos(join(raizApp, dir))) {
        const s = readFileSync(f, "utf8");
        for (const r of Object.keys(permitidos)) {
          if (s.includes(`rpc("${r}"`) || s.includes(`rpc('${r}'`)) {
            const rel = f.replace(/\\/g, "/");
            assert.ok(permitidos[r].some((p) => rel.endsWith(p)), `${f} llama a ${r}`);
            encontrados++;
          }
        }
      }
    }
    assert.equal(encontrados, 4, "cada RPC de la 219 tiene exactamente su llamador permitido");
  });
  test("consulta.ts sigue sin leer tablas", () => {
    assert.ok(!consulta.includes(".from("));
  });
  test("la ficha lee los puestos con service-role SOLO después de comprobar el tenant", () => {
    const tenant = fichaPage.indexOf("if (!autorizaTenant(ctxAcceso, c.tenant)) notFound();");
    const lectura = fichaPage.indexOf('.from("cotizacion_participantes")');
    assert.ok(tenant > 0 && lectura > tenant);
    assert.ok(/async function reintentarPersonas\(\)[\s\S]*?"use server";[\s\S]*?autorizaTenant\(await contextoCotizacion\(\), cot\.tenant\)/.test(fichaPage),
      "Reintentar vuelve a autenticar y comprobar el tenant");
  });
});

describe("tipos, scripts y workflow", () => {
  test("types/database.ts: las cuatro RPC y la tabla de vínculo sin Insert/Update para la app", () => {
    for (const f of ["registrar_personas_cotizacion: {", "actualizar_titular_cotizacion: {", "sellar_creador_cotizacion: {", "crm_personas_cotizacion_buscar: {"]) {
      assert.ok(tipos.includes(f), f);
    }
    const t = tipos.slice(tipos.indexOf("cotizacion_participantes: {"));
    assert.ok(/Insert: never;\s*\n\s*Update: never;/.test(t.slice(0, 900)));
  });
  test("scripts de la reserva presentes", () => {
    for (const s of ["preflight", "postcheck", "rollback"]) {
      assert.ok(existsSync(new URL(`supabase/scripts/${s}_219_personas_cotizaciones.sql`, raiz)), s);
    }
    assert.ok(existsSync(new URL("supabase/scripts/test_219_personas_cotizaciones.sql", raiz)));
  });
  test("workflow endurecido: pull_request, solo lectura, sin secretos ni Supabase remoto, limpieza always()", () => {
    assert.ok(/\non:\n  pull_request:/.test(workflow));
    assert.ok(!/\n {2}pull_request_target:/.test(workflow));
    assert.ok(/\npermissions:\n  contents: read\n/.test(workflow));
    assert.ok(!/secrets\./.test(workflow));
    assert.ok(!/supabase\.co|SUPABASE_URL|SERVICE_ROLE_KEY/.test(workflow));
    assert.equal((workflow.match(/if: always\(\)/g) ?? []).length, 2);
  });
  test("cada marca exigida por el workflow la emite el runner", () => {
    const marcas = [...workflow.matchAll(/'OK {4}([A-Z]+[0-9]+[a-z]?) '/g)].map((m) => m[1]);
    assert.ok(marcas.length >= 25);
    for (const m of marcas) assert.ok(runner.includes(`ok "${m} `) || runner.includes(`f_rechaza "${m} `), `el runner no emite ${m}`);
    const sqlPrueba = leer("supabase/scripts/test_219_personas_cotizaciones.sql");
    const marcasSql = [...workflow.matchAll(/'  OK {4}([A-Z]+[0-9]+[a-z]?) '/g)].map((m) => m[1]);
    assert.ok(marcasSql.length >= 5);
    for (const m of marcasSql) assert.ok(sqlPrueba.includes(`afirma('${m} `), `la prueba SQL no afirma ${m}`);
  });
});
