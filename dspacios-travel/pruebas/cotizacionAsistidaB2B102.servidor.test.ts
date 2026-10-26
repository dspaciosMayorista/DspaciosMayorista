// #102 — Resolución EN SERVIDOR de quién asiste y para quién (lib/cotizacion/asistidaB2BServidor.ts), con un cliente Supabase de sesión FALSO.
// La ejecución real contra la base (RLS incluida) está en pruebas/cotizacionAsistidaB2B102.pg.ts; aquí se cubren, sin base, las ramas de error:
// sin sesión, perfil ilegible, rol/tenant sin permiso, aliado inexistente/inactivo, porcentaje general ilegible y migración 238 sin aplicar.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  resolverActorAsistencia, resolverAliadoAsistencia, prepararAsistenciaB2B, listarAliadosParaAsistencia, verificarAliadoVivoParaConversion,
} from "../lib/cotizacion/asistidaB2BServidor.ts";
import { construirPlanB2B, MENSAJE_TERMINOS_CAMBIARON, MENSAJE_SIN_PERMISO_B2B } from "../lib/cotizacion/asistidaB2B.ts";

type Fila = Record<string, unknown>;
type Opciones = {
  user?: { id: string; email?: string } | null;
  perfil?: Fila | null;
  perfilError?: boolean;
  aliados?: Fila[];
  aliadosError?: { code?: string; message?: string };
  parametros?: Record<string, unknown>;
  parametrosError?: boolean;
};

/** Cliente de sesión falso: registra qué tablas se consultaron para poder afirmar lo que NO se leyó. */
function sbFalso(o: Opciones) {
  const consultas: string[] = [];
  const resolver = (tabla: string, filtros: Record<string, unknown>): { data: unknown; error: unknown } => {
    consultas.push(tabla);
    if (tabla === "usuarios") return o.perfilError ? { data: null, error: { code: "XX000", message: "caída" } } : { data: o.perfil ?? null, error: null };
    if (tabla === "aliados") {
      if (o.aliadosError) return { data: null, error: o.aliadosError };
      const todas = o.aliados ?? [];
      if (filtros.id !== undefined) return { data: todas.find((a) => a.id === filtros.id) ?? null, error: null };
      return { data: todas.filter((a) => a.activo === true && ["agencia", "freelance"].includes(String(a.tipo))), error: null };
    }
    if (tabla === "parametros_tributarios") {
      if (o.parametrosError) return { data: null, error: { code: "XX000", message: "caída" } };
      const p = o.parametros ?? {};
      if (filtros.parametro !== undefined) return { data: filtros.parametro as string in p ? { valor: p[filtros.parametro as string] } : null, error: null };
      return { data: Object.entries(p).map(([parametro, valor]) => ({ parametro, valor })), error: null };
    }
    return { data: null, error: { message: `tabla inesperada ${tabla}` } };
  };
  const from = (tabla: string) => {
    const filtros: Record<string, unknown> = {};
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
      in: () => q,
      order: () => q,
      maybeSingle: async () => resolver(tabla, filtros),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver(tabla, filtros)).then(ok, ko),
    };
    return q;
  };
  const sb = {
    auth: { getUser: async () => ({ data: { user: o.user === undefined ? { id: "u1", email: "auth@x.test" } : o.user }, error: null }) },
    from,
  };
  return { sb: sb as never, consultas };
}

const PERFIL_VENTA = { rol: "venta", activo: true, tenant: "mayorista", email: "venta@x.test" };
const ALIADO = { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pct_comision: 0.1, activo: true };

describe("resolverActorAsistencia", () => {
  test("sin sesión, o con un perfil que no se pudo leer, se niega con el mensaje de sesión (nunca un detalle técnico)", async () => {
    for (const o of [{ user: null }, { perfilError: true }] as Opciones[]) {
      const { sb } = sbFalso({ perfil: PERFIL_VENTA, ...o });
      assert.deepEqual(await resolverActorAsistencia(sb), { ok: false, error: "Tu sesión no es válida. Vuelve a iniciar sesión." });
    }
  });

  test("rol de la lista, activo y de Mayorista: pasa, con el correo del perfil", async () => {
    const { sb } = sbFalso({ perfil: PERFIL_VENTA });
    assert.deepEqual(await resolverActorAsistencia(sb), { ok: true, actor: { id: "u1", email: "venta@x.test", rol: "venta", superadmin: false } });
  });

  test("control_vuelo, un aliado logueado y un perfil inexistente se niegan; personal de Minorista no asiste ventas de Mayorista", async () => {
    for (const rol of ["control_vuelo", "agencia", "freelance", "cliente_final"]) {
      const { sb } = sbFalso({ perfil: { ...PERFIL_VENTA, rol } });
      assert.deepEqual(await resolverActorAsistencia(sb), { ok: false, error: MENSAJE_SIN_PERMISO_B2B }, rol);
    }
    assert.equal((await resolverActorAsistencia(sbFalso({ perfil: null }).sb)).ok, false);
    assert.equal((await resolverActorAsistencia(sbFalso({ perfil: { ...PERFIL_VENTA, tenant: "minorista" } }).sb)).ok, false);
    assert.equal((await resolverActorAsistencia(sbFalso({ perfil: { ...PERFIL_VENTA, activo: false } }).sb)).ok, false);
    assert.equal((await resolverActorAsistencia(sbFalso({ perfil: { ...PERFIL_VENTA, rol: "superadmin", tenant: "minorista" } }).sb)).ok, true);
  });
});

describe("resolverAliadoAsistencia", () => {
  test("con porcentaje propio no se consulta el parámetro general", async () => {
    const { sb, consultas } = sbFalso({ aliados: [ALIADO] });
    const r = await resolverAliadoAsistencia(sb, 7);
    assert.deepEqual(r, { ok: true, aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: 0.1, pct: 0.1, pctOrigen: "aliado" } });
    assert.deepEqual(consultas, ["aliados"]);
  });

  test("sin porcentaje propio usa el parámetro general del TIPO; si el parámetro no se puede leer, no se adivina", async () => {
    const freelance = { ...ALIADO, id: 8, tipo: "freelance", pct_comision: null };
    const ok = await resolverAliadoAsistencia(sbFalso({ aliados: [freelance], parametros: { COMISION_FREELANCE: 0.09, COMISION_AGENCIA: 0.5 } }).sb, 8);
    assert.deepEqual(ok.ok && { pct: ok.aliado.pct, origen: ok.aliado.pctOrigen }, { pct: 0.09, origen: "general" });
    const sinParametro = await resolverAliadoAsistencia(sbFalso({ aliados: [freelance], parametros: {} }).sb, 8);
    assert.deepEqual(sinParametro.ok && { pct: sinParametro.aliado.pct, origen: sinParametro.aliado.pctOrigen }, { pct: 0.11, origen: "defecto" });
    const caida = await resolverAliadoAsistencia(sbFalso({ aliados: [freelance], parametrosError: true }).sb, 8);
    assert.equal(caida.ok, false);
    assert.match(caida.ok ? "" : caida.error, /porcentaje de comisión general/);
  });

  test("0 explícito del aliado no cae al parámetro", async () => {
    const r = await resolverAliadoAsistencia(sbFalso({ aliados: [{ ...ALIADO, pct_comision: 0 }], parametros: { COMISION_AGENCIA: 0.12 } }).sb, 7);
    assert.deepEqual(r.ok && { pct: r.aliado.pct, origen: r.aliado.pctOrigen }, { pct: 0, origen: "aliado" });
  });

  test("inexistente, inactivo o de otro tipo: se rechaza con su motivo", async () => {
    const casos: [Fila | null, RegExp][] = [
      [null, /no existe/], [{ ...ALIADO, activo: false }, /inactivo/], [{ ...ALIADO, tipo: "otro" }, /no es una agencia ni un freelance/],
    ];
    for (const [fila, esperado] of casos) {
      const r = await resolverAliadoAsistencia(sbFalso({ aliados: fila ? [fila] : [] }).sb, 7);
      assert.equal(r.ok, false);
      assert.match(r.ok ? "" : r.error, esperado);
    }
  });

  test("migración 238 sin aplicar (la columna activo no existe): mensaje explícito, no un fallo opaco", async () => {
    const r = await resolverAliadoAsistencia(sbFalso({ aliadosError: { code: "42703", message: "column aliados.activo does not exist" } }).sb, 7);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /migración 238/);
    const otra = await resolverAliadoAsistencia(sbFalso({ aliadosError: { code: "XX000", message: "detalle interno" } }).sb, 7);
    assert.equal(otra.ok, false);
    assert.doesNotMatch(otra.ok ? "" : otra.error, /detalle interno/, "el detalle técnico no llega al navegador");
  });
});

describe("prepararAsistenciaB2B", () => {
  test("si el actor no puede, ni siquiera se consulta el catálogo de aliados", async () => {
    const { sb, consultas } = sbFalso({ perfil: { ...PERFIL_VENTA, rol: "control_vuelo" }, aliados: [ALIADO] });
    const r = await prepararAsistenciaB2B(sb, { aliadoId: 7, modo: "neta" });
    assert.deepEqual(r, { ok: false, error: MENSAJE_SIN_PERMISO_B2B });
    assert.deepEqual(consultas, ["usuarios"]);
  });

  test("actor y aliado válidos: devuelve ambos y la modalidad elegida", async () => {
    const { sb } = sbFalso({ perfil: PERFIL_VENTA, aliados: [ALIADO] });
    const r = await prepararAsistenciaB2B(sb, { aliadoId: 7, modo: "neta" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.contexto.modo, "neta");
    assert.equal(r.contexto.actor.rol, "venta");
    assert.equal(r.contexto.aliado.id, 7);
  });
});

describe("listarAliadosParaAsistencia", () => {
  const aliados = [
    ALIADO, { id: 8, nombre: "Lucía", tipo: "freelance", pct_comision: null, activo: true }, { id: 9, nombre: "Inactiva", tipo: "agencia", pct_comision: 0.1, activo: false },
    { id: 10, nombre: "Rara", tipo: "otro", pct_comision: 0.1, activo: true },
  ];

  test("quien no puede asistir recibe `puede: false` y ninguna lista", async () => {
    for (const o of [{ user: null }, { perfil: { ...PERFIL_VENTA, rol: "agencia" } }, { perfil: null }] as Opciones[]) {
      assert.deepEqual(await listarAliadosParaAsistencia(sbFalso({ aliados, ...o }).sb), { ok: true, puede: false });
    }
  });

  test("el personal ve solo aliados activos de tipo agencia/freelance, con su % y su origen", async () => {
    const r = await listarAliadosParaAsistencia(sbFalso({ perfil: PERFIL_VENTA, aliados, parametros: { COMISION_FREELANCE: 0.11 } }).sb);
    assert.deepEqual(r, { ok: true, puede: true, aliados: [
      { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pct: 0.1, pctOrigen: "aliado" },
      { id: 8, nombre: "Lucía", tipo: "freelance", pct: 0.11, pctOrigen: "general" },
    ] });
  });

  test("si el catálogo no se puede leer, error explícito (no una lista vacía que parezca «sin aliados»)", async () => {
    const r = await listarAliadosParaAsistencia(sbFalso({ perfil: PERFIL_VENTA, aliadosError: { code: "XX000", message: "caída" } }).sb);
    assert.equal(r.ok, false);
  });
});

describe("verificarAliadoVivoParaConversion", () => {
  const plan = (pct: number) => {
    const r = construirPlanB2B({
      aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: pct }, pct, pctOrigen: "aliado", modo: "neta", moneda: "COP",
      lineas: [{ clave: "item-0", pvp: 1_000_000, impuesto: 200_000 }], actor: { id: "u1", email: null, rol: "venta" }, congeladoEn: "2030-01-01T00:00:00.000Z",
    });
    assert.ok(r.ok);
    return r.ok ? r.plan : (null as never);
  };

  test("mismo aliado, tipo y porcentaje: pasa", async () => {
    const r = await verificarAliadoVivoParaConversion(sbFalso({ aliados: [ALIADO] }).sb, plan(0.1));
    assert.ok(r.ok);
  });

  test("el porcentaje cambió (también a 0 o a vacío con otro general), el aliado se desactivó o cambió de tipo: se rechaza", async () => {
    const casos: [Fila, string][] = [
      [{ ...ALIADO, pct_comision: 0.12 }, MENSAJE_TERMINOS_CAMBIARON],
      [{ ...ALIADO, pct_comision: 0 }, MENSAJE_TERMINOS_CAMBIARON],
      [{ ...ALIADO, tipo: "freelance" }, MENSAJE_TERMINOS_CAMBIARON],
    ];
    for (const [fila, mensaje] of casos) {
      assert.deepEqual(await verificarAliadoVivoParaConversion(sbFalso({ aliados: [fila], parametros: { COMISION_FREELANCE: 0.11 } }).sb, plan(0.1)), { ok: false, error: mensaje }, JSON.stringify(fila));
    }
    const inactivo = await verificarAliadoVivoParaConversion(sbFalso({ aliados: [{ ...ALIADO, activo: false }] }).sb, plan(0.1));
    assert.equal(inactivo.ok, false);
    assert.match(inactivo.ok ? "" : inactivo.error, /inactivo/);
    const sinParametro = await verificarAliadoVivoParaConversion(sbFalso({ aliados: [{ ...ALIADO, pct_comision: null }], parametros: { COMISION_AGENCIA: 0.15 } }).sb, plan(0.1));
    assert.deepEqual(sinParametro, { ok: false, error: MENSAJE_TERMINOS_CAMBIARON });
  });
});
