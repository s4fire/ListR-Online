import { parseTextList, rankMatches } from './text-import.js';
import { searchAnime } from './api.js';

let rows=[], modal;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const title=m=>m?.title?.userPreferred||m?.title?.english||m?.title?.romaji||m?.title?.native||'Unknown';
const $=s=>modal.querySelector(s);

function build(){
  const st=document.createElement('style');
  st.textContent='.text-list-dialog{width:min(1080px,calc(100vw - 24px));max-height:90vh;padding:0;border:1px solid #3a3445;border-radius:18px;background:#15131c;color:#f5f1fa;box-shadow:0 30px 90px #000b}.text-list-dialog::backdrop{background:#08070dcc;backdrop-filter:blur(5px)}.text-list-head{display:flex;justify-content:space-between;padding:20px 23px;border-bottom:1px solid #2b2935}.text-list-head h2{margin:3px 0 4px}.text-list-head p{margin:0;color:#958d9e;font-size:11px}.text-list-close{background:0;border:0;color:#aaa2b0;font-size:24px}.text-list-body{padding:20px;overflow:auto;max-height:calc(90vh - 120px)}.text-list-input{width:100%;min-height:210px;resize:vertical;background:#0f0e15;color:#eee8f4;border:1px solid #34303c;border-radius:12px;padding:14px;outline:0;font:12px/1.6 ui-monospace,monospace}.text-list-options{display:flex;gap:9px;align-items:center;margin-top:11px;color:#a8a0ae;font-size:11px}.text-list-options select,.text-list-row select,.text-list-row input{height:34px;background:#0e0d13;color:#ddd5e4;border:1px solid #36313e;border-radius:7px;padding:0 7px;min-width:0}.text-list-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.text-list-status{font-size:11px;color:#9d95a3}.text-list-status.error{color:#ff9eb9}.text-list-review{display:grid;gap:8px}.text-list-row{display:grid;grid-template-columns:1.5fr 1.25fr 120px 100px 80px;gap:8px;align-items:center;padding:10px;border:1px solid #2c2935;border-radius:10px;background:#111017}.text-list-row.bad{border-color:#6a3949}.text-list-title{font-size:11px;font-weight:650}.text-list-sub{font-size:9px;color:#89818f;margin-top:3px}.text-list-warning{grid-column:1/-1;color:#ffadbf;font-size:10px}.text-list-foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px}.text-list-foot small{color:#787180;font-size:9px}@media(max-width:760px){.text-list-row{grid-template-columns:1fr 1fr}.text-list-title,.text-list-warning{grid-column:1/-1}.text-list-foot{flex-direction:column;align-items:flex-end;gap:8px}}';
  document.head.appendChild(st);
  modal=document.createElement('dialog'); modal.className='text-list-dialog';
  modal.innerHTML='<div class="text-list-head"><div><p class="eyebrow">IMPORT YOUR COLLECTION</p><h2>Text to List</h2><p>Paste your list, review the AniList matches, then import what you confirm.</p></div><button class="text-list-close" type="button">×</button></div><div class="text-list-body"><div id="text-list-step"></div></div>';
  document.body.appendChild(modal);
  modal.querySelector('.text-list-close').onclick=()=>modal.close();
  const b=document.createElement('button'); b.className='button button-quiet'; b.textContent='Text to List'; b.type='button'; b.onclick=open;
  document.querySelector('#open-search')?.before(b);
}
function renderInput(msg=''){
  $('#text-list-step').innerHTML='<textarea id="tl-source" class="text-list-input" placeholder="Watching\nFrieren: Beyond Journey\'s End 10\nOne Piece 1157\n\nCompleted\nDemon Slayer\n\nInterested\nSolo Leveling"></textarea><div class="text-list-options">No heading? <select id="tl-default"><option value="watching">Watching</option><option value="completed">Completed</option><option value="interested">Interested</option></select></div><p class="text-list-status '+(msg?'error':'')+'">'+esc(msg||'Category headings require explicit watched counts for Watching and Completed.')+'</p><div class="text-list-actions"><button id="tl-parse" class="button button-primary" type="button">Parse list →</button></div>';
  $('#tl-parse').onclick=parse;
}
function open(){modal.showModal();renderInput();$('#tl-source').focus()}
async function parse(){
  const items=parseTextList($('#tl-source').value,$('#tl-default').value);
  if(!items.length){renderInput('No anime titles were detected.');return}
  rows=items.map((x,i)=>({...x,index:i,matches:[],media:null,score:0,warning:''}));
  $('#text-list-step').innerHTML='<p class="text-list-status">Finding AniList matches…</p>';
  try{
    for(const r of rows){
      r.matches=rankMatches(r.sourceTitle,await searchAnime(r.sourceTitle)).slice(0,5);
      r.media=r.matches[0]?.media||null;r.score=r.matches[0]?.score||0;
      if(!r.media)r.warning='No AniList match. Remove this row or choose a match.';
      if(r.score<55)r.warning=r.warning||'Low-confidence match — verify it.';
      if(r.explicitCategory&&r.category!=='interested'&&r.watched==null)r.warning=r.warning||'Watched episode count is required for category-heading imports.';
    }
    review();
  }catch(e){renderInput(e.message||'AniList search failed.')}
}
function review(){
  const bad=rows.filter(r=>r.warning).length;
  $('#text-list-step').innerHTML='<div class="text-list-status">'+rows.length+' title(s) · '+(bad?bad+' need attention':'ready to import')+'</div><div class="text-list-review">'+rows.map(rowHtml).join('')+'</div><div class="text-list-foot"><small>Nothing is saved until Import.</small><div class="text-list-actions"><button id="tl-back" class="button button-quiet">Back</button><button id="tl-import" class="button button-primary" '+(bad?'disabled':'')+'>Import '+rows.length+' anime</button></div></div>';
  $('#tl-back').onclick=()=>renderInput();
  $('#tl-import').onclick=confirm;
  modal.querySelectorAll('[data-row]').forEach(e=>e.addEventListener('change',()=>syncRow(+e.dataset.row)));
}
function rowHtml(r){
  const opts=r.matches.map(m=>'<option value="'+m.media.id+'" '+(r.media?.id===m.media.id?'selected':'')+'>'+esc(title(m.media))+(m.score<55?' · weak':'')+'</option>').join('')||'<option value="">No match</option>';
  const total=Number.isFinite(r.media?.episodes)&&r.media.episodes>0?Math.floor(r.media.episodes):'?';
  return '<div class="text-list-row '+(r.warning?'bad':'')+'" data-row="'+r.index+'"><div class="text-list-title">'+esc(r.sourceTitle)+'<div class="text-list-sub">'+esc(r.annotation||'no episode annotation')+'</div></div><select data-f="match">'+opts+'</select><select data-f="cat"><option value="watching" '+(r.category==='watching'?'selected':'')+'>Watching</option><option value="completed" '+(r.category==='completed'?'selected':'')+'>Completed</option><option value="interested" '+(r.category==='interested'?'selected':'')+'>Interested</option></select>'+(r.category==='interested'?'<span class="text-list-sub">—</span>':'<input data-f="watched" type="number" min="0" '+(total==='?'?'':'max="'+total+'"')+' value="'+(r.watched??'')+'" placeholder="Watched">')+'<span class="text-list-sub">Total: '+total+'</span>'+(r.warning?'<div class="text-list-warning">'+esc(r.warning)+'</div>':'')+'</div>';
}
function syncRow(i){
  const r=rows[i],el=modal.querySelector('[data-row="'+i+'"]'); if(!r||!el)return;
  r.category=el.querySelector('[data-f="cat"]').value;
  const id=el.querySelector('[data-f="match"]').value;r.media=r.matches.find(x=>String(x.media.id)===String(id))?.media||null;
  const w=el.querySelector('[data-f="watched"]');r.watched=w&&w.value!==''?Math.floor(Number(w.value)):null;r.warning='';
  if(!r.media)r.warning='Choose an AniList match.';
  if(r.score<55)r.warning=r.warning||'Low-confidence match — verify it.';
  if(r.category!=='interested'&&r.watched==null)r.warning=r.warning||'Enter watched episodes.';
  if(Number.isFinite(r.media?.episodes)&&r.watched!=null&&r.watched>r.media.episodes)r.warning='Watched episodes cannot exceed '+Math.floor(r.media.episodes)+'.';
  review();
}
async function addViaExistingUI(r){
  const q=document.querySelector('#anime-query'),cat=document.querySelector('#add-category'),form=document.querySelector('#search-form');
  q.value=title(r.media);cat.value=r.category;
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<60;i++){await new Promise(x=>setTimeout(x,100));const btn=document.querySelector('#search-results [data-action="add-result"][data-id="'+r.media.id+'"]');if(btn){btn.click();break}}
  if(r.category!=='interested'&&r.watched!=null){
    for(let i=0;i<40;i++){await new Promise(x=>setTimeout(x,75));const input=document.querySelector('#collection-grid [data-action="edit-count"][data-id="'+r.media.id+'"]');if(input){input.value=r.watched;input.dispatchEvent(new Event('change',{bubbles:true}));break}}
  }
}
async function confirm(){
  rows.forEach((r,i)=>syncRow(i)); if(rows.some(r=>r.warning))return;
  $('#tl-import').disabled=true;
  for(const r of rows)await addViaExistingUI(r);
  modal.close();
}
window.addEventListener('DOMContentLoaded',build);
