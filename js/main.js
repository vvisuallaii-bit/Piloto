/* ── BOOTSTRAP — must be the last script tag loaded (see index.html) ── */

document.addEventListener('DOMContentLoaded',()=>{
  const ta=document.getElementById('chat-input');
  if(ta)ta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';});
});

loadArticles();loadProfile();
// El arranque de datos/tareas lo orquesta auth.js (Fase 4A): decide si pide login
// y, según el rol de la sesión, encamina a la vista correcta. En un link de venta
// (?practice=…, ?demo=red) auth arranca de inmediato, idéntico a antes.
// Fallback defensivo por si auth.js no cargó: comportamiento pre-Fase-4.
if(typeof authBoot!=='function'){
  if(typeof NET!=='undefined'&&NET.active){ initNetworkDemo(); }
  else{ loadCSV(); }
  applyWhiteLabel();
}
