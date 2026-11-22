"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restablecerContrasena, cerrarSesionesAbiertas } from "../contrasena-actions";
import { createClient } from "@/lib/supabase/client";
import { almacenNavegador, leerBorradorRegistro } from "@/lib/auth/borradorRegistroB2B";
import { MENSAJE_SESIONES_SIN_CERRAR, MENSAJE_RESULTADO_INCIERTO } from "@/lib/auth/contrasena";
import { TarjetaCuenta, CampoContrasena, Mensaje, BotonEnviar, AvisoParcial } from "@/components/cuenta/CuentaUI";

// O-4: venía de «Continúa tu registro» → vuelve ahí (sin sesión: escribe la contraseña nueva); si no, al ingreso de siempre.
const destinoTrasCambio = () => (leerBorradorRegistro(almacenNavegador()) ? "/portal/registro?retomar=1" : "/login?clave=1");

export function RestablecerClient({ yaActualizada = false, incierto: inciertoInicial = false }: { yaActualizada?: boolean; incierto?: boolean }) {
  const router = useRouter();
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState("");
  const [parcial, setParcial] = useState<string | null>(yaActualizada ? MENSAJE_SESIONES_SIN_CERRAR : null);
  const [incierto, setIncierto] = useState<string | null>(inciertoInicial ? MENSAJE_RESULTADO_INCIERTO : null);
  const [errorReintento, setErrorReintento] = useState("");
  const [pendiente, start] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const r = await restablecerContrasena(nueva, confirmacion);
      // O-4: si la persona venía de «Continúa tu registro», vuelve ahí (sin sesión: tendrá que escribir la contraseña nueva); si no, al ingreso de siempre.
      if (r.ok === true) { router.replace(destinoTrasCambio()); return; }
      if (r.ok === "parcial") { setNueva(""); setConfirmacion(""); setParcial(r.mensaje); return; }
      if (r.incierto) { setNueva(""); setConfirmacion(""); setIncierto(r.error); return; }
      if (r.usarCambio) { router.replace("/cuenta/contrasena"); return; }
      if (r.enlaceVencido) { router.replace("/recuperar?error=enlace"); return; }
      setError(r.error);
    });
  }

  // La contraseña YA cambió: solo se reintenta el cierre de sesiones; nunca se vuelve a enviar la contraseña.
  function reintentarCierre() {
    setErrorReintento("");
    start(async () => {
      const r = await cerrarSesionesAbiertas("global");
      if (r.ok) { router.replace(destinoTrasCambio()); return; }
      setErrorReintento(r.error);
    });
  }

  function salirDeEstaSesion() {
    start(async () => {
      try { await createClient().auth.signOut({ scope: "local" }); } catch { /* la cookie local se limpia igual al salir */ }
      router.replace(destinoTrasCambio());
    });
  }

  // Resultado INCIERTO: la recuperación queda consumida; nunca se ofrece reenviar la contraseña con este enlace.
  if (incierto) {
    return (
      <TarjetaCuenta titulo="No pudimos confirmar el cambio" descripcion="Revisa si tu contraseña nueva funciona.">
        <div className="space-y-3" data-testid="resultado-incierto">
          <Mensaje tipo="error">{incierto}</Mensaje>
          <a href="/login" className="block w-full rounded-md bg-[var(--brand-primary)] py-2.5 text-center text-sm font-semibold text-white">Probar a ingresar</a>
          <a href="/recuperar" className="block w-full rounded-md border border-gray-300 py-2.5 text-center text-sm font-semibold text-gray-700">Solicitar un enlace nuevo</a>
        </div>
      </TarjetaCuenta>
    );
  }

  if (parcial) {
    return (
      <TarjetaCuenta titulo="Contraseña actualizada" descripcion="El cambio de contraseña se guardó.">
        <AvisoParcial mensaje={parcial} errorReintento={errorReintento} pendiente={pendiente} onReintentar={reintentarCierre} textoReintento="Reintentar el cierre de sesiones">
          <button type="button" onClick={salirDeEstaSesion} disabled={pendiente} className="w-full rounded-md border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-60">
            Salir de esta sesión e ingresar de nuevo
          </button>
        </AvisoParcial>
      </TarjetaCuenta>
    );
  }

  return (
    <TarjetaCuenta titulo="Crea tu nueva contraseña" descripcion="Elige una contraseña que no uses en otro sitio. Al guardarla cerraremos tus sesiones abiertas.">
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <CampoContrasena etiqueta="Nueva contraseña" nombre="nueva" valor={nueva} onCambio={setNueva} autoComplete="new-password" />
        <CampoContrasena etiqueta="Confirma la nueva contraseña" nombre="confirmacion" valor={confirmacion} onCambio={setConfirmacion} autoComplete="new-password" />
        {error && <Mensaje tipo="error">{error}</Mensaje>}
        <BotonEnviar cargando={pendiente}>Guardar contraseña</BotonEnviar>
      </form>
    </TarjetaCuenta>
  );
}
