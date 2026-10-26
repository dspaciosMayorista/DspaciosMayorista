// Verifica que la función INSTALADA en la base (salida de pg_get_functiondef) sea la definición remota
// (fixture) más SOLO la guarda de Mayorista: quitando la guarda, los tokens deben ser idénticos.
// Uso: node verificar_guarda_instalada.mjs <fixture.json> <instalada.sql>   -> imprime IGUAL o DISTINTA
import fs from "node:fs";
import { tokenizar, cuerpoRemoto } from "./comparar_funcion_tokens.mjs";

const [, , fx, inst] = process.argv;
const remota = cuerpoRemoto(JSON.parse(fs.readFileSync(fx, "utf8")).definicion);
const instalada = cuerpoRemoto(fs.readFileSync(inst, "utf8"));
const guarda = tokenizar(
  "if not public.puede_escribir_catalogo_global() then raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501'; end if;"
).map((x) => x.v);
const t = tokenizar(instalada.cuerpo).map((x) => x.v);
let idx = -1;
for (let i = 0; i + guarda.length <= t.length; i++) if (guarda.every((v, k) => t[i + k] === v)) { idx = i; break; }
const sinGuarda = idx < 0 ? null : [...t.slice(0, idx), ...t.slice(idx + guarda.length)];
const r = tokenizar(remota.cuerpo).map((x) => x.v);
console.log(sinGuarda && JSON.stringify(sinGuarda) === JSON.stringify(r) ? "IGUAL" : "DISTINTA");
