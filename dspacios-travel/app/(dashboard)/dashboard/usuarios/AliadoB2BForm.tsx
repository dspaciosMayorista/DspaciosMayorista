"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buscarFichasAliado, crearAliadoB2B, type FichaAliado } from "./actions";

const VACIO = { nombre: "", email: "", password: "", documento: "", contacto: "", telefono: "" };

export function AliadoB2BForm() {
  const [tipo, setTipo] = useState<"agencia" | "freelance">("agencia");
  const [tipoDocumento, setTipoDocumento] = useState("NIT");
  const [f, setF] = useState(VACIO);
  const [fichas, setFichas] = useState<FichaAliado[] | null>(null); // null = aún no buscado
  const [eleccion, setEleccion] = useState<string>(""); // id de ficha | "nueva" | ""
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof VACIO, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k === "documento") { setFichas(null); setEleccion(""); } // otra búsqueda, otra confirmación
  };

  function buscar() {
    setMsg("");
    start(async () => {
      const r = await buscarFichasAliado(f.documento);
      if (!r.ok) return setMsg(r.error);
      setFichas(r.fichas);
      setEleccion("");
    });
  }

  function crear() {
    setMsg("");
    start(async () => {
      const enlace = eleccion === "nueva" ? { modo: "nueva" as const }
        : eleccion ? { modo: "ficha" as const, aliadoId: Number(eleccion) } : null;
      const r = await crearAliadoB2B({ tipo, tipoDocumento, ...f, enlace });
      if (r.ok) { setF(VACIO); setFichas(null); setEleccion(""); setMsg("✓ Aliado B2B creado"); }
      else setMsg(r.error);
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-700">Crear aliado B2B</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <select value={tipo} onChange={(e) => { const t = e.target.value as "agencia" | "freelance"; setTipo(t); setTipoDocumento(t === "agencia" ? "NIT" : "CC"); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="agencia">agencia</option>
          <option value="freelance">freelance</option>
        </select>
        <Input placeholder="Nombre / razón social" value={f.nombre} onChange={(e) => set("nombre", e.target.value)} />
        <div className="flex gap-2">
          <select value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
            {["NIT", "CC", "CE", "PAS"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <Input placeholder="Número de documento" value={f.documento} onChange={(e) => set("documento", e.target.value)} />
          <Button type="button" variant="outline" onClick={buscar} disabled={pending || !f.documento.trim()}>Buscar ficha</Button>
        </div>
        <Input placeholder="Contacto" value={f.contacto} onChange={(e) => set("contacto", e.target.value)} />
        <Input placeholder="Teléfono" value={f.telefono} onChange={(e) => set("telefono", e.target.value)} />
        <Input placeholder="Email (acceso al portal)" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
        <Input placeholder="Contraseña (mín. 6)" type="text" value={f.password} onChange={(e) => set("password", e.target.value)} />
      </div>

      {fichas && (
        <fieldset className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3 text-sm">
          <legend className="px-1 text-xs text-gray-500">
            {fichas.length === 0 ? "No hay ficha con ese documento." : fichas.length === 1 ? "Ficha encontrada por documento — confirma qué hacer:" : `${fichas.length} fichas con ese documento — elige una (no se decide sola):`}
          </legend>
          {fichas.map((x) => (
            <label key={x.id} className="flex items-center gap-2">
              <input type="radio" name="ficha" checked={eleccion === String(x.id)} onChange={() => setEleccion(String(x.id))} />
              Enlazar con «{x.nombre}» ({x.tipo_documento ?? "doc"} {x.nit}{x.email ? ` · ${x.email}` : ""})
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="radio" name="ficha" checked={eleccion === "nueva"} onChange={() => setEleccion("nueva")} />
            Crear una ficha nueva con estos datos
          </label>
        </fieldset>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={crear} disabled={pending || !fichas || !eleccion} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Creando…" : "Crear aliado B2B"}
        </Button>
        {!fichas && <span className="text-xs text-gray-400">Busca la ficha por documento antes de crear.</span>}
        {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
