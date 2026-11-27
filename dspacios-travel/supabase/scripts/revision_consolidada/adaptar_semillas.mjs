// Genera las semillas de la revisión consolidada A PARTIR de las semillas sintéticas ya auditadas de cada entrega (se copian tal cual y solo se aplican SUSTITUCIONES DE TEXTO documentadas):
//   · los nombres de asesor de cada semilla pasan a los de las CUENTAS REALES de la revisión (la propiedad de un contrato por «asesor» es por nombre);
//   · la ficha de aliado de la agencia de la revisión es 9409 (la de B1): los contratos de soportes (#339) que eran de otra ficha pasan a ella;
//   · se quita lo que solo sirve a las pruebas automáticas (disparadores de inyección de fallos del bloque 1).
// Uso (desde dspacios-travel/): node supabase/scripts/revision_consolidada/adaptar_semillas.mjs
import fs from "node:fs";
import path from "node:path";
const S = path.resolve(import.meta.dirname, "..");               // supabase/scripts
const OUT = path.join(import.meta.dirname, "semillas");
fs.mkdirSync(OUT, { recursive: true });
const leer = (rel) => fs.readFileSync(path.join(S, rel), "utf8").split("\r\n").join("\n");

const NOMBRES = [["B1 Administracion", "Rev Administracion"], ["B1 Venta Dueno", "Rev Venta"], ["B1 ALIADO AGENCIA", "Agencia Aliada Revision"], ["Asesor 339", "Rev Venta"], ["Asesor Humo", "Rev Venta"], ["Admin Walk", "Rev Administracion"]];
const sustituir = (t, extra = []) => { for (const [a, b] of [...NOMBRES, ...extra]) t = t.split(a).join(b); return t; };
const cabecera = (origen, nota) => `-- REVISIÓN CONSOLIDADA — semilla derivada de ${origen}.\n-- ${nota}\n`;
const escribir = (n, t) => fs.writeFileSync(path.join(OUT, n), t);

// 01 · bloque 1 (vuelos/vouchers/conversión): catálogo base + contratos del recorrido visual
{
  let t = leer("fixture_recorrido_block1.sql");
  const a = t.indexOf("-- Test-only failure injection"), b = t.indexOf("-- Flight package (9402)");
  if (a < 0 || b < 0) throw new Error("marcas del fixture del bloque 1");
  t = t.slice(0, a) + t.slice(b);                                          // sin los disparadores de inyección de fallos
  escribir("01_bloque1_base.sql", cabecera("fixture_recorrido_block1.sql", "Se omite el bloque de disparadores de inyección de fallos (solo para pruebas automáticas).") + sustituir(t));
  escribir("02_bloque1_contratos_vuelo.sql", cabecera("semilla_visual_block1.sql", "Contratos DTM-9701…9705 (datos completos, faltantes, largos, solo tierra, del asesor de ventas) y cotización con vuelos.") + sustituir(leer("semilla_visual_block1.sql")));
  escribir("03_bloque1_vouchers.sql", cabecera("semilla_visual_block1_vouchers.sql", "Contratos DTM-9801…9807: un voucher aéreo por SERVICIO (PNR distintos, sin PNR, mismo PNR, heredado).") + sustituir(leer("semilla_visual_block1_vouchers.sql")));
  escribir("04_bloque1_historial.sql", cabecera("semilla_visual_historial_h81.sql", "Records AAA111/BBB222/CCC333 con historial de movimientos de sillas.") + sustituir(leer("semilla_visual_historial_h81.sql")));
}
// 05 · soportes de pago con cupo adicional (#339): sus contratos pasan a la ficha de la agencia de la revisión (9409)
escribir("05_soportes339.sql", cabecera("semilla_visual_soportes339.sql", "Los contratos DTM-8301…8306 pertenecen ahora a la agencia aliada de la revisión (ficha 9409); DTM-8399 a la freelance (8102).")
  + sustituir(leer("semilla_visual_soportes339.sql"), [["8101", "9409"], ["Agencia Alfa 339", "Agencia Aliada Revision"], ["Freelance Beta 339", "Freelance Aliada Revision"]])
    .replace(/\(9409, 'Agencia Aliada Revision', 'agencia', '900339001', true\)/, "(8101, 'Ficha sin uso 339', 'agencia', '900339001', false)"));
// 06 · CRM (#76 referidos, #78 aviso de cotización pública)
escribir("06_bloque2_crm.sql", cabecera("humo_block2_semilla.sql", "Referidor, aliados 9801–9805, contratos DTM-7001…7006, paquete con hotel bajo solicitud y registros B2B por el camino real.") + sustituir(leer("humo_block2_semilla.sql")));
console.log("semillas escritas en", OUT, fs.readdirSync(OUT).join(", "));

// 07 · bloque 3 (#36 estado de publicación + #13 vigencias de compra): solo el CATÁLOGO; presencia, auditoría y avisos van en post/post_semillas.sql porque dependen de las cuentas reales.
{
  let t = leer("humo_block3_semilla.sql");
  const a = t.indexOf("-- #36 / #13 · catálogo."), z = t.indexOf("-- #13 · avisos en la campana");
  if (a < 0 || z < 0) throw new Error("marcas de la semilla del bloque 3");
  t = t.slice(a, z).replace("update public.config_notificaciones set destinatarios = 'operaciones@humo.test', activo = true where id = 1;", "update public.config_notificaciones set destinatarios = 'operaciones@consolidada.test', activo = true where id = 1;");
  escribir("07_bloque3_catalogo.sql", cabecera("humo_block3_semilla.sql", "Catálogo: 11 paquetes en cada estado real de publicación + vigencias de compra (paquete, salida dinámica, empaquetado, paquete dinámico total) a 0–5 días de hoy (Bogotá).") + t);
}
// 08 · #103 calendario/tarifas del hotel, códigos de promoción, solicitudes y avisos de pago a proveedor (SQL de seed_review.mjs, sin la creación de cuentas por la API)
{
  const j = leer("hostinger_journey_103/seed_review.mjs");
  const a = j.indexOf("psql(a, a.db, `") + "psql(a, a.db, `".length, z = j.indexOf("`, { input: true })");
  if (a < "psql(a, a.db, `".length || z < 0) throw new Error("SQL de la semilla de #103");
  escribir("08_hotel_103.sql", cabecera("hostinger_journey_103/seed_review.mjs", "Hotel Prueba 103 (temporada ALTA, promos con código, cierre general, conjunto de fechas), 2 paquetes con deuda de actualización, contratos DTM-2001…2004 y 3 obligaciones con proveedor.") + sustituir(j.slice(a, z)));
}
console.log("semillas 07 y 08 escritas");
