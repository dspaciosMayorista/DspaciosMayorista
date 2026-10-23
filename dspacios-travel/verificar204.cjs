// Verificacion de coherencia de la migracion 204.
// Lee los 6 archivos de la propuesta y ejecuta las reglas del diseno.
// No toca la base ni el repo. Uso (desde la raiz): node verificar204.cjs
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const RAIZ = process.cwd();
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v204-'));

const ARCHIVOS = {
  migracion: 'supabase/migrations/20260601000204_staging_dian_contable.sql',
  preflight: 'supabase/scripts/preflight_204_staging_dian_lectura.sql',
  postcheck: 'supabase/scripts/postcheck_204_staging_dian_lectura.sql',
  dedupe: 'supabase/scripts/test_204_staging_dian_dedupe.sql',
  rls: 'supabase/scripts/test_204_staging_dian_rls.sql',
  rollback: 'supabase/scripts/rollback_204_staging_dian.sql',
};

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK    ' : '  FALLA ') + msg); if (!cond) fallos++; };
const titulo = (t) => console.log('\n=== ' + t + ' ===');

const txt = {};
titulo('0. Los 6 archivos existen');
for (const [k, p] of Object.entries(ARCHIVOS)) {
  ok(fs.existsSync(p), `${k}: ${p}`);
  if (fs.existsSync(p)) txt[k] = leer(p);
}
const m = txt.migracion || '';

// Extrae el CUERPO de una funcion: desde su firma hasta el $$; que la cierra.
// Una ventana de N caracteres no sirve: alcanza el cuerpo de la siguiente.
function cuerpo(nombre) {
  const re = new RegExp(
    `create or replace function (?:public\\.)?${nombre}\\b[\\s\\S]*?\\$\\$;`,
  );
  const s = m.match(re);
  return s ? s[0] : null;
}
const cuerpoDe = (n) => {
  const re = new RegExp(`create or replace function (?:public\\.)?${n}\\b[\\s\\S]*?\\$\\$;`);
  return re.test(m);
};

titulo('1. Las 8 tablas');
const TABLAS = ['lote_importacion_dian', 'documento_dian_identidad', 'documento_dian_staging',
  'documento_dian_linea_staging', 'documento_dian_impuesto_staging',
  'documento_dian_retencion_staging', 'documento_dian_forma_pago_staging',
  'documento_dian_resolucion'];
for (const t of TABLAS) ok(new RegExp(`create table if not exists public\\.${t}\\b`).test(m), `crea ${t}`);
ok((m.match(/create table if not exists public\./g) || []).length === 8, 'exactamente 8 tablas');

titulo('2. El reparto de actos (D1, §5.1)');
const prep = cuerpo('dian_staging_puede_preparar');
const apro = cuerpo('dian_staging_puede_aprobar');
const devu = cuerpo('dian_staging_puede_devolver');
const cerr = cuerpo('dian_staging_puede_cerrar');
const admi = cuerpo('dian_staging_puede_administrar');
const ver  = cuerpo('dian_staging_puede_ver');
const imp  = cuerpo('dian_staging_puede_importar');

ok(!!prep && prep.includes("'contador'"), 'preparar incluye contador');
ok(!!prep && !prep.includes("'revisor_fiscal'"), 'preparar NO incluye revisor_fiscal');
ok(!!prep && !prep.includes("'admin_contable'"), 'preparar NO incluye admin_contable');
ok(!!apro && apro.includes("'revisor_fiscal'"), 'aprobar incluye revisor_fiscal');
ok(!!apro && !/mi_rol\(\)::text = 'contador'/.test(apro), 'aprobar NO incluye contador (D3a pendiente)');
ok(!!devu && devu.includes("'revisor_fiscal'"), 'devolver incluye revisor_fiscal');
ok(!!cerr && cerr.includes("'admin_contable'"), 'cerrar incluye admin_contable');
ok(!!admi && admi.includes("'admin_contable'") && admi.includes("'gerencia'")
     && admi.includes("'administracion'") && !admi.includes("'revisor_fiscal'"),
     'administrar: admin_contable + roles administrativos, NO revisor_fiscal');
for (const [n, c] of [['preparar', prep], ['aprobar', apro], ['devolver', devu], ['cerrar', cerr]]) {
  ok(!!c && c.includes("'superadmin'"), `${n} incluye superadmin`);
  ok(!!c && c.includes("'gerencia'") && c.includes("'administracion'"),
    `${n} conserva gerencia y administracion`);
}

titulo('3. Ver delega, con filtro de usuario conocido');
ok(!!ver && ver.includes('puede_ver_tenant(p_tenant)'), 'ver delega en puede_ver_tenant');
ok(!!ver && /mi_rol\(\) is not null/.test(ver), 'ver exige mi_rol is not null');
ok(!/mi_rol\(\) is not null[\s\S]{0,200}admin_contable/.test(ver), 'ver no da acceso cross-tenant a admin_contable');

titulo('4. Los 7 helpers devuelven booleano definitivo');
for (const h of ['ver', 'importar', 'preparar', 'aprobar', 'devolver', 'cerrar', 'administrar']) {
  ok(cuerpoDe('dian_staging_puede_' + h), `existe dian_staging_puede_${h}`);
}
const conCoalesce = (m.match(/select coalesce\(/g) || []).length;
ok(conCoalesce >= 7, `los helpers usan coalesce (${conCoalesce} ocurrencias, minimo 7)`);
for (const h of ['ver', 'importar', 'preparar', 'aprobar', 'devolver', 'cerrar', 'administrar']) {
  const c = cuerpo('dian_staging_puede_' + h);
  ok(!!c && /select coalesce\(/.test(c), `${h} devuelve coalesce(..., false)`);
}

titulo('5. No se toca el helper global ni el motor contable');
ok(!/create or replace function public\.puede_ver_tenant/.test(m), 'NO redefine puede_ver_tenant');
ok(!/references public\.(asientos_contables|asiento_lineas)/.test(m),
  'NO referencia asientos_contables ni asiento_lineas');
ok(!/insert into public\.proveedores/.test(m), 'NO inserta en proveedores (D4/D5)');
ok(!/\bcreate table[^;]*asiento_id/.test(m), 'NO crea asiento_id (§3.3 futuro)');
ok(!/xml_original\s+text/.test(m), 'NO crea xml_original (D10)');
ok(!/postearAsiento|reemplazarAsiento|reversarYRegistrar/.test(m), 'NO llama al motor de asientos');

titulo('6. Dedupe e idempotencia (§4.6)');
ok(/create unique index if not exists uq_dian_staging_dedupe[\s\S]{0,120}where estado <> 'duplicado'/.test(m),
  'indice parcial de dedupe (tenant, clave, total_declarado)');
ok(!/constraint uq_dian_staging_dedupe/.test(m), 'el dedupe NO es constraint in-table');
ok(/unique \(tenant, clave\)/.test(m), 'indice unico de identidad (tenant, clave)');
ok(!/unique \(documento_dian_identidad_id\)[\s\S]{0,80}where estado <> 'duplicado'/.test(m),
  'NO existe el indice por identidad que impediria el discrepante');
ok(/unique \(tenant, fuente, periodo_desde, hash_contenido\)/.test(m), 'indice de reimportacion de lote (D6)');

titulo('7. Congelamiento de columnas (§6.3.2)');
ok(cuerpoDe('dian_staging_columnas_congeladas'), 'existe dian_staging_columnas_congeladas');
ok(cuerpoDe('_dian_staging_update_gate'), 'existe el gate de UPDATE');
ok(/create trigger dian_staging_update_gate[\s\S]{0,120}before update on public\.documento_dian_staging/i.test(m),
  'el trigger es BEFORE UPDATE en documento_dian_staging');
const congeladas = cuerpo('dian_staging_columnas_congeladas') || '';
for (const col of ['tenant', 'lote_id', 'documento_dian_identidad_id', 'clave', 'clave_base',
  'cufe', 'cude', 'tipo_documento', 'tipo_documento_original', 'numero', 'fecha',
  'proveedor_nit', 'proveedor_nombre', 'moneda', 'subtotal', 'impuestos_total',
  'retenciones_total', 'total_declarado', 'total_calculado', 'diferencia',
  'xml_hash', 'fuera_de_corte', 'duplicado_de', 'creado_en']) {
  ok(congeladas.includes(`'${col}'`), `congelada: ${col}`);
}
for (const col of ['estado', 'proveedor_id', 'cuenta_puc', 'motivo_pendiente',
  'preparado_por', 'aprobado_rol', 'devuelto_en', 'cerrado_por']) {
  ok(!congeladas.includes(`'${col}'`), `NO congelada (editable): ${col}`);
}
ok(!congeladas.includes("'trm'"), 'trm NO esta congelada (se ajusta al autorizar)');
ok(!congeladas.includes("'actualizado_en'"), 'actualizado_en NO congelada (lo sella el gate)');
ok(/new\.actualizado_en := now\(\)/.test(m), 'el gate sella actualizado_en');
ok(/foreach v_col in array public\.dian_staging_columnas_congeladas\(\) loop[\s\S]{0,200}is distinct from/.test(m),
  'el gate compara con is distinct from (reescribir el mismo valor pasa)');

titulo('8. RLS, policies y helpers');
ok(/alter table public\.%I enable row level security/.test(m), 'habilita RLS explicitamente');
ok(/alter table public\.%I force row level security/.test(m), 'fuerza RLS al dueno');
const iRls = m.indexOf('enable row level security');
const iPol = m.indexOf('create policy "dian_lote: ver"');
ok(iRls > 0 && iPol > iRls, 'RLS se habilita ANTES de crear las policies');
ok((m.match(/create policy "/g) || []).length >= 15, `policies creadas (${(m.match(/create policy "/g) || []).length})`);
ok(/drop policy if exists "dian_staging: aprobar"/.test(m)
     && /drop policy if exists "dian_staging: modificar"/.test(m),
  'las policies por acto se dropean antes de crear (idempotencia)');
// Cuenta SOLO las policies de UPDATE de documento_dian_staging. El prefijo
// "dian_staging: " tambien lo llevan las de select e insert, asi que contar por
// prefijo daria un numero que no significa nada.
const updatesStaging = (m.match(/create policy "dian_staging: \w+" on public\.documento_dian_staging\s*\n\s*for update/g) || []).length;
ok(updatesStaging === 1, `una sola policy de UPDATE en documento_dian_staging (${updatesStaging}); las permisivas se ORean`);
ok(/revoke delete, truncate on public\.documento_dian_resolucion from authenticated/.test(m),
  'sin DELETE/TRUNCATE para la API');
ok(/grant usage, select on sequence/.test(m), 'usage/select sobre las secuencias de los bigserial');
ok(/documento_dian_identidad_id_seq,/.test(m), 'la secuencia de identidad se lista en el revoke');
ok((m.match(/security definer set search_path = public/g) || []).length >= 7,
  'helpers con security definer + search_path fijo');
ok(/append-only/i.test(m), 'documenta el append-only de la bitacora');

titulo('9. RPC: atomicidad (opcion A, §4.10)');
ok(/p_lineas\s+jsonb default/.test(m) && /p_formas_pago\s+jsonb default/.test(m),
  'la RPC recibe los cuatro arrays de hijos');
ok(cuerpoDe('_dian_staging_insertar_hijos'), 'existe _dian_staging_insertar_hijos');
ok(cuerpoDe('_dian_staging_validar_hijos'), 'existe _dian_staging_validar_hijos');
ok(/perform public\._dian_staging_insertar_hijos\([\s\S]{0,120}v_documento\.id, p_lineas/.test(m),
  'la RPC inserta los hijos en la misma transaccion');
ok(/if v_estado = 'discrepante' then[\s\S]{0,160}_dian_staging_insertar_hijos/.test(m),
  'el discrepante guarda hijos y el duplicado no (§4.7)');
ok(/p_trm\s+numeric/.test(m) && /p_moneda\s+text/.test(m), 'la RPC recibe moneda y trm');
ok(!/p_proveedor_nombre,?\s*\n\s*p_subtotal/.test(m), 'la RPC no hardcodea COP');
ok(/revoke all on function public\.dian_registrar_documento\s*\n\s*from public, anon, service_role/.test(m),
  'revoke de la RPC sin firma escrita (21 parametros)');
ok(/v_tenant\s+text := public\.mi_tenant\(\)/.test(m), 'el tenant se deriva del servidor');
ok(/exception when unique_violation then/.test(m), 'la RPC maneja la violacion de unicidad');

titulo('10. Estados y actos');
for (const e of ['importado', 'pendiente_revision', 'preparado', 'devuelto', 'coincidente',
  'aprobado', 'cerrado', 'duplicado', 'discrepante', 'rechazado', 'contabilizado']) {
  ok(new RegExp(`'${e}'`).test(m), `estado: ${e}`);
}
for (const c of ['preparado_por', 'preparado_rol', 'preparado_en', 'aprobado_por', 'aprobado_rol',
  'aprobado_en', 'devuelto_por', 'devuelto_rol', 'devuelto_en', 'cerrado_por', 'cerrado_rol',
  'cerrado_en']) {
  ok(new RegExp(c).test(m), `acto: ${c}`);
}
for (const c of ['tipo_documento_original', 'proveedor_cruce_estado', 'periodo_desde', 'periodo_hasta',
  'motivo', 'hash_contenido', 'xml_hash', 'motivo_pendiente', 'fuera_de_corte', 'trg_auditoria']) {
  ok(new RegExp(c).test(m), `campo: ${c}`);
}

titulo('11. Coherencia entre los 6 archivos');
ok(/trg_auditoria/.test(txt.postcheck), 'postcheck verifica trg_auditoria');
ok(/polcmd/.test(txt.postcheck), 'postcheck verifica que no hay policy de DELETE');
ok(/dian_staging_columnas_congeladas/.test(txt.postcheck), 'postcheck verifica las columnas congeladas');
ok(/dian_staging_update_gate/.test(txt.postcheck), 'postcheck verifica el gate de UPDATE');
ok(/rol_usuario/.test(txt.postcheck), 'postcheck verifica los roles del enum');
ok(/has_function_privilege/.test(txt.postcheck), 'postcheck verifica que anon no ejecuta la RPC');
for (const t of ['duplicado', 'discrepante', 'aislamiento', 'append-only', 'reimportaci']) {
  ok(txt.dedupe.toLowerCase().includes(t), `test dedupe cubre: ${t}`);
}
for (const t of ['D20', 'D21', 'D22', 'D23']) ok(txt.dedupe.includes(t), `test dedupe tiene ${t}`);
ok(/no quedo ninguna cabecera huerfana/.test(txt.dedupe), 'D21 comprueba que no queda cabecera huerfana');
for (const t of ['R13', 'R14', 'R15', 'R15b', 'R16']) ok(txt.rls.includes(t), `test rls tiene ${t}`);
ok(/no puede dejar un documento en preparado/.test(txt.rls), 'R15b comprueba que el revisor no prepara');
for (const f of ['ON_ERROR_STOP', 'rollback']) {
  ok(txt.dedupe.includes(f), `dedupe usa ${f}`);
  ok(txt.rls.includes(f), `rls usa ${f}`);
}
for (const t of TABLAS) ok(txt.rollback.includes(t), `rollback elimina ${t}`);
for (const f of ['_dian_staging_update_gate', '_dian_staging_insertar_hijos',
  '_dian_staging_validar_hijos', 'dian_staging_columnas_congeladas']) {
  ok(txt.rollback.includes(f), `rollback elimina ${f}`);
}
ok(/drop trigger if exists dian_staging_update_gate/.test(txt.rollback), 'rollback quita el gate');
ok(/pg_policies/.test(txt.rollback), 'rollback quita las policies antes que las funciones');
ok(!/xml_hash|total_declarado/.test(txt.preflight.split('--- 7.')[1] || ''),
  'preflight no lee datos de staging (no existe todavia)');

titulo('12. Codificacion y marcadores');
for (const [k, s] of Object.entries(txt)) {
  ok(!/[\uFFFD\u4e00-\u9fff]/.test(s), `${k}: sin caracteres corruptos`);
}
ok(!/\bmarcador\b|\bTODO\b|\bFIXME\b|\bXXX\b/.test(m), 'migracion: sin marcadores olvidados');
for (const [k, s] of Object.entries(txt)) {
  const bloques = s.match(/\$\$[\s\S]*?\$\$/g) || [];
  const malas = bloques.filter((b) => /(?<!:):[a-z_]\w*/.test(b.replace(/::/g, '@@')));
  ok(malas.length === 0, `${k}: sin variables psql dentro de $$ (${malas.length})`);
}

console.log(`\n=== TOTAL: ${fallos === 0 ? 'TODO OK' : fallos + ' FALLOS'} ===`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fallos === 0 ? 0 : 1);