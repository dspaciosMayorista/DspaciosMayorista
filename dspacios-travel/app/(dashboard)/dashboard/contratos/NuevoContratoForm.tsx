"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { ComboCiudad } from "@/components/ComboCiudad";
import type { DestinoOpt } from "@/components/ComboDestino";
import { ciudadIata } from "@/lib/iata";
import {
  crearContrato,
  type PasajeroInput,
  type HotelInput,
  type VueloInput,
  type ItemInput,
  type ServicioInput,
  type TipoServicio,
  type TipoPaquete,
} from "./actions";

const TIPOS_SERVICIO: { value: TipoServicio; label: string }[] = [
  { value: "asistencia", label: "Asistencia médica" },
  { value: "traslado", label: "Traslado" },
  { value: "tour", label: "Tour" },
  { value: "otro", label: "Otro" },
];

const hoy = new Date().toISOString().slice(0, 10);

export type PaqueteOpt = {
  id: number;
  categoria: "bloqueo" | "porcion_terrestre";
  nombre: string;
  plan_alimentacion: string | null;
  impuesto_no_comisionable: number;
  paquete_hoteles: { nombre: string; ciudad: string | null; alimentacion: string | null; acomodacion_detalle: string | null }[];
  paquete_precios: { acomodacion: string; precio: number }[];
};
export type BloqueoOpt = { id: number; record: string; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null; aerolinea: string | null };

const TIPOS: { value: TipoPaquete; label: string }[] = [
  { value: "bloqueo", label: "Bloqueo (negociado + vuelo)" },
  { value: "porcion_terrestre", label: "Porción terrestre negociada" },
  { value: "empaquetado", label: "Empaquetado (tiquetes por sistema)" },
  { value: "dinamico", label: "Dinámico (todo manual)" },
];

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const sectionCls = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";
const titleCls = "text-sm font-semibold";

type Opt = { id: number; nombre: string };

export function NuevoContratoForm({
  asesorDefault,
  paquetes = [],
  bloqueos = [],
  vendedores = [],
  agencias = [],
  freelances = [],
  destinos = [],
  hotelesCatalogo = [],
  proveedoresCatalogo = [],
  aerolineasCatalogo = [],
  puedeForzarMargen = false,
}: {
  asesorDefault: string;
  paquetes?: PaqueteOpt[];
  bloqueos?: BloqueoOpt[];
  vendedores?: { nombre: string }[];
  agencias?: Opt[];
  freelances?: Opt[];
  destinos?: DestinoOpt[];
  // Catálogo de hoteles ya negociados (mayorista) + su proveedor, para
  // autocompletar en el hotel del contrato manual/dinámico sin perder la
  // opción de escribirlo libre si no está (mismo criterio que `destinos`).
  hotelesCatalogo?: { nombre: string; proveedor: string | null }[];
  proveedoresCatalogo?: string[];
  // Catálogo de aerolíneas (configurado en mayorista, `/dashboard/producto/
  // aerolineas`) con sus tipos de tarifa/equipaje — cada una trae su propia
  // lista, así que se resuelve por nombre de aerolínea al elegirla.
  aerolineasCatalogo?: { nombre: string; tarifas: { nombre: string; descripcion: string }[] }[];
  puedeForzarMargen?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [advertenciaMargen, setAdvertenciaMargen] = useState("");

  // Tipo de paquete y producto negociado
  const [tipoPaquete, setTipoPaquete] = useState<TipoPaquete>("dinamico");
  const [paqueteId, setPaqueteId] = useState<number | "">("");
  const [bloqueoId, setBloqueoId] = useState<number | "">("");
  const esNegociado = tipoPaquete === "bloqueo" || tipoPaquete === "porcion_terrestre";
  const paquetesFiltrados = paquetes.filter((p) => p.categoria === tipoPaquete);

  // Moneda: solo empaquetado/dinámico (todo manual) pueden venderse en USD.
  const [moneda, setMoneda] = useState<"COP" | "USD">("COP");
  const monedaEfectiva = esNegociado ? "COP" : moneda;
  const fmt = (n: number) => formatMoneda(n, monedaEfectiva);

  // Cliente
  const [clienteNombres, setClienteNombres] = useState("");
  const [clienteApellidos, setClienteApellidos] = useState("");
  const cliente = `${clienteNombres} ${clienteApellidos}`.trim();
  const [doc, setDoc] = useState("");
  const [tel, setTel] = useState("");
  const [dir, setDir] = useState("");

  // Generales
  const [destino, setDestino] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [fechaEmision, setFechaEmision] = useState(hoy);
  const [planNombre, setPlanNombre] = useState("");
  const [tours, setTours] = useState("");
  const [asistencia, setAsistencia] = useState(false);

  // Firma
  const [asesorNombre, setAsesorNombre] = useState(asesorDefault);
  const [asesorCargo, setAsesorCargo] = useState("Asesor/a");
  const [asesorCc, setAsesorCc] = useState("");
  const [asesorTel, setAsesorTel] = useState("");

  // Listas dinámicas
  const [pasajeros, setPasajeros] = useState<PasajeroInput[]>([
    { nombres: "", apellidos: "", tipoId: "CC", identificacion: "", fechaNacimiento: "", esInfante: false },
  ]);
  const [hoteles, setHoteles] = useState<HotelInput[]>([]);
  const [vuelos, setVuelos] = useState<VueloInput[]>([]);
  const [servicios, setServicios] = useState<ServicioInput[]>([]);
  const [items, setItems] = useState<ItemInput[]>([
    { descripcion: "Plan turístico", adultos: 1, ninos: 0, tarifaAdulto: 0, tarifaNino: 0 },
  ]);

  // Canal / asesor (todo contrato: asesor interno; B2B además agencia o freelance)
  const [tipoVenta, setTipoVenta] = useState<"interno" | "agencia" | "freelance">("interno");
  const [aliadoId, setAliadoId] = useState<number | "">("");

  // BNC (Base No Comisionable)
  const [bncModo, setBncModo] = useState<"tiquetes" | "fijo">("tiquetes");
  const [valorTiquetes, setValorTiquetes] = useState("");
  const [bncFijo, setBncFijo] = useState("");

  // Costos netos (solo manual) → validación de margen mínimo PVP ≥ costos/(1−20%).
  const MARKUP_MIN = 0.20;
  const totalCostos = esNegociado ? 0
    : hoteles.reduce((s, h) => s + Math.max(0, Number(h.costo) || 0), 0)
    + vuelos.reduce((s, v) => s + Math.max(0, Number(v.costo) || 0), 0)
    + servicios.reduce((s, x) => s + Math.max(0, Number(x.costo) || 0), 0);
  const pvpMinimo = totalCostos > 0 ? totalCostos / (1 - MARKUP_MIN) : 0;

  const total = items.reduce(
    (s, it) => s + it.adultos * it.tarifaAdulto + it.ninos * it.tarifaNino,
    0
  );
  const bnc = bncModo === "fijo" ? Number(bncFijo) || 0 : Number(valorTiquetes) || 0;
  const baseComisionable = Math.max(0, total - bnc);

  function setItem(i: number, patch: Partial<ItemInput>) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }
  function setPasajero(i: number, patch: Partial<PasajeroInput>) {
    setPasajeros((arr) => arr.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function setHotel(i: number, patch: Partial<HotelInput>) {
    setHoteles((arr) => arr.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  }
  // Si el nombre tipeado coincide con un hotel del catálogo (mayorista) y el
  // proveedor todavía está vacío, lo autocompleta -- sin pisar un proveedor
  // que el asesor ya haya escrito a mano.
  function elegirHotelNombre(i: number, nombre: string) {
    const match = hotelesCatalogo.find((h) => h.nombre.toLowerCase() === nombre.trim().toLowerCase());
    setHoteles((arr) => arr.map((h, j) => {
      if (j !== i) return h;
      const proveedor = !h.proveedor.trim() && match?.proveedor ? match.proveedor : h.proveedor;
      return { ...h, nombre, proveedor };
    }));
  }
  function setServicio(i: number, patch: Partial<ServicioInput>) {
    setServicios((arr) => arr.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
  // Al escribir el código IATA, deriva la ciudad sola (catálogo lib/iata.ts) para
  // no tener que digitarla dos veces. Si el código no está en el catálogo, la
  // ciudad queda como el usuario la haya puesto (edición libre, sin pisarla).
  function setVuelo(i: number, patch: Partial<VueloInput>) {
    setVuelos((arr) => arr.map((v, j) => {
      if (j !== i) return v;
      const next = { ...v, ...patch };
      if (patch.origenCodigo !== undefined) next.origenCiudad = ciudadIata(patch.origenCodigo) ?? next.origenCiudad;
      if (patch.destinoCodigo !== undefined) next.destinoCiudad = ciudadIata(patch.destinoCodigo) ?? next.destinoCiudad;
      return next;
    }));
  }

  // Tipos de tarifa/equipaje de la aerolínea escrita en esa fila (catálogo de
  // mayorista) — cada aerolínea trae su propia lista, o ninguna si no está
  // configurada o el nombre no coincide con el catálogo.
  function tarifasDe(aerolinea: string) {
    return aerolineasCatalogo.find((a) => a.nombre.toLowerCase() === aerolinea.trim().toLowerCase())?.tarifas ?? [];
  }

  function aplicarPaquete(idStr: string) {
    const id = Number(idStr) || "";
    setPaqueteId(id);
    const pk = paquetes.find((p) => p.id === id);
    if (!pk) return;
    setPlanNombre(pk.plan_alimentacion ?? "");
    setHoteles(
      pk.paquete_hoteles.map((h) => ({
        nombre: h.nombre, categoria: "", proveedor: "", ciudad: h.ciudad ?? "", alimentacion: h.alimentacion ?? "",
        acomodacion: "", detalleAcomodacion: h.acomodacion_detalle ?? "", fechaIngreso: "", fechaSalida: "",
      }))
    );
    const precioDoble = pk.paquete_precios.find((x) => x.acomodacion === "doble")?.precio
      ?? pk.paquete_precios[0]?.precio ?? 0;
    const precioNino = pk.paquete_precios.find((x) => x.acomodacion === "nino")?.precio ?? 0;
    setItems([{ descripcion: pk.nombre, adultos: 1, ninos: 0, tarifaAdulto: precioDoble, tarifaNino: precioNino }]);
  }

  function enviar(forzarMargen: boolean) {
    const pasajerosOk = pasajeros.filter((p) => p.nombres.trim() !== "" || p.apellidos.trim() !== "");
    const hotelesOk = hoteles.filter((h) => h.nombre.trim() !== "");
    const vuelosOk = vuelos.filter((v) => v.aerolinea.trim() !== "");
    const serviciosOk = servicios.filter((s) => s.descripcion.trim() !== "");
    const itemsOk = items.filter((it) => it.descripcion.trim() !== "");

    startTransition(async () => {
      try {
        const res = await crearContrato({
          tipoPaquete,
          paqueteId: paqueteId === "" ? null : Number(paqueteId),
          bloqueoId: bloqueoId === "" ? null : Number(bloqueoId),
          cliente,
          clienteDocumento: doc,
          clienteTelefono: tel,
          clienteDireccion: dir,
          destino,
          fechaSalida,
          fechaRegreso,
          fechaEmision,
          asistenciaMedica: asistencia,
          planNombre,
          toursTraslados: tours,
          asesorNombre,
          asesorCargo,
          asesorCc,
          asesorTel,
          pasajeros: pasajerosOk,
          hoteles: hotelesOk,
          vuelos: vuelosOk,
          servicios: serviciosOk,
          items: itemsOk,
          bncModo,
          valorTiquetes: Number(valorTiquetes) || 0,
          bncFijo: Number(bncFijo) || 0,
          tipoVenta,
          aliadoId: aliadoId === "" ? null : Number(aliadoId),
          moneda: monedaEfectiva,
          forzarMargen,
        });
        if (res.ok) {
          router.push(`/dashboard/contratos/${encodeURIComponent(res.numero)}`);
        } else if (res.margenInsuficiente && puedeForzarMargen) {
          setAdvertenciaMargen(res.error);
        } else {
          setError(res.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al crear el contrato.");
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAdvertenciaMargen("");
    if (!cliente.trim()) {
      setError("El nombre del cliente es obligatorio.");
      return;
    }
    if (bncModo === "fijo" && (Number(bncFijo) || 0) < (Number(valorTiquetes) || 0)) {
      setError("La BNC fija no puede ser menor al valor de los tiquetes.");
      return;
    }
    if (bnc > total) {
      setError("La BNC no puede ser mayor al total del contrato (PVP).");
      return;
    }
    if (totalCostos > 0 && total + 0.5 < pvpMinimo) {
      const margenActual = total > 0 ? 1 - totalCostos / total : 0;
      const mensaje = `El PVP (${fmt(total)}) no cubre el margen mínimo del ${MARKUP_MIN * 100}%. Con costos de ${fmt(totalCostos)}, el PVP mínimo es ${fmt(Math.ceil(pvpMinimo))} (margen actual: ${(margenActual * 100).toFixed(1)}%).`;
      if (puedeForzarMargen) setAdvertenciaMargen(mensaje);
      else setError(mensaje);
      return;
    }
    if (!asesorNombre.trim()) { setError("Selecciona el asesor interno."); return; }
    if (tipoVenta !== "interno" && !aliadoId) { setError(`Selecciona la ${tipoVenta} del catálogo.`); return; }
    enviar(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tipo de paquete */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>Tipo de paquete</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Tipo *</label>
            <select
              value={tipoPaquete}
              onChange={(e) => { setTipoPaquete(e.target.value as TipoPaquete); setPaqueteId(""); setBloqueoId(""); }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {!esNegociado && (
            <div>
              <label className={labelCls}>Moneda</label>
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as "COP" | "USD")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="COP">Pesos (COP)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>
          )}
          {esNegociado && (
            <div>
              <label className={labelCls}>Producto del tarifario</label>
              <select value={paqueteId} onChange={(e) => aplicarPaquete(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona un paquete</option>
                {paquetesFiltrados.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          )}
          {tipoPaquete === "bloqueo" && (
            <div>
              <label className={labelCls}>Record (descuenta cupos)</label>
              <select value={bloqueoId} onChange={(e) => setBloqueoId(Number(e.target.value) || "")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona record</option>
                {bloqueos.map((b) => <option key={b.id} value={b.id}>{b.record} · {b.ruta} · {b.fecha_ida}</option>)}
              </select>
            </div>
          )}
        </div>
        {esNegociado && (
          <p className="text-xs text-gray-400">
            Los hoteles, el plan y los precios se cargan del producto (no edites el precio).
            Los costos quedan de uso interno y no se muestran al asesor.
          </p>
        )}
      </section>

      {/* Venta / canal */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>Venta</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Asesor interno *</label>
            <select value={asesorNombre} onChange={(e) => setAsesorNombre(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">Selecciona asesor</option>
              {vendedores.map((v) => <option key={v.nombre} value={v.nombre}>{v.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tipo de venta *</label>
            <select value={tipoVenta} onChange={(e) => { setTipoVenta(e.target.value as "interno" | "agencia" | "freelance"); setAliadoId(""); }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="interno">Directa (B2C)</option>
              <option value="agencia">Agencia (B2B)</option>
              <option value="freelance">Freelance (B2B)</option>
            </select>
          </div>
          {tipoVenta === "agencia" && (
            <div>
              <label className={labelCls}>Agencia *</label>
              <select value={aliadoId} onChange={(e) => setAliadoId(Number(e.target.value) || "")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona agencia</option>
                {agencias.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
          )}
          {tipoVenta === "freelance" && (
            <div>
              <label className={labelCls}>Freelance *</label>
              <select value={aliadoId} onChange={(e) => setAliadoId(Number(e.target.value) || "")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona freelance</option>
                {freelances.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
            </div>
          )}
        </div>
        {tipoVenta !== "interno" && (
          <p className="text-xs text-gray-400">
            Si la {tipoVenta} no aparece, créala primero en <b>Finanzas → Agencias y freelance</b>. La comisión B2B se crea sola con su %.
          </p>
        )}
      </section>

      {/* Cliente */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
          Cliente
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={labelCls}>Nombres *</label>
            <Input value={clienteNombres} onChange={(e) => setClienteNombres(e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>Apellidos *</label>
            <Input value={clienteApellidos} onChange={(e) => setClienteApellidos(e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>N° Documento</label>
            <Input value={doc} onChange={(e) => setDoc(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Teléfono</label>
            <Input value={tel} onChange={(e) => setTel(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Dirección</label>
            <Input value={dir} onChange={(e) => setDir(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Datos generales */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
          Datos del viaje
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Destino</label>
            <ComboCiudad destinos={destinos} value={destino} onChange={setDestino} modo="nombre" permitirLibre placeholder="Destino…" />
          </div>
          <div>
            <label className={labelCls}>Fecha de salida (viaje)</label>
            <Input type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Fecha de regreso</label>
            <Input type="date" value={fechaRegreso} onChange={(e) => setFechaRegreso(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Fecha de emisión</label>
            <Input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Plan / Servicio</label>
            <Input value={planNombre} onChange={(e) => setPlanNombre(e.target.value)} placeholder="PLAN COMBINADO 8D-7N…" />
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={asistencia} onChange={(e) => setAsistencia(e.target.checked)} className="rounded" />
              Incluye asistencia médica
            </label>
          </div>
        </div>
        <div>
          <label className={labelCls}>Tours y traslados</label>
          <Input value={tours} onChange={(e) => setTours(e.target.value)} placeholder="Traslados aeropuerto-hotel, city tour…" />
        </div>
      </section>

      {/* Vuelos */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Vuelos (trayectos)
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() =>
              setVuelos((a) => [...a, { aerolinea: "", record: "", origenCodigo: "", origenCiudad: "", destinoCodigo: "", destinoCiudad: "", vueloIda: "", vueloRegreso: "", horaSalidaIda: "", horaLlegadaIda: "", horaSalidaReg: "", horaLlegadaReg: "", servicios: "", fechaSalida: "", fechaRegreso: "", costo: 0 }])
            }
          >
            + Agregar trayecto
          </button>
        </div>
        {vuelos.length === 0 && (
          <p className="text-xs text-gray-400">Sin vuelos (porción terrestre).</p>
        )}
        {aerolineasCatalogo.length > 0 && (
          <datalist id="aerolineas-catalogo">
            {aerolineasCatalogo.map((a) => <option key={a.nombre} value={a.nombre} />)}
          </datalist>
        )}
        {vuelos.map((v, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
            <Input placeholder="Record (PNR)" value={v.record} onChange={(e) => setVuelo(i, { record: e.target.value })} />
            <Input placeholder="Aerolínea" list="aerolineas-catalogo" value={v.aerolinea} onChange={(e) => setVuelo(i, { aerolinea: e.target.value })} />
            <ComboCiudad destinos={destinos} value={v.origenCodigo} onChange={(val) => setVuelo(i, { origenCodigo: val })} modo="iata" permitirLibre placeholder="Origen (cód)" />
            <ComboCiudad destinos={destinos} value={v.destinoCodigo} onChange={(val) => setVuelo(i, { destinoCodigo: val })} modo="iata" permitirLibre placeholder="Destino (cód)" />
            <ComboCiudad destinos={destinos} value={v.origenCiudad} onChange={(val) => setVuelo(i, { origenCiudad: val })} modo="nombre" permitirLibre placeholder="Origen (ciudad)" />
            <ComboCiudad destinos={destinos} value={v.destinoCiudad} onChange={(val) => setVuelo(i, { destinoCiudad: val })} modo="nombre" permitirLibre placeholder="Destino (ciudad)" />
            <Input placeholder="Vuelo ida (N°)" value={v.vueloIda} onChange={(e) => setVuelo(i, { vueloIda: e.target.value })} />
            <Input placeholder="Vuelo regreso (N°)" value={v.vueloRegreso} onChange={(e) => setVuelo(i, { vueloRegreso: e.target.value })} />
            <Input type="date" value={v.fechaSalida} onChange={(e) => setVuelo(i, { fechaSalida: e.target.value })} title="Fecha ida" />
            <Input type="date" value={v.fechaRegreso} onChange={(e) => setVuelo(i, { fechaRegreso: e.target.value })} title="Fecha regreso" />
            <Input placeholder="Hora salida ida" value={v.horaSalidaIda} onChange={(e) => setVuelo(i, { horaSalidaIda: e.target.value })} />
            <Input placeholder="Hora llegada ida" value={v.horaLlegadaIda} onChange={(e) => setVuelo(i, { horaLlegadaIda: e.target.value })} />
            <Input placeholder="Hora salida regreso" value={v.horaSalidaReg} onChange={(e) => setVuelo(i, { horaSalidaReg: e.target.value })} />
            <Input placeholder="Hora llegada regreso" value={v.horaLlegadaReg} onChange={(e) => setVuelo(i, { horaLlegadaReg: e.target.value })} />
            <Input className="md:col-span-2" placeholder="Servicios (equipaje…)" value={v.servicios} onChange={(e) => setVuelo(i, { servicios: e.target.value })} />
            {tarifasDe(v.aerolinea).length > 0 && (
              <select
                defaultValue=""
                className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm md:col-span-2"
                onChange={(e) => {
                  if (e.target.value) setVuelo(i, { servicios: e.target.value });
                  e.target.value = "";
                }}
                title="Rellena el campo Servicios con el texto del tipo de tarifa/equipaje elegido"
              >
                <option value="">+ Elegir tipo de tarifa/equipaje de {v.aerolinea.trim().toUpperCase()}…</option>
                {tarifasDe(v.aerolinea).map((t) => (
                  <option key={t.descripcion} value={t.descripcion}>{t.nombre} — {t.descripcion}</option>
                ))}
              </select>
            )}
            {!esNegociado && (
              <Input type="number" min={0} placeholder={`Costo neto (${monedaEfectiva})`} value={v.costo ?? ""} onChange={(e) => setVuelo(i, { costo: Number(e.target.value) || 0 })} title="Costo neto del vuelo (interno)" />
            )}
            <button type="button" className="text-xs text-gray-400 hover:text-red-500" onClick={() => setVuelos((a) => a.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
      </section>

      {/* Hoteles */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Hoteles
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() =>
              setHoteles((a) => [...a, { nombre: "", categoria: "", proveedor: "", ciudad: "", alimentacion: "", acomodacion: "", detalleAcomodacion: "", fechaIngreso: "", fechaSalida: "", costo: 0 }])
            }
          >
            + Agregar hotel
          </button>
        </div>
        {hotelesCatalogo.length > 0 && (
          <datalist id="hoteles-catalogo">
            {hotelesCatalogo.map((h) => <option key={h.nombre} value={h.nombre} />)}
          </datalist>
        )}
        {proveedoresCatalogo.length > 0 && (
          <datalist id="proveedores-catalogo">
            {proveedoresCatalogo.map((p) => <option key={p} value={p} />)}
          </datalist>
        )}
        {hoteles.length === 0 && <p className="text-xs text-gray-400">Sin hoteles cargados.</p>}
        {hoteles.map((h, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
            <Input placeholder="Hotel" list="hoteles-catalogo" value={h.nombre} onChange={(e) => elegirHotelNombre(i, e.target.value)} />
            <Input placeholder="Categoría habitación" value={h.categoria} onChange={(e) => setHotel(i, { categoria: e.target.value })} />
            <Input placeholder="Proveedor del hotel" list="proveedores-catalogo" value={h.proveedor} onChange={(e) => setHotel(i, { proveedor: e.target.value })} />
            <ComboCiudad destinos={destinos} value={h.ciudad} onChange={(val) => setHotel(i, { ciudad: val })} modo="nombre" permitirLibre placeholder="Ciudad" />
            <Input placeholder="Alimentación (P.A, PAM…)" value={h.alimentacion} onChange={(e) => setHotel(i, { alimentacion: e.target.value })} />
            <Input placeholder="Acomodación (Doble…)" value={h.acomodacion} onChange={(e) => setHotel(i, { acomodacion: e.target.value })} />
            <Input placeholder="Detalle acomodación" value={h.detalleAcomodacion} onChange={(e) => setHotel(i, { detalleAcomodacion: e.target.value })} />
            {!esNegociado && (
              <Input type="number" min={0} placeholder={`Costo neto (${monedaEfectiva})`} value={h.costo ?? ""} onChange={(e) => setHotel(i, { costo: Number(e.target.value) || 0 })} title="Costo neto del hotel (interno)" />
            )}
            <Input type="date" value={h.fechaIngreso} onChange={(e) => setHotel(i, { fechaIngreso: e.target.value })} />
            <Input type="date" value={h.fechaSalida} onChange={(e) => setHotel(i, { fechaSalida: e.target.value })} />
            <button type="button" className="text-xs text-gray-400 hover:text-red-500 md:col-span-4 md:text-right" onClick={() => setHoteles((a) => a.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
      </section>

      {/* Servicios y proveedores (asistencia médica, traslados, tours…) */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Servicios y proveedores
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setServicios((a) => [...a, { tipo: "asistencia", descripcion: "", proveedor: "", costo: 0 }])}
          >
            + Agregar servicio
          </button>
        </div>
        <p className="text-xs text-gray-400">
          Asistencia médica, traslados, tours… con su proveedor y costo: genera la cuenta por pagar sola (igual que hotel/vuelo).
        </p>
        {servicios.length === 0 && <p className="text-xs text-gray-400">Sin servicios cargados.</p>}
        {servicios.map((s, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
            <select className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={s.tipo} onChange={(e) => setServicio(i, { tipo: e.target.value as TipoServicio })}>
              {TIPOS_SERVICIO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <Input placeholder="Descripción (Traslado aeropuerto-hotel…)" className="md:col-span-2" value={s.descripcion} onChange={(e) => setServicio(i, { descripcion: e.target.value })} />
            <Input placeholder="Proveedor" value={s.proveedor} onChange={(e) => setServicio(i, { proveedor: e.target.value })} />
            {!esNegociado && (
              <Input type="number" min={0} placeholder={`Costo neto (${monedaEfectiva})`} value={s.costo ?? ""} onChange={(e) => setServicio(i, { costo: Number(e.target.value) || 0 })} title="Costo neto del servicio (interno)" />
            )}
            <button type="button" className="text-xs text-gray-400 hover:text-red-500 md:col-span-4 md:text-right" onClick={() => setServicios((a) => a.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
      </section>

      {/* Pasajeros */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Pasajeros
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setPasajeros((a) => [...a, { nombres: "", apellidos: "", tipoId: "CC", identificacion: "", fechaNacimiento: "", esInfante: false }])}
          >
            + Agregar pasajero
          </button>
        </div>
        {pasajeros.map((p, i) => (
          <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-6">
            <Input placeholder="Nombres" value={p.nombres} onChange={(e) => setPasajero(i, { nombres: e.target.value })} />
            <Input placeholder="Apellidos" value={p.apellidos} onChange={(e) => setPasajero(i, { apellidos: e.target.value })} />
            <Input placeholder="Tipo ID" value={p.tipoId} onChange={(e) => setPasajero(i, { tipoId: e.target.value })} />
            <Input placeholder="Identificación" value={p.identificacion} onChange={(e) => setPasajero(i, { identificacion: e.target.value })} />
            <Input type="date" value={p.fechaNacimiento} onChange={(e) => setPasajero(i, { fechaNacimiento: e.target.value })} />
            <div className="flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={p.esInfante} onChange={(e) => setPasajero(i, { esInfante: e.target.checked })} />
                Infante
              </label>
              <button type="button" className="text-xs text-gray-400 hover:text-red-500" onClick={() => setPasajeros((a) => a.filter((_, j) => j !== i))}>
                Quitar
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* Valores */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Detalle de valores
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setItems((a) => [...a, { descripcion: "", adultos: 0, ninos: 0, tarifaAdulto: 0, tarifaNino: 0 }])}
          >
            + Agregar ítem
          </button>
        </div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-6">
              <div className="md:col-span-2">
                <label className={labelCls}>Ítem</label>
                <Input value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Adultos</label>
                <Input type="number" min={0} value={it.adultos} onChange={(e) => setItem(i, { adultos: Number(e.target.value) })} />
              </div>
              <div>
                <label className={labelCls}>Niños</label>
                <Input type="number" min={0} value={it.ninos} onChange={(e) => setItem(i, { ninos: Number(e.target.value) })} />
              </div>
              <div>
                <label className={labelCls}>Tarifa adulto {esNegociado && <span className="text-gray-400">🔒</span>}</label>
                <Input type="number" min={0} value={it.tarifaAdulto} disabled={esNegociado}
                  className={esNegociado ? "bg-gray-100" : ""}
                  onChange={(e) => setItem(i, { tarifaAdulto: Number(e.target.value) })} />
              </div>
              <div>
                <label className={labelCls}>Tarifa niño {esNegociado && <span className="text-gray-400">🔒</span>}</label>
                <Input type="number" min={0} value={it.tarifaNino} disabled={esNegociado}
                  className={esNegociado ? "bg-gray-100" : ""}
                  onChange={(e) => setItem(i, { tarifaNino: Number(e.target.value) })} />
              </div>
              {items.length > 1 && (
                <button type="button" className="text-xs text-gray-400 hover:text-red-500 md:col-span-6 md:text-right" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>
                  Quitar ítem
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t pt-3">
          {totalCostos > 0 && (
            <span className="text-xs text-gray-500">
              Costos: <b className="tabular-nums text-gray-700">{fmt(totalCostos)}</b> · PVP mínimo (margen {MARKUP_MIN * 100}%):{" "}
              <b className="tabular-nums" style={{ color: total + 0.5 < pvpMinimo ? "#C0392B" : "var(--brand-success)" }}>{fmt(Math.ceil(pvpMinimo))}</b>
            </span>
          )}
          <span className="text-sm text-gray-500">Total del contrato:</span>
          <span className="text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>
            {fmt(total)}
          </span>
        </div>
      </section>

      {/* BNC (Base No Comisionable) */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>Base No Comisionable (BNC)</p>
        <p className="text-xs text-gray-500">
          El valor que NO comisiona (tiquetes). La comisión interna se liquida sobre la <b>base comisionable = PVP − BNC</b>.
          En dinámico sin vuelo, déjalo en 0.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Valor de los tiquetes (total)</label>
            <Input type="number" min={0} value={valorTiquetes} onChange={(e) => setValorTiquetes(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={labelCls}>¿Cómo se calcula la BNC?</label>
            <select value={bncModo} onChange={(e) => setBncModo(e.target.value as "tiquetes" | "fijo")}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="tiquetes">BNC = valor de los tiquetes</option>
              <option value="fijo">BNC = valor fijo (≥ tiquetes)</option>
            </select>
          </div>
          {bncModo === "fijo" && (
            <div>
              <label className={labelCls}>Valor fijo de la BNC</label>
              <Input type="number" min={0} value={bncFijo} onChange={(e) => setBncFijo(e.target.value)} placeholder="0" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t pt-3 text-sm">
          <span className="text-gray-500">BNC: <b className="tabular-nums text-gray-700">{fmt(bnc)}</b></span>
          <span className="text-gray-500">Base comisionable: <b className="tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(baseComisionable)}</b></span>
        </div>
      </section>

      {/* Firma asesor */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
          Asesor que firma
        </p>
        <p className="text-xs text-gray-400">Firma el <b>asesor interno</b> seleccionado arriba ({asesorNombre || "—"}).</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Cargo</label>
            <Input value={asesorCargo} onChange={(e) => setAsesorCargo(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>CC</label>
            <Input value={asesorCc} onChange={(e) => setAsesorCc(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Teléfono</label>
            <Input value={asesorTel} onChange={(e) => setAsesorTel(e.target.value)} />
          </div>
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {advertenciaMargen && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          <p>{advertenciaMargen}</p>
          <Button
            type="button"
            disabled={pending}
            onClick={() => enviar(true)}
            style={{ backgroundColor: "#b45309" }}
          >
            {pending ? "Generando contrato…" : "Continuar con la aprobación a pesar del margen"}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Generando contrato…" : "Generar contrato"}
        </Button>
        <span className="text-xs text-gray-400">
          Se asignará automáticamente un número de contrato (00-NNNN).
        </span>
      </div>
    </form>
  );
}
