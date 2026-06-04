-- Restaura la identidad de D'SPACIOS TRAVEL en empresa_config.
-- Correr UNA VEZ en la base de D'spacios después de aplicar la migración 035
-- (que siembra valores genéricos para el producto en blanco).

update public.empresa_config set
  nombre_comercial      = 'D''spacios Travel',
  tagline               = 'Mayorista de Turismo',
  logo_url              = '/marca/logo-full.png',
  logo_white_url        = '/marca/logo-white.png',
  logo_icon_url         = '/marca/logo-full.png',
  color_primary         = '#1D7C9A',
  color_accent          = '#26BBD9',
  razon_social          = 'D''Spacios Travel S.A.S.',
  nit                   = '901.654.224',
  rnt                   = '147090',
  direccion             = '',
  ciudad                = 'Medellín, Antioquia',
  telefono              = '',
  email                 = 'contacto@dspaciostravel.com',
  sitio_web             = 'Dspaciostravel.com',
  banco                 = 'Bancolombia',
  cuenta_tipo           = 'cuenta corriente',
  cuenta_numero         = '277-000056-23',
  cuenta_titular        = 'D''Spacios Travel S.A.S.',
  ciudad_emision        = 'Medellín, Antioquia',
  jurisdiccion          = 'Medellín, Antioquia',
  updated_at            = now()
where id = 1;
