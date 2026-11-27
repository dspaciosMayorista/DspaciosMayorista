// Review aid (#103): plays the SUPPLIER's reply to the latest request of a contract, through the SIMULATED Mail API and the app's real Hostinger webhook route.
//   (same settings as review.mjs: the review folder comes from HJ_REVIEW_DIR / HJ_WORK, default %USERPROFILE%\hostinger-review-103)
//   node review_reply.mjs DTM-2001 ["reply text"]        (needs the review session running: simulated Mail API + app)
// It drops one message addressed to respuestas+<token>@walk.test into the simulated mailbox and calls the webhook with the configured Bearer secret — exactly what Hostinger's notification would trigger. Nothing leaves this machine.
import { ajustesRevision, cargarConfig, requerir, sqlDesechable } from "./lib.mjs";

const [contrato, ...resto] = process.argv.slice(2);
requerir(contrato && /^[A-Za-z0-9-]{3,20}$/.test(contrato), "Usage: node review_reply.mjs <contract number, e.g. DTM-2001> [reply text]");
const a = ajustesRevision(), cfg = cargarConfig(a), sql = sqlDesechable(a), p = cfg.puertos;
const texto = resto.join(" ") || "Confirmamos disponibilidad. (respuesta sintética de revisión)";
const token = sql(`select token_respuesta from public.solicitudes_proveedor where numero_contrato = '${contrato}' and tipo = 'solicitud' order by id desc limit 1`);
requerir(token, `No supplier request found for ${contrato}: send one from the contract page first.`);
console.log(`review folder: ${a.work}`);
const SIM = `http://127.0.0.1:${p.sim}`;
const { mensajes } = await (await fetch(`${SIM}/__ctl/log`, { method: "POST", body: "{}" })).json();
const uid = 1001 + mensajes;
const mensaje = { uid, date: new Date().toISOString(), subject: "Re: Solicitud de reserva", from: { name: "Reservas del proveedor (sintético)", address: "reservas@proveedor.test" }, to: [{ address: `respuestas+${token}@walk.test` }], cc: [], bcc: [], messageId: `<review-${uid}-${Date.now()}@proveedor.test>`, inReplyTo: null, attachments: [], flags: [], unseen: true, size: 900, path: "INBOX" };
await fetch(`${SIM}/__ctl/agregar`, { method: "POST", body: JSON.stringify({ mensajes: [mensaje], textos: { [uid]: texto } }) });
const r = await fetch(`http://127.0.0.1:${a.appPort ?? p.app}/api/solicitud-proveedor/hostinger`, { method: "POST", headers: { authorization: `Bearer ${cfg.journey.webhookSecret}`, "content-type": "application/json" }, body: "{}" });
const j = await r.json().catch(() => ({}));
console.log(`webhook → HTTP ${r.status} (200 = pass finished, 202 = more work left); new replies recorded: ${j.nuevos ?? "?"}; complete: ${j.completo ?? "?"}`);
console.log(`simulated reply uid ${uid} to the latest request of ${contrato}: «${texto}»`);
process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
