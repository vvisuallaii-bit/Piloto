/* ── BOOTSTRAP — must be the last script tag loaded (see index.html) ── */

document.addEventListener('DOMContentLoaded',()=>{
  const ta=document.getElementById('chat-input');
  if(ta)ta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';});
});

loadCSV();loadArticles();loadProfile();applyWhiteLabel();
