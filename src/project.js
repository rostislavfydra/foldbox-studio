import * as THREE from 'three';
import { designById,markBounds,bandBounds } from './artwork.js';

const SVG_NS='http://www.w3.org/2000/svg';
const palette='#212c47';
const colorPattern=/^#[\da-f]{6}$/i;
const imageData=/^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i;
const cache=new Map();
export const faceNames={lid:'Крышка',flap:'Клапан'};
export const sizeOf=(project,face)=>({w:project.dimensions.width,d:face==='lid' ? project.dimensions.depth : project.dimensions.flap});
const clone=value=>JSON.parse(JSON.stringify(value));
export function geometry(state) {
  const {width,depth,height,flap,estimatedHeight,open}=state;
  return {width,depth,height,flap,estimatedHeight,open};
}
export function copyProject(project,state) {
  const copy=clone(project);
  copy.dimensions=geometry(state);
  return copy;
}
export function cleanSvg(text) {
  const source=text.trim().replace(/<!DOCTYPE\s+svg\s+PUBLIC\s+["']-\/\/W3C\/\/DTD SVG 1\.[01](?: Tiny| Basic)?\/\/EN["']\s+["']https?:\/\/www\.w3\.org\/[^"'\[\]]+\.dtd["']\s*>/i,'');
  const doc=new DOMParser().parseFromString(source,'image/svg+xml');
  const svg=doc.documentElement;
  if (svg.localName!=='svg' || doc.querySelector('parsererror') || doc.doctype) throw Error('Проверьте SVG: нужен полный элемент <svg>…</svg>.');
  // Figma wraps ordinary contours in HTML for its 3D effect. Keep the contours
  // and their filter in SVG so the image can also be exported on Safari.
  for (const wrapper of [...svg.querySelectorAll('foreignObject')]) {
    const inner=wrapper.querySelector('svg');
    if (!inner) throw Error('SVG содержит HTML. Экспортируйте графику в кривых.');
    const group=doc.createElementNS(SVG_NS,'g');
    const matrix=inner.parentElement?.getAttribute('style')?.match(/matrix\(\s*([-\d.e+,\s]+)\)/i);
    if (matrix) group.setAttribute('transform','matrix('+matrix[1]+')');
    const tx=Number(wrapper.getAttribute('x')),ty=Number(wrapper.getAttribute('y'));
    if (tx || ty) group.setAttribute('transform','translate('+tx+' '+ty+') '+(group.getAttribute('transform')||''));
    group.append(...Array.from(inner.childNodes));
    wrapper.replaceWith(group);
  }
  for (const node of [svg,...svg.querySelectorAll('*')]) {
    if (node.namespaceURI!==SVG_NS || /^(script|iframe|animate.*|set|a|foreignObject)$/i.test(node.localName)) {
      throw Error('Используйте статический SVG с контурами или PNG.');
    }
    if (node.localName==='style') {
      const css=node.textContent.replace(/\/\*[\s\S]*?\*\//g,'');
      if (/@import|@font-face|javascript:/i.test(css) || [...css.matchAll(/url\(\s*["']?([^)'"]+)/ig)].some(m=>!m[1].trim().startsWith('#'))) {
        throw Error('Встройте шрифты и внешние ресурсы в SVG.');
      }
    }
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || /@import|javascript:|expression\(/i.test(attr.value)) throw Error('Используйте статический SVG.');
      if (attr.localName==='href' && !/^(#|data:image\/(?:png|jpeg|webp);base64,)/i.test(attr.value)) throw Error('Встройте связанные изображения в SVG.');
      for (const match of attr.value.matchAll(/url\(\s*["']?([^)'"]+)/ig)) {
        if (!match[1].trim().startsWith('#')) throw Error('Встройте связанные ресурсы в SVG.');
      }
    }
  }
  let box=(svg.getAttribute('viewBox')||'').trim().split(/[,\s]+/).map(Number);
  if (box.length!==4 || !box.every(Number.isFinite) || !(box[2]>0 && box[3]>0)) {
    const w=parseFloat(svg.getAttribute('width')),h=parseFloat(svg.getAttribute('height'));
    if (!(w>0 && h>0)) throw Error('Укажите viewBox или ширину и высоту в SVG.');
    box=[0,0,w,h];svg.setAttribute('viewBox',box.join(' '));
  }
  const scale=3072/Math.max(box[2],box[3]);
  svg.setAttribute('width',String(Math.max(1,Math.round(box[2]*scale))));
  svg.setAttribute('height',String(Math.max(1,Math.round(box[3]*scale))));
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
}
export function decodeImage(src) {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(Error('Браузер не смог прочитать изображение. Попробуйте PNG, JPEG, WebP или SVG.'));
    img.src=src;
  });
}
export function imageFor(src) {
  if (!imageData.test(src)) return Promise.reject(Error('Проект содержит недоступное изображение.'));
  if (!cache.has(src)) cache.set(src,decodeImage(src).catch(error=>{cache.delete(src);throw error;}));
  return cache.get(src);
}
export function blobDataUrl(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error('Файл не удалось прочитать.'));
    reader.readAsDataURL(blob);
  });
}
export async function imageFile(file) {
  if (file.size>25*1024*1024) throw Error('Для одного слоя выберите файл до 25 МБ.');
  if (file.type==='image/svg+xml' || /\.svg$/i.test(file.name)) return cleanSvg(await file.text());
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw Error('Поддерживаются PNG, JPEG, WebP и SVG.');
  return blobDataUrl(file);
}
export async function newLayer(src,name,w=.5) {
  const image=await imageFor(src);
  return {name:name.slice(0,100),src,x:.5,y:.5,w,ratio:image.naturalWidth/image.naturalHeight,h:null,angle:0};
}
async function addTemplateLayer(surface,src,name,bounds,w,d,stretch=false) {
  if (!src) return;
  const layer=await newLayer(src,name,bounds.width/w);
  Object.assign(layer,{x:bounds.x/w,y:bounds.y/d,h:stretch ? bounds.height/d : null});
  surface.layers.push(layer);
}
export async function templateProject(state,baseImage) {
  const design=designById(state.artwork);
  if (design?.project) return copyProject(design.project,state);
  const dimensions=geometry(state);
  const blank=()=>({color:palette,layers:[]});
  const project={format:'box-studio',version:1,dimensions,bodyColor:'#24354c',lid:blank(),flap:blank()};
  const {width:w,depth:d,flap:f}=dimensions;
  const full=(depth)=>({x:w/2,y:depth/2,width:w,height:depth});
  if (!design) {
    if (baseImage) await addTemplateLayer(project.lid,baseImage.toDataURL('image/png'),'Базовый орнамент',full(d),w,d,true);
    return project;
  }
  if (design.id==='coast') {
    const photo=await imageFor(design.lid),ratio=photo.naturalWidth/photo.naturalHeight;
    const width=Math.max(w,d*ratio);
    await addTemplateLayer(project.lid,design.lid,'Иллюстрация',{width,height:width/ratio,x:w-width/2,y:d/2},w,d);
  } else {
    await addTemplateLayer(project.lid,design.lid,'Оформление крышки',full(d),w,d,true);
  }
  if (design.mark) await addTemplateLayer(project.lid,design.mark,'Золотой знак',markBounds(design,w,d),w,d);
  if (design.band) await addTemplateLayer(project.lid,design.band,'Пять полос',bandBounds(w,d),w,d,true);
  await addTemplateLayer(project.flap,design.flap,'Оформление клапана',full(f),w,f,true);
  return project;
}
export function layerBounds(layer,w,d) {
  const width=layer.w*w;
  return {x:layer.x*w,y:layer.y*d,width,height:layer.h===null ? width/layer.ratio : layer.h*d};
}
export async function prepareImages(project) {
  const images=new Map();
  const sources=new Set([...project.lid.layers,...project.flap.layers].map(layer=>layer.src));
  await Promise.all([...sources].map(async src=>images.set(src,await imageFor(src))));
  return images;
}
export function drawFace(canvas,project,face,images,w,d,longEdge,selected=-1) {
  const scale=longEdge/Math.max(w,d);
  const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(d*scale));
  if (canvas.width!==width || canvas.height!==height) {canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');
  ctx.setTransform(width/w,0,0,height/d,0,0);
  ctx.fillStyle=project[face].color;ctx.fillRect(0,0,w,d);
  ctx.imageSmoothingQuality='high';
  const layers=project[face].layers;
  for (const layer of layers) {
    const {x,y,width:lw,height:lh}=layerBounds(layer,w,d);
    ctx.save();ctx.translate(x,y);ctx.rotate(layer.angle*Math.PI/180);
    ctx.drawImage(images.get(layer.src),-lw/2,-lh/2,lw,lh);ctx.restore();
  }
  if (selected>=0 && selected<layers.length) {
    const layer=layers[selected],b=layerBounds(layer,w,d);
    ctx.save();ctx.translate(b.x,b.y);ctx.rotate(layer.angle*Math.PI/180);
    ctx.lineWidth=2/scale;ctx.strokeStyle='#25476d';ctx.strokeRect(-b.width/2,-b.height/2,b.width,b.height);
    ctx.setLineDash([6/scale,5/scale]);ctx.strokeStyle='#fff';ctx.strokeRect(-b.width/2,-b.height/2,b.width,b.height);ctx.restore();
  }
  ctx.resetTransform();
}
export async function customArtwork(project,studio) {
  const images=await prepareImages(project);
  const make=()=>{
    const map=new THREE.CanvasTexture(document.createElement('canvas'));
    map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=Math.min(8,studio.renderer.capabilities.getMaxAnisotropy());
    return new THREE.MeshStandardMaterial({map,color:0xc7c7c7,roughness:.78,envMapIntensity:.34,bumpMap:studio.materials.bump,bumpScale:.075});
  };
  const lid=make(),flap=make();
  let previous='';
  return {lid,flap,bodyColor:project.bodyColor,
    fit(w,d,f){
      const key=[w,d,f].join('/');
      if (previous===key) return;
      const max=Math.min(3072,studio.renderer.capabilities.maxTextureSize);
      drawFace(lid.map.image,project,'lid',images,w,d,max);
      drawFace(flap.map.image,project,'flap',images,w,f,max);
      lid.map.needsUpdate=flap.map.needsUpdate=true;previous=key;
    },
    dispose(){for(const m of [lid,flap]) {m.map.dispose();m.dispose();}}
  };
}
export async function validateProject(raw) {
  const fail=()=>{throw Error('Формат проекта некорректен. Выберите файл .box.json из редактора.');};
  if (raw?.format!=='box-studio' || raw.version!==1 || !colorPattern.test(raw.bodyColor)) fail();
  const out={format:'box-studio',version:1,bodyColor:raw.bodyColor,dimensions:geometry(raw.dimensions||{})};
  const dimensions=out.dimensions;
  for (const [name,min,max] of [['width',60,1200],['depth',60,1200],['height',12,600],['flap',5,600]]) {
    if (!Number.isFinite(dimensions[name]) || dimensions[name]<min || dimensions[name]>max) fail();
  }
  if (dimensions.flap>dimensions.height) fail();
  dimensions.estimatedHeight=dimensions.estimatedHeight===true;dimensions.open=dimensions.open===true;
  if (raw.booklet!==undefined) {
    const b=raw.booklet;
    if (!b || !['A4','A3'].includes(b.size) || typeof b.inserted!=='boolean' || typeof b.guides!=='boolean') fail();
    out.booklet={size:b.size,inserted:b.inserted,guides:b.guides,art:await validateSpreads(b.art)};
    if (typeof b.preset==='string') out.booklet.preset=b.preset;
  }
  for (const name of ['lid','flap']) {
    const face=raw[name];
    if (!face || !colorPattern.test(face.color) || !Array.isArray(face.layers) || face.layers.length>30) fail();
    out[name]={color:face.color,layers:[]};
    for (const entry of face.layers) {
      if (!entry || typeof entry.src!=='string' || !imageData.test(entry.src) || typeof entry.name!=='string') fail();
      for (const prop of ['x','y','w','angle']) if (!Number.isFinite(entry[prop]) || Math.abs(entry[prop])>10000) fail();
      if (!(entry.w>0) || (entry.h!==null && (!Number.isFinite(entry.h) || entry.h<=0 || entry.h>10000))) fail();
      const src=projectImageSource(entry.src);
      const layer=await newLayer(src,entry.name,entry.w);
      Object.assign(layer,{x:entry.x,y:entry.y,h:entry.h,angle:entry.angle});
      out[name].layers.push(layer);
    }
  }
  return out;
}
function projectImageSource(src) {
  if (typeof src!=='string' || !imageData.test(src)) throw Error('В проекте отсутствует изображение.');
  if (!src.toLowerCase().startsWith('data:image/svg+xml')) return src;
  const comma=src.indexOf(','), payload=src.slice(comma+1);
  const code=src.slice(0,comma).endsWith(';base64') ?
    new TextDecoder().decode(Uint8Array.from(atob(payload),c=>c.charCodeAt(0))) : decodeURIComponent(payload);
  return cleanSvg(code);
}
export async function validateSpreads(raw) {
  if (!raw || typeof raw!=='object') throw Error('В проекте отсутствуют стороны буклета.');
  const result={outside:null,inside:null};
  for (const side of Object.keys(result)) {
    const entry=raw[side];
    if (entry==null) continue;
    if (typeof entry.name!=='string') throw Error('Проверьте файл оформления буклета.');
    const src=projectImageSource(entry.src);
    await imageFor(src);
    result[side]={name:entry.name.slice(0,180),src};
  }
  return result;
}
async function db() {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open('foldbox-studio',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('projects');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function storedProject(write, key='current') {
  const database=await db();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=database.transaction('projects',write ? 'readwrite' : 'readonly');
      const store=tx.objectStore('projects');
      const op=write ? store.put(write,key) : store.get(key);
      tx.oncomplete=()=>resolve(op.result);tx.onerror=tx.onabort=()=>reject(tx.error);
    });
  } finally {database.close();}
}
