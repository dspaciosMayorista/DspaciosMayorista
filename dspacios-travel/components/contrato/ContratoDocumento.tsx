import { COLOR_DOCUMENTO } from "@/lib/contrato/colorDocumento";
import { EstanciaContratoBloque, type EstanciaContratoVista } from "@/components/contrato/EstanciaContratoBloque";
import {
  EMPRESA,
  CONTRATO_TITULO,
  CONTRATO_INTRO,
  CLAUSULAS,
  CONSTANCIA_PREFIJO,
  FIRMA_ETIQUETAS,
  COPYRIGHT_PREFIJO,
  POWERED_BY,
} from "@/lib/contrato/plantilla";
import { formatMoneda, formatFechaLarga, calcularEdad } from "@/lib/utils";
import { etiquetaIata, parseRuta } from "@/lib/iata";
import { esLineaGrupoIncluido, NOMBRE_GRUPO_INCLUIDO, repartirProporcional, tarifaPaquete, vincularAdicionales, type ParteTarifa, type SnapshotPaquete } from "@/lib/cotizacion/tarifaPaquete";
import { valorVisibleContratoItem, totalVisibleContratoItems } from "@/lib/contrato/valorContratoItem";
import { presentacionValoresContrato } from "@/lib/contrato/presentacionValores";
import { valoresNetosDocumento, tarifaIndividualSegura } from "@/lib/contrato/valoresNetosDocumento";
import { hayServicioManual, tituloPaqueteEditado, tituloPaqueteTuristico } from "@/lib/contrato/paqueteTuristicoDocumento";
import type { ComposicionBernaloDocumento, HabitacionBernaloDocumento } from "@/lib/reservar/alojamientoBernaloDocumento";
import type {
  VentaDocumento,
  ContratoPasajero,
  ContratoHotel,
  ContratoVuelo,
  ContratoItem,
  Agencia,
} from "@/types/database";
import type { CondicionesContratoResueltas } from "@/lib/contrato/condicionesContrato";
import { nombreQuienElabora } from "@/lib/cotizacion/identidadB2B";
import { esLineaVueloManual, esTramoVueloManual, notaVueloManual } from "@/lib/cart/servicioManual";
import { formatoExacto, repartoPorPersona } from "@/lib/contrato/repartoTarifa";

// Incluye / No incluye guardado como texto (una línea por ítem) → viñetas. Mismo criterio que `lineasTexto` de la comparativa.
const lineasTextoDoc = (t?: string | null) => (t || "").split(/\r?\n|·|;/).map((x) => x.replace(/^[-•*\s]+/, "").trim()).filter(Boolean);
import { agruparCondicionesTarifaPorTexto, type CondicionTarifaAplicada } from "@/lib/calc/condicionesTarifa";

// `condiciones_tarifa` opcional (ausente = cotizaciones/contratos anteriores
// a esta ronda, o hoteles Bernalo que nunca pasan por `computarReserva`) —
// nunca se asume presente. Ver lib/calc/condicionesTarifa.ts.
type HotelConNota = ContratoHotel & {
  nota_regimen?: string | null; foto_url?: string | null;
  condiciones_tarifa?: CondicionTarifaAplicada[] | null;
};

// Agrupa condiciones IDÉNTICAS en texto (de temporadas distintas) en una
// sola línea con la lista de temporadas — nunca pierde identidad (las
// temporadas se conservan, solo se colapsa el texto repetido). Ver "puede
// mostrarse una sola condición indicando las temporadas correspondientes,
// siempre que no se pierda identidad" en el encargo de esta ronda.
// Sección sobria "Condiciones de la tarifa" — SOLO texto de
// `tarifa_hotel.notas` realmente aplicado (nunca costos/netos/comisión/
// proveedor/IDs internos). Se omite por completo si no hay condiciones. La
// temporada de cada línea solo se muestra cuando el hotel tiene condiciones
// de MÁS de una temporada (evita ruido cuando es trivialmente una sola).
function CondicionesTarifaSection({ condiciones }: { condiciones: CondicionTarifaAplicada[] }) {
  if (!condiciones.length) return null;
  const grupos = agruparCondicionesTarifaPorTexto(condiciones);
  const multiTemporada = new Set(condiciones.map((c) => c.temporada)).size > 1;
  return (
    <div className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
      <span className="font-semibold">Condiciones de la tarifa:</span>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
        {grupos.map((g, i) => (
          <li key={i}>
            {g.texto}
            {multiTemporada && <span className="text-gray-400"> ({g.temporadas.join(", ")})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Props = {
  /** #88: foto de la estancia (programa por hotel y vigencia con noches adicionales); null/ausente = otro tipo de contrato. */
  estancia?: EstanciaContratoVista | null;
  // Subconjunto sin columnas financieras: lo alimenta tanto `ventas` como
  // `ventas_basica` (ver VentaDocumento en types/database.ts).
  venta: VentaDocumento;
  pasajeros: ContratoPasajero[];
  hoteles: HotelConNota[];
  vuelos: ContratoVuelo[];
  items: ContratoItem[];
  totalPagado: number;
  /**
   * 235 (#90 F): cómo se COBRA el contrato (`cobroDeVenta`). Si se cobra en una moneda distinta de la de la oferta, el total del contrato sigue
   * siendo el de la oferta y el pago/saldo se expresan en la moneda de cobro con su total convertido y congelado. Ausente = se cobra en la moneda del contrato.
   */
  cobro?: { moneda: string; total: number; trm: number | null; convertido: boolean } | null;
  // Modo COTIZACIÓN: rotula el documento como presupuesto (sin número de
  // contrato) y muestra la vigencia. No constituye reserva en firme.
  esCotizacion?: boolean;
  codigo?: string;
  vigenciaHasta?: string | null;
  // Identidad fiscal de la agencia dueña del contrato (tabla `agencias`,
  // una fila por tenant). Si no se pasa (páginas viejas sin actualizar),
  // cae a la EMPRESA fija (mayorista) — ver abajo.
  agencia?: Agencia | null;
  // Condiciones PERMANENTES del contrato (migración 164, Commit 6), YA
  // resueltas por `lib/contrato/condicionesContrato.ts` — el MISMO resolver
  // que usa la ficha del dashboard, para que UI y PDF nunca diverjan. null/
  // undefined = no se consultó (modo cotización, o contrato sin snapshot).
  condiciones?: CondicionesContratoResueltas | null;
  // Fase 3F-4B — desglose informativo por habitación de un contrato Bernalo
  // (hoteles `modelo_tarifario = "unidad"`), YA SANITIZADO por
  // `habitacionesBernaloDeContrato` (lib/reservar/alojamientoBernaloDocumento.ts):
  // nunca trae neto/bruto/comisión/fuente ni el snapshot completo (regla
  // F.34). Vacío/ausente para cualquier contrato persona.
  habitacionesBernalo?: HabitacionBernaloDocumento[];
  // Composición pública de la tarifa Bernalo usada en cotizaciones previas:
  // líneas del motor (base/suplementos) sin netos, comisión ni snapshot.
  composicionBernalo?: ComposicionBernaloDocumento[];
  // #30 — Total exigible de un contrato B2B vendido en NETO (`precio_venta`,
  // PVP − comisión del aliado), resuelto por `netoTotalExigibleDeContrato`.
  // null/ausente = no es NETO: el documento suma los ítems como siempre.
  // Presente: total y saldo salen de aquí; los valores por ítem se prorratean
  // a NETO para este documento sin revelar las tarifas originales a PVP.
  netoTotalExigible?: number | null;
  // #75 — Incluye / No incluye de una cotización de carrito que lo trae en su snapshot (p. ej. la opción elegida de una comparativa). Ausente: no se pinta.
  incluye?: string | null;
  noIncluye?: string | null;
  /** Texto editado del ítem único «Paquete Turístico …» (cotización con servicio manual). Solo cambia la descripción; ausente = la propuesta automática. */
  tituloPaquete?: string | null;
  /** Resumen del snapshot congelado de la cotización (cobertura de cada adicional y su NETO), derivado en el servidor con `snapshotPaqueteDePayload`. Sin él no se reparte. */
  paqueteSnapshot?: SnapshotPaquete | null;
};

// Marca por tenant: mayorista mantiene los colores/logo de siempre;
// minorista tiene su propia paleta (pedido del dueño, jul-2026) — azul oscuro
// de fondo, mismo azul para los títulos de sección (el amarillo de la marca
// se probó primero pero se leía muy claro sobre el blanco de la página).
const MARCA_POR_TENANT = {
  mayorista: { primary: COLOR_DOCUMENTO, titulo: COLOR_DOCUMENTO, logo: "/marca/logo-white.png", logoEnTarjeta: false },
  minorista: { primary: COLOR_DOCUMENTO, titulo: COLOR_DOCUMENTO, logo: "/marca/logo-minorista-white.png", logoEnTarjeta: false },
} as const;

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="break-inside-avoid rounded-lg bg-gray-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="text-sm text-gray-800">{value || "—"}</span>
    </div>
  );
}

// Importe NETO con sus centavos (dos cifras cuando los hay): el total exigible puede tenerlos.
const formatoNetoDocumento = (valor: number, moneda: string): string => formatoExacto(valor, moneda);

/**
 * #75 — Tarifa NETO por persona de una línea: la parte NETO de la línea entre sus personas. Si no se divide exacto (p. ej. 1.330.455,25 entre 2) no se
 * imprime una tarifa que multiplicada no da el total: se imprime el reparto real («1 × $665.227,63» y «1 × $665.227,62»), que suma exactamente.
 */
function TarifaNetaCelda({ total, cantidad, moneda }: { total: number; cantidad: number; moneda: string }) {
  const r = repartoPorPersona(total, cantidad);
  if (!r) return <>{formatoNetoDocumento(0, moneda)}</>;
  if (r.exacto) return <>{formatoNetoDocumento(r.tarifa, moneda)}</>;
  return (
    <span className="block" data-testid="reparto-neto">
      {r.partes.map((p, i) => <span key={i} className="block whitespace-nowrap">{p.cantidad} × {formatoNetoDocumento(p.tarifa, moneda)}</span>)}
    </span>
  );
}

/** Tarifa del paquete por persona: una sola tarifa, o el reparto honesto en centavos («2 × $932.666,67 + 1 × $932.666,66»); sus productos suman EXACTAMENTE el total. */
function CeldaPartes({ partes, moneda }: { partes: ParteTarifa[]; moneda: string }) {
  if (partes.length === 1) return <>{formatoNetoDocumento(partes[0].tarifa, moneda)}</>;
  return <span className="block" data-testid="reparto-paquete">{partes.map((p, i) => <span key={i} className="block whitespace-nowrap">{p.cantidad} × {formatoNetoDocumento(p.tarifa, moneda)}</span>)}</span>;
}

function resumenMenoresHabitacion(edadesMenores: number[]) {
  const cantidad = edadesMenores.length;
  if (!cantidad) return "—";
  const edades = edadesMenores.map((edad) => `${edad} ${edad === 1 ? "año" : "años"}`).join(", ");
  const sufijo = cantidad === 1 ? "menor" : "menores";
  return `${cantidad} ${sufijo} (${edades})`;
}

function etiquetaPeriodicidad(periodicidad: ComposicionBernaloDocumento["periodicidad"]) {
  return periodicidad === "por_estadia" ? "Por estadía" : "Por noche";
}

export function ContratoDocumento({
  venta,
  pasajeros,
  hoteles,
  vuelos,
  items,
  totalPagado,
  cobro = null,
  esCotizacion = false,
  codigo,
  vigenciaHasta,
  agencia,
  condiciones,
  habitacionesBernalo = [],
  composicionBernalo = [],
  netoTotalExigible = null,
  estancia = null,
  incluye = null,
  noIncluye = null,
  tituloPaquete = null,
  paqueteSnapshot = null,
}: Props) {
  const lineasIncluye = lineasTextoDoc(incluye);
  const lineasNoIncluye = lineasTextoDoc(noIncluye);
  const moneda = (venta as { moneda?: string | null }).moneda ?? "COP";
  // Fase 3F-4B: helper ÚNICO (lib/contrato/valorContratoItem.ts) — lee
  // `valor_total` para una línea `modo_precio = "total"` (Bernalo) o la
  // fórmula per-cápita de siempre para cualquier otra fila. Sin este cambio,
  // una línea Bernalo (adultos/ninos/tarifa_adulto/tarifa_nino en su default
  // 0) se mostraba en $0.
  // #30: en NETO el total y el saldo son los del total exigible, no la suma
  // de ítems a PVP (ver lib/contrato/presentacionValores.ts).
  const { total, saldo, mostrarValoresItems } = presentacionValoresContrato({
    totalItems: totalVisibleContratoItems(items),
    totalPagado,
    netoTotalExigible,
  });
  const esNeto = !mostrarValoresItems;
  // El vuelo manual no se pinta como fila: su parte se absorbe en el paquete visible (por persona o de precio total) para que las filas sumen el total de arriba.
  const lineasVuelo = items.filter((it) => esLineaVueloManual(it.descripcion));
  const ocultosVuelo = new Set(lineasVuelo.map((it) => it.id));
  const idsPaquete = new Set(items.filter((it) => !it.descripcion?.startsWith("Servicio · ") && !esLineaVueloManual(it.descripcion)).map((it) => it.id));
  // Sin fila visible que lo absorba, valoresDoc es null: en NETO no se pinta NINGÚN importe por fila (serían PVP), solo el total exigible agregado.
  const valoresDoc = !esNeto && ocultosVuelo.size === 0 ? null : ocultosVuelo.size > 0 ? valoresNetosDocumento(items, total, ocultosVuelo, idsPaquete) : valoresNetosDocumento(items, total);
  const mostrarDesglose = mostrarValoresItems || valoresDoc !== null;
  const paxVuelos = lineasVuelo.map((it) => { const m = /· ([0-9]+) pax/.exec(it.descripcion ?? ""); return m ? Number(m[1]) : null; });
  // 235: con conversión de cobro, lo pagado y el saldo van en la moneda de cobro contra el total convertido (nunca se resta una moneda de la otra).
  const cobroConvertido = cobro?.convertido ? cobro : null;
  const monedaPago = cobroConvertido ? cobroConvertido.moneda : moneda;
  const saldoDocumento = cobroConvertido ? Math.max(cobroConvertido.total - totalPagado, 0) : saldo;
  const importeDocumento = (valor: number) => esNeto ? formatoNetoDocumento(valor, moneda) : formatMoneda(valor, moneda);
  const valorItemDocumento = (item: ContratoItem) => valoresDoc ? (valoresDoc.get(item.id)?.total ?? 0) : valorVisibleContratoItem(item);
  // Separa servicios (línea propia: Servicio · Pax · Valor total) del alojamiento.
  const servicioItems = items.filter((it) => it.descripcion?.startsWith("Servicio · "));
  // La línea suelta de un vuelo manual NO se pinta en la tabla de valores: el vuelo sale en el cuadro de vuelos y su precio ya está en el total (una sola vez).
  const alojItems = items.filter((it) => !it.descripcion?.startsWith("Servicio · ") && !esLineaVueloManual(it.descripcion));
  // El aviso de un vuelo manual ("sujeto a confirmación…") se dice UNA vez para toda la sección, no en cada tramo.
  const avisosVuelosManuales = [...new Set(vuelos.map((v) => notaVueloManual(v.servicios)?.aviso).filter((a): a is string => !!a))];
  // Cierre 3F-4B: separa las líneas agregadas (`modo_precio = "total"`,
  // Bernalo) de las per-cápita de siempre — nunca se mezclan en la misma
  // tabla (regla F.5).
  const alojItemsTotal = alojItems.filter((it) => it.modo_precio === "total");
  const alojItemsPorPersona = alojItems.filter((it) => it.modo_precio !== "total");
  const tarifaIndividual = tarifaIndividualSegura(alojItemsPorPersona, paxVuelos);
  // Cotización con servicio manual: adultos y niños se presentan en UN solo ítem «Paquete Turístico …»; los servicios adicionales siguen en su sección.
  // El vuelo y los servicios adicionales entran en las tarifas de esa fila (repartidos entre los pasajeros que cubren), no en una segunda tabla de importes.
  // Una línea de precio total que NO es de un hotel Bernalo: los servicios incluidos por grupo de un hotel normal. Esa línea no impide el ítem único (se reparte, o se muestra el total).
  const lineasGrupo = alojItemsTotal.filter(esLineaGrupoIncluido);
  const unificarPaquete = esCotizacion && alojItemsPorPersona.length > 0 && lineasGrupo.length === alojItemsTotal.length && hayServicioManual(items);
  const ventaTexto = venta as { destino?: string | null; fecha_regreso?: string | null };
  const tituloPaqueteDoc = tituloPaqueteEditado(tituloPaquete) ?? tituloPaqueteTuristico(ventaTexto.destino, venta.fecha_salida, ventaTexto.fecha_regreso);
  // Cada línea adicional se vincula con el snapshot congelado (a cuántos pasajeros cubre y, en NETO, su parte del plan B2B). Sin vínculo seguro NO se infiere nada
  // (ni de «venta.pax» ni del texto de la línea): se muestra el total agregado y se explica.
  const adLineas = unificarPaquete ? [...lineasVuelo, ...servicioItems] : [];
  const centPvp = (linea: ContratoItem) => Math.round(valorVisibleContratoItem(linea) * 100);
  const vinculos = vincularAdicionales(adLineas.map((l) => ({ descripcion: l.descripcion, centavos: centPvp(l) })), paqueteSnapshot ?? null);
  const vinculoPorId = new Map(adLineas.map((l, i) => [l.id, vinculos[i]] as const));
  const filaPaquete = unificarPaquete ? (() => {
    const adultos = alojItemsPorPersona.reduce((x, it) => x + Number(it.adultos), 0);
    const ninos = alojItemsPorPersona.reduce((x, it) => x + Number(it.ninos), 0);
    let baseAdultoCentavos = alojItemsPorPersona.reduce((x, it) => x + Math.round(Number(it.adultos) * Number(it.tarifa_adulto) * 100), 0);
    let baseNinoCentavos = alojItemsPorPersona.reduce((x, it) => x + Math.round(Number(it.ninos) * Number(it.tarifa_nino) * 100), 0);
    const nombreDe = (l: ContratoItem) => (esLineaVueloManual(l.descripcion) ? "el vuelo" : `«${l.descripcion.replace(/^Servicio · /, "").split(" · ")[0].replace(/ — sujeto a confirmación.*$/, "").split(" — ")[0]}»`);
    const adicionales = adLineas.map((l, i) => ({ nombre: nombreDe(l), centavos: centPvp(l), pax: vinculos[i]?.pax ?? null }));
    // Servicios incluidos por grupo: su importe ya está en el total; entra al reparto solo si el snapshot acredita a cuántos pasajeros cubre.
    const grupoCentavos = lineasGrupo.reduce((x, l) => x + centPvp(l), 0);
    if (lineasGrupo.length) adicionales.push({ nombre: NOMBRE_GRUPO_INCLUIDO, centavos: grupoCentavos, pax: lineasGrupo.length === 1 ? paqueteSnapshot?.grupoPax ?? null : null });
    const soloTotal = (motivo: string) => ({ ok: false as const, adultos, ninos, totalCentavos: Math.round(total * 100), motivo, neto: true });
    if (!esNeto) return { adultos, ninos, adicionales, tarifa: tarifaPaquete({ adultos, ninos, baseAdultoCentavos, baseNinoCentavos, adicionales, neto: false }) };
    // NETO: la comisión del plan B2B congelado recae solo sobre la parte comisionable de cada línea; el impuesto no comisionable queda íntegro.
    const s = paqueteSnapshot?.neto ?? null;
    const pvpItems = baseAdultoCentavos + baseNinoCentavos + adicionales.reduce((x, a) => x + a.centavos, 0);
    if (!paqueteSnapshot || !s || vinculos.some((v) => !v || v.netoCentavos === null) || s.exigibleCentavos !== Math.round(total * 100) || paqueteSnapshot.pvpCentavos !== pvpItems || s.hotelPvpCentavos !== baseAdultoCentavos + baseNinoCentavos + grupoCentavos) {
      return { adultos, ninos, adicionales, tarifa: soloTotal("falta el plan B2B congelado de esta cotización o no cuadra con su total") };
    }
    // El NETO del hotel se reparte entre adultos, niños y el servicio por grupo (líneas del mismo hotel en el plan), en proporción a su PVP.
    let netoGrupo = 0;
    [baseAdultoCentavos, baseNinoCentavos, netoGrupo] = repartirProporcional(s.hotelNetoCentavos, [baseAdultoCentavos, baseNinoCentavos, grupoCentavos]);
    const netos = adicionales.map((a, i) => ({ ...a, centavos: i < vinculos.length ? (vinculos[i]!.netoCentavos as number) : netoGrupo }));
    const tarifa = tarifaPaquete({ adultos, ninos, baseAdultoCentavos, baseNinoCentavos, adicionales: netos, neto: true });
    return { adultos, ninos, adicionales, tarifa: tarifa.totalCentavos === Math.round(total * 100) ? tarifa : soloTotal("el reparto NETO no cuadra con el total exigible") };
  })() : null;
  const anio = new Date().getFullYear();

  const tenant = ((venta as { tenant?: string | null }).tenant ?? "mayorista") === "minorista" ? "minorista" : "mayorista";
  const MARCA = MARCA_POR_TENANT[tenant];
  const PRIMARY = MARCA.primary;
  const TITULO = MARCA.titulo;
  // Identidad fiscal: la de `agencias` (tenant real) si llegó por prop; si no,
  // la constante fija de siempre (documentos viejos sin actualizar a esta prop).
  const empresa = {
    razonSocial: agencia?.razon_social ?? EMPRESA.razonSocial,
    nit: agencia?.nit ?? EMPRESA.nit,
    rnt: agencia?.rnt ?? EMPRESA.rnt,
    sitio: EMPRESA.sitio,
    correo: agencia?.correo ?? EMPRESA.correo,
    cuentaBancaria: {
      banco: agencia?.banco ?? EMPRESA.cuentaBancaria.banco,
      tipo: agencia?.tipo_cuenta ?? EMPRESA.cuentaBancaria.tipo,
      numero: agencia?.numero_cuenta ?? EMPRESA.cuentaBancaria.numero,
      titular: agencia?.razon_social ?? EMPRESA.cuentaBancaria.titular,
    },
  };

  // Segunda firma: vendedor / aliado B2B (agencia o freelance) que hizo la
  // venta — puede ser la misma persona que elaboró el contrato (asesor
  // interno), en cuyo caso las dos firmas coinciden y eso está bien.
  const tipoAsesorVenta = (venta as { tipo_asesor?: string | null }).tipo_asesor ?? null;
  const agenciaNombreVenta = (venta as { agencia_nombre?: string | null }).agencia_nombre ?? null;
  const freelanceNombreVenta = (venta as { freelance_nombre?: string | null }).freelance_nombre ?? null;
  // Quien elaboró: el nombre de firma persistido o, si el contrato solo guarda el asesor (importados, cotizaciones viejas), ese asesor. Sin ninguno: «—».
  const quienElabora = nombreQuienElabora(venta.asesor_firma_nombre, venta.asesor);
  const vendedorNombre =
    tipoAsesorVenta === "agencia"
      ? agenciaNombreVenta
      : tipoAsesorVenta === "freelance"
        ? freelanceNombreVenta
        : venta.asesor ?? venta.asesor_firma_nombre;
  const vendedorCargo =
    tipoAsesorVenta === "agencia" ? "Agencia aliada" : tipoAsesorVenta === "freelance" ? "Freelance / Aliado B2B" : "Vendedor/a";

  return (
    <div className="contrato-doc mx-auto max-w-3xl bg-white text-gray-800">
      {/* ── Encabezado ─────────────────────────────────────────── */}
      <header
        className="flex flex-col gap-3 rounded-t-xl px-5 py-5 text-white sm:flex-row sm:items-start sm:justify-between sm:gap-4 md:px-8 md:py-6"
        style={{ backgroundColor: PRIMARY }}
      >
        <div>
          {/* Logo de marca — logo y color de fondo cambian según la agencia
              (mayorista/minorista). Si el logo no viene preparado para fondo
              oscuro (`logoEnTarjeta`), se muestra dentro de una tarjeta
              blanca en vez de directo sobre el color. */}
          {MARCA.logoEnTarjeta ? (
            <div className="rounded-md bg-white px-2 py-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MARCA.logo} alt={empresa.razonSocial} className="h-10 w-auto" />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={MARCA.logo} alt={empresa.razonSocial} className="h-12 w-auto" />
          )}
        </div>
        <div className="text-center">
          <div className="text-base font-semibold">{esCotizacion ? "COTIZACIÓN" : CONTRATO_TITULO}</div>
          <div className="mt-1 text-xs opacity-90">
            {esCotizacion ? `Cotización #: ${codigo ?? "—"}` : `Contrato #: ${venta.numero_contrato}`}
          </div>
          <div className="text-xs opacity-90">
            Emisión: {formatFechaLarga(venta.fecha_emision)}
          </div>
          <div className="text-xs opacity-90">
            Viaje: {formatFechaLarga(venta.fecha_salida)}
          </div>
          {esCotizacion && vigenciaHasta && (
            <div className="text-xs opacity-90">
              Válida hasta: {formatFechaLarga(vigenciaHasta)}
            </div>
          )}
        </div>
        <div className="text-right text-xs opacity-90">
          <div>{empresa.sitio}</div>
          <div>{empresa.correo}</div>
          <div className="mt-1">RNT {empresa.rnt}</div>
        </div>
      </header>

      {/* ── Estado del contrato (pendiente / confirmado) ─────────── */}
      {(() => {
        const est = (venta.estado ?? "").toLowerCase();
        // "activo" = contrato creado por el generador manual (dashboard/contratos),
        // que nace ya confirmado (nunca pasa por "pendiente" — ver EstadoVenta.tsx).
        // Se trata igual que "confirmado" aquí y en la liquidación de comisiones.
        if (est === "confirmado" || est === "confirmada" || est === "activo") {
          return (
            <div className="border-b border-green-200 bg-green-50 px-5 py-2 text-center text-xs font-semibold text-green-700 md:px-8">
              ✓ CONTRATO CONFIRMADO — reserva aprobada y en firme.
            </div>
          );
        }
        if (est === "cancelado" || est === "cancelada") {
          return (
            <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-center text-xs font-semibold text-red-700 md:px-8">
              ✕ CONTRATO CANCELADO.
            </div>
          );
        }
        return (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-xs font-semibold text-amber-700 md:px-8">
            ⏳ COTIZACIÓN PENDIENTE — sujeta a disponibilidad y confirmación. No constituye reserva en firme hasta su confirmación.
          </div>
        );
      })()}

      <div className="space-y-7 px-5 py-6 text-sm md:px-8 md:py-7">
        {/* ── Cliente ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 break-after-avoid text-sm font-semibold" style={{ color: TITULO }}>
            Cliente
          </h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Pill label="Nombre" value={venta.cliente} />
            <Pill label="N° Documento" value={venta.cliente_documento ?? ""} />
            <Pill label="Teléfono" value={venta.cliente_telefono ?? ""} />
            <Pill label="Dirección" value={venta.cliente_direccion ?? ""} />
          </div>
        </section>

        {/* ── Titular de la reserva ────────────────────────────────
            Solo en una venta NETO asistida: el cliente comercial (arriba) es el ALIADO y la persona cuyos datos se capturaron es el titular. */}
        {venta.titular_nombre && (
          <section>
            <h2 className="mb-2 break-after-avoid text-sm font-semibold" style={{ color: TITULO }}>
              Titular de la reserva
            </h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Pill label="Nombre" value={venta.titular_nombre} />
              <Pill label="N° Documento" value={venta.titular_documento ?? ""} />
              <Pill label="Teléfono" value={venta.titular_telefono ?? ""} />
            </div>
          </section>
        )}

        {/* ── Vuelos ───────────────────────────────────────────── */}
        {vuelos.length > 0 && (
          <section>
            <h2
              className="mb-2 break-after-avoid text-sm font-semibold"
              style={{ color: TITULO }}
            >
              Vuelos
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {vuelos.map((v) => {
                // Origen/Destino: usa los campos guardados; si están vacíos, los
                // deriva de la ruta ("MDE - CTG - MDE" → origen MDE, destino CTG).
                const r = parseRuta(v.servicios);
                const manual = esTramoVueloManual(v);
                // Un vuelo manual no trae ruta en «servicios» (es una nota): su ciudad sale de sus propias columnas.
                const origen = etiquetaIata(v.origen_codigo) || (manual ? v.origen_ciudad : etiquetaIata(r.origen)) || "—";
                const destino = etiquetaIata(v.destino_codigo) || (manual ? v.destino_ciudad : etiquetaIata(r.destino)) || "—";
                const direccionLabel = v.direccion === "ida" ? "Ida" : v.direccion === "regreso" ? "Regreso" : null;
                // #47: el CONTRATO no muestra horarios ni número de vuelo (quedan guardados para la operación); la cotización sí muestra la hora local de salida.
                const mostrarHorario = esCotizacion;
                // Compat: contratos creados antes de que cada fila fuera UN tramo
                // guardaban ida+regreso mezclados en la misma fila.
                const esLegacyDoble = !v.numero_vuelo && !v.hora_salida && !!(v.vuelo_ida || v.vuelo_regreso || v.hora_salida_ida || v.hora_salida_reg);
                return (
                <div
                  key={v.id}
                  className="break-inside-avoid rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex items-center gap-2 font-semibold text-gray-700">
                    <span>✈</span> {manual ? "Vuelo sin reserva confirmada" : (v.aerolinea ?? "—")}
                    {/* El record/PNR es interno: NO se muestra al cliente. */}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    Origen: {origen}
                  </div>
                  <div className="text-xs text-gray-600">
                    Destino: {destino}
                  </div>
                  {/* Vuelo manual: la nota guardada conserva su marca interna; se muestran solo los pasajeros (el aviso va una vez, al pie de la sección). */}
                  {manual ? (
                    notaVueloManual(v.servicios)?.pax != null && (
                      <div className="mt-1 text-xs text-gray-500">Pasajeros: {notaVueloManual(v.servicios)!.pax}</div>
                    )
                  ) : v.servicios && (
                    <div className="mt-1 text-xs text-gray-500">
                      Equipaje/Servicios: {v.servicios}
                    </div>
                  )}
                  {esLegacyDoble ? (
                    <>
                      <div className="mt-1 text-xs text-gray-500">
                        Ida: {formatFechaLarga(v.fecha_salida)}
                        {mostrarHorario && v.vuelo_ida ? ` · vuelo ${v.vuelo_ida}` : ""}
                        {mostrarHorario && v.hora_salida_ida ? ` · ${v.hora_salida_ida}${v.hora_llegada_ida ? `–${v.hora_llegada_ida}` : ""}` : ""}
                      </div>
                      {(v.fecha_regreso || v.vuelo_regreso || v.hora_salida_reg) && (
                        <div className="text-xs text-gray-500">
                          Regreso: {formatFechaLarga(v.fecha_regreso)}
                          {mostrarHorario && v.vuelo_regreso ? ` · vuelo ${v.vuelo_regreso}` : ""}
                          {mostrarHorario && v.hora_salida_reg ? ` · ${v.hora_salida_reg}${v.hora_llegada_reg ? `–${v.hora_llegada_reg}` : ""}` : ""}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-1 text-xs text-gray-500">
                      {direccionLabel ? `${direccionLabel}: ` : ""}{formatFechaLarga(v.fecha_salida)}
                      {mostrarHorario && v.numero_vuelo ? ` · vuelo ${v.numero_vuelo}` : ""}
                      {mostrarHorario && v.hora_salida
                        ? (manual ? ` · salida ${v.hora_salida} (hora local)` : ` · ${v.hora_salida}${v.hora_llegada ? `–${v.hora_llegada}` : ""}`)
                        : ""}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
            {avisosVuelosManuales.length > 0 && (
              <p className="mt-2 text-xs text-gray-500" data-testid="aviso-vuelos-manuales">
                {avisosVuelosManuales.map((a) => `Vuelos sin reserva confirmada: ${a}.`).join(" ")}
              </p>
            )}
          </section>
        )}

        {/* ── Hoteles y Servicios ──────────────────────────────── */}
        <section>
          <div className="break-inside-avoid">
            <h2 className="mb-2 break-after-avoid text-sm font-semibold" style={{ color: TITULO }}>
              Hoteles y Servicios
            </h2>
            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <Pill
                label="Asistencia Médica"
                value={venta.asistencia_medica ? "Sí" : "No"}
              />
              <Pill label="Servicio / Plan" value={venta.plan_nombre ?? ""} />
              <Pill
                label="Tours y Traslados"
                value={venta.tours_traslados ?? ""}
              />
            </div>
          </div>
          {hoteles.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {hoteles.map((h) => (
                <div
                  key={h.id}
                  className="break-inside-avoid rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex items-start gap-3">
                    {h.foto_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={h.foto_url}
                        alt={h.nombre}
                        className="h-14 w-14 shrink-0 rounded-md object-cover"
                      />
                    )}
                    <div className="min-w-0">
                  <div className="font-semibold text-gray-700">
                    {h.nombre}{h.categoria ? ` · ${h.categoria}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    Ciudad: {h.ciudad ?? "—"}
                  </div>
                  <div className="text-xs text-gray-600">
                    Alimentación: {h.alimentacion ?? "—"} · Acomodación:{" "}
                    {h.acomodacion ?? "—"}
                  </div>
                  {h.detalle_acomodacion && (
                    <div className="text-xs text-gray-500">
                      {h.detalle_acomodacion}
                    </div>
                  )}
                  {h.nota_regimen && (
                    <div className="mt-1 break-inside-avoid rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
                      <span className="font-semibold">Nota especial del plan:</span> {h.nota_regimen}
                    </div>
                  )}
                  {h.condiciones_tarifa && h.condiciones_tarifa.length > 0 && (
                    <CondicionesTarifaSection condiciones={h.condiciones_tarifa} />
                  )}
                  <div className="mt-1 text-xs text-gray-500">
                    {formatFechaLarga(h.fecha_ingreso)} →{" "}
                    {formatFechaLarga(h.fecha_salida)}
                  </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {estancia && (
            <div className="mt-3">
              <EstanciaContratoBloque estancia={estancia} />
            </div>
          )}
        </section>

        {/* ── Incluye / No incluye (#75: solo si el snapshot lo trae) ── */}
        {(lineasIncluye.length > 0 || lineasNoIncluye.length > 0) && (
          <section className="break-inside-avoid" data-testid="incluye-documento">
            <h2 className="mb-2 break-after-avoid text-sm font-semibold" style={{ color: TITULO }}>Incluye / No incluye</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {lineasIncluye.length > 0 && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-1 text-xs font-semibold text-gray-700">Incluye</div>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-600">{lineasIncluye.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
              {lineasNoIncluye.length > 0 && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-1 text-xs font-semibold text-gray-500">No incluye</div>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-600">{lineasNoIncluye.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Pasajeros ────────────────────────────────────────── */}
        {pasajeros.length > 0 && (
          <section>
            <h2
              className="mb-2 break-after-avoid text-sm font-semibold"
              style={{ color: TITULO }}
            >
              Pasajeros
            </h2>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead className="break-inside-avoid break-after-avoid">
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="border border-gray-200 px-2 py-1">#</th>
                  <th className="border border-gray-200 px-2 py-1">Nombre</th>
                  <th className="border border-gray-200 px-2 py-1">Tipo ID</th>
                  <th className="border border-gray-200 px-2 py-1">
                    Identificación
                  </th>
                  <th className="border border-gray-200 px-2 py-1">
                    Nacimiento
                  </th>
                  <th className="border border-gray-200 px-2 py-1">Edad</th>
                </tr>
              </thead>
              <tbody>
                {pasajeros.map((p, i) => {
                  const edad = calcularEdad(
                    p.fecha_nacimiento,
                    venta.fecha_salida
                  );
                  return (
                    <tr key={p.id} className="break-inside-avoid">
                      <td className="border border-gray-200 px-2 py-1">
                        {i + 1}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {p.nombre}
                        {p.es_infante && (
                          <span className="ml-1 text-[10px] text-gray-400">
                            (infante)
                          </span>
                        )}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {p.tipo_id ?? "—"}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {p.identificacion ?? "—"}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {formatFechaLarga(p.fecha_nacimiento)}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {edad ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </section>
        )}

        {/* ── Valores y Pagos ──────────────────────────────────── */}
        <section>
          <div className="break-inside-avoid">
            <h2 className="mb-2 break-after-avoid text-sm font-semibold" style={{ color: TITULO }}>
              Valores y Pagos
            </h2>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="break-inside-avoid rounded-lg p-3 text-white" style={{ backgroundColor: PRIMARY }}>
                <div className="text-[10px] uppercase opacity-80">
                  Total del contrato
                </div>
                <div className="text-base font-bold">{importeDocumento(total)}</div>
              </div>
              {cobroConvertido && <Pill label="Total a cobrar" value={formatMoneda(cobroConvertido.total, cobroConvertido.moneda)} />}
              <Pill label="Total pagado" value={formatMoneda(totalPagado, monedaPago)} />
              <Pill label="Saldo pendiente" value={cobroConvertido ? formatMoneda(saldoDocumento, monedaPago) : importeDocumento(saldo)} />
              <Pill label="Moneda" value={cobroConvertido ? `${moneda} · cobro en ${cobroConvertido.moneda}` : moneda} />
            </div>
          </div>
          {/* Hallazgo confirmado (cierre 3F-4B): una línea `modo_precio =
              "total"` (Bernalo) no tiene adultos/niños/tarifa por columna —
              son 0 en la base porque esa fila nunca reparte precio por
              persona (ver lib/contrato/valorContratoItem.ts). Mostrarla en
              la tabla de siempre (Adultos 0 · Niños 0 · Tarifa $0 · Tarifa
              $0) parecía un dato real y no lo es. Se separa en una fila
              agregada limpia — el detalle por habitación va aparte, debajo
              (sección "Detalle por habitación", regla F.32-34). */}
          {alojItemsTotal.length > 0 && !filaPaquete && (
            <div className="mb-3 space-y-2">
              {alojItemsTotal.map((it) => (
                <div key={it.id} className="flex break-inside-avoid items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                  <span className="text-gray-700">{it.descripcion}</span>
                  {mostrarDesglose && (
                    <span className="font-semibold text-gray-800">{importeDocumento(valorItemDocumento(it))}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {mostrarValoresItems && composicionBernalo.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <p className="mb-1 break-after-avoid text-xs font-semibold text-gray-500">Composición tarifa Bernalo</p>
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead className="break-inside-avoid break-after-avoid">
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="border border-gray-200 px-2 py-1">Hotel</th>
                    <th className="border border-gray-200 px-2 py-1">Concepto</th>
                    <th className="border border-gray-200 px-2 py-1">Cantidad</th>
                    <th className="border border-gray-200 px-2 py-1">Valor unitario</th>
                    <th className="border border-gray-200 px-2 py-1">Cobro</th>
                    <th className="border border-gray-200 px-2 py-1">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {composicionBernalo.map((linea, idx) => (
                    <tr key={`${linea.habitacionId}-${idx}`} className="break-inside-avoid">
                      <td className="border border-gray-200 px-2 py-1">{linea.hotelNombre}</td>
                      <td className="border border-gray-200 px-2 py-1">{linea.concepto}</td>
                      <td className="border border-gray-200 px-2 py-1">{linea.cantidad}</td>
                      <td className="border border-gray-200 px-2 py-1">{formatMoneda(linea.valorUnitario, moneda)}</td>
                      <td className="border border-gray-200 px-2 py-1">{etiquetaPeriodicidad(linea.periodicidad)}</td>
                      <td className="border border-gray-200 px-2 py-1 font-medium">{formatMoneda(linea.valorTotal, moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filaPaquete && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-xs">
                <thead className="break-inside-avoid break-after-avoid">
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="border border-gray-200 px-2 py-1">Ítem</th>
                    <th className="border border-gray-200 px-2 py-1">Adultos</th>
                    <th className="border border-gray-200 px-2 py-1">Niños</th>
                    <th className="border border-gray-200 px-2 py-1">Tarifa Adulto{esNeto ? " NETO" : ""}</th>
                    <th className="border border-gray-200 px-2 py-1">Tarifa Niño{esNeto ? " NETO" : ""}</th>
                    <th className="border border-gray-200 px-2 py-1">Valor total{esNeto ? " NETO" : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="break-inside-avoid" data-testid="fila-paquete-turistico">
                    <td className="border border-gray-200 px-2 py-1">{tituloPaqueteDoc}</td>
                    <td className="border border-gray-200 px-2 py-1">{filaPaquete.adultos}</td>
                    <td className="border border-gray-200 px-2 py-1">{filaPaquete.ninos}</td>
                    <td className="border border-gray-200 px-2 py-1">
                      {filaPaquete.tarifa.ok ? (filaPaquete.adultos > 0 ? <CeldaPartes partes={filaPaquete.tarifa.tarifaAdulto} moneda={moneda} /> : formatoNetoDocumento(0, moneda)) : "—"}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {filaPaquete.tarifa.ok ? (filaPaquete.ninos > 0 ? <CeldaPartes partes={filaPaquete.tarifa.tarifaNino} moneda={moneda} /> : formatoNetoDocumento(0, moneda)) : "—"}
                    </td>
                    <td className="border border-gray-200 px-2 py-1 font-medium" data-testid="valor-total-paquete">{formatoNetoDocumento(filaPaquete.tarifa.totalCentavos / 100, moneda)}</td>
                  </tr>
                </tbody>
              </table>
              {filaPaquete.adicionales.length > 0 && (
                <p className="mt-1 text-[11px] text-gray-500" data-testid="nota-paquete">
                  {filaPaquete.tarifa.ok
                    ? "Las tarifas por pasajero incluyen el alojamiento, los vuelos y los servicios adicionales del paquete."
                    : `No se muestra la tarifa por pasajero: ${filaPaquete.tarifa.motivo}. El valor total incluye alojamiento, vuelos y servicios adicionales.`}
                </p>
              )}
            </div>
          )}

          {alojItemsPorPersona.length > 0 && !filaPaquete && (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead className="break-inside-avoid break-after-avoid">
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="border border-gray-200 px-2 py-1">Ítem</th>
                  <th className="border border-gray-200 px-2 py-1">Adultos</th>
                  <th className="border border-gray-200 px-2 py-1">Niños</th>
                  {mostrarDesglose && (
                    <>
                      <th className="border border-gray-200 px-2 py-1">
                        Tarifa Adulto{esNeto ? " NETO" : ""}
                      </th>
                      <th className="border border-gray-200 px-2 py-1">
                        Tarifa Niño{esNeto ? " NETO" : ""}
                      </th>
                      <th className="border border-gray-200 px-2 py-1">
                        Valor total{esNeto ? " NETO" : ""}
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {alojItemsPorPersona.map((it) => (
                  <tr key={it.id} className="break-inside-avoid">
                    <td className="border border-gray-200 px-2 py-1">
                      {it.descripcion}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {it.adultos}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {it.ninos}
                    </td>
                    {mostrarDesglose && (
                      <>
                        <td className="border border-gray-200 px-2 py-1">
                          {!tarifaIndividual ? "—" : valoresDoc
                            ? <TarifaNetaCelda total={valoresDoc.get(it.id)?.adultoTotal ?? 0} cantidad={Number(it.adultos)} moneda={moneda} />
                            : formatMoneda(it.tarifa_adulto, moneda)}
                        </td>
                        <td className="border border-gray-200 px-2 py-1">
                          {!tarifaIndividual ? "—" : valoresDoc
                            ? <TarifaNetaCelda total={valoresDoc.get(it.id)?.ninoTotal ?? 0} cantidad={Number(it.ninos)} moneda={moneda} />
                            : formatMoneda(it.tarifa_nino, moneda)}
                        </td>
                        <td className="border border-gray-200 px-2 py-1 font-medium">
                          {importeDocumento(valorItemDocumento(it))}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {habitacionesBernalo.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              {/* Regla F.32/33/34: SOLO desglose informativo (hotel,
                  categoría, alimentación, adultos, edades) — nunca se
                  reparte el PVP/vuelo/servicios/comisión entre habitaciones,
                  y nunca se muestra un dato del snapshot privado. */}
              <p className="mb-1 break-after-avoid text-xs font-semibold text-gray-500">Detalle por habitación</p>
              <table className="w-full min-w-[420px] border-collapse text-xs">
                <thead className="break-inside-avoid break-after-avoid">
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="border border-gray-200 px-2 py-1">Hotel</th>
                    <th className="border border-gray-200 px-2 py-1">Categoría</th>
                    <th className="border border-gray-200 px-2 py-1">Alimentación</th>
                    <th className="border border-gray-200 px-2 py-1">Adultos</th>
                    <th className="border border-gray-200 px-2 py-1">Menores</th>
                  </tr>
                </thead>
                <tbody>
                  {habitacionesBernalo.map((h) => (
                    <tr key={h.habitacionId} className="break-inside-avoid">
                      <td className="border border-gray-200 px-2 py-1">{h.hotelNombre}</td>
                      <td className="border border-gray-200 px-2 py-1">{h.categoria ?? "—"}</td>
                      <td className="border border-gray-200 px-2 py-1">{h.alimentacion ?? "—"}</td>
                      <td className="border border-gray-200 px-2 py-1">{h.adultos}</td>
                      <td className="border border-gray-200 px-2 py-1">
                        {resumenMenoresHabitacion(h.edadesMenores)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {servicioItems.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <p className="mb-1 break-after-avoid text-xs font-semibold text-gray-500">Servicios adicionales</p>
              <table className="w-full min-w-[360px] border-collapse text-xs">
                <thead className="break-inside-avoid break-after-avoid">
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="border border-gray-200 px-2 py-1">Servicio</th>
                    <th className="border border-gray-200 px-2 py-1">Pax</th>
                    {mostrarDesglose && !filaPaquete && <th className="border border-gray-200 px-2 py-1">Valor total{esNeto ? " NETO" : ""}</th>}
                  </tr>
                </thead>
                <tbody>
                  {servicioItems.map((it) => (
                    <tr key={it.id} className="break-inside-avoid">
                      <td className="border border-gray-200 px-2 py-1">
                        {it.descripcion.replace(/^Servicio · /, "")}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">{filaPaquete ? vinculoPorId.get(it.id)?.pax ?? "—" : venta.pax ?? "—"}</td>
                      {mostrarDesglose && !filaPaquete && (
                        <td className="border border-gray-200 px-2 py-1 font-medium">
                          {importeDocumento(valorItemDocumento(it))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Condiciones de pago y restricciones ───────────────── */}
        {/* Sección construida por `condiciones` (mismo resolver que la ficha
            del dashboard). Si no hay snapshot (contrato histórico o modo
            cotización) no se renderiza NADA: no se inventa una cláusula de
            restricción que la fuente de verdad no dice. Nunca se muestra una
            etiqueta global tipo "100% no reembolsable" si solo ALGUNOS
            componentes están restringidos — cada componente lleva su propio
            aviso, y el resumen agregado siempre va acompañado del desglose. */}
        {condiciones?.hayCondiciones && condiciones.filas.length > 0 && (
          <section>
            <h2 className="mb-2 break-after-avoid text-sm font-semibold" style={{ color: TITULO }}>
              Condiciones de pago
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-xs">
                <thead className="break-inside-avoid break-after-avoid">
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="border border-gray-200 px-2 py-1">Componente</th>
                    <th className="border border-gray-200 px-2 py-1">Condición</th>
                    <th className="border border-gray-200 px-2 py-1">Pago mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {condiciones.filas.map((l) => (
                    <tr key={l.key} className="break-inside-avoid last:break-before-avoid">
                      <td className="border border-gray-200 px-2 py-1">
                        {l.referencia ?? l.nombreComponente}
                        <div className="text-[10px] text-gray-400">{l.nombreComponente}</div>
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {l.condicionTexto}
                        {l.condicionDetalle && <div className="text-[10px] text-gray-400">{l.condicionDetalle}</div>}
                        {l.fechaLimite && (
                          <div className="text-[10px] text-gray-400">Saldo antes del {formatFechaLarga(l.fechaLimite)}</div>
                        )}
                      </td>
                      <td className="border border-gray-200 px-2 py-1 font-medium">
                        {formatMoneda(l.exigido, l.moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {condiciones.resumen && (
              <p className="mt-2 break-inside-avoid text-[11px] font-semibold text-gray-700">{condiciones.resumen.texto}</p>
            )}
            {/* Restricciones: SOLO se enumeran los componentes que de verdad
                están restringidos EN LA PRESENTACIÓN (tras overrides). Ningún
                texto de restricción aparece si `restringidas` está vacío. */}
            {condiciones.restringidas.length > 0 && (
              <div className="mt-2 space-y-1">
                {condiciones.restringidas.map((l) => (
                  <p key={l.key} className="break-inside-avoid rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
                    <span className="font-semibold">{l.referencia ?? l.nombreComponente}:</span> {l.restriccionTexto}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Cláusulas ────────────────────────────────────────── */}
        <section>
          <div className="break-inside-avoid">
            <h2 className="mb-3 break-after-avoid text-center text-sm font-bold uppercase tracking-wide text-gray-700">
              {CONTRATO_TITULO}
            </h2>
            <p className="mb-4 break-inside-avoid text-justify text-xs leading-relaxed text-gray-600">
              {CONTRATO_INTRO}
            </p>
          </div>
          <div className="space-y-3">
            {CLAUSULAS.map((c) => (
              <div key={c.numero} className="break-inside-avoid">
                <h3 className="text-xs font-semibold text-gray-700">
                  {c.numero}. {c.titulo}
                </h3>
                {c.parrafos.map((p, i) => (
                  <p
                    key={i}
                    className="mt-1 text-justify text-[11px] leading-relaxed text-gray-600"
                  >
                    {p}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ── Constancia + Firma ───────────────────────────────── */}
        <section className="break-inside-avoid pt-2 text-xs text-gray-600">
          <p>
            {CONSTANCIA_PREFIJO} {formatFechaLarga(venta.fecha_emision)}.
          </p>
          <div className="mt-8 flex flex-wrap gap-8">
            <div className="w-64 border-t border-gray-400 pt-1">
              <div className="font-semibold text-gray-800">
                {quienElabora ?? "—"}
              </div>
              <div>
                {FIRMA_ETIQUETAS.cargo} {venta.asesor_firma_cargo ?? "Elaboró el contrato"}
              </div>
              {venta.asesor_firma_cc && (
                <div>
                  {FIRMA_ETIQUETAS.cc} {venta.asesor_firma_cc}
                </div>
              )}
              {venta.asesor_firma_tel && (
                <div>
                  {FIRMA_ETIQUETAS.tel} {venta.asesor_firma_tel}
                </div>
              )}
            </div>
            {/* Vendedor / aliado B2B — puede coincidir con quien elaboró el
                contrato (misma persona, ambas firmas iguales). */}
            <div className="w-64 border-t border-gray-400 pt-1">
              <div className="font-semibold text-gray-800">
                {vendedorNombre ?? "—"}
              </div>
              <div>
                {FIRMA_ETIQUETAS.cargo} {vendedorCargo}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-lg bg-gray-50 p-3 text-[11px]">
            <div className="font-semibold text-gray-700">Datos de pago</div>
            <div>
              {empresa.cuentaBancaria.banco} — {empresa.cuentaBancaria.tipo}{" "}
              {empresa.cuentaBancaria.numero}
            </div>
            <div>A nombre de {empresa.cuentaBancaria.titular}</div>
            <div className="mt-1">
              {empresa.razonSocial} · NIT {empresa.nit} · RNT {empresa.rnt}
            </div>
          </div>

          <p className="mt-6 text-center text-[10px] text-gray-400">
            {COPYRIGHT_PREFIJO} {anio} · Documento digital — se solicita no
            imprimir.
          </p>
          <p className="mt-0.5 text-center text-[9px] text-gray-300">
            {POWERED_BY}
          </p>
        </section>
      </div>
    </div>
  );
}
