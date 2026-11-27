// Dedicated REVIEW BROWSER profile (#103): a separate Microsoft Edge profile whose saved passwords are ONLY the four synthetic review accounts, so the owner picks an account from the browser's list instead of typing it.
// It does not touch the personal Edge profile, does not change the product login and is not a shortcut: Edge fills the normal e-mail/password form and the server authenticates exactly as always.
// Mechanism (verified in an earlier review): Edge keeps passwords in `Default/Login Data` (SQLite) encrypted with AES-256-GCM; the key is protected with the Windows user's DPAPI, which only the same user can open.
//   node review_browser.mjs prepare [account] [--verify]   seeds the profile (the named account first = the one Edge proposes first) and, with --verify, proves in a real Edge that the form is filled (:autofill)
//   node review_browser.mjs open [account]                  opens a normal Edge window with that profile on the login page (the saved-account list appears when you click the e-mail field)
//   node review_browser.mjs list                            shows the accounts stored in the profile (no passwords printed)
// Close the review Edge window before `prepare` (the profile cannot be written while it is open). Local synthetic accounts only (@walk.test).
import { chromium } from "../../../node_modules/@playwright/test/index.mjs";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";
import { createCipheriv, randomBytes, createDecipheriv } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ajustesRevision, cargarConfig, contrasenaRevision, requerir } from "./lib.mjs";

export const CUENTAS_REVISION = ["admin103@walk.test", "ops103@walk.test", "sup103@walk.test", "venta103@walk.test"];
const ARGS_EDGE = { channel: "msedge", headless: true, ignoreDefaultArgs: ["--password-store=basic", "--use-mock-keychain", "--disable-features=PasswordManager"] };
export const perfilDe = (a) => path.join(a.work, "edge-profile");
export const origenDe = (cfg, a) => `http://127.0.0.1:${a.appPort ?? cfg.puertos.app}`;
const epoca = (ms) => BigInt(ms) * 1000n + 11644473600000000n;      // microseconds since 1601 (Chromium format)

function claveDelPerfil(perfil) {
  const ek = Buffer.from(JSON.parse(fs.readFileSync(path.join(perfil, "Local State"), "utf8")).os_crypt.encrypted_key, "base64");
  requerir(ek.subarray(0, 5).toString("latin1") === "DPAPI", "This Edge does not use the classic DPAPI key: passwords cannot be seeded (use Edge's manual password import).");
  const b64 = execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${ek.subarray(5).toString("base64")}'), $null, 'CurrentUser'))`], { encoding: "utf8" }).trim();
  return Buffer.from(b64, "base64");
}
/** Writes the saved logins (idempotent: replaces the rows of THIS origin only). `primera` = the account Edge proposes first. */
// Without an explicit account the CURRENT first proposal is kept, so a routine start/resume never changes which account the browser proposes.
function primeraGuardada(a, cfg) { try { const c = cuentasGuardadas(a, cfg)[0]?.cuenta; return CUENTAS_REVISION.includes(c) ? c : CUENTAS_REVISION[0]; } catch { return CUENTAS_REVISION[0]; } }
export async function prepararPerfil(a, cfg, primeraPedida) {
  const primera = primeraPedida ?? primeraGuardada(a, cfg);
  const perfil = perfilDe(a), origen = origenDe(cfg, a), pass = contrasenaRevision(cfg);
  const orden = [primera, ...CUENTAS_REVISION.filter((c) => c !== primera)];
  requerir(orden.every((c) => /@walk\.test$/.test(c)) && CUENTAS_REVISION.includes(primera), `Unknown review account «${primera}».`);
  fs.mkdirSync(perfil, { recursive: true });
  if (!fs.existsSync(path.join(perfil, "Default", "Login Data"))) {          // a new profile: one first launch creates Edge's state and password database
    const c = await chromium.launchPersistentContext(perfil, ARGS_EDGE); await (c.pages()[0] ?? await c.newPage()).goto("about:blank"); await new Promise((r) => setTimeout(r, 1500)); await c.close();
  }
  const clave = claveDelPerfil(perfil), cifrar = (t) => { const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", clave, iv); const ct = Buffer.concat([c.update(t, "utf8"), c.final()]); return Buffer.concat([Buffer.from("v10"), iv, ct, c.getAuthTag()]); };
  let db; try { db = new DatabaseSync(path.join(perfil, "Default", "Login Data")); db.exec("select 1 from logins limit 1"); } catch (e) { throw new Error(`Cannot write the review browser profile (is the review Edge window still open?). Close it and retry. ${String(e).slice(0, 100)}`); }
  const cols = new Set(db.prepare("pragma table_info(logins)").all().map((c) => c.name));
  db.prepare("delete from logins where signon_realm = ?").run(`${origen}/`);
  orden.forEach((correo, i) => {
    const t = epoca(Date.now() - i * 1000);
    const v = { origin_url: `${origen}/login`, action_url: `${origen}/login`, username_element: "email", username_value: correo, password_element: "password", password_value: cifrar(pass), submit_element: "", signon_realm: `${origen}/`, date_created: t, blacklisted_by_user: 0, scheme: 0, password_type: 0, times_used: 0, form_data: Buffer.alloc(0), display_name: "", icon_url: "", federation_url: "", skip_zero_click: 0, generation_upload_status: 0, possible_username_pairs: Buffer.alloc(0), date_last_used: t, moving_blocked_for: Buffer.alloc(0), date_password_modified: t, sharing_notification_displayed: 0, date_last_filled: t, actor_login_approved: 0 };
    const usar = Object.keys(v).filter((k) => cols.has(k));
    db.prepare(`insert into logins (${usar.join(",")}) values (${usar.map(() => "?").join(",")})`).run(...usar.map((k) => v[k]));
  });
  db.close();
  return { perfil, origen, cuentas: orden };
}
/** Accounts currently saved for the origin, decrypted ONLY to prove they match the review password (never printed). */
export function cuentasGuardadas(a, cfg) {
  const perfil = perfilDe(a), db = new DatabaseSync(path.join(perfil, "Default", "Login Data"), { readOnly: true });
  const filas = db.prepare("select username_value as u, password_value as p from logins where signon_realm = ? order by date_last_used desc").all(`${origenDe(cfg, a)}/`); db.close();
  const clave = claveDelPerfil(perfil), pass = contrasenaRevision(cfg);
  return filas.map((f) => { const b = Buffer.from(f.p), d = createDecipheriv("aes-256-gcm", clave, b.subarray(3, 15)); d.setAuthTag(b.subarray(b.length - 16)); const txt = Buffer.concat([d.update(b.subarray(15, b.length - 16)), d.final()]).toString("utf8"); return { cuenta: f.u, claveCorrecta: txt === pass }; });
}
/** A REAL Edge with the profile: does it fill the sign-in form (fields in :autofill state)? Returns what it saw. */
export async function comprobarAutofill(a, cfg) {
  const c = await chromium.launchPersistentContext(perfilDe(a), ARGS_EDGE), p = c.pages()[0] ?? await c.newPage();
  try {
    await p.goto(`${origenDe(cfg, a)}/login`, { waitUntil: "networkidle" }); await p.waitForTimeout(4000);
    return await p.evaluate(() => ({ correo: document.querySelector('input[name="email"]')?.value ?? "", largoClave: document.querySelector('input[name="password"]')?.value?.length ?? 0, autofill: [...document.querySelectorAll('input[name="email"], input[name="password"]')].every((i) => i.matches(":autofill")) }));
  } finally { await c.close(); }
}
/** A page driver over the review profile with the helper API used by the rehearsal (ir / evaluar / esperar / ...). Headless, for the executor's rehearsal only. */
export async function abrirNavegador(a, cfg, { ancho = 1280, alto = 900 } = {}) {
  const c = await chromium.launchPersistentContext(perfilDe(a), { ...ARGS_EDGE, viewport: { width: ancho, height: alto } }), p = c.pages()[0] ?? await c.newPage();
  p.setDefaultTimeout(20000);
  await p.addInitScript(() => { window.confirm = () => true; window.alert = () => {}; });
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = {
    page: p, dormir,
    ir: async (url) => { await p.goto(url, { waitUntil: "load" }); await dormir(800); },
    evaluar: (fn, ...args) => p.evaluate(({ src, args: ar }) => (0, eval)(`(${src})`)(...ar), { src: fn.toString(), args }),
    async esperar(fn, ms = 15000, ...args) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await this.evaluar(fn, ...args)) return true; } catch { /* navigating */ } await dormir(300); } throw new Error("timeout waiting for condition"); },
    tam: async (w, h) => { await p.setViewportSize({ width: w, height: h }); await dormir(300); },
    foto: (ruta) => p.screenshot({ path: ruta, fullPage: true }),
    archivo: (selector, ruta) => p.setInputFiles(selector, ruta),
    limpiarSesion: () => c.clearCookies(), cerrar: () => c.close(),
  };
  return api;
}
/** Signs in WITHOUT typing: the browser fills the saved account; we only check it did and submit the normal form. */
export async function ingresarConAutofill(b, cfg, a, correoEsperado) {
  await b.ir(`${origenDe(cfg, a)}/login`); await b.dormir(3500);
  const visto = await b.evaluar(() => ({ correo: document.querySelector('input[name="email"]')?.value ?? "", largoClave: document.querySelector('input[name="password"]')?.value?.length ?? 0, autofill: [...document.querySelectorAll('input[name="email"], input[name="password"]')].every((i) => i.matches(":autofill")) }));
  requerir(visto.correo === correoEsperado && visto.autofill && visto.largoClave > 0, `The browser did not fill the saved account (saw «${visto.correo}», autofill=${visto.autofill}).`);
  await b.evaluar(() => document.querySelector('button[type="submit"]').click());
  await b.esperar(() => !location.pathname.startsWith("/login"), 30000);
  return visto;
}

if (path.basename(process.argv[1] ?? "") === "review_browser.mjs") {
  const [orden, ...resto] = process.argv.slice(2), a = ajustesRevision();
  try {
    const cfg = cargarConfig(a), cuenta = resto.find((x) => !x.startsWith("--")) ?? undefined;
    const completa = cuenta ? (CUENTAS_REVISION.find((c) => c === cuenta || c.startsWith(cuenta + "@") || c.startsWith(cuenta))) : undefined;
    requerir(!cuenta || completa, `Unknown account «${cuenta}». Choose one of: ${CUENTAS_REVISION.join(", ")}`);
    if (orden === "prepare") {
      const r = await prepararPerfil(a, cfg, completa);
      console.log(`Saved ${r.cuentas.length} synthetic accounts for ${r.origen}/login in ${r.perfil} (first proposed: ${r.cuentas[0]})`);
      if (resto.includes("--verify")) {
        const v = await comprobarAutofill(a, cfg), ok = v.correo === r.cuentas[0] && v.autofill && v.largoClave > 0;
        console.log(`${ok ? "OK" : "FAIL"}: Edge filled the sign-in form → account «${v.correo}», password of ${v.largoClave} characters, fields in autofill state: ${v.autofill}`); process.exit(ok ? 0 : 1);
      }
    } else if (orden === "open") {
      if (completa) await prepararPerfil(a, cfg, completa);
      const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p)); requerir(edge, "Microsoft Edge not found.");
      requerir(fs.existsSync(path.join(perfilDe(a), "Default", "Login Data")), "The review browser profile is not prepared: run `node review_browser.mjs prepare` first.");
      spawn(edge, [`--user-data-dir=${perfilDe(a)}`, "--no-first-run", "--no-default-browser-check", "--new-window", `${origenDe(cfg, a)}/login`], { detached: true, stdio: "ignore" }).unref();
      console.log(`Edge (review profile) opened on ${origenDe(cfg, a)}/login — click the e-mail field and choose an account from the list.`);
    } else if (orden === "list") {
      for (const f of cuentasGuardadas(a, cfg)) console.log(`${f.cuenta}  password matches the review password: ${f.claveCorrecta}`);
    } else { console.error("Usage: node review_browser.mjs prepare [account] [--verify] | open [account] | list"); process.exit(2); }
  } catch (e) { console.error("review_browser:", e instanceof Error ? e.message : e); process.exit(1); }
}
