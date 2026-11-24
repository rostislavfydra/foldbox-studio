import { blobDataUrl } from './project.js';
import burgundyOutside from './booklet-art/a4-designs/burgundy-outside.webp';
import burgundyInside from './booklet-art/a4-designs/burgundy-inside.webp';
import burgundyThumb from './booklet-art/a4-designs/burgundy-thumb.webp';
import navyOutside from './booklet-art/a4-designs/navy-outside.webp';
import navyInside from './booklet-art/a4-designs/navy-inside.webp';
import navyThumb from './booklet-art/a4-designs/navy-thumb.webp';
import champagneOutside from './booklet-art/a4-designs/champagne-outside.webp';
import champagneThumb from './booklet-art/a4-designs/champagne-thumb.webp';
import sandOutside from './booklet-art/a4-designs/sand-outside.webp';
import sandThumb from './booklet-art/a4-designs/sand-thumb.webp';
import sand2Outside from './booklet-art/a4-designs/sand-2-outside.webp';
import sand2Thumb from './booklet-art/a4-designs/sand-2-thumb.webp';
import ivoryInside from './booklet-art/a4-designs/ivory-inside.webp';

// The three ivory editions have byte-identical inside spreads in the source.
function preset(id, label, thumb, outside, inside) {
  return {
    id, label, thumb,
    art: {
      outside: {name:label+' · наружная',src:outside},
      inside: {name:label+' · внутренняя',src:inside}
    }
  };
}

export const a4Presets = [
  preset('burgundy', 'Бордо', burgundyThumb, burgundyOutside, burgundyInside),
  preset('navy', 'Синий', navyThumb, navyOutside, navyInside),
  preset('champagne', 'Айвори — шампань', champagneThumb, champagneOutside, ivoryInside),
  preset('sand', 'Айвори — песочный', sandThumb, sandOutside, ivoryInside),
  preset('sand-2', 'Айвори — песочный 2', sand2Thumb, sand2Outside, ivoryInside)
];

export const a4PresetById = id => a4Presets.find(item=>item.id===id);

export async function artworkForA4(preset) {
  const entries=await Promise.all(Object.entries(preset.art).map(async ([side,file])=>{
    if (file.src.startsWith('data:')) return [side,file];
    const response=await fetch(file.src);
    if (!response.ok) throw Error('Не удалось загрузить вариант. Проверьте соединение и повторите выбор.');
    const blob=await response.blob();
    return [side,{name:file.name,src:await blobDataUrl(blob.slice(0,blob.size,'image/webp'))}];
  }));
  return Object.fromEntries(entries);
}
