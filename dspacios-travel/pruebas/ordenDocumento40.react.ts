// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// #40 E2 · Orden visual de la captura del cliente/titular en las superficies internas del dashboard (el checkout va en ordenDocumentoCheckout40.react.ts):
//   · el PRIMER campo de la sección es «Número de documento», con la acción «Buscar» a su lado; debajo: tipo de documento, nombres, apellidos y contacto;
//   · captura nueva: el tipo NO se presupone (queda sin elegir antes de buscar); edición: se conserva y se muestra el tipo ya guardado;
//   · flujos tras Buscar: sin coincidencias (se elige el tipo y se completan los datos), una coincidencia (se aplica) y el mismo número como CC y como CE
//     (el usuario elige la persona);
//   · en NETO la edición del contrato no ofrece Buscar (el cliente comercial es el aliado, no una persona).
// Cada escenario corre con ancho de ventana de escritorio y de móvil: el orden del DOM (único que define el orden visual en una sola columna) no cambia.
import { montar, clic, escribir, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import { test, describe, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { __setBuscarTitularPorNumero } = await import("./support/stubs/buscarTitularStub.mjs");
const { NuevoContratoForm } = await import("../app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
const { EditarVentaForm } = await import("../app/(dashboard)/dashboard/contratos/[numero]/EditarVentaForm.tsx");
const { TitularEditor } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/TitularEditor.tsx");
const { CotizacionManualForm } = await import("../app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx");
const { ReservaForm } = await import("../app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx");
const { ProgramaReservaForm } = await import("../app/(dashboard)/dashboard/reservar/programa/[id]/ProgramaReservaForm.tsx");
const h = React.createElement;

const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const pausa = () => React.act(async () => { await new Promise((r) => setTimeout(r, 15)); });
async function cambiar(sel: HTMLSelectElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const ancho = (px: number) => { Object.defineProperty(dom.window, "innerWidth", { value: px, configurable: true }); dom.window.dispatchEvent(new dom.window.Event("resize")); };

/** Etiquetas (en orden de documento) que siguen al encabezado de la sección. */
function etiquetasTras(raiz: Element, encabezado: RegExp): HTMLLabelElement[] {
  const cab = [...raiz.querySelectorAll("h2, p, legend, button, span")].find((e) => encabezado.test(txt(e)));
  assert.ok(cab, `no se encontró el encabezado ${encabezado}`);
  return [...raiz.querySelectorAll("label")].filter((l) => cab.compareDocumentPosition(l) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) as HTMLLabelElement[];
}
const etiqueta = (ls: HTMLLabelElement[], prefijo: string) => ls.find((l) => txt(l).startsWith(prefijo));
const campo = (l: HTMLLabelElement | undefined, sel: string) => l?.parentElement?.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;

type Superficie = {
  nombre: string;
  encabezado: RegExp;
  /** Prefijo de la etiqueta del campo de nombre (en edición de contrato es un único «Cliente»). */
  nombres: string;
  montar: (tipoGuardado?: string) => Promise<{ contenedor: Element; desmontar: () => Promise<void> }>;
  abrir?: (raiz: Element) => Promise<void>;
  /** Superficie de edición: muestra un tipo ya guardado. */
  edicion?: boolean;
};

const ASESORES = [{ nombre: "Asesor", email: "a@x.test" }];
const META = {
  paqueteId: 1, hotelId: 1, bloqueoId: null, modulo: "servicios" as const, moneda: "COP", hotelNombre: "Hotel", destino: "CARTAGENA",
  fechaIda: null, fechaRegreso: null, noches: null, bloqueoLabel: null, edadInfanteMax: 1, edadNinoMax: 11, paxMinHotel: null, paxMaxHotel: null,
  petFriendly: false, petNota: null,
};
const EDIT = (tipo: string) => ({
  cliente: "Ana Pérez", clienteDocumento: "123456", clienteTipoDocumento: tipo, clienteTelefono: "300", clienteEmail: "", clienteDireccion: "",
  destino: "CARTAGENA", fechaSalida: "2030-03-01", fechaRegreso: "2030-03-04", plazo: "", tipoAsesor: "interno", agenciaNombre: "", agenciaAsesor: "",
  freelanceNombre: "", asesorNombre: "Asesor", planNombre: "", observaciones: "", precioVenta: "1000000", pax: "2",
});

const SUPERFICIES: Superficie[] = [
  { nombre: "contrato manual (NuevoContratoForm)", encabezado: /^Cliente$/, nombres: "Nombres",
    montar: () => montar(h(NuevoContratoForm, { asesorDefault: "Asesor", agencias: [] })) },
  { nombre: "cotización dinámica (CotizacionManualForm)", encabezado: /^Cliente$/, nombres: "Nombres",
    montar: () => montar(h(CotizacionManualForm, { asesores: [], aliados: [], miNombre: "Asesor", miRolVenta: false, pctAliadoB2B: 0.1 })) },
  { nombre: "reservar (ReservaForm)", encabezado: /^Cliente$/, nombres: "Nombres",
    montar: () => montar(h(ReservaForm, { meta: META, combos: [{ categoria: "Estándar", regimen: "PC", precios: { doble: 1_000_000 } }] })) },
  { nombre: "reservar programa (ProgramaReservaForm)", encabezado: /^Cliente$/, nombres: "Nombres",
    montar: () => montar(h(ProgramaReservaForm, {
      programaId: 1, moneda: "USD", dias: 5, vigenciaDesde: null, vigenciaHasta: null, asesores: ASESORES,
      categorias: [{ id: 1, nombre: "Estándar", precios: [{ acomodacion: "doble", pvp: 1000, bajoSolicitud: false }] }],
    })) },
  { nombre: "titular de la cotización (TitularEditor)", encabezado: /^Datos del titular$/, nombres: "Nombres", edicion: true,
    montar: (tipo = "") => montar(h(TitularEditor, { id: 1, version: 1, inicial: { nombres: "Ana", apellidos: "Pérez", tipoDoc: tipo, numeroDoc: "123456", nacimiento: "1990-01-01", telefono: "300", email: "" } })),
    abrir: async (raiz) => { await clic([...raiz.querySelectorAll("button")].find((b) => txt(b) === "Editar"), "Editar"); } },
  { nombre: "edición del contrato (EditarVentaForm)", encabezado: /^Editar datos del contrato/, nombres: "Cliente", edicion: true,
    montar: (tipo = "") => montar(h(EditarVentaForm, { numero: "00-0001", inicial: EDIT(tipo), destinos: [] })),
    abrir: async (raiz) => { await clic([...raiz.querySelectorAll("button")].find((b) => txt(b).startsWith("Editar datos del contrato")), "Editar datos"); } },
];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; ancho(1280); });
after(() => dom.window.close());

const cand = (tipoDoc: string, nombres: string) => ({ tipoDoc, numero: "123456", divergencia: false, datos: { nombres, apellidos: "Pérez", telefono: "311" } });
async function montarSuperficie(s: Superficie, tipoGuardado?: string) {
  usarBD({});
  const m = await s.montar(tipoGuardado);
  desmontar = m.desmontar;
  if (s.abrir) await s.abrir(m.contenedor);
  return m.contenedor;
}
const buscarBtn = (raiz: Element, ls: HTMLLabelElement[]) => etiqueta(ls, "Número de documento")!.parentElement!.querySelector("button")! as HTMLButtonElement;

for (const [vista, px] of [["escritorio", 1280], ["móvil", 390]] as const) {
  describe(`Orden y flujo del documento · ${vista} (${px}px)`, () => {
    for (const s of SUPERFICIES) {
      describe(s.nombre, () => {
        test("el primer campo es «Número de documento» con «Buscar» al lado; debajo, tipo, nombres, apellidos y contacto", async () => {
          ancho(px);
          const raiz = await montarSuperficie(s);
          const ls = etiquetasTras(raiz, s.encabezado);
          assert.match(txt(ls[0]), /^Número de documento/, "primer campo de la sección");
          assert.equal(txt(buscarBtn(raiz, ls)), "Buscar", "la acción Buscar está en el mismo bloque que el número");
          const pos = (p: string) => ls.findIndex((l) => txt(l).startsWith(p));
          const orden = ["Número de documento", "Tipo de documento", s.nombres].map(pos);
          assert.ok(orden.every((i) => i >= 0), "existen número, tipo y nombre: " + orden.join(","));
          assert.deepEqual([...orden].sort((a, b) => a - b), orden, "número < tipo < nombre");
          if (s.nombres === "Nombres") assert.ok(pos("Apellidos") > pos("Nombres"), "apellidos después de nombres");
          const contacto = Math.min(...["Teléfono", "Email"].map(pos).filter((i) => i >= 0));
          assert.ok(contacto > pos(s.nombres), "el contacto va debajo del nombre");
        });

        if (!s.edicion) {
          test("captura nueva: el tipo no se presupone (sin elegir antes de buscar)", async () => {
            ancho(px);
            const raiz = await montarSuperficie(s);
            const ls = etiquetasTras(raiz, s.encabezado);
            const tipo = campo(etiqueta(ls, "Tipo de documento"), "select") as HTMLSelectElement;
            assert.equal(tipo.value, "");
            assert.match(txt(tipo.options[0]), /Elige el tipo/);
          });
        }

        test("sin coincidencias: se avisa, se elige el tipo y se completan los demás datos", async () => {
          ancho(px);
          __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [] }));
          const raiz = await montarSuperficie(s);
          const ls = etiquetasTras(raiz, s.encabezado);
          await escribir(campo(etiqueta(ls, "Número de documento"), "input") as HTMLInputElement, "999999");
          await clic(buscarBtn(raiz, ls), "Buscar"); await pausa();
          assert.match(txt(raiz), /Sin coincidencias\. Elige el tipo de documento y completa los demás datos/);
          assert.equal([...raiz.querySelectorAll("button")].some((b) => txt(b) === "Aplicar datos"), false, "nada que aplicar");
          const tipo = campo(etiqueta(ls, "Tipo de documento"), "select") as HTMLSelectElement;
          await cambiar(tipo, "CE");
          assert.equal(tipo.value, "CE");
          const nombre = campo(etiqueta(ls, s.nombres), "input") as HTMLInputElement;
          await escribir(nombre, "Zoe");
          assert.equal(nombre.value, "Zoe");
        });

        test("una coincidencia: se propone sola y «Aplicar datos» llena tipo y datos", async () => {
          ancho(px);
          __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [cand("CC", "Ana")] }));
          const raiz = await montarSuperficie(s, s.edicion ? "CE" : undefined);
          const ls = etiquetasTras(raiz, s.encabezado);
          const numero = campo(etiqueta(ls, "Número de documento"), "input") as HTMLInputElement;
          await escribir(numero, numero.value === "123456" ? "123457" : "123456"); // en edición hay un número guardado: se cambia para forzar la búsqueda
          await clic(buscarBtn(raiz, ls), "Buscar"); await pausa();
          const aplicar = [...raiz.querySelectorAll("button")].find((b) => txt(b) === "Aplicar datos");
          assert.ok(aplicar, "con una sola coincidencia se muestra «Aplicar datos» sin pedir elegir");
          await clic(aplicar, "Aplicar datos");
          assert.equal((campo(etiqueta(ls, "Tipo de documento"), "select") as HTMLSelectElement).value, "CC");
        });

        test("el mismo número como CC y como CE: el usuario elige la persona y se aplica SU tipo", async () => {
          ancho(px);
          __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [cand("CC", "Ana"), cand("CE", "Beto")] }));
          const raiz = await montarSuperficie(s, s.edicion ? "CC" : undefined);
          const ls = etiquetasTras(raiz, s.encabezado);
          const numero = campo(etiqueta(ls, "Número de documento"), "input") as HTMLInputElement;
          await escribir(numero, numero.value === "123456" ? "123457" : "123456");
          await clic(buscarBtn(raiz, ls), "Buscar"); await pausa();
          assert.match(txt(raiz), /elige la persona/);
          assert.equal([...raiz.querySelectorAll("button")].some((b) => txt(b) === "Aplicar datos"), false, "no aplica sin elegir");
          const ce = [...raiz.querySelectorAll("button")].find((b) => txt(b).startsWith("CE 123456"));
          assert.ok(ce, "se ofrece cada persona con su tipo");
          assert.ok([...raiz.querySelectorAll("button")].some((b) => txt(b).startsWith("CC 123456")));
          await clic(ce, "persona CE");
          await clic([...raiz.querySelectorAll("button")].find((b) => txt(b) === "Aplicar datos"), "Aplicar datos");
          assert.equal((campo(etiqueta(ls, "Tipo de documento"), "select") as HTMLSelectElement).value, "CE");
          // Captura nueva: se llena con la persona elegida. Edición: el nombre ya guardado NO se pisa en silencio (solo con la casilla de reemplazo).
          assert.match((campo(etiqueta(ls, s.nombres), "input") as HTMLInputElement).value, s.edicion ? /Ana/ : /Beto/);
        });

        if (s.edicion) {
          test("al editar se conserva y se muestra el tipo ya guardado (sin presuponer CC)", async () => {
            ancho(px);
            const raiz = await montarSuperficie(s, "CE");
            const ls = etiquetasTras(raiz, s.encabezado);
            assert.equal((campo(etiqueta(ls, "Tipo de documento"), "select") as HTMLSelectElement).value, "CE");
          });
        }
      });
    }

    test("edición del contrato en NETO: sin Buscar (el cliente comercial es el aliado), pero el tipo guardado se muestra y el número va primero", async () => {
      ancho(px);
      usarBD({});
      const m = await montar(h(EditarVentaForm, { numero: "00-0001", inicial: EDIT("NIT"), destinos: [], modalidadNeto: true }));
      desmontar = m.desmontar;
      await clic([...m.contenedor.querySelectorAll("button")].find((b) => txt(b).startsWith("Editar datos del contrato")), "Editar datos");
      const ls = etiquetasTras(m.contenedor, /^Editar datos del contrato/);
      assert.match(txt(ls[0]), /^Número de documento/);
      assert.equal(etiqueta(ls, "Número de documento")!.parentElement!.querySelector("button"), null, "no hay búsqueda de titular sobre el aliado");
      assert.equal((campo(etiqueta(ls, "Tipo de documento"), "select") as HTMLSelectElement).value, "NIT");
    });
  });
}
