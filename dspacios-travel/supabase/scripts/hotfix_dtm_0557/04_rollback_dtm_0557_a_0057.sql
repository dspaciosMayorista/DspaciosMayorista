-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK del hotfix DTM-0057 → DTM-0557: devuelve el contrato a DTM-0057 y el
-- consecutivo de mayorista a "próximo = DTM-0058" (last_value=57, is_called=true).
--
-- FINAL, PENDIENTE DE REVISIÓN. El bloque ESPERADOS es IDÉNTICO al del hotfix
-- (mismo inventario, ahora bajo DTM-0557); la prueba local lo verifica.
--
-- Usa el MISMO motor que el hotfix con los parámetros invertidos (la prueba
-- local compara los dos bloques MOTOR byte a byte). Por eso hereda todas sus
-- garantías: una sola transacción, candado sobre la secuencia antes de leerla,
-- fila bloqueada, catálogo de FKs verificado, barrido final, y "ya aplicado"
-- → no hace nada.
--
-- CUÁNDO NO SIRVE (aborta sin cambios):
--   · Si ya se emitió DTM-0558 o posterior (el próximo consecutivo ya no es
--     558): devolver la secuencia a 58 dejaría números repetibles. En ese caso
--     la reversión deja de ser mecánica y hay que decidir qué hacer.
--   · Si DTM-0557 ganó filas nuevas después del hotfix (un abono, un pasajero,
--     un adjunto…): el inventario no coincide. Se actualiza ESPERADOS a
--     conciencia o se decide no revertir.
--
-- La auditoría NO se revierte: quedan las filas originales de DTM-0057, las del
-- hotfix (DTM-0057 → DTM-0557) y las de este rollback (DTM-0557 → DTM-0057).
-- Si el cliente ya recibió el documento corregido, revertir lo desactualiza.
-- ───────────────────────────────────────────────────────────────────────────

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';
set local search_path = public, pg_temp;

-- ── Parámetros de ESTE archivo (los del hotfix, invertidos) ───────────────
create temp table _hx_param on commit drop as
select 'DTM-0557'::text as viejo,
       'DTM-0057'::text as nuevo,
       558::bigint       as proximo_antes,    -- tras el hotfix: próximo DTM-0558
       58::bigint        as proximo_despues;  -- vuelve a last_value=57, is_called=true

-- >>> ESPERADOS ─────────────────────────────────────────────────────────────
-- Las filas del hotfix, contadas aquí bajo DTM-0557. Inventario de PRODUCCIÓN (esquema anterior a la migración 194), finalizado
-- el 2026-10-02 con el preflight de producción (sin DETENER) y la
-- autorización expresa del dueño para aliados_b2b (1), contrato_servicios (2),
-- asientos_contables.descripcion (4) y asiento_lineas.tercero (4).
--   C = confirmado (inventario inicial, autorización o preflight).
--   I = 0 inferido: no se reportó como referencia extra y el preflight no dio
--       DETENER. Verificar contra la captura del preflight antes de ejecutar.
-- Si cualquier valor no coincide con lo vivo, el motor aborta SIN cambios y
-- muestra "vivo=N esperado=M". NULL (pendiente) también aborta.
-- Valores: un número de filas, o 'ausente' cuando la COLUMNA no existe en el
-- esquema de producción (no es lo mismo que 0: lo mide el motor y aborta si
-- no coincide, en cualquiera de los dos sentidos).
create temp table _hx_esperado (
  clave    text primary key,
  esperado text check (esperado ~ '^([0-9]+|ausente)$')
) on commit drop;
insert into _hx_esperado values
  ('fk:contrato_pasajeros',                      '3'),            -- C inventario inicial
  ('fk:contrato_vuelos',                         '2'),            -- C inventario inicial
  ('fk:contrato_hoteles',                        '1'),            -- C inventario inicial
  ('fk:contrato_items',                          '1'),            -- C inventario inicial
  ('fk:cuentas_por_pagar',                       '4'),            -- C inventario inicial
  ('fk:abonos',                                  '0'),            -- C sin abonos
  ('fk:sillas',                                  '0'),            -- C sin sillas
  ('fk:vouchers',                                '0'),            -- C sin vouchers
  ('fk:aliados_b2b',                             '1'),            -- C autorizado por el dueño
  ('fk:liquidacion_comisiones',                  '0'),            -- I verificar
  ('fk:rentabilidad',                            '0'),            -- I verificar
  ('fk:facturacion',                             '0'),            -- C sin factura
  ('fk:contrato_facturacion',                    '0'),            -- C sin factura
  ('fk:contrato_adjuntos',                       '0'),            -- C sin objetos en Storage; sin DETENER
  ('fk:cotizaciones',                            '0'),            -- I verificar
  ('fk:cuotas',                                  '0'),            -- I verificar
  ('fk:contrato_servicios',                      '2'),            -- C autorizado por el dueño
  ('fk:contrato_vuelo_control',                  '0'),            -- I verificar
  ('fk:contrato_vuelo_control_cambios',          '0'),            -- I verificar
  ('fk:contrato_condiciones',                    '0'),            -- I verificar
  ('fk:restriccion_overrides',                   '0'),            -- C sin DETENER
  ('fk:contrato_financiero_pendiente',           '0'),            -- C sin DETENER
  ('fk:contrato_alojamiento_bernalo',            '0'),            -- I verificar
  ('ref:conciliacion_sistema.numero_contrato',   '0'),            -- I verificar
  ('ref:liquidacion_descuentos.numero_contrato', '0'),            -- I verificar
  ('ref:movimientos_silla.numero_contrato',      'ausente'),      -- C preflight: columna ausente (antes de la 194)
  ('ref:movimientos_silla.contrato_manual',      'ausente'),      -- C preflight: columna ausente (antes de la 194)
  ('ref:sillas.contrato_manual',                 '0'),            -- C sin DETENER
  ('ref:numeros_contrato_liberados.numero',      '0'),            -- C sin DETENER
  ('ref:storage.objects.name',                   '0'),            -- C sin objetos en Storage
  ('ref:asientos_contables.descripcion',         '4'),            -- C autorizado por el dueño
  ('ref:asiento_lineas.tercero',                 '4');            -- C autorizado por el dueño

-- Catálogo de FKs esperado (idéntico con las migraciones 1→191 y 1→200 del
-- repo; se confirma contra producción). Si el catálogo vivo difiere, aborta.
create temp table _hx_fk_esperada (conname text, tabla text, columna text, referenciada text) on commit drop;
insert into _hx_fk_esperada values
  ('abonos_numero_contrato_fkey',                        'abonos',                         'numero_contrato', 'ventas'),
  ('cuentas_por_pagar_numero_contrato_fkey',             'cuentas_por_pagar',              'numero_contrato', 'ventas'),
  ('aliados_b2b_numero_contrato_fkey',                   'aliados_b2b',                    'numero_contrato', 'ventas'),
  ('liquidacion_comisiones_numero_contrato_fkey',        'liquidacion_comisiones',         'numero_contrato', 'ventas'),
  ('facturacion_numero_contrato_fkey',                   'facturacion',                    'numero_contrato', 'ventas'),
  ('rentabilidad_numero_contrato_fkey',                  'rentabilidad',                   'numero_contrato', 'ventas'),
  ('sillas_numero_contrato_fkey',                        'sillas',                         'numero_contrato', 'ventas'),
  ('contrato_pasajeros_numero_contrato_fkey',            'contrato_pasajeros',             'numero_contrato', 'ventas'),
  ('contrato_hoteles_numero_contrato_fkey',              'contrato_hoteles',               'numero_contrato', 'ventas'),
  ('contrato_vuelos_numero_contrato_fkey',               'contrato_vuelos',                'numero_contrato', 'ventas'),
  ('contrato_items_numero_contrato_fkey',                'contrato_items',                 'numero_contrato', 'ventas'),
  ('contrato_adjuntos_numero_contrato_fkey',             'contrato_adjuntos',              'numero_contrato', 'ventas'),
  ('cotizaciones_numero_contrato_fkey',                  'cotizaciones',                   'numero_contrato', 'ventas'),
  ('vouchers_numero_contrato_fkey',                      'vouchers',                       'numero_contrato', 'ventas'),
  ('cuotas_numero_contrato_fkey',                        'cuotas',                         'numero_contrato', 'ventas'),
  ('contrato_facturacion_numero_contrato_fkey',          'contrato_facturacion',           'numero_contrato', 'ventas'),
  ('contrato_servicios_numero_contrato_fkey',            'contrato_servicios',             'numero_contrato', 'ventas'),
  ('contrato_vuelo_control_numero_contrato_fkey',        'contrato_vuelo_control',         'numero_contrato', 'ventas'),
  ('contrato_condiciones_numero_contrato_fkey',          'contrato_condiciones',           'numero_contrato', 'ventas'),
  ('restriccion_overrides_numero_contrato_fkey',         'restriccion_overrides',          'numero_contrato', 'ventas'),
  ('contrato_financiero_pendiente_numero_contrato_fkey', 'contrato_financiero_pendiente',  'numero_contrato', 'ventas'),
  ('contrato_alojamiento_bernalo_numero_contrato_fkey',  'contrato_alojamiento_bernalo',   'numero_contrato', 'ventas'),
  ('contrato_vuelo_control_cambios_numero_contrato_fkey','contrato_vuelo_control_cambios', 'numero_contrato', 'contrato_vuelo_control');
-- <<< ESPERADOS ─────────────────────────────────────────────────────────────

-- >>> MOTOR (idéntico en el hotfix y en el rollback; la prueba local lo verifica)
do $motor$
declare
  v_viejo text; v_nuevo text; v_prox_antes bigint; v_prox_despues bigint;
  v_incr bigint; v_last bigint; v_called boolean; v_prox bigint;
  v_tenant text; v_n bigint; v_m bigint; v_txt text;
  v_viejo_num int; v_nuevo_num int; v_max_otro int;
  r record;
  -- Deben ser 0 SIEMPRE, sin importar lo que diga el bloque ESPERADOS:
  -- cada una cambia el alcance (documento fiscal, archivo en Storage,
  -- historial inmutable o registro a medias) y obliga a decidir antes.
  c_debe_ser_cero constant text[] := array[
    'fk:sillas','fk:vouchers','fk:facturacion','fk:contrato_facturacion',
    'fk:contrato_adjuntos','fk:restriccion_overrides',
    'fk:contrato_financiero_pendiente',
    'ref:movimientos_silla.numero_contrato','ref:movimientos_silla.contrato_manual',
    'ref:sillas.contrato_manual','ref:numeros_contrato_liberados.numero',
    'ref:storage.objects.name'];
begin
  select viejo, nuevo, proximo_antes, proximo_despues
    into v_viejo, v_nuevo, v_prox_antes, v_prox_despues from _hx_param;

  -- ── 0) Borrador / alcance ────────────────────────────────────────────────
  select string_agg(clave, ', ' order by clave) into v_txt from _hx_esperado where esperado is null;
  if v_txt is not null then
    raise exception 'BORRADOR: faltan expectativas del catálogo de producción (%). No se cambió nada.', v_txt;
  end if;
  select string_agg(clave || '=' || esperado, ', ' order by clave) into v_txt
    from _hx_esperado where clave = any (c_debe_ser_cero) and esperado not in ('0', 'ausente');
  if v_txt is not null then
    raise exception 'FUERA DE ALCANCE: % deben ser 0 (o ''ausente'' si la columna no existe) para este hotfix. Decidir antes de seguir.', v_txt;
  end if;
  -- Una tabla con FK hacia ventas no puede estar "ausente": el catálogo de
  -- FKs se verifica aparte y exige que exista.
  select string_agg(clave, ', ' order by clave) into v_txt
    from _hx_esperado where clave like 'fk:%' and esperado = 'ausente';
  if v_txt is not null then
    raise exception 'ESPERADOS inválido: % no puede ser ''ausente'' (es una FK del catálogo).', v_txt;
  end if;
  if exists (select 1 from unnest(c_debe_ser_cero) k where k not in (select clave from _hx_esperado)) then
    raise exception 'Bloque ESPERADOS incompleto: falta alguna clave obligatoria.';
  end if;

  -- ── 1) Candado sobre la secuencia ANTES de leerla ───────────────────────
  select seqincrement into v_incr from pg_sequence
   where seqrelid = 'public.contrato_seq_mayorista'::regclass;
  if v_incr is distinct from 1 then
    raise exception 'contrato_seq_mayorista tiene increment=% (se esperaba 1).', v_incr;
  end if;
  execute 'alter sequence public.contrato_seq_mayorista increment by 1';  -- sin cambio: solo el candado
  select last_value, is_called into v_last, v_called from public.contrato_seq_mayorista;
  v_prox := case when v_called then v_last + 1 else v_last end;

  -- ── 2) Estado ───────────────────────────────────────────────────────────
  if not exists (select 1 from public.ventas where numero_contrato = v_viejo)
     and exists (select 1 from public.ventas where numero_contrato = v_nuevo) then
    if v_prox >= v_prox_despues then
      raise notice 'YA APLICADO: % no existe, % sí y el próximo consecutivo es %. No se cambió nada.',
        v_viejo, v_nuevo, v_prox;
      return;
    end if;
    raise exception 'Estado inconsistente: % ya existe pero el próximo consecutivo es % (se esperaba >= %).',
      v_nuevo, v_prox, v_prox_despues;
  end if;
  if not exists (select 1 from public.ventas where numero_contrato = v_viejo) then
    raise exception 'No existe el contrato %.', v_viejo;
  end if;
  if exists (select 1 from public.ventas where numero_contrato = v_nuevo) then
    raise exception 'Colisión: ya existe el contrato %.', v_nuevo;
  end if;
  if v_prox <> v_prox_antes then
    raise exception 'La secuencia se movió: el próximo consecutivo es % (se esperaba %). ¿Se creó otro contrato DTM? Volver a diagnosticar.',
      v_prox, v_prox_antes;
  end if;

  -- ── 3) Fila bloqueada + invariantes de numeración ───────────────────────
  select tenant into v_tenant from public.ventas where numero_contrato = v_viejo for update;
  if v_tenant is distinct from 'mayorista' then
    raise exception '% no es de mayorista (tenant=%).', v_viejo, v_tenant;
  end if;
  v_viejo_num := substring(v_viejo from '^DTM-([0-9]{4,})$')::int;
  v_nuevo_num := substring(v_nuevo from '^DTM-([0-9]{4,})$')::int;
  if v_viejo_num is null or v_nuevo_num is null
     or v_nuevo <> 'DTM-' || lpad(v_nuevo_num::text, 4, '0') then
    raise exception 'Formato inválido (% / %).', v_viejo, v_nuevo;
  end if;
  if v_nuevo_num <> v_prox_despues - 1 then
    raise exception 'El número nuevo (%) debe ser el último emitido (próximo - 1 = %).', v_nuevo_num, v_prox_despues - 1;
  end if;
  select max(substring(numero_contrato from '^DTM-([0-9]+)$')::int) into v_max_otro
    from public.ventas where numero_contrato ~ '^DTM-[0-9]+$' and numero_contrato <> v_viejo;
  if coalesce(v_max_otro, 0) >= least(v_viejo_num, v_nuevo_num) then
    raise exception 'Hay otro contrato DTM con número % (>= %): numeración no es la esperada.',
      v_max_otro, least(v_viejo_num, v_nuevo_num);
  end if;
  if exists (select 1 from public.ventas where numero_contrato ~ '^DTM-' and tenant <> 'mayorista')
     or exists (select 1 from public.ventas where tenant = 'mayorista' and numero_contrato !~ '^DTM-[0-9]{4,}$') then
    raise exception 'Hay contratos con tenant y prefijo cruzados: revisar antes de renumerar.';
  end if;

  -- ── 4) Catálogo de FKs vivo == esperado ─────────────────────────────────
  create temp table _hx_fk_viva on commit drop as
  select c.oid, c.conname::text, c.conrelid::regclass::text as tabla, a.attname::text as columna,
         c.confrelid::regclass::text as referenciada, c.condeferrable, c.condeferred
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.confrelid in ('public.ventas'::regclass, 'public.contrato_vuelo_control'::regclass);
  select string_agg(x, '; ') into v_txt from (
    (select 'falta ' || conname as x from _hx_fk_esperada
      except select 'falta ' || conname from _hx_fk_viva)
    union all
    (select 'sobra ' || conname || ' (' || tabla || '.' || columna || ')' from _hx_fk_viva
      where (conname, tabla, columna, referenciada) not in
            (select conname, tabla, columna, referenciada from _hx_fk_esperada))) d;
  if v_txt is not null then
    raise exception 'El catálogo de FKs no es el esperado: %. Actualizar el inventario antes de seguir.', v_txt;
  end if;

  -- ── 5) Conteos vivos == inventario aprobado ─────────────────────────────
  -- estado = el conteo de DTM-viejo como texto, o 'ausente' si la columna no
  -- existe en este esquema (p. ej. movimientos_silla.numero_contrato antes
  -- de la migración 194). Nunca se traduce "no existe" a 0.
  create temp table _hx_conteo (clave text primary key, viejo bigint, nuevo bigint, estado text not null) on commit drop;
  for r in select * from _hx_fk_viva loop
    execute format('select count(*) filter (where %1$I = $1), count(*) filter (where %1$I = $2) from %2$s',
                   r.columna, r.tabla) into v_n, v_m using v_viejo, v_nuevo;
    insert into _hx_conteo values ('fk:' || r.tabla, v_n, v_m, v_n::text);
  end loop;
  -- Referencias sin FK. modo: igual = el valor exacto; contiene = el número
  -- dentro del texto; pool = el número en el pool de reciclaje (y, como
  -- colisión, el próximo DTM).
  for r in select * from (values
      ('ref:conciliacion_sistema.numero_contrato',   'public',  'conciliacion_sistema',       'numero_contrato', 'igual'),
      ('ref:liquidacion_descuentos.numero_contrato', 'public',  'liquidacion_descuentos',     'numero_contrato', 'igual'),
      ('ref:movimientos_silla.numero_contrato',      'public',  'movimientos_silla',          'numero_contrato', 'igual'),
      ('ref:movimientos_silla.contrato_manual',      'public',  'movimientos_silla',          'contrato_manual', 'contiene'),
      ('ref:sillas.contrato_manual',                 'public',  'sillas',                     'contrato_manual', 'contiene'),
      ('ref:numeros_contrato_liberados.numero',      'public',  'numeros_contrato_liberados', 'numero',          'pool'),
      ('ref:storage.objects.name',                   'storage', 'objects',                    'name',            'contiene'),
      ('ref:asientos_contables.descripcion',         'public',  'asientos_contables',         'descripcion',     'contiene'),
      ('ref:asiento_lineas.tercero',                 'public',  'asiento_lineas',             'tercero',         'igual')
    ) as x(clave, esquema, tabla, columna, modo)
  loop
    if not exists (select 1 from pg_attribute
                    where attrelid = to_regclass(format('%I.%I', r.esquema, r.tabla))
                      and attname = r.columna and attnum > 0 and not attisdropped) then
      insert into _hx_conteo values (r.clave, null, null, 'ausente');
      continue;
    end if;
    execute format(case r.modo
        when 'igual'    then 'select count(*) filter (where %1$I = $1), count(*) filter (where %1$I = $2) from %2$I.%3$I'
        when 'contiene' then 'select count(*) filter (where %1$I::text ilike ''%%'' || $1 || ''%%''), count(*) filter (where %1$I::text ilike ''%%'' || $2 || ''%%'') from %2$I.%3$I'
        when 'pool'     then 'select count(*) filter (where %1$I in ($1, $2)), count(*) filter (where %1$I = $3) from %2$I.%3$I'
      end, r.columna, r.esquema, r.tabla)
      into v_n, v_m using v_viejo, v_nuevo, 'DTM-' || lpad(v_prox_despues::text, 4, '0');
    insert into _hx_conteo values (r.clave, v_n, v_m, v_n::text);
  end loop;

  select string_agg(format('%s: vivo=%s esperado=%s', e.clave, coalesce(c.estado, 'sin medir'), e.esperado), '; ' order by e.clave)
    into v_txt
    from _hx_esperado e left join _hx_conteo c using (clave)
   where c.estado is distinct from e.esperado;
  if v_txt is not null then
    raise exception 'El inventario de % cambió: %. No se cambió nada.', v_viejo, v_txt;
  end if;
  select string_agg(clave || '=' || nuevo, ', ') into v_txt from _hx_conteo where nuevo <> 0;
  if v_txt is not null then
    raise exception 'Colisión: % ya aparece en %.', v_nuevo, v_txt;
  end if;
  -- Tablas medidas sin expectativa: el catálogo creció y el inventario no.
  select string_agg(clave, ', ') into v_txt from _hx_conteo where clave not in (select clave from _hx_esperado);
  if v_txt is not null then
    raise exception 'Hay referencias sin expectativa aprobada: %.', v_txt;
  end if;
  -- Asientos: solo se reescribe el formato que deja el posteo de CxP.
  if exists (select 1 from public.asientos_contables
              where descripcion like '%' || v_viejo || '%' and descripcion not like '%(' || v_viejo || ')%')
     or exists (select 1 from public.asientos_contables where descripcion ~ (v_viejo || '[0-9]')) then
    raise exception 'Hay asientos que mencionan % con un formato inesperado: revisar a mano.', v_viejo;
  end if;

  -- ── 6) Barrido previo: el número nuevo no aparece en ninguna parte ──────
  for r in
    select n.nspname, c.relname, a.attname
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
     where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p')
       and a.attnum > 0 and not a.attisdropped
       and (t.typcategory in ('S', 'A') or t.typname in ('json', 'jsonb'))
       and c.relname <> 'auditoria'
  loop
    execute format('select count(*) from %I.%I where %I::text like $1', r.nspname, r.relname, r.attname)
      into v_n using '%' || v_nuevo || '%';
    if v_n > 0 then
      raise exception 'Colisión: % aparece en %.%.% (% filas).', v_nuevo, r.nspname, r.relname, r.attname, v_n;
    end if;
  end loop;

  -- ── 7) FKs diferidas solo donde hay filas ───────────────────────────────
  create temp table _hx_fk_tocada on commit drop as
  select f.* from _hx_fk_viva f join _hx_conteo c on c.clave = 'fk:' || f.tabla
   where c.viejo > 0 and f.tabla <> 'contrato_condiciones';
  for r in select * from _hx_fk_tocada loop
    execute format('alter table %s alter constraint %I deferrable initially immediate', r.tabla, r.conname);
    execute format('set constraints public.%I deferred', r.conname);
  end loop;

  -- ── 8) contrato_condiciones: copiar, borrar con el bypass, reinsertar ───
  create temp table _hx_condiciones on commit drop as
  select * from public.contrato_condiciones where numero_contrato = v_viejo;
  if exists (select 1 from _hx_condiciones) then
    if exists (select 1 from public.restriccion_overrides
                where contrato_condicion_id in (select id from _hx_condiciones)) then
      raise exception 'Hay restriccion_overrides apuntando a condiciones de %: fuera de alcance.', v_viejo;
    end if;
    perform set_config('app.eliminando_contrato', 'true', true);
    delete from public.contrato_condiciones where numero_contrato = v_viejo;
    perform set_config('app.eliminando_contrato', 'false', true);
  end if;

  -- ── 9) Renumerar ────────────────────────────────────────────────────────
  create temp table _hx_infantes on commit drop as
  select id, es_infante from public.contrato_pasajeros where numero_contrato = v_viejo;

  update public.ventas set numero_contrato = v_nuevo where numero_contrato = v_viejo;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ventas: se esperaba 1 fila, se actualizaron %.', v_n; end if;

  for r in select t.*, c.viejo as filas from _hx_fk_tocada t join _hx_conteo c on c.clave = 'fk:' || t.tabla
           order by (t.tabla = 'contrato_pasajeros') loop
    if r.tabla = 'contrato_pasajeros' then
      -- Primero los que no dependen de nadie: el trigger de infantes valida
      -- que el responsable esté en el MISMO contrato, y así ya lo está.
      update public.contrato_pasajeros set numero_contrato = v_nuevo
       where numero_contrato = v_viejo and responsable_id is null;
      get diagnostics v_n = row_count;
      update public.contrato_pasajeros set numero_contrato = v_nuevo
       where numero_contrato = v_viejo;
      get diagnostics v_m = row_count;
      v_n := v_n + v_m;
    else
      execute format('update %s set %I = $1 where %I = $2', r.tabla, r.columna, r.columna)
        using v_nuevo, v_viejo;
      get diagnostics v_n = row_count;
    end if;
    if v_n <> r.filas then
      raise exception '%: se esperaban % filas, se actualizaron %.', r.tabla, r.filas, v_n;
    end if;
  end loop;

  update _hx_condiciones set numero_contrato = v_nuevo;
  insert into public.contrato_condiciones select * from _hx_condiciones;

  -- ── 10) Referencias sin FK ──────────────────────────────────────────────
  update public.conciliacion_sistema   set numero_contrato = v_nuevo where numero_contrato = v_viejo;
  update public.liquidacion_descuentos set numero_contrato = v_nuevo where numero_contrato = v_viejo;
  update public.asiento_lineas         set tercero = v_nuevo         where tercero = v_viejo;
  update public.asientos_contables
     set descripcion = replace(descripcion, '(' || v_viejo || ')', '(' || v_nuevo || ')')
   where descripcion like '%(' || v_viejo || ')%';

  -- ── 11) Verificar FKs ya, y devolverlas a como estaban ──────────────────
  set constraints all immediate;
  for r in select * from _hx_fk_tocada loop
    execute format('alter table %s alter constraint %I %s', r.tabla, r.conname,
      case when not r.condeferrable then 'not deferrable'
           when r.condeferred then 'deferrable initially deferred'
           else 'deferrable initially immediate' end);
  end loop;

  -- ── 12) Consecutivo ─────────────────────────────────────────────────────
  -- RESTART + nextval() deja last_value=próximo-1, is_called=true: la misma
  -- forma que produce el uso normal (y la que había antes). Ambos son
  -- transaccionales aquí: ALTER SEQUENCE crea un relfilenode nuevo en esta
  -- transacción, así que si algo falla después, el nextval se descarta con él.
  execute format('alter sequence public.contrato_seq_mayorista restart with %s', v_prox_despues - 1);
  perform nextval('public.contrato_seq_mayorista');

  -- ── 13) Verificación final (dentro de la transacción) ───────────────────
  if exists (select 1 from public.ventas where numero_contrato = v_viejo)
     or not exists (select 1 from public.ventas where numero_contrato = v_nuevo and tenant = 'mayorista') then
    raise exception 'Verificación: ventas no quedó renumerada.';
  end if;
  for r in select * from _hx_fk_viva loop
    execute format('select count(*) filter (where %1$I = $1), count(*) filter (where %1$I = $2) from %2$s',
                   r.columna, r.tabla) into v_n, v_m using v_viejo, v_nuevo;
    if v_n <> 0 or v_m <> (select viejo from _hx_conteo where clave = 'fk:' || r.tabla) then
      raise exception 'Verificación %: quedan % con % y hay % con % (se esperaban %).',
        r.tabla, v_n, v_viejo, v_m, v_nuevo, (select viejo from _hx_conteo where clave = 'fk:' || r.tabla);
    end if;
  end loop;
  if exists (select 1 from _hx_infantes i join public.contrato_pasajeros p using (id)
              where p.es_infante is distinct from i.es_infante or p.numero_contrato <> v_nuevo) then
    raise exception 'Verificación: cambió la clasificación de algún pasajero.';
  end if;
  if exists (select 1 from _hx_fk_viva f join pg_constraint c on c.oid = f.oid
              where c.condeferrable is distinct from f.condeferrable
                 or c.condeferred is distinct from f.condeferred) then
    raise exception 'Verificación: alguna FK no volvió a su deferrabilidad original.';
  end if;
  select last_value, is_called into v_last, v_called from public.contrato_seq_mayorista;
  if v_last <> v_prox_despues - 1 or not v_called then
    raise exception 'Verificación: la secuencia quedó en (%, %), se esperaba (%, true).', v_last, v_called, v_prox_despues - 1;
  end if;
  -- Barrido completo: el número viejo solo puede quedar en la auditoría.
  for r in
    select n.nspname, c.relname, a.attname
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
     where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p')
       and a.attnum > 0 and not a.attisdropped
       and (t.typcategory in ('S', 'A') or t.typname in ('json', 'jsonb'))
       and c.relname <> 'auditoria'
  loop
    execute format('select count(*) from %I.%I where %I::text like $1', r.nspname, r.relname, r.attname)
      into v_n using '%' || v_viejo || '%';
    if v_n > 0 then
      raise exception 'Verificación: % sigue apareciendo en %.%.% (% filas). Referencia no inventariada.',
        v_viejo, r.nspname, r.relname, r.attname, v_n;
    end if;
  end loop;

  raise notice 'OK: % → % (% tablas hijas con FK renumeradas, % condiciones reinsertadas). Próximo consecutivo: DTM-%.',
    v_viejo, v_nuevo, (select count(*) from _hx_fk_tocada), (select count(*) from _hx_condiciones),
    lpad(v_prox_despues::text, 4, '0');
end
$motor$;
-- <<< MOTOR

commit;
