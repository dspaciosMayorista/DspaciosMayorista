// Revisión consolidada · #103 — juega la RESPUESTA SIMULADA de un proveedor a la última solicitud de un contrato (nada sale de este equipo).
//   node supabase/scripts/revision_consolidada/responder_proveedor.mjs DTM-2001 "Confirmamos disponibilidad con el código."
//   node supabase/scripts/revision_consolidada/responder_proveedor.mjs --crear-soporte      (crea un PDF sintético para el paso del aviso de pago)
// Hace lo mismo que la notificación de Hostinger: deja UN mensaje dirigido a respuestas+<token>@consolidada.test en la API de correo SIMULADA y llama a la ruta de entrada real de la app
// (POST /api/solicitud-proveedor/hostinger con el secreto configurado). El correo real de Hostinger NO interviene. Base: rev_consolidada (REV_ENSAYO=1 usa la copia de ensayo).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CFG_DIR = path.join(process.env.LOCALAPPDATA ?? "", "dspacios-local-revision-consolidada");
export const DOMINIO_RESPUESTAS = "consolidada.test";
export const cargarConfig = () => JSON.parse(fs.readFileSync(path.join(CFG_DIR, "config.json"), "utf8"));
export const RUTA_SOPORTE = path.join(CFG_DIR, "soporte-sintetico-103.pdf");

/** SQL de solo lectura contra la base de revisión (o la copia de ensayo con REV_ENSAYO=1). */
export function sqlCli(q) {
  const db = process.env.REV_ENSAYO === "1" ? "rev_consolidada_ensayo" : "rev_consolidada";
  const r = spawnSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pgrevc", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`SQL: ${(r.stderr || r.stdout).slice(0, 300)}`);
  return r.stdout.trim();
}

/** Deja la respuesta en el buzón simulado y avisa a la app. `sql` permite reutilizar la conexión del ensayo. Devuelve { status, nuevos, completo, uid }. */
export async function responder(contrato, texto, sql = sqlCli) {
  if (!/^[A-Za-z0-9-]{3,20}$/.test(contrato ?? "")) throw new Error("Uso: responder_proveedor.mjs <contrato, p. ej. DTM-2001> [texto de la respuesta]");
  const cfg = cargarConfig(), p = cfg.puertos, SIM = `http://127.0.0.1:${p.sim}`;
  const token = sql(`select token_respuesta from public.solicitudes_proveedor where numero_contrato = '${contrato}' and tipo = 'solicitud' order by id desc limit 1`);
  if (!token) throw new Error(`No hay una solicitud a proveedor para ${contrato}: envía una primero desde la ficha del contrato.`);
  const { mensajes } = await (await fetch(`${SIM}/__ctl/log`, { method: "POST", body: "{}" })).json();
  const uid = 1001 + mensajes;
  const mensaje = { uid, date: new Date().toISOString(), subject: "Re: Solicitud de reserva", from: { name: "Reservas del proveedor (sintético)", address: "reservas@proveedor.test" }, to: [{ address: `respuestas+${token}@${DOMINIO_RESPUESTAS}` }], cc: [], bcc: [], messageId: `<revision-${uid}-${Date.now()}@proveedor.test>`, inReplyTo: null, attachments: [], flags: [], unseen: true, size: 900, path: "INBOX" };
  await fetch(`${SIM}/__ctl/agregar`, { method: "POST", body: JSON.stringify({ mensajes: [mensaje], textos: { [uid]: texto } }) });
  const r = await fetch(`http://127.0.0.1:${p.app}/api/solicitud-proveedor/hostinger`, { method: "POST", headers: { authorization: `Bearer ${cfg.journey.webhookSecret}`, "content-type": "application/json" }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, nuevos: j.nuevos, completo: j.completo, uid };
}

/** PDF mínimo y válido (sintético, ~600 bytes) para subir como soporte de pago. */
export function pdfSintetico() {
  const flujo = "BT /F1 12 Tf 20 100 Td (Soporte sintetico de revision - no es un pago real) Tj ET";
  const cuerpos = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let s = "%PDF-1.4\n"; const off = [];
  cuerpos.forEach((c, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${c}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${cuerpos.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${cuerpos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [a, ...resto] = process.argv.slice(2);
  try {
    if (a === "--crear-soporte") { fs.mkdirSync(CFG_DIR, { recursive: true }); fs.writeFileSync(RUTA_SOPORTE, pdfSintetico()); console.log(`Soporte sintético creado: ${RUTA_SOPORTE}`); }
    else {
      const texto = resto.join(" ") || "Confirmamos disponibilidad. (respuesta sintética de revisión)";
      const r = await responder(a, texto);
      console.log(`webhook → HTTP ${r.status} (200 = pasada terminada, 202 = queda trabajo); respuestas nuevas registradas: ${r.nuevos ?? "?"}; completo: ${r.completo ?? "?"}\nrespuesta simulada (uid ${r.uid}) a la última solicitud de ${a}: «${texto}»`);
      process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
