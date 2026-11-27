// Build de producción de la revisión local con el entorno que usa la app de revisión (llaves/puertos del config; NEXT_PUBLIC_* se incrustan al construir). Memoria acotada: heap 3 GB y 3 CPU.
// Uso (desde dspacios-travel/, con el mutex de comandos pesados):  node supabase/scripts/revision_consolidada/construir.cjs
// Antes de construir archiva el .next vigente en C:/tmp/consolidada/next_<BUILD_ID> (si no existe ya) para no perder la evidencia del build anterior. NO detiene nada: detén la app de revisión antes (el build reescribe .next).
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
const dir = path.join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const c = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
const source = fs.readFileSync("supabase/scripts/revision_consolidada/revision.mjs", "utf8");
const body = source.slice(source.indexOf("function entornoApp(c) {"), source.indexOf("\nfunction iniciarApp(c)"));
const env = new Function("c", "DOMINIO", "BUZON", body + "; return entornoApp(c);")(c, "consolidada.test", "ACwalk0000test1");
const shim = path.join(dir, "build-cpus.cjs");
fs.writeFileSync(shim, "const os=require('node:os');const cpus=os.cpus.bind(os);os.cpus=()=>cpus().slice(0,3);os.availableParallelism=()=>3;");
env.NODE_OPTIONS = "--max-old-space-size=3072 --require " + JSON.stringify(shim);
const idFile = path.join(".next", "BUILD_ID");
if (fs.existsSync(idFile)) {
  const id = fs.readFileSync(idFile, "utf8").trim(), dest = "C:/tmp/consolidada/next_" + id;
  if (!fs.existsSync(dest)) { console.log("archivando el build vigente " + id + " en " + dest); fs.cpSync(".next", dest, { recursive: true }); }
}
console.log("Construyendo. RAM libre MB: " + Math.round(os.freemem() / 1048576));
const r = cp.spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env, stdio: "inherit", windowsHide: true });
process.exit(r.status ?? 1);
