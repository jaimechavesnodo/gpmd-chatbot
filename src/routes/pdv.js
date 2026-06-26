const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { nitCoincide } = require('../lib/ocr');

// GET /api/pdv?q=...    → autocompletar por NIT (prefijo) o nombre de cliente (para el aprobador)
// GET /api/pdv?nit=...  → clientes que coinciden exactamente con ese NIT
// GET /api/pdv          → listado completo (gestión)
router.get('/', requireAuth(['admin', 'agente', 'cliente']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_pdv').select('*').eq('activo', true).order('cliente');
  if (error) return res.status(500).json({ error: error.message });

  const q = (req.query.q || '').trim();
  if (q) {
    const ql = q.toLowerCase();
    const qd = q.replace(/\D/g, '');
    const rows = (data || []).filter((p) => {
      const nit = String(p.nit || '');
      const byNit = qd && nit.replace(/\D/g, '').includes(qd);
      const byCliente = p.cliente && p.cliente.toLowerCase().includes(ql);
      return byNit || byCliente;
    }).slice(0, 15);
    return res.json(rows);
  }

  const nit = req.query.nit;
  const rows = nit ? (data || []).filter((p) => nitCoincide(nit, p.nit)) : data;
  res.json(rows);
});

// CRUD mínimo (admin) — para agregar PDV más adelante
router.post('/', requireAuth(['admin']), async (req, res) => {
  const { nit, cliente, agente, departamento, ciudad } = req.body;
  if (!cliente) return res.status(400).json({ error: 'cliente requerido' });
  const { data, error } = await supabase.from('gpmd_pdv')
    .insert({ nit: nit || null, cliente, agente, departamento, ciudad }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:id', requireAuth(['admin']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_pdv').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth(['admin']), async (req, res) => {
  await supabase.from('gpmd_pdv').update({ activo: false }).eq('id', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
