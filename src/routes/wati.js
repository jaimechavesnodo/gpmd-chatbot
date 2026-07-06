const express = require('express');
const router = express.Router();
const { processIncoming } = require('../lib/conversation');

// Webhook entrante de WATI. Configurar en WATI → Settings → Webhooks:
//   https://nodo.host/gpmd-chatbot/webhook/wati?secret=<WATI_WEBHOOK_SECRET>
router.post('/', async (req, res) => {
  // Responder rápido SIEMPRE (WATI reintenta si no recibe 200)
  res.sendStatus(200);

  try {
    // Verificación opcional por query secret
    const expected = process.env.WATI_WEBHOOK_SECRET;
    if (expected && req.query.secret && req.query.secret !== expected) {
      console.warn('[WATI webhook] secret inválido');
      return;
    }

    const b = req.body || {};

    // Solo procesar mensajes entrantes del usuario (no salientes ni eventos de estado)
    const evento = b.eventType || '';
    const esEntrante = b.owner === false || /received/i.test(evento);
    if (!esEntrante) {
      console.warn(`[WATI webhook] descartado (no parece entrante) eventType="${evento}" owner=${b.owner} waId=${b.waId || b.whatsappNumber || b.phone || ''}`);
      return;
    }

    const phone = b.waId || b.whatsappNumber || b.phone || '';
    if (!phone) return;

    const type = b.type || 'text';
    const text = typeof b.text === 'string' ? b.text : (b.text?.body || '');
    // Para imágenes y documentos (PDF) WATI manda la ruta del archivo en `data`
    const esArchivo = type === 'image' || type === 'document';
    const mediaFileName = esArchivo ? (b.data || b.fileName || '') : '';

    console.log(`[WATI in] ${phone} type=${type} text="${(text || '').slice(0, 40)}"`);
    await processIncoming({ phone, text, type, mediaFileName, senderName: b.senderName });
  } catch (e) {
    console.error('[WATI webhook] error:', e.message);
  }
});

module.exports = router;
