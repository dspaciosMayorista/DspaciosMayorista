"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { correoRecuperacion } from "@/lib/auth/contrasena";
import { almacenNavegador, leerBorradorRegistro } from "@/lib/auth/borradorRegistroB2B";
import { TarjetaCuenta, Mensaje } from "@/components/cuenta/CuentaUI";

// Espera mínima entre dos solicitudes desde esta pantalla (el límite real por correo/IP lo impone Supabase Auth).
const ESPERA_SEGUNDOS = 60;

export function RecuperarClient({ enlaceVencido, desdeRegistro = false }: { enlaceVencido: boolean; desdeRegistro?: boolean }) {
  // O-4: desde «Continúa tu registro» el correo ya está escrito; solo se rellena el campo (el envío sigue siendo el mismo, con la misma respuesta genérica).
  const [correo, setCorreo] = useState("");
  const [retomaRegistro, setRetomaRegistro] = useState(false);
  useEffect(() => {
    if (!desdeRegistro) return;
    const d = leerBorradorRegistro(almacenNavegador());
    if (!d?.email) return;
    setCorreo(d.email);
    setRetomaRegistro(true);
  }, [desdeRegistro]);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [espera, setEspera] = useState(0);

  // Un solo temporizador mientras haya cuenta regresiva; se limpia al terminar o al desmontar.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const c = correoRecuperacion(correo);
    if (!c) { setError("Escribe un correo válido."); return; }
    setCargando(true);
    const { error: err } = await createClient().auth.resetPasswordForEmail(c, {
      redirectTo: `${window.location.origin}/auth/callback?next=/restablecer`,
    });
    setCargando(false);
    // Supabase responde 200 exista o no la cuenta (no hay error que revele algo): cualquier error es un fallo REAL (límite de frecuencia, red, servidor)
    // y no se puede decir «enviado». El mensaje de éxito es el mismo para correos registrados y no registrados.
    if (err) {
      const limite = err.status === 429 || err.code === "over_email_send_rate_limit" || err.code === "over_request_rate_limit";
      setError(limite ? "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." : "No pudimos enviar el enlace ahora. Inténtalo de nuevo en unos minutos.");
      return;
    }
    setEnviado(true);
    setEspera(ESPERA_SEGUNDOS);
  }

  return (
    <TarjetaCuenta titulo="Recuperar contraseña" descripcion="Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.">
      <div className="space-y-4">
        {enlaceVencido && !enviado && <Mensaje tipo="error">El enlace venció o ya se usó. Solicita uno nuevo.</Mensaje>}
        {enviado ? (
          <Mensaje tipo="ok">Si el correo está registrado, te enviamos un enlace para restablecer la contraseña. Revisa también la carpeta de spam. El enlace vence pronto.{retomaRegistro ? " Después de crear la contraseña nueva volverás a «Continúa tu registro» para terminar de enviar tu solicitud." : ""}</Mensaje>
        ) : null}
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div>
            <label htmlFor="correo-recuperar" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">Correo</label>
            <div className="relative">
              <Mail size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input id="correo-recuperar" name="email" type="email" autoComplete="email" inputMode="email" required value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                className="w-full rounded-md border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]" />
            </div>
          </div>
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <button type="submit" disabled={cargando || espera > 0}
            className="flex w-full items-center justify-center rounded-md bg-[var(--brand-primary)] py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60">
            {cargando ? "Enviando…" : espera > 0 ? `Reenviar en ${espera} s` : enviado ? "Reenviar enlace" : "Enviar enlace"}
          </button>
        </form>
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-[var(--brand-primary)] hover:underline">
          <ArrowLeft size={14} aria-hidden /> Volver a ingresar
        </Link>
      </div>
    </TarjetaCuenta>
  );
}
