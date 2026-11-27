// #11 — Decisión PURA de cuándo el navegador avisa «sigo usando la aplicación». Sin red, sin DOM: el componente solo la llama.
//
// Reglas (todas acotadas, ninguna con temporizador):
//   · Solo con la pestaña VISIBLE (una pestaña oculta jamás cuenta como actividad).
//   · Como mucho una escritura cada INTERVALO_PING_MS por navegador (el último envío se comparte entre pestañas por almacenamiento local); además la base limita a 1 cada 4 min por persona.
//   · Se evalúa solo en eventos reales: al cargar, al volver a la pestaña y al interactuar (clic/tecla). Sin uso no hay envío: la observación envejece sola.
//   · Un error NO se reintenta en bucle: se espera REINTENTO_TRAS_ERROR_MS (y solo habrá otro intento ante un nuevo gesto). Un rechazo de autorización/rol (la persona no tiene presencia) detiene los envíos de esta sesión.
export const INTERVALO_PING_MS = 5 * 60_000;
export const REINTENTO_TRAS_ERROR_MS = 60_000;

export type EstadoPing = { ultimo: number; detenido: boolean };

export function debePingar(ahora: number, visible: boolean, estado: EstadoPing): boolean {
  if (!visible || estado.detenido) return false;
  return !(Number.isFinite(estado.ultimo) && ahora - estado.ultimo < INTERVALO_PING_MS && ahora >= estado.ultimo);
}

/** Valor a guardar como «último envío» tras un error transitorio: el próximo intento queda a REINTENTO_TRAS_ERROR_MS (no a un intervalo completo, pero nunca inmediato). */
export function ultimoTrasError(ahora: number): number {
  return ahora - INTERVALO_PING_MS + REINTENTO_TRAS_ERROR_MS;
}

/** ¿El error indica que la persona no puede tener presencia (sin sesión/permiso)? Entonces no se insiste en esta sesión. */
export function errorDefinitivo(error: { code?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  return code === "42501" || code === "PGRST301" || code === "PGRST302" || error.status === 401 || error.status === 403;
}

// ── Control por IDENTIDAD (B3-4) ─────────────────────────────────────────────────────────────────────────────────────
// El «último envío» es de UNA persona, no del navegador: se guarda bajo una clave con su id, de modo que A que acaba de enviar no suprime la primera actividad de B en el mismo navegador, y dos pestañas de la MISMA persona
// siguen compartiendo el límite. La identidad se resuelve sin red (sesión local) y SOLO cuando un gesto ya pasó el límite (como mucho una vez cada 5 min), y se vuelve a verificar justo antes de enviar. Un resultado que llega tarde
// solo toca la clave de la identidad que lo envió, y solo si esa identidad sigue activa. Sin temporizadores: todo ocurre dentro de un evento real.
export const PREFIJO_CLAVE = "presencia:ultimo-envio:";
export const claveDe = (id: string) => `${PREFIJO_CLAVE}${id}`;

export type Almacen = { leer(clave: string): string | null; escribir(clave: string, valor: string): void; borrar(clave: string): void; claves(): string[] };
export type DepsPresencia = {
  ahora: () => number;
  visible: () => boolean;
  /** id de la persona con sesión (lectura LOCAL de la sesión, sin pedir nada a la red salvo que ya hubiera que renovar el token) o null. */
  sesion: () => Promise<string | null>;
  /** la llamada a `registrar_presencia`. */
  enviar: () => Promise<{ error: { code?: string; status?: number } | null }>;
  almacen: Almacen;
};

export function crearControladorPresencia(d: DepsPresencia) {
  let identidad: string | null = null;
  const detenidos = new Set<string>();                  // identidades con rechazo definitivo (sin permiso): no se insiste con ELLAS en esta sesión de página
  const enCurso = new Set<string>();                    // envíos en vuelo, por identidad (el de A no bloquea a B)
  const memoria = new Map<string, number>();            // respaldo si el almacenamiento local falla: sin él cada gesto enviaría
  const leer = (id: string): number => {
    let v = 0; try { v = Number(d.almacen.leer(claveDe(id)) ?? "0") || 0; } catch { /* sin almacenamiento */ }
    return Math.max(v, memoria.get(id) ?? 0);
  };
  const guardar = (id: string, v: number) => { memoria.set(id, v); try { d.almacen.escribir(claveDe(id), String(v)); } catch { /* queda la memoria */ } };
  /** Limpieza de claves de OTRAS personas: al cerrar sesión se borran todas; al cambiar de cuenta solo las que ya no limitan nada (más viejas que el intervalo), así A→B→A en pocos minutos no reenvía y no quedan ids viejos guardados. */
  const limpiar = (salvo: string | null) => {
    const ahora = d.ahora(), viejo = (v: number) => !Number.isFinite(v) || ahora - v >= INTERVALO_PING_MS || v > ahora;
    try {
      for (const k of d.almacen.claves()) {
        if (!k.startsWith(PREFIJO_CLAVE) || k === (salvo ? claveDe(salvo) : "")) continue;
        if (salvo === null || viejo(Number(d.almacen.leer(k)))) d.almacen.borrar(k);
      }
    } catch { /* sin almacenamiento */ }
    for (const [k, v] of [...memoria.entries()]) if (k !== salvo && (salvo === null || viejo(v))) memoria.delete(k);
  };
  /** Cambio de identidad (inicio, cambio de cuenta o cierre de sesión): se olvidan los límites de las demás personas y la nueva empieza sin rechazo previo. */
  function fijarIdentidad(nueva: string | null) {
    if (nueva === identidad) return;
    identidad = nueva;
    limpiar(nueva);
    if (nueva) detenidos.delete(nueva);
  }
  const puede = (id: string) => !enCurso.has(id) && !detenidos.has(id) && debePingar(d.ahora(), d.visible(), { ultimo: leer(id), detenido: false });

  /** Gesto real o carga/vuelta a la pestaña. Devuelve true si envió. */
  async function intentar(): Promise<boolean> {
    if (!d.visible()) return false;
    let id = identidad;
    if (id === null) { id = await d.sesion(); fijarIdentidad(id); if (!id) return false; }
    if (!puede(id)) return false;                       // camino normal de casi todos los gestos: síncrono, sin red ni lecturas de sesión
    const real = await d.sesion();                      // verificación previa al envío (la cuenta pudo cambiar en otra pestaña)
    if (real !== id) { fijarIdentidad(real); if (!real) return false; id = real; }
    if (!puede(id) || !d.visible()) return false;   // se re-evalúa tras la espera: otra pestaña de la misma persona pudo enviar entretanto
    const ahora = d.ahora();
    guardar(id, ahora);                                 // se reserva ANTES de enviar: un segundo gesto u otra pestaña de la misma persona no duplican el envío
    enCurso.add(id);
    try {
      const { error } = await d.enviar();
      if (error) {
        if (identidad !== id) return true;              // la cuenta cambió mientras tanto: el resultado no toca el límite de la identidad nueva
        if (errorDefinitivo(error)) detenidos.add(id); else guardar(id, ultimoTrasError(d.ahora()));
      }
    } catch {
      if (identidad === id) guardar(id, ultimoTrasError(d.ahora()));
    } finally {
      enCurso.delete(id);
    }
    return true;
  }
  /** Evento de autenticación (SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED…): `id` = persona con sesión tras el evento, o null. */
  const cambioSesion = (id: string | null) => fijarIdentidad(id);
  /** Al volver a la pestaña: relee la sesión local (sin red) por si la cuenta cambió en otra pestaña sin que esta recibiera el evento. Una lectura por vuelta a la pestaña, no por gesto. */
  async function reverificar(): Promise<void> { fijarIdentidad(await d.sesion()); }
  return { intentar, cambioSesion, reverificar, identidadActual: () => identidad };
}
