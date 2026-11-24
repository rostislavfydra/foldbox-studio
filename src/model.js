import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { disposeLid, lidMaterial } from './materials.js';
import { markBounds, bandBounds } from './artwork.js';

function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.receiveShadow = true;
  object.castShadow = true;
  parent.add(object);
  return object;
}

function board(parent, width, height, depth, x, y, z, materials, radius = .65) {
  const geometry = new RoundedBoxGeometry(width, height, depth, 2, radius);
  return mesh(parent, geometry, materials, x, y, z);
}

function gridGeometry(nx, nz, point) {
  const positions = [], uvs = [], indices = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / nz;
      positions.push(...point(u, v));
      uvs.push(u, 1-v);
      if (i < nx && j < nz) {
        const a = j * (nx + 1) + i, b = a + nx + 1;
        indices.push(a, b, a+1, a+1, b, b+1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// One continuous surface rolls over the front fold and returns beneath the blanket.
function foldedTextile(parent, width, depth, height, x, bottomY, material, layer) {
  const detail = Math.min(width, depth);
  const endRadius = Math.min(height * .49, depth * .06);
  const cornerRadius = detail * .055;
  const nx = 76, nz = 66;
  const geometry = gridGeometry(nx, nz, (u, v) => {
    const a = u * 2 - 1;
    const t = Math.min(1, Math.max(0, (v - .12) / .76));
    let z = (t - .5) * (depth - 2 * endRadius);
    let y = height;
    if (v < .12 || v > .88) {
      const front = v > .88;
      const angle = (front ? (v - .88) / .12 : (.12 - v) / .12) * Math.PI;
      z += (front ? 1 : -1) * endRadius * Math.sin(angle);
      y -= (1 - Math.cos(angle)) * height * .47;
    }
    const nearEnd = Math.max(0, Math.abs(z) - (depth * .5 - cornerRadius)) / cornerRadius;
    const endInset = cornerRadius * (1 - Math.sqrt(Math.max(0, 1 - nearEnd * nearEnd)));
    const xx = a * (width / 2 - endInset);
    const ridge = Math.sin(a * 18 + .75 * Math.sin(t * 4 + layer))
      + .48 * Math.sin(a * 31 + 1.3 * t) + .45 * Math.sin(a * 7 - t * 3.1);
    const crease = Math.exp(-Math.pow((a - .29 - .035 * Math.sin(t * 5)) / .037, 2));
    const amplitude = Math.min(height * .14, detail * .017);
    const sideRoll = Math.pow(Math.abs(a), 14) * height * .27;
    y += amplitude * (ridge - 1.8 * crease) - sideRoll;
    z += Math.min(depth * .008, 1.6) * Math.sin(a * 9 + layer) * Math.pow(Math.abs(t * 2 - 1), 3);
    return [xx, y, z];
  });
  mesh(parent, geometry, material, x, bottomY, 0);
  // Rounded folded side edges fill the narrow opening between the two fabric faces.
  board(parent, width * .995, height * .72, depth * .968, x, bottomY + height * .44, 0, material,
    Math.min(height * .35, detail * .025));
}

function interior(parent, innerW, innerD, h, mat) {
  const column = innerW * .337;
  const jarRadius = Math.min(innerW * .08, innerD * .107);
  const jarPositions = [-.314, 0, .314].map(fraction => fraction * innerD);
  const satin = gridGeometry(90, 95, (u, v) => {
    const x = (u - .5) * innerW, z = (v - .5) * innerD;
    const waves = Math.sin(23*u + 18*v + 2.5*Math.sin(v*14))
      + .55*Math.sin(u*40 - v*18 + Math.sin(u*19)) + .30*Math.sin(v*77 + u*27);
    let relief = waves * .028;
    for (const centerZ of jarPositions) {
      const dx = (x-column)/jarRadius, dz = (z-centerZ)/jarRadius;
      const r = Math.hypot(dx, dz), angle = Math.atan2(dz, dx);
      const envelope = Math.exp(-Math.pow((r-1.32)/.78,2));
      relief += envelope * (.068*Math.sin(9*angle + 1.8*r + .8*Math.sin(3*angle))
        + .04*Math.sin(15*angle-r)) - .10*Math.exp(-Math.pow(r/.88,4));
    }
    const edge = Math.pow(Math.max(Math.abs(2*u-1), Math.abs(2*v-1)), 11);
    return [x, h * (.58 + relief + edge * .12), z];
  });
  mesh(parent, satin, mat.satin);
  const textileX = -innerW * .147;
  for (let layer = 0; layer < 3; layer++) {
    foldedTextile(parent, innerW*(.676-layer*.002), innerD*(.94-layer*.008),
      h*(layer === 2 ? .165 : .131), textileX + Math.sin(layer) * innerW * .002,
      h*(.455 + layer*.13), mat.textile, layer);
  }
  const labelW = Math.min(innerW*.118, innerD*.22);
  board(parent, labelW, Math.min(.9,h*.013), labelW*.49,
    textileX + innerW*.192, h*.903, innerD*.263, mat.label, .35);
  for (const z of jarPositions) {
    mesh(parent, new THREE.CylinderGeometry(jarRadius*.98,jarRadius*.94,h*.24,64),
      mat.jar,column,h*.68,z);
    mesh(parent, new THREE.CylinderGeometry(jarRadius,jarRadius,h*.022,64),
      mat.trim,column,h*.80,z);
    mesh(parent, new THREE.CylinderGeometry(jarRadius*.98,jarRadius,h*.044,64),
      [mat.capRim,mat.capTop,mat.capRim],column,h*.833,z);
  }
}

export function makeBox(settings, mat, artwork) {
  const {width:w, depth:d, height:h} = settings;
  const root = new THREE.Group();
  const t = Math.min(3.0, w*.017, d*.019, h*.072);
  const inset = t*.90;
  const trayW = w-2*inset, trayD = d-3.1*t;
  const wallH = h-2.25*t, wallY = t+wallH/2;
  const wallThickness = Math.min(t*1.25, trayW*.05, trayD*.05);
  const base = board(root, w, t, d, 0, t/2, 0, mat.base, t*.22);
  const tray = new THREE.Group();
  tray.position.z = -.13*t;
  root.add(tray);
  const frontWall = board(tray, trayW, wallH, wallThickness, 0,wallY,(trayD-wallThickness)/2, mat.cover);
  board(tray, trayW, wallH, wallThickness, 0,wallY,-(trayD-wallThickness)/2, mat.inner);
  for (const sign of [-1,1]) {
    board(tray, wallThickness,wallH,trayD-wallThickness*2,
      sign*(trayW-wallThickness)/2,wallY,0, mat.cover);
  }
  const spine = board(root,w, h-1.35*t, t, 0,(h-1.35*t)/2+t*.40,-d/2+t/2,mat.edge);
  const contents = new THREE.Group();
  tray.add(contents);
  const innerWidth=trayW-2*wallThickness, innerDepth=trayD-2*wallThickness;
  interior(contents, innerWidth, innerDepth, h, mat);
  const contentsTop=new THREE.Box3().setFromObject(contents).max.y;
  const traySpace={width:innerWidth,depth:innerDepth,surface:contentsTop,
    centerZ:tray.position.z,clearance:h-t-contentsTop};

  const hinge = new THREE.Group();
  hinge.position.set(0, h-t/2, -d/2+t/2);
  root.add(hinge);
  let decorated = null;
  const decals={};
  const lidSurfaces = [mat.edge, mat.edge, mat.cover, mat.inner, mat.edge, mat.edge];
  const lid = board(hinge,w,t,d,0,0,(d-t)/2,lidSurfaces,t*.23);
  const flap = new THREE.Group();
  flap.position.set(0,0,d-t);
  hinge.add(flap);
  const flapH = settings.flap;
  const frontSurfaces = [mat.edge,mat.edge,mat.edge,mat.edge,mat.cover,mat.inner];
  const front = board(flap,w,flapH,t*.90,0,(t-flapH)/2,0,frontSurfaces,t*.22);
  const hingeStrip = board(hinge,w-.12*t,t*.5,t*1.14,0,-t*.28,t*.14,mat.joint,t*.18);
  const envelope = [base, spine, lid, front, frontWall, hingeStrip];
  const corners = envelope.map(object => {
    object.geometry.computeBoundingBox();
    const {min,max} = object.geometry.boundingBox;
    const points = [];
    for (const x of [min.x,max.x]) for (const y of [min.y,max.y]) for (const z of [min.z,max.z]) {
      points.push(new THREE.Vector3(x,y,z));
    }
    return points;
  });
  const worldCorners = corners.flat().map(() => new THREE.Vector3());
  function pose(fraction) {
    hinge.rotation.x = -fraction * THREE.MathUtils.degToRad(108);
    flap.rotation.x = -fraction * THREE.MathUtils.degToRad(72);
    contents.visible = fraction > .003;
    root.updateMatrixWorld(true);
    let n = 0;
    for (let i = 0; i < envelope.length; i++) {
      for (const point of corners[i]) worldCorners[n++].copy(point).applyMatrix4(envelope[i].matrixWorld);
    }
  }
  function finish(next, design) {
    if (decorated) disposeLid(decorated);
    decorated = design ? null : lidMaterial(next, mat.bump);
    lidSurfaces[2] = design ? design.lid || mat.navy : decorated;
    frontSurfaces[4] = design?.flap || mat.cover;
    design?.fit?.(w,d,flapH);
    for (const name of ['mark','band']) {
      if (!design?.[name]) {if (decals[name]) decals[name].visible=false;continue;}
      let plane=decals[name];
      if (!plane) {
        plane=mesh(hinge,new THREE.PlaneGeometry(1,1),design[name]);
        plane.rotation.x=-Math.PI/2;
        plane.castShadow=plane.receiveShadow=false;
        decals[name]=plane;
      }
      const bounds=name==='mark' ? markBounds(design.definition,w,d) : bandBounds(w,d);
      plane.scale.set(bounds.width,bounds.height,1);
      plane.position.set(bounds.x-w/2,t*.5+.025,bounds.y-t*.5);
      plane.material=design[name];plane.visible=true;
    }
  }
  finish(settings, artwork);
  pose(settings.open ? 1 : 0);
  return {
    root, worldCorners, pose, finish, traySpace,
    baseImage(){return decorated?.map.image;},
    dispose() {
      root.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
      if (decorated) disposeLid(decorated);
    }
  };
}
