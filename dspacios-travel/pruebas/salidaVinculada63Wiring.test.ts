import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// #63 — cableado ESTÁTICO (lee el código y los scripts como texto): lo que no se puede probar ejecutando sin una base real
// o sin tocar producción, y los compromisos de la entrega (qué archivos NO se tocan, qué guardas deben seguir en su sitio).
// El comportamiento está en salidaVinculada63*.test.ts / .react.ts y en test_227_salida_vinculada.sql (Postgres, CI).

const RAIZ = new URL("../", import.meta.url);
const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, RAIZ)), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/--.*$/gm, "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const sinCadenas = (s: string) => s.replace(/'(?:[^']|'')*'/g, "''");
/** Texto de una función SQL por su nombre (de `create or replace function public.<nombre>` hasta su `$$;`). */
const funcionSql = (sql: string, nombre: string) => {
  const i = sql.indexOf(`create or replace function public.${nombre}(`);
  assert.ok(i >= 0, `no está la función ${nombre}`);
  const j = sql.indexOf("$$;", sql.indexOf("$$", i) + 2);
  return sql.slice(i, j + 3);
};
/** Quita los cuerpos `$$ … $$` (funciones y bloques DO): lo que queda son las sentencias de nivel superior. */
const sinCuerpos = (s: string) => s.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
const huella = (rel: string) => createHash("sha256").update(leer(rel)).digest("hex").slice(0, 16);

const MIG = "supabase/migrations/20260601000227_salida_vinculada_empaquetado.sql";
/** Funciones nuevas del cierre E/F/G (aceptación atómica, fencing, protecciones y H derivada). */
const FUNCIONES_EFG = [
  "trg_p63_inmutable", "p63_bump_costos", "trg_p63_costos_hoteles", "trg_p63_costos_acomodaciones", "trg_p63_costos_servicios", "trg_p63_costos_proveedores",
  "trg_p63_costos_empaquetados", "p63_hoy_bogota", "p63_financiero_derivado", "p63_hijos_pendientes", "p63_payload_alterno", "crear_cotizacion_oferta_63",
  "aceptar_oferta_63", "trg_ventas_aceptacion_63_ins", "trg_ventas_borrada_63", "trg_ventas_costos_63", "p63_validar_pendiente", "trg_p63_pendiente",
  "trg_cxp_aceptacion_63", "trg_cxp_borrada_63", "p63_registrar_financiero",
  // Ciclo 5: el plan B2B (% del aliado / parámetro general) mueve el contador de costos.
  "p63_bump_costos_todos", "trg_p63_costos_b2b",
];
const WORKFLOW = "../.github/workflows/test-227-salida-vinculada-63.yml";

describe("archivos que NO se tocan (decisión del Coordinador)", () => {
  test("menoresDeDos.ts (226) se reutiliza SIN editar: misma huella que en 3cfe731c", () => {
    assert.equal(huella("lib/reservar/menoresDeDos.ts"), "357c02fd8898ba6a");
  });
  test("el motor de precios (lib/calc/paquetes.ts) queda intacto: legacy y precioMenorDeDos como en 3cfe731c", () => {
    assert.equal(huella("lib/calc/paquetes.ts"), "b2cbe250e047660c");
  });
  test("origen.ts y salidaDinamicaVigente.ts (#62) quedan intactos", () => {
    assert.equal(huella("lib/reservar/origen.ts"), "346a364394e5a31b");
    assert.equal(huella("lib/reservar/salidaDinamicaVigente.ts"), "fdb3513b8b64357e");
  });
  test("las migraciones 220 y 226 (ya aplicadas) no se editan: la 227 las envuelve o las reemplaza con su propia migración", () => {
    assert.ok(existsSync(new URL("supabase/migrations/20260601000220_paquete_destinos_aereos.sql", RAIZ)));
    assert.ok(existsSync(new URL("supabase/migrations/20260601000226_tarifa_infante.sql", RAIZ)));
    assert.ok(existsSync(new URL(MIG, RAIZ)));
  });
  test("no se creó ningún archivo con la palabra 'promocion' en el nombre ni en el código nuevo (no es un tipo ni un estado)", () => {
    for (const f of ["lib/reservar/ofertaDinamica63.ts", "lib/reservar/prepararOferta63.ts", "lib/reservar/importeObligacion63.ts", "lib/reservar/payloadFinanciero63.ts"]) {
      assert.doesNotMatch(sinComentarios(leer(f)), /promoci[oó]n/i, `${f} usa la palabra promoción`);
    }
  });
  test("R2: los módulos nuevos NO escriben rótulos de menores (los pone menoresDeDos.ts de la 226, sin variantes)", () => {
    for (const f of ["lib/reservar/ofertaDinamica63.ts", "lib/reservar/prepararOferta63.ts", "lib/reservar/importeObligacion63.ts", "lib/reservar/payloadFinanciero63.ts"]) {
      assert.doesNotMatch(leer(f), /Infante \(2 a[ñn]os\)|menor de 2 a[ñn]os\) ·|"Infante ·|Ni[ñn]o 1 \(/, `${f} define un rótulo de menores`);
    }
    const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(reservar, /descripcionLineaMenor\(lm, input\.categoria, input\.regimen\)/, "el contrato sigue usando el rótulo de la 226");
  });
});

describe("cupos: SOLO un Bloqueo negociado tiene sillas", () => {
  test("ningún módulo de la oferta 63 ni de la resolución del origen consulta cupos ni sillas", () => {
    for (const f of ["lib/reservar/ofertaDinamica63.ts", "lib/reservar/prepararOferta63.ts", "lib/reservar/empaquetadoOrigen.ts", "lib/reservar/computo.ts"]) {
      const src = sinComentarios(leer(f));
      assert.doesNotMatch(src, /cupos_por_bloqueo/, `${f} consulta cupos_por_bloqueo`);
      assert.doesNotMatch(src, /\.from\(\s*["']sillas["']\s*\)/, `${f} consulta sillas`);
    }
  });
  test("reservarDesdeTarifarioInterno: la validación de cupos vive DENTRO del bloque `origen.tipo === \"bloqueo\"` y en ningún otro lugar", () => {
    const src = sinComentarios(leer("app/(dashboard)/dashboard/reservar/actions.ts"));
    const ini = src.indexOf("async function reservarDesdeTarifarioInterno(");
    const fin = src.indexOf("export type CotizacionResult");
    const cuerpo = src.slice(ini, fin);
    const posBloque = cuerpo.indexOf('if (origen.tipo === "bloqueo") {');
    const posCupos = cuerpo.indexOf("cupos_por_bloqueo");
    assert.ok(posBloque > 0 && posCupos > posBloque, "los cupos deben consultarse dentro del bloque de Bloqueo");
    assert.equal((cuerpo.match(/cupos_por_bloqueo/g) ?? []).length, 1, "una sola consulta de cupos en toda la reserva");
    // y el bloque termina antes de seguir con el resto del flujo (no se extiende a otros orígenes)
    const cierre = cuerpo.indexOf("const infantesN", posBloque);
    assert.ok(cierre > posCupos);
    assert.doesNotMatch(cuerpo.slice(posBloque, cierre), /origen\.tipo === "salida"|origen\.tipo === "empaquetado"/);
  });
});

describe("la 227 envuelve, no copia ni reemplaza lo vigente", () => {
  const mig = leer(MIG);
  const sql = sinComentarios(mig);
  test("el envoltorio LLAMA al publicador vigente y no lo redefine", () => {
    assert.match(sql, /public\.publicar_tarifario_resultado\(p_paquete_id, p_generacion, p_revision_capturada, p_moneda, p_filas\)/);
    assert.doesNotMatch(sql, /create (or replace )?function public\.publicar_tarifario_resultado\(/i);
    assert.doesNotMatch(funcionSql(sql, "publicar_tarifario_resultado_63"), /precio_pvp_menor2|insert into public\.tarifario_resultado|delete from public\.tarifario_resultado/, "el cuerpo de la 226 no se copia");
  });
  test("no redefine el trigger de invalidación de la 226 sobre empaquetados: agrega uno PROPIO", () => {
    assert.doesNotMatch(sql, /create or replace function public\.tarifario_trg_bump_por_empaquetado/i);
    assert.doesNotMatch(sql, /create trigger tarifario_trg_empaquetados\b/i);
    assert.match(sql, /create trigger tarifario_trg_empaquetado_vinculadas_63/i);
  });
  test("solo reemplaza DOS funciones existentes: la guarda de configuración de la 220 y la RPC financiera de la 210", () => {
    const reemplazadas = [...sql.matchAll(/create or replace function public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
    const conocidas = new Set(["validar_config_destinos_aereos_67", "registrar_financiero_contrato"]);
    const nuevas = new Set(["trg_modo_oferta_vinculadas_63", "trg_invalidar_modo_oferta_63", "trg_salida_vinculada_63", "trg_vinculo_aereo_67_salida",
      "tarifario_trg_empaquetado_vinculadas_63", "publicar_tarifario_resultado_63", ...FUNCIONES_EFG]);
    for (const f of reemplazadas) assert.ok(conocidas.has(f) || nuevas.has(f), `la 227 reemplaza/crea una función inesperada: ${f}`);
    for (const f of conocidas) assert.ok(reemplazadas.includes(f), `falta reemplazar ${f}`);
  });
  test("la RPC financiera conserva K15 (ya_completo) y, para un contrato SIN aceptación #63, el TEXTO EXACTO de la 210", () => {
    for (const marca of ["ya_completo", "financiero_registrado_en", "marca_cxp_automatica", "for update", "contrato_financiero_pendiente"]) {
      assert.match(sql, new RegExp(marca), `la RPC financiera perdió ${marca}`);
    }
    // El camino de siempre es la 210 palabra por palabra: lo único que difiere es la variable del marcador y el desvío para #63.
    const f210 = funcionSql(leer("supabase/migrations/20260601000210_financiero_contrato_reentrada.sql"), "registrar_financiero_contrato");
    const f227 = funcionSql(mig, "registrar_financiero_contrato");
    const sin227 = f227
      .replace("  v_acep       bigint;\n", "")
      .replace(/\n  -- 227 \(#63\): un contrato ligado[\s\S]*?return public\.p63_registrar_financiero\([^\n]*\n  end if;\n/, "");
    assert.equal(sin227, f210, "la rama de contratos de siempre dejó de ser la 210 exacta");
    // El desvío va DESPUÉS del K15 (ya_completo primero) y ANTES de leer el payload del llamador.
    const iK15 = f227.indexOf("'ya_completo', true");
    const iDesvio = f227.indexOf("p63_registrar_financiero(");
    const iPayload = f227.indexOf("jsonb_typeof(p_cxp)");
    assert.ok(iK15 > 0 && iK15 < iDesvio && iDesvio < iPayload, "K15 → desvío #63 → payload del llamador");
    // Una aceptación #63 jamás usa el INSERT de la 210 (que no conoce las marcas): lo hace p63_registrar_financiero.
    assert.doesNotMatch(f227.slice(iDesvio + 200), /aceptacion_63_id|obligacion_63/, "el camino de siempre no escribe marcas #63");
  });
  test("toda consulta a information_schema.columns se restringe a TABLAS BASE (lección del C10 de la 226)", () => {
    for (const f of [MIG, "supabase/scripts/preflight_227_salida_vinculada_empaquetado.sql", "supabase/scripts/postcheck_227_salida_vinculada_empaquetado.sql", "supabase/scripts/rollback_227_salida_vinculada_empaquetado.sql"]) {
      const s = sinComentarios(leer(f));
      const usos = (s.match(/information_schema\.columns/g) ?? []).length;
      const bases = (s.match(/table_type\s*=\s*'BASE TABLE'/g) ?? []).length;
      assert.ok(usos === 0 || bases >= 1, `${f}: ${usos} consulta(s) a information_schema.columns sin restringir a tablas base`);
    }
  });
  test("las funciones nuevas son SECURITY DEFINER con search_path fijo y sin acceso para anon/authenticated (salvo el envoltorio)", () => {
    for (const fn of ["trg_modo_oferta_vinculadas_63", "trg_invalidar_modo_oferta_63", "trg_salida_vinculada_63", "trg_vinculo_aereo_67_salida", "tarifario_trg_empaquetado_vinculadas_63"]) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated`), `${fn} sin revoke`);
    }
    assert.match(sql, /revoke all on function public\.publicar_tarifario_resultado_63\(.*\) from public, anon/);
    assert.match(sql, /grant execute on function public\.publicar_tarifario_resultado_63\(.*\) to authenticated/);
    assert.doesNotMatch(sql, /grant execute on function public\.publicar_tarifario_resultado_63\(.*\) to (anon|public)/);
    // Las dos únicas INVOKER a propósito: la guarda de inmutabilidad (solo compara OLD/NEW) y la del pendiente (igual que la 210:
    // anon/authenticated deben recibir el 42501 de RLS, no un rechazo propio).
    const INVOKER_A_PROPOSITO = new Set(["trg_p63_inmutable", "trg_p63_pendiente"]);
    for (const m of sql.matchAll(/create or replace function public\.(trg_[a-z0-9_]+|tarifario_trg_[a-z0-9_]+|publicar_tarifario_resultado_63)[\s\S]*?\$\$;/g)) {
      if (INVOKER_A_PROPOSITO.has(m[1])) {
        assert.doesNotMatch(m[0], /security definer/i, `${m[1]} debe ser INVOKER`);
        continue;
      }
      assert.match(m[0], /security definer/i, `${m[1]} no es SECURITY DEFINER`);
      assert.match(m[0], /set search_path = public, pg_temp/i, `${m[1]} sin search_path fijo`);
    }
  });
  test("la tabla de metadata es PRIVADA: RLS activada, sin policies y sin privilegios para anon/authenticated", () => {
    assert.match(sql, /alter table public\.tarifario_oferta_63 enable row level security/);
    assert.match(sql, /revoke all on table public\.tarifario_oferta_63 from public, anon, authenticated/);
    assert.doesNotMatch(sql, /create policy[^;]*tarifario_oferta_63/i);
  });
  test("el CHECK de la vinculada prohíbe doble margen y USD; el modo 63 exige Dinámico con TRM", () => {
    assert.match(sql, /salidas_dinamicas_vinculada_chk[\s\S]*aplica_mk = false and ta = 0 and moneda = 'COP'/);
    assert.match(sql, /armado_paquetes_modo63_chk[\s\S]*tipo::text = 'dinamico' and trm_oferta is not null/);
    assert.match(sql, /empaquetados_moneda_cop_chk check \(moneda = 'COP'\)/);
  });
  test("la fuente es FK RESTRICT y única por (paquete, fuente)", () => {
    assert.match(sql, /empaquetado_id bigint references public\.empaquetados\(id\) on delete restrict/);
    assert.match(sql, /create unique index salidas_dinamicas_paquete_empaquetado_uk\s+on public\.salidas_dinamicas \(paquete_id, empaquetado_id\) where empaquetado_id is not null/);
  });
  test("el vínculo aéreo de la 220 se reutiliza DIFERIDO (constraint trigger), sin copiar la regla de país", () => {
    assert.match(sql, /create constraint trigger tr_vinculo_aereo_67_salida[\s\S]*deferrable initially deferred/);
    assert.match(sql, /perform public\.validar_vinculo_aereo_67\(NEW\.paquete_id, 'empaquetado', NEW\.empaquetado_id\)/);
    assert.doesNotMatch(funcionSql(sql, "trg_vinculo_aereo_67_salida") + funcionSql(sql, "trg_salida_vinculada_63"), /pais_comparable_67|destinos_aereos_efectivos_67/, "la regla de país vive en la 220 y no se duplica");
  });
  test("el trigger propio escucha record, costo (N), tarifa (R), fee (F), destino, fechas, ruta, activo y compra", () => {
    const m = /create trigger tarifario_trg_empaquetado_vinculadas_63[\s\S]*?execute function/i.exec(sql);
    assert.ok(m);
    for (const col of ["record", "tarifa_proveedor", "tarifa_para_empaquetar", "fee_infante", "destino_id", "fecha_ida", "fecha_regreso", "ruta", "activo", "compra_inicio", "compra_fin", "moneda"]) {
      assert.match(m[0], new RegExp(`OLD\\.${col} is distinct from NEW\\.${col}`), `no escucha ${col}`);
    }
  });
  test("no hay DML sobre contratos, abonos ni cuentas por pagar existentes (aditiva)", () => {
    // Sentencias de NIVEL SUPERIOR (los cuerpos de función incluyen la escritura de la RPC financiera, que es la de la 210).
    assert.doesNotMatch(sinCuerpos(sql), /\b(update|delete from|insert into)\s+public\.(ventas|abonos|cuentas_por_pagar|cotizaciones|contrato_[a-z_]+)\b/i);
  });
  test("termina en commit y empieza en begin (una transacción)", () => {
    assert.match(sql.trim(), /^begin;/);
    assert.match(sql.trim(), /commit;$/);
  });
});

describe("contrato TS ↔ SQL: los prefijos de error que la app traduce existen en la base", () => {
  const sql = leer(MIG);
  const acciones = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
  for (const prefijo of ["salida_vinculada_modo", "salida_vinculada_record", "modo_oferta_vinculadas"]) {
    test(`la base lanza '${prefijo}' y la app lo traduce`, () => {
      assert.ok(sql.includes(prefijo), `${prefijo} no está en la migración`);
      assert.ok(acciones.includes(prefijo), `${prefijo} no se traduce en paquetes/actions.ts`);
    });
  }
  test("el índice único se llama como lo espera la app", () => {
    assert.ok(sql.includes("salidas_dinamicas_paquete_empaquetado_uk"));
    assert.ok(acciones.includes("salidas_dinamicas_paquete_empaquetado_uk"));
  });
  test("las columnas nuevas están en types/database.ts (salvo empaquetados.moneda, que no se tipa a propósito)", () => {
    const tipos = leer("types/database.ts");
    for (const col of ["modo_oferta", "trm_oferta", "empaquetado_id", "valor_cop_63", "trm_63", "publicar_tarifario_resultado_63"]) assert.ok(tipos.includes(col), `falta ${col}`);
  });
  test("el generador publica por el envoltorio SOLO en modo 63, y el resto de los paquetes sigue por el publicador de siempre", () => {
    assert.match(acciones, /modo63\s*\?\s*await sb\.rpc\("publicar_tarifario_resultado_63"/);
    assert.match(acciones, /:\s*await sb\.rpc\("publicar_tarifario_resultado", \{/);
  });
  test("la rama MANUAL del generador de la 226 sigue como estaba (la prueba de cableado de la 226 la fija)", () => {
    assert.match(acciones, /filasHoteles\(fIda, numNoches, aporteVueloVal, impuesto, "dinamico", null, label \|\| \(sal\.ruta \?\? "Salida"\), fReg, false, sal\.id as number, null, Number\(sal\.fee_infante\) \|\| 0\)/);
  });
});

describe("scripts y workflow de la 227", () => {
  const scripts = [
    "supabase/scripts/preflight_227_salida_vinculada_empaquetado.sql", "supabase/scripts/postcheck_227_salida_vinculada_empaquetado.sql",
    "supabase/scripts/rollback_227_salida_vinculada_empaquetado.sql", "supabase/scripts/test_227_salida_vinculada.sql", "supabase/scripts/test_227_fases.sh",
  ];
  for (const f of scripts) test(`existe ${f}`, () => assert.ok(existsSync(new URL(f, RAIZ))));

  test("preflight y postcheck son de SOLO LECTURA y terminan en rollback", () => {
    for (const f of ["supabase/scripts/preflight_227_salida_vinculada_empaquetado.sql", "supabase/scripts/postcheck_227_salida_vinculada_empaquetado.sql"]) {
      const s = sinCadenas(sinComentarios(leer(f)));
      assert.match(s, /begin transaction read only;/);
      assert.match(s.trim(), /rollback;$/);
      assert.doesNotMatch(s, /\b(insert into|update\s+public|delete from|drop |alter |create )/i, `${f} escribe`);
    }
  });
  test("el rollback se niega con uso y es forward-only después", () => {
    const s = leer("supabase/scripts/rollback_227_salida_vinculada_empaquetado.sql");
    assert.match(s, /rollback 227 ABORTADO/);
    for (const palabra of ["modo cop_trm_63", "salida(s) vinculada(s)", "equivalente COP congelado", "publicación(es) 63"]) assert.ok(s.includes(palabra), `no verifica: ${palabra}`);
  });
  test("el workflow: permisos de solo lectura, sin pull_request_target, sin secretos, acciones fijadas por SHA, imágenes con versión exacta", () => {
    const w = leer(WORKFLOW);
    const yaml = w.replace(/^\s*#.*$/gm, "");
    assert.match(w, /^permissions:\n  contents: read$/m);
    assert.doesNotMatch(yaml, /pull_request_target/);
    assert.doesNotMatch(yaml, /\$\{\{\s*secrets\./);
    assert.match(w, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4\.2\.2/);
    assert.match(w, /IMAGEN_PG: supabase\/postgres:15\.8\.1\.085/);
    assert.match(w, /IMAGEN_NODE: node:24\.14\.0-bookworm-slim/);
    assert.match(w, /preparar_esquema_local\.sh "\$CT" 226 "\$PLANTILLA"/, "el esquema parte de la cadena hasta la 226");
    assert.match(w, /set \+e/, "set +e antes de cada tee");
    assert.match(w, /TEST 227 FASES: TODO OK/);
    assert.match(w, /TEST 227 SQL: TODO OK/);
  });
  test("las pruebas que el workflow lista existen", () => {
    const w = leer(WORKFLOW);
    for (const m of w.matchAll(/pruebas\/[A-Za-z0-9]+\.(?:test\.ts|react\.ts)/g)) assert.ok(existsSync(new URL(m[0], RAIZ)), `el workflow lista ${m[0]} y no existe`);
  });
  test("package.json no registra las pruebas React de la 227 (van por comando directo): la ÚNICA excepción es la de la oferta en USD (234), pedida por el dueño", () => {
    const pkg = leer("package.json");
    assert.doesNotMatch(pkg, /salidaVinculada63(?!Usd\.react\.ts)/);
    assert.match(pkg, /"test:react":[^\n]*pruebas\/salidaVinculada63Usd\.react\.ts/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E/F/G · aceptación atómica con snapshot privado, fencing de la cabecera, finalización derivada
// (cableado estático; el comportamiento real está en test_227_salida_vinculada.sql, test_227_carrera.sh y los .react.ts)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("E/F/G: tablas privadas y RPC solo service_role", () => {
  const mig = leer(MIG);
  const sql = sinComentarios(mig);
  test("p63_oferta y p63_aceptacion son PRIVADAS: RLS activada, sin policies y sin privilegios para anon/authenticated", () => {
    for (const t of ["p63_oferta", "p63_aceptacion"]) {
      assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      assert.match(sql, new RegExp(`revoke all on table public\\.${t}\\s+from public, anon, authenticated`));
      assert.doesNotMatch(sql, new RegExp(`create policy[^;]*${t}`, "i"));
    }
  });
  test("crear_cotizacion_oferta_63 y aceptar_oferta_63 son SECURITY DEFINER, con search_path fijo y SOLO service_role", () => {
    for (const [fn, firma] of [["crear_cotizacion_oferta_63", "uuid, text, jsonb, jsonb, text, text, jsonb"], ["aceptar_oferta_63", "bigint, text, uuid, text, text"]]) {
      assert.match(funcionSql(sql, fn), /security definer/i);
      assert.match(funcionSql(sql, fn), /set search_path = public, pg_temp/i);
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(${firma}\\) from public, anon, authenticated`));
      assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(${firma}\\) to service_role`));
      assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to (authenticated|anon|public)`));
    }
  });
  test("las 15 funciones internas nuevas (p63_* y triggers) no se otorgan a anon ni authenticated", () => {
    for (const fn of FUNCIONES_EFG.filter((f) => !["crear_cotizacion_oferta_63", "aceptar_oferta_63"].includes(f))) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`), `${fn} sin revoke`);
    }
  });
  test("las tablas privadas llevan auditoría (087) y sus snapshots son inmutables (UPDATE y DELETE rechazados)", () => {
    assert.match(sql, /create trigger trg_auditoria after insert or delete or update on public\.p63_oferta/);
    assert.match(sql, /create trigger trg_auditoria after insert or delete or update on public\.p63_aceptacion/);
    assert.match(sql, /create trigger trg_p63_oferta_inmutable\s+before update or delete on public\.p63_oferta/);
    assert.match(sql, /create trigger trg_p63_aceptacion_inmutable\s+before update or delete on public\.p63_aceptacion/);
    assert.match(funcionSql(sql, "trg_p63_inmutable"), /p63_historico/);
  });
  test("la cotización y su oferta se crean en UNA transacción y la RPC verifica las 4 revisiones de T0 bajo candado", () => {
    const f = funcionSql(sql, "crear_cotizacion_oferta_63");
    assert.match(f, /from public\.armado_paquetes p where p\.id = v_paquete for share/);
    for (const rev of ["rev_fuente", "rev_publicada", "gen_publicada", "rev_costos"]) assert.match(f, new RegExp(rev));
    assert.ok(f.indexOf("p63_oferta_cambio") < f.indexOf("insert into public.cotizaciones"), "las revisiones se verifican ANTES de insertar");
    assert.ok(f.indexOf("insert into public.cotizaciones") < f.indexOf("insert into public.p63_oferta"));
  });
});

describe("E/F/G: aceptar_oferta_63 — orden de candados, reloj y revalidación", () => {
  const sql = sinComentarios(leer(MIG));
  const f = funcionSql(sql, "aceptar_oferta_63");
  test("candados hoja → paquete: fuente (FOR SHARE) → salida (FOR SHARE) → paquete (FOR NO KEY UPDATE) → oferta (FOR UPDATE)", () => {
    const i1 = f.indexOf("from public.empaquetados e where e.id = v_emp for share");
    const i2 = f.indexOf("from public.salidas_dinamicas s where s.id = v_salida for share");
    const i3 = f.indexOf("for no key update");
    const i4 = f.indexOf("from public.p63_oferta where id = v_o.id for update");
    assert.ok(i1 > 0 && i1 < i2 && i2 < i3 && i3 < i4, `orden de candados: ${[i1, i2, i3, i4]}`);
  });
  test("NUNCA toma ni escribe la venta (la finalización y la reversión sí: venta → oferta → aceptación; no hay ciclo)", () => {
    assert.doesNotMatch(f, /public\.ventas/);
  });
  test("la fecha de negocio sale del reloj de Bogotá tomado DESPUÉS de los candados (clock_timestamp), no de la hora de inicio de la transacción", () => {
    assert.match(f, /v_hoy := public\.p63_hoy_bogota\(\)/);
    assert.ok(f.indexOf("v_hoy := public.p63_hoy_bogota()") > f.indexOf("for no key update"));
    assert.match(funcionSql(sql, "p63_hoy_bogota"), /clock_timestamp\(\) at time zone 'America\/Bogota'/);
  });
  test("revalida AHORA: paquete activo/modo/TRM, tarifario publicado, revisiones y contador de costos, huellas, salida, fuente y destino aéreo (220)", () => {
    for (const marca of ["v_activo is not true", "v_trm is distinct from v_o.trm", "v_publica is not true", "v_rev_p is distinct from v_o.rev_publicada",
      "v_gen_p is distinct from v_o.gen_publicada", "v_rev_f is distinct from v_o.rev_fuente", "v_rev_c is distinct from v_o.rev_costos",
      "p_huella is distinct from v_o.huella", "p_huella_financiera is distinct from v_o.huella_financiera", "v_s.compra_inicio", "v_s.compra_fin",
      "v_e.record", "v_e.moneda is distinct from 'COP'", "public.validar_vinculo_aereo_67(v_paquete, 'empaquetado', v_emp)"]) {
      assert.ok(f.includes(marca), `aceptar_oferta_63 no revalida: ${marca}`);
    }
  });
  test("el número se reserva en la MISMA transacción (generador de mayorista) y el reintento devuelve el MISMO intento", () => {
    assert.match(f, /public\.siguiente_numero_contrato_para_tenant\(p_tenant\)/);
    assert.ok(f.indexOf("estado <> 'descartada'") < f.indexOf("siguiente_numero_contrato_para_tenant"), "primero se busca el intento vigente, después se gasta un consecutivo");
    assert.match(f, /p63_oferta_cerrada/);
  });
});

describe("E/F/G: fencing de la cabecera, pendiente, obligaciones aceptadas y finalización derivada", () => {
  const mig = leer(MIG);
  const sql = sinComentarios(mig);
  test("BEFORE INSERT en ventas: un número reservado solo lo crea el intento vigente, con lo aceptado, y lo marca 'materializando' en el mismo insert", () => {
    const f = funcionSql(sql, "trg_ventas_aceptacion_63_ins");
    assert.match(sql, /create trigger trg_ventas_aceptacion_63_ins\s+before insert on public\.ventas/);
    for (const m of ["where a.numero_contrato = new.numero_contrato for update", "v_a.estado <> 'preparada'", "tipo_paquete", "precio_venta", "costo_aereo", "impuesto", "fecha_salida"]) assert.ok(f.includes(m), m);
    assert.ok(f.indexOf("raise exception 'p63_cabecera: la cabecera no coincide") < f.indexOf("set estado = 'materializando'"), "valida y SOLO ENTONCES marca");
  });
  test("la reversión descarta el intento y reabre la oferta tomando los candados en el orden oferta → aceptación (el mismo de aceptar)", () => {
    const f = funcionSql(sql, "trg_ventas_borrada_63");
    assert.match(sql, /create trigger trg_ventas_borrada_63\s+after delete on public\.ventas/);
    assert.ok(f.indexOf("from public.p63_oferta o where o.id = v_oferta for update") < f.indexOf("update public.p63_aceptacion"), "oferta ANTES que aceptación");
    assert.match(f, /estado <> 'completa'/, "un intento completo no se descarta ni se reabre");
  });
  test("el pendiente solo guarda lo aceptado, tras los hijos; la guarda es INVOKER y deja pasar a anon/authenticated al 42501 de RLS", () => {
    const f = funcionSql(sql, "p63_validar_pendiente");
    assert.ok(f.indexOf("p63_payload_alterno") < f.indexOf("p63_hijos_pendientes"), "payload exacto y luego hijos");
    assert.match(sql, /create trigger trg_p63_pendiente\s+before insert or update on public\.contrato_financiero_pendiente/);
    assert.match(funcionSql(sql, "trg_p63_pendiente"), /current_user in \('anon', 'authenticated'\)[\s\S]*return new/);
  });
  test("las obligaciones aceptadas protegen principal, moneda, proveedor, servicio y retención; el borrado es DIFERIDO (eliminar_contrato sigue pudiendo)", () => {
    const f = funcionSql(sql, "trg_cxp_aceptacion_63");
    for (const c of ["valor_total", "moneda", "proveedor", "tipo_proveedor", "servicio", "aplica_retencion", "pct_retencion", "valor_cop_63", "trm_63", "obligacion_63", "aceptacion_63_id"]) {
      assert.match(f, new RegExp(`new\\.${c} is distinct from old\\.${c}`), `no protege ${c}`);
    }
    assert.match(sql, /create constraint trigger trg_cxp_borrada_63\s+after delete on public\.cuentas_por_pagar\s+deferrable initially deferred/);
    assert.match(funcionSql(sql, "trg_cxp_borrada_63"), /exists \(select 1 from public\.ventas v where v\.numero_contrato = old\.numero_contrato/);
  });
  test("los costos del contrato aceptado solo los escribe la RPC financiera (bandera de transacción app.p63_h)", () => {
    assert.match(funcionSql(sql, "trg_ventas_costos_63"), /current_setting\('app\.p63_h', true\)/);
    assert.match(funcionSql(sql, "p63_registrar_financiero"), /set_config\('app\.p63_h', 'on', true\)[\s\S]*set_config\('app\.p63_h', 'off', true\)/);
  });
  test("p63_registrar_financiero: aceptación vigente, payload derivado (rechaza el alterno), pendiente exacto, hijos completos; marca la aceptación completa", () => {
    const f = funcionSql(sql, "p63_registrar_financiero");
    const orden = ["v_a.estado <> 'materializando'", "p63_payload_alterno", "p63_sin_pendiente", "p63_hijos_pendientes", "set_config('app.p63_h', 'on', true)", "insert into public.cuentas_por_pagar", "update public.p63_aceptacion set estado = 'completa'"];
    let ultimo = -1;
    for (const o of orden) { const i = f.indexOf(o); assert.ok(i > ultimo, `fuera de orden: ${o}`); ultimo = i; }
    assert.match(f, /aceptacion_63_id, obligacion_63/);
  });
  test("el contador de costos se incrementa por trigger en la MISMA transacción del cambio (hoteles, acomodaciones, servicios, proveedores, vuelo fuente)", () => {
    for (const t of ["hoteles", "hotel_acomodaciones", "servicios_adicionales", "proveedores", "empaquetados"]) {
      assert.match(sql, new RegExp(`on public\\.${t}\\s+for each row execute function public\\.trg_p63_costos_`), `sin trigger de costos en ${t}`);
    }
    assert.match(funcionSql(sql, "p63_bump_costos"), /modo_oferta = 'cop_trm_63'/);
  });
});

describe("E/F/G: el orquestador TS materializa SOLO desde lo aceptado", () => {
  const acciones = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const cuerpoReserva = (() => {
    const i = acciones.indexOf("async function reservarDesdeTarifarioInterno(input: ReservaInput");
    const j = acciones.indexOf("// Costos y cuentas por pagar (CxP) de una reserva del tarifario", i);
    assert.ok(i > 0 && j > i);
    return acciones.slice(i, j);
  })();
  test("el número sale de la aceptación (63) o del consecutivo de siempre (else), y la aceptación va ANTES del insert de la venta", () => {
    assert.match(cuerpoReserva, /if \(oferta63\) \{[\s\S]*?aceptarOferta63\(adminAcept[\s\S]*?\} else \{\s*const numRes = await siguienteNumeroContrato\(tenant\);/);
    assert.ok(cuerpoReserva.indexOf("aceptarOferta63(") < cuerpoReserva.indexOf('from("ventas").insert'), "aceptar antes de insertar la cabecera");
    assert.equal((cuerpoReserva.match(/siguienteNumeroContrato\(tenant\)/g) ?? []).length, 1);
  });
  test("la cabecera lleva el marcador de su aceptación y los hijos (hotel, tramos, ítems) salen del snapshot devuelto", () => {
    assert.match(cuerpoReserva, /aceptacion_63_id: aceptacion63\?\.aceptacion_id \?\? null/);
    assert.match(cuerpoReserva, /\.\.\.aceptacion63\.snapshot\.hotel/);
    assert.match(cuerpoReserva, /aceptacion63\.snapshot\.tramos\.map\(/);
    assert.match(cuerpoReserva, /aceptacion63\.snapshot\.items\.map\(/);
  });
  test("las finanzas de la rama 63 son EXACTAMENTE las que devolvió la aceptación; el cálculo vivo solo se usa para COMPARAR la huella", () => {
    assert.match(cuerpoReserva, /cxp = aceptacion63\.financiero\.cxp as unknown as CxPFinanciera\[\]/);
    assert.match(cuerpoReserva, /costosContrato = aceptacion63\.financiero\.costos as CostosContrato/);
    assert.equal((cuerpoReserva.match(/calcularFinancieroReserva\(/g) ?? []).length, 2, "una vez para la huella (63) y una para el contrato de siempre");
    assert.match(cuerpoReserva, /const vivo63 = await calcularFinancieroReserva[\s\S]*?huellaFinanciera63\(/);
    assert.match(cuerpoReserva, /\} else \{\s*const finCalc = await calcularFinancieroReserva/);
  });
  test("convertirCotizacion pasa SU id como cotizacionId (lo que venga del navegador al cotizar se descarta)", () => {
    assert.match(acciones, /oferta63: payload\.oferta63 \? \{ \.\.\.payload\.oferta63, cotizacionId: id, trmProvisional: trmProvisional \?\? null, monedaCobro: monedaCobro \?\? null, trmCobro: trmCobro \?\? null \} : payload\.oferta63/);
  });
  test("cotizar: T0 se lee ANTES de calcular y la cotización + oferta se guardan por la RPC atómica (la inserción directa queda solo para lo de siempre)", () => {
    const i = acciones.indexOf("export async function crearCotizacion(");
    const c = acciones.slice(i, acciones.indexOf("export async function convertirCotizacion(", i));
    assert.ok(c.indexOf("leerRevisiones63(") < c.indexOf("computarReserva(sb, input)"), "T0 antes de calcular");
    assert.ok(c.indexOf("crearCotizacionOferta63(") > c.indexOf("construirSnapshot63("));
    assert.match(c, /if \(oferta63\) \{[\s\S]*?crearCotizacionOferta63[\s\S]*?\} else \{\s*const \{ data: row0, error \} = await sbCot\.from\("cotizaciones"\)\.insert\(/);
  });
  test("asientos.ts falla CERRADO: no hay caída al nominal ante errores de lectura (ni 42703 ni 'valor_cop_63')", () => {
    const a = leer("lib/contabilidad/asientos.ts");
    assert.doesNotMatch(a, /42703/);
    assert.doesNotMatch(a, /\/valor_cop_63\/\.test/);
    assert.match(a, /resolverImporteContable63\(/);
    assert.match(a, /if \(error\) return \{ ok: false, error: MENSAJE_LECTURA_CXP_63 \}/);
  });
  test("asegurarCuentasPorPagar distingue AUSENCIA de marca de FALLO de lectura y nunca complementa un contrato #63", () => {
    const a = leer("lib/reservar/asegurarCuentasPorPagar.ts");
    assert.match(a, /if \(errVenta\) return \{ ok: false/);
    assert.match(a, /if \(aceptacion63 != null\) \{/);
    assert.ok(a.indexOf("if (aceptacion63 != null) {") < a.indexOf("faltantesCxP("), "el desvío 63 va antes del algoritmo de faltantes");
    assert.match(a, /requiereRevision: true/);
  });
  test("el script de carreras de dos sesiones existe y el workflow lo corre", () => {
    assert.ok(existsSync(new URL("supabase/scripts/test_227_carrera.sh", RAIZ)));
    assert.match(leer(WORKFLOW), /test_227_carrera\.sh/);
  });
});

describe("ciclo 5: plan B2B congelado y vigencias de compra dentro de la aceptación", () => {
  const sql = leer(MIG);
  const acciones = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const snapshotTs = leer("lib/reservar/aceptacion63.ts");
  const computo = leer("lib/reservar/computo.ts");
  const aceptar = funcionSql(sql, "aceptar_oferta_63");
  const fencing = funcionSql(sql, "trg_ventas_aceptacion_63_ins");

  test("aceptar_oferta_63 valida las vigencias de compra del snapshot con p63_hoy_bogota() ANTES de reservar el número, sin depender de ningún UPDATE", () => {
    assert.match(aceptar, /v_hoy := public\.p63_hoy_bogota\(\)/);
    assert.match(aceptar, /jsonb_array_elements\(coalesce\(v_snap -> 'vigencias', '\[\]'::jsonb\)\)/);
    assert.match(aceptar, /v_hoy < \(v_vig ->> 'compra_inicio'\)::date/);
    assert.match(aceptar, /v_hoy > \(v_vig ->> 'compra_fin'\)::date/);
    assert.match(aceptar, /p63_oferta_cambio: la tarifa "%" de % ya no está en su vigencia de compra/);
    assert.doesNotMatch(aceptar.slice(aceptar.indexOf("v_vig ->> 'compra_fin'") - 400, aceptar.indexOf("v_vig ->> 'compra_fin'") + 400), /current_date|now\(\)/, "la vigencia usa SOLO el reloj de negocio de Bogotá");
    const iVig = aceptar.indexOf("jsonb_array_elements(coalesce(v_snap -> 'vigencias'");
    const iNumero = aceptar.search(/nextval|reservar_numero|numero_contrato\s*:=|v_numero\s*:=/);
    assert.ok(iVig > 0 && iNumero > iVig, "las vigencias se validan antes de reservar el número");
  });
  test("la cabecera se contrasta contra el plan B2B ACEPTADO (snapshot.b2b), no contra un recálculo con el % de hoy", () => {
    for (const marca of ["v_b2b := v_a.snapshot -> 'b2b'", "'tipo_asesor'", "'canal'", "(v_b2b ->> 'aliado_id')::bigint", "v_b2b ->> 'modo_compra'", "v_b2b ->> 'comision'", "v_b2b ->> 'comision_estado'", "(v_b2b ->> 'precio_final')::numeric"]) {
      assert.ok(fencing.includes(marca), `el fencing no contrasta ${marca}`);
    }
    assert.doesNotMatch(fencing, /new\.modo_compra = 'neta' then greatest\(0, v_precio/, "el precio neto ya no se recalcula en el fencing");
  });
  test("el % del aliado y el parámetro general mueven el contador de costos en la MISMA transacción (aliados, parametros_tributarios)", () => {
    assert.match(sql, /create trigger trg_p63_costos_aliados\s+after update of pct_comision, tipo on public\.aliados/);
    assert.match(sql, /create trigger trg_p63_costos_parametros_upd\s+after update of valor on public\.parametros_tributarios/);
    assert.match(sql, /create trigger trg_p63_costos_parametros_ins\s+after insert on public\.parametros_tributarios/);
    assert.match(sql, /'COMISION_AGENCIA', 'COMISION_FREELANCE'/);
    assert.match(funcionSql(sql, "p63_bump_costos_todos"), /update public\.armado_paquetes set p63_rev_costos = p63_rev_costos \+ 1 where modo_oferta = 'cop_trm_63'/);
  });
  test("las funciones nuevas del ciclo 5 son solo del servicio: sin acceso de anon / authenticated", () => {
    for (const fn of ["p63_bump_costos_todos", "trg_p63_costos_b2b"]) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated`), `${fn} sin revoke`);
    }
  });
  test("TS: el snapshot guarda el plan B2B y las vigencias, y la huella financiera los incluye (cotizar y aceptar la calculan igual)", () => {
    assert.match(snapshotTs, /b2b: PlanB2bSnapshot63 \| null;\s+vigencias: VigenciaCompra63\[\];/);
    assert.match(snapshotTs, /jsonCanonico63\(b2b \? \{ \.\.\.resto, b2b \} : resto\)/);
    assert.match(acciones, /huellaFinanciera63\(\{ \.\.\.snapshot63\.financiero, b2b: snapshot63\.b2b \}\)/);
    assert.match(acciones, /construirObligaciones63\(vivo63\.cxp, oferta63\.trm\), b2b: planVivo63 \}/);
    assert.match(acciones, /vigencias: comp\.data\.vigencias63/);
  });
  test("TS: la cabecera B2B sale del snapshot aceptado; ya no se recalcula con el % vivo (sin pctAliado63)", () => {
    assert.doesNotMatch(acciones, /pctAliado63/);
    assert.match(acciones, /const b2b63 = aceptacion63\.snapshot\.b2b;/);
    assert.match(acciones, /precioFinal: b2b63\.precio_final/);
    assert.match(acciones, /b2b63\.aliado_id !== aliadoB2B/);
  });
  test("TS: el aliado de una oferta #63 se lee con el MISMO cliente al cotizar y al aceptar (service-role), no con la sesión de quien convierte", () => {
    assert.match(acciones, /const lector63 = oferta63 && process\.env\.SUPABASE_SERVICE_ROLE_KEY \? createAdminClient\(\) : null;\s+const al = lector63\s+\? await resolverAliadoReserva\(lector63, input\.tipoAsesor, input\.aliadoId\)\s+: await resolverAliadoReserva\(sb, input\.tipoAsesor, input\.aliadoId\);/);
    assert.match(acciones, /resolverAliadoReserva\(admin, input\.tipoAsesor, input\.aliadoId\)/);
  });
  test("computo.ts recoge las vigencias de compra de hotel (noches de habitación y menores) y de servicios solo en una oferta #63", () => {
    assert.match(computo, /vigencias63: VigenciaCompra63\[\];/);
    assert.match(computo, /if \(oferta63\) \{\s+for \(const t of r\.temporadasTarifa\) nombresVigHotel63\.add\(t\);/);
    assert.match(computo, /recogerVigenciaMenor63\("nino", precioFinalTemporadasMenores\)/);
    assert.match(computo, /recogerVigenciaMenor63\("nino2", precioFinalTemporadasMenores\)/);
    assert.match(computo, /recogerVigenciaMenor63\("infante", precioFinalTemporadasMenores\)/);
    assert.match(computo, /vigencias63\.push\(\{ origen: "servicio", ref: `\$\{id\}\|\$\{q\.temporada\}`/);
    assert.match(computo, /oferta63: oferta63 \? \{ \.\.\.oferta63, monedaHotel: monedaHotelOrigen63, monedaServicios: monedaServicios63 \} : null, vigencias63 \}/);
  });
});
