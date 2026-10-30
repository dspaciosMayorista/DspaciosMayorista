// #39 fase 1 — prueba de CABLEADO (mira el código fuente, no el comportamiento).
//
// No demuestra que la frontera funcione —eso lo demuestra el CI de la 216/217
// en PostgreSQL y PostgREST desechables— sino que no quedó ninguna puerta
// lateral en el código ni en las migraciones:
//   · ninguna ruta de la app llama a las RPC de dinero 198 directo: la única
//     puerta son los wrappers de la 216 (y #50 los extenderá, sin otra puerta);
//   · ninguna ruta escribe directo servicios, pagos previos ni condiciones, ni
//     inserta una cotización manual;
//   · la 216 no redefine la 198/164/211 y deja la frontera DESHABILITADA; la 217
//     la activa con la lista fija de revocaciones;
//   · decisión A: la vigencia sigue libre (sin regla de autoría). De
//     `reservar/actions.ts` #39 solo toca `convertirCotizacion`, para rechazar
//     una manual antes del motor (excepción focal autorizada por el dueño);
//   · el workflow focal es de solo lectura y sin secretos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const M216 = leer("supabase/migrations/20260601000216_cotizacion_manual_edicion_frontera.sql");
const M217 = leer("supabase/migrations/20260601000217_cotizacion_manual_cierre_frontera.sql");
const sinComentariosSql = (s: string) => s.replace(/--[^\n]*/g, "");

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(join(RAIZ, dir))) {
    const p = join(RAIZ, dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules") out.push(...archivosTs(relative(RAIZ, p))); }
    else if (/\.(ts|tsx)$/.test(n)) out.push(relative(RAIZ, p).replace(/\\/g, "/"));
  }
  return out;
}
const CODIGO = ["app", "lib", "components"].flatMap(archivosTs);

/** Cuerpo de una función SQL de la 216 (desde su `create or replace` hasta el `$$;` que la cierra). */
function funcion(nombre: string): string {
  const i = M216.indexOf(`create or replace function ${nombre}(`);
  assert.ok(i >= 0, `no está ${nombre}`);
  const a = M216.indexOf("$$", i);
  const b = M216.indexOf("$$", a + 2);
  return M216.slice(i, b + 2);
}

describe("app: una sola puerta de dinero y ninguna escritura directa", () => {
  test("ninguna ruta llama a las RPC 198 de dinero directo", () => {
    const malas = CODIGO.filter((f) => /\.rpc\(\s*["'](registrar_pago_previo|anular_pago_previo|convertir_cotizacion_a_contrato|transferir_pagos_previos_a_abonos)["']/.test(leer(f)));
    assert.deepEqual(malas, []);
  });
  test("los wrappers SÍ se llaman, cada uno desde su acción", () => {
    const pagos = leer("app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
    const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
    assert.match(pagos, /\.rpc\("registrar_pago_previo_rev",/);
    assert.match(pagos, /\.rpc\("anular_pago_previo_controlado",/);
    assert.match(manual, /\.rpc\("convertir_cotizacion_manual_controlada",/);
    assert.match(manual, /\.rpc\("crear_cotizacion_manual",/);
    assert.match(manual, /\.rpc\("editar_servicios_cotizacion_manual",/);
    assert.match(manual, /\.rpc\("actualizar_recobro_ninos_manual",/);
  });
  test("nadie escribe directo servicios, pagos previos ni condiciones", () => {
    const re = /\.from\(\s*["'](cotizacion_servicios|cotizacion_pagos_previos|cotizacion_condiciones)["']\s*\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/;
    const malas = CODIGO.filter((f) => {
      const s = leer(f);
      // Solo cuenta si la cadena de llamadas sigue (no corta en `;` antes del método de escritura).
      const m = s.match(re);
      return !!m && !m[0].includes(";");
    });
    assert.deepEqual(malas, []);
  });
  test("manual-actions ya no inserta cotizaciones ni servicios", () => {
    const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
    assert.doesNotMatch(manual, /\.insert\(/);
  });
  test("el pago lee la revisión en la consulta de la cotización, antes que los servicios", () => {
    const pagos = leer("app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
    const iRev = pagos.indexOf("Number(cot.economico_rev)");
    const iServ = pagos.indexOf('.from("cotizacion_servicios")');
    assert.ok(iRev > 0 && iServ > iRev);
    assert.match(pagos, /p_rev_esperada: revEsperada/);
  });
  test("el snapshot del primer pago lee los servicios en el MISMO orden que la 216 (orden, id)", () => {
    // `p39_priv.componentes_manual` numera con `order by s.orden, s.id`; si la app ordenara solo
    // por `orden`, dos filas con el mismo `orden` podrían llegar en otro orden y el primer pago
    // fallaría (cerrado) con PAGO_39_COMPOSICION.
    const pagos = leer("app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
    assert.match(pagos, /\.from\("cotizacion_servicios"\)\s*\.select\("id, tipo_servicio, valor, nombre_servicio"\)\s*\.eq\("cotizacion_id", cotizacionId\)\s*\.order\("orden"\)\s*\.order\("id"\)/);
    assert.match(funcion("p39_priv.componentes_manual"), /row_number\(\) over \(order by s\.orden, s\.id\)/);
  });
  test("decisión A: reservar/actions.ts no conoce nada de #39 y la vigencia no se tocó", () => {
    const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.doesNotMatch(reservar, /economico_rev|_39\b|editar_servicios|creado_por_id/);
    assert.match(leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx"), /editable=\{c\.estado === "abierta" && !salidaPasada\}/);
  });
  test("excepción focal: convertirCotizacion rechaza una manual ANTES del motor, y solo ahí aparece la guarda", () => {
    const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    const ini = reservar.indexOf("export async function convertirCotizacion(");
    const fin = reservar.indexOf("export async function convertirCotizacionCarrito");
    assert.ok(ini > 0 && fin > ini, "no se pudo delimitar convertirCotizacion");
    const f = reservar.slice(ini, fin);
    assert.match(f, /\.select\("estado, payload, numero_contrato, tenant, modo, tipo, vigencia_hasta, fecha_salida"\)/, "la lectura incluye tipo");
    const iGuarda = f.indexOf('if (cot.tipo === "manual") return { ok: false');
    assert.ok(iGuarda > 0, "falta la guarda de manual");
    for (const despues of ['if (cot.estado === "convertida"', "contextoCotizacion()", "reservarDesdeTarifarioInterno(", '.update({ estado: "convertida"']) {
      const i = f.indexOf(despues);
      assert.ok(i > iGuarda, `la guarda debe ir antes de ${despues}`);
    }
    // La guarda vive solo en convertirCotizacion: nada más del archivo filtra manuales por esta vía.
    assert.equal(reservar.split('cot.tipo === "manual"').length - 1, 1, "la guarda aparece una sola vez en el archivo");
  });
  test("la ficha muestra los editores solo si la elegibilidad lo permite", () => {
    const page = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(page, /sb\.rpc\("edicion_cotizaciones_habilitada"\)/);
    const iEleg = page.indexOf("elegibilidad.ok ?");
    assert.ok(iEleg > 0 && page.indexOf("<ServiciosCotizacionEditor") > iEleg && page.indexOf("<RecobroNinosEditor") > iEleg);
  });
  test("íconos, nunca emojis, en los editores de #39", () => {
    for (const f of ["app/(dashboard)/dashboard/cotizaciones/[id]/ServiciosCotizacionEditor.tsx", "app/(dashboard)/dashboard/cotizaciones/[id]/RecobroNinosEditor.tsx"]) {
      assert.doesNotMatch(leer(f), /\p{Extended_Pictographic}/u, f);
    }
  });
});

describe("migración 216 (A, aditiva)", () => {
  const sql = sinComentariosSql(M216);
  test("no redefine ni altera ninguna RPC existente (198/164/208/211)", () => {
    assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\.(registrar_pago_previo|anular_pago_previo|transferir_pagos_previos_a_abonos|convertir_cotizacion_a_contrato|_autorizado_pago_previo|crear_cotizacion_comparativa)\s*\(/i);
    assert.doesNotMatch(sql, /alter\s+function/i);
    assert.doesNotMatch(sql, /f211_priv\.\w+\s*\(/i, "no llama ni redefine piezas privadas de la 211");
  });
  test("wrappers INVOKER (la 198 sigue con service_role); RPC de edición DEFINER con search_path fijo", () => {
    for (const w of ["public.registrar_pago_previo_rev", "public.anular_pago_previo_controlado", "public.convertir_cotizacion_manual_controlada"]) {
      assert.match(funcion(w), /security invoker set search_path = public, pg_temp/, w);
    }
    for (const r of ["public.crear_cotizacion_manual", "public.editar_servicios_cotizacion_manual", "public.actualizar_recobro_ninos_manual", "public.edicion_cotizaciones_habilitada",
      "p39_priv.emitir", "p39_priv.cerrar", "p39_priv.autorizada", "p39_priv.frontera_activa", "p39_priv.bloquear_para_editar"]) {
      assert.match(funcion(r), /security definer set search_path = public, pg_temp/, r);
    }
    assert.match(funcion("p39_priv.autorizada"), /language sql volatile security definer/, "autorizada VOLATILE");
  });
  test("cada wrapper emite, llama a la 198 SIN cambios y cierra, en ese orden", () => {
    for (const [w, rpc, op] of [
      ["public.registrar_pago_previo_rev", "public.registrar_pago_previo(", "'pago'"],
      ["public.anular_pago_previo_controlado", "public.anular_pago_previo(", "'anulacion'"],
      ["public.convertir_cotizacion_manual_controlada", "public.convertir_cotizacion_a_contrato(", "'conversion'"],
    ] as const) {
      const f = funcion(w);
      const iLock = f.indexOf("for update");
      const iEmit = f.indexOf(`p39_priv.emitir(`);
      const iCall = f.lastIndexOf(rpc);
      const iClose = f.indexOf("p39_priv.cerrar(");
      assert.ok(iLock > 0 && iLock < iEmit && iEmit < iCall && iCall < iClose, `${w}: bloqueo → emitir → 198 → cerrar`);
      assert.ok(f.slice(iEmit, iEmit + 60).includes(op), `${w}: operación ${op}`);
    }
  });
  test("ACL: p39_priv solo para service_role; RPC de edición y wrappers solo service_role; habilitada solo authenticated", () => {
    assert.match(sql, /revoke all on schema p39_priv from public, anon, authenticated, service_role;/);
    assert.match(sql, /grant usage on schema p39_priv to service_role;/);
    assert.doesNotMatch(sql, /grant [^;]*on schema p39_priv to [^;]*(anon|authenticated)/);
    assert.doesNotMatch(sql, /grant execute on function p39_priv\.[^;]* to [^;]*(anon|authenticated)/);
    assert.match(sql, /revoke all on all functions in schema p39_priv from public, anon, authenticated, service_role;/);
    for (const f of ["crear_cotizacion_manual", "editar_servicios_cotizacion_manual", "actualizar_recobro_ninos_manual",
      "registrar_pago_previo_rev", "anular_pago_previo_controlado", "convertir_cotizacion_manual_controlada"]) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated, service_role;`), f);
      assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`), f);
      assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to [^;]*(anon|authenticated)`), f);
    }
    assert.match(sql, /grant execute on function public\.edicion_cotizaciones_habilitada\(\) to authenticated;/);
  });
  test("la frontera nace DESHABILITADA; la revisión económica, activa", () => {
    for (const [t, tabla] of [["trg_cot_frontera_39", "cotizaciones"], ["trg_cot_pagos_frontera_39", "cotizacion_pagos_previos"], ["trg_cot_condiciones_frontera_39", "cotizacion_condiciones"]]) {
      assert.match(sql, new RegExp(`create trigger ${t}\\b`));
      assert.match(sql, new RegExp(`alter table public\\.${tabla} disable trigger ${t};`));
    }
    assert.doesNotMatch(sql, /disable trigger trg_cot_economico_rev_39|disable trigger trg_cot_servicios_rev_39/);
  });
  test("decisión A: la frontera deja libre vigencia_hasta y no decide nada por rol ni autor", () => {
    const f = funcion("p39_priv.tg_frontera_cotizaciones");
    assert.match(f, /v_libres text\[\] := array\['vigencia_hasta'/);
    assert.doesNotMatch(f, /mi_rol\(\)|creado_por_id|auth\.uid\(\)/);
  });
  test("la frontera cubre el PRIMER congelado: esas columnas solo quedan libres con la autorización de pago", () => {
    const f = funcion("p39_priv.tg_frontera_cotizaciones");
    const iPago = f.indexOf("if v_pago then");
    const iCong = f.indexOf("'condicion_pago_congelada_en', 'moneda_congelada', 'trm_autoritativa'");
    assert.ok(iPago > 0 && iCong > iPago, "las columnas de congelado solo se agregan dentro de `if v_pago`");
    assert.doesNotMatch(f.slice(0, iPago), /monto_exigido_total_cop/);
  });
  test("orden de disparo: los de #39 antes que los de la 154 y la 211 (PostgreSQL ordena por nombre)", () => {
    const nombres = ["trg_cot_economico_rev_39", "trg_cot_frontera_39", "trg_cotizaciones_bloquear_cambio_tenant", "trg_cotizaciones_comparativa_guarda", "trg_cotizaciones_no_descartar_con_pagos"];
    assert.deepEqual([...nombres].sort(), nombres);
    assert.ok("trg_cot_condiciones_frontera_39" < "trg_cotizacion_condiciones_bloquear_congeladas");
    assert.ok("trg_cot_condiciones_frontera_39" < "trg_madre_sin_condiciones" && "trg_cot_pagos_frontera_39" < "trg_madre_sin_pagos");
  });
  test("composición en SQL = componentesDeManual en TS (mapeo y etiquetas)", () => {
    const ts = leer("lib/cotizacion/componentesManual.ts");
    const label = ts.slice(ts.indexOf("const LABEL"), ts.indexOf("};", ts.indexOf("const LABEL")));
    const f = funcion("p39_priv.componentes_manual");
    const etiquetas = [...label.matchAll(/^\s+(\w+): "([^"]+)",$/gm)];
    assert.equal(etiquetas.length, 5, "cinco tipos de servicio");
    for (const m of etiquetas) {
      assert.match(f, new RegExp(`when '${m[1]}' then '${m[2]}'`), `etiqueta de ${m[1]}`);
    }
    assert.match(f, /when 'aereo' then 'aereo_empaquetado' when 'hotel' then 'hotel' else 'servicio'/);
    assert.match(f, /coalesce\(s\.valor, 0\) > 0/, "solo valor > 0, como el TS");
  });
  test("el cierre es un evento aparte (solo inserción), no un UPDATE", () => {
    assert.match(funcion("p39_priv.cerrar"), /insert into p39_priv\.autorizacion_cerrada/);
    assert.doesNotMatch(sql, /update p39_priv\.autorizacion_emitida/);
  });
});

describe("migración 217 (B, cierre)", () => {
  const sql = sinComentariosSql(M217);
  test("lista fija de revocaciones", () => {
    assert.match(sql, /revoke insert, update, delete, truncate on public\.cotizacion_servicios from public, anon, authenticated, service_role;/);
    assert.match(sql, /revoke insert, update, delete, truncate on public\.cotizacion_pagos_previos from public, anon, authenticated;/);
    assert.match(sql, /revoke delete, truncate on public\.cotizacion_pagos_previos from service_role;/);
    assert.match(sql, /revoke insert, update, delete, truncate on public\.cotizacion_condiciones from public, anon, authenticated;/);
    assert.match(sql, /revoke truncate on public\.cotizacion_condiciones from service_role;/);
  });
  test("activa los tres disparadores y exige frontera_activa() antes de confirmar", () => {
    for (const [t, tabla] of [["trg_cot_frontera_39", "cotizaciones"], ["trg_cot_pagos_frontera_39", "cotizacion_pagos_previos"], ["trg_cot_condiciones_frontera_39", "cotizacion_condiciones"]]) {
      assert.match(sql, new RegExp(`alter table public\\.${tabla} enable trigger ${t};`));
    }
    assert.match(sql, /if not p39_priv\.frontera_activa\(\) then/);
    assert.doesNotMatch(sql, /create or replace function|grant /i, "la 217 no crea funciones ni concede nada");
  });
});

describe("workflow focal 216/217", () => {
  const wf = readFileSync(join(RAIZ, "..", ".github", "workflows", "test-216-217-cotizacion-edicion.yml"), "utf8").replace(/\r\n/g, "\n");
  // Sin comentarios YAML (el encabezado explica justo lo que NO se usa).
  const yaml = wf.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
  test("pull_request normal, solo lectura, sin secretos, con timeout y limpieza", () => {
    assert.match(yaml, /^on:\n\s+pull_request:/m);
    assert.doesNotMatch(yaml, /pull_request_target/);
    assert.match(yaml, /permissions:\n\s+contents: read/);
    assert.doesNotMatch(yaml, /secrets\./);
    assert.doesNotMatch(yaml, /ecr\.aws/);
    assert.match(wf, /timeout-minutes:/);
    assert.match(wf, /if: always\(\)/);
  });
  test("corre los tres runners y no acepta un verde vacío", () => {
    for (const s of ["test_216_fases.sh", "test_216_carrera.sh", "test_216_api.sh"]) assert.ok(wf.includes(s), s);
    for (const marca of ["TEST 216 FASES: TODO OK", "TEST 216 CARRERAS: TODO OK", "TEST 216 API: TODO OK"]) assert.ok(wf.includes(marca), marca);
    assert.match(wf, /grep -q '\^FALLO'/);
  });
  test("exige los marcadores de exposición: X6 (sin USAGE), X6.1 (control positivo) y DV6–DV8 (C21/C22 pueden fallar)", () => {
    for (const marca of ["'OK    X5.1 '", "'OK    X6 '", "'OK    X6.1 '", "'OK    DV6 '", "'OK    DV7 '", "'OK    DV8 '"]) assert.ok(yaml.includes(marca), marca);
  });
  test("corre las pruebas TS de #39 (R4 y cableado) en Node con versión exacta y sin acciones de terceros", () => {
    assert.match(yaml, /IMAGEN_NODE: node:\d+\.\d+\.\d+-/, "imagen de Node con versión exacta");
    assert.match(yaml, /pnpm install --frozen-lockfile/);
    for (const f of ["pruebas/cotizacionEdicion39R4.test.ts", "pruebas/cotizacionEdicion39.wiring.test.ts"]) assert.ok(yaml.includes(f), f);
    assert.ok(yaml.includes("^ℹ fail 0$"), "exige cero fallos");
    assert.ok(yaml.includes("✔ R4 manual con payload de tarifario plantado"), "exige R4 en verde");
    // Toda acción de terceros fijada por SHA completo (hoy solo checkout).
    const usos = [...yaml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(usos.length > 0);
    for (const u of usos) assert.match(u, /^actions\/checkout@[0-9a-f]{40}$/, u);
  });
});

describe("package.json", () => {
  test("la prueba React de #39 está registrada en test:react", () => {
    const p = JSON.parse(leer("package.json")) as { scripts: Record<string, string> };
    assert.ok(p.scripts["test:react"].includes("pruebas/cotizacionEdicion39Editor.react.ts"));
  });
});
