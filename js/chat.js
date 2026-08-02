/* ── AI PARTNER / CHAT (tab: Asesor IA) ── */

function buildSystemPrompt(dataCtx){
  const profileCtx=buildProfileContext();
  // Must match getWhiteLabel()'s priority (URL param > saved profile >
  // default) — reversing it here would let a stale locally-saved profile
  // from a previous client override the current ?practice= URL.
  const practiceName=getWhiteLabel()||'esta clínica dental';
  return `Eres el socio estratégico y asesor de negocios on-demand de ${practiceName}, una clínica dental en Colombia. Tienes acceso completo a sus datos de rendimiento y actúas como un asesor financiero de nivel directivo disponible en cualquier momento — a las 11pm, temprano en la mañana, cuando el dueño necesite tomar una decisión.

${dataCtx}
${profileCtx}

TU ALCANCE — solo responde sobre estos temas:
1. Análisis de los datos de rendimiento de ${practiceName} (recaudación, producción, pacientes, aceptación de tratamientos, ausentismo, mezcla de servicios, gastos)
2. Estrategia de negocio y decisiones operativas directamente relacionadas con sus datos y perfil
3. Comparación con referencias del sector odontológico colombiano
4. Decisiones específicas: contratación, equipos, expansión, agenda, tarifas, convenios con aseguradoras

FUERA DE ALCANCE — si te preguntan algo no relacionado con la clínica o sus datos, responde: "Eso está fuera de lo que puedo ayudarte aquí. Estoy enfocado en los datos y la estrategia de ${practiceName}."

CÓMO OPERAS:
- Siempre basa tus respuestas en los datos reales y el perfil. Cita números específicos.
- Usa el contexto del perfil para hacer respuestas específicas — si tienen 3 consultorios en área urbana, considera eso. Si su reto es el ausentismo, prioriza esa perspectiva.
- Cuando el dueño proponga una idea, valídala o cuestiónala con datos — no solo digas "excelente idea."
- Da opiniones directas: si algo no cuadra, dilo.
- Conciso y ejecutivo. Sin relleno. Sin consejos genéricos.
- Responde siempre en español colombiano, tono directo y cercano.
- Usa pesos colombianos (COP) en todos los valores monetarios.
- Si el perfil está incompleto, aún así da la mejor respuesta posible con los datos disponibles.

ESTILO: Asesor de confianza que conoce profundamente el negocio. Directo, honesto, basado en los números específicos de esta clínica. Como un socio financiero que siempre está disponible.`;
}

function initChat(){
  if(!ALL.length)return;
  chatDataContext=buildDataContext();
  chatReady=true;
  const bar=document.getElementById('chat-context-bar');
  const tot=ALL.reduce((s,r)=>s+r.collections,0);
  const profileTag=PRACTICE_PROFILE?` · Perfil: ${PRACTICE_PROFILE.name}`:'';
  bar.textContent=`✓ Contexto cargado — ${ALL.length} meses · $${Math.round(tot).toLocaleString('es-CO')} en recaudación · ${ALL.reduce((s,r)=>s+r.new_patients,0)} pacientes nuevos${profileTag}`;
  bar.style.color='var(--accent)';
}

function appendMsg(role,text,isThinking=false){
  const welcome=document.getElementById('chat-welcome');
  if(welcome)welcome.remove();
  const wrap=document.getElementById('chat-messages');
  const div=document.createElement('div');
  div.className=`msg ${role}`;
  const avatar=role==='ai'?`<div class="msg-avatar">🦷</div>`:`<div class="msg-avatar">👤</div>`;
  if(isThinking){
    div.innerHTML=`${avatar}<div class="msg-thinking"><span></span><span></span><span></span></div>`;
  }else{
    // AI text is run through renderMarkdown (which escapes first); user
    // input is escaped directly — neither is trusted HTML.
    const html=role==='ai'?renderMarkdown(text):escapeHtml(text).replace(/\n/g,'<br>');
    div.innerHTML=`${avatar}<div class="msg-bubble">${html}</div>`;
  }
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function sendSuggestion(btn){document.getElementById('chat-input').value=btn.textContent;sendChat();}

async function sendChat(){
  const input=document.getElementById('chat-input');
  const sendBtn=document.getElementById('chat-send');
  const text=input.value.trim();
  if(!text||!chatReady)return;
  input.value='';input.style.height='auto';sendBtn.disabled=true;
  appendMsg('user',text);
  chatHistory.push({role:'user',content:text});
  const thinking=appendMsg('ai','',true);

  // Demo de red: respuesta offline con los datos reales de la sede (sin API).
  if(typeof NET!=='undefined'&&NET.active&&NET.fuente==='sintetico'){
    const reply=netDemoChatReply(text);
    setTimeout(()=>{thinking.remove();appendMsg('ai',reply);chatHistory.push({role:'ai',content:reply});sendBtn.disabled=false;input.focus();},450);
    return;
  }

  try{
    const messages=[
      {role:'user',content:buildSystemPrompt(chatDataContext)+'\n\n[Sistema listo. Ahora estás en línea con el dueño de la clínica.]'},
      {role:'assistant',content:`Listo. Tengo los datos de ${getWhiteLabel()} cargados y estoy aquí como tu asesor estratégico. ¿Qué necesitas analizar?`},
      ...chatHistory.slice(0,-1).map(m=>({role:m.role==='ai'?'assistant':'user',content:m.content})),
      {role:'user',content:text}
    ];
    const resp=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL_ID,max_tokens:1024,messages})});
    const json=await resp.json();
    const reply=json.content.map(b=>b.text||'').join('');
    thinking.remove();appendMsg('ai',reply);
    chatHistory.push({role:'ai',content:reply});
  }catch(e){
    thinking.remove();appendMsg('ai',`⚠️ Error de conexión: ${e.message}`);
  }
  sendBtn.disabled=false;input.focus();
}

function clearChat(){
  chatHistory=[];
  document.getElementById('chat-messages').innerHTML=`
    <div class="chat-welcome" id="chat-welcome">
      <div class="chat-welcome-icon">🦷</div>
      <h3>Tu asesor de clínica dental está listo</h3>
      <p>Tengo acceso completo a los datos de rendimiento de ${escapeHtml(getWhiteLabel())}. Pregúntame lo que sea — valido ideas, analizo tendencias y te doy consejo estratégico directo.</p>
      <div class="chat-suggestions">
        <button class="chat-suggestion" onclick="sendSuggestion(this)">¿Cuál servicio es el más rentable?</button>
        <button class="chat-suggestion" onclick="sendSuggestion(this)">¿Por qué mi tasa de ausentismo es alta?</button>
        <button class="chat-suggestion" onclick="sendSuggestion(this)">¿Cómo mejoro la aceptación de tratamientos?</button>
        <button class="chat-suggestion" onclick="sendSuggestion(this)">¿Qué está elevando mis gastos operativos?</button>
        <button class="chat-suggestion" onclick="sendSuggestion(this)">¿En qué meses tengo mayor oportunidad de ingresos?</button>
      </div>
    </div>`;
}
