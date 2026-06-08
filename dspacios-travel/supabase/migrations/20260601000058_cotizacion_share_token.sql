-- 058 · Link público para compartir/descargar la COTIZACIÓN
--
-- Igual que los contratos (migración 011): cada cotización tiene un token uuid
-- aleatorio para verla sin login en /cot/<token>. El cliente del tarifario puede
-- guardar/imprimir su cotización y mostrarla en la oficina. Imposible de adivinar.

alter table public.cotizaciones
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists cotizaciones_share_token_key
  on public.cotizaciones (share_token);
