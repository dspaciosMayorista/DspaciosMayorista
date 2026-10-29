import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/app/(dashboard)/LogoutButton";

export type PestanaPortal = "inicio" | "cotizaciones" | "ventas" | "cartera" | "documentos" | "agentes";

const PESTANAS: { id: PestanaPortal; href: string; label: string }[] = [
  { id: "inicio", href: "/portal/b2b", label: "Inicio" },
  { id: "cotizaciones", href: "/portal/b2b/cotizaciones", label: "Cotizaciones" },
  { id: "ventas", href: "/portal/b2b/ventas", label: "Mis ventas" },
  { id: "cartera", href: "/portal/b2b/cartera", label: "Cartera" },
  { id: "documentos", href: "/portal/b2b/documentos", label: "Documentos" },
];

export function PortalShell({ children, nombre, activa, mostrarAgentes, linkPago }: {
  children: React.ReactNode;
  nombre?: string | null;
  /** Sin `activa` no se dibuja la navegación (pantallas de ingreso / revisión). */
  activa?: PestanaPortal;
  mostrarAgentes?: boolean;
  linkPago?: string | null;
}) {
  const pestanas = mostrarAgentes ? [...PESTANAS, { id: "agentes" as const, href: "/portal/b2b/agentes", label: "Agentes" }] : PESTANAS;
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-gradient px-4 py-5 text-white sm:px-6 sm:py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/portal"><Logo variant="white" height={36} priority className="h-9 w-auto" /></Link>
          <div className="flex min-w-0 items-center gap-3 text-sm sm:gap-4">
            {nombre && <span className="max-w-[10rem] truncate opacity-90 sm:max-w-none">{nombre}</span>}
            <LogoutButton className="text-white/90 hover:text-white" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {activa && (
          <nav aria-label="Secciones del portal" className="mb-5 flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-2 py-2">
            <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {pestanas.map((p) => (
                <li key={p.id} className="shrink-0">
                  <Link
                    href={p.href}
                    aria-current={p.id === activa ? "page" : undefined}
                    className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${p.id === activa ? "text-white" : "text-gray-600 hover:bg-gray-100"}`}
                    style={p.id === activa ? { backgroundColor: "var(--brand-primary)" } : undefined}
                  >
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
            {linkPago && (
              <a href={linkPago} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }}>
                Pagar en línea
              </a>
            )}
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}

/** Subpestañas por enlace real (`?vista=`): enlace directo, teclado y botón Atrás funcionan sin JavaScript. */
export function SubPestanas({ base, actual, items, etiqueta }: {
  base: string;
  actual: string;
  items: { id: string; label: string; cuenta?: number }[];
  etiqueta: string;
}) {
  return (
    <nav aria-label={etiqueta} className="mb-4">
      <ul className="inline-flex gap-1 rounded-lg bg-gray-100 p-1">
        {items.map((i) => (
          <li key={i.id}>
            <Link
              href={`${base}?vista=${i.id}`}
              aria-current={i.id === actual ? "page" : undefined}
              className={`block whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${i.id === actual ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              {i.label}{typeof i.cuenta === "number" ? <span className="ml-1.5 text-xs text-gray-400">{i.cuenta}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Contenedor de tabla desplazable en móvil, enfocable con teclado. */
export function TablaScroll({ children, etiqueta, ancho = "min-w-[760px]" }: { children: React.ReactNode; etiqueta: string; ancho?: string }) {
  return (
    <div role="region" aria-label={etiqueta} tabIndex={0} className="overflow-x-auto rounded-xl border border-gray-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2">
      <table className={`w-full ${ancho} text-sm`}>{children}</table>
    </div>
  );
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">{children}</p>;
}
