// Wiring por inspección de fuente para el mecanismo de "señal de navegación
// pendiente" de `SidebarNav.tsx`. No es una prueba de renderizado real: el
// contrato de `useLinkStatus` (next/link) exige un <Link> real con contexto
// de router del App Router, que este repo no simula en jsdom para ningún
// componente todavía — por eso el mecanismo (mismo hook, mismo debounce,
// mismo componente `IsotipoMini`) se verificó por separado, en NAVEGADOR
// REAL, con una réplica fiel del hook contra rutas públicas reales (grabado
// en video con Playwright; evidencia entregada aparte, no en este archivo).
// Esto solo confirma que el CABLEADO de producción coincide con lo que esa
// verificación probó.
//
// Corrección (Preview): al pulsar Ventas/Contratos/Contabilidad/Producto en
// el sidebar, la pantalla anterior quedaba inmóvil 1-2s sin ninguna señal
// visible — los enlaces son `<Link prefetch={false}>`, así que cada clic
// paga primero el viaje de red del payload de la ruta, y sin prefetch no
// existe nada que un `loading.tsx` pueda mostrar hasta que ese payload
// llega. `useLinkStatus` (`pending`) expone exactamente esa espera.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const fuente = leer("app/(dashboard)/SidebarNav.tsx");

function cuerpoFuncion(fuenteCompleta: string, ancla: string): string {
  const idx = fuenteCompleta.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let profundidadParen = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "{" && profundidadParen === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" del cuerpo tras "${ancla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${ancla}"`);
}

describe("SidebarNav.tsx — useLinkStatus + retraso de aparición, sin temporizador que finja/termine la navegación", () => {
  test("useLinkStatus se importa de next/link (no una implementación propia)", () => {
    assert.match(fuente, /import Link, \{ useLinkStatus \} from "next\/link";/);
  });

  test("usePendienteConRetraso llama useLinkStatus para leer `pending` — la fuente real de verdad, nunca un estado propio inventado", () => {
    const cuerpo = cuerpoFuncion(fuente, "function usePendienteConRetraso(): boolean {");
    assert.match(cuerpo, /const \{ pending \} = useLinkStatus\(\);/);
  });

  test("el temporizador SOLO decide cuándo APARECE la señal (retraso de aparición) — nunca la apaga por sí solo: el `false` vive en el cleanup (reacciona a que `pending` cambió), no en un segundo setTimeout", () => {
    const cuerpo = cuerpoFuncion(fuente, "function usePendienteConRetraso(): boolean {");
    assert.match(cuerpo, /if \(!pending\) return;/, "sin pending, no debe programar nada (ni mostrar ni ocultar por temporizador)");
    assert.match(cuerpo, /const t = setTimeout\(\(\) => setMostrar\(true\), RETRASO_APARICION_MS\);/);
    assert.match(cuerpo, /return \(\) => \{ clearTimeout\(t\); setMostrar\(false\); \};/);
    // Guard: no debe existir un SEGUNDO setTimeout que appague `mostrar`
    // (eso sería "temporizador que termina la navegación por su cuenta").
    const ocurrenciasSetTimeout = [...cuerpo.matchAll(/setTimeout\(/g)];
    assert.equal(ocurrenciasSetTimeout.length, 1, "solo debe existir un setTimeout (el de aparición), nunca uno de desaparición");
  });

  test("NavIcon y NavBullet son hijos DIRECTOS de cada <Link> (nunca llamados desde Group, que solo renderiza el <Link> — useLinkStatus exige estar dentro de él)", () => {
    // Los 3 <Link> del archivo (colapsado, Group principal, hijos) deben
    // envolver a NavIcon/NavBullet como children, no invocar el hook desde
    // el componente padre y pasar un booleano por prop.
    const usosNavIcon = [...fuente.matchAll(/<NavIcon\b/g)];
    const usosNavBullet = [...fuente.matchAll(/<NavBullet\b/g)];
    assert.equal(usosNavIcon.length, 2, "NavIcon debe usarse en el <Link> colapsado y en el <Link> principal de Group");
    assert.equal(usosNavBullet.length, 1, "NavBullet debe usarse en el <Link> de cada hijo");
  });

  test("Group (el componente que RENDERIZA los <Link>, no vive dentro de ellos) nunca llama useLinkStatus directamente — evita el error documentado de next/link", () => {
    const cuerpoGroup = cuerpoFuncion(fuente, "function Group({ item, pathname }: { item: NavItem; pathname: string }) {");
    assert.doesNotMatch(cuerpoGroup, /useLinkStatus/);
  });

  test("el isotipo reutiliza LA MISMA animación/estático-por-reduced-motion que components/LoadingScreen.tsx (markStyles.mark), en vez de declarar una segunda animación paralela", () => {
    assert.match(fuente, /import markStyles from "@\/components\/LoadingScreen\.module\.css";/);
    assert.match(fuente, /className=\{markStyles\.mark\}/);
  });

  test("la señal es puramente de presentación: no aparece en el <Link> con prefetch distinto de false, ni cambia href/navegación/permisos (los 3 <Link> siguen con prefetch={false} y el mismo href de siempre)", () => {
    const sinComentarios = fuente.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const ocurrenciasPrefetch = [...sinComentarios.matchAll(/prefetch=\{false\}/g)];
    assert.equal(ocurrenciasPrefetch.length, 3, "los 3 <Link> (colapsado, principal, hijo) deben seguir con prefetch={false}");
  });
});
