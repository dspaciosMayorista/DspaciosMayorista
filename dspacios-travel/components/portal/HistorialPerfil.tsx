import { createAdminClient } from "@/lib/supabase/admin";
import { cargarHistorialPropio } from "@/lib/portal/historialPropio";

/**
 * #25 — «Historial de tus datos»: los cambios hechos a TU ficha y a tu nombre, por ti desde el portal o por D'spacios.
 * Componente de servidor: una lectura acotada al abrir el perfil (sin sondeo). La persona sale de la sesión (`userId` ya resuelto por el portal);
 * el aliado que se consulta se vuelve a resolver en la base desde ese usuario, nunca desde un parámetro del navegador.
 */
export async function HistorialPerfil({ userId }: { userId: string }) {
  const h = await cargarHistorialPropio(createAdminClient(), userId);
  if (h.estado === "no_aplica") return null;
  return (
    <section className="mt-4 min-w-0 rounded-xl border border-gray-100 bg-white p-4" aria-labelledby="historial-datos">
      <h2 id="historial-datos" className="mb-1 text-sm font-semibold text-gray-700">Historial de tus datos</h2>
      <p className="mb-2 text-[11px] text-gray-400">Cambios a tu nombre y a los datos de tu ficha. Los datos bancarios solo se muestran con sus últimos cuatro dígitos.</p>
      {h.estado === "error" ? (
        <p className="text-xs text-amber-700" role="alert">No pudimos cargar tu historial ahora; no significa que no tengas cambios. Intenta más tarde.</p>
      ) : h.lineas.length === 0 ? (
        <p className="text-xs text-gray-500">Aún no hay cambios registrados.</p>
      ) : (
        <ol className="space-y-2" aria-label="Historial de tus datos">
          {h.lineas.map((l) => (
            <li key={l.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold">{l.accion === "Alta" ? "Ficha creada" : "Cambio"}</span>
                <span className="text-gray-500">{new Date(l.fecha).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })}</span>
                {l.accion !== "Alta" && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${l.origen === "portal" ? "bg-sky-50 text-sky-700" : "bg-gray-100 text-gray-600"}`}>
                    {l.origen === "portal" ? "Hecho desde tu portal" : "Corregido por D'spacios"}
                  </span>
                )}
              </div>
              {l.cambios.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {l.cambios.map((c) => (
                    <li key={c.campo} className="break-words"><span className="font-medium">{c.campo}:</span> <span className="text-gray-500">{c.antes}</span> → <span>{c.despues}</span></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
