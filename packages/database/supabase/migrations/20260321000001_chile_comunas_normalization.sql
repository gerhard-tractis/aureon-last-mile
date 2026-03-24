-- ============================================================
-- spec-14: Chile Comunas Normalization
-- ============================================================

-- 1. PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. chile_comunas reference table
CREATE TABLE public.chile_comunas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_cut   VARCHAR(10)  UNIQUE NOT NULL,
  nombre       VARCHAR(100) NOT NULL,
  provincia    VARCHAR(100) NOT NULL,
  region       VARCHAR(100) NOT NULL,
  region_num   SMALLINT     NOT NULL,
  geometry     GEOMETRY(MultiPolygon, 4326)
);

CREATE INDEX idx_chile_comunas_nombre_lower ON public.chile_comunas (lower(nombre));
CREATE INDEX idx_chile_comunas_region_num    ON public.chile_comunas (region_num);

ALTER TABLE public.chile_comunas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chile_comunas_authenticated_select" ON public.chile_comunas
  FOR SELECT TO authenticated USING (true);

-- 3. chile_comuna_aliases
CREATE TABLE public.chile_comuna_aliases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias      TEXT NOT NULL,
  comuna_id  UUID NOT NULL REFERENCES public.chile_comunas(id),
  source     TEXT NOT NULL DEFAULT 'seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias)
);

CREATE INDEX idx_chile_comuna_aliases_alias_lower ON public.chile_comuna_aliases (lower(alias));

ALTER TABLE public.chile_comuna_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chile_comuna_aliases_authenticated_select" ON public.chile_comuna_aliases
  FOR SELECT TO authenticated USING (true);

-- 4. Seed all 346 Chilean communes (official CUT codes, INE)
INSERT INTO public.chile_comunas (codigo_cut, nombre, provincia, region, region_num) VALUES
  -- Región de Arica y Parinacota (15)
  ('15101', 'Arica',             'Arica',       'Arica y Parinacota', 15),
  ('15102', 'Camarones',         'Arica',       'Arica y Parinacota', 15),
  ('15201', 'Putre',             'Parinacota',  'Arica y Parinacota', 15),
  ('15202', 'General Lagos',     'Parinacota',  'Arica y Parinacota', 15),
  -- Región de Tarapacá (1)
  ('01101', 'Iquique',           'Iquique',     'Tarapacá', 1),
  ('01107', 'Alto Hospicio',     'Iquique',     'Tarapacá', 1),
  ('01401', 'Pozo Almonte',      'Tamarugal',   'Tarapacá', 1),
  ('01402', 'Camiña',            'Tamarugal',   'Tarapacá', 1),
  ('01403', 'Colchane',          'Tamarugal',   'Tarapacá', 1),
  ('01404', 'Huara',             'Tamarugal',   'Tarapacá', 1),
  ('01405', 'Pica',              'Tamarugal',   'Tarapacá', 1),
  -- Región de Antofagasta (2)
  ('02101', 'Antofagasta',       'Antofagasta', 'Antofagasta', 2),
  ('02102', 'Mejillones',        'Antofagasta', 'Antofagasta', 2),
  ('02103', 'Sierra Gorda',      'Antofagasta', 'Antofagasta', 2),
  ('02104', 'Taltal',            'Antofagasta', 'Antofagasta', 2),
  ('02201', 'Calama',            'El Loa',      'Antofagasta', 2),
  ('02202', 'Ollagüe',           'El Loa',      'Antofagasta', 2),
  ('02203', 'San Pedro de Atacama', 'El Loa',   'Antofagasta', 2),
  ('02301', 'Tocopilla',         'Tocopilla',   'Antofagasta', 2),
  ('02302', 'María Elena',       'Tocopilla',   'Antofagasta', 2),
  -- Región de Atacama (3)
  ('03101', 'Copiapó',           'Copiapó',     'Atacama', 3),
  ('03102', 'Caldera',           'Copiapó',     'Atacama', 3),
  ('03103', 'Tierra Amarilla',   'Copiapó',     'Atacama', 3),
  ('03201', 'Chañaral',          'Chañaral',    'Atacama', 3),
  ('03202', 'Diego de Almagro',  'Chañaral',    'Atacama', 3),
  ('03301', 'Vallenar',          'Huasco',      'Atacama', 3),
  ('03302', 'Alto del Carmen',   'Huasco',      'Atacama', 3),
  ('03303', 'Freirina',          'Huasco',      'Atacama', 3),
  ('03304', 'Huasco',            'Huasco',      'Atacama', 3),
  -- Región de Coquimbo (4)
  ('04101', 'La Serena',         'Elqui',       'Coquimbo', 4),
  ('04102', 'Coquimbo',          'Elqui',       'Coquimbo', 4),
  ('04103', 'Andacollo',         'Elqui',       'Coquimbo', 4),
  ('04104', 'La Higuera',        'Elqui',       'Coquimbo', 4),
  ('04105', 'Paiguano',          'Elqui',       'Coquimbo', 4),
  ('04106', 'Vicuña',            'Elqui',       'Coquimbo', 4),
  ('04201', 'Illapel',           'Choapa',      'Coquimbo', 4),
  ('04202', 'Canela',            'Choapa',      'Coquimbo', 4),
  ('04203', 'Los Vilos',         'Choapa',      'Coquimbo', 4),
  ('04204', 'Salamanca',         'Choapa',      'Coquimbo', 4),
  ('04301', 'Ovalle',            'Limarí',      'Coquimbo', 4),
  ('04302', 'Combarbalá',        'Limarí',      'Coquimbo', 4),
  ('04303', 'Monte Patria',      'Limarí',      'Coquimbo', 4),
  ('04304', 'Punitaqui',         'Limarí',      'Coquimbo', 4),
  ('04305', 'Río Hurtado',       'Limarí',      'Coquimbo', 4),
  -- Región de Valparaíso (5)
  ('05101', 'Valparaíso',        'Valparaíso',  'Valparaíso', 5),
  ('05102', 'Casablanca',        'Valparaíso',  'Valparaíso', 5),
  ('05103', 'Concón',            'Valparaíso',  'Valparaíso', 5),
  ('05104', 'Juan Fernández',    'Valparaíso',  'Valparaíso', 5),
  ('05105', 'Puchuncaví',        'Valparaíso',  'Valparaíso', 5),
  ('05107', 'Quintero',          'Valparaíso',  'Valparaíso', 5),
  ('05109', 'Viña del Mar',      'Valparaíso',  'Valparaíso', 5),
  ('05201', 'Isla de Pascua',    'Isla de Pascua', 'Valparaíso', 5),
  ('05301', 'Los Andes',         'Los Andes',   'Valparaíso', 5),
  ('05302', 'Calle Larga',       'Los Andes',   'Valparaíso', 5),
  ('05303', 'Rinconada',         'Los Andes',   'Valparaíso', 5),
  ('05304', 'San Esteban',       'Los Andes',   'Valparaíso', 5),
  ('05401', 'La Ligua',          'Petorca',     'Valparaíso', 5),
  ('05402', 'Cabildo',           'Petorca',     'Valparaíso', 5),
  ('05403', 'Papudo',            'Petorca',     'Valparaíso', 5),
  ('05404', 'Petorca',           'Petorca',     'Valparaíso', 5),
  ('05405', 'Zapallar',          'Petorca',     'Valparaíso', 5),
  ('05501', 'Quillota',          'Quillota',    'Valparaíso', 5),
  ('05502', 'Calera',            'Quillota',    'Valparaíso', 5),
  ('05503', 'Hijuelas',          'Quillota',    'Valparaíso', 5),
  ('05504', 'La Cruz',           'Quillota',    'Valparaíso', 5),
  ('05506', 'Nogales',           'Quillota',    'Valparaíso', 5),
  ('05601', 'San Antonio',       'San Antonio', 'Valparaíso', 5),
  ('05602', 'Algarrobo',         'San Antonio', 'Valparaíso', 5),
  ('05603', 'Cartagena',         'San Antonio', 'Valparaíso', 5),
  ('05604', 'El Quisco',         'San Antonio', 'Valparaíso', 5),
  ('05605', 'El Tabo',           'San Antonio', 'Valparaíso', 5),
  ('05606', 'Santo Domingo',     'San Antonio', 'Valparaíso', 5),
  ('05701', 'San Felipe',        'San Felipe de Aconcagua', 'Valparaíso', 5),
  ('05702', 'Catemu',            'San Felipe de Aconcagua', 'Valparaíso', 5),
  ('05703', 'Llaillay',          'San Felipe de Aconcagua', 'Valparaíso', 5),
  ('05704', 'Panquehue',         'San Felipe de Aconcagua', 'Valparaíso', 5),
  ('05705', 'Putaendo',          'San Felipe de Aconcagua', 'Valparaíso', 5),
  ('05706', 'Santa María',       'San Felipe de Aconcagua', 'Valparaíso', 5),
  ('05801', 'Quilpué',           'Marga Marga', 'Valparaíso', 5),
  ('05802', 'Limache',           'Marga Marga', 'Valparaíso', 5),
  ('05803', 'Olmué',             'Marga Marga', 'Valparaíso', 5),
  ('05804', 'Villa Alemana',     'Marga Marga', 'Valparaíso', 5),
  -- Región del Libertador General Bernardo O'Higgins (6)
  ('06101', 'Rancagua',          'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06102', 'Codegua',           'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06103', 'Coinco',            'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06104', 'Coltauco',          'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06105', 'Doñihue',           'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06106', 'Graneros',          'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06107', 'Las Cabras',        'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06108', 'Machalí',           'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06109', 'Malloa',            'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06110', 'Mostazal',          'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06111', 'Olivar',            'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06112', 'Peumo',             'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06113', 'Pichidegua',        'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06114', 'Quinta de Tilcoco', 'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06115', 'Rengo',             'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06116', 'Requínoa',          'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06117', 'San Vicente',       'Cachapoal',   'Libertador General Bernardo O''Higgins', 6),
  ('06201', 'Pichilemu',         'Cardenal Caro', 'Libertador General Bernardo O''Higgins', 6),
  ('06202', 'La Estrella',       'Cardenal Caro', 'Libertador General Bernardo O''Higgins', 6),
  ('06203', 'Litueche',          'Cardenal Caro', 'Libertador General Bernardo O''Higgins', 6),
  ('06204', 'Marchihue',         'Cardenal Caro', 'Libertador General Bernardo O''Higgins', 6),
  ('06205', 'Navidad',           'Cardenal Caro', 'Libertador General Bernardo O''Higgins', 6),
  ('06206', 'Paredones',         'Cardenal Caro', 'Libertador General Bernardo O''Higgins', 6),
  ('06301', 'San Fernando',      'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06302', 'Chépica',           'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06303', 'Chimbarongo',       'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06304', 'Lolol',             'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06305', 'Nancagua',          'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06306', 'Palmilla',          'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06307', 'Peralillo',         'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06308', 'Placilla',          'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06309', 'Pumanque',          'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  ('06310', 'Santa Cruz',        'Colchagua',   'Libertador General Bernardo O''Higgins', 6),
  -- Región del Maule (7)
  ('07101', 'Talca',             'Talca',       'Maule', 7),
  ('07102', 'Constitución',      'Talca',       'Maule', 7),
  ('07103', 'Curepto',           'Talca',       'Maule', 7),
  ('07104', 'Empedrado',         'Talca',       'Maule', 7),
  ('07105', 'Maule',             'Talca',       'Maule', 7),
  ('07106', 'Pelarco',           'Talca',       'Maule', 7),
  ('07107', 'Pencahue',          'Talca',       'Maule', 7),
  ('07108', 'Río Claro',         'Talca',       'Maule', 7),
  ('07109', 'San Clemente',      'Talca',       'Maule', 7),
  ('07110', 'San Rafael',        'Talca',       'Maule', 7),
  ('07201', 'Cauquenes',         'Cauquenes',   'Maule', 7),
  ('07202', 'Chanco',            'Cauquenes',   'Maule', 7),
  ('07203', 'Pelluhue',          'Cauquenes',   'Maule', 7),
  ('07301', 'Curicó',            'Curicó',      'Maule', 7),
  ('07302', 'Hualañé',           'Curicó',      'Maule', 7),
  ('07303', 'Licantén',          'Curicó',      'Maule', 7),
  ('07304', 'Molina',            'Curicó',      'Maule', 7),
  ('07305', 'Rauco',             'Curicó',      'Maule', 7),
  ('07306', 'Romeral',           'Curicó',      'Maule', 7),
  ('07307', 'Sagrada Familia',   'Curicó',      'Maule', 7),
  ('07308', 'Teno',              'Curicó',      'Maule', 7),
  ('07309', 'Vichuquén',         'Curicó',      'Maule', 7),
  ('07401', 'Linares',           'Linares',     'Maule', 7),
  ('07402', 'Colbún',            'Linares',     'Maule', 7),
  ('07403', 'Longaví',           'Linares',     'Maule', 7),
  ('07404', 'Parral',            'Linares',     'Maule', 7),
  ('07405', 'Retiro',            'Linares',     'Maule', 7),
  ('07406', 'San Javier',        'Linares',     'Maule', 7),
  ('07407', 'Villa Alegre',      'Linares',     'Maule', 7),
  ('07408', 'Yerbas Buenas',     'Linares',     'Maule', 7),
  -- Región de Ñuble (16)
  ('16101', 'Chillán',           'Diguillín',   'Ñuble', 16),
  ('16102', 'Bulnes',            'Diguillín',   'Ñuble', 16),
  ('16103', 'Chillán Viejo',     'Diguillín',   'Ñuble', 16),
  ('16104', 'El Carmen',         'Diguillín',   'Ñuble', 16),
  ('16105', 'Pemuco',            'Diguillín',   'Ñuble', 16),
  ('16106', 'Pinto',             'Diguillín',   'Ñuble', 16),
  ('16107', 'Quillón',           'Diguillín',   'Ñuble', 16),
  ('16108', 'San Ignacio',       'Diguillín',   'Ñuble', 16),
  ('16109', 'Yungay',            'Diguillín',   'Ñuble', 16),
  ('16201', 'Quirihue',          'Itata',       'Ñuble', 16),
  ('16202', 'Cobquecura',        'Itata',       'Ñuble', 16),
  ('16203', 'Coelemu',           'Itata',       'Ñuble', 16),
  ('16204', 'Ninhue',            'Itata',       'Ñuble', 16),
  ('16205', 'Portezuelo',        'Itata',       'Ñuble', 16),
  ('16206', 'Ránquil',           'Itata',       'Ñuble', 16),
  ('16207', 'Treguaco',          'Itata',       'Ñuble', 16),
  ('16301', 'San Carlos',        'Punilla',     'Ñuble', 16),
  ('16302', 'Coihueco',          'Punilla',     'Ñuble', 16),
  ('16303', 'Ñiquén',            'Punilla',     'Ñuble', 16),
  ('16304', 'San Fabián',        'Punilla',     'Ñuble', 16),
  ('16305', 'San Nicolás',       'Punilla',     'Ñuble', 16),
  -- Región del Biobío (8)
  ('08101', 'Concepción',        'Concepción',  'Biobío', 8),
  ('08102', 'Coronel',           'Concepción',  'Biobío', 8),
  ('08103', 'Chiguayante',       'Concepción',  'Biobío', 8),
  ('08104', 'Florida',           'Concepción',  'Biobío', 8),
  ('08105', 'Hualqui',           'Concepción',  'Biobío', 8),
  ('08106', 'Lota',              'Concepción',  'Biobío', 8),
  ('08107', 'Penco',             'Concepción',  'Biobío', 8),
  ('08108', 'San Pedro de la Paz', 'Concepción', 'Biobío', 8),
  ('08109', 'Santa Juana',       'Concepción',  'Biobío', 8),
  ('08110', 'Talcahuano',        'Concepción',  'Biobío', 8),
  ('08111', 'Tomé',              'Concepción',  'Biobío', 8),
  ('08112', 'Hualpén',           'Concepción',  'Biobío', 8),
  ('08201', 'Lebu',              'Arauco',      'Biobío', 8),
  ('08202', 'Arauco',            'Arauco',      'Biobío', 8),
  ('08203', 'Cañete',            'Arauco',      'Biobío', 8),
  ('08204', 'Contulmo',          'Arauco',      'Biobío', 8),
  ('08205', 'Curanilahue',       'Arauco',      'Biobío', 8),
  ('08206', 'Los Álamos',        'Arauco',      'Biobío', 8),
  ('08207', 'Tirúa',             'Arauco',      'Biobío', 8),
  ('08301', 'Los Ángeles',       'Biobío',      'Biobío', 8),
  ('08302', 'Antuco',            'Biobío',      'Biobío', 8),
  ('08303', 'Cabrero',           'Biobío',      'Biobío', 8),
  ('08304', 'Laja',              'Biobío',      'Biobío', 8),
  ('08305', 'Mulchén',           'Biobío',      'Biobío', 8),
  ('08306', 'Nacimiento',        'Biobío',      'Biobío', 8),
  ('08307', 'Negrete',           'Biobío',      'Biobío', 8),
  ('08308', 'Quilaco',           'Biobío',      'Biobío', 8),
  ('08309', 'Quilleco',          'Biobío',      'Biobío', 8),
  ('08310', 'San Rosendo',       'Biobío',      'Biobío', 8),
  ('08311', 'Santa Bárbara',     'Biobío',      'Biobío', 8),
  ('08312', 'Tucapel',           'Biobío',      'Biobío', 8),
  ('08313', 'Yumbel',            'Biobío',      'Biobío', 8),
  ('08314', 'Alto Biobío',       'Biobío',      'Biobío', 8),
  -- Región de La Araucanía (9)
  ('09101', 'Temuco',            'Cautín',      'La Araucanía', 9),
  ('09102', 'Carahue',           'Cautín',      'La Araucanía', 9),
  ('09103', 'Cunco',             'Cautín',      'La Araucanía', 9),
  ('09104', 'Curarrehue',        'Cautín',      'La Araucanía', 9),
  ('09105', 'Freire',            'Cautín',      'La Araucanía', 9),
  ('09106', 'Galvarino',         'Cautín',      'La Araucanía', 9),
  ('09107', 'Gorbea',            'Cautín',      'La Araucanía', 9),
  ('09108', 'Lautaro',           'Cautín',      'La Araucanía', 9),
  ('09109', 'Loncoche',          'Cautín',      'La Araucanía', 9),
  ('09110', 'Melipeuco',         'Cautín',      'La Araucanía', 9),
  ('09111', 'Nueva Imperial',    'Cautín',      'La Araucanía', 9),
  ('09112', 'Padre las Casas',   'Cautín',      'La Araucanía', 9),
  ('09113', 'Perquenco',         'Cautín',      'La Araucanía', 9),
  ('09114', 'Pitrufquén',        'Cautín',      'La Araucanía', 9),
  ('09115', 'Pucón',             'Cautín',      'La Araucanía', 9),
  ('09116', 'Saavedra',          'Cautín',      'La Araucanía', 9),
  ('09117', 'Teodoro Schmidt',   'Cautín',      'La Araucanía', 9),
  ('09118', 'Toltén',            'Cautín',      'La Araucanía', 9),
  ('09119', 'Vilcún',            'Cautín',      'La Araucanía', 9),
  ('09120', 'Villarrica',        'Cautín',      'La Araucanía', 9),
  ('09121', 'Cholchol',          'Cautín',      'La Araucanía', 9),
  ('09201', 'Angol',             'Malleco',     'La Araucanía', 9),
  ('09202', 'Collipulli',        'Malleco',     'La Araucanía', 9),
  ('09203', 'Curacautín',        'Malleco',     'La Araucanía', 9),
  ('09204', 'Ercilla',           'Malleco',     'La Araucanía', 9),
  ('09205', 'Lonquimay',         'Malleco',     'La Araucanía', 9),
  ('09206', 'Los Sauces',        'Malleco',     'La Araucanía', 9),
  ('09207', 'Lumaco',            'Malleco',     'La Araucanía', 9),
  ('09208', 'Purén',             'Malleco',     'La Araucanía', 9),
  ('09209', 'Renaico',           'Malleco',     'La Araucanía', 9),
  ('09210', 'Traiguén',          'Malleco',     'La Araucanía', 9),
  ('09211', 'Victoria',          'Malleco',     'La Araucanía', 9),
  -- Región de Los Ríos (14)
  ('14101', 'Valdivia',          'Valdivia',    'Los Ríos', 14),
  ('14102', 'Corral',            'Valdivia',    'Los Ríos', 14),
  ('14103', 'Futrono',           'Valdivia',    'Los Ríos', 14),
  ('14104', 'La Unión',          'Valdivia',    'Los Ríos', 14),
  ('14105', 'Lago Ranco',        'Valdivia',    'Los Ríos', 14),
  ('14106', 'Lanco',             'Valdivia',    'Los Ríos', 14),
  ('14107', 'Los Lagos',         'Valdivia',    'Los Ríos', 14),
  ('14108', 'Máfil',             'Valdivia',    'Los Ríos', 14),
  ('14109', 'Mariquina',         'Valdivia',    'Los Ríos', 14),
  ('14110', 'Paillaco',          'Valdivia',    'Los Ríos', 14),
  ('14111', 'Panguipulli',       'Valdivia',    'Los Ríos', 14),
  ('14112', 'Río Bueno',         'Valdivia',    'Los Ríos', 14),
  ('14201', 'Ranco',             'Ranco',       'Los Ríos', 14),
  -- Región de Los Lagos (10)
  ('10101', 'Puerto Montt',      'Llanquihue',  'Los Lagos', 10),
  ('10102', 'Calbuco',           'Llanquihue',  'Los Lagos', 10),
  ('10103', 'Cochamó',           'Llanquihue',  'Los Lagos', 10),
  ('10104', 'Fresia',            'Llanquihue',  'Los Lagos', 10),
  ('10105', 'Frutillar',         'Llanquihue',  'Los Lagos', 10),
  ('10106', 'Los Muermos',       'Llanquihue',  'Los Lagos', 10),
  ('10107', 'Llanquihue',        'Llanquihue',  'Los Lagos', 10),
  ('10108', 'Maullín',           'Llanquihue',  'Los Lagos', 10),
  ('10109', 'Puerto Varas',      'Llanquihue',  'Los Lagos', 10),
  ('10201', 'Castro',            'Chiloé',      'Los Lagos', 10),
  ('10202', 'Ancud',             'Chiloé',      'Los Lagos', 10),
  ('10203', 'Chonchi',           'Chiloé',      'Los Lagos', 10),
  ('10204', 'Curaco de Vélez',   'Chiloé',      'Los Lagos', 10),
  ('10205', 'Dalcahue',          'Chiloé',      'Los Lagos', 10),
  ('10206', 'Puqueldón',         'Chiloé',      'Los Lagos', 10),
  ('10207', 'Queilén',           'Chiloé',      'Los Lagos', 10),
  ('10208', 'Quellón',           'Chiloé',      'Los Lagos', 10),
  ('10209', 'Quemchi',           'Chiloé',      'Los Lagos', 10),
  ('10210', 'Quinchao',          'Chiloé',      'Los Lagos', 10),
  ('10301', 'Osorno',            'Osorno',      'Los Lagos', 10),
  ('10302', 'Puerto Octay',      'Osorno',      'Los Lagos', 10),
  ('10303', 'Purranque',         'Osorno',      'Los Lagos', 10),
  ('10304', 'Puyehue',           'Osorno',      'Los Lagos', 10),
  ('10305', 'Río Negro',         'Osorno',      'Los Lagos', 10),
  ('10306', 'San Juan de la Costa', 'Osorno',   'Los Lagos', 10),
  ('10307', 'San Pablo',         'Osorno',      'Los Lagos', 10),
  ('10401', 'Chaitén',           'Palena',      'Los Lagos', 10),
  ('10402', 'Futaleufú',         'Palena',      'Los Lagos', 10),
  ('10403', 'Hualaihué',         'Palena',      'Los Lagos', 10),
  ('10404', 'Palena',            'Palena',      'Los Lagos', 10),
  -- Región de Aysén del General Carlos Ibáñez del Campo (11)
  ('11101', 'Coihaique',         'Coihaique',   'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11102', 'Lago Verde',        'Coihaique',   'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11201', 'Aysén',             'Aysén',       'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11202', 'Cisnes',            'Aysén',       'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11203', 'Guaitecas',         'Aysén',       'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11301', 'Cochrane',          'Capitán Prat', 'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11302', 'O''Higgins',        'Capitán Prat', 'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11303', 'Tortel',            'Capitán Prat', 'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11401', 'Chile Chico',       'General Carrera', 'Aysén del General Carlos Ibáñez del Campo', 11),
  ('11402', 'Río Ibáñez',        'General Carrera', 'Aysén del General Carlos Ibáñez del Campo', 11),
  -- Región de Magallanes y de la Antártica Chilena (12)
  ('12101', 'Punta Arenas',      'Magallanes',  'Magallanes y de la Antártica Chilena', 12),
  ('12102', 'Laguna Blanca',     'Magallanes',  'Magallanes y de la Antártica Chilena', 12),
  ('12103', 'Río Verde',         'Magallanes',  'Magallanes y de la Antártica Chilena', 12),
  ('12104', 'San Gregorio',      'Magallanes',  'Magallanes y de la Antártica Chilena', 12),
  ('12201', 'Cabo de Hornos',    'Antártica Chilena', 'Magallanes y de la Antártica Chilena', 12),
  ('12202', 'Antártica',         'Antártica Chilena', 'Magallanes y de la Antártica Chilena', 12),
  ('12301', 'Natales',           'Última Esperanza', 'Magallanes y de la Antártica Chilena', 12),
  ('12302', 'Torres del Paine',  'Última Esperanza', 'Magallanes y de la Antártica Chilena', 12),
  ('12401', 'Porvenir',          'Tierra del Fuego', 'Magallanes y de la Antártica Chilena', 12),
  ('12402', 'Primavera',         'Tierra del Fuego', 'Magallanes y de la Antártica Chilena', 12),
  ('12403', 'Timaukel',          'Tierra del Fuego', 'Magallanes y de la Antártica Chilena', 12),
  -- Región Metropolitana de Santiago (13)
  ('13101', 'Santiago',          'Santiago',    'Metropolitana de Santiago', 13),
  ('13102', 'Cerrillos',         'Santiago',    'Metropolitana de Santiago', 13),
  ('13103', 'Cerro Navia',       'Santiago',    'Metropolitana de Santiago', 13),
  ('13104', 'Conchalí',          'Santiago',    'Metropolitana de Santiago', 13),
  ('13105', 'El Bosque',         'Santiago',    'Metropolitana de Santiago', 13),
  ('13106', 'Estación Central',  'Santiago',    'Metropolitana de Santiago', 13),
  ('13107', 'Huechuraba',        'Santiago',    'Metropolitana de Santiago', 13),
  ('13108', 'Independencia',     'Santiago',    'Metropolitana de Santiago', 13),
  ('13109', 'La Cisterna',       'Santiago',    'Metropolitana de Santiago', 13),
  ('13110', 'Las Condes',        'Santiago',    'Metropolitana de Santiago', 13),
  ('13111', 'La Florida',        'Santiago',    'Metropolitana de Santiago', 13),
  ('13112', 'La Granja',         'Santiago',    'Metropolitana de Santiago', 13),
  ('13113', 'La Pintana',        'Santiago',    'Metropolitana de Santiago', 13),
  ('13114', 'La Reina',          'Santiago',    'Metropolitana de Santiago', 13),
  ('13115', 'Lo Espejo',         'Santiago',    'Metropolitana de Santiago', 13),
  ('13116', 'Maipú',             'Santiago',    'Metropolitana de Santiago', 13),
  ('13117', 'Macul',             'Santiago',    'Metropolitana de Santiago', 13),
  ('13118', 'Pudahuel',          'Santiago',    'Metropolitana de Santiago', 13),
  ('13119', 'Lo Barnechea',      'Santiago',    'Metropolitana de Santiago', 13),
  ('13120', 'Ñuñoa',             'Santiago',    'Metropolitana de Santiago', 13),
  ('13121', 'Pedro Aguirre Cerda', 'Santiago',  'Metropolitana de Santiago', 13),
  ('13122', 'Peñalolén',         'Santiago',    'Metropolitana de Santiago', 13),
  ('13123', 'Providencia',       'Santiago',    'Metropolitana de Santiago', 13),
  ('13124', 'Quilicura',         'Santiago',    'Metropolitana de Santiago', 13),
  ('13125', 'Quinta Normal',     'Santiago',    'Metropolitana de Santiago', 13),
  ('13126', 'Recoleta',          'Santiago',    'Metropolitana de Santiago', 13),
  ('13127', 'Renca',             'Santiago',    'Metropolitana de Santiago', 13),
  ('13128', 'San Miguel',        'Santiago',    'Metropolitana de Santiago', 13),
  ('13129', 'San Joaquín',       'Santiago',    'Metropolitana de Santiago', 13),
  ('13130', 'San Ramón',         'Santiago',    'Metropolitana de Santiago', 13),
  ('13131', 'Vitacura',          'Santiago',    'Metropolitana de Santiago', 13),
  ('13132', 'Lo Prado',          'Santiago',    'Metropolitana de Santiago', 13),
  ('13201', 'Puente Alto',       'Cordillera',  'Metropolitana de Santiago', 13),
  ('13202', 'Pirque',            'Cordillera',  'Metropolitana de Santiago', 13),
  ('13203', 'San José de Maipo', 'Cordillera',  'Metropolitana de Santiago', 13),
  ('13301', 'Colina',            'Chacabuco',   'Metropolitana de Santiago', 13),
  ('13302', 'Lampa',             'Chacabuco',   'Metropolitana de Santiago', 13),
  ('13303', 'Tiltil',            'Chacabuco',   'Metropolitana de Santiago', 13),
  ('13401', 'San Bernardo',      'Maipo',       'Metropolitana de Santiago', 13),
  ('13402', 'Buin',              'Maipo',       'Metropolitana de Santiago', 13),
  ('13403', 'Calera de Tango',   'Maipo',       'Metropolitana de Santiago', 13),
  ('13404', 'Paine',             'Maipo',       'Metropolitana de Santiago', 13),
  ('13501', 'Melipilla',         'Melipilla',   'Metropolitana de Santiago', 13),
  ('13502', 'Alhué',             'Melipilla',   'Metropolitana de Santiago', 13),
  ('13503', 'Curacaví',          'Melipilla',   'Metropolitana de Santiago', 13),
  ('13504', 'María Pinto',       'Melipilla',   'Metropolitana de Santiago', 13),
  ('13505', 'San Pedro',         'Melipilla',   'Metropolitana de Santiago', 13),
  ('13601', 'Talagante',         'Talagante',   'Metropolitana de Santiago', 13),
  ('13602', 'El Monte',          'Talagante',   'Metropolitana de Santiago', 13),
  ('13603', 'Isla de Maipo',     'Talagante',   'Metropolitana de Santiago', 13),
  ('13604', 'Padre Hurtado',     'Talagante',   'Metropolitana de Santiago', 13),
  ('13605', 'Peñaflor',          'Talagante',   'Metropolitana de Santiago', 13)
ON CONFLICT (codigo_cut) DO NOTHING;

-- 5a. Seed aliases: uppercase canonical name
INSERT INTO public.chile_comuna_aliases (alias, comuna_id, source)
SELECT upper(nombre), id, 'seed'
  FROM public.chile_comunas
ON CONFLICT (alias) DO NOTHING;

-- 5b. Seed aliases: accentless uppercase
INSERT INTO public.chile_comuna_aliases (alias, comuna_id, source)
SELECT
  upper(translate(nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
  id,
  'seed'
  FROM public.chile_comunas
 WHERE upper(translate(nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) != upper(nombre)
ON CONFLICT (alias) DO NOTHING;

-- 6. normalize_comuna_id function
CREATE OR REPLACE FUNCTION public.normalize_comuna_id(raw_name TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF raw_name IS NULL OR trim(raw_name) = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM public.chile_comunas
   WHERE lower(trim(nombre)) = lower(trim(raw_name))
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  SELECT comuna_id INTO v_id
    FROM public.chile_comuna_aliases
   WHERE lower(trim(alias)) = lower(trim(raw_name))
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  RETURN NULL;
END;
$$;

-- 7. map_comuna_alias RPC
CREATE OR REPLACE FUNCTION public.map_comuna_alias(
  p_alias     TEXT,
  p_comuna_id UUID,
  p_source    TEXT DEFAULT 'manual'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_canonical TEXT;
BEGIN
  SELECT nombre INTO v_canonical FROM public.chile_comunas WHERE id = p_comuna_id;

  INSERT INTO public.chile_comuna_aliases (alias, comuna_id, source)
    VALUES (trim(p_alias), p_comuna_id, p_source)
    ON CONFLICT (alias) DO UPDATE SET comuna_id = p_comuna_id, source = p_source;

  UPDATE public.orders
     SET comuna_id = p_comuna_id,
         comuna    = v_canonical
   WHERE lower(trim(comuna_raw)) = lower(trim(p_alias))
     AND comuna_id IS NULL;
END;
$$;

-- 8. get_unmatched_comunas RPC
CREATE OR REPLACE FUNCTION public.get_unmatched_comunas(p_operator_id UUID)
RETURNS TABLE (comuna_raw TEXT, order_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT o.comuna_raw, COUNT(*)::BIGINT AS order_count
    FROM public.orders o
   WHERE o.operator_id = p_operator_id
     AND o.comuna_id IS NULL
     AND o.comuna_raw IS NOT NULL
   GROUP BY o.comuna_raw
   ORDER BY order_count DESC;
$$;

-- 9. orders: add new columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS comuna_id  UUID REFERENCES public.chile_comunas(id),
  ADD COLUMN IF NOT EXISTS comuna_raw TEXT;

-- 10. Normalization trigger
CREATE OR REPLACE FUNCTION public.orders_normalize_comuna()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_id   UUID;
  v_name TEXT;
BEGIN
  IF NEW.comuna IS NOT NULL THEN
    IF NEW.comuna_raw IS NULL THEN
      NEW.comuna_raw := NEW.comuna;
    END IF;
    v_id := public.normalize_comuna_id(NEW.comuna);
    NEW.comuna_id := v_id;
    IF v_id IS NOT NULL THEN
      SELECT nombre INTO v_name FROM public.chile_comunas WHERE id = v_id;
      NEW.comuna := v_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_normalize_comuna_trigger ON public.orders;
CREATE TRIGGER orders_normalize_comuna_trigger
  BEFORE INSERT OR UPDATE OF comuna
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_normalize_comuna();

-- 11. dock_zone_comunas junction table
CREATE TABLE public.dock_zone_comunas (
  dock_zone_id UUID NOT NULL REFERENCES public.dock_zones(id),
  comuna_id    UUID NOT NULL REFERENCES public.chile_comunas(id),
  PRIMARY KEY (dock_zone_id, comuna_id)
);

ALTER TABLE public.dock_zone_comunas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dock_zone_comunas_operator_select" ON public.dock_zone_comunas
  FOR SELECT USING (
    dock_zone_id IN (SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id())
  );
CREATE POLICY "dock_zone_comunas_operator_insert" ON public.dock_zone_comunas
  FOR INSERT WITH CHECK (
    dock_zone_id IN (SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id())
  );
CREATE POLICY "dock_zone_comunas_operator_delete" ON public.dock_zone_comunas
  FOR DELETE USING (
    dock_zone_id IN (SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id())
  );

-- 12. Drop old free-text comunas column
ALTER TABLE public.dock_zones DROP COLUMN IF EXISTS comunas;

-- 13. Backfill existing orders
UPDATE public.orders
   SET comuna_raw = comuna
 WHERE comuna_raw IS NULL AND comuna IS NOT NULL;

UPDATE public.orders o
   SET comuna_id = public.normalize_comuna_id(o.comuna),
       comuna = COALESCE(
         (SELECT nombre FROM public.chile_comunas WHERE id = public.normalize_comuna_id(o.comuna)),
         o.comuna
       )
 WHERE o.comuna IS NOT NULL
   AND o.comuna_id IS NULL;

-- 14. Grants
GRANT SELECT ON public.chile_comunas TO authenticated, anon;
GRANT SELECT ON public.chile_comuna_aliases TO authenticated;
GRANT SELECT ON public.dock_zone_comunas TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_comuna_id(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.map_comuna_alias(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unmatched_comunas(UUID) TO authenticated;
