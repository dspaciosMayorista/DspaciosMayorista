// 2026-11-18: la vista OPERATIVA interna (ficha del contrato) conserva la instrucción de cobro en COP aunque el documento de cliente la exprese en USD. Base desechable; estado restaurado en finally.
import { execFileSync } from "node:child_process";
import { lanzar, abrir, APP, crearInforme } from "./revision_comun.mjs";
const psql = (sql) => execFileSync("docker", ["exec", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "rev_verif_corr", "-X", "-A", "-t", "-c", sql], { encoding: "utf8" }).trim();
const { ok, cerrar } = crearInforme("ficha interna USD pendiente (COP operativo)");
const orig = psql("select estado from public.ventas where numero_contrato='DTM-0005'");
psql("update public.ventas set estado='pendiente' where numero_contrato='DTM-0005'");
try {
  const b = await lanzar(); const { page } = await abrir(b, { email: "administracion@revision.test" });
  await page.goto(`${APP}/dashboard/contratos/DTM-0005`, { waitUntil: "networkidle" });
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log((t.match(/.{0,60}[Pp]ago m[íi]nimo para confirmar.{0,140}/g) ?? ["(sin texto)"]).join(" || "));
  ok(/Pago mínimo para confirmar[^.]{0,80}1\.230\.000/.test(t) || /1\.230\.000 COP/.test(t), "la ficha interna muestra el mínimo en COP (1.230.000), instrucción de cobro operativa");
  await b.close();
} finally { psql(`update public.ventas set estado='${orig}' where numero_contrato='DTM-0005'`); console.log("estado restaurado:", psql("select estado from public.ventas where numero_contrato='DTM-0005'")); }
process.exit(cerrar());
