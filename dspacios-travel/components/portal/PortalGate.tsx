import Link from "next/link";
import { Clock } from "lucide-react";
import { PortalShell } from "@/components/portal/PortalShell";
import type { ContextoPortal } from "@/lib/portal/b2bPortalServidor";
import s from "./vidrio.module.css";

/** Pantallas de quien NO es un aliado activo: ingreso/registro (visitante o interno) y «registro en revisión». */
export function PortalGate({ ctx }: { ctx: Exclude<ContextoPortal, { estado: "ok" }> }) {
  if (ctx.estado === "pendiente") {
    return (
      <PortalShell nombre={ctx.nombre}>
        <section className={`${s.panel} ${s.centrado}`}>
          <Clock aria-hidden size={28} style={{ color: "#8A4B08" }} />
          <h2 className={s.h2}>Registro en revisión</h2>
          <p className={s.subtitulo}>Tu cuenta fue creada y está pendiente de aprobación. Te avisaremos cuando esté lista.</p>
        </section>
      </PortalShell>
    );
  }
  return (
    <PortalShell nombre={ctx.nombre}>
      <section className={`${s.panel} ${s.centrado}`}>
        <h2 className={s.h2}>Portal de aliados</h2>
        <p className={s.subtitulo}>Agencias y freelance: ingresa o regístrate.</p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
          <Link href="/login" className={s.cta}>Iniciar sesión</Link>
          <Link href="/portal/registro" className={s.btnVidrio}>Registrarse</Link>
        </div>
        {ctx.estado === "interno" && (
          <p className={s.subtitulo}>
            Estás con una cuenta interna. ¿Buscas tu panel? <Link href="/dashboard" style={{ fontWeight: 700 }}>Portal Admin</Link>.
          </p>
        )}
      </section>
    </PortalShell>
  );
}
