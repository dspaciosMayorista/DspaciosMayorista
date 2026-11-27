"use client";

// #11 — Presencia reciente. Componente SIN interfaz: registra, de forma acotada, que la persona autenticada está usando la aplicación.
// Sin temporizadores ni sondeo: se evalúa al cargar, al volver a la pestaña y al interactuar (clic/tecla), solo con la pestaña visible; ver lib/presencia/ping.ts (límite por IDENTIDAD, B3-4).
// La llamada va directo a la base (RPC `registrar_presencia`, sesión del usuario) y no pasa por una función de Vercel; la base limita a 1 escritura cada 4 min por persona.
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { crearControladorPresencia, type Almacen } from "@/lib/presencia/ping";

const almacenLocal: Almacen = {
  leer: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
  escribir: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  borrar: (k) => { try { window.localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  claves: () => { try { return Object.keys(window.localStorage); } catch { return []; } },
};

export function PresenciaActiva() {
  useEffect(() => {
    const supabase = createClient();
    const ctl = crearControladorPresencia({
      ahora: () => Date.now(),
      visible: () => document.visibilityState === "visible",
      sesion: async () => { try { return (await supabase.auth.getSession()).data.session?.user.id ?? null; } catch { return null; } },
      enviar: async () => { try { return await supabase.rpc("registrar_presencia"); } catch { return { error: { code: "red" } }; } },
      almacen: almacenLocal,
    });
    const intentar = () => { void ctl.intentar(); };
    const alVolver = () => { if (document.visibilityState === "visible") void ctl.reverificar().then(intentar); };
    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, sesion) => ctl.cambioSesion(sesion?.user.id ?? null));
    intentar();
    document.addEventListener("visibilitychange", alVolver);
    document.addEventListener("pointerdown", intentar, { passive: true });
    document.addEventListener("keydown", intentar, { passive: true });
    return () => {
      suscripcion.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", alVolver);
      document.removeEventListener("pointerdown", intentar);
      document.removeEventListener("keydown", intentar);
    };
  }, []);
  return null;
}
