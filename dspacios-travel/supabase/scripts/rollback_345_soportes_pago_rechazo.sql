-- 345 · ROLLBACK de la migración 345 (rechazo de soportes de pago). Restaura f281_soportes_insert (339) y f281_soportes_update (281) EXACTAS, y quita lo que agregó la 345.
-- SE NIEGA a ejecutarse si ya existe evidencia que depende de ella (soportes rechazados, correcciones o estados de aviso): borrar o reinterpretar evidencia no es un rollback aceptable.
-- En ese caso: revisa los soportes rechazados (motivo_retiro = 'rechazo') y decide con el dueño; esta migración NO se revierte con datos vivos.
begin;   -- una sola transacción: si el candado de abajo se niega, NADA de lo demás se ejecuta
do $$
declare v_n bigint;
begin
  if to_regclass('public.contrato_soportes_pago') is null then raise exception '345 rollback: falta contrato_soportes_pago.'; end if;
  select count(*) into v_n from public.contrato_soportes_pago where motivo_retiro = 'rechazo' or corrige_id is not null;
  if v_n > 0 then raise exception '345 rollback ABORTADO: hay % soporte(s) rechazados o correcciones. No se revierte con evidencia que depende de la 345.', v_n; end if;
  if to_regclass('public.soporte_rechazo_aviso') is not null then
    select count(*) into v_n from public.soporte_rechazo_aviso;
    if v_n > 0 then raise exception '345 rollback ABORTADO: hay % estado(s) de aviso de rechazo.', v_n; end if;
  end if;
end $$;

drop function if exists public.soporte_rechazo_aviso_cerrar(bigint, text, integer, text);
drop function if exists public.soporte_rechazo_aviso_reclamar(bigint);
drop function if exists public.soporte_corregir(bigint, uuid, text, text, text, bigint, text);
drop function if exists public.soporte_rechazar(bigint, uuid, text);
drop function if exists public.f345_destinatarios_rechazo(bigint);
drop table if exists public.soporte_rechazo_aviso;

create or replace function public.f281_soportes_insert() returns trigger language plpgsql set search_path = '' as $$
declare
  v_tenant text; v_abonos bigint; v_vigentes bigint; o public.contrato_soportes_pago;
  c_adicionales constant int := 1;   -- cupo adicional por contrato (339): evidencia de un pago que el equipo aún no registra. NO está ligado a ningún pago.
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
    if v_vigentes + 1 > v_abonos + c_adicionales then
      raise exception 'SOPORTE_LIMITE: el contrato % tiene % abono(s) y % soporte(s) vigente(s); el máximo es abonos + % = %. Reemplaza o retira uno, o registra el pago.', new.numero_contrato, v_abonos, v_vigentes, c_adicionales, v_abonos + c_adicionales using errcode = 'F4515';
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

create or replace function public.f281_soportes_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.tenant, new.path, new.nombre_original, new.mime, new.size_bytes, new.sha256, new.subido_por, new.subido_en, new.reemplaza_id)
     is distinct from
     (old.tenant, old.path, old.nombre_original, old.mime, old.size_bytes, old.sha256, old.subido_por, old.subido_en, old.reemplaza_id) then
    raise exception 'SOPORTE_INMUTABLE: la evidencia del soporte % no se modifica.', old.id using errcode = 'F4517';
  end if;
  if old.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe; está conservado y congelado.', old.id using errcode = 'F4520';
  end if;
  if new.numero_contrato is distinct from old.numero_contrato then
    -- Renumeración del contrato: SOLO dentro de f281_trasladar_evidencia (que ninguna aplicación puede ejecutar), con la marca local de transacción que ella fija
    -- Y la coherencia estructural (misma agencia y mismo created_at entre la venta vieja y la nueva). Ninguna de las dos basta por sí sola.
    if coalesce(pg_catalog.current_setting('app.f281_traslado', true), '') <> old.numero_contrato || '>' || new.numero_contrato
       or new.archivado_en is not null
       or (new.vigente, new.retirado_en, new.retirado_por, new.motivo_retiro, new.nota_retiro) is distinct from (old.vigente, old.retirado_en, old.retirado_por, old.motivo_retiro, old.nota_retiro)
       or not exists (select 1 from public.ventas a join public.ventas b on b.tenant = a.tenant and b.created_at = a.created_at
                       where a.numero_contrato = old.numero_contrato and b.numero_contrato = new.numero_contrato and a.tenant = old.tenant) then
      raise exception 'SOPORTE_INMUTABLE: el número del contrato del soporte % solo cambia en la renumeración del contrato.', old.id using errcode = 'F4517';
    end if;
    return new;
  end if;
  if new.archivado_en is distinct from old.archivado_en then
    -- Archivar: lo ÚNICO que puede cambiar es archivado_en (null → fecha).
    if (new.vigente, new.retirado_en, new.retirado_por, new.motivo_retiro, new.nota_retiro) is distinct from (old.vigente, old.retirado_en, old.retirado_por, old.motivo_retiro, old.nota_retiro) then
      raise exception 'SOPORTE_INMUTABLE: archivar el soporte % no cambia nada más.', old.id using errcode = 'F4517';
    end if;
    return new;
  end if;
  if not old.vigente or new.vigente then
    raise exception 'SOPORTE_INMUTABLE: el soporte % solo pasa de vigente a retirado, una vez.', old.id using errcode = 'F4517';
  end if;
  return new;
end $$;

alter table public.contrato_soportes_pago drop constraint if exists soportes_corrige_o_reemplaza;
alter table public.contrato_soportes_pago drop constraint if exists soportes_rechazo_motivo;
alter table public.contrato_soportes_pago drop constraint if exists contrato_soportes_pago_motivo_retiro_check;
alter table public.contrato_soportes_pago add constraint contrato_soportes_pago_motivo_retiro_check check (motivo_retiro in ('reemplazo', 'retiro'));
drop index if exists public.uq_soportes_corrige;
alter table public.contrato_soportes_pago drop column if exists corrige_id;
commit;
