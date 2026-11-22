"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmarCodigoYSolicitarB2B, continuarRegistroB2B, iniciarRegistroB2B, reenviarCodigoB2B } from "./actions";
import { ESPERA_REENVIO_S } from "@/lib/auth/codigoRegistro";
import { almacenNavegador, borrarBorradorRegistro, guardarBorradorRegistro, leerBorradorRegistro } from "@/lib/auth/borradorRegistroB2B";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function RegistroForm({ retomar = false }: { retomar?: boolean }) {
  const [f, setF] = useState({
    tipo: "agencia", tipoDocumento: "NIT", nombre: "", nit: "", contacto: "", email: "", telefono: "", ciudad: "", notas: "", aceptaNotificaciones: true,
    password: "", passwordConfirm: "",
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  // #62: paso 2 = código que llega al correo. El enfriamiento de reenvío es un contador LOCAL (sin red); Auth además limita los envíos.
  const [paso, setPaso] = useState<"datos" | "codigo" | "continuar">("datos");
  const [codigo, setCodigo] = useState("");
  const [espera, setEspera] = useState(0);
  // O-4: tras cambiar la contraseña desde «Continúa tu registro» se vuelve aquí con los datos del formulario (sin contraseña) y se retoma ese paso.
  useEffect(() => {
    if (!retomar) return;
    const d = leerBorradorRegistro(almacenNavegador());
    if (!d) return;
    setF((p) => ({ ...p, ...d, password: "", passwordConfirm: "" }));
    setPaso("continuar");
    setMsg("Contraseña actualizada. Escribe tu contraseña NUEVA para terminar de enviar tu solicitud.");
  }, [retomar]);
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  function enviar() {
    setMsg("");
    start(async () => {
      const r = await iniciarRegistroB2B(f);
      if (r.ok) { setPaso("codigo"); setEspera(ESPERA_REENVIO_S); } else { setMsg(r.error); if (r.continuar) setPaso("continuar"); }
    });
  }
  function verificar() {
    setMsg("");
    start(async () => {
      const { password: _p, passwordConfirm: _c, ...datos } = f;
      const r = await confirmarCodigoYSolicitarB2B({ ...datos, codigo });
      if (r.ok) setOk(true);
      else { setMsg(r.error); if (r.continuar) setPaso("continuar"); }
    });
  }
  // B6: el correo ya quedó verificado pero la solicitud no se completó. Correo + contraseña del registro prueban la titularidad (saber el correo no basta).
  function continuar() {
    setMsg("");
    start(async () => {
      const { passwordConfirm: _c, ...datos } = f;
      const r = await continuarRegistroB2B(datos);
      if (r.ok) { borrarBorradorRegistro(almacenNavegador()); setOk(true); }
      else setMsg(r.error);
    });
  }
  // O-4: se guardan los datos (nunca la contraseña) y se sale al flujo de recuperación ya existente; no hay ningún atajo de acceso.
  function guardarParaRecuperar() {
    guardarBorradorRegistro(almacenNavegador(), f);
  }
  function reenviar() {
    setMsg("");
    start(async () => {
      const r = await reenviarCodigoB2B(f.email);
      if (r.ok) { setEspera(ESPERA_REENVIO_S); setMsg("Si el correo tiene un registro pendiente, te enviamos un código nuevo."); } else setMsg(r.error);
    });
  }

  if (ok) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <div className="text-2xl">✅</div>
        <h2 className="mt-2 text-lg font-semibold text-gray-800">¡Solicitud enviada!</h2>
        <p className="mt-1 text-sm text-gray-600">
          Revisaremos tu registro y te avisaremos cuando se apruebe. Luego podrás iniciar sesión en el Portal B2B.
        </p>
        <Link href="/portal/b2b" className="mt-4 inline-block text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>← Volver al Portal B2B</Link>
      </div>
    );
  }

  if (paso === "continuar") {
    return (
      <div className="space-y-3" data-testid="paso-continuar">
        <h2 className="text-base font-semibold text-gray-800">Continúa tu registro</h2>
        <p className="text-sm text-gray-600">
          Tu correo <strong>{f.email.trim().toLowerCase()}</strong> ya está verificado. Escribe la contraseña que elegiste al registrarte para terminar de enviar tu solicitud de aprobación.
        </p>
        <div>
          <label htmlFor="continuar-password" className={lbl}>Contraseña del registro</label>
          <Input id="continuar-password" type="password" autoComplete="current-password" value={f.password} onChange={(e) => set("password", e.target.value)} />
        </div>
        {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={continuar} disabled={pending || f.password.length < 6 || !f.email.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Continuando…" : "Continuar y enviar solicitud"}
          </Button>
          <Link href="/recuperar?desde=registro" onClick={guardarParaRecuperar} data-testid="olvide-contrasena" className="text-sm font-medium text-[#1D7C9A] hover:underline">
            Olvidé mi contraseña
          </Link>
        </div>
      </div>
    );
  }

  if (paso === "codigo") {
    return (
      <div className="space-y-3" data-testid="paso-codigo">
        <h2 className="text-base font-semibold text-gray-800">Verifica tu correo</h2>
        <p className="text-sm text-gray-600">
          Enviamos un código a <strong>{f.email.trim().toLowerCase()}</strong>. Escríbelo aquí para enviar tu solicitud de aprobación. Si no lo ves, revisa la carpeta de spam.
        </p>
        <div>
          <label htmlFor="codigo-correo" className={lbl}>Código de verificación</label>
          <Input id="codigo-correo" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
        </div>
        {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={verificar} disabled={pending || codigo.length < 6} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Verificando…" : "Verificar y enviar solicitud"}
          </Button>
          <button type="button" onClick={reenviar} disabled={pending || espera > 0} className={`text-sm font-medium ${espera > 0 ? "text-gray-400" : "text-[#1D7C9A]"}`}>
            {espera > 0 ? `Reenviar código en ${espera} s` : "Reenviar código"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>Tipo de aliado</label>
          <select
            value={f.tipo}
            onChange={(e) => {
              // El tipo de documento por defecto sigue al tipo de aliado:
              // una agencia se identifica con NIT, un freelance con cédula.
              set("tipo", e.target.value);
              set("tipoDocumento", e.target.value === "freelance" ? "CC" : "NIT");
            }}
            className={sel}
          >
            <option value="agencia">Agencia de viajes</option>
            <option value="freelance">Freelance</option>
          </select>
        </div>
        <div><label className={lbl}>Nombre / Razón social *</label><Input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} /></div>
        <div>
          <label className={lbl}>Tipo de documento *</label>
          <select value={f.tipoDocumento} onChange={(e) => set("tipoDocumento", e.target.value)} className={sel}>
            <option value="NIT">NIT</option>
            <option value="CC">Cédula de ciudadanía</option>
            <option value="CE">Cédula de extranjería</option>
            <option value="PAS">Pasaporte</option>
          </select>
        </div>
        {/* El documento es la LLAVE para reconocer al aliado: si ya tiene
            contratos que le montó un asesor interno, con este número se
            enlazan a su cuenta al aprobarlo. */}
        <div>
          <label className={lbl}>Número de documento *</label>
          <Input value={f.nit} onChange={(e) => set("nit", e.target.value)} />
          <p className="mt-1 text-[11px] text-gray-400">
            Con este número reconocemos las reservas que ya tengas con nosotros.
          </p>
        </div>
        <div><label className={lbl}>Persona de contacto</label><Input value={f.contacto} onChange={(e) => set("contacto", e.target.value)} /></div>
        <div><label className={lbl}>Correo *</label><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label className={lbl}>Teléfono</label><Input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} /></div>
        <div><label className={lbl}>Ciudad</label><Input value={f.ciudad} onChange={(e) => set("ciudad", e.target.value)} /></div>
        <div><label className={lbl}>Contraseña *</label><Input type="password" value={f.password} onChange={(e) => set("password", e.target.value)} placeholder="mín. 6 caracteres" /></div>
        <div><label className={lbl}>Repetir contraseña *</label><Input type="password" value={f.passwordConfirm} onChange={(e) => set("passwordConfirm", e.target.value)} /></div>
      </div>
      <div><label className={lbl}>Notas</label><textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={2} className={sel} /></div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={f.aceptaNotificaciones} onChange={(e) => set("aceptaNotificaciones", e.target.checked)} />
        Acepto recibir notificaciones (tarifas, confirmaciones, novedades).
      </label>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Button onClick={enviar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Enviando…" : "Continuar: enviar código al correo"}
      </Button>
    </div>
  );
}
