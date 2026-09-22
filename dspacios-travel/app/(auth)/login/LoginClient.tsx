"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import {
  Eye, EyeOff, Mail, Lock, ArrowRight, Loader2, ShieldCheck, FlaskConical,
  Tags, CalendarCheck, FileCheck2, Users, Settings,
} from "lucide-react";
import { loginConCodigo } from "./actions";
import styles from "./LoginClient.module.css";

// Estilo forzado a mano (no via className) en los campos reales de texto:
// usa los tokens propios de /login (LoginClient.module.css) en vez de
// clases utilitarias, para que el color de fondo/texto/borde de los campos
// quede fijado explícitamente aquí, sin depender de qué reglas globales
// existan en styles/globals.css.
const CAMPO_ESTILO: React.CSSProperties = {
  backgroundColor: "var(--login-field-bg)",
  color: "var(--login-ink)",
  borderColor: "var(--login-field-border)",
};

// Capacidades reales del sistema (módulos ya existentes: `tarifario`,
// `reservar`, `contratos` en lib/constants.ts / MODULO_POR_RUTA) — presentadas
// como disponibilidad según permisos, nunca como métricas o estados en vivo.
const CAPACIDADES = [
  { icon: Tags, titulo: "Tarifario y oferta publicada", descripcion: "Consulta paquetes, porciones terrestres y programas disponibles." },
  { icon: CalendarCheck, titulo: "Reservas y seguimiento", descripcion: "Gestiona solicitudes y disponibilidad desde un flujo centralizado." },
  { icon: FileCheck2, titulo: "Contratos y documentos", descripcion: "Centraliza contratos, vouchers y documentos de la operación." },
] as const;

// ── Selector de tipo de cuenta ──────────────────────────────────────────────
// ⚠️ Regla innegociable: esto SOLO cambia presentación (etiqueta, título,
// descripción, placeholder y texto del CTA) — nunca la autorización real. El
// enrutamiento posterior a autenticar sigue dependiendo EXCLUSIVAMENTE de
// `perfil.rol` (ver `handleSubmit`); este estado nunca se lee ahí, nunca se
// envía al servidor y nunca decide el destino. Elegir "Admin" con una cuenta
// `agencia` real sigue entrando a `/portal/b2b`, y viceversa.
type PortalSeleccionado = "b2b" | "admin";

const CONTENIDO_PORTAL: Record<PortalSeleccionado, {
  etiquetaSelector: string; titulo: string; descripcion: string; placeholderCorreo: string; cta: string;
}> = {
  b2b: {
    etiquetaSelector: "Portal B2B Agencias",
    titulo: "Bienvenido al Portal Agencias & Freelance",
    descripcion: "Consulta tarifas, prepara cotizaciones y gestiona tus solicitudes desde el portal B2B.",
    placeholderCorreo: "agente@agencia.com",
    cta: "Acceder al Portal B2B",
  },
  admin: {
    etiquetaSelector: "Portal Admin",
    titulo: "Portal Admin & Operaciones Centrales",
    descripcion: "Acceso para el equipo interno de operación, administración y gestión comercial.",
    placeholderCorreo: "operaciones@dspacios.com",
    cta: "Ingresar al Panel Administrativo",
  },
};

export function LoginClient({
  quickLoginEnabled,
  inactivoInicial,
}: {
  quickLoginEnabled: boolean;
  inactivoInicial: boolean;
}) {
  const router = useRouter();
  const [portalSeleccionado, setPortalSeleccionado] = useState<PortalSeleccionado>("b2b");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [inactivo] = useState(inactivoInicial);

  const contenido = CONTENIDO_PORTAL[portalSeleccionado];

  async function handleCodigo(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const r = await loginConCodigo(codigo);
    // Si tiene éxito, la acción redirige; si vuelve, es error.
    if (r && !r.ok) {
      setError(r.error);
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError("Credenciales inválidas. Verifica tu correo y contraseña.");
      setLoading(false);
      return;
    }

    // Rutea según el rol REAL — el selector de tipo de cuenta de arriba nunca
    // participa acá: es presentación, no autorización. Agencias/freelance van
    // al portal B2B.
    let destino = "/dashboard";
    if (data.user) {
      const { data: perfil } = await supabase.from("usuarios").select("rol, activo").eq("id", data.user.id).maybeSingle();
      // Supabase Auth no sabe de `usuarios.activo`: la credencial de una cuenta
      // desactivada sigue siendo válida y crea sesión. Se cierra aquí mismo para
      // no dejar una sesión viva (aunque inservible) dando vueltas — el
      // middleware igual la rebotaría, pero después de haberla creado.
      if (perfil && perfil.activo === false) {
        await supabase.auth.signOut();
        setError("Tu cuenta está desactivada. Comunícate con el administrador para reactivarla.");
        setLoading(false);
        return;
      }
      if (perfil?.rol === "agencia" || perfil?.rol === "freelance" || perfil?.rol === "cliente_final") destino = "/portal/b2b";
    }
    router.push(destino);
    router.refresh();
  }

  async function handleGoogle() {
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (oauthError) {
      setError("No se pudo iniciar con Google. Avisa al administrador.");
      setLoading(false);
    }
  }

  return (
    <div className={`${styles.root} flex flex-col`}>
      {/* Barra superior operacional — compacta, con solo lo que puede
          demostrarse (nada de integraciones, números de soporte ni número
          de versión que no existan realmente). */}
      <header className="flex items-center justify-between border-b border-[var(--login-context-border)] px-4 py-2.5 sm:px-6">
        <span className="flex items-center gap-2 text-xs font-medium tracking-wide text-[var(--login-context-muted)]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--login-lime)] opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--login-lime)]" />
          </span>
          <span className="text-[var(--login-context-ink)]">D&apos;Spacios Travel</span>
          <span className="hidden text-[var(--login-context-muted)]/60 sm:inline">·</span>
          <span className="hidden sm:inline">Plataforma mayorista</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--login-context-muted)]">
          <ShieldCheck size={14} className="text-[var(--login-cyan)]" aria-hidden />
          Acceso protegido
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 pb-24 sm:p-6 lg:p-8 lg:pb-20">
        <div className="grid w-full max-w-6xl grid-cols-1 overflow-hidden rounded-[22px] border border-[rgba(255,255,255,0.75)] shadow-[0_20px_45px_-20px_rgba(0,0,0,0.6)] lg:grid-cols-[1.4fr_1fr]">
          {/* Columna de autenticación — superficie clara */}
          <section className="flex flex-col justify-center bg-[var(--login-surface)] px-6 py-8 sm:px-10 sm:py-10 lg:px-12">
            <a href="/tarifario" aria-label="Volver al tarifario" className="inline-block self-start border-b border-[var(--login-field-border)] pb-6">
              <Logo variant="full" height={64} priority className="h-14 w-auto sm:h-16" />
            </a>

            {/* Selector de tipo de cuenta — SOLO presentación, ver la regla
                innegociable en CONTENIDO_PORTAL/handleSubmit más arriba. */}
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--login-ink-muted)]">
                Selecciona tu tipo de cuenta
              </p>
              <div
                role="tablist"
                aria-label="Tipo de cuenta"
                className="grid grid-cols-2 gap-1 rounded-md p-1"
                style={{ backgroundColor: "var(--login-selector-bg)" }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={portalSeleccionado === "b2b"}
                  onClick={() => setPortalSeleccionado("b2b")}
                  className="flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition"
                  style={
                    portalSeleccionado === "b2b"
                      ? { backgroundColor: "var(--login-surface)", color: "var(--login-ink)", boxShadow: "0 1px 2px rgba(16,24,40,0.08)", border: "1px solid var(--login-field-border)" }
                      : { color: "var(--login-ink-muted)", border: "1px solid transparent" }
                  }
                >
                  <Users size={16} aria-hidden />
                  Portal B2B Agencias
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={portalSeleccionado === "admin"}
                  onClick={() => setPortalSeleccionado("admin")}
                  className="flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition"
                  style={
                    portalSeleccionado === "admin"
                      ? { backgroundColor: "var(--login-surface)", color: "var(--login-ink)", boxShadow: "0 1px 2px rgba(16,24,40,0.08)", border: "1px solid var(--login-field-border)" }
                      : { color: "var(--login-ink-muted)", border: "1px solid transparent" }
                  }
                >
                  <Settings size={16} aria-hidden />
                  Portal Admin
                </button>
              </div>
            </div>

            <h1 className="mt-6 text-[1.75rem] font-bold leading-tight tracking-tight text-[var(--login-ink)]">
              {contenido.titulo}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--login-ink-muted)]">
              {contenido.descripcion}
            </p>

            {inactivo && (
              <p
                role="alert"
                className="mt-5 rounded-md border px-3 py-2 text-sm"
                style={{ backgroundColor: "var(--login-warn-bg)", borderColor: "var(--login-warn-border)", color: "var(--login-warn-ink)" }}
              >
                Tu cuenta está desactivada. Comunícate con el administrador para reactivarla.
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" aria-busy={loading}>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--login-ink-muted)]">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--login-ink-soft)]" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={CAMPO_ESTILO}
                    className="w-full rounded-md border py-2.5 pl-10 pr-3 text-sm placeholder:text-[var(--login-ink-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--login-cyan)]"
                    placeholder={contenido.placeholderCorreo}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--login-ink-muted)]">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--login-ink-soft)]" />
                  <input
                    id="password"
                    name="password"
                    type={mostrarPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={CAMPO_ESTILO}
                    className="w-full rounded-md border py-2.5 pl-10 pr-10 text-sm placeholder:text-[var(--login-ink-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--login-cyan)]"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassword((v) => !v)}
                    aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={mostrarPassword}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--login-ink-soft)] transition hover:text-[var(--login-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--login-cyan)]"
                  >
                    {mostrarPassword ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
                  </button>
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border px-3 py-2 text-sm"
                  style={{ backgroundColor: "var(--login-danger-bg)", borderColor: "var(--login-danger-border)", color: "var(--login-danger-ink)" }}
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: "var(--login-primary)" }}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                    Ingresando…
                  </>
                ) : (
                  <>
                    {contenido.cta}
                    <ArrowRight size={16} aria-hidden />
                  </>
                )}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-[var(--login-ink-soft)]">
              <span className="h-px flex-1 bg-[var(--login-field-border)]" />
              O continuar con
              <span className="h-px flex-1 bg-[var(--login-field-border)]" />
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: "var(--login-field-border)", color: "var(--login-ink-muted)" }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
              </svg>
              Continuar con Google
            </button>

            {quickLoginEnabled && (
              <details className="mt-5 rounded-md border px-3 py-2" style={{ borderColor: "var(--login-field-border)" }}>
                <summary className={`${styles.summaryReset} flex list-none items-center gap-1.5 text-xs font-medium text-[var(--login-ink-soft)]`}>
                  <FlaskConical size={13} aria-hidden />
                  Acceso de pruebas
                </summary>
                <form onSubmit={handleCodigo} className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder="Código de acceso"
                    style={CAMPO_ESTILO}
                    className="w-full rounded-md border px-3 py-2 text-sm placeholder:text-[var(--login-ink-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--login-cyan)]"
                  />
                  <button
                    type="submit"
                    disabled={loading || !codigo}
                    className="shrink-0 rounded-md px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: "var(--login-ocean)" }}
                  >
                    Entrar
                  </button>
                </form>
              </details>
            )}
          </section>

          {/* Columna de contexto — superficie oscura, puramente informativa
              (sin afirmaciones sin demostrar). El selector de tipo de cuenta
              vive en el panel blanco (arriba); acá NUNCA vuelven a aparecer
              "Portal B2B"/"Portal interno" como tarjetas — ese fue el error
              de interpretación corregido en esta ronda. Oculta debajo de
              `lg`: en móvil/tablet estrecha el selector de la izquierda ya
              comunica B2B/Admin, así que no hace falta duplicarlo, y evita
              alargar la pantalla. */}
          <section className="hidden flex-col justify-between gap-7 bg-[var(--login-context)] px-8 py-10 lg:flex">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <span className="rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--login-ocean)]" style={{ backgroundColor: "var(--login-lime)" }}>
                  Plataforma mayorista D&apos;Spacios
                </span>
                <span className="text-[11px] font-mono text-[var(--login-cyan)]/80">B2B + OPERACIÓN</span>
              </div>

              <div>
                <h2 className="text-2xl font-bold leading-snug tracking-tight text-[var(--login-context-ink)]">
                  Herramientas para vender y operar viajes en un solo lugar
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--login-context-muted)]">
                  Accede al tarifario, las reservas y la documentación de la operación según los permisos de tu cuenta.
                </p>
              </div>

              <div className="divide-y overflow-hidden rounded-md border" style={{ borderColor: "var(--login-context-border)" }}>
                {CAPACIDADES.map(({ icon: Icon, titulo, descripcion }) => (
                  <div key={titulo} className="flex items-start gap-3 p-3" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--login-green)]/15">
                      <Icon size={16} className="text-[var(--login-green)]" aria-hidden />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--login-context-ink)]">{titulo}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-[var(--login-context-muted)]">{descripcion}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="flex items-start gap-2 border-t pt-4 text-xs leading-relaxed text-[var(--login-context-muted)]" style={{ borderColor: "var(--login-context-border)" }}>
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--login-green)]" aria-hidden />
              Acceso protegido y permisos definidos por perfil.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
