// Renders REAL B2B document components with synthetic props to standalone HTML files (for a layout inspection with the compiled CSS in a real browser).
// NOT a test and NOT part of any suite. Run:  node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs pruebas/support/visual_b2b_render.ts <outDir>
// Limits: no login/DB (props are synthetic); the logo and the signature are inline SVG standing in for the PNG/JPG the authorized routes serve (same box, different pixels).
import fs from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENCIA_PRUEBA } from "./agenciaPrueba.ts";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const svg = (t: string, bg: string, fg: string, w = 360, hh = 120) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><rect width="100%" height="100%" rx="12" fill="${bg}"/><text x="50%" y="56%" text-anchor="middle" font-family="Georgia,serif" font-size="${Math.round(hh * 0.34)}" font-style="italic" fill="${fg}">${t}</text></svg>`)}`;
const LOGO_SRC = svg("Laura Viajes", "#fde68a", "#7c2d12", 480, 160);
const FIRMA_SRC = svg("Laura Gómez", "#ffffff", "#1e3a8a", 360, 120);

const { CuentaCobroDocumento } = await import("../../components/portal/CuentaCobroDocumento.tsx");
const { CotizacionManualDocumento } = await import("../../components/contrato/CotizacionManualDocumento.tsx");
const { ComparativaHoja } = await import("../../components/cotizacion/ComparativaHoja.tsx");
const { LogoAliado } = await import("../../components/portal/LogoAliado.tsx");

const detalle = { pvp: 5_000_000, baseComisionable: 4_000_000, pctComision: 0.12, esPctEfectivo: false, esPctPactado: false, comisionBase: 480_000, recobroAliado: null, aplicaRetencion: true, pctRetencion: 0.11, retencion: 52_800, totalPagar: 427_200 };
const snap = {
  v: 1, clave: "ab:31", numeroContrato: "00-0451", concepto: "Comisión por venta — Contrato 00-0451 — Cliente Ana Gómez — Destino San Andrés", fechaSalida: "2027-01-10", moneda: "COP", elaboracion: "2026-11-21",
  aliado: { id: 7, nombre: "Laura Pérez", tipoDocumento: "CC", nit: "52111222", direccion: "Calle 1 # 2-3, Bogotá", telefono: "+573001112233", email: "laura@test.co", titularCuenta: "Laura Pérez", banco: "Bancolombia", tipoCuenta: "Ahorros", numeroCuenta: "000123456", aplicaRetencion: true },
  compania: { nombre: "D'SPACIOS TRAVEL", nit: "900.111.222-3", direccion: "Cra 7 # 1-1, Bogotá" }, detalle,
};
const venta = {
  numero_contrato: null, cliente: "Ana Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora Interna", asesor_firma_nombre: "Asesora Interna",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2026-11-03", fecha_salida: "2026-12-01", destino: "Cartagena",
  pax: 2, ninos: 0, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: "freelance", freelance_nombre: "Laura Gómez", agencia_nombre: null,
};
const items = [{ descripcion: "PAQUETE TURÍSTICO A CARTAGENA DEL 1 AL 5 DE DICIEMBRE DE 2026", cantidad: 2, tarifa_unit: 2_000_000, valor: 4_000_000 }];
const manual = (extra: Record<string, unknown>) => renderToStaticMarkup(h(CotizacionManualDocumento, { codigo: "C-0001", venta, items, cliente: {}, incluye: "Desayuno\nTraslados aeropuerto-hotel", noIncluye: "Propinas\nGastos personales", vigenciaHasta: "2026-11-30", fechaEmision: "2026-11-03", agencia: AGENCIA_PRUEBA, ...extra } as never));
const MADRE = { codigo: "CMP-001", cliente: "Ana Pérez", destino: "Cartagena", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-14", pax: 2, moneda: "COP", vigencia_hasta: "2026-10-20", created_at: "2026-10-15T10:00:00Z", tenant: "mayorista" };
const GRUPOS = [{ opcionRef: "A", etiqueta: "Hotel A", acomodaciones: [{ opcionRef: "A", acomodacionRef: "unica", etiqueta: "Hotel A", moneda: "COP", tarifaPersona: 900_000, total: 1_800_000, orden: 0 }] }];
const comparativa = (extra: Record<string, unknown>) => renderToStaticMarkup(h(ComparativaHoja, { madre: MADRE, grupos: GRUPOS as never, resumenes: {}, vencida: false, identidad: AGENCIA_PRUEBA, ...extra } as never));

const LOGO = { src: LOGO_SRC, nombre: "Laura Gómez" };
const noop = async () => ({ ok: true as const });
const vistas: Record<string, string> = {
  "cuenta-aceptada": renderToStaticMarkup(h(CuentaCobroDocumento, { snap, firma: { version: 2, aceptadaEn: "2026-11-21T15:00:00Z", imagen: FIRMA_SRC } } as never)),
  "cuenta-sin-aceptar": renderToStaticMarkup(h(CuentaCobroDocumento, { snap, firma: null } as never)),
  "cotizacion-con-logo": manual({ logoAliado: LOGO }),
  "cotizacion-sin-logo": manual({}),
  "comparativa-con-logo": comparativa({ logoAliado: LOGO }),
  "perfil-logo-vacio": renderToStaticMarkup(h("div", { className: "mx-auto max-w-3xl p-4" }, h(LogoAliado, { nombre: "Laura Gómez", src: "/portal/b2b/perfil/logo", puedeCambiar: true, subir: noop, retirar: noop } as never))),
  "perfil-logo-bloqueado": renderToStaticMarkup(h("div", { className: "mx-auto max-w-3xl p-4" }, h(LogoAliado, { nombre: "Agencia Compartida", src: "/portal/b2b/perfil/logo", puedeCambiar: false, motivo: "Tu cuenta comparte la ficha con otra cuenta activa; pide el cambio a tu asesor.", subir: noop, retirar: noop } as never))),
};
for (const [k, v] of Object.entries(vistas)) fs.writeFileSync(path.join(out, `${k}.body.html`), v.replace(/<link rel="preload"[^>]*\/>/g, ""));
console.log("vistas:", Object.keys(vistas).join(", "));
