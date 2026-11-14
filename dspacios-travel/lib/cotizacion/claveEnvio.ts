// #14-A — Identidad de la INTENCIÓN de envío del formulario del carrito (protección del servidor contra el doble envío, las pestañas y los reintentos de UNA misma intención).
// Alcance deliberadamente acotado: coordina las pestañas del MISMO navegador (localStorage + Web Locks); NO deduplica entre navegadores ni entre dispositivos (cada uno tiene su identidad).
// Reglas:
//  · La identidad (UUID aleatorio) se guarda por contenido (huella) en el almacén del navegador, con un historial {id, desde}. Crearla/leerla ocurre dentro de un candado del navegador
//    (`navigator.locks`), así que dos pestañas que arrancan con el almacén VACÍO obtienen la MISMA identidad (sin el candado, escribir-y-releer converge igual salvo en una ventana mínima).
//  · Cada formulario abierto FIJA la identidad que resolvió para un contenido y la conserva (`fijadas`): lo que otras pestañas hagan después no la cambia.
//  · «Es otra compra» (`nuevaCompra`) añade una identidad NUEVA al historial con la hora actual y la fija SOLO en el formulario que la pidió. Las pestañas abiertas antes siguen resolviendo la identidad
//    que regía cuando se abrieron (`abiertaEn`): no se vuelven compras nuevas; las abiertas después usan la nueva.
//  · NO hay época ni caducidad por hora en la identidad (nada que se rompa «en el límite»): el almacén solo se limpia de contenidos sin uso en 24 h.
//  · Otro titular, recobro, aliado u hotel = otro contenido = otra huella = otra identidad. Otro usuario/contenido con la misma identidad → el servidor responde `clave_en_uso` y se pasa a una identidad nueva.
export const CLAVE_ALMACEN = "dspacios_envio_v3";
export const RETENCION_MS = 24 * 3600_000;
const NOMBRE_CANDADO = "dspacios_envio";

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Version = { id: string; desde: number };
type Registro = { ids: Version[]; ts: number };
type Mapa = Record<string, Registro>;
/** Ejecuta `fn` en exclusión mutua entre las pestañas del navegador. */
export type Candado = <T>(fn: () => T) => Promise<T>;

export const candadoDelNavegador: Candado = (fn) => {
  const locks = (globalThis as { navigator?: { locks?: { request: (n: string, cb: () => unknown) => Promise<unknown> } } }).navigator?.locks;
  return locks?.request ? (locks.request(NOMBRE_CANDADO, async () => fn()) as Promise<ReturnType<typeof fn>>) : Promise.resolve().then(fn);
};

export type ContextoEnvio = {
  almacen: Almacen | null;
  /** Cuándo se abrió este formulario: decide qué identidad del historial le corresponde si aún no fijó ninguna. */
  abiertaEn: number;
  /** Identidades ya fijadas por este formulario (huella → id): no cambian por lo que hagan otras pestañas. */
  fijadas: Map<string, string>;
  nuevoUuid: () => string;
  candado: Candado;
  ahora: () => number;
};

export function crearContextoEnvio(almacen: Almacen | null, nuevoUuid: () => string, opciones: { candado?: Candado; ahora?: () => number } = {}): ContextoEnvio {
  const ahora = opciones.ahora ?? Date.now;
  return { almacen, abiertaEn: ahora(), fijadas: new Map(), nuevoUuid, candado: opciones.candado ?? candadoDelNavegador, ahora };
}

/** Texto canónico de la solicitud SIN lo que no define la intención (`vistos` y la propia clave). */
export function textoDeEntrada(entrada: unknown): string {
  return JSON.stringify(entrada, (k, v) => (k === "vistos" || k === "claveEnvio" ? undefined : v)) ?? "null";
}

/** Huella corta (djb2 de 53 bits) del contenido: solo indexa la identidad en el almacén. No es criptográfica; el servidor guarda su propia huella SHA-256. */
export function huellaDeEntrada(entrada: unknown): string {
  const texto = textoDeEntrada(entrada);
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < texto.length; i++) { const c = texto.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 33) ^ c; h1 >>>= 0; h2 >>>= 0; }
  return `${h1.toString(16)}${h2.toString(16)}-${texto.length}`;
}

function leer(almacen: Almacen | null): Mapa {
  try { const v = JSON.parse(almacen?.getItem(CLAVE_ALMACEN) ?? "null"); return v && typeof v === "object" && !Array.isArray(v) ? (v as Mapa) : {}; } catch { return {}; }
}
function guardar(almacen: Almacen | null, m: Mapa, ahora: number): void {
  for (const k of Object.keys(m)) if (!(ahora - m[k].ts < RETENCION_MS)) delete m[k]; // limpieza: contenidos sin uso en 24 h
  try { almacen?.setItem(CLAVE_ALMACEN, JSON.stringify(m)); } catch { /* sin almacén: la identidad vale solo para este formulario */ }
}
const vigente = (r: Registro | undefined, ahora: number): r is Registro => versionValida(r) && ahora - r.ts < RETENCION_MS;
const versionValida = (r: Registro | undefined): r is Registro => !!r && Array.isArray(r.ids) && r.ids.length > 0 && r.ids.every((v) => typeof v.id === "string" && typeof v.desde === "number");

/** La identidad que rige para quien se abrió en `abiertaEn`: la última versión con `desde <= abiertaEn`. La primera tiene `desde = 0`, así que siempre hay una. */
function vigenteEn(r: Registro, abiertaEn: number): string {
  let id = r.ids[0].id;
  for (const v of r.ids) if (v.desde <= abiertaEn) id = v.id;
  return id;
}

/** Identidad de ESTA intención en este formulario: la fijada, o la que resuelve (creándola si el almacén no la tiene) dentro del candado. */
export async function claveParaEnvio(entrada: unknown, ctx: ContextoEnvio): Promise<string> {
  const huella = huellaDeEntrada(entrada);
  const fijada = ctx.fijadas.get(huella);
  if (fijada) return fijada;
  const id = await ctx.candado(() => {
    const ahora = ctx.ahora();
    const m = leer(ctx.almacen);
    let r = m[huella];
    if (!vigente(r, ahora)) { r = { ids: [{ id: ctx.nuevoUuid(), desde: 0 }], ts: ahora }; m[huella] = r; }
    r.ts = ahora;
    guardar(ctx.almacen, m, ahora);
    // Sin candado del navegador: si otra pestaña escribió a la vez, gana lo que quedó guardado (todas releen y adoptan el mismo registro).
    const guardado = leer(ctx.almacen)[huella];
    return vigenteEn(versionValida(guardado) ? guardado : r, ctx.abiertaEn);
  });
  ctx.fijadas.set(huella, id);
  return id;
}

/** «Es otra compra»: una identidad NUEVA para este contenido, fijada solo en este formulario; las pestañas abiertas antes conservan la suya. */
export async function nuevaCompra(entrada: unknown, ctx: ContextoEnvio): Promise<string> {
  const huella = huellaDeEntrada(entrada);
  const id = ctx.nuevoUuid();
  await ctx.candado(() => {
    const ahora = ctx.ahora();
    const m = leer(ctx.almacen);
    const r = vigente(m[huella], ahora) ? m[huella] : { ids: [{ id: ctx.nuevoUuid(), desde: 0 }], ts: ahora };
    r.ids.push({ id, desde: ahora });
    r.ts = ahora;
    m[huella] = r;
    guardar(ctx.almacen, m, ahora);
  });
  ctx.fijadas.set(huella, id);
  return id;
}

/** Envía con la identidad de la intención. Si el servidor dice que esa clave la usó OTRO usuario u OTRO contenido, pasa a una identidad nueva y reintenta (hasta `intentos` envíos). */
export async function enviarConClave<R>(entrada: unknown, ctx: ContextoEnvio, enviar: (clave: string) => Promise<R>, esClaveEnUso: (r: R) => boolean, intentos = 3): Promise<R> {
  let r = await enviar(await claveParaEnvio(entrada, ctx));
  for (let i = 1; i < intentos && esClaveEnUso(r); i++) r = await enviar(await nuevaCompra(entrada, ctx));
  return r;
}

/** ¿Puede este navegador coordinar pestañas? Exige un almacén que funcione (escribe, relee, borra) Y Web Locks. Si no, la interfaz lo dice: solo hay protección dentro de esta página (doble clic y reintentos), no entre pestañas. */
export function coordinacionDisponible(almacen: Almacen | null, conCandado: boolean = !!(globalThis as { navigator?: { locks?: { request?: unknown } } }).navigator?.locks?.request): boolean {
  if (!almacen || !conCandado) return false;
  try {
    const sonda = `${CLAVE_ALMACEN}_sonda`;
    almacen.setItem(sonda, "1");
    const ok = almacen.getItem(sonda) === "1";
    almacen.removeItem(sonda);
    return ok;
  } catch { return false; }
}
