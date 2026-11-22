"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cambiarContrasena, cerrarSesionesAbiertas } from "@/app/(auth)/contrasena-actions";
import { TarjetaCuenta, CampoContrasena, Mensaje, BotonEnviar, AvisoParcial } from "@/components/cuenta/CuentaUI";

export function CambiarContrasenaClient({ volver }: { volver: string }) {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  const [parcial, setParcial] = useState<string | null>(null);
  const [errorReintento, setErrorReintento] = useState("");
  const [pendiente, start] = useTransition();

  function limpiar() { setActual(""); setNueva(""); setConfirmacion(""); }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setListo(false); setParcial(null);
    start(async () => {
      const r = await cambiarContrasena(actual, nueva, confirmacion);
      if (r.ok === true) { limpiar(); setListo(true); return; }
      if (r.ok === "parcial") { limpiar(); setParcial(r.mensaje); return; }
      if (r.enlaceVencido) { router.replace("/login"); return; }
      setError(r.error);
    });
  }

  // La contraseña YA cambió: solo se reintenta el cierre de las otras sesiones.
  function reintentarCierre() {
    setErrorReintento("");
    start(async () => {
      const r = await cerrarSesionesAbiertas("others");
      if (r.ok) { setParcial(null); setListo(true); return; }
      setErrorReintento(r.error);
    });
  }

  return (
    <TarjetaCuenta titulo="Cambiar contraseña" descripcion="Por seguridad, confirma tu contraseña actual. Cerraremos tus otras sesiones abiertas.">
      {parcial ? (
        <AvisoParcial mensaje={parcial} errorReintento={errorReintento} pendiente={pendiente} onReintentar={reintentarCierre} textoReintento="Reintentar el cierre de las otras sesiones">
          <Link href={volver} className="inline-flex items-center gap-1.5 text-sm text-[var(--brand-primary)] hover:underline"><ArrowLeft size={14} aria-hidden /> Volver</Link>
        </AvisoParcial>
      ) : (
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <CampoContrasena etiqueta="Contraseña actual" nombre="actual" valor={actual} onCambio={setActual} autoComplete="current-password" />
          <CampoContrasena etiqueta="Nueva contraseña" nombre="nueva" valor={nueva} onCambio={setNueva} autoComplete="new-password" />
          <CampoContrasena etiqueta="Confirma la nueva contraseña" nombre="confirmacion" valor={confirmacion} onCambio={setConfirmacion} autoComplete="new-password" />
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          {listo && <Mensaje tipo="ok">Tu contraseña se actualizó y se cerraron tus otras sesiones. Un dispositivo ya conectado puede seguir activo hasta que venza su acceso actual (normalmente, hasta una hora).</Mensaje>}
          <BotonEnviar cargando={pendiente}>Cambiar contraseña</BotonEnviar>
          <Link href={volver} className="inline-flex items-center gap-1.5 text-sm text-[var(--brand-primary)] hover:underline">
            <ArrowLeft size={14} aria-hidden /> Volver
          </Link>
        </form>
      )}
    </TarjetaCuenta>
  );
}
