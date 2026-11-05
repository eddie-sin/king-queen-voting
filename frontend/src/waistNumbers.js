const assignments = [
  ['Pann Myat Nadi', 'Pan Myat Nadi', 'Zwe Wai Yan Htet', 'Zwel Wai Yan Htet'],
  ['Pan Hsu Han', 'Pan Su Han', 'Than Htut Oo'],
  ['Thiri San', 'Ar Kar Min', 'Arkar Min'],
  ['Ei Thwel Shin Thant', 'Alex Lian', 'Lian'],
  ['Su Yati Linn', 'Hsu Yadi Lin', 'Nyein Chan San'],
  ['Hay Mann Oo', 'Hay Mhan Oo', 'Aung Kaung San'],
  ['Wera', 'Hnin Thiri'],
];

const normalize = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const numbers = new Map(assignments.flatMap((names, index) => names.map(name => [normalize(name), index + 1])));

export function waistNumberFor(candidate) {
  return numbers.get(normalize(candidate?.fullName)) ?? null;
}

export function candidateInGallery(candidate, category) {
  return candidate.category === category &&
    !(category === 'king' && normalize(candidate.fullName) === 'aung khant paing');
}
