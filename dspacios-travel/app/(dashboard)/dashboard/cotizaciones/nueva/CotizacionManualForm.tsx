"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OpcionesTipoDoc } from "@/components/personas/OpcionesTipoDoc";
import { BuscarTitular } from "@/components/personas/BuscarTitular";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { fuenteNombreCotizacion, entradasFuente, etiquetasCatalogo, hotelPorId, prefillFilaCotizacion, prefillHotelManual, restriccionesHotel, seleccionarCatalogo, vinculoDeTexto, vinculoProveedor, type CatalogoCotizacion } from "@/lib/catalogo/prefillManual";
import { Plane, Hotel, Car, HeartPulse, Plus, Trash2, GitCompareArrows, type LucideIcon } from "lucide-react";
import { ComboDestino, type DestinoOpt } from "@/components/ComboDestino";
import { ACOM_ROOMS, ACOM_ROOM_LABEL } from "@/lib/acomodaciones";
import { errorOrdenFechas } from "@/lib/reglas/duracionViaje";
import { evaluarHotel, hotelDbDeCatalogo, type HotelDb } from "@/lib/catalogo/evaluarHoteles";
import { contarEntero, errorInfantesSinAdulto, hotelesDeDestino, normalizarHabitaciones, textoHabitaciones, ETIQUETA_COMPRA } from "@/lib/catalogo/validacionManual";
import { crearCotizacionManual, crearComparativaManual, type ServicioManual } from "../manual-actions";
import { ACOMODACION_UNICA, OPCIONES_REF, MAX_OPCIONES, nombrePaqueteItem, type OpcionRef } from "@/lib/cotizacion/comparativa";
import { PresentacionComparativaEditor, errorEdicion, presentacionDesdeEdicion, type EdicionPresentacion, type OpcionEditable } from "@/components/cotizacion/PresentacionComparativaEditor";
import { sugerirIncluye, NO_INCLUYE_DEFAULT } from "@/lib/cotizacion/incluye";
import { hoyBogota, vigenciaInicial } from "@/lib/cotizacion/vigencia";
import { acuerdoComision, participacionAliado, validarBnc } from "@/lib/cotizacion/acuerdoComision";
import { pctComisionNeto, vistaNetoManual } from "@/lib/cotizacion/netoManual";
import { aUnidades, puedeFijarNeto } from "@/lib/cotizacion/netoHija";

type Asesor = { nombre: string | null; email: string };
type Aliado = { id: number; nombre: string; tipo: string | null; pct_comision?: number | null };
/** #48: lo que la vista previa del precio NETO necesita del servidor (la base decide al guardar). */
type DatosNeto = { rol: string | null; pctAgencia: number | null; pctFreelance: number | null; reglaParticipacion: boolean };

const TIPOS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "aereo", label: "Aéreo", icon: Plane },
  { value: "hotel", label: "Hotel", icon: Hotel },
  { value: "traslado", label: "Traslado", icon: Car },
  { value: "asistencia", label: "Asistencia médica", icon: HeartPulse },
  { value: "otro", label: "Otro", icon: Plus },
];

type Fila = ServicioManual & { _id: number; opcionRef?: OpcionRef | null };
let _seq = 1;

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const hoy = hoyBogota();
/** Sin datos del servidor no hay opción NETO (el formulario se comporta como siempre). */
const SIN_NETO: DatosNeto = { rol: null, pctAgencia: null, pctFreelance: null, reglaParticipacion: false };

function valor(f: { costoNeto: number; modo: "mk" | "ta"; pctMarkup: number; ta: number }): number {
  const c = Number(f.costoNeto) || 0;
  if (f.modo === "ta") return Math.round(Math.max(0, c) + (Number(f.ta) || 0));
  const m = (Number(f.pctMarkup) || 0) / 100;
  if (c <= 0 || m >= 1) return 0;
  return Math.round(c / (1 - m));
}

const SIN_CATALOGO: CatalogoCotizacion = { hoteles: [], servicios: [], aerolineas: [], proveedores: [] };

export function CotizacionManualForm({ asesores, aliados, miNombre, miRolVenta, pctAliadoB2B, neto = SIN_NETO, catalogo = SIN_CATALOGO, destinos = [] }: {
  asesores: Asesor[]; aliados: Aliado[]; miNombre: string; miRolVenta: boolean; pctAliadoB2B: number; neto?: DatosNeto;
  /** B95-13: destinos del catálogo del dueño (el destino se ELIGE de esta lista; ya no se escribe). */
  destinos?: DestinoOpt[];
  /** #95: catálogo para precargar nombre y proveedor (editables; sin precios). */
  catalogo?: CatalogoCotizacion;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  // Cliente / cabecera
  const [cli, setCli] = useState({ nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "", nacimiento: "" });
  // B95-13: el destino se elige del catálogo (id); su nombre es el que se guarda. Los hoteles del catálogo se ofrecen SOLO para ese destino.
  const [destinoId, setDestinoId] = useState<number | "">("");
  const destino = destinos.find((d) => d.id === destinoId)?.nombre ?? "";
  const [avisoDestino, setAvisoDestino] = useState("");
  const [fechaIda, setFechaIda] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [pax, setPax] = useState("1");
  const [numNinos, setNumNinos] = useState("0");
  // B95-15: infantes explícitos (no ocupan silla ni plaza de adulto; sin tarifa propia en esta cotización).
  const [numInfantes, setNumInfantes] = useState("0");
  const [tarifaNino, setTarifaNino] = useState("0");
  // #33 (B95-6): en una comparativa cada hotel cobra SU tarifa de niño (0 = gratis); vacío = sin indicar.
  const [tarifaNinoOpc, setTarifaNinoOpc] = useState<Record<string, string>>({});
  const [moneda, setMoneda] = useState("COP");
  // Recobro: mayor valor cobrado (oculto al cliente). Distribución según canal.
  const [recobro, setRecobro] = useState("0");
  const [recobroAliado, setRecobroAliado] = useState("0");
  // #97: participación del aliado en el recobro por VALOR o por PORCENTAJE (el importe final es lo que cuenta), y BNC explícita (vacío ≠ 0).
  const [modoPart, setModoPart] = useState<"valor" | "pct">("valor");
  const [pctPart, setPctPart] = useState("");
  const [bnc, setBnc] = useState("");
  const [plazo, setPlazo] = useState("");
  const [vigencia, setVigencia] = useState(vigenciaInicial(hoy, null, 3));
  const [observaciones, setObservaciones] = useState("");
  const [incluye, setIncluye] = useState("");
  const [noIncluye, setNoIncluye] = useState("");

  // Canal
  const [tipoAsesor, setTipoAsesor] = useState<"interno" | "agencia" | "freelance">("interno");
  const [asesorInterno, setAsesorInterno] = useState(miRolVenta ? miNombre : "");
  const [aliadoNombre, setAliadoNombre] = useState("");

  // #48: modalidad del precio de una dinámica B2B. NETO = el aliado paga PVP menos su comisión (sello #50); solo roles que pueden fijarlo.
  const [modalidad, setModalidad] = useState<"pvp" | "neto">("pvp");
  const [reconoce, setReconoce] = useState(true);
  const [autorizarMargen, setAutorizarMargen] = useState(false);

  // Modo explícito «Cotización comparativa» (#35). Apagado por defecto: el flujo simple no cambia.
  const [comparativa, setComparativa] = useState(false);

  // Markup general + servicios
  const [markupGeneral, setMarkupGeneral] = useState("20");
  const [filas, setFilas] = useState<Fila[]>([]);

  // El modo TA solo aplica al aéreo (igual que en el servidor).
  const efModo = (f: Fila): "mk" | "ta" => (f.tipo === "aereo" && f.modo === "ta" ? "ta" : "mk");
  const totalServicios = useMemo(() => filas.reduce((s, f) => s + valor({ ...f, modo: efModo(f) }), 0), [filas]);
  const fmt = (n: number) => formatMoneda(n, moneda);

  const nNinos = Math.max(Number(numNinos) || 0, 0);
  const valorNino = Math.max(Number(tarifaNino) || 0, 0);
  const totalNinos = nNinos * valorNino;
  const recobroN = Math.max(Number(recobro) || 0, 0);
  const totalCotizacion = totalServicios + totalNinos + recobroN;

  // Comparativa: lo común (aéreo, traslados, asistencia, otros) se cuenta UNA vez en cada hotel.
  // NUNCA se suma un hotel con otro: cada opción tiene su propio total.
  const comunes = filas.filter((f) => f.tipo !== "hotel").reduce((s, f) => s + valor({ ...f, modo: efModo(f) }), 0);
  const opcionesUsadas = OPCIONES_REF.filter((r) => filas.some((f) => f.tipo === "hotel" && f.opcionRef === r));
  const hotelSinOpcion = filas.some((f) => f.tipo === "hotel" && !f.opcionRef);
  const totalOpcion = (r: OpcionRef) =>
    comunes + filas.filter((f) => f.tipo === "hotel" && f.opcionRef === r).reduce((s, f) => s + valor({ ...f, modo: efModo(f) }), 0);

  // #75: Incluye / No incluye y descripción del ítem POR OPCIÓN (la propuesta sale de los servicios comunes + el hotel de esa opción).
  const [edicionPres, setEdicionPres] = useState<EdicionPresentacion>({});
  const opcionesEditables: OpcionEditable[] = opcionesUsadas.map((r) => {
    const deLaOpcion = filas.filter((f) => f.tipo !== "hotel" || f.opcionRef === r);
    const hotel = filas.find((f) => f.tipo === "hotel" && f.opcionRef === r)?.nombre || `Hotel ${r}`;
    return {
      clave: `${r}/${ACOMODACION_UNICA}`, titulo: `Opción ${r} · ${hotel}`,
      lineas: [{ indice: 0, descripcion: nombrePaqueteItem(destino, fechaIda, fechaRegreso) }],
      incluyeSugerido: incluye.trim() || sugerirIncluye(deLaOpcion.map((f) => ({ tipo: f.tipo, nombre: f.nombre }))),
      noIncluyeSugerido: noIncluye.trim(),
    };
  });

  const esB2B = tipoAsesor !== "interno";
  const recobroAliadoN = !esB2B ? 0
    : participacionAliado(recobroN, modoPart === "pct" ? { modo: "pct", pct: (Number(pctPart) || 0) / 100 } : { modo: "valor", valor: Number(recobroAliado) || 0 });
  // En modo porcentaje el importe se redondea a la unidad: se avisa para que nunca se ajuste en silencio.
  const brutoPct = esB2B && modoPart === "pct" ? recobroN * ((Number(pctPart) || 0) / 100) : null;
  const pctRedondeado = brutoPct != null && Math.abs(brutoPct - recobroAliadoN) > 1e-6;
  // Base comisionable (vista previa, sin %): total − BNC − (recobro completo solo si el aliado recibe algo de él).
  const bncValida = validarBnc(bnc, totalCotizacion);
  const baseComisionable = esB2B && bncValida.ok
    ? acuerdoComision({ total: totalCotizacion, bnc: bncValida.bnc, recobroTotal: recobroN, participacion: recobroAliadoN, pct: 0 }).base
    : null;
  const recobroEmpresaN = recobroN - recobroAliadoN;

  // Cliente final = 100% empresa. Al pasar a B2B, sugiere el % de la config.
  useEffect(() => {
    if (!esB2B) { setRecobroAliado("0"); return; }
    setRecobroAliado((prev) => (Number(prev) > 0 ? prev : String(Math.round(recobroN * pctAliadoB2B))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoAsesor]);

  // B95-13/15/20: catálogo de hoteles del DESTINO elegido, reglas de ocupación y validación en línea (la misma que repite el servidor).
  const catalogoDestino = useMemo<CatalogoCotizacion>(() => ({ ...catalogo, hoteles: hotelesDeDestino(catalogo.hoteles, destinoId === "" ? null : destinoId) }), [catalogo, destinoId]);
  const dbHoteles = useMemo(() => new Map<number, HotelDb>(catalogo.hoteles.map((h) => [h.id, hotelDbDeCatalogo(h)])), [catalogo.hoteles]);
  const adultosN = contarEntero(pax), ninosN = contarEntero(numNinos), infantesN = contarEntero(numInfantes);
  const errConteos = adultosN == null || ninosN == null || infantesN == null ? "Adultos, niños e infantes deben ser números enteros (0 o más)." : errorInfantesSinAdulto(adultosN, infantesN);
  const errFechas = errorOrdenFechas(fechaIda, fechaRegreso);
  /** Evaluación de una fila de hotel con contenido (las vacías no se validan: el armado las descarta). */
  const evaluarFila = (f: Fila) => {
    if (f.tipo !== "hotel" || !((Number(f.costoNeto) || 0) > 0 || f.nombre.trim() || f.plataforma.trim())) return null;
    return evaluarHotel({ nombre: f.nombre, catalogoId: seleccionarCatalogo(entradasFuente(fuenteNombreCotizacion(f.tipo, catalogoDestino)), f.nombre, f.catalogoId ?? null).id, compra: f.compra, plataforma: f.plataforma, proveedor: f.proveedor, habitaciones: f.habitaciones },
      { destinoId: destinoId === "" ? null : destinoId, ocupacion: { adultos: adultosN ?? 0, ninos: ninosN ?? 0, infantes: infantesN ?? 0 }, db: dbHoteles });
  };
  const erroresHoteles = filas.flatMap((f) => evaluarFila(f)?.errores ?? []);
  const erroresFormulario = [...(destinoId === "" ? ["Elige el destino de la lista del catálogo."] : []), ...(errFechas ? [errFechas] : []), ...(errConteos ? [errConteos] : []), ...erroresHoteles];
  const bloqueado = erroresFormulario.length > 0;

  function elegirDestino(id: number | "") {
    setDestinoId(id);
    // Un hotel del catálogo que ya no corresponde al destino NO se queda en silencio: se quita su vínculo y su copia, y se avisa cuál fue.
    // Mientras se escribe en el buscador el id pasa por «» un instante: eso NO es elegir otro destino y no toca los hoteles (sin destino, el formulario ya queda bloqueado).
    const obsoletos = id === "" ? [] : filas.filter((f) => f.tipo === "hotel" && f.catalogoId != null && hotelPorId(catalogo.hoteles, f.catalogoId)?.destinoId !== id);
    if (id !== "" || obsoletos.length) setAvisoDestino(obsoletos.length ? `Se quitó el hotel ${obsoletos.map((f) => `«${f.nombre}»`).join(", ")}: no pertenece al destino elegido. Elige otro hotel del destino o escríbelo como hotel manual.` : "");
    if (obsoletos.length) setFilas((fs) => fs.map((x) => (obsoletos.some((o) => o._id === x._id) ? { ...x, catalogoId: null, nombre: "", categoria: "", regimen: "", proveedor: "" } : x)));
  }

  function agregar(tipo: string) {
    setFilas((f) => [...f, { _id: _seq++, tipo, plataforma: "", nombre: "", proveedor: "", costoNeto: 0, modo: "mk", pctMarkup: Number(markupGeneral) || 0, ta: 0 }]);
  }
  // #95: al escribir/elegir el nombre se precarga el proveedor del catálogo si estaba vacío. Ambos campos siguen siendo texto editable de ESTA cotización.
  // B95-3: la elección real se identifica por ID (con homónimos se elige la opción etiquetada); al elegir un hotel también se precargan, SOLO en campos vacíos, su categoría, régimen y acomodación
  // cuando tiene una única opción (con varias quedan como sugerencias). Los tres campos se guardan en la cotización; editarlos no toca el catálogo y nunca se copia precio ni vigencia.
  function setNombre(id: number, nombre: string) {
    setFilas((fs) => fs.map((x) => {
      if (x._id !== id) return x;
      const fuente = fuenteNombreCotizacion(x.tipo, catalogoDestino);
      const sel = seleccionarCatalogo(entradasFuente(fuente), nombre, x.catalogoId ?? null);
      const nueva = sel.id !== (x.catalogoId ?? null);
      let patch: Partial<Fila> = {};
      if (nueva && x.tipo === "hotel") {
        const p = prefillHotelManual({ nombre: sel.texto, categoria: x.categoria ?? "", proveedor: x.proveedor, alimentacion: x.regimen ?? "", acomodacion: x.acomodacion ?? "" }, hotelPorId(catalogo.hoteles, sel.id));
        patch = { ...(p.proveedor ? { proveedor: p.proveedor } : {}), ...(p.categoria ? { categoria: p.categoria } : {}), ...(p.alimentacion ? { regimen: p.alimentacion } : {}), ...(p.acomodacion ? { acomodacion: p.acomodacion } : {}) };
      } else if (nueva) patch = prefillFilaCotizacion(fuente, sel.id, x.proveedor);
      return { ...x, nombre: sel.texto, catalogoId: sel.id, ...patch };
    }));
  }
  // El id viaja solo si el texto SIGUE siendo esa elección (editar la copia la vuelve texto libre).
  const datosCatalogo = (f: Fila) => ({
    catalogoId: idEfectivo(f),
    ...(f.tipo === "hotel" ? { categoria: (f.categoria ?? "").trim(), regimen: (f.regimen ?? "").trim(), acomodacion: textoHabitaciones(f.habitaciones), habitaciones: normalizarHabitaciones(f.habitaciones), compra: f.compra, detalleAcomodacion: (f.detalleAcomodacion ?? "").trim() } : {}),
  });
  const idEfectivo = (f: Fila) => seleccionarCatalogo(entradasFuente(fuenteNombreCotizacion(f.tipo, catalogoDestino)), f.nombre, f.catalogoId ?? null).id;
  function set(id: number, k: keyof ServicioManual, v: string | number) {
    setFilas((f) => f.map((x) => (x._id === id ? { ...x, [k]: v } : x)));
  }
  function setHab(id: number, a: (typeof ACOM_ROOMS)[number], v: string) {
    setFilas((fs) => fs.map((x) => (x._id === id ? { ...x, habitaciones: { ...x.habitaciones, [a]: Math.max(0, Math.trunc(Number(v) || 0)) } } : x)));
  }
  function setCompra(id: number, v: string) {
    setFilas((fs) => fs.map((x) => (x._id === id ? { ...x, compra: v === "directa" || v === "plataforma" ? v : undefined } : x)));
  }
  function quitar(id: number) {
    setFilas((f) => f.filter((x) => x._id !== id));
  }

  function guardar() {
    setErr("");
    if (!`${cli.nombres}${cli.apellidos}`.trim()) { setErr("El nombre del cliente es obligatorio."); return; }
    if (!filas.length) { setErr("Agrega al menos un servicio."); return; }
    if (erroresFormulario.length) { setErr(erroresFormulario[0]); return; }
    if (comparativa) {
      if (hotelSinOpcion) { setErr("Asigna cada hotel a una opción (A, B o C)."); return; }
      if (opcionesUsadas.length < 2) { setErr("Una comparativa necesita al menos dos hoteles en opciones distintas."); return; }
      if (tipoAsesor !== "interno" && aliadoId == null) { setErr("Elige el aliado del catálogo (no se admite texto libre en una comparativa)."); return; }
      if (nNinos > 0) {
        const falta = opcionesUsadas.find((r) => !Number.isFinite(Number(tarifaNinoOpc[r])) || (tarifaNinoOpc[r] ?? "").trim() === "" || Number(tarifaNinoOpc[r]) < 0);
        if (falta) { setErr(`Indica la tarifa de niño de la Opción ${falta} (0 si es gratis): cada hotel cobra la suya.`); return; }
      }
      const errPres = errorEdicion(opcionesEditables, edicionPres);
      if (errPres) { setErr(errPres); return; }
      const presentacion = presentacionDesdeEdicion(opcionesEditables, edicionPres);
      start(async () => {
        const r = await crearComparativaManual({
          cliente: cli, destino, destinoId: destinoId === "" ? null : destinoId, fechaIda, fechaRegreso, pax: Number(pax) || 0, moneda,
          ninos: nNinos, infantes: Number(numInfantes) || 0, tarifaNino: 0, recobro: recobroN, recobroAliado: recobroAliadoN, tipoAsesor,
          tarifaNinoPorOpcion: nNinos > 0 ? Object.fromEntries(opcionesUsadas.map((r) => [r, Math.max(Number(tarifaNinoOpc[r]) || 0, 0)])) : undefined,
          asesorInterno: tipoAsesor === "interno" ? asesorInterno : "",
          agenciaNombre: tipoAsesor === "agencia" ? aliadoNombre : "",
          freelanceNombre: tipoAsesor === "freelance" ? aliadoNombre : "",
          aliadoId: tipoAsesor === "interno" ? null : aliadoId,
          plazo, vigenciaHasta: vigencia, observaciones, incluye, noIncluye, presentacion,
          servicios: filas.map((f) => ({
            tipo: f.tipo, plataforma: f.plataforma, nombre: f.nombre, proveedor: f.proveedor, costoNeto: Number(f.costoNeto) || 0, modo: f.modo, pctMarkup: Number(f.pctMarkup) || 0, ta: Number(f.ta) || 0,
            ...datosCatalogo(f),
            opcionRef: f.tipo === "hotel" ? (f.opcionRef ?? null) : null,
          })),
        });
        if (r.ok) router.push(`/dashboard/cotizaciones/${r.id}`);
        else setErr(r.error);
      });
      return;
    }
    // #97: dinámica B2B → aliado del catálogo (id) y BNC escrita expresamente. El servidor lo vuelve a exigir.
    if (tipoAsesor !== "interno") {
      if (aliadoId == null) { setErr("Elige la agencia o el freelance del catálogo de la lista (no se admite texto libre)."); return; }
      if (usaNeto) { if (vistaNeto?.v.bloqueo) { setErr(vistaNeto.v.bloqueo); return; } }
      else if (!bncValida.ok) { setErr(bncValida.error); return; }
    }
    start(async () => {
      const r = await crearCotizacionManual({
        cliente: cli, destino, destinoId: destinoId === "" ? null : destinoId, fechaIda, fechaRegreso, pax: Number(pax) || 0, moneda,
        ninos: nNinos, infantes: Number(numInfantes) || 0, tarifaNino: valorNino,
        recobro: recobroN, recobroAliado: recobroAliadoN,
        aliadoId: tipoAsesor === "interno" ? null : aliadoId,
        bnc: tipoAsesor !== "interno" && !usaNeto && bncValida.ok ? bncValida.bnc : null,
        modalidad: usaNeto ? { modalidad: "neto", reconoceRecobro: recobroAliadoN > 0 && reconoce, autorizarMargen } : undefined,
        tipoAsesor,
        asesorInterno: tipoAsesor === "interno" ? asesorInterno : "",
        agenciaNombre: tipoAsesor === "agencia" ? aliadoNombre : "",
        freelanceNombre: tipoAsesor === "freelance" ? aliadoNombre : "",
        plazo, vigenciaHasta: vigencia, observaciones, incluye, noIncluye,
        servicios: filas.map((f) => ({ tipo: f.tipo, plataforma: f.plataforma, nombre: f.nombre, proveedor: f.proveedor, costoNeto: Number(f.costoNeto) || 0, modo: f.modo, pctMarkup: Number(f.pctMarkup) || 0, ta: Number(f.ta) || 0, ...datosCatalogo(f) })),
      });
      if (r.ok) router.push(`/dashboard/cotizaciones/${r.id}`);
      else setErr(r.error);
    });
  }

  const aliadosFiltrados0 = aliados.filter((a) => tipoAsesor === "agencia" ? (a.tipo ?? "").toLowerCase().includes("agencia") : tipoAsesor === "freelance" ? (a.tipo ?? "").toLowerCase().includes("free") : true);
  const aliadosFiltrados = aliadosFiltrados0;
  // El aliado de una comparativa sale del catálogo por id; el texto libre no cuenta.
  const aliadoSel = aliadosFiltrados.find((a) => a.nombre === aliadoNombre) ?? null;
  const aliadoId = aliadoSel?.id ?? null;

  // #48: vista previa del NETO (mismas reglas que la base; la base vuelve a decidir con el rol real al guardar).
  const puedeNeto = esB2B && !comparativa && puedeFijarNeto(neto.rol);
  const usaNeto = puedeNeto && modalidad === "neto";
  const vistaNeto = useMemo(() => {
    if (!usaNeto || aliadoSel == null) return null;
    const pct = pctComisionNeto(aliadoSel.pct_comision ?? null, tipoAsesor === "agencia" ? neto.pctAgencia : neto.pctFreelance, tipoAsesor === "agencia" ? "agencia" : "freelance");
    return {
      pct,
      v: vistaNetoManual({
        servicios: filas.map((f) => ({ tipo: f.tipo, valor: valor({ ...f, modo: efModo(f) }), costoNeto: Number(f.costoNeto) || 0 })),
        total: totalCotizacion, recobro: recobroN, ninos: nNinos, tarifaNino: valorNino, recobroAliado: recobroAliadoN, reconoce,
        pct, reglaParticipacion: neto.reglaParticipacion, rol: neto.rol, autorizarMargen,
      }),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usaNeto, aliadoSel, tipoAsesor, filas, totalCotizacion, recobroN, nNinos, valorNino, recobroAliadoN, reconoce, autorizarMargen, neto]);

  return (
    <div className="space-y-6">
      {/* Cliente */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Cliente</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="col-span-2 md:col-span-3">
            <label className={lbl}>Número de documento</label>
            <div className="flex gap-1">
              <Input value={cli.numeroDoc} onChange={(e) => setCli({ ...cli, numeroDoc: e.target.value })} />
              <BuscarTitular numero={cli.numeroDoc} actual={cli} onAplicar={({ tipoDoc, ...d }) => setCli((p) => ({ ...p, tipoDoc, ...d }))} />
            </div>
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className={lbl}>Tipo de documento</label>
            <select value={cli.tipoDoc} onChange={(e) => setCli({ ...cli, tipoDoc: e.target.value })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">Elige el tipo…</option>
              <OpcionesTipoDoc />
            </select>
          </div>
          <div><label className={lbl}>Nombres</label><Input value={cli.nombres} onChange={(e) => setCli({ ...cli, nombres: e.target.value })} /></div>
          <div><label className={lbl}>Apellidos</label><Input value={cli.apellidos} onChange={(e) => setCli({ ...cli, apellidos: e.target.value })} /></div>
          <div><label className={lbl}>Fecha de nacimiento</label><DateInput aria-label="Fecha de nacimiento" type="date" value={cli.nacimiento} onValueChange={(dateValue) => setCli({ ...cli, nacimiento: dateValue })} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={cli.telefono} onChange={(e) => setCli({ ...cli, telefono: e.target.value })} /></div>
          <div><label className={lbl}>Email</label><Input value={cli.email} onChange={(e) => setCli({ ...cli, email: e.target.value })} /></div>
        </div>
        <p className="mt-2 text-xs text-gray-400">Para generar el contrato se exige nombre, tipo y número de documento y fecha de nacimiento del titular.</p>
      </section>

      {/* Datos del viaje */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Datos del viaje</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2 md:col-span-2" data-testid="campo-destino">
            <label className={lbl}>Destino (del catálogo)</label>
            <ComboDestino destinos={destinos} value={destinoId} onChange={elegirDestino} placeholder="Elige el destino…" />
            {destinos.length === 0 && <p className="mt-1 text-[11px] text-red-600" role="alert">No hay destinos en el catálogo: pide que se carguen en Producto → Destinos.</p>}
            {avisoDestino && <p className="mt-1 text-[11px] text-amber-700" role="status" data-testid="aviso-destino">{avisoDestino}</p>}
          </div>
          <div><label className={lbl}>Fecha ida</label><DateInput aria-label="Fecha ida" type="date" value={fechaIda} min={hoy} onValueChange={(dateValue) => { const v = dateValue; setFechaIda(v); if (v && vigencia > v) setVigencia(v); }} /></div>
          <div>
            <label className={lbl}>Fecha regreso</label>
            <DateInput aria-label="Fecha regreso" type="date" value={fechaRegreso} min={fechaIda || hoy} onValueChange={(dateValue) => setFechaRegreso(dateValue)} />
            {errFechas && <p className="mt-1 text-[11px] text-red-600" role="alert" data-testid="error-fechas">{errFechas}</p>}
          </div>
          <div><label className={lbl}>Adultos</label><Input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
          <div><label className={lbl}>Niños</label><Input type="number" min={0} value={numNinos} onChange={(e) => setNumNinos(e.target.value)} /></div>
          <div title="Los infantes no ocupan silla ni plaza de adulto y no suman tarifa en esta cotización.">
            <label className={lbl}>Infantes</label>
            <Input aria-label="Infantes" type="number" min={0} value={numInfantes} onChange={(e) => setNumInfantes(e.target.value)} />
          </div>
          {Number(numNinos) > 0 && !comparativa && (
            <div><label className={lbl}>Tarifa por niño</label><Input type="number" min={0} value={tarifaNino} onChange={(e) => setTarifaNino(e.target.value)} /></div>
          )}
          <div>
            <label className={lbl}>Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {["COP", "USD"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Plazo de pago</label><Input value={plazo} onChange={(e) => setPlazo(e.target.value)} placeholder="Inmediato / 7 días…" /></div>
          <div><label className={lbl}>Vigencia hasta</label><DateInput aria-label="Vigencia hasta" type="date" value={vigencia} min={hoy} max={fechaIda || undefined} onValueChange={(dateValue) => setVigencia(dateValue)} /></div>
        </div>

        {/* Canal */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl}>Tipo de venta</label>
            <div className="flex gap-1">
              {(["interno", "agencia", "freelance"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTipoAsesor(t)}
                  className="flex-1 rounded-lg border px-3 py-2 text-xs font-medium capitalize transition-colors"
                  style={tipoAsesor === t ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tipoAsesor === "interno" ? (
            <div>
              <label className={lbl}>Asesor</label>
              <select value={asesorInterno} onChange={(e) => setAsesorInterno(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona</option>
                {asesores.map((a) => <option key={a.email} value={a.nombre ?? a.email}>{a.nombre ?? a.email}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className={lbl}>{tipoAsesor === "agencia" ? "Agencia" : "Freelance"}</label>
              <input list="aliados-list" value={aliadoNombre} onChange={(e) => setAliadoNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="Nombre" />
              <datalist id="proveedores-cot">{catalogo.proveedores.map((p) => <option key={p} value={p} />)}</datalist>
              <datalist id="aliados-list">{aliadosFiltrados.map((a) => <option key={a.id} value={a.nombre} />)}</datalist>
            </div>
          )}
        </div>
      </section>

      {/* Servicios */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Servicios</h2>
          <button type="button" onClick={() => setComparativa((v) => !v)} aria-pressed={comparativa}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={comparativa ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
            <GitCompareArrows size={14} /> Cotización comparativa
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Markup general
            <Input type="number" min={0} className="h-8 w-20" value={markupGeneral} onChange={(e) => setMarkupGeneral(e.target.value)} />%
          </label>
        </div>
        {comparativa && (
          <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Compara hasta {MAX_OPCIONES} hoteles del mismo viaje y moneda. El aéreo (uno o varios tramos), los traslados y los demás
            servicios son <b>comunes</b> y se cuentan una sola vez en el total de cada hotel. Asigna cada hotel a una opción (A, B o C).
            El cliente elige <b>un</b> hotel: los hoteles no se suman entre sí.
          </p>
        )}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TIPOS.map((t) => (
            <button key={t.value} type="button" onClick={() => agregar(t.value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)]">
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {filas.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">Agrega servicios con los botones de arriba.</p>
        ) : (
          <div className="space-y-3">
            {filas.map((f) => {
              const esAereo = f.tipo === "aereo";
              const v = valor({ ...f, modo: efModo(f) });
              const modoTa = esAereo && f.modo === "ta";
              return (
                <div key={f._id} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <select value={f.tipo} onChange={(e) => set(f._id, "tipo", e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold">
                      {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {esAereo && (
                      <div className="flex overflow-hidden rounded-md border border-gray-300 text-[11px] font-medium">
                        {(["mk", "ta"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => set(f._id, "modo", m)}
                            className="px-2.5 py-1 transition-colors"
                            style={f.modo === m ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}>
                            {m === "mk" ? "Markup" : "TA (fijo)"}
                          </button>
                        ))}
                      </div>
                    )}
                    {comparativa && (f.tipo === "hotel" ? (
                      <select aria-label="Opción de la comparativa" value={f.opcionRef ?? ""}
                        onChange={(e) => setFilas((fs) => fs.map((x) => (x._id === f._id ? { ...x, opcionRef: (e.target.value || null) as OpcionRef | null } : x)))}
                        className="rounded-md border px-2 py-1 text-xs font-semibold" style={f.opcionRef ? { borderColor: "var(--brand-primary)" } : { borderColor: "#f59e0b" }}>
                        <option value="">Opción…</option>
                        {OPCIONES_REF.map((r) => <option key={r} value={r}>Opción {r}</option>)}
                      </select>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Común a todas las opciones</span>
                    ))}
                    <button type="button" onClick={() => quitar(f._id)} className="ml-auto text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {(f.tipo !== "hotel" || f.compra === "plataforma") && (
                      <div><label className={lbl}>Plataforma{f.tipo === "hotel" ? " (proveedor a pagar)" : ""}</label><Input value={f.plataforma} onChange={(e) => set(f._id, "plataforma", e.target.value)} placeholder="Despegar, JetSMART…" /></div>
                    )}
                    {(() => {
                      const fuente = fuenteNombreCotizacion(f.tipo, catalogoDestino);
                      const entradas = entradasFuente(fuente);
                      const ev = evaluarFila(f);
                      const sel = seleccionarCatalogo(entradas, f.nombre, f.catalogoId ?? null);
                      // Aéreo: aerolíneas por nombre (sin id ni restricciones). El resto: elección real por id.
                      const vn = f.tipo === "aereo" ? vinculoDeTexto(fuente, f.nombre) : sel.estado === "catalogo" ? "catalogo" : sel.estado === "vacio" ? "vacio" : "libre";
                      const etiquetas = etiquetasCatalogo(entradas);
                      const vp = vinculoProveedor(catalogo.proveedores, f.proveedor);
                      const hotel = f.tipo === "hotel" ? hotelPorId(catalogo.hoteles, sel.id) : null;
                      const rest = restriccionesHotel(hotel);
                      const conMenores = !!hotel?.adultsOnly && (Number(numNinos) || 0) > 0;
                      return (
                        <>
                          <div><label className={lbl}>Nombre del servicio</label><Input list={`nombres-cot-${f._id}`} value={f.nombre} onChange={(e) => setNombre(f._id, e.target.value)} /><datalist id={`nombres-cot-${f._id}`}>{fuente.map((x) => <option key={`${x.id ?? "n"}-${x.nombre}`} value={x.id != null ? (etiquetas.get(x.id) ?? x.nombre) : x.nombre} />)}</datalist></div>
                          {f.tipo === "hotel" && (
                            <div>
                              <label className={lbl}>Cómo se compra</label>
                              <select aria-label="Origen de la compra" value={f.compra ?? ""} onChange={(e) => setCompra(f._id, e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                                <option value="">Elige…</option>
                                <option value="directa">{ETIQUETA_COMPRA.directa}</option>
                                <option value="plataforma">{ETIQUETA_COMPRA.plataforma}</option>
                              </select>
                            </div>
                          )}
                          {f.tipo === "hotel" && f.compra === "plataforma" ? (
                            <div><label className={lbl}>Proveedor a pagar</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" data-testid="proveedor-plataforma">{f.plataforma.trim() || "— (escribe la plataforma)"}</div></div>
                          ) : (
                            <div><label className={lbl}>{f.tipo === "hotel" ? "Proveedor del hotel (compra directa)" : "Proveedor"}</label><Input list="proveedores-cot" value={f.proveedor} onChange={(e) => set(f._id, "proveedor", e.target.value)} /></div>
                          )}
                          {f.tipo === "hotel" && (
                            <>
                              <div><label className={lbl}>Categoría de habitación</label><Input list={`cot-cat-${f._id}`} value={f.categoria ?? ""} onChange={(e) => set(f._id, "categoria", e.target.value)} /></div>
                              <div><label className={lbl}>Régimen / alimentación</label><Input list={`cot-reg-${f._id}`} value={f.regimen ?? ""} onChange={(e) => set(f._id, "regimen", e.target.value)} /></div>
                              <div className="col-span-2 md:col-span-3" data-testid="habitaciones-hotel">
                                <label className={lbl}>Habitaciones (cantidad por tipo)</label>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                  {ACOM_ROOMS.filter((a) => !(hotel?.reglasAcom?.length) || hotel.reglasAcom.some((r) => r.acomodacion === a)).map((a) => (
                                    <label key={a} className="text-[11px] text-gray-500">{ACOM_ROOM_LABEL[a]}
                                      <Input type="number" min={0} aria-label={`Habitaciones ${ACOM_ROOM_LABEL[a]}`} value={f.habitaciones?.[a] ? f.habitaciones[a] : ""} onChange={(e) => setHab(f._id, a, e.target.value)} />
                                    </label>
                                  ))}
                                </div>
                                <Input className="mt-1" aria-label="Detalle de la acomodación (opcional)" placeholder="Detalle opcional (vista al mar, cama adicional…)" value={f.detalleAcomodacion ?? ""} onChange={(e) => set(f._id, "detalleAcomodacion", e.target.value)} />
                              </div>
                              {hotel && (
                                <>
                                  <datalist id={`cot-cat-${f._id}`}>{hotel.categorias.map((c) => <option key={c} value={c} />)}</datalist>
                                  <datalist id={`cot-reg-${f._id}`}>{hotel.regimenes.map((c) => <option key={c} value={c} />)}</datalist>
                                </>
                              )}
                            </>
                          )}
                          {(vn !== "vacio" || vp !== "vacio" || rest.length > 0 || sel.estado === "ambiguo") && (
                            <div className="col-span-2 flex flex-wrap items-center gap-1.5 text-[11px] md:col-span-3" data-testid="vinculo-cotizacion">
                              {sel.estado === "ambiguo" && f.tipo !== "aereo" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700" role="status">Hay varios con este nombre: elige uno de la lista (se distinguen por destino/categoría y #id)</span>}
                              {vn !== "vacio" && !(sel.estado === "ambiguo" && f.tipo !== "aereo") && <span className={`rounded-full px-2 py-0.5 ${vn === "catalogo" ? "bg-green-50 text-green-700" : "bg-gray-200 text-gray-600"}`}>{vn === "catalogo" ? "Del catálogo" : f.tipo === "hotel" ? "Hotel manual (no está en el catálogo)" : "Texto libre"}</span>}
                              {vp !== "vacio" && <span className={`rounded-full px-2 py-0.5 ${vp === "catalogo" ? "bg-green-50 text-green-700" : "bg-gray-200 text-gray-600"}`}>{vp === "catalogo" ? "Proveedor del catálogo" : "Proveedor en texto libre"}</span>}
                              {rest.map((r) => <span key={r} className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{r}</span>)}
                              {conMenores && <span className="font-medium text-red-600" role="alert">Este hotel es solo para adultos y la cotización lleva niños.</span>}
                            </div>
                          )}
                          {f.tipo === "hotel" && destinoId === "" && <p className="col-span-2 text-[11px] text-gray-500 md:col-span-3">Elige primero el destino para ver los hoteles del catálogo; también puedes escribir un hotel manual.</p>}
                          {ev && (ev.errores.length > 0 || ev.aviso) && (
                            <div className="col-span-2 space-y-0.5 text-[11px] md:col-span-3" data-testid="errores-hotel">
                              {ev.errores.map((m) => <p key={m} className="font-medium text-red-600" role="alert">{m}</p>)}
                              {ev.aviso && <p className="text-amber-700" role="status">{ev.aviso}</p>}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div><label className={lbl}>Costo neto</label><Input type="number" min={0} value={f.costoNeto || ""} onChange={(e) => set(f._id, "costoNeto", Number(e.target.value))} /></div>
                    {modoTa ? (
                      <div><label className={lbl}>TA (valor fijo)</label><Input type="number" min={0} value={f.ta || ""} onChange={(e) => set(f._id, "ta", Number(e.target.value))} /></div>
                    ) : (
                      <div><label className={lbl}>Markup %</label><Input type="number" min={0} value={f.pctMarkup} onChange={(e) => set(f._id, "pctMarkup", Number(e.target.value))} /></div>
                    )}
                    <div>
                      <label className={lbl}>Valor</label>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(v)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-medium text-gray-600">Subtotal servicios</span>
          <span className="text-lg font-semibold tabular-nums text-gray-700">{fmt(totalServicios)}</span>
        </div>
      </section>

      {/* Recobro (oculto al cliente) */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Recobro</h2>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">No se muestra al cliente</span>
        </div>
        <p className="mb-3 text-xs text-gray-400">Mayor valor que entra al total pero no corresponde a un servicio. Va oculto dentro de la tarifa.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Valor del recobro</label><Input type="number" min={0} value={recobro} onChange={(e) => setRecobro(e.target.value)} /></div>
          {esB2B ? (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className={lbl}>Para el aliado (free/agencia)</label>
                  <button type="button" onClick={() => setRecobroAliado(String(Math.round(recobroN * pctAliadoB2B)))}
                    className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Sugerir {Math.round(pctAliadoB2B * 100)}%</button>
                </div>
                <div className="mb-1 flex gap-3 text-[11px] text-gray-600">
                  <label className="flex items-center gap-1"><input type="radio" name="modoPart" checked={modoPart === "valor"} onChange={() => setModoPart("valor")} /> Valor</label>
                  <label className="flex items-center gap-1"><input type="radio" name="modoPart" checked={modoPart === "pct"} onChange={() => setModoPart("pct")} /> Porcentaje</label>
                </div>
                {modoPart === "valor" ? (
                  <Input type="number" min={0} max={recobroN} value={recobroAliado} onChange={(e) => setRecobroAliado(e.target.value)} />
                ) : (
                  <Input type="number" min={0} max={100} step="any" placeholder="% del recobro" value={pctPart} onChange={(e) => setPctPart(e.target.value)} />
                )}
                <p className="mt-1 text-[11px] text-gray-500">Importe final al aliado: <b>{fmt(recobroAliadoN)}</b>{recobroAliadoN > 0 ? " (el recobro completo sale de la base de su comisión)" : " (sin participación: el recobro permanece en la base)"}
                  {pctRedondeado && brutoPct != null && <span className="block text-amber-700">El porcentaje equivale a {brutoPct.toFixed(2)} y se redondea a {fmt(recobroAliadoN)}.</span>}</p>
              </div>
              <div>
                <label className={lbl}>Para la empresa</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums text-gray-700">{fmt(recobroEmpresaN)}</div>
              </div>
            </>
          ) : (
            <div className="md:col-span-2 flex items-end">
              <p className="text-xs text-gray-500">Cliente final → recobro <b>100% para la empresa</b>.</p>
            </div>
          )}
        </div>
      </section>

      {/* #97: acuerdo de comisión del aliado (solo dinámica B2B; la comparativa sigue su propio flujo) */}
      {esB2B && !comparativa && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-700">Comisión del aliado</h2>
          {puedeNeto && (
            <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-700" role="radiogroup" aria-label="Modalidad del precio">
              <label className="flex items-center gap-1.5"><input type="radio" name="modalidad" checked={modalidad === "pvp"} onChange={() => setModalidad("pvp")} /> PVP: el aliado cobra su comisión después</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="modalidad" checked={modalidad === "neto"} onChange={() => setModalidad("neto")} /> NETO: el aliado paga el PVP menos su comisión</label>
            </div>
          )}
          {usaNeto ? (
            <div className="space-y-3" data-testid="neto-manual">
              <p className="text-xs text-gray-400">
                El cliente final ve siempre el PVP. El aliado paga el NETO y no se crea una segunda comisión: la participación en el recobro va dentro del descuento. La base de datos fija estos valores al guardar.
              </p>
              {aliadoSel == null || vistaNeto == null ? (
                <p className="text-sm text-gray-500">Elige el aliado del catálogo para calcular el NETO.</p>
              ) : (
                <>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <FilaNeto k="Total (PVP)" v={fmt(aUnidades(vistaNeto.v.resultado.precio))} />
                    <FilaNeto k="Tiquetes aéreos (no comisionan)" v={fmt(aUnidades(vistaNeto.v.resultado.tiquetes))} />
                    <FilaNeto k="Base comisionable" v={fmt(aUnidades(vistaNeto.v.resultado.base))} />
                    <FilaNeto k={`Comisión ordinaria (${(vistaNeto.pct * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} %)`} v={fmt(aUnidades(vistaNeto.v.resultado.ordinaria))} />
                    <FilaNeto k="Participación en el recobro" v={fmt(aUnidades(vistaNeto.v.resultado.participacion))} />
                    <FilaNeto k="Descuento total al aliado" v={fmt(vistaNeto.v.descuento)} />
                    <FilaNeto k="Costo total de los servicios" v={fmt(vistaNeto.v.costos)} />
                    <FilaNeto k={`Margen sobre el NETO (mínimo ${vistaNeto.v.evaluacion.pisoBps / 100} %)`} v={`${(vistaNeto.v.evaluacion.margen * 100).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`} />
                  </dl>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.06)" }}>
                    <span className="text-sm font-semibold text-gray-700">NETO que paga el aliado</span>
                    <span className="text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(vistaNeto.v.neto)}</span>
                  </div>
                  {recobroAliadoN > 0 && (
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="mt-1" checked={reconoce} onChange={(e) => setReconoce(e.target.checked)} />
                      <span>Reconocer la participación del aliado en el recobro ({fmt(recobroAliadoN)}); sin marcar, el recobro queda en la base de su comisión y no se le paga aparte.</span>
                    </label>
                  )}
                  {vistaNeto.v.requiereAutorizacion && (
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="mt-1" checked={autorizarMargen} onChange={(e) => setAutorizarMargen(e.target.checked)} />
                      <span>Autorizo guardar con un margen por debajo del mínimo (solo superadmin o administración; solo tiquetes: solo superadmin).</span>
                    </label>
                  )}
                  {vistaNeto.v.bloqueo
                    ? <p className="text-sm text-red-600" role="alert">{vistaNeto.v.bloqueo}</p>
                    : <p className="text-xs text-emerald-700">Cumple las reglas de margen: se puede guardar en NETO.</p>}
                </>
              )}
            </div>
          ) : (
          <>
          <p className="mb-3 text-xs text-gray-400">
            El aliado se toma del catálogo y su porcentaje queda fijado al guardar (no se edita aquí). Indica la base no comisionable: escribe 0 si no hay.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className={lbl}>Base no comisionable (BNC) *</label>
              <Input type="number" min={0} placeholder="0 si no hay" value={bnc} onChange={(e) => setBnc(e.target.value)} />
              {!bncValida.ok && bnc !== "" && <p className="mt-1 text-[11px] text-red-600">{bncValida.error}</p>}
            </div>
            <div>
              <label className={lbl}>Base comisionable</label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums text-gray-700">
                {baseComisionable == null ? "—" : fmt(baseComisionable)}
              </div>
            </div>
            <div className="text-xs text-gray-500">
              Aliado: <b>{aliadoId == null ? "elige uno de la lista" : aliadoNombre}</b>
            </div>
          </div>
          </>
          )}
        </section>
      )}

      {/* Total por opción (comparativa): sin total global */}
      {comparativa && (
        <section className="rounded-xl border p-5" style={{ borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.04)" }}>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Total por opción</h2>
          {opcionesUsadas.length === 0 ? (
            <p className="text-xs text-gray-400">Asigna al menos dos hoteles a una opción para ver el total de cada una.</p>
          ) : (
            <div className="space-y-2">
              {opcionesUsadas.map((r) => {
                const nombreHotel = filas.find((f) => f.tipo === "hotel" && f.opcionRef === r)?.nombre || `Hotel ${r}`;
                const tarifaN = Math.max(Number(tarifaNinoOpc[r]) || 0, 0);
                const total = totalOpcion(r) + nNinos * tarifaN + recobroN;
                return (
                  <div key={r} className="rounded-lg bg-white px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">Opción {r} · {nombreHotel}</span>
                      <span className="text-lg font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(total)}</span>
                    </div>
                    {nNinos > 0 && (
                      <label className="mt-1.5 flex items-center justify-between gap-3 text-xs text-gray-500">
                        <span>Tarifa por niño en este hotel (0 si es gratis) · {nNinos} {nNinos === 1 ? "niño" : "niños"}</span>
                        <Input aria-label={`Tarifa por niño de la Opción ${r}`} type="number" min={0} className="w-36" value={tarifaNinoOpc[r] ?? ""} placeholder="Obligatorio"
                          onChange={(e) => setTarifaNinoOpc((prev) => ({ ...prev, [r]: e.target.value }))} />
                      </label>
                    )}
                  </div>
                );
              })}
              <p className="text-[11px] text-gray-400">Cada total incluye los servicios comunes una sola vez{nNinos > 0 ? ", los niños a la tarifa de cada hotel" : ""}{recobroN > 0 ? " y el recobro (oculto)" : ""}. No hay un total global: se elige un hotel.</p>
            </div>
          )}
        </section>
      )}

      {/* Total cotización */}
      {!comparativa && (
      <section className="rounded-xl border p-5" style={{ borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.04)" }}>
        <div className="space-y-1 text-sm text-gray-600">
          <div className="flex items-center justify-between"><span>Servicios (adultos)</span><span className="tabular-nums">{fmt(totalServicios)}</span></div>
          {nNinos > 0 && <div className="flex items-center justify-between"><span>Niños ({nNinos} × {fmt(valorNino)})</span><span className="tabular-nums">{fmt(totalNinos)}</span></div>}
          {recobroN > 0 && <div className="flex items-center justify-between text-gray-400"><span>Recobro (oculto)</span><span className="tabular-nums">{fmt(recobroN)}</span></div>}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
          <span className="text-sm font-semibold text-gray-700">Total cotización</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(totalCotizacion)}</span>
        </div>
      </section>
      )}

      {/* Comparativa: Incluye / No incluye y descripción POR OPCIÓN (lo común se ve una vez en el documento si queda igual en todas) */}
      {comparativa && opcionesEditables.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Presentación de cada opción</h2>
            <p className="text-xs text-gray-400">Propuesta desde los servicios de cada opción. Edítala antes de generar.</p>
          </div>
          <PresentacionComparativaEditor opciones={opcionesEditables} edicion={edicionPres} onChange={setEdicionPres} />
          <button type="button" onClick={() => setNoIncluye(NO_INCLUYE_DEFAULT)} className="mt-2 text-[11px] font-medium text-[#1D7C9A] hover:underline">
            Proponer «No incluye» sugerido en todas las opciones
          </button>
        </section>
      )}

      {/* Incluye / No incluye */}
      {!comparativa && (
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Incluye / No incluye</h2>
          <p className="text-xs text-gray-400">Aparece en la cotización para que el cliente sepa qué cubre. Editable.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={lbl}>Incluye</label>
              <button type="button" onClick={() => setIncluye(sugerirIncluye(filas.map((f) => ({ tipo: f.tipo, nombre: f.nombre }))))}
                className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Generar desde servicios</button>
            </div>
            <textarea value={incluye} onChange={(e) => setIncluye(e.target.value)} rows={5} placeholder="Una línea por ítem…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={lbl}>No incluye</label>
              <button type="button" onClick={() => setNoIncluye(NO_INCLUYE_DEFAULT)}
                className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Usar texto sugerido</button>
            </div>
            <textarea value={noIncluye} onChange={(e) => setNoIncluye(e.target.value)} rows={5} placeholder="Una línea por ítem…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
          </div>
        </div>
      </section>
      )}

      <div>
        <label className={lbl}>Observaciones</label>
        <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {bloqueado && filas.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-600" role="alert" data-testid="bloqueo-formulario">
          {erroresFormulario.slice(0, 4).map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={guardar} disabled={pending || bloqueado} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : comparativa ? "Generar comparativa" : "Generar cotización"}
        </Button>
        <span className="text-xs text-gray-400">{comparativa ? "Se guarda como comparativa: no se cobra ni se convierte hasta elegir una opción." : "Se guarda como cotización (estado abierta)."}</span>
      </div>
    </div>
  );
}

function FilaNeto({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 py-1">
      <dt className="text-gray-600">{k}</dt>
      <dd className="tabular-nums font-medium text-gray-900">{v}</dd>
    </div>
  );
}
