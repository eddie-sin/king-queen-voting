const mongoose = require('mongoose');
const Admin = require('../model/adminsModel');
const Controls = require('../model/eventControlsModel');
const Ballot = require('../model/ballotsModel');
const User = require('../model/usersModel');
const Action = require('../model/adminActionsModel');
const Wish = require('../model/wishesModel');
const MemoryPhotoLike = require('../model/memoryPhotoLikesModel');
const passwords = require('./passwords');
const { withControls } = require('./eventControls');
const admission = require('./voteAdmission');
exports.seed = async () => {
  if (typeof process.env.JWT_SECRET !== 'string' || Buffer.byteLength(process.env.JWT_SECRET) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes.');
  require('./accounts/config').validate();
  const db = mongoose.connection.db;
  if (await db.collection('users').findOne({ $or: [{emailKey:{$exists:false}},{emailVerifiedAt:{$exists:false}}] })) throw new Error('Student test accounts need the explicit auth reset. No data was changed.');
  // Read-only guard BEFORE initialization: never reinterpret the old application's database.
  const legacy = await db.collection('elections').findOne({});
  const oldBallot = await db.collection('ballots').findOne({ credential: { $exists: true } });
  const oldAdmin = await db.collection('admins').findOne({ role: { $nin: ['admin', 'voting_admin', 'memory_admin', 'lantern_admin'] } });
  const oldUser = await db.collection('users').findOne({ credentialIssued: { $exists: true } });
  if (legacy || oldBallot || oldAdmin || oldUser) throw new Error('Legacy test database detected. Select a separate empty v2 database; no data was migrated or deleted.');
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('Manual voting requires a MongoDB replica set for transactions. Use an isolated replica set locally or a compatible Atlas database.');
  let indexes = [];
  try { indexes = await db.collection('ballots').indexes(); } catch (error) { if (error.code !== 26) throw error; }
  if (indexes.some(index => index.key.credential)) throw new Error('Incompatible legacy ballot index. Use a clean v2 database.');
  // Connection autoCreate/autoIndex are disabled so the guard above is read-only.
  // Include the existing Memory Photo models and their ownership/quota indexes.
  await Promise.all(Object.values(mongoose.models).map(async model => {
    await model.createCollection();
    await model.createIndexes();
  }));
  if (!(await Admin.exists({ role: 'admin' }))) {
    const username = passwords.username(process.env.ADMIN_USERNAME);
    passwords.validateStaffPassword(process.env.ADMIN_PASSWORD);
    const existing = await Admin.exists({ username });
    if (existing) throw new Error('Configured administrator username is already in use by another staff account.');
    await Admin.create({ username, passwordHash: await passwords.hash(process.env.ADMIN_PASSWORD), role: 'admin' });
  }
  await Controls.updateOne({ _id: 'event' }, { $setOnInsert: { schemaVersion: 2 } }, { upsert: true, runValidators: true });
  // An unexpected restart never resumes an interrupted open window automatically.
  await withControls(async ({ controls }) => {
    if (controls.lanternVotingOpen) { controls.lanternVotingOpen=false; controls.revision++; }
    if (controls.votingStatus !== 'closed') { controls.votingStatus = 'closed'; controls.revision++; }
  });
  admission.close();
};
