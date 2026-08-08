/* ── FASE 4C — LOGIN REAL Y ENRUTAMIENTO POR ROL ────────────────────────────
   Cargado ANTES de main.js. Orquesta el arranque de la app: decide si se pide
   login y, según el rol de la sesión, encamina a la vista correcta.

   Fase 4A construyó esto como mock (usuarios hardcodeados). La 4C lo conecta al
   backend real: `POST /auth/login` valida contra D1 y devuelve un token que se
   guarda en la sesión y viaja como `Authorization: Bearer <token>` en toda
   llamada al Worker que requiera sesión (ver authFetch).

   NOMENCLATURA — la variable de sesión es SESSION (separada por completo de
   NET.rol, que es el mecanismo del demo de red para prospectos y NO se toca):
     - dueno         → Gerente (ve toda la red)
     - admin_sede    → Administrador de sede (una sola sede)
     - recepcionista → Recepcionista (solo Pendientes)  */

// La sesión vive en sessionStorage (no localStorage): sobrevive recargas dentro de
// la misma pestaña, pero al cerrar el navegador / abrir una pestaña nueva se pide
// login de nuevo. Así el login aparece cada vez que se abre la página.
const SESSION_KEY = 'smile_dental_session';

const ROL_LABEL = { dueno: 'Gerente', admin_sede: 'Administrador de sede', recepcionista: 'Recepcionista' };

let SESSION = null;
let authExpirando = false;   // evita disparar el redirect de sesión-expirada en paralelo

/* Fetch con la sesión adjunta: agrega Authorization si hay token, y si el Worker
   responde 401 en una llamada AUTENTICADA, limpia la sesión y vuelve al login.
   En el demo de venta (sin token) un 401 NO redirige — lo maneja el llamador
   (fallback sintético / lista vacía). */
async function authFetch(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (SESSION && SESSION.token && !o.headers['Authorization']) {
    o.headers['Authorization'] = 'Bearer ' + SESSION.token;
  }
  const res = await fetch(url, o);
  if (res.status === 401 && SESSION && SESSION.token) authSessionExpired();
  return res;
}

function authSessionExpired() {
  if (authExpirando) return;
  authExpirando = true;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  SESSION = null;
  const w = document.querySelector('.session-wrap'); if (w) w.remove();
  authShowLogin();
  const err = document.getElementById('login-error');
  if (err) err.textContent = 'Tu sesión expiró, ingresa de nuevo.';
}

function authLoadSession() {
  try { const raw = sessionStorage.getItem(SESSION_KEY); if (raw) SESSION = JSON.parse(raw); }
  catch (e) { SESSION = null; }
}

/* Un link de venta (?practice=…, ?demo=red, ?network=…) NUNCA pide login: se
   comporta idéntico a antes de la Fase 4. El login solo aplica en una URL limpia
   (el flujo autenticado real). */
function authIsSalesDemo() {
  return (typeof URL_PARAMS !== 'undefined' && URL_PARAMS.active) ||
         (typeof NET !== 'undefined' && NET.active);
}
/* Acceso interno/debugging (?admin): mantiene el flujo viejo de X-Admin-Key sin
   forzar login, como antes de la Fase 4 (ver worker/README.md → uso interno). */
function authIsAdminInterno() { return new URLSearchParams(location.search).has('admin'); }
function authNeedsLogin() { return !authIsSalesDemo() && !authIsAdminInterno() && !SESSION; }

/* ── Arranque ──────────────────────────────────────────────────────────── */
function authBoot() {
  authLoadSession();
  applyWhiteLabel();
  authRenderSessionUI();
  if (authNeedsLogin()) { authShowLogin(); return; }
  authRunBoot();
}

/* Corre el bootstrap de datos + tareas, ya con la sesión (o el demo) resueltos.
   Un link de venta (?demo=red, ?practice=…) SIEMPRE tiene prioridad sobre el
   enrutamiento por rol: una sesión que quede en el navegador nunca debe secuestrar
   la vista de demostración de un prospecto. */
function authRunBoot() {
  const sessionRouting = !!SESSION && !authIsSalesDemo();
  if (sessionRouting && SESSION.rol === 'dueno') {
    // Gerente → fuerza la vista Red usando el network_id de la sesión, sin
    // necesitar ?demo=red en la URL. Reutiliza el modo red existente.
    NET.active = true;
    NET.networkId = SESSION.network_id || NET.networkId;
    NET.rol = 'dueno';
    initNetworkDemo().then(authAfterNetwork);
  } else if (typeof NET !== 'undefined' && NET.active) {
    initNetworkDemo();                       // demo de red (prospecto) — igual que antes
  } else {
    const p = loadCSV();                      // sede única (admin_sede, recepcionista o demo)
    if (sessionRouting) { if (p && p.then) p.then(authApplyRoleRouting); else setTimeout(authApplyRoleRouting, 0); }
  }
  applyWhiteLabel();
  authBootTareas();
}

/* Bootstrap de tareas (antes vivía al final de tareas.js; ahora lo orquesta
   auth para respetar el gate de login). */
function authBootTareas() {
  if (typeof loadPacientes === 'function') loadPacientes();
  if (typeof initTareasAdmin === 'function') initTareasAdmin();
  // En modo red no hay tareas por sede en este arranque (las consolida el Red view).
  if (!(typeof NET !== 'undefined' && NET.active) && typeof fetchTareas === 'function') fetchTareas();
}

/* ── Enrutamiento por rol ──────────────────────────────────────────────── */
function authApplyRoleRouting() {
  if (!SESSION) return;
  if (SESSION.rol === 'recepcionista') {
    // Solo "Pendientes": oculta los demás botones del tab-nav y entra directo.
    document.querySelectorAll('.tab-nav .tab-btn').forEach(b => {
      if (b.id !== 'tab-btn-tareas') b.style.display = 'none';
    });
    const btn = document.getElementById('tab-btn-tareas');
    if (btn) switchTab('tareas', btn);
    // El formulario de creación NUNCA para recepción (reforzado en initTareasAdmin).
    const admin = document.getElementById('tarea-admin');
    if (admin) admin.style.display = 'none';
  }
  // admin_sede → vista de sede única sin cambios; el practice_id de la sesión ya
  // determina qué tareas carga Pendientes (ver tareasPracticeId en tareas.js).
}

/* Se ejecuta tras montar la vista Red del Gerente: relabela el rol y habilita la
   creación de tareas con selector de sede (reutiliza el formulario #tarea-admin). */
function authAfterNetwork() {
  if (!SESSION || SESSION.rol !== 'dueno') return;
  const chip = document.querySelector('#network-bar .nb-rol-chip');
  if (chip) chip.textContent = 'Gerente';

  const admin = document.getElementById('tarea-admin');
  const slot = document.getElementById('ct-slot');
  if (admin && slot && admin.parentElement !== slot) {
    slot.appendChild(admin);                 // mueve el formulario al overlay del Gerente
    admin.style.display = 'block';
    const field = document.getElementById('ta-sede-field');
    const sel = document.getElementById('ta-sede');
    if (field && sel && NET.sedes) {
      sel.innerHTML = NET.sedes.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
      field.style.display = '';              // selector de sede: visible solo en la vista Red
    }
    const sem = document.getElementById('ta-semana');
    if (sem && !sem.value) sem.value = tareasLunes();
  }
  authInyectarBotonCrear();
}

function authInyectarBotonCrear() {
  if (document.getElementById('ct-open')) return;
  const host = document.querySelector('#network-bar .nb-controls') ||
               document.querySelector('#network-bar .nb-inner');
  if (!host) return;
  const b = document.createElement('button');
  b.id = 'ct-open';
  b.className = 'nb-crear-btn';
  b.type = 'button';
  b.textContent = '＋ Crear tarea';
  b.onclick = authAbrirCrear;
  host.appendChild(b);
}

function authAbrirCrear() {
  const ov = document.getElementById('ct-overlay');
  if (!ov) return;
  ov.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function authCerrarCrear() {
  const ov = document.getElementById('ct-overlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.style.overflow = '';
}

/* ── Login ─────────────────────────────────────────────────────────────── */
function authShowLogin() {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
  const ov = document.getElementById('login-overlay');
  if (ov) ov.classList.add('open');
  const email = document.getElementById('login-email');
  if (email) email.focus();
}

async function authLogin(e) {
  if (e && e.preventDefault) e.preventDefault();   // síncrono: evita el submit del form
  const err = document.getElementById('login-error');
  const btn = document.querySelector('#login-form .login-btn');
  const email = (document.getElementById('login-email').value || '').trim().toLowerCase();
  const pass = document.getElementById('login-pass').value || '';
  if (!email || !pass) { if (err) err.textContent = 'Ingresa correo y contraseña.'; return false; }
  if (err) err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }
  try {
    const resp = await fetch(`${WORKER_URL}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 429) { if (err) err.textContent = 'Demasiados intentos. Espera un minuto e intenta de nuevo.'; return false; }
    if (!resp.ok || !data.token) { if (err) err.textContent = 'Correo o contraseña incorrectos.'; return false; }

    SESSION = { token: data.token, rol: data.rol, nombre: data.nombre, network_id: data.network_id, practice_id: data.practice_id, email };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(SESSION)); } catch (e2) {}
    authExpirando = false;

    document.getElementById('login-pass').value = '';
    const ov = document.getElementById('login-overlay'); if (ov) ov.classList.remove('open');
    const loading = document.getElementById('loading'); if (loading) loading.style.display = 'flex';
    authRenderSessionUI();
    authRunBoot();
  } catch (e2) {
    if (err) err.textContent = 'No se pudo conectar con el servidor. Revisa tu internet e intenta de nuevo.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Iniciar sesión'; }
  }
  return false;
}

function authLogout() {
  const token = SESSION && SESSION.token;
  // Best-effort: invalida el token en el servidor (no bloquea la salida).
  if (token) fetch(`${WORKER_URL}/auth/logout`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  // Recarga a una URL limpia: reinicia todo el estado y vuelve al login.
  location.reload();
}

/* Píldora de sesión + botón "Cerrar sesión" en el header (solo con sesión). */
function authRenderSessionUI() {
  if (!SESSION) return;
  if (document.getElementById('session-logout')) return;
  const pill = document.getElementById('profile-pill');
  const host = pill ? pill.parentElement : null;
  if (!host) return;
  const wrap = document.createElement('div');
  wrap.className = 'session-wrap';
  wrap.innerHTML =
    `<span class="session-pill" title="${escapeHtml(SESSION.email || '')}">` +
      `<span class="session-dot"></span>${escapeHtml(SESSION.nombre || '')} · ${escapeHtml(ROL_LABEL[SESSION.rol] || SESSION.rol)}` +
    `</span>` +
    `<button class="session-logout" id="session-logout" type="button" onclick="authLogout()">Cerrar sesión</button>`;
  host.appendChild(wrap);
}

document.addEventListener('DOMContentLoaded', authBoot);
