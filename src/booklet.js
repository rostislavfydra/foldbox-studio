import * as THREE from 'three';
import { imageFor } from './project.js';
import a4Outside from './booklet-art/a4-outside.webp';
import a4Inside from './booklet-art/a4-inside.webp';
import a3Outside from './booklet-art/a3-outside.webp';
import a3Inside from './booklet-art/a3-inside.webp';
import a4Pdf from './booklet-art/a4.pdf';
import a3Pdf from './booklet-art/a3.pdf';

// The short leaf tucks inside. The original A4 artboard allows 3 mm for the roll fold.
export const formats = {
  A4: {width:297, depth:210, panel:100, tuck:97, outside:a4Outside, inside:a4Inside, pdf:a4Pdf},
  A3: {width:420, depth:297, panel:141, tuck:138, outside:a3Outside, inside:a3Inside, pdf:a3Pdf}
};
export const sheetSides = ['outside', 'inside'];
export const paperThickness = .25;
const stackHeight = paperThickness * 4.2;

export function fitInTray(spec, tray) {
  if (tray.clearance < stackHeight + .25) return null;
  const gap = 1;
  if (spec.panel + gap <= tray.width && spec.depth + gap <= tray.depth) {
    return {angle:0, width:spec.panel, depth:spec.depth};
  }
  if (spec.depth + gap <= tray.width && spec.panel + gap <= tray.depth) {
    return {angle:Math.PI/2, width:spec.depth, depth:spec.panel};
  }
  return null;
}

export async function loadPaper(renderer) {
  const guides = {};
  await Promise.all(Object.entries(formats).map(async ([key, spec]) => {
    const [outside, inside] = await Promise.all([imageFor(spec.outside), imageFor(spec.inside)]);
    guides[key] = {outside, inside};
  }));
  const paper = {edge:new THREE.MeshStandardMaterial({color:0xd8d7d2, roughness:.95})};
  function textureFor(canvas) {
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return map;
  }
  for (const side of sheetSides) {
    const map=textureFor(document.createElement('canvas'));
    paper[side] = new THREE.MeshStandardMaterial({map,color:0xe9e8e5,roughness:.94,metalness:0,envMapIntensity:.25});
  }
  let lastKey, lastGuides, lastImages;
  paper.paint = (key, showGuides, images) => {
    if (key===lastKey && showGuides===lastGuides && images===lastImages) return;
    const spec = formats[key];
    for (const side of sheetSides) {
      const material=paper[side], previous=material.map;
      const detail=images?.[side] ? 3072 : (showGuides ? guides[key][side].naturalWidth : 8);
      const width=Math.min(detail,renderer.capabilities.maxTextureSize);
      const height=Math.round(width*spec.depth/spec.width);
      const resized=previous.image.width!==width || previous.image.height!==height;
      const canvas=resized ? document.createElement('canvas') : previous.image;
      if (resized) { canvas.width=width;canvas.height=height; }
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      if (images?.[side]) drawTrimmed(ctx, images[side], canvas.width, canvas.height);
      if (showGuides) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(guides[key][side],0,0,canvas.width,canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      }
      // A WebGL2 texture's allocated storage cannot grow or shrink in place.
      if (resized) {
        material.map=textureFor(canvas);
        previous.dispose();
      } else previous.needsUpdate=true;
    }
    lastKey=key; lastGuides=showGuides; lastImages=images;
  };
  return paper;
}

function drawTrimmed(ctx, image, width, height) {
  const w=image.naturalWidth, h=image.naturalHeight;
  const ratio=w/h;
  // Recognise whole spreads exported with the template's 3 mm bleed on all sides.
  const closest = Object.values(formats).map(spec=>({
    spec, error:Math.abs(ratio - (spec.width+6)/(spec.depth+6))
  })).sort((a,b)=>a.error-b.error)[0];
  let x=0, y=0;
  if (closest.error<.0018 && closest.error<Math.abs(ratio-width/height)) {
    x=w*3/(closest.spec.width+6); y=h*3/(closest.spec.depth+6);
  }
  const scale=Math.min(width/(w-2*x),height/(h-2*y));
  const dw=(w-2*x)*scale, dh=(h-2*y)*scale;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,x,y,w-2*x,h-2*y,(width-dw)/2,(height-dh)/2,dw,dh);
}

export function makeBooklet(spec, paper) {
  const root=new THREE.Group(), sheet=new THREE.Group();
  root.add(sheet);
  const left=new THREE.Group(), right=new THREE.Group();
  sheet.add(left,right);
  left.position.x=-spec.panel/2; right.position.x=spec.panel/2;
  const panels=[];
  function addPanel(parent, width, x, start) {
    const geometry=new THREE.BoxGeometry(width,paperThickness,spec.depth);
    const {position,uv}=geometry.attributes;
    for (const group of geometry.groups) {
      if (group.materialIndex!==2 && group.materialIndex!==3) continue;
      const inside=group.materialIndex===2;
      for (let i=group.start;i<group.start+group.count;i++) {
        const v=geometry.index.getX(i);
        const u=(start+position.getX(v)+width/2)/spec.width;
        uv.setXY(v,inside ? u : 1-u,.5-position.getZ(v)/spec.depth);
      }
    }
    const object=new THREE.Mesh(geometry,[paper.edge,paper.edge,paper.inside,paper.outside,paper.edge,paper.edge]);
    object.position.x=x; object.castShadow=object.receiveShadow=true;
    parent.add(object);
    const points=[];
    for(const xx of [-width/2,width/2]) for(const yy of [-paperThickness/2,paperThickness/2])
      for(const zz of [-spec.depth/2,spec.depth/2]) points.push(new THREE.Vector3(xx,yy,zz));
    panels.push({object,points});
  }
  addPanel(left,spec.panel,-spec.panel/2,0);
  addPanel(sheet,spec.panel,0,spec.panel);
  addPanel(right,spec.tuck,spec.tuck/2,spec.panel*2);
  const worldCorners=panels.flatMap(p=>p.points.map(()=>new THREE.Vector3()));
  const bounds=new THREE.Box3();
  function updateBounds() {
    root.updateWorldMatrix(true,true);
    bounds.makeEmpty();
    let i=0;
    for(const {object,points} of panels) for(const point of points) {
      const p=worldCorners[i++].copy(point).applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(p);
    }
  }
  function pose(reveal, outsideUp=false) {
    const fold=1-reveal/100;
    const tuck=THREE.MathUtils.smoothstep(fold,0,.68);
    const cover=THREE.MathUtils.smoothstep(fold,.24,1);
    right.rotation.z=Math.PI*tuck;
    left.rotation.z=-Math.PI*cover;
    // Stagger the folded leaves by one paper thickness plus a small air gap.
    right.position.y=paperThickness*1.5*tuck;
    left.position.y=paperThickness*3.2*cover;
    sheet.rotation.z=outsideUp ? Math.PI : 0;
    sheet.position.y=paperThickness/2;
    updateBounds();
    if (outsideUp && bounds.min.y < -.001) {
      sheet.position.y-=bounds.min.y;
      updateBounds();
    }
  }
  return {root,worldCorners,bounds,pose,updateBounds,
    dispose(){for(const {object} of panels)object.geometry.dispose();}
  };
}

export function templateBlob(key) {
  const bytes=atob(formats[key].pdf.split(',')[1]);
  return new Blob([Uint8Array.from(bytes,char=>char.charCodeAt(0))],{type:'application/pdf'});
}
