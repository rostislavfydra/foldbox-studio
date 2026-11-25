import * as THREE from 'three';
import ornamentLid from './art/ornament-lid.webp';
import ornamentFlap from './art/ornament-flap.webp';
import ornamentThumb from './art/ornament-thumb.webp';
import architectureLid from './art/architecture-lid.webp';
import architectureFlap from './art/architecture-flap.webp';
import architectureThumb from './art/architecture-thumb.webp';
import birdsLid from './art/birds-lid.webp';
import birdsFlap from './art/birds-flap.webp';
import birdsThumb from './art/birds-thumb.webp';
import coastPhoto from './art/coast-photo.webp';
import coastMark from './art/coast-mark.svg';
import coastThumb from './art/coast-thumb.webp';
import centerMark from './art/center-mark.svg';
import centerThumb from './art/center-thumb.webp';
import stripesMark from './art/stripes-mark.svg';
import stripeBand from './art/stripe-band.svg';
import stripesThumb from './art/stripes-thumb.webp';
import facadeProject from './art/facade-emblem.box.json';
import facadeThumb from './art/facade-emblem-thumb.webp';

export const designs=[
  {id:'facade-emblem',label:'Фасад со знаком',project:facadeProject,thumb:facadeThumb},
  {id:'center',label:'По центру',mark:centerMark,thumb:centerThumb,markRatio:226/37,markWidth:.4},
  {id:'stripes',label:'Полосы',mark:stripesMark,band:stripeBand,thumb:stripesThumb,markRatio:251/29,markWidth:.463},
  {id:'coast',label:'Побережье',lid:coastPhoto,mark:coastMark,thumb:coastThumb,markRatio:512/54,markWidth:.945},
  {id:'ornament',label:'Орнамент',lid:ornamentLid,flap:ornamentFlap,thumb:ornamentThumb},
  {id:'architecture',label:'Фасад',lid:architectureLid,flap:architectureFlap,thumb:architectureThumb},
  {id:'birds',label:'Птицы',lid:birdsLid,flap:birdsFlap,thumb:birdsThumb}
];
export const designById=id=>designs.find(design=>design.id===id);

export function markBounds(design,w,d) {
  const width=Math.min(w*design.markWidth,d*.2*design.markRatio),height=width/design.markRatio;
  const x=design.id==='stripes' ? w*.969-width/2 : w/2;
  const y=design.id==='coast' ? d*.957-height/2 : d*(design.id==='stripes' ? .537 : .5);
  return {width,height,x,y};
}
export function bandBounds(w,d) {
  const width=w*.065;
  return {width,height:d*.998,x:w*.005+width/2,y:d*.5};
}

export async function loadDesign(id,renderer,bumpMap) {
  if (id==='base') return null;
  const design=designById(id);
  const loader=new THREE.TextureLoader();
  const result={definition:design};
  const surfaces=[];
  await Promise.all(['lid','flap','mark','band'].filter(name=>design[name]).map(async name=>{
    const map=await loader.loadAsync(design[name]);
    map.colorSpace=THREE.SRGBColorSpace;
    map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const material=new THREE.MeshStandardMaterial({
      map,color:0xc7c7c7,roughness:.78,envMapIntensity:.34,
      bumpMap,bumpScale:.075
    });
    if (name==='mark' || name==='band') {
      Object.assign(material,{transparent:true,depthWrite:false,polygonOffset:true,
        polygonOffsetFactor:-2,polygonOffsetUnits:-2,metalness:.48,roughness:.40,envMapIntensity:.85,bumpMap:null});
      material.color.set(0xffffff);
    }
    result[name]=material;surfaces.push(material);
  }));
  result.dispose=()=>{
    for (const item of surfaces) {item.map.dispose();item.dispose();}
  };
  if (design.id==='coast') {
    result.fit=(width,depth)=>{
      const photo=result.lid.map,sourceAspect=photo.image.width/photo.image.height,targetAspect=width/depth;
      const repeatX=Math.min(1,targetAspect/sourceAspect),repeatY=Math.min(1,sourceAspect/targetAspect);
      // Keep the building at the right edge and the horizon level.
      photo.repeat.set(repeatX,repeatY);
      photo.offset.set(1-repeatX,(1-repeatY)/2);
    };
  }
  return result;
}
