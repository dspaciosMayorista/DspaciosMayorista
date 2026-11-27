// Comprueba con el navegador DEDICADO (perfil de revisión) un ingreso REAL: Edge rellena el formulario con la cuenta guardada, se pulsa «Ingresar», se llega al panel y se CIERRA la sesión (el perfil queda sin sesión abierta).
// Requiere la app arriba (revision.mjs iniciar o ensayo-iniciar) y el perfil preparado (navegador-preparar). Uso: node verificar_navegador_login.mjs [alias=superadmin,gerencia]
import { chromium } from "../../../node_modules/@playwright/test/index.mjs";
import fs from "node:fs"; import path from "node:path";
const CFG = path.join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const conf = JSON.parse(fs.readFileSync(path.join(CFG, "config.json"), "utf8"));
const ORIGEN = `http://localhost:${conf.puertos.app}`;
const ALIAS = (process.argv[2] ?? "superadmin,gerencia").split(",");
const c = await chromium.launchPersistentContext(path.join(CFG, "edge-perfil"), { channel: "msedge", headless: true, ignoreDefaultArgs: ["--password-store=basic", "--use-mock-keychain", "--disable-features=PasswordManager"] });
let ok = true;
for (const alias of ALIAS) {
  const p = c.pages()[0] ?? await c.newPage();
  await p.goto(`${ORIGEN}/login`, { waitUntil: "networkidle" }); await p.waitForTimeout(3500);
  // Edge propone la cuenta más reciente; para otra cuenta se escribe el correo (Edge completa la contraseña guardada al elegir/ingresar el usuario)
  const correo = `${alias}@consolidada.test`;
  const actual = await p.inputValue('input[name="email"]');
  if (actual !== correo) { await p.fill('input[name="email"]', correo); await p.waitForTimeout(800); }
  const clave = (await p.inputValue('input[name="password"]')).length;
  const autofill = await p.evaluate(() => [...document.querySelectorAll('input[name="email"], input[name="password"]')].every((i) => i.matches(":autofill")));
  if (clave === 0) await p.fill('input[name="password"]', "Consolidada2026!");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }).catch(() => null), p.click('button[type="submit"]')]);
  await p.waitForLoadState("networkidle").catch(() => {});
  const dentro = new URL(p.url()).pathname.startsWith("/dashboard") || new URL(p.url()).pathname.startsWith("/portal");
  console.log(`${dentro ? "OK" : "FALLO"} ${correo}: contraseña autocompletada=${clave > 0 ? "sí" : "no (se escribió)"} · autofill=${autofill} · destino ${new URL(p.url()).pathname}`);
  ok = ok && dentro;
  const salir = p.locator("button:visible", { hasText: "Cerrar sesión" }).first();
  if (await salir.count()) { await salir.click(); await p.waitForURL(/\/tarifario|\/login|\/$/, { timeout: 30000 }).catch(() => {}); }
}
await c.close(); process.exit(ok ? 0 : 1);
