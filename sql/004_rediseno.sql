-- ============================================================
-- GPMD 2026 — Migración v2: preregistro sin slots + PDV/Productos
-- Ejecutar en Supabase SQL Editor.
-- NOTA: limpia datos de prueba (el modelo de estados cambió).
-- ============================================================

-- ------------------------------------------------------------
-- 0. Limpieza de datos de prueba (cambia el modelo de estados)
-- ------------------------------------------------------------
DELETE FROM gpmd_facturas;
DELETE FROM gpmd_conversaciones;
DELETE FROM gpmd_participants;

-- ------------------------------------------------------------
-- 1. Eliminar el sistema de agendamiento por slots
-- ------------------------------------------------------------
DROP VIEW IF EXISTS gpmd_slots_disponibles;
DROP TABLE IF EXISTS gpmd_slots;

-- ------------------------------------------------------------
-- 2. Participantes: nuevos campos y estados
-- ------------------------------------------------------------
ALTER TABLE gpmd_participants
  ADD COLUMN IF NOT EXISTS novato                     BOOLEAN,
  ADD COLUMN IF NOT EXISTS tipo_documento_piloto      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tipo_documento_copiloto    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS numero_documento_copiloto  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS rh_copiloto                VARCHAR(10);

-- Nuevo catálogo de estados: pre_registrado → en_revision → confirmado | rechazado | lista_espera
ALTER TABLE gpmd_participants DROP CONSTRAINT IF EXISTS gpmd_participants_estado_check;
ALTER TABLE gpmd_participants ALTER COLUMN estado SET DEFAULT 'pre_registrado';
ALTER TABLE gpmd_participants ADD CONSTRAINT gpmd_participants_estado_check
  CHECK (estado IN ('pre_registrado','en_revision','confirmado','rechazado','lista_espera'));

-- ------------------------------------------------------------
-- 3. Facturas: datos resueltos de PDV y de producto
-- ------------------------------------------------------------
ALTER TABLE gpmd_facturas
  ADD COLUMN IF NOT EXISTS nit               VARCHAR(30),
  ADD COLUMN IF NOT EXISTS cliente           VARCHAR(200),
  ADD COLUMN IF NOT EXISTS agente            VARCHAR(120),
  ADD COLUMN IF NOT EXISTS departamento      VARCHAR(120),
  ADD COLUMN IF NOT EXISTS ciudad_pdv        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS producto_catalogo VARCHAR(200),
  ADD COLUMN IF NOT EXISTS match_confianza   DECIMAL(3,2);

CREATE INDEX IF NOT EXISTS idx_facturas_nit ON gpmd_facturas(nit);

-- ------------------------------------------------------------
-- 4. Conversaciones: ya no se usa slots_cache
-- ------------------------------------------------------------
ALTER TABLE gpmd_conversaciones DROP COLUMN IF EXISTS slots_cache;

-- ------------------------------------------------------------
-- 5. PDV participantes (un NIT puede tener varios clientes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gpmd_pdv (
  id            SERIAL PRIMARY KEY,
  nit           VARCHAR(30),
  cliente       VARCHAR(200) NOT NULL,
  agente        VARCHAR(120),
  departamento  VARCHAR(120),
  ciudad        VARCHAR(120),
  activo        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (nit, cliente)
);
CREATE INDEX IF NOT EXISTS idx_pdv_nit ON gpmd_pdv(nit);

-- ------------------------------------------------------------
-- 6. Productos participantes (catálogo)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gpmd_productos (
  id            SERIAL PRIMARY KEY,
  producto      VARCHAR(200) NOT NULL,
  presentacion  VARCHAR(120),
  participa     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (producto, presentacion)
);
