// HUELLA DEL BUILD LOCAL (#43/#60). Une el build de `.next` con el código del que salió, para que `local4360.ps1 start`
// no sirva un build viejo sin avisar.
//   node huella_build_local4360.mjs <app> escribir   → tras `next build`: guarda .next/local4360-huella.json
//   node huella_build_local4360.mjs <app> comprobar  → antes de `next start`: sale 0 si corresponde, 1 si no (y dice por qué)
// Código que entra = archivos versionados o nuevos (git ls-files -co --exclude-standard) salvo lo que el build no lee:
// docs/, supabase/, pruebas/ y *.md. Se compara el CONTENIDO (sha256), no fechas.
// Además el build debe llevar incrustada la URL local del gateway y ninguna de un proyecto Supabase alojado.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [app, modo] = process.argv.slice(2);
const next = path.join(app, ".next");
const archivoHuella = path.join(next, "local4360-huella.json");
const FUERA = /^(docs|supabase|pruebas|\.worktrees)\/|\.md$/i;

function huella() {
  const lista = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: app, encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\0").filter((f) => f && !FUERA.test(f)).sort();
  const total = crypto.createHash("sha256"); const porArchivo = {};
  for (const f of lista) {
    let h; try { h = crypto.createHash("sha256").update(fs.readFileSync(path.join(app, f))).digest("hex"); } catch { h = "borrado"; }
    porArchivo[f] = h; total.update(`${f}\0${h}\n`);
  }
  return { hash: total.digest("hex"), archivos: porArchivo };
}

// Recorre los chunks de cliente y el servidor compilado buscando la URL de Supabase incrustada.
function urlsIncrustadas() {
  let local = false; const alojadas = new Set();
  const visitar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "cache" && e.name !== "dev") visitar(p); }
      else if (/\.(js|json|html)$/.test(e.name)) {
        const t = fs.readFileSync(p, "utf8");
        if (t.includes("127.0.0.1:54360")) local = true;
        for (const m of t.matchAll(/[a-z0-9]{20}\.supabase\.co/g)) alojadas.add(m[0]);
      }
    }
  };
  visitar(next);
  return { local, alojadas: [...alojadas] };
}

if (!fs.existsSync(path.join(next, "BUILD_ID"))) { console.log("NO HAY BUILD: falta .next/BUILD_ID (corre 'prod' una vez)."); process.exit(1); }
const buildId = fs.readFileSync(path.join(next, "BUILD_ID"), "utf8").trim();

if (modo === "escribir") {
  const h = huella();
  fs.writeFileSync(archivoHuella, JSON.stringify({ buildId, fecha: new Date().toISOString(), ...h }));
  console.log(`huella del build ${buildId} guardada (${Object.keys(h.archivos).length} archivos)`);
  process.exit(0);
}

let fallos = 0;
const u = urlsIncrustadas();
if (!u.local) { console.log("NO CORRESPONDE: el build no lleva la URL del gateway local (127.0.0.1:54360); no se hizo con este entorno."); fallos++; }
if (u.alojadas.length) { console.log(`NO CORRESPONDE: el build lleva URL de Supabase alojado (${u.alojadas.join(", ")}).`); fallos++; }

const actual = huella();
if (fs.existsSync(archivoHuella)) {
  const g = JSON.parse(fs.readFileSync(archivoHuella, "utf8"));
  if (g.buildId !== buildId) { console.log(`DESACTUALIZADO: la huella es del build ${g.buildId} y .next tiene ${buildId}.`); fallos++; }
  else if (g.hash !== actual.hash) {
    const todos = new Set([...Object.keys(g.archivos), ...Object.keys(actual.archivos)]);
    const dif = [...todos].filter((f) => g.archivos[f] !== actual.archivos[f]).sort();
    console.log(`DESACTUALIZADO: ${dif.length} archivo(s) cambiaron desde el build ${buildId} (${g.fecha}):`);
    for (const f of dif.slice(0, 20)) console.log(`  ${!g.archivos[f] ? "nuevo   " : !actual.archivos[f] ? "quitado " : "cambiado"} ${f}`);
    if (dif.length > 20) console.log(`  … y ${dif.length - 20} más`);
    fallos++;
  } else console.log(`el build ${buildId} corresponde al código actual (huella de contenido, ${Object.keys(actual.archivos).length} archivos)`);
} else {
  // Build anterior a la huella: solo se puede comparar por fecha. Se informa como tal y NO se adopta la huella.
  const t = fs.statSync(path.join(next, "BUILD_ID")).mtimeMs;
  const nuevos = Object.keys(actual.archivos).filter((f) => { try { return fs.statSync(path.join(app, f)).mtimeMs > t; } catch { return true; } });
  if (nuevos.length) { console.log(`DESACTUALIZADO (por fecha; build sin huella): ${nuevos.length} archivo(s) modificados después del build:`); for (const f of nuevos.slice(0, 20)) console.log(`  ${f}`); fallos++; }
  else console.log(`el build ${buildId} no tiene huella de contenido (es anterior a ella); por FECHA ningún archivo del código es posterior al build.`);
}
process.exit(fallos ? 1 : 0);
