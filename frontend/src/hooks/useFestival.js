import { useCallback, useEffect, useRef, useState } from 'react';
import { savedChoices, scheduleState, validKey } from '../domain.js';

const EMPTY = { king: null, queen: null };
export function useFestival(api) {
  const [candidates, setCandidates] = useState([]);
  const [candidateState, setCandidateState] = useState('loading');
  const [candidateError, setCandidateError] = useState('');
  const [lanterns, setLanterns] = useState([]);
  const [lanternState, setLanternState] = useState('loading');
  const [lanternError, setLanternError] = useState('');
  const [schedule, setSchedule] = useState(null);
  const [scheduleError, setScheduleError] = useState('');
  const [checkedAt, setCheckedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  const keyRef = useRef(''); // Never persisted; only POST/PATCH/DELETE JSON bodies carry this value.
  const epoch = useRef(0);
  const lock = useRef(false);
  const [choices, setChoices] = useState(EMPTY);
  const [choiceState, setChoiceState] = useState('locked');
  const choiceStateRef = useRef('locked');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [celebration, setCelebration] = useState(0);
  const scheduleRef = useRef(null);
  const checkedAtRef = useRef(0);

  const markChoices = useCallback(state => { choiceStateRef.current = state; setChoiceState(state); }, []);
  const lockChoices = useCallback(() => { keyRef.current = ''; setChoices(EMPTY); markChoices('locked'); }, [markChoices]);
  const signOut = useCallback((message = 'Signed out. Your session and voting key have been cleared.') => {
    epoch.current++; sessionRef.current = null; setSession(null); lockChoices();
    setNotice({ type: 'info', text: message });
  }, [lockChoices]);

  const loadCandidates = useCallback(async () => {
    setCandidateState('loading'); setCandidateError('');
    try { setCandidates(await api.candidates()); setCandidateState('ready'); }
    catch (e) { setCandidateState('error'); setCandidateError(e.message); }
  }, [api]);
  const loadSchedule = useCallback(async () => {
    try {
      const value = await api.settings();
      if (!value) throw new Error('The event schedule is unavailable.');
      scheduleRef.current = value; checkedAtRef.current = Date.now();
      setSchedule(value); setCheckedAt(checkedAtRef.current); setScheduleError('');
      return value;
    } catch (e) {
      checkedAtRef.current = 0; setCheckedAt(0); setScheduleError(e.message); return null;
    }
  }, [api]);
  const loadLanterns = useCallback(async () => {
    setLanternState('loading'); setLanternError('');
    try { setLanterns(await api.lanterns()); setLanternState('ready'); }
    catch (e) { setLanternState('error'); setLanternError(e.message); }
  }, [api]);
  useEffect(() => { loadCandidates(); loadSchedule(); loadLanterns(); }, [loadCandidates, loadSchedule, loadLanterns]);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(loadSchedule, 30000);
    const focus = () => { setNow(Date.now()); loadSchedule(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(clock); clearInterval(poll); window.removeEventListener('focus', focus); };
  }, [loadSchedule]);

  const fresh = checkedAt > 0 && now - checkedAt < 90000;
  const status = fresh ? scheduleState(schedule, now) : { registration: 'unknown', voting: 'unknown' };
  const statusRef = useRef(status); statusRef.current = status;
  const openNow = () => checkedAtRef.current > 0 && Date.now() - checkedAtRef.current < 90000 && scheduleState(scheduleRef.current).voting === 'open';

  // Selected identities disappear as soon as the period closes or its state is unknown.
  useEffect(() => { if (status.voting !== 'open') lockChoices(); }, [status.voting, lockChoices]);

  async function verifyAccount(generation = epoch.current) {
    const active = sessionRef.current;
    if (!active) return false;
    try {
      const user = await api.me(active.token);
      if (!user) throw new Error('Account status is unavailable.');
      if (generation !== epoch.current) return false;
      const updated = { ...active, user }; sessionRef.current = updated; setSession(updated); return true;
    } catch (e) {
      if (generation !== epoch.current) return false;
      if (e.status === 401) signOut('Your login has expired. Please sign in again.');
      else if (e.status === 403) signOut('This account is disabled or no longer permitted to vote.');
      else setNotice({ type: 'error', text: 'Account status could not be refreshed. Participation information may be out of date.' });
      return false;
    }
  }
  useEffect(() => {
    if (!session) return;
    const onFocus = () => { verifyAccount(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // Token determines which account is being checked; user flag updates do not rebind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  async function login(email, password) {
    const generation = ++epoch.current;
    const data = await api.login(email, password);
    if (generation !== epoch.current) return;
    if (!data?.token || !data?.user) throw new Error('The login response is incomplete.');
    lockChoices(); const next = { token: data.token, user: data.user };
    sessionRef.current = next; setSession(next); setNotice({ type: 'success', text: 'Welcome back. Enter your voting key to unlock your choices.' });
    await verifyAccount(generation);
  }
  async function register(email, password) {
    if (statusRef.current.registration !== 'open') throw new Error('Registration is not available right now. Please refresh the schedule.');
    const data = await api.register(email, password);
    if (!validKey(data?.votingKey)) throw new Error('Registration responded without a usable key. Do not register again; contact the event organisers.');
    return data;
  }

  async function readChoices(key, generation) {
    const active = sessionRef.current;
    if (!active || !openNow()) throw new Error('Saved choices can only be viewed while voting is open.');
    const votes = await api.myVotes(active.token, key);
    if (generation !== epoch.current || !openNow()) return false;
    setChoices(savedChoices(votes)); markChoices('ready');
    // Flags remain useful after the period closes, without revealing identities.
    const flags = { hasVotedKing: votes.some(v => v.contest === 'king'), hasVotedQueen: votes.some(v => v.contest === 'queen') };
    const updated = { ...active, user: { ...active.user, ...flags } };
    sessionRef.current = updated; setSession(updated);
    return true;
  }

  async function handleKeyError(error, generation) {
    if (generation !== epoch.current) return;
    // A key-related 401 does NOT itself invalidate the login. /auth/me decides that.
    if (error.status === 401 || error.status === 403) {
      lockChoices(); await verifyAccount(generation);
    }
  }
  async function unlock(key) {
    if (lock.current) return;
    if (!validKey(key)) throw new Error('Enter the complete 64-character lowercase voting key.');
    lock.current = true; setBusy(true); markChoices('loading');
    const generation = epoch.current;
    try {
      if (!await readChoices(key, generation)) throw new Error('The session or voting period changed. Please try again.');
      keyRef.current = key; setNotice(null);
    } catch (e) { if (generation === epoch.current) { markChoices('locked'); await handleKeyError(e, generation); } throw e; }
    finally { lock.current = false; setBusy(false); }
  }
  async function refreshChoices() {
    if (lock.current) return;
    if (!keyRef.current) { markChoices('locked'); return; }
    lock.current = true; setBusy(true); markChoices('loading');
    const generation = epoch.current;
    try {
      if (await readChoices(keyRef.current, generation)) setNotice({ type: 'info', text: 'Saved choices refreshed. Review them before making another change.' });
    } catch (e) {
      if (generation === epoch.current) { markChoices('uncertain'); setNotice({ type: 'error', text: e.message }); await handleKeyError(e, generation); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function mutate({ contest, candidate, action }) {
    if (lock.current) return false;
    if (!sessionRef.current || !keyRef.current || choiceStateRef.current !== 'ready' || !openNow()) {
      setNotice({ type: 'error', text: 'Unlock and refresh your choices during voting before continuing.' }); return false;
    }
    // Decide endpoint from verified choices, never from participation flags alone.
    const expected = action === 'remove' ? 'remove' : choices[contest] ? 'change' : 'submit';
    if (action !== expected || (action === 'remove' && !choices[contest])) {
      setNotice({ type: 'info', text: 'Your choices changed. Please review them and confirm again.' }); return false;
    }
    lock.current = true; setBusy(true);
    const generation = epoch.current; const token = sessionRef.current.token; const key = keyRef.current;
    try {
      if (action === 'remove') await api.remove(token, key, contest);
      else await api[action](token, key, candidate._id, contest);
      if (generation !== epoch.current) return false;
      markChoices('loading');
      const refreshed = await readChoices(key, generation);
      if (!refreshed) { lockChoices(); setNotice({ type: 'info', text: 'The server accepted the vote request. Voting has since closed; only account participation is now available.' }); await verifyAccount(generation); return true; }
      setNotice({ type: 'success', text: action === 'remove' ? `Your ${contest} choice has been removed.` : `Your ${contest} choice has been saved.` });
      if (action !== 'remove') setCelebration(Date.now());
      return true;
    } catch (e) {
      if (generation !== epoch.current) return false;
      // Never replay a mutation automatically. First obtain authoritative choices.
      markChoices('uncertain');
      setNotice({ type: 'error', text: `${e.message} Checking your saved choices before another attempt…` });
      try {
        if (await readChoices(key, generation)) {
          setNotice({ type: 'info', text: 'The request did not finish cleanly. Saved choices have been refreshed; review them before voting again.' });
        }
      } catch (readError) {
        if (generation === epoch.current) {
          markChoices('uncertain'); setNotice({ type: 'error', text: 'We could not verify your saved choices. Refresh them before making another change.' });
          await handleKeyError(readError, generation);
        }
      }
      await loadSchedule(); await verifyAccount(generation);
      return false;
    } finally { lock.current = false; setBusy(false); }
  }

  return { candidates, candidateState, candidateError, reloadCandidates: loadCandidates,
    lanterns, lanternState, lanternError, reloadLanterns: loadLanterns, schedule, scheduleError,
    status, reloadSchedule: loadSchedule, session, choices: status.voting === 'open' ? choices : EMPTY,
    choiceState, busy, notice, dismissNotice: () => setNotice(null), celebration,
    login, register, signOut, unlock, refreshChoices, mutate, lockChoices, verifyAccount };
}
