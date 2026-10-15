/**
 * SIMULADOR LOCAL mínimo de la API de Supabase, SOLO para pruebas locales
 * (`test_207_api_crm_contactos_acceso.sh`). Nunca apunta a un proyecto real.
 *
 *   node mock_supabase_local.mjs <puerto_postgrest> <secreto_jwt> <usuarios.json> <archivo_salida>
 *
 *   · /auth/v1/token?grant_type=password → valida email/contraseña contra
 *     <usuarios.json> ({ email: { id, password } }) y devuelve una sesión con
 *     un JWT HS256 firmado con el MISMO secreto que usa el PostgREST local.
 *   · /auth/v1/logout → 204.
 *   · /rest/v1/* → reenvía tal cual (método, cabeceras, consulta) al
 *     PostgREST local: la RLS que se prueba es la de PostgreSQL de verdad.
 *
 * Escribe en <archivo_salida> una línea JSON con { puerto, anonKey } al
 * quedar escuchando. Sin dependencias externas.
 */
import http from "node:http";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [, , puertoRest, secreto, rutaUsuarios, salida] = process.argv;
const usuarios = JSON.parse(readFileSync(rutaUsuarios, "utf8"));

const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
function jwt(payload) {
  const cab = b64({ alg: "HS256", typ: "JWT" });
  const cuerpo = b64(payload);
  const firma = createHmac("sha256", secreto).update(`${cab}.${cuerpo}`).digest("base64url");
  return `${cab}.${cuerpo}.${firma}`;
}
const ahora = () => Math.floor(Date.now() / 1000);
const anonKey = jwt({ role: "anon", iss: "local", iat: ahora(), exp: ahora() + 3600 });

function leerCuerpo(req) {
  return new Promise((ok) => { const p = []; req.on("data", (c) => p.push(c)); req.on("end", () => ok(Buffer.concat(p))); });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  const cuerpo = await leerCuerpo(req);

  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    let datos = {};
    try { datos = JSON.parse(cuerpo.toString() || "{}"); } catch { /* cuerpo inválido */ }
    const u = usuarios[datos.email];
    if (!u || u.password !== datos.password) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }));
    }
    const exp = ahora() + 3600;
    const access = jwt({ sub: u.id, role: "authenticated", aud: "authenticated", email: datos.email, iat: ahora(), exp });
    const user = { id: u.id, aud: "authenticated", role: "authenticated", email: datos.email,
                   app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ access_token: access, token_type: "bearer", expires_in: 3600,
                                    expires_at: exp, refresh_token: "local-refresh", user }));
  }
  if (url.pathname.startsWith("/auth/v1/logout")) { res.writeHead(204); return res.end(); }

  if (url.pathname.startsWith("/rest/v1/")) {
    const destino = `http://127.0.0.1:${puertoRest}${url.pathname.slice("/rest/v1".length)}${url.search}`;
    const cab = { ...req.headers };
    delete cab.host; delete cab["content-length"]; delete cab.connection;
    let r;
    try {
      r = await fetch(destino, { method: req.method, headers: cab,
                                 body: ["GET", "HEAD"].includes(req.method) ? undefined : cuerpo });
    } catch {
      res.writeHead(502); return res.end();   // PostgREST caído: error, nunca "0 filas"
    }
    const salidaCab = {};
    r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) salidaCab[k] = v; });
    res.writeHead(r.status, salidaCab);
    if (req.method === "HEAD") return res.end();
    return res.end(Buffer.from(await r.arrayBuffer()));
  }

  res.writeHead(404); res.end();
});

servidor.listen(0, "127.0.0.1", () => {
  writeFileSync(salida, JSON.stringify({ puerto: servidor.address().port, anonKey }) + "\n");
});
