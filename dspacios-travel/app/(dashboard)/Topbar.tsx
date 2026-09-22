import styles from "./DashboardShell.module.css";

// Barra superior REAL del Dashboard (solo escritorio/tablet — md:flex, ver
// layout.tsx). Únicamente datos con fuente real: switcher de agencia (si
// corresponde), correo del usuario autenticado, rol real y la fecha del
// servidor. Ninguna integración externa, moneda global, notificación,
// teléfono ni indicador de estado sin fuente real — ver DECISIONS.md para
// la lista completa de contenido descartado en esta ronda.
export function Topbar({
  userLabel,
  rol,
  fecha,
  switcher,
  logout,
}: {
  userLabel: string;
  rol: string | null;
  fecha: string;
  switcher?: React.ReactNode;
  logout: React.ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-30 hidden h-16 items-center justify-between gap-4 border-b px-6 md:flex"
      style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}
    >
      <div className="flex items-center gap-4">
        {switcher}
        <span className="text-sm capitalize" style={{ color: "var(--dash-ink-muted)" }}>
          {fecha}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className={`${styles.heading} text-sm font-semibold leading-tight`} style={{ color: "var(--dash-ink)" }}>
            {userLabel}
          </div>
          {rol && (
            <div className="text-xs font-medium capitalize leading-tight" style={{ color: "var(--dash-accent)" }}>
              {rol}
            </div>
          )}
        </div>
        {logout}
      </div>
    </header>
  );
}
