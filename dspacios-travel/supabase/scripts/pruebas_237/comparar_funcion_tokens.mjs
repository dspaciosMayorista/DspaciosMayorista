// Compara POR TOKENS el cuerpo de una función plpgsql con otro, ignorando solo formato
// (espacios, saltos de línea, CRLF/LF, comentarios, mayúsculas de palabras/identificadores sin comillas).
// Los literales entre comillas simples se comparan EXACTOS (un espacio dentro de un mensaje SÍ es lógica).
//
// Uso:  node comparar_funcion_tokens.mjs <migracion.sql> <fixture.json> [nombre_funcion]
// Salida: informe en texto; exit 0 = tokens idénticos y atributos equivalentes, exit 1 = hay diferencias.
import fs from "node:fs";
import crypto from "node:crypto";

export const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");

export function tokenizar(sql) {
  const t = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && sql[i + 1] === "-") { while (i < n && sql[i] !== "\n") i++; continue; }          // comentario de línea
    if (c === "/" && sql[i + 1] === "*") { const j = sql.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; } // comentario de bloque
    if (c === "'") {                                                                                     // literal (exacto, '' escapa)
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error("literal sin cerrar");
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      t.push({ k: "lit", v: sql.slice(i, j + 1).replace(/\r\n/g, "\n") });
      i = j + 1; continue;
    }
    if (c === '"') { const j = sql.indexOf('"', i + 1); t.push({ k: "qid", v: sql.slice(i, j + 1) }); i = j + 1; continue; } // identificador con comillas (exacto)
    if (/[A-Za-z_]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++; t.push({ k: "id", v: sql.slice(i, j).toLowerCase() }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[0-9.]/.test(sql[j])) j++; t.push({ k: "num", v: sql.slice(i, j) }); i = j; continue; }
    const tres = sql.slice(i, i + 3), dos = sql.slice(i, i + 2);
    if (tres === "->>") { t.push({ k: "op", v: tres }); i += 3; continue; }
    if (["->", "::", ":=", "<>", "<=", ">=", "||", "!="].includes(dos)) { t.push({ k: "op", v: dos }); i += 2; continue; }
    t.push({ k: "op", v: c }); i++;
  }
  return t;
}

const fmt = (x) => (x ? x.v : "∅");

export function diffTokens(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].v === b[j].v ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const dif = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].v === b[j].v) { i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { dif.push({ lado: "solo remota", pos: j, token: fmt(b[j]) }); j++; }
    else { dif.push({ lado: "solo repo", pos: i, token: fmt(a[i]) }); i++; }
  }
  return dif;
}

export function cuerpoMigracion(raw, nombre) {
  // Insensible a mayúsculas y a la etiqueta del dólar-quote ($$ o $function$).
  const low = raw.toLowerCase();
  const i = low.indexOf(`create or replace function public.${nombre}(`);
  if (i < 0) throw new Error("función no encontrada en la migración");
  const m = /\bas\s+(\$[a-z_]*\$)/.exec(low.slice(i));
  if (!m) throw new Error("sin cuerpo dollar-quoted");
  const tag = m[1];
  const a = i + m.index + m[0].length;
  const b = low.indexOf(tag, a);
  return { cabecera: raw.slice(i, i + m.index), cuerpo: raw.slice(a, b) };
}

export function cuerpoRemoto(def) {
  const a = def.indexOf("$function$") + "$function$".length;
  const b = def.lastIndexOf("$function$");
  return { cabecera: def.slice(0, a - "$function$".length), cuerpo: def.slice(a, b) };
}

// Atributos (cabecera) normalizados: tipo de retorno, lenguaje, security definer, search_path.
function atributos(cab) {
  const c = cab.replace(/--.*$/gm, " ").replace(/\s+/g, " ").toLowerCase();
  const sp = /set search_path\s*(?:=|to)\s*([^a-z]*?(?:'?public'?\s*,\s*'?pg_temp'?|'?[a-z_, ']+?))\s*(?:as\b|$)/.exec(c);
  return {
    returns: (/returns\s+([a-z0-9_\[\]]+)/.exec(c) || [])[1],
    language: (/language\s+([a-z0-9_]+)/.exec(c) || [])[1],
    securityDefiner: /security definer/.test(c),
    searchPath: sp ? sp[1].replace(/'/g, "").replace(/\s+/g, "").trim() : null,
    parametros: (/\(([^)]*)\)/.exec(c) || [])[1]?.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim(),
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}` || process.argv[1]?.endsWith("comparar_funcion_tokens.mjs")) {
  const [, , migracion, fixture, nombre = "reemplazar_tarifas_hotel_calculadora"] = process.argv;
  const fx = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const rem = cuerpoRemoto(fx.definicion);
  const rep = cuerpoMigracion(fs.readFileSync(migracion, "utf8"), nombre);
  console.log(`Función: ${nombre}`);
  console.log(`MD5 observado (fixture)                 : ${fx.md5_observado}`);
  console.log(`MD5 del cuerpo remoto (prosrc)          : ${md5(rem.cuerpo)}  ${md5(rem.cuerpo) === fx.md5_observado ? "<== COINCIDE con el observado" : ""}`);
  console.log(`MD5 de la definición completa (remota)  : ${md5(fx.definicion)}  ${md5(fx.definicion) === fx.md5_observado ? "<== COINCIDE con el observado" : ""}`);
  console.log(`MD5 del cuerpo en el repo (migr. 179)   : ${md5(rep.cuerpo)}`);
  const ta = tokenizar(rep.cuerpo), tb = tokenizar(rem.cuerpo);
  console.log(`Tokens: repo=${ta.length} remota=${tb.length}`);
  const dif = diffTokens(ta, tb);
  console.log(`Diferencias de TOKENS en el cuerpo: ${dif.length}`);
  for (const d of dif.slice(0, 40)) console.log(`  - ${d.lado} @${d.pos}: ${d.token}`);
  const aa = atributos(rep.cabecera), ab = atributos(rem.cabecera);
  const attrIguales = JSON.stringify(aa) === JSON.stringify(ab);
  console.log(`Atributos repo   : ${JSON.stringify(aa)}`);
  console.log(`Atributos remota : ${JSON.stringify(ab)}`);
  console.log(`Atributos equivalentes: ${attrIguales}`);
  const lf = (s) => s.replace(/\r\n/g, "\n");
  console.log(`Líneas: repo=${lf(rep.cuerpo).split("\n").length} remota=${lf(rem.cuerpo).split("\n").length} | CRLF repo=${/\r\n/.test(rep.cuerpo)} remota=${/\r\n/.test(rem.cuerpo)}`);
  const igual = dif.length === 0 && attrIguales;
  console.log(igual ? "VEREDICTO: tokens idénticos y atributos equivalentes — la diferencia es SOLO de formato." : "VEREDICTO: HAY DIFERENCIAS de lógica o de atributos (ver arriba).");
  process.exit(igual ? 0 : 1);
}
