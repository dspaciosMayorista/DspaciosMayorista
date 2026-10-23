// #49 · presentación móvil de tablas operativas (lote 1: Facturación y Leads).
//
// Monta los componentes REALES en jsdom con el shell `ResponsiveTableShell`.
// En jsdom el contenedor mide 0 px de ancho, así que el shell apila las filas
// (mismo modo que en un celular) sin depender de un media query de viewport.
// Comprueba que:
//   - la tabla se envuelve en el shell y queda en modo apilado;
//   - cada celda conserva su etiqueta de columna (data-label);
//   - contrato/cliente/importes/estado y todos los datos del lead siguen
//     visibles, incluidos enlaces y acciones;
//   - la búsqueda sigue filtrando y la fila de Facturación se expande con
//     teclado/tacto (aria-expanded + aria-controls).
//
// Es una prueba de presentación: no ejecuta acciones de servidor ni toca la
// base. Las acciones de Facturación se sirven con un stub (ver reactLoader).
import { dom, montar } from "./support/fechaNegocioArnes.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { formatMoneda } from "../lib/utils.ts";

const React = await import("react");
const { FacturacionClient } = await import("../app/(dashboard)/dashboard/contabilidad/facturacion/FacturacionClient.tsx");
const { LeadsClient } = await import("../app/(crm)/crm/leads/LeadsClient.tsx");
const h = React.createElement;

after(() => dom.window.close());

const etiquetas = (tabla: Element) => [...tabla.querySelectorAll("tbody tr")[0].querySelectorAll("td")].map((td) => td.getAttribute("data-label"));
const shellDe = (tabla: Element) => {
  const shell = tabla.parentElement as HTMLElement;
  assert.match(shell.className, /(^|\s)stacked(\s|$)/, "el contenedor no está en modo apilado");
  return shell;
};
async function pulsarBoton(contenedor: Element, texto: string) {
  const boton = [...contenedor.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  assert.ok(boton, `no se encontró el botón ${texto}`);
  await React.act(async () => {
    boton!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}
async function escribir(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  await React.act(async () => {
    setter.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

const FACTURA_SIN_CONFIGURAR = {
  numero_contrato: "CT-2026-000123456789",
  cliente: "Agencia de Viajes y Turismo Internacional Los Andes S.A.S.",
  destino: "Cartagena",
  mes: "2026-10",
  precio_venta: 1289456700,
  moneda: "COP",
  monedaOrig: "USD",
  trm: 4123.45,
  estado: "confirmado",
  irtProveedores: 834567800,
  dianEmitida: false,
  cfg: null,
};
const FACTURA_CONFIGURADA = {
  ...FACTURA_SIN_CONFIGURAR,
  numero_contrato: "CT-2026-000987654321",
  cliente: "Operador Mayorista del Caribe S.A.S.",
  precio_venta: 987654321,
  irtProveedores: 123456789,
  cfg: { irt: 123456789, ingresoExento: 5000000, tipoExento: "exento" as const, observacion: "Nota tributaria" },
};
const fmt = (n: number) => formatMoneda(n, "COP");

test("Facturación: fichas apiladas con las seis columnas y sus enlaces", async () => {
  const m = await montar(h(FacturacionClient, { rows: [FACTURA_SIN_CONFIGURAR, FACTURA_CONFIGURADA], ivaPct: 0.19 }));
  try {
    await pulsarBoton(m.contenedor, "Todos");
    const tabla = m.contenedor.querySelector("table")!;
    shellDe(tabla);
    assert.deepEqual(etiquetas(tabla), ["Contrato", "Cliente", "PVP", "IRT", "Ingreso propio", "Estado"]);

    const texto = m.contenedor.textContent ?? "";
    assert.ok(texto.includes(FACTURA_SIN_CONFIGURAR.numero_contrato));
    assert.ok(texto.includes(FACTURA_SIN_CONFIGURAR.cliente), "nombre de cliente largo");
    assert.ok(texto.includes(fmt(FACTURA_SIN_CONFIGURAR.precio_venta)), "PVP");
    assert.ok(texto.includes(fmt(FACTURA_CONFIGURADA.irtProveedores)), "IRT");
    assert.ok(texto.includes(fmt(FACTURA_CONFIGURADA.precio_venta - FACTURA_CONFIGURADA.irtProveedores)), "ingreso propio");
    assert.ok(texto.includes("Por defecto"));
    assert.ok(texto.includes("Configurado"));

    const enlace = m.contenedor.querySelector(`a[href="/dashboard/contratos/${encodeURIComponent(FACTURA_SIN_CONFIGURAR.numero_contrato)}"]`);
    assert.ok(enlace, "el número de contrato debe seguir enlazado");

    const busqueda = m.contenedor.querySelector<HTMLInputElement>('input[placeholder="Buscar contrato, cliente o destino…"]')!;
    assert.match(busqueda.className, /w-full/, "la búsqueda debe ocupar el ancho en móvil");
    assert.match(busqueda.className, /sm:w-72/, "y conservar el ancho de escritorio");
    await escribir(busqueda, "no-existe-este-contrato");
    assert.match(m.contenedor.textContent ?? "", /Sin contratos en este filtro\./);
  } finally {
    await m.desmontar();
  }
});

test("Facturación: la fila se expande con un control accesible y muestra la configuración", async () => {
  const m = await montar(h(FacturacionClient, { rows: [FACTURA_CONFIGURADA], ivaPct: 0.19 }));
  try {
    await pulsarBoton(m.contenedor, "Configurados");
    const boton = m.contenedor.querySelector<HTMLButtonElement>('button[aria-controls^="facturacion-editor-"]')!;
    assert.ok(boton, "falta el botón de configuración");
    assert.equal(boton.getAttribute("aria-expanded"), "false");
    assert.ok(boton.getAttribute("aria-label")?.includes(FACTURA_CONFIGURADA.numero_contrato));

    await React.act(async () => {
      boton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(boton.getAttribute("aria-expanded"), "true");

    const editor = m.contenedor.querySelector(`[id="${boton.getAttribute("aria-controls")}"]`)!;
    assert.ok(editor, "el editor no aparece al expandir");
    const te = editor.textContent ?? "";
    assert.match(te, /Ingreso exento \/ excluido/);
    assert.match(te, /Liquidación/);
    assert.match(te, /Quitar \(volver al por defecto\)/);
    assert.ok(editor.querySelector("input[type=number]"), "el campo de ingreso exento");
  } finally {
    await m.desmontar();
  }
});

const LEAD = {
  id: 77,
  tenant: "mayorista",
  etapa: "calificado" as const,
  canal: "whatsapp" as const,
  nombre: "María Fernanda de los Ángeles Rodríguez y Asociados",
  telefono: "+57 300 123 4567 ext. 890",
  email: "maria.fernanda.rodriguez-contratos@agencia-internacional.example",
  tipo_doc: "NIT",
  documento: "900.123.456-7",
  interes: "Paquete Cartagena + San Andrés para 12 personas, salida 24/12/2026",
  origen_detalle: "Campaña Instagram «Navidad en el Caribe»",
  notas: "Prefiere contacto por WhatsApp después de las 6 p. m.; solicita factura electrónica.",
  responsable_id: "r-1",
  proxima_accion_at: "2026-10-01T15:00:00.000Z",
  cerrado_at: null,
  created_at: "2026-09-20T10:00:00.000Z",
  updated_at: "2026-09-20T10:00:00.000Z",
};
const RESPONSABLE = { id: "r-1", nombre: "Laura Gómez", email: "laura@agencia.test", rol: "venta", tenant: "mayorista" };

test("Leads: ficha apilada con contacto, origen, etapa, responsable y próxima acción", async () => {
  const m = await montar(h(LeadsClient, { leads: [LEAD], responsables: [RESPONSABLE], puedeReasignar: false, usuarioId: "u-1" }));
  try {
    const tabla = m.contenedor.querySelector("table")!;
    shellDe(tabla);
    assert.deepEqual(etiquetas(tabla), ["Lead", "Origen", "Etapa", "Responsable", "Próxima acción"]);

    const celdas = [...tabla.querySelectorAll("tbody tr")[0].querySelectorAll("td")];
    assert.equal(celdas[0].children.length, 1, "Lead debe tener UN bloque de contenido junto a la etiqueta");
    assert.equal(celdas[1].children.length, 1, "Origen debe tener UN bloque de contenido junto a la etiqueta");
    assert.match(celdas[0].className, /fichaBloque/, "la etiqueta Lead se alinea con la primera línea");
    assert.match(celdas[1].className, /fichaBloque/, "la etiqueta Origen se alinea con la primera línea");
    const bloqueLead = celdas[0].firstElementChild as HTMLElement;
    const bloqueOrigen = celdas[1].firstElementChild as HTMLElement;
    for (const bloque of [bloqueLead, bloqueOrigen]) {
      assert.match(bloque.className, /min-w-0/, "el bloque no puede comprimirse por debajo de su contenido");
      assert.match(bloque.className, /flex-1/, "el bloque debe ocupar el ancho disponible junto a la etiqueta");
      assert.match(bloque.className, /text-left/, "los datos de la ficha se leen alineados a la izquierda");
    }
    assert.ok(bloqueLead.querySelector("a"), "el enlace del lead vive dentro del bloque");
    assert.ok(bloqueLead.querySelector(`.soloEscritorio`), "el resumen corto se conserva para escritorio");
    assert.ok(bloqueLead.querySelector(`.soloApilado`), "los datos completos viven en el mismo bloque");

    const texto = m.contenedor.textContent ?? "";
    for (const valor of [
      LEAD.nombre, LEAD.telefono, LEAD.email, `${LEAD.tipo_doc} ${LEAD.documento}`, LEAD.interes,
      LEAD.origen_detalle, LEAD.notas, "WhatsApp", "Calificado", RESPONSABLE.nombre,
    ]) {
      assert.ok(texto.includes(valor), `no se muestra: ${valor}`);
    }
    assert.ok(!texto.includes("Sin identificador"));

    const enlace = m.contenedor.querySelector(`a[href="/crm/leads/${LEAD.id}"]`);
    assert.ok(enlace, "el nombre del lead debe seguir enlazado a su ficha");
    const fecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(LEAD.proxima_accion_at));
    assert.ok(texto.includes(fecha), "la próxima acción debe verse completa");
  } finally {
    await m.desmontar();
  }
});

test("Leads: la búsqueda y el filtro por etapa siguen disponibles en la ficha apilada", async () => {
  const m = await montar(h(LeadsClient, { leads: [LEAD], responsables: [RESPONSABLE], puedeReasignar: false, usuarioId: "u-1" }));
  try {
    const busqueda = m.contenedor.querySelector<HTMLInputElement>('input[placeholder^="Buscar nombre"]')!;
    const cajaBusqueda = busqueda.parentElement!;
    assert.match(cajaBusqueda.className, /(^|\s)w-full(\s|$)/, "el buscador ocupa el ancho completo en móvil");
    assert.match(cajaBusqueda.className, /sm:w-auto/, "el buscador conserva su ancho flexible de escritorio");
    assert.match(cajaBusqueda.className, /sm:flex-1/, "el buscador sigue creciendo junto al filtro en escritorio");
    await escribir(busqueda, "maria.fernanda.rodriguez-contratos@agencia-internacional.example");
    assert.ok(m.contenedor.querySelector(`a[href="/crm/leads/${LEAD.id}"]`), "la búsqueda por correo debe conservar el lead");

    await escribir(busqueda, "sin-resultados-posibles");
    assert.match(m.contenedor.textContent ?? "", /No hay leads con esos filtros\./);

    await escribir(busqueda, "");
    const selector = m.contenedor.querySelector<HTMLSelectElement>("select")!;
    assert.match(selector.className, /(^|\s)w-full(\s|$)/, "el filtro de etapa ocupa su propia línea en móvil");
    assert.match(selector.className, /sm:w-auto/, "el filtro conserva su ancho de escritorio");
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
      setter.call(selector, "archivado");
      selector.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.match(m.contenedor.textContent ?? "", /No hay leads con esos filtros\./);
  } finally {
    await m.desmontar();
  }
});
