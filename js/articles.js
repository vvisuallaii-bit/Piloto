/* ── MARKET INTELLIGENCE (tab: Tendencias) ── */

async function loadArticles(){
  try{
    ARTICLES=await(await fetch('articles.json')).json();renderArticles(ARTICLES);
  }catch(e){
    document.getElementById('mi-grid').innerHTML='<div class="mi-empty"><div class="mi-empty-icon">⚠️</div><p>No se pudo cargar articles.json</p></div>';
  }
}

const MI_TAG_COLORS=new Set(['red','amber','green']);
function safeTagColor(c){return MI_TAG_COLORS.has(c)?c:'';}

const MI_CATEGORY_LABELS={
  'Industry Trend':'Tendencia del sector',
  'Competitor Move':'Movimiento de la competencia',
  'Market Intelligence':'Inteligencia de mercado'
};
function categoryLabel(c){return MI_CATEGORY_LABELS[c]||c;}

function renderArticles(list){
  const grid=document.getElementById('mi-grid');
  if(!list.length){grid.innerHTML='<div class="mi-empty"><div class="mi-empty-icon">📭</div><p>Todavía no hay artículos.</p></div>';return;}
  const order={red:0,amber:1,green:2};
  const sorted=[...list].sort((a,b)=>{const d=(order[a.tag_color]??3)-(order[b.tag_color]??3);return d!==0?d:new Date(b.date)-new Date(a.date);});
  grid.innerHTML=sorted.map(a=>`
    <div class="mi-card" onclick="openArticle(${Number(a.id)})">
      <div class="mi-card-top"><span class="mi-category">${escapeHtml(categoryLabel(a.category))}</span><span class="mi-tag ${safeTagColor(a.tag_color)}">${escapeHtml(a.tag)}</span></div>
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.summary)}</p>
      <div class="mi-card-footer">
        <span class="mi-source">📰 ${escapeHtml(a.source)}</span>
        <span class="mi-date">${fmtDate(a.date)}</span>
      </div>
      <div class="mi-card-read">Leer análisis completo ›</div>
    </div>`).join('');
}
function filterArticles(cat,btn){
  document.querySelectorAll('.mi-filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  renderArticles(cat==='all'?ARTICLES:ARTICLES.filter(a=>a.category===cat));
}
function openArticle(id){
  const a=ARTICLES.find(x=>x.id===id);if(!a)return;
  document.getElementById('art-company').textContent=a.company;
  document.getElementById('art-title').textContent=a.title;
  document.getElementById('art-summary').textContent=a.summary;
  document.getElementById('art-insight').textContent=a.insight;
  document.getElementById('art-cat').textContent=categoryLabel(a.category);
  document.getElementById('art-date').textContent=fmtDate(a.date);
  const tagEl=document.getElementById('art-tag');
  tagEl.textContent=a.tag;tagEl.className='art-tag '+safeTagColor(a.tag_color);
  document.getElementById('art-sections').innerHTML=a.sections.map(s=>`
    <div class="art-section">
      <div class="art-section-title">${escapeHtml(s.title)}</div>
      <div class="art-bullets">${s.bullets.map(b=>`<div class="art-bullet">${escapeHtml(b)}</div>`).join('')}</div>
    </div>`).join('');
  document.getElementById('art-overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeArticle(e){
  if(e&&e.target!==document.getElementById('art-overlay'))return;
  document.getElementById('art-overlay').classList.remove('open');
  document.body.style.overflow='';
}
