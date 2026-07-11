/* ── CORE: constants, global state, formatting & DOM helpers ──
   Loaded first. Every other js/*.js file relies on the globals defined here.
   Chart.js must already be loaded (see index.html) before this file runs. */

const PALETTE=['#00D4AA','#388BFD','#E3B341','#A371F7','#F85149','#3FB950'];
const WORKER_URL='https://claude-proxy.vvisuall-aii.workers.dev';
const MODEL_ID='claude-sonnet-4-5';
Chart.defaults.color='#7D8590';Chart.defaults.borderColor='#21262D';Chart.defaults.font.family="'Inter',system-ui,sans-serif";

let ALL=[],charts={},CURRENT_DATA=[];
let ARTICLES=[];
let chatHistory=[],chatDataContext='',chatReady=false;
let LAST_RESULT=null;
let FC_RESULT=null;
let FC_CHART=null;

/* ── WHITE LABEL — reads ?practice=&city=&doctor= from URL ── */
const URL_PARAMS=(()=>{
  const p=new URLSearchParams(window.location.search);
  const name=(p.get('practice')||'').trim().replace(/\+/g,' ');
  const city=(p.get('city')||'').trim().replace(/\+/g,' ');
  const doctor=(p.get('doctor')||'').trim().replace(/\+/g,' ');
  return{name,city,doctor,active:!!name};
})();

function getWhiteLabel(){
  // Priority: URL param > Perfil de la Clínica > default
  if(URL_PARAMS.active) return URL_PARAMS.name;
  if(PRACTICE_PROFILE?.name) return PRACTICE_PROFILE.name;
  return 'Smile Dental';
}

function applyWhiteLabel(){
  const name=getWhiteLabel();
  const city=URL_PARAMS.city||(PRACTICE_PROFILE?.location||'');
  const doctor=URL_PARAMS.doctor||'';

  // Page title
  document.title=`${name} — Intelligence Dashboard`;

  // Header brand name
  const brandEl=document.querySelector('.brand-name');
  if(brandEl) brandEl.textContent=name;

  // Brand subtitle
  const subEl=document.querySelector('.brand-sub');
  if(subEl) subEl.textContent=city?`${city} · Practice Intelligence`:'Dashboard de Inteligencia Dental';

  // AI panel empty state (innerHTML — name can come from the URL, so it must be escaped)
  const aiEmpty=document.getElementById('ai-empty');
  if(aiEmpty) aiEmpty.innerHTML=`<div class="ai-empty-icon">◈</div>Haz clic en <strong style="color:var(--accent)">Analizar con IA</strong> para generar un análisis ejecutivo de ${escapeHtml(name)}. Los filtros activos aplican.`;

  // Tendencias del Sector subtitle
  const miSub=document.querySelector('.mi-header p');
  if(miSub) miSub.textContent=`Tendencias e insights del sector odontológico — curados para ${name}`;

  // Chat header
  const chatNameEl=document.querySelector('.chat-header-name');
  if(chatNameEl) chatNameEl.textContent=`Asesor IA — ${name}`;

  // Chat welcome message
  const chatWelcomeP=document.getElementById('chat-welcome-p')||document.querySelector('#chat-welcome p');
  if(chatWelcomeP) chatWelcomeP.textContent=`Tengo acceso completo a los datos de rendimiento de ${name}. Pregúntame lo que sea — valido ideas, analizo tendencias y te doy consejo estratégico directo.`;

  // Profile pill
  const pill=document.getElementById('profile-pill');
  const pillLbl=document.getElementById('profile-pill-label');
  if(URL_PARAMS.active && pill && pillLbl){
    pill.classList.add('complete');
    pillLbl.textContent=`${name}${doctor?' · '+doctor:''}${city?' · '+city:''}`;
  }

  // If URL params present, pre-fill profile modal fields
  if(URL_PARAMS.active){
    const nameInput=document.getElementById('pp-name');
    const locInput=document.getElementById('pp-location');
    if(nameInput && !nameInput.value) nameInput.value=name;
    if(locInput && !locInput.value && city) locInput.value=city;
  }
}

function switchTab(name,btn){
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
}

function fmtCOP(v){return '$'+Math.round(v).toLocaleString('es-CO');}
function fmtDate(s){return new Date(s+'T00:00:00').toLocaleDateString('es-CO',{day:'numeric',month:'short',year:'numeric'});}

function kill(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
function mkLeg(id,entries){
  const tot=entries.reduce((s,e)=>s+e[1],0);
  document.getElementById(id).innerHTML=entries.map((e,i)=>
    `<span><span class="leg-sq" style="background:${PALETTE[i%PALETTE.length]}"></span>${e[0]} <strong style="color:var(--text);font-weight:500">${Math.round(e[1]/tot*100)}%</strong></span>`
  ).join('');
}
function mkRank(id,entries,fmt){
  const max=entries[0]?entries[0][1]:1;
  document.getElementById(id).innerHTML=entries.map((e,i)=>`
    <div class="rank-row">
      <div class="rank-num">${i+1}</div>
      <div class="rank-name">${e[0]}</div>
      <div class="rank-bar-wrap"><div class="rank-bar" style="width:${Math.round(e[1]/max*100)}%;background:${PALETTE[i%PALETTE.length]}"></div></div>
      <div class="rank-val">${fmt?fmt(e[1]):Math.round(e[1]).toLocaleString('es-CO')}</div>
    </div>`).join('');
}

/* Escapes text before it's interpolated into an innerHTML template.
   Needed anywhere the source is the AI (Claude responses), the user
   (chat input), or a URL query param — none of that is trusted HTML. */
function escapeHtml(str){
  if(str==null) return '';
  return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderMarkdown(text){
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/^### (.+)$/gm,'<strong style="font-size:13px;color:var(--accent)">$1</strong>')
    .replace(/^## (.+)$/gm,'<strong style="font-size:14px;color:var(--text)">$1</strong>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g,m=>`<ul>${m}</ul>`)
    .replace(/\n\n/g,'</p><p>')
    .replace(/^(?!<)(.+)$/gm,(m,p)=>p.startsWith('<')?m:`<p>${m}</p>`)
    .replace(/<p><\/p>/g,'');
}
