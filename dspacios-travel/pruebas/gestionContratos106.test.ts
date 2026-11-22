// #106 · Gestión integral de contratos (superadmin): pruebas PURAS de filtros, presentación, debounce, validación de la respuesta y cableado de seguridad/consumo.
// La parte con base real (RPC, RLS, identidad, acuses) está en pruebas/gestionContratos106.pg.ts (supabase/scripts/test_106_gestion_contratos.sh).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aFiltrosRpc, aplicarPisoViajeReciente, aQuery, entero, esFechaValida, hayFiltros, parsearFiltros, POR_PAGINA, totalPaginas } from "../lib/gestionContratos/filtros.ts";
import { fechaNegocio } from "../lib/fechaNegocio.ts";
import { crearDebounce } from "../lib/gestionContratos/debounce.ts";
import { parsearRespuesta, type FilaGestion } from "../lib/gestionContratos/tipos.ts";
import { accionesSeguimiento, comisionVista, enlacesDe, facturaEmisionVista, facturaEnvioVista, fechaCorta, fechaHoraBogota, saldoVista, voucherEntregaVista, voucherGeneracionVista } from "../lib/gestionContratos/presentacion.ts";
import { LECTURA_MODULO, moduloDeRuta } from "../lib/constants.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

describe("filtros de la URL", () => {
  test("valores válidos pasan y se reescriben igual en la URL", () => {
    const { filtros, pagina, avisos } = parsearFiltros({ agencia: "minorista", numero: " 10602 ", salida_desde: "2026-12-01", salida_hasta: "2026-12-31", saldo: "con_saldo", comision: "descontada", pagina: "3" });
    assert.deepEqual(avisos, []);
    assert.equal(pagina, 3);
    assert.equal(filtros.agencia, "minorista");
    assert.equal(filtros.numero, "10602");
    assert.equal(aQuery(filtros, pagina), "?agencia=minorista&numero=10602&salida_desde=2026-12-01&salida_hasta=2026-12-31&saldo=con_saldo&comision=descontada&pagina=3");
    assert.deepEqual(aFiltrosRpc(filtros), { tenant: "minorista", numero: "10602", salida_desde: "2026-12-01", salida_hasta: "2026-12-31", saldo: "con_saldo", comision: "descontada" });
  });
  test("valores hostiles o inventados se descartan con aviso y nunca llegan a la base", () => {
    const { filtros, avisos } = parsearFiltros({ agencia: "otra'; drop table ventas;--", saldo: "x", venta_desde: "2026-02-30", salida_hasta: "2026-13-01", orden: "id; select 1", estado: ["confirmado", "pendiente"] });
    assert.equal(filtros.agencia, undefined); assert.equal(filtros.saldo, undefined); assert.equal(filtros.ventaDesde, undefined); assert.equal(filtros.salidaHasta, undefined);
    assert.equal(filtros.orden, "venta_desc");
    assert.equal(filtros.estado, "confirmado"); // un parámetro repetido: solo el primero
    assert.equal(avisos.length, 5);
    assert.deepEqual(aFiltrosRpc(filtros), { estado: "confirmado" });
  });
  test("texto: se recortan controles y largos; el comodín % se manda tal cual (la base lo escapa)", () => {
    const { filtros } = parsearFiltros({ cliente: `  Ana\u0000\n  ${"x".repeat(200)}` });
    assert.ok(filtros.cliente!.length <= 60);
    assert.ok(!/[\u0000-\u001f]/.test(filtros.cliente!));
    assert.equal(parsearFiltros({ numero: "100%_" }).filtros.numero, "100%_");
  });
  test("página: entero positivo acotado; basura = 1", () => {
    for (const [v, esperado] of [["2", 2], ["0", 1], ["-4", 1], ["1.5", 1], ["abc", 1], ["", 1], [undefined, 1], ["99999999", 1], ["20000", 10000]] as const) assert.equal(entero(v), esperado, String(v));
  });
  test("fechas: solo calendario real, bordes de mes y año bisiesto", () => {
    for (const v of ["2026-01-31", "2028-02-29", "2026-12-31"]) assert.ok(esFechaValida(v), v);
    for (const v of ["2026-02-29", "2026-04-31", "2026-00-10", "26-01-01", "2026-1-1", "2026-01-01T00:00", ""]) assert.ok(!esFechaValida(v), v);
  });
  test("rango invertido avisa pero no se reescribe", () => {
    const { filtros, avisos } = parsearFiltros({ venta_desde: "2026-11-30", venta_hasta: "2026-11-01" });
    assert.equal(filtros.ventaDesde, "2026-11-30");
    assert.match(avisos[0], /invertido/);
  });
  test("sin filtros: URL vacía, hayFiltros falso; orden por defecto no se escribe", () => {
    const { filtros } = parsearFiltros({});
    assert.equal(aQuery(filtros), ""); assert.equal(hayFiltros(filtros), false);
    assert.equal(hayFiltros(parsearFiltros({ orden: "saldo_desc" }).filtros), true);
  });
  test("totalPaginas", () => {
    assert.equal(POR_PAGINA, 25);
    for (const [n, p] of [[0, 1], [1, 1], [25, 1], [26, 2], [50, 2], [51, 3]] as const) assert.equal(totalPaginas(n), p);
  });
});

describe("debounce del buscador", () => {
  test("solo corre la última llamada tras la espera; cancelar descarta; sin reintentos", async () => {
    const t = await import("node:test");
    const mock = t.mock;
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const vistos: string[] = [];
      const d = crearDebounce((v: string) => vistos.push(v), 400);
      d("1"); mock.timers.tick(399); d("10"); mock.timers.tick(399); d("106");
      assert.equal(vistos.length, 0); assert.ok(d.pendiente());
      mock.timers.tick(400);
      assert.deepEqual(vistos, ["106"]); assert.ok(!d.pendiente());
      mock.timers.tick(10_000);
      assert.deepEqual(vistos, ["106"]); // nada más se ejecuta por sí solo
      d("x"); d.cancelar(); mock.timers.tick(5_000);
      assert.deepEqual(vistos, ["106"]);
    } finally { mock.timers.reset(); }
  });
});

const base = (o: Partial<FilaGestion> = {}): FilaGestion => ({
  numero: "DTM-10601", uid: "11111111-1111-1111-1111-111111111111", tenant: "mayorista", cliente: "Ana", destino: "CARTAGENA", tipoPaquete: "porcion",
  fechaVenta: "2026-09-02", fechaSalida: "2026-12-10", fechaRegreso: "2026-12-14", estado: "confirmado", estadoGrupo: "confirmado", financieroPendiente: false,
  monedaOferta: "COP", precioOferta: 2_000_000, monedaCobro: "COP", cobroConvertido: false, total: 2_000_000, pagado: 500_000, saldo: 1_500_000, saldoClase: "con_saldo", nAbonos: 1,
  voucher: { n: 0, entrega: "sin_voucher", acuseAnterior: false, evento: null, en: null, actor: null, canal: null, nota: null },
  factura: { emitida: false, estado: "sin_factura", contable: false, dian: false, registros: 0, envio: "sin_factura", evento: null, en: null, actor: null, canal: null, nota: null },
  comision: { clase: "no_aplica", filas: 0 }, ...o,
});

describe("presentación: nunca confundir lo generado con lo entregado/enviado", () => {
  test("tres estados del voucher, en dos pasos: no generado · generado sin entrega registrada · entrega registrada manualmente", () => {
    const sin = base();
    assert.equal(voucherGeneracionVista(sin).texto, "No generado"); assert.equal(voucherEntregaVista(sin).texto, "Sin voucher");
    const gen = base({ voucher: { ...base().voucher, n: 2, entrega: "pendiente" } });
    assert.equal(voucherGeneracionVista(gen).texto, "Generado (2)");
    assert.match(voucherGeneracionVista(gen).detalle ?? "", /no prueba que se haya entregado/);
    const ent = voucherEntregaVista(gen);
    assert.equal(ent.tono, "warn"); assert.equal(ent.texto, "Entrega sin registrar"); assert.match(ent.detalle ?? "", /No consta/);
    const reg = base({ voucher: { n: 1, entrega: "entregado", acuseAnterior: false, evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana Gómez", canal: "whatsapp", nota: null } });
    assert.equal(voucherGeneracionVista(reg).texto, "Generado (1)");
    const r = voucherEntregaVista(reg);
    assert.match(r.texto, /manualmente/); assert.match(r.detalle ?? "", /10:30/); assert.match(r.detalle ?? "", /Ana Gómez/);
    assert.match(r.detalle ?? "", /no prueba que el cliente lo recibiera ni lo aceptara/);
  });
  test("ningún texto de entrega/envío afirma recepción o aceptación del destinatario", () => {
    const v = voucherEntregaVista(base({ voucher: { n: 1, entrega: "entregado", acuseAnterior: false, evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana", canal: "correo", nota: null } }));
    const e = facturaEnvioVista(base({ factura: { emitida: true, estado: "emitida", contable: true, dian: true, registros: 1, envio: "enviada", evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana", canal: "correo", nota: null } }));
    for (const x of [v, e]) { assert.equal(x.tono, "info"); assert.match(x.texto, /registrad[ao] manualmente/); assert.ok(!/recibid|aceptad|confirmad/i.test(x.texto)); assert.match(x.detalle ?? "", /Acuse del personal/); }
  });
  test("voucher de reemplazo: la entrega queda pendiente (no verde) y el acuse anterior se menciona como historial", () => {
    const f = base({ voucher: { ...base().voucher, n: 2, entrega: "pendiente", acuseAnterior: true, evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana Gómez", canal: "whatsapp" } });
    const v = voucherEntregaVista(f);
    assert.equal(v.tono, "warn"); assert.match(v.texto, /voucher nuevo/); assert.match(v.detalle ?? "", /historial/); assert.match(v.detalle ?? "", /Ana Gómez/);
    assert.match(voucherGeneracionVista(f).detalle ?? "", /después de la entrega registrada/);
    assert.equal(facturaEnvioVista(base({ factura: { ...base().factura, emitida: true, estado: "emitida", envio: "desactualizada" } })).tono, "orange");
  });
  test("«emitida» es SOLO validación DIAN: asiento o número antiguo se muestran «pendiente de validación», nunca emitida", () => {
    const sinValidar = facturaEmisionVista(base({ factura: { ...base().factura, estado: "sin_validar", contable: true, registros: 1 } }));
    assert.equal(sinValidar.texto, "Pendiente de validación DIAN"); assert.equal(sinValidar.tono, "warn"); assert.match(sinValidar.detalle ?? "", /no consta la validación DIAN/);
    assert.equal(facturaEmisionVista(base({ factura: { ...base().factura, emitida: true, estado: "emitida", dian: true } })).texto, "Emitida (validada por la DIAN)");
    assert.equal(facturaEmisionVista(base()).texto, "Sin factura");
  });
  test("factura emitida sin acuse: envío «sin registrar»", () => {
    const v = facturaEnvioVista(base({ factura: { ...base().factura, emitida: true, estado: "emitida", envio: "pendiente" } }));
    assert.equal(v.tono, "warn"); assert.match(v.detalle ?? "", /no consta/i);
  });
  test("NETO descontada NO es una comisión por pagar", () => {
    const v = comisionVista("descontada");
    assert.notEqual(v.tono, "warn"); assert.match(v.texto, /NETO/); assert.match(v.detalle ?? "", /no hay comisión por pagar/);
    assert.equal(comisionVista("pendiente").tono, "warn"); assert.equal(comisionVista("pagada").tono, "ok");
    assert.equal(comisionVista("no_aplica").tono, "neutral");
  });
  test("saldo: desconocido, cancelado, sobrepago, pagado y con saldo (sin falsos ceros)", () => {
    assert.equal(saldoVista(base({ total: null, saldo: null, saldoClase: "sin_total" })).texto, "Sin total");
    assert.equal(saldoVista(base({ total: 0, saldo: 0, saldoClase: "sin_total" })).texto, "Sin total");
    assert.equal(saldoVista(base({ estadoGrupo: "cancelado", pagado: 300_000 })).texto, "Cancelado");
    assert.match(saldoVista(base({ saldoClase: "sobrepago", saldo: -100, monedaCobro: "USD", pagado: 2600, total: 2500 })).detalle ?? "", /USD/);
    assert.equal(saldoVista(base({ saldoClase: "pagado", saldo: 0 })).tono, "ok");
    assert.match(saldoVista(base()).texto, /1\.500\.000/);
  });
  test("acciones de acuse: solo lo que la base aceptaría", () => {
    assert.deepEqual(accionesSeguimiento("sin_voucher", false), { marcar: false, retirar: false });
    assert.deepEqual(accionesSeguimiento("pendiente", true), { marcar: true, retirar: false });
    assert.deepEqual(accionesSeguimiento("entregado", true), { marcar: false, retirar: true });
    assert.deepEqual(accionesSeguimiento("desactualizada", false), { marcar: false, retirar: true });
    assert.deepEqual(accionesSeguimiento("sin_factura", false), { marcar: false, retirar: false });
  });
  test("fechas sin corrimiento de zona; hora en Bogotá", () => {
    assert.equal(fechaCorta("2026-11-12"), "12/11/2026"); assert.equal(fechaCorta(null), "—"); assert.equal(fechaCorta("basura"), "—");
    assert.equal(fechaHoraBogota("2026-11-12T15:30:00Z"), "12/11/2026 10:30");
    assert.equal(fechaHoraBogota("2026-11-13T04:59:00Z"), "12/11/2026 23:59");
    assert.equal(fechaHoraBogota(null), "—");
  });
  test("enlaces: ficha del contrato con pestaña; comisiones solo si aplica; número codificado", () => {
    const e = enlacesDe({ numero: "MIN-00-0901", comision: { clase: "no_aplica", filas: 0 } });
    assert.deepEqual(e.map((x) => x.clave), ["contrato", "pagos", "vouchers", "facturacion"]);
    assert.equal(e[0].href, "/dashboard/contratos/MIN-00-0901"); assert.equal(e[1].href, "/dashboard/contratos/MIN-00-0901?tab=cartera");
    assert.equal(e[2].href, "/dashboard/contratos/MIN-00-0901#vouchers"); assert.equal(e[3].href, "/dashboard/contratos/MIN-00-0901?tab=facturacion");
    const c = enlacesDe({ numero: "DTM-1/2", comision: { clase: "pendiente", filas: 1 } });
    assert.equal(c.at(-1)!.href, "/dashboard/contratos/DTM-1%2F2?tab=comisiones");
  });
});

describe("validación de la respuesta de la base", () => {
  const filaJson = {
    numero: "DTM-1", uid: "u", tenant: "mayorista", cliente: null, destino: null, tipo_paquete: null, fecha_venta: "2026-01-01", fecha_salida: null, fecha_regreso: null,
    estado: "confirmado", estado_grupo: "confirmado", financiero_pendiente: false, moneda_oferta: "COP", precio_oferta: 10, moneda_cobro: "COP", cobro_convertido: false,
    total: null, pagado: 0, saldo: null, saldo_clase: "sin_total", n_abonos: 0,
    voucher: { n: 0, entrega: "sin_voucher", acuse_anterior: false, evento: null, en: null, actor: null, canal: null, nota: null },
    factura: { emitida: false, estado: "sin_factura", contable: false, dian: false, registros: 0, envio: "sin_factura", evento: null, en: null, actor: null, canal: null, nota: null },
    comision: { clase: "no_aplica", filas: 0 },
  };
  const ok = { total: 1, limite: 25, desplazamiento: 0, resumen: [], filas: [filaJson] };
  test("una respuesta correcta conserva null (total desconocido no se vuelve 0)", () => {
    const r = parsearRespuesta(ok);
    assert.equal(r.filas[0].total, null); assert.equal(r.filas[0].saldo, null);
  });
  test("una forma inesperada falla en voz alta", () => {
    assert.throws(() => parsearRespuesta(null)); assert.throws(() => parsearRespuesta({ ...ok, filas: "x" }));
    assert.throws(() => parsearRespuesta({ ...ok, filas: [{ ...filaJson, saldo_clase: "inventado" }] }));
    assert.throws(() => parsearRespuesta({ ...ok, filas: [{ ...filaJson, pagado: "10" }] }));
    assert.throws(() => parsearRespuesta({ ...ok, filas: [{ ...filaJson, voucher: undefined }] }));
    assert.throws(() => parsearRespuesta({ ...ok, filas: [{ ...filaJson, tenant: "otra" }] }));
  });
});

describe("cableado: solo superadmin, sin sondeos ni service-role", () => {
  test("el módulo y la ruta son SOLO superadmin y el proxy los cubre", () => {
    assert.deepEqual([...LECTURA_MODULO.gestion_contratos], ["superadmin"]);
    assert.equal(moduloDeRuta("/dashboard/gestion-contratos"), "gestion_contratos");
    assert.equal(moduloDeRuta("/dashboard/gestion-contratos/loquesea"), "gestion_contratos");
    assert.equal(moduloDeRuta("/dashboard/contratos/DTM-1"), "contratos"); // no se tocó el módulo de contratos
    for (const rol of ["gerencia", "administracion", "operaciones", "venta", "control_vuelo"]) assert.ok(!(LECTURA_MODULO.gestion_contratos as readonly string[]).includes(rol), rol);
  });
  test("nada de la pantalla usa service-role, la agencia activa ni temporizadores periódicos", () => {
    const archivos = [
      "lib/gestionContratos/cargar.server.ts", "lib/gestionContratos/filtros.ts", "lib/gestionContratos/presentacion.ts", "lib/gestionContratos/tipos.ts",
      "app/(dashboard)/dashboard/gestion-contratos/page.tsx", "app/(dashboard)/dashboard/gestion-contratos/actions.ts", "app/(dashboard)/dashboard/gestion-contratos/TablaGestion.tsx",
      "app/(dashboard)/dashboard/gestion-contratos/SeguimientoControl.tsx", "app/(dashboard)/dashboard/gestion-contratos/FiltrosGestion.tsx",
    ];
    for (const a of archivos) {
      const src = leer(a).replace(/\/\/.*$/gm, "");
      assert.ok(!/createAdminClient|supabase\/admin|SERVICE_ROLE/.test(src), `${a}: service-role`);
      assert.ok(!/getTenant|tenantContext|cookies\(/.test(src), `${a}: agencia activa`);
      assert.ok(!/setInterval|refetchInterval|router\.refresh\(\)/.test(src), `${a}: sondeo`);
    }
    assert.ok(/prefetch=\{false\}/.test(leer("app/(dashboard)/dashboard/gestion-contratos/TablaGestion.tsx")), "los enlaces de fila no hacen prefetch");
  });
  test("la disposición depende del ancho del contenedor (container queries), no del viewport, y las fechas no usan nowrap", () => {
    const src = leer("app/(dashboard)/dashboard/gestion-contratos/TablaGestion.tsx").replace(/\/\/.*$/gm, "");
    assert.ok(/className="@container"/.test(src), "falta el contenedor");
    assert.ok(!/(^|[\s"`])(sm|md|lg|xl|2xl):/.test(src), "queda un breakpoint de viewport");
    assert.ok(!/whitespace-nowrap/.test(src), "queda un nowrap que puede montar columnas");
    for (const q of ["@xl:grid-cols-2", "@3xl:grid-cols-3", "@5xl:grid-cols-[", "@5xl:hidden"]) assert.ok(src.includes(q), q);
    assert.ok(/Regreso \{fechaCorta/.test(src) && /Viaje \{fechaCorta/.test(src), "fechas en líneas propias");
  });
  test("la página exige superadmin ANTES de pedir datos y la acción valida y delega en la RPC", () => {
    const carga = leer("lib/gestionContratos/cargar.server.ts").replace(/\/\/.*$/gm, "");
    assert.ok(carga.indexOf("esSuperadminActivo(sb)") < carga.indexOf("fn_gestion_contratos"));
    const acceso = leer("lib/gestionContratos/acceso.server.ts");
    assert.ok(/rol === "superadmin" && data.activo !== false/.test(acceso), "superadmin y ACTIVO");
    const act = leer("app/(dashboard)/dashboard/gestion-contratos/actions.ts").replace(/\/\/.*$/gm, "");
    assert.ok(act.indexOf("esSuperadminActivo(sb)") < act.indexOf("registrar_seguimiento_contrato"));
    assert.ok(/revalidatePath\("\/dashboard\/gestion-contratos"\)/.test(act));
  });
  test("la migración 309 no modifica objetos existentes ni da escritura directa a la API", () => {
    const sql = leer("supabase/migrations/20260601000309_gestion_contratos_superadmin.sql");
    assert.ok(!/alter table public\.(ventas|abonos|vouchers|facturacion|contrato_facturacion|aliados_b2b)\b/i.test(sql));
    assert.ok(!/grant (insert|update|delete)[^;]*contrato_seguimiento/i.test(sql));
    assert.ok(/revoke all on public\.contrato_seguimiento from public, anon, authenticated/.test(sql));
    for (const fn of ["fn_gestion_contratos", "registrar_seguimiento_contrato"]) assert.ok(new RegExp(`revoke all on function public\\.${fn}`).test(sql), fn);
  });
});

describe("nota explicativa de la lista (hallazgo de navegador, 2026-11-18)", () => {
  test("el texto de la nota va en UN solo <span> junto al ícono: como hijos sueltos del <p> flex cada fragmento era una columna y la página desbordaba a 768 px", () => {
    const pagina = leer("app/(dashboard)/dashboard/gestion-contratos/page.tsx");
    // el <p className="… flex …"> contiene el ícono y exactamente un <span> con todo el texto
    assert.match(pagina, /<p className="[^"]*\bflex\b[^"]*">\s*<Info [^>]*\/>\s*<span>\s*Cada voucher y cada factura[\s\S]*?hasta que se registre el acuse\.\s*<\/span>\s*<\/p>/);
  });
});

// #126-E — «Viaje más reciente» (orden salida_asc): salidas de HOY (America/Bogota) en adelante; el historial se alcanza con fechas de viaje explícitas u otros órdenes.
describe("#126-E · piso «hoy» de Viaje más reciente", () => {
  const base = (extra: Record<string, string> = {}) => parsearFiltros({ orden: "salida_asc", ...extra }).filtros;
  test("solo el orden salida_asc recibe el piso; el resto de órdenes y filtros quedan como están", () => {
    const r = aplicarPisoViajeReciente(base(), "2030-06-15");
    assert.equal(r.pisoDesde, "2030-06-15");
    assert.deepEqual(aFiltrosRpc(r.filtros), { salida_desde: "2030-06-15" });
    for (const orden of ["venta_desc", "venta_asc", "salida_desc", "saldo_desc", "numero_asc"]) {
      const f = parsearFiltros({ orden }).filtros;
      assert.equal(aplicarPisoViajeReciente(f, "2030-06-15").pisoDesde, null, orden);
      assert.equal(aplicarPisoViajeReciente(f, "2030-06-15").filtros, f, "ni siquiera copia: no cambia nada");
    }
  });
  test("una fecha de viaje explícita (desde o hasta) manda: no se aplica el piso (historial accesible)", () => {
    assert.equal(aplicarPisoViajeReciente(base({ salida_desde: "2020-01-01" }), "2030-06-15").pisoDesde, null);
    assert.equal(aplicarPisoViajeReciente(base({ salida_hasta: "2029-12-31" }), "2030-06-15").pisoDesde, null);
    assert.deepEqual(aFiltrosRpc(aplicarPisoViajeReciente(base({ salida_hasta: "2029-12-31" }), "2030-06-15").filtros), { salida_hasta: "2029-12-31" });
  });
  test("el piso NO se escribe en la URL ni cuenta como filtro del usuario: el enlace compartido sigue diciendo solo el orden", () => {
    const f = base({ estado: "pendiente" });
    const { filtros } = aplicarPisoViajeReciente(f, "2030-06-15");
    assert.equal(aQuery(f), "?estado=pendiente&orden=salida_asc");
    assert.equal(f.salidaDesde, undefined, "los filtros originales no se mutan");
    assert.equal(filtros.salidaDesde, "2030-06-15");
    assert.equal(filtros.estado, "pendiente");
  });
  test("el día es el de BOGOTÁ (UTC-5): 23:59:59 sigue siendo hoy aunque en UTC ya sea mañana; 00:00:00 cambia el día", () => {
    assert.equal(fechaNegocio(new Date("2030-06-15T17:00:00Z")), "2030-06-15");
    assert.equal(fechaNegocio(new Date("2030-06-16T04:59:59Z")), "2030-06-15");
    assert.equal(fechaNegocio(new Date("2030-06-16T05:00:00Z")), "2030-06-16");
    assert.equal(fechaNegocio(new Date("2030-06-16T02:00:00Z")), "2030-06-15", "trampa: el día UTC sería el 16");
    assert.equal(fechaNegocio(new Date("2030-01-01T04:59:59Z")), "2029-12-31", "cruce de año");
  });
  test("el cargador usa el reloj inyectado y fechaNegocio (no la fecha UTC del servidor)", () => {
    const c = leer("lib/gestionContratos/cargar.server.ts");
    assert.match(c, /ahora: Date = new Date\(\)/);
    assert.match(c, /aplicarPisoViajeReciente\(filtros, fechaNegocio\(ahora\)\)/);
    assert.match(c, /aFiltrosRpc\(efectivos\)/);
    assert.doesNotMatch(c, /toISOString\(\)\.slice\(0, 10\)/);
  });
});
