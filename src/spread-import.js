import { blobDataUrl, cleanSvg, decodeImage } from './project.js';

const sides=['outside','inside'];
const longEdge=3072;
let enginePromise;

function pdfEngine() {
  if (window.FoldboxPdf) return Promise.resolve(window.FoldboxPdf);
  if (!enginePromise) {
    enginePromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=new URL('booklet-pdf.js',document.baseURI).href;
      script.onload=()=>window.FoldboxPdf ? resolve(window.FoldboxPdf) : reject(Error('Модуль PDF не загрузился.'));
      script.onerror=()=>{script.remove();reject(Error('Не удалось загрузить модуль PDF. Повторите попытку.'));};
      document.head.append(script);
    }).catch(error=>{enginePromise=null;throw error;});
  }
  return enginePromise;
}

function fileType(file,bytes) {
  const text=new TextDecoder().decode(bytes);
  if (bytes[0]===137 && text.slice(1,4)==='PNG') return 'image/png';
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (text.startsWith('RIFF') && text.slice(8,12)==='WEBP') return 'image/webp';
  if (text.startsWith('GIF8')) return 'image/gif';
  if (text.includes('%PDF-') || /\.pdf$/i.test(file.name)) return 'application/pdf';
  const ext=file.name.split('.').pop().toLowerCase();
  if (ext==='svg' || /<svg[\s>]/i.test(text)) return 'image/svg+xml';
  const types={jpg:'jpeg',jpeg:'jpeg',jfif:'jpeg',png:'png',webp:'webp',gif:'gif',avif:'avif',bmp:'bmp',heic:'heic',heif:'heif'};
  return types[ext] ? 'image/'+types[ext] : file.type.toLowerCase();
}
async function rasterData(canvas, type='image/png') {
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,.96));
  if (!blob) throw Error('Браузеру не удалось подготовить изображение для 3D-модели.');
  return blobDataUrl(blob);
}
async function readImage(file,type) {
  if (type==='image/svg+xml') return cleanSvg(await file.text());
  if (!type.startsWith('image/')) throw Error('Выберите изображение или PDF.');
  const blob=file.type===type ? file : file.slice(0,file.size,type);
  const url=URL.createObjectURL(blob);
  try {
    const img=await decodeImage(url);
    const scale=Math.min(1,longEdge/Math.max(img.naturalWidth,img.naturalHeight));
    if (scale===1 && file.size<=12*1024*1024 && ['image/png','image/jpeg','image/webp'].includes(type)) {
      return await blobDataUrl(blob);
    }
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');
    ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return await rasterData(canvas,type==='image/jpeg' ? type : 'image/png');
  } finally {URL.revokeObjectURL(url);}
}

function choosePages(engine,doc,fileName,side,existing) {
  const dialog=document.getElementById('pdf-import');
  const apply=document.getElementById('pdf-apply');
  const events=new AbortController(), rev={outside:0,inside:0};
  const select=key=>document.getElementById('pdf-page-'+key);
  document.getElementById('pdf-name').textContent=fileName+' · '+doc.numPages.toLocaleString('ru-RU')+' стр.';
  function picks() {
    return Object.fromEntries(sides.map(key=>[key,Number(select(key).value)]).filter(([,page])=>page>0));
  }
  async function preview(key) {
    const sequence=++rev[key], page=Number(select(key).value);
    const box=document.getElementById('pdf-thumb-'+key);
    apply.disabled=!Object.keys(picks()).length;
    box.textContent=page ? 'Подготовка…' : 'Без замены';
    if (!page) {
      if (existing[key]) {
        const img=new Image();img.alt='Текущее оформление';img.src=existing[key].src;box.replaceChildren(img);
      }
      return;
    }
    try {
      const canvas=await engine.renderPage(doc,page,420);
      if (dialog.open && rev[key]===sequence) box.replaceChildren(canvas);
    } catch {
      if (dialog.open && rev[key]===sequence) box.textContent='Не удалось показать страницу';
    }
  }
  for (const key of sides) {
    const menu=select(key), options=document.createDocumentFragment();
    options.append(new Option('Оставить без изменений','0'));
    for(let n=1;n<=doc.numPages;n++) options.append(new Option('Страница '+n,String(n)));
    menu.replaceChildren(options);
    menu.value=String(key===side || !existing[key] ? (key==='outside' ? 1 : 2) : 0);
    menu.addEventListener('change',()=>preview(key),{signal:events.signal});
  }
  dialog.returnValue='';
  const answer=new Promise(resolve=>dialog.addEventListener('close',()=>{
    events.abort();
    for(const key of sides)document.getElementById('pdf-thumb-'+key).replaceChildren();
    resolve(dialog.returnValue==='apply' ? picks() : null);
  },{once:true}));
  dialog.showModal();
  for(const key of sides) preview(key);
  return answer;
}

export async function importSpreads(file,side,existing,onProgress) {
  if (!file.size) throw Error('Выбранный файл пуст.');
  const header=new Uint8Array(await file.slice(0,1024).arrayBuffer());
  const type=fileType(file,header);
  if (type!=='application/pdf') {
    return {[side]:{name:file.name.slice(0,180),src:await readImage(file,type)}};
  }
  onProgress('Открытие PDF…');
  const engine=await pdfEngine(), doc=await engine.openDocument(file);
  try {
    const pages=doc.numPages===1 ? {[side]:1} : await choosePages(engine,doc,file.name,side,existing);
    if (!pages) return null;
    const rendered=new Map(),changes={};
    for (const [key,n] of Object.entries(pages)) {
      onProgress('Подготовка страницы '+n+'…');
      if (!rendered.has(n)) {
        const canvas=await engine.renderPage(doc,n,longEdge);
        rendered.set(n,await rasterData(canvas));
        canvas.width=canvas.height=1;
      }
      changes[key]={name:file.name.slice(0,155)+' · стр. '+n,src:rendered.get(n)};
    }
    return changes;
  } finally {await doc.destroy();}
}
