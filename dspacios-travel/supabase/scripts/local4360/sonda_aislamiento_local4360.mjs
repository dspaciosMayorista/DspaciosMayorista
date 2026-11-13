// SONDA DE AISLAMIENTO del entorno local #43/#60. La lanza `local4360.ps1 aislamiento` con EXACTAMENTE el mismo
// entorno hijo y la misma guardia de red que la app. No hace ninguna llamada real al exterior: la guardia rechaza
// antes de resolver DNS o abrir el socket (el error lleva su código propio, que lo demuestra). Nunca imprime valores
// de variables: solo nombres y comprobaciones.
import http from "node:http";

let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };

// 1) Entorno del proceso: solo lo mínimo del sistema + lo local.
const LOCALES = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET",
  "NEXT_PUBLIC_SITE_URL", "NEXT_TELEMETRY_DISABLED", "QUICK_LOGIN_ENABLED", "LOCAL4360_REGISTRO_RED", "NODE_OPTIONS"]);
const SENSIBLE = /KEY|SECRET|TOKEN|PASS|PWD|DSN|DATABASE|SUPABASE|VERCEL|RESEND|BREVO|WOMPI|STRIPE|SMTP|SENTRY|AWS|GOOGLE|GITHUB|OPENAI|ANTHROPIC|MANTENIMIENTO|QUICK_LOGIN|WEBHOOK|CRON/i;
const nombres = Object.keys(process.env);
const ajenas = nombres.filter((n) => SENSIBLE.test(n) && !LOCALES.has(n));
ok(ajenas.length === 0, `ninguna variable de credenciales o integraciones del usuario pasa a la app (${nombres.length} variables, todas del sistema o locales)`);
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://x");
ok(url.hostname === "127.0.0.1", "Supabase de la app = gateway local en 127.0.0.1");
const iss = (k) => { try { return JSON.parse(Buffer.from(String(k).split(".")[1], "base64url").toString()).iss; } catch { return null; } };
ok(iss(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) === "supabase-local4360" && iss(process.env.SUPABASE_SERVICE_ROLE_KEY) === "supabase-local4360",
  "las claves anon y service son las locales (emisor supabase-local4360), no de un proyecto real");
ok(new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname === "127.0.0.1", "URL del sitio en loopback");
ok(process.env.QUICK_LOGIN_ENABLED === "0" && process.env.NEXT_TELEMETRY_DISABLED === "1", "atajo de login apagado y telemetría de Next desactivada");
ok(/guardia_red_local4360\.cjs/.test(process.env.NODE_OPTIONS ?? "") && /--max-old-space-size=\d+/.test(process.env.NODE_OPTIONS ?? ""), "guardia de red precargada y presupuesto de memoria fijado");

// 2) Destinos externos: deben bloquearse ANTES de cualquier conexión.
const bloqueado = (e) => e?.code === "ELOCAL4360_BLOQUEADO" || e?.cause?.code === "ELOCAL4360_BLOQUEADO";
const EXTERNOS = [
  ["Supabase alojado (proyecto de producción)", "https://sbqvrckukbjzhtzqpyzg.supabase.co/rest/v1/"],
  ["correo Resend", "https://api.resend.com/emails"],
  ["correo Brevo", "https://api.brevo.com/v3/smtp/email"],
  ["pagos Wompi", "https://checkout.wompi.co/"],
  ["webhook arbitrario", "https://hooks.example.org/x"],
  ["telemetría de Next", "https://telemetry.nextjs.org/api/v1/record"],
];
for (const [que, destino] of EXTERNOS) {
  try { await fetch(destino, { method: "POST", body: "{}" }); ok(false, `${que}: NO se bloqueó`); }
  catch (e) { ok(bloqueado(e), `${que}: bloqueado antes de conectar${bloqueado(e) ? "" : ` (otro error: ${e?.cause?.code ?? e?.message})`}`); }
}
await new Promise((res) => {
  const r = http.get({ host: "8.8.8.8", port: 80, path: "/" }, () => { ok(false, "IP pública por http: NO se bloqueó"); res(); });
  r.on("error", (e) => { ok(bloqueado(e), "IP pública por http.get: bloqueada"); res(); });
}).catch((e) => ok(bloqueado(e), "IP pública por http.get: bloqueada"));

// 2b) Qué cuenta como loopback: solo «localhost» e IPs literales válidas; nunca un dominio que empiece por «127.».
const { createRequire } = await import("node:module");
const { esLoopback } = createRequire(import.meta.url)("./guardia_red_local4360.cjs");   // misma instancia precargada
const SI = ["localhost", "127.0.0.1", "127.255.255.254", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"];
const NO = ["127.ejemplo.com", "127.0.0.1.nip.io", "127.1", "localhost.ejemplo.com", "128.0.0.1", "10.0.0.1", "::2", "::ffff:10.0.0.1", "0x7f000001", ""];
ok(SI.every(esLoopback), `aceptados como loopback: ${SI.join(", ")}`);
const colados = NO.filter(esLoopback);
ok(colados.length === 0, `rechazados como loopback: ${NO.map((x) => x || "(vacío)").join(", ")}${colados.length ? ` — SE COLARON: ${colados.join(", ")}` : ""}`);
for (const destino of ["https://127.ejemplo.com/", "http://127.0.0.1.nip.io/"]) {
  try { await fetch(destino); ok(false, `${destino}: NO se bloqueó`); }
  catch (e) { ok(bloqueado(e), `${new URL(destino).hostname}: bloqueado antes de resolver DNS${bloqueado(e) ? "" : ` (otro error: ${e?.cause?.code ?? e?.message})`}`); }
}

// 3) Loopback permitido: el gateway local responde.
try { const r = await fetch(`${url.origin}/auth/v1/health`); ok(r.status === 200, `el gateway local responde (Auth ${r.status})`); }
catch (e) { ok(false, `gateway local no responde: ${e?.cause?.code ?? e?.message}`); }

console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
