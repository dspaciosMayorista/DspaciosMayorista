import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// 226 — CABLEADO: la migración es aditiva; los caminos que leen o escriben el precio/costo del infante usan la
// fuente única (lib/reservar/menoresDeDos.ts + computarReserva); el workflow cumple las reglas del repo.
// Pruebas sobre el fuente (complemento de tarifaInfante226.test.ts, que EJECUTA el motor).

const APP = join(import.meta.dirname, "..");
const REPO = join(APP, "..");
const leer = (rel: string) => readFileSync(join(APP, rel), "utf8").replace(/\r\n/g, "\n");
const leerRepo = (rel: string) => readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentariosSql = (s: string) => s.replace(/--.*$/gm, "");

const MIGRACION = "supabase/migrations/20260601000226_tarifa_infante.sql";
const SCRIPTS = [
  "supabase/scripts/preflight_226_tarifa_infante.sql",
  "supabase/scripts/postcheck_226_tarifa_infante.sql",
  "supabase/scripts/rollback_226_tarifa_infante.sql",
  "supabase/scripts/test_226_tarifa_infante.sql",
  "supabase/scripts/test_226_fases.sh",
];

describe("migración 226: aditiva y con su kit completo", () => {
  const mig = leer(MIGRACION);
  const migSql = sinComentariosSql(mig);
  // Instrucciones de nivel superior: sin los cuerpos de funciones y bloques DO ($$ ... $$), que sí insertan/borran
  // (crear_bloqueo crea sillas, el publicador reemplaza el snapshot) porque ASÍ eran en la 181/195.
  const migTop = migSql.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  test("existen la migración, preflight, postcheck, rollback, batería, fases y workflow", () => {
    for (const f of [MIGRACION, ...SCRIPTS]) assert.ok(existsSync(join(APP, f)), f);
    assert.ok(existsSync(join(REPO, ".github/workflows/test-226-tarifa-infante.yml")));
  });
  test("no toca policies, privilegios de tablas ni datos: sin create/drop/alter policy, sin insert/update/delete/truncate de datos", () => {
    assert.doesNotMatch(migSql, /\b(create|drop|alter)\s+policy\b/i);
    assert.doesNotMatch(migSql, /\btruncate\b/i);
    assert.doesNotMatch(migSql, /\bdrop\s+(table|column)\b/i);
    assert.doesNotMatch(migTop, /^\s*(insert\s+into|delete\s+from)\b/im);
    // Los únicos UPDATE son de la sintaxis `update of <columnas>` de los triggers.
    assert.doesNotMatch(migTop.replace(/update of [a-z_, ]+/gi, ""), /\bupdate\s+public\./i);
    assert.doesNotMatch(migSql, /\bgrant\s+(select|insert|update|delete|all)\b[^;]*\bon\s+(table\s+)?public\.(bloqueos_vuelo|servicios_adicionales|servicio_temporadas|tarifario_resultado|ventas)\b/i);
  });
  test("agrega exactamente las 4 columnas con sus CHECK y reemplaza lo esperado, nada más", () => {
    assert.match(migSql, /add column if not exists fee_infante numeric\(15,2\) not null default 0/);
    assert.match(migSql, /alter table public\.servicios_adicionales\s+add column if not exists precio_infante numeric\(15,2\)/);
    assert.match(migSql, /alter table public\.servicio_temporadas\s+add column if not exists precio_infante numeric\(15,2\)/);
    assert.match(migSql, /alter table public\.tarifario_resultado\s+add column if not exists precio_pvp_menor2 numeric\(15,2\)/);
    const alteradas = [...migSql.matchAll(/alter table public\.(\w+)/gi)].map((m) => m[1]);
    assert.deepEqual([...new Set(alteradas)].sort(), ["bloqueos_vuelo", "servicio_temporadas", "servicios_adicionales", "tarifario_resultado"]);
    const funciones = [...migSql.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).sort();
    assert.deepEqual(funciones, ["crear_bloqueo", "publicar_tarifario_resultado", "tarifario_trg_bump_servicio_catalogo"]);
    const vistas = [...migSql.matchAll(/create or replace view public\.(\w+)/gi)].map((m) => m[1]).sort();
    assert.deepEqual(vistas, ["tarifario_resultado_publicable", "tarifario_resumen"]);
  });
  test("el publicador y crear_bloqueo conservan SECURITY DEFINER, search_path y los grants (nunca anon)", () => {
    assert.match(migSql, /revoke all on function public\.publicar_tarifario_resultado\(bigint, bigint, bigint, text, jsonb\) from public, anon;/);
    assert.match(migSql, /grant execute on function public\.publicar_tarifario_resultado\(bigint, bigint, bigint, text, jsonb\) to authenticated;/);
    assert.match(migSql, /revoke all on function public\.crear_bloqueo\(jsonb, integer\) from public, anon;/);
    assert.match(migSql, /grant execute on function public\.crear_bloqueo\(jsonb, integer\) to authenticated;/);
    assert.match(migSql, /revoke all on function public\.tarifario_trg_bump_servicio_catalogo\(\) from public, anon, authenticated;/);
    assert.doesNotMatch(migSql, /grant\s+[^;]*\bto\s+anon\b/i);
  });
  test("los triggers de invalidación escuchan fee_infante y precio_infante", () => {
    assert.match(migSql, /after insert or delete or update of nombre, descripcion, precio_persona, precio_infante, recargo_individual, liquidacion, moneda\s+on public\.servicios_adicionales/);
    assert.match(migSql, /update of tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta\s+on public\.bloqueos_vuelo/);
    assert.match(migSql, /update of activo, compra_inicio, compra_fin, tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta\s+on public\.empaquetados/);
    assert.match(migSql, /NEW\.precio_infante is not distinct from OLD\.precio_infante/);
  });
  test("tarifario_resumen.precio_infante pasa a ser el precio del menor de 2 años (coalesce con precio_pvp para filas viejas)", () => {
    assert.match(migSql, /min\(coalesce\(r\.precio_pvp_menor2, r\.precio_pvp\)\) filter \(where r\.acomodacion = 'infante'\) as precio_infante/);
  });
  test("el rollback se niega con datos en las columnas nuevas, restaura el texto original y retira las columnas", () => {
    const rb = leer(SCRIPTS[2]);
    assert.match(rb, /ROLLBACK 226 ABORTADO/);
    assert.match(rb, /drop column if exists precio_pvp_menor2/);
    assert.match(rb, /drop column if exists fee_infante/);
    assert.match(rb, /drop column if exists precio_infante/);
    // El texto restaurado del publicador y de crear_bloqueo es el de la 181/195: sin las columnas nuevas.
    const parteFunciones = rb.slice(rb.indexOf("-- Funciones (texto de la 181/195)"), rb.indexOf("-- Columnas (vacías"));
    assert.ok(parteFunciones.includes("create or replace function public.publicar_tarifario_resultado("));
    assert.ok(parteFunciones.includes("create or replace function public.crear_bloqueo("));
    assert.doesNotMatch(parteFunciones, /precio_pvp_menor2|fee_infante/);
  });
  test("preflight y postcheck son de solo lectura y terminan en ROLLBACK", () => {
    for (const f of [SCRIPTS[0], SCRIPTS[1]]) {
      const s = leer(f);
      assert.match(s, /begin transaction read only;/);
      assert.match(s.trim(), /rollback;$/);
      assert.doesNotMatch(sinComentariosSql(s), /\b(insert\s+into|update\s+public|delete\s+from|create\s+(table|function)|alter\s+table|drop\s+)/i);
    }
  });
  test("el postcheck trata un objeto ausente (NULL) como FALLA, no como verde", () => {
    assert.match(leer(SCRIPTS[1]), /coalesce\(ok, false\) as ok/);
  });
  test("ninguna variable PL/pgSQL de los scripts 226 se llama como una columna (evita la sombra de nombres)", () => {
    const columnas = new Set(["id", "record", "fee_infante", "precio_infante", "precio_pvp_menor2", "precio_pvp", "paquete_id", "bloqueo_id", "activo", "estado", "nombre", "tarifa_neta", "numero_contrato", "servicio_id"]);
    for (const f of [MIGRACION, SCRIPTS[2], SCRIPTS[3]]) {
      const s = sinComentariosSql(leer(f));
      for (const bloque of s.matchAll(/\bdeclare\b([\s\S]*?)\bbegin\b/gi)) {
        for (const linea of bloque[1].split(/;\s*\n?/)) {
          const nombre = linea.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i)?.[1]?.toLowerCase();
          if (nombre) assert.ok(!columnas.has(nombre), `${f}: la variable "${nombre}" tiene nombre de columna`);
        }
      }
    }
  });
  test("las fixtures de contratos usan numeración DTM-NNNN", () => {
    for (const f of [SCRIPTS[3], SCRIPTS[4]]) {
      const s = leer(f);
      const contratos = [...s.matchAll(/'((?:DTM|MIN)-[0-9A-Za-z-]+)'/g)].map((m) => m[1]);
      assert.ok(contratos.length > 0, f);
      for (const c of contratos) assert.match(c, /^DTM-\d{4}$/, `${f}: ${c}`);
    }
    assert.doesNotMatch(leer(SCRIPTS[3]), /'(?:00-\d{4}|MIN-)/);
  });
  test("la batería no compara contra conteos literales de tablas compartidas (conteos reales de sus propias fixtures)", () => {
    const s = sinComentariosSql(leer(SCRIPTS[3]));
    // Toda comparación de un count(*) con un literal debe estar acotada por una fixture propia (id/record/paquete de la prueba).
    for (const m of s.matchAll(/count\(\*\)[^;\n]*?\bfrom\b([^;\n]*)/gi)) {
      const resto = m[0];
      if (!/=\s*\d+\b/.test(resto)) continue;
      assert.match(resto, /(226\d{3}|T226|record|bloqueo_id|paquete_id|numero_contrato)/i, `conteo literal sin acotar: ${resto.slice(0, 160)}`);
    }
  });
});

describe("workflow test-226-tarifa-infante.yml cumple las reglas del repo", () => {
  const wfCompleto = leerRepo(".github/workflows/test-226-tarifa-infante.yml");
  const wf = wfCompleto.replace(/^\s*#.*$/gm, "");   // los comentarios pueden NOMBRAR lo prohibido
  test("permisos de solo lectura, sin pull_request_target, sin secretos ni Supabase remoto", () => {
    assert.match(wf, /^permissions:\n  contents: read$/m);
    assert.doesNotMatch(wf, /pull_request_target/);
    assert.doesNotMatch(wf, /\$\{\{\s*secrets\./);
    assert.doesNotMatch(wf, /supabase\.co|SUPABASE_(URL|SERVICE_ROLE_KEY|ANON_KEY)/);
    assert.doesNotMatch(wf, /\.env/);
  });
  test("toda acción va fijada por SHA de 40 caracteres", () => {
    const usos = [...wf.matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(usos.length > 0);
    for (const u of usos) assert.match(u, /@[0-9a-f]{40}$/, `acción sin SHA: ${u}`);
  });
  test("`set +e` antes de CADA pipeline con tee", () => {
    const pasos = wf.split(/\n      - name:/).slice(1);
    const conTee = pasos.filter((p) => /\|\s*tee\b/.test(p));
    assert.ok(conTee.length >= 2, "debe haber pipelines con tee");
    for (const p of conTee) {
      const iSet = p.indexOf("set +e");
      const iTee = p.search(/\|\s*tee\b/);
      assert.ok(iSet >= 0 && iSet < iTee, `falta set +e antes del tee en el paso: ${p.slice(0, 80)}`);
    }
  });
  test("el esquema parte de la cadena real hasta la 225 y corre las fases y las pruebas TS", () => {
    assert.match(wf, /preparar_esquema_local\.sh "\$CT" 225 "\$PLANTILLA"/);
    assert.match(wf, /test_226_fases\.sh/);
    assert.match(wf, /tarifaInfante226\.test\.ts/);
    assert.match(wf, /tarifaInfante226Cableado\.test\.ts/);
    assert.match(wf, /TEST 226 FASES: TODO OK/);
    assert.match(wf, /TEST 226 SQL: TODO OK/);
  });
});

describe("los caminos de venta usan la fuente única de menores de 2 años", () => {
  const computo = leer("lib/reservar/computo.ts");
  const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const buscador = leer("lib/reservar/cotizar.ts");
  const generador = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
  const origen = leer("lib/reservar/empaquetadoOrigen.ts");

  test("computarReserva: precio por tarifarMenores, lectura de precio_pvp_menor2, servicios con el pax de 2+ años", () => {
    assert.match(computo, /tarifarMenores\(/);
    assert.match(computo, /precio_pvp, precio_pvp_menor2, hotel_nombre/);
    assert.match(computo, /const paxServAdulto = esServicios \? totalPax : paxConSilla;/);
    assert.match(computo, /precioServicio\(s\.modo, s\.personaPvp, s\.grupos, paxServAdulto\)/);
    assert.match(computo, /cargoGrupoIncluido\(gruposIncluidosPendientes, paxServAdulto,/);
    assert.match(computo, /precio_infante/);
    // Los dos sitios que sumaban pvpPorAcom["infante"] a mano ya no existen.
    assert.doesNotMatch(computo, /numInfantes \* pvpPorAcom\["infante"\]/);
  });
  test("reservar: el fee de infante del vuelo se cobra por menor de 2 años calculado (no por input.infantes) y los ítems salen de lineasMenores", () => {
    assert.match(reservar, /const infantesN = numMenoresDeDos;/);
    assert.match(reservar, /datosVuelo\.fee_infante \* infantesN/);
    assert.equal((reservar.match(/for \(const lm of lineasMenores\)/g) ?? []).length, 3, "contrato, snapshot de cotización y conversión de carrito");
    assert.doesNotMatch(reservar, /Number\(input\.infantes\) \|\| 0;\s*\n\s*if \(numInfantesItem/);
    assert.match(reservar, /lineasMenores,\n?\s*\}\);|lineasMenores,\s*\n\s*\}\);/);
  });
  test("reservar: CxP de hotel incluye el neto del infante y CxP de servicios usa el precio de infante neto", () => {
    assert.match(reservar, /netoPorAcom\["infante"\] \* numInfantes/);
    assert.match(reservar, /netoInfTempServ/);
    assert.match(reservar, /precioServicio\(modo, netoPersona, grupos, paxConSilla\) \+ \(modo === "persona" \? netoInfante \* numMenoresDeDos : 0\)/);
  });
  test("reservar (conversión de carrito, bloqueo): el costo aéreo suma el fee de infante del bloqueo por menor de 2 años", () => {
    assert.match(reservar, /fee_infante, fecha_ida, fecha_regreso, vuelo_ida/);
    // La fórmula vive en UN solo lugar (la comparten la revisión previa de moneda y la creación del contrato del carrito).
    assert.match(reservar, /const costoAereo = costoAereoBloqueo\(bq, paxConSilla, numMenoresDeDos\);/);
    assert.match(leer("lib/reservar/costosObligacionesCarrito.ts"), /\(Number\(bq\.fee_infante\) \|\| 0\) \* numMenoresDeDos/);
  });
  test("checkout: filas de menores y residual salen de lineasMenores", () => {
    assert.match(checkout, /for \(const lm of lineasMenores\)/);
    assert.match(checkout, /descripcionLineaMenor\(lm, it\.categoria, it\.regimen\)/);
    assert.match(checkout, /lineasMenores,\n\s*\}\);/);
  });
  test("buscador de hoteles: los menores se tarifan con tarifarMenores y el rango de grupo NO cuenta al menor de 2 años", () => {
    assert.match(buscador, /tarifarMenores\(\{/);
    assert.match(buscador, /const paxGrupo = pax;/);
    assert.doesNotMatch(buscador, /pax \+ menores\.infantes/);
    assert.match(buscador, /precio_persona, precio_infante, liquidacion, proveedor_id/);
  });
  test("generador: cada fuente de vuelo pasa su fee_infante (precio = costo, sin MK ni TA) y el infante sin tarifa de hotel se publica", () => {
    // 231: el join del Bloqueo además lee su moneda.
    assert.match(generador, /tarifa_para_empaquetar, fee_infante(, moneda)?\)/);
    assert.match(generador, /tarifa_para_empaquetar, fee_infante, (moneda, )?activo, compra_inicio, compra_fin\)/);
    assert.match(generador, /Number\(b\.fee_infante\) \|\| 0\);/);
    assert.match(generador, /Number\(e\.fee_infante\) \|\| 0\);/);
    assert.match(generador, /Number\(sal\.fee_infante\) \|\| 0\);/);
    assert.match(generador, /precioMenorDeDos\(\{ aporteHotel, aporteServiciosMenor: aporteServMenor, feeInfante, moneda: monedaHotel \}\)/);
    assert.match(generador, /if \(hayHabitacion && !hayInfante && !hotelAdultsOnly && procedenciaHab\) publicarFila\("infante", 0, procedenciaHab\);/);
    // Ni MK ni TA sobre el fee: no pasa por aporteVuelo/marcar.
    assert.doesNotMatch(generador, /marcar\([^)]*feeInfante/);
    assert.doesNotMatch(generador, /aporteVuelo\([^)]*fee_infante/);
  });
  test("origen del vuelo: el Bloqueo lee su fee_infante (ya no es 0 fijo)", () => {
    assert.match(origen, /fee_infante: Number\(b\.fee_infante\) \|\| 0,/);
    assert.doesNotMatch(origen, /fee_infante: 0,/);
  });
  test("fuera de alcance intactos: Bernalo, Programas, cotización manual y contrato manual no usan menoresDeDos", () => {
    for (const f of ["lib/calc/pvpAlojamientoBernalo.ts", "lib/reservar/computoReservaBernalo.ts", "lib/programas/precioReserva57.ts", "app/(dashboard)/dashboard/cotizaciones/manual-actions.ts", "app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx"]) {
      assert.doesNotMatch(leer(f), /menoresDeDos/, f);
    }
  });
});

describe("catálogo y vuelos: los campos nuevos están en las pantallas y en la carga masiva", () => {
  test("servicios: campo, temporadas, CSV y aviso de servicios sin precio de infante", () => {
    const acciones = leer("app/(dashboard)/dashboard/producto/servicios/actions.ts");
    const cliente = leer("app/(dashboard)/dashboard/producto/servicios/ServiciosClient.tsx");
    const pagina = leer("app/(dashboard)/dashboard/producto/servicios/page.tsx");
    assert.match(acciones, /precio_infante: precioInfanteRow\(input\.precioInfante\)/);
    assert.match(acciones, /precio_infante: numCsvNullable\(r\.precio_infante\)/);
    assert.match(pagina, /key: "precio_infante"/);
    assert.match(pagina, /recargo_individual, precio_infante, foto_url/);
    assert.match(cliente, /Precio de infante/);
    assert.match(cliente, /Sin precio de infante/);
    assert.match(cliente, /vacío = paga como adulto/);
  });
  test("bloqueos: fee_infante en crear, editar y CSV; sin cambiar el contrato de edición cuando la página no lo manda", () => {
    const acciones = leer("app/(dashboard)/dashboard/vuelos/actions.ts");
    const nuevo = leer("app/(dashboard)/dashboard/vuelos/NuevoBloqueoForm.tsx");
    const editar = leer("app/(dashboard)/dashboard/vuelos/[id]/EditarBloqueoForm.tsx");
    assert.match(acciones, /fee_infante: feeInfanteValido\(input\.feeInfante\)/);
    assert.match(acciones, /input\.feeInfante !== undefined \? \{ fee_infante: feeInfanteValido\(input\.feeInfante\) \} : \{\}/);
    assert.match(acciones, /fee_infante: Math\.max\(numCsv\(r\.fee_infante\), 0\)/);
    assert.match(nuevo, /Fee de infante \(0 a 1,99 años\)/);
    assert.match(editar, /inicial\.feeInfante !== undefined \? \{ feeInfante: Number\(f\.feeInfante\) \|\| 0 \} : \{\}/);
    assert.match(leer("app/(dashboard)/dashboard/vuelos/page.tsx"), /key: "fee_infante"/);
    // trasladar_cupos NO se toca: un fee distinto no vuelve incompatibles dos records.
    assert.doesNotMatch(sinComentariosSql(leer(MIGRACION)), /trasladar_cupos/);
    assert.doesNotMatch(leer("lib/vuelos/compatibles.ts"), /fee_infante/);
  });
  test("tarifario público: columna 'Infante (menor de 2 años)' con su precio y la nota de que desde los 2 años se cobra como adulto", () => {
    const pub = leer("app/tarifario/TarifarioPublic.tsx");
    assert.match(pub, /\["infante", "Infante \(menor de 2 años\)"\]/);
    assert.match(pub, /r\.preciosMenor2\?\.infante \?\? r\.precios\.infante/);
    assert.match(pub, /Desde los 2 años, el vuelo y los servicios se cobran como adulto/);
    assert.match(leer("lib/tarifario/datos.ts"), /precio_pvp, precio_pvp_menor2, descripcion/);
    assert.match(leer("app/tarifario/detalle-actions.ts"), /precio_pvp, precio_pvp_menor2, descripcion/);
  });
  test("listado de paquetes: aviso de los que hay que regenerar (solo lectura, sin barrido automático)", () => {
    const acciones = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
    const inicio = acciones.indexOf("export async function paquetesConTarifarioAnteriorAInfante");
    const fin = acciones.indexOf("// ── AUTO-RECÁLCULO", inicio);
    const cuerpo = acciones.slice(inicio, fin);
    assert.ok(inicio > 0 && fin > inicio);
    assert.doesNotMatch(cuerpo, /generarTarifario\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(/, "solo lee: nunca regenera");
    assert.match(leer("app/(dashboard)/dashboard/paquetes/page.tsx"), /paquetesConTarifarioAnteriorAInfante\(\)/);
  });
});
