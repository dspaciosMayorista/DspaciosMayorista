// ADL-041/042 — voucher aéreo POR SERVICIO CONTRATADO (identidad guardada, no el PNR), PNR por tramo en el voucher pagado, estados vigente/revisar/retirado y señal interna de «voucher actualizado».
// Funciones puras + cableado. El comportamiento real contra Postgres está en supabase/scripts/test_338_voucher_vuelo_servicios.sql y en supabase/scripts/recorrido_block1.mjs (grupo f2). Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agruparServiciosAereos, construirVouchersVuelo, sinPnr, tienePnr, type FilaVueloBasica } from "../lib/voucher/vuelo.ts";
import { resolverAccesoVoucher, esVoucherVigente, type DepsAccesoVoucher } from "../lib/voucher/accesoVoucher.ts";
import { vueloVisible } from "../lib/voucher/pnrVoucher.ts";
import { voucherEntregaVista, voucherGeneracionVista } from "../lib/gestionContratos/presentacion.ts";
import { parsearRespuesta } from "../lib/gestionContratos/tipos.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const S1 = "00000000-0000-0000-0000-000000000001", S2 = "00000000-0000-0000-0000-000000000002";
const fila = (o: Partial<FilaVueloBasica>): FilaVueloBasica => ({
  id: 1, record: null, servicio_aereo: null, aerolinea: "Aerolínea X", direccion: null, origen_codigo: "BOG", origen_ciudad: null, destino_codigo: "CTG", destino_ciudad: null, numero_vuelo: "XX1", fecha_salida: "2030-10-15",
  hora_salida: "06:05", hora_llegada: "07:30", servicios: null, orden: 0, vuelo_ida: null, vuelo_regreso: null, hora_salida_ida: null, hora_llegada_ida: null,
  hora_salida_reg: null, hora_llegada_reg: null, fecha_regreso: null, ...o,
});
const base = { pasajeros: ["Ana", "Luis", "Eva"], titular: "Ana", nReserva: "DTM-1", vendedor: "V", emision: "2030-10-01" };

describe("agruparServiciosAereos: el servicio es la asociación GUARDADA, nunca el PNR, el orden ni el id (ADL-042)", () => {
  test("ida con PNR AAA111 y regreso con PNR BBB222 del MISMO servicio = UN servicio", () => {
    const g = agruparServiciosAereos([fila({ id: 7, record: "AAA111", servicio_aereo: S1, direccion: "ida" }), fila({ id: 8, record: "BBB222", servicio_aereo: S1, direccion: "regreso", orden: 1 })]);
    assert.equal(g.servicios.length, 1);
    assert.deepEqual([g.servicios[0].clave, g.servicios[0].filas.length, g.sinAsociar.length], [S1, 2, 0]);
  });
  test("dos servicios contratados con el MISMO PNR siguen siendo dos", () => {
    const g = agruparServiciosAereos([fila({ id: 1, record: "SAME00", servicio_aereo: S1 }), fila({ id: 2, record: "SAME00", servicio_aereo: S2 })]);
    assert.deepEqual(g.servicios.map((x) => x.clave).sort(), [S1, S2].sort());
  });
  test("dos servicios SIN PNR siguen siendo dos (la ausencia de PNR no los une)", () => {
    const g = agruparServiciosAereos([fila({ id: 1, servicio_aereo: S1 }), fila({ id: 2, servicio_aereo: S2 }), fila({ id: 3, servicio_aereo: S2, orden: 2 })]);
    assert.deepEqual(g.servicios.map((x) => [x.clave, x.filas.length]).sort(), [[S1, 1], [S2, 2]].sort());
  });
  test("guardar un PNR después (o cambiarlo) no mueve ningún tramo de servicio ni cambia la clave", () => {
    const antes = agruparServiciosAereos([fila({ id: 10, servicio_aereo: S1 }), fila({ id: 11, servicio_aereo: S1 })]);
    const despues = agruparServiciosAereos([fila({ id: 10, record: "NEW111", servicio_aereo: S1 }), fila({ id: 11, record: "OTRO22", servicio_aereo: S1 })]);
    assert.equal(antes.servicios[0].clave, despues.servicios[0].clave);
    assert.equal(despues.servicios.length, 1);
  });
  test("quitar el tramo con el menor id (el antiguo «ancla») no cambia la clave del servicio", () => {
    const antes = agruparServiciosAereos([fila({ id: 10, servicio_aereo: S1 }), fila({ id: 20, servicio_aereo: S1 }), fila({ id: 30, servicio_aereo: S2 })]);
    const despues = agruparServiciosAereos([fila({ id: 20, servicio_aereo: S1 }), fila({ id: 30, servicio_aereo: S2 })]);
    assert.deepEqual(antes.servicios.map((x) => x.clave).sort(), despues.servicios.map((x) => x.clave).sort());
  });
  test("el orden de las filas de entrada y las mayúsculas del uuid no cambian el resultado", () => {
    const a = agruparServiciosAereos([fila({ id: 9, servicio_aereo: S1 }), fila({ id: 4, servicio_aereo: S1.toUpperCase() })]);
    assert.equal(a.servicios.length, 1);
    assert.equal(a.servicios[0].clave, S1);
  });
  test("un tramo sin servicio asociado NO se asigna por PNR, posición ni id: sale en sinAsociar", () => {
    const g = agruparServiciosAereos([fila({ id: 1, record: "AAA111", servicio_aereo: S1 }), fila({ id: 2, record: "AAA111" }), fila({ id: 3, record: null, servicio_aereo: " " })]);
    assert.deepEqual(g.servicios.map((x) => x.filas.map((f) => f.id)), [[1]]);
    assert.deepEqual(g.sinAsociar.map((f) => f.id), [2, 3]);
  });
});

describe("construirVouchersVuelo", () => {
  test("un contenido por servicio, con SUS tramos y el PNR guardado en CADA tramo; pasajeros del contrato en cada uno", () => {
    const r = construirVouchersVuelo({
      ...base, filas: [
        fila({ id: 1, record: "AAA111", servicio_aereo: S1, direccion: "ida" }), fila({ id: 2, record: "BBB222", servicio_aereo: S1, direccion: "regreso", orden: 1 }), fila({ id: 3, record: "AAA111", servicio_aereo: S2, numero_vuelo: "XX9", orden: 2 }),
      ],
    });
    assert.equal(r.servicios.length, 2);
    const s1 = r.servicios.find((x) => x.clave === S1)!, s2 = r.servicios.find((x) => x.clave === S2)!;
    assert.deepEqual(s1.contenido.tramos.map((t) => t.pnr), ["AAA111", "BBB222"]);
    assert.deepEqual([s1.tramos, s2.tramos, s2.contenido.tramos[0].pnr, s1.contenido.pasajeros.length], [[1, 2], [3], "AAA111", 3]);
    assert.deepEqual(r.sinAsociar, []);
  });
  test("sin ningún PNR guardado igual se genera y el contenido no trae el campo", () => {
    const r = construirVouchersVuelo({ ...base, filas: [fila({ id: 1, servicio_aereo: S1 }), fila({ id: 2, servicio_aereo: S1, orden: 1 })] });
    assert.equal(r.servicios.length, 1);
    assert.doesNotMatch(JSON.stringify(r.servicios[0].contenido), /pnr/i);
  });
  test("tramos sin servicio asociado se informan (ids) para RECHAZAR la generación antes de escribir", () => {
    const r = construirVouchersVuelo({ ...base, filas: [fila({ id: 1, servicio_aereo: S1 }), fila({ id: 2 }), fila({ id: 5 })] });
    assert.deepEqual(r.sinAsociar, [2, 5]);
  });
  test("sin tramos no se emite ningún voucher", () => {
    assert.deepEqual(construirVouchersVuelo({ ...base, filas: [] }), { servicios: [], sinAsociar: [] });
  });
});

describe("vueloVisible: el PNR (por tramo) solo con el contrato 100 % pagado (falla cerrado)", () => {
  const c = construirVouchersVuelo({ ...base, filas: [fila({ id: 1, record: "ABC123", servicio_aereo: S1, direccion: "ida" }), fila({ id: 2, record: "XYZ789", servicio_aereo: S1, direccion: "regreso", orden: 1 })] }).servicios[0].contenido;
  const pagadoSi = async () => true, pagadoNo = async () => false;
  test("aliado: ya pasó la comprobación de pago al abrir; no se consulta otra vez", async () => {
    let llamadas = 0;
    const r = await vueloVisible(c, "aliado", "DTM-1", async () => { llamadas++; return true; });
    assert.deepEqual([r.contenido.tramos.map((t) => t.pnr), llamadas], [["ABC123", "XYZ789"], 0]);
  });
  test("interno con contrato pagado: ve cada PNR en su tramo (una consulta)", async () => {
    let llamadas = 0;
    const r = await vueloVisible(c, "interno", "DTM-1", async () => { llamadas++; return true; });
    assert.deepEqual([r.contenido.tramos.map((t) => t.pnr), r.pnrPendientePago, llamadas], [["ABC123", "XYZ789"], false, 1]);
  });
  test("interno con contrato NO pagado: ningún PNR llega al objeto y se avisa", async () => {
    const r = await vueloVisible(c, "interno", "DTM-1", pagadoNo);
    assert.equal(r.pnrPendientePago, true);
    assert.doesNotMatch(JSON.stringify(r.contenido), /ABC123|XYZ789|pnr/i);
  });
  test("un error al leer el pago NIEGA (nunca se infiere «pagado» de un fallo)", async () => {
    const r = await vueloVisible(c, "interno", "DTM-1", async () => { throw new Error("red"); });
    assert.equal(r.pnrPendientePago, true);
    assert.doesNotMatch(JSON.stringify(r.contenido), /ABC123|XYZ789/);
  });
  test("sin PNR guardado no hay consulta ni aviso (cero peticiones añadidas)", async () => {
    let llamadas = 0;
    const r = await vueloVisible(sinPnr(c), "interno", "DTM-1", async () => { llamadas++; return pagadoSi(); });
    assert.deepEqual([llamadas, r.pnrPendientePago, tienePnr(r.contenido)], [0, false, false]);
  });
});

describe("acceso por token: un voucher aéreo que no es vigente nunca se sirve como vigente (ADL-042)", () => {
  const tok = "11111111-2222-3333-4444-555555555555";
  const contrato = { tenant: "mayorista", b2b_usuario_id: null, aliado_id: 9601, agencia_nombre: "Agencia X", freelance_nombre: null };
  const deps = (estado: string | undefined, rol: string, pagado = true): DepsAccesoVoucher => ({
    sesion: async () => ({ id: "u" }),
    perfil: async () => ({ id: "u", rol, tenant: "mayorista", nombre: "N", activo: true, aliadoId: rol === "agencia" ? 9601 : null, accesoLegacyNombre: null }),
    voucher: async () => ({ id: 1, numero_contrato: "DTM-1", tipo: "vuelo", contenido: { clase: "vuelo" }, ...(estado ? { estado } : {}) }),
    visibleParaInterno: async () => true, contrato: async () => contrato, fichaManual: async () => false, pagadoCompleto: async () => pagado,
  });
  test("aliado dueño y pagado: vigente abre; revisar y retirado → no_vigente (sin itinerario)", async () => {
    assert.equal((await resolverAccesoVoucher(tok, deps("vigente", "agencia"))).ok, true);
    assert.equal((await resolverAccesoVoucher(tok, deps(undefined, "agencia"))).ok, true);
    assert.deepEqual(await resolverAccesoVoucher(tok, deps("revisar", "agencia")), { ok: false, motivo: "no_vigente", estado: "revisar" });
    assert.deepEqual(await resolverAccesoVoucher(tok, deps("retirado", "agencia")), { ok: false, motivo: "no_vigente", estado: "retirado" });
  });
  test("el estado NO revela nada antes de autorizar: sin pago el motivo sigue siendo pago_incompleto", async () => {
    assert.deepEqual(await resolverAccesoVoucher(tok, deps("retirado", "agencia", false)), { ok: false, motivo: "pago_incompleto" });
  });
  test("interno: recibe el voucher con su estado (la página decide: retirado sin itinerario, revisar con aviso)", async () => {
    const r = await resolverAccesoVoucher(tok, deps("revisar", "administracion"));
    assert.equal(r.ok && r.voucher.estado, "revisar");
    assert.equal(esVoucherVigente({ estado: "revisar" }), false);
    assert.equal(esVoucherVigente({ estado: "retirado" }), false);
    assert.equal(esVoucherVigente({ estado: "vigente" }), true);
    assert.equal(esVoucherVigente({}), true);
  });
});

describe("Gestión de contratos: la señal «voucher actualizado» es interna y no afirma entrega", () => {
  const f = (v: Record<string, unknown>) => ({ voucher: { n: 2, entrega: "pendiente", acuseAnterior: true, actualizado: true, evento: "marcar", en: "2026-11-12T15:30:00Z", actor: "Ana", canal: "correo", nota: null, ...v } }) as never;
  test("actualizado tras una entrega registrada: «comunicación pendiente», sin decir que el cliente lo vio", () => {
    const v = voucherEntregaVista(f({}));
    assert.equal(v.texto, "Voucher actualizado: comunicación pendiente");
    assert.match(v.detalle ?? "", /no indica que el cliente haya recibido, leído ni aceptado/);
    assert.equal(v.tono, "warn");
  });
  test("un voucher NUEVO (sin cambio de contenido en el mismo enlace) conserva el texto de la 309", () => {
    assert.equal(voucherEntregaVista(f({ actualizado: false })).texto, "Entrega sin registrar (voucher nuevo)");
  });
  test("la generación dice «actualizado (mismo enlace)» y no «entregado»", () => {
    const g = voucherGeneracionVista(f({}));
    assert.match(g.detalle ?? "", /actualizado \(mismo enlace\)/);
    assert.doesNotMatch(g.texto + (g.detalle ?? ""), /entregado|recibido/i);
  });
  test("un voucher de vuelo desactualizado o retirado se ve en la generación: avisa, no dice que está entregado ni vigente", () => {
    const g = voucherGeneracionVista(f({ aereoNoVigente: 1 }));
    assert.match(g.texto, /vuelo desactualizado/);
    assert.match(g.detalle ?? "", /no muestra el itinerario anterior/);
    assert.equal(g.tono, "warn");
  });
  test("la respuesta de la RPC se valida: `actualizado` y `aereo_no_vigente` llegan tipados y su ausencia es false/0", () => {
    const filaRaw = (extra: Record<string, unknown>) => ({
      numero: "DTM-1", uid: "u", tenant: "mayorista", cliente: null, destino: null, tipo_paquete: null, fecha_venta: null, fecha_salida: null, fecha_regreso: null, estado: null, estado_grupo: "otro",
      financiero_pendiente: false, moneda_oferta: "COP", precio_oferta: null, moneda_cobro: "COP", cobro_convertido: false, total: null, pagado: 0, saldo: null, saldo_clase: "sin_total", n_abonos: 0,
      voucher: { n: 1, entrega: "pendiente", acuse_anterior: true, evento: "marcar", en: null, actor: null, canal: null, nota: null, ...extra },
      factura: { emitida: false, estado: "sin_factura", contable: false, dian: false, registros: 0, envio: "sin_factura", evento: null, en: null, actor: null, canal: null, nota: null },
      comision: { clase: "no_aplica", filas: 0 },
    });
    const r = (extra: Record<string, unknown>) => parsearRespuesta({ total: 1, limite: 25, desplazamiento: 0, resumen: [], filas: [filaRaw(extra)] }).filas[0].voucher;
    assert.equal(r({ actualizado: true }).actualizado, true);
    assert.equal(r({}).actualizado, false);
    assert.equal(r({ aereo_no_vigente: 2 }).aereoNoVigente, 2);
    assert.equal(r({}).aereoNoVigente, 0);
  });
});

describe("cableado y migración 338", () => {
  const mig = leer("supabase/migrations/20260601000338_voucher_vuelo_por_servicio_y_revision.sql");
  const sql = mig.replace(/--.*$/gm, "");
  test("índice único por (contrato, servicio), llave obligatoria para el tipo vuelo y la función de 337 reemplazada", () => {
    assert.match(mig, /create unique index vouchers_vuelo_uno_por_servicio on public\.vouchers \(numero_contrato, servicio_clave\) where tipo = 'vuelo'/);
    assert.match(mig, /drop index public\.vouchers_vuelo_uno_por_contrato/);
    assert.match(mig, /drop function public\.guardar_voucher_vuelo\(text, jsonb\)/);
    assert.match(mig, /vouchers_vuelo_exige_clave/);
    assert.match(mig, /security invoker/);
  });
  test("la revisión solo sube con un cambio REAL (la fecha de emisión no cuenta) y un reintento idéntico y vigente no toca la fila", () => {
    assert.match(mig, /where \(v\.contenido - 'emision'\) is distinct from \(excluded\.contenido - 'emision'\) or v\.estado <> 'vigente'/);
    assert.match(mig, /revision = v\.revision \+ case when \(v\.contenido - 'emision'\) is distinct from \(excluded\.contenido - 'emision'\) then 1 else 0 end/);
  });
  test("no borra vouchers ni datos: retira (estado) y conserva el historial", () => {
    assert.doesNotMatch(sql, /delete from public\.vouchers|truncate/i);
    assert.match(sql, /estado = 'retirado'/);
  });
  test("ADL-042: la identidad del servicio es una columna guardada; el PNR no interviene; sin asociar NO se adivina", () => {
    assert.match(sql, /add column servicio_aereo uuid/);
    assert.match(sql, /SERVICIO_AEREO_SIN_ASOCIAR/);
    assert.match(sql, /SERVICIOS_CAMBIARON/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('voucher_vuelo\|'/);
    const rpc = sql.slice(sql.indexOf("create function public.guardar_vouchers_vuelo"), sql.indexOf("drop function public.guardar_voucher_vuelo"));
    assert.doesNotMatch(rpc, /\.record\b|pnr/i);
  });
  test("V5-1: un solo protocolo de candado — la generación lo toma ANTES de validar y todo escritor de tramos lo toma en un trigger BEFORE (orden global: ventas, luego advisory)", () => {
    const rpc = sql.slice(sql.indexOf("create function public.guardar_vouchers_vuelo"), sql.indexOf("drop function public.guardar_voucher_vuelo"));
    assert.ok(rpc.indexOf("public.bloquear_voucher_vuelo(p_numero)") > 0 && rpc.indexOf("public.bloquear_voucher_vuelo(p_numero)") < rpc.indexOf("SERVICIO_AEREO_SIN_ASOCIAR"), "el candado va antes de cualquier validación");
    assert.match(sql, /create trigger t_00_tramo_candado before insert or update or delete on public\.contrato_vuelos for each row/);
    assert.match(sql, /hashtextextended\('voucher_vuelo\|' \|\| v_a, 0\)/, "misma llave que la generación");
    const ayudante = sql.slice(sql.indexOf("create function public.bloquear_voucher_vuelo"), sql.indexOf("revoke all on function public.bloquear_voucher_vuelo"));
    assert.ok(ayudante.indexOf("for key share") > 0 && ayudante.indexOf("for key share") < ayudante.indexOf("pg_advisory_xact_lock"), "ventas primero, advisory después");
    assert.match(sql, /if v_a is not null and v_b is not null and v_a > v_b then/, "dos contratos (renumeración) se bloquean en orden fijo");
  });
  test("V5-2: el disparador invalida por CUALQUIER columna guardada (fila completa), no por una lista a mano; la huella usa también la fila completa", () => {
    const disp = sql.slice(sql.indexOf("create function public.fn_tramo_marca_vouchers"), sql.indexOf("revoke all on function public.fn_tramo_marca_vouchers"));
    assert.match(disp, /fn_marcar_voucher_servicio\(new\.numero_contrato, new\.servicio_aereo, true\)/, "UPDATE compara la huella guardada");
    assert.doesNotMatch(disp, /old\.vuelo_ida|old\.aerolinea/, "ya no hay lista de campos que olvidar");
    const huella = sql.slice(sql.indexOf("create function public.huella_servicio_aereo"), sql.indexOf("revoke all on function public.huella_servicio_aereo"));
    assert.match(huella, /to_jsonb\(c\) - 'orden' - 'numero_contrato'\)::text, '\|' order by c\.orden, c\.id/, "fila completa, en orden de presentación, sin el valor absoluto de orden");
    assert.match(sql, /add column huella text/);
    assert.match(sql, /do update set contenido = excluded\.contenido, huella = excluded\.huella/, "la generación guarda la huella con la que construyó el contenido");
  });
  test("las tres funciones de la 309 se recrean con cambios solo del voucher, sin tocar el resto", () => {
    const m309 = leer("supabase/migrations/20260601000309_gestion_contratos_superadmin.sql");
    for (const fn of ["seguimiento_referencia", "registrar_seguimiento_contrato", "fn_gestion_contratos"]) {
      assert.ok(m309.includes(`create or replace function public.${fn}(`) && mig.includes(`create or replace function public.${fn}(`), fn);
    }
    assert.ok(mig.includes("'rev', coalesce(sum(v.revision), 0)"));
    assert.ok(mig.includes("'actualizado', p.vou_actualizado"));
    assert.ok(mig.includes("'aereo_no_vigente', coalesce(p.vo_no_vig, 0)"));
    const cuerpo = (src: string, fn: string) => { const i = src.indexOf(`create or replace function public.${fn}(`); const fin = src.indexOf(`on function public.${fn}(`, i); const l = src.slice(i, fin).split("\n"); return l.slice(0, l.length - 1); };
    for (const fn of ["seguimiento_referencia", "registrar_seguimiento_contrato", "fn_gestion_contratos"]) {
      const viejo = cuerpo(m309, fn), nuevoC = cuerpo(mig, fn), sV = new Set(viejo), sN = new Set(nuevoC);
      const quitadas = viejo.filter((l) => !sN.has(l)), puestas = nuevoC.filter((l) => !sV.has(l));
      assert.ok(quitadas.length <= 6 && puestas.length >= 1 && puestas.length <= 8, `${fn}: -${quitadas.length} +${puestas.length}`);
      assert.ok([...quitadas, ...puestas].every((l) => /voucher|vo_|vou_|max_id|rev|'rev'|acuse_anterior|actualizado|338|signal|superseded|vouchers|no_vig/.test(l) || l.trim().startsWith("--")), `${fn}: cambió algo que no es del voucher`);
    }
  });
  test("generarVoucherVuelo rechaza ANTES de la RPC si hay tramos sin servicio y lee el servicio guardado", () => {
    const a = leer("app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
    const cuerpo = a.slice(a.indexOf("export async function generarVoucherVuelo"), a.indexOf("export async function actualizarVoucher"));
    assert.match(cuerpo, /select\("id, record, servicio_aereo,/);
    assert.ok(cuerpo.indexOf("sinAsociar.length") < cuerpo.indexOf('rpc("guardar_vouchers_vuelo"'));
    assert.match(cuerpo, /SERVICIOS_CAMBIARON/);
  });
  test("el editor de vuelos envía el servicio de cada tramo y valida su forma en la frontera", () => {
    assert.match(leer("app/(dashboard)/dashboard/vuelos/contrato-vuelos-actions.ts"), /servicio: oNull\(t\.servicio\)/);
    assert.match(leer("app/(dashboard)/dashboard/vuelos/frontera-tramos.ts"), /RE_SERVICIO/);
  });
  test("la página del voucher no entrega el itinerario de un voucher retirado, ni uno no vigente a un aliado", () => {
    const pg = leer("app/voucher/[token]/page.tsx");
    assert.match(pg, /motivo === "no_vigente"/);
    assert.match(pg, /estadoVoucher === "retirado"/);
    assert.match(pg, /data-testid="voucher-desactualizado"/);
  });
  test("el contrato al cliente no lee ni dibuja el PNR en código", () => {
    const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(sinComentarios(leer("components/contrato/ContratoDocumento.tsx")), /\.record\b|\brecord:|PNR/);
    assert.doesNotMatch(sinComentarios(leer("app/contrato/[numero]/page.tsx")), /\.record\b|\brecord[,:]/);
  });
  test("el panel interno rotula la actualización como señal interna y muestra los estados «desactualizado»/«retirado»", () => {
    const p = leer("app/(dashboard)/dashboard/contratos/[numero]/VouchersPanel.tsx");
    assert.match(p, /data-testid="voucher-vuelo-actualizado"/);
    assert.match(p, /no indica que el cliente lo haya recibido ni visto/);
    assert.match(p, /data-testid="voucher-vuelo-desactualizado"/);
    assert.match(p, /data-testid="voucher-vuelo-retirado"/);
  });
});
