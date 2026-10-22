import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// Hotfix 224 — netos de `empaquetados` por rol (sin base de datos).
// Lo que el SQL hace de verdad (RLS por rol, API, rollback exacto) corre en GitHub Actions:
// .github/workflows/test-224-neto-empaquetados.yml. Aquí se prueba lo que SÍ se puede probar sin Postgres:
//   · la migración tiene la forma pedida (vista sin columnas de costo, policy sin `venta`),
//   · los roles de la migración coinciden con los de la 156 y con `lib/roles.ts` (fuente única en código),
//   · el tipo de la vista en `types/database.ts` coincide con la lista de columnas del SQL,
//   · INVENTARIO de lectores de `empaquetados` en la aplicación: ningún lector con la sesión de un rol que
//     perdió la tabla base puede seguir leyéndola (la falla que rompe la reserva de `venta`),
//   · el workflow y los scripts focales cumplen las reglas de seguridad del encargo.

const RAIZ = new URL("../", import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, RAIZ), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (sql: string) => sql.replace(/--.*$/gm, "");

const MIG = "supabase/migrations/20260601000224_neto_empaquetados_por_rol.sql";
const MIG225 = "supabase/migrations/20260601000225_neto_empaquetados_cierre.sql";
const MIG_156 = "supabase/migrations/20260601000156_empaquetados.sql";
const WF = "../.github/workflows/test-224-225-neto-empaquetados.yml";

const COLUMNAS_COSTO = ["tarifa_proveedor", "fee_infante", "tarifa_para_empaquetar", "estado_pago", "notas"];
// Roles de la policy que reemplaza a la de lectura operativa de la 156.
const ROLES_BASE = ["superadmin", "gerencia", "administracion", "operaciones", "control_vuelo"];
const ROLES_VISTA = [...ROLES_BASE, "venta"];

const roles = (texto: string) => [...texto.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

function bloque(sql: string, inicio: RegExp): string {
  const m = inicio.exec(sql);
  assert.ok(m, `no se encontró ${inicio}`);
  const desde = m.index;
  const hasta = sql.indexOf(";", desde);
  return sql.slice(desde, hasta + 1);
}

describe("migración 224 — forma", () => {
  const sql = sinComentarios(leer(MIG));

  test("es la única 224 y no toca migraciones anteriores", () => {
    const dir = new URL("supabase/migrations/", RAIZ);
    const con224 = readdirSync(dir).filter((f) => f.startsWith("20260601000224_"));
    assert.deepEqual(con224, ["20260601000224_neto_empaquetados_por_rol.sql"]);
    const alters = [...sql.matchAll(/alter table\s+(?:if exists\s+)?([a-z_.]+)/gi)].map((m) => m[1]);
    assert.deepEqual(alters, [], "la 224 no altera tablas (solo crea la vista)");
  });

  test("la 224 es ADITIVA: no crea, borra ni cambia ninguna policy (venta conserva la lectura hasta la 225)", () => {
    assert.ok(!/(create|drop|alter)\s+policy/i.test(sql), "la 224 no debe tocar policies: eso es la 225");
    assert.ok(!/revoke[^;]*on\s+(table\s+)?public\.empaquetados\s/i.test(sql), "la 224 no revoca nada de la tabla base");
  });

  test("la vista es security_barrier, no security_invoker, y filtra por mi_rol() con los 6 roles de la 156", () => {
    const v = bloque(sql, /create or replace view public\.empaquetados_basica/i);
    assert.match(v, /security_barrier\s*=\s*true/i);
    assert.match(v, /security_invoker\s*=\s*false/i);
    const donde = /where\s+public\.mi_rol\(\)\s+in\s*\(([^)]*)\)/i.exec(v);
    assert.ok(donde, "la vista debe controlar el rol en su where");
    assert.deepEqual([...roles(donde[1])].sort(), [...ROLES_VISTA].sort());
  });

  test("la vista no lista ninguna columna de costo y su lista de columnas es explícita (sin *)", () => {
    const v = bloque(sql, /create or replace view public\.empaquetados_basica/i);
    const select = /select\s+([\s\S]*?)\s+from public\.empaquetados e/i.exec(v);
    assert.ok(select, "select de la vista");
    assert.ok(!select[1].includes("*"), "la lista de columnas no puede ser *");
    const cols = select[1].split(",").map((c) => c.trim().replace(/^e\./, "")).filter(Boolean);
    assert.equal(cols.length, 21);
    for (const c of COLUMNAS_COSTO) assert.ok(!cols.includes(c), `la vista expone ${c}`);
    assert.ok(!/tarifa_proveedor|fee_infante|tarifa_para_empaquetar|estado_pago|notas/.test(v), "la definición no puede mencionar columnas de costo");
    for (const necesaria of ["id", "activo", "compra_inicio", "compra_fin", "destino_id", "record", "ruta"]) {
      assert.ok(cols.includes(necesaria), `falta ${necesaria}, que usa computarReserva o la vitrina`);
    }
  });

  test("ACL de la vista: se revoca todo y solo authenticated recibe SELECT; nada para anon", () => {
    assert.match(sql, /revoke all on public\.empaquetados_basica from public, anon, authenticated, service_role/);
    const grants = [...sql.matchAll(/grant\s+(\w+)\s+on\s+public\.empaquetados_basica\s+to\s+([^;]+);/gi)];
    assert.equal(grants.length, 1);
    assert.equal(grants[0][1].toLowerCase(), "select");
    assert.equal(grants[0][2].trim(), "authenticated");
    assert.ok(!/to\s+[^;]*\banon\b/i.test(sql.replace(/revoke[^;]*;/gi, "")), "ningún grant a anon");
  });

});

describe("migración 225 — cierre", () => {
  const sql = sinComentarios(leer(MIG225));

  test("es la única 225 y no altera tablas ni toca la vista de la 224", () => {
    const dir = new URL("supabase/migrations/", RAIZ);
    const con225 = readdirSync(dir).filter((f) => f.startsWith("20260601000225_"));
    assert.deepEqual(con225, ["20260601000225_neto_empaquetados_cierre.sql"]);
    assert.deepEqual([...sql.matchAll(/alter table\s+(?:if exists\s+)?([a-z_.]+)/gi)].map((m) => m[1]), []);
    assert.ok(!/(create|drop|alter)\s+(or replace\s+)?view/i.test(sql), "la 225 no toca la vista");
  });

  test("se NIEGA si la vista de la 224 no existe (no cierra antes de tiempo)", () => {
    assert.match(sql, /to_regclass\('public\.empaquetados_basica'\) is null/);
    assert.match(sql, /raise exception '225: falta la vista public\.empaquetados_basica/);
  });

  test("la policy de lectura de la tabla base queda sin venta y la anterior se elimina", () => {
    assert.match(sql, /drop policy if exists "empaquetados: lectura operativa" on public\.empaquetados/);
    const p = bloque(sql, /create policy "empaquetados: lectura con costos"/i);
    assert.match(p, /for select/i);
    const usando = /using\s*\(\s*public\.mi_rol\(\)\s+in\s*\(([^)]*)\)/i.exec(p);
    assert.ok(usando);
    assert.deepEqual([...roles(usando[1])].sort(), [...ROLES_BASE].sort());
    assert.ok(!roles(usando[1]).includes("venta"));
  });

  test("no hay otra policy sobre empaquetados ni sobre sus tablas hermanas (alcance acotado)", () => {
    const tablas = [...sql.matchAll(/(?:create|drop) policy[^;]*? on (public\.[a-z_]+)/gi)].map((m) => m[1]);
    assert.ok(tablas.length >= 3);
    for (const t of tablas) assert.equal(t, "public.empaquetados", `policy inesperada sobre ${t}`);
  });

  test("la 224 y la 225 dicen el orden de despliegue: 224, código, 225", () => {
    const h224 = leer(MIG);
    const h225 = leer(MIG225);
    assert.match(h224, /1\) correr la 224 · 2\) desplegar el código/);
    assert.match(h225, /DESPUÉS de la 224 Y DESPUÉS de desplegar el código/);
  });
});

describe("paridad de roles con la 156 y con lib/roles.ts", () => {
  const m156 = leer(MIG_156);

  test("la vista conserva EXACTAMENTE los 6 roles que hoy leen la tabla (nadie gana acceso nuevo)", () => {
    const lectura = bloque(m156, /create policy "empaquetados: lectura operativa"/i);
    const usando = /using\s*\(\s*public\.mi_rol\(\)\s+in\s*\(([^)]*)\)/i.exec(lectura);
    assert.ok(usando);
    assert.deepEqual([...roles(usando[1])].sort(), [...ROLES_VISTA].sort());
  });

  test("la policy nueva es la de 156 menos venta, y coincide con quien ESCRIBE empaquetados", () => {
    const esc = bloque(m156, /create policy "empaquetados: escritura control"/i);
    const usando = /using\s*\(\s*public\.mi_rol\(\)\s+in\s*\(([^)]*)\)/i.exec(esc);
    assert.ok(usando);
    assert.deepEqual([...roles(usando[1])].sort(), [...ROLES_BASE].sort(), "quien edita el neto es quien debe leerlo");
  });

  test("ESCRITURA.vuelos de lib/roles.ts (fuente única en código) = los roles de la tabla base", () => {
    const roles_ts = leer("lib/roles.ts");
    const admin = /ADMIN_ROLES:[^=]*=\s*\[([^\]]*)\]/.exec(roles_ts);
    const vuelos = /vuelos:\s*\[\.\.\.ADMIN_ROLES,([^\]]*)\]/.exec(roles_ts);
    assert.ok(admin && vuelos, "no se pudo leer lib/roles.ts");
    const deCodigo = [...[...admin[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]), ...[...vuelos[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])];
    assert.deepEqual([...deCodigo].sort(), [...ROLES_BASE].sort());
  });

  test("venta queda fuera de los módulos que muestran netos de empaquetados (LECTURA_MODULO)", () => {
    const c = leer("lib/constants.ts");
    for (const modulo of ["vuelos", "paquetes", "producto"]) {
      assert.match(c, new RegExp(`${modulo}:\\s*ROLES_INTERNOS\\.filter\\(\\(r\\) => r !== "venta"\\)`), `${modulo} debe excluir a venta`);
    }
  });
});

describe("types/database.ts — la vista nueva", () => {
  const tipos = leer("types/database.ts");

  test("el tipo de la vista omite exactamente las columnas de costo", () => {
    const m = /empaquetados_basica:\s*\{\s*Row:\s*Omit<\s*Database\["public"\]\["Tables"\]\["empaquetados"\]\["Row"\],\s*([^>]*?)>/.exec(tipos);
    assert.ok(m, "no se encontró el tipo de empaquetados_basica");
    const omitidas = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    assert.deepEqual([...omitidas].sort(), [...COLUMNAS_COSTO].sort());
  });

  test("las columnas del SQL son las del tipo de la tabla menos las de costo (sin deriva)", () => {
    const fila = /empaquetados:\s*\{\s*Row:\s*\{([\s\S]*?)\};\s*Insert/.exec(tipos);
    assert.ok(fila, "no se encontró Row de empaquetados");
    const todas = [...fila[1].matchAll(/^\s+([a-z_]+):/gm)].map((x) => x[1]);
    const sql = sinComentarios(leer(MIG));
    const v = bloque(sql, /create or replace view public\.empaquetados_basica/i);
    const select = /select\s+([\s\S]*?)\s+from public\.empaquetados e/i.exec(v)!;
    const cols = select[1].split(",").map((c) => c.trim().replace(/^e\./, "")).filter(Boolean);
    assert.deepEqual([...cols].sort(), todas.filter((c) => !COLUMNAS_COSTO.includes(c)).sort());
  });
});

const RAIZ_DIR = fileURLToPath(RAIZ);
function archivos(dirRel: string, ext: RegExp): string[] {
  const salida: string[] = [];
  const recorrer = (abs: string) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (["node_modules", ".next", "dist"].includes(e.name)) continue;
      const ruta = join(abs, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (ext.test(e.name)) salida.push(relative(RAIZ_DIR, ruta).split("\\").join("/"));
    }
  };
  recorrer(join(RAIZ_DIR, dirRel));
  return salida;
}

describe("inventario de lectores de la tabla base `empaquetados` en la aplicación", () => {
  const fuentes = ["app", "lib", "components"].flatMap((d) => archivos(d, /\.(ts|tsx)$/));

  // Lectores que consultan `empaquetados` (o la embeben) y el cliente con el que lo hacen. La clasificación se
  // revisó a mano (ver bitacora-hotfix-224.md, 1.4): solo los de sesión importan para este hotfix.
  const LECTORES = new Map<string, { cliente: "sesion" | "servicio"; roles: string }>([
    ["app/(dashboard)/dashboard/paquetes/[id]/page.tsx", { cliente: "sesion", roles: "modulo paquetes (sin venta)" }],
    ["app/(dashboard)/dashboard/paquetes/actions.ts", { cliente: "sesion", roles: "armado interno (sin venta)" }],
    ["app/(dashboard)/dashboard/vuelos/page.tsx", { cliente: "sesion", roles: "modulo vuelos (sin venta)" }],
    ["app/(dashboard)/dashboard/vuelos/historico/page.tsx", { cliente: "sesion", roles: "modulo vuelos (sin venta)" }],
    ["app/(dashboard)/dashboard/vuelos/empaquetados/[id]/page.tsx", { cliente: "sesion", roles: "modulo vuelos (sin venta)" }],
    ["app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts", { cliente: "sesion", roles: "5 roles de escritura" }],
    ["lib/paquetes/destinosAereos67.ts", { cliente: "sesion", roles: "armado interno o service-role" }],
    ["lib/reservar/computoReservaBernalo.ts", { cliente: "servicio", roles: "service-role" }],
    ["lib/reservar/empaquetadoOrigen.ts", { cliente: "servicio", roles: "service-role" }],
    ["lib/tarifario/datos.ts", { cliente: "servicio", roles: "service-role" }],
    ["lib/tarifario/datosBernalo.ts", { cliente: "servicio", roles: "service-role" }],
    ["lib/tarifario/filtrosPostCarga.ts", { cliente: "servicio", roles: "service-role" }],
    // computo.ts ya NO está aquí: lee con la SESIÓN de quien reserva (incl. `venta`) y pasó a la vista (línea 258).
  ]);

  const leeBase = (src: string) => /\.from\(\s*["']empaquetados["']\s*\)|\bempaquetados\(/.test(src.replace(/\/\/.*$/gm, ""));

  test("ningún archivo nuevo lee `empaquetados` sin haber sido clasificado", () => {
    const encontrados = fuentes.filter((f) => leeBase(leer(f)));
    const desconocidos = encontrados.filter((f) => !LECTORES.has(f));
    assert.deepEqual(desconocidos, [], "lector de empaquetados sin clasificar: revisa si lo ejecuta un rol sin acceso financiero");
  });

  test("los lectores clasificados siguen existiendo y siguen leyendo (la lista no se oxida)", () => {
    for (const f of LECTORES.keys()) {
      assert.ok(existsSync(new URL(f, RAIZ)), `ya no existe ${f}`);
      assert.ok(leeBase(leer(f)), `${f} ya no lee empaquetados: actualiza el inventario`);
    }
  });

  test("ningún lector de sesión de la tabla base lo ejecuta `venta`: los que quedan viven en módulos que LECTURA_MODULO/proxy.ts le cierran", () => {
    for (const [f, v] of LECTORES) {
      if (v.cliente !== "sesion") continue;
      assert.ok(!/venta/.test(v.roles.replace(/sin venta/g, "")), `${f}: su lectura de sesión la correría venta (${v.roles})`);
    }
  });

  test("el único lector de la vista con sesión de venta es computo.ts", () => {
    const lectoresVista = fuentes.filter((f) => /\.from\(\s*["']empaquetados_basica["']\s*\)/.test(leer(f).replace(/\/\/.*$/gm, "")));
    assert.deepEqual(lectoresVista, ["lib/reservar/computo.ts"]);
  });

  test("la vista y la tabla base jamás se mezclan en una misma consulta de sesión", () => {
    for (const f of fuentes) {
      const src = leer(f).replace(/\/\/.*$/gm, "");
      if (!/empaquetados_basica/.test(src)) continue;
      // Una consulta a la vista no puede pedir columnas de costo (el tipo ya lo impide en el build; esto lo explica).
      for (const m of src.matchAll(/\.from\(\s*["']empaquetados_basica["']\s*\)\s*\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
        for (const c of COLUMNAS_COSTO) assert.ok(!new RegExp(`\\b${c}\\b`).test(m[2]), `${f} pide ${c} a la vista`);
      }
    }
  });

  // GUARDA DE DESPLIEGUE (bitacora-hotfix-224.md, Q2, autorizada): `lib/reservar/computo.ts` valida la vigencia del
  // Empaquetado con la SESIÓN de quien reserva (incl. `venta`). Con la 225 aplicada, `venta` ya no alcanza la fila de
  // la tabla base: si este archivo volviera a leerla, toda reserva de un vuelo de Sistema respondería "El empaquetado
  // seleccionado ya no existe". Sin `todo` ni omisión: debe estar en verde SIEMPRE.
  test("computo.ts lee la VISTA (no la tabla base) para validar la vigencia del Empaquetado", () => {
    const src = leer("lib/reservar/computo.ts").replace(/\/\/.*$/gm, "");
    assert.ok(/\.from\(\s*["']empaquetados_basica["']\s*\)/.test(src), "computo.ts sigue leyendo la tabla base con la sesion de venta");
    assert.ok(!/\.from\(\s*["']empaquetados["']\s*\)/.test(src), "computo.ts no debe consultar la tabla base");
    // Solo las columnas que la vista expone (el tipo ya lo exige en el build; esto lo hace visible).
    const bloqueVista = /\.from\(\s*["']empaquetados_basica["']\s*\)\s*\.select\(\s*["']([^"']+)["']/.exec(src);
    assert.ok(bloqueVista, "no se encontró el select sobre la vista");
    assert.deepEqual(bloqueVista[1].split(",").map((c) => c.trim()), ["activo", "compra_inicio", "compra_fin"]);
  });

  test("el cambio en computo.ts es EXACTAMENTE la línea autorizada: ninguna otra lectura de empaquetados en el archivo", () => {
    const src = leer("lib/reservar/computo.ts").replace(/\/\/.*$/gm, "");
    assert.equal((src.match(/\.from\(\s*["']empaquetados[a-z_]*["']\s*\)/g) ?? []).length, 1);
  });
});

describe("workflow y scripts focales de la 224 y la 225", () => {
  const scripts = [
    "supabase/scripts/preflight_224_neto_empaquetados.sql", "supabase/scripts/postcheck_224_neto_empaquetados.sql",
    "supabase/scripts/rollback_224_neto_empaquetados.sql", "supabase/scripts/test_224_neto_empaquetados.sql",
    "supabase/scripts/test_224_fases.sh", "supabase/scripts/test_224_api.sh",
    "supabase/scripts/preflight_225_neto_empaquetados_cierre.sql", "supabase/scripts/postcheck_225_neto_empaquetados_cierre.sql",
    "supabase/scripts/rollback_225_neto_empaquetados_cierre.sql", "supabase/scripts/test_225_neto_empaquetados.sql",
    "supabase/scripts/test_225_fases.sh", "supabase/scripts/test_225_api.sh",
  ];
  for (const f of scripts) test(`existe ${f}`, () => assert.ok(existsSync(new URL(f, RAIZ))));

  const wf = existsSync(new URL(WF, RAIZ)) ? leer(WF) : "";
  const wfSinComentarios = wf.replace(/^\s*#.*$/gm, "");

  test("hay un solo workflow de 224/225 y corre las DOS fases (fases + API de cada una)", () => {
    assert.ok(wf.length > 0);
    const dir = new URL("../.github/workflows/", RAIZ);
    assert.deepEqual(readdirSync(dir).filter((f) => /224|225/.test(f)), ["test-224-225-neto-empaquetados.yml"]);
    for (const s of ["test_224_fases.sh", "test_224_api.sh", "test_225_fases.sh", "test_225_api.sh"]) assert.ok(wf.includes(s), `el workflow no corre ${s}`);
  });
  test("permisos de solo lectura, sin secretos, sin pull_request_target, sin Supabase remoto", () => {
    assert.match(wfSinComentarios, /permissions:\s*\n\s*contents: read/);
    assert.ok(!/secrets\./.test(wfSinComentarios));
    assert.ok(!/pull_request_target/.test(wfSinComentarios));
    assert.ok(!/supabase\.co|SUPABASE_|service_role_key/i.test(wfSinComentarios));
  });
  test("toda acción `uses:` está fijada por SHA de 40 caracteres", () => {
    const usos = [...wfSinComentarios.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(usos.length >= 2);
    for (const u of usos) assert.match(u, /@[0-9a-f]{40}$/, `acción sin fijar por SHA: ${u}`);
  });
  test("`set +e` antes de cada pipeline con tee (el código de salida se lee de PIPESTATUS)", () => {
    const bloques = wfSinComentarios.split(/\n\s*- name:/).filter((b) => /\|\s*tee\b/.test(b));
    assert.equal(bloques.length, 5, "fases 224, API 224, fases 225, API 225 y pruebas TS");
    for (const b of bloques) {
      assert.ok(b.indexOf("set +e") >= 0 && b.indexOf("set +e") < b.indexOf("tee"), "falta set +e antes de tee");
      assert.match(b, /PIPESTATUS\[0\]/);
    }
  });
  test("el esquema se arma hasta la 223 real y las dos fases parten de esa misma plantilla", () => {
    assert.match(wfSinComentarios, /preparar_esquema_local\.sh "\$CT" 223 "\$PLANTILLA"/);
    assert.ok(existsSync(new URL("supabase/migrations/20260601000223_neto_hija_manual_cierre.sql", RAIZ)));
    for (const s of ["test_224_fases.sh", "test_224_api.sh", "test_225_fases.sh", "test_225_api.sh"]) {
      assert.match(wfSinComentarios, new RegExp(`${s} "\\$CT" "\\$PLANTILLA"`));
    }
  });
  test("las dos fases prueban lo pedido: 224 aplica sola (compatibilidad) y 225 aplica 224 + 225", () => {
    const api224 = leer("supabase/scripts/test_224_api.sh");
    const api225 = leer("supabase/scripts/test_225_api.sh");
    assert.ok(api224.includes("20260601000224_neto_empaquetados_por_rol.sql") && !api224.includes("20260601000225"), "la API de la fase 1 solo aplica la 224");
    assert.ok(api225.includes("20260601000224_neto_empaquetados_por_rol") && api225.includes("20260601000225_neto_empaquetados_cierre"));
    assert.match(api224, /T2 venta CONSERVA la tabla base/);
    assert.match(api225, /T2 venta pide select=\* de la tabla base: 0 filas/);
    const f225 = leer("supabase/scripts/test_225_fases.sh");
    assert.ok(f225.includes("rollback_224_neto_empaquetados.sql") && f225.includes("rollback_225_neto_empaquetados_cierre.sql"), "rollbacks por separado");
    assert.match(f225, /F0\.1 la 225 se niega sin la vista/);
  });
  test("la imagen de PostgREST del workflow es la de los dos runners de API", () => {
    const imagen = /IMAGEN_PGRST:\s*(\S+)/.exec(wf)?.[1];
    assert.ok(imagen);
    for (const f of ["test_224_api.sh", "test_225_api.sh"]) assert.ok(leer(`supabase/scripts/${f}`).includes(imagen), f);
  });
  test("la batería de la 225 ejercita las DOS condiciones (sin acceso a la tabla y con acceso por la vista)", () => {
    const sql = leer("supabase/scripts/test_225_neto_empaquetados.sql");
    assert.match(sql, /Z venta SÍ alcanza filas por la vista/);
    assert.match(sql, /Z control_vuelo SÍ alcanza filas/);
    assert.match(sql, /\('vent','0'\)/, "venta debe leer 0 filas de la tabla base tras la 225");
    for (const rol of ["super", "gere", "admi", "oper", "ctrl", "vent", "agen", "free", "clie"]) {
      assert.ok(sql.includes(`'${rol}'`), `falta el rol ${rol}`);
    }
    assert.ok(/set local role %I/.test(sql), "debe cambiar de rol de Postgres (si no, el dueño se salta la RLS)");
    assert.ok(sql.includes("'anon'"));
  });
  test("la batería de la 224 afirma la compatibilidad: venta CONSERVA la tabla base en la fase 1", () => {
    const sql = leer("supabase/scripts/test_224_neto_empaquetados.sql");
    assert.match(sql, /\('vent',\(select count\(\*\)::text from public\.empaquetados\)\)/, "venta debe leer TODAS las filas de la tabla base en la fase 1");
    assert.match(sql, /Z venta alcanza filas por la vista \(>0\) y TAMBIÉN por la tabla base/);
    assert.match(sql, /Z control_vuelo SÍ alcanza filas/);
    assert.ok(/set local role %I/.test(sql));
  });
  test("las baterías SQL no usan literales para contar filas que otros bloques pueden crear (el bloque R inserta una)", () => {
    for (const f of ["supabase/scripts/test_224_neto_empaquetados.sql", "supabase/scripts/test_225_neto_empaquetados.sql"]) {
      const sql = leer(f);
      // Los esperados de B y V, el select * de venta, el listado de control_vuelo, W y Z se comparan con el conteo REAL.
      assert.ok(!/\('(super|gere|admi|oper|ctrl)','2'\)/.test(sql), `${f}: esperado literal '2' en B/V`);
      assert.ok(!/v_res = '3'/.test(sql) && !/v_res::int >= 3/.test(sql), `${f}: literal 3 en W/R`);
      const z = sql.slice(sql.indexOf("-- ═ Z"));
      assert.match(z, /v_total := \(select count\(\*\)::text from public\.empaquetados\)/, `${f}: Z debe medir el total real`);
      assert.ok(!/v_d = '2'/.test(z), `${f}: Z compara la tabla base de venta con un literal`);
      assert.match(z, /v_a = v_total/, `${f}: Z debe exigir que la vista de venta traiga todas las filas`);
    }
  });
  test("convenciones del encargo: sin variables PL/pgSQL que coincidan con columnas y fixtures DTM si hay ventas", () => {
    const COLUMNAS = new Set(["id", "record", "aerolinea", "ruta", "origen", "activo", "rol", "nombre", "email", "detalle", "nota", "tenant", "notas"]);
    const sqls = scripts.filter((f) => f.endsWith(".sql"));
    for (const f of sqls) {
      const sql = leer(f);
      for (const m of sql.matchAll(/declare\s+([\s\S]*?)\bbegin\b/gi)) {
        for (const decl of m[1].split(";")) {
          const nombre = decl.trim().split(/\s+/)[0]?.toLowerCase();
          if (nombre) assert.ok(!COLUMNAS.has(nombre), `${f}: la variable ${nombre} coincide con una columna`);
        }
      }
      if (/insert into public\.ventas/i.test(sql)) assert.match(sql, /DTM-\d{4}/, `${f}: fixture de venta sin formato DTM-NNNN`);
    }
  });
  test("los preflight no bloquean y los postcheck devuelven UNA fila consolidada", () => {
    for (const n of ["224_neto_empaquetados", "225_neto_empaquetados_cierre"]) {
      const pre = leer(`supabase/scripts/preflight_${n}.sql`);
      assert.ok(!/'BLOQUEANTE'/.test(pre.replace(/--.*$/gm, "")), `preflight ${n}: cuenta, no bloquea`);
      assert.match(pre, /begin transaction read only;[\s\S]*rollback;/);
      const post = leer(`supabase/scripts/postcheck_${n}.sql`);
      assert.match(post, /begin transaction read only;[\s\S]*bool_and\(ok\)[\s\S]*rollback;/);
      assert.equal((post.match(/select case when bool_and\(ok\)/g) ?? []).length, 1);
    }
  });
  test("el rollback de la 225 restaura la policy anterior con los mismos 6 roles de la 156 y deja la vista", () => {
    const rb = sinComentarios(leer("supabase/scripts/rollback_225_neto_empaquetados_cierre.sql"));
    const p = bloque(rb, /create policy "empaquetados: lectura operativa"/i);
    const usando = /using\s*\(\s*public\.mi_rol\(\)\s+in\s*\(([^)]*)\)/i.exec(p);
    assert.ok(usando);
    assert.deepEqual([...roles(usando[1])].sort(), [...ROLES_VISTA].sort());
    assert.ok(!/drop view/i.test(rb), "el rollback de la 225 no retira la vista de la 224");
  });
  test("el rollback de la 224 retira solo la vista y se niega si la 225 sigue aplicada", () => {
    const rb = sinComentarios(leer("supabase/scripts/rollback_224_neto_empaquetados.sql"));
    assert.match(rb, /drop view if exists public\.empaquetados_basica/);
    assert.ok(!/(create|drop)\s+policy/i.test(rb));
    assert.match(rb, /ROLLBACK 224 ABORTADO: la 225 sigue aplicada/);
  });
});
