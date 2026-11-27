// Prepara el navegador DEDICADO de la revisión local: un perfil propio de Microsoft Edge (%LOCALAPPDATA%\dspacios-local-revision-int\edge-perfil) con las cuentas SINTÉTICAS @consolidada.test guardadas
// en su gestor de contraseñas, para elegir la cuenta en la lista del formulario de ingreso en vez de teclearla. No toca el perfil personal de Edge, no cambia el login del producto y no es un atajo de acceso:
// Edge solo rellena el formulario normal (correo + contraseña) y el servidor autentica igual que siempre.
// Funcionamiento: Edge guarda las contraseñas en `Login Data` (SQLite) cifradas con AES-256-GCM; la clave está protegida con DPAPI del usuario de Windows. Este script usa esa misma clave (solo el mismo usuario puede)
// para sembrar las cuentas sintéticas, y con --verificar abre Edge con ese perfil y comprueba que RELLENA el formulario (campos en estado :autofill).
// Uso: node supabase/scripts/revision_consolidada/preparar_navegador.mjs [--verificar] [--cuentas "a@consolidada.test,b@consolidada.test"]
//      Cierra antes la ventana de Edge de revisión (el perfil no se puede escribir mientras está abierto). Es idempotente: vuelve a sembrar las mismas cuentas sin duplicar.
import { chromium } from "../../../node_modules/@playwright/test/index.mjs";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { join } from "node:path";

const CFG = join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const PERFIL = join(CFG, "edge-perfil");
const conf = JSON.parse(readFileSync(join(CFG, "config.json"), "utf8"));
const ORIGEN = `http://localhost:${conf.puertos.app}`;
const CLAVE_SINTETICA = "Consolidada2026!";   // misma de TODAS las cuentas sintéticas de la revisión (documentada en el recorrido)
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? (process.argv[i + 1] ?? true) : null; };
const CUENTAS = (typeof arg("--cuentas") === "string" ? arg("--cuentas").split(",") :
  "superadmin gerencia administracion operaciones venta venta2 controlvuelo aliado freelance minorista inactivo".split(" ").map((c) => `${c}@consolidada.test`));
if (CUENTAS.some((c) => !/@consolidada\.test$/.test(c))) throw new Error("Solo cuentas sintéticas @consolidada.test.");
const ARGS_EDGE = { channel: "msedge", headless: true, ignoreDefaultArgs: ["--password-store=basic", "--use-mock-keychain", "--disable-features=PasswordManager"] };

mkdirSync(PERFIL, { recursive: true });
// 1) Si el perfil es nuevo, Edge crea su estado y su base de contraseñas con un primer arranque.
if (!existsSync(join(PERFIL, "Default", "Login Data"))) {
  const c = await chromium.launchPersistentContext(PERFIL, ARGS_EDGE);
  await (c.pages()[0] ?? await c.newPage()).goto("about:blank"); await new Promise((r) => setTimeout(r, 1500)); await c.close();
}
// 2) Clave de cifrado del perfil (DPAPI del usuario actual).
const ek = Buffer.from(JSON.parse(readFileSync(join(PERFIL, "Local State"), "utf8")).os_crypt.encrypted_key, "base64");
if (ek.subarray(0, 5).toString("latin1") !== "DPAPI") throw new Error("Este Edge no usa la clave DPAPI clásica: no se siembran contraseñas (usa la importación manual de contraseñas de Edge).");
const claveB64 = execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${ek.subarray(5).toString("base64")}'), $null, 'CurrentUser'))`], { encoding: "utf8" }).trim();
const clave = Buffer.from(claveB64, "base64");
const cifrar = (t) => { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", clave, iv); const ct = Buffer.concat([c.update(t, "utf8"), c.final()]); return Buffer.concat([Buffer.from("v10"), iv, ct, c.getAuthTag()]); };
// 3) Siembra idempotente (solo filas de ESTE origen).
let db;
try { db = new DatabaseSync(join(PERFIL, "Default", "Login Data")); db.exec("select 1 from logins limit 1"); }
catch (e) { throw new Error(`No se puede escribir el perfil (¿Edge de revisión sigue abierto?). Ciérralo y repite. ${String(e).slice(0, 120)}`); }
const cols = new Set(db.prepare("pragma table_info(logins)").all().map((c) => c.name));
const epoca = (ms) => BigInt(ms) * 1000n + 11644473600000000n;   // microsegundos desde 1601 (formato de Chromium)
db.prepare("delete from logins where signon_realm = ?").run(`${ORIGEN}/`);
CUENTAS.forEach((correo, i) => {
  const t = epoca(Date.now() - i * 1000);   // la primera queda como la «más reciente»: es la que Edge propone primero
  const v = { origin_url: `${ORIGEN}/login`, action_url: `${ORIGEN}/login`, username_element: "email", username_value: correo, password_element: "password", password_value: cifrar(CLAVE_SINTETICA), submit_element: "", signon_realm: `${ORIGEN}/`, date_created: t, blacklisted_by_user: 0, scheme: 0, password_type: 0, times_used: 0, form_data: Buffer.alloc(0), display_name: "", icon_url: "", federation_url: "", skip_zero_click: 0, generation_upload_status: 0, possible_username_pairs: Buffer.alloc(0), date_last_used: t, moving_blocked_for: Buffer.alloc(0), date_password_modified: t, sharing_notification_displayed: 0, date_last_filled: t, actor_login_approved: 0 };
  const usar = Object.keys(v).filter((k) => cols.has(k));
  db.prepare(`insert into logins (${usar.join(",")}) values (${usar.map(() => "?").join(",")})`).run(...usar.map((k) => v[k]));
});
console.log(`Sembradas ${CUENTAS.length} cuentas sintéticas para ${ORIGEN}/login en el perfil ${PERFIL}`);
db.close();
// 4) Comprobación REAL: Edge rellena el formulario con ese perfil.
if (arg("--verificar")) {
  const c = await chromium.launchPersistentContext(PERFIL, ARGS_EDGE);
  const p = c.pages()[0] ?? await c.newPage();
  await p.goto(`${ORIGEN}/login`, { waitUntil: "networkidle" }); await p.waitForTimeout(4000);
  const r = await p.evaluate(() => ({ correo: document.querySelector('input[name="email"]')?.value ?? "", largoClave: document.querySelector('input[name="password"]')?.value?.length ?? 0, autofill: [...document.querySelectorAll('input[name="email"], input[name="password"]')].every((i) => i.matches(":autofill")) }));
  await c.close();
  const bien = CUENTAS.includes(r.correo) && r.largoClave === CLAVE_SINTETICA.length && r.autofill;
  console.log(`${bien ? "OK" : "FALLO"}: Edge rellenó el formulario de ingreso → correo «${r.correo}», contraseña de ${r.largoClave} caracteres, campos en estado autofill: ${r.autofill}`);
  process.exit(bien ? 0 : 1);
}
