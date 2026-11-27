// Sirve la plantilla HTML del correo de confirmación (GoTrue la pide por HTTP). Antes era un `node -e` en línea; como archivo tiene una línea de comando estable y verificable (RC-1).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const puerto = Number(process.argv[2]);
const html = fs.readFileSync(path.join(import.meta.dirname, "../real_62/plantilla_confirmacion_codigo.html"));
http.createServer((q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); r.end(html); }).listen(puerto, "0.0.0.0");
