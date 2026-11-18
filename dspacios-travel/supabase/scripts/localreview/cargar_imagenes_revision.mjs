// #105 — Carga fotos SINTÉTICAS en el Storage LOCAL de la revisión: ORIGINALES PESADOS «ya almacenados» (como los que hoy sube el equipo desde la cámara),
// algunos medianos y otros ya reducidos, y las enlaza a los Programas/Receptivos de semilla_revision_105.sql. No toca ningún archivo existente fuera de este entorno.
// Uso: node cargar_imagenes_revision.mjs <config.json> <gateway_url>   (lo lanza localreview.ps1 preparar)
import { readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [cfgPath, URL_GW] = process.argv.slice(2);
if (!cfgPath || !(URL_GW ?? "").startsWith("http://127.0.0.1")) throw new Error("Solo local: uso node cargar_imagenes_revision.mjs <config.json> <http://127.0.0.1:...>");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const H = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` };
const dir = mkdtempSync(join(tmpdir(), "rev-fixtures-"));
execFileSync(process.execPath, [fileURLToPath(new URL("../local-img/generar_fixtures.mjs", import.meta.url)), dir], { stdio: "inherit" });
const archivos = new Set(readdirSync(dir));

async function subir(bucket, ruta, archivo) {
  if (!archivos.has(archivo)) throw new Error(`falta el fixture ${archivo}`);
  const r = await fetch(`${URL_GW}/storage/v1/object/${bucket}/${ruta}`, { method: "POST", headers: { ...H, "content-type": "image/jpeg", "x-upsert": "true", "cache-control": "max-age=3600" }, body: readFileSync(join(dir, archivo)) });
  if (!r.ok) throw new Error(`Storage ${bucket}/${ruta}: ${r.status} ${await r.text()}`);
  return `${URL_GW}/storage/v1/object/public/${bucket}/${ruta}`;
}
async function parchar(tabla, id, columna, valor) {
  const r = await fetch(`${URL_GW}/rest/v1/${tabla}?id=eq.${id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ [columna]: valor }) });
  if (!r.ok) throw new Error(`${tabla} ${id}: ${r.status} ${await r.text()}`);
}
// Programas 916101–916106: 3 originales de cámara (~9 MB), 1 grande, 2 ya del tamaño de una subida nueva.
const prog = ["huge-1.jpg", "huge-2.jpg", "huge-3.jpg", "large-1.jpg", "ok-1.jpg", "ok-2.jpg"];
for (let i = 0; i < prog.length; i++) await parchar("programas", 916101 + i, "portada_url", await subir("programas", `rev/portada-${916101 + i}.jpg`, prog[i]));
// Receptivos 916101–916112: 4 originales pesados, 4 grandes, 4 medianos.
const rec = ["huge-4.jpg", "huge-5.jpg", "huge-6.jpg", "large-2.jpg", "large-3.jpg", "large-4.jpg", "large-5.jpg", "large-6.jpg", "ok-3.jpg", "ok-4.jpg", "ok-5.jpg", "ok-6.jpg"];
for (let i = 0; i < rec.length; i++) await parchar("servicios_adicionales", 916101 + i, "foto_url", await subir("servicio-fotos", `rev/servicio-${916101 + i}.jpg`, rec[i]));
console.log(`Fotos cargadas: ${prog.length} portadas de Programas y ${rec.length} fotos de Receptivos (originales pesados incluidos).`);
