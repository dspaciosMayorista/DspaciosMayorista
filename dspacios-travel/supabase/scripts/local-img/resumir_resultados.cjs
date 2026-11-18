const r = require(process.argv[2]).resultados;
console.log("scenario | reqs0 | MB0 | reqs | MB | pico | 1st ms | vista0 n | vista0 ms | LCP | CLS | 3xx/304 | abiertasFin");
for (const [k, v] of Object.entries(r)) {
  if (v.error) { console.log(k, "ERROR", v.error); continue; }
  console.log([k, v.peticionesAntesDeScroll, (v.bytesAntesDeScroll / 1048576).toFixed(1), v.peticiones, (v.bytes / 1048576).toFixed(1), v.picoConcurrencia, v.primeraImagenMs, v.imgsEnVista0, v.todasEnVista0Ms, v.lcp?.t, v.cls, v.conditional304, v.abiertasAlFinal ?? "-"].join(" | "));
}
