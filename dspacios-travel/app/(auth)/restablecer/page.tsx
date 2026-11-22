import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { autorizacionRecuperacion } from "@/lib/auth/recuperacionServidor";
import { RestablecerClient } from "./RestablecerClient";

export const metadata = { title: "Nueva contraseña" };
export const dynamic = "force-dynamic";

// Solo con una sesión de RECUPERACIÓN verificada en el servidor (la misma comprobación que exige la acción). Una sesión ordinaria va a «Cambiar contraseña»
// (pide la contraseña actual); un enlace vencido/usado/de otra sesión pide uno nuevo. Esto es comodidad: la autorización real vive en la acción.
export default async function RestablecerPage() {
  const sb = await createClient();
  const aut = await autorizacionRecuperacion(sb);
  if (!aut.ok) {
    if (aut.motivo === "sin_recuperacion") redirect("/cuenta/contrasena");
    // ESTA recuperación ya se reclamó (tabla del servidor). Si Auth confirmó el cambio y la sesión sigue viva (el cierre de sesiones no se confirmó): no se pide otro enlace ni se muestra el formulario,
    // sino el estado parcial con su remedio (reintentar el cierre). Es también lo que ve quien recarga la página en ese estado.
    if (aut.motivo === "consumida") return aut.aplicada ? <RestablecerClient yaActualizada /> : <RestablecerClient incierto />;
    redirect("/recuperar?error=enlace");
  }
  return <RestablecerClient />;
}
