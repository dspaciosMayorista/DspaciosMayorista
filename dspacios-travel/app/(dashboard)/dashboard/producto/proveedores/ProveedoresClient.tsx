"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { crearProveedor, actualizarProveedor, eliminarProveedor, type TipoProveedor, type ProveedorInput } from "./actions";
import { ComboCiudad } from "@/components/ComboCiudad";
import { ComboProveedor } from "@/components/ComboProveedor";
import type { DestinoOpt } from "@/components/ComboDestino";

export type Proveedor = {
  id: number; tipo: string | null; nombre: string; razon_social: string | null;
  nit: string | null; ciudad: string | null; contacto: string | null;
  datos_pago: string | null; banco: string | null; tipo_cuenta: string | null; numero_cuenta: string | null;
  politica_reservas: string | null;
  voucher_contacto: string | null;
  aplica_retencion: boolean; pct_retencion: number;
  clasificacion: string | null;
};

const TIPOS: { value: TipoProveedor; label: string }[] = [
  { value: "hotelero", label: "Hotelero" },
  { value: "aereo", label: "Aéreo" },
  { value: "servicios", label: "Servicios adicionales" },
  { value: "programa", label: "Programa/circuito" },
];
const TIPO_LABEL: Record<string, string> = { hotelero: "Hotelero", aereo: "Aéreo", servicios: "Servicios", programa: "Programa/circuito" };
const TIPOS_CUENTA = ["Ahorros", "Corriente"];

const lbl = "mb-1 block text-xs font-medium text-gray-600";

// Texto de respaldo para la columna "Datos bancarios" de la tabla.
function bancarioTexto(p: Proveedor): string {
  const partes = [p.banco, p.tipo_cuenta, p.numero_cuenta].filter((x): x is string => !!x);
  if (partes.length) return partes.join(" · ");
  return p.datos_pago ?? "—";
}

type Resultado = { ok: true } | { ok: false; error: string };

const selectCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

// Formulario compartido por la pestaña de creación y el diálogo de edición.
// Guarda su propio borrador: cancelar o cerrar no toca el proveedor.
function ProveedorForm({ inicial, proveedores, destinos, textoGuardar, onSubmit, onCancel }: {
  inicial: Proveedor | null; proveedores: Proveedor[]; destinos: DestinoOpt[];
  textoGuardar: string; onSubmit: (input: ProveedorInput) => Promise<Resultado>; onCancel?: () => void;
}) {
  const uid = useId();
  const p = inicial;
  const [tipo, setTipo] = useState<TipoProveedor>((p?.tipo as TipoProveedor) ?? "hotelero");
  const [nombre, setNombre] = useState(p?.nombre ?? "");
  const [razon, setRazon] = useState(p?.razon_social ?? "");
  const [nit, setNit] = useState(p?.nit ?? "");
  const [ciudad, setCiudad] = useState(p?.ciudad ?? "");
  const [contacto, setContacto] = useState(p?.contacto ?? "");
  const [banco, setBanco] = useState(p?.banco ?? "");
  const [tipoCuenta, setTipoCuenta] = useState(p?.tipo_cuenta ?? "");
  const [numeroCuenta, setNumeroCuenta] = useState(p?.numero_cuenta ?? "");
  const [politica, setPolitica] = useState(p?.politica_reservas ?? "");
  const [voucherCon, setVoucherCon] = useState(p?.voucher_contacto ?? "");
  const [origenPol, setOrigenPol] = useState<number | "">("");
  const [ret, setRet] = useState(p?.aplica_retencion ?? false);
  const [pctRet, setPctRet] = useState(p?.aplica_retencion ? String(p.pct_retencion * 100) : "");
  const [clasif, setClasif] = useState<"costo" | "irt">((p?.clasificacion as "costo" | "irt") ?? "costo");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const nombreRef = useRef<HTMLInputElement>(null);
  const id = (k: string) => `${uid}-${k}`;

  // Copia la política de reservas de otro proveedor a este formulario (muchos
  // manejan las mismas). Rellena el textarea para revisar antes de guardar.
  function traerPolitica() {
    if (origenPol === "") return;
    const o = proveedores.find((x) => x.id === origenPol);
    if (!o) return;
    if (politica.trim() && !confirm("¿Reemplazar la política actual con la del proveedor elegido?")) return;
    setPolitica(o.politica_reservas ?? "");
    setOrigenPol("");
  }

  // Proveedores (distintos al que se edita) que tienen política para copiar.
  const conPolitica = proveedores.filter((x) => x.id !== p?.id && (x.politica_reservas ?? "").trim() !== "");

  function reiniciar() {
    setTipo("hotelero"); setNombre(""); setRazon(""); setNit(""); setCiudad(""); setContacto("");
    setBanco(""); setTipoCuenta(""); setNumeroCuenta(""); setPolitica(""); setVoucherCon("");
    setOrigenPol(""); setRet(false); setPctRet(""); setClasif("costo");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); nombreRef.current?.focus(); return; }
    setErr("");
    setPending(true);
    const input: ProveedorInput = {
      tipo, nombre, razonSocial: razon, nit, ciudad, contacto,
      banco, tipoCuenta, numeroCuenta, politicaReservas: politica, voucherContacto: voucherCon,
      aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
      clasificacion: clasif,
    };
    let r: Resultado;
    try { r = await onSubmit(input); } catch { r = { ok: false, error: "No se pudo guardar el proveedor. Intenta de nuevo." }; }
    setPending(false);
    if (r.ok) { if (!p) reiniciar(); }
    else { setErr(r.error); nombreRef.current?.focus(); }
  }

  const errNombre = err === "El nombre es obligatorio.";

  return (
    <form onSubmit={guardar} noValidate>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label htmlFor={id("tipo")} className={lbl}>Tipo *</label>
          <select id={id("tipo")} value={tipo} onChange={(e) => setTipo(e.target.value as TipoProveedor)} className={selectCls}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={id("nombre")} className={lbl}>Nombre comercial *</label>
          <Input id={id("nombre")} ref={nombreRef} value={nombre} onChange={(e) => setNombre(e.target.value)}
            aria-required="true" aria-invalid={errNombre || undefined} aria-describedby={err ? id("err") : undefined} />
        </div>
        <div><label htmlFor={id("razon")} className={lbl}>Razón social</label><Input id={id("razon")} value={razon} onChange={(e) => setRazon(e.target.value)} /></div>
        <div><label htmlFor={id("nit")} className={lbl}>NIT</label><Input id={id("nit")} value={nit} onChange={(e) => setNit(e.target.value)} /></div>
        <div><label htmlFor={id("ciudad")} className={lbl}>Ciudad</label><ComboCiudad inputId={id("ciudad")} destinos={destinos} value={ciudad} onChange={setCiudad} modo="nombre" permitirLibre placeholder="Ciudad…" /></div>
        <div><label htmlFor={id("contacto")} className={lbl}>Contacto</label><Input id={id("contacto")} value={contacto} onChange={(e) => setContacto(e.target.value)} /></div>
        <div><label htmlFor={id("banco")} className={lbl}>Banco</label><Input id={id("banco")} value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Ej. Bancolombia" /></div>
        <div>
          <label htmlFor={id("tcuenta")} className={lbl}>Tipo de cuenta</label>
          <select id={id("tcuenta")} value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {TIPOS_CUENTA.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div><label htmlFor={id("ncuenta")} className={lbl}>Número de cuenta</label><Input id={id("ncuenta")} value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value)} placeholder="Ej. 123-456789-00" /></div>
        <div className="md:col-span-3">
          <label htmlFor={id("politica")} className={lbl}>Política de reservas <span className="font-normal text-gray-400">(uso interno · no se muestra en el contrato)</span></label>
          <textarea id={id("politica")} value={politica} onChange={(e) => setPolitica(e.target.value)} rows={2}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="Ej. Reserva con 50% de anticipo · cancelación sin costo hasta 15 días antes · no reembolsable en temporada alta…" />
          {conPolitica.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Traer política de otro proveedor:</span>
              <div className="w-64">
                <ComboProveedor
                  proveedores={conPolitica.map((x) => ({ id: x.id, nombre: x.nombre }))}
                  value={origenPol}
                  onChange={setOrigenPol}
                  placeholder="Busca el proveedor con política…"
                />
              </div>
              <Button type="button" variant="outline" onClick={traerPolitica} disabled={origenPol === ""}>Traer</Button>
            </div>
          )}
        </div>
        <div className="md:col-span-3">
          <label htmlFor={id("voucher")} className={lbl}>Contacto para voucher <span className="font-normal text-gray-400">(sale en el voucher de servicios)</span></label>
          <Input id={id("voucher")} value={voucherCon} onChange={(e) => setVoucherCon(e.target.value)} placeholder="Ej. Angie Mendoza · Cels 320-500.88.48 · Operador Transturismo Cartagena" />
        </div>
        <div>
          <label htmlFor={id("clasif")} className={lbl}>Tratamiento contable</label>
          <select id={id("clasif")} value={clasif} onChange={(e) => setClasif(e.target.value as "costo" | "irt")} className={selectCls}>
            <option value="costo">Costo (ingreso propio · descuenta IVA)</option>
            <option value="irt">IRT (ingreso para tercero · no provisiona)</option>
          </select>
          <p className="mt-1 text-[11px] text-gray-400">
            {clasif === "irt"
              ? "Hotel/aerolínea que solo se intermedia: no es costo propio ni descuenta IVA."
              : "Se factura como ingreso propio: su IVA (base gravable de la CxP) es descontable."}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} /> Retención
          </label>
          {ret && <Input type="number" aria-label="Porcentaje de retención" className="w-20" placeholder="%" value={pctRet} onChange={(e) => setPctRet(e.target.value)} />}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : textoGuardar}
        </Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancelar</Button>}
        {err && <span id={id("err")} role="alert" className="text-sm text-red-600">{err}</span>}
      </div>
    </form>
  );
}

type Vista = "crear" | "listado";

// Pestaña activa: texto y subrayado de marca (el estilo base del componente compartido es muy tenue).
const TAB_CLS = "flex-none px-3 py-2 data-active:font-semibold data-active:text-[var(--brand-primary)] after:!inset-x-0 after:!bottom-[-7px] after:!h-[3px] data-active:after:!bg-[var(--brand-primary)] data-active:after:!opacity-100";

export function ProveedoresClient({ proveedores: proveedoresServidor, destinos }: { proveedores: Proveedor[]; destinos: DestinoOpt[] }) {
  const [vista, setVista] = useState<Vista>("crear");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [creado, setCreado] = useState(false);
  // Ediciones confirmadas por el servidor, mostradas de inmediato; se descartan
  // cuando llegan los datos revalidados de la página.
  const [ediciones, setEdiciones] = useState<{ base: Proveedor[]; filas: Record<number, Proveedor> }>({ base: proveedoresServidor, filas: {} });
  const guardandoEdicion = useRef(false);
  const PAGE_SIZE = 10;

  const filasLocales = ediciones.base === proveedoresServidor ? ediciones.filas : {};
  const proveedores = proveedoresServidor.map((p) => filasLocales[p.id] ?? p);

  const filtrados = query.trim()
    ? proveedores.filter((p) => p.nombre.toLowerCase().includes(query.trim().toLowerCase()))
    : proveedores;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaActual = Math.min(page, totalPaginas - 1);
  const visibles = filtrados.slice(paginaActual * PAGE_SIZE, paginaActual * PAGE_SIZE + PAGE_SIZE);

  async function crear(input: ProveedorInput): Promise<Resultado> {
    setCreado(false);
    const r = await crearProveedor(input);
    if (r.ok) setCreado(true);
    return r;
  }

  async function actualizar(input: ProveedorInput): Promise<Resultado> {
    const destino = editando;
    if (!destino) return { ok: false, error: "No hay proveedor en edición." };
    guardandoEdicion.current = true;
    try {
      const r = await actualizarProveedor(destino.id, input);
      if (!r.ok) return r;
      const o = (s: string) => (s.trim() !== "" ? s.trim() : null);
      const nuevo: Proveedor = {
        ...destino, tipo: input.tipo, nombre: input.nombre.trim(), razon_social: o(input.razonSocial), nit: o(input.nit),
        ciudad: o(input.ciudad), contacto: o(input.contacto), banco: o(input.banco), tipo_cuenta: o(input.tipoCuenta),
        numero_cuenta: o(input.numeroCuenta), politica_reservas: o(input.politicaReservas),
        voucher_contacto: o(input.voucherContacto), aplica_retencion: input.aplicaRetencion,
        pct_retencion: input.pctRetencion, clasificacion: input.clasificacion,
      };
      setEdiciones((prev) => ({
        base: proveedoresServidor,
        filas: { ...(prev.base === proveedoresServidor ? prev.filas : {}), [destino.id]: nuevo },
      }));
      setEditando(null);
      return r;
    } finally {
      guardandoEdicion.current = false;
    }
  }

  return (
    <Tabs value={vista} onValueChange={(v) => setVista(v as Vista)} className="flex-col gap-4">
      <TabsList variant="line" aria-label="Secciones de proveedores" className="h-auto w-full flex-wrap justify-start gap-2 border-b border-gray-200 pb-1.5">
        <TabsTrigger value="crear" className={TAB_CLS}>Creación o configuración</TabsTrigger>
        <TabsTrigger value="listado" className={TAB_CLS}>Listado de proveedores ({proveedores.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="crear" keepMounted>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-gray-700">Nuevo proveedor</p>
          <ProveedorForm inicial={null} proveedores={proveedores} destinos={destinos} textoGuardar="Agregar proveedor" onSubmit={crear} />
          {creado && (
            <p role="status" className="mt-3 text-sm text-green-700">
              Proveedor agregado.{" "}
              <button type="button" className="text-[var(--brand-accent)] underline" onClick={() => setVista("listado")}>Ver el listado</button>
            </p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="listado" keepMounted>
        {proveedores.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">Aún no hay proveedores.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                type="search"
                aria-label="Buscar proveedor por nombre"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                placeholder="Buscar por nombre…"
                className="max-w-xs"
              />
              <span className="text-xs text-gray-400" aria-live="polite">
                {filtrados.length} {filtrados.length === 1 ? "proveedor" : "proveedores"}
                {query.trim() ? ` · filtrado de ${proveedores.length}` : ""}
              </span>
            </div>

            {visibles.length === 0 ? (
              <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                Sin resultados para “{query}”.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                    <th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Nombre</th>
                    <th className="px-4 py-2">Razón social</th><th className="px-4 py-2">NIT</th>
                    <th className="px-4 py-2">Datos bancarios</th><th className="px-4 py-2">Política de reservas</th><th className="px-4 py-2"></th>
                  </tr></thead>
                  <tbody>{visibles.map((p) => <Row key={p.id} p={p} onEdit={setEditando} />)}</tbody>
                </table>
              </div>
            )}

            {totalPaginas > 1 && (
              <div className="flex items-center justify-center gap-2 pt-1">
                <Button variant="outline" disabled={paginaActual === 0} onClick={() => setPage(paginaActual - 1)}>← Anterior</Button>
                <span className="text-sm text-gray-500">Página {paginaActual + 1} de {totalPaginas}</span>
                <Button variant="outline" disabled={paginaActual >= totalPaginas - 1} onClick={() => setPage(paginaActual + 1)}>Siguiente →</Button>
              </div>
            )}
          </div>
        )}
      </TabsContent>

      <Dialog open={editando != null} onOpenChange={(abierto) => { if (!abierto && !guardandoEdicion.current) setEditando(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar proveedor</DialogTitle>
            <DialogDescription>{editando?.nombre}</DialogDescription>
          </DialogHeader>
          {editando && (
            <ProveedorForm
              key={editando.id}
              inicial={editando}
              proveedores={proveedores}
              destinos={destinos}
              textoGuardar="Guardar cambios"
              onSubmit={actualizar}
              onCancel={() => setEditando(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

function Row({ p, onEdit }: { p: Proveedor; onEdit: (p: Proveedor) => void }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{TIPO_LABEL[p.tipo ?? ""] ?? p.tipo}</span>
      </td>
      <td className="px-4 py-2 text-gray-700">{p.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{p.razon_social ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{p.nit ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{bancarioTexto(p)}</td>
      <td className="px-4 py-2 text-gray-500"><PoliticaCelda nombre={p.nombre} politica={p.politica_reservas} /></td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={() => onEdit(p)} aria-label={`Editar ${p.nombre}`} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
        <span className="mx-2 text-gray-300">·</span>
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`¿Eliminar ${p.nombre}?`)) start(() => { void eliminarProveedor(p.id); }); }}
          aria-label={`Eliminar ${p.nombre}`} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}

// Resumen de la política en la fila (máx. 2 líneas) + "Ver más" que abre la
// política completa en un diálogo con scroll propio. El diálogo va en un portal,
// así que la fila no crece mientras está abierto.
function PoliticaCelda({ nombre, politica }: { nombre: string; politica: string | null }) {
  const texto = politica ?? "";
  if (texto.trim() === "") return <span>—</span>;
  return (
    <div className="max-w-[260px]">
      <p data-politica-resumen className="line-clamp-2 whitespace-pre-wrap break-words">{texto}</p>
      <Dialog>
        <DialogTrigger render={<button type="button" className="mt-0.5 text-xs text-[var(--brand-accent)] hover:underline" />}>
          Ver más
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Política de reservas</DialogTitle>
            <DialogDescription>{nombre}</DialogDescription>
          </DialogHeader>
          <div data-politica-completa className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-gray-700">
            {texto}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cerrar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
