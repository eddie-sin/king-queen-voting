import { useEffect, useRef, useState } from 'react';
import { request } from './api.js';
import Icon from './Icon.jsx';
import { AdminLoader, Spinner } from './Loader.jsx';
const LABELS = {
  'votes.read':'View candidate vote totals (manual refresh)','lantern.votes.read':'View Lantern vote totals (manual refresh)',
  'memory.open':'Open Memory feature','memory.close':'Close Memory feature','memory.approve':'Accept Memory Photos','memory.reject':'Reject Memory Photos',
  'lantern.open':'Open Lantern voting','lantern.close':'Close Lantern voting','lantern.announce':'Announce Lantern winner','lantern.hide':'Hide Lantern announcement',
  'candidates.create': 'Create candidates', 'candidates.update': 'Update candidates', 'candidates.delete': 'Delete candidates',
  'voting.open': 'Open voting', 'voting.close': 'Close voting', 'votes.clear': 'Clear all votes',
  'announcement.open': 'Open announcement', 'announcement.close': 'Close announcement',
  'registration.open': 'Open registration', 'registration.close': 'Close registration',
};
const blank = () => ({ username: '', password: '', status: 'active', permissions: [], role: 'voting_admin' });

function SparkleKeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
      <path d="M5 3v4" />
      <path d="M3 5h4" />
      <path d="M19 17v4" />
      <path d="M17 19h4" />
    </svg>
  );
}

function CopyIcon({ copied }) {
  return copied ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function generateStrongPassword() {
  const length = 16;
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?_-+=';
  const all = upper + lower + digits + symbols;

  const required = [];
  const getChars = (set, count) => {
    const vals = new Uint32Array(count);
    window.crypto.getRandomValues(vals);
    for (let i = 0; i < count; i++) {
      required.push(set[vals[i] % set.length]);
    }
  };

  getChars(upper, 3);
  getChars(lower, 3);
  getChars(digits, 3);
  getChars(symbols, 2);

  const remaining = length - required.length;
  const remVals = new Uint32Array(remaining);
  window.crypto.getRandomValues(remVals);
  for (let i = 0; i < remaining; i++) {
    required.push(all[remVals[i] % all.length]);
  }

  const shuffleVals = new Uint32Array(length);
  window.crypto.getRandomValues(shuffleVals);
  for (let i = length - 1; i > 0; i--) {
    const j = shuffleVals[i] % (i + 1);
    [required[i], required[j]] = [required[j], required[i]];
  }

  return required.join('');
}

function checkPasswordStrength(pwd) {
  if (!pwd) {
    return {
      level: 0,
      label: 'Too short',
      rules: { length: false, upperLower: false, number: false, symbol: false },
    };
  }
  const byteLength = new TextEncoder().encode(pwd).length;
  const validLength = pwd.length >= 15 && byteLength <= 72;
  const rules = {
    length: validLength,
    upperLower: /[a-z]/.test(pwd) && /[A-Z]/.test(pwd),
    number: /\d/.test(pwd),
    symbol: /[^A-Za-z0-9]/.test(pwd),
  };
  let score = 0;
  if (rules.length) score++;
  if (rules.upperLower) score++;
  if (rules.number) score++;
  if (rules.symbol) score++;

  let level = 0;
  let label = 'Weak';
  if (pwd.length < 15) {
    level = 0;
    label = 'Too short';
  } else if (byteLength > 72) {
    level = 0;
    label = 'Too long (max 72 bytes)';
  } else if (score <= 1) {
    level = 0;
    label = 'Weak';
  } else if (score === 2) {
    level = 1;
    label = 'Fair';
  } else if (score === 3) {
    level = 2;
    label = 'Good';
  } else {
    level = 3;
    label = 'Strong';
  }

  return { level, label, rules };
}

export default function StaffManager({ token, report, notify }) {
  const [showPassword,setShowPassword]=useState(false), [rolePermissions,setRolePermissions]=useState({});
  const [accounts, setAccounts] = useState([]), [permissions, setPermissions] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null), [form, setForm] = useState(blank), [remove, setRemove] = useState(null), [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  async function refresh() { setLoading(true); try { const data = await request('/admin/staff', { token }); setAccounts(data.admins); setPermissions(data.permissions);setRolePermissions(data.rolePermissions); setError(''); } catch (e) { setError(e.message); report(e); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, [token]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  function markCopied() {
    clearTimeout(copyTimer.current);
    setCopied(true);
    copyTimer.current = setTimeout(() => setCopied(false), 2600);
  }
  function handleGeneratePassword() {
    const generated = generateStrongPassword();
    setForm(current => ({ ...current, password: generated }));
    setShowPassword(true);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(generated).then(markCopied).catch(() => {});
    }
  }
  function handleCopyPassword() {
    if (!form.password || !navigator?.clipboard?.writeText) return;
    navigator.clipboard.writeText(form.password).then(markCopied).catch(() => {});
  }
  function edit(account) { clearTimeout(copyTimer.current); setCopied(false); setEditor(account?.id || 'new'); setForm(account ? { username: account.username, password: '', status: account.status, permissions: [...account.permissions], role: account.role } : blank()); setError('');setShowPassword(false); }
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true);
    try {
      const body = { role:form.role, username: form.username, status: form.status, permissions: form.permissions, ...(form.password ? { password: form.password } : {}) };
      await request(`/admin/staff${editor === 'new' ? '' : `/${editor}`}`, { token, method: editor === 'new' ? 'POST' : 'PATCH', body });
      clearTimeout(copyTimer.current); setCopied(false); setEditor(null); setForm(blank()); notify('Staff account saved. Permission changes apply to subsequent actions.'); await refresh();
    } catch (e) { setError(e.message); report(e); } finally { setBusy(false); }
  }
  async function deleteAccount() {
    if (busy) return; setBusy(true);
    try { await request(`/admin/staff/${remove.id}`, { token, method: 'DELETE' }); setRemove(null); notify('Staff account deleted.'); await refresh(); }
    catch (e) { setError(e.message); report(e); } finally { setBusy(false); }
  }
  const strength = checkPasswordStrength(form.password);
  return <div><div className="page-header"><div><p className="eyebrow">HIGHER ADMINISTRATOR</p><h1>Staff <em>accounts</em></h1><p className="muted">Create separate Voting, Memory and Lantern administrator accounts. Grant their control permissions individually.</p></div><button className="button primary" onClick={() => edit(null)}><Icon name="plus" size={17} />Create staff account</button></div>{error && <p className="message error" role="alert">{error}</p>}<section className="candidate-panel"><div className="panel-head"><h2>Staff accounts</h2><button className={`button secondary ${loading ? 'is-busy' : ''}`} onClick={refresh} disabled={loading}>{loading ? <><Spinner size={13} />Refreshing…</> : <><Icon name="refresh" size={14} />Refresh</>}</button></div>{loading ? <AdminLoader label="Loading staff accounts…" hint="Fetching authorized administrators and granted permissions" icon="users" /> : !accounts.length ? <p className="empty">No staff accounts yet.</p> : <div className="table-wrap"><table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Permissions</th><th>Actions</th></tr></thead><tbody>{accounts.map(account => <tr key={account.id}><td>{account.username}</td><td>{account.role.replaceAll('_',' ')}</td><td>{account.status}</td><td>{account.permissions.length} granted</td><td><div className="actions"><button className="button secondary" onClick={() => edit(account)}>Edit access</button><button className="button delete" onClick={() => setRemove(account)}>Delete</button></div></td></tr>)}</tbody></table></div>}</section>
    {editor && <div className="overlay center"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="staff-title"><h2 id="staff-title">{editor === 'new' ? 'Create staff account' : 'Edit staff account'}</h2><form onSubmit={save}><label className="field"><span>Role</span><select disabled={editor!=='new'} value={form.role} onChange={e=>setForm({...form,role:e.target.value,permissions:[]})}><option value="voting_admin">Voting admin</option><option value="memory_admin">Memory admin</option><option value="lantern_admin">Lantern admin</option></select></label><label className="field"><span>Username</span><input autoComplete="off" value={form.username} maxLength={100} required onChange={e => setForm({ ...form, username: e.target.value })}/></label><label className="field"><span>{editor === 'new' ? 'Password' : 'New password (leave blank to keep)'}</span><input type={showPassword?'text':'password'} autoComplete="new-password" value={form.password} minLength={15} required={editor === 'new'} placeholder={editor === 'new' ? 'Create a strong password (15+ chars)' : 'Leave blank to keep current password'} onChange={e => { setCopied(false); setForm({ ...form, password: e.target.value }); }}/></label><label className="show-password"><input type="checkbox" checked={showPassword} onChange={e=>setShowPassword(e.target.checked)}/> Show password</label>
      <div className="pw-tools">
        <div className="pw-generator-row">
          <button
            type="button"
            className="btn-strong-generator"
            onClick={handleGeneratePassword}
            disabled={busy}
            title="Generate a cryptographically secure 16-character password"
          >
            <SparkleKeyIcon />
            <span>Create strong password</span>
          </button>
          {form.password.length > 0 && (
            <button
              type="button"
              className={`btn-copy-password ${copied ? 'is-copied' : ''}`}
              onClick={handleCopyPassword}
              disabled={busy}
            >
              <CopyIcon copied={copied} />
              <span>{copied ? 'Copied!' : 'Copy password'}</span>
            </button>
          )}
        </div>
        {form.password.length > 0 && (
          <div className="pw-strength-meter" role="status" aria-live="polite">
            <div className="pw-strength-header">
              <span className="pw-strength-title">Password strength:</span>
              <span className={`pw-strength-label lvl-${strength.level}`}>
                {strength.label}
              </span>
            </div>
            <div className="pw-strength-bars" aria-hidden="true">
              {[0, 1, 2, 3].map(idx => (
                <div
                  key={idx}
                  className={`pw-strength-bar ${
                    idx <= strength.level ? `is-active lvl-${strength.level}` : ''
                  }`}
                />
              ))}
            </div>
            <div className="pw-strength-rules">
              <span className={`pw-rule-pill ${strength.rules.length ? 'is-met' : ''}`}>
                {strength.rules.length ? '✓' : '○'} 15+ chars
              </span>
              <span className={`pw-rule-pill ${strength.rules.upperLower ? 'is-met' : ''}`}>
                {strength.rules.upperLower ? '✓' : '○'} Upper &amp; lower
              </span>
              <span className={`pw-rule-pill ${strength.rules.number ? 'is-met' : ''}`}>
                {strength.rules.number ? '✓' : '○'} Number
              </span>
              <span className={`pw-rule-pill ${strength.rules.symbol ? 'is-met' : ''}`}>
                {strength.rules.symbol ? '✓' : '○'} Symbol
              </span>
            </div>
          </div>
        )}
      </div>
      <label className="field"><span>Account status</span><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="disabled">Disabled</option></select></label><fieldset className="permission-list"><legend>Allowed actions</legend>{(rolePermissions[form.role]||[]).map(permission => <label key={permission}><input type="checkbox" checked={form.permissions.includes(permission)} onChange={e => setForm({ ...form, permissions: e.target.checked ? [...form.permissions, permission] : form.permissions.filter(p => p !== permission) })}/>{LABELS[permission] || permission}</label>)}</fieldset><p className="small">Password resets, username changes and disabling the account revoke existing sessions.</p>{error && <p className="message error" role="alert">{error}</p>}<div className="drawer-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => { clearTimeout(copyTimer.current); setCopied(false); setEditor(null); setForm(blank()); }}>Cancel</button><button className={`button primary ${busy ? 'is-busy' : ''}`} disabled={busy}>{busy ? <><Spinner size={14} />Saving…</> : 'Save account'}</button></div></form></section></div>}
    {remove && <div className="overlay center"><section className="modal small-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-staff-title"><h2 id="delete-staff-title">Delete {remove.username}?</h2><p>This revokes the account’s access. Existing moderation and action records remain.</p><div className="drawer-actions"><button className="button secondary" disabled={busy} onClick={() => setRemove(null)}>Cancel</button><button className={`button delete ${busy ? 'is-busy' : ''}`} disabled={busy} onClick={deleteAccount}>{busy ? <><Spinner size={14} />Deleting…</> : 'Delete account'}</button></div></section></div>}
  </div>;
}
