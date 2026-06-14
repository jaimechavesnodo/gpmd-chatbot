# GPMD Chatbot — Gran Premio Mobil Delvac 2026

Sistema completo de pre-registro vía WhatsApp para el Gran Premio Mobil Delvac 2026.

## Stack

- **WhatsApp**: WATI + flujos de conversación
- **Automatización**: n8n self-hosted
- **OCR**: Claude Vision API (Anthropic)
- **Backend**: Node.js + Express
- **Frontend**: HTML/CSS/JS + Tailwind CDN
- **Base de datos**: Supabase (PostgreSQL)
- **Deploy**: EasyPanel en Hostinger VPS

## URL de producción

`https://nodo.host/gpmd` (pendiente configuración en EasyPanel)

## Variables de entorno requeridas

Copiar `.env.example` a `.env` y completar:

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_KEY` | Service role key de Supabase |
| `JWT_SECRET` | Secreto para firmar JWT (mín 32 chars) |
| `ANTHROPIC_API_KEY` | API key de Anthropic (Claude Vision) |
| `WATI_API_URL` | URL del servidor WATI (ej: https://live-server.wati.io) |
| `WATI_API_TOKEN` | Bearer token de WATI |
| `WATI_WEBHOOK_SECRET` | Secreto compartido WATI↔backend |
| `N8N_WEBHOOK_BASE_URL` | URL base de webhooks n8n |
| `N8N_WEBHOOK_SECRET` | Secreto compartido backend↔n8n |
| `SLOTS_POR_FRANJA` | Capacidad por franja AM/PM (default: 50) |
| `FACTURA_VALOR_MINIMO` | Valor mínimo de factura en COP |

## Correr en desarrollo

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Deploy (producción)

El deploy es automático vía GitHub → EasyPanel al hacer push a `main`.

## Base de datos

Ejecutar en Supabase SQL Editor (en orden):

```bash
# 1. Crear tablas
sql/001_schema.sql

# 2. Insertar slots
sql/002_slots_seed.sql
```

## Crear primer usuario admin

Ejecutar directamente en Supabase o con un script:

```sql
-- Contraseña: cambiar antes de producción
INSERT INTO gpmd_usuarios (email, nombre, rol, password_hash)
VALUES (
  'admin@gpmd.com',
  'Administrador',
  'admin',
  '$2b$12$...'  -- bcrypt hash de la contraseña
);
```

O usar el script de seed:
```bash
node src/scripts/seed-admin.js admin@ejemplo.com "ContraseñaSegura123"
```

## Módulos del Panel Admin

| Módulo | URL | Roles |
|---|---|---|
| Login | `/` | Todos |
| Agenda | `/agenda.html` | admin, cliente |
| Aprobador | `/aprobador.html` | admin, agente |
| Dashboard | `/dashboard.html` | admin, cliente |
| Log | `/log.html` | admin |
| Usuarios | `/usuarios.html` | admin |

## n8n Workflows

Ver `n8n/README-n8n.md` para instrucciones de importación.

## Contacto

NODO — jaime.chaves@nodo.live
