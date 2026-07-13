/* ── PRACTICE PROFILE MODAL ── */

const PP_KEY='smile_dental_practice_profile';
let PRACTICE_PROFILE=null;

function loadProfile(){
  // No auto-open: a modal popping up mid-demo interrupts the pitch. The user
  // opens the profile deliberately via the header pill (onclick="openProfile()").
  try{
    const raw=localStorage.getItem(PP_KEY);
    if(raw){PRACTICE_PROFILE=JSON.parse(raw);applyProfile();}
  }catch(e){PRACTICE_PROFILE=null;}
}

function applyProfile(){
  if(!PRACTICE_PROFILE)return;
  applyWhiteLabel();
  if(chatReady)initChat();
}

function openProfile(){
  // populate fields if profile exists
  if(PRACTICE_PROFILE){
    const p=PRACTICE_PROFILE;
    if(p.name)document.getElementById('pp-name').value=p.name;
    if(p.location)document.getElementById('pp-location').value=p.location;
    if(p.chairs)document.getElementById('pp-chairs').value=p.chairs;
    if(p.doctors)document.getElementById('pp-doctors').value=p.doctors;
    if(p.goal)document.getElementById('pp-goal').value=p.goal;
    if(p.notes)document.getElementById('pp-notes').value=p.notes;
    if(p.insurance)p.insurance.forEach(v=>{const c=document.querySelector(`#pp-insurance [data-val="${v}"]`);if(c)c.classList.add('selected');});
    if(p.area){const c=document.querySelector(`#pp-area [data-val="${p.area}"]`);if(c)c.classList.add('selected');}
    if(p.challenge)p.challenge.forEach(v=>{const c=document.querySelector(`#pp-challenge [data-val="${v}"]`);if(c)c.classList.add('selected');});
  }
  document.getElementById('pp-overlay').classList.add('open');
  document.body.style.overflow='hidden';
}

function closeProfile(){
  document.getElementById('pp-overlay').classList.remove('open');
  document.body.style.overflow='';
}

function ppOverlayClick(e){if(e.target===document.getElementById('pp-overlay'))closeProfile();}

function toggleChip(el,groupId,single=false){
  if(single){
    document.querySelectorAll(`#${groupId} .pp-chip`).forEach(c=>c.classList.remove('selected'));
  }
  el.classList.toggle('selected');
}

function getChipVals(groupId){
  return [...document.querySelectorAll(`#${groupId} .pp-chip.selected`)].map(c=>c.dataset.val);
}

function saveProfile(){
  const name=document.getElementById('pp-name').value.trim();
  if(!name){document.getElementById('pp-name').focus();document.getElementById('pp-name').style.borderColor='var(--red)';return;}
  document.getElementById('pp-name').style.borderColor='';

  const profile={
    name,
    location:document.getElementById('pp-location').value.trim(),
    chairs:document.getElementById('pp-chairs').value,
    doctors:document.getElementById('pp-doctors').value,
    goal:document.getElementById('pp-goal').value,
    notes:document.getElementById('pp-notes').value.trim(),
    insurance:getChipVals('pp-insurance'),
    area:getChipVals('pp-area')[0]||'',
    challenge:getChipVals('pp-challenge'),
    savedAt:new Date().toISOString(),
  };

  localStorage.setItem(PP_KEY,JSON.stringify(profile));
  PRACTICE_PROFILE=profile;
  applyProfile();
  // rebuild chat context with new profile
  if(ALL.length)initChat();
  closeProfile();
}
