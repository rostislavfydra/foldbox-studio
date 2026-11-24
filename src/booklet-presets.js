import { blobDataUrl } from './project.js';
import burgundyOutside from './booklet-art/a4/burgundy-outside.webp';
import burgundyInside from './booklet-art/a4/burgundy-inside.webp';
import burgundyThumb from './booklet-art/a4/burgundy-thumb.webp';
import navyOutside from './booklet-art/a4/navy-outside.webp';
import navyInside from './booklet-art/a4/navy-inside.webp';
import navyThumb from './booklet-art/a4/navy-thumb.webp';
import champagneOutside from './booklet-art/a4/champagne-outside.webp';
import champagneThumb from './booklet-art/a4/champagne-thumb.webp';
import sandOutside from './booklet-art/a4/sand-outside.webp';
import sandThumb from './booklet-art/a4/sand-thumb.webp';
import sand2Outside from './booklet-art/a4/sand-2-outside.webp';
import sand2Thumb from './booklet-art/a4/sand-2-thumb.webp';
import ivoryInside from './booklet-art/a4/ivory-inside.webp';

import a3ArchitectureOutside from './booklet-art/a3/architecture-outside.webp';
import a3ArchitectureThumb from './booklet-art/a3/architecture-thumb.webp';
import a3ArchitectureInside from './booklet-art/a3/architecture-inside.webp';
import a3BordeauxOutside from './booklet-art/a3/bordeaux-outside.webp';
import a3BordeauxThumb from './booklet-art/a3/bordeaux-thumb.webp';
import a3BordeauxInside from './booklet-art/a3/bordeaux-inside.webp';
import a3IvoryOutside from './booklet-art/a3/ivory-outside.webp';
import a3IvoryThumb from './booklet-art/a3/ivory-thumb.webp';
import a3IvoryInside from './booklet-art/a3/ivory-inside.webp';
import a3InteriorOutside from './booklet-art/a3/interior-outside.webp';
import a3InteriorThumb from './booklet-art/a3/interior-thumb.webp';
import a3CoastOutside from './booklet-art/a3/coast-outside.webp';
import a3CoastThumb from './booklet-art/a3/coast-thumb.webp';

function preset(id, label, thumb, outside, inside) {
  return {
    id, label, thumb,
    art: {
      outside: {name:label+' · наружная',src:outside},
      inside: {name:label+' · внутренняя',src:inside}
    }
  };
}

const a4 = [
  preset('burgundy', 'Бордо', burgundyThumb, burgundyOutside, burgundyInside),
  preset('navy', 'Синий', navyThumb, navyOutside, navyInside),
  preset('champagne', 'Айвори — шампань', champagneThumb, champagneOutside, ivoryInside),
  preset('sand', 'Айвори — песочный', sandThumb, sandOutside, ivoryInside),
  preset('sand-2', 'Айвори — песочный 2', sand2Thumb, sand2Outside, ivoryInside)
];

const a3 = [
  preset('architecture', 'Синий · Архитектура', a3ArchitectureThumb, a3ArchitectureOutside, a3ArchitectureInside),
  preset('bordeaux', 'Бордо', a3BordeauxThumb, a3BordeauxOutside, a3BordeauxInside),
  preset('ivory', 'Айвори', a3IvoryThumb, a3IvoryOutside, a3IvoryInside),
  preset('interior', 'Айвори · Интерьер', a3InteriorThumb, a3InteriorOutside, a3IvoryInside),
  preset('coast', 'Айвори · Море', a3CoastThumb, a3CoastOutside, a3IvoryInside)
];

export const bookletPresets = {A4:a4, A3:a3};
export const presetById = (size,id) => bookletPresets[size]?.find(item=>item.id===id);

export async function artworkForPreset(preset) {
  const entries=await Promise.all(Object.entries(preset.art).map(async ([side,file])=>{
    if (file.src.startsWith('data:')) return [side,file];
    const response=await fetch(file.src);
    if (!response.ok) throw Error('Не удалось загрузить вариант. Проверьте соединение и повторите выбор.');
    const blob=await response.blob();
    return [side,{name:file.name,src:await blobDataUrl(blob.slice(0,blob.size,'image/webp'))}];
  }));
  return Object.fromEntries(entries);
}
