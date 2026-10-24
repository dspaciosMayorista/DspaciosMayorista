-- ───────────────────────────────────────────────────────────────────────────
-- 230 · DESPUÉS de la corrección: la oferta #63 ABIERTA del paquete 70 no se puede aceptar (falla cerrado) y p63_oferta no se tocó.
-- Todo en una transacción que termina en ROLLBACK. Base desechable local (orden: fixture, fixture de oferta, corrección, este archivo).
--   A) tal como queda el paquete 70 (inactivo): aceptar_oferta_63 se rechaza.
--   B) aun si alguien reactivara el paquete 70 con la publicación al día: se rechaza porque la revisión de la fuente cambió.
-- ───────────────────────────────────────────────────────────────────────────
begin;

create temp table r (ord int, control text, valor text, esperado text, estado text);

insert into r select 1, 'oferta_1_sigue_abierta_sin_aceptacion',
  (select estado || ' / aceptaciones=' || (select count(*) from public.p63_aceptacion where oferta_id = 1) from public.p63_oferta where id = 1), 'abierta / aceptaciones=0',
  case when (select estado from public.p63_oferta where id = 1) = 'abierta' and not exists (select 1 from public.p63_aceptacion) then 'OK' else 'REVISAR' end;
insert into r select 2, 'la_revision_de_la_fuente_cambio_tras_la_correccion',
  (select o.rev_fuente || ' (oferta) vs ' || p.tarifario_revision_fuente || ' (paquete)' from public.p63_oferta o, public.armado_paquetes p where o.id = 1 and p.id = 70), 'distintas',
  case when (select o.rev_fuente <> p.tarifario_revision_fuente from public.p63_oferta o, public.armado_paquetes p where o.id = 1 and p.id = 70) then 'OK' else 'REVISAR' end;

-- A) paquete 70 inactivo.
do $$
declare v_ok boolean := false; v_msg text; v_cot bigint;
begin
  select cotizacion_id into v_cot from public.p63_oferta where id = 1;
  begin
    perform public.aceptar_oferta_63(v_cot, 'mayorista', '00000000-0000-0000-0000-000000230001'::uuid, 'h-230', 'hf-230');
    v_ok := true;
  exception when others then v_msg := sqlerrm;
  end;
  insert into r values (3, 'A_aceptar_con_el_paquete_70_inactivo_falla_cerrado', coalesce(v_msg, 'ACEPTÓ'), 'p63_oferta_cambio...', case when not v_ok and v_msg like 'p63_oferta_cambio%' then 'OK' else 'REVISAR' end);
end $$;

-- B) paquete 70 reactivado y con la publicación "al día" (solo dentro de esta transacción): falla por la revisión de la fuente.
-- (un trigger del paquete reinicia la publicación al activarlo: por eso tres UPDATE separados)
update public.armado_paquetes set activo = true, trm_oferta = 3200 where id = 70;
update public.armado_paquetes set tarifario_revision_publicada = 5, tarifario_generacion_publicada = 5 where id = 70;
update public.armado_paquetes set tarifario_snapshot_publicable = true where id = 70;
do $$
declare v_ok boolean := false; v_msg text; v_cot bigint;
begin
  select cotizacion_id into v_cot from public.p63_oferta where id = 1;
  begin
    perform public.aceptar_oferta_63(v_cot, 'mayorista', '00000000-0000-0000-0000-000000230001'::uuid, 'h-230', 'hf-230');
    v_ok := true;
  exception when others then v_msg := sqlerrm;
  end;
  insert into r values (4, 'B_aceptar_con_el_paquete_reactivado_falla_por_cambio_de_fuente', coalesce(v_msg, 'ACEPTÓ'), 'p63_oferta_cambio: una fuente...',
                        case when not v_ok and v_msg like 'p63_oferta_cambio: una fuente%' then 'OK' else 'REVISAR' end);
end $$;

insert into r select 5, 'sigue_sin_haber_aceptaciones_ni_ventas',
  (select count(*) from public.p63_aceptacion)::text || ' aceptaciones / ' || (select count(*) from public.ventas where paquete_armado_id in (70, 71))::text || ' ventas', '0 / 0',
  case when not exists (select 1 from public.p63_aceptacion) and not exists (select 1 from public.ventas where paquete_armado_id in (70, 71)) then 'OK' else 'REVISAR' end;

select control, valor, esperado, estado from r order by ord;
rollback;
