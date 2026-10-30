// Se ejecuta con el loader del arnés (reactLoader + jsdom); NO está en el script test:react de package.json
// (package.json no está en la reserva de #68): lo corre el workflow test-221-clientes-contratos-68.yml.
//
// #68 · «Clientes de contratos» renderizado de verdad con datos SINTÉTICOS: las páginas reales del servidor, con la
// RPC simulada por el arnés. Comprueba la presentación (una fila por contrato, sin columnas financieras, mensaje
// único para ficha vacía, módulo oculto a roles sin acceso). El permiso real se prueba en SQL/PostgREST.
import { montar, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const Lista = (await import("../app/(crm)/crm/clientes-contratos/page.tsx")).default;
const Ficha = (await import("../app/(crm)/crm/clientes-contratos/[numero_contrato]/page.tsx")).default;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const FILA = (n: string, extra: Record<string, unknown> = {}) => ({
  numero_contrato: n, fecha_venta: "2026-09-01", cliente: "Cliente Sintetico", cliente_documento: "DOC-SINT-1",
  cliente_email: "sint@ejemplo.test", cliente_telefono: "3000000000", destino: "Destino Sintetico", fecha_salida: "2026-11-01",
  fecha_regreso: "2026-11-05", estado: "confirmado", tipo_asesor: "interno", agencia_nombre: null, freelance_nombre: null,
  tenant: "mayorista", hay_mas: false, ...extra,
});
const usuario = (rol: string, activo = true) => ({ usuarios: [{ id: "u-arnes", rol, activo, tenant: "mayorista" }] });
const lista = async (sp: Record<string, string> = {}) => montar(await Lista({ searchParams: Promise.resolve(sp) } as never));
const ficha = async (n: string) => montar(await Ficha({ params: Promise.resolve({ numero_contrato: n }) } as never));

test("lista: una fila por contrato aunque el cliente y el documento sean el mismo", async () => {
  usarBD(usuario("administracion"), {
    crm_contratos_clientes_buscar: () => [FILA("68-0001"), FILA("68-0002")],
  });
  const m = await lista();
  desmontar = m.desmontar;
  assert.equal(m.contenedor.querySelectorAll("tbody tr").length, 2, "dos contratos = dos filas");
  assert.match(m.contenedor.textContent ?? "", /68-0001/);
  assert.match(m.contenedor.textContent ?? "", /68-0002/);
  assert.match(m.contenedor.textContent ?? "", /No es la base\s+de campañas/);
});

test("lista: no pinta columnas que la RPC no debe devolver aunque llegaran", async () => {
  usarBD(usuario("gerencia"), {
    crm_contratos_clientes_buscar: () => [FILA("68-0001", { precio_venta: 987654321, costo_hotel: 123456789, share_token: "TOKEN-SECRETO", cliente_direccion: "Calle Secreta 1", asesor: "Asesor Interno" })],
  });
  const m = await lista();
  desmontar = m.desmontar;
  const t = m.contenedor.textContent ?? "";
  for (const prohibido of ["987654321", "123456789", "TOKEN-SECRETO", "Calle Secreta", "Asesor Interno"]) assert.ok(!t.includes(prohibido), prohibido);
});

test("lista: el rol venta lo sabe en el texto y no envía tenant ni asesor a la RPC", async () => {
  const bd = usarBD(usuario("venta"), { crm_contratos_clientes_buscar: () => [FILA("68-0001")] });
  const m = await lista();
  desmontar = m.desmontar;
  assert.match(m.contenedor.textContent ?? "", /solo los contratos que figuran a tu nombre/);
  const [llamada] = bd.llamadasRpc.filter((c) => c.fn === "crm_contratos_clientes_buscar");
  assert.equal(llamada.args.p_tenant, null);
  assert.deepEqual(Object.keys(llamada.args).sort(), ["p_busqueda", "p_cursor", "p_tam", "p_tenant"]);
});

test("lista: el superadmin envía el filtro de agencia activa", async () => {
  const bd = usarBD(usuario("superadmin"), { crm_contratos_clientes_buscar: () => [] });
  const m = await lista();
  desmontar = m.desmontar;
  assert.equal(bd.llamadasRpc[0].args.p_tenant, "mayorista");
  assert.match(m.contenedor.textContent ?? "", /No hay contratos para mostrar/);
});

test("lista: con más resultados ofrece la siguiente página con el último contrato como cursor", async () => {
  usarBD(usuario("operaciones"), { crm_contratos_clientes_buscar: () => [FILA("68-0001"), FILA("68-0002", { hay_mas: true })] });
  const m = await lista();
  desmontar = m.desmontar;
  const siguiente = [...m.contenedor.querySelectorAll("a")].find((a) => /Siguiente página/.test(a.textContent ?? ""));
  assert.ok(siguiente, "enlace a la siguiente página");
  assert.equal(siguiente.getAttribute("href"), "/crm/clientes-contratos?c=68-0002");
});

test("lista: un cursor inválido se ignora y uno válido llega a la RPC", async () => {
  const bd = usarBD(usuario("administracion"), { crm_contratos_clientes_buscar: () => [] });
  let m = await lista({ c: "x".repeat(200) });
  await m.desmontar();
  assert.equal(bd.llamadasRpc[0].args.p_cursor, null);
  m = await lista({ c: "68-0002" });
  desmontar = m.desmontar;
  assert.equal(bd.llamadasRpc[1].args.p_cursor, "68-0002");
});

test("lista: el error de la base no se muestra", async () => {
  usarBD(usuario("administracion"), {
    crm_contratos_clientes_buscar: () => ({ __error: { code: "42501", message: "permission denied for table ventas" } }),
  });
  const m = await lista();
  desmontar = m.desmontar;
  const t = m.contenedor.textContent ?? "";
  assert.match(t, /No se pudo consultar los contratos/);
  assert.ok(!/42501|permission denied|ventas/.test(t));
});

test("lista: roles sin acceso, usuario desactivado o sin perfil ven el módulo oculto y la RPC no se llama", async () => {
  for (const [rol, activo] of [["control_vuelo", true], ["agencia", true], ["freelance", true], ["cliente_final", true], ["venta", false], ["", true]] as const) {
    const bd = usarBD(usuario(rol, activo), { crm_contratos_clientes_buscar: () => [FILA("68-0001")] });
    const m = await lista();
    assert.match(m.contenedor.textContent ?? "", /Módulo no disponible para tu usuario/, `${rol}/${activo}`);
    assert.equal(bd.llamadasRpc.length, 0, `${rol}/${activo}: sin llamada a la RPC`);
    await m.desmontar();
  }
  const bd = usarBD({ usuarios: [] }, { crm_contratos_clientes_buscar: () => [FILA("68-0001")] });
  const m = await lista();
  desmontar = m.desmontar;
  assert.match(m.contenedor.textContent ?? "", /Módulo no disponible/);
  assert.equal(bd.llamadasRpc.length, 0);
});

test("ficha: muestra los datos del contrato y un enlace al contrato; no hay sección de coincidencias", async () => {
  usarBD(usuario("administracion"), { crm_contrato_cliente_ficha: () => [FILA("68-0001")] });
  const m = await ficha("68-0001");
  desmontar = m.desmontar;
  const t = m.contenedor.textContent ?? "";
  assert.match(t, /Contrato 68-0001/);
  assert.match(t, /DOC-SINT-1/);
  assert.match(t, /sint@ejemplo\.test/);
  assert.ok(!/coincidencia|otros contratos|mismo cliente/i.test(t.replace(/No se unen con otros contratos/, "")));
  const enlace = [...m.contenedor.querySelectorAll("a")].find((a) => /Abrir el contrato/.test(a.textContent ?? ""));
  assert.equal(enlace?.getAttribute("href"), "/dashboard/contratos/68-0001");
});

test("ficha: ajeno, de otro tenant, inexistente y número inválido muestran exactamente el mismo texto", async () => {
  const textos: string[] = [];
  for (const numero of ["68-0001", "68-0002", "68-9999", "a%00b"]) {
    usarBD(usuario("venta"), { crm_contrato_cliente_ficha: () => [] });
    const m = await ficha(numero);
    textos.push(m.contenedor.textContent ?? "");
    await m.desmontar();
  }
  assert.match(textos[0], /No hay un contrato con ese número que puedas consultar desde aquí/);
  for (const t of textos) assert.equal(t, textos[0]);
});

test("ficha: sin acceso por rol no llama a la RPC", async () => {
  const bd = usarBD(usuario("agencia"), { crm_contrato_cliente_ficha: () => [FILA("68-0001")] });
  const m = await ficha("68-0001");
  desmontar = m.desmontar;
  assert.match(m.contenedor.textContent ?? "", /Módulo no disponible/);
  assert.equal(bd.llamadasRpc.length, 0);
});
