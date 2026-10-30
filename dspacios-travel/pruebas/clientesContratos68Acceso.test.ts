// #68 (migración 221) — «Clientes de contratos» del CRM: lo que decide el helper del lado de la aplicación.
// La AUTORIDAD (rol, tenant, venta solo propios, guarda de homónimos) está en las funciones SQL y se prueba en
// Postgres/PostgREST (supabase/scripts/test_221_clientes_contratos_crm.sql/.sh). Aquí se prueba, con datos
// sintéticos y un cliente Supabase falso, que la aplicación:
//   · no envía actor, asesor ni tenant propio de quien no es superadmin (no puede ampliar el alcance);
//   · recorta cada fila a la lista blanca de 14 columnas del contrato;
//   · devuelve el mismo resultado vacío para ajeno / otro tenant / inexistente / sin permiso;
//   · no filtra el texto de un error de la base.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNAS_CONTRATO, TAM_PAGINA, claseEstado, esRolClientesContratos, etiquetaCanal, listarClientesContratos,
  normalizarBusqueda, normalizarCursor, normalizarNumeroContrato, numeroParaMostrar, obtenerFichaContrato,
  proyectarContrato, rolDelActor, tenantParaRpc,
} from "../lib/crm/clientesContratos68.ts";

type Llamada = { fn: string; args: Record<string, unknown> };
function sbFalso(respuestas: Record<string, { data: unknown; error: unknown } | (() => never)>) {
  const llamadas: Llamada[] = [];
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      const r = respuestas[fn];
      if (typeof r === "function") r();
      return r ?? { data: [], error: null };
    },
  };
  return { sb: sb as never, llamadas };
}

const FILA = {
  numero_contrato: "68-0001", fecha_venta: "2026-09-01", cliente: "Cliente Sintetico Uno", cliente_documento: "DOC-0001",
  cliente_email: "uno@ejemplo.test", cliente_telefono: "3000000001", destino: "Destino Uno", fecha_salida: "2026-11-01",
  fecha_regreso: "2026-11-05", estado: "confirmado", tipo_asesor: "interno", agencia_nombre: null, freelance_nombre: null,
  tenant: "mayorista",
};

test("venta: solo contratos propios (la autoridad es la RPC; la aplicación no envía actor, asesor ni tenant)", async () => {
  assert.equal(tenantParaRpc("venta", "mayorista"), null);
  assert.equal(tenantParaRpc("venta", "minorista"), null);
  for (const rol of ["gerencia", "administracion", "operaciones"]) assert.equal(tenantParaRpc(rol, "minorista"), null, rol);
  assert.equal(tenantParaRpc("superadmin", "minorista"), "minorista", "solo el superadmin envía el filtro de agencia");
  const { sb, llamadas } = sbFalso({ crm_contratos_clientes_buscar: { data: [{ ...FILA, hay_mas: false }], error: null } });
  await listarClientesContratos(sb, { tenant: tenantParaRpc("venta", "minorista"), q: "sint", cursor: null });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].fn, "crm_contratos_clientes_buscar");
  assert.deepEqual(Object.keys(llamadas[0].args).sort(), ["p_busqueda", "p_cursor", "p_tam", "p_tenant"], "ningún parámetro de actor, asesor o rol");
  assert.equal(llamadas[0].args.p_tenant, null);
  assert.equal(llamadas[0].args.p_tam, TAM_PAGINA);
});

test("la ficha de un contrato ajeno, de otro tenant o inexistente responde igual", async () => {
  const resp = async () => {
    // La RPC devuelve el MISMO conjunto vacío en los cuatro casos; la aplicación no tiene cómo distinguirlos.
    const { sb } = sbFalso({ crm_contrato_cliente_ficha: { data: [], error: null } });
    return obtenerFichaContrato(sb, "68-9999");
  };
  const ajeno = await resp();
  const otroTenant = await resp();
  const inexistente = await resp();
  const sinPermiso = await resp();
  for (const r of [otroTenant, inexistente, sinPermiso]) assert.deepEqual(r, ajeno);
  assert.deepEqual(ajeno, { ok: true, contrato: null });
  // data null (otra forma de «vacío» de PostgREST) también es el mismo resultado.
  const { sb } = sbFalso({ crm_contrato_cliente_ficha: { data: null, error: null } });
  assert.deepEqual(await obtenerFichaContrato(sb, "68-9999"), ajeno);
});

test("la ficha existente se proyecta a las 14 columnas y descarta cualquier extra", async () => {
  const extra = { ...FILA, precio_venta: 9999, costo_hotel: 1, share_token: "tok", asesor: "Alguien", cliente_direccion: "Calle 1", asesor_firma_cc: "1", hay_mas: false };
  const { sb } = sbFalso({ crm_contrato_cliente_ficha: { data: [extra], error: null } });
  const r = await obtenerFichaContrato(sb, "68-0001");
  assert.ok(r.ok && r.contrato);
  assert.deepEqual(Object.keys(r.contrato).sort(), [...COLUMNAS_CONTRATO].sort());
  for (const prohibida of ["precio_venta", "costo_hotel", "share_token", "asesor", "cliente_direccion", "asesor_firma_cc", "hay_mas"]) {
    assert.ok(!(prohibida in r.contrato), prohibida);
  }
});

test("una fila por contrato: dos contratos del mismo cliente siguen siendo dos filas, sin agrupar", async () => {
  const dos = [
    { ...FILA, numero_contrato: "68-0001", hay_mas: false },
    { ...FILA, numero_contrato: "68-0002", hay_mas: false }, // mismo cliente, mismo documento
  ];
  const { sb } = sbFalso({ crm_contratos_clientes_buscar: { data: dos, error: null } });
  const r = await listarClientesContratos(sb, { tenant: null, q: null, cursor: null });
  assert.ok(r.ok);
  assert.deepEqual(r.filas.map((f) => f.numero_contrato), ["68-0001", "68-0002"]);
  assert.equal(r.hayMas, false);
});

test("hay_mas de la RPC activa la siguiente página y nunca se muestran más de TAM_PAGINA filas", async () => {
  const filas = Array.from({ length: TAM_PAGINA + 5 }, (_, i) => ({ ...FILA, numero_contrato: `68-${1000 + i}`, hay_mas: true }));
  const { sb } = sbFalso({ crm_contratos_clientes_buscar: { data: filas, error: null } });
  const r = await listarClientesContratos(sb, { tenant: null, q: null, cursor: null });
  assert.ok(r.ok);
  assert.equal(r.filas.length, TAM_PAGINA);
  assert.equal(r.hayMas, true);
});

test("el error de la base no se muestra: mensaje genérico, sin código ni texto del servidor", async () => {
  const detalle = { message: 'permission denied for table ventas (42501) tenant=mayorista', code: "42501" };
  const { sb } = sbFalso({
    crm_contratos_clientes_buscar: { data: null, error: detalle },
    crm_contrato_cliente_ficha: { data: null, error: detalle },
  });
  const a = await listarClientesContratos(sb, { tenant: null, q: null, cursor: null });
  const b = await obtenerFichaContrato(sb, "68-0001");
  for (const r of [a, b]) {
    assert.equal(r.ok, false);
    const texto = JSON.stringify(r);
    assert.ok(!/42501|permission|ventas|tenant=/.test(texto), texto);
  }
  // Una excepción (red, JWT vencido) tampoco se propaga.
  const lanza = sbFalso({ crm_contratos_clientes_buscar: () => { throw new Error("boom con datos"); } });
  const c = await listarClientesContratos(lanza.sb, { tenant: null, q: null, cursor: null });
  assert.equal(c.ok, false);
  assert.ok(!/boom/.test(JSON.stringify(c)));
});

test("roles: solo los cinco internos; control_vuelo, agencia, freelance, cliente_final y vacío no", () => {
  for (const r of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) assert.equal(esRolClientesContratos(r), true, r);
  for (const r of ["control_vuelo", "agencia", "freelance", "cliente_final", "publico", "", null, undefined, 3]) {
    assert.equal(esRolClientesContratos(r), false, String(r));
  }
});

test("rolDelActor: sin sesión o usuario desactivado = sin acceso; activo = su rol", async () => {
  const mk = (user: unknown, perfil: unknown) => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: perfil }) }) }) }),
  }) as never;
  assert.equal(await rolDelActor(mk(null, { rol: "venta", activo: true })), null);
  assert.equal(await rolDelActor(mk({ id: "u" }, { rol: "venta", activo: false })), null);
  assert.equal(await rolDelActor(mk({ id: "u" }, null)), null);
  assert.equal(await rolDelActor(mk({ id: "u" }, { rol: "venta", activo: true })), "venta");
  const roto = { auth: { getUser: async () => { throw new Error("x"); } } } as never;
  assert.equal(await rolDelActor(roto), null);
});

test("búsqueda: recorta, rechaza menos de 3 y más de 100 caracteres y quita caracteres de control", () => {
  assert.deepEqual(normalizarBusqueda(undefined), { ok: true, q: null });
  assert.deepEqual(normalizarBusqueda("   "), { ok: true, q: null });
  assert.deepEqual(normalizarBusqueda("  abc  "), { ok: true, q: "abc" });
  assert.deepEqual(normalizarBusqueda("ab"), { ok: false, motivo: "corta" });
  assert.deepEqual(normalizarBusqueda("x".repeat(101)), { ok: false, motivo: "larga" });
  assert.deepEqual(normalizarBusqueda("x".repeat(100)), { ok: true, q: "x".repeat(100) });
  assert.deepEqual(normalizarBusqueda("ab\u0000c\n"), { ok: true, q: "ab c" });
  assert.deepEqual(normalizarBusqueda(42), { ok: false, motivo: "invalida" });
  assert.deepEqual(normalizarBusqueda(new File([], "f")), { ok: false, motivo: "invalida" });
});

test("cursor y número de contrato: texto acotado y sin control; lo demás se ignora", () => {
  assert.equal(normalizarCursor("68-0001"), "68-0001");
  assert.equal(normalizarCursor(""), null);
  assert.equal(normalizarCursor("a\u0000b"), null);
  assert.equal(normalizarCursor("x".repeat(61)), null);
  assert.equal(normalizarCursor(["68-0001"]), null);
  assert.equal(normalizarNumeroContrato("MIN-00-0451"), "MIN-00-0451");
  assert.equal(normalizarNumeroContrato("68%2D0001"), "68-0001");
  assert.equal(normalizarNumeroContrato("%E0%A4%A"), null, "URL mal codificada");
  assert.equal(normalizarNumeroContrato("a%00b"), null);
  assert.equal(normalizarNumeroContrato("   "), null);
});

test("proyección: filas inválidas se descartan; el tenant y el número son obligatorios", () => {
  assert.equal(proyectarContrato(null), null);
  assert.equal(proyectarContrato([]), null);
  assert.equal(proyectarContrato({ ...FILA, numero_contrato: "" }), null);
  assert.equal(proyectarContrato({ ...FILA, tenant: undefined }), null);
  assert.equal(proyectarContrato({ ...FILA, cliente: undefined })?.cliente, "");
});

test("presentación: número sin prefijo MIN-, estado y canal sin inventar identidad", () => {
  assert.equal(numeroParaMostrar("MIN-00-0451"), "00-0451");
  assert.equal(claseEstado("Confirmado"), "confirmado");
  assert.equal(claseEstado("anulado"), "cancelado");
  assert.equal(claseEstado(null), "otro");
  assert.equal(etiquetaCanal({ tipo_asesor: "agencia", agencia_nombre: "Agencia X", freelance_nombre: null }), "Agencia: Agencia X");
  assert.equal(etiquetaCanal({ tipo_asesor: "freelance", agencia_nombre: null, freelance_nombre: null }), "Freelance");
  assert.equal(etiquetaCanal({ tipo_asesor: null, agencia_nombre: null, freelance_nombre: null }), "—");
});
