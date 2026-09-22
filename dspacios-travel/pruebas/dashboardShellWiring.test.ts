import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Rediseño del shell del Dashboard (fase 1: sidebar, topbar, home real) —
// verificación por inspección de fuente (mismo patrón que
// pruebas/loginWiring.test.ts: no hay React Testing Library en este repo).
//
// Protege exactamente el contrato acordado en la auditoría: el rediseño es
// visual, la lógica de datos/permisos/consultas queda intacta.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const layout = leer("app/(dashboard)/layout.tsx");
const sidebar = leer("app/(dashboard)/DesktopSidebar.tsx");
const nav = leer("app/(dashboard)/SidebarNav.tsx");
const topbar = leer("app/(dashboard)/Topbar.tsx");
const home = leer("app/(dashboard)/dashboard/page.tsx");
const css = leer("app/(dashboard)/DashboardShell.module.css");
const rootLayout = leer("app/layout.tsx");
const globals = leer("styles/globals.css");
const roles = leer("lib/roles.ts");
const constants = leer("lib/constants.ts");
const proxy = leer("proxy.ts");
const tenantServer = leer("lib/tenant.server.ts");
const tenantActions = leer("app/(dashboard)/tenant-actions.ts");
const tenantSwitcher = leer("app/(dashboard)/TenantSwitcher.tsx");

describe("NAV — sigue filtrándose por módulo, rol y tenant (sin lógica nueva)", () => {
  test("la función de filtrado conserva las 4 reglas exactas: minorista oculto, solo minorista, solo superadmin, roles permitidos, módulo", () => {
    assert.match(layout, /if \(tenant === "minorista" && n\.minoristaOculto\) return false;/);
    assert.match(layout, /if \(n\.soloMinorista && tenant !== "minorista"\) return false;/);
    assert.match(layout, /if \(n\.soloSuperadmin && rol !== "superadmin"\) return false;/);
    assert.match(layout, /if \(n\.rolesPermitidos\) return n\.rolesPermitidos\.includes\(rol \?\? ""\);/);
    assert.match(layout, /return !n\.modulo \|\| permitidos\.has\(n\.modulo\);/);
  });

  test("sigue resolviendo rol/permitidos/tenant con las mismas funciones (miRol, modulosConsultables, tenantContext) — nada reimplementado", () => {
    assert.match(layout, /import \{ modulosConsultables, miRol \} from "@\/lib\/roles";/);
    assert.match(layout, /import \{ tenantContext \} from "@\/lib\/tenant\.server";/);
    assert.match(layout, /const rol = await miRol\(\);/);
    assert.match(layout, /const permitidos = modulosConsultables\(rol\);/);
    assert.match(layout, /const \{ tenant, puedeCambiar, permitidos: tenantsPermitidos \} = await tenantContext\(\);/);
  });

  test("conserva ítems representativos del catálogo real (rutas, módulo y banderas intactas)", () => {
    assert.match(layout, /\{ href: "\/tarifario", label: "Tarifario ↗", grupo: "Comercial", iconKey: "tarifario", modulo: "tarifario", minoristaOculto: true \}/);
    assert.match(layout, /\{ href: "\/dashboard\/contratos\/importar", label: "Importar histórico", iconKey: "importar", soloMinorista: true, rolesPermitidos: \["superadmin", "administracion"\] \}/);
    assert.match(layout, /\{ href: "\/cms", label: "Sitio web", iconKey: "cms", modulo: "configuracion", soloSuperadmin: true, minoristaOculto: true \}/);
    assert.match(layout, /\{ href: "\/dashboard\/auditoria", label: "Auditoría", iconKey: "auditoria", rolesPermitidos: \["superadmin", "gerencia"\] \}/);
  });
});

describe("SidebarNav — conserva rutas, jerarquía y estado activo", () => {
  test("el estado activo sigue siendo pathname exacto o prefijo de sub-ruta, en ambas variantes (colapsada y expandida)", () => {
    const ocurrencias = nav.match(/pathname === \w+\.href \|\| pathname\.startsWith\(\w+\.href \+ "\/"\)/g) ?? [];
    assert.equal(ocurrencias.length, 2, "debe seguir habiendo exactamente dos cálculos de estado activo (ítem colapsado + Group)");
  });

  test("los hijos (children) se siguen desplegando y su activo sigue siendo comparación exacta de ruta", () => {
    assert.match(nav, /item\.children!\.map\(\(c\) => \{/);
    assert.match(nav, /const cActive = pathname === c\.href;/);
  });

  test("el mapa de íconos conserva las mismas 16 claves de módulo (ningún módulo se queda sin ícono ni se inventa uno nuevo)", () => {
    const m = nav.match(/const ICONS: Record<string, LucideIcon> = \{([\s\S]*?)\};/);
    assert.ok(m, "debe existir el mapa ICONS");
    const claves = [...m![1].matchAll(/(\w+):/g)].map((x) => x[1]);
    assert.deepEqual(claves.sort(), [
      "auditoria", "b2b", "cms", "contabilidad", "contratos", "cotizaciones", "crm", "finanzas",
      "importar", "paquetes", "producto", "reservar", "tarifario", "usuarios", "ventas", "vuelos", "configuracion",
    ].sort());
  });
});

describe("Colapso del sidebar — misma clave de localStorage, mismo comportamiento", () => {
  test("sigue usando la clave 'dsp-sidebar' para leer y guardar el estado", () => {
    assert.match(sidebar, /const KEY = "dsp-sidebar";/);
    assert.match(sidebar, /localStorage\.getItem\(KEY\) === "1"/);
    assert.match(sidebar, /localStorage\.setItem\(KEY, n \? "1" : "0"\)/);
  });
});

describe("TenantSwitcher — selector personalizado, mismo comportamiento y persistencia", () => {
  test("ya no renderiza un <select> nativo — usa @base-ui/react/select (dependencia ya instalada, sin librería nueva)", () => {
    assert.doesNotMatch(tenantSwitcher, /<select/);
    assert.match(tenantSwitcher, /import \{ Select as SelectPrimitive \} from "@base-ui\/react\/select";/);
  });

  test("conserva el guard de solo-lectura (sin permiso o con un solo tenant permitido) con el mismo texto/etiqueta de siempre", () => {
    assert.match(tenantSwitcher, /if \(!puedeCambiar \|\| permitidos\.length < 2\) \{/);
    assert.match(tenantSwitcher, /<span className=\{base\} style=\{style\} title="Agencia activa">/);
  });

  test("el valor, el cambio y la persistencia son exactamente los mismos: value/onValueChange controlados, cambiarTenant + recarga completa", () => {
    assert.match(tenantSwitcher, /items=\{permitidos\.map\(\(t\) => \(\{ value: t, label: TENANT_LABEL\[t\] \}\)\)\}/);
    assert.match(tenantSwitcher, /value=\{tenant\}/);
    assert.match(tenantSwitcher, /onValueChange=\{onValueChange\}/);
    assert.match(tenantSwitcher, /await cambiarTenant\(value\);/);
    assert.match(tenantSwitcher, /window\.location\.reload\(\);/);
    assert.match(tenantSwitcher, /disabled=\{pending\}/);
  });

  test("el trigger conserva estados hover/focus-visible/abierto/disabled y es operable por teclado (listbox nativo de Base UI: sin handlers de tecla propios)", () => {
    assert.match(tenantSwitcher, /hover:brightness-95/);
    assert.match(tenantSwitcher, /focus-visible:ring-2 focus-visible:ring-\[var\(--dash-accent\)\]/);
    assert.match(tenantSwitcher, /data-\[popup-open\]:ring-2/);
    assert.match(tenantSwitcher, /disabled:cursor-not-allowed disabled:opacity-60/);
    assert.doesNotMatch(tenantSwitcher, /onKeyDown|addEventListener\("keydown"/);
  });

  test("la opción activa se marca con el color de marca y un indicador visual (check)", () => {
    assert.match(tenantSwitcher, /color: t === tenant \? "var\(--brand-primary\)" : "var\(--foreground\)"/);
    assert.match(tenantSwitcher, /<SelectPrimitive\.ItemIndicator/);
    assert.match(tenantSwitcher, /<Check size=\{14\}/);
  });

  test("el menú (Portal) usa tokens semánticos globales, nunca --dash-* (el Portal queda fuera del scope de .dashRoot)", () => {
    const idxPortal = tenantSwitcher.indexOf("<SelectPrimitive.Portal>");
    const bloquePortal = tenantSwitcher.slice(idxPortal);
    assert.doesNotMatch(bloquePortal, /--dash-/);
    assert.match(bloquePortal, /var\(--card\)/);
    assert.match(bloquePortal, /var\(--border\)/);
  });

  test("radio máximo de 8px en el menú (rounded-lg) y sombra discreta (shadow-sm, no shadow-md/lg/xl)", () => {
    assert.match(tenantSwitcher, /rounded-lg border py-1 text-sm shadow-sm/);
    assert.doesNotMatch(tenantSwitcher, /shadow-(md|lg|xl|2xl)/);
  });
});

describe("Home (/dashboard) — mismas consultas y cálculos, sin datos nuevos", () => {
  test("las 6 consultas reales siguen siendo exactamente las mismas tablas/filtros", () => {
    assert.match(home, /supabase\.from\("paquetes"\)\.select\("id", \{ count: "exact", head: true \}\)/);
    assert.match(home, /supabase\.from\("ventas"\)\.select\("precio_venta, fecha_venta, fecha_salida, estado"\)\.eq\("tenant", tenant\)/);
    assert.match(home, /supabase\.from\("abonos"\)\.select\("valor_abono"\)\.eq\("tenant", tenant\)/);
    assert.match(home, /supabase\.from\("cupos_por_bloqueo"\)\.select\("cupos_disponibles"\)/);
    assert.match(home, /supabase\.from\("bloqueos_vuelo"\)\.select\("id", \{ count: "exact", head: true \}\)\.gte\("fecha_ida", hoyStr\)\.lte\("fecha_ida", addDays\(14\)\)/);
    assert.match(home, /supabase\.from\("cuentas_por_pagar"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("tenant", tenant\)\.gte\("fecha_vencimiento", hoyStr\)\.lte\("fecha_vencimiento", addDays\(15\)\)/);
  });

  test("los cálculos derivados (activos, pendientes, ventaMes, cartera, cuposDisponibles, cuposCriticos) están intactos", () => {
    assert.match(home, /const nActivos = noCancel\.length;/);
    assert.match(home, /const nPendientes = vts\.filter\(\(v\) => v\.estado === "pendiente"\)\.length;/);
    assert.match(home, /const cartera = Math\.max\(0, totalVentas - totalAbonos\);/);
    assert.match(home, /const cuposCriticos = \(cupos \?\? \[\]\)\.filter\(\(c\) => \{ const n = Number\(c\.cupos_disponibles \?\? 0\); return n > 0 && n <= 3; \}\)\.length;/);
  });

  test("gating interno/esMinorista/OCULTOS_MINORISTA permanece igual", () => {
    assert.match(home, /const interno = \["superadmin", "gerencia", "administracion", "operaciones"\]\.includes\(perfil\?\.rol \?\? ""\);/);
    assert.match(home, /const esMinorista = tenant === "minorista";/);
    assert.match(home, /const OCULTOS_MINORISTA = new Set\(\["\/dashboard\/tarifario", "\/dashboard\/reservar", "\/dashboard\/producto", "\/dashboard\/paquetes", "\/dashboard\/vuelos"\]\);/);
    assert.match(home, /const modulos = MODULOS\.filter\(\(m\) => \(!m\.interno \|\| interno\) && !\(esMinorista && OCULTOS_MINORISTA\.has\(m\.href\)\)\);/);
  });

  test("FLUJO y MODULOS conservan sus rutas reales (mismos hrefs, sin agregar módulos nuevos)", () => {
    assert.match(home, /const FLUJO: \{ href: string; icon: LucideIcon; label: string \}\[\] = \[/);
    assert.match(home, /\{ href: "\/dashboard\/tarifario", icon: Tags, label: "Tarifario" \}/);
    assert.match(home, /\{ href: "\/dashboard\/rentabilidad", icon: LineChart, label: "Finanzas" \}/);
    const modulosHrefs = [...home.matchAll(/href: "(\/dashboard\/[a-z/]+)", icon: \w+, label: "[^"]+", desc:/g)].map((m) => m[1]);
    assert.deepEqual(modulosHrefs, [
      "/dashboard/tarifario", "/dashboard/reservar", "/dashboard/producto", "/dashboard/paquetes",
      "/dashboard/contratos", "/dashboard/vuelos", "/dashboard/cartera", "/dashboard/pagos",
      "/dashboard/finanzas", "/dashboard/configuracion",
    ]);
  });

  test("las alertas quedan acotadas a cupos críticos y pagos por vencer (sin aerolíneas ni datos inventados)", () => {
    assert.match(home, /label: "Cupos críticos", n: cuposCriticos, href: "\/dashboard\/vuelos"/);
    assert.match(home, /label: "Pagos por vencer \(15d\)", n: nPagos \?\? 0, href: "\/dashboard\/pagos"/);
    assert.doesNotMatch(home, /JetSmart|Avianca|Copa/);
  });
});

describe("Superficie visual — sin .app-bg ni .home-clasica/.home-blueprint, sin selectores legacy", () => {
  const archivos = { layout, sidebar, nav, topbar, home, tenantSwitcher };

  for (const [nombre, contenido] of Object.entries(archivos)) {
    test(`${nombre}: no usa la clase .app-bg (es compartida con Tarifario)`, () => {
      assert.doesNotMatch(contenido, /\bapp-bg\b/);
    });
    test(`${nombre}: no queda ningún rastro de .home-clasica/.home-blueprint`, () => {
      assert.doesNotMatch(contenido, /home-clasica|home-blueprint/);
    });
    test(`${nombre}: no usa clases bg-white/text-gray-*/border-gray-* (interceptadas por temas legacy)`, () => {
      assert.doesNotMatch(contenido, /\bbg-white\b/);
      assert.doesNotMatch(contenido, /\btext-gray-\d/);
      assert.doesNotMatch(contenido, /\bborder-gray-\d/);
    });
  }

  test("globals.css sigue intacto: sin variables --dash- nuevas colándose ahí", () => {
    assert.doesNotMatch(globals, /--dash-/);
  });
});

describe("Tipografía — Outfit/Plus Jakarta Sans cargadas y scoped SOLO al Dashboard", () => {
  test("layout.tsx las carga con next/font/google, como variables --dash-font-heading/--dash-font-body", () => {
    assert.match(layout, /import \{ Outfit, Plus_Jakarta_Sans \} from "next\/font\/google";/);
    assert.match(layout, /variable: "--dash-font-heading"/);
    assert.match(layout, /variable: "--dash-font-body"/);
  });

  test(".dashRoot aplica --dash-font-body como font-family base y .heading usa --dash-font-heading", () => {
    assert.match(css, /\.dashRoot \{[\s\S]*font-family: var\(--dash-font-body\)/);
    assert.match(css, /\.heading \{\s*font-family: var\(--dash-font-heading\)/);
  });

  test("el root layout (app/layout.tsx) NO importa Outfit/Plus Jakarta Sans — Login/Tarifario/Portal B2B no heredan nada de esto", () => {
    assert.doesNotMatch(rootLayout, /Outfit|Plus_Jakarta_Sans/);
    assert.match(rootLayout, /import \{ Jost \} from "next\/font\/google";/);
  });

  test("styles.heading NUNCA envuelve el contenedor completo de DesktopSidebar/Topbar/header móvil (navegación y controles deben quedar en Plus Jakarta Sans)", () => {
    // El <aside> de DesktopSidebar ya no importa `styles` en absoluto: si
    // reaparece el import, alguien reintrodujo Outfit en todo el contenedor.
    assert.doesNotMatch(sidebar, /styles/);
    // El <header> de Topbar no debe llevar `${styles.heading}` en su propio
    // className — solo el bloque de identidad (userLabel) puede usarlo.
    const idxHeaderTopbar = topbar.indexOf("<header");
    const bloqueHeaderTopbar = topbar.slice(idxHeaderTopbar, topbar.indexOf(">", idxHeaderTopbar));
    assert.doesNotMatch(bloqueHeaderTopbar, /styles\.heading/);
    // El único uso permitido en Topbar es sobre el bloque de identidad (userLabel).
    assert.match(topbar, /className=\{`\$\{styles\.heading\}[^`]*`\}[\s\S]{0,20}style=\{\{ color: "var\(--dash-ink\)" \}\}>\s*\{userLabel\}/);
    // El <header> móvil de layout.tsx (solo celular) tampoco debe llevarlo.
    const idxHeaderMovil = layout.indexOf("<header");
    const bloqueHeaderMovil = layout.slice(idxHeaderMovil, layout.indexOf(">", idxHeaderMovil));
    assert.doesNotMatch(bloqueHeaderMovil, /styles\.heading/);
  });

  test("styles.heading solo aparece en title/saludo/cifras KPI/identidad — nunca en más de esos puntos del código", () => {
    // dashboard/page.tsx: saludo (h1) + valor de la métrica (cifra KPI).
    assert.equal((home.match(/styles\.heading/g) ?? []).length, 2);
    // Topbar: identidad (userLabel).
    assert.equal((topbar.match(/styles\.heading/g) ?? []).length, 1);
  });
});

describe("Contraste canvas/tarjeta — --dash-bg, --dash-surface y --dash-kpi-surface derivan de tokens distintos", () => {
  test("--dash-bg (canvas), --dash-border y --dash-kpi-surface aplican un matiz azul con color-mix() sobre tokens semánticos reales (--muted/--card/--border + --brand-accent) — nunca un hex fijo", () => {
    assert.match(css, /--dash-bg:\s*color-mix\(in srgb, var\(--muted\) 85%, var\(--brand-accent\) 15%\);/);
    assert.match(css, /--dash-surface:\s*var\(--card\);/);
    assert.match(css, /--dash-kpi-surface:\s*color-mix\(in srgb, var\(--card\) 92%, var\(--brand-accent\) 8%\);/);
    assert.match(css, /--dash-border:\s*color-mix\(in srgb, var\(--border\) 82%, var\(--brand-accent\) 18%\);/);
    // Nunca un color fijo tipo #f2f8fc: siempre var(--muted)/var(--card)/var(--border) como base.
    assert.doesNotMatch(css, /--dash-(bg|surface|kpi-surface|border):\s*#[0-9a-fA-F]{3,6}/);
  });

  test("el texto (--dash-ink/--dash-ink-muted) NO se mezcla con el matiz azul — el contraste AA no cambia con este ajuste", () => {
    assert.match(css, /--dash-ink:\s*var\(--foreground\);/);
    assert.match(css, /--dash-ink-muted:\s*var\(--muted-foreground\);/);
    assert.doesNotMatch(css, /--dash-ink[^:]*:\s*color-mix/);
  });

  test("solo la tarjeta de métrica (MetricCard) usa --dash-kpi-surface; el resto de superficies principales (header, flujo, módulos, sidebar, topbar) sigue en --dash-surface blanco", () => {
    assert.equal((home.match(/var\(--dash-kpi-surface\)/g) ?? []).length, 1, "--dash-kpi-surface debe usarse en un único punto: el fondo de MetricCard");
    // La cabecera operativa y la sección "Flujo operativo" siguen blancas.
    assert.match(home, /<header className="rounded-lg border p-6" style=\{\{ backgroundColor: "var\(--dash-surface\)"/);
    assert.match(home, /<section className="mt-5 rounded-lg border p-4" style=\{\{ backgroundColor: "var\(--dash-surface\)"/);
  });

  // Extrae SOLO el primer bloque de declaraciones de un tema (desde su
  // "html[data-theme=...] {" inicial hasta el "}" que lo cierra) — nunca una
  // ventana de caracteres arbitraria, que puede cruzar sin querer hacia otra
  // regla más adelante en el archivo (ej. la clase .dark, que también trae
  // --card) y dar un falso positivo/negativo.
  function bloqueTema(nombreTema: string): string {
    const selector = `html[data-theme="${nombreTema}"] {`;
    const inicio = globals.indexOf(selector);
    assert.notEqual(inicio, -1, `debe existir el bloque de declaraciones de data-theme="${nombreTema}"`);
    const fin = globals.indexOf("\n}", inicio);
    return globals.slice(inicio, fin);
  }

  test("en los 4 temas reales del repo (marca/verde/web/blueprint), --muted y --card quedan definidos y son distintos entre sí", () => {
    // Tema por defecto ("marca", :root): --card blanco, --muted gris muy claro.
    const raiz = globals.slice(globals.indexOf(":root {"), globals.indexOf("\n}", globals.indexOf(":root {")));
    assert.match(raiz, /--card: oklch\(1 0 0\);/);
    assert.match(raiz, /--muted: oklch\(0\.97 0 0\);/);

    // verde: ambos redefinidos dentro de SU PROPIO bloque, y distintos entre sí.
    const verde = bloqueTema("verde");
    assert.match(verde, /--card: #0c100e;/);
    assert.match(verde, /--muted: #141a17;/);

    // web y blueprint: redefinen --muted (canvas) dentro de su propio bloque y
    // NUNCA pisan --card ahí (queda en el blanco por defecto) — igual de
    // válido, siguen siendo valores distintos.
    const web = bloqueTema("web");
    assert.match(web, /--muted:\s*#eef1f8;/);
    assert.doesNotMatch(web, /--card:/);
    const blueprint = bloqueTema("blueprint");
    assert.match(blueprint, /--muted:\s*#efe8da;/);
    assert.doesNotMatch(blueprint, /--card:/);
  });
});

describe("Sin afirmaciones inventadas (mismo criterio auditado que el login)", () => {
  const todo = layout + sidebar + nav + topbar + home + css + tenantSwitcher;
  const prohibido: [RegExp, string][] = [
    [/Sabre|Amadeus/i, "Sabre/Amadeus"],
    [/\bGDS\b|\bNDC\b/, "GDS/NDC"],
    [/SSL\s*256|\b99\.98\b|\bv4\.1\.8\b/, "SLA/versión inventada"],
    [/JetSmart|Wompi|PSE\b/, "proveedor/pasarela inventada"],
    [/RUT\s*\/\s*RNT/, "certificación inventada"],
    [/\+57\s*\d/, "teléfono inventado"],
    [/[Ss]incronizaci[oó]n/, "estado de sincronización inventado"],
    [/[Oo]perador [Mm]ayorista [Cc]ertificado/, "certificación inventada"],
  ];
  for (const [re, etiqueta] of prohibido) {
    test(`no aparece: ${etiqueta}`, () => {
      assert.doesNotMatch(todo, re);
    });
  }
});

describe("Archivos de permisos/autorización — no se tocan en esta ronda", () => {
  test("lib/roles.ts, lib/constants.ts, proxy.ts, lib/tenant.server.ts y tenant-actions.ts no declaran ningún token --dash- ni importan el CSS module del shell (prueba de que no fueron mezclados con el rediseño visual)", () => {
    for (const [nombreArchivo, contenido] of [
      ["lib/roles.ts", roles], ["lib/constants.ts", constants], ["proxy.ts", proxy],
      ["lib/tenant.server.ts", tenantServer], ["app/(dashboard)/tenant-actions.ts", tenantActions],
    ] as const) {
      assert.doesNotMatch(contenido, /DashboardShell\.module\.css|--dash-/, `${nombreArchivo} no debe mezclarse con el rediseño visual`);
    }
  });
});
