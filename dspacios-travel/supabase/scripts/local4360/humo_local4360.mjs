// Prueba de HUMO del entorno local #43/#60: inicia sesión de verdad en GoTrue local con cada usuario de prueba,
// arma la cookie de sesión como @supabase/ssr y pide páginas a la app (dev o build local). Solo lectura.
// Uso: node humo_local4360.mjs <config.json> [url_app=http://127.0.0.1:3043]
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const APP = process.argv[3] ?? "http://127.0.0.1:3043";
const SUPA = "http://127.0.0.1:54360";
const REF = new URL(SUPA).hostname.split(".")[0];   // @supabase/ssr: sb-<primer segmento del host>-auth-token
let fallos = 0;
const tokens = new Map();
// RPC de solo lectura por el gateway, con el token de la sesión real (como hace la app en el navegador).
const rpc = async (email, fn, args) => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: cfg.anonKey, authorization: `Bearer ${tokens.get(email)}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
};
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };

async function sesion(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: cfg.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Local4360!" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  tokens.set(email, j.access_token);
  // Mismo formato que @supabase/ssr: "base64-" + base64url(JSON) partido en trozos de 3180.
  const valor = "base64-" + Buffer.from(JSON.stringify(j)).toString("base64url");
  const trozos = valor.match(/.{1,3180}/g);
  return trozos.length === 1 ? `sb-${REF}-auth-token=${valor}` : trozos.map((t, i) => `sb-${REF}-auth-token.${i}=${t}`).join("; ");
}
async function pagina(cookie, ruta) {
  const r = await fetch(`${APP}${ruta}`, { headers: { cookie }, redirect: "manual" });
  return { status: r.status, destino: r.headers.get("location"), html: r.status === 200 ? await r.text() : "" };
}

const op = await sesion("operaciones@local4360.test");
let p = await pagina(op, "/dashboard/producto/hoteles/436001?tab=tarifas");
ok(p.status === 200 && p.html.includes("LOCAL 1"), `operaciones abre la ficha del hotel Dubai con grupos (HTTP ${p.status})`);
ok(/Tarifa por fórmula/.test(p.html), "la ficha trae la calculadora");
ok(/data-estado-grupos/.test(p.html) && /(preparado|se vende por grupos)/.test(p.html), "3c: la ficha dice el estado de los grupos (preparado o se vende)");
ok(p.html.includes("PUENTE"), "3c: la vigencia PUENTE de la semilla está en la ficha");
let a = await rpc("operaciones@local4360.test", "grupos_dias_alcance", { p_temporada_id: 4360011 });
ok(a.status === 200 && Array.isArray(a.cuerpo?.empates) && Array.isArray(a.cuerpo?.habilitaciones) && ["preparado", "activo"].includes(a.cuerpo?.estado),
  `3c: operaciones lee el alcance de ALTA por el gateway (HTTP ${a.status}; estado ${a.cuerpo?.estado}; ${a.cuerpo?.empates?.length ?? "?"} empate(s))`);
p = await pagina(op, "/dashboard/producto/hoteles/436005");
ok(p.status === 200 && p.html.includes("LOCAL 5"), `operaciones abre el hotel por unidad (HTTP ${p.status})`);
const ve = await sesion("venta@local4360.test");
p = await pagina(ve, "/dashboard/producto/hoteles/436001");
ok(p.status !== 200 || !/Tarifa por fórmula/.test(p.html), `venta no accede a la calculadora del hotel (HTTP ${p.status}${p.destino ? " → " + p.destino : ""})`);
a = await rpc("venta@local4360.test", "grupos_dias_alcance", { p_temporada_id: 4360011 });
ok(a.status === 403, `3c: venta no lee el alcance (HTTP ${a.status})`);
const sa = await sesion("superadmin@local4360.test");
p = await pagina(sa, "/dashboard/producto/hoteles/436002");
ok(p.status === 200 && p.html.includes("LOCAL 2"), `superadmin abre el hotel Mixta (HTTP ${p.status})`);
console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
