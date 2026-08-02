/* ── BOOTSTRAP — must be the last script tag loaded (see index.html) ── */

document.addEventListener('DOMContentLoaded',()=>{
  const ta=document.getElementById('chat-input');
  if(ta)ta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';});
});

loadArticles();loadProfile();
// Modo demo de red (?demo=red): bootstrap propio, sin cargar el CSV de sede única.
// Aditivo: sin el parámetro, el comportamiento es idéntico al de siempre.
if(typeof NET!=='undefined'&&NET.active){ initNetworkDemo(); }
else{ loadCSV(); }
applyWhiteLabel();
