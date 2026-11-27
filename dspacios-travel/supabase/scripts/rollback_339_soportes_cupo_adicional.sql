-- 339 · ROLLBACK (una transacción). Restaura la función f281_soportes_insert EXACTA de la migración 281 (límite: soportes vigentes <= abonos).
-- Se NIEGA, sin tocar nada, si la función actual no es la que dejó la 339 (cambió después: no se sobrescribe en silencio un cambio posterior).
-- NO borra, retira ni modifica ningún soporte ni aviso: la evidencia se conserva. Efecto: los contratos que tengan más soportes vigentes que abonos quedan «excedidos»
-- bajo la regla vieja (siguen pudiendo reemplazar y retirar; solo no admiten nuevos). El conteo se informa al final como NOTICE y como resultado.
begin;
do $$
declare v_md5 text;
begin
  if to_regprocedure('public.f281_soportes_insert()') is null then
    raise exception '339 rollback: falta f281_soportes_insert().';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()');
  if v_md5 is distinct from '9f00935a6536eabed5bdff9c496c45a8' then
    raise exception '339 rollback: f281_soportes_insert ya no es la versión de la 339 (md5 actual %); no se sobrescribe. Revisa y restaura a mano.', v_md5;
  end if;
end $$;

create or replace function public.f281_soportes_insert() returns trigger language plpgsql set search_path = '' as $$
declare
  v_tenant text; v_abonos bigint; v_vigentes bigint; o public.contrato_soportes_pago;
begin
  select v.tenant into v_tenant from public.ventas v where v.numero_contrato = new.numero_contrato;
  if not found then
    raise exception 'SOPORTE_CONTRATO_INEXISTENTE: el contrato % no existe.', new.numero_contrato using errcode = 'F4510';
  end if;
  if new.tenant is distinct from v_tenant then
    raise exception 'SOPORTE_TENANT: el soporte declara la agencia % y el contrato % es de %.', new.tenant, new.numero_contrato, v_tenant using errcode = 'F4514';
  end if;
  if new.archivado_en is not null then
    raise exception 'SOPORTE_NACE_VIGENTE: un soporte nuevo no nace archivado.' using errcode = 'F4516';
  end if;
  if not new.vigente then
    raise exception 'SOPORTE_NACE_VIGENTE: un soporte nuevo nace vigente.' using errcode = 'F4516';
  end if;

  if new.reemplaza_id is null then
    select count(*) into v_abonos from public.abonos a where a.numero_contrato = new.numero_contrato;
    select count(*) into v_vigentes from public.contrato_soportes_pago s where s.numero_contrato = new.numero_contrato and s.vigente and s.archivado_en is null;
    if v_vigentes + 1 > v_abonos then
      raise exception 'SOPORTE_LIMITE: el contrato % tiene % abono(s) y % soporte(s) vigente(s); no caben más. Reemplaza o retira uno.', new.numero_contrato, v_abonos, v_vigentes using errcode = 'F4515';
    end if;
  else
    -- Sustitución: NO crece el conteo vigente. Se verifica por estructura, sin banderas.
    select * into o from public.contrato_soportes_pago s where s.id = new.reemplaza_id;
    if o.id is null or o.numero_contrato <> new.numero_contrato or o.vigente or o.archivado_en is not null
       or o.motivo_retiro is distinct from 'reemplazo' or o.retirado_en is distinct from now() then
      raise exception 'SOPORTE_SUSTITUCION: la fila % no está retirada por reemplazo en esta transacción para el contrato %.', new.reemplaza_id, new.numero_contrato using errcode = 'F4516';
    end if;
  end if;
  return new;
end $$;

do $$
declare v_md5 text; v_exc bigint;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()');
  if v_md5 is distinct from 'b0ca477d9cd9917c888a93ff0cb208a4' then
    raise exception '339 rollback: la función restaurada NO coincide con la de la 281 (md5 %).', v_md5;
  end if;
  select count(*) into v_exc from (
    select s.numero_contrato from public.contrato_soportes_pago s
     where s.vigente and s.archivado_en is null
     group by s.numero_contrato
    having count(*) > (select count(*) from public.abonos a where a.numero_contrato = s.numero_contrato)) x;
  raise notice '339 rollback: f281_soportes_insert restaurada (281). Contratos con más soportes vigentes que abonos (excedidos bajo la regla vieja; nada se borró): %', v_exc;
end $$;

select 'ROLLBACK 339 OK' as resultado,
       (select count(*) from (select s.numero_contrato from public.contrato_soportes_pago s where s.vigente and s.archivado_en is null group by s.numero_contrato
         having count(*) > (select count(*) from public.abonos a where a.numero_contrato = s.numero_contrato)) x) as contratos_excedidos_regla_281;
commit;
