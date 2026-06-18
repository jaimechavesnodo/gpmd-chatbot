// Utilidades de autenticación compartidas
function getToken() { return localStorage.getItem('gpmd_token'); }
function getUser() { return JSON.parse(localStorage.getItem('gpmd_user') || 'null'); }

function requireLogin() {
  const t = getToken();
  const u = getUser();
  if (!t || !u) { window.location.href = './'; return null; }
  return u;
}

function requireRole(roles) {
  const u = requireLogin();
  if (!u) return null;
  if (!roles.includes(u.rol)) { window.location.href = './'; return null; }
  return u;
}

function logout() {
  localStorage.removeItem('gpmd_token');
  localStorage.removeItem('gpmd_user');
  window.location.href = './';
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) { logout(); return null; }
  return res;
}

function renderSidebar(activeKey) {
  const user = getUser();
  if (!user) return;

  const nav = [
    { key: 'agenda',    href: 'agenda.html',    icon: '📅', label: 'Agenda', roles: ['admin','cliente'] },
    { key: 'aprobador', href: 'aprobador.html',  icon: '✅', label: 'Aprobador', roles: ['admin','agente'] },
    { key: 'dashboard', href: 'dashboard.html',  icon: '📊', label: 'Dashboard', roles: ['admin','cliente'] },
    { key: 'log',       href: 'log.html',        icon: '📋', label: 'Log', roles: ['admin'] },
    { key: 'usuarios',  href: 'usuarios.html',   icon: '👥', label: 'Usuarios', roles: ['admin'] },
  ].filter(n => n.roles.includes(user.rol));

  const links = nav.map(n =>
    `<a href="${n.href}" class="${n.key === activeKey ? 'active' : ''}">
      <span class="icon">${n.icon}</span> ${n.label}
    </a>`
  ).join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo">
      <img src="assets/img/Logo_MobilDelvac_v2.png" alt="Mobil Delvac" class="logo-mobil"/>
      <img src="assets/img/logo-nodo-white.png" alt="NODO" class="logo-nodo"/>
    </div>
    <nav class="sidebar-nav">${links}</nav>
    <div class="sidebar-footer">
      <div class="user-name">${user.nombre}</div>
      <div>${user.rol}</div>
      <button onclick="logout()" style="margin-top:.5rem;background:none;border:none;color:#888;cursor:pointer;font-size:.8rem;">
        ← Salir
      </button>
    </div>
  `;
}

function showToast(msg, type = '') {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast ${type === 'ok' ? 'toast-ok' : type === 'error' ? 'toast-error' : ''}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
