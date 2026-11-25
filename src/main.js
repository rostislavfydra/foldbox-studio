import { Studio, views, drawAxis } from './scene.js';
import { makeZip } from './zip.js';
import { designs, designById, loadDesign } from './artwork.js';
import { templateProject,copyProject,customArtwork,storedProject,decodeImage,imageFor,validateSpreads } from './project.js';
import { setupEditor } from './editor.js';
import { formats, sheetSides, loadPaper, templateBlob } from './booklet.js';
import { importSpreads } from './spread-import.js';
import { bookletPresets, presetById, artworkForPreset } from './booklet-presets.js';

const byId = id => document.getElementById(id);
const viewport = byId('viewport'), fieldset = byId('settings');
const single = byId('export-one'), batch = byId('export-all');
const sizeHint = byId('size-hint'), status = byId('export-status');
const format = new Intl.NumberFormat('ru-RU',{useGrouping:false, maximumFractionDigits:3});
const defaults = {width:410, depth:300.3, height:105, flap:100.085, estimatedHeight:true, open:false, varnish:true, foil:true, artwork:'facade-emblem', artworkVersion:3, resolution:2048};
Object.assign(defaults,{product:'box',bookletFormat:'A4',bookletInserted:false,bookletReveal:55,bookletSide:'inside',
  bookletGuides:true,a4Preset:'',a4Guides:false,a3Preset:null,a3Guides:false});
const presetKey = size => size.toLowerCase()+'Preset';
const limits = {width:[60,1200,'Ширина'],depth:[60,1200,'Глубина'],height:[12,600,'Высота'],flap:[5,600,'Длина клапана']};
const key = 'foldbox-studio:settings:v1';
const state = {...defaults};
try {
  const stored = JSON.parse(localStorage.getItem(key) || '{}');
  for (const [name,[min,max]] of Object.entries(limits)) {
    if (Number.isFinite(stored[name]) && stored[name]>=min && stored[name]<=max) state[name]=stored[name];
  }
  for (const name of ['open','varnish','foil','estimatedHeight']) {
    if (typeof stored[name] === 'boolean') state[name]=stored[name];
  }
  if ([1024,2048,3072].includes(stored.resolution)) state.resolution=stored.resolution;
  if (['base','custom'].includes(stored.artwork) || designById(stored.artwork)) state.artwork=stored.artwork;
  if (stored.artworkVersion!==defaults.artworkVersion) {state.artwork=defaults.artwork;state.open=false;}
  if (stored.flap===undefined && state.estimatedHeight) state.height=defaults.height;
  if (state.flap>state.height) state.flap=Math.round(state.height*.95*1000)/1000;
  if (stored.product==='booklet') state.product='booklet';
  if (Object.keys(formats).includes(stored.bookletFormat)) state.bookletFormat=stored.bookletFormat;
  if (stored.bookletSide==='outside') state.bookletSide='outside';
  if (Number.isInteger(stored.bookletReveal) && stored.bookletReveal>=0 && stored.bookletReveal<=100) state.bookletReveal=stored.bookletReveal;
  for (const k of ['bookletInserted','bookletGuides','a4Guides','a3Guides']) if(typeof stored[k]==='boolean')state[k]=stored[k];
  for (const size of Object.keys(formats)) {
    const name=presetKey(size);
    if (stored[name]==='' || presetById(size,stored[name])) state[name]=stored[name];
  }
} catch { /* Private browsing can disable local storage. */ }
const linked=new URLSearchParams(location.search);
const linkedProduct=linked.get('model'), linkedFormat=linked.get('format');
if (['box','booklet'].includes(linkedProduct)) state.product=linkedProduct;
if (linkedProduct==='booklet' && Object.hasOwn(formats,linkedFormat)) state.bookletFormat=linkedFormat;
if (linkedProduct==='box') {
  const design=linked.get('design'), lid=linked.get('lid');
  if (design==='base' || designById(design)) state.artwork=design;
  if (lid==='open' || lid==='closed') state.open=lid==='open';
}
function persist() { try {localStorage.setItem(key,JSON.stringify(state));} catch {} }
function updateProductUrl() {
  const url=new URL(location.href);
  url.searchParams.set('model',state.product);
  if (state.product==='booklet') {
    url.searchParams.set('format',state.bookletFormat);
    url.searchParams.delete('design');url.searchParams.delete('lid');
  } else {
    url.searchParams.delete('format');
    if (state.artwork==='custom') url.searchParams.delete('design');
    else url.searchParams.set('design',state.artwork);
    if (url.searchParams.has('lid')) url.searchParams.set('lid',state.open ? 'open' : 'closed');
  }
  try {history.replaceState(null,'',url);} catch {}
}

const bookletViews=views.filter(view=>['three-quarter','top','bottom'].includes(view.id));
function availableViews() {return state.product==='booklet' ? bookletViews : views;}
const camera = {yaw:views[0].yaw,pitch:views[0].pitch,zoom:1,id:views[0].id};
let measures=false, studio, ready=false, busy=false, valid=true, heightEdited=false;
let pose=state.open ? 1 : 0, animating=false, animationId=0;
let frameId=0,thumbTimer=0,dimensionsTimer=0,previousDownload='';
let loadingDesign=false,designRevision=0;
let savedProject=null;
let paper, paperBusy=false;
let sharedSheet={art:{outside:null,inside:null},images:{}};
const personalSheets={}, selectedSheets={};
function formatSheet(size=state.bookletFormat) {return selectedSheets[size] || personalSheets[size];}
function currentSheet() {return formatSheet() || sharedSheet;}
function guideSetting() {return formatSheet() ? state.bookletFormat.toLowerCase()+'Guides' : 'bookletGuides';}

// Keep legacy uploads shared until the user edits a format-specific edition.
function setPersonalSheet(sheet,fromPreset=false) {
  const size=state.bookletFormat;
  if (fromPreset || formatSheet(size) || (size==='A3' && state.a3Preset!==null)) {
    personalSheets[size]=sheet;selectedSheets[size]=null;state[presetKey(size)]='';
    return 'booklet-art-'+size.toLowerCase();
  }
  sharedSheet=sheet;
  return 'booklet-art';
}
const touches=new Map();
const prefersReducedMotion=matchMedia('(prefers-reduced-motion: reduce)');

for (const name of Object.keys(limits)) byId(name).value=format.format(state[name]);
byId('varnish').checked=state.varnish;
byId('foil').checked=state.foil;
byId('resolution').value=String(state.resolution);

function updateHint() {
  sizeHint.classList.remove('error');
  sizeHint.textContent=state.estimatedHeight ? 'Высота указана приблизительно.' : 'Внешние размеры закрытой коробки.';
}
updateHint();
function exportAvailability() {
  const boxBlocked=state.product==='box' && (!valid || !!dimensionsTimer || animating || loadingDesign);
  single.disabled=batch.disabled=!ready || busy || paperBusy || boxBlocked;
  for (const id of ['model-box','model-booklet']) byId(id).disabled=!ready || busy || paperBusy;
  for (const side of sheetSides) byId('file-'+side).disabled=!ready || busy || paperBusy;
}
exportAvailability();
function updateLidButtons() {
  byId('opened').setAttribute('aria-pressed',String(state.open));
  byId('closed').setAttribute('aria-pressed',String(!state.open));
  updateTrayHint();
}
updateLidButtons();

function updateTrayHint() {
  const fit=studio?.bookletFit, trayHint=byId('tray-hint'), fitHint=byId('fit-hint');
  const unavailable=!!studio?.booklet && !fit;
  const reason='Сложенный буклет не помещается поверх вложений при этих габаритах.';
  trayHint.hidden=!state.bookletInserted;
  trayHint.classList.toggle('error',unavailable);
  trayHint.textContent=unavailable ? reason : state.open ? (fit?.angle ? 'Буклет лежит поперёк коробки.' : 'Буклет лежит поверх вложений.') : 'Откройте крышку, чтобы увидеть буклет.';
  fitHint.hidden=!unavailable && valid;
  fitHint.textContent=!valid ? 'Проверьте габариты в настройках коробки.' : reason;
  byId('insert-booklet').disabled=!ready || busy || paperBusy || !valid || !fit;
}

const presetButtons={};
for (const [size,items] of Object.entries(bookletPresets)) {
  const group=byId(size.toLowerCase()+'-presets');
  if (!group) continue;
  presetButtons[size]=[...items,{id:'',label:'Свой макет'}].map(item=>{
    const button=document.createElement('button');
    button.type='button';button.className='booklet-preset';button.dataset.preset=item.id;
    const swatch=document.createElement(item.thumb ? 'img' : 'span');
    if (item.thumb) {swatch.src=item.thumb;swatch.alt='';}
    else {swatch.className='custom-sheet';swatch.setAttribute('aria-hidden','true');}
    button.append(swatch,document.createTextNode(item.label));
    button.addEventListener('click',()=>choosePreset(size,item.id));
    group.append(button);
    return button;
  });
}

function bookletUI() {
  const solo=state.product==='booklet', spec=formats[state.bookletFormat];
  byId('product-title').textContent=solo ? 'Буклет в два сгиба' : 'Коробка-книга';
  byId('stage').classList.toggle('paper-stage',solo);
  document.title=byId('product-title').textContent+' — Студия упаковки';
  byId('box-tone').hidden=solo;byId('booklet-caption').hidden=!solo;
  byId('booklet-caption').textContent=state.bookletFormat+' · '+spec.width+' × '+spec.depth+' мм';
  for (const id of ['box-geometry','box-lid']) byId(id).hidden=solo;
  for (const id of ['booklet-geometry','booklet-art']) byId(id).hidden=!solo;
  for (const [size,buttons] of Object.entries(presetButtons)) {
    byId(size.toLowerCase()+'-library').hidden=!solo || state.bookletFormat!==size;
    for (const button of buttons) button.setAttribute('aria-pressed',String(button.dataset.preset===(selectedSheets[size]?.id || '')));
  }
  for (const product of ['box','booklet']) byId('model-'+product).setAttribute('aria-pressed',String(state.product===product));
  viewport.setAttribute('aria-label','3D-модель '+(solo?'буклета':'коробки')+'. Используйте стрелки для вращения, плюс и минус для масштаба.');
  for (const key of Object.keys(formats)) byId('paper-'+key.toLowerCase()).setAttribute('aria-pressed',String(key===state.bookletFormat));
  byId('folded-size').textContent=spec.panel+' × '+spec.depth+' мм';
  byId('panel-widths').textContent=[spec.tuck,spec.panel,spec.panel].join(' / ')+' мм';
  byId('paper-fold').value=String(state.bookletReveal);
  byId('fold-value').textContent=state.bookletReveal+'%';
  byId('paper-fold').setAttribute('aria-valuetext',state.bookletReveal+'% раскрытия');
  for (const [id,reveal] of [['closed',0],['partial',55],['flat',100]]) {
    byId('fold-'+id).setAttribute('aria-pressed',String(state.bookletReveal===reveal));
  }
  for (const side of sheetSides) {
    byId('show-'+side).setAttribute('aria-pressed',String(state.bookletReveal===100 && side===state.bookletSide));
    const file=currentSheet().art[side];
    byId('name-'+side).textContent=file?.name || '';
    byId('info-'+side).hidden=byId('remove-'+side).hidden=!file;
    byId('file-action-'+side).textContent=file ? 'Заменить' : 'Загрузить';
    const thumb=byId('preview-'+side);
    if (file && thumb.getAttribute('src')!==file.src) thumb.src=file.src;
    if (!file) thumb.removeAttribute('src');
  }
  byId('paper-guides').checked=state[guideSetting()];
  byId('paper-pdf').textContent='Скачать шаблон '+state.bookletFormat+' · PDF';
  byId('tray-booklet').value=state.bookletInserted ? state.bookletFormat : '';
  updateTrayHint();
}
bookletUI();
function refreshBooklet() {
  studio.updateBooklet(paper,currentSheet().images,state[guideSetting()]);
  bookletUI();persist();status.replaceChildren();paperMessage('');
  invalidate();paintThumbnails();exportAvailability();
}
function selectProduct(product) {
  if (!ready || busy || paperBusy) return;
  state.product=product;
  updateProductUrl();updateViewChoices();
  refreshBooklet();chooseView(views[0]);
}
byId('model-booklet').addEventListener('click',()=>selectProduct('booklet'));
byId('model-box').addEventListener('click',()=>selectProduct('box'));
for (const key of Object.keys(formats)) byId('paper-'+key.toLowerCase()).addEventListener('click',()=>{
  activateFormat(key,()=>{updateProductUrl();refreshBooklet();});
});
function revealBooklet(reveal, side) {
  if (!ready || busy || paperBusy) return;
  state.bookletReveal=reveal;
  if (side) state.bookletSide=side;
  refreshBooklet();
}
byId('paper-fold').addEventListener('input',e=>revealBooklet(Number(e.target.value)));
for (const [id,value] of [['closed',0],['partial',55],['flat',100]]) byId('fold-'+id).addEventListener('click',()=>{
  revealBooklet(value,value===100 ? state.bookletSide : 'inside');
  if (value!==100) chooseView(views[0]);
});
function showPaperSide(side) {
  revealBooklet(100,side);chooseView(views.find(view=>view.id==='top'));
}
function paperMessage(message,error=false) {
  const el=byId('paper-status');el.textContent=message;el.hidden=!message;el.classList.toggle('error',error);
}
async function editSheet(progress, edit) {
  if (!ready || busy || paperBusy) return;
  paperBusy=true;fieldset.disabled=true;exportAvailability();
  paperMessage(progress);
  try {await edit();}
  catch(error) {paperMessage(error.message || 'Не удалось применить оформление буклета.',true);}
  finally {paperBusy=false;fieldset.disabled=false;bookletUI();exportAvailability();}
}
async function loadPreset(preset) {
  const art=await artworkForPreset(preset);
  return {id:preset.id,art,images:await spreadImages(art,decodeImage)};
}
async function restorePreset(size) {
  const id=state[presetKey(size)];
  const firstA3=size==='A3' && id===null && !personalSheets.A3 && !sheetSides.some(side=>sharedSheet.art[side]);
  const preset=firstA3 ? bookletPresets.A3[0] : presetById(size,id);
  if (preset && selectedSheets[size]?.id!==preset.id) {
    selectedSheets[size]=await loadPreset(preset);
    state[presetKey(size)]=preset.id;
  }
}
function activateFormat(size,apply) {
  return editSheet('Загрузка разворота…',async()=>{
    try {await restorePreset(size);}
    finally {state.bookletFormat=size;apply();}
  });
}
function choosePreset(size,id) {
  if (state.bookletFormat!==size || (id===(selectedSheets[size]?.id || '') && id===state[presetKey(size)])) return;
  return editSheet('Загрузка варианта…',async()=>{
    const preset=presetById(size,id);
    selectedSheets[size]=preset ? await loadPreset(preset) : null;
    state[presetKey(size)]=id;
    if (preset) state[guideSetting()]=false;
    refreshBooklet();
  });
}
function changeSpread(side,file) {
  return editSheet('Подготовка разворота…',async()=>{
    const sheet=currentSheet();
    const changes=file ? await importSpreads(file,side,sheet.art,paperMessage) : {[side]:null};
    if (!changes) {paperMessage('');return;}
    const updates=await Promise.all(Object.entries(changes).map(async ([key,entry])=>
      [key,entry ? await decodeImage(entry.src) : null]));
    const art={...sheet.art,...changes};
    const storageKey=setPersonalSheet({art,images:{...sheet.images,...Object.fromEntries(updates)}});
    if (file) state[guideSetting()]=false;
    state.bookletReveal=100;state.bookletSide=side in changes ? side : updates[0][0];
    refreshBooklet();chooseView(views.find(view=>view.id==='top'));
    try {
      await storedProject(art,storageKey);
      paperMessage(!file ? 'Оформление стороны убрано.' : updates.length===2 ? 'Обе стороны применены и сохранены.' : 'Оформление стороны сохранено.');
    } catch {paperMessage('Изменение применено на эту сессию. Хранилище браузера недоступно.');}
  });
}
for (const side of sheetSides) {
  byId('show-'+side).addEventListener('click',()=>showPaperSide(side));
  byId('remove-'+side).addEventListener('click',()=>changeSpread(side,null));
  byId('file-'+side).addEventListener('change',e=>{
    const file=e.target.files[0];e.target.value='';
    if (file) changeSpread(side,file);
  });
}
function transferredFile(data) {
  if (data.files.length>1) throw Error('Перетащите один файл на выбранную сторону.');
  if (data.files.length) return data.files[0];
  const svg=data.getData('text/plain').trim();
  if (/<svg[\s>]/i.test(svg)) return new File([svg],'Из буфера.svg',{type:'image/svg+xml'});
  return null;
}
function receiveFile(event, data, side) {
  try {
    const file=transferredFile(data);
    if (file) {event.preventDefault();changeSpread(side,file);}
  } catch(error) {event.preventDefault();paperMessage(error.message,true);}
}
for(const target of [byId('stage'),...document.querySelectorAll('[data-spread]')]) {
  target.addEventListener('dragover',e=>{
    if (state.product!=='booklet' || ![...e.dataTransfer.types].some(t=>t==='Files' || t==='text/plain')) return;
    e.preventDefault();e.dataTransfer.dropEffect='copy';target.classList.add('is-over');
  });
  target.addEventListener('dragleave',e=>{if(!target.contains(e.relatedTarget))target.classList.remove('is-over');});
  target.addEventListener('drop',e=>{
    if (state.product!=='booklet') return;
    target.classList.remove('is-over');e.preventDefault();
    receiveFile(e,e.dataTransfer,target.dataset.spread || state.bookletSide);
  });
}
document.addEventListener('paste',e=>{
  if (state.product!=='booklet' || !ready || busy || paperBusy || document.querySelector('dialog[open]') ||
      e.target.closest?.('textarea,input:not([type=file]),[contenteditable=true]')) return;
  receiveFile(e,e.clipboardData,e.target.closest?.('[data-spread]')?.dataset.spread || state.bookletSide);
});
byId('paper-guides').addEventListener('change',e=>{
  if (!ready || busy || paperBusy) return;
  state[guideSetting()]=e.target.checked;refreshBooklet();
});
byId('paper-pdf').addEventListener('click',()=>{
  offerDownload(templateBlob(state.bookletFormat),'booklet-'+state.bookletFormat.toLowerCase()+'.pdf');
});
byId('insert-booklet').addEventListener('click',()=>{
  if (!ready || busy || paperBusy || !studio.bookletFit || !valid) return;
  state.bookletInserted=true;selectProduct('box');setLid(true);
});
byId('tray-booklet').addEventListener('change',e=>{
  if (!ready || busy || paperBusy) return;
  const size=e.target.value;
  if (!size) {state.bookletInserted=false;refreshBooklet();return;}
  activateFormat(size,()=>{
    state.bookletInserted=true;refreshBooklet();
    if (studio.bookletFit) setLid(true);
  });
});

const designButtons=designs.map(design=>{
  const button=document.createElement('button'), img=document.createElement('img');
  button.className='design-choice'; button.id='art-'+design.id;
  img.src=design.thumb;img.alt='';
  button.append(img,document.createTextNode(design.label));
  button.setAttribute('aria-label','Применить макет «'+design.label+'»');
  button.addEventListener('click',()=>selectDesign(design.id));
  byId('designs').append(button);
  return {id:design.id,button};
});
function showSelection(id) {
  for (const item of designButtons) item.button.setAttribute('aria-pressed',String(item.id===id));
  byId('base-art').setAttribute('aria-pressed',String(id==='base'));
  byId('base-finishes').hidden=id!=='base';
  byId('my-design').hidden=!savedProject;
  byId('my-design').setAttribute('aria-pressed',String(id==='custom'));
  const tint=id==='custom' ? savedProject?.bodyColor || '#24354c' : '#24354c';
  byId('tone-sample').style.background=tint;
  byId('tone-name').textContent=tint.toLowerCase()==='#24354c' ? 'Тёмно-синий' : tint.toUpperCase();
}
function boxArtwork(id) {
  const project=id==='custom' ? savedProject : designById(id)?.project;
  return project ? customArtwork(project,studio) : loadDesign(id,studio.renderer,studio.materials.bump);
}
async function selectDesign(id) {
  if (!ready || busy) return;
  const revision=++designRevision;
  loadingDesign=true;exportAvailability();showSelection(id);
  byId('art-status').textContent='Применение макета…';
  try {
    const pair=await boxArtwork(id);
    if (revision!==designRevision) {pair?.dispose();return;}
    studio.setArtwork(pair);
    state.artwork=id;updateProductUrl();persist();
    byId('art-status').textContent='';
    status.replaceChildren();
    invalidate();paintThumbnails();
  } catch {
    if (revision!==designRevision) return;
    showSelection(state.artwork);
    byId('art-status').textContent='Макет не загрузился. Выберите его ещё раз.';
  } finally {
    if (revision===designRevision) {loadingDesign=false;exportAvailability();}
  }
}
byId('base-art').addEventListener('click',()=>selectDesign('base'));
byId('my-design').addEventListener('click',()=>selectDesign('custom'));
showSelection(state.artwork);

const thumbButtons = views.map(view => {
  const button=document.createElement('button');
  button.className='view-button';
  button.setAttribute('aria-pressed',String(view.id===camera.id));
  button.setAttribute('aria-label','Показать ракурс «'+view.name+'»');
  const holder=document.createElement('span'), thumb=document.createElement('canvas'), label=document.createElement('span');
  holder.className='thumb';
  thumb.width=234;thumb.height=150;
  thumb.setAttribute('aria-hidden','true');
  label.className='view-name';label.textContent=view.name;
  holder.append(thumb);button.append(holder,label);
  button.addEventListener('click',()=>chooseView(view));
  return {view,button,thumb};
});

function updateViewChoices() {
  const choices=availableViews(), strip=byId('views');
  strip.replaceChildren(...thumbButtons.filter(item=>choices.includes(item.view)).map(item=>item.button));
  strip.classList.toggle('booklet-views',state.product==='booklet');
  byId('export-all-label').textContent='Скачать '+choices.length+(choices.length===3 ? ' ракурса' : ' ракурсов');
}
updateViewChoices();

function showFailure(message) {
  ready=false;
  fieldset.disabled=true;
  for (const entry of thumbButtons) entry.button.disabled=true;
  for (const id of ['zoom-in','zoom-out','fit','measure']) byId(id).disabled=true;
  const sceneStatus=byId('scene-status');
  sceneStatus.textContent=message+' ';
  const retry=document.createElement('button');
  retry.textContent='Обновить страницу'; retry.style.cssText='display:inline-block;text-decoration:underline;pointer-events:auto';
  retry.addEventListener('click',()=>location.reload());
  sceneStatus.append(retry);
  exportAvailability();
}

function paint() {
  frameId=0;
  if (!ready || busy) return;
  const rect=viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr=Math.min(window.devicePixelRatio || 1,2,2200/rect.width);
  const w=Math.max(1,Math.round(rect.width*dpr)), h=Math.max(1,Math.round(rect.height*dpr));
  studio.paint(viewport,w,h,camera,{kind:'preview', zoom:camera.zoom, measure:measures});
  if (measures) studio.drawDimensions(viewport,dpr,camera);
  drawAxis(byId('axis'),camera);
}
function invalidate() {
  if (!frameId) frameId=requestAnimationFrame(paint);
}
function paintThumbnails() {
  clearTimeout(thumbTimer);
  thumbTimer=setTimeout(()=>{
    if (!ready || busy || animating) return;
    for (const {view,thumb} of thumbButtons) {
      if (availableViews().includes(view)) studio.paint(thumb,234,150,view,{kind:'thumb'});
    }
  },65);
}
function updateCameraUi() {
  const entry=views.find(view=>view.id===camera.id);
  byId('current-view').textContent=entry ? entry.name : 'Свободный вид';
  byId('zoom').textContent=Math.round(camera.zoom*100)+'%';
  byId('zoom-out').disabled=camera.zoom<=.55;
  byId('zoom-in').disabled=camera.zoom>=2.2;
  for (const item of thumbButtons) item.button.setAttribute('aria-pressed',String(item.view.id===camera.id));
}
function chooseView(view) {
  if (!ready || busy) return;
  Object.assign(camera,{yaw:view.yaw,pitch:view.pitch,id:view.id,zoom:1});
  updateCameraUi();invalidate();
}
function orbit(dx,dy) {
  if (!ready || busy) return;
  camera.yaw-=dx*.008;
  camera.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,camera.pitch+dy*.007));
  camera.id='custom';
  updateCameraUi();invalidate();
}
function zoomBy(factor) {
  if (!ready || busy) return;
  camera.zoom=Math.max(.55,Math.min(2.2,camera.zoom*factor));
  updateCameraUi();invalidate();
}
byId('fit').addEventListener('click',()=>chooseView(views[0]));
byId('zoom-in').addEventListener('click',()=>zoomBy(1.2));
byId('zoom-out').addEventListener('click',()=>zoomBy(1/1.2));
byId('measure').addEventListener('click',()=>{
  if (!ready || busy) return;
  measures=!measures;
  byId('measure').setAttribute('aria-pressed',String(measures));
  invalidate();
});
viewport.addEventListener('pointerdown',e=>{
  if (!ready || busy || (e.pointerType==='mouse' && e.button!==0)) return;
  viewport.focus({preventScroll:true});
  viewport.setPointerCapture(e.pointerId);
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove',e=>{
  const previous=touches.get(e.pointerId);
  if (!previous || busy) return;
  const next={x:e.clientX,y:e.clientY};
  if (touches.size===1) {
    if (next.x!==previous.x || next.y!==previous.y) orbit(next.x-previous.x,next.y-previous.y);
  } else if (touches.size===2) {
    const other=[...touches.entries()].find(([id])=>id!==e.pointerId)[1];
    const oldLength=Math.hypot(previous.x-other.x,previous.y-other.y);
    const newLength=Math.hypot(next.x-other.x,next.y-other.y);
    if (oldLength>2 && newLength>2) zoomBy(newLength/oldLength);
  }
  touches.set(e.pointerId,next);
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) viewport.addEventListener(type,e=>{
  touches.delete(e.pointerId);
  if (!touches.size) viewport.classList.remove('dragging');
});
viewport.addEventListener('wheel',e=>{
  if (!ready || busy) return;
  e.preventDefault();
  const delta=e.deltaY*(e.deltaMode===1 ? 14 : e.deltaMode===2 ? 200 : 1);
  zoomBy(Math.exp(-Math.max(-160,Math.min(160,delta))*.002));
},{passive:false});
viewport.addEventListener('keydown',e=>{
  const steps={ArrowLeft:[-9,0],ArrowRight:[9,0],ArrowUp:[0,9],ArrowDown:[0,-9]};
  if (steps[e.key]) orbit(...steps[e.key]);
  else if (e.key==='+' || e.key==='=') zoomBy(1.2);
  else if (e.key==='-') zoomBy(1/1.2);
  else if (e.key==='Home') chooseView(views[0]);
  else return;
  e.preventDefault();
});

function readDimensions() {
  const result={};
  let error='';
  for (const [name,[min,max,label]] of Object.entries(limits)) {
    const el=byId(name), raw=el.value.trim();
    const n=/^\d+(?:[.,]\d{1,3})?$/.test(raw) ? Number(raw.replace(',','.')) : NaN;
    const ok=Number.isFinite(n) && n>=min && n<=max;
    el.setAttribute('aria-invalid',String(!ok));
    if (!ok && !error) error=label+' — число от '+min+' до '+max+' мм (до 3 знаков после запятой).';
    result[name]=n;
  }
  if (!error && result.flap>result.height) {
    error='Клапан длиннее передней стенки. Уменьшите длину клапана или увеличьте высоту.';
    byId('flap').setAttribute('aria-invalid','true');
  }
  valid=!error;
  if (error) {sizeHint.textContent=error;sizeHint.classList.add('error');}
  else updateHint();
  return valid ? result : null;
}
function commitDimensions() {
  clearTimeout(dimensionsTimer);dimensionsTimer=0;
  const next=readDimensions();
  if (next && ready && !busy) {
    const changed=Object.keys(next).some(name=>next[name]!==state[name]);
    if (heightEdited) {state.estimatedHeight=false;heightEdited=false;}
    if (changed) {
      Object.assign(state,next);
      cancelAnimationFrame(animationId);
      animating=false;pose=state.open ? 1 : 0;
      studio.rebuild(state);
      invalidate();paintThumbnails();
    }
    persist();updateHint();
  }
  updateTrayHint();
  exportAvailability();
}
for (const name of Object.keys(limits)) {
  const el=byId(name);
  el.addEventListener('input',()=>{
    if (name==='height') heightEdited=true;
    clearTimeout(dimensionsTimer);dimensionsTimer=0;
    if (readDimensions()) dimensionsTimer=setTimeout(commitDimensions,220);
    exportAvailability();
  });
  el.addEventListener('change',commitDimensions);
  el.addEventListener('blur',()=>{
    commitDimensions();
    if (valid) el.value=format.format(state[name]);
  });
  el.addEventListener('keydown',e=>{if (e.key==='Enter') el.blur();});
}
function setLid(open) {
  if (!ready || busy || state.open===open) return;
  state.open=open;updateProductUrl();persist();updateLidButtons();
  cancelAnimationFrame(animationId);
  const startPose=pose, goal=open ? 1 : 0, start=performance.now();
  const duration=prefersReducedMotion.matches ? 0 : 560*Math.abs(goal-startPose);
  animating=true;exportAvailability();
  function step(now) {
    const t=duration ? Math.min(1,(now-start)/duration) : 1;
    pose=startPose+(goal-startPose)*t*t*(3-2*t);
    studio.pose(pose);invalidate();
    if (t<1) animationId=requestAnimationFrame(step);
    else {animating=false;exportAvailability();paintThumbnails();}
  }
  step(start);
}
byId('closed').addEventListener('click',()=>setLid(false));
byId('opened').addEventListener('click',()=>setLid(true));
for (const name of ['varnish','foil']) byId(name).addEventListener('change',()=>{
  if (!ready || busy) return;
  state[name]=byId(name).checked;
  studio.box.finish(state,studio.artwork);persist();invalidate();paintThumbnails();
});
byId('resolution').addEventListener('change',()=>{state.resolution=Number(byId('resolution').value);persist();});

setupEditor(async()=>{
  commitDimensions();
  if (!valid || !ready || busy || loadingDesign) return null;
  const project=state.artwork==='custom' && savedProject ? copyProject(savedProject,state) : await templateProject(state,studio.box.baseImage());
  project.booklet={size:state.bookletFormat,inserted:state.bookletInserted,guides:state[guideSetting()],art:{...currentSheet().art}};
  const selected=selectedSheets[state.bookletFormat];
  if (selected) project.booklet.preset=selected.id;
  return project;
},async project=>{
  const b=project.booklet;
  const preset=b && presetById(b.size,b.preset);
  let libraryArt;
  if (preset) {
    const selected=selectedSheets[b.size];
    try {libraryArt=selected?.id===preset.id ? selected.art : await artworkForPreset(preset);}
    catch { /* A saved project also carries its own copy of both images. */ }
  }
  const matchesPreset=libraryArt && sheetSides.every(side=>b.art[side]?.src===libraryArt[side].src);
  const images=b ? await spreadImages(b.art,matchesPreset ? decodeImage : imageFor) : null;
  const pair=await customArtwork(project,studio);
  const changed=Object.keys(limits).some(name=>state[name]!==project.dimensions[name]);
  Object.assign(state,project.dimensions,{artwork:'custom'});
  let paperStorageKey;
  if (b) {
    Object.assign(state,{bookletFormat:b.size,bookletInserted:b.inserted});
    if (matchesPreset) {
      selectedSheets[b.size]={id:preset.id,art:b.art,images};state[presetKey(b.size)]=preset.id;
    } else {
      paperStorageKey=setPersonalSheet({art:b.art,images},!!b.preset);
    }
    state[guideSetting()]=b.guides;
  } else state.bookletInserted=false;
  updateProductUrl();
  savedProject=project;
  cancelAnimationFrame(animationId);animating=false;pose=state.open ? 1 : 0;
  if (changed) studio.rebuild(state);
  studio.setArtwork(pair);studio.pose(pose);studio.updateBooklet(paper,currentSheet().images,state[guideSetting()]);bookletUI();
  for (const name of Object.keys(limits)) byId(name).value=format.format(state[name]);
  heightEdited=false;readDimensions();showSelection('custom');updateLidButtons();persist();
  status.replaceChildren();invalidate();paintThumbnails();exportAvailability();
  try {
    await storedProject(project);
    if (paperStorageKey) await storedProject(b.art,paperStorageKey);
    byId('art-status').textContent='Мой макет сохранён в этом браузере.';
  } catch {
    byId('art-status').textContent='Макет применён на эту сессию. Сохраните файл проекта через редактор.';
  }
});

function offerDownload(blob,name) {
  if (previousDownload) URL.revokeObjectURL(previousDownload);
  previousDownload=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=previousDownload;link.download=name;link.textContent='Сохранить ещё раз';
  status.replaceChildren(document.createTextNode('Файл готов. '),link);
  link.click();
}
async function spreadImages(art,read=imageFor) {
  const pairs=await Promise.all(sheetSides.map(async side=>[side,art[side] ? await read(art[side].src) : null]));
  return Object.fromEntries(pairs);
}
async function restoreSheet(art) {
  const validArt=await validateSpreads(art);
  return {art:validArt,images:await spreadImages(validArt)};
}
async function exportImages(all) {
  const solo=state.product==='booklet';
  if (!solo) commitDimensions();
  if (!ready || busy || paperBusy || (!solo && (!valid || animating || loadingDesign))) return;
  busy=true;fieldset.disabled=true;exportAvailability();status.classList.remove('error');
  byId('settings').setAttribute('aria-busy','true');
  const size=state.resolution;
  const selected=selectedSheets[state.bookletFormat];
  const edition=selected ? '_'+selected.id : '';
  const included=state.bookletInserted && studio.bookletFit ? '_booklet-'+state.bookletFormat.toLowerCase()+edition : '';
  const paperPose=state.bookletReveal===100 ? state.bookletSide : state.bookletReveal===0 ? 'folded' : 'fold-'+state.bookletReveal;
  const stem=solo ? 'booklet_'+state.bookletFormat.toLowerCase()+'_'+paperPose+edition :
    'box_'+state.artwork+'_'+state.width+'x'+state.depth+'x'+state.height+'mm_'+(state.open ? 'open' : 'closed')+included;
  try {
    if (all) {
      const files=[], choices=availableViews();
      for (const [i,view] of choices.entries()) {
        status.textContent='Подготовка '+(i+1)+' из '+choices.length+' · '+view.name;
        await new Promise(resolve=>setTimeout(resolve,24));
        const blob=await studio.png(view,size);
        files.push({name:String(i+1).padStart(2,'0')+'_'+view.id+'.png',blob});
      }
      status.textContent='Сборка архива…';
      offerDownload(await makeZip(files),stem+'_'+size+'px.zip');
    } else {
      status.textContent='Подготовка PNG…';
      const current={...camera};
      await new Promise(resolve=>setTimeout(resolve,24));
      offerDownload(await studio.png(current,size),stem+'_'+current.id+'_'+size+'px.png');
    }
  } catch (error) {
    status.classList.add('error');
    status.textContent=error.message || 'Не удалось сохранить изображение. Повторите выгрузку.';
  } finally {
    busy=false;fieldset.disabled=!ready;
    byId('settings').removeAttribute('aria-busy');
    exportAvailability();invalidate();
    paintThumbnails();
  }
}
single.addEventListener('click',()=>exportImages(false));
batch.addEventListener('click',()=>exportImages(true));

const guide=byId('guide');
byId('help').addEventListener('click',()=>guide.showModal());
byId('close-help').addEventListener('click',()=>guide.close());
guide.addEventListener('click',e=>{
  if (e.target!==guide) return;
  const rect=guide.getBoundingClientRect();
  if (e.clientX<rect.left || e.clientX>rect.right || e.clientY<rect.top || e.clientY>rect.bottom) guide.close();
});
new ResizeObserver(invalidate).observe(byId('stage'));
window.addEventListener('resize',invalidate);

requestAnimationFrame(async ()=>{
  try {
    studio=new Studio(state);
    studio.renderer.domElement.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      showFailure('Браузер прервал 3D-просмотр. Для продолжения обновите страницу.');
    });
    const paperAssets=loadPaper(studio.renderer);
    try {
      const sizes=Object.keys(formats);
      const [previous,spreads,...personal]=await Promise.all([
        storedProject(),storedProject(undefined,'booklet-art'),...sizes.map(size=>storedProject(undefined,'booklet-art-'+size.toLowerCase()))
      ]);
      savedProject=previous || null;
      if (spreads) sharedSheet=await restoreSheet(spreads);
      for (const [index,art] of personal.entries()) if (art) personalSheets[sizes[index]]=await restoreSheet(art);
    } catch { /* A fresh or unavailable local store still opens the original templates. */ }
    try {await restorePreset(state.bookletFormat);}
    catch(error) {paperMessage(error.message || 'Не удалось загрузить разворот. Выберите вариант ещё раз.',true);}
    if (state.artwork==='custom' && !savedProject) state.artwork=defaults.artwork;
    studio.setArtwork(await boxArtwork(state.artwork));
    paper=await paperAssets;studio.updateBooklet(paper,currentSheet().images,state[guideSetting()]);
    showSelection(state.artwork);
    ready=true;bookletUI();byId('scene-status').textContent='';
    paint();paintThumbnails();exportAvailability();
  } catch (error) {
    console.error(error);
    showFailure('Для 3D-модели требуется WebGL. Включите графическое ускорение или откройте страницу в другом браузере.');
  }
});
