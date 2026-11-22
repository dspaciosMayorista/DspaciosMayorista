// #62 (V1) — genera (una vez) los secretos LOCALES de la pila de prueba: secreto JWT, llaves anon/service y contraseña de roles. Solo para la base desechable local; nunca versionar la salida.
// Uso: node claves.mjs <carpeta>   → escribe <carpeta>/config.json (si no existe) y lo imprime.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Indica la carpeta de configuración.");
mkdirSync(dir, { recursive: true });
const archivo = join(dir, "config.json");
if (!existsSync(archivo)) {
  const secreto = "local-v1-" + randomBytes(24).toString("hex");
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const firmar = (p) => { const h = b({ alg: "HS256", typ: "JWT" }), c = b(p); return `${h}.${c}.${createHmac("sha256", secreto).update(`${h}.${c}`).digest("base64url")}`; };
  writeFileSync(archivo, JSON.stringify({
    jwtSecret: secreto,
    anonKey: firmar({ role: "anon", iss: "local-v1", exp: 4102444800 }),
    serviceKey: firmar({ role: "service_role", iss: "local-v1", exp: 4102444800 }),
    rolesPassword: "r" + randomBytes(12).toString("hex"),
    puertos: { gateway: 19080, auth: 19081, rest: 19082, correo: 19083, app: 3047, storage: 19084 },
  }, null, 2));
}
console.log(readFileSync(archivo, "utf8"));
