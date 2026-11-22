// ── B2B (ronda 7): utilidades y datos sintéticos propios de este recorrido ─────────────────────────────────────────────
import zlib from "node:zlib";
import { createHash } from "node:crypto";
const GRUPOS = process.env.GRUPOS ? process.env.GRUPOS.split(",") : null;
const G = (n) => !GRUPOS || GRUPOS.includes(n);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
// PNG válido sin dependencias (rayas diagonales: se distingue a simple vista en las capturas).
const PNGB = (w, h, [r, g, b]) => {
  const fila = w * 3 + 1, raw = Buffer.alloc(fila * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * fila + 1 + x * 3, rayado = (x + y) % 36 < 7; raw[o] = rayado ? r : 255; raw[o + 1] = rayado ? g : 255; raw[o + 2] = rayado ? b : 255; }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
const nuevoContexto2 = async () => browser.newContext({ viewport: { width: 1280, height: 800 } });
const AR = "ClaveB2B-2026";
async function crearU({ rol, nombre, aliadoId = null, tenant = "mayorista", clave = AR }) {
  const email = `${rol}.${TAG}.${++nAliado}@v1.test`;
  const r = await authFetch("/admin/users", { metodo: "POST", service: true, cuerpo: { email, password: clave, email_confirm: true } });
  const u = await r.json();
  if (!u.id) throw new Error(`no se creó el usuario: ${JSON.stringify(u)}`);
  sql(`insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values ('${u.id}', '${email}', '${nombre}', '${rol}', true, '${tenant}', ${aliadoId ?? "null"}) on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id`);
  return { id: u.id, email, clave, nombre };
}
// Llamada DIRECTA a una Server Action (sin la interfaz): id capturado de la interfaz real, argumentos como arreglo JSON.
async function repetirAccion(ctx, url, idAccion, args) {
  const r = await ctx.request.post(url, { headers: { "next-action": idAccion, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, data: JSON.stringify(args) });
  return { status: r.status(), texto: await r.text() };
}
const tokenDe = async (u) => (await grant(u.email, u.clave)).json.access_token;
const rest = (ruta, token, metodo = "GET") => fetch(`${GW}/rest/v1/${ruta}`, { method: metodo, headers: { apikey: CFG.anonKey, authorization: `Bearer ${token ?? CFG.anonKey}` } });
const contiene = (t, re) => re.test(t.replace(/\s+/g, " "));

// Aliados: A (freelance, mayorista, con ficha completa), B (freelance, mayorista), C (agencia, mayorista), X (freelance de OTRA agencia: minorista).
const IDA = 97100 + (Date.now() % 800), IDB = IDA + 1, IDC = IDA + 2, IDX = IDA + 3;
const NUM = `DTM-9${String(Date.now()).slice(-6)}`, NUM84 = `DTM-8${String(Date.now()).slice(-6)}`;
const ficha = (id, nombre, tipo, extra = "") => `insert into public.aliados (id, nombre, tipo, nit, tipo_documento, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta, aplica_retencion, pct_retencion, pct_comision, activo) values (${id}, '${nombre}', '${tipo}', '${id}', 'CC', 'Calle 1 # 2-3, Bogotá', '+573001112233', 'a${id}@qa.test', 'Bancolombia', 'Ahorros', '00012${id}', true, 0.10, 0.11, true) on conflict (id) do nothing;`;

const NOMA = `Laura Pérez QA ${TAG}`, NOMB = `Beto Viajes QA ${TAG}`; // nombres únicos por corrida: el formulario de cotización resuelve el aliado por el nombre que se escribe
