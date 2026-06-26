const express = require('express');
const router = express.Router();
const { construirResumen, resumenHtml } = require('../lib/resumen');

// GET /webhook/resumen?secret=...  (o header x-gpmd-secret)
// Devuelve { subject, html } listo para que n8n lo envíe por correo. Lo llama el cron de n8n.
router.get('/', async (req, res) => {
  const expected = process.env.N8N_WEBHOOK_SECRET || process.env.GPMD_WEBHOOK_SECRET;
  const provided = req.headers['x-gpmd-secret'] || req.query.secret;
  if (expected && provided !== expected) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const data = await construirResumen();
    const fecha = new Date(data.generado).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });
    res.json({
      subject: `GPMD 2026 — Resumen ${fecha} · ${data.cupo.confirmados}/${data.cupo.limite} confirmados`,
      html: resumenHtml(data),
      data,
    });
  } catch (e) {
    console.error('[GPMD] resumen:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
