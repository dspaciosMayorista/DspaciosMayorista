// #43/#60 incremento 2 — lectura combinada por HTTP contra PostgREST local (la lanza
// supabase/scripts/test_293_lectura_postgrest.sh). Usa las MISMAS cadenas `select` de los cuatro
// cargadores del motor, extraídas del código fuente, y comprueba por rol que:
//   (a) cada lectura sigue siendo UNA solicitud con 0, 1 y 10 grupos (se mide el volumen);
//   (b) RLS no oculta los grupos de una vigencia visible (grupos recibidos == grupos reales);
//   (c) la paginación por rangos de vigencia.ts funciona igual con la incrustación.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const URL = process.env.T293_URL, SECRETO = process.env.T293_SECRETO, SQL = process.env.T293_SQL;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`;
};
const usuario = (n, s) => jwt({ role: "authenticated", sub: `00000000-0000-4000-8000-00000000930${n}`, session_id: `00000000-0000-4000-8000-00000000a30${s}` });
const ROLES = {
  service_role: jwt({ role: "service_role" }),
  superadmin: usuario(1, 1),
  operaciones_mayorista: usuario(2, 2),
  operaciones_minorista: usuario(3, 3),
  venta: usuario(4, 4),
  anon: null,
};
const sql = (q) => execSync(SQL, { input: q, encoding: "utf8" }).trim();

let fallos = 0, solicitudes = 0;
const ok = (c, m) => { if (c) console.log(`OK    ${m}`); else { fallos++; console.log(`FALLO ${m}`); } };

// Cadenas reales de los cargadores (la prueba falla si alguno deja de incrustar los grupos).
const fuentes = {
  "cotizar.ts": "lib/reservar/cotizar.ts",
  "computo.ts": "lib/reservar/computo.ts",
  "vigencia.ts": "lib/tarifario/vigencia.ts",
  "paquetes/actions.ts": "app/(dashboard)/dashboard/paquetes/actions.ts",
};
const selects = {};
// #43/#60 entrega 4: los cargadores arman la lectura con un template que incrusta SELECT_PROMO_VIGENCIA (lib/calc/promocionesGrupo.ts).
// Se acepta comilla doble o backtick y se sustituye la constante por su valor REAL, así la consulta enviada sigue siendo la del código.
const SELECT_PROMO = readFileSync("lib/calc/promocionesGrupo.ts", "utf8").match(/export const SELECT_PROMO_VIGENCIA = "([^"]*)";/)?.[1] ?? null;
for (const [k, f] of Object.entries(fuentes)) {
  const m = [...readFileSync(f, "utf8").matchAll(/from\("hotel_temporadas"\)\s*\.select\((?:"([^"]*)"|`([^`]*)`)\)/g)]
    .map((x) => (x[1] ?? x[2]).replace(/\$\{SELECT_PROMO_VIGENCIA\}/g, SELECT_PROMO ?? "\u0000sin constante"))
    .filter((s) => s.includes("hotel_temporada_grupos(") && !s.includes("${"));
  ok(m.length === 1, `${k}: la lectura de vigencias del motor incrusta los grupos`);
  selects[k] = m[0];
}

async function get(token, ruta) {
  solicitudes++;
  const r = await fetch(`${URL}${ruta}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const texto = await r.text();
  return { status: r.status, bytes: Buffer.byteLength(texto), cuerpo: (() => { try { return JSON.parse(texto); } catch { return texto; } })() };
}
const ruta = (sel, extra = "") => `/hotel_temporadas?select=${encodeURIComponent(sel)}&hotel_id=eq.9301&order=orden,id${extra}`;
const gruposReales = () => Number(sql("select count(*) from public.hotel_temporada_grupos g join public.hotel_temporadas t on t.id = g.temporada_id where t.hotel_id = 9301;"));

const medidas = [];
async function escenario(nombre) {
  const reales = gruposReales();
  for (const [k, sel] of Object.entries(selects)) {
    for (const [rol, token] of Object.entries(ROLES)) {
      const antes = solicitudes;
      const r = await get(token, ruta(sel));
      ok(solicitudes - antes === 1, `[${nombre}] ${k} / ${rol}: una sola solicitud`);
      if (rol === "anon") {
        // anon no tiene SELECT sobre la tabla de grupos: PostgREST rechaza la incrustación (no la vacía en silencio).
        ok(r.status >= 400, `[${nombre}] ${k} / anon: rechazado explícitamente (HTTP ${r.status}), ningún cargador del motor usa anon`);
        continue;
      }
      ok(r.status === 200 && Array.isArray(r.cuerpo), `[${nombre}] ${k} / ${rol}: HTTP 200`);
      const vigs = Array.isArray(r.cuerpo) ? r.cuerpo : [];
      const recibidos = vigs.reduce((s, v) => s + (Array.isArray(v.hotel_temporada_grupos) ? v.hotel_temporada_grupos.length : 0), 0);
      if (rol === "venta") ok(vigs.length === 0, `[${nombre}] ${k} / venta: no ve vigencias (igual que hoy)`);
      else ok(vigs.length === 6 && recibidos === reales, `[${nombre}] ${k} / ${rol}: 6 vigencias y ${reales} grupos recibidos (RLS no los oculta)`);
      if (k === "cotizar.ts" && rol === "service_role") medidas.push({ escenario: nombre, grupos: reales, bytes: r.bytes });
    }
  }
  // Paginación tal como la hace vigencia.ts (rangos ordenados por id): mismas filas y grupos que sin paginar.
  const p1 = await get(ROLES.service_role, ruta(selects["vigencia.ts"], "&limit=4&offset=0"));
  const p2 = await get(ROLES.service_role, ruta(selects["vigencia.ts"], "&limit=4&offset=4"));
  const todas = [...p1.cuerpo, ...p2.cuerpo];
  ok(todas.length === 6 && todas.reduce((s, v) => s + v.hotel_temporada_grupos.length, 0) === reales,
    `[${nombre}] vigencia.ts paginada en 2 páginas: 6 vigencias y ${reales} grupos`);
}

// La fila de vigencia nueva para tener 6 en el hotel 9301 (el fixture trae 5).
sql("insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (930107, 9301, 'MEDIA', '2027-06-01', '2027-06-30', 1, 'tarifa');");
{
  // Línea base: la misma lectura de cotizar.ts SIN la incrustación (como era antes del incremento 2).
  const r = await get(ROLES.service_role, ruta(selects["cotizar.ts"].replace(", hotel_temporada_grupos(id, dias, activo)", "")));
  medidas.push({ escenario: "sin incrustar (antes)", grupos: 0, bytes: r.bytes });
}
await escenario("0 grupos");
sql("insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930101, 'Fin de semana', array[5,6,7]);");
await escenario("1 grupo");
sql(`delete from public.hotel_temporada_grupos;
insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) select 930101, 'D' || d, array[d]::smallint[] from generate_series(1,7) d;
insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930105, 'A', array[1,2]), (930105, 'B', array[3,4]), (930107, 'C', array[5,6,7]);`);
await escenario("10 grupos");
ok(sql("select count(*) from public.hotel_temporada_grupos where activo;") === "0", "los grupos siguen inactivos (la incrustación no los activa)");

console.log("\nVolumen de la respuesta de vigencias (cotizar.ts, service_role, hotel con 6 vigencias):");
for (const m of medidas) console.log(`  ${m.escenario.padEnd(9)} ${String(m.grupos).padStart(2)} grupos  ${m.bytes} bytes`);
console.log(`\nSolicitudes HTTP totales de la prueba: ${solicitudes}`);
console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
