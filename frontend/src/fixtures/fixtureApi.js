// DEVELOPMENT ONLY. Imported only behind import.meta.env.DEV in main.jsx.
// There are no fixtures in the production application and no automatic fallback.
import { ApiError } from '../api.js';
import { publicCandidate, publicResults, eventState } from '../domain.js';

export function createFixtureApi({ scenario = 'open', delayMs = 300 } = {}) {
  const announced = scenario === 'announced';
  const controls = { registrationOpen: !announced && scenario !== 'registration-closed',
    votingStatus: ['closed','upcoming','announced'].includes(scenario) ? 'closed' : 'open',
    announcementOpen: announced, memoryPhotosEnabled: false, round: 1, window: 1, revision: 0,
    candidateManagementLocked: !announced ? scenario !== 'closed' && scenario !== 'upcoming' : true };
  const names = [['Aung Khant', 'Min Thant', 'Hein Htet'], ['May Thazin', 'Hnin Wut Yee', 'Su Myat Noe']];
  const candidates = ['king', 'queen'].flatMap((contest, j) => names[j].map((name, i) => publicCandidate({
    _id: `${contest}-${i + 1}`, fullName: name, batchNumber: '2026', category: contest, isActive: true,
    images: Array.from({ length: i + 1 }, () => `${import.meta.env?.BASE_URL || '/'}art/source-${contest}.svg`),
    ...(i === 0 ? { nickname: j ? 'Thazin' : 'Khant', bio: 'A sample profile for the local design preview. Real names, photographs and biographies come from the candidates API.', age: 20, zodiacSign: 'Libra', hobbiesAndInterests: ['Music', 'Photography'] } : {}),
  })));
  const accounts = new Map([['demo@example.test', { password: 'festival123', user: { id: 'demo', email: 'demo@example.test', hasVotedKing: false, hasVotedQueen: false }, choices: {} }]]);
  const tokens = new Map(); let interruptedOnce = false; let sequence = 0;
  const wait = () => new Promise(resolve => setTimeout(resolve, delayMs));
  const fail = (message, status = 400, interrupted = false) => { throw new ApiError(message, { status, interrupted }); };
  const account = token => tokens.get(token) || fail('Your login has expired.', 401);
  const open = () => { if (eventState(controls).voting !== 'open') fail('Voting is not open.', 403); };
  const flags = data => ({ ...data.user, round: controls.round, hasVotedKing: Boolean(data.choices.king), hasVotedQueen: Boolean(data.choices.queen) });
  const mutate = async (token, id, contest, snapshot) => {
    await wait(); const data = account(token); open();
    if (snapshot.round !== controls.round || snapshot.window !== controls.window) fail('Refresh voting status.', 409);
    if (!['king','queen'].includes(contest)) fail('Invalid category.');
    if (data.choices[contest]) {
      if (data.choices[contest]._id === id) return { status: 'success' };
      fail('You have already voted in this category.', 409);
    }
    const candidate = candidates.find(c => c._id === id && c.category === contest);
    if (!candidate) fail('Candidate unavailable.', 404);
    data.choices[contest] = candidate;
    if (scenario === 'interrupted' && !interruptedOnce) { interruptedOnce = true; fail('Connection interrupted.', 0, true); }
    return { status: 'success', message: 'Vote recorded.' };
  };
  return {
    async lanternStatus(){return {open:false,announced:false,window:0,winner:null};},
    async myLanternVote(){return {vote:null};},
    async voteLantern(){throw new ApiError('Lantern voting is closed in this preview.');},
    async candidates() { await wait(); if (scenario === 'error') fail('Sample candidate service is unavailable.', 503); return scenario === 'empty' ? [] : candidates; },
    async lanterns() { await wait(); return []; },
    async settings() { await wait(); if (scenario === 'schedule-error') fail('Sample schedule service is unavailable.', 503); return controls; },
    async results() {
      await wait(); if (!announced) fail('Announcement is closed.', 403);
      const sampleTotals = (contest, list) => list.map((name, i) => ({ candidate: { _id: `${contest}-f${i}`, fullName: name, batchNumber: 'HND-65', category: contest, isActive: true, images: [`${import.meta.env?.BASE_URL || '/'}art/source-${contest}.svg`] }, votes: 0 }));
      return publicResults({
        round: controls.round, revision: controls.revision,
        kings: sampleTotals('king', ['Aung Khant', 'Min Thant', 'Hein Htet', 'Zaw Lin', 'Kaung Myat']),
        queens: sampleTotals('queen', ['May Thazin', 'Hnin Wut Yee', 'Su Myat Noe', 'Thiri Aung', 'Ei Phyu']),
      });
    },
    async register(email, password) {
      await wait(); if (eventState(controls).registration !== 'open') fail('Registration is closed.', 403);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) fail('Enter a valid email and password of at least eight characters.');
      if (accounts.has(email)) fail('An account already exists for this email.', 409);
      const user = { id: `fixture-${++sequence}`, email, hasVotedKing: false, hasVotedQueen: false };
      accounts.set(email, { password, user, choices: {} }); return { user };
    },
    async login(email, password) { await wait(); const data = accounts.get(email); if (!data || data.password !== password) fail('Email or password is incorrect.', 401); const token = `fixture-session-${++sequence}`; tokens.set(token, data); return { token, user: flags(data) }; },
    async me(token) { await wait(); return flags(account(token)); },
    async myVotes(token) { await wait(); const data = account(token); return { votes: Object.entries(data.choices).map(([contest, candidate]) => ({ contest, candidate })), round: controls.round, window: controls.window }; },
    submit: mutate,
  };
}
