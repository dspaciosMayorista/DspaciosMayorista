// Genera la GUÍA DEL DUEÑO (español) a partir de los mismos pasos que ejecuta el ensayo: lo que el dueño lee es lo que se ensayó.
//   node supabase/scripts/revision_consolidada/generar_guia.mjs [--salida archivo.md] [--build ID] [--ensayo "texto de resultado"]
import fs from "node:fs";
import path from "node:path";
const AQUI = import.meta.dirname;
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const CFG = path.join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const cfg = JSON.parse(fs.readFileSync(path.join(CFG, "config.json"), "utf8"));
const APP = `http://localhost:${cfg.puertos.app}`;
const ENTREGAS = [
  ["bloque3", "Bloque 3 — Presencia reciente (#11), alertas de fin de compra en la zona «Alertas» (#13) y estado de publicación (#36)"],
  ["bloque1", "Bloque 1 — Vuelos y vouchers (#17, #18, #26, #29, #37, #40)"],
  ["bloque2", "Bloque 2 — CRM: referidos (#76), aviso de cotización pública (#78) e inventarios (#27, #28)"],
  ["soportes339", "Soportes de pago del aliado con cupo adicional (migración 339)"],
  ["hotel103", "Hotel: calendario, actualización de tarifas, solicitudes al proveedor y avisos de pago (#103)"],
  ["bloque95", "Bloque de seis tareas (#95, #61, #41, #42, #51, #33)"],
  ["hotel88", "Información de hotel en paquetes dinámicos (#88)"],
  ["neta", "Costo neto del bloqueo"],
  ["integracion", "Integración — lo que solo ocurre al combinar las entregas"],
];
const pasos = [];
const dir = path.join(AQUI, "pasos");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs")).sort()) pasos.push(...((await import(`file:///${path.join(dir, f).replace(/\\/g, "/")}`)).pasos ?? []));
const cuenta = (rol) => (rol ? `${rol}@consolidada.test` : "sin iniciar sesión (visitante)");
const L = [];
L.push(`# Revisión consolidada local — guía del dueño`, "",
  `Generada automáticamente a partir de los pasos que se ensayaron. Todo es **sintético y local**: ninguna persona, proveedor, banco ni correo real participa y **nada sale de este equipo**. Build de la aplicación: \`${arg("--build") ?? "?"}\`.`, "",
  arg("--ensayo") ? `**Ensayo previo (copia desechable, no tu base):** ${arg("--ensayo")}` : "", "",
  "## 1. Antes de empezar", "",
  "| Qué | Dónde |", "|---|---|",
  `| Aplicación | ${APP}/login — usa siempre \`localhost\` (no \`127.0.0.1\`); solo este equipo puede abrirla |`,
  `| Correo de pruebas (lo que la aplicación «enviaría»; no sale nada) | http://127.0.0.1:${cfg.puertos.correo} |`,
  "| Cuentas (todas con la misma contraseña) | `C:\\Users\\Usuario\\AppData\\Local\\dspacios-local-revision-consolidada\\credenciales.txt` — correos `<alias>@consolidada.test` |",
  "| Navegador con las cuentas guardadas | `node supabase\\scripts\\revision_consolidada\\revision.mjs navegador` (abre Edge con un perfil propio; en el campo de correo se elige la cuenta de la lista) |",
  "| Iniciar / detener | `node supabase\\scripts\\revision_consolidada\\revision.mjs iniciar` · `… detener` (desde la carpeta `dspacios-travel` de la composición). **Detener no borra nada**: base, archivos, cuentas y avance se conservan. Pídeselo al ejecutor si prefieres. |",
  "| Volver al estado inicial | `… restaurar --confirmar` — acción **separada y explícita** que DESCARTA tu avance. Nunca ocurre al iniciar o detener. |", "",
  "Cuentas: **superadmin**, **gerencia**, **administracion**, **operaciones**, **venta** (asesor de ciertos contratos), **venta2**, **controlvuelo**, **aliado** (agencia, ficha «Agencia Aliada Revision», portal `/portal/b2b`), **freelance**, **minorista** y **inactivo** (desactivada, para comprobar el acceso denegado).", "",
  "## 2. Qué NO está implementado (no lo busques)", "",
  "- **Pagos a referidos**: no existe el registro del pago, ni retención, ni documento, ni contabilidad/margen, ni política de pago en USD. La «elegibilidad» de una participación **no es un pago**.",
  "- **Buzón real de Hostinger y entrega real de correo** (#103): aquí el correo solo se captura localmente y la respuesta del proveedor es simulada.",
  "- **Costos y consumo en la nube (Vercel/Supabase)**: no se miden; solo hay evidencia local.",
  "- **Hallazgo preexistente, ya medido (paso INT-04; no lo introduce esta revisión):** con gerencia, administración u operaciones el selector «Asesor interno» de «Nuevo contrato (manual)» y de «Nueva cotización» sale vacío (la regla de acceso a `usuarios` solo deja ver el propio perfil); con venta aparece solo ella, y venta no lee el catálogo de servicios ni las tarifas por categoría. Por eso los pasos de creación con catálogo (B95-13 al B95-16 y B95-20) se recorren con la cuenta **superadmin** (la tuya), y los recorridos reales de personal (B2-04b, B2-12, NETO-03…) usan **venta**. No hace falta que lo verifiques en producción; queda como decisión de producto.",
  "- **Archivos de los soportes sembrados (#339): NO se abren.** Los soportes que ya vienen cargados en DTM-8302 al DTM-8306 (`s1.pdf`, `a.pdf`, `pago-1.pdf`, `p1.pdf`…) son solo FILAS de prueba para comprobar cupos, historial y avisos; no tienen archivo detrás y «Abrir» sobre ellos no entregaría nada. Pulsa «Abrir» únicamente en los soportes que subas tú en la revisión (por ejemplo `comprobante-8301.pdf`, paso S339-05), que sí son archivos reales.",
  "- **Corrección histórica de datos reales** (clientes, aliados duplicados, costos de bloqueos anteriores): no se hace; los diagnósticos son de solo lectura y los corre el ejecutor si los pides.", "",
  "## 3. Ya aceptado antes — no se repite", "",
  "**Segunda ronda (correcciones de tus dos revisiones):** esta guía conserva los pasos que aceptaste (no se repiten salvo que se indique) y reemplaza los que pediste corregir o explicar. La matriz completa paso por paso (aceptado / aceptado con corrección / rechazado / explicación / verificación diferida a Producción) está en `docs/tecnico/rev2-matriz-aceptacion-2026-11-26.md`. Lo que NO se prueba aquí y sigue pendiente en Producción: el registro público con código por correo real (B2-05), los pasos H103-05 a H103-10 y el buzón real de Hostinger.", "",
  "Las cuatro correcciones finales aceptadas (origen directo/asistido, pasajeros compactos, «Agregar pasajero» visible y tarifa de niño), la recuperación de contraseña de una cuenta existente, el cierre general en bloqueos y las comprobaciones locales previas registradas en la cola de pendientes. El registro con código por correo y la recuperación desde un registro interrumpido quedaron diferidos a Producción por decisión del dueño (el registro con código del bloque CRM sí se prueba aquí con el correo de pruebas).", "");
let n = 0;
for (const [clave, titulo] of ENTREGAS) {
  const ps = pasos.filter((p) => p.entrega === clave); if (!ps.length) continue;
  L.push(`## ${++n + 3}. ${titulo}`, "");
  for (const p of ps) {
    L.push(`### ${p.id} — ${p.titulo}`, "", `- **Cuenta:** ${cuenta(p.rol)}`, `- **Enlace:** ${p.ruta ? `${APP}${p.ruta}` : "(el que se indica abajo)"}`, `- **Qué hacer:** ${p.accion}`, `- **Qué debe verse:** ${p.esperado}`, "- **Resultado:**  ☐ correcto   ☐ con observación: ____________", "");
  }
}
L.push("## Decisiones de política que siguen abiertas (no son pruebas)", "",
  "- **Alertas de fin de compra (zona «Alertas», migración 344):** «Revisado» es por persona (¿debe un solo «Revisado» limpiar la alerta para todos?), alcance de las alertas de hotel y servicio (hoy todas las vigencias de un hotel o servicio activo, incluidas promociones), quién las recibe (hoy: superadmin, gerencia, administración y operaciones de la agencia; ¿también venta?), umbral (reutiliza «días de anticipación», 5 por defecto), ventana de «presencia reciente» (10 minutos) y la campana añadida al CRM.",
  "- **#103:** remitente y dirección de respuesta, destinatarios internos, formato y catálogo por proveedor, latencia del barrido diario, elegibilidad del primer barrido y ruta final del correo.",
  "- **Soportes (#339):** si los contratos cancelados deben seguir en el listado.",
  "- **Antes de publicar:** orden de migraciones 327→348 con su preflight/postcheck (una consulta integral cada una), revisión de bloqueos activos sin neto real y verificación en la nube.", "");
const salida = arg("--salida") ?? path.join(CFG, "GUIA_REVISION.md");
fs.writeFileSync(salida, L.join("\r\n") + "\r\n"); console.log(`guía escrita: ${salida} · ${pasos.length} pasos`);
