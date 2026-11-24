import {sizeOf,layerBounds,drawFace,newLayer,imageFor,imageFile,cleanSvg,prepareImages,validateProject} from './project.js';

export function setupEditor(getDraft,applyDraft) {
  const el=id=>document.getElementById(id);
  const dialog=el('editor'),canvas=el('sheet'),stage=el('sheet-stage'),status=el('edit-status');
  const fields={w:el('layer-w'),x:el('layer-x'),y:el('layer-y'),angle:el('layer-angle')};
  const number=n=>n.toLocaleString('ru-RU',{maximumFractionDigits:2,useGrouping:false});
  let doc,images,face='lid',selected=-1,drag=null,working=false;
  const layers=()=>doc[face].layers,layer=()=>layers()[selected];
  function message(text,error=false) {status.textContent=text;status.classList.toggle('error',error);}
  async function task(fn) {
    if (working) return;
    working=true;dialog.setAttribute('aria-busy','true');
    dialog.querySelector('.editor-body').inert=dialog.querySelector('.editor-footer').inert=true;
    el('cancel-edit').disabled=true;
    try {await fn();} catch(e) {message(e.message||'Не удалось выполнить действие.',true);}
    finally {
      working=false;dialog.removeAttribute('aria-busy');el('cancel-edit').disabled=false;
      dialog.querySelector('.editor-body').inert=dialog.querySelector('.editor-footer').inert=false;
    }
  }
  function draw() {
    if (!dialog.open || !doc || !images) return;
    const {w,d}=sizeOf(doc,face);
    const availableW=Math.max(50,stage.clientWidth-8),availableH=Math.max(50,stage.clientHeight-30);
    const scale=Math.min(availableW/w,availableH/d);
    canvas.style.width=w*scale+'px';canvas.style.height=d*scale+'px';
    drawFace(canvas,doc,face,images,w,d,Math.max(160,Math.round(Math.max(w,d)*scale*Math.min(devicePixelRatio||1,2))),selected);
    el('sheet-size').textContent=number(w)+' × '+number(d)+' мм';
  }
  function syncFields() {
    const active=layer(),{w,d}=sizeOf(doc,face);
    el('layer-controls').disabled=!active;
    const values=active ? {w:active.w*w,x:active.x*w,y:active.y*d,angle:active.angle} : {};
    for (const [key,input] of Object.entries(fields)) {
      input.value=active ? number(values[key]) : '';input.setAttribute('aria-invalid','false');
    }
    el('raise-layer').disabled=!active || selected===layers().length-1;
    el('lower-layer').disabled=!active || selected===0;
    el('face-color').value=doc[face].color;el('body-color').value=doc.bodyColor;
  }
  function refresh() {
    const list=el('layers');list.replaceChildren();
    if (!layers().length) list.add(new Option('Слоёв пока нет','-1'));
    for (let i=layers().length-1;i>=0;i--) list.add(new Option(layers()[i].name,String(i)));
    list.disabled=!layers().length;list.value=String(selected);
    el('edit-lid').setAttribute('aria-pressed',String(face==='lid'));
    el('edit-flap').setAttribute('aria-pressed',String(face==='flap'));
    syncFields();draw();
  }
  async function activate(project) {
    const loaded=await prepareImages(project);
    doc=project;images=loaded;face='lid';selected=layers().length-1;
    el('svg-entry').hidden=true;el('svg-source').value='';message('');
    refresh();
  }
  el('edit-design').addEventListener('click',async ()=>{
    try {
      const project=await getDraft();
      if (!project) return;
      dialog.showModal();
      await task(()=>activate(project));
    } catch(e) {el('art-status').textContent=e.message;}
  });
  el('cancel-edit').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
  dialog.addEventListener('close',()=>{drag=null;doc=null;images=null;});
  new ResizeObserver(draw).observe(stage);
  for (const name of ['lid','flap']) el('edit-'+name).addEventListener('click',()=>{
    face=name;selected=layers().length-1;message('');refresh();
  });
  el('layers').addEventListener('change',()=>{selected=Number(el('layers').value);syncFields();draw();});
  async function insert(src,name) {
    if (layers().length>=30) throw Error('Для одной грани доступно до 30 слоёв.');
    const item=await newLayer(src,name),{w,d}=sizeOf(doc,face);
    item.w=Math.min(.55,d*.65*item.ratio/w);
    images.set(src,await imageFor(src));layers().push(item);selected=layers().length-1;
    message('Слой добавлен.');refresh();
  }
  const fileName=f=>(f.name||'Изображение').replace(/\.[a-z0-9]+$/i,'')||'Изображение';
  el('add-image').addEventListener('click',()=>el('layer-file').click());
  el('layer-file').addEventListener('change',e=>{
    const file=e.target.files[0];e.target.value='';
    if (file) task(async()=>insert(await imageFile(file),fileName(file)));
  });
  el('paste-svg').addEventListener('click',()=>{
    el('svg-entry').hidden=!el('svg-entry').hidden;
    if (!el('svg-entry').hidden) el('svg-source').focus();
  });
  el('insert-svg').addEventListener('click',()=>task(async()=>{
    await insert(cleanSvg(el('svg-source').value),'Векторный знак');
    el('svg-source').value='';el('svg-entry').hidden=true;
  }));
  dialog.addEventListener('paste',e=>{
    if (working || e.target===el('svg-source')) return;
    const file=[...e.clipboardData.files].find(f=>f.type.startsWith('image/'));
    const code=e.clipboardData.getData('text/plain').trim();
    if (!file && !/<svg[\s>]/i.test(code)) return;
    e.preventDefault();
    task(async()=>file ? insert(await imageFile(file),fileName(file)) : insert(cleanSvg(code),'Векторный знак'));
  });
  stage.addEventListener('dragover',e=>{e.preventDefault();stage.classList.add('over');});
  stage.addEventListener('dragleave',()=>stage.classList.remove('over'));
  stage.addEventListener('drop',e=>{
    e.preventDefault();stage.classList.remove('over');
    const files=[...e.dataTransfer.files];const text=e.dataTransfer.getData('text/plain').trim();
    task(async()=>{
      if (!files.length && text) await insert(cleanSvg(text),'Векторный знак');
      for (const f of files) await insert(await imageFile(f),fileName(f));
    });
  });
  for (const [name,input] of Object.entries(fields)) input.addEventListener('input',()=>{
    if (!layer()) return;
    const s=input.value.trim().replace(',','.'),n=Number(s),{w,d}=sizeOf(doc,face);
    const valid=s!=='' && Number.isFinite(n) && Math.abs(n)<=10000 && (name!=='w'||n>=.1);
    input.setAttribute('aria-invalid',String(!valid));
    if (!valid) {message(name==='w' ? 'Ширина должна быть числом от 0,1 до 10 000 мм.' : 'Введите число от −10 000 до 10 000.',true);return;}
    const item=layer();
    if (name==='w') {if(item.h!==null)item.h*=n/(item.w*w);item.w=n/w;}
    else if (name==='angle') item.angle=n;
    else item[name]=n/(name==='x' ? w : d);
    message('');draw();
  });
  el('center-layer').addEventListener('click',()=>{layer().x=layer().y=.5;syncFields();draw();});
  el('fill-layer').addEventListener('click',()=>{
    const {w,d}=sizeOf(doc,face),item=layer();
    item.x=item.y=.5;item.angle=0;item.h=null;item.w=Math.max(1,d*item.ratio/w);
    syncFields();draw();
  });
  for (const [id,direction] of [['raise-layer',1],['lower-layer',-1]]) el(id).addEventListener('click',()=>{
    const items=layers(),next=selected+direction;
    if (next<0 || next>=items.length) return;
    [items[selected],items[next]]=[items[next],items[selected]];selected=next;refresh();
  });
  el('remove-layer').addEventListener('click',()=>{
    layers().splice(selected,1);selected=Math.min(selected,layers().length-1);refresh();
  });
  el('face-color').addEventListener('input',()=>{doc[face].color=el('face-color').value;draw();});
  el('body-color').addEventListener('input',()=>{doc.bodyColor=el('body-color').value;});
  function point(e) {
    const rect=canvas.getBoundingClientRect(),{w,d}=sizeOf(doc,face);
    return {x:(e.clientX-rect.left)/rect.width*w,y:(e.clientY-rect.top)/rect.height*d};
  }
  canvas.addEventListener('pointerdown',e=>{
    if (!doc || working || e.button!==0) return;
    const pos=point(e),{w,d}=sizeOf(doc,face);
    let hit=-1;
    for (let i=layers().length-1;i>=0;i--) {
      const item=layers()[i],b=layerBounds(item,w,d),theta=item.angle*Math.PI/180;
      const dx=pos.x-b.x,dy=pos.y-b.y;
      if (Math.abs(dx*Math.cos(theta)+dy*Math.sin(theta))<=b.width/2 &&
          Math.abs(dy*Math.cos(theta)-dx*Math.sin(theta))<=b.height/2) {hit=i;break;}
    }
    selected=hit;
    if (hit>=0) {
      drag={id:e.pointerId,x:pos.x,y:pos.y,lx:layer().x,ly:layer().y};
      canvas.setPointerCapture(e.pointerId);
    }
    canvas.focus({preventScroll:true});refresh();
  });
  canvas.addEventListener('pointermove',e=>{
    if (!drag || drag.id!==e.pointerId || !layer()) return;
    const pos=point(e),{w,d}=sizeOf(doc,face);
    layer().x=drag.lx+(pos.x-drag.x)/w;layer().y=drag.ly+(pos.y-drag.y)/d;
    syncFields();draw();
  });
  for (const t of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(t,()=>{drag=null;});
  canvas.addEventListener('keydown',e=>{
    const step={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if (!step || !layer()) return;
    e.preventDefault();
    const {w,d}=sizeOf(doc,face),mm=e.shiftKey ? 10 : e.altKey ? .1 : 1;
    layer().x+=step[0]*mm/w;layer().y+=step[1]*mm/d;syncFields();draw();
  });
  function checkInputs() {
    if (Object.values(fields).some(input=>input.getAttribute('aria-invalid')==='true')) throw Error('Исправьте выделенные поля слоя.');
  }
  el('open-project').addEventListener('click',()=>el('project-file').click());
  el('project-file').addEventListener('change',e=>{
    const file=e.target.files[0];e.target.value='';
    if (!file) return;
    task(async()=>{
      if (file.size>96*1024*1024) throw Error('Проект превышает 96 МБ. Уменьшите размер исходных изображений.');
      let raw;try{raw=JSON.parse(await file.text());}catch{throw Error('Файл не является проектом .box.json.');}
      await activate(await validateProject(raw));message('Проект открыт. Нажмите «Применить к коробке», чтобы обновить 3D-модель.');
    });
  });
  el('save-project').addEventListener('click',()=>task(async()=>{
    checkInputs();
    const blob=new Blob([JSON.stringify(doc)],{type:'application/json'});
    if (blob.size>96*1024*1024) throw Error('Для сохранения проекта уменьшите исходные изображения до суммарного объёма 96 МБ.');
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='box_'+doc.dimensions.width+'x'+doc.dimensions.depth+'x'+doc.dimensions.height+'.box.json';
    dialog.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    message('Проект со слоями подготовлен для скачивания.');
  }));
  el('apply-edit').addEventListener('click',()=>task(async()=>{
    checkInputs();await applyDraft(doc);dialog.close();
  }));
}
