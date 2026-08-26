-- ───────────────────────────────────────────────────────────────────────────
-- 160 · ventas_formato_numero_por_tenant (CIERRE — correr DESPUÉS de la 159,
--   del despliegue de código y de las pruebas operativas. NO antes.)
--
-- ⚠️ ORDEN OBLIGATORIO DE DESPLIEGUE (ver también el cuerpo del PR — corregido
-- en la revisión posterior al PR #274: el orden anterior pedía probar los 5
-- caminos EN PRODUCCIÓN con contratos reales, lo que habría consumido varios
-- consecutivos DTM de forma PERMANENTE, ya que mayorista nunca los recicla):
--   1) Ejecutar `supabase/scripts/preventiva_antes_de_159.sql` (solo lectura).
--   2) Confirmar que su veredicto es OK (no BLOQUEADO).
--   3) Aplicar la 159 (aditiva).
--   4) Desplegar el código que usa `siguiente_numero_contrato_para_tenant`.
--   5) Validar los 5 caminos de creación de contrato ÚNICAMENTE en base
--      local o staging (nunca con contratos reales en producción).
--      ⚠️ Distinguir tres niveles de cobertura, sin confundirlos (revisión
--      posterior al PR #274, ronda 4 — el borrador anterior de este paso
--      afirmaba que los scripts SQL "ya cubren" la validación de los 5
--      caminos, lo cual es INEXACTO: esos scripts no ejecutan ninguna Server
--      Action real):
--        a) Scripts SQL (`test_consecutivo_dtm_mayorista.sh`,
--           `test_concurrencia_dtm_mayorista.sh`): prueban la MECÁNICA del
--           generador — la función `siguiente_numero_contrato_para_tenant()`
--           en sí, permisos/ACL, avance de la secuencia, reciclaje del pool
--           de minorista, formato del número devuelto y concurrencia (dos
--           sesiones simultáneas nunca chocan). No invocan ninguna Server
--           Action de Next.js ni tocan datos de negocio reales.
--        b) Tests unitarios/wiring (`pruebas/*.test.ts`): prueban la CONEXIÓN
--           ESTRUCTURAL de los 5 caminos — que cada Server Action llama a
--           `contextoCrearContrato()`/el generador correcto como primera
--           operación, con lógica pura (sin red, sin Supabase real).
--        c) Local/staging (este paso): la ÚNICA prueba FUNCIONAL completa —
--           ejecutar de verdad, contra una base de datos real (nunca
--           producción), cada uno de los 5 caminos aplicables
--           (`crearContrato`, `reservarPrograma`, y los demás que generan
--           `numero_contrato` mayorista) y confirmar el resultado end-to-end.
--      Ninguno de los tres niveles reemplaza a los otros dos — los tres son
--      necesarios antes de considerar el frente validado.
--   6) En producción, crear SOLAMENTE el primer contrato mayorista REAL por
--      el flujo operativo que corresponda (uno solo, el que el negocio use
--      de verdad) y verificar que su numero_contrato sea exactamente
--      DTM-0001, sin prefijo doble.
--   7) Recién ENTONCES aplicar esta migración (160).
--   8) Correr las pruebas finales (test_ventas_formato_por_tenant.sql).
--
-- Invertir el orden (correr la 160 antes de desplegar el código nuevo, antes
-- de validar en local/staging, o antes de confirmar el veredicto OK del
-- preflight) puede dejar el candado activo mientras el código viejo todavía
-- intenta escribir un número que no cumple el formato nuevo — evitable
-- simplemente respetando el orden de arriba.
--
-- QUÉ HACE
--   Verifica el formato de TODOS los contratos existentes y, si todos pasan,
--   agrega un CHECK a `ventas` que impide para siempre que un contrato
--   mayorista se guarde sin formato DTM-NNNN (mínimo 4 dígitos) o que un
--   contrato minorista se guarde sin el prefijo MIN-. NO reenumera ni
--   modifica ningún dato — es solo verificación + candado.
--
--   El candado de minorista es deliberadamente MÁS LAXO que el de mayorista
--   (`^MIN-` sin fijar el ancho de dígitos del sufijo): el importador
--   histórico (`lib/minorista/importMinorista.ts`) preserva TEXTO LIBRE de
--   la hoja de cálculo original como sufijo (no siempre "00-NNNN" estricto),
--   y esta migración explícitamente "no toca ni reenumera datos" — exigirle
--   a minorista el mismo formato estricto que a mayorista podría rechazar un
--   futuro re-import legítimo de histórico. El objetivo de este candado es
--   impedir el CRUCE de formatos entre tenants (un DTM- bajo minorista, o un
--   00-NNNN/MIN- bajo mayorista), no fijar la forma exacta interna de cada
--   uno. Mayorista sí puede ser estricto porque, a partir de la 159, TODA su
--   numeración nueva sale de una única función controlada — no hay
--   histórico previo que acomodar (el diagnóstico v3 confirmó 0 contratos
--   mayoristas antes de la 159).
--
-- Si el pre-chequeo encuentra una fila incompatible, ABORTA con un mensaje
-- claro (contratos y cantidad) ANTES de intentar el ALTER TABLE — aunque el
-- propio ALTER TABLE ADD CONSTRAINT también abortaría solo con la validación
-- nativa de Postgres, el mensaje aquí es más específico para diagnosticar
-- sin tener que interpretar el error crudo del motor.
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_tenant_ambiguo   bigint;
  v_mal_mayorista    bigint;
  v_mal_minorista    bigint;
begin
  select count(*) into v_tenant_ambiguo
    from public.ventas
   where tenant is null or tenant not in ('mayorista', 'minorista');
  if v_tenant_ambiguo > 0 then
    raise exception
      'ABORTADO: % contrato(s) con tenant NULL o distinto de mayorista/minorista. '
      'Revisar antes de cerrar la migración 160 — el candado nuevo asume '
      'exactamente esos dos valores.', v_tenant_ambiguo;
  end if;

  select count(*) into v_mal_mayorista
    from public.ventas
   where tenant = 'mayorista' and numero_contrato !~ '^DTM-[0-9]{4,}$';
  if v_mal_mayorista > 0 then
    raise exception
      'ABORTADO: % contrato(s) mayorista NO tienen formato DTM-NNNN (mínimo 4 '
      'dígitos). Revisar antes de cerrar la migración 160 — probablemente '
      'código viejo todavía escribiendo contratos mayoristas sin pasar por '
      'siguiente_numero_contrato_para_tenant().', v_mal_mayorista;
  end if;

  select count(*) into v_mal_minorista
    from public.ventas
   where tenant = 'minorista' and numero_contrato !~ '^MIN-';
  if v_mal_minorista > 0 then
    raise exception
      'ABORTADO: % contrato(s) minorista NO tienen el prefijo MIN-. Revisar '
      'antes de cerrar la migración 160.', v_mal_minorista;
  end if;
end $$;

alter table public.ventas
  add constraint ventas_numero_contrato_formato_por_tenant
  check (
    (tenant = 'mayorista' and numero_contrato ~ '^DTM-[0-9]{4,}$')
    or (tenant = 'minorista' and numero_contrato ~ '^MIN-')
  );

comment on constraint ventas_numero_contrato_formato_por_tenant on public.ventas is
  'Impide el cruce de formatos entre tenants: mayorista SIEMPRE DTM-NNNN '
  '(mínimo 4 dígitos), minorista SIEMPRE con prefijo MIN-. No fija el ancho '
  'del sufijo de minorista (histórico con texto libre). Migración 160 — '
  'correr solo después de la 159, el despliegue de código y las pruebas '
  'operativas.';

commit;
