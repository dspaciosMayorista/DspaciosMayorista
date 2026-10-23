"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, X } from "lucide-react";
import { SidebarNav, type NavItem } from "./SidebarNav";
import styles from "./DashboardShell.module.css";

// Menú del celular (< md). Antes el header móvil pintaba solo el primer nivel
// de `nav` en una fila con scroll horizontal: los submenús (Vuelos, Montaje,
// Netas, Finanzas, Contabilidad) no se podían abrir sin conocer la URL. Ahora
// un botón abre un panel con el MISMO `SidebarNav` del escritorio: mismos
// ítems ya filtrados por rol/tenant en layout.tsx, mismos hijos, mismo estado
// activo y misma señal de navegación pendiente. El móvil no decide permisos.
//
// El panel queda MONTADO aunque esté cerrado (atributo `hidden`): al tocar un
// enlace se cierra de inmediato, pero su <Link> sigue vivo y `useLinkStatus`
// mantiene el indicador de carga sobre el contenido mientras llega la ruta.

const MEDIA_ESCRITORIO = "(min-width: 768px)"; // breakpoint `md` de Tailwind
const ENFOCABLES = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Ítem (y sub-ítem) de la ruta actual, para orientar con el menú cerrado. Gana el href más largo. */
export function seccionActual(nav: NavItem[], pathname: string): { padre: string; hijo: string | null } | null {
  let mejor: { largo: number; padre: string; hijo: string | null } | null = null;
  for (const it of nav) {
    for (const c of it.children ?? []) {
      if (c.href === pathname && (!mejor || c.href.length > mejor.largo)) {
        mejor = { largo: c.href.length, padre: it.label, hijo: c.label === it.label ? null : c.label };
      }
    }
    const coincide = it.href === pathname || pathname.startsWith(`${it.href}/`);
    if (coincide && (!mejor || it.href.length > mejor.largo)) {
      mejor = { largo: it.href.length, padre: it.label, hijo: null };
    }
  }
  return mejor && { padre: mejor.padre, hijo: mejor.hijo };
}

export function MobileNav({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname();
  // "Abierto en esta ruta": si la ruta cambia (enlace, atrás del navegador) el
  // panel queda cerrado solo, sin un efecto que sincronice estado.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn !== null && abiertoEn === pathname;
  const panelId = useId();
  const tituloId = useId();
  const botonRef = useRef<HTMLButtonElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function cerrar() {
    setAbiertoEn(null);
    botonRef.current?.focus();
  }

  // Fondo inmóvil mientras el panel está abierto (mismo criterio que el carrito
  // del tarifario) y foco dentro del panel al abrir.
  useEffect(() => {
    if (!abierto) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, [abierto]);

  // Si la ventana pasa a escritorio con el panel abierto, se cierra: ahí ya
  // está el sidebar y el panel quedaría oculto con el fondo bloqueado.
  useEffect(() => {
    if (!abierto || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MEDIA_ESCRITORIO);
    const alCambiar = () => { if (mq.matches) setAbiertoEn(null); };
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, [abierto]);

  // Teclado: Escape cierra; Tab/Shift+Tab no se escapan del panel abierto.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const enfocables = [...panelRef.current.querySelectorAll<HTMLElement>(ENFOCABLES)];
    if (!enfocables.length) return;
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  // Tocar un destino cierra el panel; la navegación del <Link> sigue su curso.
  // Ctrl/Cmd/Shift/clic medio (abrir en otra pestaña) no lo cierran.
  function onClickPanel(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((e.target as Element).closest("a[href]")) cerrar();
  }

  const seccion = seccionActual(nav, pathname);

  return (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <button
          ref={botonRef}
          type="button"
          onClick={() => setAbiertoEn(pathname)}
          aria-expanded={abierto}
          aria-controls={panelId}
          aria-haspopup="dialog"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors hover:bg-[var(--dash-muted-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dash-accent)]"
          style={{ borderColor: "var(--dash-border)", color: "var(--dash-primary)" }}
        >
          <Menu size={18} aria-hidden />
          Menú
        </button>
        {seccion && (
          <p className="flex min-w-0 items-center gap-1 text-sm" style={{ color: "var(--dash-ink-muted)" }}>
            <span className="truncate">{seccion.padre}</span>
            {seccion.hijo && (
              <>
                <ChevronRight size={14} aria-hidden className="shrink-0" />
                <span className="truncate font-medium" style={{ color: "var(--dash-ink)" }}>{seccion.hijo}</span>
              </>
            )}
          </p>
        )}
      </div>

      <div hidden={!abierto} className="fixed inset-0 z-50 md:hidden">
        <div
          aria-hidden
          onClick={cerrar}
          className="absolute inset-0"
          style={{ backgroundColor: "color-mix(in srgb, var(--dash-ink) 45%, transparent)" }}
        />
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={tituloId}
          onKeyDown={onKeyDown}
          onClick={onClickPanel}
          className={`${styles.menuMovil} absolute inset-y-0 left-0 flex w-[85vw] max-w-xs flex-col border-r shadow-lg`}
          style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)", borderTop: "4px solid var(--dash-primary)" }}
        >
          <div className="flex items-center justify-between border-b py-1 pl-4 pr-2" style={{ borderColor: "var(--dash-border)" }}>
            <h2 id={tituloId} className="text-sm font-semibold" style={{ color: "var(--dash-ink)" }}>
              Menú
            </h2>
            <button
              ref={cerrarRef}
              type="button"
              onClick={cerrar}
              aria-label="Cerrar menú"
              className="grid h-11 w-11 place-items-center rounded-lg transition-colors hover:bg-[var(--dash-muted-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dash-accent)]"
              style={{ color: "var(--dash-ink-muted)" }}
            >
              <X size={20} aria-hidden />
            </button>
          </div>
          <SidebarNav items={nav} />
        </div>
      </div>
    </>
  );
}
