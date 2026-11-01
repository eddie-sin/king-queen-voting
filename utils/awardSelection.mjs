// Shared by the announcement API and its review dialog. Order is title order,
// never a re-ranking of an organiser's manual choices.
export const AWARD_SLOTS = [
  { key: 'king', title: 'King', category: 'king', rank: 0 },
  { key: 'queen', title: 'Queen', category: 'queen', rank: 0 },
  { key: 'mrs', title: 'Mrs Thadingyut', category: 'king', rank: 1 },
  { key: 'miss', title: 'Miss Thadingyut', category: 'queen', rank: 1 },
];
export function planAwards(rows, mode = 'default', picks = {}) {
  const chosen = new Set(), selection = {}, slots = [];
  for (const definition of AWARD_SLOTS) {
    const categoryRows = rows.filter(row => row.candidate.category === definition.category);
    const previous = AWARD_SLOTS.find(slot => slot.category === definition.category && slot.rank === 0);
    const waiting = definition.rank === 1 && categoryRows.length > 0 && !selection[previous.key];
    const remaining = categoryRows.filter(row => !chosen.has(String(row.candidate._id)));
    const highest = Math.max(...remaining.map(row => row.votes));
    const options = waiting ? [] : mode === 'manual' ? remaining : remaining.filter(row => row.votes === highest);
    const requested = picks[definition.key];
    const invalid = Boolean(requested) && !options.some(row => String(row.candidate._id) === requested);
    const selected = invalid ? null : requested ? options.find(row => String(row.candidate._id) === requested) : mode === 'default' && options.length === 1 ? options[0] : null;
    if (selected) { selection[definition.key] = String(selected.candidate._id); chosen.add(String(selected.candidate._id)); }
    const required = categoryRows.length > definition.rank;
    slots.push({ ...definition, options, selected, required, waiting, invalid, tied: mode === 'default' && options.length > 1 });
  }
  return { slots, selection, ready: slots.every(slot => !slot.invalid && (!slot.required || slot.selected)) };
}
