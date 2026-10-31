// Loader ESM de SOLO PRUEBAS (262): igual que aliasLoader.mjs y además resuelve imports relativos SIN extensión ("../paquetes/actions"), que Next/webpack resuelven y
// `node --test` no. Permite ejecutar de verdad acciones del servidor (p. ej. producto/servicios/actions.ts) que importan a otras así.
import { resolve as base } from "./aliasLoader.mjs";
export async function resolve(specifier, context, nextResolve) {
  try { return await base(specifier, context, nextResolve); } catch (e) {
    if (e && e.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      for (const suf of [".ts", ".tsx", "/index.ts"]) { try { return await base(specifier + suf, context, nextResolve); } catch { /* sigue */ } }
    }
    throw e;
  }
}
