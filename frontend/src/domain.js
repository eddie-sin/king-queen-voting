export const CONTESTS = ['king', 'queen'];
export const titleCase = value => value === 'queen' ? 'Queen' : 'King';
export const validKey = value => /^[a-f0-9]{64}$/.test(value);
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

export function scheduleState(schedule, now = Date.now()) {
  const parse = v => typeof v === 'string' && v ? Date.parse(v) : NaN;
  const registration = parse(schedule?.registrationClosesAt);
  const opens = parse(schedule?.votingOpensAt);
  const closes = parse(schedule?.votingClosesAt);
  return {
    registration: Number.isFinite(registration) ? (now <= registration ? 'open' : 'closed') : 'unknown',
    voting: !Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens ? 'unknown' : now < opens ? 'upcoming' : now > closes ? 'closed' : 'open',
  };
}

export function myanmarTime(date) {
  if (!date || !Number.isFinite(Date.parse(date))) return 'Awaiting schedule';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Yangon', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(date)) + ' MMT';
}
