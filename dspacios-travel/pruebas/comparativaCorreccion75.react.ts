// Se ejecuta con npm run test:react (loader del arnés).
// #75 · ronda de correcciones: cuadre del documento hijo (PVP y NETO con vuelo manual), Incluye ordenado, salida pasada y edición visible del Ítem.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { PresentacionComparativaEditor } = await import("../components/cotizacion/PresentacionComparativaEditor.tsx");
const { VigenciaTexto } = await import("../components/cotizacion/VigenciaTexto.tsx");
const { valoresNetosDocumento } = await import("../lib/contrato/valoresNetosDocumento.ts");
const { tituloPaqueteTuristico, tituloPaqueteEditado } = await import("../lib/contrato/paqueteTuristicoDocumento.ts");
const { sugerirIncluye } = await import("../lib/cotizacion/incluye.ts");
const { snapshotPaqueteDePayload } = await import("../lib/cotizacion/tarifaPaquete.ts");
const { construirPlanB2B } = await import("../lib/cotizacion/asistidaB2B.ts");
const { abiertaConSalidaPasada, salidaPasada } = await import("../lib/cotizacion/vigencia.ts");
const { descripcionCotizacionManual, tramosVueloManual, validarServicioManual } = await import("../lib/cart/servicioManual.ts");

const plano = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const venta = {
  numero_contrato: "", cliente: "Agencia Aliada", cliente_documento: "900", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora",
  asesor_firma_nombre: "Asesora", asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente",
  fecha_emision: "2030-01-10", fecha_salida: "2030-03-01", pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista",
};
function doc(extra: Record<string, unknown>) {
  const props = { venta, pasajeros: [], hoteles: [], vuelos: [], items: [], totalPagado: 0, esCotizacion: true, codigo: "COT-1", agencia: null, condiciones: null, ...extra };
  return plano(renderToStaticMarkup(createElement(ContratoDocumento, props as unknown as Parameters<typeof ContratoDocumento>[0])));
}
const item = (id: number, descripcion: string, adultos: number, ninos: number, ta: number, tn: number) =>
  ({ id, numero_contrato: "", descripcion, adultos, ninos, tarifa_adulto: ta, tarifa_nino: tn, orden: id, modo_precio: null, valor_total: null });
const vueloManual = (id: number, pax: number, precio: number, impuestoNoComisionable = 0) => {
  const r = validarServicioManual({ clase: "vuelo", nombre: "Avianca", pax, precio, moneda: "COP", impuestoNoComisionable, tramo: "ida_regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", hotelRef: "item-0", horaIda: null, horaRegreso: null }, "COP");
  assert.ok(r.ok);
  if (!r.ok) throw new Error("vuelo inválido");
  const linea = { id, numero_contrato: "", descripcion: descripcionCotizacionManual(r.valor), adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: id, modo_precio: "total", valor_total: precio };
  const vuelos = tramosVueloManual(r.valor, true).map((v, i) => ({ id: id * 10 + i, numero_contrato: "", ...v }));
  return { linea, vuelos, valor: r.valor };
};
/** Snapshot congelado que el servidor le da al documento: payload con alojamiento + manuales/tours; en NETO, además el plan B2B (10 % sobre lo comisionable). */
function snapshot(o: { hotelPvp: number; manuales?: unknown[]; tours?: unknown[]; neto?: { lineas: { clave: string; pvp: number; impuesto: number }[] } }) {
  const payload: Record<string, unknown> = { items: [{ precio: o.hotelPvp }], tours: o.tours ?? [], manuales: o.manuales ?? [] };
  let exigible: number | null = null;
  if (o.neto) {
    const r = construirPlanB2B({ aliado: { id: 1, nombre: "Aliado", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo: "neta", moneda: "COP", lineas: o.neto.lineas, actor: { id: "u", email: null, rol: "venta" }, congeladoEn: "2030-01-01T00:00:00Z" });
    assert.ok(r.ok);
    if (!r.ok) throw new Error("plan");
    payload.b2bAsistido = r.plan;
    exigible = r.plan.total_exigible;
  }
  return { snap: snapshotPaqueteDePayload(payload, exigible), exigible };
}
const tour = (pax: number, precio: number) => ({ nombre: "City tour", destino: null, precio, pax });
const HOTEL = "Hotel Almirante — CARTAGENA · 1 hab Doble (2 pax) · Estándar / PAM";

describe("documento hijo con vuelo manual: la fila del paquete suma el total mostrado", () => {
  const { linea, vuelos, valor } = vueloManual(2, 2, 500_000, 120_000);
  const items = [item(1, HOTEL, 2, 0, 700_000, 0), linea];
  const pvpSnap = snapshot({ hotelPvp: 1_400_000, manuales: [valor] });
  // NETO con plan: comisión 10 % solo sobre lo comisionable (hotel 1.400.000 + vuelo 500.000 − 120.000 de impuesto) = 178.000 → exigible 1.722.000.
  const netoSnap = snapshot({ hotelPvp: 1_400_000, manuales: [valor], neto: { lineas: [{ clave: "item-0", pvp: 1_400_000, impuesto: 0 }, { clave: "manual-0", pvp: 500_000, impuesto: 120_000 }] } });
  test("NETO con plan congelado: total 1.722.000 = fila 1.722.000 = 2 × 861.000; sin nota ni el reparto anterior", () => {
    const t = doc({ items, vuelos, netoTotalExigible: netoSnap.exigible, paqueteSnapshot: netoSnap.snap });
    assert.match(t, /Total del contrato \$ 1\.722\.000/);
    assert.match(t, /Paquete Turístico 2 0 \$ 861\.000 \$ 0 \$ 1\.722\.000/);
    assert.doesNotMatch(t, /El total exigible incluye|incluye el valor de los vuelos/);
    assert.doesNotMatch(t, /665\.227|1\.330\.455/);
    assert.doesNotMatch(t, /Vuelo · Avianca/, "el vuelo no sale como importe individual");
    assert.equal(t.split("1.722.000").length - 1, 3, "total, saldo y fila: ni sumado dos veces ni repetido");
  });
  test("PVP: total = fila, tarifa por adulto = la mitad, sin nota", () => {
    const t = doc({ items, vuelos, netoTotalExigible: null, paqueteSnapshot: pvpSnap.snap });
    assert.match(t, /Total del contrato \$ 1\.900\.000/);
    assert.match(t, /Paquete Turístico 2 0 \$ 950\.000 \$ 0 \$ 1\.900\.000/);
    assert.doesNotMatch(t, /incluye el valor de los vuelos/);
  });
  test("reintento: renderizar de nuevo con los mismos datos congelados da el mismo documento", () => {
    const a = doc({ items, vuelos, netoTotalExigible: netoSnap.exigible, paqueteSnapshot: netoSnap.snap });
    assert.equal(doc({ items: structuredClone(items), vuelos: structuredClone(vuelos), netoTotalExigible: netoSnap.exigible, paqueteSnapshot: structuredClone(netoSnap.snap) }), a);
  });
  test("con menores y vuelo no se inventa tarifa individual: se muestra el total agregado y las filas cuadran", () => {
    const conNino = [item(1, HOTEL, 2, 0, 500_000, 0), item(3, "Hotel Almirante — CARTAGENA · Niño 1 · Estándar / PAM", 0, 1, 0, 250_000), linea];
    const t = doc({ items: conNino, vuelos, netoTotalExigible: 1_650_000.35, paqueteSnapshot: snapshot({ hotelPvp: 1_250_000, manuales: [valor] }).snap });
    assert.match(t, /Total del contrato \$ 1\.650\.000,35/);
    assert.doesNotMatch(t, /incluye el valor de los vuelos/);
    const fila = /Paquete Turístico 2 1 — — \$ ([0-9.,]+)/.exec(t);
    assert.ok(fila, "un único ítem con adultos, niños y tarifas individuales ocultas");
    assert.equal(Math.round(Number(fila[1].replace(/\./g, "").replace(",", ".")) * 100), 165_000_035);
  });
});

describe("hija NETO con hotel de precio total (Bernalo) y vuelo manual: nunca importes PVP como NETO", () => {
  const { linea, vuelos } = vueloManual(3, 2, 500_000);
  const hotelTotal = { id: 1, numero_contrato: "", descripcion: "Hotel Bernalo · 1 hab", adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: 1, modo_precio: "total", valor_total: 1_000_000 };
  const svc = { id: 2, numero_contrato: "", descripcion: "Servicio · City tour", adultos: 2, ninos: 0, tarifa_adulto: 100_000, tarifa_nino: 0, orden: 2, modo_precio: null, valor_total: null };
  const centavos = (x: string) => Math.round(Number(x.replace(/\./g, "").replace(",", ".")) * 100);
  test("NETO: el vuelo se absorbe en la fila total; fila + servicio = total exigible al centavo; sin importes PVP", () => {
    const t = doc({ items: [hotelTotal, svc, linea], vuelos, netoTotalExigible: 1_400_000.35 });
    assert.match(t, /Total del contrato \$ 1\.400\.000,35/);
    assert.doesNotMatch(t, /1\.000\.000|500\.000|1\.700\.000/, "ningún importe PVP");
    const fila = centavos(/Hotel Bernalo · 1 hab \$ ([\d.,]+)/.exec(t)![1]);
    const serv = centavos(/City tour \S+ \$ ([\d.,]+)/.exec(t)![1]);
    assert.equal(fila + serv, 140_000_035);
  });
  test("NETO sin fila que absorba el vuelo: solo el total agregado, ningún importe por fila", () => {
    const t = doc({ items: [svc, linea], vuelos, netoTotalExigible: 250_000.35 });
    assert.match(t, /Total del contrato \$ 250\.000,35/);
    assert.doesNotMatch(t, /200\.000|700\.000|500\.000/, "ningún importe PVP");
    assert.doesNotMatch(t, /City tour \S+ \$/);
  });
  test("PVP: sin cambios, filas = total PVP", () => {
    const t = doc({ items: [hotelTotal, svc, linea], vuelos, netoTotalExigible: null });
    assert.match(t, /Total del contrato \$ 1\.700\.000/);
    assert.match(t, /Hotel Bernalo · 1 hab \$ 1\.500\.000/);
  });
});

describe("valoresNetosDocumento: reparto exacto con menores, servicios y vuelo oculto", () => {
  const suma = (m: Map<number, { total: number }>, ids: number[]) => ids.reduce((s, id) => s + Math.round((m.get(id)?.total ?? 0) * 100), 0);
  const por = (id: number, a: number, n: number, ta: number, tn: number) => ({ id, modo_precio: "por_persona", valor_total: null, adultos: a, ninos: n, tarifa_adulto: ta, tarifa_nino: tn });
  const tot = (id: number, v: number) => ({ id, modo_precio: "total", valor_total: v, adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0 });
  test("adultos × tarifa + menores × tarifa con centavos repartidos suman exactamente el total visible", () => {
    const v = valoresNetosDocumento([por(1, 2, 2, 500_000, 250_000)], 1_333_333.33)!.get(1)!;
    assert.equal(Math.round((v.adultoTotal + v.ninoTotal) * 100), 133_333_333);
    assert.equal(Math.round(v.total * 100), 133_333_333);
  });
  test("vuelo oculto + servicio comisionable: lo visible suma el total y el vuelo queda en cero", () => {
    const items = [por(1, 2, 1, 500_000, 250_000), por(2, 3, 0, 40_000, 0), tot(3, 900_000)];
    const m = valoresNetosDocumento(items, 1_999_999.99, new Set([3]))!;
    assert.equal(m.get(3)!.total, 0);
    assert.equal(suma(m, [1, 2]), 199_999_999);
  });
  test("sin parte visible a la que atribuir el vuelo no se fabrica un desglose", () => {
    assert.equal(valoresNetosDocumento([tot(3, 900_000)], 800_000, new Set([3])), null);
  });
});

describe("Incluye: orden fijo, sin categorías ausentes ni duplicados", () => {
  test("tiquetes, hotel, traslados/tours, otros servicios, asistencia médica", () => {
    const t = sugerirIncluye([
      { tipo: "asistencia", nombre: "Assist" }, { tipo: "otro", nombre: "Seguro de equipaje" }, { tipo: "traslado", nombre: "Aeropuerto" },
      { tipo: "hotel", nombre: "Hotel A" }, { tipo: "aereo", nombre: "Avianca" }, { tipo: "hotel", nombre: "hotel a" }, { tipo: "tour", nombre: "City tour" },
    ]);
    assert.deepEqual(t.split("\n"), ["Tiquetes aéreos (Avianca)", "Alojamiento en Hotel A", "Traslados (Aeropuerto)", "City tour", "Seguro de equipaje", "Asistencia médica (Assist)"]);
    assert.equal(sugerirIncluye([{ tipo: "hotel", nombre: "Hotel A" }, { tipo: "asistencia", nombre: "" }]), "Alojamiento en Hotel A\nAsistencia médica");
  });
});

describe("salida pasada", () => {
  test("solo caduca una ABIERTA con salida anterior a hoy; sin salida o el mismo día no", () => {
    assert.equal(salidaPasada("2030-03-01", "2030-03-02"), true);
    assert.equal(salidaPasada("2030-03-01", "2030-03-01"), false);
    assert.equal(salidaPasada(null, "2030-03-02"), false);
    assert.equal(abiertaConSalidaPasada({ estado: "abierta", fecha_salida: "2030-03-01" }, "2030-03-02"), true);
    for (const estado of ["convertida", "descartada"]) assert.equal(abiertaConSalidaPasada({ estado, fecha_salida: "2030-03-01" }, "2030-03-02"), false);
  });
  test("el listado/ficha marcan «Vencida» aunque no haya vigencia registrada", () => {
    const h = plano(renderToStaticMarkup(createElement(VigenciaTexto, { vigencia: null, estado: "abierta", hoy: "2030-03-02", fechaSalida: "2030-03-01" })));
    assert.match(h, /Vencida/);
    assert.doesNotMatch(plano(renderToStaticMarkup(createElement(VigenciaTexto, { vigencia: null, estado: "abierta", hoy: "2030-03-02", fechaSalida: null }))), /Vencida/);
  });
  test("cableado: listado, ficha, enlace público, portal, acciones del servidor y base usan la misma regla", () => {
    const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    for (const p of ["app/(dashboard)/dashboard/cotizaciones/page.tsx", "app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx", "app/cot/[token]/page.tsx", "app/portal/b2b/page.tsx",
      "app/(dashboard)/dashboard/reservar/actions.ts", "app/(dashboard)/dashboard/cotizaciones/manual-actions.ts", "app/tarifario/checkout/actions.ts", "lib/cotizacion/comparativaDocumento.tsx"]) {
      assert.match(leer(p), /abiertaConSalidaPasada/, p);
    }
    assert.match(leer("supabase/migrations/20260601000253_cotizacion_salida_pasada_guarda.sql"), /COTIZACION_SALIDA_PASADA/);
  });
});

describe("editor de presentación: el Ítem es visible y su vista previa muestra la descripción final", () => {
  const opciones = [{ clave: "A/unica", titulo: "Opción A · Hotel A", lineas: [{ indice: 0, descripcion: "Hotel A · 1 hab Doble" }], incluyeSugerido: "", noIncluyeSugerido: "" }];
  const render = (edicion: Record<string, unknown>) => plano(renderToStaticMarkup(createElement(PresentacionComparativaEditor, { opciones, edicion, onChange: () => {} } as never)));
  test("rotula «Ítem del documento», aclara que solo cambia la descripción y previsualiza el texto original", () => {
    const t = render({});
    assert.match(t, /Ítem del documento/);
    assert.match(t, /Cambia solo la descripción del ítem/);
    assert.match(t, /Vista previa del documento Ítem: Hotel A · 1 hab Doble/);
  });
  test("con una edición, la vista previa muestra la descripción final", () => {
    assert.match(render({ "A/unica": { textos: { 0: "  Plan Caribe   todo incluido " } } }), /Vista previa del documento Ítem: Plan Caribe todo incluido/);
  });
});

describe("cotización normal con servicio manual: un solo ítem «Paquete Turístico …»", () => {
  const ventaCot = { ...venta, destino: "CARTAGENA", fecha_salida: "2030-03-01", fecha_regreso: "2030-03-04" };
  const htmlDoc = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(ContratoDocumento, {
    venta: ventaCot, pasajeros: [], hoteles: [], vuelos: [], items: [], totalPagado: 0, esCotizacion: true, codigo: "COT-1", agencia: null, condiciones: null, ...extra,
  } as unknown as Parameters<typeof ContratoDocumento>[0]));
  const centavos = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
  const fila = (html: string) => plano(/<tr[^>]*data-testid="fila-paquete-turistico"[^]*?<\/tr>/.exec(html)?.[0] ?? "");
  const importes = (html: string) => [...fila(html).matchAll(/\$ ([\d.,]+)/g)].map((m) => centavos(m[1]));
  const valorFila = (html: string) => centavos([...fila(html).matchAll(/\$ ([\d.,]+)/g)].at(-1)![1]);
  const svc = { id: 9, numero_contrato: "", descripcion: "Servicio · City tour", adultos: 2, ninos: 0, tarifa_adulto: 200_000, tarifa_nino: 0, orden: 9, modo_precio: null, valor_total: null };

  test("títulos: propuesta con días/noches y edición válida solo de texto", () => {
    assert.equal(tituloPaqueteTuristico("CARTAGENA", "2030-03-01", "2030-03-04"), "Paquete Turístico CARTAGENA 4 días/3 noches");
    assert.equal(tituloPaqueteTuristico("SAN ANDRÉS", "2030-03-01", "2030-03-02"), "Paquete Turístico SAN ANDRÉS 2 días/1 noche");
    assert.equal(tituloPaqueteTuristico("CARTAGENA", null, null), "Paquete Turístico CARTAGENA");
    assert.equal(tituloPaqueteEditado("  Plan   Caribe "), "Plan Caribe");
    assert.equal(tituloPaqueteEditado("ab"), null);
    assert.equal(tituloPaqueteEditado("x".repeat(201)), null);
    assert.equal(tituloPaqueteEditado("hola\u0007mundo"), null);
  });

  describe("sin menores: paquete (hotel + vuelo, una vez) + servicios adicionales = total", () => {
    const { linea, vuelos, valor } = vueloManual(2, 2, 682_000);
    const items = [item(1, HOTEL, 2, 0, 800_000, 0), linea, svc];
    const pvpSnap = snapshot({ hotelPvp: 1_600_000, manuales: [valor], tours: [tour(2, 400_000)] });
    // NETO: 10 % sobre 2.682.000 (todo comisionable) → exigible 2.413.800.
    const netoSnap = snapshot({ hotelPvp: 1_600_000, manuales: [valor], tours: [tour(2, 400_000)], neto: { lineas: [{ clave: "item-0", pvp: 1_600_000, impuesto: 0 }, { clave: "tour-0", pvp: 400_000, impuesto: 0 }, { clave: "manual-0", pvp: 682_000, impuesto: 0 }] } });
    test("PVP: total $2.682.000 = 2 × $1.341.000 (alojamiento 800.000 + vuelo 341.000 + servicio 200.000 por persona), en UNA fila", () => {
      const h = htmlDoc({ items, vuelos, netoTotalExigible: null, paqueteSnapshot: pvpSnap.snap });
      const t = plano(h);
      assert.match(t, /Total del contrato \$ 2\.682\.000/);
      assert.match(fila(h), /Paquete Turístico CARTAGENA 4 días\/3 noches 2 0 \$ 1\.341\.000 \$ 0 \$ 2\.682\.000/);
      assert.equal(valorFila(h), 268_200_000);
      assert.doesNotMatch(t, /\$ 400\.000|\$ 682\.000/, "los importes del vuelo y del servicio no se muestran por separado");
      assert.doesNotMatch(t, /Vuelo · Avianca/);
      assert.equal((h.match(/fila-paquete-turistico/g) ?? []).length, 1, "un único ítem, no una fila por acomodación");
      assert.match(t, /Servicios adicionales/);
    });
    test("NETO: la fila ES el total exigible y el vuelo no se cuenta dos veces", () => {
      const h = htmlDoc({ items, vuelos, netoTotalExigible: netoSnap.exigible, paqueteSnapshot: netoSnap.snap });
      assert.match(plano(h), /Total del contrato \$ 2\.413\.800/);
      assert.equal(valorFila(h), 241_380_000);
      const todos = importes(h); const total = todos[todos.length - 1];
      const partes = todos.slice(0, -1).filter((c) => c > 0); // 2 adultos: una tarifa × 2, o «1 × a» y «1 × b»
      assert.equal(partes.length === 1 ? 2 * partes[0] : partes.reduce((x, y) => x + y, 0), total, "tarifas × cantidad = total");
    });
  });

  describe("con menores y vuelo: no se reparte el vuelo entre adulto y niño sin una decisión comercial", () => {
    const { linea, vuelos, valor } = vueloManual(2, 3, 682_000);
    const snapParcial = snapshot({ hotelPvp: 2_000_000, manuales: [valor], tours: [tour(2, 400_000)] }).snap; // el servicio cubre 2 de los 3 pasajeros
    const items = [item(1, HOTEL, 2, 0, 800_000, 0), item(3, "Hotel Almirante — CARTAGENA · Niño 1 · Estándar / PAM", 0, 1, 0, 400_000), linea, svc];
    for (const [nombre, neto, esperado] of [["PVP", null, 308_200_000], ["NETO", 2_900_000.35, 290_000_035]] as const) {
      test(`${nombre}: Adultos 2, Niños 1, tarifas individuales ocultas ("—") y la fila ya incluye el servicio: es el total`, () => {
        const h = htmlDoc({ items, vuelos, netoTotalExigible: neto, paqueteSnapshot: snapParcial });
        assert.match(fila(h), /2 1 — — \$/);
        assert.equal(valorFila(h), esperado);
        assert.match(plano(h), /No se muestra la tarifa por pasajero: el vuelo cubre 3 de los 2 pasajeros|No se muestra la tarifa por pasajero/);
        assert.match(plano(h), neto === null ? /Total del contrato \$ 3\.082\.000/ : /Total del contrato \$ 2\.900\.000,35/);
      });
    }
  });

  test("cableado: el texto editado viaja del checkout al snapshot y de ahí a los dos documentos", () => {
    const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    assert.match(leer("app/tarifario/checkout/page.tsx"), /tituloPaquete: tituloEditado/);
    assert.match(leer("app/tarifario/checkout/actions.ts"), /tituloPaquete: tituloPaqueteEditado\(/);
    assert.match(leer("app/tarifario/checkout/actions.ts"), /manualesOk\.length && input\.tituloPaquete/);
    for (const p of ["app/cot/[token]/page.tsx", "app/cotizacion/[id]/page.tsx"]) assert.match(leer(p), /tituloPaquete=\{d\.tituloPaquete \?\? null\}/, p);
  });

  test("servicio manual para los 3 pasajeros y con menores: se reparte en centavos entre adultos y niño y las tarifas suman el total", () => {
    const m = validarServicioManual({ clase: "otro", nombre: "City tour", pax: 3, precio: 400_000, moneda: "COP", impuestoNoComisionable: 0 }, "COP");
    assert.ok(m.ok);
    if (!m.ok) return;
    const manual = { ...svc, id: 9, descripcion: descripcionCotizacionManual(m.valor) };
    const h = htmlDoc({ items: [item(1, HOTEL, 2, 0, 800_000, 0), item(3, "Hotel Almirante — CARTAGENA · Niño 1 · Estándar / PAM", 0, 1, 0, 400_000), manual], vuelos: [], paqueteSnapshot: snapshot({ hotelPvp: 2_000_000, manuales: [m.valor] }).snap });
    // 2 adultos × 800.000 + 1 niño × 400.000 + servicio 400.000 entre 3 personas (133.333,34 / 133.333,33 / 133.333,33).
    assert.deepEqual(importes(h), [93_333_334, 93_333_333, 53_333_333, 240_000_000]);
    assert.equal(importes(h)[0] + importes(h)[1] + importes(h)[2], importes(h)[3]);
  });

  test("la edición cambia solo el texto: mismos valores; una edición inválida se ignora", () => {
    const { linea, vuelos } = vueloManual(2, 2, 682_000);
    const items = [item(1, HOTEL, 2, 0, 800_000, 0), linea, svc];
    const base = htmlDoc({ items, vuelos });
    const editado = htmlDoc({ items, vuelos, tituloPaquete: "Plan Caribe 4D/3N" });
    assert.match(fila(editado), /^ ?Plan Caribe 4D\/3N /);
    assert.equal(fila(editado).replace("Plan Caribe 4D/3N", ""), fila(base).replace("Paquete Turístico CARTAGENA 4 días/3 noches", ""));
    assert.match(fila(htmlDoc({ items, vuelos, tituloPaquete: "ab" })), /Paquete Turístico CARTAGENA 4 días\/3 noches/);
  });

  test("sin servicio manual el documento no cambia: sigue una fila por acomodación", () => {
    const h = htmlDoc({ items: [item(1, HOTEL, 2, 0, 800_000, 0), item(3, "Hotel Almirante — CARTAGENA · Niño 1 · Estándar / PAM", 0, 1, 0, 400_000)] });
    assert.doesNotMatch(h, /fila-paquete-turistico/);
    assert.match(plano(h), /Niño 1 · Estándar \/ PAM 0 1/);
  });
});
