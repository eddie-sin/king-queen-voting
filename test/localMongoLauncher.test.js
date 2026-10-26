const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { configuration, mongodArguments, samePath, validateOwnedOptions } = require('../scripts/localMongo.cjs');

test('Windows configuration honors isolated port, directory, replica set and custom binary', () => {
  const config = configuration({
    LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local', KQV_MONGO_PORT: '27191',
    KQV_MONGO_DBPATH: 'C:\\kqv-preview\\mongo', KQV_MONGO_REPLICA_SET: 'kqvWindows',
    MONGOD_BINARY: 'C:\\MongoDB\\mongod.exe',
  }, 'win32');
  assert.equal(config.port, 27191);
  assert.equal(config.replicaSet, 'kqvWindows');
  assert.equal(config.binary, 'C:\\MongoDB\\mongod.exe');
  assert.equal(config.directory, path.resolve('C:\\kqv-preview\\mongo'));
  assert.equal(config.uri, 'mongodb://127.0.0.1:27191/?directConnection=true');
});

test('native Windows arguments never use mongod --fork while Unix behavior is preserved', () => {
  const config = configuration({ KQV_MONGO_PORT: '27192', KQV_MONGO_DBPATH: './tmp-mongo' }, 'win32');
  assert.equal(mongodArguments(config, 'win32').includes('--fork'), false);
  assert.equal(mongodArguments(config, 'linux').at(-1), '--fork');
  assert.deepEqual(mongodArguments(config, 'win32').slice(0, 6), ['--bind_ip', '127.0.0.1', '--port', '27192', '--replSet', 'kqvLocal']);
});

test('invalid ports and replica-set names fail before any process launch', () => {
  assert.throws(() => configuration({ KQV_MONGO_PORT: '27017x' }), /KQV_MONGO_PORT/);
  assert.throws(() => configuration({ KQV_MONGO_PORT: '80' }), /KQV_MONGO_PORT/);
  assert.throws(() => configuration({ KQV_MONGO_REPLICA_SET: 'bad set!' }), /KQV_MONGO_REPLICA_SET/);
});

test('ownership validation accepts only the configured path, port and replica set', () => {
  const config = configuration({ KQV_MONGO_PORT: '27193', KQV_MONGO_DBPATH: './owned-mongo', KQV_MONGO_REPLICA_SET: 'ownedSet' });
  const options = { parsed: { storage: { dbPath: config.directory }, net: { port: config.port }, replication: { replSetName: config.replicaSet } } };
  assert.doesNotThrow(() => validateOwnedOptions(options, config));
  assert.doesNotThrow(() => validateOwnedOptions({ parsed: { ...options.parsed, replication: { replSet: config.replicaSet } } }, config));
  assert.throws(() => validateOwnedOptions({ parsed: { ...options.parsed, storage: { dbPath: path.resolve('./other-mongo') } } }, config), /not this project's isolated server/);
  assert.throws(() => validateOwnedOptions({ parsed: { ...options.parsed, net: { port: 27194 } } }, config), /different MongoDB startup settings/);
  assert.throws(() => validateOwnedOptions({ parsed: { ...options.parsed, replication: { replSetName: 'otherSet' } } }, config), /different MongoDB startup settings/);
});

test('Windows path ownership comparison is case-insensitive only on Windows', () => {
  assert.equal(samePath('C:\\KQV\\Mongo', 'c:\\kqv\\mongo', 'win32'), true);
  assert.equal(samePath('/var/KQV', '/var/kqv', 'linux'), false);
});
