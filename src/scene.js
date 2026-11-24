import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { makeMaterials } from './materials.js';
import { makeBox } from './model.js';
import { formats, fitInTray, makeBooklet } from './booklet.js';

export const views = [
  {id:'three-quarter', name:'Вид ¾', yaw:.53, pitch:.57},
  {id:'front', name:'Спереди', yaw:0, pitch:0},
  {id:'right', name:'Справа', yaw:Math.PI/2, pitch:0},
  {id:'back', name:'Сзади', yaw:Math.PI, pitch:0},
  {id:'left', name:'Слева', yaw:-Math.PI/2, pitch:0},
  {id:'top', name:'Сверху', yaw:0, pitch:Math.PI/2},
  {id:'bottom', name:'Снизу', yaw:0, pitch:-Math.PI/2}
];

function makeContactShadow(w,d) {
  const padding = Math.max(w,d) * .34;
  const width = w + 2*padding, depth = d + 2*padding;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const pixels = ctx.createImageData(256,256);
  const softness = Math.min(w,d) * .095;
  function falloff(x,z,offsetX,offsetZ,blur) {
    const dx = Math.max(0,Math.abs(x-offsetX)-w*.484);
    const dz = Math.max(0,Math.abs(z-offsetZ)-d*.484);
    return Math.exp(-(dx*dx+dz*dz)/(2*blur*blur));
  }
  for (let j=0; j<256; j++) for (let i=0; i<256; i++) {
    const x = ((i+.5)/256-.5)*width, z = ((j+.5)/256-.5)*depth;
    const index = (j*256+i)*4;
    const ambient = .20*falloff(x,z,w*.035,-d*.022,softness)
      + .30*falloff(x,z,w*.008,-d*.003,softness*.31);
    pixels.data[index] = 26; pixels.data[index+1] = 34; pixels.data[index+2] = 46;
    pixels.data[index+3] = Math.round(ambient*255);
  }
  ctx.putImageData(pixels,0,0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({map, transparent:true, depthWrite:false, toneMapped:false});
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width,depth),material);
  shadow.rotation.x = -Math.PI/2;
  shadow.position.y = -.22;
  shadow.renderOrder = -1;
  return shadow;
}

export class Studio {
  constructor(settings) {
    this.renderer = new THREE.WebGLRenderer({
      alpha:true, antialias:true, premultipliedAlpha:true, powerPreference:'default',
      preserveDrawingBuffer:false
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .98;
    this.renderer.setClearColor(0x000000,0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    const room = new RoomEnvironment(this.renderer);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room,.055);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xf4f6ff,0xadb7c4,.83));
    this.key = new THREE.DirectionalLight(0xfff7ec,2.4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048,2048);
    this.key.shadow.bias = -.00027;
    this.scene.add(this.key,this.key.target);
    const rim = new THREE.DirectionalLight(0xe5edff,1.15);
    rim.position.set(1,1.2,-1.8);
    this.scene.add(rim);
    this.camera = new THREE.OrthographicCamera();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.materials = makeMaterials();
    this.bodyTones=['cover','edge','base','inner','joint'].map(name=>[this.materials[name],this.materials[name].color.clone()]);
    this.rebuild(settings);
  }
  rebuild(settings) {
    if (this.box) {
      this.scene.remove(this.box.root,this.shadow);
      this.box.dispose();
      this.shadow.geometry.dispose();
      this.shadow.material.map.dispose();
      this.shadow.material.dispose();
    }
    this.settings = settings;
    this.fraction = settings.open ? 1 : 0;
    this.box = makeBox(settings,this.materials,this.artwork);
    this.shadow = makeContactShadow(settings.width,settings.depth);
    this.scene.add(this.box.root,this.shadow);
    this.arrangeModels();
  }
  lighting(width,depth,height) {
    const span = Math.max(width,depth+height,height*1.15);
    this.key.position.set(-1.0*span,2.1*span,1.35*span);
    this.key.target.position.set(0,(depth+height)*.28,-depth*.16);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -span*1.05;
    cam.right = cam.top = span*1.05;
    cam.near = span*.1;
    cam.far = span*5;
    cam.updateProjectionMatrix();
    this.key.shadow.normalBias = span*.00065;
    this.renderer.shadowMap.needsUpdate = true;
  }
  pose(fraction) {
    this.fraction=fraction;
    this.box.pose(fraction);
    if (this.booklet && this.settings.product==='box') {
      this.booklet.root.visible=!!(this.settings.bookletInserted && this.bookletFit && fraction>.003);
    }
    this.renderer.shadowMap.needsUpdate = true;
  }
  updateBooklet(paper, images, showGuides=this.settings.bookletGuides) {
    const key=this.settings.bookletFormat, spec=formats[key];
    if (key!==this.paperFormat) {
      if (this.booklet) {
        this.scene.remove(this.booklet.root,this.paperShadow);
        this.booklet.dispose();
        this.paperShadow.geometry.dispose();this.paperShadow.material.map.dispose();this.paperShadow.material.dispose();
      }
      this.booklet=makeBooklet(spec,paper);
      this.paperShadow=makeContactShadow(spec.width,spec.depth);
      this.paperShadow.material.opacity=.52;
      this.scene.add(this.booklet.root,this.paperShadow);
      this.paperFormat=key;
    }
    if (this.settings.product==='booklet' || this.settings.bookletInserted) paper.paint(key,showGuides,images);
    this.arrangeModels();
  }
  arrangeModels() {
    const s=this.settings, solo=s.product==='booklet' && !!this.booklet;
    this.box.root.visible=!solo;
    if (!this.booklet) { this.lighting(s.width,s.depth,s.height);return; }
    const spec=formats[s.bookletFormat], tray=this.box.traySpace;
    const book=this.booklet, placement=fitInTray(spec,tray);
    this.bookletFit=placement;
    book.root.visible=solo || !!(placement && s.bookletInserted && this.fraction>.003);
    book.root.position.set(0,0,0);book.root.rotation.y=0;
    if (solo) {
      book.pose(s.bookletReveal,s.bookletSide==='outside');
      this.paperShadow.scale.x=(book.bounds.max.x-book.bounds.min.x)/spec.width;
      this.paperShadow.position.x=(book.bounds.max.x+book.bounds.min.x)/2;
      this.lighting(spec.width,spec.depth,book.bounds.max.y);
    } else {
      if (placement && s.bookletInserted) {
        book.root.rotation.y=placement.angle;
        const x=Math.max(-tray.width*.15,-(tray.width-placement.width)/2+.5);
        book.root.position.set(x,tray.surface+.2,tray.centerZ);
        book.pose(0);
      }
      this.lighting(s.width,s.depth,s.height);
    }
  }
  setArtwork(design) {
    const previous=this.artwork;
    const replacement=design?.bodyColor && new THREE.Color(design.bodyColor);
    const reference=this.bodyTones[0][1];
    for (const [material,original] of this.bodyTones) {
      material.color.copy(original);
      if (replacement) material.color.setRGB(original.r*replacement.r/reference.r,
        original.g*replacement.g/reference.g,original.b*replacement.b/reference.b);
    }
    this.box.finish(this.settings,design);
    this.artwork=design;
    previous?.dispose();
  }
  configureCamera(view, aspect, fillX, fillY, zoom) {
    const {yaw,pitch} = view;
    this.right.set(Math.cos(yaw),0,-Math.sin(yaw));
    this.direction.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
    this.up.crossVectors(this.direction,this.right).normalize();
    let xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity,zMin=Infinity,zMax=-Infinity;
    const bookMode=this.settings.product==='booklet';
    for (const corner of (bookMode ? this.booklet : this.box).worldCorners) {
      const x = corner.dot(this.right), y = corner.dot(this.up), z = corner.dot(this.direction);
      xMin = Math.min(x,xMin); xMax = Math.max(x,xMax);
      yMin = Math.min(y,yMin); yMax = Math.max(y,yMax);
      zMin = Math.min(z,zMin); zMax = Math.max(z,zMax);
    }
    this.center.copy(this.right).multiplyScalar((xMin+xMax)/2)
      .addScaledVector(this.up,(yMin+yMax)/2)
      .addScaledVector(this.direction,(zMin+zMax)/2);
    const height = Math.max((xMax-xMin)/(aspect*fillX),(yMax-yMin)/fillY)/zoom;
    const span = bookMode ? formats[this.settings.bookletFormat].width : Math.max(this.settings.width,this.settings.depth,this.settings.height);
    const cam = this.camera;
    cam.position.copy(this.center).addScaledVector(this.direction,span*5);
    cam.up.copy(this.up);
    cam.lookAt(this.center);
    cam.left = -height*aspect/2; cam.right = -cam.left;
    cam.top = height/2; cam.bottom = -cam.top;
    cam.near = span*.1; cam.far = span*10;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  render(width,height,view,{kind='preview',zoom=1,measure=false} = {}) {
    const renderer = this.renderer;
    if (renderer.getContext().isContextLost()) throw new Error('Контекст 3D недоступен. Обновите страницу.');
    if (renderer.domElement.width !== width || renderer.domElement.height !== height) {
      renderer.setSize(width,height,false);
    }
    const exporting = kind === 'export';
    const fillX = exporting ? .86 : measure ? .66 : kind === 'thumb' ? .77 : .79;
    const fillY = exporting ? .86 : measure ? .57 : kind === 'thumb' ? .71 : .72;
    this.configureCamera(view,width/height,fillX,fillY,zoom);
    const showShadow=!exporting && view.pitch>.035 && view.pitch<1.51;
    this.shadow.visible=showShadow && this.box.root.visible;
    if (this.paperShadow) this.paperShadow.visible=showShadow && !this.box.root.visible;
    renderer.render(this.scene,this.camera);
    return renderer.domElement;
  }
  paint(target,width,height,view,options) {
    const source = this.render(width,height,view,options);
    if (target.width !== width || target.height !== height) {
      target.width = width; target.height = height;
    }
    const ctx = target.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,width,height);
    ctx.drawImage(source,0,0);
  }
  async png(view,size) {
    const gl = this.renderer.getContext();
    const max = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    if (size > max) throw new Error('Устройство поддерживает меньший кадр. Уменьшите разрешение.');
    const canvas = this.render(size,size,view,{kind:'export'});
    if (gl.drawingBufferWidth !== size || gl.drawingBufferHeight !== size) {
      throw new Error('Для этого размера недостаточно видеопамяти. Уменьшите разрешение.');
    }
    return new Promise((resolve,reject) => canvas.toBlob(blob => {
      if (blob && blob.size) resolve(blob);
      else reject(new Error('Браузер не смог создать PNG. Выберите меньшее разрешение.'));
    },'image/png'));
  }
  drawDimensions(canvas,dpr,view) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width/dpr, height = canvas.height/dpr;
    const project = (x,y,z) => {
      const p = new THREE.Vector3(x,y,z).project(this.camera);
      return {x:(p.x*.5+.5)*width, y:(.5-p.y*.5)*height};
    };
    const bookMode=this.settings.product==='booklet';
    const bounds=bookMode ? this.booklet.bounds : null;
    const {width:w,depth:d,height:h} = bounds ? {width:bounds.max.x-bounds.min.x,depth:bounds.max.z-bounds.min.z,height:bounds.max.y} : this.settings;
    const cx=bounds ? (bounds.min.x+bounds.max.x)/2 : 0;
    const sx = Math.sin(view.yaw)>=0 ? 1 : -1, sz = Math.cos(view.yaw)>=0 ? 1 : -1;
    const Y = view.pitch < -.2 ? h : 0;
    const X = cx+sx*w/2, Z = sz*d/2;
    const center = project(cx,h/2,0);
    const lines = [
      [project(cx-w/2,Y,Z),project(cx+w/2,Y,Z),w],
      [project(X,Y,-d/2),project(X,Y,d/2),d]
    ];
    if (!bookMode) lines.push([project(-X,0,Z),project(-X,h,Z),h]);
    ctx.save();
    ctx.scale(dpr,dpr);
    ctx.font = '500 12px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    const placed = [];
    for (const [a,b,value] of lines) {
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      if (length<23) continue;
      const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
      const sign = ((mx-center.x)*(-dy)+(my-center.y)*dx)>=0 ? 1 : -1;
      const nx=-dy/length*sign,ny=dx/length*sign,off=14;
      ctx.strokeStyle = '#657488';
      ctx.beginPath();
      ctx.moveTo(a.x+nx*off,a.y+ny*off);ctx.lineTo(b.x+nx*off,b.y+ny*off);
      for (const p of [a,b]) {
        ctx.moveTo(p.x+nx*4,p.y+ny*4);ctx.lineTo(p.x+nx*(off+3),p.y+ny*(off+3));
      }
      ctx.stroke();
      const label=value.toLocaleString('ru-RU')+' мм';
      const tw=ctx.measureText(label).width+8;
      const lx=Math.max(tw/2+3,Math.min(width-tw/2-3,mx+nx*(off+10)));
      const ly=Math.max(11,Math.min(height-11,my+ny*(off+10)));
      if (placed.some(p => Math.abs(p.x-lx)<(p.w+tw)/2 && Math.abs(p.y-ly)<19)) continue;
      placed.push({x:lx,y:ly,w:tw});
      ctx.fillStyle='#edf0f3'; ctx.fillRect(lx-tw/2,ly-9,tw,18);
      ctx.fillStyle='#33465b'; ctx.fillText(label,lx,ly+.5);
    }
    ctx.restore();
  }
}

export function drawAxis(canvas,view) {
  const ctx=canvas.getContext('2d'), {yaw,pitch}=view;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.scale(2,2);
  const ox=28,oy=27,length=14;
  const axes=[
    ['X',Math.cos(yaw),Math.sin(yaw)*Math.sin(pitch),'#956d69'],
    ['Y',0,-Math.cos(pitch),'#5b7969'],
    ['Z',-Math.sin(yaw),Math.cos(yaw)*Math.sin(pitch),'#5c7697']
  ];
  ctx.font='500 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  for (const [name,dx,dy,color] of axes) {
    if (Math.hypot(dx,dy)<.1) continue;
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.4;
    ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox+dx*length,oy+dy*length);ctx.stroke();
    ctx.fillText(name,ox+dx*(length+6),oy+dy*(length+6));
  }
  ctx.restore();
}
