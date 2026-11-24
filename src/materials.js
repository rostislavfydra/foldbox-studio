import * as THREE from 'three';

function surface(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

function texture(ctx, color = false) {
  const result = new THREE.CanvasTexture(ctx.canvas);
  if (color) result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function grain(width, base, spread, seed) {
  const ctx = surface(width);
  const pixels = ctx.createImageData(width, width);
  const random = randomGenerator(seed);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = (random() + random() - 1) * spread;
    pixels.data[i] = base[0] + n;
    pixels.data[i + 1] = base[1] + n;
    pixels.data[i + 2] = base[2] + n;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return ctx;
}

function repeating(ctx, repeatX, repeatY, color = false) {
  const t = texture(ctx, color);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

// Four engraved leaves form an independent, unlettered ornament.
function engravedFlower(ctx, x, y, radius, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = radius * .061;
  ctx.lineJoin = 'round';
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    ctx.moveTo(0, -radius * .11);
    ctx.bezierCurveTo(-radius * .36, -radius * .38, -radius * .25, -radius * .73, 0, -radius);
    ctx.bezierCurveTo(radius * .25, -radius * .73, radius * .36, -radius * .38, 0, -radius * .11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -radius * .23);
    ctx.lineTo(0, -radius * .74);
    ctx.stroke();
    ctx.rotate(Math.PI / 2);
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * .075, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lacquerPattern(ctx, width, height, aspect, ink) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height * .46);
  ctx.clip();
  const cell = width / 11;
  const stepY = cell * .77 * height * aspect / width;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.8, cell * .041);
  for (let row = -1; row * stepY < height * .47; row++) {
    for (let col = -1; col < 13; col++) {
      const x = (col + (row % 2) * .5) * cell;
      const y = (row + .32) * stepY;
      for (const r of [.94, .70, .46]) {
        ctx.beginPath();
        ctx.moveTo(x - .5 * r * cell, y + .29 * stepY);
        ctx.bezierCurveTo(x - .43 * r * cell, y - .24 * r * stepY, x - .12 * r * cell, y - .40 * r * stepY, x, y - .79 * r * stepY);
        ctx.bezierCurveTo(x + .12 * r * cell, y - .40 * r * stepY, x + .43 * r * cell, y - .24 * r * stepY, x + .50 * r * cell, y + .29 * stepY);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function lidMaterial(settings, bumpMap) {
  const aspect = settings.width / settings.depth;
  const width = Math.round(Math.min(1536, Math.max(384, 1280 * Math.min(1, aspect))));
  const height = Math.round(Math.min(1536, Math.max(384, width / aspect)));
  const color = surface(width, height);
  const properties = surface(width, height);
  color.fillStyle = '#25384f';
  color.fillRect(0, 0, width, height);
  properties.fillStyle = 'rgb(0,193,0)';
  properties.fillRect(0, 0, width, height);
  if (settings.varnish) {
    lacquerPattern(color, width, height, aspect, '#1b2d45');
    lacquerPattern(properties, width, height, aspect, 'rgb(0,57,18)');
  }
  if (settings.foil) {
    // Draw in physical proportions even when the lid is unusually long or narrow.
    const scaleY = height * aspect / width;
    const radius = Math.min(width * .050, height / scaleY * .105);
    const gold = color.createLinearGradient(width * .45, height * .69, width * .55, height * .79);
    gold.addColorStop(0, '#ba975f');
    gold.addColorStop(.42, '#ead8a4');
    gold.addColorStop(.6, '#c9aa74');
    gold.addColorStop(1, '#dccc9d');
    for (const [ctx, ink] of [[color, gold], [properties, 'rgb(0,91,183)']]) {
      ctx.save();
      ctx.scale(1, scaleY);
      engravedFlower(ctx, width / 2, height * .747 / scaleY, radius, ink);
      ctx.restore();
    }
  }
  const finish = texture(properties);
  const material = new THREE.MeshStandardMaterial({
    map: texture(color, true), metalness: 1, metalnessMap: finish,
    roughness: 1, roughnessMap: finish, bumpMap, bumpScale: .115, envMapIntensity: .64
  });
  return material;
}

export function disposeLid(material) {
  material.map.dispose();
  material.roughnessMap.dispose();
  material.dispose();
}

export function makeMaterials() {
  const bump = repeating(grain(256, [125,125,125], 54, 42), 7, 6);
  const paper = (color, roughness = .76, bumpScale = .12) => new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0, envMapIntensity: .48, bumpMap: bump, bumpScale
  });
  const weave = grain(128, [225, 219, 202], 16, 261);
  const knit = surface(128);
  knit.fillStyle = '#999';
  knit.fillRect(0, 0, 128, 128);
  for (let y = -8; y < 136; y += 8) {
    for (let x = -4; x < 132; x += 4) {
      const offset = (y / 8 % 2) * 2;
      for (const [ctx, ink] of [[weave, '#827e7028'], [knit, '#3b3b3b']]) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x + offset, y);
        ctx.quadraticCurveTo(x + 2 + offset, y + 4, x + 1 + offset, y + 7);
        ctx.stroke();
      }
    }
  }
  const knitMap = repeating(weave, 4, 4, true);
  const knitBump = repeating(knit, 4, 4);
  const textile = new THREE.MeshStandardMaterial({
    map: knitMap, bumpMap: knitBump, bumpScale: .22, roughness: .97, envMapIntensity: .32,
    side: THREE.DoubleSide
  });
  const satin = new THREE.MeshPhysicalMaterial({
    color: '#17263f', roughness: .49, metalness: .08,
    sheen: .82, sheenColor: new THREE.Color('#67778e'), sheenRoughness: .39,
    bumpMap: bump, bumpScale: .085, envMapIntensity: .55
  });
  const cap = surface(384);
  cap.fillStyle = '#e7e2d0';
  cap.fillRect(0,0,384,384);
  engravedFlower(cap, 192, 192, 102, '#293d55');
  const navy=paper('#c7c7c7',.79,.13);
  navy.map=repeating(grain(384,[32,43,68],12,9781),3,2,true);
  navy.envMapIntensity=.34;
  return {
    bump, textile, satin, navy,
    cover: paper('#24354c'), edge: paper('#213149'), base: paper('#213248'),
    inner: paper('#293b54', .88), joint: paper('#132238', .84),
    jar: new THREE.MeshStandardMaterial({color:'#152334', roughness:.28, metalness:.25}),
    capTop: new THREE.MeshStandardMaterial({map:texture(cap,true), roughness:.52, metalness:.07}),
    capRim: paper('#d9d2bc', .52, .03),
    trim: new THREE.MeshStandardMaterial({color:'#bea16d', metalness:.72, roughness:.35}),
    label: paper('#304059', .84, .16)
  };
}
