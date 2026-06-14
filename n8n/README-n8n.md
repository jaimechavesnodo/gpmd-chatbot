# Workflows n8n — GPMD 2026

## Importar workflows

1. En n8n → **Workflows** → botón **Import** (esquina superior derecha)
2. Seleccionar el archivo JSON del workflow
3. Configurar la credencial **Supabase GPMD** (PostgreSQL) antes de activar
4. Reemplazar `SUPABASE_CRED_ID` con el ID real de la credencial en n8n
5. Activar el workflow (toggle en la esquina superior derecha)

## Credencial Supabase requerida

Tipo: **PostgreSQL**
- Host: `db.XXXXXXXX.supabase.co`
- Port: `5432`
- Database: `postgres`
- User: `postgres`
- Password: (Supabase database password)
- SSL: `require`

## Variables de entorno n8n requeridas

Configurar en EasyPanel → Variables del servicio n8n:
```
ANTHROPIC_API_KEY=sk-ant-...
WATI_API_URL=https://live-server.wati.io
WATI_API_TOKEN=eyJ...
```

## Workflows

| Archivo | Path webhook | Propósito |
|---|---|---|
| `wf-gpmd-01-check-usuario.json` | `POST /webhook/gpmd/check-usuario` | Verificar si ya existe el participante |
| `wf-gpmd-02-guardar-registro.json` | `POST /webhook/gpmd/guardar-registro` | Guardar datos de piloto, copiloto, vehículo |
| `wf-gpmd-03-slots-disponibles.json` | `POST /webhook/gpmd/slots-disponibles` | Retornar turnos disponibles |
| `wf-gpmd-04-reservar-slot.json` | `POST /webhook/gpmd/reservar-slot` | Reservar turno elegido por el usuario |
| `wf-gpmd-05-procesar-factura.json` | `POST /webhook/gpmd/procesar-factura` | OCR con Claude Vision + guardar resultado |
| `wf-gpmd-06-notificacion.json` | `POST /webhook/gpmd/notificacion` | Enviar mensaje WhatsApp al participante |
| `wf-gpmd-07-recordatorios.json` | Cron 8am diario | Enviar recordatorios D-2, D-1, D-0 |

## Header de seguridad

Todos los webhooks verifican el header:
```
x-gpmd-secret: GPMD_WEBHOOK_SECRET
```
Reemplazar `GPMD_WEBHOOK_SECRET` en cada nodo Code con el valor real configurado en el `.env` del backend.

## Flujo WATI → n8n

```
WATI Flow Node (Webhook)
    Body: { "phone": "{{phone}}", "cedula": "@cedula", ... }
    Header: x-gpmd-secret: VALOR_SECRETO
    ↓
n8n procesa y responde JSON
    ↓
WATI usa {{campo}} para mostrar respuesta
```
