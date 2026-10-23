// #49 — Menú móvil del Dashboard: los submenús autorizados se alcanzan desde el
// celular, con estado activo, teclado y tacto, sin decidir permisos aparte.
//
// Monta el `MobileNav` REAL (con el `SidebarNav` real adentro) en jsdom. El
// `nav` de cada caso sale del `NAV` y del filtro REALES de layout.tsx
// (evaluados desde su fuente: el layout es un Server Component y no se puede
// importar aquí) con `modulosConsultables` real de lib/roles.ts.
//
// Uso directo (no está en package.json):
//   node --experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/menuMovilDashboard.react.ts
import { test, describe, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><main data-dashboard-main></main></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- React necesita los globales del DOM en esta prueba.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `next` no publica mapa "exports": en ESM plano "next/navigation" no resuelve.
// Este hook solo lo apunta a su archivo real para que `mock.module` lo reemplace.
register(
  "data:text/javascript," +
    encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'),
);

let rutaActual = "/dashboard";
mock.module("next/navigation", { namedExports: { usePathname: () => rutaActual } });

const React = await import("react");
const h = React.createElement;
// <Link> como <a> real y sin navegación pendiente. Igual que next/link, cancela
// la navegación nativa (jsdom no navega); el clic sigue burbujeando al panel.
function LinkFalso({ href, children, ...resto }: { href: string; children?: React.ReactNode; prefetch?: boolean }) {
  delete resto.prefetch; // no es atributo del DOM
  return h("a", { href, ...resto, onClick: (e: { preventDefault(): void }) => e.preventDefault() }, children);
}
mock.module("next/link", { defaultExport: LinkFalso, namedExports: { useLinkStatus: () => ({ pending: false }) } });

const { createRoot } = await import("react-dom/client");
const { act } = React;
const { MobileNav, seccionActual } = await import("../app/(dashboard)/MobileNav.tsx");
const { modulosConsultables } = await import("../lib/roles.ts");
type NavItem = Parameters<typeof MobileNav>[0]["nav"][number];

// ── NAV y filtro reales de layout.tsx ─────────────────────────────────────
const fuenteLayout = readFileSync(new URL("../app/(dashboard)/layout.tsx", import.meta.url), "utf8");
function evaluarNav(): NavItem[] {
  const ancla = fuenteLayout.indexOf("const NAV: NavItem[] = [");
  assert.ok(ancla > -1, "layout.tsx debe declarar NAV");
  const desde = fuenteLayout.indexOf("[", ancla + "const NAV: NavItem[] =".length);
  const hasta = fuenteLayout.indexOf("\n];", desde);
  return new Function(`return ${fuenteLayout.slice(desde, hasta + 2)};`)() as NavItem[];
}
function evaluarFiltro() {
  const desde = fuenteLayout.indexOf("NAV.filter((n) => {");
  assert.ok(desde > -1, "layout.tsx debe filtrar NAV con el predicado de siempre");
  const hasta = fuenteLayout.indexOf("});", desde);
  return new Function("NAV", "tenant", "rol", "permitidos", `return ${fuenteLayout.slice(desde, hasta + 2)};`) as (
    nav: NavItem[], tenant: string, rol: string | null, permitidos: Set<string>,
  ) => NavItem[];
}
const NAV = evaluarNav();
const filtro = evaluarFiltro();
type Tenant = "mayorista" | "minorista";
const navDe = (rol: string, tenant: Tenant) => filtro(NAV, tenant, rol, modulosConsultables(rol as never));

// ── Montaje ───────────────────────────────────────────────────────────────
let contenedor: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
before(() => {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
});
beforeEach(() => {
  rutaActual = "/dashboard";
  document.body.style.overflow = "";
  root = createRoot(contenedor);
});
afterEach(() => act(() => root.unmount()));
after(() => contenedor.remove());

const montar = (nav: NavItem[]) => act(() => root.render(h(MobileNav, { nav })));
const disparador = () => contenedor.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const dialogo = () => contenedor.querySelector<HTMLElement>('[role="dialog"]')!;
const abierto = () => !dialogo().parentElement!.hidden;
function clic(el: Element, init: MouseEventInit = {}) {
  act(() => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })); });
}
function tecla(key: string, init: KeyboardEventInit = {}) {
  const destino = (document.activeElement ?? document.body) as Element;
  act(() => { destino.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
}
const enlaceDialogo = (href: string) => dialogo().querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const toggle = (label: string) => dialogo().querySelector<HTMLButtonElement>(`button[aria-label="Submenú de ${label}"]`);
function abrirTodosLosSubmenus() {
  for (let i = 0; i < 50; i++) {
    const cerrado = dialogo().querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    if (!cerrado) return;
    clic(cerrado);
  }
  assert.fail("quedaron submenús sin poder abrirse");
}
const hrefsDialogo = () => new Set([...dialogo().querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!));
const esperados = (nav: NavItem[]) => new Set(nav.flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]));

describe("#49 menú móvil — apertura y destinos", () => {
  test("cerrado por defecto; el botón Menú abre un diálogo modal y lleva el foco adentro", () => {
    montar(navDe("superadmin", "mayorista"));
    assert.equal(abierto(), false);
    assert.equal(disparador().getAttribute("aria-expanded"), "false");
    assert.equal(disparador().getAttribute("aria-controls"), dialogo().id);
    clic(disparador());
    assert.equal(abierto(), true);
    assert.equal(disparador().getAttribute("aria-expanded"), "true");
    assert.equal(dialogo().getAttribute("aria-modal"), "true");
    assert.equal(document.getElementById(dialogo().getAttribute("aria-labelledby")!)?.textContent, "Menú");
    assert.equal(document.activeElement?.getAttribute("aria-label"), "Cerrar menú");
  });

  test("cada submenú se despliega con su botón (aria-expanded/aria-controls) y deja usar sus destinos", () => {
    montar(navDe("superadmin", "mayorista"));
    clic(disparador());
    for (const grupo of ["Vuelos", "Montaje de producto", "Netas", "Finanzas", "Contabilidad"]) {
      const b = toggle(grupo);
      assert.ok(b, `falta el botón de submenú de ${grupo}`);
      assert.equal(b.getAttribute("aria-expanded"), "false");
      clic(b);
      assert.equal(b.getAttribute("aria-expanded"), "true");
      const region = document.getElementById(b.getAttribute("aria-controls")!);
      assert.ok(region, `${grupo}: aria-controls debe apuntar al submenú visible`);
      const hijos = NAV.find((n) => n.label === grupo)!.children!;
      for (const c of hijos) assert.ok(region.querySelector(`a[href="${c.href}"]`), `${grupo}: falta ${c.href}`);
    }
    assert.ok(enlaceDialogo("/dashboard/contabilidad/libro-diario"));
    assert.ok(enlaceDialogo("/dashboard/producto/hoteles"));
    assert.ok(enlaceDialogo("/dashboard/vuelos/pasajeros"));
  });
});

describe("#49 menú móvil — permisos: muestra exactamente el nav que filtra layout.tsx, con todos sus hijos", () => {
  const roles = ["superadmin", "gerencia", "administracion", "operaciones", "venta", "control_vuelo", "agencia"];
  for (const tenant of ["mayorista", "minorista"] as Tenant[]) {
    for (const rol of roles) {
      test(`${rol} / ${tenant}`, () => {
        const nav = navDe(rol, tenant);
        montar(nav);
        clic(disparador());
        abrirTodosLosSubmenus();
        assert.deepEqual([...hrefsDialogo()].sort(), [...esperados(nav)].sort());
      });
    }
  }

  test("venta (mayorista) no recibe Finanzas, Contabilidad, Netas ni Vuelos; sí lo comercial", () => {
    const hrefs = esperados(navDe("venta", "mayorista"));
    for (const h of ["/dashboard/reservar", "/dashboard/cotizaciones", "/dashboard/contratos", "/dashboard/contratos/nuevo", "/crm"]) {
      assert.ok(hrefs.has(h), `venta debe ver ${h}`);
    }
    for (const h of ["/dashboard/cartera", "/dashboard/contabilidad/libro-diario", "/dashboard/producto/hoteles", "/dashboard/vuelos/pasajeros", "/dashboard/auditoria"]) {
      assert.ok(!hrefs.has(h), `venta NO debe ver ${h}`);
    }
  });

  test("operaciones ve Finanzas pero no Contabilidad (rolesPermitidos); administracion ve los 9 de Contabilidad", () => {
    const op = esperados(navDe("operaciones", "mayorista"));
    assert.ok(op.has("/dashboard/cartera"));
    assert.ok(!op.has("/dashboard/contabilidad/libro-diario"));
    const adm = esperados(navDe("administracion", "mayorista"));
    const contabilidad = NAV.find((n) => n.label === "Contabilidad")!.children!;
    assert.equal(contabilidad.length, 9);
    for (const c of contabilidad) assert.ok(adm.has(c.href), `administracion debe ver ${c.href}`);
  });

  test("minorista oculta tarifario/montaje/netas/vuelos y muestra el importador solo a superadmin/administracion", () => {
    const sa = esperados(navDe("superadmin", "minorista"));
    for (const h of ["/tarifario", "/dashboard/vuelos/pasajeros", "/dashboard/producto/hoteles", "/dashboard/paquetes/nuevo", "/cms"]) {
      assert.ok(!sa.has(h), `minorista NO debe mostrar ${h}`);
    }
    assert.ok(sa.has("/dashboard/contratos/importar"));
    assert.ok(!esperados(navDe("gerencia", "minorista")).has("/dashboard/contratos/importar"));
    assert.ok(!esperados(navDe("superadmin", "mayorista")).has("/dashboard/contratos/importar"));
  });
});

describe("#49 menú móvil — estado activo", () => {
  test("en Libro diario el grupo Contabilidad se abre solo y marca el sub-ítem con aria-current", () => {
    rutaActual = "/dashboard/contabilidad/libro-diario";
    montar(navDe("administracion", "mayorista"));
    const seccion = disparador().parentElement!.textContent ?? "";
    assert.match(seccion, /Contabilidad/);
    assert.match(seccion, /Libro diario/);
    clic(disparador());
    assert.equal(toggle("Contabilidad")!.getAttribute("aria-expanded"), "true");
    assert.equal(enlaceDialogo("/dashboard/contabilidad/libro-diario")!.getAttribute("aria-current"), "page");
    assert.equal(toggle("Finanzas")!.getAttribute("aria-expanded"), "false", "los demás grupos siguen cerrados");
  });

  test("seccionActual elige el href más específico", () => {
    const nav = navDe("superadmin", "mayorista");
    assert.deepEqual(seccionActual(nav, "/dashboard/cartera"), { padre: "Finanzas", hijo: "Cartera (por cobrar)" });
    assert.deepEqual(seccionActual(nav, "/dashboard/rentabilidad"), { padre: "Finanzas", hijo: "Rentabilidad" });
    assert.deepEqual(seccionActual(nav, "/dashboard/usuarios/b2b"), { padre: "Aprobaciones B2B", hijo: null });
    assert.deepEqual(seccionActual(nav, "/dashboard/contratos/00-0451"), { padre: "Contratos", hijo: null });
    assert.equal(seccionActual(nav, "/dashboard"), null);
    assert.deepEqual(seccionActual(navDe("superadmin", "minorista"), "/dashboard/contratos/importar"), { padre: "Importar histórico", hijo: null });
  });
});

describe("#49 menú móvil — cierre, tacto y teclado", () => {
  test("tocar un destino cierra el panel, devuelve el foco al botón y el enlace sigue montado (señal de carga)", () => {
    montar(navDe("superadmin", "mayorista"));
    clic(disparador());
    clic(toggle("Contabilidad")!);
    const enlace = enlaceDialogo("/dashboard/contabilidad/retenciones")!;
    clic(enlace);
    assert.equal(abierto(), false);
    assert.ok(document.activeElement === disparador(), "el foco vuelve al botón Menú");
    assert.ok(document.body.contains(enlace), "el <Link> no se desmonta: su useLinkStatus sigue mostrando la carga");
  });

  test("Ctrl/Cmd+clic (abrir en otra pestaña) no cierra el panel", () => {
    montar(navDe("superadmin", "mayorista"));
    clic(disparador());
    clic(enlaceDialogo("/dashboard/ventas")!, { ctrlKey: true });
    assert.equal(abierto(), true);
    clic(enlaceDialogo("/dashboard/ventas")!, { metaKey: true });
    assert.equal(abierto(), true);
  });

  test("Escape cierra y devuelve el foco; Tab y Shift+Tab no se escapan del panel", () => {
    montar(navDe("superadmin", "mayorista"));
    clic(disparador());
    const enfocables = [...dialogo().querySelectorAll<HTMLElement>("a[href], button")];
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    assert.ok(document.activeElement === primero, "el foco entra por Cerrar menú");
    tecla("Tab", { shiftKey: true });
    assert.ok(document.activeElement === ultimo, "Shift+Tab desde el primero va al último");
    tecla("Tab");
    assert.ok(document.activeElement === primero, "Tab desde el último vuelve al primero");
    tecla("Escape");
    assert.equal(abierto(), false);
    assert.ok(document.activeElement === disparador(), "Escape devuelve el foco al botón Menú");
  });

  test("tocar el fondo o el botón Cerrar cierra el panel", () => {
    montar(navDe("superadmin", "mayorista"));
    clic(disparador());
    clic(dialogo().previousElementSibling!);
    assert.equal(abierto(), false);
    clic(disparador());
    clic(dialogo().querySelector('button[aria-label="Cerrar menú"]')!);
    assert.equal(abierto(), false);
  });

  test("cambiar de ruta (p. ej. Atrás del navegador) cierra el panel", () => {
    const nav = navDe("superadmin", "mayorista");
    montar(nav);
    clic(disparador());
    rutaActual = "/dashboard/ventas";
    montar(nav);
    assert.equal(abierto(), false);
  });

  test("bloquea el scroll del fondo mientras está abierto y lo restaura al cerrar", () => {
    document.body.style.overflow = "auto";
    montar(navDe("superadmin", "mayorista"));
    clic(disparador());
    assert.equal(document.body.style.overflow, "hidden");
    tecla("Escape");
    assert.equal(document.body.style.overflow, "auto");
  });

  test("si la ventana pasa a escritorio con el panel abierto, se cierra y libera el scroll", () => {
    const oyentes = new Set<() => void>();
    let escritorio = false;
    const w = window as unknown as { matchMedia?: unknown };
    const previo = w.matchMedia;
    w.matchMedia = () => ({
      get matches() { return escritorio; },
      addEventListener: (_t: string, cb: () => void) => oyentes.add(cb),
      removeEventListener: (_t: string, cb: () => void) => oyentes.delete(cb),
    });
    try {
      montar(navDe("superadmin", "mayorista"));
      clic(disparador());
      assert.equal(oyentes.size, 1);
      escritorio = true;
      act(() => { for (const cb of [...oyentes]) cb(); });
      assert.equal(abierto(), false);
      assert.equal(document.body.style.overflow, "");
      assert.equal(oyentes.size, 0, "el oyente se retira al cerrar");
    } finally {
      w.matchMedia = previo;
    }
  });
});

describe("#49 cableado — layout.tsx pasa el mismo nav filtrado a ambos menús", () => {
  test("MobileNav y DesktopSidebar reciben la misma variable `nav`; ya no queda la fila de solo primer nivel", () => {
    assert.match(fuenteLayout, /import \{ MobileNav \} from "\.\/MobileNav";/);
    assert.match(fuenteLayout, /<MobileNav nav=\{nav\} \/>/);
    assert.match(fuenteLayout, /<DesktopSidebar nav=\{nav\} tenant=\{tenant\} \/>/);
    assert.doesNotMatch(fuenteLayout, /nav\.map\(\(n\) =>/);
    assert.doesNotMatch(fuenteLayout, /scrollNoBar/);
  });

  test("el header móvil sigue siendo solo celular y MobileNav vive dentro de él", () => {
    const ini = fuenteLayout.indexOf("<header");
    const fin = fuenteLayout.indexOf("</header>", ini);
    assert.match(fuenteLayout.slice(ini, ini + 120), /md:hidden/);
    assert.ok(fuenteLayout.slice(ini, fin).includes("<MobileNav nav={nav} />"));
  });
});
