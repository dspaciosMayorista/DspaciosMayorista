// R3-1 / R3-2 — DOCUMENTO DEL CLIENTE de los contratos creados por el recorrido real (pruebas/r2Acciones95.pg.ts): comparativa/cotización → pago previo → contrato → saldo.
// Renderiza los componentes REALES (`ContratoDocumento` y `CotizacionManualDocumento`) con las filas PERSISTIDAS que vuelca ese recorrido (docs/tecnico/evidencia-r3-95-2026-11-23/*.json: ventas, contrato_items,
// contrato_pasajeros, abonos y la cotización hija) y las mismas props que arma app/contrato/[numero]/page.tsx. Exige EXACTITUD: ninguna tolerancia.
//   · el total que imprime el contrato = ventas.precio_venta = Σ de sus líneas = el total de la cotización elegida (al centavo);
//   · total pagado y saldo = precio − pagado; pagado por completo → «Saldo pendiente» en cero;
//   · la línea de ajuste («Ajuste por redondeo») aparece solo cuando hay residuo, sin personas ni tarifas; la fila agrupada y la tarifa REAL del niño se conservan;
//   · «Servicio / Plan» trae la copia editada del hotel elegido y nada del otro hotel; ningún costo/proveedor.
// Se ejecuta con el loader del arnés (JSX): `npm run test:react:bloque95`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement, type ComponentType } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { CotizacionManualDocumento } = await import("../components/contrato/CotizacionManualDocumento.tsx");
const { cobroDeVenta } = await import("../lib/finanzas/cobro.ts");
const { formatMoneda } = await import("../lib/utils.ts");
const { formatoExacto } = await import("../lib/contrato/repartoTarifa.ts");
const DIR = "docs/tecnico/evidencia-r3-95-2026-11-23";
const AJUSTE = "Ajuste de redondeo del reparto del hotel";

type Fila = { adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; descripcion: string };
const archivos = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /_(parcial|completo)\.json$/.test(f)).sort() : [];
const centavos = (n: number) => Math.round(n * 100);
const limpio = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ").replace(/\$ /g, "$");
// Importes como los imprime el documento: COP a la unidad; USD con sus centavos cuando los tiene (formatoExacto).
const imp = (n: number, moneda: string) => (moneda === "USD" ? formatoExacto(n, moneda).replace(/\s+/g, " ") : formatMoneda(n, moneda).replace(/\s+/g, ""));

function renderContrato(d: Record<string, any>): string {
  const venta = d.venta;
  const props = {
    venta: { cliente_telefono: null, cliente_direccion: null, asesor_firma_nombre: venta.asesor, asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, fecha_emision: "2030-02-01", agencia_nombre: null, freelance_nombre: null, ...venta },
    pasajeros: d.pasajeros, hoteles: d.hoteles, vuelos: [], items: d.items, totalPagado: d.pagado, cobro: cobroDeVenta(venta), agencia: AGENCIA_PRUEBA, condiciones: null,
    habitacionesBernalo: [], resumenPrecios: null, netoTotalExigible: null, estancia: null,
  };
  return limpio(renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props)));
}
function renderCotizacion(d: Record<string, any>): string {
  const cot = d.cotizacion_hija;
  const det = cot.detalle as { items: { descripcion: string; cantidad?: number; tarifa_unit?: number; valor: number }[]; incluye?: string; noIncluye?: string };
  const venta = { cliente: cot.cliente, destino: cot.destino, fecha_salida: cot.fecha_salida, fecha_regreso: cot.fecha_regreso, pax: cot.pax, ninos: Number(cot.payload?.ninos ?? 0), precio_venta: Number(cot.precio_venta), moneda: cot.moneda };
  return limpio(renderToStaticMarkup(createElement(CotizacionManualDocumento as ComponentType<Record<string, unknown>>, {
    codigo: cot.codigo ?? "", venta, items: det.items, cliente: cot.payload?.cliente ?? {}, incluye: det.incluye ?? null, noIncluye: det.noIncluye ?? null, vigenciaHasta: cot.vigencia_hasta, fechaEmision: "2030-02-01", agencia: AGENCIA_PRUEBA, logoAliado: null,
  })));
}

test("hay volcados de contratos del recorrido real (si falta, corre antes pruebas/r2Acciones95.pg.ts con R2_EVIDENCIA)", () => {
  assert.ok(archivos.length >= 16, `se esperaban ≥ 16 volcados (8 opciones × parcial/completo) y hay ${archivos.length}`);
});

for (const archivo of archivos) {
  test(`documento · ${archivo.replace(".json", "")}`, (t) => {
    const d = JSON.parse(fs.readFileSync(`${DIR}/${archivo}`, "utf8")) as Record<string, any>;
    const ctx = d.contexto as { fase: "parcial" | "completo"; total: number; ajusteEsperado: number; opcion: "A" | "B"; moneda: string };
    const moneda = ctx.moneda;
    const items = d.items as Fila[];
    const precio = Number(d.venta.precio_venta);
    const pagado = Number(d.pagado);
    const sumaLineas = items.reduce((s, i) => s + centavos(Number(i.adultos) * Number(i.tarifa_adulto)) + centavos(Number(i.ninos) * Number(i.tarifa_nino)), 0);

    // Persistido == elegido == líneas, al centavo (sin tolerancia).
    assert.equal(centavos(precio), centavos(ctx.total), "precio persistido = total de la opción elegida");
    assert.equal(sumaLineas, centavos(precio), "Σ líneas = precio persistido");
    const hija = d.cotizacion_hija;
    assert.equal(centavos(Number(hija.precio_venta)), centavos(precio), "la cotización hija elegida vale lo mismo que el contrato");
    const sumaCotizacion = (hija.detalle.items as { valor: number }[]).reduce((s, i) => s + centavos(Number(i.valor)), 0);
    assert.equal(sumaCotizacion, centavos(precio), "las líneas de la cotización suman su precio");

    const doc = renderContrato(d);
    const cot = renderCotizacion(d);
    t.diagnostic(`${archivo}: precio=${precio} pagado=${pagado} → ${doc.slice(doc.indexOf("Valores y Pagos"), doc.indexOf("Valores y Pagos") + 420)}`);

    // Total, pagado y saldo impresos = precio, pagado y precio − pagado (formato de la moneda del contrato).
    const saldo = (centavos(precio) - centavos(pagado)) / 100;
    assert.ok(doc.includes(`Total del contrato ${imp(precio, moneda)}`), `total impreso ${imp(precio, moneda)}`);
    assert.ok(doc.includes(`Total pagado ${imp(pagado, moneda)}`), `pagado impreso ${imp(pagado, moneda)}`);
    assert.ok(doc.includes(`Saldo pendiente ${imp(saldo, moneda)}`), `saldo impreso ${imp(saldo, moneda)}`);
    if (ctx.fase === "completo") {
      assert.equal(saldo, 0, "pagado por completo");
      assert.ok(doc.includes(`Saldo pendiente ${imp(0, moneda)}`), "pagado por completo → saldo en cero (nunca un residuo inventado)");
    } else {
      assert.ok(saldo > 0, "pago parcial → hay saldo real");
    }
    // La cotización elegida imprime el mismo total que el contrato.
    assert.ok(cot.includes(imp(precio, moneda)), `la cotización elegida imprime el mismo total ${imp(precio, moneda)}`);

    // B95-19 (owner 2026-11-26, SUPERA la aserción de R3-1): la línea de ajuste sigue GUARDADA (Σ líneas = precio persistido; datos históricos intactos) pero el documento del CLIENTE ya no imprime la fila
    // «Ajuste por redondeo»: el residuo va dentro de la tarifa de los adultos y la fila agrupada y la tarifa REAL del niño se conservan. Las filas impresas suman el total exacto.
    const aj = items.filter((i) => i.descripcion === AJUSTE);
    if (ctx.ajusteEsperado === 0) assert.equal(aj.length, 0, "sin residuo no hay línea guardada");
    else assert.equal(aj.length, 1, "con residuo la línea sigue guardada (la suma de las líneas guardadas es el precio)");
    assert.ok(!doc.includes("Ajuste por redondeo") && !doc.includes("redondeo") && !doc.includes("reparto del hotel"), "ni fila de ajuste ni texto de redondeo en el documento del cliente");
    assert.ok(!cot.includes("Ajuste por redondeo"), "ni en la cotización elegida");
    const paquete = items.find((i) => i.descripcion.startsWith("PAQUETE TURÍSTICO A "))!;
    assert.ok(doc.includes("PAQUETE TURÍSTICO A CARTAGENA"), "la fila agrupada se conserva");
    assert.equal(paquete.ninos, 1);
    // Tarifa del adulto = (adultos × tarifa guardada + residuo) ÷ adultos, con su precisión de cálculo; la del niño, la real guardada.
    const tarifaAdulto = (centavos(Number(paquete.adultos) * Number(paquete.tarifa_adulto)) + centavos(ctx.ajusteEsperado)) / Number(paquete.adultos) / 100;
    const impT = (n: number) => (moneda === "USD" ? formatoExacto(n, moneda).replace(/\s+/g, " ") : formatoExacto(n, moneda).replace(/\s+/g, ""));
    assert.ok(doc.includes(`${impT(tarifaAdulto)} ${imp(Number(paquete.tarifa_nino), moneda)}`), `la fila muestra la tarifa por adulto ${impT(tarifaAdulto)} (con el residuo) y la tarifa REAL del niño`);
    // El valor total de la fila agrupada = lo guardado de paquete + residuo; con el niño real, las filas visibles suman el precio.
    const totalFila = centavos(Number(paquete.adultos) * Number(paquete.tarifa_adulto)) + centavos(ctx.ajusteEsperado) + centavos(Number(paquete.ninos) * Number(paquete.tarifa_nino));
    assert.equal(totalFila, centavos(precio), "la fila agrupada (con el residuo) vale exactamente el precio del contrato");

    // R3-2: copia editada del hotel elegido en «Servicio / Plan»; nada del otro hotel; sin costos ni proveedores.
    const esperadoPlan = ctx.opcion === "A" ? "Hotel A · Superior · PAM · Triple" : "Hotel B · Estándar · PC · Doble";
    assert.ok(doc.includes(`Servicio / Plan ${esperadoPlan}`), `«Servicio / Plan» = ${esperadoPlan}`);
    assert.ok(!doc.includes(ctx.opcion === "A" ? "Hotel B" : "Hotel A"), "solo el hotel elegido");
    for (const prohibido of ["costo neto", "NETO", "comisión"]) assert.ok(!doc.includes(prohibido), `el documento no expone «${prohibido}»`);
    assert.ok(doc.includes("Titular Sintético"), "titular");
  });
}
