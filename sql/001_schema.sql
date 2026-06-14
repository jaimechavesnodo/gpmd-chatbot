-- ============================================================
-- GPMD 2026 — Schema principal
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Extensión UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Tabla: gpmd_usuarios (admin panel users)
-- ============================================================
CREATE TABLE IF NOT EXISTS gpmd_usuarios (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(200) UNIQUE NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  nombre       VARCHAR(200),
  rol          VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'cliente', 'agente')),
  activo       BOOLEAN DEFAULT true,
  ultimo_login TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Tabla: gpmd_participants (WhatsApp users)
-- ============================================================
CREATE TABLE IF NOT EXISTS gpmd_participants (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                       VARCHAR(20) UNIQUE NOT NULL,
  cedula                      VARCHAR(20) UNIQUE NOT NULL,
  -- Piloto
  nombre_piloto               VARCHAR(200),
  edad                        INTEGER,
  tipo_participacion          VARCHAR(20) CHECK (tipo_participacion IN ('novato', 'experto')),
  participaciones_anteriores  INTEGER DEFAULT 0,
  rh                          VARCHAR(10),
  eps                         VARCHAR(100),
  ciudad                      VARCHAR(100),
  departamento                VARCHAR(100),
  email                       VARCHAR(200),
  -- Copiloto
  nombre_copiloto             VARCHAR(200),
  -- Vehículo
  vehiculo_marca              VARCHAR(100),
  vehiculo_modelo             VARCHAR(100),
  vehiculo_cilindrada         VARCHAR(50),
  vehiculo_empresa            VARCHAR(100),
  vehiculo_placa              VARCHAR(20),
  -- Registro
  codigo_preregistro          VARCHAR(20) UNIQUE,
  estado                      VARCHAR(30) DEFAULT 'en_registro'
                              CHECK (estado IN ('en_registro','slot_pendiente','factura_pendiente','factura_en_revision','aprobado','rechazado')),
  wati_atributo_sync          BOOLEAN DEFAULT false,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Tabla: gpmd_slots
-- ============================================================
CREATE TABLE IF NOT EXISTS gpmd_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           DATE NOT NULL,
  franja          VARCHAR(5) NOT NULL CHECK (franja IN ('AM', 'PM')),
  hora_inicio     TIME NOT NULL,
  hora_fin        TIME NOT NULL,
  numero_slot     INTEGER NOT NULL,       -- número dentro de la franja
  participant_id  UUID REFERENCES gpmd_participants(id),
  reservado_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fecha, franja, numero_slot)
);

-- Vista de disponibilidad
CREATE OR REPLACE VIEW gpmd_slots_disponibles AS
  SELECT fecha, franja, hora_inicio, hora_fin, COUNT(*) AS disponibles
  FROM gpmd_slots
  WHERE participant_id IS NULL
  GROUP BY fecha, franja, hora_inicio, hora_fin
  ORDER BY fecha, franja;

-- ============================================================
-- Tabla: gpmd_facturas
-- ============================================================
CREATE TABLE IF NOT EXISTS gpmd_facturas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id        UUID REFERENCES gpmd_participants(id),
  imagen_url            TEXT NOT NULL,
  -- OCR automático (raw + campos extraídos)
  ocr_raw               JSONB,
  ocr_establecimiento   VARCHAR(200),
  ocr_ciudad            VARCHAR(100),
  ocr_fecha_compra      DATE,
  ocr_referencia_producto VARCHAR(200),
  ocr_presentacion      VARCHAR(50),
  ocr_cantidad          DECIMAL(10,2),
  ocr_valor_total       DECIMAL(12,2),
  ocr_confianza         DECIMAL(3,2),
  ocr_motivo_revision   TEXT,
  -- Campos confirmados (por agente o auto si pasa)
  establecimiento       VARCHAR(200),
  ciudad                VARCHAR(100),
  fecha_compra          DATE,
  referencia_producto   VARCHAR(200),
  presentacion          VARCHAR(50),
  cantidad              DECIMAL(10,2),
  valor_total           DECIMAL(12,2),
  -- Estado
  estado                VARCHAR(30) DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','aprobada_auto','en_revision','aprobada_manual','rechazada')),
  razon_rechazo         VARCHAR(100)
                        CHECK (razon_rechazo IN ('foto_ilegible','fuera_periodo','producto_no_participante','establecimiento_no_participante','factura_duplicada','valor_insuficiente','otro') OR razon_rechazo IS NULL),
  razon_rechazo_detalle TEXT,
  revisado_por          INTEGER REFERENCES gpmd_usuarios(id),
  revisado_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Tabla: gpmd_log
-- ============================================================
CREATE TABLE IF NOT EXISTS gpmd_log (
  id          SERIAL PRIMARY KEY,
  entidad     VARCHAR(50),
  entidad_id  VARCHAR(100),
  accion      VARCHAR(80),
  detalle     JSONB,
  usuario_id  INTEGER REFERENCES gpmd_usuarios(id),
  fuente      VARCHAR(20) DEFAULT 'automatico' CHECK (fuente IN ('automatico','manual')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_participants_phone   ON gpmd_participants(phone);
CREATE INDEX IF NOT EXISTS idx_participants_cedula  ON gpmd_participants(cedula);
CREATE INDEX IF NOT EXISTS idx_participants_estado  ON gpmd_participants(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_estado      ON gpmd_facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_participant ON gpmd_facturas(participant_id);
CREATE INDEX IF NOT EXISTS idx_slots_fecha_franja   ON gpmd_slots(fecha, franja);
CREATE INDEX IF NOT EXISTS idx_log_created_at       ON gpmd_log(created_at DESC);

-- ============================================================
-- Trigger: actualizar updated_at en participants
-- ============================================================
CREATE OR REPLACE FUNCTION gpmd_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_participants_updated_at
  BEFORE UPDATE ON gpmd_participants
  FOR EACH ROW EXECUTE FUNCTION gpmd_set_updated_at();
