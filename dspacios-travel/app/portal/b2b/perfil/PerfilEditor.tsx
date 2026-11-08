"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";
import { guardarPerfil } from "./actions";

/** Valores tal cual salieron de la base (`null` incluido): son los ORIGINALES con los que se abre el formulario. */
export type ValoresFicha = { nombre: string | null; contacto: string | null; telefono: string | null; email: string | null; direccion: string | null };
export type PropsEditor = {
  tipo: "agencia" | "freelance";
  nombreUsuario: string;
  puedeNombreUsuario: boolean;
  motivoNombreUsuario: string | null;
  ficha: ValoresFicha | null;
  puedeFicha: boolean;
  motivoFicha: string | null;
  camposFicha: string[];
};

const CAJA = "min-w-0 rounded-xl border border-gray-100 bg-white p-4";
const INPUT = "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-[var(--brand-accent)] focus:outline-none";

function Msg({ m }: { m: { ok: boolean; texto: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`mt-2 text-xs ${m.ok ? "text-emerald-700" : "text-red-700"}`}>{m.texto}</p>;
}

export function PerfilEditor(p: PropsEditor) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [nombre, setNombre] = useState(p.nombreUsuario);
  const [msgU, setMsgU] = useState<{ ok: boolean; texto: string } | null>(null);
  const [f, setF] = useState<Record<keyof ValoresFicha, string>>({
    nombre: p.ficha?.nombre ?? "", contacto: p.ficha?.contacto ?? "", telefono: p.ficha?.telefono ?? "", email: p.ficha?.email ?? "", direccion: p.ficha?.direccion ?? "",
  });
  const [confirma, setConfirma] = useState(false);
  const [msgF, setMsgF] = useState<{ ok: boolean; texto: string } | null>(null);
  const cambioNombreFicha = !!p.ficha && f.nombre.trim() !== (p.ficha.nombre ?? "").trim();
  const tiene = (c: string) => p.camposFicha.includes(c);

  function guardarUsuario() {
    empezar(async () => {
      const r = await guardarPerfil({ seccion: "usuario", nombre, esperado: { nombre: p.nombreUsuario } });
      setMsgU(r.ok ? { ok: true, texto: r.cambios.length ? "Nombre actualizado." : "Sin cambios." } : { ok: false, texto: r.error });
      if (r.ok) router.refresh();
    });
  }
  function guardarFicha() {
    empezar(async () => {
      const r = await guardarPerfil({ seccion: "ficha", ...f, confirmaNombreFicha: confirma, esperado: p.ficha ?? undefined });
      setMsgF(r.ok ? { ok: true, texto: r.cambios.length ? "Datos actualizados." : "Sin cambios." } : { ok: false, texto: r.error });
      if (r.ok) { setConfirma(false); router.refresh(); }
    });
  }
  const campo = (id: keyof ValoresFicha, etiqueta: string, tipo = "text") => tiene(id) && (
    <label key={id} className="block text-xs text-gray-500">{etiqueta}
      <input className={INPUT} type={tipo} value={f[id]} onChange={(e) => setF({ ...f, [id]: e.target.value })} maxLength={id === "direccion" ? 200 : id === "email" ? 254 : 120} />
    </label>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className={CAJA} aria-labelledby="ed-usuario">
        <h2 id="ed-usuario" className="mb-2 text-sm font-semibold text-gray-700">Tus datos de usuario</h2>
        {p.puedeNombreUsuario ? (
          <>
            <label className="block text-xs text-gray-500">Tu nombre
              <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} />
            </label>
            <button type="button" disabled={pendiente} onClick={guardarUsuario} className="mt-3 inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
              <Check className="h-4 w-4" aria-hidden /> Guardar nombre
            </button>
          </>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-gray-500"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{p.motivoNombreUsuario}</p>
        )}
        <Msg m={msgU} />
      </section>

      <section className={CAJA} aria-labelledby="ed-ficha">
        <h2 id="ed-ficha" className="mb-2 text-sm font-semibold text-gray-700">{p.tipo === "agencia" ? "Datos de la agencia" : "Tus datos de contacto"}</h2>
        {p.puedeFicha && p.ficha ? (
          <div className="space-y-2">
            {campo("nombre", p.tipo === "agencia" ? "Razón social" : "Nombre")}
            {campo("contacto", "Persona de contacto")}
            {campo("telefono", "Teléfono", "tel")}
            {campo("email", "Correo de contacto", "email")}
            {campo("direccion", "Dirección")}
            <p className="text-[11px] text-gray-400">El correo de contacto no cambia el correo con el que inicias sesión.</p>
            {cambioNombreFicha && (
              <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                <input type="checkbox" checked={confirma} onChange={(e) => setConfirma(e.target.checked)} className="mt-0.5" />
                <span>Este nombre también cambiará en tu cuenta de cobro. Confirmo el cambio.</span>
              </label>
            )}
            <button type="button" disabled={pendiente} onClick={guardarFicha} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
              <Check className="h-4 w-4" aria-hidden /> Guardar datos
            </button>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-gray-500"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{p.motivoFicha ?? "No disponible."}</p>
        )}
        <Msg m={msgF} />
      </section>
    </div>
  );
}
