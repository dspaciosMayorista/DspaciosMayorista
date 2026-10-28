// ─────────────────────────────────────────────────────────────────────────
// Tarifa del PAQUETE por pasajero — lógica PURA (solo presentación: nunca cambia un importe guardado).
//
// El cliente ve UNA fila comercial: Adultos · Niños · Tarifa Adulto · Tarifa Niño · Valor total. El vuelo y los servicios adicionales que cubren a TODOS los
// pasajeros se reparten entre ellos y su parte se suma a la tarifa base de cada adulto/niño, para que las tarifas multiplicadas sumen EXACTAMENTE el total.
//   · Todo en centavos enteros. El residuo del reparto va, de a un centavo, a las primeras personas (adultos primero): determinista.
//   · Un adicional que cubre a menos pasajeros, o no dice cuántos cubre, NO se reparte (no se inventa a quién le toca): se devuelve el total agregado y el motivo.
// ─────────────────────────────────────────────────────────────────────────
import { leerPlanB2BDePayload } from "@/lib/cotizacion/asistidaB2B";
import { descripcionCotizacionManual, validarServicioManual } from "@/lib/cart/servicioManual";

/** `cantidad` personas pagan `tarifa` (en unidades de moneda, con centavos). */
export type ParteTarifa = { tarifa: number; cantidad: number };

/** `nombre` ya viene listo para una frase: «el vuelo», «Traslado privado». */
export type AdicionalPaquete = { nombre: string; centavos: number; pax: number | null };

export type TarifaPaquete =
  | { ok: true; adultos: number; ninos: number; tarifaAdulto: number; tarifaNino: number; ajusteCentavos: number; totalCentavos: number; conAdicionales: boolean; neto: boolean }
  | { ok: false; adultos: number; ninos: number; totalCentavos: number; motivo: string; neto: boolean };

/** Pro rata por mayor fracción (desempate por posición): los repartos suman EXACTAMENTE `total`. */
export function repartirProporcional(total: number, pesos: readonly number[]): number[] {
  const suma = pesos.reduce((s, p) => s + p, 0);
  if (!(suma > 0)) return pesos.map(() => 0);
  const exacto = pesos.map((p) => (total * p) / suma);
  const piso = exacto.map(Math.floor);
  let faltan = total - piso.reduce((s, p) => s + p, 0);
  const orden = exacto.map((e, i) => ({ i, f: e - Math.floor(e) })).filter((x) => pesos[x.i] > 0).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let j = 0; faltan > 0 && orden.length; j++, faltan--) piso[orden[j % orden.length].i]++;
  return piso;
}

export function tarifaPaquete(e: {
  adultos: number; ninos: number;
  /** Parte del alojamiento (o de la base) de los adultos y de los niños, en centavos. */
  baseAdultoCentavos: number; baseNinoCentavos: number;
  adicionales: readonly AdicionalPaquete[];
  neto?: boolean;
}): TarifaPaquete {
  const { adultos, ninos } = e;
  const neto = !!e.neto;
  const sumaAdic = e.adicionales.reduce((s, a) => s + a.centavos, 0);
  const totalCentavos = e.baseAdultoCentavos + e.baseNinoCentavos + sumaAdic;
  const falla = (motivo: string): TarifaPaquete => ({ ok: false, adultos, ninos, totalCentavos, motivo, neto });
  const n = adultos + ninos;
  const enteros = [adultos, ninos, e.baseAdultoCentavos, e.baseNinoCentavos, ...e.adicionales.map((a) => a.centavos)];
  if (!enteros.every((v) => Number.isSafeInteger(v) && v >= 0) || n < 1) return falla("los datos de pasajeros o importes no permiten repartir la tarifa");
  if ((adultos === 0 && e.baseAdultoCentavos > 0) || (ninos === 0 && e.baseNinoCentavos > 0)) return falla("hay un importe de adultos o niños sin pasajeros que lo respalden");
  const parcial = e.adicionales.find((a) => a.pax !== n);
  if (parcial) {
    return falla(parcial.pax == null
      ? `no se pudo verificar cuántos pasajeros cubre ${parcial.nombre}`
      : `${parcial.nombre} cubre ${parcial.pax} de los ${n} pasajeros`);
  }
  // UNA tarifa por clase (todos los adultos pagan lo mismo; todos los niños, lo mismo): la parte entera en centavos de su base + su parte del adicional.
  // Lo que no se reparte en centavos exactos (menos de un centavo por persona) NO se esconde: sale como «ajuste de redondeo» explícito, de modo que
  // adultos × tarifa + niños × tarifa + ajuste = total, siempre al centavo.
  const pisoAdic = Math.floor(sumaAdic / n);
  const pisoA = adultos > 0 ? Math.floor(e.baseAdultoCentavos / adultos) + pisoAdic : 0;
  const pisoN = ninos > 0 ? Math.floor(e.baseNinoCentavos / ninos) + pisoAdic : 0;
  const ajusteCentavos = totalCentavos - adultos * pisoA - ninos * pisoN;
  return { ok: true, adultos, ninos, tarifaAdulto: pisoA / 100, tarifaNino: pisoN / 100, ajusteCentavos, totalCentavos, conAdicionales: e.adicionales.length > 0, neto };
}

// ── Opción de una comparativa de carrito ──
const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const cent = (n: number) => Math.round(n * 100);
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(obj) : []);

/** Etiqueta que el checkout pone a la línea de precio total de los servicios INCLUIDOS del paquete con cobro por grupo (hotel normal, no Bernalo). */
const SUFIJO_GRUPO = " · Servicios incluidos por grupo";
export const NOMBRE_GRUPO_INCLUIDO = "los servicios incluidos por grupo";
/** ¿Es la línea de total de servicios incluidos por grupo de un hotel normal? (Una línea Bernalo también es de precio total, pero su texto no termina así.) */
export function esLineaGrupoIncluido(linea: { descripcion?: unknown; modo_precio?: unknown }): boolean {
  return linea.modo_precio === "total" && typeof linea.descripcion === "string" && linea.descripcion.endsWith(SUFIJO_GRUPO);
}

/**
 * A cuántos pasajeros cubre el servicio incluido por grupo, según el snapshot congelado. El cobro por grupo se liquida con los pasajeros CON silla (adultos y niños, sin
 * los menores de 2 años), así que solo se acredita cuando: hay exactamente un hotel normal (no Bernalo), el snapshot guardó el servicio incluido ligado a ese hotel (`ref`),
 * y no hay infantes (con infantes no se sabe de los datos guardados cuántos pasajeros entraron al rango del grupo). null = no acreditable.
 */
export function grupoPaxDePayload(payload: unknown): number | null {
  if (!obj(payload)) return null;
  const hoteles = lista(payload.items);
  if (hoteles.length !== 1 || (Array.isArray(payload.items) && payload.items.length !== 1)) return null;
  const h = hoteles[0];
  if (h.modeloTarifario === "unidad" || typeof h.ref !== "string" || !h.ref) return null;
  if (!lista(payload.serviciosIncluidos).some((s) => s.ref === h.ref)) return null;
  if (h.infantes !== 0 || !(typeof h.pax === "number" && Number.isInteger(h.pax) && h.pax > 0)) return null;
  return h.pax;
}

/**
 * Tarifa del paquete de UNA opción de carrito, desde su snapshot congelado (`plantilla_hija`) y, en NETO, desde el plan B2B congelado (`payload.b2bAsistido`).
 * Devuelve null cuando no aplica (comparativa manual, tarifa por habitación Bernalo, o una opción PVP sin vuelo ni servicios: ahí vale la presentación de siempre).
 *  · PVP: alojamiento (líneas de habitación del snapshot) + vuelos/servicios con su precio declarado; deben sumar EXACTAMENTE el total de la opción.
 *  · NETO: el total es el exigible; la comisión se reparte entre las líneas del plan SOLO sobre su parte comisionable (PVP − impuesto no comisionable), así
 *    ningún importe NETO sale del PVP ni de una proporción que ignore lo no comisionable.
 * Si el snapshot no alcanza para repartir con seguridad: `ok: false` con el motivo (el documento muestra el total agregado y lo explica).
 */
export function tarifaPaqueteOpcion(resumen: unknown, plantilla: unknown, totalColumna: number): TarifaPaquete | null {
  const payload = obj(plantilla) && obj(plantilla.payload) ? plantilla.payload : null;
  const detalle = obj(plantilla) && obj(plantilla.detalle) ? plantilla.detalle : null;
  if (!payload || !Array.isArray(payload.items) || !detalle) return null;
  const exigible = obj(resumen) && typeof resumen.total_exigible === "number" ? resumen.total_exigible : null;
  const neto = exigible !== null;
  const tours = lista(payload.tours), manuales = lista(payload.manuales);
  if (!neto && !tours.length && !manuales.length) return null;

  const filas = lista(detalle.items);
  const esAdicional = (d: unknown) => typeof d === "string" && (d.startsWith("Servicio · ") || d.startsWith("Vuelo · "));
  const lineasGrupo = filas.filter(esLineaGrupoIncluido);
  const habitaciones = filas.filter((i) => !esAdicional(i.descripcion) && !esLineaGrupoIncluido(i));
  if (habitaciones.some((i) => i.modo_precio === "total")) return null;
  const adultos = habitaciones.reduce((s, i) => s + Number(i.adultos), 0);
  const ninos = habitaciones.reduce((s, i) => s + Number(i.ninos), 0);
  let baseA = habitaciones.reduce((s, i) => s + cent(Number(i.adultos) * Number(i.tarifa_adulto)), 0);
  let baseN = habitaciones.reduce((s, i) => s + cent(Number(i.ninos) * Number(i.tarifa_nino)), 0);
  const nombre = (x: Record<string, unknown>) => (x.clase === "vuelo" ? "el vuelo" : `«${typeof x.nombre === "string" && x.nombre.trim() ? x.nombre.trim() : "servicio adicional"}»`);
  const paxDe = (x: Record<string, unknown>) => (typeof x.pax === "number" && Number.isInteger(x.pax) && x.pax > 0 ? x.pax : null);
  const lineaDe = (x: Record<string, unknown>): { nombre: string; pvp: number; pax: number | null } | null =>
    typeof x.precio === "number" && Number.isFinite(x.precio) ? { nombre: nombre(x), pvp: cent(x.precio), pax: paxDe(x) } : null;
  const ads = [...tours.map(lineaDe), ...manuales.map(lineaDe)];
  const totalOpcion = cent(neto ? exigible : totalColumna);
  const fallaSnapshot = (): TarifaPaquete => ({ ok: false, adultos, ninos, totalCentavos: totalOpcion, neto, motivo: "el registro de esta opción no permite verificar el reparto por pasajero; genera la comparativa de nuevo" });
  if (ads.some((a) => a === null)) return fallaSnapshot();
  const adicionales = (ads as { nombre: string; pvp: number; pax: number | null }[]).map((a) => ({ nombre: a.nombre, centavos: a.pvp, pax: a.pax }));
  // Servicios incluidos por grupo: parte del hotel (su importe ya está en el precio del hotel, no se suma otra vez). Se reparte como un adicional solo si el snapshot acredita su cobertura.
  const grupoC = lineasGrupo.reduce((s, i) => s + cent(Number(i.valor_total)), 0);
  if (lineasGrupo.length) adicionales.push({ nombre: NOMBRE_GRUPO_INCLUIDO, centavos: grupoC, pax: lineasGrupo.length === 1 ? grupoPaxDePayload(payload) : null });
  if (baseA + baseN + adicionales.reduce((s, a) => s + a.centavos, 0) !== cent(totalColumna)) return fallaSnapshot();

  if (neto) {
    const r = netoDePlan(payload, exigible, totalColumna);
    if (!r) return fallaSnapshot();
    if (r.hotelPvp !== baseA + baseN + grupoC) return fallaSnapshot();
    // El NETO del hotel se reparte entre adultos, niños y el servicio por grupo (todos son parte de la línea de hotel del plan), en proporción a su PVP.
    let netoGrupo = 0;
    [baseA, baseN, netoGrupo] = repartirProporcional(r.hotelNeto, [baseA, baseN, grupoC]);
    const netoAd = [...r.tours, ...r.manuales, ...(lineasGrupo.length ? [netoGrupo] : [])];
    if (netoAd.length !== adicionales.length) return fallaSnapshot();
    adicionales.forEach((a, i) => { a.centavos = netoAd[i]; });
    if (baseA + baseN + adicionales.reduce((s, a) => s + a.centavos, 0) !== cent(exigible)) return fallaSnapshot();
  }
  return tarifaPaquete({ adultos, ninos, baseAdultoCentavos: baseA, baseNinoCentavos: baseN, adicionales, neto });
}

/**
 * Reparto NETO del plan B2B congelado (`payload.b2bAsistido`): la comisión se reparte entre las líneas del plan SOLO sobre su parte comisionable (PVP − impuesto no
 * comisionable, que queda íntegro). Devuelve el NETO del alojamiento (líneas que no son tour ni manual) y el de cada tour y manual, en el orden del payload.
 * null si falta el plan, no es NETO, no cuadra con el exigible o con el PVP, o no hay una línea del plan por cada tour/manual.
 */
export function netoDePlan(payload: unknown, exigible: number, totalPvp: number): { hotelPvp: number; hotelNeto: number; tours: number[]; manuales: number[] } | null {
  if (!obj(payload)) return null;
  const leido = leerPlanB2BDePayload(payload);
  const plan = leido.ok ? leido.plan : null;
  if (!plan || plan.modo_compra !== "neta" || cent(plan.total_exigible) !== cent(exigible) || cent(plan.pvp) !== cent(totalPvp)) return null;
  const lineas = plan.lineas.map((l) => ({ clave: l.clave, pvp: cent(l.pvp), base: cent(l.pvp) - cent(l.impuesto) }));
  const comision = repartirProporcional(cent(plan.comision), lineas.map((l) => l.base));
  const netoDe = lineas.map((l, i) => ({ clave: l.clave, pvp: l.pvp, neto: l.pvp - comision[i] }));
  const esAd = (c: string) => /^(tour|manual)-[0-9]+$/.test(c);
  const serie = (prefijo: string, n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) { const l = netoDe.find((x) => x.clave === `${prefijo}-${i}`); if (!l) return null; out.push(l.neto); }
    return out;
  };
  const tours = serie("tour", lista(payload.tours).length), manuales = serie("manual", lista(payload.manuales).length);
  if (!tours || !manuales) return null;
  const hotel = netoDe.filter((l) => !esAd(l.clave));
  return { hotelPvp: hotel.reduce((x, l) => x + l.pvp, 0), hotelNeto: hotel.reduce((x, l) => x + l.neto, 0), tours, manuales };
}

// ── Cotización normal: vínculo de cada línea adicional con el snapshot congelado ──
/** Un servicio del tarifario (tour) o manual del snapshot, tal como lo ve el documento: su texto, su precio, a cuántos pasajeros cubre y, en NETO, su parte NETO. */
export type VinculoAdicional = { descripcion: string; precioCentavos: number; pax: number | null; netoCentavos: number | null };
/** Lo ÚNICO del snapshot que el documento necesita (sin PVP de línea expuesto como importe, sin comisión): apto para el enlace público. */
export type SnapshotPaquete = {
  adicionales: VinculoAdicional[];
  /** Suma del snapshot (hoteles + tours + manuales) en centavos: el documento exige que coincida con sus propias líneas. */
  pvpCentavos: number;
  neto: { hotelPvpCentavos: number; hotelNetoCentavos: number; exigibleCentavos: number } | null;
  /** Pasajeros que cubre el servicio incluido por grupo del hotel (ver `grupoPaxDePayload`); null = no acreditable o no aplica. */
  grupoPax: number | null;
};

/**
 * Deriva, EN EL SERVIDOR, el snapshot que el documento usa para repartir el paquete. `payload` es el de la cotización; `netoTotalExigible` el de `detalle.b2bExterno`
 * (null = PVP). El documento público nunca recibe el payload: solo este resumen.
 */
export function snapshotPaqueteDePayload(payload: unknown, netoTotalExigible: number | null): SnapshotPaquete | null {
  if (!obj(payload)) return null;
  const tours = lista(payload.tours), manuales = lista(payload.manuales);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const pax = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
  const adicionales: VinculoAdicional[] = [];
  for (const t of tours) {
    const precio = num(t.precio);
    if (typeof t.nombre !== "string" || precio === null) continue;
    adicionales.push({ descripcion: `Servicio · ${t.nombre}${typeof t.destino === "string" && t.destino ? ` — ${t.destino}` : ""}`, precioCentavos: cent(precio), pax: pax(t.pax), netoCentavos: null });
  }
  for (const m of manuales) {
    const r = validarServicioManual(m);
    if (r.ok) adicionales.push({ descripcion: descripcionCotizacionManual(r.valor), precioCentavos: cent(r.valor.precio), pax: pax(r.valor.pax), netoCentavos: null });
  }
  const hoteles = Array.isArray(payload.items) ? payload.items.filter(obj) : [];
  let pvp = 0;
  for (const x of [...hoteles, ...tours, ...manuales]) {
    const precio = num(x.precio);
    if (precio === null) return null;
    pvp += cent(precio);
  }
  let neto: SnapshotPaquete["neto"] = null;
  if (netoTotalExigible !== null) {
    const r = netoDePlan(payload, netoTotalExigible, pvp / 100);
    // Los adicionales válidos conservan el orden tours → manuales: si alguno se descartó arriba, no se puede asociar su NETO con seguridad.
    if (r && adicionales.length === r.tours.length + r.manuales.length) {
      [...r.tours, ...r.manuales].forEach((n, i) => { adicionales[i].netoCentavos = n; });
      neto = { hotelPvpCentavos: r.hotelPvp, hotelNetoCentavos: r.hotelNeto, exigibleCentavos: cent(netoTotalExigible) };
    }
  }
  return { adicionales, pvpCentavos: pvp, neto, grupoPax: grupoPaxDePayload(payload) };
}

/** Vincula cada línea adicional del documento (texto + valor PVP) con UNA entrada del snapshot (texto idéntico y mismo precio; cada entrada se usa una sola vez). null = sin vínculo seguro. */
export function vincularAdicionales(lineas: readonly { descripcion: string; centavos: number }[], snap: SnapshotPaquete | null): (VinculoAdicional | null)[] {
  const usados = new Set<number>();
  return lineas.map((l) => {
    const i = snap ? snap.adicionales.findIndex((a, j) => !usados.has(j) && a.descripcion === l.descripcion && a.precioCentavos === l.centavos) : -1;
    if (i < 0) return null;
    usados.add(i);
    return snap!.adicionales[i];
  });
}
