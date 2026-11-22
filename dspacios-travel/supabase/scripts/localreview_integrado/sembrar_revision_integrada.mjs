// Ejemplos SINTÉTICOS que la guía de revisión consolidada necesita en la base de revisión. ADITIVO e IDEMPOTENTE: solo crea lo que falta (ids/correos propios 967xx / *@revision.test), nunca borra ni
// modifica filas existentes del dueño, y rehúsa correr fuera de una base `rev_verif_*`. La pila debe estar ARRIBA sobre esa base (revision_integrada.ps1 iniciar): los usuarios se crean por GoTrue.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview_integrado/sembrar_revision_integrada.mjs <base=rev_verif_int_revision> [contenedor=pgb2b]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import zlib from "node:zlib";

const BASE = process.argv[2] ?? "rev_verif_int_revision", CT = process.argv[3] ?? "pgb2b";
if (!/^rev_verif/.test(BASE)) throw new Error(`solo en copias rev_verif_*; base indicada: ${BASE}`);
const DIR = `${process.env.LOCALAPPDATA}/dspacios-local-revision-int`;
const CFG = JSON.parse(readFileSync(`${DIR}/config.json`, "utf8"));
const GW = `http://127.0.0.1:${CFG.puertos.gateway}`, SERVICE = CFG.serviceKey ?? CFG.serviceRoleKey, CLAVE = "Revision2026!";
const psql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", BASE, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const esc = (s) => String(s).replace(/'/g, "''");

async function usuario({ email, nombre, rol, aliadoId = null, activo = true, clave = CLAVE, appMeta = null }) {
  // GoTrue crea la cuenta y un disparador de la base inserta su fila en `usuarios` con rol por defecto (cliente_final, inactiva): la fila de ESTA cuenta sintética se fija siempre con el rol real.
  let id = psql(`select id from auth.users where email = '${esc(email)}'`);
  if (!id) {
    const r = await fetch(`${GW}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: JSON.stringify({ email, password: clave, email_confirm: true, ...(appMeta ? { app_metadata: appMeta } : {}) }) });
    const j = await r.json();
    if (!j.id) throw new Error(`no se creó ${email}: ${JSON.stringify(j)}`);
    id = j.id; console.log(`  + ${email} creada en Auth`);
  } else console.log(`  = ${email} ya existe en Auth`);
  psql(`insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values ('${id}', '${esc(email)}', '${esc(nombre)}', '${rol}', ${activo}, 'mayorista', ${aliadoId ?? "null"})
    on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id`);
  console.log(`    perfil: ${rol}${aliadoId ? ", ficha " + aliadoId : ""}${activo ? "" : ", inactivo (registro sin completar)"}`);
  return id;
}

// ── 1. Fichas de aliado (freelance con datos de pago completos) ───────────────────────────────────────────────────────────────────────────────
psql(`insert into public.aliados (id, nombre, tipo, nit, tipo_documento, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta, aplica_retencion, pct_retencion, pct_comision, activo) values
  (96701, 'Camila Ríos Demo', 'freelance', '1020304050', 'CC', 'Calle 45 # 12-30, Bogotá', '+573001234567', 'camila.rios@revision.test', 'Bancolombia', 'Ahorros', '00096701234', true, 0.10, 0.11, true),
  (96702, 'Beto Viajes Demo', 'freelance', '1030405060', 'CC', 'Carrera 7 # 80-10, Bogotá', '+573002345678', 'beto.viajes@revision.test', 'Davivienda', 'Ahorros', '00096702345', true, 0.10, 0.11, true)
  on conflict (id) do nothing`);
console.log("fichas 96701 (Camila Ríos Demo) y 96702 (Beto Viajes Demo): listas");

// ── 2. Usuarios (todos con la clave de la revisión) ──────────────────────────────────────────────────────────────────────────────────────────
const camila = await usuario({ email: "freelance@revision.test", nombre: "Camila Ríos Demo", rol: "freelance", aliadoId: 96701 });
const beto = await usuario({ email: "freelance2@revision.test", nombre: "Beto Viajes Demo", rol: "freelance", aliadoId: 96702 });
// Registros VERIFICADOS sin solicitud (se interrumpieron después del código): «Continúa tu registro». Clave del registro distinta, a propósito.
const CLAVE_REGISTRO = "ClaveContinuar-2026";
await usuario({ email: "continuar@revision.test", nombre: "Aliado Continuar Demo", rol: "agencia", activo: false, clave: CLAVE_REGISTRO, appMeta: { registro_b2b_codigo: true } });
await usuario({ email: "continuar2@revision.test", nombre: "Aliado Continuar Demo Dos", rol: "agencia", activo: false, clave: CLAVE_REGISTRO, appMeta: { registro_b2b_codigo: true } });

// ── 3. Contratos con comisión elegible (valores calculados a mano) ───────────────────────────────────────────────────────────────────────────
//  DTM-96701 · Camila · PVP 5.000.000 · base comisionable 4.000.000 × 11 % = 440.000 · retención 10 % = 44.000 · TOTAL A COBRAR 396.000 · salida 15/03/2027
//  DTM-96702 · Beto   · PVP 3.000.000 · base 2.500.000 × 11 % = 275.000 · retención 27.500 · total 247.500 · salida 20/03/2027 (aislamiento: Camila no lo ve)
//  DTM-96703 · «Rev Aliado Uno» (AGENCIA 9301) · PVP 4.000.000 · base 3.200.000 × 10 % = 320.000 · salida 10/04/2027 (ruta de factura electrónica: las agencias no firman cuenta de cobro)
const venta = (n, cliente, destino, salida, pvp, aliadoId, userId, tipo) => `insert into public.ventas (numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, aliado_id, b2b_usuario_id, tipo_asesor, tenant)
  select '${n}', '${cliente}', '${destino}', '${salida}', ${pvp}, 'COP', 'confirmado', ${aliadoId}, '${userId}', '${tipo}', 'mayorista' where not exists (select 1 from public.ventas where numero_contrato = '${n}');`;
const comision = (n, nombre, tipo, aliadoId, pvp, base, pct, valor, ret) => `insert into public.aliados_b2b (numero_contrato, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, comision_valor, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, tenant, descontada_en_precio)
  select '${n}', '${nombre}', '${aliadoId}', '${tipo}', ${aliadoId}, ${pvp}, ${base}, ${pct}, ${valor}, 0, 0, ${ret > 0}, ${ret}, 'pendiente', 'mayorista', false where not exists (select 1 from public.aliados_b2b where numero_contrato = '${n}');`;
const uAgencia = psql(`select id from public.usuarios where email = 'aliado@revision.test'`);
psql(venta("DTM-96701", "Ana Gómez", "SAN ANDRÉS", "2027-03-15", 5000000, 96701, camila, "freelance") + comision("DTM-96701", "Camila Ríos Demo", "freelance", 96701, 5000000, 4000000, 0.11, 440000, 0.10)
  + venta("DTM-96702", "Luis Mora", "CARTAGENA", "2027-03-20", 3000000, 96702, beto, "freelance") + comision("DTM-96702", "Beto Viajes Demo", "freelance", 96702, 3000000, 2500000, 0.11, 275000, 0.10)
  + venta("DTM-96703", "Marta Ruiz", "SANTA MARTA", "2027-04-10", 4000000, 9301, uAgencia, "agencia") + comision("DTM-96703", "Rev Aliado Uno", "agencia", 9301, 4000000, 3200000, 0.10, 320000, 0));
console.log("contratos DTM-96701 / DTM-96702 / DTM-96703 con su comisión: listos");

// ── 3b. Cotización DIRECTA de Camila (la generó ella desde el tarifario) para «Solicitar contrato» (#78): C-REV78 · 1.800.000 · Cartagena · salida 20/03/2027 · válida hasta 28/02/2027 ─────────
psql(`insert into public.cotizaciones (tenant, codigo, modo, estado, creado_por, precio_venta, moneda, destino, cliente, fecha_salida, fecha_regreso, vigencia_hasta, tipo, pax, payload, share_token)
  select 'mayorista', 'C-REV78', 'simple', 'abierta', 'freelance@revision.test', 1800000, 'COP', 'CARTAGENA', 'Ana Gómez', '2027-03-20', '2027-03-24', '2027-02-28', 'tarifario', 2, '{}', '8f7d2c1e-0b6a-4c3d-9e5f-000000096701'
  where not exists (select 1 from public.cotizaciones where codigo = 'C-REV78')`);
console.log("cotización directa C-REV78 de Camila (1.800.000, válida hasta 28/02/2027): lista");

// ── 4. Responsable de las solicitudes de contrato (#78): solo si NO hay ninguno configurado ─────────────────────────────────────────────────
psql(`update public.config_solicitudes set emails = 'administracion@revision.test' where id = 1 and coalesce(btrim(emails), '') = ''`);
console.log("config_solicitudes: responsable =", psql("select coalesce(emails, '(vacío)') from public.config_solicitudes where id = 1"));

// ── 5. Archivos de muestra (PNG sintéticos) para firma y logo ─────────────────────────────────────────────────────────────────────────────
const PNGB = (w, h, [r, g, b]) => {
  const fila = w * 3 + 1, raw = Buffer.alloc(fila * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * fila + 1 + x * 3, rayado = (x + y) % 36 < 7; raw[o] = rayado ? r : 255; raw[o + 1] = rayado ? g : 255; raw[o + 2] = rayado ? b : 255; }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
mkdirSync(`${DIR}/muestras`, { recursive: true });
writeFileSync(`${DIR}/muestras/firma-camila.png`, PNGB(240, 90, [30, 58, 138]));
writeFileSync(`${DIR}/muestras/logo-camila.png`, PNGB(320, 110, [124, 45, 18]));
console.log(`muestras: ${DIR}/muestras/firma-camila.png, logo-camila.png`);
console.log("OK: ejemplos sintéticos listos (aditivo; nada existente se modificó).");
