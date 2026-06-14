// Crea el primer usuario admin en Supabase
// Uso: node src/scripts/seed-admin.js <email> <password> [nombre]
// Ejemplo: node src/scripts/seed-admin.js admin@gpmd.com "MiClave123" "Admin GPMD"

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const [,, email, password, nombre = 'Administrador'] = process.argv;

if (!email || !password) {
  console.error('Uso: node src/scripts/seed-admin.js <email> <password> [nombre]');
  process.exit(1);
}

if (password.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres');
  process.exit(1);
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const password_hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from('gpmd_usuarios')
    .insert({ email: email.toLowerCase().trim(), nombre, rol: 'admin', password_hash })
    .select('id, email, nombre, rol')
    .single();

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.log('✅ Usuario admin creado:');
  console.log(`   Email: ${data.email}`);
  console.log(`   Nombre: ${data.nombre}`);
  console.log(`   Rol: ${data.rol}`);
  console.log(`   ID: ${data.id}`);
}

main();
