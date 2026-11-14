// #86 · Arnés de STORAGE REAL (storage-api local, desechable): mide qué hace el bucket `soportes-pago` (creado por la migración 281) con tamaño, tipo,
// acceso, sobrescritura, URL firmada de subida y de lectura, y cuánta memoria cuesta validar+hashear+guardar varios archivos a la vez.
// La lanza supabase/scripts/test_281_storage.sh. Sin dependencias: fetch/FormData de Node.
//
// ALCANCE DE LA EVIDENCIA: un Storage LOCAL no es el proyecto alojado (versión y configuración pueden diferir; el límite GLOBAL del proyecto no está aquí).
// Lo que se imprime son hechos de ESTA versión de storage-api; no se declara demostrado ningún límite remoto.
import { createHash, randomBytes } from "node:crypto";

const URL_BASE = process.env.STORAGE_URL;
const SERVICIO = process.env.SERVICE_KEY;
const AUTENTICADO = process.env.AUTH_KEY;     // JWT role=authenticated (usuario cualquiera)
const ANON = process.env.ANON_KEY;
if (!URL_BASE || !SERVICIO || !AUTENTICADO || !ANON) throw new Error("Faltan STORAGE_URL, SERVICE_KEY, AUTH_KEY, ANON_KEY: usa test_281_storage.sh");

const BUCKET = "soportes-pago";
const LIMITE = 5_242_880;
const filas = [];
const registrar = (control, esperado, observado) => filas.push({ control, esperado: String(esperado), observado: String(observado), estado: esperado === "informativo" ? "INFO" : String(esperado) === String(observado) ? "OK" : "FALLA" });
const cab = (clave, extra = {}) => ({ Authorization: `Bearer ${clave}`, apikey: clave, ...extra });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const pdf = (n) => Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(Math.max(0, n - 9))]);

async function subir(clave, ruta, bytes, mime, extra = {}) {
  const r = await fetch(`${URL_BASE}/object/${BUCKET}/${ruta}`, { method: "POST", headers: cab(clave, { "content-type": mime, ...extra }), body: bytes });
  return r.status;
}
async function descargar(clave, ruta) {
  const r = await fetch(`${URL_BASE}/object/authenticated/${BUCKET}/${ruta}`, { headers: cab(clave) });
  return { status: r.status, bytes: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
}
const aleatoria = () => `pruebas/${randomBytes(6).toString("hex")}`;

// 0 · el bucket que creó la migración 281 existe tal cual
{
  const r = await fetch(`${URL_BASE}/bucket/${BUCKET}`, { headers: cab(SERVICIO) });
  const b = r.ok ? await r.json() : {};
  registrar("bucket soportes-pago visible para storage-api", "200", r.status);
  registrar("bucket privado", "false", b.public);
  registrar("límite del bucket (bytes)", LIMITE, b.file_size_limit);
  registrar("tipos permitidos del bucket", "application/pdf,image/jpeg,image/png", (b.allowed_mime_types ?? []).join(","));
}

// 1 · subida desde el servidor (service-role): válida, tamaño y tipo
const ruta1 = aleatoria() + ".pdf"; const original = pdf(1_000_000);
registrar("MODO FUNCIÓN · PDF de 1 MB con service-role se acepta", "200", await subir(SERVICIO, ruta1, original, "application/pdf"));
{ const d = await descargar(SERVICIO, ruta1); registrar("MISMOS BYTES · lo descargado es idéntico a lo subido (sha256)", sha(original), d.bytes ? sha(d.bytes) : "sin descarga"); }
registrar("MODO FUNCIÓN · exactamente el límite del bucket se acepta", "200", await subir(SERVICIO, aleatoria() + ".pdf", pdf(LIMITE), "application/pdf"));
{ const s = await subir(SERVICIO, aleatoria() + ".pdf", pdf(LIMITE + 1), "application/pdf"); registrar("MODO FUNCIÓN · un byte por encima del límite se rechaza (código 4xx)", "true", s >= 400 && s < 500); }
{ const s = await subir(SERVICIO, aleatoria() + ".txt", Buffer.from("hola"), "text/plain"); registrar("MODO FUNCIÓN · tipo declarado no permitido (text/plain) se rechaza (4xx)", "true", s >= 400 && s < 500); }
registrar("LÍMITE DE STORAGE · declarar image/png sobre bytes de PDF SÍ se acepta (Storage mira el tipo declarado, no el contenido): por eso la app valida los bytes", "informativo", await subir(SERVICIO, aleatoria() + ".png", pdf(1000), "image/png"));

// 2 · sobrescritura
{
  const r = aleatoria() + ".pdf";
  await subir(SERVICIO, r, pdf(1000), "application/pdf");
  const sin = await subir(SERVICIO, r, pdf(1000), "application/pdf");
  registrar("SOBRESCRITURA · segunda subida a la misma ruta sin upsert se rechaza (4xx; esta versión responde 400 «Duplicate»)", "true", sin >= 400 && sin < 500);
  registrar("SOBRESCRITURA · con x-upsert:true Storage SÍ sobrescribe (la app nunca lo envía)", "informativo", await subir(SERVICIO, r, pdf(1000), "application/pdf", { "x-upsert": "true" }));
}

// 3 · acceso de usuarios (el bucket no tiene ninguna policy)
{
  const r = aleatoria() + ".pdf"; await subir(SERVICIO, r, pdf(1000), "application/pdf");
  const lee = await descargar(AUTENTICADO, r);
  registrar("ACCESO · un usuario autenticado NO descarga", "true", lee.status >= 400);
  registrar("ACCESO · un usuario autenticado NO sube", "true", (await subir(AUTENTICADO, aleatoria() + ".pdf", pdf(1000), "application/pdf")) >= 400);
  registrar("ACCESO · anónimo NO descarga", "true", (await descargar(ANON, r)).status >= 400);
  registrar("ACCESO · anónimo NO sube", "true", (await subir(ANON, aleatoria() + ".pdf", pdf(1000), "application/pdf")) >= 400);
  const l = await fetch(`${URL_BASE}/object/list/${BUCKET}`, { method: "POST", headers: cab(AUTENTICADO, { "content-type": "application/json" }), body: JSON.stringify({ prefix: "pruebas", limit: 5 }) });
  const lista = l.ok ? await l.json() : [];
  registrar("ACCESO · un usuario autenticado NO lista el bucket (vacío o denegado)", "true", !l.ok || (Array.isArray(lista) && lista.length === 0));
}

// 4 · URL firmada de LECTURA (la que usa la app para abrir un soporte)
{
  const r = aleatoria() + ".pdf"; const b = pdf(5000); await subir(SERVICIO, r, b, "application/pdf");
  const f = await fetch(`${URL_BASE}/object/sign/${BUCKET}/${r}`, { method: "POST", headers: cab(SERVICIO, { "content-type": "application/json" }), body: JSON.stringify({ expiresIn: 2 }) });
  const j = f.ok ? await f.json() : {};
  const url = `${URL_BASE}${(j.signedURL ?? "").replace(/^\/storage\/v1/, "")}`;
  const ok = await fetch(url);
  registrar("LECTURA FIRMADA · dentro de su vigencia devuelve los mismos bytes", sha(b), ok.ok ? sha(Buffer.from(await ok.arrayBuffer())) : `HTTP ${ok.status}`);
  await new Promise((res) => setTimeout(res, 3500));
  registrar("LECTURA FIRMADA · vencida (2 s) ya no sirve", "true", (await fetch(url)).status >= 400);
}

// 5 · MODO DIRECTO: URL firmada de SUBIDA (lo que el diseño NO usa salvo que esto lo demuestre)
{
  const r = aleatoria() + ".pdf";
  const f = await fetch(`${URL_BASE}/object/upload/sign/${BUCKET}/${r}`, { method: "POST", headers: cab(SERVICIO) });
  const j = f.ok ? await f.json() : {};
  registrar("MODO DIRECTO · el servidor puede emitir una URL firmada de subida", "200", f.status);
  const token = j.token ?? new globalThis.URL(`http://x${j.url ?? ""}`).searchParams.get("token");
  const subirFirmada = (ruta, bytes, mime) => fetch(`${URL_BASE}/object/upload/sign/${BUCKET}/${ruta}?token=${token}`, { method: "PUT", headers: { "content-type": mime }, body: bytes });
  const grande = await subirFirmada(r, pdf(LIMITE + 1), "application/pdf");
  registrar("MODO DIRECTO · la URL firmada RESPETA el límite del bucket (6 MB rechazado, 4xx)", "true", grande.status >= 400 && grande.status < 500);
  const t = await subirFirmada(r, pdf(1000), "text/plain");
  registrar("MODO DIRECTO · la URL firmada RESPETA los tipos del bucket (text/plain rechazado, 4xx)", "true", t.status >= 400 && t.status < 500);
  const bien = await subirFirmada(r, pdf(1000), "application/pdf");
  registrar("MODO DIRECTO · subida válida con la URL firmada", "200", bien.status);
  const otra = await subirFirmada(r, pdf(1000), "application/pdf");
  registrar("MODO DIRECTO · REUTILIZAR la misma URL para volver a escribir esa ruta (debe fallar)", "true", otra.status >= 400);
  const rutaAjena = aleatoria() + ".pdf";
  const ajena = await subirFirmada(rutaAjena, pdf(1000), "application/pdf");
  registrar("MODO DIRECTO · la URL firmada NO sirve para escribir en OTRA ruta (debe fallar)", "true", ajena.status >= 400);
  registrar("MODO DIRECTO · expiración: documentada por Supabase en 2 horas; NO se mide aquí", "informativo", "no medido");
}

// 6 · memoria y concurrencia del MODO FUNCIÓN: leer a memoria + validar + hashear + guardar, varios a la vez
{
  global.gc?.();
  const base = process.memoryUsage().rss;
  let pico = base;
  const muestreo = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 5);
  const tamano = 4_000_000; const n = 8;
  const t0 = Date.now();
  const estados = await Promise.all(Array.from({ length: n }, async () => {
    const b = pdf(tamano);
    const copia = new Uint8Array(b);                       // la función recibe los bytes en memoria
    const h = sha(copia);                                   // hash de ESTOS bytes
    const s = await subir(SERVICIO, aleatoria() + ".pdf", copia, "application/pdf");
    return s === 200 && h.length === 64;
  }));
  clearInterval(muestreo);
  registrar(`CONCURRENCIA · ${n} subidas simultáneas de ${(tamano / 1e6).toFixed(0)} MB (leer+hashear+guardar) todas correctas`, "true", estados.every(Boolean));
  registrar(`MEMORIA · pico adicional de RSS del proceso con ${n}×${(tamano / 1e6).toFixed(0)} MB simultáneos (MB, medido; no es un límite de Vercel)`, "informativo", Math.round((pico - base) / 1e6));
  registrar("TIEMPO · duración de esas subidas (ms, medido en local)", "informativo", Date.now() - t0);
}

// ── Salida: UNA tabla + veredicto ─────────────────────────────────────────
const ancho = Math.max(...filas.map((f) => f.control.length));
for (const f of filas) console.log(`${f.estado.padEnd(5)} ${f.control.padEnd(ancho)}  esperado=${f.esperado}  observado=${f.observado}`);
const fallas = filas.filter((f) => f.estado === "FALLA").length;
console.log(`\nRESUMEN: ${filas.filter((f) => f.estado === "OK").length} OK, ${fallas} FALLA, ${filas.filter((f) => f.estado === "INFO").length} informativos`);
console.log("LÍMITES: evidencia de storage-api LOCAL. No demuestra el límite global ni el comportamiento del proyecto remoto; la subida por función queda acotada por el cuerpo de solicitud de Vercel (4,5 MB, documentación oficial).");
process.exit(fallas === 0 ? 0 : 1);
