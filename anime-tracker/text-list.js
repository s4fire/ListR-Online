import { parseTextList, rankMatches } from './text-import.js';
import { searchAnime } from './api.js';
import { addImportedMedia, hasAnimeId } from './script.js';

let rows = [];
let modal;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const title = m => m?.title?.userPreferred || m?.title?.english || m?.title?.romaji || m?.title?.native || 'Unknown';
const $ = s => modal.querySelector(s);

function build() {
  const st = document.createElement('style');
  st.textContent = '.text-list-dialog{width:min(1080px,calc(100vw - 24px));max-height:90vh;padding:0;border:1px solid #3a3445;border-radius:18px;background:#15131c;color:#f5f1fa;box-shadow:0 30px 90px #000b}.text-list-dialog::backdrop{background:#08070dcc;backdrop-filter:blur(5px)}.text-list-head{display:flex;justify-content:space-between;padding:20px 23px;border-bottom:1px solid #2b2935}.text-list-head h2{margin:3px 0 4px}.text-list-head p{margin:0;color:#958d9e;font-size:11px}.text-list-close{background:0;border:0;color:#aaa2b0;font-size:24px}.text-list-body{padding:20px;overflow:auto;max-height:calc(90vh - 120px)}.text-list-input{width:100%;min-height:210px;resize:vertical;background:#0f0e15;color:#eee8f4;border:1px solid #34303c;border-radius:12px;padding:14px;outline:0;font:12px/1.6 ui-monospace,monospace}.text-list-options{display:flex;gap:9px;align-items:center;margin-top:11px;color:#a8a0ae;font-size:11px}.text-list-options select,.text-list-row input{height:34px;background:#0e0d13;color:#ddd5e4;border:1px solid #36313e;border-radius:7px;padding:0 7px;min-width:0}.tl-select{position:relative;min-width:0}.tl-select-button{width:100%;height:34px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#0e0d13;color:#ddd5e4;border:1px solid #36313e;border-radius:7px;padding:0 28px 0 8px;cursor:pointer}.tl-select-button:after{content:'⌄';position:absolute;right:9px;top:7px;color:#89818f}.tl-select-menu{display:none;position:absolute;z-index:20;left:0;right:0;top:38px;max-height:220px;overflow-y:auto;background:#17141d;border:1px solid #403a49;border-radius:9px;padding:4px;box-shadow:0 16px 35px #0009}.tl-select.open .tl-select-menu{display:block}.tl-select-option{display:block;width:100%;border:0;background:transparent;color:#ddd5e4;text-align:left;border-radius:6px;padding:8px;font-size:10px;cursor:pointer}.tl-select-option:hover,.tl-select-option.selected{background:#292431}.text-list-row{position:relative}.text-list-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.text-list-status{font-size:11px;color:#9d95a3}.text-list-status.error{color:#ff9eb9}.text-list-status.progress{display:flex;align-items:center;gap:9px}.text-list-spinner{width:13px;height:13px;border:2px solid #3a3445;border-top-color:#eee8f4;border-radius:50%;animation:tlspin .8s linear infinite}@keyframes tlspin{to{transform:rotate(360deg)}}.text-list-review{display:grid;gap:8px}.text-list-row{display:grid;grid-template-columns:1.5fr 1.25fr 120px 100px 100px;gap:8px;align-items:center;padding:10px;border:1px solid #2c2935;border-radius:10px;background:#111017}.text-list-row.bad{border-color:#6a3949}.text-list-title{font-size:11px;font-weight:650}.text-list-sub{font-size:9px;color:#89818f;margin-top:3px}.text-list-warning{grid-column:1/-1;color:#ffadbf;font-size:10px}.text-list-foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px}.text-list-foot small{color:#787180;font-size:9px}.text-list-duplicate{font-size:9px;color:#e7c47a}.text-list-ready{font-size:9px;color:#8fca9d}@media(max-width:760px){.text-list-row{grid-template-columns:1fr 1fr}.text-list-title,.text-list-warning{grid-column:1/-1}.text-list-foot{flex-direction:column;align-items:flex-end;gap:8px}}';
  document.head.appendChild(st);
  modal = document.createElement('dialog');
  modal.className = 'text-list-dialog';
  modal.innerHTML = '<div class="text-list-head"><div><p class="eyebrow">IMPORT YOUR COLLECTION</p><h2>Text to List</h2><p>Paste your list, review the AniList matches, then import what you confirm.</p></div><button class="text-list-close" type="button">×</button></div><div class="text-list-body"><div id="text-list-step"></div></div>';
  document.body.appendChild(modal);
  modal.querySelector('.text-list-close').onclick = () => modal.close();

}

function renderInput(msg = '') {
  $('#text-list-step').innerHTML = '<textarea id="tl-source" class="text-list-input" placeholder="Watching\nFrieren: Beyond Journey's End 10\nOne Piece 1157\n\nCompleted\nDemon Slayer\n\nInterested\nSolo Leveling"></textarea><div class="text-list-options">No heading? ${customSelect("default","watching",[{value:"watching",label:"Watching"},{value:"completed",label:"Completed"},{value:"interested",label:"Interested"}])}</div><p class="text-list-status '+(msg?'error':'')+'">'+esc(msg || 'Category headings require explicit watched counts for Watching and Completed.')+'</p><div class="text-list-actions"><button id="tl-parse" class="button button-primary" type="button">Parse list →</button></div>';
  bindCustomSelects();
  $('#tl-parse').onclick = parse;
}

function open() { modal.showModal(); renderInput(); $('#tl-source').focus(); }

function applyDefaults(r) {
  if (r.explicitCategory || r.category === 'interested') return;
  if (r.watched != null) return;
  if (r.category === 'watching') r.watched = 0;
  else if (r.category === 'completed' && Number.isFinite(r.media?.episodes) && r.media.episodes > 0) r.watched = Math.floor(r.media.episodes);
}

async function parse() {
  const items = parseTextList($('#tl-source').value, modal.querySelector('.tl-select[data-f="default"]').dataset.value);
  if (!items.length) { renderInput('No anime titles were detected.'); return; }
  rows = items.map((x, i) => ({...x, index:i, matches:[], media:null, score:0, warning:''}));
  renderProgress(0, rows.length, 'Starting AniList matching…');
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      renderProgress(i, rows.length, 'Finding AniList matches…');
      const ranked = rankMatches(r.sourceTitle, await searchAnime(r.sourceTitle));
      const seriesOnly = ranked.filter(x => Number(x.media?.episodes) > 1);
      r.matches = (seriesOnly.length ? seriesOnly : ranked).slice(0, 5);
      r.media = r.matches[0]?.media || null;
      r.score = r.matches[0]?.score || 0;
      applyDefaults(r);
      if (!r.media) r.warning = 'No AniList match. Choose a match or go back.';
      else if (r.score < 55) r.warning = 'Low-confidence match — verify it.';
      if (r.explicitCategory && r.category !== 'interested' && r.watched == null) r.warning = r.warning || 'Watched episode count is required for category-heading imports.';
    }
    renderProgress(rows.length, rows.length, 'Matches ready.');
    review();
  } catch (e) { renderInput(e.message || 'AniList search failed.'); }
}

function renderProgress(done, total, message) {
  const pct = total ? Math.round(done / total * 100) : 0;
  $('#text-list-step').innerHTML = '<div class="text-list-status progress"><span class="text-list-spinner"></span><span>'+esc(message)+' '+done+'/'+total+' ('+pct+'%)</span></div>';
}

function review() {
  const bad = rows.filter(r => r.warning).length;
  $('#text-list-step').innerHTML = '<div class="text-list-status">'+rows.length+' title(s) · '+(bad ? bad+' need attention' : 'ready to import')+'</div><div class="text-list-review">'+rows.map(rowHtml).join('')+'</div><div class="text-list-foot"><small>Nothing is saved until Import.</small><div class="text-list-actions"><button id="tl-back" class="button button-quiet">Back</button><button id="tl-import" class="button button-primary" '+(bad ? 'disabled' : '')+'>Import '+rows.length+' anime</button></div></div>';
  $('#tl-back').onclick = () => renderInput();
  $('#tl-import').onclick = confirm;
  bindCustomSelects();
}
function customSelect(field, value, options) {
  const label = options.find(o => String(o.value) === String(value))?.label || 'Choose…';
  return '<div class="tl-select" data-f="'+field+'" data-value="'+esc(value ?? '')+'"><button type="button" class="tl-select-button">'+esc(label)+'</button><div class="tl-select-menu">'+options.map(o => '<button type="button" class="tl-select-option '+(String(o.value)===String(value)?'selected':'')+'" data-value="'+esc(o.value)+'">'+esc(o.label)+'</button>').join('')+'</div></div>';
}
function bindCustomSelects() {
  modal.querySelectorAll('.tl-select').forEach(select => {
    select.querySelector('.tl-select-button').onclick = e => {
      e.stopPropagation();
      modal.querySelectorAll('.tl-select.open').forEach(x => { if (x !== select) x.classList.remove('open'); });
      select.classList.toggle('open');
    };
    select.querySelectorAll('.tl-select-option').forEach(option => option.onclick = e => {
      e.stopPropagation();
      select.dataset.value = option.dataset.value;
      select.classList.remove('open');
      const row = select.closest('[data-row]');
      if (row) syncRow(+row.dataset.row);
    });
  });
  if (!window.__tlOutsideBound) { document.addEventListener('click', closeCustomSelects); window.__tlOutsideBound = true; }
}
function closeCustomSelects() {
  modal.querySelectorAll('.tl-select.open').forEach(x => x.classList.remove('open'));
}


function rowHtml(r) {
  const matchOptions = r.matches.map(m => ({value:m.media.id,label:title(m.media)+(m.score<55?' · weak':'')}));
  const total = Number.isFinite(r.media?.episodes) && r.media.episodes > 0 ? Math.floor(r.media.episodes) : '?';
  const duplicate = r.media && hasAnimeId(r.media.id);
  const status = duplicate ? '<span class="text-list-duplicate">Already in your list</span>' : '<span class="text-list-ready">New</span>';
  return '<div class="text-list-row '+(r.warning?'bad':'')+'" data-row="'+r.index+'"><div class="text-list-title">'+esc(r.sourceTitle)+'<div class="text-list-sub">'+esc(r.annotation || 'no episode annotation')+'</div></div>'+customSelect('match',r.media?.id||'',matchOptions)+customSelect('cat',r.category,[{value:'watching',label:'Watching'},{value:'completed',label:'Completed'},{value:'interested',label:'Interested'}])+(r.category==='interested'?'<span class="text-list-sub">—</span>':'<input data-f="watched" type="number" min="0" '+(total==='?'?'':'max="'+total+'"')+' value="'+(r.watched ?? '')+'" placeholder="Watched">')+'<span class="text-list-sub">Total: '+total+'</span>'+status+(r.warning?'<div class="text-list-warning">'+esc(r.warning)+'</div>':'')+'</div>';
}
function syncRow(i) {
  const r = rows[i], el = modal.querySelector('[data-row="'+i+'"]');
  if (!r || !el) return;
  r.category = el.querySelector('[data-f="cat"]').dataset.value;
  const id = el.querySelector('[data-f="match"]').dataset.value;
  r.media = r.matches.find(x => String(x.media.id) === String(id))?.media || null;
  const w = el.querySelector('[data-f="watched"]');
  r.watched = w && w.value !== '' ? Math.floor(Number(w.value)) : null;
  if (!r.explicitCategory && r.watched == null) applyDefaults(r);
  r.warning = '';
  if (!r.media) r.warning = 'Choose an AniList match.';
  if (r.media && r.score < 55) r.warning = r.warning || 'Low-confidence match — verify it.';
  if (r.explicitCategory && r.category !== 'interested' && r.watched == null) r.warning = r.warning || 'Enter watched episodes.';
  if (Number.isFinite(r.media?.episodes) && r.watched != null && r.watched > r.media.episodes) r.warning = 'Watched episodes cannot exceed '+Math.floor(r.media.episodes)+'.';
}

function confirm() {
  rows.forEach((r, i) => syncRow(i));
  if (rows.some(r => r.warning)) { review(); return; }
  const button = $('#tl-import');
  button.disabled = true;
  button.textContent = 'Importing…';
  void doImport();
}

async function doImport() {
  try {
    for (let i = 0; i < rows.length; i++) {
      renderImportProgress(i, rows.length);
      const r = rows[i];
      if (!r.media || hasAnimeId(r.media.id)) continue;
      addImportedMedia(r.media, r.category, r.watched);
    }
    renderImportProgress(rows.length, rows.length);
    await new Promise(resolve => setTimeout(resolve, 350));
    modal.close();
  } catch (e) {
    $('#text-list-step').innerHTML = '<p class="text-list-status error">'+esc(e.message || 'Import failed. Your confirmed items may have been saved; review your list before retrying.')+'</p><div class="text-list-actions"><button id="tl-fail-close" class="button button-quiet">Close</button></div>';
    $('#tl-fail-close').onclick = () => modal.close();
  }
}

function renderImportProgress(done, total) {
  $('#text-list-step').innerHTML = '<div class="text-list-status progress"><span class="text-list-spinner"></span><span>Importing '+done+' / '+total+'…</span></div><div class="text-list-sub">Your confirmed anime are being added to your list.</div>';
}

function mountButton() {
  if (document.querySelector('[data-action="open-text-list"]')) return;
  const searchButton = document.querySelector('#open-search');
  const b = document.createElement('button');
  b.className = 'button button-quiet text-list-trigger';
  b.textContent = 'Text to List';
  b.type = 'button';
  b.dataset.action = 'open-text-list';
  b.onclick = open;
  if (searchButton?.parentElement) {
    searchButton.parentElement.insertBefore(b, searchButton);
  } else {
    document.querySelector('main')?.prepend(b);
  }
}
window.addEventListener('DOMContentLoaded', () => { build(); mountButton(); });

