// Verificacion del diff de roles contables: aplica el parche propuesto a
// lib/constants.ts y lib/roles.ts EN MEMORIA, compila con esbuild y ejecuta las
// reglas reales (moduloDeRuta + LECTURA_MODULO + modulosConsultables +
// ESCRITURA). No escribe nada en el repo.
//
// Uso (desde la raiz del proyecto): node verificar-roles-204.cjs
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');
const esbuild = require('esbuild');

const RAIZ = process.cwd();
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

// ── El parche propuesto ─────────────────────────────────────────────────────
function parchearConstants(src) {
  let s = src;
  const pasos = [];

  const a = s;
  s = s.replace(
    /("cliente_final",\n)(\s*\] as const;)/,
    '$1  // Rol contable (D1). A proposito NO van en ROLES_INTERNOS.\n  "contador",\n  "revisor_fiscal",\n  "admin_contable",\n$2',
  );
  pasos.push(['ROLES', s !== a]);

  const b = s;
  s = s.replace(
    'export const ROLES_EXTERNOS: Rol[] = ["agencia", "freelance", "cliente_final"];',
    'export const ROLES_EXTERNOS: Rol[] = ["agencia", "freelance", "cliente_final"];\n\n' +
      '// Roles del area contable (D1).\n' +
      'export const ROLES_CONTABLES: Rol[] = [\n  "contador",\n  "revisor_fiscal",\n  "admin_contable",\n];',
  );
  pasos.push(['ROLES_CONTABLES', s !== b]);

  const c = s;
  s = s.replace(
    'export const LECTURA_MODULO: Record<string, readonly Rol[]> = {',
    'export const LECTURA_MODULO: Record<string, readonly Rol[]> = {\n' +
      '  contabilidad_dian: ["superadmin", "gerencia", "administracion", ...ROLES_CONTABLES] as Rol[],\n',
  );
  pasos.push(['LECTURA_MODULO.contabilidad_dian', s !== c]);

  const d = s;
  s = s.replace(
    'export const MODULO_POR_RUTA: { prefijo: string; modulo: string }[] = [',
    'export const MODULO_POR_RUTA: { prefijo: string; modulo: string }[] = [\n' +
      '  { prefijo: "/dashboard/contabilidad/staging-dian", modulo: "contabilidad_dian" },',
  );
  pasos.push(['MODULO_POR_RUTA', s !== d]);

  return { src: s, pasos };
}

function parchearRoles(src) {
  let s = src;
  const pasos = [];

  const a = s;
  s = s.replace(
    'import { LECTURA_MODULO, type Rol } from "@/lib/constants";',
    'import { LECTURA_MODULO, ROLES_CONTABLES, type Rol } from "@/lib/constants";',
  );
  pasos.push(['import ROLES_CONTABLES', s !== a]);

  const b = s;
  s = s.replace(
    '  usuarios: ["superadmin", "administracion"] as Rol[],\n} satisfies Record<string, Rol[]>;',
    '  usuarios: ["superadmin", "administracion"] as Rol[],\n' +
      '  dian_staging: ["superadmin", "gerencia", ...ROLES_CONTABLES] as Rol[],\n} satisfies Record<string, Rol[]>;',
  );
  pasos.push(['ESCRITURA.dian_staging', s !== b]);

  return { src: s, pasos };
}

// ── Compilar y cargar ───────────────────────────────────────────────────────
const pc = parchearConstants(leer('lib/constants.ts'));
const pr = parchearRoles(leer('lib/roles.ts'));

console.log('=== 0. El parche aplica completo (si no, el resto no prueba nada) ===');
let fallos = 0;
function ok(cond, msg) {
  console.log((cond ? '  OK    ' : '  FALLA ') + msg);
  if (!cond) fallos++;
}
for (const [nombre, aplico] of [...pc.pasos, ...pr.pasos]) {
  ok(aplico, `parche aplicado: ${nombre}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roles204-'));
fs.writeFileSync(path.join(tmp, 'constants.ts'), pc.src);
fs.writeFileSync(path.join(tmp, 'roles.ts'), pr.src);
fs.writeFileSync(path.join(tmp, 'stub.js'), 'exports.createClient = async () => ({});');

const comunes = { bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent', write: false };
fs.writeFileSync(
  path.join(tmp, 'c.js'),
  esbuild.buildSync({ ...comunes, entryPoints: [path.join(tmp, 'constants.ts')] }).outputFiles[0].text,
);
fs.writeFileSync(
  path.join(tmp, 'r.js'),
  esbuild.buildSync({
    ...comunes,
    entryPoints: [path.join(tmp, 'roles.ts')],
    external: ['@/lib/constants', '@/lib/supabase/server', 'next/headers'],
  }).outputFiles[0].text,
);

const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === '@/lib/constants') return path.join(tmp, 'c.js');
  if (req === '@/lib/supabase/server') return path.join(tmp, 'stub.js');
  return resolverOriginal.call(this, req, ...rest);
};
const C = require(path.join(tmp, 'c.js'));
const R = require(path.join(tmp, 'r.js'));
Module._resolveFilename = resolverOriginal;

const CONTABLES = ['contador', 'revisor_fiscal', 'admin_contable'];
const entra = (ruta, rol) => {
  const mod = C.moduloDeRuta(ruta);
  const dentro = C.LECTURA_MODULO[mod];
  return dentro ? dentro.includes(rol) : false;
};

console.log('\n=== 1. Los 3 roles son tipo Rol y NO entran a ROLES_INTERNOS/EXTERNOS ===');
for (const r of CONTABLES) {
  ok(C.ROLES.includes(r), `ROLES incluye ${r}`);
  ok(!C.ROLES_INTERNOS.includes(r), `ROLES_INTERNOS NO incluye ${r} (ese grupo abre ventas/vuelos/producto/finanzas)`);
  ok(!C.ROLES_EXTERNOS.includes(r), `ROLES_EXTERNOS NO incluye ${r}`);
  const mods = [...R.modulosConsultables(r)];
  ok(mods.length === 1 && mods[0] === 'contabilidad_dian', `${r} -> modulos [${mods.join(', ')}]`);
}

console.log('\n=== 2. Rutas prohibidas (todas deben dar false) ===');
const PROHIBIDAS = [
  '/dashboard/ventas', '/dashboard/ventas/nueva',
  '/dashboard/vuelos', '/dashboard/vuelos/123/silla',
  '/dashboard/cartera', '/dashboard/pagos', '/dashboard/comisiones',
  '/dashboard/rentabilidad', '/dashboard/liquidacion', '/dashboard/aliados',
  '/dashboard/producto', '/dashboard/producto/hoteles/12/tarifas',
  '/dashboard/usuarios', '/dashboard/usuarios/b2b',
  '/dashboard/configuracion',
  '/dashboard/crm',
  '/dashboard/cotizaciones', '/dashboard/reservar', '/dashboard/contratos',
  '/dashboard/tarifario', '/dashboard/paquetes',
];
for (const ruta of PROHIBIDAS) {
  const mod = C.moduloDeRuta(ruta);
  for (const rol of CONTABLES) {
    ok(!entra(ruta, rol), `${ruta} [${mod}] NO entra ${rol}`);
  }
}

console.log('\n=== 3. La unica ruta que si abren ===');
for (const ruta of [
  '/dashboard/contabilidad/staging-dian',
  '/dashboard/contabilidad/staging-dian/lote/12',
  '/dashboard/contabilidad/staging-dian/documento/44',
]) {
  ok(C.moduloDeRuta(ruta) === 'contabilidad_dian', `${ruta} resuelve a contabilidad_dian`);
  for (const rol of CONTABLES) {
    ok(entra(ruta, rol), `${ruta} entra ${rol}`);
  }
}

console.log('\n(');
console.log('=== 4. Las pantallas contables que YA existen no fueron capturadas ===');
console.log('Si el prefijo nuevo fuera mas corto que /dashboard/contabilidad, estas');
console.log('quedarian dentro de contabilidad_dian y abririan el modulo al contador.');
for (const ruta of [
  '/dashboard/contabilidad',
  '/dashboard/contabilidad/facturacion',
  '/dashboard/rentabilidad', '/dashboard/liquidacion', '/dashboard/aliados',
  '/dashboard/comisiones', '/dashboard/flujo-caja', '/dashboard/punto-equilibrio',
]) {
  const mod = C.moduloDeRuta(ruta);
  ok(mod === 'finanzas', `${ruta} sigue resolviendo a ${mod}, no a contabilidad_dian`);
  for (const rol of CONTABLES) {
    ok(!entra(ruta, rol), `${ruta} NO entra ${rol}`);
  }
}

console.log('\n=== 5. Los roles previos no pierden nada ===');
for (const rol of ['superadmin', 'gerencia', 'administracion', 'operaciones', 'control_vuelo']) {
  const mods = [...R.modulosConsultables(rol)];
  ok(mods.length > 0, `${rol} sigue con ${mods.length} modulos`);
}
ok(C.LECTURA_MODULO.finanzas.includes('gerencia'), 'gerencia conserva finanzas');
ok(C.LECTURA_MODULO.usuarios.includes('superadmin'), 'superadmin conserva usuarios');
for (const rol of CONTABLES) {
  ok(!C.LECTURA_MODULO.usuarios.includes(rol), `${rol} NO entra a usuarios`);
  ok(!C.LECTURA_MODULO.configuracion.includes(rol), `${rol} NO entra a configuracion`);
  ok(!C.LECTURA_MODULO.crm.includes(rol), `${rol} NO entra a crm`);
}

console.log('\n=== 6. ESCRITURA: dian_staging aditivo, nada mas se abre ===');
ok(Array.isArray(R.ESCRITURA.dian_staging), 'ESCRITURA.dian_staging existe');
for (const rol of CONTABLES) {
  ok(R.ESCRITURA.dian_staging.includes(rol), `dian_staging incluye ${rol}`);
}
for (const recurso of ['producto', 'vuelos', 'ventas', 'aliados', 'b2b', 'usuarios']) {
  for (const rol of CONTABLES) {
    ok(!R.ESCRITURA[recurso].includes(rol), `ESCRITURA.${recurso} NO incluye ${rol}`);
  }
}
for (const rol of CONTABLES) {
  ok(!R.ADMIN_ROLES.includes(rol), `ADMIN_ROLES NO incluye ${rol} (no hereda escritura global)`);
  ok(!R.puedeEscribir('producto', rol), `puedeEscribir('producto', ${rol}) = false`);
  ok(!R.puedeEscribir('ventas', rol), `puedeEscribir('ventas', ${rol}) = false`);
  ok(R.puedeEscribir('dian_staging', rol), `puedeEscribir('dian_staging', ${rol}) = true`);
}

console.log('\n=== 7. El enum de types/database.ts quedaria alineado tras el parche ===');
// El parche tambien toca types/database.ts, que NO se aplico. Se parchea aqui
// en memoria para comprobar que el paquete completo es coherente entre si.
const tipos = leer('types/database.ts');
const bloqueOriginal = (tipos.match(/rol_usuario:[\s\S]{0,500}?;/) || [''])[0];
const bloqueParcheado = bloqueOriginal.replace(
  /(\s*\| "cliente_final")(;)/,
  '$1\n        | "contador"\n        | "revisor_fiscal"\n        | "admin_contable"$2',
);
ok(bloqueParcheado !== bloqueOriginal, 'el parche de types/database.ts aplica');
for (const r of CONTABLES) {
  ok(bloqueParcheado.includes(`"${r}"`), `types/database.ts declararia ${r} en rol_usuario`);
}
ok(!/rol_usuario:[\s\S]{0,500}?"contador"[\s\S]{0,500}?"contador"/.test(bloqueParcheado),
  'no se duplica ningun valor del enum');

// El enum y ROLES deben tener exactamente los mismos 12 valores.
const delEnum = [...bloqueParcheado.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
ok(delEnum.length === C.ROLES.length && delEnum.every((v, i) => v === C.ROLES[i]),
  `enum y ROLES tienen los mismos ${C.ROLES.length} valores, en el mismo orden`);

console.log(`\n=== TOTAL: ${fallos === 0 ? 'TODO OK' : fallos + ' FALLOS'} ===`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fallos === 0 ? 0 : 1);