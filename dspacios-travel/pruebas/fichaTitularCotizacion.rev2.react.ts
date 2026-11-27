// Se ejecuta con npm run test:react:rev2 (loader del arnés).
// B2-11 / B2-12a — la ficha del titular en la pantalla de trabajo de una cotización: se renderiza el componente REAL para cada estado/origen, con datos sintéticos.
// El cableado en la página y el listado se afirma con el código fuente (la página completa necesita Server Actions reales); la lectura real por rol va en fichaTitular931.rev2.pg.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { readFileSync } from "node:fs";

const { renderToStaticMarkup } = await import("react-dom/server");
const { FichaTitularCotizacion } = await import("../components/cotizacion/FichaTitularCotizacion.tsx");
const { fichaTitularCotizacion } = await import("../lib/cotizacion/fichaTitular.ts");

const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
const cli = { nombres: "Ana", apellidos: "Perez", tipoDoc: "CC", numeroDoc: "1010101010", nacimiento: "1990-05-04", telefono: "3001112233", email: "ana@x.test" };
const base = { id: 1, tenant: "mayorista", tipo: "manual", estado: "abierta", cliente: "Ana Perez", pax: 2, creado_por_id: "u1", payload: { cliente: cli } };
const pintar = (fila: Record<string, unknown>, opts: Record<string, unknown> = {}) => {
  const ficha = fichaTitularCotizacion(fila as never, opts as never);
  return renderToStaticMarkup(createElement(FichaTitularCotizacion as ComponentType<Record<string, unknown>>, { ficha, estado: fila.estado }));
};
const titular = (id: string) => (h: string) => texto(h.match(new RegExp(`data-testid="${id}"[^>]*>(.*?)</(?:dd|p|div|ul)>`))?.[1] ?? "");
const dd = (h: string, id: string) => titular(id)(h).trim();

test("cotización dinámica abierta: nombre, «CC número», nacimiento, teléfono y correo a la vista, sin abrir «Ver / Imprimir»", () => {
  const h = pintar(base, { puestos: [{ id: "t", rol: "titular", activo: true }] });
  assert.equal(dd(h, "ficha-nombre"), "Ana Perez");
  assert.equal(dd(h, "ficha-documento"), "CC 1010101010");
  assert.equal(dd(h, "ficha-nacimiento"), "1990-05-04");
  assert.equal(dd(h, "ficha-telefono"), "3001112233");
  assert.equal(dd(h, "ficha-email"), "ana@x.test");
  assert.match(texto(h), /Origen: Cotización dinámica · personal interno/);
  assert.match(texto(h), /Titular registrado en Personas de cotización\./);
  assert.match(texto(h), /Adultos: 2/);
  assert.doesNotMatch(h, /Imprimir/);
});

test("lo que falta dice «No registrado»; no se supone CC ni se inventa un contacto", () => {
  const h = pintar({ ...base, payload: { cliente: { nombres: "Ana", apellidos: "", tipoDoc: "", numeroDoc: "555" } } }, { puestos: null });
  assert.equal(dd(h, "ficha-documento"), "555 (tipo no registrado)");
  for (const id of ["ficha-nacimiento", "ficha-telefono", "ficha-email"]) assert.equal(dd(h, id), "No registrado");
  assert.equal(h.includes('data-testid="ficha-registro"'), false); // sin lectura de puestos no se afirma nada del CRM
});

test("titular de relleno del motor (comparativa madre): «No registrado» y «Sin titular identificado», sin persona inventada", () => {
  const h = pintar({ ...base, modo: "comparativa", cliente: "Cliente", payload: { cliente: { nombres: "Cliente", apellidos: "", numeroDoc: "" } } }, { puestos: [] });
  assert.equal(dd(h, "ficha-nombre"), "No registrado");
  assert.match(texto(h), /Sin titular identificado: no se registra ninguna persona\./);
  assert.match(texto(h), /Origen: Comparativa de opciones/);
});

test("solicitud de hotel de un visitante (pendiente de tarifa): origen, contacto, edades y el aviso de registro pendiente", () => {
  const fila = { ...base, tipo: "tarifario", estado: "pendiente_tarifa", creado_por_id: null, propietario_id: null, aliado_id: null, creado_por: null, paquete_armado_id: 7, pax: 3,
    detalle: { solicitudHotel: { adultos: 2, menores: 1 } }, payload: { cliente: cli, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [7] } };
  const h = pintar(fila, { puestos: [] });
  assert.match(texto(h), /Origen: Solicitud de hotel bajo solicitud · visitante del tarifario público \(sin sesión\)/);
  assert.equal(dd(h, "ficha-telefono"), "3001112233");
  assert.match(texto(h), /Adultos: 2 · Menores: 1 · Niños: 0 · Infantes: 0 · Edades de los menores: 7/);
  assert.match(texto(h), /Pendiente de registrar en Personas de cotización: usa «Reintentar»\./);
});

test("venta B2B del carrito: el aliado se rotula aparte del titular y los viajeros indicados por el aliado se distinguen", () => {
  const fila = { ...base, tipo: "carrito", pax: 3, payload: { cliente: cli, tipoAsesor: "freelance", freelanceNombre: "Freelance Humo", pasajeros: [{ nombres: "Beto", apellidos: "P", tipoDoc: "TI", numeroDoc: "2020" }] } };
  const h = pintar(fila, { puestos: [{ id: "t", rol: "titular", activo: true }], pasajerosAliado: [{ nombres: "Carla", apellidos: "Q", tipoDoc: "CC", numeroDoc: "3030", fechaNacimiento: "1985-02-02" }] });
  assert.match(dd(h, "ficha-aliado"), /Aliado: Freelance Humo \(freelance\) · El titular de abajo es el viajero, no el aliado\./);
  assert.equal(dd(h, "ficha-nombre"), "Ana Perez");
  const v = texto(h.match(/data-testid="ficha-pasajeros"[\s\S]*$/)?.[0] ?? "");
  assert.match(v, /Viajeros con datos guardados \(2\)/);
  assert.match(v, /Beto P TI 2020 Nacimiento: No registrado/);
  assert.match(v, /Carla Q CC 3030 Nac\. 1985-02-02 Indicado por el aliado/);
});

test("estados cerrados: convertida y descartada siguen mostrando al titular; la nota no ofrece «Reintentar» donde ya no aplica", () => {
  const conv = pintar({ ...base, estado: "convertida", numero_contrato: "00-0451" }, { puestos: [] });
  assert.equal(dd(conv, "ficha-nombre"), "Ana Perez");
  assert.match(texto(conv), /No hay un titular activo en Personas de cotización\./);
  assert.doesNotMatch(texto(conv), /Reintentar/);
  assert.match(texto(conv), /convertida/);
  const desc = pintar({ ...base, estado: "descartada" }, { puestos: [{ id: "t", rol: "titular", activo: true }] });
  assert.equal(dd(desc, "ficha-nombre"), "Ana Perez");
  assert.match(texto(desc), /descartada/);
});

test("la explicación del CRM distingue ver / aceptar / descartar / convertir de crear o guardar", () => {
  const t = texto(pintar(base));
  assert.match(t, /¿Cuándo se guarda este titular en el CRM\?/);
  assert.match(t, /al crear o guardar la cotización: no al verla, aceptarla, descartarla ni convertirla/);
  assert.match(t, /Convertir en contrato no crea personas ni contactos nuevos/);
});

test("estructura: una columna en móvil, dos desde sm; sin emojis", () => {
  const h = pintar(base);
  assert.match(h, /grid-cols-1[^"]*sm:grid-cols-2/);
  assert.doesNotMatch(texto(h), /\p{Extended_Pictographic}/u);
});

test("cableado: la página de trabajo monta la ficha en los TRES caminos y el listado trae el contacto del titular", () => {
  const pagina = readFileSync(new URL("../app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx", import.meta.url), "utf8");
  assert.equal((pagina.match(/<FichaTitularCotizacion /g) ?? []).length, 3); // comparativa madre · pendiente de tarifa · cotización normal (manual, carrito, tarifario, dinámica)
  const lista = readFileSync(new URL("../app/(dashboard)/dashboard/cotizaciones/page.tsx", import.meta.url), "utf8");
  assert.match(lista, /titular_doc:payload->cliente->>numeroDoc/);
  assert.match(lista, /enmascararDocumento\(x\.titular_doc\)/);
  assert.match(lista, /data-testid="lista-titular-contacto"/);
});
