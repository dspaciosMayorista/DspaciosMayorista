// Fingerprint of the REVIEW PROGRESS (#103): lets a stop/start cycle prove that nothing was lost. Needs the environment running (it reads the database, the inbox and the stored files).
//   node review_huella.mjs            prints JSON; compare the output before stop and after start (identical = preserved).
// Covered: review tables (row hash), accounts, uploaded files (database rows AND the bytes in the storage volume), captured mail (Mailpit message ids), the simulated mailbox file, config/credentials/sample proof files, and the saved browser accounts.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ajustesRevision, cargarConfig, sqlDesechable } from "./lib.mjs";
import { cuentasGuardadas } from "./review_browser.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const a = ajustesRevision(), cfg = cargarConfig(a), sql = sqlDesechable(a);
const TABLAS = ["ventas", "contrato_hoteles", "contrato_pasajeros", "contrato_servicios", "solicitudes_proveedor", "solicitud_proveedor_eventos", "solicitud_proveedor_avisos", "cxp_pagos", "cuentas_por_pagar", "cxp_pago_soportes", "hotel_temporadas", "hotel_blackouts", "hotel_codigos_promocion", "conjuntos_fechas", "armado_paquetes", "tarifario_cambio_fuente", "usuarios", "hostinger_estado_buzon", "hostinger_respuestas_pendientes", "auditoria"];
const huella = { tablas: {}, ficheros: {} };
for (const t of TABLAS) {
  try { huella.tablas[t] = sql(`select count(*) || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.${t} x`); }
  catch { huella.tablas[t] = "n/a"; }
}
huella.tablas["auth.users"] = sql("select count(*) || ':' || coalesce(md5(string_agg(id::text || email, '|' order by id::text)), '-') from auth.users");
try { huella.tablas["storage.objects"] = sql("select count(*) || ':' || coalesce(md5(string_agg(bucket_id || '/' || name, '|' order by bucket_id, name)), '-') from storage.objects"); } catch { huella.tablas["storage.objects"] = "n/a"; }
try { const m = await (await fetch(`http://127.0.0.1:${cfg.puertos.correo}/api/v1/messages?limit=1000`)).json(); huella.correoCapturado = `${m.total ?? (m.messages ?? []).length}:${sha((m.messages ?? []).map((x) => x.ID).sort().join(","))}`; } catch { huella.correoCapturado = "n/a"; }
try { huella.bytesAlmacenados = sha(execFileSync("docker", ["exec", "hj103_stor", "sh", "-c", "find /var/lib/storage -type f | sort | xargs -r sha256sum | sed 's#  .*/#  #'"], { encoding: "utf8" })); } catch { huella.bytesAlmacenados = "n/a"; }
for (const f of ["config.json", "review_credentials.txt", "soporte-walk.pdf", "sim-state.json", "review-state.json", "pg.json"]) { const p = path.join(a.work, f); huella.ficheros[f] = fs.existsSync(p) ? sha(fs.readFileSync(p)) : "absent"; }
try { huella.cuentasNavegador = sha(JSON.stringify(cuentasGuardadas(a, cfg))); } catch { huella.cuentasNavegador = "n/a"; }
console.log(JSON.stringify(huella, null, 2));
