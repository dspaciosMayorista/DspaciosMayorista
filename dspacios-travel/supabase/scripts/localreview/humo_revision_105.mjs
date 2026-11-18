// #105 + O1 + O2 sobre la fuente INTEGRADA, Edge real (Playwright):
//   O1  las MISMAS fotos publicadas de Programas y Receptivos para visitante, aliado, venta, administración y superadmin; foto rota y foto faltante caen al «Sin foto»; solicitudes de imagen por rol.
//   O2  un original de cámara > 8 MB se REDUCE antes del tope final: subida → Storage local → guardar → recargar → ver; un archivo no reducible y pesado recibe un error claro.
//   #105 portada de Programa y foto de Receptivo con los cargadores reales; los originales pesados ya almacenados no se tocan.
// ESCRIBE datos de prueba (subidas y una foto rota temporal): corre `localreview.ps1 restaurar` después.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_105.mjs <carpeta_capturas> <carpeta_fixtures>
import { join } from "node:path";
import { statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { lanzar, abrir, abrirConLogin, APP, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; const FIX = process.argv[3]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("#105 · O1 · O2");
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", (process.env.REV_DB_VERIF ?? "rev_revision"), "-X", "-q", "-t", "-A"], { input: q, encoding: "utf8" }).trim();
const b = await lanzar();

// Sin decodificar los originales de 9 MB en el navegador: se leen las URL que la página RECIBIÓ para cada rol y se comprueban con HEAD.
async function fotos(page) {
  await page.waitForTimeout(1500);
  const { urls, sinFoto } = await page.evaluate(() => ({
    urls: [...new Set([...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src).filter((u) => /storage\/v1\/object\/public\/(programas|servicio-fotos)/.test(u)))],
    sinFoto: (document.body.innerText.match(/Sin foto/g) ?? []).length,
  }));
  let cargadas = 0, rotas = 0;
  for (const u of urls) { const r = await fetch(u, { method: "HEAD" }); if (r.status === 200) cargadas++; else rotas++; }
  return { cargadas, rotas, total: urls.length, sinFoto, urls: urls.sort() };
}
async function pestana(page, nombre) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`^${nombre}$`) }).first().click();
  await page.waitForTimeout(1500);
}

// ── O1 · mismas fotos publicadas para todos los roles ──────────────────────────────────────────────────
const porRol = {};
for (const [rol, email] of [["visitante", null], ["aliado (agencia)", "aliado@revision.test"], ["venta", "venta@revision.test"], ["administracion", "administracion@revision.test"], ["superadmin", "superadmin@revision.test"]]) {
  const { ctx, page } = email ? await abrirConLogin(b, email) : await abrir(b);
  const reqImg = []; page.on("request", (rq) => { if (/storage\/v1\/object\/public\/servicio-fotos/.test(rq.url())) reqImg.push(rq.url()); });
  await pestana(page, "Programas"); const p = await fotos(page);
  reqImg.length = 0;
  await pestana(page, "Receptivos");
  const r = await fotos(page);
  const alCargar = reqImg.length; await page.waitForTimeout(4000); const enReposo = reqImg.length - alCargar;
  porRol[rol] = { programas: p, receptivos: r, alCargar, enReposo };
  console.log(`  ${rol.padEnd(18)} Programas ${JSON.stringify({ ...p, urls: undefined })} · Receptivos ${JSON.stringify({ ...r, urls: undefined })} · solicitudes de foto al cargar ${alCargar}, en reposo ${enReposo}`);
  if (rol === "visitante") await page.screenshot({ path: join(OUT, "105-receptivos-visitante.png"), fullPage: false });
  await ctx.close();
}
const roles = Object.keys(porRol);
for (const rol of roles) {
  ok(porRol[rol].programas.cargadas === 6 && porRol[rol].programas.rotas === 0, `O1 ${rol}: Programas 6 portadas, 0 rotas`);
  ok(porRol[rol].receptivos.cargadas === 12 && porRol[rol].receptivos.rotas === 0 && porRol[rol].receptivos.sinFoto === 0, `O1 ${rol}: Receptivos 12 fotos publicadas, 0 rotas, 0 «Sin foto» (${porRol[rol].receptivos.cargadas}/${porRol[rol].receptivos.rotas}/${porRol[rol].receptivos.sinFoto})`);
}
ok(roles.every((r) => JSON.stringify(porRol[r].receptivos.urls) === JSON.stringify(porRol.visitante.receptivos.urls)), "O1: las MISMAS 12 URL de foto para todos los roles");
ok(roles.every((r) => porRol[r].alCargar === porRol.visitante.alCargar), `O1: la misma cantidad de solicitudes de foto al cargar para todos los roles (${porRol.visitante.alCargar})`);
ok(roles.every((r) => porRol[r].enReposo === 0), "O1: 0 solicitudes de foto en reposo (sin reintentos ni sondeos)");
// Foto rota (404) y foto faltante (null): el «Sin foto» de siempre, nunca un icono roto ni un reintento
sql("update public.servicios_adicionales set foto_url = 'http://127.0.0.1:54370/storage/v1/object/public/servicio-fotos/rev/no-existe.jpg' where id = 916105; update public.servicios_adicionales set foto_url = null where id = 916106;");
{
  const { ctx, page } = await abrir(b);
  const reqRota = []; page.on("request", (rq) => { if (/no-existe\.jpg/.test(rq.url())) reqRota.push(rq.url()); });
  await pestana(page, "Receptivos");
  await page.waitForTimeout(3000);
  const t = await texto(page); const sin = (t.match(/Sin foto/g) ?? []).length;
  const rotasVisibles = await page.evaluate(() => [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0 && /servicio-fotos/.test(i.currentSrc || i.src)).length);
  ok(sin >= 1, `O1: la foto faltante / rota se ve como «Sin foto» (${sin} placeholder(s))`);
  ok(rotasVisibles === 0, "O1: ningún icono de imagen rota visible");
  ok(reqRota.length <= 1, `O1: la foto rota se pide como máximo una vez (${reqRota.length}): sin reintentos`);
  await page.screenshot({ path: join(OUT, "105-receptivos-foto-rota.png"), fullPage: false });
  await ctx.close();
}
sql("update public.servicios_adicionales set foto_url = 'http://127.0.0.1:54370/storage/v1/object/public/servicio-fotos/rev/servicio-916105.jpg' where id = 916105; update public.servicios_adicionales set foto_url = 'http://127.0.0.1:54370/storage/v1/object/public/servicio-fotos/rev/servicio-916106.jpg' where id = 916106;");

// ── Subidas autenticadas con los cargadores reales (#105 + O2) ──────────────────────────────────────────
const antesPortada = sql("select portada_url from public.programas where id=916101");
const tam = (bucket, url) => Number(sql(`select coalesce((metadata->>'size')::bigint,0) from storage.objects where bucket_id='${bucket}' and name='${url.split(`/${bucket}/`)[1]}'`) || 0);
{
  const { ctx, page, cuenta } = await abrirConLogin(b, "superadmin@revision.test");
  await page.goto(`${APP}/dashboard/producto/programas/916101`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Imágenes y piezas/ }).click();
  const original = join(FIX, "huge-1.jpg"); const pesoOriginal = statSync(original).size;
  reiniciar(cuenta);
  await page.locator("section:has-text('Portada (fondo del programa)') input[type=file]").first().setInputFiles(original);
  const t0 = Date.now(); let nueva = antesPortada;
  while (Date.now() - t0 < 60000 && nueva === antesPortada) { await page.waitForTimeout(500); nueva = sql("select portada_url from public.programas where id=916101"); }
  ok(nueva !== antesPortada && /portada_url-\d+\.(webp|jpg)/.test(nueva), `Programa 916101: la portada nueva se guardó (${nueva.split("/").pop()})`);
  const t = tam("programas", nueva);
  ok(t > 0 && t < pesoOriginal / 3, `lo almacenado pesa ${Math.round(t / 1024)} KB frente a ${Math.round(pesoOriginal / 1024)} KB del original (reductor en el navegador)`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Imágenes y piezas/ }).click(); await page.waitForTimeout(1500);
  const vista = await page.evaluate((u) => { const i = [...document.querySelectorAll("img")].find((x) => (x.currentSrc || x.src).includes(u)); return i ? { w: i.naturalWidth, h: i.naturalHeight } : null; }, nueva.split("/").pop());
  ok(!!vista && vista.w > 0 && vista.w <= 1920, `tras recargar se ve la portada nueva (${vista ? `${vista.w}x${vista.h}` : "no encontrada"})`);
  ok(await sinDesborde(page), "sin desbordamiento horizontal en el editor");

  // Receptivo: se marca el input de archivo del servicio «IMG Tour 01 CARTAGENA IMG»
  await page.goto(`${APP}/dashboard/producto/servicios`, { waitUntil: "networkidle" });
  await page.evaluate(() => { for (const i of document.querySelectorAll("input[type=file]")) { let e = i.parentElement; while (e && !/IMG Tour \d\d/.test(e.innerText)) e = e.parentElement; if (e && /IMG Tour 01 /.test(e.innerText) && !/IMG Tour 02 /.test(e.innerText)) { i.setAttribute("data-rev", "tour01"); break; } } });
  const entrada = page.locator("[data-rev=tour01]");
  const errorVisible = () => page.evaluate(() => [...document.querySelectorAll("p")].map((p) => p.innerText).find((x) => /MB|reducir|imagen/i.test(x) && x.length > 15) ?? "");
  const antesRec = sql("select foto_url from public.servicios_adicionales where id=916101");

  // O2 · un archivo NO reducible (GIF) de 9 MB: error claro y NO se sube nada
  const gif = join(OUT, "pesado-no-reducible.gif");
  writeFileSync(gif, Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(9 * 1024 * 1024, 7)]));
  await entrada.setInputFiles(gif);
  await page.waitForTimeout(1500);
  const errGif = await errorVisible();
  ok(/9,0 MB/.test(errGif) && /no se puede reducir automáticamente/.test(errGif) && /JPG o WebP/.test(errGif), `O2: un GIF de 9 MB recibe un error claro («${errGif.slice(0, 110)}…»)`);
  ok(sql("select foto_url from public.servicios_adicionales where id=916101") === antesRec, "O2: el archivo no reducible NO cambió la foto guardada");
  await page.screenshot({ path: join(OUT, "105-o2-error-no-reducible.png"), fullPage: false });

  // O2 · un original de cámara de más de 8 MB (huge-4: ~9,2 MB) entra por su versión reducida
  const camara = join(FIX, "huge-4.jpg"); const pesoCamara = statSync(camara).size;
  ok(pesoCamara > 8 * 1024 * 1024, `O2: el original de cámara pesa ${(pesoCamara / 1048576).toFixed(1)} MB (> 8 MB)`);
  await entrada.setInputFiles(camara);
  const t1 = Date.now(); let recNueva = antesRec;
  while (Date.now() - t1 < 60000 && recNueva === antesRec) { await page.waitForTimeout(500); recNueva = sql("select foto_url from public.servicios_adicionales where id=916101"); }
  ok(recNueva !== antesRec && recNueva.includes("/servicio-fotos/"), `O2: el original > 8 MB se subió y se guardó (${recNueva.split("/").pop()})`);
  const tamRec = tam("servicio-fotos", recNueva);
  ok(tamRec > 0 && tamRec <= 8 * 1024 * 1024 && tamRec < pesoCamara / 3, `O2: en Storage pesa ${Math.round(tamRec / 1024)} KB (≤ 8 MB, el límite no cambió) frente a ${Math.round(pesoCamara / 1024)} KB del original`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const mini = await page.evaluate((u) => { const i = [...document.querySelectorAll("img")].find((x) => (x.currentSrc || x.src).includes(u)); return i ? { w: i.naturalWidth } : null; }, recNueva.split("/").pop());
  ok(!!mini && mini.w > 0, "O2: tras recargar la miniatura del Receptivo se ve");
  await page.screenshot({ path: join(OUT, "105-servicios-subida.png"), fullPage: false });
  await ctx.close();
  // y el visitante ve la foto NUEVA en el catálogo público
  const pub = await abrir(b);
  await pestana(pub.page, "Receptivos");
  const f2 = await fotos(pub.page);
  ok(f2.urls.some((u) => u.includes(recNueva.split("/").pop())), "O2: el visitante ve en el catálogo público la foto recién subida");
  await pub.ctx.close();
}
// Los originales pesados existentes siguen intactos
const peso = sql("select count(*) filter (where (metadata->>'size')::bigint > 5000000) from storage.objects where bucket_id in ('programas','servicio-fotos')");
ok(Number(peso) >= 5, `los originales pesados ya almacenados siguen allí sin reescribir (${peso} objetos > 5 MB)`);
await b.close();
process.exit(cerrar());
