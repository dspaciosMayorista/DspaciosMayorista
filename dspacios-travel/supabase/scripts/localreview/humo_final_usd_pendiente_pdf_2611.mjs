// Corrección del dueño 2026-11-18 · PDF del documento USD en estado PENDIENTE (build final, base desechable rev_verif_corr; el estado se restaura en finally). Uso: node humo_final_usd_pendiente_pdf_2611.mjs <carpeta>
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { lanzar, abrir, APP, crearInforme } from "./revision_comun.mjs";
const DB = "rev_verif_corr"; const OUT = process.argv[2] ?? "C:/tmp/vfinal/pdf"; mkdirSync(OUT, { recursive: true });
const psql = (sql) => execFileSync("docker", ["exec", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-A", "-t", "-c", sql], { encoding: "utf8" }).trim();
const { ok, cerrar } = crearInforme("PDF USD pendiente (build final)");
const orig = psql("select estado from public.ventas where numero_contrato='DTM-0005'");
psql("update public.ventas set estado='pendiente' where numero_contrato='DTM-0005'");
try {
  const b = await lanzar(); const { page } = await abrir(b, { email: "administracion@revision.test" });
  await page.goto(`${APP}/contrato/DTM-0005`, { waitUntil: "networkidle" });
  await page.pdf({ path: `${OUT}/pdf-DTM-0005-pendiente.pdf`, format: "A4", printBackground: true });
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  ok(/Pago mínimo para confirmar: \$300 USD \(mínimo acordado\)/.test(t), "pendiente: «Pago mínimo para confirmar: $300 USD (mínimo acordado)»");
  ok(!/1\.230\.000|4\.100\.000|Total a cobrar/.test(t), "pendiente: ni 1.230.000 ni 4.100.000 ni «Total a cobrar»");
  ok(/TOTAL PAGADO USD \$300\b/.test(t) && /SALDO PENDIENTE USD \$700\b/.test(t), "pendiente: pagado USD 300 · saldo USD 700");
  await b.close();
} finally { psql(`update public.ventas set estado='${orig}' where numero_contrato='DTM-0005'`); console.log("estado restaurado:", psql("select estado from public.ventas where numero_contrato='DTM-0005'")); }
process.exit(cerrar());
