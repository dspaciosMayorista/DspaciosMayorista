// #125 (owner correction 2026-11-18, round 2 after Codex C1/C2) — PRESENTATION ONLY. The stored contract keeps the signed «Niño gratis por habitación» line (adultos:1 × negative tarifa) so that
// Σ items = precio_venta; nothing here writes or changes stored data. For the CLIENT document the benefit is folded into the payable tariff of the child it belongs to:
// «full-price child row + negative promotion row» becomes «paying children at their tariff + the benefited child at what that child really pays».
// A child that pays nothing is shown as «Niño gratis»; no promotion name, nights or arithmetic reach the client.
//   · C1: a free child (payable tariff 0) joins the ONE adult package row of its hotel/category/regimen («Adultos 2 · Niños 1 · Tarifa Niño «Niño gratis»»); with more than one candidate adult row the
//     attribution is not sealed (the signed text names «hab. N» but the adult rows do not say which room is which) so the free child keeps ONE separate row — never guessed into a room.
//   · C2: several children with a PARTIAL benefit cannot be split child by child from the stored total. Where the per-child tariff is sealed (the frozen summary, `filasResumen.ts`) that path is used; for the
//     historical line that only carries a total, the beneficiaries are ONE row with their group value (Σ tariffs − benefit) and NO per-child tariff (`tarifaNinoNoAtribuible`): no negative row, no average shown, no invented split.
import { ROTULO_LINEA_NINO_GRATIS, esLineaNinoGratis } from "@/lib/reservar/ninoGratisLinea";

export const ETIQUETA_NINO_GRATIS_CLIENTE = "Niño gratis";

type Fila = { id: number; descripcion: string; modo_precio: string; valor_total: number | null; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number };
/** Marcas SOLO de presentación (no se guardan): la fila del paquete que ya incluye al niño gratis, y la fila de menores cuyo importe es de grupo (sin tarifa por niño atribuible). */
export type MarcasNinoGratis = { ninoGratisFusionado?: boolean; ninoGratisCero?: boolean; tarifaNinoNoAtribuible?: boolean };

const cent = (n: number) => Math.round(Number(n) * 100);
const sufijoCatReg = (d: string) => d.slice(d.lastIndexOf(" · ") + 3);

/**
 * Plega la línea firmada del niño gratis en las filas de niño de su clase y une al niño en cero con la fila de adultos del paquete. Conserva EXACTAMENTE la suma de las filas.
 * Si no se puede atribuir con certeza (fila de niño ausente, importes que no cuadran, rótulos distintos) la línea queda tal cual
 * (el documento la rotula solo «Niño gratis», sin promoción ni cálculo) y NO se inventa un reparto.
 */
export function plegarNinoGratisItems<T extends Fila>(items: readonly T[]): { items: (T & MarcasNinoGratis)[]; plegado: boolean } {
  let filas: (T & MarcasNinoGratis)[] = [...items];
  let plegado = false;
  let siguienteId = Math.max(0, ...items.map((i) => (Number.isSafeInteger(i.id) ? i.id : 0))) + 1;
  for (const ng of items.filter((i) => esLineaNinoGratis(i.descripcion))) {
    const corte = ng.descripcion.indexOf(ROTULO_LINEA_NINO_GRATIS);
    const prefijo = corte > 0 ? ng.descripcion.slice(0, corte) : "";
    const clases = [...ng.descripcion.matchAll(/\(Niño ([12])\)/g)].map((m) => m[1]);
    const importe = -cent(Number(ng.adultos) * Number(ng.tarifa_adulto)); // centavos condonados (positivo)
    if (!clases.length || importe <= 0) continue;
    const cuenta = new Map<string, number>();
    for (const c of clases) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
    // La línea firmada del contrato creado desde Reservar/conversión lleva el hotel delante («Hotel · Niño gratis por habitación …») y las filas de niño NO (real: DTM-0001 NETO 2026-11-18): se busca primero con el prefijo y,
    // si ninguna lo lleva, la ÚNICA fila de esa clase sin prefijo (con varias no se adivina cuál es).
    const buscarFila = (c: string, n: number) => {
      const conPrefijo = filas.find((f) => f.modo_precio !== "total" && f.descripcion.startsWith(`${prefijo}Niño ${c} · `) && Number(f.ninos) >= n);
      if (conPrefijo || !prefijo) return conPrefijo;
      const sin = filas.filter((f) => f.modo_precio !== "total" && f.descripcion.startsWith(`Niño ${c} · `) && Number(f.ninos) >= n);
      return sin.length === 1 ? sin[0] : undefined;
    };
    const objetivos = [...cuenta].map(([c, n]) => ({ c, n, fila: buscarFila(c, n) }));
    if (objetivos.some((o) => !o.fila)) continue;
    const tarifa = (o: (typeof objetivos)[number]) => cent(o.fila!.tarifa_nino);
    const sumaTarifas = objetivos.reduce((s, o) => s + o.n * tarifa(o), 0);
    if (importe > sumaTarifas) continue; // inconsistente (lo condonado supera lo que pagarían): se conserva la línea tal cual, no se inventa
    // Reducción por niño de cada clase (centavos), SOLO cuando es la única lectura posible:
    //   · un solo niño beneficiado en total (recibe todo lo condonado: p. ej. 347.000 − 253.000 = 94.000), o
    //   · TODOS los beneficiados quedan en cero (importe = Σ tarifas: cada uno recibe su tarifa completa, de una o de las dos clases).
    // Cualquier otro caso (varios niños con condonación parcial) no se atribuye niño a niño.
    const total1 = objetivos.reduce((s, o) => s + o.n, 0) === 1;
    const todosGratis = importe === sumaTarifas;
    let reduccion: Map<string, number[]> | null = null;
    if (total1) reduccion = new Map([[objetivos[0].c, [importe]]]);
    else if (todosGratis) reduccion = new Map(objetivos.map((o) => [o.c, Array.from({ length: o.n }, () => tarifa(o))]));
    if (reduccion) {
      for (const o of objetivos) {
        const original = o.fila!;
        const grupos = new Map<number, number>(); // tarifa pagadera (centavos) → niños
        for (const r of reduccion.get(o.c)!) grupos.set(tarifa(o) - r, (grupos.get(tarifa(o) - r) ?? 0) + 1);
        const restantes = Number(original.ninos) - o.n;
        const nuevas: (T & MarcasNinoGratis)[] = [];
        if (restantes > 0) nuevas.push({ ...original, ninos: restantes });
        for (const [pagadero, ninos] of [...grupos].sort((a, b) => b[0] - a[0])) {
          const reutiliza = restantes === 0 && nuevas.length === 0;
          nuevas.push({
            ...original,
            id: reutiliza ? original.id : siguienteId++,
            ninos,
            tarifa_nino: pagadero / 100,
            descripcion: pagadero === 0 ? original.descripcion.replace(/Niño [12]( ·|$)/, `${ETIQUETA_NINO_GRATIS_CLIENTE}$1`) : original.descripcion,
            ...(pagadero === 0 ? { ninoGratisCero: true } : {}),
          });
        }
        const pos = filas.indexOf(original);
        filas = [...filas.slice(0, pos), ...nuevas, ...filas.slice(pos + 1)];
      }
    } else {
      // C2 — varios niños con beneficio PARCIAL y solo el total guardado: UNA fila de grupo (Σ tarifas − beneficio), sin tarifa por niño, sin fila negativa. Exige un único prefijo/rótulo de categoría y régimen.
      const sufijos = new Set(objetivos.map((o) => sufijoCatReg(o.fila!.descripcion)));
      if (sufijos.size !== 1) continue;
      const ninosGrupo = objetivos.reduce((s, o) => s + o.n, 0);
      const valorGrupo = sumaTarifas - importe; // centavos que SE PAGAN por los beneficiados
      const primero = objetivos[0].fila!;
      const grupo: T & MarcasNinoGratis = {
        ...primero, id: siguienteId++, ninos: ninosGrupo, tarifa_nino: valorGrupo / ninosGrupo / 100, tarifaNinoNoAtribuible: true,
        descripcion: objetivos.length === 1 ? primero.descripcion : `${primero.descripcion.slice(0, primero.descripcion.indexOf("Niño "))}Niños · ${[...sufijos][0]}`,
      };
      const posPrimero = filas.indexOf(primero);
      const resultado: (T & MarcasNinoGratis)[] = [];
      filas.forEach((f, i) => {
        const o = objetivos.find((x) => x.fila === f);
        if (!o) { resultado.push(f); return; }
        const restantes = Number(f.ninos) - o.n;
        if (restantes > 0) resultado.push({ ...f, ninos: restantes });
        if (i === posPrimero) resultado.push(grupo);
      });
      filas = resultado;
    }
    filas = filas.filter((f) => f !== ng && f.id !== ng.id);
    plegado = true;
  }
  return { items: unirNinoGratisAlPaquete(filas), plegado };
}

/** Fila de adultos del paquete (alojamiento por persona): no es servicio, vuelo, ajuste, niño ni la línea firmada. */
const esFilaAdultosPaquete = (f: Fila) =>
  f.modo_precio !== "total" && Number(f.adultos) > 0 && !f.descripcion.startsWith("Servicio · ") && !f.descripcion.includes("Niño") && !/^Ajuste por redondeo$/i.test(f.descripcion) && !/vuelo/i.test(f.descripcion);

/**
 * C1 — el niño en cero se muestra DENTRO de la fila de adultos del paquete (misma cobertura): «Adultos 2 · Niños 1 · Tarifa Niño «Niño gratis»». Solo si hay UNA fila candidata con el mismo hotel/categoría/régimen
 * (si hay varias —otra habitación con otra tarifa— no hay dato sellado de a qué habitación pertenece el niño y NO se adivina: queda su fila «Niño gratis»). El valor total de la fila no cambia (el niño aporta 0).
 */
function unirNinoGratisAlPaquete<T extends Fila & MarcasNinoGratis>(filas: T[]): T[] {
  let salida = filas;
  for (const g of filas.filter((f) => f.ninoGratisCero)) {
    const corte = g.descripcion.indexOf(ETIQUETA_NINO_GRATIS_CLIENTE);
    const prefijo = corte > 0 ? g.descripcion.slice(0, corte) : "";
    const sufijo = sufijoCatReg(g.descripcion);
    const candidatas = salida.filter((f) => esFilaAdultosPaquete(f) && f.descripcion.startsWith(prefijo) && sufijoCatReg(f.descripcion) === sufijo && (Number(f.ninos) === 0 || Number(f.tarifa_nino) === 0));
    if (candidatas.length !== 1) continue;
    const adultos = candidatas[0];
    const fusionada = { ...adultos, ninos: Number(adultos.ninos) + Number(g.ninos), tarifa_nino: 0, ninoGratisFusionado: true };
    salida = salida.filter((f) => f !== g).map((f) => (f === adultos ? fusionada : f));
  }
  return salida;
}

/** Rótulo de cliente de una línea firmada que no se pudo plegar: «Niño gratis», sin promoción ni cálculo. */
export const descripcionClienteNinoGratis = (descripcion: string) => (esLineaNinoGratis(descripcion) ? ETIQUETA_NINO_GRATIS_CLIENTE : descripcion);

/** La explicación «Niño gratis de «promoción»: habitación …» (condiciones de la tarifa) nombra la promoción: no se muestra en un contrato. */
export const esExplicacionNinoGratis = (texto: unknown): boolean => typeof texto === "string" && /^Niño gratis de «/.test(texto);
