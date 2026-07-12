"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import { crearCuenta, actualizarCuenta, eliminarCuenta, type Cuenta } from "./actions";

type Naturaleza = "debito" | "credito";

function NaturalezaBadge({ n }: { n: string }) {
  const debito = n === "debito";
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={debito ? { backgroundColor: "rgba(29,124,154,0.1)", color: "var(--brand-primary)" } : { backgroundColor: "rgba(180,83,9,0.1)", color: "#b45309" }}
    >
      {debito ? "Débito" : "Crédito"}
    </span>
  );
}

export function PlanCuentasClient({ cuentasIniciales }: { cuentasIniciales: Cuenta[] }) {
  const router = useRouter();
  const [cuentas] = useState<Cuenta[]>(cuentasIniciales);
  const [busqueda, setBusqueda] = useState("");
  const [soloActivas, setSoloActivas] = useState(true);
  const [formAbierto, setFormAbierto] = useState<false | { padreId: number | null }>(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [colapsadas, setColapsadas] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const porPadre = useMemo(() => {
    const m = new Map<number | null, Cuenta[]>();
    for (const c of cuentas) {
      const k = c.padre_id;
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return m;
  }, [cuentas]);

  const filtro = busqueda.trim().toLowerCase();
  const coincide = (c: Cuenta) =>
    (!soloActivas || c.activa) &&
    (!filtro || c.codigo.includes(filtro) || c.nombre.toLowerCase().includes(filtro));

  // Si hay búsqueda, mostrar todas las que coinciden (sin colapsar el árbol).
  const raices = (porPadre.get(null) ?? []).sort((a, b) => a.codigo.localeCompare(b.codigo));

  function toggleColapsar(id: number) {
    setColapsadas((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function refrescar() { router.refresh(); }

  function renderNodo(c: Cuenta): React.ReactNode {
    const hijos = (porPadre.get(c.id) ?? []).sort((a, b) => a.codigo.localeCompare(b.codigo));
    const hijosVisibles = filtro ? hijos.filter((h) => nodoOAlgunHijoCoincide(h)) : hijos.filter(coincide);
    const propioVisible = filtro ? nodoOAlgunHijoCoincide(c) : coincide(c);
    if (!propioVisible) return null;
    const colapsada = colapsadas.has(c.id) && !filtro;

    return (
      <div key={c.id}>
        {editId === c.id ? (
          <FilaEditar cuenta={c} onDone={() => { setEditId(null); refrescar(); }} onCancel={() => setEditId(null)} />
        ) : (
          <div
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"
            style={{ paddingLeft: `${(c.nivel - 1) * 18 + 8}px` }}
          >
            {hijos.length > 0 ? (
              <button type="button" onClick={() => toggleColapsar(c.id)} className="text-gray-400">
                {colapsada ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="w-[14px]" />
            )}
            <span className="w-24 shrink-0 font-mono text-xs text-gray-500">{c.codigo}</span>
            <span className={`flex-1 truncate ${c.nivel <= 2 ? "font-semibold text-gray-700" : "text-gray-700"}`}>{c.nombre}</span>
            {!c.activa && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400">Inactiva</span>}
            <NaturalezaBadge n={c.naturaleza} />
            {c.permite_movimiento && (
              <span className="shrink-0 rounded-full bg-[var(--brand-success)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--brand-success)]">
                Recibe movimiento
              </span>
            )}
            <button type="button" onClick={() => { setFormAbierto(false); setEditId(c.id); }} className="text-gray-400 hover:text-[var(--brand-accent)]" title="Editar">
              <Pencil size={13} />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm(`¿Eliminar la cuenta ${c.codigo} · ${c.nombre}?`)) return;
                start(async () => { const r = await eliminarCuenta(c.id); if (!r.ok) { setError(r.error); return; } refrescar(); });
              }}
              className="text-gray-300 hover:text-red-500"
              title="Eliminar"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              onClick={() => { setEditId(null); setFormAbierto({ padreId: c.id }); }}
              className="shrink-0 text-[11px] font-medium hover:underline"
              style={{ color: "var(--brand-accent)" }}
            >
              + subcuenta
            </button>
          </div>
        )}
        {formAbierto && formAbierto.padreId === c.id && (
          <div style={{ paddingLeft: `${c.nivel * 18 + 8}px` }} className="py-1">
            <FilaNueva padre={c} onDone={() => { setFormAbierto(false); refrescar(); }} onCancel={() => setFormAbierto(false)} />
          </div>
        )}
        {!colapsada && hijosVisibles.length > 0 && <div>{hijos.map((h) => renderNodo(h))}</div>}
      </div>
    );
  }

  function nodoOAlgunHijoCoincide(c: Cuenta): boolean {
    if (coincide(c)) return true;
    const hijos = porPadre.get(c.id) ?? [];
    return hijos.some((h) => nodoOAlgunHijoCoincide(h));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Buscar</label>
          <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Código o nombre…" className="w-56" />
        </div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={soloActivas} onChange={(e) => setSoloActivas(e.target.checked)} /> Solo activas
        </label>
        <div className="ml-auto">
          <Button onClick={() => { setEditId(null); setFormAbierto({ padreId: null }); }} style={{ backgroundColor: "var(--brand-primary)" }}>
            <Plus size={15} className="mr-1 inline" /> Nueva clase (nivel 1)
          </Button>
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {formAbierto && formAbierto.padreId === null && (
        <FilaNueva padre={null} onDone={() => { setFormAbierto(false); refrescar(); }} onCancel={() => setFormAbierto(false)} />
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-2">
        {raices.length === 0 ? <p className="px-3 py-6 text-center text-sm text-gray-400">Sin cuentas.</p> : raices.map((c) => renderNodo(c))}
      </div>
    </div>
  );
}

function FilaNueva({ padre, onDone, onCancel }: { padre: Cuenta | null; onDone: () => void; onCancel: () => void }) {
  const [codigo, setCodigo] = useState(padre?.codigo ?? "");
  const [nombre, setNombre] = useState("");
  const [naturaleza, setNaturaleza] = useState<Naturaleza>((padre?.naturaleza as Naturaleza) ?? "debito");
  const [permiteMovimiento, setPermiteMovimiento] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function guardar() {
    setError("");
    start(async () => {
      const r = await crearCuenta({ codigo, nombre, padreId: padre?.id ?? null, naturaleza, permiteMovimiento });
      if (!r.ok) { setError(r.error); return; }
      onDone();
    });
  }

  return (
    <div className="rounded-lg border border-dashed p-3" style={{ borderColor: "var(--brand-accent)" }}>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="block text-[11px] text-gray-500">Código</label><Input value={codigo} onChange={(e) => setCodigo(e.target.value)} className="w-28 font-mono" placeholder={padre ? `${padre.codigo}…` : "1"} /></div>
        <div className="flex-1"><label className="block text-[11px] text-gray-500">Nombre</label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la cuenta" /></div>
        <div>
          <label className="block text-[11px] text-gray-500">Naturaleza</label>
          <select value={naturaleza} onChange={(e) => setNaturaleza(e.target.value as Naturaleza)} className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm">
            <option value="debito">Débito</option>
            <option value="credito">Crédito</option>
          </select>
        </div>
        <label className="mb-2 flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={permiteMovimiento} onChange={(e) => setPermiteMovimiento(e.target.checked)} /> Recibe movimiento
        </label>
        <Button onClick={guardar} disabled={pending || !codigo.trim() || !nombre.trim()} className="h-9" style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "…" : "Crear"}
        </Button>
        <button type="button" onClick={onCancel} className="pb-2 text-xs text-gray-400 hover:text-gray-700">Cancelar</button>
      </div>
      {padre && <p className="mt-1 text-[11px] text-gray-400">Subcuenta de {padre.codigo} · {padre.nombre} — el código debe empezar con &quot;{padre.codigo}&quot;.</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function FilaEditar({ cuenta, onDone, onCancel }: { cuenta: Cuenta; onDone: () => void; onCancel: () => void }) {
  const [codigo, setCodigo] = useState(cuenta.codigo);
  const [nombre, setNombre] = useState(cuenta.nombre);
  const [naturaleza, setNaturaleza] = useState<Naturaleza>(cuenta.naturaleza as Naturaleza);
  const [permiteMovimiento, setPermiteMovimiento] = useState(cuenta.permite_movimiento);
  const [activa, setActiva] = useState(cuenta.activa);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function guardar() {
    setError("");
    start(async () => {
      const r = await actualizarCuenta(cuenta.id, { codigo, nombre, naturaleza, permiteMovimiento, activa });
      if (!r.ok) { setError(r.error); return; }
      onDone();
    });
  }

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.04)" }}>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="block text-[11px] text-gray-500">Código</label><Input value={codigo} onChange={(e) => setCodigo(e.target.value)} className="w-28 font-mono" /></div>
        <div className="flex-1"><label className="block text-[11px] text-gray-500">Nombre</label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div>
          <label className="block text-[11px] text-gray-500">Naturaleza</label>
          <select value={naturaleza} onChange={(e) => setNaturaleza(e.target.value as Naturaleza)} className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm">
            <option value="debito">Débito</option>
            <option value="credito">Crédito</option>
          </select>
        </div>
        <label className="mb-2 flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={permiteMovimiento} onChange={(e) => setPermiteMovimiento(e.target.checked)} /> Recibe movimiento
        </label>
        <label className="mb-2 flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Activa
        </label>
        <Button onClick={guardar} disabled={pending} className="h-9" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar"}</Button>
        <button type="button" onClick={onCancel} className="pb-2 text-xs text-gray-400 hover:text-gray-700">Cancelar</button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
