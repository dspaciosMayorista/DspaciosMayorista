"use client";

// #106 · Filtros de Gestión de contratos. La URL es la fuente de verdad: cada cambio es UNA navegación (router.replace) que vuelve a renderizar la página
// en el servidor. El texto espera 400 ms de calma (debounce); listas y fechas navegan al instante. Una navegación nueva sustituye a la anterior (el router
// solo pinta la última respuesta), no hay sondeos ni reintentos, y un cambio que no altera la URL no hace ninguna petición. Lo que el usuario ve en los
// campos vive en estado local (`f`) para que lo escrito mientras llega la respuesta no se pierda; solo «atrás/adelante» del navegador lo reemplaza.
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Search, X } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { aQuery, esFechaValida, hayFiltros, parsearFiltros, type FiltrosGestion } from "@/lib/gestionContratos/filtros";
import { crearDebounce, type Debounce } from "@/lib/gestionContratos/debounce";

const ESPERA_TEXTO_MS = 400;
const campo = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const rotulo = "mb-1 block text-xs font-medium text-gray-600";

type Opcion = readonly [valor: string, texto: string];
const OPCIONES: Record<string, readonly Opcion[]> = {
  agencia: [["mayorista", "Mayorista"], ["minorista", "Minorista"]],
  estado: [["pendiente", "Pendiente"], ["confirmado", "Confirmado / activo"], ["cancelado", "Cancelado"], ["otro", "Otro estado"]],
  saldo: [["con_saldo", "Con saldo por cobrar"], ["pagado", "Pagado completo"], ["sobrepago", "Sobrepagado"], ["sin_total", "Sin total registrado"]],
  moneda: [["COP", "COP"], ["USD", "USD"]],
  voucher: [["con", "Con vouchers"], ["sin", "Sin vouchers"]],
  entrega: [["pendiente", "Entrega sin registrar"], ["entregado", "Entrega registrada"]],
  factura: [["emitida", "Factura emitida (validada DIAN)"], ["sin_emitir", "Pendiente de validación DIAN"]],
  envio: [["pendiente", "Envío sin registrar"], ["enviada", "Envío registrado"], ["desactualizada", "Acuse desactualizado"]],
  comision: [["pendiente", "Pendiente de pago"], ["parcial", "Pago parcial"], ["pagada", "Pagada"], ["descontada", "Descontada (NETO)"], ["revision_neto", "NETO: revisar fila"], ["retenida", "Retenida"], ["prevista", "Prevista al confirmar"], ["sin_definir", "Sin definir"], ["no_aplica", "No aplica"]],
  orden: [["venta_desc", "Compra: más reciente"], ["venta_asc", "Compra: más antigua"], ["salida_asc", "Viaje: más próximo"], ["salida_desc", "Viaje: más lejano"], ["saldo_desc", "Mayor saldo"], ["numero_asc", "Número de contrato"]],
};

function Lista({ nombre, etiqueta, valor, onCambio, todas }: { nombre: string; etiqueta: string; valor: string; onCambio: (v: string) => void; todas: string }) {
  return (
    <label className="block">
      <span className={rotulo}>{etiqueta}</span>
      <select value={valor} onChange={(e) => onCambio(e.target.value)} className={campo}>
        {todas && <option value="">{todas}</option>}
        {OPCIONES[nombre].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

type Clave = keyof FiltrosGestion;

// Filtros de segunda línea: viven en «Más filtros» (cerrado por defecto salvo que alguno esté activo) para que la lista quede a la vista, sobre todo en móvil.
const SECUNDARIOS: Clave[] = ["ventaDesde", "ventaHasta", "salidaDesde", "salidaHasta", "saldo", "moneda", "voucher", "entrega", "factura", "envio", "comision"];
const activosSecundarios = (f: FiltrosGestion) => SECUNDARIOS.filter((k) => f[k] != null && f[k] !== "").length;

export function FiltrosGestionUI({ actuales }: { actuales: FiltrosGestion }) {
  const router = useRouter();
  const ruta = usePathname();
  const [pendiente, iniciar] = useTransition();
  const [f, setF] = useState<FiltrosGestion>(actuales);
  const [masAbierto, setMasAbierto] = useState(activosSecundarios(actuales) > 0);
  const pedida = useRef(aQuery(actuales)); // última URL pedida por este componente (evita peticiones sin cambio real)
  const espera = useRef<Debounce<[string]> | null>(null);

  // Una sola instancia del debounce por componente; se cancela al desmontar.
  useEffect(() => {
    const ir = (q: string) => {
      if (q === pedida.current) return;
      pedida.current = q;
      iniciar(() => router.replace(`${ruta}${q}`, { scroll: false }));
    };
    espera.current = crearDebounce(ir, ESPERA_TEXTO_MS);
    return () => espera.current?.cancelar();
  }, [router, ruta]);

  // «Atrás/adelante» del navegador: los campos vuelven a reflejar la URL (es lo único que reemplaza el estado local).
  useEffect(() => {
    const alVolver = () => {
      espera.current?.cancelar();
      const sp = Object.fromEntries(new URLSearchParams(window.location.search));
      const siguientes = parsearFiltros(sp).filtros;
      pedida.current = aQuery(siguientes);
      setF(siguientes);
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);

  function ahora(siguientes: FiltrosGestion) {
    setF(siguientes);
    espera.current?.cancelar();
    const q = aQuery(siguientes); // cualquier cambio de filtro vuelve a la página 1
    if (q === pedida.current) return;
    pedida.current = q;
    iniciar(() => router.replace(`${ruta}${q}`, { scroll: false }));
  }
  const cambiar = (clave: Clave, valor: string) => ahora({ ...f, [clave]: valor === "" ? undefined : valor } as FiltrosGestion);
  const fecha = (clave: Clave, v: string) => { if (v === "" || esFechaValida(v)) cambiar(clave, v); }; // un texto a medio escribir no navega
  function texto(clave: "numero" | "cliente", valor: string) {
    const sig = { ...f, [clave]: valor.trim() === "" ? undefined : valor } as FiltrosGestion;
    setF(sig);
    espera.current?.(aQuery({ ...sig, [clave]: valor.trim() === "" ? undefined : valor.trim() }));
  }

  return (
    <form role="search" aria-label="Filtros de contratos" aria-busy={pendiente}
      onSubmit={(e) => { e.preventDefault(); ahora({ ...f, numero: f.numero?.trim() || undefined, cliente: f.cliente?.trim() || undefined }); }}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Lista nombre="agencia" etiqueta="Agencia" valor={f.agencia ?? ""} onCambio={(v) => cambiar("agencia", v)} todas="Ambas agencias" />
        <label className="block"><span className={rotulo}>N.º de contrato</span>
          <span className="relative block"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <input value={f.numero ?? ""} onChange={(e) => texto("numero", e.target.value)} maxLength={60} placeholder="p. ej. 10602" className={`${campo} pl-8`} autoComplete="off" /></span></label>
        <label className="block"><span className={rotulo}>Cliente</span>
          <input value={f.cliente ?? ""} onChange={(e) => texto("cliente", e.target.value)} maxLength={60} placeholder="Nombre del titular" className={campo} autoComplete="off" /></label>
        <Lista nombre="estado" etiqueta="Estado del contrato" valor={f.estado ?? ""} onCambio={(v) => cambiar("estado", v)} todas="Todos los estados" />
      </div>
      <details open={masAbierto} onToggle={(e) => setMasAbierto(e.currentTarget.open)} className="mt-3 rounded-lg border border-gray-200 px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium text-gray-700">Más filtros{activosSecundarios(f) > 0 ? ` (${activosSecundarios(f)} activo${activosSecundarios(f) === 1 ? "" : "s"})` : ""}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className={rotulo}>Compra desde</span><DateInput aria-label="Compra desde" value={f.ventaDesde ?? ""} onValueChange={(v) => fecha("ventaDesde", v)} className={campo} /></label>
          <label className="block"><span className={rotulo}>Compra hasta</span><DateInput aria-label="Compra hasta" value={f.ventaHasta ?? ""} onValueChange={(v) => fecha("ventaHasta", v)} className={campo} /></label>
          <label className="block"><span className={rotulo}>Viaje (salida) desde</span><DateInput aria-label="Salida desde" value={f.salidaDesde ?? ""} onValueChange={(v) => fecha("salidaDesde", v)} className={campo} /></label>
          <label className="block"><span className={rotulo}>Viaje (salida) hasta</span><DateInput aria-label="Salida hasta" value={f.salidaHasta ?? ""} onValueChange={(v) => fecha("salidaHasta", v)} className={campo} /></label>
          <Lista nombre="saldo" etiqueta="Saldo" valor={f.saldo ?? ""} onCambio={(v) => cambiar("saldo", v)} todas="Cualquier saldo" />
          <Lista nombre="moneda" etiqueta="Moneda de cobro" valor={f.moneda ?? ""} onCambio={(v) => cambiar("moneda", v)} todas="COP y USD" />
          <Lista nombre="voucher" etiqueta="Vouchers" valor={f.voucher ?? ""} onCambio={(v) => cambiar("voucher", v)} todas="Con o sin vouchers" />
          <Lista nombre="entrega" etiqueta="Entrega de vouchers (acuse manual)" valor={f.entrega ?? ""} onCambio={(v) => cambiar("entrega", v)} todas="Cualquiera" />
          <Lista nombre="factura" etiqueta="Factura" valor={f.factura ?? ""} onCambio={(v) => cambiar("factura", v)} todas="Con o sin factura" />
          <Lista nombre="envio" etiqueta="Envío de factura (acuse manual)" valor={f.envio ?? ""} onCambio={(v) => cambiar("envio", v)} todas="Cualquiera" />
          <Lista nombre="comision" etiqueta="Comisión B2B" valor={f.comision ?? ""} onCambio={(v) => cambiar("comision", v)} todas="Cualquiera" />
          </div>
      </details>
      <div className="mt-3 sm:max-w-xs">
        <Lista nombre="orden" etiqueta="Ordenar por" valor={f.orden} onCambio={(v) => cambiar("orden", v)} todas="" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}><Search size={14} aria-hidden /> Aplicar</button>
        {hayFiltros(f) && <Link href={ruta} prefetch={false} onClick={() => { espera.current?.cancelar(); pedida.current = ""; setF({ orden: "venta_desc" }); }} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800"><X size={14} aria-hidden /> Limpiar filtros</Link>}
        <span className="inline-flex items-center gap-1 text-xs text-gray-500" role="status" aria-live="polite">{pendiente && <><Loader2 size={12} className="animate-spin" aria-hidden /> Actualizando…</>}</span>
      </div>
    </form>
  );
}
