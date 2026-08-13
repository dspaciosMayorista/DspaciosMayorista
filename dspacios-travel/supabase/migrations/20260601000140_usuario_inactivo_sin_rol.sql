-- Migración 140: un usuario con `activo = false` pierde TODOS sus permisos
--
-- Hasta ahora `usuarios.activo` era decorativo: se podía desmarcar en
-- /dashboard/usuarios, pero nada lo verificaba. Un usuario desactivado
-- conservaba su sesión (el JWT sigue siendo válido hasta que expira) y
-- `mi_rol()` seguía devolviendo su rol, así que TODAS las policies de RLS
-- (`mi_rol() in (...)`) lo seguían dejando pasar — incluso llamando la API de
-- Supabase directamente, sin pasar por la app.
--
-- La corrección va en `mi_rol()` en vez de policy por policy: es la función de
-- la que cuelga toda la RLS del proyecto, así que filtrando aquí, un usuario
-- inactivo deja de tener rol y automáticamente falla cualquier policy que
-- dependa de él. Un solo punto, sin tocar las ~100 policies existentes.
--
-- Es seguro porque el cambio SOLO puede denegar más, nunca conceder: ninguna
-- policy del proyecto usa el patrón `mi_rol() is null` (verificado), así que
-- pasar de un rol a null jamás abre un permiso que antes estuviera cerrado.
--
-- `puede_ver_tenant()` no necesita cambio: todas las policies que la usan la
-- combinan con `mi_rol() in (...)`, que ya deniega primero.
--
-- Nota: la policy de lectura de `usuarios` es `id = auth.uid() or mi_rol() =
-- 'superadmin'`, así que un usuario inactivo SIGUE pudiendo leer su propia
-- fila. Eso es intencional: el middleware (proxy.ts) necesita leer su `activo`
-- para mandarlo al login con el aviso correcto.
--
-- ⚠️ Un superadmin que se desactive a sí mismo se deja por fuera (ya no podrá
-- volver a activarse desde la UI). Para recuperarlo hay que poner
-- `activo = true` desde el editor SQL de Supabase (que corre como service_role
-- y no pasa por RLS).

create or replace function public.mi_rol()
returns rol_usuario language sql security definer stable as $$
  select rol from public.usuarios where id = auth.uid() and activo;
$$;
