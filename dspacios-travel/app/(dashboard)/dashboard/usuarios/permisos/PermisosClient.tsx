"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { guardarPermisosRol, guardarPermisosUsuario } from "./actions";

type Permiso = { consultar: boolean; modificar: boolean; eliminar: boolean };
type Modulo = { key: string; label: string };
type Rol = { key: string; label: string };
type Usuario = { id: string; nombre: string; rol: string };

const VACIO: Permiso = { consultar: false, modificar: false, eliminar: false };

export function PermisosClient({
  modulos, roles, porRol, usuarios, porUsuario,
}: {
  modulos: Modulo[];
  roles: Rol[];
  porRol: Record<string, Record<string, Permiso>>;
  usuarios: Usuario[];
  porUsuario: Record<string, Record<string, Permiso>>;
}) {
  const router = useRouter();

  // ── Sección por ROL ─────────────────────────────────────────────────────────
  const [rol, setRol] = useState(roles.find((r) => r.key !== "superadmin")?.key ?? roles[0].key);
  const [estadoRol, setEstadoRol] = useState<Record<string, Permiso>>(() => clon(porRol[rol]));
  const [rolPend, startRol] = useTransition();
  const [rolMsg, setRolMsg] = useState("");

  function cambiarRol(nuevo: string) {
    setRol(nuevo);
    setEstadoRol(clon(porRol[nuevo]));
    setRolMsg("");
  }
  const togRol = (mod: string, k: keyof Permiso) =>
    setEstadoRol((p) => ({ ...p, [mod]: { ...p[mod], [k]: !p[mod][k] } }));

  function guardarRol() {
    setRolMsg("");
    startRol(async () => {
      const filas = modulos.map((m) => ({ modulo: m.key, ...estadoRol[m.key] }));
      const r = await guardarPermisosRol(rol, filas);
      if (r.ok) { setRolMsg("✓ Guardado"); router.refresh(); } else setRolMsg(r.error);
    });
  }

  // ── Sección por USUARIO (override) ──────────────────────────────────────────
  const [usrId, setUsrId] = useState(usuarios[0]?.id ?? "");
  const usrActual = usuarios.find((u) => u.id === usrId);
  // Estado: por módulo, { personalizado, permiso }
  const initUsr = useMemo(() => {
    const ov = porUsuario[usrId] ?? {};
    const e: Record<string, { pers: boolean; p: Permiso }> = {};
    for (const m of modulos) e[m.key] = ov[m.key] ? { pers: true, p: { ...ov[m.key] } } : { pers: false, p: { ...VACIO } };
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usrId]);
  const [estadoUsr, setEstadoUsr] = useState(initUsr);
  const [usrKey, setUsrKey] = useState(usrId); // para re-sincronizar al cambiar usuario
  if (usrKey !== usrId) { setUsrKey(usrId); setEstadoUsr(initUsr); }
  const [usrPend, startUsr] = useTransition();
  const [usrMsg, setUsrMsg] = useState("");

  const togUsrPers = (mod: string) =>
    setEstadoUsr((p) => ({ ...p, [mod]: { ...p[mod], pers: !p[mod].pers } }));
  const togUsr = (mod: string, k: keyof Permiso) =>
    setEstadoUsr((p) => ({ ...p, [mod]: { ...p[mod], p: { ...p[mod].p, [k]: !p[mod].p[k] } } }));

  function guardarUsr() {
    setUsrMsg("");
    startUsr(async () => {
      const filas = modulos.filter((m) => estadoUsr[m.key].pers).map((m) => ({ modulo: m.key, ...estadoUsr[m.key].p }));
      const r = await guardarPermisosUsuario(usrId, filas);
      if (r.ok) { setUsrMsg("✓ Guardado"); router.refresh(); } else setUsrMsg(r.error);
    });
  }

  const th = "px-3 py-2 text-center text-xs font-medium text-gray-500";
  const esSuper = rol === "superadmin";

  return (
    <div className="space-y-8">
      {/* Por rol */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Permisos por rol</h2>
          <select value={rol} onChange={(e) => cambiarRol(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        {esSuper ? (
          <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">Superadmin siempre tiene acceso total a todo.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-3 py-2 text-xs font-medium text-gray-500">Módulo</th>
                    <th className={th}>Consultar</th><th className={th}>Modificar</th><th className={th}>Eliminar</th>
                  </tr>
                </thead>
                <tbody>
                  {modulos.map((m) => (
                    <tr key={m.key} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-700">{m.label}</td>
                      {(["consultar", "modificar", "eliminar"] as const).map((k) => (
                        <td key={k} className="px-3 py-2 text-center">
                          <input type="checkbox" checked={estadoRol[m.key][k]} onChange={() => togRol(m.key, k)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button onClick={guardarRol} disabled={rolPend} style={{ backgroundColor: "var(--brand-primary)" }}>
                {rolPend ? "Guardando…" : "Guardar permisos del rol"}
              </Button>
              {rolMsg && <span className={rolMsg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{rolMsg}</span>}
            </div>
          </>
        )}
      </section>

      {/* Por usuario (acceso especial) */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Acceso especial por usuario</h2>
          <select value={usrId} onChange={(e) => setUsrId(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.rol}</option>)}
          </select>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Marca <b>Personalizado</b> en un módulo para sobre-escribir lo que da su rol. Los que no marques siguen usando el rol.
        </p>
        {usrActual && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-3 py-2 text-xs font-medium text-gray-500">Módulo</th>
                    <th className={th}>Personalizado</th><th className={th}>Consultar</th><th className={th}>Modificar</th><th className={th}>Eliminar</th>
                  </tr>
                </thead>
                <tbody>
                  {modulos.map((m) => {
                    const e = estadoUsr[m.key];
                    return (
                      <tr key={m.key} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-700">{m.label}</td>
                        <td className="px-3 py-2 text-center"><input type="checkbox" checked={e.pers} onChange={() => togUsrPers(m.key)} /></td>
                        {(["consultar", "modificar", "eliminar"] as const).map((k) => (
                          <td key={k} className="px-3 py-2 text-center">
                            <input type="checkbox" disabled={!e.pers} checked={e.p[k]} onChange={() => togUsr(m.key, k)} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button onClick={guardarUsr} disabled={usrPend} style={{ backgroundColor: "var(--brand-primary)" }}>
                {usrPend ? "Guardando…" : "Guardar acceso del usuario"}
              </Button>
              {usrMsg && <span className={usrMsg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{usrMsg}</span>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function clon(p: Record<string, Permiso>): Record<string, Permiso> {
  const o: Record<string, Permiso> = {};
  for (const k in p) o[k] = { ...p[k] };
  return o;
}
