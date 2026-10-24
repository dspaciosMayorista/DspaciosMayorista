-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la ACREDITACIÓN EN BLOQUE de la 231 (acreditar_231_bloqueos_cop.sql) — DATOS. Deja en NULL (sin acreditar) los Bloqueos que ese
-- script acreditó como COP (los de la constancia 'D2 del dueño 2026-10-23…') y borra su constancia. NO toca Bloqueos acreditados por
-- formulario ni en USD. NO cambia ningún importe.
--
-- Por qué desactiva dos triggers (solo dentro de esta transacción, se reactivan al final): (1) trg_bloqueos_moneda_90 prohíbe volver a NULL una moneda
-- acreditada (es la regla normal; este rollback es la excepción autorizada) y (2) tarifario_trg_bloqueos_vuelo invalidaría los tarifarios por un
-- cambio COP -> NULL que no cambia ningún precio (NULL se lee como COP). Requiere ser dueño de la tabla (editor SQL de Supabase: sí).
-- Se NIEGA si el interruptor estricto está encendido (apágalo antes) o si la 231 no está aplicada. Termina con UNA consulta integral.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bloqueos_vuelo' and column_name = 'moneda_acreditada_ref') then
    raise exception 'ROLLBACK DATOS 231 ABORTADO: la 231 no está aplicada.';
  end if;
  if coalesce((select exigir_moneda_bloqueo from p90_priv.config where id), false) then
    raise exception 'ROLLBACK DATOS 231 ABORTADO: el interruptor estricto está encendido; apágalo antes (update p90_priv.config set exigir_moneda_bloqueo = false where id).';
  end if;
end $$;

alter table public.bloqueos_vuelo disable trigger trg_bloqueos_moneda_90;
alter table public.bloqueos_vuelo disable trigger tarifario_trg_bloqueos_vuelo;

update public.bloqueos_vuelo
   set moneda = null, moneda_acreditada_en = null, moneda_acreditada_por = null, moneda_acreditada_ref = null
 where moneda = 'COP' and moneda_acreditada_ref like 'D2 del dueño 2026-10-23%';

alter table public.bloqueos_vuelo enable trigger trg_bloqueos_moneda_90;
alter table public.bloqueos_vuelo enable trigger tarifario_trg_bloqueos_vuelo;

do $$
begin
  if exists (select 1 from public.bloqueos_vuelo where moneda_acreditada_ref like 'D2 del dueño 2026-10-23%') then
    raise exception 'ROLLBACK DATOS 231 ABORTADO: quedaron Bloqueos con la constancia D2. Se revierte todo.';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.bloqueos_vuelo'::regclass and tgname in ('trg_bloqueos_moneda_90', 'tarifario_trg_bloqueos_vuelo') and tgenabled = 'O') <> 2 then
    raise exception 'ROLLBACK DATOS 231 ABORTADO: los triggers no quedaron activos. Se revierte todo.';
  end if;
end $$;

commit;

select control, valor, esperado, estado
  from (
    select 1 as ord, 'bloqueos_con_constancia_D2' as control, count(*) filter (where moneda_acreditada_ref like 'D2 del dueño 2026-10-23%')::text as valor, '0' as esperado,
           case when count(*) filter (where moneda_acreditada_ref like 'D2 del dueño 2026-10-23%') = 0 then 'OK' else 'REVISAR' end as estado
      from public.bloqueos_vuelo
    union all
    select 2, 'bloqueos_sin_acreditar', count(*) filter (where moneda is null)::text, 'dato (los 95 deberían estar de vuelta aquí)', 'INFO' from public.bloqueos_vuelo
    union all
    select 3, 'triggers_de_la_231_activos',
           (select count(*) from pg_trigger where tgrelid = 'public.bloqueos_vuelo'::regclass and tgname in ('trg_bloqueos_moneda_90', 'tarifario_trg_bloqueos_vuelo') and tgenabled = 'O')::text, '2',
           case when (select count(*) from pg_trigger where tgrelid = 'public.bloqueos_vuelo'::regclass and tgname in ('trg_bloqueos_moneda_90', 'tarifario_trg_bloqueos_vuelo') and tgenabled = 'O') = 2 then 'OK' else 'REVISAR' end
  ) q
 order by ord;
