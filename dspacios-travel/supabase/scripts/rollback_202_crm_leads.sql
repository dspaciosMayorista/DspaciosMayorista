-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 202 · CRM leads — SOLO sobre una base donde el módulo está VACÍO.
--
-- Esta migración retira objetos PROPIOS del CRM y nada más:
--   · las dos tablas (sin CASCADE: si algo ajeno las referenciara, falla);
--   · los triggers de auditoría que la 202 instaló en ellas;
--   · las funciones `crm_lead_*` de la 202, incluidas las de escritura.
-- No toca `trg_auditoria` de ninguna otra tabla, ni la 203, ni `usuarios`.
--
-- Si ya hay leads cargados NO hace nada y se niega: la bitácora comercial es el
-- único registro de esos contactos y un `drop ... cascade` la destruiría en
-- silencio. Para retirarla con datos hace falta una decisión explícita aparte.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_leads     bigint;
  v_actividades bigint;
begin
  if to_regclass('public.crm_leads') is not null then
    select count(*) into v_leads from public.crm_leads;
    if v_leads > 0 then
      raise exception
        'Rollback 202 cancelado: crm_leads tiene % lead(s). No se borra la bitacora comercial; vaciala o decide la retirada de forma explicita.',
        v_leads;
    end if;
  else
    v_leads := 0;
  end if;

  if to_regclass('public.crm_lead_actividades') is not null then
    select count(*) into v_actividades from public.crm_lead_actividades;
    if v_actividades > 0 then
      raise exception
        'Rollback 202 cancelado: crm_lead_actividades tiene % actividad(es) y sus leads ya no existen. No se borra la bitacora.',
        v_actividades;
    end if;
  end if;
end;
$$;

-- Triggers de auditoría SOLO de las dos tablas del CRM. El `if exists` evita
-- el NOTICE cuando la 202 se aplicó en un entorno donde no había `fn_auditoria`.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as tabla
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('crm_leads', 'crm_lead_actividades')
  loop
    execute format('drop trigger if exists trg_auditoria on %s;', r.tabla);
  end loop;
end;
$$;

-- Sin CASCADE: si una policy, vista o funcion de otro modulo dependiera de estas
-- tablas, este rollback falla en vez de arrastrarlas consigo.
drop table if exists public.crm_lead_actividades;
drop table if exists public.crm_leads;

drop function if exists public.crm_lead_registrar_actividad(bigint, text, text, timestamptz);
drop function if exists public.crm_lead_cambiar_etapa(bigint, text);
drop function if exists public.crm_lead_tomar(bigint);
drop function if exists public.crm_lead_actualizar(bigint, jsonb);
drop function if exists public.crm_lead_crear(jsonb);
drop function if exists public.crm_lead_email_de(uuid);
drop function if exists public.crm_lead_coincidencias(text, text, text, text, text, bigint, uuid, text, text);
drop function if exists public.crm_lead_duplicado_id(text, text, text, bigint, uuid, text, text);
-- Firma de un borrador anterior de la 202 (dedupe por telefono/correo/numero
-- sin tipo). Nunca se aplico en remoto; se retira si quedo en una base local.
drop function if exists public.crm_lead_duplicado_id(text, text, text, text, uuid, text, text);
drop function if exists public.crm_lead_tipo_doc_validado(text, text);
drop function if exists public.crm_lead_puede_ver(text, uuid);
drop function if exists public.crm_lead_permite_crear(text, uuid, uuid, text, text);
drop function if exists public.crm_lead_permite_cambiar_responsable(text, uuid, uuid, uuid, text, text);
drop function if exists public.crm_lead_permite_ver(text, uuid, uuid, text, text);
drop function if exists public.crm_lead_actor();
drop function if exists public.crm_lead_responsable_valido(uuid, text);
drop function if exists public.crm_lead_actividades_append_only();
drop function if exists public.crm_leads_bloquear_delete();
drop function if exists public.crm_leads_bloquear_cambio_tenant();
drop function if exists public.crm_leads_touch_updated_at();
drop function if exists public.crm_lead_normalizar_tipo_doc(text);
drop function if exists public.crm_lead_normalizar_documento(text);
drop function if exists public.crm_lead_normalizar_email(text);
drop function if exists public.crm_lead_normalizar_telefono(text);

notify pgrst, 'reload schema';

commit;