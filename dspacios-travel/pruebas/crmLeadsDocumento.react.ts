// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
//
// CRM leads (#351) · identidad documental = TIPO + NÚMERO, de punta a punta en
// la app: el formulario REAL de la bandeja (`LeadsClient.tsx`) y de la ficha
// (`LeadDetalleClient.tsx`) llaman a las Server Actions REALES de
// `app/(crm)/crm/leads/actions.ts`, que hablan con un cliente de Supabase
// simulado. Lo que se comprueba:
//   - un número sin tipo no viaja a la base (no se asume CC);
//   - tipo + número llegan a la RPC como `tipo_doc` + `documento`;
//   - el selector de tipo arranca vacío en el alta y con el tipo guardado en la ficha;
//   - teléfono/correo compartidos NO bloquean: el lead se crea y se muestra el aviso;
//   - mismo tipo + número: mensaje de duplicado (con id solo si la base lo da);
//   - un lead sin documento se guarda sin tipo ni número;
//   - un rol fuera del módulo no llega a la RPC.
// Las fronteras (Supabase, next/cache, tenant, navegación, DateInput) se sirven
// con un hook de resolución propio, que corre antes que reactLoader.mjs.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/lib/supabase/server": datos("export async function createClient() { return globalThis.__leadsPrueba.sb; }"),
  "next/cache": datos("export function revalidatePath(r) { globalThis.__leadsPrueba.revalidadas.push(r); }"),
  "@/lib/tenant.server": datos("export async function tenantContext() { return { tenant: 'mayorista', home: 'mayorista', puedeCambiar: false }; }"),
  "next/navigation": datos("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; }"),
  "@/components/ui/DateInput": new URL("./support/stubs/dateInputStub.mjs", import.meta.url).href,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FRONTERAS[specifier]) return { url: FRONTERAS[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/crm/leads" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

type Llamada = { nombre: string; args: Record<string, unknown> };
type Respuesta = { data: unknown; error: { message: string } | null };
const estado = {
  rol: "venta",
  llamadas: [] as Llamada[],
  respuesta: (() => ({ data: { id: 12, coincidencias: [] }, error: null })) as (l: Llamada) => Respuesta,
};
const prueba = { sb: null as unknown, revalidadas: [] as string[] };
(globalThis as unknown as { __leadsPrueba: typeof prueba }).__leadsPrueba = prueba;
prueba.sb = {
  auth: { async getUser() { return { data: { user: { id: "00000000-0000-0000-0000-00000000c206" } } }; } },
  from(tabla: string) {
    assert.equal(tabla, "usuarios", "las actions de escritura solo leen el perfil; el lead va por RPC");
    const q = {
      select: () => q,
      eq: () => q,
      async maybeSingle() { return { data: { id: "00000000-0000-0000-0000-00000000c206", email: "venta@local.test", rol: estado.rol, tenant: "mayorista" }, error: null }; },
    };
    return q;
  },
  async rpc(nombre: string, args: Record<string, unknown>) {
    const l = { nombre, args };
    estado.llamadas.push(l);
    return estado.respuesta(l);
  },
};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { LeadsClient } = await import("../app/(crm)/crm/leads/LeadsClient.tsx");
const { LeadDetalleClient } = await import("../app/(crm)/crm/leads/[id]/LeadDetalleClient.tsx");
const { crearLead, actualizarLead, tomarLead } = await import("../app/(crm)/crm/leads/actions.ts");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
  estado.rol = "venta";
  estado.llamadas.length = 0;
  estado.respuesta = () => ({ data: { id: 12, coincidencias: [] }, error: null });
  prueba.revalidadas.length = 0;
});
after(() => dom.window.close());

async function montar(elemento: unknown) {
  const contenedor = document.createElement("div");
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  await React.act(async () => raiz.render(elemento as never));
  desmontar = async () => {
    await React.act(async () => raiz.unmount());
    contenedor.remove();
  };
  return contenedor;
}
const campo = <T extends Element>(raiz: Element, selector: string) => {
  const el = raiz.querySelector<T>(selector);
  assert.ok(el, `no se encontró ${selector}`);
  return el!;
};
function llenar(form: HTMLFormElement, valores: Record<string, string>) {
  for (const [nombre, valor] of Object.entries(valores)) {
    campo<HTMLInputElement | HTMLSelectElement>(form, `[name="${nombre}"]`).value = valor;
  }
}
async function enviar(form: HTMLFormElement, listo: () => boolean) {
  await React.act(async () => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  for (let i = 0; i < 40 && !listo(); i++) {
    await React.act(async () => { await new Promise((r) => setImmediate(r)); });
  }
}
const textoEstado = (raiz: Element) => raiz.querySelector('[role="status"]')?.textContent?.trim() ?? "";
const aviso = (raiz: Element) => raiz.querySelector('[data-testid="aviso-coincidencias"]')?.textContent?.trim() ?? null;

async function bandeja() {
  const raiz = await montar(h(LeadsClient, { leads: [], responsables: [], puedeReasignar: false, usuarioId: "00000000-0000-0000-0000-00000000c206" }));
  const form = campo<HTMLFormElement>(raiz, "form");
  return { raiz, form };
}

test("alta: el selector de tipo arranca vacío (no se asume CC) y ofrece el catálogo", async () => {
  const { form } = await bandeja();
  const tipo = campo<HTMLSelectElement>(form, 'select[name="tipoDoc"]');
  assert.equal(tipo.value, "", "el tipo no viene preseleccionado");
  assert.deepEqual([...tipo.options].map((o) => o.value), ["", "CC", "CE", "TI", "RC", "PAS", "PPT", "NIT"]);
});

test("alta: número sin tipo muestra el error y NO llama a la RPC", async () => {
  const { raiz, form } = await bandeja();
  llenar(form, { nombre: "Ana", documento: "1.020.304" });
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.match(textoEstado(raiz), /Indica el tipo de documento: el numero solo no identifica a la persona\./);
  assert.deepEqual(estado.llamadas, [], "un número sin tipo no debe viajar a la base");
});

test("alta: tipo + número llegan a crm_lead_crear como tipo_doc + documento", async () => {
  const { raiz, form } = await bandeja();
  llenar(form, { nombre: "Hijo", tipoDoc: "TI", documento: "1020304" });
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.equal(estado.llamadas.length, 1);
  assert.equal(estado.llamadas[0].nombre, "crm_lead_crear");
  const p = estado.llamadas[0].args.p_datos as Record<string, string>;
  assert.equal(p.tipo_doc, "TI");
  assert.equal(p.documento, "1020304");
  assert.equal(p.tenant, "mayorista");
  assert.equal(textoEstado(raiz), "Lead #12 creado.");
  assert.equal(aviso(raiz), null, "sin coincidencias no hay aviso");
});

test("alta: teléfono compartido NO bloquea; el lead se crea y se avisa la coincidencia", async () => {
  estado.respuesta = () => ({ data: { id: 13, coincidencias: [{ id: 7, por: ["telefono"] }] }, error: null });
  const { raiz, form } = await bandeja();
  llenar(form, { nombre: "Hermana", telefono: "300 333 0003" });
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.equal(textoEstado(raiz), "Lead #13 creado.");
  assert.match(aviso(raiz) ?? "", /#7 \(teléfono\)/);
  assert.match(aviso(raiz) ?? "", /no se fusionó nada/);
});

test("alta: mismo tipo + número → mensaje de duplicado con el id que da la base, sin aviso", async () => {
  estado.respuesta = () => ({ data: null, error: { message: "crm_lead_duplicado:7" } });
  const { raiz, form } = await bandeja();
  llenar(form, { nombre: "Copia", tipoDoc: "CC", documento: "1020304" });
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.equal(textoEstado(raiz), "Ya existe otro lead con ese tipo y numero de documento (#7).");
  assert.equal(aviso(raiz), null);
});

test("alta: duplicado de un lead ajeno → mensaje genérico, sin id", async () => {
  estado.respuesta = () => ({ data: null, error: { message: "crm_lead_duplicado:" } });
  const { raiz, form } = await bandeja();
  llenar(form, { nombre: "Copia", tipoDoc: "PAS", documento: "AB123" });
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.equal(textoEstado(raiz), "Ya existe otro lead con ese tipo y numero de documento en esta agencia.");
  assert.doesNotMatch(textoEstado(raiz), /#/);
});

test("alta: un lead sin documento se guarda sin tipo ni número", async () => {
  const { raiz, form } = await bandeja();
  llenar(form, { nombre: "Desconocido" });
  await enviar(form, () => textoEstado(raiz) !== "");
  const p = estado.llamadas[0]?.args.p_datos as Record<string, string>;
  assert.equal(p.tipo_doc, "");
  assert.equal(p.documento, "");
  assert.equal(textoEstado(raiz), "Lead #12 creado.");
});

const leadGuardado = {
  id: 5, tenant: "mayorista", etapa: "nuevo", canal: "whatsapp", nombre: "Titular",
  telefono: null, email: null, tipo_doc: "CC", documento: "1020304", interes: null,
  origen_detalle: null, notas: null, responsable_id: "00000000-0000-0000-0000-00000000c206", proxima_accion_at: null,
  cerrado_at: null, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z",
} as const;

async function ficha() {
  const raiz = await montar(h(LeadDetalleClient, {
    lead: leadGuardado as never, actividades: [], responsables: [], puedeReasignar: false,
  }));
  // La ficha tiene tres formularios (datos, etapa, actividad): el de datos es el
  // que contiene el selector de tipo de documento.
  const form = campo<HTMLSelectElement>(raiz, 'select[name="tipoDoc"]').closest("form") as HTMLFormElement;
  assert.ok(form, "no se encontró el formulario de datos de la ficha");
  return { raiz, form };
}

test("ficha: el tipo guardado viene seleccionado y se reenvía con el número", async () => {
  estado.respuesta = () => ({ data: { id: 5, coincidencias: [] }, error: null });
  const { raiz, form } = await ficha();
  assert.equal(campo<HTMLSelectElement>(form, 'select[name="tipoDoc"]').value, "CC");
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.equal(estado.llamadas[0]?.nombre, "crm_lead_actualizar");
  assert.equal(estado.llamadas[0]?.args.p_lead, 5);
  const p = estado.llamadas[0]?.args.p_datos as Record<string, string>;
  assert.equal(p.tipo_doc, "CC");
  assert.equal(p.documento, "1020304");
  assert.equal(textoEstado(raiz), "Lead actualizado.");
});

test("ficha: quitar el tipo y dejar el número no llega a la base", async () => {
  const { raiz, form } = await ficha();
  llenar(form, { tipoDoc: "" });
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.match(textoEstado(raiz), /Indica el tipo de documento/);
  assert.deepEqual(estado.llamadas, []);
});

test("ficha: pasar a un tipo + número que ya tiene otro lead → duplicado, sin aviso", async () => {
  estado.respuesta = () => ({ data: null, error: { message: "crm_lead_duplicado:9" } });
  const { raiz, form } = await ficha();
  llenar(form, { tipoDoc: "TI" });
  await enviar(form, () => textoEstado(raiz) !== "");
  assert.equal(textoEstado(raiz), "Ya existe otro lead con ese tipo y numero de documento (#9).");
  assert.equal(aviso(raiz), null);
});

test("acción: un rol fuera del módulo no llega a la RPC aunque el documento sea válido", async () => {
  for (const rol of ["operaciones", "control_vuelo", "agencia"]) {
    estado.rol = rol;
    const r = await crearLead({ nombre: "X", canal: "otro", tipoDoc: "CC", documento: "1" });
    assert.deepEqual(r, { ok: false, error: "Sin permiso para crear leads." }, rol);
  }
  assert.deepEqual(estado.llamadas, []);
  assert.deepEqual(prueba.revalidadas, []);
});

// ── Server Action: tipos mal formados y entrada validada ─────────────────────
const CLAVES_FORMULARIO = [
  "canal", "documento", "email", "interes", "nombre", "notas", "origen_detalle",
  "proxima_accion_at", "responsable_id", "telefono", "tipo_doc",
];
const llamadas = () => estado.llamadas as Llamada[];

// Lead "en la base" para las pruebas de edición. `crm_lead_actualizar` real
// REEMPLAZA cada campo con lo que recibe ("" = borrar): la simulación hace lo
// mismo, así que si la acción mandara un formulario rellenado con vacíos, los
// datos previos se borrarían aquí igual que en Supabase.
type FilaLead = Record<string, string | null>;
const LEAD_PREVIO: FilaLead = {
  canal: "whatsapp", nombre: "Titular", telefono: "3001112233", email: "titular@local.test",
  tipo_doc: "CC", documento: "1020304", interes: "Cartagena", origen_detalle: "Historia",
  notas: "Prefiere WhatsApp", responsable_id: "00000000-0000-0000-0000-00000000c206", proxima_accion_at: null,
};
let filaLead: FilaLead = { ...LEAD_PREVIO };
function rpcQueReemplaza() {
  filaLead = { ...LEAD_PREVIO };
  estado.respuesta = (l) => {
    if (l.nombre !== "crm_lead_actualizar") return { data: { id: 12, coincidencias: [] }, error: null };
    const p = l.args.p_datos as Record<string, string>;
    for (const k of Object.keys(filaLead)) filaLead[k] = p[k] ? p[k] : null;
    return { data: { id: l.args.p_lead, coincidencias: [] }, error: null };
  };
}
// El formulario completo tal como lo manda la ficha.
const FORMULARIO_COMPLETO = {
  nombre: "Titular", canal: "whatsapp", telefono: "3001112233", email: "titular@local.test",
  tipoDoc: "CC", documento: "1020304", interes: "Cartagena", origenDetalle: "Historia",
  notas: "Prefiere WhatsApp", responsableId: "00000000-0000-0000-0000-00000000c206", proximaAccionAt: "",
};

test("acción: un tipo mal formado (CC2, C-C, C C) no viaja a la base; la sigla c.c. sí", async () => {
  for (const malo of ["CC2", "C-C", "C C", "..CC", "cédula"]) {
    const r = await crearLead({ nombre: "X", canal: "otro", tipoDoc: malo, documento: "1020304" });
    assert.deepEqual(r, { ok: false, error: "Tipo de documento invalido." }, malo);
  }
  assert.deepEqual(llamadas(), []);
  const ok = await crearLead({ nombre: "X", canal: "otro", tipoDoc: "c.c.", documento: "1020304" });
  assert.equal(ok.ok, true);
  assert.equal((llamadas()[0]?.args.p_datos as Record<string, string>).tipo_doc, "c.c.", "la base normaliza la sigla");
});

test("acción: una EDICIÓN parcial se rechaza antes de Supabase y los datos previos quedan intactos", async () => {
  rpcQueReemplaza();
  // Solo nombre y canal: antes se rellenaba el resto con "" y la RPC recibía un
  // formulario "completo" que borraba teléfono, correo, documento y notas.
  const r = await actualizarLead(5, { nombre: "Titular", canal: "whatsapp" } as never);
  assert.deepEqual(r, {
    ok: false,
    error: "Faltan campos del formulario del lead: telefono, email, tipoDoc, documento, interes, origenDetalle, notas, responsableId, proximaAccionAt. No se modifico nada.",
  });
  // Falta UNA sola clave: tampoco pasa.
  const sinNotas: Record<string, unknown> = { ...FORMULARIO_COMPLETO };
  delete sinNotas.notas;
  assert.deepEqual(await actualizarLead(5, sinNotas as never), {
    ok: false, error: "Faltan campos del formulario del lead: notas. No se modifico nada.",
  });
  // Una clave presente pero `undefined` cuenta como ausente.
  assert.deepEqual(await actualizarLead(5, { ...FORMULARIO_COMPLETO, telefono: undefined } as never), {
    ok: false, error: "Faltan campos del formulario del lead: telefono. No se modifico nada.",
  });
  assert.equal(llamadas().length, 0, "cero llamadas a la RPC");
  assert.deepEqual(prueba.revalidadas, [], "un rechazo no revalida la pantalla");
  assert.deepEqual(filaLead, LEAD_PREVIO, "teléfono, correo, documento y notas siguen como estaban");
});

test("acción: el formulario COMPLETO se acepta, cambia lo editado y conserva el resto", async () => {
  rpcQueReemplaza();
  const r = await actualizarLead(5, { ...FORMULARIO_COMPLETO, interes: "San Andrés" });
  assert.equal(r.ok, true);
  assert.equal(llamadas().length, 1);
  assert.equal(llamadas()[0].nombre, "crm_lead_actualizar");
  const p = llamadas()[0].args.p_datos as Record<string, unknown>;
  assert.deepEqual(Object.keys(p).filter((k) => p[k] !== undefined).sort(), CLAVES_FORMULARIO, "las once claves");
  assert.deepEqual(filaLead, { ...LEAD_PREVIO, interes: "San Andrés" });
});

test("acción: en el formulario completo, un campo PRESENTE y vacío sí limpia el dato", async () => {
  rpcQueReemplaza();
  const r = await actualizarLead(5, { ...FORMULARIO_COMPLETO, email: "", notas: null, tipoDoc: "", documento: "" });
  assert.equal(r.ok, true);
  assert.deepEqual(filaLead, { ...LEAD_PREVIO, email: null, notas: null, tipo_doc: null, documento: null });
});

test("acción: CREAR con los opcionales omitidos sigue funcionando y los completa vacíos", async () => {
  const r = await crearLead({ nombre: "Desconocido", canal: "instagram" });
  assert.equal(r.ok, true);
  const p = llamadas()[0]?.args.p_datos as Record<string, unknown>;
  assert.equal(llamadas()[0]?.nombre, "crm_lead_crear");
  for (const k of CLAVES_FORMULARIO.filter((c) => c !== "nombre" && c !== "canal")) {
    assert.equal(p[k], "", `${k} se completa vacío en el alta`);
  }
  assert.equal(p.nombre, "Desconocido");
  assert.equal(p.tenant, "mayorista");
});

test("acción: entrada inválida no llega a la RPC (no objeto, clave desconocida, valor no texto, responsable/fecha mal formados)", async () => {
  const malos: Array<[Record<string, unknown> | null | unknown[], string]> = [
    [null, "Datos del lead invalidos."],
    [["Ana"], "Datos del lead invalidos."],
    [{ tenant: "minorista" }, "Campos no admitidos: tenant."],
    [{ notas: 5 }, "El campo notas debe ser texto."],
    [{ responsableId: "1; drop" }, "Responsable invalido."],
    [{ proximaAccionAt: "pronto" }, "Fecha de proxima accion invalida."],
  ];
  for (const [malo, error] of malos) {
    const alta = malo && !Array.isArray(malo) ? { nombre: "Ana", canal: "otro", ...malo } : malo;
    const edicion = malo && !Array.isArray(malo) ? { ...FORMULARIO_COMPLETO, ...malo } : malo;
    assert.deepEqual(await crearLead(alta as never), { ok: false, error }, `alta ${JSON.stringify(malo)}`);
    assert.deepEqual(await actualizarLead(5, edicion as never), { ok: false, error }, `edición ${JSON.stringify(malo)}`);
  }
  assert.deepEqual(llamadas(), []);
  assert.deepEqual(prueba.revalidadas, []);
});

test("acción: un id de lead que no es entero positivo no llega a la RPC", async () => {
  for (const id of [0, -3, 1.5, Number.NaN, "5", null]) {
    assert.deepEqual(await actualizarLead(id as never, FORMULARIO_COMPLETO), { ok: false, error: "Lead invalido." }, String(id));
    assert.deepEqual(await tomarLead(id as never), { ok: false, error: "Lead invalido." }, String(id));
  }
  assert.deepEqual(llamadas(), []);
});

test("acción: si la RPC rechaza un payload parcial, el mensaje lo dice (no un éxito)", async () => {
  estado.respuesta = () => ({ data: null, error: { message: "crm_lead_payload_incompleto: faltan notas." } });
  assert.deepEqual(await actualizarLead(5, FORMULARIO_COMPLETO), {
    ok: false, error: "Datos del lead incompletos o invalidos: faltan notas.",
  });
  assert.deepEqual(prueba.revalidadas, [], "un rechazo no revalida la pantalla");
});
