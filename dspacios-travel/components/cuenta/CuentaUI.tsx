"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Lock, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Logo";

/** Tarjeta centrada para las pantallas de cuenta (recuperar, restablecer, cambiar contraseña). Móvil: ancho completo con gutter de 16 px. */
export function TarjetaCuenta({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex justify-center"><Logo variant="full" height={44} /></div>
        <h1 className="text-center text-xl font-semibold text-[var(--brand-primary)]">{titulo}</h1>
        {descripcion && <p className="mt-1.5 text-center text-sm text-gray-600">{descripcion}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Mensaje({ tipo, children }: { tipo: "error" | "ok"; children: React.ReactNode }) {
  const Icono = tipo === "error" ? AlertCircle : CheckCircle2;
  return (
    <p role={tipo === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${tipo === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      <Icono size={16} className="mt-0.5 shrink-0" aria-hidden /> <span>{children}</span>
    </p>
  );
}

/** Campo de contraseña con mostrar/ocultar. `autoComplete` distingue la clave vigente de la nueva para los gestores de contraseñas. */
export function CampoContrasena({ etiqueta, valor, onCambio, autoComplete, nombre }: {
  etiqueta: string; valor: string; onCambio: (v: string) => void; autoComplete: "current-password" | "new-password"; nombre: string;
}) {
  const id = useId();
  const [ver, setVer] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">{etiqueta}</label>
      <div className="relative">
        <Lock size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input id={id} name={nombre} type={ver ? "text" : "password"} autoComplete={autoComplete} required value={valor}
          onChange={(e) => onCambio(e.target.value)}
          className="w-full rounded-md border border-gray-300 py-2.5 pl-10 pr-10 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]" />
        <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={ver}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]">
          {ver ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export function BotonEnviar({ cargando, children }: { cargando: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={cargando}
      className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60">
      {cargando && <Loader2 size={16} className="animate-spin" aria-hidden />} {children}
    </button>
  );
}

/**
 * Resultado PARCIAL: la contraseña ya cambió, pero no se confirmó el cierre de las demás sesiones. El único remedio ofrecido es reintentar el cierre
 * (nunca repetir el cambio de contraseña) o salir de esta sesión.
 */
export function AvisoParcial({ mensaje, errorReintento, pendiente, onReintentar, textoReintento, children }: {
  mensaje: string; errorReintento: string; pendiente: boolean; onReintentar: () => void; textoReintento: string; children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3" data-testid="resultado-parcial">
      <p role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden /> <span>{mensaje}</span>
      </p>
      {errorReintento && <Mensaje tipo="error">{errorReintento}</Mensaje>}
      <button type="button" onClick={onReintentar} disabled={pendiente}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60">
        {pendiente && <Loader2 size={16} className="animate-spin" aria-hidden />} {textoReintento}
      </button>
      {children}
    </div>
  );
}
