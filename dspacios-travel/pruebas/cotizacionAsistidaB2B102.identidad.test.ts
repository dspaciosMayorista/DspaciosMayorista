// #102 (Preview #403) — Identidad comercial NETO, firmas, RNT y listado: reglas puras + cableado de servidor (sin base).
// La ejecución real contra la base (cotización → conversión de punta a punta) está en pruebas/cotizacionAsistidaB2B102.pg.ts (bloque I1-I6);
// el HTML de los documentos, en pruebas/cotizacionAsistidaB2B102.identidad.react.ts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  camposClienteVenta, camposVendedorAliado, fiscalDeFilaAliado, nombreQuienElabora, titularDeCliente, valorParaListado,
} from "../lib/cotizacion/identidadB2B.ts";
import { cargarAgenciaDeCotizacion } from "../lib/cotizacion/agenciaCotizacion.ts";
import { compararIdentidadAliadoConCongelada, compararTerminosVistos, leerAsistenciaB2BEntrada, MENSAJE_TERMINOS_VISTOS_CAMBIARON, construirPlanB2B, leerPlanB2BDePayload, MENSAJE_COTIZACION_B2B_INVALIDA, MENSAJE_IDENTIDAD_ALIADO_CAMBIO } from "../lib/cotizacion/asistidaB2B.ts";
import { resolverFirmasSesion } from "../lib/cotizacion/firmasSesion.ts";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const ALIADO = fiscalDeFilaAliado({ nombre: " Viajes Aurora ", nit: "900123456-7", tipo_documento: "NIT", telefono: "604", email: "a@x.test", direccion: "Calle 10" });
const TITULAR = titularDeCliente({ nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "300", email: "ana@x.test" });

describe("identidad fiscal del aliado y titular", () => {
  test("la identidad del aliado sale de la fila del catálogo, recortada; lo vacío queda null", () => {
    assert.deepEqual(ALIADO, { nombre: "Viajes Aurora", documento: "900123456-7", tipoDocumento: "NIT", telefono: "604", email: "a@x.test", direccion: "Calle 10" });
    assert.deepEqual(fiscalDeFilaAliado({ nombre: "X", nit: "  ", telefono: null }), { nombre: "X", documento: null, tipoDocumento: null, telefono: null, email: null, direccion: null });
    assert.equal(fiscalDeFilaAliado(null).nombre, "");
  });

  test("NETO: cliente = aliado (catálogo) y el titular queda aparte con todos sus datos", () => {
    const c = camposClienteVenta({ modo: "neta", fiscal: ALIADO, titular: TITULAR });
    assert.deepEqual(c, {
      cliente: "Viajes Aurora", cliente_documento: "900123456-7", cliente_telefono: "604", cliente_email: "a@x.test", cliente_direccion: "Calle 10",
      titular_nombre: "Ana Pérez", titular_documento: "123", titular_telefono: "300", titular_email: "ana@x.test",
    });
  });

  test("PVP con comisión, B2C y modalidad ausente: cliente = persona, sin titular aparte", () => {
    for (const modo of ["comisionable", null, undefined] as const) {
      const c = camposClienteVenta({ modo, fiscal: ALIADO, titular: TITULAR });
      assert.deepEqual([c.cliente, c.cliente_documento, c.cliente_telefono, c.cliente_email, c.cliente_direccion], ["Ana Pérez", "123", "300", "ana@x.test", null], String(modo));
      assert.deepEqual([c.titular_nombre, c.titular_documento, c.titular_telefono, c.titular_email], [null, null, null, null]);
    }
  });

  test("NETO sin identidad de aliado legible no inventa un cliente: cae a la persona", () => {
    assert.equal(camposClienteVenta({ modo: "neta", fiscal: fiscalDeFilaAliado({ nombre: "  " }), titular: TITULAR }).cliente, "Ana Pérez");
    assert.equal(camposClienteVenta({ modo: "neta", fiscal: null, titular: TITULAR }).titular_nombre, null);
  });

  test("el vendedor sale del aliado según su tipo; sin nombre no se inventa", () => {
    assert.deepEqual(camposVendedorAliado({ nombre: "Viajes Aurora", tipo: "agencia" }), { tipo_asesor: "agencia", agencia_nombre: "Viajes Aurora", freelance_nombre: null });
    assert.deepEqual(camposVendedorAliado({ nombre: "Lucía", tipo: "freelance" }), { tipo_asesor: "freelance", agencia_nombre: null, freelance_nombre: "Lucía" });
    assert.equal(camposVendedorAliado({ nombre: "  ", tipo: "agencia" }), null);
    assert.equal(camposVendedorAliado(null), null);
  });

  test("quien elabora: el asesor elegido; si no, el usuario autenticado; si ninguno, null", () => {
    assert.equal(nombreQuienElabora(" Marta ", "Pedro"), "Marta");
    assert.equal(nombreQuienElabora("", "Pedro"), "Pedro");
    assert.equal(nombreQuienElabora(null, "  "), null);
    assert.equal(nombreQuienElabora(undefined, undefined), null);
  });
});

describe("importe y etiqueta del listado", () => {
  test("NETO ⇒ total exigible; PVP con comisión ⇒ PVP; sin modalidad ⇒ precio guardado sin etiqueta", () => {
    assert.deepEqual(valorParaListado({ modo: "neta", precioVenta: 1_300_000, totalExigible: "1190000", moneda: "COP" }), { etiqueta: "NETO", valor: 1_190_000, moneda: "COP" });
    assert.deepEqual(valorParaListado({ modo: "comisionable", precioVenta: 1_300_000, totalExigible: 1_300_000, moneda: "USD" }), { etiqueta: "PVP", valor: 1_300_000, moneda: "USD" });
    for (const modo of [null, undefined, "", "x"]) assert.deepEqual(valorParaListado({ modo, precioVenta: 800_000, moneda: null }), { etiqueta: null, valor: 800_000, moneda: "COP" });
  });

  test("un NETO sin total exigible válido (≤ 0, NaN, texto, ausente) pide revisar el importe: sin valor y sin PVP", () => {
    for (const t of [0, -5, Number.NaN, "abc", null, undefined, ""]) {
      assert.deepEqual(valorParaListado({ modo: "neta", precioVenta: 800_000, totalExigible: t as never, moneda: "COP" }), { etiqueta: null, revisar: true, valor: null, moneda: "COP" }, String(t));
    }
  });

  test("una modalidad desconocida conserva el comportamiento histórico (precio guardado, sin etiqueta ni revisión)", () => {
    for (const modo of [null, undefined, "", "otra"]) {
      assert.deepEqual(valorParaListado({ modo, precioVenta: 800_000, totalExigible: Number.NaN, moneda: "COP" }), { etiqueta: null, valor: 800_000, moneda: "COP" }, String(modo));
    }
  });
});

describe("fila de agencias de la cotización", () => {
  type Resp = { data: unknown; error?: { message: string } | null } | "lanza";
  function lector(filas: Record<string, Resp>) {
    const consultas: string[] = [];
    const sb = { from: (t: string) => ({ select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: async () => {
      consultas.push(`${t}:${v}`);
      const r = filas[v] ?? { data: null, error: null };
      if (r === "lanza") throw new Error("red");
      return r;
    } }) }) }) };
    return { sb, consultas };
  }
  const fila = (rnt: string | null) => ({ data: { rnt }, error: null });

  test("dato válido: trae la fila del tenant de la cotización (Mayorista y Minorista tienen RNT distinto)", async () => {
    const { sb } = lector({ mayorista: fila("RNT-MAY"), minorista: fila("RNT-MIN") });
    const may = await cargarAgenciaDeCotizacion(sb, "mayorista"); const min = await cargarAgenciaDeCotizacion(sb, "minorista");
    assert.ok(may.ok && min.ok);
    assert.equal((may.ok && (may.agencia as unknown as { rnt: string }).rnt), "RNT-MAY");
    assert.equal((min.ok && (min.agencia as unknown as { rnt: string }).rnt), "RNT-MIN");
  });

  test("tenant ausente o desconocido: error, sin consultar nada", async () => {
    const { sb, consultas } = lector({ mayorista: fila("RNT-MAY") });
    for (const t of [null, undefined, "", "otro", "MAYORISTA"]) {
      const r = await cargarAgenciaDeCotizacion(sb, t as never);
      assert.deepEqual(r.ok === false && r.motivo, "tenant_invalido", String(t));
    }
    assert.deepEqual(consultas, []);
  });

  test("error técnico (respuesta con error o excepción): error en AMBOS tenants, distinto de «fila ausente»", async () => {
    for (const tenant of ["mayorista", "minorista"]) {
      for (const r of [{ data: null, error: { message: "caída" } }, "lanza"] as Resp[]) {
        const res = await cargarAgenciaDeCotizacion(lector({ [tenant]: r }).sb, tenant);
        assert.equal(res.ok === false && res.motivo, "error_tecnico", tenant);
        assert.match(res.ok === false ? res.mensaje : "", /RNT/);
      }
    }
  });

  test("fila ausente: Mayorista conserva su constante (ok con agencia null); Minorista NO se puede acreditar", async () => {
    assert.deepEqual(await cargarAgenciaDeCotizacion(lector({}).sb, "mayorista"), { ok: true, agencia: null });
    const min = await cargarAgenciaDeCotizacion(lector({}).sb, "minorista");
    assert.equal(min.ok === false && min.motivo, "ausente");
    assert.match(min.ok === false ? min.mensaje : "", /Minorista/);
  });

  test("fila de Minorista sin RNT (vacío o espacios) no acredita nada; la de Mayorista conserva el comportamiento histórico", async () => {
    for (const rnt of [null, "", "   "]) {
      const min = await cargarAgenciaDeCotizacion(lector({ minorista: fila(rnt) }).sb, "minorista");
      assert.equal(min.ok === false && min.motivo, "sin_rnt", String(rnt));
    }
    assert.equal((await cargarAgenciaDeCotizacion(lector({ mayorista: fila(null) }).sb, "mayorista")).ok, true);
  });
});

describe("firmas desde la sesión", () => {
  function sesion(o: { user?: { id: string } | null; perfil?: Record<string, unknown> | null; aliado?: Record<string, unknown> | null }) {
    const tablas: string[] = [];
    const from = (t: string) => {
      tablas.push(t);
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: t === "usuarios" ? (o.perfil ?? null) : (o.aliado ?? null) }) };
      return q;
    };
    return { sb: { auth: { getUser: async () => ({ data: { user: o.user === undefined ? { id: "u1" } : o.user } }) }, from } as never, tablas };
  }

  test("un usuario interno activo firma con su nombre (también control_vuelo)", async () => {
    for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta", "control_vuelo"]) {
      const { sb } = sesion({ perfil: { rol, activo: true, nombre: " Marta Ruiz " } });
      assert.deepEqual(await resolverFirmasSesion(sb), { elabora: "Marta Ruiz", aliado: null }, rol);
    }
  });

  test("sin sesión, usuario inactivo, rol externo sin aliado o sin nombre: no se firma (nunca se inventa)", async () => {
    for (const o of [{ user: null }, { perfil: null }, { perfil: { rol: "venta", activo: false, nombre: "X" } }, { perfil: { rol: "venta", activo: true, nombre: "  " } },
      { perfil: { rol: "cliente_final", activo: true, nombre: "Y" } }, { perfil: { rol: "agencia", activo: true, nombre: "Z", aliado_id: null } }]) {
      assert.deepEqual(await resolverFirmasSesion(sesion(o).sb), { elabora: null, aliado: null }, JSON.stringify(o));
    }
  });

  test("un aliado B2B logueado vende a nombre de SU aliado del catálogo (no firma como asesor interno)", async () => {
    const { sb } = sesion({ perfil: { rol: "agencia", activo: true, nombre: "Usuario", aliado_id: 7 }, aliado: { nombre: "Viajes Aurora", tipo: "agencia" } });
    assert.deepEqual(await resolverFirmasSesion(sb), { elabora: null, aliado: { nombre: "Viajes Aurora", tipo: "agencia" } });
  });
});

describe("cableado: rutas de la cotización, listado, checkout y conversión", () => {
  test("la cotización imprimible carga la agencia del tenant de la cotización y la pasa a los dos documentos", () => {
    const f = leer("app/cotizacion/[id]/page.tsx");
    assert.match(f, /cargarAgenciaDeCotizacion\(sb, cot\.tenant\)/);
    assert.equal((f.match(/agencia=\{agencia\}/g) ?? []).length, 2, "documento del tarifario y cotización manual");
  });

  test("el enlace público carga la agencia con el tenant de la fila hallada por el token (service-role, sin sesión) y la pasa al documento", () => {
    const f = leer("app/cot/[token]/page.tsx");
    assert.match(f, /\.select\("codigo, detalle, vigencia_hasta, tenant"\)\s*\.eq\("share_token", token\)/, "se busca solo por share_token y se lee el tenant");
    assert.match(f, /cargarAgenciaDeCotizacion\(sb, cot\.tenant\)/);
    assert.match(f, /const sb = createAdminClient\(\)/);
    assert.match(f, /agencia=\{agencia\}/);
    assert.doesNotMatch(f, /params\.tenant|searchParams/, "el tenant nunca viene de la URL");
  });

  test("el listado muestra NETO/PVP con el componente compartido y lee solo los dos campos del plan (no el payload entero)", () => {
    const f = leer("app/(dashboard)/dashboard/cotizaciones/page.tsx");
    assert.match(f, /ValorCotizacion/);
    assert.match(f, /payload->b2bAsistido->>modo_compra/);
    assert.match(f, /payload->b2bAsistido->>total_exigible/);
    assert.match(f, /<ValorCotizacion desde=/, "la comparativa conserva «desde»");
  });

  test("el checkout toma cliente/identidad del catálogo y la firma del usuario autenticado; nada del navegador", () => {
    const f = leer("app/tarifario/checkout/actions.ts");
    assert.match(f, /camposClienteVenta\(\{ modo: planB2B\?\.modo_compra \?\? null, fiscal: opts\?\.b2b\?\.aliado\.fiscal \?\? null, titular: titularDeCliente\(input\.cliente\) \}\)/);
    assert.match(f, /resolverFirmasSesion\(sb, adminLookup\)/);
    assert.match(f, /cliente: campos\.cliente,\s*cliente_documento: campos\.cliente_documento,/, "la fila de la lista lleva el cliente comercial");
    assert.match(f, /asesor: elabora,/);
    assert.doesNotMatch(f, /input\.(aliado|nit|asistencia)\w*\.(nit|nombre|documento)/, "ninguna identidad fiscal sale del cuerpo de la petición");
  });

  test("la conversión usa la identidad VIVA del catálogo (no el snapshot) y firma con el usuario si no se eligió asesor", () => {
    const f = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(f, /fiscalAliadoVivo = aliadoVivo\.aliado\.fiscal/);
    assert.match(f, /camposClienteVenta\(\{ modo: planB2BCot\?\.modo_compra \?\? null, fiscal: fiscalAliadoVivo, titular: titularDeCliente\(cliente\) \}\)/);
    assert.match(f, /nombreQuienElabora\(opts\.asesorInterno, \(await resolverFirmasSesion\(sb\)\)\.elabora\)/);
    assert.match(f, /asesor_firma_nombre: oNull\(firmaConversion\)/);
  });

  test("el selector del checkout y las fichas rotulan al titular; el contrato lo prellena como primer pasajero", () => {
    assert.match(leer("app/tarifario/checkout/page.tsx"), /"Titular de la reserva"/);
    assert.match(leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx"), /Titular de la reserva/);
    const c = leer("app/(dashboard)/dashboard/contratos/[numero]/page.tsx");
    assert.match(c, /Titular de la reserva/);
    assert.match(c, /titularNombre=\{venta\.titular_nombre \?\? venta\.cliente \?\? ""\}/);
  });

  test("la migración 239 es solo aditiva (columnas + vista), con preflight/postcheck/rollback", () => {
    const m = leer("supabase/migrations/20260601000239_titular_reserva_neto.sql");
    assert.match(m, /add column if not exists titular_nombre text/);
    assert.match(m, /create or replace view public\.ventas_basica/);
    assert.doesNotMatch(m, /create policy|drop policy|create trigger|create function|create or replace function|alter table [^;]* drop |delete from|update public\./i);
    for (const s of ["preflight", "postcheck", "rollback"]) assert.ok(leer(`supabase/scripts/${s}_239_titular_reserva.sql`).length > 100, s);
  });

  test("la 238 ya aplicada no se editó para esto: la 239 no depende de nada que la 238 cambie", () => {
    const m = leer("supabase/migrations/20260601000239_titular_reserva_neto.sql");
    assert.doesNotMatch(m, /cotizacion_origen_id|grupo_conversion|tg_cot_b2b_asistido_inmutable/);
  });
});

describe("identidad fiscal del aliado congelada en el plan (NETO)", () => {
  const armar = (modo: "neta" | "comisionable", identidad?: { documento: string | null; tipoDocumento: string | null }) => {
    const r = construirPlanB2B({
      aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo, moneda: "COP",
      lineas: [{ clave: "item-0", pvp: 1_000_000, impuesto: 200_000 }], identidad,
      actor: { id: "u1", email: null, rol: "venta" }, congeladoEn: "2030-01-01T00:00:00.000Z",
    });
    assert.ok(r.ok);
    return r.ok ? r.plan : (null as never);
  };
  const vivo = { nombre: "Viajes Aurora", documento: "900123456-7", tipoDocumento: "NIT" };
  const plan = armar("neta", { documento: "900123456-7", tipoDocumento: "NIT" });

  test("el plan congela nombre, documento y tipo, y sobrevive a la relectura del payload", () => {
    assert.deepEqual([plan.aliado_nombre, plan.aliado_documento, plan.aliado_tipo_documento], ["Viajes Aurora", "900123456-7", "NIT"]);
    const leido = leerPlanB2BDePayload({ b2bAsistido: JSON.parse(JSON.stringify(plan)) });
    assert.ok(leido.ok && leido.plan);
    assert.deepEqual(leido.ok && [leido.plan!.aliado_documento, leido.plan!.aliado_tipo_documento], ["900123456-7", "NIT"]);
  });

  test("idéntica ⇒ ok (con espacios sobrantes); cambió nombre, documento o tipo ⇒ rechazo con el mensaje de identidad", () => {
    assert.deepEqual(compararIdentidadAliadoConCongelada(plan, { ...vivo, nombre: " Viajes Aurora " }), { ok: true });
    for (const cambio of [{ nombre: "Otro" }, { documento: "1" }, { documento: null }, { tipoDocumento: "CC" }, { tipoDocumento: null }]) {
      assert.deepEqual(compararIdentidadAliadoConCongelada(plan, { ...vivo, ...cambio }), { ok: false, error: MENSAJE_IDENTIDAD_ALIADO_CAMBIO }, JSON.stringify(cambio));
    }
  });

  test("sin documento al cotizar: null contra null pasa; null contra un documento nuevo se rechaza", () => {
    const sinDoc = armar("neta", { documento: null, tipoDocumento: null });
    assert.deepEqual(compararIdentidadAliadoConCongelada(sinDoc, { nombre: "Viajes Aurora", documento: null, tipoDocumento: null }), { ok: true });
    assert.equal(compararIdentidadAliadoConCongelada(sinDoc, { nombre: "Viajes Aurora", documento: "9", tipoDocumento: null }).ok, false);
  });

  test("un plan NETO de formato anterior (sin identidad congelada) no se puede acreditar: plan inválido", () => {
    const { aliado_documento: _d, aliado_tipo_documento: _t, ...viejo } = JSON.parse(JSON.stringify(plan));
    const leido = leerPlanB2BDePayload({ b2bAsistido: viejo });
    assert.ok(leido.ok && leido.plan && leido.plan.aliado_documento === undefined);
    assert.deepEqual(compararIdentidadAliadoConCongelada(leido.plan!, vivo), { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA });
  });

  test("PVP con comisión no se evalúa (el cliente es la persona): nada cambia en sus reglas", () => {
    const pvp = armar("comisionable", { documento: "900123456-7", tipoDocumento: "NIT" });
    assert.deepEqual(compararIdentidadAliadoConCongelada(pvp, { nombre: "Otro", documento: "0", tipoDocumento: "CC" }), { ok: true });
  });
});

describe("cableado: identidad fiscal y RNT fallan antes de numerar / de imprimir", () => {
  test("la verificación del aliado vivo (antes de numerar) compara la identidad; el checkout congela la del catálogo", () => {
    const sv = leer("lib/cotizacion/asistidaB2BServidor.ts");
    assert.match(sv, /compararIdentidadAliadoConCongelada\(plan, \{ nombre: al\.aliado\.fiscal\.nombre, documento: al\.aliado\.fiscal\.documento, tipoDocumento: al\.aliado\.fiscal\.tipoDocumento \}\)/);
    const co = leer("app/tarifario/checkout/actions.ts");
    assert.match(co, /identidad: \{ documento: opts\.b2b\.aliado\.fiscal\.documento, tipoDocumento: opts\.b2b\.aliado\.fiscal\.tipoDocumento \}/);
    const ac = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.ok(ac.indexOf("verificarAliadoVivoParaConversion(sb, planB2BCot)") < ac.indexOf("siguienteNumeroContrato(tenantCotizacion)"), "se verifica antes de reservar número");
  });

  test("las dos rutas de la cotización lanzan un error explícito si no se acredita la agencia (no caen a la constante)", () => {
    for (const rel of ["app/cotizacion/[id]/page.tsx", "app/cot/[token]/page.tsx"]) {
      const f = leer(rel);
      assert.match(f, /if \(!agenciaRes\.ok\) throw new Error\(agenciaRes\.mensaje\)/, rel);
      assert.match(f, /const agencia = agenciaRes\.agencia;/, rel);
    }
  });
});

describe("términos vistos en la vista previa vs. los que liquida el servidor al generar", () => {
  const plan = (() => {
    const r = construirPlanB2B({
      aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: 0.11 }, pct: 0.11, pctOrigen: "aliado", modo: "neta", moneda: "USD",
      lineas: [{ clave: "item-0", pvp: 1930, impuesto: 830 }], actor: { id: "u1", email: null, rol: "venta" }, congeladoEn: "2030-01-01T00:00:00.000Z",
    });
    assert.ok(r.ok);
    return r.ok ? r.plan : (null as never);
  })();
  const vistos = { modo_compra: plan.modo_compra, moneda: plan.moneda, pvp: plan.pvp, impuesto: plan.impuesto, base: plan.base, pct: plan.pct, pct_origen: plan.pct_origen, comision: plan.comision, total_exigible: plan.total_exigible };

  test("sin cambios (caso de la captura: 1.930 / 830 / 1.100 / 11 % = 121 / NETO 1.809) ⇒ ok", () => {
    assert.deepEqual([plan.pvp, plan.impuesto, plan.base, plan.comision, plan.total_exigible], [1930, 830, 1100, 121, 1809]);
    assert.deepEqual(compararTerminosVistos(vistos, plan), { ok: true });
    assert.deepEqual(compararTerminosVistos({ ...vistos, pvp: vistos.pvp + 0.004 }, plan), { ok: true }, "ruido de redondeo bajo medio centavo");
  });

  test("cambió PVP, impuesto, base, porcentaje, origen, comisión, total, moneda o modalidad ⇒ rechazo con el mensaje de términos cambiados", () => {
    const cambios: Record<string, unknown>[] = [
      { pvp: 2000 }, { impuesto: 900 }, { base: 1000 }, { pct: 0.12 }, { pct_origen: "general" }, { comision: 120 }, { total_exigible: 1810 }, { moneda: "COP" }, { modo_compra: "comisionable" },
    ];
    for (const c of cambios) assert.deepEqual(compararTerminosVistos({ ...vistos, ...c } as never, plan), { ok: false, error: MENSAJE_TERMINOS_VISTOS_CAMBIARON }, JSON.stringify(c));
  });

  test("la entrada lee `vistos` si llega bien formado; uno ilegible se rechaza (no se ignora); sin `vistos` sigue igual que antes", () => {
    const base = { canal: "b2b", aliadoId: 7, modo: "neta" };
    assert.deepEqual(leerAsistenciaB2BEntrada({ asistencia: base }), { ok: true, asistencia: { aliadoId: 7, modo: "neta" } });
    const bien = leerAsistenciaB2BEntrada({ asistencia: { ...base, vistos } });
    assert.ok(bien.ok && bien.asistencia?.vistos?.total_exigible === 1809);
    for (const malo of [{}, { ...vistos, pvp: "1930" }, { ...vistos, pct: Number.NaN }, { ...vistos, modo_compra: "x" }, { ...vistos, pct_origen: "y" }, { ...vistos, moneda: "" }, "texto", []]) {
      const r = leerAsistenciaB2BEntrada({ asistencia: { ...base, vistos: malo } });
      assert.equal(r.ok, false, JSON.stringify(malo));
    }
  });
});
