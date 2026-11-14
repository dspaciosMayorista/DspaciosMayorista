-- ENCENDER el ciclo de vida de la comisión (#97/#75). Se ejecuta SOLO tras preflight_286_ciclo.sql con veredicto «LISTO PARA ENCENDER EL CICLO». Una transacción.
-- Efecto: un contrato PENDIENTE es SIEMPRE solo plan (con el ciclo encendido o apagado) y se materializa al CONFIRMAR (gancho único de #75). Encender solo afecta a los contratos que nacen ya confirmados/'activo' (pasan a registrar plan y materializar en el acto, en vez de la fila directa). El contrato manual nuevo de Mayorista nace siempre PENDIENTE
-- (decisión de #75; el interruptor NO decide el estado de nacimiento, el código solo lo lee para rechazar un B2B sin ciclo); 'activo' conserva su tratamiento histórico (se materializa al crearse). Lo histórico NO se toca.
-- Si falta una dependencia, NO se enciende y el error la nombra. Reversible sin perder evidencia: desactivar_286_ciclo_comision.sql.
begin;
lock table public.comision_plan in share row exclusive mode;
do $$
declare k record; v_faltan text;
begin
  select * into k from p97_priv.ciclo limit 1;
  if not found then raise exception 'ACTIVAR_CICLO_286: la 286 no está aplicada.' using errcode = 'P0001'; end if;
  if k.activo then raise exception 'ACTIVAR_CICLO_286: el ciclo ya está encendido (desde %).', k.activado_en using errcode = 'P0001'; end if;
  select string_agg(d.dependencia || ' — ' || d.detalle, '; ') into v_faltan from p97_priv.dependencias_ciclo() d where not d.cumplida;
  if v_faltan is not null then
    raise exception 'ACTIVAR_CICLO_286: NO se enciende; faltan dependencias: %.', v_faltan using errcode = 'P0001';
  end if;
  update p97_priv.ciclo set activo = true, activado_en = now();
  raise notice 'ACTIVAR_CICLO_286: ciclo ENCENDIDO.';
end $$;
select activo, activado_en from p97_priv.ciclo;
commit;
