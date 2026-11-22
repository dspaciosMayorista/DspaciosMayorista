// #98 — presentación real de la cuenta de cobro (versión aceptada vs. sin aceptar) y de los dos controles del aliado (jsdom). Las Server Actions se sustituyen por dobles. FIXTURES LOCALES.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, File: dom.window.File,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { act } = React;

const aceptaciones: Record<string, unknown>[] = []; let respuestaAceptar: unknown = { ok: true, version: 1, repetida: false };
const firmas: FormData[] = []; let respuestaFirma: unknown = { ok: true, repetida: false };
mock.module(new URL("../app/portal/comision/[numero]/acciones.ts", import.meta.url).href, { namedExports: { aceptarCuentaCobro: async (e: Record<string, unknown>) => { aceptaciones.push(e); return respuestaAceptar; } } });
mock.module(new URL("../app/portal/b2b/perfil/firma-actions.ts", import.meta.url).href, { namedExports: { guardarFirma: async (f: FormData) => { firmas.push(f); return respuestaFirma; } } });

const { CuentaCobroDocumento } = await import("../components/portal/CuentaCobroDocumento.tsx");
const { AceptarCuenta } = await import("../components/portal/AceptarCuenta.tsx");
const { FirmaAliado } = await import("../components/portal/FirmaAliado.tsx");

const detalle = { pvp: 5_000_000, baseComisionable: 4_000_000, pctComision: 0.12, esPctEfectivo: false, esPctPactado: false, comisionBase: 480_000, recobroAliado: null, aplicaRetencion: true, pctRetencion: 0.11, retencion: 52_800, totalPagar: 427_200 };
const snap = (over: Record<string, unknown> = {}) => ({
  v: 1, clave: "ab:31", numeroContrato: "00-0451", concepto: "Comisión por venta — Contrato 00-0451 — Cliente Ana Gómez — Destino San Andrés", fechaSalida: "2027-01-10", moneda: "COP", elaboracion: "2026-11-21",
  aliado: { id: 7, nombre: "Laura Pérez", tipoDocumento: "CC", nit: "52111222", direccion: "Calle 1 # 2-3", telefono: "+573001112233", email: "laura@test.co", titularCuenta: "Laura Pérez", banco: "Bancolombia", tipoCuenta: "Ahorros", numeroCuenta: "000123456" },
  compania: { nombre: "D'SPACIOS TRAVEL", nit: "900.111.222-3", direccion: "Cra 7 # 1-1" }, detalle, ...over,
}) as never;
const IMG = "data:image/png;base64,iVBORw0KGgo=";
const html = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(CuentaCobroDocumento, props as never));
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("versión aceptada: la imagen de firma va ARRIBA del nombre, con versión, fecha y el aviso de que no es firma digital certificada; los importes salen del snapshot", () => {
  const h = html({ snap: snap(), firma: { version: 2, aceptadaEn: "2026-11-21T15:00:00Z", imagen: IMG } });
  const t = texto(h);
  assert.ok(h.indexOf(IMG) > -1 && h.indexOf(IMG) < h.indexOf(">Laura Pérez</p>", h.indexOf("Firma</div>")), "la imagen precede al nombre bajo la línea de firma");
  assert.match(t, /Aceptación electrónica — versión 2, .*21.*2026/);
  assert.match(t, /No es una firma digital certificada/);
  assert.match(h, /data-firma="aceptada"/);
  // importes congelados (hechos a mano): total 427.200, comisión 480.000, retención 52.800
  for (const m of [/427\.200/, /480\.000/, /52\.800/, /4\.000\.000/, /12\.00%/, /11\.0%/]) assert.match(t, m);
  assert.doesNotMatch(t, /Versión sin aceptar/);
});

test("la fecha de elaboración mostrada es la congelada, no la de hoy; los datos bancarios del snapshot se imprimen", () => {
  const t = texto(html({ snap: snap(), firma: { version: 1, aceptadaEn: "2026-11-21T15:00:00Z", imagen: IMG } }));
  assert.match(t, /Fecha de elaboración:.*21.*noviembre.*2026/i);
  assert.match(t, /Bancolombia — Ahorros · A nombre de Laura Pérez · N\.° 000123456/);
});

test("versión sin aceptar: línea de firma vacía, sin imagen, dice «Versión sin aceptar»", () => {
  const h = html({ snap: snap(), firma: null });
  assert.doesNotMatch(h, /<img/); assert.match(h, /data-firma="pendiente"/); assert.match(texto(h), /Versión sin aceptar/);
  assert.doesNotMatch(texto(h), /Aceptación electrónica/);
});

test("aceptada pero la imagen no está disponible: se dice con honestidad y la aceptación se muestra igual", () => {
  const t = texto(html({ snap: snap(), firma: { version: 1, aceptadaEn: "2026-11-21T15:00:00Z", imagen: null } }));
  assert.match(t, /imagen de la firma no está disponible/); assert.match(t, /Aceptación electrónica — versión 1/);
});

test("retención no aplicable: se imprime la declaración del Art. 383 desde el snapshot; USD se formatea en USD", () => {
  const t = texto(html({ snap: snap({ moneda: "USD", detalle: { ...detalle, pvp: 2500, baseComisionable: 2000, comisionBase: 240, aplicaRetencion: false, pctRetencion: null, retencion: null, totalPagar: 240 } }), firma: null }));
  assert.match(t, /NO HACER RETENCIÓN EN LA FUENTE/); assert.match(t, /USD/); assert.match(t, /240/);
});

async function montar(el: unknown) { const cont = document.createElement("div"); document.body.appendChild(cont); const root = createRoot(cont); await act(async () => { root.render(el as never); }); return { cont, root }; }
const boton = (c: HTMLElement, t: string) => [...c.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;

test("AceptarCuenta: el botón exige la casilla; envía número, comisión y el hash visto UNA sola vez; el error del servidor se muestra", async () => {
  aceptaciones.length = 0; respuestaAceptar = { ok: false, error: "El documento cambió mientras lo revisabas.", desfasada: true };
  const { cont, root } = await montar(React.createElement(AceptarCuenta, { numero: "00-0451", comisionId: 31, hash: "h".repeat(64) }));
  assert.equal(boton(cont, "Aceptar y firmar").disabled, true);
  assert.match(cont.textContent ?? "", /no una firma digital certificada/);
  await act(async () => { (cont.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
  assert.equal(boton(cont, "Aceptar y firmar").disabled, false);
  await act(async () => { boton(cont, "Aceptar y firmar").click(); });
  assert.deepEqual(aceptaciones, [{ numero: "00-0451", comisionId: 31, hash: "h".repeat(64) }]);
  assert.match(cont.querySelector('[role="alert"]')?.textContent ?? "", /cambió mientras lo revisabas/);
  await act(async () => root.unmount());
});

test("FirmaAliado: sin archivo no llama al servidor; un archivo grande se rechaza en el cliente; uno válido se envía en el campo «firma»", async () => {
  firmas.length = 0; respuestaFirma = { ok: true, repetida: false };
  const { cont, root } = await montar(React.createElement(FirmaAliado, { imagen: null, vigenteDesde: null }));
  assert.match(cont.textContent ?? "", /Aún no has subido tu firma/);
  await act(async () => { boton(cont, "Subir firma").click(); });
  assert.equal(firmas.length, 0); assert.match(cont.querySelector('[role="alert"]')?.textContent ?? "", /Elige una imagen/);
  const entrada = cont.querySelector('input[type="file"]') as HTMLInputElement;
  assert.equal(entrada.accept, "image/png,image/jpeg");
  const poner = async (f: File) => { Object.defineProperty(entrada, "files", { value: [f], configurable: true }); };
  await poner(new dom.window.File([new Uint8Array(512 * 1024 + 1)], "grande.png", { type: "image/png" }));
  await act(async () => { boton(cont, "Subir firma").click(); });
  assert.equal(firmas.length, 0); assert.match(cont.querySelector('[role="alert"]')?.textContent ?? "", /512 KB/);
  await poner(new dom.window.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "firma.png", { type: "image/png" }));
  await act(async () => { boton(cont, "Subir firma").click(); });
  assert.equal(firmas.length, 1); assert.ok(firmas[0].get("firma")); assert.match(cont.textContent ?? "", /Firma guardada/);
  await act(async () => root.unmount());
});

test("FirmaAliado con firma vigente: muestra la imagen (data URI), la fecha y ofrece «Reemplazar»; un rechazo del servidor se muestra", async () => {
  respuestaFirma = { ok: false, error: "Solo se aceptan imágenes PNG o JPG." };
  const { cont, root } = await montar(React.createElement(FirmaAliado, { imagen: IMG, vigenteDesde: "20 de noviembre de 2026" }));
  assert.equal((cont.querySelector("img") as HTMLImageElement).src, IMG);
  assert.match(cont.textContent ?? "", /conservan la firma con la que se aceptaron/);
  const entrada = cont.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(entrada, "files", { value: [new dom.window.File([new Uint8Array([60, 115])], "x.svg", { type: "image/svg+xml" })], configurable: true });
  await act(async () => { boton(cont, "Reemplazar firma").click(); });
  assert.match(cont.querySelector('[role="alert"]')?.textContent ?? "", /PNG o JPG/);
  await act(async () => root.unmount());
});
