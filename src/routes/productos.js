const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/productos — catálogo participante
router.get('/', requireAuth(['admin', 'agente', 'cliente']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_productos').select('*').order('producto');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', requireAuth(['admin']), async (req, res) => {
  const { producto, presentacion, participa } = req.body;
  if (!producto) return res.status(400).json({ error: 'producto requerido' });
  const { data, error } = await supabase.from('gpmd_productos')
    .insert({ producto, presentacion: presentacion || null, participa: participa !== false }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:id', requireAuth(['admin']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_productos').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth(['admin']), async (req, res) => {
  await supabase.from('gpmd_productos').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
