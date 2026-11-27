// INSPECCIÓN de la app COMPILADA para el cupo adicional de soportes de pago (339): portal del aliado (Cartera → Soportes de pago) y ficha interna del contrato,
// con sesiones reales (aliado, otro aliado, gerencia, superadmin), la subida REAL a través de la interfaz (archivo elegido en el <input>, Server Action compilada,
// Storage en memoria, RPC y triggers reales) y capturas a 1280 / 820 / 390 px (emulación de dispositivo móvil real).
// Lanzar con: sh supabase/scripts/lanzar_visual_compilada.sh pgsoporte339 plantilla339 docs/tecnico/evidence-soportes-339 supabase/scripts/visual_soportes339.mjs \
//               supabase/migrations/20260601000339_soportes_pago_cupo_adicional.sql supabase/scripts/semilla_visual_soportes339.sql
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { iniciar, dormir } from "./visual_compilada_lib.mjs";

const REST = process.env.VC_REST, SECRETO = process.env.VC_SECRETO, PS = process.env.VC_PS, SALIDA = process.env.VC_SALIDA, APP_DIR = process.env.VC_APP_DIR;
const U = (n) => `00000000-0000-4000-8000-0000003390${n}`;
const USUARIOS = {
  ALI: { id: U("a1"), email: "ali339@x.test", rol: "agencia (aliado de DTM-8301…8306)" }, OTRO: { id: U("a2"), email: "otro339@x.test", rol: "freelance (otro aliado)" },
  GER: { id: U("b1"), email: "ger339@x.test", rol: "gerencia mayorista" }, SUP: { id: U("b2"), email: "sup339@x.test", rol: "superadmin" },
};
const sql = (q) => execSync(PS, { input: q, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const ANCHOS = [1280, 820, 390];

// El build se hizo con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1 y anon «anon-local» (Next los fija en la compilación): como Node no permite ese puerto, un --require de arnés reescribe esa URL al proxy (puerto 54399, sin prefijo).
const h = await iniciar({ rest: REST, secreto: SECRETO, usuarios: USUARIOS, salida: SALIDA, appDir: APP_DIR, proxyPuerto: 54399, prefijo: "", anonLiteral: "anon-local", reescribirUrl: "http://127.0.0.1:1" });
console.log("app compilada respondiendo en", h.APP, "· BUILD_ID", h.buildId);
const ARCH = path.resolve(h.OUT, "archivos"); fs.mkdirSync(ARCH, { recursive: true });
const pdf = (n) => { const f = path.join(ARCH, `soporte-sintetico-${n}.pdf`); fs.writeFileSync(f, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(`soporte sintetico ${n} `.repeat(30))])); return f; };

const ali = await h.pestana("ALI"), otro = await h.pestana("OTRO"), ger = await h.pestana("GER"), sup = await h.pestana("SUP"), anon = await h.pestana(null);
const URL_SOP = `${h.APP}/portal/b2b/cartera?vista=soportes`;

/** Estado visible de la tarjeta de un contrato en el portal. */
const tarjeta = (pest, num) => pest.eval(`(() => {
  const a = [...document.querySelectorAll('article')].find((x) => x.querySelector('h3')?.textContent.trim() === ${JSON.stringify(num)});
  if (!a) return null;
  const subir = [...a.querySelectorAll('button')].find((b) => /Subir soporte|Procesando/.test(b.textContent));
  const r = a.getBoundingClientRect();
  return { texto: a.innerText.replace(/\\s+/g, ' ').trim(), subirDeshabilitado: subir ? subir.disabled : null, nSoportes: a.querySelectorAll('ul > li').length, ancho: Math.round(r.width) };
})()`);
const claves = (t) => (t ? t.texto : "");
const abrirPortal = async (pest, ancho = 1280) => { await pest.ir(URL_SOP, ancho, 3500); };

console.log("\n== 1. Portal del aliado (Cartera → Soportes de pago): estados de cupo en la página compilada ==");
// Solicitudes por carga de la pestaña (informativo): el contador del proxy distingue REST/RPC/Storage. La carga de datos no cambió con la 339 (solo se dejó de filtrar contratos sin pagos).
const instantanea = () => ({ ...h.peticiones });
const diferencia = (a, b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v - (a[k] ?? 0)]).filter(([, v]) => v));
{ const a = instantanea(); await abrirPortal(ali); const d = diferencia(a, instantanea()); const total = Object.values(d).reduce((s, v) => s + v, 0);
  const html = await ali.eval("document.documentElement.outerHTML.length");
  console.log("INFO  carga de Cartera→Soportes (6 contratos): " + total + " solicitudes al proxy " + JSON.stringify(d) + "; HTML renderizado " + html + " caracteres"); h.medidas.push({ nombre: "carga-cartera-soportes", solicitudes: total, porTipo: d, htmlCaracteres: html }); }
const esperados = [
  ["DTM-8301", /0 de 1 permitidos/, /0 pagos registrados \+ 1 adicional/, /Aún no hay pagos registrados: puedes adjuntar un soporte/, false],
  ["DTM-8302", /1 de 1 permitidos/, /0 pagos registrados \+ 1 adicional/, /Ya usaste todos los soportes permitidos/, true],
  ["DTM-8303", /1 de 2 permitidos/, /1 pago registrado \+ 1 adicional/, /este es el soporte adicional, para un pago aún sin registrar/, false],
  ["DTM-8304", /2 de 2 permitidos/, /1 pago registrado \+ 1 adicional/, /Ya usaste todos los soportes permitidos/, true],
  ["DTM-8305", /4 de 3 permitidos/, /2 pagos registrados \+ 1 adicional/, /Hay más soportes vigentes de los permitidos/, true],
  ["DTM-8306", /3 de 3 permitidos/, /2 pagos registrados \+ 1 adicional/, /Ya usaste todos los soportes permitidos/, true],
];
for (const [num, resumen, desglose, mensaje, deshabilitado] of esperados) {
  const t = await tarjeta(ali, num);
  ok(!!t, `${num}: la tarjeta existe (contrato sin pagos incluido)`);
  const x = claves(t);
  ok(resumen.test(x) && desglose.test(x), `${num}: «${(x.match(/Soportes vigentes:[^+]*\+ 1 adicional|Soportes vigentes:.{0,80}/) ?? [""])[0]}»`);
  ok(mensaje.test(x), `${num}: mensaje de disponibilidad (${mensaje})`);
  ok(t?.subirDeshabilitado === deshabilitado, `${num}: botón «Subir soporte» ${deshabilitado ? "deshabilitado" : "habilitado"} (observado: ${t?.subirDeshabilitado})`);
}
const todo = await ali.texto();
// Guarda: si la página no es la esperada, TODOS los controles de desborde de abajo serían vacíos. Se aborta en lugar de dar falsos OK.
if (fallos > 0 || !/Soportes de pago/.test(todo)) { console.log("\nABORTADO: la página compilada no muestra el contenido esperado (peticiones al proxy:", JSON.stringify(h.peticiones), "). Texto:", JSON.stringify(todo.slice(0, 300))); console.log("--- salida de la app ---", h.eventosApp.join("").slice(-1800)); h.limpiar(); process.exit(1); }
ok(!/DTM-8399|Cliente de otro aliado/.test(todo), "el aliado NO ve el contrato de otro aliado");
ok(/DTM-8301/.test(todo) && /DTM-8306/.test(todo), "los 6 contratos propios están listados");
for (const a of ANCHOS) {
  await abrirPortal(ali, a);
  const med = await ali.captura("portal-soportes-estados-iniciales", a, "main");
  ok(!med.desbordaHorizontal && med.elementosFueraDelViewport === 0, `portal soportes @${a}px (viewport real ${med.innerWidth}): sin desborde horizontal (scroll ${med.scrollWidth}/${med.innerWidth}; fuera de viewport: ${med.elementosFueraDelViewport}${med.ejemplosFuera?.length ? " " + med.ejemplosFuera.join(" | ") : ""}); texto recortado: ${med.textoRecortado?.length ? med.textoRecortado.join(" | ") : "ninguno"}`);
}

console.log("\n== 2. Subida REAL por la interfaz compilada (Server Action → Storage en memoria → RPC y triggers reales) ==");
const huella = (n) => sql(`select md5(to_jsonb(v)::text) || ':' || v.estado || ':' || (select count(*) from public.abonos a where a.numero_contrato = v.numero_contrato) || ':' || (select count(*) from public.asientos_contables) from public.ventas v where numero_contrato = '${n}'`);
const vigentes = (n) => Number(sql(`select count(*) from public.contrato_soportes_pago where numero_contrato = '${n}' and vigente and archivado_en is null`));
const avisos = (n, uid) => Number(sql(`select count(*) from public.avisos where numero_contrato = '${n}' and usuario_id = '${uid}' and tipo = 'soporte_pago_nuevo'`));
const elegir = (pest, num, archivo) => pest.elegirArchivo(`(() => { const a = [...document.querySelectorAll('article')].find((x) => x.querySelector('h3')?.textContent.trim() === ${JSON.stringify(num)}); const i = [...a.querySelectorAll('input[type=file]')]; return i[i.length - 1]; })()`, [archivo]);

for (const [num, antesV, esperadoTras, rotulo] of [["DTM-8301", 0, /1 de 1 permitidos/, "sin pagos: el primer soporte"], ["DTM-8303", 1, /2 de 2 permitidos/, "1 pago + 1 soporte: el soporte ADICIONAL"]]) {
  await abrirPortal(ali);
  const f0 = huella(num);
  ok(vigentes(num) === antesV, `${num} (${rotulo}): parte con ${antesV} soporte(s) vigente(s)`);
  const antesSolic = instantanea();
  ok(await elegir(ali, num, pdf(num)), `${num}: archivo elegido en el input real de la tarjeta`);
  await dormir(5000);
  { const d = diferencia(antesSolic, instantanea()); const total = Object.values(d).reduce((s, v) => s + v, 0); console.log(`INFO  ${num}: una subida completa (acción + refresco de la pestaña) = ${total} solicitudes al proxy ${JSON.stringify(d)}`); h.medidas.push({ nombre: `subida-${num}`, solicitudes: total, porTipo: d }); }
  const t = await tarjeta(ali, num);
  ok(esperadoTras.test(claves(t)) && /Soporte subido\./.test(claves(t)), `${num}: la tarjeta pasa a «${(claves(t).match(/Soportes vigentes:.{0,40}/) ?? [""])[0]}» con «Soporte subido.»`);
  ok(t?.subirDeshabilitado === true && /Ya usaste todos los soportes permitidos/.test(claves(t)), `${num}: el botón queda deshabilitado con el mensaje de máximo`);
  ok(vigentes(num) === antesV + 1, `${num}: la base tiene ${antesV + 1} soporte(s) vigente(s)`);
  ok(huella(num) === f0, `${num}: venta, estado, abonos y asientos IDÉNTICOS tras la subida (${f0.slice(0, 18)}…)`);
  ok(avisos(num, USUARIOS.GER.id) === 1 && avisos(num, USUARIOS.SUP.id) === 1, `${num}: los avisos internos siguen llegando a gerencia y superadmin`);
  // Forzar un segundo archivo en el input (el botón está deshabilitado, pero el input existe): la interfaz y la base deben rechazarlo.
  ok(await elegir(ali, num, pdf(num + "-extra")), `${num}: se fuerza un archivo más en el input oculto`);
  await dormir(4500);
  const t2 = await tarjeta(ali, num);
  ok(/máximo de soportes vigentes: uno por cada pago registrado y uno adicional/.test(claves(t2)), `${num}: rechazo visible con el mensaje de máximo (${(claves(t2).match(/Este contrato ya tiene el máximo[^.]*\./) ?? ["sin mensaje"])[0].slice(0, 60)}…)`);
  ok(vigentes(num) === antesV + 1, `${num}: la base sigue con ${antesV + 1} (no se superó el máximo)`);
  ok(huella(num) === f0, `${num}: sigue sin cambios financieros tras el rechazo`);
  for (const a of ANCHOS) { await abrirPortal(ali, a); const med = await ali.captura(`portal-soportes-tras-subida-${num}`, a, "main"); ok(!med.desbordaHorizontal && med.elementosFueraDelViewport === 0, `${num} tras subir @${a}px: sin desborde (fuera de viewport: ${med.elementosFueraDelViewport})`); }
}
ok(Number(sql("select count(*) from public.abonos where numero_contrato in ('DTM-8301','DTM-8303') ")) === 1, "ningún pago nació de las subidas (8301: 0 y 8303: 1, como al inicio)");
ok(sql("select estado from public.ventas where numero_contrato = 'DTM-8301'") === "pendiente", "DTM-8301 sigue PENDIENTE: subir evidencia no confirma el contrato");
ok(h.peticiones["POST storage"] >= 2, `Storage recibió las subidas reales (${h.peticiones["POST storage"] ?? 0} POST)`);

console.log("\n== 3. Acceso: otro aliado, sin sesión, personal interno ==");
await otro.ir(URL_SOP, 1280, 3000);
const tOtro = await otro.texto();
ok(/DTM-8399/.test(tOtro) && !/DTM-8301|DTM-8303|Agencia Alfa/.test(tOtro), "otro aliado: ve solo SU contrato (DTM-8399, sin pagos: cupo disponible) y ninguno de Alfa");
const pOtro = await tarjeta(otro, "DTM-8399");
ok(pOtro?.subirDeshabilitado === false && /0 de 1 permitidos/.test(claves(pOtro)), "otro aliado: su contrato sin pagos admite 1 soporte");
await anon.ir(URL_SOP, 1280, 2500);
{ const t = await anon.texto(); ok(/Iniciar sesión/.test(t) && !/DTM-83|Soportes vigentes|Subir soporte/.test(t), "sin sesión: el portal pide iniciar sesión y no muestra contratos ni soportes"); }
await ger.ir(URL_SOP, 1280, 2500);
ok(!/DTM-8301|Soportes vigentes/.test(await ger.texto()), "gerencia en el portal del aliado: no ve los soportes del aliado");

console.log("\n== 4. Ficha interna del contrato (gerencia y superadmin): panel de soportes ==");
const casos = [
  ["DTM-8304", /Vigentes 2 de 2 permitidos \(1 abono registrado \+ 1 adicional\)/, /Hay más soportes vigentes que abonos registrados: el aliado puede haber adjuntado la evidencia de un pago aún sin registrar/, false],
  ["DTM-8305", /Vigentes 4 de 3 permitidos \(2 abonos registrados \+ 1 adicional\)/, /Hay más soportes vigentes de los permitidos \(p\. ej\. tras anular un abono\)/, true],
  ["DTM-8302", /Vigentes 1 de 1 permitidos \(0 abonos registrados \+ 1 adicional\)/, /Hay más soportes vigentes que abonos registrados: el aliado puede haber adjuntado/, false],
];
for (const [num, resumen, nota, esExcedido] of casos) {
  for (const [pest, rol] of [[sup, "superadmin"], [ger, "gerencia"]]) {
    await pest.ir(`${h.APP}/dashboard/contratos/${num}`, 1280, 3500);
    const t = await pest.texto();
    ok(resumen.test(t) && nota.test(t), `${num} (${rol}): panel «${(t.match(/Vigentes \d+ de \d+ permitidos \([^)]*\)/) ?? ["sin panel"])[0]}» con su nota`);
    if (esExcedido) ok(!/Hay más soportes vigentes que abonos registrados: el aliado puede haber/.test(t), `${num}: excedido muestra solo el aviso ámbar (no la nota informativa)`);
  }
  for (const a of ANCHOS) { await sup.ir(`${h.APP}/dashboard/contratos/${num}`, a, 3500); const med = await sup.captura(`ficha-interna-soportes-${num}`, a, '[aria-label="Soportes de pago del aliado"]'); ok(!med.desbordaHorizontal && med.elementosFueraDelViewport === 0, `ficha ${num} (panel de soportes) @${a}px: sin desborde (fuera de viewport: ${med.elementosFueraDelViewport}); texto recortado: ${med.textoRecortado?.length ? med.textoRecortado.join(" | ") : "ninguno"}`); }
}
const errores = [...ali.errores(), ...sup.errores()].filter(Boolean);
ok(errores.length === 0, `sin excepciones de JavaScript en las pestañas (${errores.length})`);

h.escribirMedidas("mediciones_soportes339.json");
console.log(`\nRESULTADO: ${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"} · BUILD_ID ${h.buildId} · peticiones por tipo:`, JSON.stringify(h.peticiones));
h.limpiar();
process.exit(fallos === 0 ? 0 : 1);
