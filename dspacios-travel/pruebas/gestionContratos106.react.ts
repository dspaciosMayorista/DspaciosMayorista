// #106 · Render REAL de la lista de Gestión de contratos (SSR): cada estado de voucher/factura se ve en su propio paso y la disposición va por container queries.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// La Server Action real termina en next/cache + Supabase: aquí solo se renderiza, nunca se invoca.
mock.module(new URL("../app/(dashboard)/dashboard/gestion-contratos/actions.ts", import.meta.url).href, { namedExports: { registrarSeguimiento: async () => ({ ok: true }) } });
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { TablaGestion } = await import("../app/(dashboard)/dashboard/gestion-contratos/TablaGestion.tsx");

const evento = { evento: null, en: null, actor: null, canal: null, nota: null } as const;
const base = (numero: string, o: Record<string, unknown> = {}) => ({
  numero, uid: `u-${numero}`, tenant: "mayorista", cliente: "Cliente", destino: "CARTAGENA", tipoPaquete: null,
  fechaVenta: "2026-09-02", fechaSalida: "2026-12-10", fechaRegreso: "2026-12-14", estado: "confirmado", estadoGrupo: "confirmado", financieroPendiente: false,
  monedaOferta: "USD", precioOferta: 1000, monedaCobro: "USD", cobroConvertido: false, total: 1000, pagado: 300, saldo: 700, saldoClase: "con_saldo", nAbonos: 1,
  voucher: { ...evento, n: 0, entrega: "sin_voucher", acuseAnterior: false },
  factura: { ...evento, emitida: false, estado: "sin_factura", contable: false, dian: false, registros: 0, envio: "sin_factura" },
  comision: { clase: "no_aplica", filas: 0 }, ...o,
});
const html = (f: unknown) => renderToStaticMarkup(React.createElement(TablaGestion, { filas: [f] as never }));

test("voucher no generado: paso Generación «No generado» y sin botón de registrar entrega", () => {
  const h = html(base("DTM-1"));
  assert.match(h, /Generación[\s\S]*No generado/); assert.match(h, /Sin voucher/); assert.ok(!/Registrar entrega/.test(h));
});
test("voucher generado sin acuse: Generado (2) + «Entrega sin registrar» + botón para registrar", () => {
  const h = html(base("DTM-2", { voucher: { ...evento, n: 2, entrega: "pendiente", acuseAnterior: false } }));
  assert.match(h, /Generado \(2\)/); assert.match(h, /Entrega sin registrar/); assert.match(h, /Registrar entrega/); assert.ok(!/registrada manualmente/.test(h));
});
test("entrega registrada: se rotula manual y no afirma recepción", () => {
  const h = html(base("DTM-3", { voucher: { n: 1, entrega: "entregado", acuseAnterior: false, evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana", canal: "whatsapp", nota: null } }));
  assert.match(h, /Entrega registrada manualmente/); assert.match(h, /Acuse del personal/); assert.ok(!/Entrega sin registrar/.test(h));
});
test("factura: pendiente de validación DIAN · emitida sin envío · envío registrado manualmente", () => {
  const pend = html(base("DTM-4", { factura: { ...evento, emitida: false, estado: "sin_validar", contable: true, dian: false, registros: 1, envio: "sin_factura" } }));
  assert.match(pend, /Pendiente de validación DIAN/); assert.match(pend, /Se registra cuando la factura esté emitida/); assert.ok(!/Registrar envío/.test(pend));
  const em = html(base("DTM-5", { factura: { ...evento, emitida: true, estado: "emitida", contable: true, dian: true, registros: 1, envio: "pendiente" } }));
  assert.match(em, /Emitida \(validada por la DIAN\)/); assert.match(em, /Envío sin registrar/); assert.match(em, /Registrar envío/);
  const env = html(base("DTM-6", { factura: { emitida: true, estado: "emitida", contable: true, dian: true, registros: 1, envio: "enviada", evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana", canal: "correo", nota: null } }));
  assert.match(env, /Envío registrado manualmente/); assert.match(env, /no prueba que el cliente la recibiera ni la aceptara/);
});
test("voucher de reemplazo: historial y entrega nueva sin registrar", () => {
  const h = html(base("DTM-7", { voucher: { n: 2, entrega: "pendiente", acuseAnterior: true, evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana", canal: "whatsapp", nota: null } }));
  assert.match(h, /Entrega sin registrar \(voucher nuevo\)/); assert.match(h, /sigue en el historial/);
});
test("disposición: contenedor + fechas en líneas propias, sin breakpoints de viewport", () => {
  const h = html(base("DTM-8"));
  assert.match(h, /class="@container"/); assert.match(h, /@5xl:grid-cols-\[/);
  assert.match(h, /Compra 02\/09\/2026/); assert.match(h, /<p[^>]*>Viaje 10\/12\/2026<\/p>/); assert.match(h, /<p[^>]*>Regreso 14\/12\/2026<\/p>/);
  assert.ok(!/(^|[\s"])md:/.test(h) && !/whitespace-nowrap/.test(h));
});
