export const CONTESTS = ['king', 'queen'];
export const titleCase = value => value === 'queen' ? 'Queen' : 'King';
const safeImageUrl = value => typeof value === 'string' && (/^\/(?!\/)/.test(value) || /^https?:\/\//i.test(value));

// Render only the public fields. Contact numbers never enter presentation data.
export function publicCandidate(value) {
  if (!value || typeof value !== 'object') return null;
  const text = x => typeof x === 'string' ? x : '';
  return {
    _id: text(value._id), fullName: text(value.fullName) || 'Candidate',
    batchNumber: value.batchNumber == null ? '' : String(value.batchNumber),
    nickname: text(value.nickname), images: (Array.isArray(value.images) ? value.images : []).filter(safeImageUrl).slice(0, 3),
    bio: text(value.bio), age: Number.isFinite(value.age) && value.age > 0 ? value.age : null,
    zodiacSign: text(value.zodiacSign),
    hobbiesAndInterests: (Array.isArray(value.hobbiesAndInterests) ? value.hobbiesAndInterests : []).filter(x => typeof x === 'string' && x.trim()),
    category: CONTESTS.includes(value.category) ? value.category : '', isActive: value.isActive === true,
  };
}

export function publicLantern(value) {
  if (!value || typeof value !== 'object' || value.section !== 'lantern' || !safeImageUrl(value.url)) return null;
  const clean = field => typeof field === 'string' ? field.trim() : '';
  return {
    _id: clean(value._id), url: value.url,
    title: clean(value.title) || 'Festival lantern', description: clean(value.description),
  };
}

export function savedChoices(votes) {
  if (!Array.isArray(votes)) throw new Error('Saved choices could not be verified. Please refresh them.');
  const result = { king: null, queen: null };
  for (const vote of votes) {
    if (!CONTESTS.includes(vote.contest)) continue;
    if (result[vote.contest]) throw new Error('Saved choices could not be verified. Please refresh them.');
    // A deleted candidate still represents a vote and must not become a first-vote action.
    result[vote.contest] = publicCandidate(vote.candidate) || { _id: '', fullName: 'Candidate unavailable', images: [], category: vote.contest };
  }
  return result;
}

export function eventState(controls) {
  return {
    registration: typeof controls?.registrationOpen === 'boolean' ? controls.registrationOpen ? 'open' : 'closed' : 'unknown',
    voting: ['open', 'closed', 'closing'].includes(controls?.votingStatus) ? controls.votingStatus : 'unknown',
  };
}
export function announcementState(controls) {
  if (typeof controls?.announcementOpen !== 'boolean') return 'unknown';
  return controls.announcementOpen && controls.votingStatus === 'closed' ? 'announced' : 'waiting';
}
export function publicResults(results) {
  if (!results || !Number.isSafeInteger(results.round) || !Number.isSafeInteger(results.revision)) throw new Error('Results are unavailable.');
  const pick = list => {
    if (!Array.isArray(list)) throw new Error('Results are incomplete.');
    return list.map(entry => {
      const candidate = publicCandidate(entry?.candidate);
      if (!candidate?._id || !Number.isSafeInteger(entry.votes) || entry.votes < 0) throw new Error('Results are incomplete.');
      return { ...candidate, votes: entry.votes, title: typeof entry.title==='string'?entry.title:'' };
    }).sort((a, b) => b.votes - a.votes || a.fullName.localeCompare(b.fullName) || a._id.localeCompare(b._id));
  };
  return { king: pick(results.kings), queen: pick(results.queens), round: results.round, revision: results.revision };
}
