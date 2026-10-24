exports.PERMISSIONS = Object.freeze([
  'candidates.create', 'candidates.update', 'candidates.delete',
  'voting.open', 'voting.close', 'votes.clear',
  'announcement.open', 'announcement.close', 'registration.open', 'registration.close',
]);
exports.can = (account, permission) => account?.status === 'active'
  && (account.role === 'admin' || (account.role === 'voting_admin'
    && (!permission || exports.PERMISSIONS.includes(permission) && account.permissions.includes(permission))));
exports.staffResponse = account => ({
  id: String(account._id), username: account.username, role: account.role, status: account.status,
  permissions: account.role === 'admin' ? [...exports.PERMISSIONS] : account.permissions,
});
