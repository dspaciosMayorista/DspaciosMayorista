// SONDA de diagnóstico (no es una prueba): ¿cómo se abre el popup «Ver opciones» de la tarjeta con fechas? Solo base DESECHABLE.
import { chromium } from "@playwright/test";
import { SUPA, APP, cookieSesion } from "./revision_comun.mjs";
void SUPA;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "es-CO" });
await ctx.addCookies(await cookieSesion("administracion@revision.test"));
const page = await ctx.newPage();
await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Porción terrestre/ }).first().click().catch(() => {}); await page.waitForTimeout(900);
const n = await page.locator('[data-testid="fechas-tarjeta"]').count();
console.log("tarjetas:", n);
const idx = await page.locator('[data-testid="fechas-tarjeta"]').evaluateAll((els) => els.findIndex((e) => { let x = e.parentElement; for (let i = 0; i < 10 && x; i++, x = x.parentElement) { if (/Hotel PRE BF 125 ACTIVO/.test(x.textContent ?? "") && x.querySelectorAll('[data-testid="fechas-tarjeta"]').length === 1) return true; } return false; }));
console.log("indice:", idx);
const bloque = page.locator('[data-testid="fechas-tarjeta"]').nth(idx);
await bloque.locator('input[aria-label="Ida"]').fill("04/12/2026"); await bloque.locator('input[aria-label="Ida"]').blur();
await bloque.locator('input[aria-label="Regreso"]').fill("09/12/2026"); await bloque.locator('input[aria-label="Regreso"]').blur();
await bloque.getByRole("button", { name: /Ver precio para estas fechas/ }).click();
await page.waitForSelector('[data-testid="precio-fechas"]', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
const tarjeta = bloque.locator("xpath=ancestor::*[.//*[contains(text(),'Hotel PRE BF 125 ACTIVO')]][count(.//*[@data-testid='fechas-tarjeta'])=1][last()]");
console.log("botones de la tarjeta:", JSON.stringify((await tarjeta.locator("button").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").slice(0, 60))));
console.log("hrefs/roles:", JSON.stringify(await tarjeta.locator("[role=button],a").evaluateAll((els) => els.map((e) => `${e.tagName}:${(e.textContent ?? "").replace(/\s+/g, " ").slice(0, 40)}`))));
for (const sel of ['button:has-text("Ver opciones")', 'text=/Ver opciones/i', 'img', 'h3']) {
  const l = tarjeta.locator(sel);
  console.log(sel, await l.count());
}
const antes = await page.locator('[role="dialog"]').count();
await page.getByRole("button", { name: /Ver opciones/ }).nth(idx).click({ timeout: 4000 }).catch((e) => console.log("click Ver opciones falló:", String(e).slice(0, 100)));
await page.waitForTimeout(1500);
console.log("dialogs antes/despues:", antes, await page.locator('[role="dialog"]').count(), "fixed:", await page.locator(".fixed.inset-0").count());
console.log("etiquetas dentro del dialog:", JSON.stringify(await page.locator('[role="dialog"] [data-testid="etiqueta-promocion-hotel"]').allInnerTexts()));
await page.screenshot({ path: "C:/tmp/ev126/sonda_popup.png" });
await browser.close();
