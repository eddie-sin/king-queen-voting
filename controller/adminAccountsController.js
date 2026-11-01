const mongoose = require('mongoose');
const Admin = require('../model/adminsModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const passwords = require('../utils/passwords');
const { PERMISSIONS, ROLE_PERMISSIONS, staffResponse } = require('../utils/permissions');
const { staffMutation, audit } = require('../utils/eventControls');
function fields(body, create) {
  if (!body || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(k => !['username', 'password', 'permissions', 'status', 'role'].includes(k))) throw new AppError('Only username, password, permissions and status are editable.', 400);
  const updates = {};
  if (create || body.username !== undefined) updates.username = passwords.username(body.username);
  if (create || body.password !== undefined) passwords.validateStaffPassword(body.password);
  if (body.status !== undefined) {
    if (!['active', 'disabled'].includes(body.status)) throw new AppError('Invalid account status.', 400);
    updates.status = body.status;
  }
  if (body.permissions !== undefined) {
    if (!Array.isArray(body.permissions) || body.permissions.some(p => !PERMISSIONS.includes(p)) || new Set(body.permissions).size !== body.permissions.length) throw new AppError('Invalid permission list.', 400);
    updates.permissions = body.permissions;
  }
  return updates;
}
exports.list = catchAsync(async (req, res) => {
  const accounts = await Admin.find({ role: { $in: Object.keys(ROLE_PERMISSIONS) } }).sort({ username: 1 }).limit(1000);
  res.json({ status: 'success', data: { admins: accounts.map(staffResponse), permissions: PERMISSIONS, rolePermissions: ROLE_PERMISSIONS } });
});
exports.create = catchAsync(async (req, res) => {
  const updates = fields(req.body, true);
  const role = req.body.role || 'voting_admin';
  if (!Object.hasOwn(ROLE_PERMISSIONS, role) || updates.permissions?.some(p => !ROLE_PERMISSIONS[role].includes(p))) throw new AppError('Invalid role or permissions for this role.', 400);
  updates.passwordHash = await passwords.hash(req.body.password);
  const account = await staffMutation(req, 'admin', async ({ session, actor }) => {
    const created = (await Admin.create([{ ...updates, role }], { session }))[0];
    await audit(session, actor, 'staff.create', { accountId: String(created._id), username: created.username });
    return created;
  });
  res.status(201).json({ status: 'success', data: { admin: staffResponse(account) } });
});
exports.update = catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new AppError('Invalid account ID.', 400);
  const updates = fields(req.body, false);
  if (req.body.password !== undefined) updates.passwordHash = await passwords.hash(req.body.password);
  const account = await staffMutation(req, 'admin', async ({ session, actor }) => {
    const target = await Admin.findOne({ _id: req.params.id, role: { $in: Object.keys(ROLE_PERMISSIONS) } }).session(session);
    if (!target) throw new AppError('Staff account not found.', 404);
    if (req.body.role && req.body.role !== target.role || updates.permissions?.some(p => !ROLE_PERMISSIONS[target.role].includes(p))) throw new AppError('Roles cannot be changed; permissions must belong to this role.', 400);
    const revoke = updates.passwordHash || updates.status === 'disabled' || updates.username && updates.username !== target.username;
    Object.assign(target, updates);
    if (revoke) target.tokenVersion++;
    await target.save({ session });
    await audit(session, actor, 'staff.update', { accountId: String(target._id), fields: Object.keys(req.body) });
    return target;
  });
  res.json({ status: 'success', data: { admin: staffResponse(account) } });
});
exports.remove = catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new AppError('Invalid account ID.', 400);
  await staffMutation(req, 'admin', async ({ session, actor }) => {
    const target = await Admin.findOneAndDelete({ _id: req.params.id, role: { $in: Object.keys(ROLE_PERMISSIONS) } }).session(session);
    if (!target) throw new AppError('Staff account not found.', 404);
    await audit(session, actor, 'staff.delete', { accountId: String(target._id), username: target.username });
  });
  res.json({ status: 'success', data: {} });
});
