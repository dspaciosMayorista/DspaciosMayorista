"use client";

// Error boundary del módulo CRM. En vez de la pantalla genérica "This page
// couldn't load", muestra un mensaje amable + botón de reintento + un código
// (digest) que mapea al log del servidor en Vercel para diagnosticar.
export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg p-10 text-center">
      <h2 className="text-xl font-semibold text-gray-900">No se pudo cargar esta sección del CRM</h2>
      <p className="mt-2 text-sm text-gray-500">
        Ocurrió un error en el servidor. Intenta de nuevo; si persiste, comparte el
        código de abajo con soporte para ubicarlo en los registros.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        Reintentar
      </button>
      {error?.digest && (
        <p className="mt-4 font-mono text-[11px] text-gray-400">cód: {error.digest}</p>
      )}
    </div>
  );
}
