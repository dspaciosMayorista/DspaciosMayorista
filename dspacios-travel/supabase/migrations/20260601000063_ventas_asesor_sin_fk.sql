-- 063 · Soltar FK de ventas.asesor → asesores(email)
--
-- Los asesores internos ahora son los USUARIOS con rol 'venta' (no la tabla
-- `asesores`). ventas.asesor guarda el identificador/nombre del asesor sin la FK
-- antigua (que rompía al generar el contrato con un usuario que no estaba en
-- `asesores`). Queda como texto libre.

alter table public.ventas drop constraint if exists ventas_asesor_fkey;
