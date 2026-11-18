// HUMO de la revisión local de #106: pide /dashboard/gestion-contratos con la sesión REAL de cada usuario sintético por el gateway local (sin seguir redirecciones). Uso: node humo_roles_106.mjs <config.json>
import { readFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const SUPA = "http://127.0.0.1:54356", APP = "http://127.0.0.1:3056";
async function cookie(email) {
  const j = await (await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: cfg.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password: "Local106!" }) })).json();
  const v = "base64-" + Buffer.from(JSON.stringify(j)).toString("base64url"); const t = v.match(/.{1,3180}/g);
  return t.length === 1 ? `sb-127-auth-token=${v}` : t.map((x, i) => `sb-127-auth-token.${i}=${x}`).join("; ");
}
for (const u of ["superadmin", "gerencia", "administracion", "operaciones", "venta", "aliado"]) {
  const c = await cookie(`${u}@local106.test`);
  const r = await fetch(`${APP}/dashboard/gestion-contratos`, { headers: { cookie: c }, redirect: "manual" });
  const html = r.status === 200 ? await r.text() : "";
  console.log(u.padEnd(15), r.status, r.headers.get("location") ?? "", r.status === 200 ? `contiene lista: ${html.includes("<h1") && html.includes("Contrato DTM-10617")}` : "");
}
