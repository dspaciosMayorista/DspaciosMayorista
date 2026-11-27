// #76 — Referidos: reglas puras y garantías que se pueden fijar sin base de datos. La semántica real (atribución, elegibilidad, concurrencia, reversa de pagos) está en
// supabase/scripts/test_341_referidos.sql/.sh, test_341_concurrencia.sh y pruebas/referidos76.pg.ts; la pantalla, en pruebas/referidosUI76.react.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accesoReferidos, decisionValida, ETIQUETA_ESTADO, esEstadoReferido, formatPct, mensajeErrorReferidos, normalizarCodigo, pctValido, PCT_REFERIDO } from "../lib/referidos/reglas.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const sinComentarios = (s: string) => s.replace(/^\s*(--|\/\/).*$/gm, "");

describe("quién entra y quién gestiona", () => {
  test("superadmin y gerencia gestionan; administración solo consulta; el resto no entra", () => {
    const ok = (rol: string) => accesoReferidos({ rol, activo: true });
    assert.deepEqual(ok("superadmin"), { ok: true, gestiona: true });
    assert.deepEqual(ok("gerencia"), { ok: true, gestiona: true });
    assert.deepEqual(ok("administracion"), { ok: true, gestiona: false });
    for (const rol of ["operaciones", "venta", "control_vuelo", "agencia", "freelance", "cliente_final", "inventado", ""]) assert.deepEqual(ok(rol), { ok: false }, rol);
  });
  test("falla cerrado: usuario inactivo, sin estado, sin perfil o rol no textual", () => {
    for (const activo of [false, null, undefined, "true", 1]) assert.deepEqual(accesoReferidos({ rol: "superadmin", activo }), { ok: false }, String(activo));
    assert.deepEqual(accesoReferidos(null), { ok: false }); assert.deepEqual(accesoReferidos(undefined), { ok: false });
    assert.deepEqual(accesoReferidos({ rol: 5, activo: true }), { ok: false });
  });
});

describe("porcentaje: solo 1 % o 2 %", () => {
  test("acepta exactamente 1 % y 2 % en las formas razonables de escribirlos", () => {
    for (const v of [0.01, "0.01", "0,01", 0.02, "0.02", "0,02", 2, "2"]) assert.ok(PCT_REFERIDO.includes(pctValido(v) as never), String(v));
    assert.equal(pctValido(0.01), 0.01); assert.equal(pctValido("0,02"), 0.02); assert.equal(pctValido(2), 0.02);
  });
  test("rechaza todo lo demás (1,5 %, 3 %, 100 %, negativos, texto, NaN, vacío)", () => {
    for (const v of [0.015, "1,5", 1.5, 0.03, 3, 1, "1", 0, -0.01, -2, "abc", "", "2 %", NaN, Infinity, null, undefined, {}, [], true]) assert.equal(pctValido(v), null, String(v));
  });
  test("se muestra como porcentaje legible", () => { assert.equal(formatPct(0.01), "1 %"); assert.equal(formatPct("0.0200"), "2 %"); });
});

describe("código de referido", () => {
  test("se normaliza a mayúsculas y exige 4 a 20 caracteres de letras, números y guiones", () => {
    assert.equal(normalizarCodigo(" odair-2 "), "ODAIR-2"); assert.equal(normalizarCodigo("AB12"), "AB12"); assert.equal(normalizarCodigo("A".repeat(20)), "A".repeat(20));
    for (const v of ["abc", "A".repeat(21), "-ABCD", "AB CD", "AB_CD", "ÁBCD1", "AB;DROP", "", "   ", null, undefined, 12345, {}]) assert.equal(normalizarCodigo(v), null, String(v));
  });
});

describe("textos", () => {
  test("cada estado de elegibilidad tiene texto y ayuda; el pendiente explica la regla del 100 %", () => {
    for (const k of ["pendiente_pago", "elegible", "cancelado", "sin_base", "sin_evidencia_base", "base_ambigua"] as const) { assert.ok(esEstadoReferido(k)); assert.ok(ETIQUETA_ESTADO[k].texto.length > 3 && ETIQUETA_ESTADO[k].ayuda.length > 10, k); }
    assert.match(ETIQUETA_ESTADO.pendiente_pago.ayuda, /100 % pagado/); assert.match(ETIQUETA_ESTADO.elegible.ayuda, /No se paga sola/); assert.match(ETIQUETA_ESTADO.sin_evidencia_base.ayuda, /No se adivina ni se muestra un cero/); assert.equal(esEstadoReferido("no_aplica_neto"), false, "el NETO ya no es un estado aparte");
    assert.equal(esEstadoReferido("inventado"), false); assert.equal(esEstadoReferido(undefined), false);
  });
  test("los errores de la base se traducen sin filtrar texto interno", () => {
    for (const c of ["F4701", "F4702", "F4703", "F4704", "F4705", "F4706", "F4707", "F4708", "F4709", "F4710"]) assert.match(mensajeErrorReferidos({ code: c, message: "detalle interno SECRETO" }), /\S/);
    assert.ok(!mensajeErrorReferidos({ code: "XX000", message: "relation public.referidores SECRETO" }).includes("SECRETO"));
    assert.equal(mensajeErrorReferidos(null), mensajeErrorReferidos({ code: "otro" }));
    assert.equal(mensajeErrorReferidos({ code: "F4707" }), "El código de referido no es válido.");
  });
});

describe("garantías de diseño (estáticas)", () => {
  const mig = sinComentarios(leer("supabase/migrations/20260601000341_referidos.sql"));
  test("la base solo admite 1 % o 2 % en códigos, asignaciones y fotos de contrato", () => {
    assert.equal((mig.match(/check \(pct in \(0\.01, 0\.02\)\)/g) ?? []).length, 3);
  });
  test("las tablas son solo service_role y las funciones públicas solo las ejecuta service_role", () => {
    assert.match(mig, /revoke all on table public\.%I from public, anon, authenticated/);
    const funciones = [...mig.matchAll(/^create function public\.(\w+)\(/gm)].map((m) => m[1]);
    assert.deepEqual([...funciones].sort(), ["referidor_codigo_definir", "referidor_guardar", "referido_aplicar_codigo", "referido_asignar", "referido_quitar", "referidos_catalogo", "referidos_contratos"].sort());
    for (const f of funciones) assert.ok(mig.includes(`'public.${f}(`), `grant/revoke de ${f}`);
    assert.match(mig, /revoke all on function %s from public, anon, authenticated/); assert.match(mig, /grant execute on function %s to service_role/);
  });
  test("la participación del referidor NO escribe comisiones del aliado, pagos, cuentas por pagar ni asientos, ni abre un canal externo", () => {
    assert.ok(!/(insert into|update|delete from)\s+public\.(aliados_b2b|comision_b2b_pagos|cuentas_por_pagar|cxp_pagos|asientos_contables|asiento_lineas|abonos)\b/i.test(mig));
    assert.ok(!/pg_net|net\.http|resend|whatsapp|webhook|smtp|mailto/i.test(mig));
    for (const f of ["lib/referidos/reglas.ts", "lib/referidos/servidor.ts", "app/(crm)/crm/referidos/actions.ts", "app/(crm)/crm/referidos/ReferidosClient.tsx", "app/(crm)/crm/referidos/page.tsx"]) {
      assert.ok(!/aliados_b2b|comision_b2b_pagos|cuentas_por_pagar|cxp_pagos|asientos|fetch\(|mailto|wa\.me/i.test(sinComentarios(leer(f))), f);
    }
  });
  test("la elegibilidad se DERIVA del criterio existente del 100 % pagado (no se guarda ni se duplica la regla)", () => {
    assert.match(mig, /public\.contratos_pagados_completos\(/);
    assert.ok(!/create table[^;]*\b(pagado|elegible|pagada)\b/i.test(mig), "no hay columna de estado de pago que pueda quedar vieja");
  });
  test("la atribución nunca bloquea el contrato, usa lo vigente al crearse y no se hace por nombre", () => {
    assert.match(mig, /exception when others then[\s\S]*raise warning/);
    assert.match(mig, /vigente_desde <= p_creado/);
    assert.ok(!/(lower|ilike)\s*\([^)]*(nombre|asesor|freelance_nombre|agencia_nombre)/i.test(mig), "sin cruce por nombre");
  });
  test("el navegador no puede mandar la tarifa ni la identidad por la ruta del código", () => {
    const acc = leer("app/(crm)/crm/referidos/actions.ts");
    assert.match(acc, /export async function aplicarCodigoAction\(raw: \{ aliadoId: number; codigo: string \}\)/);
    assert.ok(!/aplicarCodigoReferido\([^)]*pct/.test(acc));
    const srv = leer("lib/referidos/servidor.ts");
    assert.match(srv, /aplicarCodigoReferido = \(actorId: string, aliadoId: number, codigo: string\)/);
    // El actor SIEMPRE sale de la sesión: ninguna acción exportada lo recibe del navegador.
    for (const m of acc.matchAll(/export async function (\w+)\(raw: \{([^}]*)\}/g)) assert.ok(!/actor/i.test(m[2]), `${m[1]} no recibe actor del navegador`);
    // La aprobación decide el candidato DESPUÉS de aprobar; porcentaje e identidad solo son lo que se VIO (la base los compara con la regla guardada).
    const apr = leer("app/(dashboard)/dashboard/usuarios/b2b/actions.ts");
    assert.ok(apr.indexOf('rpc("aprobar_solicitud_b2b"') < apr.indexOf("decidirCandidatoReferido("));
    assert.ok(!/aplicarCodigoReferido/.test(apr));
  });
  test("la pantalla solo ofrece 1 % y 2 % (selector derivado de PCT_REFERIDO, sin campo numérico)", () => {
    const ui = leer("app/(crm)/crm/referidos/ReferidosClient.tsx");
    assert.match(ui, /PCT_REFERIDO\.map/); assert.ok(!/type="number"|type='number'/.test(ui));
  });
});

describe("código escrito en el registro público: candidato, decisión y quién decide (migración 342)", () => {
  test("decisionValida: solo confirmar/otro con referidor entero > 0 y 1 %/2 %, o descartar; todo lo demás es null", () => {
    assert.deepEqual(decisionValida({ decision: "descartar" }), { decision: "descartar" });
    assert.deepEqual(decisionValida({ decision: "confirmar_codigo", referidorId: 3, pct: 0.01 }), { decision: "confirmar_codigo", referidorId: 3, pct: 0.01 });
    assert.deepEqual(decisionValida({ decision: "asignar_otro", referidorId: 3, pct: "2" }), { decision: "asignar_otro", referidorId: 3, pct: 0.02 });
    for (const mala of [null, undefined, "x", 7, {}, { decision: "confirmar_codigo" }, { decision: "confirmar_codigo", referidorId: 0, pct: 0.01 }, { decision: "confirmar_codigo", referidorId: 1.5, pct: 0.01 },
      { decision: "confirmar_codigo", referidorId: 3, pct: 0.03 }, { decision: "asignar_otro", referidorId: "3", pct: 0.01 }, { decision: "borrar", referidorId: 3, pct: 0.01 }]) {
      assert.equal(decisionValida(mala), null, JSON.stringify(mala));
    }
  });

  test("el registro público envía el código solo como texto normalizado: ni referidor ni porcentaje, y el formato inválido se avisa antes de crear la cuenta", () => {
    const a = leer("app/portal/registro/actions.ts");
    assert.match(a, /codigo_referido: normalizarCodigoReferido\(d\.codigoReferido\) \?\? ""/);
    assert.ok(!/referidor|pct_referido|porcentaje/i.test(sinComentarios(a)), "el registro no maneja identidad ni tarifa del referidor");
    assert.match(a, /normalizarCodigoReferido\(input\.codigoReferido\)\) return \{ ok: false, error: "El código de referido usa de 4 a 20/);
    const form = leer("app/portal/registro/RegistroForm.tsx");
    assert.match(form, /reg-codigo-referido/); assert.match(form, /Código de referido \(opcional\)/);
  });

  test("la aprobación B2B: administración no decide el referido (se rechaza ANTES de aprobar) y ya no existe el camino de «aplicar código al aprobar»", () => {
    const b = sinComentarios(leer("app/(dashboard)/dashboard/usuarios/b2b/actions.ts"));
    assert.ok(!/aplicarCodigoReferido|codigoReferido/.test(b), "ya no se aplica un código de texto libre al aprobar");
    assert.match(b, /if \(!actor\?\.acceso\.gestiona\) return \{ ok: false, error: "Solo superadmin o gerencia pueden confirmar el referido\./);
    assert.ok(b.indexOf("actor?.acceso.gestiona") < b.indexOf('sb.rpc("aprobar_solicitud_b2b"'), "el rechazo ocurre antes de aprobar");
    const sql = sinComentarios(leer("supabase/migrations/20260601000341_referidos.sql"));
    assert.match(sql, /referido_aplicar_codigo[\s\S]{0,260}f341_priv\.actor\(p_actor, array\['superadmin', 'gerencia'\]\)/, "la base tampoco deja aplicar códigos a administración");
  });

  test("la migración 342 no abre canales nuevos: solo service_role, y la decisión exige superadmin/gerencia", () => {
    const sql = sinComentarios(leer("supabase/migrations/20260601000342_registro_b2b_codigo_referido.sql"));
    assert.match(sql, /referido_decidir_solicitud[\s\S]{0,400}f341_priv\.actor\(p_actor, array\['superadmin', 'gerencia'\]\)/);
    for (const f of ["registro_b2b_completar(uuid, jsonb)", "referido_decidir_solicitud(uuid, bigint, text, bigint, numeric)", "referidos_candidatos(uuid)"]) {
      assert.ok(sql.includes(`revoke all on function public.${f} from public, anon, authenticated;`) && sql.includes(`grant execute on function public.${f} to service_role;`), f);
    }
    assert.ok(!/pg_net|http_|resend|whatsapp|webhook|smtp/i.test(sql));
  });

  test("el borrador de «Olvidé mi contraseña» NO guarda el código de referido: ya está en el servidor desde el paso 1 y la reanudación lo conserva", () => {
    assert.ok(!leer("lib/auth/borradorRegistroB2B.ts").includes("codigoReferido"));
  });

  test("mensajes de los errores nuevos de la base", () => {
    assert.match(mensajeErrorReferidos({ code: "F4711" }), /aprobado y enlazado a una ficha de aliado/);
    assert.match(mensajeErrorReferidos({ code: "F4712" }), /regla del código cambió/);
    assert.match(mensajeErrorReferidos({ code: "F4713" }), /no existe o no trae un código/);
  });
});

describe("la base del referido es la base GUARDADA de la comisión del aliado (decisión del dueño, 2026-11-25)", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const sql341 = norm(sinComentarios(leer("supabase/migrations/20260601000341_referidos.sql")));

  test("f341_priv.base_aliado es el espejo LITERAL de la base de comision_b2b_total (205): misma expresión, mismos casos explícito/legado", () => {
    const m205 = norm(sinComentarios(leer("supabase/migrations/20260601000205_comisiones_b2b_integridad.sql")));
    const base205 = /case when a\.base_explicita then coalesce\(a\.base_comision, coalesce\(a\.precio_venta, 0\)\) else coalesce\(nullif\(a\.base_comision, 0\), coalesce\(a\.precio_venta, 0\)\) end/.exec(m205)?.[0];
    assert.ok(base205, "la expresión de la 205 existe");
    assert.ok(sql341.includes(`select ${base205}`), "341 usa la MISMA expresión, no una reescrita");
  });

  test("el listado NO recalcula la base desde lo cobrado ni desde el monto de la comisión: no usa precio_venta − impuesto de ventas ni comision_b2b", () => {
    const fn = sql341.slice(sql341.indexOf("create function public.referidos_contratos"), sql341.indexOf("create function public.referidos_catalogo"));
    assert.ok(fn.length > 500);
    assert.ok(!/precio_venta\s*-\s*coalesce\(v\.impuesto/.test(fn) && !/v\.precio_venta/.test(fn.replace(/coalesce\(v\.moneda/g, "")), "no se calcula PVP − impuesto de ventas");
    assert.ok(!/comision_b2b\b/.test(fn.replace(/comision_b2b_descontada/g, "")), "no se usa el monto de la comisión del aliado (ventas.comision_b2b)");
    assert.match(fn, /base_ali/); assert.match(fn, /f341_priv\.base_aliado\(x\)/);
  });

  test("sin evidencia el monto es NULL, no un cero calculado: solo base guardada 0 o contrato cancelado dan 0", () => {
    const fn = sql341.slice(sql341.indexOf("create function public.referidos_contratos"), sql341.indexOf("create function public.referidos_catalogo"));
    assert.match(fn, /when f\.est in \('sin_base', 'cancelado'\) then 0::numeric else null end/);
    assert.match(fn, /when ev\.n = 0 then 'sin_evidencia_base'/); assert.match(fn, /when ev\.nb > 1 then 'base_ambigua'/);
    assert.ok(!/no_aplica_neto/.test(fn));
    assert.match(fn, /and x\.aliado_id = b\.aliado_id/); assert.ok(!/x\.aliado_id is null/i.test(fn), "una comisión sin aliado_id no es evidencia (C76-1)");
  });

  test("elegible sigue siendo el MISMO criterio 100 % pagado (307), en ordinario y NETO; nada se paga solo", () => {
    const fn = sql341.slice(sql341.indexOf("create function public.referidos_contratos"), sql341.indexOf("create function public.referidos_catalogo"));
    assert.match(fn, /contratos_pagados_completos/); assert.match(fn, /when pag\.n is not null then 'elegible'/);
    assert.ok(!/insert into|update public|pg_net|http_/i.test(fn), "la lectura no escribe ni dispara pagos");
  });
});
