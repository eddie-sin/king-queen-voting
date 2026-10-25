import { useCallback, useEffect, useRef, useState } from 'react';
import { announcementState, eventState, savedChoices } from '../domain.js';
const EMPTY = { king: null, queen: null };
import {readStoredSession,writeStoredSession,announceAccountChange} from '../authSession.js';
export {readStoredSession,writeStoredSession} from '../authSession.js';
export function useFestival(api) {
  const [candidates, setCandidates] = useState([]), [candidateState, setCandidateState] = useState('loading'), [candidateError, setCandidateError] = useState('');
  const [lanterns, setLanterns] = useState([]), [lanternState, setLanternState] = useState('loading'), [lanternError, setLanternError] = useState('');
  const [controls, setControls] = useState(null), [controlsError, setControlsError] = useState(''), [checkedAt, setCheckedAt] = useState(0), [now, setNow] = useState(Date.now());
  const [session, setSession] = useState(readStoredSession), [choices, setChoices] = useState(EMPTY), [choiceState, setChoiceState] = useState('loading');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(null), [celebration, setCelebration] = useState(0);
  const [results, setResults] = useState(null), [resultsLoad, setResultsLoad] = useState('idle'), [resultsError, setResultsError] = useState('');
  const current = useRef({ controls: null, checkedAt: 0, session, choices: EMPTY, choiceState: 'loading', results: null });
  const epoch = useRef(0), locked = useRef(false), mounted = useRef(true), statusSequence = useRef(0), accountSequence = useRef(0), resultSequence = useRef(0);
  const updateSession = useCallback(next => { current.current.session = next; setSession(next); writeStoredSession(next); }, []);
  const markChoices = state => { current.current.choiceState = state; setChoiceState(state); };
  const clearChoices = () => { current.current.choices = EMPTY; setChoices(EMPTY); markChoices('loading'); };
  const signOut = useCallback(async (message = 'Signed out.') => {
    try { await api.logout?.(); } catch { setNotice({type:'error',text:'Sign-out could not be confirmed. Check your connection and retry.'}); return; }
    window.google?.accounts?.id?.disableAutoSelect(); announceAccountChange();
    epoch.current++; accountSequence.current++; current.current.choices = EMPTY; current.current.choiceState = 'loading';
    updateSession(null); setChoices(EMPTY); setChoiceState('loading'); setNotice({ type: 'info', text: message });
  }, [api, updateSession]);
  const loadCandidates = useCallback(async () => {
    setCandidateState('loading');
    try { const value = await api.candidates(); if (mounted.current) { setCandidates(value); setCandidateState('ready'); setCandidateError(''); } }
    catch (error) { if (mounted.current) { setCandidateState('error'); setCandidateError(error.message); } }
  }, [api]);
  const loadLanterns = useCallback(async () => {
    setLanternState('loading');
    try { const value = await api.lanterns(); if (mounted.current) { setLanterns(value); setLanternState('ready'); setLanternError(''); } }
    catch (error) { if (mounted.current) { setLanternState('error'); setLanternError(error.message); } }
  }, [api]);
  const refreshChoices = useCallback(async () => {
    const active = current.current.session;
    if (!active) return false;
    const generation = epoch.current, sequence = ++accountSequence.current;
    try {
      const [user, data] = await Promise.all([api.me(active.token), api.myVotes(active.token)]);
      if (!mounted.current || generation !== epoch.current || sequence !== accountSequence.current) return false;
      if (!user || !data || !Number.isSafeInteger(data.round) || user.round !== data.round) throw new Error('Account state changed. Refresh your choices.');
      const controlsNow = current.current.controls;
      if (controlsNow && data.round !== controlsNow.round) throw new Error('Votes were reset. Refresh your choices.');
      const selected = savedChoices(data.votes);
      current.current.choices = selected; setChoices(selected); markChoices('ready');
      updateSession({ ...active, user: { ...user, hasVotedKing: Boolean(selected.king), hasVotedQueen: Boolean(selected.queen) } });
      return true;
    } catch (error) {
      if (!mounted.current || generation !== epoch.current || sequence !== accountSequence.current) return false;
      if ([401, 403].includes(error.status)) signOut('Your account session ended. Please sign in again.');
      else { markChoices('uncertain'); setNotice({ type: 'error', text: error.message }); }
      return false;
    }
  }, [api, signOut, updateSession]);
  const loadResults = useCallback(async () => {
    const snapshot = current.current.controls;
    const sequence = ++resultSequence.current;
    if (announcementState(snapshot) !== 'announced') { current.current.results = null; setResults(null); setResultsLoad('idle'); return; }
    setResultsLoad('loading'); setResultsError('');
    try {
      const value = await api.results();
      if (!mounted.current || sequence !== resultSequence.current) return;
      const latest = current.current.controls;
      if (announcementState(latest) !== 'announced' || value.round !== latest.round || value.revision !== latest.revision) return;
      current.current.results = value; setResults(value); setResultsLoad('ready');
    } catch (error) {
      if (!mounted.current || sequence !== resultSequence.current) return;
      current.current.results = null; setResults(null); setResultsLoad(error.status === 403 ? 'pending' : 'error'); setResultsError(error.message);
    }
  }, [api]);
  const loadControls = useCallback(async () => {
    const sequence = ++statusSequence.current;
    try {
      const value = await api.settings();
      if (!value || eventState(value).voting === 'unknown' || !Number.isSafeInteger(value.round) || !Number.isSafeInteger(value.window)) throw new Error('Event status is unavailable.');
      if (!mounted.current || sequence !== statusSequence.current) return null;
      const before = current.current.controls;
      current.current.controls = value; current.current.checkedAt = Date.now();
      setControls(value); setCheckedAt(current.current.checkedAt); setControlsError(''); setNow(Date.now());
      if (before && before.round !== value.round) { clearChoices(); await refreshChoices(); }
      else if (before && (before.window !== value.window || before.votingStatus !== value.votingStatus)) await refreshChoices();
      if (before && before.candidateManagementLocked && !value.candidateManagementLocked || before && before.window !== value.window) loadCandidates();
      if (announcementState(value) !== 'announced') {
        resultSequence.current++; current.current.results = null; setResults(null); setResultsLoad('idle');
      } else if (!current.current.results || current.current.results.revision !== value.revision) loadResults();
      return value;
    } catch (error) {
      if (mounted.current && sequence === statusSequence.current) {
        current.current.checkedAt = 0; setCheckedAt(0); setControlsError(error.message);
        resultSequence.current++; current.current.results = null; setResults(null); setResultsLoad('idle');
      }
      return null;
    }
  }, [api, refreshChoices, loadCandidates, loadResults]);
  useEffect(() => {
    mounted.current = true;
    loadCandidates(); loadLanterns(); loadControls();
    restoreSession();
    let timer, stopped = false;
    const poll = async () => {
      await loadControls();
      if (!stopped) timer = setTimeout(poll, document.hidden ? 30000 : 4500 + Math.random() * 1000);
    };
    timer = setTimeout(poll, 5000);
    const focus = () => { loadControls(); restoreSession(); };
    const external = event => { if(event.key==='festival-account-change') restoreSession(); };
    const sync = () => {
      const next = readStoredSession();
      if (next?.token !== current.current.session?.token) {
        epoch.current++; accountSequence.current++; current.current.session = next; setSession(next); clearChoices();
        if (next) refreshChoices();
      }
    };
    const clock = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('focus', focus); window.addEventListener('storage', external); window.addEventListener('festival-session-change', sync);
    return () => { stopped = true; mounted.current = false; statusSequence.current++; resultSequence.current++; accountSequence.current++; clearTimeout(timer); clearInterval(clock); window.removeEventListener('focus', focus); window.removeEventListener('storage', external); window.removeEventListener('festival-session-change', sync); };
  }, [loadCandidates, loadLanterns, loadControls, refreshChoices]);
  async function restoreSession() {
    const generation=epoch.current;
    try {
      const data=api.session?await api.session():null;
      if(!mounted.current||generation!==epoch.current)return;
      if(data?.sessionKey&&data.user){
        if(current.current.session?.token!==data.sessionKey){epoch.current++;clearChoices();}
        updateSession({token:data.sessionKey,user:data.user}); await refreshChoices();
      }
    } catch(error) { if([401,403].includes(error.status)&&generation===epoch.current){epoch.current++;updateSession(null);clearChoices();} }
  }
  async function acceptLogin(data) {
    if(!data?.user||!(data.sessionKey||data.token))throw new Error('The sign-in response is incomplete.');
    epoch.current++;clearChoices();updateSession({token:data.sessionKey||data.token,user:data.user});announceAccountChange();
    setNotice({type:'success',text:'Welcome to the celebration.'});await refreshChoices();
  }
  async function login(email,password){await acceptLogin(await api.login(email,password));}
  async function register(email, password, operationId) {
    if (!current.current.controls?.registrationOpen) throw new Error('Registration is closed.');
    return api.register(email, password, operationId);
  }
  async function mutate({ contest, candidate }) {
    if (locked.current) return false;
    const snapshot = current.current.controls, active = current.current.session;
    if (!active || current.current.choiceState !== 'ready' || !snapshot || eventState(snapshot).voting !== 'open'
      || Date.now() - current.current.checkedAt > 15000 || current.current.choices[contest]) {
      setNotice({ type: 'info', text: 'Refresh your account and voting status before voting. Each category allows one vote.' }); return false;
    }
    locked.current = true; setBusy(true);
    const generation = epoch.current;
    try {
      await api.submit(active.token, candidate._id, contest, snapshot);
      if (!mounted.current || generation !== epoch.current) return false;
      const confirmed = await refreshChoices();
      if (confirmed) { setNotice({ type: 'success', text: `Your ${contest} vote is recorded.` }); setCelebration(Date.now()); }
      else setNotice({ type: 'info', text: 'The server accepted your vote. Refresh your choices to check its status.' });
      return true;
    } catch (error) {
      if (!mounted.current || generation !== epoch.current) return false;
      markChoices('uncertain'); setNotice({ type: 'info', text: `${error.message} Checking whether your vote was recorded…` });
      await loadControls();
      const checked = await refreshChoices();
      if (generation !== epoch.current || !mounted.current) return false;
      const recorded = checked && current.current.choices[contest]?._id === candidate._id;
      setNotice({ type: recorded ? 'success' : 'error', text: recorded ? 'Your vote is recorded.' : checked ? `${error.message} Your saved choices are up to date.` : 'We could not confirm the outcome. Refresh your choices before trying again.' });
      return Boolean(recorded);
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const fresh = checkedAt > 0 && now - checkedAt < 15000;
  return { candidates, candidateState, candidateError, reloadCandidates: loadCandidates,
    lanterns, lanternState, lanternError, reloadLanterns: loadLanterns, controls, controlsError,
    status: fresh ? eventState(controls) : { registration: 'unknown', voting: 'unknown' }, reloadControls: loadControls,
    resultsStage: fresh ? announcementState(controls) : 'unknown', results: fresh ? results : null, resultsLoad, resultsError, reloadResults: loadResults,
    session, choices, choiceState, busy, notice, celebration, dismissNotice: () => setNotice(null),
    login, register, acceptLogin, signOut, refreshChoices, mutate };
}
