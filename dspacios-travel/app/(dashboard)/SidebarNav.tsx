"use client";

import Link, { useLinkStatus } from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Tags, Ticket, FileText, ShoppingBag, FileSignature, Plane, Package, Boxes,
  Wallet, Users, UserCheck, Settings, Globe, Contact, ChevronDown, ChevronRight,
  Circle, History, Calculator, Upload, type LucideIcon,
} from "lucide-react";
import markStyles from "@/components/LoadingScreen.module.css";
import { LoadingScreen } from "@/components/LoadingScreen";

export type NavItem = {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
  separadorAntes?: boolean;   // dibuja un separador antes de este ítem
  grupo?: string;             // etiqueta de sección (Comercial, Operación…)
  iconKey?: string;           // ícono lucide (ver ICONS)
  modulo?: string;            // módulo de permisos (para ocultar según rol)
  soloSuperadmin?: boolean;   // visible solo para el rol superadmin
  rolesPermitidos?: string[]; // visible solo para estos roles (ignora `modulo`)
  minoristaOculto?: boolean;  // se oculta cuando la agencia activa es minorista
  soloMinorista?: boolean;    // visible SOLO cuando la agencia activa es minorista
};

const ICONS: Record<string, LucideIcon> = {
  tarifario: Tags, reservar: Ticket, cotizaciones: FileText, ventas: ShoppingBag,
  contratos: FileSignature, vuelos: Plane, paquetes: Package, producto: Boxes,
  finanzas: Wallet, usuarios: Users, b2b: UserCheck, configuracion: Settings,
  cms: Globe, crm: Contact, auditoria: History, contabilidad: Calculator, importar: Upload,
};

// Colores por estilo inline, nunca por clases utilitarias de color de
// Tailwind — los tokens --dash-* son variables CSS scoped al shell del
// Dashboard (ver DashboardShell.module.css).
const ITEM_INACTIVO = "var(--dash-ink-muted)";
const SUBITEM_INACTIVO = "var(--dash-ink-muted)";

// Retraso de APARICIÓN de la señal de navegación pendiente — nunca de
// desaparición. Todos los enlaces internos del sidebar son Link de next/link
// con `prefetch={false}` (ver más abajo): sin prefetch, cada clic paga primero
// el viaje de red que trae el payload de la ruta, y solo DESPUÉS de eso
// existe algo que un `loading.tsx` pueda mostrar — ese hueco (~1-2s en rutas
// pesadas como Ventas/Contratos/Contabilidad/Producto) es exactamente lo que
// `useLinkStatus` expone (`pending`, ver next/link) y lo que este archivo
// tenía sin ninguna señal visible. El retraso es solo para no mostrar nada
// en un clic que resuelve casi al instante (evita el parpadeo); una vez
// mostrada, la señal SIEMPRE sigue el valor real de `pending` — nunca un
// temporizador que la apague por su cuenta ni que la use para simular que
// la navegación ya terminó.
const RETRASO_APARICION_MS = 150;

function usePendienteConRetraso(): boolean {
  const { pending } = useLinkStatus();
  const [mostrar, setMostrar] = useState(false);
  useEffect(() => {
    // Nunca `setMostrar` síncrono en el cuerpo del efecto (regla
    // `react-hooks/set-state-in-effect` — mismo criterio ya usado en este
    // proyecto para "Persona y unidad..." en pruebas/tarjetaHotelExpandible):
    // el `false` vive en el cleanup (se dispara solo cuando `pending` deja de
    // ser true, o al desmontar) y el `true` vive dentro del propio callback
    // del temporizador — ambos son reacciones a un evento externo (el reloj),
    // nunca un ajuste síncrono del cuerpo del efecto.
    if (!pending) return;
    const t = setTimeout(() => setMostrar(true), RETRASO_APARICION_MS);
    return () => { clearTimeout(t); setMostrar(false); };
  }, [pending]);
  return mostrar;
}

// Isotipo pequeño para el hueco del ícono/bullet de un enlace — reutiliza LA
// MISMA animación (`markStyles.mark`, con su propio corte a estático bajo
// `prefers-reduced-motion`) que `components/LoadingScreen.tsx`, en vez de
// declarar una segunda animación paralela para el mismo significado.
function IsotipoMini({ size }: { size: number }) {
  return (
    <Image
      src="/marca/isotipo-full.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={markStyles.mark}
    />
  );
}

function IndicadorNavegacion({ mostrar }: { mostrar: boolean }) {
  if (!mostrar || typeof document === "undefined") return null;
  const main = document.querySelector("[data-dashboard-main]");
  if (!main) return null;
  const rect = main.getBoundingClientRect();
  return createPortal(
    <div
      className="fixed z-30"
      style={{
        top: Math.max(0, rect.top),
        right: Math.max(0, window.innerWidth - rect.right),
        bottom: Math.max(0, window.innerHeight - rect.bottom),
        left: Math.max(0, rect.left),
      }}
    >
      <LoadingScreen fullScreen={false} label="Cargando página" />
    </div>,
    main,
  );
}

// DEBE ser hijo directo de un componente Link — `useLinkStatus` lee el
// contexto que ese Link provee (ver next/link); llamarlo más arriba (en
// `Group`, que solo RENDERIZA el Link, no vive dentro de él) siempre
// devolvería el estado inicial. Sustituye el ícono normal por el isotipo
// mientras esa navegación puntual está pendiente y muestra el indicador
// principal en el contenido, sin ocultar la etiqueta del enlace.
function NavIcon({ icon: Icon, size, letra }: { icon?: LucideIcon; size: number; letra?: string }) {
  const mostrar = usePendienteConRetraso();
  return (
    <>
      {mostrar ? (
        <span aria-hidden className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
          <IsotipoMini size={size} />
        </span>
      ) : Icon ? (
        <Icon size={size} strokeWidth={2} className="shrink-0 opacity-90" />
      ) : letra ? (
        <span className="text-xs font-bold">{letra}</span>
      ) : (
        <span className="w-[17px]" />
      )}
      <IndicadorNavegacion mostrar={mostrar} />
    </>
  );
}

// Mismo contrato que `NavIcon`, para los enlaces hijos (que muestran un
// bullet en vez de un ícono lucide).
function NavBullet() {
  const mostrar = usePendienteConRetraso();
  return (
    <>
      {mostrar ? (
        <span aria-hidden className="inline-flex shrink-0 items-center justify-center" style={{ width: 12, height: 12 }}>
          <IsotipoMini size={12} />
        </span>
      ) : (
        <Circle size={5} className="shrink-0" fill="currentColor" strokeWidth={0} />
      )}
      <IndicadorNavegacion mostrar={mostrar} />
    </>
  );
}

export function SidebarNav({ items, collapsed }: { items: NavItem[]; collapsed?: boolean }) {
  const pathname = usePathname();

  if (collapsed) {
    return (
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + "/");
          const Icon = it.iconKey ? ICONS[it.iconKey] : undefined;
          return (
            <Link
              key={it.href}
              href={it.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              title={it.label}
              className="mx-auto grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-[var(--dash-muted-surface)]"
              style={active ? { backgroundColor: "var(--dash-primary)", color: "white" } : { color: ITEM_INACTIVO }}
            >
              <NavIcon icon={Icon} size={18} letra={it.label.charAt(0)} />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      {items.map((it) => (
        <div key={it.href}>
          {it.grupo ? (
            <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>
              {it.grupo}
            </p>
          ) : it.separadorAntes ? (
            <div className="my-2 border-t" style={{ borderColor: "var(--dash-border)" }} />
          ) : null}
          <Group item={it} pathname={pathname} />
        </div>
      ))}
    </nav>
  );
}

function Group({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const hasChildren = !!item.children?.length;
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? active;
  const Icon = item.iconKey ? ICONS[item.iconKey] : undefined;

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={item.href}
          prefetch={false}
          aria-current={active ? "page" : undefined}
          className="flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--dash-muted-surface)]"
          style={
            active
              ? { backgroundColor: "var(--dash-primary)", color: "white", fontWeight: 600 }
              : { color: ITEM_INACTIVO }
          }
        >
          <NavIcon icon={Icon} size={17} />
          <span className="truncate">{item.label}</span>
        </Link>
        {hasChildren && (
          <button
            type="button"
            aria-label="Desplegar"
            onClick={() => setManual(!open)}
            className="px-2 py-2 transition-colors hover:opacity-70"
            style={{ color: "var(--dash-ink-muted)" }}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        )}
      </div>

      {hasChildren && open && (
        <div className="ml-[22px] mt-0.5 space-y-0.5 border-l pl-2" style={{ borderColor: "var(--dash-border)" }}>
          {item.children!.map((c) => {
            const cActive = pathname === c.href;
            return (
              <Link
                key={c.href}
                href={c.href}
                prefetch={false}
                aria-current={cActive ? "page" : undefined}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[var(--dash-muted-surface)]"
                style={cActive ? { color: "var(--dash-accent)", fontWeight: 600 } : { color: SUBITEM_INACTIVO }}
              >
                <NavBullet />
                <span className="truncate">{c.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
