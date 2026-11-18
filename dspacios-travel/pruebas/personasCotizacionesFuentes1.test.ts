// #1 (migración 308) — reglas puras y cableado: anonimia de las nuevas fuentes, registro persona por persona solo ante un rechazo de una persona, y que la
// migración, su rollback y las acciones no diverjan. El recorrido real contra PostgreSQL está en personasCotizaciones1.pg.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esCotizacionAnonima } from "../lib/personas/cotizacion.ts";
import { altaPersonasCotizacion } from "../lib/personas/consulta.ts";
import { altaPersonasDeCotizacionGuardada } from "../lib/personas/altaGuardada.ts";

const raiz = new URL("../", import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, raiz), "utf8").replace(/\r\n/g, "\n");
const base = { tenant: "mayorista", creado_por_id: null, propietario_id: null, aliado_id: null };

describe("anonimia: misma regla en TypeScript y en la base", () => {
  test("carrito público, paquete dinámico de un visitante y solicitud de hotel de un visitante son anónimas", () => {
    assert.equal(esCotizacionAnonima({ ...base, tipo: "carrito" }), true);
    assert.equal(esCotizacionAnonima({ ...base, tipo: "comparativa_carrito" }), true);
    assert.equal(esCotizacionAnonima({ ...base, tipo: "manual", paquete_din_id: 7 }), true);
    assert.equal(esCotizacionAnonima({ ...base, tipo: "tarifario", creado_por: null, paquete_armado_id: 3 }), true);
  });
  test("con creador, propietario o aliado, en minorista o con datos que faltan, NO es anónima (lo seguro: se registra el tipo y la base decide)", () => {
    assert.equal(esCotizacionAnonima({ ...base, tipo: "manual", paquete_din_id: 7, creado_por_id: "u" }), false, "din con sesión");
    assert.equal(esCotizacionAnonima({ ...base, tipo: "manual" }), false, "manual simple (216): siempre con autor");
    assert.equal(esCotizacionAnonima({ ...base, tipo: "tarifario", creado_por: "asesor@x.test", paquete_armado_id: 3 }), false, "Reservar: trae el correo");
    assert.equal(esCotizacionAnonima({ ...base, tipo: "tarifario", paquete_armado_id: 3 }), false, "creado_por no informado ≠ null");
    assert.equal(esCotizacionAnonima({ ...base, tipo: "tarifario", creado_por: null }), false, "sin paquete armado");
    assert.equal(esCotizacionAnonima({ ...base, tenant: "minorista", tipo: "carrito" }), false);
    assert.equal(esCotizacionAnonima({ ...base, aliado_id: 4, tipo: "carrito" }), false);
  });
});

// ── Fachada simulada: cuenta las llamadas y responde según la entrada ──
type Llamada = { n: number; fn: string; participantes: { numero_doc: string | null }[] };
function adminSimulado(rechazo: (p: { numero_doc: string | null }[]) => string | null) {
  const llamadas: Llamada[] = [];
  const admin = {
    rpc: async (fn: string, args: { p_participantes?: { numero_doc: string | null }[] }) => {
      const participantes = args.p_participantes ?? [];
      llamadas.push({ n: llamadas.length + 1, fn, participantes });
      const msg = rechazo(participantes);
      return msg ? { data: null, error: { message: msg } } : { data: { nuevos: participantes.length, reintentos: 0, omitidos: 0 }, error: null };
    },
  };
  return { admin: admin as never, llamadas };
}
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const fila = (pasajeros: { numeroDoc: string }[]) => ({
  id: 1, tenant: "mayorista", tipo: "tarifario", creado_por: "a@x.test",
  payload: { cliente: { nombres: "Ana", apellidos: "P", tipoDoc: "CC", numeroDoc: "111" }, pasajeros: pasajeros.map((p, i) => ({ nombres: `P${i}`, apellidos: "X", tipoDoc: "CC", ref: uuid(i + 1), ...p })) },
});
const malo = (ps: { numero_doc: string | null }[]) => (ps.some((p) => p.numero_doc === "999") ? "original_demasiado_largo" : null);

describe("alta: un rechazo de UNA persona no deja fuera a las demás", () => {
  test("lote sin problema: una sola llamada (sin bucle por pasajero)", async () => {
    const { admin, llamadas } = adminSimulado(() => null);
    const r = await altaPersonasCotizacion(admin, { fila: fila([{ numeroDoc: "222" }, { numeroDoc: "333" }]), usuarioId: "u", sellar: false });
    assert.equal(r.ok, true); assert.equal(llamadas.length, 1); assert.equal(llamadas[0].participantes.length, 3);
  });
  test("un pasajero inválido: el lote falla, se intenta de a una y solo ese queda sin registrar (con aviso)", async () => {
    const { admin, llamadas } = adminSimulado(malo);
    const r = await altaPersonasCotizacion(admin, { fila: fila([{ numeroDoc: "222" }, { numeroDoc: "999" }, { numeroDoc: "333" }]), usuarioId: "u", sellar: false });
    assert.deepEqual(r, { ok: false, etapa: "registro", codigo: "original_demasiado_largo" });
    assert.equal(llamadas.length, 1 + 4, "1 del lote + 1 por persona (titular + 3 pasajeros), solo en este camino de fallo");
    const aceptadas = llamadas.slice(1).filter((l) => !l.participantes.some((p) => p.numero_doc === "999"));
    assert.equal(aceptadas.length, 3, "titular y los dos pasajeros válidos quedaron registrados");
  });
  // F2 (auditoría Codex): lista POSITIVA. Cada clase de fallo se mide por su número EXACTO de llamadas (titular + 2 pasajeros = 3 participantes).
  const tres = () => fila([{ numeroDoc: "222" }, { numeroDoc: "333" }]);
  const PERSONA = ["original_demasiado_largo", "nit_dv_sin_nit", "nit_dv_invalido", "observaciones_invalidas", "campo_no_admitido", "participante_vacio", "tipo_no_admitido"];
  for (const codigo of PERSONA) {
    test(`dato inválido de UNA persona (${codigo}): 1 llamada del lote + 1 por participante (4), y el resto queda registrado`, async () => {
      const { admin, llamadas } = adminSimulado((ps) => (ps.some((p) => p.numero_doc === "333") ? codigo : null));
      const r = await altaPersonasCotizacion(admin, { fila: tres(), usuarioId: "u", sellar: false });
      assert.deepEqual(r, { ok: false, etapa: "registro", codigo });
      assert.equal(llamadas.length, 1 + 3);
      assert.equal(llamadas.slice(1).filter((l) => !l.participantes.some((p) => p.numero_doc === "333")).length, 2, "titular y el otro pasajero sí pasaron");
    });
  }
  for (const codigo of [
    "no_autorizado", "cotizacion_no_abierta", "cotizacion_inexistente", "tenant_invalido", "participantes_invalidos", // de la llamada
    "ref_invalido", "ref_inconsistente", "captura_inconsistente", "fuente_invalida", "origen_invalido", "captura_id_obligatorio", "clave_alta_reutilizada", // estructura o código propio
    "canceling", "connection", "fetch", "deadlock", "lock", "invalid", "unknown", // sistema: tiempo agotado, red, bloqueos o texto no reconocido
  ]) {
    test(`rechazo que NO es de una persona (${codigo}): exactamente 1 llamada, sin recorrer participantes`, async () => {
      const { admin, llamadas } = adminSimulado(() => codigo);
      const r = await altaPersonasCotizacion(admin, { fila: tres(), usuarioId: "u", sellar: false });
      assert.deepEqual(r, { ok: false, etapa: "registro", codigo }); assert.equal(llamadas.length, 1);
    });
  }
  test("tiempo agotado con el texto real de PostgreSQL: 1 llamada (antes 3 con 1 titular y 1 pasajero, 1+N con más)", async () => {
    for (const n of [1, 2, 8]) {
      const a = adminSimulado(() => "canceling statement due to statement timeout");
      const ra = await altaPersonasCotizacion(a.admin, { fila: fila(Array.from({ length: n }, (_, i) => ({ numeroDoc: `4${i}` }))), usuarioId: "u", sellar: false });
      assert.equal(ra.ok, false); assert.equal(a.llamadas.length, 1, `${n} pasajeros`);
    }
  });
  test("mensaje sin código reconocible (vacío, null, solo números): 1 llamada", async () => {
    for (const msg of ["", "123 raro", "  "]) {
      const a = adminSimulado(() => msg || " ");
      const r = await altaPersonasCotizacion(a.admin, { fila: tres(), usuarioId: "u", sellar: false });
      assert.equal(r.ok, false); assert.equal(a.llamadas.length, 1, JSON.stringify(msg));
    }
  });
  test("un solo participante con dato inválido: 1 llamada (no hay con quién repartir)", async () => {
    const unica = adminSimulado(malo);
    const f = fila([]); f.payload.cliente.numeroDoc = "999";
    const ru = await altaPersonasCotizacion(unica.admin, { fila: f, usuarioId: "u", sellar: false });
    assert.equal(ru.ok, false); assert.equal(unica.llamadas.length, 1);
  });
  test("si durante el recorrido de a una aparece un fallo que ya no es de la persona (tiempo agotado, autorización), se DETIENE ahí", async () => {
    for (const [detiene, codigoEsperado] of [["canceling statement due to statement timeout", "canceling"], ["no_autorizado", "no_autorizado"], ["boom", "boom"]] as const) {
      let n = 0;
      const { admin, llamadas } = adminSimulado((ps) => { n++; if (n === 1) return "original_demasiado_largo"; if (n === 3) return detiene; return ps.length === 1 ? null : "original_demasiado_largo"; });
      const r = await altaPersonasCotizacion(admin, { fila: tres(), usuarioId: "u", sellar: false });
      assert.deepEqual(r, { ok: false, etapa: "registro", codigo: codigoEsperado });
      assert.equal(llamadas.length, 3, "lote + 2 participantes; los siguientes NO se intentan");
    }
  });
  test("el sello fallido no multiplica llamadas: 1 sello + 1 registro, y el aviso de sello se conserva", async () => {
    const llamadas: string[] = [];
    const admin = { rpc: async (fn: string) => { llamadas.push(fn); return fn === "sellar_creador_cotizacion" ? { data: null, error: { message: "sello_no_admitido" } } : { data: { nuevos: 3, reintentos: 0, omitidos: 0 }, error: null }; } };
    const r = await altaPersonasCotizacion(admin as never, { fila: tres(), usuarioId: "u", sellar: true });
    assert.deepEqual(r, { ok: false, etapa: "sello", codigo: "sello_no_admitido" }); assert.deepEqual(llamadas, ["sellar_creador_cotizacion", "registrar_personas_cotizacion"]);
  });
  test("si el rechazo del lote era transitorio y todas pasan de a una, el resultado es éxito", async () => {
    let primera = true;
    const { admin, llamadas } = adminSimulado((ps) => { if (primera && ps.length > 1) { primera = false; return "original_demasiado_largo"; } return null; });
    const r = await altaPersonasCotizacion(admin, { fila: fila([{ numeroDoc: "222" }]), usuarioId: "u", sellar: false });
    assert.equal(r.ok, true); assert.equal(llamadas.length, 1 + 2);
  });
});

// F1 (auditoría Codex): el sello faltante solo se pide si la cotización de verdad no lo tiene; la base decide a quién se lo concede (mismo autor, < 15 min).
describe("alta de una cotización ya guardada: recuperación del sello", () => {
  function adminConFila(creadoPorId: string | null) {
    const llamadas: string[] = [];
    const f = { ...fila([{ numeroDoc: "222" }]), creado_por_id: creadoPorId };
    const admin = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: f, error: null }) }) }) }),
      rpc: async (fn: string) => { llamadas.push(fn); return fn === "sellar_creador_cotizacion" ? { data: "sellada", error: null } : { data: { nuevos: 2, reintentos: 0, omitidos: 0 }, error: null }; },
    };
    return { admin: admin as never, llamadas };
  }
  test("sin sello y con usuario verificado: 1 sello + 1 registro", async () => {
    const { admin, llamadas } = adminConFila(null);
    assert.deepEqual(await altaPersonasDeCotizacionGuardada(admin, 1, "u", true), { ok: true });
    assert.deepEqual(llamadas, ["sellar_creador_cotizacion", "registrar_personas_cotizacion"]);
  });
  test("ya sellada (por él u otro): no se vuelve a pedir el sello — solo el registro idempotente", async () => {
    for (const dueno of ["u", "otro"]) {
      const { admin, llamadas } = adminConFila(dueno);
      await altaPersonasDeCotizacionGuardada(admin, 1, "u", true);
      assert.deepEqual(llamadas, ["registrar_personas_cotizacion"]);
    }
  });
  test("sin usuario (visitante) o con sellar=false: nunca se pide el sello", async () => {
    for (const [uid, sellar] of [[null, true], ["u", false]] as const) {
      const { admin, llamadas } = adminConFila(null);
      await altaPersonasDeCotizacionGuardada(admin, 1, uid, sellar);
      assert.deepEqual(llamadas, ["registrar_personas_cotizacion"]);
    }
  });
});

describe("entrega: lanzador de pruebas con estado de salida y scripts SQL del dueño de una sola consulta", () => {
  const lanzador = leer("supabase/scripts/test_pg_local.sh");
  const envoltorio = leer("supabase/scripts/test_1_personas_cotizaciones.sh");
  test("F3: el lanzador conserva el estado de Node a través del filtro y mantiene la limpieza (trap)", () => {
    assert.match(lanzador, /2>&1; echo \$\? > "\$RCF"; \} \\/);
    assert.match(lanzador, /RC="\$\(cat "\$RCF"/); assert.match(lanzador, /^exit "\$RC"$/m); assert.match(lanzador, /^trap limpiar EXIT$/m);
  });
  test("F3: el envoltorio de #1 corre las dos suites y sale distinto de 0 si cualquiera falla", () => {
    assert.equal(envoltorio.split("|| RC=1").length - 1, 2); assert.match(envoltorio, /^exit "\$RC"$/m); assert.match(envoltorio, /^RC=0$/m);
  });
  for (const f of ["preflight", "postcheck"]) {
    test(`F4: ${f} 308 es UNA sola sentencia SELECT de solo lectura, con control, observado, esperado y veredicto`, () => {
      const sql = leer(`supabase/scripts/${f}_308_personas_cotizacion_fuentes.sql`).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").trim();
      assert.match(sql, /^with\b/i); assert.match(sql, /select control, observado, esperado, veredicto from \(/);
      assert.equal(sql.split(";").length - 1, 1, "un solo punto y coma"); assert.ok(sql.endsWith(";"));
      assert.ok(!/\b(begin|rollback|commit|insert|update|delete|create|alter|drop|grant|revoke|set)\b/i.test(sql.replace(/'[^']*'/g, "''")), "sin transacción ni escritura");
    });
  }
});

describe("cableado: la 308, su rollback y las acciones", () => {
  const m308 = leer("supabase/migrations/20260601000308_personas_cotizacion_fuentes.sql");
  const rb = leer("supabase/scripts/rollback_308_personas_cotizacion_fuentes.sql");
  const m219 = leer("supabase/migrations/20260601000219_personas_cotizaciones.sql");
  const sinComentarios = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const sql = sinComentarios(m308);

  test("la 308 solo redefine las dos fachadas de la 219: sin tablas, sin datos, grants solo a service_role", () => {
    assert.deepEqual([...sql.matchAll(/create or replace function ([a-z_.0-9]+)\(/g)].map((x) => x[1]), ["public.registrar_personas_cotizacion", "public.sellar_creador_cotizacion"]);
    for (const prohibido of [/create table/i, /alter table/i, /\bdelete from\b/i, /drop function/i, /grant [^;]*\b(anon|authenticated)\b/i]) {
      assert.ok(!prohibido.test(sql), `la 308 contiene ${prohibido}`);
    }
    // El DML que trae es el de las funciones de la 219 (alta del puesto y sello): ni una escritura más ni una menos.
    const dml = (t: string) => (t.match(/\b(insert into|update) public\.[a-z_]+/g) ?? []).sort().join("|");
    const s219 = sinComentarios(m219);
    const cuerpo219 = (firma: string) => { const i = s219.indexOf(`create or replace function ${firma}(`); return s219.slice(i, s219.indexOf("\n$$;\n", i)); };
    assert.equal(dml(sql), dml(cuerpo219("public.registrar_personas_cotizacion") + cuerpo219("public.sellar_creador_cotizacion")));
    assert.match(sql, /revoke all on function public\.registrar_personas_cotizacion\(bigint, uuid, jsonb\) from public, anon, authenticated, service_role/);
    assert.match(sql, /grant execute on function public\.registrar_personas_cotizacion\(bigint, uuid, jsonb\), public\.sellar_creador_cotizacion\(bigint, uuid\) to service_role/);
    assert.match(sql, /\bsecurity definer\b/); assert.match(sql, /set search_path = pg_catalog, pg_temp/);
  });
  test("admite pendiente_tarifa en las dos fachadas y define la anonimia nueva sin depender del estado", () => {
    assert.equal(sql.split("not in ('abierta', 'pendiente_tarifa')").length - 1, 2);
    assert.match(sql, /q\.tipo = 'manual' and q\.paquete_din_id is not null/);
    assert.match(sql, /q\.tipo = 'tarifario' and q\.creado_por is null and q\.paquete_armado_id is not null/);
    assert.ok(!/q\.estado = 'pendiente_tarifa'[\s\S]*anonim/.test(sql));
  });
  test("el rollback restaura el texto EXACTO de la 219 (y no contiene pendiente_tarifa)", () => {
    const cuerpo = (s: string, firma: string) => { const i = s.indexOf(`create or replace function ${firma}(`); return s.slice(i, s.indexOf("\n$$;\n", i)); };
    for (const f of ["public.registrar_personas_cotizacion", "public.sellar_creador_cotizacion"]) assert.equal(cuerpo(rb, f), cuerpo(m219, f), f);
    assert.ok(!sinComentarios(rb).includes("pendiente_tarifa"));
  });
  test("las acciones registran a la persona en TODOS los orígenes, también el visitante y la solicitud de hotel", () => {
    const din = leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts");
    assert.ok(!/else \{\s*alta = await altaPersonasCotizacion\(/.test(din), "din: el alta ya no es exclusiva de los usuarios con sesión");
    assert.match(din, /const alta = await altaPersonasCotizacion\(admin, \{[^}]*paquete_din_id: p\.id/);
    const sol = leer("app/tarifario/solicitudHotelActions.ts");
    assert.match(sol, /altaPersonasCotizacion\(admin, \{\s*fila: \{ id: row\.id, tenant: "mayorista", tipo: "tarifario"/);
    assert.match(sol, /sellar: !!user/);
    assert.match(sol, /altaPersonasDeCotizacionGuardada\(admin, cotizacionId, user\?\.id \?\? null, !!user\)/, "la solicitud repetida repara el registro y recupera el sello faltante del usuario con sesión");
    const co = leer("app/tarifario/checkout/actions.ts");
    assert.match(co, /altaPersonasDeCotizacionGuardada\(admin, data\.id, actor === "anon" \? null : actor, actor !== "anon"\)/, "la misma intención repetida (mismo actor verificado) repara el registro y el sello");
  });
  test("la ficha y su «Reintentar» también cubren una solicitud pendiente de tarifa y usan la lista única de columnas", () => {
    const pagina = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(pagina, /c\.estado === "abierta" \|\| c\.estado === "pendiente_tarifa"/);
    assert.match(pagina, /cot\.estado !== "abierta" && cot\.estado !== "pendiente_tarifa"/);
    assert.match(pagina, /leerFilaCotizacionPersonas\(admin, cotizacionId\)/);
  });
  test("asignarNetaSolicitud repite el alta con la fila REAL (helper compartido) y reservar/actions.ts sigue sin columnas de #39", () => {
    const r = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(r, /altaPersonasDeCotizacionGuardada\(admin, cotizacionId, user\.id, false\)/);
    assert.doesNotMatch(r, /creado_por_id: cot\.|paquete_din_id: cot\./);
  });
  test("la lista del CRM rotula una solicitud pendiente de tarifa (no muestra el código crudo)", () => {
    assert.match(leer("app/(crm)/crm/personas-cotizacion/PersonasCotizacionClient.tsx"), /pendiente_tarifa: "Pendiente de tarifa"/);
  });
  test("la lista de columnas del alta incluye todo lo que usa esCotizacionAnonima", () => {
    const c = leer("lib/personas/cotizacion.ts");
    const lista = /COLUMNAS_COTIZACION_PERSONAS =\s*"([^"]+)"/.exec(c)?.[1] ?? "";
    for (const col of ["creado_por_id", "propietario_id", "aliado_id", "creado_por", "paquete_din_id", "paquete_armado_id", "tenant", "tipo", "payload"]) assert.ok(lista.includes(col), col);
  });
});
