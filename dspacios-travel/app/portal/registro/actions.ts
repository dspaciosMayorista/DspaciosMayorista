"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClienteSinSesion } from "@/lib/supabase/sinSesion";
import {
  esRegistroPendienteSinVerificar, esRegistroVerificadoSinSolicitud, MAX_INTENTOS_CODIGO, MSG_CODIGO_AGOTADO, MSG_CODIGO_INVALIDO, MSG_CONTINUAR, MSG_CONTINUAR_INVALIDO,
  MSG_EN_CURSO, MSG_ERROR_TEMPORAL, MSG_ESPERA, MSG_VERIFICADO_PENDIENTE, normalizarCodigo, type RegistroPendiente,
} from "@/lib/auth/codigoRegistro";

// #62 — registro B2B en DOS pasos. (1) `iniciarRegistroB2B`: crea la cuenta SIN verificar e INACTIVA y manda el código al correo. (2)
// `confirmarCodigoYSolicitarB2B`: solo con el código correcto (Auth confirma el correo) se registra la solicitud de aprobación. La solicitud
// NUNCA se crea sin `email_confirmed_at` en Auth; ese dato lo decide el servidor, no el navegador. La cuenta sigue inactiva hasta que alguien la apruebe.
//
// B5/B6 — COORDINACIÓN. Cada transición pasa por una función de base de datos (migración 324, `registro_b2b_*`) que toma el candado de FILA del registro y decide con el
// estado ACTUAL: (a) el intento se RESERVA antes de llamar a Auth y se resuelve después; (b) esta capa NUNCA borra cuentas de Auth: el borrado lo hace la propia base, en la misma
// transacción y solo si el correo sigue sin confirmar (`registro_b2b_descartar` / quinto rechazo), así que ni una verificación tardía de Auth ni el paso del tiempo pueden dejar una
// cuenta confirmada borrada; (c) solo un rechazo DEFINITIVO de Auth (4xx) cuenta como intento fallido: un resultado desconocido (corte de red, 5xx, tiempo agotado) no cuenta, y como Auth
// pudo haber confirmado el correo antes de perderse la respuesta, se completa preguntando a la base (la autoridad); (d) la solicitud se crea con `registro_b2b_completar`, idempotente y
// reanudable: si algo falla DESPUÉS de verificar, la cuenta queda verificada y se completa con `continuarRegistroB2B`, que exige correo + contraseña (saber el correo NO basta).
// Llamadas por acción: paso 2 con código incorrecto = 3 lecturas + reclamar + verificar + resolver (el contador ya no se escribe en Auth); con código correcto = lo mismo + completar.
type Result = { ok: true } | { ok: false; error: string; continuar?: boolean };

export type SolicitudB2BInput = {
  tipo: string; nombre: string; nit: string; contacto: string; email: string;
  telefono: string; ciudad: string; notas: string; aceptaNotificaciones: boolean;
  password: string; passwordConfirm: string;
  tipoDocumento?: string;   // NIT / CC / CE / PAS — `nit` es el NÚMERO
};
export type DatosSolicitudB2B = Omit<SolicitudB2BInput, "password" | "passwordConfirm">;

type Admin = ReturnType<typeof createAdminClient>;
type Pendiente = RegistroPendiente & { id: string; rol: string | null; nombre: string | null };
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

const limitado = (e: { status?: number; code?: string } | null | undefined) => e?.status === 429 || e?.code === "over_email_send_rate_limit" || e?.code === "over_request_rate_limit";

/** Rechazo DEFINITIVO de Auth = respuesta 4xx del servicio (código incorrecto/vencido). Todo lo demás (sin estado, 5xx, red, tiempo agotado) deja el resultado DESCONOCIDO. */
const rechazoDefinitivo = (e: { status?: number } | null | undefined) => typeof e?.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 429;

/** Llama una función registro_b2b_* (migración 324, aún fuera de types/database.ts). Devuelve el valor como texto, o null si la llamada falló (nunca inventa un resultado). */
async function llamar(admin: Admin, fn: string, args: Record<string, unknown>): Promise<string | null> {
  const rpc = (admin as unknown as { rpc: Rpc }).rpc.bind(admin);
  const { data, error } = await rpc(fn, args);
  if (error || data === null || data === undefined) return null;
  return String(data);
}

/** Datos del formulario que el servidor guarda con el registro (sin contraseña) para poder completar la solicitud sin volver a pedirlos. */
function datosParaEstado(d: Partial<DatosSolicitudB2B>) {
  return {
    nombre: (d.nombre ?? "").trim(), nit: (d.nit ?? "").trim(), tipo_documento: (d.tipoDocumento ?? "").trim(), contacto: (d.contacto ?? "").trim(),
    telefono: (d.telefono ?? "").trim(), ciudad: (d.ciudad ?? "").trim(), notas: (d.notas ?? "").trim(), acepta_notificaciones: d.aceptaNotificaciones === true,
  };
}

/** Lee el registro con ese correo y su estado en Auth. app_metadata solo lo escribe el servidor (el usuario no puede falsificar el marcador). */
async function leerPendiente(admin: Admin, email: string): Promise<Pendiente | null> {
  const { data: fila } = await admin.from("usuarios").select("id, rol, nombre, activo").eq("email", email).maybeSingle();
  if (!fila) return null;
  const { data: au } = await admin.auth.admin.getUserById(fila.id);
  if (!au?.user) return null;
  const { data: sol } = await admin.from("b2b_solicitudes").select("id").eq("usuario_id", fila.id).limit(1).maybeSingle();
  const meta = (au.user.app_metadata ?? {}) as { registro_b2b_codigo?: unknown; intentos_codigo?: unknown };
  return {
    id: fila.id, rol: fila.rol ?? null, nombre: fila.nombre ?? null,
    flag: meta.registro_b2b_codigo === true, confirmado: !!au.user.email_confirmed_at, activo: fila.activo ?? null,
    intentos: Number.isInteger(meta.intentos_codigo) ? (meta.intentos_codigo as number) : 0, tieneSolicitud: !!sol,
  };
}

/**
 * ÚNICO camino que elimina una cuenta del registro, y quien elimina es la BASE: `registro_b2b_descartar` borra de forma atómica y solo si el correo sigue sin confirmar en ese instante.
 * Esta capa no llama a deleteUser de Auth (entre «autorizar» y «borrar» desde aquí quedaba una ventana en la que una verificación tardía podía confirmar la cuenta).
 * Devuelve el veredicto para responder con el mensaje correcto: «borrada» (ya no existe), «verificado» (se conserva), «ocupado» (verificación reciente en curso) o «error».
 */
async function descartarSiAutoriza(admin: Admin, id: string): Promise<"borrada" | "verificado" | "ocupado" | "error"> {
  const v = await llamar(admin, "registro_b2b_descartar", { p_usuario: id });
  if (v === "borrada" || v === "sin_cuenta") return "borrada";
  if (v === "verificado" || v === "completado") return "verificado";
  if (v === "ocupado") return "ocupado";
  return "error";
}

export async function iniciarRegistroB2B(input: SolicitudB2BInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre / razón social es obligatorio." };
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "El correo es obligatorio." };
  if (!input.nit.trim()) return { ok: false, error: "El número de documento (NIT o cédula) es obligatorio." };
  if (input.password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };
  if (input.password !== input.passwordConfirm) return { ok: false, error: "Las contraseñas no coinciden." };

  const tipo = input.tipo === "freelance" ? "freelance" : "agencia";
  const admin = createAdminClient();

  // Candado anti-suplantación: los contratos de un aliado B2B se vinculan (para
  // datos históricos sin b2b_usuario_id) también por nombre de agencia/freelance
  // en texto libre. Si alguien se registra con el MISMO nombre que un aliado ya
  // aprobado, vería sus contratos y comisiones. Bloqueamos el duplicado aquí.
  // (`neq email`: un intento anterior sin verificar del MISMO correo no bloquea reintentar.)
  const { data: dup } = await admin
    .from("usuarios")
    .select("id")
    .in("rol", ["agencia", "freelance"])
    .ilike("nombre", input.nombre.trim())
    .neq("email", email)
    .limit(1)
    .maybeSingle();
  if (dup) {
    return {
      ok: false,
      error: "Ya existe una cuenta de aliado registrada con ese nombre. Si es tu empresa, contáctanos para verificar el acceso en vez de crear una cuenta nueva.",
    };
  }

  // Un intento anterior ABANDONADO (sin verificar, inactivo, sin solicitud, marcado por este flujo) se reemplaza SOLO si la base autoriza el descarte; cualquier otra cuenta con ese correo se respeta.
  const previo = await leerPendiente(admin, email);
  if (previo) {
    // Correo ya verificado por este flujo pero sin solicitud (se interrumpió después del código): no se reemplaza ni se borra; se continúa con la contraseña.
    if (esRegistroVerificadoSinSolicitud(previo)) return { ok: false, continuar: true, error: MSG_CONTINUAR };
    if (!esRegistroPendienteSinVerificar(previo)) return { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." };
    const d = await descartarSiAutoriza(admin, previo.id);
    if (d === "verificado") return { ok: false, continuar: true, error: MSG_CONTINUAR };
    if (d === "ocupado") return { ok: false, error: MSG_EN_CURSO };
    if (d === "error") return { ok: false, error: MSG_ERROR_TEMPORAL };
  }

  // Crea la cuenta SIN verificar (queda PENDIENTE: inactiva hasta que la apruebe un admin y, además, solo pide aprobación tras verificar el correo).
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: false,
    user_metadata: { nombre: input.nombre.trim(), rol: tipo },
    app_metadata: { registro_b2b_codigo: true, intentos_codigo: 0 },
  });
  if (ce || !created?.user) {
    const m = (ce?.message ?? "").toLowerCase();
    if (m.includes("already") || m.includes("registered") || m.includes("exists"))
      return { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." };
    return { ok: false, error: ce?.message ?? "No se pudo crear la cuenta." };
  }
  const uid = created.user.id;

  // El trigger crea el perfil; lo dejamos como aliado pendiente (inactivo) con
  // su comisión por defecto (12% agencia, 11% freelance).
  //
  // ⚠️ Falla CERRADO. Desde la migración 193 el trigger (`handle_new_user`)
  // ya crea el perfil INACTIVO (sin intervalo activo); antes de la 193 lo
  // creaba activo. Este update queda como segunda barrera y para fijar
  // nombre/comisión: se exige que afecte exactamente la fila del usuario; si
  // no, se descarta la cuenta recién creada (la fila de `usuarios` cae en
  // cascada) y no se deja nada a medias.
  const { data: inactivado, error: ue } = await admin.from("usuarios").update({
    rol: tipo, activo: false, nombre: input.nombre.trim(),
    pct_comision: tipo === "agencia" ? 0.12 : 0.11,
  }).eq("id", uid).select("id");
  if (ue || inactivado?.length !== 1) {
    await descartarSiAutoriza(admin, uid);
    return { ok: false, error: "No se pudo registrar tu solicitud. Intenta de nuevo en unos minutos." };
  }

  // Estado serializado del registro + datos del formulario (para poder completar la solicitud sin pedirlos otra vez). Sin él no hay coordinación: se descarta la cuenta nueva.
  if ((await llamar(admin, "registro_b2b_iniciar", { p_usuario: uid, p_datos: datosParaEstado(input) })) !== "ok") {
    await descartarSiAutoriza(admin, uid);
    return { ok: false, error: MSG_ERROR_TEMPORAL };
  }

  // Código al correo (plantilla «Confirm signup» con {{ .Token }}, configuración del proyecto en Supabase). Sin código no hay cómo continuar: se descarta la cuenta.
  const { error: re } = await createClienteSinSesion().auth.resend({ type: "signup", email });
  if (re) {
    await descartarSiAutoriza(admin, uid);
    return { ok: false, error: limitado(re) ? MSG_ESPERA : "No pudimos enviar el código a tu correo. Revisa la dirección e intenta de nuevo en unos minutos." };
  }
  return { ok: true };
}

/** Reenvía el código. Respuesta neutra: no revela si el correo tiene o no un registro pendiente. Solo reenvía si la base confirma que sigue pendiente y sin verificar. */
export async function reenviarCodigoB2B(emailRaw: string): Promise<Result> {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "El correo es obligatorio." };
  const admin = createAdminClient();
  const pend = await leerPendiente(admin, email);
  if (!pend || !esRegistroPendienteSinVerificar(pend)) return { ok: true };
  if ((await llamar(admin, "registro_b2b_permitir_reenvio", { p_usuario: pend.id })) !== "true") return { ok: true };
  const { error } = await createClienteSinSesion().auth.resend({ type: "signup", email });
  if (error) return { ok: false, error: limitado(error) ? MSG_ESPERA : "No pudimos reenviar el código. Intenta de nuevo en unos minutos." };
  return { ok: true };
}

/** Crea la solicitud (idempotente) a través de la base. Nunca borra nada: ante cualquier fallo la cuenta verificada se conserva para completar con `continuarRegistroB2B`. */
async function completar(admin: Admin, id: string, datos: Partial<DatosSolicitudB2B>): Promise<Result> {
  const r = await llamar(admin, "registro_b2b_completar", { p_usuario: id, p_datos: datosParaEstado(datos) });
  if (r === "creada" || r === "ya_existia") return { ok: true };
  if (r === "sin_verificar") return { ok: false, error: MSG_CODIGO_INVALIDO };
  if (r === "descartando") return { ok: false, error: MSG_CODIGO_AGOTADO };
  if (r === "no_aplica") return { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." };
  return { ok: false, continuar: true, error: MSG_VERIFICADO_PENDIENTE };
}

export async function confirmarCodigoYSolicitarB2B(input: DatosSolicitudB2B & { codigo: string }): Promise<Result> {
  const email = String(input.email ?? "").trim().toLowerCase();
  const codigo = normalizarCodigo(input.codigo);
  if (!email || !codigo) return { ok: false, error: MSG_CODIGO_INVALIDO };
  const admin = createAdminClient();

  const pend = await leerPendiente(admin, email);
  // Correo ya verificado por este flujo y sin solicitud: el código ya no sirve; se continúa con la contraseña (no se completa solo por conocer el correo).
  if (pend && esRegistroVerificadoSinSolicitud(pend)) return { ok: false, continuar: true, error: MSG_CONTINUAR };
  // Cualquier cosa que no sea un registro pendiente de ESTE flujo responde igual que un código malo (sin revelar qué cuentas existen).
  if (!pend || !esRegistroPendienteSinVerificar(pend)) return { ok: false, error: MSG_CODIGO_INVALIDO };

  // Reserva el intento ANTES de llamar a Auth (la base cuenta y serializa; antes era leer-sumar-escribir en app_metadata).
  const reclamo = await llamar(admin, "registro_b2b_reclamar_intento", { p_usuario: pend.id, p_max: MAX_INTENTOS_CODIGO, p_previos: pend.intentos });
  if (reclamo === "verificado") return { ok: false, continuar: true, error: MSG_CONTINUAR };
  if (reclamo === "completado") return { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." };
  if (reclamo === "en_curso") return { ok: false, error: MSG_EN_CURSO };
  if (reclamo === "agotado") return { ok: false, error: MSG_CODIGO_AGOTADO };   // la base ya borró la cuenta sin verificar (cinco rechazos definitivos)
  if (reclamo === "sin_cuenta") return { ok: false, error: MSG_CODIGO_INVALIDO };   // la cuenta ya no existe (se reinició el registro)
  if (reclamo !== "ok") return { ok: false, error: MSG_ERROR_TEMPORAL };

  const { error: ve } = await createClienteSinSesion().auth.verifyOtp({ email, token: codigo, type: "signup" });
  if (ve) {
    if (limitado(ve)) {
      await llamar(admin, "registro_b2b_resolver_intento", { p_usuario: pend.id, p_resultado: "omitido", p_max: MAX_INTENTOS_CODIGO });   // la limitación de frecuencia no cuenta como intento
      return { ok: false, error: MSG_ESPERA };
    }
    if (!rechazoDefinitivo(ve)) {
      // RESULTADO DESCONOCIDO (corte de red, 5xx, tiempo agotado): Auth pudo haber confirmado el correo antes de perderse la respuesta. No cuenta como intento fallido y no se
      // supone nada: se libera la reserva y se pregunta a la base (autoridad). Si el correo SÍ quedó confirmado, el registro se completa; si no, se pide reintentar.
      await llamar(admin, "registro_b2b_resolver_intento", { p_usuario: pend.id, p_resultado: "omitido", p_max: MAX_INTENTOS_CODIGO });
      const c = await completar(admin, pend.id, input);
      return c.ok || c.continuar ? c : { ok: false, error: MSG_ERROR_TEMPORAL };
    }
    const v = await llamar(admin, "registro_b2b_resolver_intento", { p_usuario: pend.id, p_resultado: "fallo", p_max: MAX_INTENTOS_CODIGO });
    if (v === "descartada") return { ok: false, error: MSG_CODIGO_AGOTADO };   // quinto rechazo definitivo: la base borró la cuenta sin verificar
    // Otra petición verificó la cuenta mientras esta fallaba: NO se borra ni se completa con un código ajeno; se pide continuar con la contraseña.
    if (v === "verificado" || v === "completado") return { ok: false, continuar: v === "verificado", error: v === "verificado" ? MSG_CONTINUAR : MSG_CODIGO_INVALIDO };
    return { ok: false, error: MSG_CODIGO_INVALIDO };
  }

  // Auth confirmó el correo. Se anota (si esta llamada falla no importa: `registro_b2b_completar` revalida la verificación en la base) y se completa de forma idempotente.
  await llamar(admin, "registro_b2b_resolver_intento", { p_usuario: pend.id, p_resultado: "exito", p_max: MAX_INTENTOS_CODIGO });
  return completar(admin, pend.id, input);
}

/**
 * B6 — continuación segura tras un fallo POSTERIOR a la verificación del código. La prueba de titularidad es CORREO + CONTRASEÑA del registro (Auth rechaza el inicio de sesión
 * mientras el correo no esté verificado): conocer solo el correo no autoriza a completar el registro de otra persona. Idempotente: repetirla no duplica la solicitud ni borra nada.
 */
export async function continuarRegistroB2B(input: { email: string; password: string } & Partial<DatosSolicitudB2B>): Promise<Result> {
  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  if (!email || !password) return { ok: false, error: MSG_CONTINUAR_INVALIDO };
  const { data, error } = await createClienteSinSesion().auth.signInWithPassword({ email, password });
  if (error || !data?.user) return { ok: false, error: limitado(error) ? MSG_ESPERA : MSG_CONTINUAR_INVALIDO };
  return completar(createAdminClient(), data.user.id, input);
}
