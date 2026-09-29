import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// GUARDA — columnas legacy de proveedores (migración 191)
//
// La 191 elimina de public.proveedores las ocho columnas sensibles; desde la
// 189 viven en public.proveedores_datos_sensibles. PostgREST no avisa al
// compilar: un `.select("nit")` sobre proveedores o un embed
// `proveedores(banco)` solo falla en ejecución. Estas pruebas leen el CÓDIGO
// FUENTE de app/, components/ y lib/ y fallan si alguien vuelve a:
//   - leer una columna legacy desde `from("proveedores")` o un embed;
//   - escribir el catálogo directo (insert/update/upsert) en vez de la RPC;
//   - mandar `datos_pago` a guardar_proveedor (la RPC nunca lo escribe).
// La semántica en base de datos se prueba con
// supabase/scripts/pruebas/test_191_proveedores_rls_rpc.sql.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const LEGACY = [
  "nit", "razon_social", "datos_pago", "banco", "tipo_cuenta",
  "numero_cuenta", "politica_reservas", "voucher_contacto",
] as const;
const RE_LEGACY = new RegExp(`\\b(${LEGACY.join("|")})\\b`);

function fuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(join(raiz, dir))) {
    const rel = join(dir, nombre);
    if (statSync(join(raiz, rel)).isDirectory()) salida.push(...fuentes(rel));
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(rel);
  }
  return salida;
}
const ARCHIVOS = ["app", "components", "lib"].flatMap(fuentes);

// Cadena de llamadas que sigue a `.from("proveedores")` hasta el `;` o el
// siguiente `.from(` (suficiente para los encadenados de supabase-js).
function cadenasDeProveedores(src: string): string[] {
  const cadenas: string[] = [];
  const re = /\.from\(\s*["'`]proveedores["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const resto = src.slice(m.index + m[0].length);
    const corte = resto.search(/;|\.from\(/);
    cadenas.push(resto.slice(0, corte === -1 ? 600 : corte));
  }
  return cadenas;
}

// Contenido de cada embed `proveedores(...)` / `proveedores!fk(...)` dentro de
// strings de select (paréntesis balanceados).
function embedsDeProveedores(src: string): string[] {
  const embeds: string[] = [];
  const re = /[\s,"'`(]proveedores(?:![\w]+)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let nivel = 1;
    let i = m.index + m[0].length;
    const inicio = i;
    while (i < src.length && nivel > 0) {
      if (src[i] === "(") nivel++;
      else if (src[i] === ")") nivel--;
      i++;
    }
    embeds.push(src.slice(inicio, i - 1));
  }
  return embeds;
}

test("ningún select sobre from('proveedores') pide columnas legacy", () => {
  const hallazgos: string[] = [];
  let revisadas = 0;
  for (const rel of ARCHIVOS) {
    for (const cadena of cadenasDeProveedores(leer(rel))) {
      revisadas++;
      const sel = cadena.match(/\.select\(\s*(["'`])([\s\S]*?)\1/);
      if (sel && RE_LEGACY.test(sel[2])) hallazgos.push(`${relative(raiz, join(raiz, rel))}: select("${sel[2]}")`);
      if (sel && /(^|[\s,])\*($|[\s,])/.test(sel[2])) hallazgos.push(`${rel}: select("*") sobre proveedores`);
    }
  }
  assert.ok(revisadas >= 15, `se esperaban muchas lecturas de proveedores; se encontraron ${revisadas} (¿cambió el patrón?)`);
  assert.deepEqual(hallazgos, []);
});

test("ningún embed proveedores(...) pide columnas legacy", () => {
  const hallazgos: string[] = [];
  let revisados = 0;
  for (const rel of ARCHIVOS) {
    for (const embed of embedsDeProveedores(leer(rel))) {
      revisados++;
      if (RE_LEGACY.test(embed) || /(^|[\s,])\*($|[\s,])/.test(embed)) hallazgos.push(`${rel}: proveedores(${embed})`);
    }
  }
  assert.ok(revisados >= 10, `se esperaban embeds de proveedores; se encontraron ${revisados} (¿cambió el patrón?)`);
  assert.deepEqual(hallazgos, []);
});

test("el catálogo solo se escribe por la RPC (from('proveedores') solo lee o borra)", () => {
  const hallazgos: string[] = [];
  for (const rel of ARCHIVOS) {
    for (const cadena of cadenasDeProveedores(leer(rel))) {
      if (/\.(insert|update|upsert)\(/.test(cadena)) hallazgos.push(`${rel}: ${cadena.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(hallazgos, []);
});

test("las acciones de proveedores nunca envían datos_pago a guardar_proveedor", () => {
  const src = leer("app/(dashboard)/dashboard/producto/proveedores/actions.ts");
  assert.ok((src.match(/rpc\("guardar_proveedor"/g) ?? []).length === 3, "crear, actualizar y CSV usan la RPC");
  assert.doesNotMatch(src, /datos_pago/, "la RPC ignora datos_pago; enviarlo daría la falsa idea de que se guarda");
});

test("types/database.ts: proveedores ya no declara columnas legacy; la tabla sensible sí", () => {
  const src = leer("types/database.ts");
  const bloque = (tabla: string) => {
    const ini = src.indexOf(`      ${tabla}: {\n`);
    assert.ok(ini >= 0, `no se encontró el tipo de ${tabla}`);
    return src.slice(ini, src.indexOf("Relationships", ini));
  };
  const proveedores = bloque("proveedores");
  for (const c of LEGACY) assert.doesNotMatch(proveedores, new RegExp(`\\b${c}\\??:`), `proveedores aún declara ${c}`);
  const sensibles = bloque("proveedores_datos_sensibles");
  for (const c of LEGACY) assert.match(sensibles, new RegExp(`\\b${c}: string \\| null;`), `la tabla sensible perdió ${c}`);
});

test("migración 191: sin CASCADE, RPC que no pisa datos_pago y una sola lectura del catálogo", () => {
  const sql = leer("supabase/migrations/20260601000191_proveedores_retirar_columnas_legacy.sql")
    .replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bcascade\b/i, "la 191 no debe usar CASCADE");
  const conflicto = sql.match(/on conflict \(proveedor_id, tenant\) do update set([\s\S]*?);/i);
  assert.ok(conflicto, "la RPC hace upsert sobre la tabla sensible");
  assert.doesNotMatch(conflicto[1], /datos_pago/, "el DO UPDATE no debe tocar datos_pago");
  assert.equal((sql.match(/create policy[^;]*on public\.proveedores\s+for (select|all)/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /on public\.proveedores_datos_sensibles\s+for/i, "la 191 no crea policies en la tabla sensible");
  assert.doesNotMatch(sql, /grant[^;]*truncate/i, "la 191 no concede TRUNCATE");
  assert.match(sql, /security invoker/i);
});

// ─────────────────────────────────────────────────────────────────────────
// Uso interno del catálogo (decisión del dueño): agencia, freelance y
// cliente_final no leen public.proveedores ni la tabla sensible en ningún
// tenant. Los flujos B2B de /dashboard/reservar que necesitan el proveedor
// (nombre y retención, para la CxP) lo leen en el servidor con service-role.
// ─────────────────────────────────────────────────────────────────────────

test("migración 191: la lectura del catálogo no menciona roles externos", () => {
  const sql = leer("supabase/migrations/20260601000191_proveedores_retirar_columnas_legacy.sql")
    .replace(/--.*$/gm, "");
  const policy = sql.match(/create policy "proveedores: lectura catalogo"[\s\S]*?\);/i);
  assert.ok(policy, "existe la policy de lectura del catálogo");
  assert.doesNotMatch(policy[0], /agencia|freelance|cliente_final/);
  for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta", "control_vuelo"]) {
    assert.match(policy[0], new RegExp(`'${rol}'`), `el personal interno ${rol} conserva la lectura`);
  }
  assert.doesNotMatch(policy[0], /mi_tenant_real/, "el personal interno lee en ambos tenants");
});

test("voucher: nunca usa proveedores.contacto como respaldo del contacto del voucher", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
  for (const embed of embedsDeProveedores(src)) {
    assert.doesNotMatch(embed, /\bcontacto\b/, `el voucher no debe pedir proveedores(${embed})`);
  }
  // Solo `g.contacto` (el agrupador interno, que se llena con voucher_contacto).
  // Cualquier otro `X.contacto` / `X?.contacto` en el código (sin comentarios)
  // sería leer el contacto del catálogo, que puede ser un número interno.
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const accesos = [...codigo.matchAll(/([\w$)\]]+)\??\.contacto\b/g)].map((m) => m[1]);
  assert.ok(accesos.length > 0, 'el voucher sigue usando g.contacto');
  assert.deepEqual([...new Set(accesos)], ['g'], `accesos a .contacto fuera del agrupador: ${accesos.join(', ')}`);
  assert.match(src, /\.select\("proveedor_id, voucher_contacto"\)/, "el contacto sale de la tabla sensible");
});

test("reservar: los embeds de proveedores van por service-role, salvo reservarPrograma (solo interno)", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const inicioPrograma = src.indexOf("export async function reservarPrograma");
  assert.ok(inicioPrograma > 0);
  const lineas = src.split("\n");
  let offset = 0;
  const conUsuario: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const posLinea = offset;
    offset += linea.length + 1;
    if (!/proveedores(![\w]+)?\(/.test(linea) || /^\s*(\/\/|\/?\*)/.test(linea)) continue;
    // Cliente de la consulta: la última asignación/uso de admin|sb antes del embed.
    const previo = lineas.slice(Math.max(0, i - 6), i + 1).join("\n");
    const usaAdmin = /\badmin\b|createAdminClient\(\)|\bclientH\b|\badminCond\b/.test(previo);
    const enPrograma = posLinea > inicioPrograma;
    if (!usaAdmin && !enPrograma) conUsuario.push(`línea ${i + 1}: ${linea.trim().slice(0, 90)}`);
  }
  assert.deepEqual(conUsuario, [], "embeds de proveedores con el cliente del usuario en flujos alcanzables por B2B");
  const programa = src.slice(inicioPrograma, inicioPrograma + 4000);
  assert.match(programa, /contextoCrearContrato\("reservar_programa"/, "reservarPrograma exige el contexto interno");
});

test("reservarPrograma queda cerrado a roles externos: solo quien escribe ventas pasa el contexto", () => {
  // lib/roles.ts importa next/headers (no se puede ejecutar aquí): se verifica
  // su definición literal. Si alguien suma un rol externo, esto falla.
  const roles = leer("lib/roles.ts");
  assert.match(roles, /export const ADMIN_ROLES: readonly Rol\[\] = \["superadmin", "administracion", "gerencia"\];/);
  assert.match(roles, /ventas: \[\.\.\.ADMIN_ROLES, "operaciones", "venta"\] as Rol\[\],/);
  assert.match(roles, /return !!rol && \(ESCRITURA\[recurso\] as readonly string\[\]\)\.includes\(rol\);/);
  const contexto = leer("lib/contrato/contexto.ts");
  assert.match(contexto, /puedeEscribir\("ventas", rol\)/, "contextoCrearContrato decide con ESCRITURA.ventas");
});

test("migración 191: el guard compara la forma EXACTA de las 8 policies contra una referencia idéntica", () => {
  const sql191 = leer("supabase/migrations/20260601000191_proveedores_retirar_columnas_legacy.sql");
  const sql189 = leer("supabase/migrations/20260601000189_proveedores_datos_sensibles_preparacion.sql");
  const bloque = (sql: string, nombre: string, tabla: string) => {
    const re = new RegExp(`create policy "${nombre}"\\s+on ${tabla.replace(/\./g, "\\.")} for[\\s\\S]*?;`);
    const m = sql.match(re);
    assert.ok(m, `no se encontró ${nombre} sobre ${tabla}`);
    return m[0].replace(/\s+on \S+ for/, " on X for");
  };
  // Lectura del catálogo: la referencia es copia literal de la real.
  assert.equal(
    bloque(sql191, "proveedores: lectura catalogo", "pg_temp._ref191_catalogo"),
    bloque(sql191, "proveedores: lectura catalogo", "public.proveedores"),
  );
  // Las otras siete: copia literal de la 189 (que la 191 no toca).
  for (const [nombre, real, ref] of [
    ["proveedores: insertar mayorista", "public.proveedores", "pg_temp._ref191_catalogo"],
    ["proveedores: actualizar mayorista", "public.proveedores", "pg_temp._ref191_catalogo"],
    ["proveedores: borrar mayorista", "public.proveedores", "pg_temp._ref191_catalogo"],
    ["proveedores sensibles: lectura autorizada", "public.proveedores_datos_sensibles", "pg_temp._ref191_sensibles"],
    ["proveedores sensibles: insertar mayorista", "public.proveedores_datos_sensibles", "pg_temp._ref191_sensibles"],
    ["proveedores sensibles: actualizar mayorista", "public.proveedores_datos_sensibles", "pg_temp._ref191_sensibles"],
    ["proveedores sensibles: borrar mayorista", "public.proveedores_datos_sensibles", "pg_temp._ref191_sensibles"],
  ] as const) {
    assert.equal(bloque(sql191, nombre, ref), bloque(sql189, nombre, real), `${nombre}: la referencia difiere de la 189`);
  }
  // Comparación en ambos sentidos (nada de más, nada de menos, nada distinto).
  assert.match(sql191, /\(select \* from real_ except select \* from ref_\)\s+union all\s+\(select \* from ref_ except select \* from real_\)/);
});
