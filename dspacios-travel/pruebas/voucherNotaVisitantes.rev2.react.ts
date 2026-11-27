// Rev2 B1-05 / B1-06 — la limitación «no hay pasajero↔tramo» del voucher aéreo: la ve CUALQUIER visitante (interno o aliado), en pantalla y en impresión; con más de un servicio aéreo
// se agrega un aviso visible; la nota INTERNA de PNR pendiente sigue siendo solo interna. Se ejecuta con npm run test:react:rev2. Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { readFileSync } from "node:fs";

const { renderToStaticMarkup } = await import("react-dom/server");
const { VoucherVueloDocumento } = await import("../components/voucher/VoucherVueloDocumento.tsx");
const { construirVouchersVuelo, NOTA_PASAJEROS_TRAMOS, avisoVariosServiciosAereos } = await import("../lib/voucher/vuelo.ts");
const { vueloVisible } = await import("../lib/voucher/pnrVoucher.ts");
const { cuentaServiciosAereosVigentes } = await import("../lib/voucher/serviciosAereosPuro.ts");

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(VoucherVueloDocumento as ComponentType<Record<string, unknown>>, props));
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const fila = (o: Record<string, unknown>) => ({
  id: 1, record: null, servicio_aereo: null, aerolinea: "Aerolínea X", direccion: null, origen_codigo: null, origen_ciudad: null, destino_codigo: null, destino_ciudad: null, numero_vuelo: null, fecha_salida: null,
  hora_salida: null, hora_llegada: null, servicios: null, orden: 0, vuelo_ida: null, vuelo_regreso: null, hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null, fecha_regreso: null, ...o,
});
// Contrato sintético: 4 pasajeros; servicio A (BOG→CTG ida y regreso, PNR AAA111) y servicio B (MDE→CTG ida, PNR BBB222). No existe asignación pasajero↔tramo en ninguna parte.
const PASAJEROS = ["Ana Pérez", "Luis Gómez", "Marta Ríos", "Pedro Soto"];
const SA = "11111111-1111-4111-8111-111111111111";
const SB = "22222222-2222-4222-8222-222222222222";
const { servicios } = construirVouchersVuelo({
  pasajeros: PASAJEROS, titular: "Ana Pérez", nReserva: "DTM-9001", vendedor: "Asesora", emision: "2030-10-01",
  filas: [
    fila({ id: 1, orden: 0, servicio_aereo: SA, record: "AAA111", direccion: "ida", numero_vuelo: "XX1", origen_codigo: "BOG", destino_codigo: "CTG", fecha_salida: "2030-10-15", hora_salida: "06:05", hora_llegada: "07:30" }),
    fila({ id: 2, orden: 1, servicio_aereo: SA, record: "AAA111", direccion: "regreso", numero_vuelo: "XX2", origen_codigo: "CTG", destino_codigo: "BOG", fecha_salida: "2030-10-18", hora_salida: "18:40", hora_llegada: "20:10" }),
    fila({ id: 3, orden: 2, servicio_aereo: SB, record: "BBB222", direccion: "ida", numero_vuelo: "YY7", origen_codigo: "MDE", destino_codigo: "CTG", fecha_salida: "2030-10-15", hora_salida: "09:00", hora_llegada: "10:15" }),
  ] as never,
});

describe("B1-05 · dos servicios aéreos, cuatro pasajeros, sin asignación guardada", () => {
  test("hecho de datos: cada voucher trae SOLO sus tramos pero los CUATRO pasajeros del contrato (no existe vínculo)", () => {
    assert.equal(servicios.length, 2);
    const [a, b] = servicios;
    assert.deepEqual(a.contenido.tramos.map((t) => t.numeroVuelo), ["XX1", "XX2"]);
    assert.deepEqual(b.contenido.tramos.map((t) => t.numeroVuelo), ["YY7"]);
    assert.deepEqual(a.contenido.pasajeros, PASAJEROS);
    assert.deepEqual(b.contenido.pasajeros, PASAJEROS);
  });

  test("con 2 servicios el voucher dice, visible: «Esta reserva tiene 2 servicios aéreos… no registra qué pasajero viaja en cada vuelo»", () => {
    const h = render({ c: servicios[1].contenido, serviciosAereos: 2 });
    assert.match(h, /data-testid="aviso-varios-servicios"/);
    const t = texto(h);
    assert.match(t, /Esta reserva tiene 2 servicios aéreos\. El sistema no registra qué pasajero viaja en cada vuelo/);
    assert.match(t, /no a este vuelo en particular/);
    assert.match(t, /No se debe entender que todos los pasajeros viajan en todos los vuelos/);
    assert.ok(t.includes(avisoVariosServiciosAereos(2)), "es el texto único de lib/voucher/vuelo.ts");
    // Visible: sin clases que lo oculten al imprimir ni tamaño de 10 px.
    const i = h.indexOf('data-testid="aviso-varios-servicios"');
    const etiqueta = h.slice(h.lastIndexOf("<p", i), h.indexOf(">", i));
    assert.doesNotMatch(etiqueta, /print:hidden|hidden|text-\[10px\]/);
  });

  test("con un solo servicio (o sin poder contarlo) NO hay aviso de varios servicios; la nota general se conserva", () => {
    for (const n of [1, 0, null, undefined]) {
      const h = render({ c: servicios[0].contenido, serviciosAereos: n });
      assert.doesNotMatch(h, /aviso-varios-servicios/, `n=${String(n)}`);
      assert.ok(texto(h).includes(NOTA_PASAJEROS_TRAMOS));
    }
  });

  test("la nota general ya no es de 10 px gris claro: se lee (text-xs) y no se oculta al imprimir", () => {
    const h = render({ c: servicios[0].contenido });
    const i = h.indexOf('data-testid="nota-pasajeros-tramos"');
    const etiqueta = h.slice(h.lastIndexOf("<p", i), h.indexOf(">", i));
    assert.match(etiqueta, /text-xs/);
    assert.doesNotMatch(etiqueta, /text-\[10px\]|text-gray-400|print:hidden/);
  });
});

describe("B1-06 · aliado e interno ven lo mismo (misma ruta app/voucher/[token], mismo componente)", () => {
  const pagadoSi = async () => true;
  const pagadoNo = async () => false;
  test("ALIADO (contrato 100 % pagado): ve la nota, el aviso de varios servicios y el PNR; no ve la nota interna", async () => {
    const v = await vueloVisible(servicios[0].contenido, "aliado", "DTM-9001", pagadoNo); // el aliado ya pasó el pago al resolver el acceso: no se vuelve a preguntar
    assert.equal(v.pnrPendientePago, false);
    const h = render({ c: v.contenido, serviciosAereos: 2, pnrPendientePago: v.pnrPendientePago });
    const t = texto(h);
    assert.match(t, /Pasajeros y tramos se listan por separado/);
    assert.match(t, /Esta reserva tiene 2 servicios aéreos/);
    assert.match(t, /PNR \/ Código de reserva AAA111/);
    assert.doesNotMatch(h, /pnr-pendiente-pago/);
  });

  test("INTERNO con contrato SIN pagar: ve la misma nota y aviso, SIN PNR, y además la nota interna (que no se imprime)", async () => {
    const v = await vueloVisible(servicios[0].contenido, "interno", "DTM-9001", pagadoNo);
    assert.equal(v.pnrPendientePago, true);
    const h = render({ c: v.contenido, serviciosAereos: 2, pnrPendientePago: v.pnrPendientePago });
    const t = texto(h);
    assert.match(t, /Pasajeros y tramos se listan por separado/);
    assert.match(t, /Esta reserva tiene 2 servicios aéreos/);
    assert.doesNotMatch(t, /AAA111/);
    const i = h.indexOf('data-testid="pnr-pendiente-pago"');
    assert.ok(i > 0);
    assert.match(h.slice(h.lastIndexOf("<p", i), i), /print:hidden/);
  });

  test("INTERNO con contrato pagado: igual que el aliado (PNR visible, sin nota interna)", async () => {
    const v = await vueloVisible(servicios[0].contenido, "interno", "DTM-9001", pagadoSi);
    const h = render({ c: v.contenido, serviciosAereos: 2, pnrPendientePago: v.pnrPendientePago });
    assert.match(texto(h), /AAA111/);
    assert.doesNotMatch(h, /pnr-pendiente-pago/);
  });

  test("la nota y el aviso son idénticos para ambos modos (único texto, sin condicionarse al visitante)", async () => {
    const a = await vueloVisible(servicios[1].contenido, "aliado", "DTM-9001", pagadoSi);
    const i = await vueloVisible(servicios[1].contenido, "interno", "DTM-9001", pagadoSi);
    const desdePasajeros = (h: string) => texto(h.slice(h.indexOf("Pasajeros de la reserva")));
    assert.equal(desdePasajeros(render({ c: a.contenido, serviciosAereos: 2 })), desdePasajeros(render({ c: i.contenido, serviciosAereos: 2 })));
  });

  test("cableado: la página del voucher cuenta los servicios (solo para el voucher aéreo) y se lo pasa al documento", () => {
    const pagina = readFileSync(new URL("../app/voucher/[token]/page.tsx", import.meta.url), "utf8");
    assert.match(pagina, /contarServiciosAereos\(r\.voucher\.numero_contrato\)/);
    assert.match(pagina, /serviciosAereos=\{serviciosAereos\}/);
    assert.match(pagina, /vuelo \? await contarServiciosAereos/);
  });
});

test("conteo de servicios vigentes: «retirado» no cuenta; «revisar» y estado ausente sí", () => {
  assert.equal(cuentaServiciosAereosVigentes([{ estado: "vigente" }, { estado: "revisar" }, { estado: "retirado" }, { estado: null }, {}]), 4);
  assert.equal(cuentaServiciosAereosVigentes([]), 0);
  assert.equal(cuentaServiciosAereosVigentes([{ estado: "retirado" }]), 0);
});
