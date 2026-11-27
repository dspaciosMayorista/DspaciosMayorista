// Claves LOCALES y fijas de la prueba de pantallas R3 (nada remoto): el secreto firma el JWT anon que se incrusta en el build y los JWT de sesión; PostgREST lo recibe por R2_SECRETO.
import { createHmac } from "node:crypto";
export const SECRETO = "r3-pantallas-secreto-fijo-local-0123456789abcdef";
export const PUERTO_PASARELA = 54395, PUERTO_REST = 54396, PUERTO_APP = 3095;
export const URL_SUPABASE = `http://127.0.0.1:${PUERTO_PASARELA}`;
const b = (s) => Buffer.from(s).toString("base64url");
export function jwt(payload, exp = 2000000000) {
  const h = b(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b(JSON.stringify({ iss: "supabase", iat: 1700000000, ...payload, exp }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
export const ANON = jwt({ role: "anon" });
export const SERVICIO = jwt({ role: "service_role" });
if (process.argv[2] === "anon") process.stdout.write(ANON);
