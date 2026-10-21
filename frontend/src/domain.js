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
  const override = schedule?.votingOverride;
  const validVoting = Number.isFinite(opens) && Number.isFinite(closes) && closes > opens;
  return {
    registration: Number.isFinite(registration) ? (now <= registration ? 'open' : 'closed') : 'unknown',
    voting: !validVoting ? 'unknown' : override === 'open' ? 'open' : override === 'closed' ? 'closed' : now < opens ? 'upcoming' : now > closes ? 'closed' : 'open',
  };
}

export function myanmarTime(date) {
  if (!date || !Number.isFinite(Date.parse(date))) return 'Awaiting schedule';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Yangon', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(date)) + ' MMT';
}

// Finalists are announced only after voting has ended and the published time has passed.
// The server enforces the same rule; this only chooses which stage to render.
export function finalistsState(schedule, now = Date.now()) {
  const published = typeof schedule?.resultsPublishedAt === 'string' ? Date.parse(schedule.resultsPublishedAt) : NaN;
  if (!Number.isFinite(published)) return 'unknown';
  if (now < published || scheduleState(schedule, now).voting !== 'closed') return 'waiting';
  return 'announced';
}

// Public finalists show five equal people per contest: no votes, ranks or tie-break flags,
// and an alphabetical order so the server's vote order never hints at placement.
export function publicFinalists(results) {
  if (!results || typeof results !== 'object') throw new Error('Finalist results are unavailable.');
  const pick = list => (Array.isArray(list) ? list : [])
    .map(entry => publicCandidate(entry?.candidate))
    .filter(candidate => candidate?._id)
    .map(({ _id, fullName, nickname, batchNumber, images, category }) => ({ _id, fullName, nickname, batchNumber, images, category }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'en', { sensitivity: 'base' }));
  return { king: pick(results.kings), queen: pick(results.queens) };
}
