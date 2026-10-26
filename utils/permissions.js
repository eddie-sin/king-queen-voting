exports.ROLE_PERMISSIONS = Object.freeze({
  voting_admin: ['votes.read','candidates.create','candidates.update','candidates.delete','voting.open','voting.close','votes.clear','announcement.open','announcement.close','registration.open','registration.close'],
  memory_admin: ['memory.open','memory.close','memory.approve','memory.reject','memory.delete'],
  lantern_admin: ['lantern.votes.read','lantern.open','lantern.close','lantern.announce','lantern.hide'],
});
exports.PERMISSIONS = Object.freeze(Object.values(exports.ROLE_PERMISSIONS).flat());
exports.can = (account, permission) => account?.status === 'active' && (account.role === 'admin' ||
  Object.hasOwn(exports.ROLE_PERMISSIONS, account.role) && (!permission ||
    permission === 'candidates.read' && account.role === 'voting_admin' ||
    permission === 'memory.read' && account.role === 'memory_admin' ||
    permission === 'lantern.manage' && account.role === 'lantern_admin' ||
    exports.ROLE_PERMISSIONS[account.role].includes(permission) && account.permissions.includes(permission)));
exports.staffResponse = account => ({id:String(account._id),username:account.username,role:account.role,status:account.status,
  permissions:account.role==='admin'?[...exports.PERMISSIONS]:account.permissions});
