// Claves del entorno LOCAL #43/#60: un secreto JWT aleatorio NUEVO (nunca uno real) y las claves anon y
// service_role firmadas con él. Se guardan fuera del repo; si ya existen, se reutilizan.
// Uso: node claves_local4360.mjs <archivo_config.json>
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const destino = process.argv[2];
if (!destino) throw new Error("uso: node claves_local4360.mjs <archivo_config.json>");
if (existsSync(destino)) { process.stdout.write("existente\n"); process.exit(0); }
const secreto = `local4360-${randomBytes(32).toString("hex")}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const firmar = (rol) => {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role: rol, iss: "supabase-local4360", iat: 1767225600, exp: 4102444800 });
  return `${h}.${p}.${createHmac("sha256", secreto).update(`${h}.${p}`).digest("base64url")}`;
};
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, JSON.stringify({ jwtSecret: secreto, anonKey: firmar("anon"), serviceKey: firmar("service_role"), cronSecret: `cron-local4360-${randomBytes(8).toString("hex")}`, rolesPassword: `r4360${randomBytes(12).toString("hex")}` }, null, 2));
process.stdout.write("nueva\n");
