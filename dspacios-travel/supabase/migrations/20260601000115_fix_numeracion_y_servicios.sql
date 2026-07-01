-- ───────────────────────────────────────────────────────────────────────────
-- 115 · Fix numeración duplicada de la minorista + tabla contrato_servicios
--
--  1) BUG encontrado: crearContrato() usaba el número crudo de
--     siguiente_numero_contrato() (secuencia GLOBAL compartida con la mayorista)
--     SIN el prefijo MIN- al crear un contrato manual en la agencia minorista.
--     Resultado: un contrato nuevo (ej. "00-0497") queda con el MISMO número
--     VISIBLE que uno ya importado ("MIN-00-0497" → se muestra "00-0497"), y
--     encima usa una PK "00-0497" que en cualquier momento puede colisionar con
--     la numeración real de la mayorista. Ya se corrigió el código (crearContrato
--     ahora usa numeroConTenant). Esta función arregla los datos que ya quedaron
--     mal: renumera cada contrato de la minorista sin prefijo MIN- a un número
--     nuevo (con prefijo), re-apuntando TODAS las tablas hijas dinámicamente.
--
--  2) contrato_servicios: para que el contrato manual (dinámico/empaquetado)
--     pueda registrar servicios (asistencia médica, traslados, tours…) CON
--     proveedor y costo — igual que ya existe para hoteles/vuelos — y generar
--     su cuenta por pagar automática.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.contrato_servicios (
  id              bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  tipo            text not null default 'otro', -- asistencia | traslado | tour | otro
  descripcion     text not null,
  proveedor       text,
  costo           numeric(15,2) default 0,
  orden           integer default 0
);
alter table public.contrato_servicios enable row level security;
drop policy if exists "contrato_servicios: interno" on public.contrato_servicios;
create policy "contrato_servicios: interno" on public.contrato_servicios for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','administracion','operaciones','venta'));

-- Renumera UN contrato (todas sus tablas hijas + CxP + facturación) de p_viejo a
-- p_nuevo. No usa UPDATE directo sobre la PK (evita problemas de orden de FKs):
-- duplica la fila de ventas con el número nuevo, mueve las hijas, borra la vieja.
create or replace function public.fn_renumerar_contrato(p_viejo text, p_nuevo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  cols text;
  fk record;
begin
  if public.mi_rol() not in ('superadmin','gerencia') then
    raise exception 'No autorizado para renumerar contratos.';
  end if;
  if exists (select 1 from public.ventas where numero_contrato = p_nuevo) then
    raise exception 'Ya existe un contrato con el número nuevo (%).', p_nuevo;
  end if;

  -- numero_contrato → el nuevo; share_token → uno nuevo (es UNIQUE, no se puede
  -- copiar mientras la fila vieja lo sigue teniendo). El resto, tal cual.
  select string_agg(
    case
      when column_name = 'numero_contrato' then quote_literal(p_nuevo)
      when column_name = 'share_token' then 'gen_random_uuid()'
      else quote_ident(column_name)
    end,
    ', ' order by ordinal_position
  ) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'ventas';

  -- Orden obligatorio: 1) crear la fila nueva (PK nueva) → 2) mover las hijas a
  -- que apunten a ella (ya pueden, la PK existe) → 3) borrar la fila vieja (ya
  -- no la referencia nadie).
  execute format('insert into public.ventas select %s from public.ventas where numero_contrato = %L', cols, p_viejo);

  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.ventas'::regclass
      and c.conrelid <> 'public.ventas'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using p_nuevo, p_viejo;
  end loop;

  delete from public.ventas where numero_contrato = p_viejo;
end;
$$;

-- Encuentra y renumera TODOS los contratos de la minorista que quedaron sin el
-- prefijo MIN- (el bug de arriba). Devuelve la tabla de cambios (viejo → nuevo)
-- para que quede registro de qué se corrigió. Ejecutar UNA vez:
--   select * from public.fn_arreglar_numeros_minorista();
create or replace function public.fn_arreglar_numeros_minorista()
returns table(numero_viejo text, numero_nuevo text) language plpgsql security definer set search_path = public as $$
declare
  r record; nuevo text;
begin
  if public.mi_rol() not in ('superadmin','gerencia') then
    raise exception 'No autorizado.';
  end if;
  for r in
    select v.numero_contrato from public.ventas v
    where v.tenant = 'minorista' and v.numero_contrato not like 'MIN-%'
    order by v.numero_contrato
  loop
    nuevo := 'MIN-' || public.siguiente_numero_contrato();
    perform public.fn_renumerar_contrato(r.numero_contrato, nuevo);
    numero_viejo := r.numero_contrato;
    numero_nuevo := nuevo;
    return next;
  end loop;
end;
$$;

grant execute on function public.fn_renumerar_contrato(text, text) to authenticated;
grant execute on function public.fn_arreglar_numeros_minorista() to authenticated;
