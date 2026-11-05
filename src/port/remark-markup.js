import { NOTE_TONES } from './note-markup.js';

const names = {
  红: 'rose', red: 'rose', rose: 'rose',
  蓝: 'blue', blue: 'blue',
  绿: 'sage', green: 'sage', sage: 'sage',
  黄: 'amber', 橙: 'amber', yellow: 'amber', orange: 'amber', amber: 'amber',
  紫: 'plum', purple: 'plum', plum: 'plum',
  青: 'teal', teal: 'teal',
  灰: 'slate', gray: 'slate', grey: 'slate', slate: 'slate',
  棕: 'stone', brown: 'stone', stone: 'stone',
};
const hex = rgb => '#' + rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
const rgb = color => color.slice(1).match(/../g).map(channel => parseInt(channel, 16));
const mix = (a, b, ratio) => a.map((channel, index) => channel * ratio + b[index] * (1 - ratio));
const luminance = value => rgb(value).map(channel => { const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

function capsuleColor(value) {
  const name = value.trim().toLowerCase(), tone = NOTE_TONES.find(tone => tone.id === (names[name] || names[name.replace(/色$/, '')]));
  if (tone) return { ink: tone.ink, fill: tone.fill, border: hex(mix(rgb(tone.ink), [255, 255, 255], .2)) };
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(name)) return null;
  const base = name.length === 4 ? '#' + [...name.slice(1)].map(c => c + c).join('') : name;
  const fill = hex(mix(rgb(base), [255, 255, 255], .12));
  let ink = base;
  // Keep arbitrary light colours readable on their tint, without accepting CSS
  // expressions, styles or HTML from the remark field.
  for (let n = 0; n < 30 && contrast(ink, fill) < 4.5; n++) ink = hex(rgb(ink).map(channel => channel * .9));
  return { ink, fill, border: hex(mix(rgb(ink), [255, 255, 255], .2)) };
}

export function parseRemark(value = '') {
  const text = String(value ?? ''), result = [];
  // Deliberately require {colour}: ordinary [citations] and wiki links stay
  // ordinary text. Backslash escapes allow a literal capsule example.
  const pattern = /\\([\\[\]{}])|\[([^\[\]\r\n]+)\]\{([^{}\r\n]{1,32})\}/g;
  const append = text => { if (!text) return; const last = result.at(-1); if (last?.kind === 'text') last.text += text; else result.push({ kind: 'text', text }); };
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    append(text.slice(cursor, match.index));
    if (match[1]) append(match[1]);
    else {
      const label = match[2].trim(), colors = capsuleColor(match[3]);
      if (label && colors) result.push({ kind: 'pill', text: label, ...colors });
      else append(match[0]);
    }
    cursor = match.index + match[0].length;
  }
  append(text.slice(cursor)); return result;
}
export const remarkPlainText = value => parseRemark(value).map(part => part.text).join('');
