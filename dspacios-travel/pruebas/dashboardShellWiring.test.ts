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
const metaMigracion = leer("supabase/migrations/20260601000185_meta_ventas_mensual.sql");
const metaRollback = leer("supabase/scripts/rollback_185_meta_ventas_mensual.sql");
const metaPreflight = leer("supabase/scripts/preflight_185_meta_ventas_mensual.sql");
const metaPostcheck = leer("supabase/scripts/postcheck_185_meta_ventas_mensual.sql");
const metaActions = leer("app/(dashboard)/dashboard/configuracion/actions.ts");
const metaConfigUI = leer("app/(dashboard)/dashboard/configuracion/MetaVentasConfig.tsx");
const dbTypes = leer("types/database.ts");
const metricasLib = leer("lib/dashboard/metricas.ts");
const fetchAllPaginadoLib = leer("lib/supabase/fetchAllPaginado.ts");
const dashboardMetricasTest = leer("pruebas/dashboardMetricas.test.ts");
const fetchAllPaginadoTest = leer("pruebas/fetchAllPaginado.test.ts");

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

describe("Home (/dashboard) — agregados en base (ronda de costo), sin datos inventados", () => {
  test("las consultas de fondo pasaron de .select() completos a RPC de agregación — mismo tenant/filtros, resultado pequeño y tipado", () => {
    assert.match(home, /supabase\.from\("paquetes"\)\.select\("id", \{ count: "exact", head: true \}\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_contratos_por_estado", \{ p_tenant: tenant \}\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_cupos_resumen"\)\.maybeSingle\(\)/);
    assert.match(home, /supabase\.from\("bloqueos_vuelo"\)\.select\("id", \{ count: "exact", head: true \}\)\.gte\("fecha_ida", hoyStr\)\.lte\("fecha_ida", addDays\(14\)\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_cxp_resumen", \{ p_tenant: tenant, p_desde: hoyStr, p_hasta: addDays\(15\) \}\)\.maybeSingle\(\)/);
    // Ya NO quedan los .select() completos de la ronda anterior.
    assert.doesNotMatch(home, /supabase\.from\("ventas"\)\.select\("numero_contrato/);
    assert.doesNotMatch(home, /supabase\.from\("abonos"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("cupos_por_bloqueo"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("cuentas_por_pagar"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("retenciones_cxp"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("cxp_pagos"\)\.select\(/);
  });

  test("los cálculos derivados base (contratos vía clasificarContratosDesdeConteos, ventaMes vía ventasMesPorMonedaDesdeAgregado, cupos vía cuposResumenDesdeAgregado) están intactos", () => {
    // Contratos/ventas/cupos ya NO se calculan inline en page.tsx — delegan
    // en funciones puras (lib/dashboard/metricas.ts) que consumen los
    // agregados devueltos por las RPC, probadas a fondo en
    // pruebas/dashboardMetricas.test.ts y pruebas/dashboardMetricasAgregadas.test.ts.
    assert.match(home, /const \{ nVigentes, nPendientes, nConfirmadosOActivos \} = clasificarContratosDesdeConteos\(contratosPorEstado \?\? \[\]\);/);
    assert.match(home, /const ventasPorMoneda = ventasMesPorMonedaDesdeAgregado\(ventaMesFilas \?\? \[\]\);/);
    assert.match(home, /const ventaMes = ventasPorMoneda\["COP"\] \?\? 0;/);
    assert.match(home, /const \{ cuposCapacidad, cuposOcupados, cuposDisponibles, cuposCriticos \} = cuposResumenDesdeAgregado\(cuposFila \?\? null\);/);
    // El aggregate viejo `cartera = totalVentas - totalAbonos` (una sola
    // cifra, mezclando monedas) se REEMPLAZÓ por `carteraPorMonedaDesdeAgregado`.
    assert.doesNotMatch(home, /const cartera = Math\.max\(0, totalVentas - totalAbonos\);/);
    assert.doesNotMatch(home, /const nActivos = /);
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
    assert.match(home, /label: "Pagos por vencer \(15d\)", n: cxpTotal, href: "\/dashboard\/pagos"/);
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

describe("KPI ampliados — barras de progreso con fuente real (ronda de indicadores)", () => {
  test("pctOrNull (lib/dashboard/metricas.ts, con pruebas ejecutables en pruebas/dashboardMetricas.test.ts) no publica barra sin denominador válido — page.tsx la importa, no la redefine", () => {
    assert.match(metricasLib, /export function pctOrNull\(num: number, den: number\): number \| null \{/);
    assert.match(metricasLib, /if \(!den \|\| den <= 0\) return null;/);
    assert.match(home, /import \{\s*\n\s*pctOrNull, pctRawOrNull,\s*\n\s*clasificarContratosDesdeConteos, carteraPorMonedaDesdeAgregado, ventasMesPorMonedaDesdeAgregado, cuposResumenDesdeAgregado,\s*\n\s*BALDE_MONEDA_DESCONOCIDA,\s*\n\s*\} from "@\/lib\/dashboard\/metricas";/);
    assert.doesNotMatch(home, /function pctOrNull\(/);
  });

  test("el porcentaje se calcula desde datos reales (Math.round sobre num\\/den) y se acota a [0,100]", () => {
    assert.match(metricasLib, /Math\.max\(0, Math\.min\(100, Math\.round\(\(num \/ den\) \* 100\)\)\)/);
  });

  test("cada barra solo se arma cuando pctOrNull no dio null (ausencia de barra cuando no corresponde)", () => {
    assert.match(home, /bar: contratosPct != null \? \{ num: nConfirmadosOActivos, den: nVigentes, pct: contratosPct \} : undefined,/);
    assert.match(home, /bar: cuposPct != null \? \{ num: cuposOcupados, den: cuposCapacidad, pct: cuposPct, color: cuposBarColor \} : undefined,/);
    assert.match(home, /bar: cxpPct != null \? \{ num: cxpPagadas, den: cxpTotal, pct: cxpPct \} : undefined,/);
    assert.match(home, /bar: concPct != null \? \{ num: concHechas, den: concTotal, pct: concPct \} : undefined,/);
    assert.match(home, /bar: dianPct != null \? \{ num: dianEmitidas, den: dianTotal, pct: dianPct \} : undefined,/);
  });

  test("MetricCard renderiza cifra principal, contexto 'X de Y' y porcentaje solo si hay barra", () => {
    assert.match(home, /<span>\{bar\.num\} de \{bar\.den\}<\/span>/);
    assert.match(home, /<span className="font-semibold">\{bar\.pct\}%<\/span>/);
  });

  test("Conciliaciones, Facturación DIAN y Retención en la fuente están gateadas por `contable` (superadmin/gerencia/administracion) — NO por `interno`", () => {
    assert.match(home, /const contable = \["superadmin", "gerencia", "administracion"\]\.includes\(perfil\?\.rol \?\? ""\);/);
    assert.match(home, /\.\.\.\(contable \? \[\{\s*icon: FileCheck2, label: "Conciliaciones del mes"/);
    assert.match(home, /\.\.\.\(contable \? \[\{\s*icon: ShieldCheck, label: "Facturación DIAN"/);
    assert.match(home, /\.\.\.\(contable \? \[\{ icon: Percent, label: "Retención en la fuente \(mes\)"/);
  });

  test("las consultas gateadas por `contable` (contrato_facturacion x2, conciliacion_extracto x2, retenciones_cxp RPC) no se disparan para un rol no autorizado — devuelven un Promise.resolve default en su lugar", () => {
    assert.match(home, /contable \? supabase\.from\("contrato_facturacion"\)\.select\("numero_contrato", \{ count: "exact", head: true \}\) : Promise\.resolve\(\{ count: 0 \}\)/);
    assert.match(home, /contable \? supabase\.from\("contrato_facturacion"\)\.select\("numero_contrato", \{ count: "exact", head: true \}\)\.eq\("dian_emitida", true\) : Promise\.resolve\(\{ count: 0 \}\)/);
    assert.match(home, /contable \? supabase\.from\("conciliacion_extracto"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("tenant", tenant\)\.eq\("periodo", mesActual\) : Promise\.resolve\(\{ count: 0 \}\)/);
    assert.match(home, /contable\s*\?\s*supabase\.from\("conciliacion_extracto"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("tenant", tenant\)\.eq\("periodo", mesActual\)\.not\("conciliacion_id", "is", null\)\s*: Promise\.resolve\(\{ count: 0 \}\)/);
    assert.match(home, /contable\s*\n\s*\? supabase\.rpc\("fn_dashboard_retenciones_mes", \{ p_tenant: tenant, p_periodo: mesActual \}\)\s*\n\s*: Promise\.resolve\(\{ data: 0 \}\)/);
  });

  test("cxp_resumen (RPC, cruce con cxp_pagos hecho en base) solo se pide si el rol es `interno` — no dispara ninguna consulta extra en JS", () => {
    assert.match(home, /interno\s*\n\s*\? supabase\.rpc\("fn_dashboard_cxp_resumen", \{ p_tenant: tenant, p_desde: hoyStr, p_hasta: addDays\(15\) \}\)\.maybeSingle\(\)\s*\n\s*: Promise\.resolve\(\{ data: null as \{ total: number; pagadas: number \} \| null \}\)/);
    // No debe quedar ninguna consulta JS aparte a cxp_pagos ni ningún cruce en memoria.
    assert.doesNotMatch(home, /supabase\.from\("cxp_pagos"\)/);
    assert.doesNotMatch(home, /sumarPagosPorCuenta/);
  });

  test("facturación DIAN usa el ÚNICO estado real del modelo (dian_emitida, booleano) — no aparece ninguna mención a 'aceptada'/'rechazada' como si existieran en la base", () => {
    assert.match(home, /\.eq\("dian_emitida", true\)/);
    assert.doesNotMatch(home, /dian_aceptada|dian_rechazada|[Aa]ceptada.*[Rr]echazada.*DIAN|DIAN.*[Aa]ceptada/);
  });

  test("las cuentas por pagar 'pagadas por completo' se leen directo del agregado (cxpResumen.pagadas) — nunca se suman $ ni se cruzan filas en JS", () => {
    assert.match(home, /const cxpTotal = cxpResumen\?\.total \?\? 0;/);
    assert.match(home, /const cxpPagadas = cxpResumen\?\.pagadas \?\? 0;/);
    assert.doesNotMatch(home, /reduce.*valor_total|cxpFilas\.reduce|cxpFilas\.filter/);
  });

  test("no hay porcentajes, metas ni cifras quemadas para los KPI nuevos (sin literales como 88, 92, 95 usados como % fijo)", () => {
    assert.doesNotMatch(home, /pct:\s*\d/);
    assert.doesNotMatch(home, /meta_mensual|metaMensual|% al día|meta 88/);
  });

  test("cupos: capacidad/ocupados/disponibles/críticos vienen de un único agregado en base (fn_dashboard_cupos_resumen), no de traer cada bloqueo", () => {
    assert.match(home, /supabase\.rpc\("fn_dashboard_cupos_resumen"\)\.maybeSingle\(\)/);
    assert.doesNotMatch(home, /supabase\.from\("cupos_por_bloqueo"\)\.select\(/);
  });

  test("el color de la barra de cupos usa el mismo umbral ya existente de 'cuposCriticos' (no un umbral nuevo inventado)", () => {
    assert.match(home, /cuposCapacidad > 0 && cuposOcupados >= cuposCapacidad \? "var\(--dash-danger\)"/);
    assert.match(home, /: cuposCriticos > 0 \? "var\(--dash-warning\)"/);
  });

  test("--dash-warning deriva de tokens de marca vía color-mix (sin hex suelto)", () => {
    assert.match(css, /--dash-warning:\s*color-mix\(in srgb, var\(--brand-highlight\) 55%, var\(--destructive\) 45%\);/);
  });

  test("la barra es delgada (.barTrack de 5px) y estable (transición de ancho, sin animación abrupta)", () => {
    assert.match(css, /\.barTrack\s*\{[^}]*height:\s*5px;/);
    assert.match(css, /\.barFill\s*\{[^}]*transition:\s*width 0\.3s ease;/);
  });

  test("el KPI de retención en la fuente NO lleva barra (sin denominador real posible) — solo cifra + sub", () => {
    assert.match(home, /\{ icon: Percent, label: "Retención en la fuente \(mes\)", value: formatCOP\(retencionMes\), sub: "Practicada a proveedores" \}/);
  });

  test("responsive: el grid de métricas sigue en 2 columnas en móvil y 4 en escritorio (sin recortes al agregar más tarjetas)", () => {
    assert.match(home, /<section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">/);
  });
});

describe("Meta general de ventas — migración, permisos y KPI (segunda ronda)", () => {
  test("la tabla es nueva, aditiva, con unicidad tenant+periodo+moneda y valor positivo", () => {
    assert.match(metaMigracion, /create table if not exists public\.meta_ventas_mensual \(/);
    assert.match(metaMigracion, /valor\s+numeric\(15,2\) not null check \(valor > 0\)/);
    assert.match(metaMigracion, /unique \(tenant, periodo, moneda\)/);
    assert.match(metaMigracion, /actualizado_por text/);
    assert.match(metaMigracion, /created_at\s+timestamptz not null default now\(\)/);
    assert.match(metaMigracion, /updated_at\s+timestamptz not null default now\(\)/);
  });

  test("RLS: lectura para el set `interno` (incluye operaciones), escritura (insert/update/delete) solo para el set `contable` — ambas acotadas por tenant", () => {
    assert.match(metaMigracion, /create policy "meta_ventas: lectura interna"\s*\n\s*on public\.meta_ventas_mensual for select\s*\n\s*using \(\s*\n\s*public\.mi_rol\(\) in \('superadmin','gerencia','administracion','operaciones'\)\s*\n\s*and public\.puede_ver_tenant\(tenant\)/);
    assert.match(metaMigracion, /create policy "meta_ventas: escritura contable"\s*\n\s*on public\.meta_ventas_mensual for insert\s*\n\s*with check \(\s*\n\s*public\.mi_rol\(\) in \('superadmin','gerencia','administracion'\)/);
    assert.match(metaMigracion, /create policy "meta_ventas: actualizar contable"\s*\n\s*on public\.meta_ventas_mensual for update/);
    assert.match(metaMigracion, /create policy "meta_ventas: eliminar contable"\s*\n\s*on public\.meta_ventas_mensual for delete/);
    assert.doesNotMatch(metaMigracion, /for all/);
  });

  test("preflight/postcheck son scripts SQL ejecutables aparte (no un comentario dentro de la migración), y ninguno se ejecuta remoto desde acá", () => {
    assert.match(metaMigracion, /supabase\/scripts\/preflight_185_meta_ventas_mensual\.sql\s*\(correr ANTES\)/);
    assert.match(metaMigracion, /supabase\/scripts\/postcheck_185_meta_ventas_mensual\.sql\s*\(correr DESPUÉS\)/);
    assert.match(metaPreflight, /SOLO LECTURA — no modifica nada\. Correr ANTES de aplicar la 185\./);
    assert.match(metaPostcheck, /SOLO LECTURA\. Correr DESPUÉS de aplicar la 185\./);
  });

  test("el preflight es una sola sentencia (Supabase SQL Editor), sin metacomandos, y comprueba tabla aún no existe / helpers de RLS / ausencia de conflicto", () => {
    assert.match(metaPreflight, /'tabla_no_existe_aun', to_regclass\('public\.meta_ventas_mensual'\) is null,/);
    assert.match(metaPreflight, /'existe_mi_rol'/);
    assert.match(metaPreflight, /'existe_puede_ver_tenant'/);
    assert.match(metaPreflight, /'sin_policies_previas'/);
    assert.match(metaPreflight, /select jsonb_build_object\(/);
  });

  test("el postcheck comprueba columnas/checks/unique, RLS habilitada, policies por acción, roles de lectura/escritura, trigger de updated_at (ausente por diseño), y GRANT de tabla+secuencia (anon sin nada, authenticated con lo mínimo, service_role con todo) — una sola sentencia, JSON final con ok", () => {
    assert.match(metaPostcheck, /'rls_habilitada', rls_habilitada,/);
    assert.match(metaPostcheck, /'policies_4', policies_4,/);
    assert.match(metaPostcheck, /'lectura_incluye_operaciones', lectura_incluye_operaciones,/);
    assert.match(metaPostcheck, /'escritura_sin_operaciones', escritura_sin_operaciones,/);
    assert.match(metaPostcheck, /'sin_trigger_updated_at', sin_trigger_updated_at,/);
    assert.match(metaPostcheck, /anon_tabla_sin_acceso/);
    assert.match(metaPostcheck, /authenticated_tabla_ok/);
    assert.match(metaPostcheck, /service_role_tabla_ok/);
    assert.match(metaPostcheck, /anon_secuencia_sin_acceso/);
    assert.match(metaPostcheck, /authenticated_secuencia_ok/);
    assert.match(metaPostcheck, /service_role_secuencia_ok/);
    assert.match(metaPostcheck, /select jsonb_build_object\(\s*\n\s*'ok',/);
  });

  test("preflight y postcheck 185 NO tienen ninguna línea que empiece por '\\' (sin metacomandos de psql) y devuelven un único JSON", () => {
    for (const script of [metaPreflight, metaPostcheck]) {
      const lineasConBarra = script.split("\n").filter((l) => l.trim().startsWith("\\"));
      assert.deepEqual(lineasConBarra, []);
      assert.equal((script.match(/select jsonb_build_object\(/g) ?? []).length, 1);
    }
  });

  test("migración 185: GRANT explícito de tabla y secuencia — anon/public sin nada, authenticated select/insert/update/delete + usage/select de secuencia, service_role con todo", () => {
    assert.match(metaMigracion, /revoke all on public\.meta_ventas_mensual from public, anon, authenticated;/);
    assert.match(metaMigracion, /grant select, insert, update, delete on public\.meta_ventas_mensual to authenticated;/);
    assert.match(metaMigracion, /grant all on public\.meta_ventas_mensual to service_role;/);
    assert.match(metaMigracion, /revoke all on sequence public\.meta_ventas_mensual_id_seq from public, anon, authenticated;/);
    assert.match(metaMigracion, /grant usage, select on sequence public\.meta_ventas_mensual_id_seq to authenticated;/);
    assert.match(metaMigracion, /grant all on sequence public\.meta_ventas_mensual_id_seq to service_role;/);
  });

  test("existe un rollback dedicado que reconoce que los datos cargados se pierden", () => {
    assert.match(metaRollback, /drop table if exists public\.meta_ventas_mensual;/);
    assert.match(metaRollback, /SE PIERDE/);
  });

  test("types/database.ts declara la tabla nueva (Row/Insert/Update) — el cliente de Supabase la reconoce en tsc --noEmit", () => {
    assert.match(dbTypes, /meta_ventas_mensual: \{/);
  });

  test("guardarMetaVentas: valida formato de periodo y valor > 0, y exige rol contable ANTES de escribir (defensa en profundidad sobre la RLS real)", () => {
    assert.match(metaActions, /if \(!\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(input\.periodo\)\)/);
    assert.match(metaActions, /if \(!Number\.isFinite\(input\.valor\) \|\| input\.valor <= 0\)/);
    assert.match(metaActions, /if \(!\["superadmin", "gerencia", "administracion"\]\.includes\(perfil\?\.rol \?\? ""\)\)/);
  });

  test("la meta se guarda con upsert por (tenant, periodo, moneda) — nunca inserta duplicados silenciosos para el mismo mes", () => {
    assert.match(metaActions, /\.upsert\(\s*\{[\s\S]*?\},\s*\{ onConflict: "tenant,periodo,moneda" \}\s*\)/);
  });

  test("el editor administrativo (MetaVentasConfig) deja explícito que NO es la suma de metas individuales de asesores", () => {
    assert.match(metaConfigUI, /no la suma de las metas individuales de los asesores/);
  });

  test("Dashboard: la meta se consulta solo si `interno`, para el mes actual, TODAS las monedas configuradas (cada moneda compara contra su propia meta) — nunca sumando asesores.meta_mensual", () => {
    assert.match(home, /supabase\.from\("meta_ventas_mensual"\)\.select\("moneda, valor"\)\.eq\("tenant", tenant\)\.eq\("periodo", mesActual\)/);
    assert.doesNotMatch(home, /meta_mensual/);
  });

  test("sin meta configurada: NO se dibuja barra y el copy dice exactamente 'Sin meta general configurada' (nunca se asume 0)", () => {
    assert.match(home, /sub: metaVentas == null\s*\n\s*\? "Sin meta general configurada"/);
    assert.match(home, /bar: metaVentas != null && metaVentasPct != null \? \{ num: ventaMes, den: metaVentas, pct: metaVentasPct \} : undefined,/);
  });

  test("el % PRINCIPAL de ventas-vs-meta usa la variante ACOTADA (pctOrNull) — nunca pctRawOrNull. Superar la meta jamás se muestra como '134%' en el número principal", () => {
    assert.match(home, /const metaVentasPct = metaVentas != null \? pctOrNull\(ventaMes, metaVentas\) : null;/);
    assert.doesNotMatch(home, /const metaVentasPct = metaVentas != null \? pctRawOrNull/);
  });

  test("la variante SIN acotar (pctRawOrNull) se usa SOLO para detectar y cuantificar el excedente, en una variable aparte que nunca alimenta el bar.pct principal", () => {
    assert.match(home, /const metaVentasPctCrudo = metaVentas != null \? pctRawOrNull\(ventaMes, metaVentas\) : null;/);
    assert.match(home, /const metaSuperadaPor = metaVentas != null && metaVentasPctCrudo != null && metaVentasPctCrudo > 100 \? ventaMes - metaVentas : null;/);
  });

  test("al superar la meta, el sub-texto muestra el excedente en pesos ('Meta general superada por $X'), nunca un % de 3 dígitos", () => {
    assert.match(home, /`Meta general superada por \$\{formatCOP\(metaSuperadaPor\)\}`/);
  });

  test("el ANCHO de la barra sí se acota a 100% al renderizar (defensa adicional, aunque metaVentasPct ya viene acotado por pctOrNull)", () => {
    assert.match(home, /width: `\$\{Math\.max\(0, Math\.min\(100, bar\.pct\)\)\}%`/);
  });

  test("el texto usa 'Meta general del mes' (no 'meta' a secas), distinguiéndola del cálculo dinámico de Punto de equilibrio", () => {
    assert.match(home, /Meta general del mes: \$\{formatCOP\(metaVentas\)\}/);
    assert.match(metaConfigUI, /<h2 className="text-sm font-semibold text-gray-700">Meta general del mes<\/h2>/);
  });

  test("MetaVentasConfig documenta con evidencia que NO reemplaza pe_empleados/pe_costos (cálculo dinámico) y que son dos datos técnicos distintos", () => {
    assert.match(metaConfigUI, /NO reemplaza ni modifica el cálculo dinámico de "Punto de equilibrio"/);
    assert.match(metaConfigUI, /pe_empleados.*pe_costos/);
    assert.match(metaConfigUI, /son dos datos técnicos\s*\n\/\/\s*DISTINTOS/);
  });

  test("(revisión de fórmula) metaPorMoneda se arma por moneda — COP se compara SOLO contra meta COP, nunca contra ventas de otra moneda", () => {
    assert.match(home, /const metaPorMoneda: Record<string, number> = \{\};/);
    assert.match(home, /for \(const f of metaVentasFilas \?\? \[\]\) metaPorMoneda\[f\.moneda\] = Number\(f\.valor\) \|\| 0;/);
    assert.match(home, /const metaVentas = metaPorMoneda\["COP"\] \?\? null;/);
  });

  test("meta USD (u otra moneda) se muestra en una tarjeta INDEPENDIENTE, comparada solo contra ventas de esa misma moneda, nunca convertida", () => {
    assert.match(home, /const ventaMesOtras = Object\.keys\(\{ \.\.\.ventasPorMoneda, \.\.\.metaPorMoneda \}\)/);
    assert.match(home, /\.filter\(\(m\) => m !== "COP" && m !== BALDE_MONEDA_DESCONOCIDA\)/);
    assert.match(home, /icon: Wallet, label: `Ventas del mes \(\$\{moneda\}\)`/);
    assert.match(home, /bar: meta != null && pct != null \? \{ num: venta, den: meta, pct \} : undefined,/);
  });

  test("meta COP sin ventas COP → avance 0% (nunca 'sin meta', nunca se omite la barra)", () => {
    // pctOrNull(0, metaCOP) = 0, no null — el bar se arma igual con pct 0.
    // Cubierto ejecutablemente en pruebas/dashboardMetricas.test.ts
    // ("ventas en 0% de la meta").
    assert.match(dashboardMetricasTest, /ventas en 0% de la meta/);
  });
});

describe("Cartera al día/vencida — fecha del viaje − 30 días (lógica movida a lib/dashboard/metricas.ts, probada a fondo en pruebas/dashboardMetricas.test.ts)", () => {
  test("fechaLimitePago/clasificarCartera viven en la librería pura, exportadas — page.tsx las importa, no las redefine", () => {
    assert.match(metricasLib, /export function fechaLimitePago\(fechaSalida: string\): string \{/);
    assert.match(metricasLib, /d\.setUTCDate\(d\.getUTCDate\(\) - 30\);/);
    assert.match(metricasLib, /export function clasificarCartera\(/);
    assert.doesNotMatch(home, /function fechaLimitePago\(/);
    assert.doesNotMatch(home, /function clasificarCartera\(/);
  });

  test("usa 'hoy' en zona horaria de Bogotá (en-CA da formato ISO), no la fecha UTC del servidor", () => {
    assert.match(home, /const hoyBogota = new Date\(\)\.toLocaleDateString\("en-CA", \{ timeZone: "America\/Bogota" \}\);/);
  });

  test("vencida: hoyBogota > fechaLimite; al día: lo contrario — comparación estricta, sin margen inventado (ver pruebas del día exacto vs. día siguiente en dashboardMetricas.test.ts)", () => {
    assert.match(metricasLib, /if \(hoyBogota > fechaLimitePago\(v\.fecha_salida\)\) bucket\.vencida \+= saldo;/);
    assert.match(metricasLib, /else bucket\.alDia \+= saldo;/);
  });

  test("saldo pendiente = precio_venta - abonos del contrato; saldo <= 0 (pagado por completo) se EXCLUYE de la cartera", () => {
    assert.match(metricasLib, /const saldo = \(v\.precio_venta \?\? 0\) - \(abonosPorContrato\[v\.numero_contrato\] \?\? 0\);/);
    assert.match(metricasLib, /if \(saldo <= 0\) continue;/);
  });

  test("page.tsx ya NO calcula cartera en JS: la clasificación al día/vencida/sin-fecha se hace en base (fn_dashboard_cartera_por_moneda) y page.tsx solo reempaqueta el resultado", () => {
    assert.match(home, /const carteraPorMoneda = carteraPorMonedaDesdeAgregado\(carteraFilas \?\? \[\]\);/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_cartera_por_moneda", \{ p_tenant: tenant, p_hoy: hoyBogota \}\)/);
    assert.doesNotMatch(home, /supabase\.from\("ventas"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("abonos"\)\.select\(/);
  });

  test("fecha de viaje ausente: NUNCA se clasifica como al día — queda en un balde `sinFecha` aparte", () => {
    assert.match(metricasLib, /if \(!v\.fecha_salida\) \{/);
    assert.match(metricasLib, /bucket\.sinFecha \+= saldo;/);
    assert.match(metricasLib, /bucket\.sinFechaCount \+= 1;/);
  });

  test("se clasifica POR MONEDA (Record<string, CarteraBucket>) — nunca se suma COP con USD en el mismo balde", () => {
    assert.match(metricasLib, /const moneda = v\.moneda \|\| "COP";/);
    assert.match(metricasLib, /const porMoneda: Record<string, CarteraBucket> = \{\};/);
  });

  test("la barra es al día / cartera CLASIFICABLE (al día + vencida) — el saldo sin fecha queda fuera del %", () => {
    assert.match(home, /const carteraClasificableCOP = carteraCOP\.alDia \+ carteraCOP\.vencida;/);
    assert.match(home, /const carteraPctCOP = pctOrNull\(carteraCOP\.alDia, carteraClasificableCOP\);/);
  });

  test("el color de la barra pasa a crítico (--dash-danger) cuando hay saldo vencido real", () => {
    assert.match(home, /color: carteraCOP\.vencida > 0 \? "var\(--dash-danger\)" : undefined/);
  });

  test("monedas distintas de COP (ej. USD) se muestran en tarjetas separadas, nunca convertidas sin TRM persistida — usa formatUSD, no una conversión inventada", () => {
    assert.match(home, /const carteraOtras = Object\.entries\(carteraPorMoneda\)\.filter\(\(\[m\]\) => m !== "COP"\);/);
    assert.match(home, /value: moneda === "USD" \? formatUSD\(total\) : `\$\{total\.toLocaleString\("es-CO"\)\} \$\{moneda\}`,/);
  });

  test("el aviso de saldos sin fecha clasificable aparece en el sub-texto de la tarjeta, con conteo Y monto separados del % clasificado", () => {
    assert.match(home, /\$\{carteraCOP\.sinFechaCount\} contrato\(s\) sin fecha de viaje \(\$\{formatCOP\(carteraCOP\.sinFecha\)\}, sin clasificar\)/);
  });

  test("la cartera COP gatea por `interno`, igual que antes", () => {
    assert.match(home, /icon: HandCoins, label: "Cartera por cobrar \(COP\)"/);
  });
});

describe("Contratos — fórmula revisada: numerador SUBCONJUNTO explícito del denominador (lógica movida a lib/dashboard/metricas.ts)", () => {
  test("la semántica de 'pendiente'/'confirmado'/'activo'/'cancelado' queda documentada con evidencia del flujo de creación, en la librería pura", () => {
    assert.match(metricasLib, /'pendiente'\s+→ nace así en Reservar/);
    assert.match(metricasLib, /'confirmado' → ese mismo flujo tras confirmarse/);
    assert.match(metricasLib, /'activo'\s+→ el generador de contrato MANUAL/);
  });

  test("el numerador se calcula con un FILTRO explícito (confirmado U activo), nunca por resta — no puede superar el denominador aunque aparezca un estado no contemplado", () => {
    assert.match(metricasLib, /const ESTADOS_CONFIRMADO_O_ACTIVO = new Set\(\["confirmado", "activo"\]\);/);
    assert.match(metricasLib, /const nConfirmadosOActivos = vigentes\.filter\(\(v\) => ESTADOS_CONFIRMADO_O_ACTIVO\.has\(v\.estado \?\? ""\)\)\.length;/);
    assert.doesNotMatch(metricasLib, /const nConfirmadosOActivos = nVigentes - nPendientes;/);
  });

  test("el numerador (confirmados/activos) y el denominador (vigentes) provienen del MISMO array filtrado (`vigentes`) — subconjunto garantizado", () => {
    assert.match(metricasLib, /const vigentes = ventas\.filter\(\(v\) => v\.estado !== "cancelado"\);/);
    assert.match(metricasLib, /vigentes\.filter\(\(v\) => ESTADOS_CONFIRMADO_O_ACTIVO\.has/);
    assert.match(metricasLib, /return \{ nVigentes: vigentes\.length, nPendientes, nConfirmadosOActivos \};/);
  });

  test("page.tsx delega en clasificarContratosDesdeConteos (agregado en base, no filas) — la variable renombrada ya no significa 'estado === activo'", () => {
    assert.match(home, /const \{ nVigentes, nPendientes, nConfirmadosOActivos \} = clasificarContratosDesdeConteos\(contratosPorEstado \?\? \[\]\);/);
    assert.doesNotMatch(home, /const nActivos\b/);
    assert.doesNotMatch(home, /[^`\s]nActivos,/); // nunca usada como identificador real (num:/den: etc.)
  });

  test("la barra de Contratos usa el numerador explícito, no una resta", () => {
    assert.match(home, /bar: contratosPct != null \? \{ num: nConfirmadosOActivos, den: nVigentes, pct: contratosPct \} : undefined,/);
  });

  test("escenario ejecutable '2 pendientes + 3 confirmados + 1 activo + 1 cancelado → 4 de 6' — probado en pruebas/dashboardMetricas.test.ts, no solo por inspección de fuente", () => {
    assert.match(dashboardMetricasTest, /2 pendientes \+ 3 confirmados \+ 1 activo \+ 1 cancelado → 4 de 6 \(nunca 4 de 1\)/);
    assert.match(dashboardMetricasTest, /assert\.equal\(nVigentes, 6\);/);
    assert.match(dashboardMetricasTest, /assert\.equal\(nConfirmadosOActivos, 4\);/);
  });
});

describe("Pagos por vencer (15d) — universo coherente, ahora resuelto en base", () => {
  test("total y pagadas vienen del mismo agregado (fn_dashboard_cxp_resumen) — nunca dos consultas distintas que puedan desalinearse", () => {
    assert.match(home, /const cxpTotal = cxpResumen\?\.total \?\? 0;/);
    assert.match(home, /const cxpPagadas = cxpResumen\?\.pagadas \?\? 0;/);
  });

  test("las cuentas ya pagadas NO se excluyen del total — el copy dice explícitamente 'X de Y ya saldada(s)'", () => {
    assert.match(home, /sub: cxpTotal > 0 \? `\$\{cxpPagadas\} de \$\{cxpTotal\} ya saldada\(s\) por completo` : "Sin cuentas por vencer",/);
  });

  test("el porcentaje de Pagos por vencer usa pctOrNull (acotado 0-100) — mismo guard que el resto de barras de conteo", () => {
    assert.match(home, /const cxpPct = pctOrNull\(cxpPagadas, cxpTotal\);/);
  });
});

describe("Costo de las consultas (ronda de agregación en base) — ninguna tarjeta descarga filas completas solo para sumar o contar", () => {
  test("fetchAllPaginado (lib/supabase/fetchAllPaginado.ts) se MANTIENE como utilidad reutilizable, con sus pruebas intactas — pero el Dashboard ya no la usa", () => {
    assert.match(fetchAllPaginadoLib, /export async function fetchAllPaginado<T>\(/);
    assert.match(fetchAllPaginadoLib, /if \(error\) break;/);
    assert.match(fetchAllPaginadoTest, /con más filas que el límite simulado, el total y la suma agregada son IDÉNTICOS a una lectura sin límite/);
    assert.doesNotMatch(home, /fetchAllPaginado/);
  });

  test("ventas, abonos, cupos_por_bloqueo, cuentas_por_pagar y retenciones_cxp ya NO se descargan fila por fila en dashboard/page.tsx — se leen vía las 6 RPC de agregación (migración 186)", () => {
    assert.match(home, /supabase\.rpc\("fn_dashboard_contratos_por_estado", \{ p_tenant: tenant \}\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_cupos_resumen"\)\.maybeSingle\(\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_retenciones_mes", \{ p_tenant: tenant, p_periodo: mesActual \}\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_cxp_resumen", \{ p_tenant: tenant, p_desde: hoyStr, p_hasta: addDays\(15\) \}\)\.maybeSingle\(\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_cartera_por_moneda", \{ p_tenant: tenant, p_hoy: hoyBogota \}\)/);
    assert.match(home, /supabase\.rpc\("fn_dashboard_ventas_mes", \{ p_tenant: tenant, p_periodo: mesActual \}\)/);
  });

  test("los conteos (paquetes, salidas próximas, contrato_facturacion x2, conciliacion_extracto x2) siguen usando `count: exact, head: true` — no están sujetos a Max Rows y no necesitan agregación aparte", () => {
    assert.match(home, /supabase\.from\("paquetes"\)\.select\("id", \{ count: "exact", head: true \}\)/);
    assert.match(home, /supabase\.from\("bloqueos_vuelo"\)\.select\("id", \{ count: "exact", head: true \}\)/);
    assert.match(home, /supabase\.from\("contrato_facturacion"\)\.select\("numero_contrato", \{ count: "exact", head: true \}\)/);
    assert.match(home, /supabase\.from\("conciliacion_extracto"\)\.select\("id", \{ count: "exact", head: true \}\)/);
  });

  test("no queda ningún .select() de filas individuales de ventas/abonos/cupos_por_bloqueo/cuentas_por_pagar/retenciones_cxp/cxp_pagos en dashboard/page.tsx", () => {
    assert.doesNotMatch(home, /supabase\.from\("ventas"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("abonos"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("cupos_por_bloqueo"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("cuentas_por_pagar"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("retenciones_cxp"\)\.select\(/);
    assert.doesNotMatch(home, /supabase\.from\("cxp_pagos"\)\.select\(/);
  });

  test("cantidad de consultas FIJA: exactamente 14 llamadas a Supabase en dashboard/page.tsx (1 perfil + 13 en el Promise.all), sin importar el número de tarjetas ni el volumen de datos", () => {
    const llamadas = (home.match(/supabase\.(from|rpc)\(/g) ?? []).length;
    assert.equal(llamadas, 14, `se esperaban 14 llamadas a supabase.from/rpc, se encontraron ${llamadas}`);
  });

  test("meta_ventas_mensual sigue siendo pequeño por diseño (unicidad tenant+periodo+moneda) — ahora trae todas las monedas del periodo, no solo COP, para comparar cada una contra su propia meta", () => {
    assert.match(home, /supabase\.from\("meta_ventas_mensual"\)\.select\("moneda, valor"\)\.eq\("tenant", tenant\)\.eq\("periodo", mesActual\)/);
  });
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
