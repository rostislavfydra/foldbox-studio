import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

let offlineResources;
let offlineWorkerReady;
function startOfflineWorker(source) {
  // Chromium cannot load a module worker from the opaque file:// origin.
  // The portable build embeds a classic worker with the same PDF.js engine.
  const content=new Blob([source],{type:'text/javascript'});
  const blobUrl=tail=>URL.createObjectURL(new Blob([content,'\n',tail],{type:'text/javascript'}));
  const url=blobUrl("self.postMessage('foldbox-pdf-ready');");
  const fallback=()=>{
    GlobalWorkerOptions.workerSrc=blobUrl('export const {WorkerMessageHandler}=globalThis.pdfjsWorker;');
  };
  return new Promise(resolve=>{
    let worker;
    try {worker=new Worker(url);} catch {URL.revokeObjectURL(url);fallback();resolve();return;}
    const listeners=new AbortController();
    worker.addEventListener('error',()=>{
      listeners.abort();URL.revokeObjectURL(url);worker.terminate();fallback();resolve();
    },{signal:listeners.signal});
    worker.addEventListener('message',event=>{
      if (event.data!=='foldbox-pdf-ready') return;
      listeners.abort();URL.revokeObjectURL(url);GlobalWorkerOptions.workerPort=worker;resolve();
    },{signal:listeners.signal});
  });
}

class InlineBinaryData {
  async fetch({kind,filename}) {
    const directories={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'};
    const encoded=offlineResources[directories[kind]+'/'+filename];
    if (!encoded) throw Error('В автономной версии отсутствует ресурс PDF.');
    return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  }
}

export async function openDocument(file) {
  const inlineWorker=document.getElementById('pdf-worker-source');
  const options={data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
    enableXfa:false,useSystemFonts:true};
  if (inlineWorker) {
    if (!offlineResources) {
      offlineResources=JSON.parse(document.getElementById('pdf-resources').textContent);
      offlineWorkerReady=startOfflineWorker(inlineWorker.textContent);
    }
    await offlineWorkerReady;
    Object.assign(options,{useWorkerFetch:false,BinaryDataFactory:InlineBinaryData});
  } else {
    const base=new URL('pdf/',document.baseURI).href;
    GlobalWorkerOptions.workerSrc=base+'worker.mjs';
    Object.assign(options,{cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',
      wasmUrl:base+'wasm/',iccUrl:base+'iccs/'});
  }
  const task=getDocument(options);
  try {
    return await task.promise;
  } catch(error) {
    await task.destroy().catch(()=>{});
    if (error.name==='PasswordException') throw Error('Этот PDF защищён паролем. Для импорта нужна открытая копия.');
    if (error.name==='InvalidPDFException') throw Error('PDF повреждён или не читается. Экспортируйте файл заново.');
    throw Error('Не удалось открыть PDF. Проверьте файл и повторите загрузку.');
  }
}

export async function renderPage(doc, pageNumber, longEdge) {
  const page=await doc.getPage(pageNumber);
  const original=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:longEdge/Math.max(original.width,original.height)});
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(viewport.width));
  canvas.height=Math.max(1,Math.round(viewport.height));
  await page.render({canvas,viewport,background:'#ffffff'}).promise;
  return canvas;
}
