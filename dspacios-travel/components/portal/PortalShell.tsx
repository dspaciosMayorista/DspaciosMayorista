import Link from "next/link";
import Image from "next/image";
import { CreditCard, FileText, House, ClipboardList, ReceiptText, Wallet, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/app/(dashboard)/LogoutButton";
import s from "./vidrio.module.css";

export type PestanaPortal = "inicio" | "cotizaciones" | "ventas" | "cartera" | "documentos" | "agentes";

const ICONO = { size: 20, "aria-hidden": true } as const;
const PESTANAS: { id: PestanaPortal; href: string; label: string; corto: string; icono: React.ReactNode }[] = [
  { id: "inicio", href: "/portal/b2b", label: "Inicio", corto: "Inicio", icono: <House {...ICONO} /> },
  { id: "cotizaciones", href: "/portal/b2b/cotizaciones", label: "Cotizaciones", corto: "Cotiz.", icono: <ClipboardList {...ICONO} /> },
  { id: "ventas", href: "/portal/b2b/ventas", label: "Mis ventas", corto: "Ventas", icono: <ReceiptText {...ICONO} /> },
  { id: "cartera", href: "/portal/b2b/cartera", label: "Cartera", corto: "Cartera", icono: <Wallet {...ICONO} /> },
  { id: "documentos", href: "/portal/b2b/documentos", label: "Documentos", corto: "Docs.", icono: <FileText {...ICONO} /> },
];

const ROL: Record<string, string> = { agencia: "Agencia", freelance: "Freelance" };

/**
 * Marco «Vidrio» del portal. Sin `activa` no se dibuja la navegación (pantallas de ingreso / revisión).
 * `cta` es la acción principal del encabezado: la pone cada página (el marco no conoce destinos del catálogo).
 */
export function PortalShell({ children, nombre, rol, detalle, activa, mostrarAgentes, linkPago, cta }: {
  children: React.ReactNode;
  nombre?: string | null;
  rol?: string | null;
  /** Reemplaza el texto bajo el nombre (por defecto, el tipo de aliado). */
  detalle?: string | null;
  activa?: PestanaPortal;
  mostrarAgentes?: boolean;
  linkPago?: string | null;
  cta?: React.ReactNode;
}) {
  const pestanas = mostrarAgentes
    ? [...PESTANAS, { id: "agentes" as const, href: "/portal/b2b/agentes", label: "Agentes", corto: "Agentes", icono: <Users {...ICONO} /> }]
    : PESTANAS;
  const inicial = (nombre ?? "").trim().charAt(0).toUpperCase();
  const linea = detalle ?? (rol ? `${ROL[rol] ?? rol} · Aliado` : "Portal de aliados");
  return (
    <div className={s.raiz}>
      {/* React 19 eleva este <link> al <head>; la fuente solo se usa dentro de .raiz. */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" precedence="default" />
      <div aria-hidden="true" className={`${s.halo} ${s.halo1}`} />
      <div aria-hidden="true" className={`${s.halo} ${s.halo2}`} />
      <div aria-hidden="true" className={`${s.halo} ${s.halo3}`} />
      <div className={s.marco}>
        <div className={s.vidrio}>
          {activa && (
            <nav aria-label="Secciones del portal" className={s.nav}>
              <div aria-hidden="true" className={s.navMarca}>
                <Image src="/marca/isotipo-white.png" alt="" width={26} height={26} />
              </div>
              <ul className={s.navLista}>
                {pestanas.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={p.href}
                      title={p.label}
                      aria-label={p.label}
                      aria-current={p.id === activa ? "page" : undefined}
                      className={`${s.navItem} ${p.id === activa ? s.navActivo : ""}`}
                    >
                      {p.icono}
                      <span aria-hidden="true" className={s.navEtiqueta}>{p.corto}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <main className={s.principal}>
            <header className={s.cabecera}>
              <div className={s.identidadGrupo}>
                <Link href="/portal" aria-label="D'spacios Travel, inicio del portal"><Logo variant="full" height={40} priority className="h-10 w-auto" /></Link>
                {nombre && (
                  <>
                    <div aria-hidden="true" className={s.sep} />
                    <div className={s.identidad}>
                      <div aria-hidden="true" className={s.avatar}>{inicial || "A"}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className={s.idNombre}>{nombre}</div>
                        <div className={s.idRol}>{linea}</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className={s.acciones}>
                {linkPago && (
                  <a href={linkPago} target="_blank" rel="noopener noreferrer" className={s.btnVidrio}>
                    <CreditCard aria-hidden size={18} /> Pagar en línea
                  </a>
                )}
                <LogoutButton className={s.btnVidrio} />
                {cta}
              </div>
            </header>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Título de página + línea de apoyo, con el mismo ritmo que la cabecera del inicio. */
export function Titulo({ children, apoyo }: { children: React.ReactNode; apoyo?: React.ReactNode }) {
  return (
    <div className={s.titulo}>
      <h1 className={s.h1}>{children}</h1>
      {apoyo ? <span className={s.nota}>{apoyo}</span> : null}
    </div>
  );
}

/** Aviso de estado (lectura incompleta, histórico sin verificar…): visible para lectores de pantalla. */
export function Aviso({ children }: { children: React.ReactNode }) {
  return <p role="status" className={s.aviso}>{children}</p>;
}

/** Subpestañas por enlace real (`?vista=`): enlace directo, teclado y botón Atrás funcionan sin JavaScript. */
export function SubPestanas({ base, actual, items, etiqueta }: {
  base: string;
  actual: string;
  items: { id: string; label: string; cuenta?: number }[];
  etiqueta: string;
}) {
  return (
    <nav aria-label={etiqueta}>
      <ul className={s.segmentado}>
        {items.map((i) => (
          <li key={i.id}>
            <Link
              href={`${base}?vista=${i.id}`}
              aria-current={i.id === actual ? "page" : undefined}
              className={`${s.segmento} ${i.id === actual ? s.segmentoActivo : ""}`}
            >
              {i.label}{typeof i.cuenta === "number" ? <span className={s.segCuenta}>{i.cuenta}</span> : null}
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
    <div role="region" aria-label={etiqueta} tabIndex={0} className={`${s.tablaMarco} overflow-x-auto`}>
      <table className={`w-full ${ancho} text-sm`}>{children}</table>
    </div>
  );
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <p className={s.vacio}>{children}</p>;
}
