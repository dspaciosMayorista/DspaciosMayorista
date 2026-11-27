// Ejecuta trabajo DESPUÉS de responder la acción (Next `after`), sin que el usuario espere. Fuera de una petición de Next (pruebas, scripts) `after` no existe: ahí
// se ejecuta en línea y se espera, de modo que el resultado siga siendo determinista. La tarea nunca lanza: un fallo se registra (las regeneraciones ya marcan su propio estado).
export type ModoDespues = "diferida" | "inmediata";

export async function despuesDeResponder(nombre: string, tarea: () => Promise<unknown>): Promise<ModoDespues> {
  const segura = async () => { try { await tarea(); } catch (e) { console.error(`${nombre}: la tarea posterior falló:`, e instanceof Error ? e.message : e); } };
  try {
    // Import dinámico: `next/server` solo existe dentro de Next; así las pruebas que importan estas acciones fuera de Next siguen cargando.
    const { after } = await import("next/server");
    after(segura);
    return "diferida";
  } catch { /* fuera de una petición: se ejecuta en línea */ }
  await segura();
  return "inmediata";
}
