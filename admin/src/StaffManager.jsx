import { useEffect, useState } from 'react';
import { request } from './api.js';
const LABELS = {
  'candidates.create': 'Create candidates', 'candidates.update': 'Update candidates', 'candidates.delete': 'Delete candidates',
  'voting.open': 'Open voting', 'voting.close': 'Close voting', 'votes.clear': 'Clear all votes',
  'announcement.open': 'Open announcement', 'announcement.close': 'Close announcement',
  'registration.open': 'Open registration', 'registration.close': 'Close registration',
};
const blank = () => ({ username: '', password: '', status: 'active', permissions: [] });
export default function StaffManager({ token, report, notify }) {
  const [accounts, setAccounts] = useState([]), [permissions, setPermissions] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null), [form, setForm] = useState(blank), [remove, setRemove] = useState(null), [error, setError] = useState('');
  async function refresh() { setLoading(true); try { const data = await request('/admin/voting-admins', { token }); setAccounts(data.admins); setPermissions(data.permissions); setError(''); } catch (e) { setError(e.message); report(e); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, [token]);
  function edit(account) { setEditor(account?.id || 'new'); setForm(account ? { username: account.username, password: '', status: account.status, permissions: [...account.permissions] } : blank()); setError(''); }
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true);
    try {
      const body = { username: form.username, status: form.status, permissions: form.permissions, ...(form.password ? { password: form.password } : {}) };
      await request(`/admin/voting-admins${editor === 'new' ? '' : `/${editor}`}`, { token, method: editor === 'new' ? 'POST' : 'PATCH', body });
      setEditor(null); setForm(blank()); notify('Voting administrator saved. Permission changes apply to subsequent actions.'); await refresh();
    } catch (e) { setError(e.message); report(e); } finally { setBusy(false); }
  }
  async function deleteAccount() {
    if (busy) return; setBusy(true);
    try { await request(`/admin/voting-admins/${remove.id}`, { token, method: 'DELETE' }); setRemove(null); notify('Voting administrator deleted.'); await refresh(); }
    catch (e) { setError(e.message); report(e); } finally { setBusy(false); }
  }
  return <div><div className="page-header"><div><p className="eyebrow">HIGHER ADMINISTRATOR</p><h1>Voting <em>administrators</em></h1><p className="muted">Reading candidates is always available. Grant each other action separately.</p></div><button className="button primary" onClick={() => edit(null)}>Create voting admin</button></div>{error && <p className="message error" role="alert">{error}</p>}<section className="candidate-panel"><div className="panel-head"><h2>Staff accounts</h2><button className="button secondary" onClick={refresh} disabled={loading}>Refresh</button></div>{loading ? <p className="empty">Loading staff…</p> : !accounts.length ? <p className="empty">No voting administrators yet.</p> : <div className="table-wrap"><table><thead><tr><th>Username</th><th>Status</th><th>Permissions</th><th>Actions</th></tr></thead><tbody>{accounts.map(account => <tr key={account.id}><td>{account.username}</td><td>{account.status}</td><td>{account.permissions.length} granted</td><td><div className="actions"><button className="button secondary" onClick={() => edit(account)}>Edit access</button><button className="button delete" onClick={() => setRemove(account)}>Delete</button></div></td></tr>)}</tbody></table></div>}</section>
    {editor && <div className="overlay center"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="staff-title"><h2 id="staff-title">{editor === 'new' ? 'Create voting administrator' : 'Edit voting administrator'}</h2><form onSubmit={save}><label className="field"><span>Username</span><input autoComplete="off" value={form.username} maxLength={100} required onChange={e => setForm({ ...form, username: e.target.value })}/></label><label className="field"><span>{editor === 'new' ? 'Password' : 'New password (leave blank to keep)'}</span><input type="password" autoComplete="new-password" value={form.password} minLength={8} required={editor === 'new'} onChange={e => setForm({ ...form, password: e.target.value })}/></label><label className="field"><span>Account status</span><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="disabled">Disabled</option></select></label><fieldset className="permission-list"><legend>Allowed actions</legend>{permissions.map(permission => <label key={permission}><input type="checkbox" checked={form.permissions.includes(permission)} onChange={e => setForm({ ...form, permissions: e.target.checked ? [...form.permissions, permission] : form.permissions.filter(p => p !== permission) })}/>{LABELS[permission] || permission}</label>)}</fieldset><p className="small">Password resets, username changes and disabling the account revoke existing sessions.</p>{error && <p className="message error" role="alert">{error}</p>}<div className="drawer-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => { setEditor(null); setForm(blank()); }}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button></div></form></section></div>}
    {remove && <div className="overlay center"><section className="modal small-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-staff-title"><h2 id="delete-staff-title">Delete {remove.username}?</h2><p>This revokes the account’s access. Existing moderation and action records remain.</p><div className="drawer-actions"><button className="button secondary" disabled={busy} onClick={() => setRemove(null)}>Cancel</button><button className="button delete" disabled={busy} onClick={deleteAccount}>{busy ? 'Deleting…' : 'Delete account'}</button></div></section></div>}
  </div>;
}
