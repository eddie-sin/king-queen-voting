// DEVELOPMENT ONLY. Imported only behind import.meta.env.DEV in main.jsx.
// There are no fixtures in the production application and no automatic fallback.
import { ApiError } from '../api.js';
import { publicCandidate, publicFinalists, scheduleState } from '../domain.js';

export function createFixtureApi({ scenario = 'open', delayMs = 300 } = {}) {
  const now = Date.now(); const iso = offset => new Date(now + offset).toISOString();
  const announced = scenario === 'announced';
  const schedule = {
    registrationClosesAt: iso(scenario === 'registration-closed' || announced ? -60000 : 86400000),
    votingOpensAt: iso(scenario === 'upcoming' ? 3600000 : announced ? -7200000 : -3600000),
    votingClosesAt: iso(scenario === 'closed' ? -1000 : announced ? -3600000 : 7200000),
    resultsPublishedAt: iso(announced ? -60000 : 10800000), timezone: 'Asia/Yangon',
  };
  const names = [['Aung Khant', 'Min Thant', 'Hein Htet'], ['May Thazin', 'Hnin Wut Yee', 'Su Myat Noe']];
  const candidates = ['king', 'queen'].flatMap((contest, j) => names[j].map((name, i) => publicCandidate({
    _id: `${contest}-${i + 1}`, fullName: name, batchNumber: '2026', category: contest, isActive: true,
    images: Array.from({ length: i + 1 }, () => `${import.meta.env?.BASE_URL || '/'}art/source-${contest}.svg`),
    ...(i === 0 ? { nickname: j ? 'Thazin' : 'Khant', bio: 'A sample profile for the local design preview. Real names, photographs and biographies come from the candidates API.', age: 20, zodiacSign: 'Libra', hobbiesAndInterests: ['Music', 'Photography'] } : {}),
  })));
  const accounts = new Map([['demo@example.test', { password: 'festival123', key: 'a'.repeat(64), user: { id: 'demo', email: 'demo@example.test', hasVotedKing: false, hasVotedQueen: false }, choices: {} }]]);
  const tokens = new Map(); let interruptedOnce = false; let sequence = 0;
  const wait = () => new Promise(resolve => setTimeout(resolve, delayMs));
  const fail = (message, status = 400, interrupted = false) => { throw new ApiError(message, { status, interrupted }); };
  const account = token => tokens.get(token) || fail('Your login has expired.', 401);
  const open = () => { if (scheduleState(schedule).voting !== 'open') fail('Voting is not open.', 403); };
  const check = (token, key) => { const data = account(token); if (key !== data.key) fail('The voting key does not match this account.', 401); open(); return data; };
  const flags = data => ({ ...data.user, hasVotedKing: Boolean(data.choices.king), hasVotedQueen: Boolean(data.choices.queen) });
  const mutate = async (token, key, id, contest, type) => {
    await wait(); const data = check(token, key);
    if (!['king', 'queen'].includes(contest)) fail('Invalid contest.');
    if (type === 'submit' && data.choices[contest]) fail('A choice already exists. Use change.', 409);
    if (type !== 'submit' && !data.choices[contest]) fail('No choice exists.', 409);
    if (type === 'remove') delete data.choices[contest];
    else { const candidate = candidates.find(c => c._id === id && c.category === contest); if (!candidate) fail('Candidate is unavailable.', 404); data.choices[contest] = candidate; }
    if (scenario === 'interrupted' && !interruptedOnce) { interruptedOnce = true; fail('Connection interrupted.', 0, true); }
    return { status: 'success', message: 'Choice saved.' };
  };
  return {
    async candidates() { await wait(); if (scenario === 'error') fail('Sample candidate service is unavailable.', 503); return scenario === 'empty' ? [] : candidates; },
    async lanterns() { await wait(); return []; },
    async settings() { await wait(); if (scenario === 'schedule-error') fail('Sample schedule service is unavailable.', 503); return schedule; },
    async finalists() {
      await wait(); if (!announced) fail('Finalist results are not available yet.', 403);
      const five = (contest, list) => list.map((name, i) => ({ candidate: { _id: `${contest}-f${i}`, fullName: name, batchNumber: 'HND-65', category: contest, isActive: true, images: [`${import.meta.env?.BASE_URL || '/'}art/source-${contest}.svg`] }, votes: 0 }));
      return publicFinalists({
        kings: five('king', ['Aung Khant', 'Min Thant', 'Hein Htet', 'Zaw Lin', 'Kaung Myat']),
        queens: five('queen', ['May Thazin', 'Hnin Wut Yee', 'Su Myat Noe', 'Thiri Aung', 'Ei Phyu']),
      });
    },
    async register(email, password) {
      await wait(); if (scheduleState(schedule).registration !== 'open') fail('Registration is closed.', 403);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) fail('Enter a valid email and password of at least eight characters.');
      if (accounts.has(email)) fail('An account already exists for this email.', 409);
      const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
      const user = { id: `fixture-${++sequence}`, email, hasVotedKing: false, hasVotedQueen: false };
      accounts.set(email, { key, password, user, choices: {} }); return { user, votingKey: key };
    },
    async login(email, password) { await wait(); const data = accounts.get(email); if (!data || data.password !== password) fail('Email or password is incorrect.', 401); const token = `fixture-session-${++sequence}`; tokens.set(token, data); return { token, user: flags(data) }; },
    async me(token) { await wait(); return flags(account(token)); },
    async myVotes(token, key) { await wait(); const data = check(token, key); return Object.entries(data.choices).map(([contest, candidate]) => ({ contest, candidate })); },
    submit: (token, key, id, contest) => mutate(token, key, id, contest, 'submit'),
    change: (token, key, id, contest) => mutate(token, key, id, contest, 'change'),
    remove: (token, key, contest) => mutate(token, key, null, contest, 'remove'),
  };
}
