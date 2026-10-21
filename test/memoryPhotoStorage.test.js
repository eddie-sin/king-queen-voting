const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Readable } = require("node:stream");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const directory = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "memory-photo-storage-"));
process.env.LOCAL_UPLOAD_DIR = path.join(directory, "public");
process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(directory, "private");
const storage = require("../utils/memoryPhotoStorage");
const publicStorage = require("../utils/imageStorage");
const file = { buffer: Buffer.from("test-image-bytes"), mimetype: "image/png" };
const keyPattern = /^memory-photos\/[0-9a-f-]+\.png$/;

after(() => fs.rm(directory, { recursive: true, force: true }));

test("local Memory Photo storage returns opaque keys and supports retrieval and idempotent cleanup", async () => {
  process.env.NODE_ENV = "test";
  const original = S3Client.prototype.send;
  S3Client.prototype.send = () => { throw Error("Local storage must not call AWS"); };
  try {
    const key = await storage.uploadImage(file);
    assert.match(key, keyPattern);
    assert.notEqual(await storage.uploadImage(file), key);
    const result = await storage.getImage(key);
    assert.deepEqual(result, { body: file.buffer, contentType: "image/png", contentLength: file.buffer.length });
    assert.deepEqual(await fs.readFile(path.join(directory, "private", key)), file.buffer);
    await storage.deleteImage(key);
    await storage.deleteImage(key);
    await assert.rejects(storage.getImage(key), { statusCode: 404 });
  } finally { S3Client.prototype.send = original; }
});

test("existing public uploads remain accessible while private images cannot be fetched through /uploads", async () => {
  process.env.NODE_ENV = "test";
  const key = await storage.uploadImage(file);
  const publicUrl = await publicStorage.uploadImage(file, "gallery/memory");
  const app = require("../app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}${publicUrl}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), file.buffer);
    for (const url of [`/uploads/${key}`, `/uploads/private/${key}`, `/private-memory-photos/${key}`,
      `/uploads/%2e%2e%2fprivate%2f${key}`]) {
      const hidden = await fetch(`${base}${url}`);
      assert.equal(hidden.status, 404);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("private storage rejects invalid files and keys before accessing local files or S3", async () => {
  for (const mode of ["test", "production"]) {
    process.env.NODE_ENV = mode;
    for (const invalid of [null, { ...file, mimetype: "text/html" }, { ...file, mimetype: "toString" },
      { ...file, buffer: "not a buffer" }, { ...file, buffer: Buffer.alloc(0) },
      { ...file, buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }]) {
      await assert.rejects(storage.uploadImage(invalid), { statusCode: 400 });
    }
    for (const key of [null, "", "../outside.png", "memory-photos/../../outside.png",
      "memory-photos\\outside.png", "/absolute.png", "https://example.com/a.png",
      "gallery/memory/example.png", "memory-photos/%2e%2e.png", "memory-photos/example.png"]) {
      await assert.rejects(storage.getImage(key), { statusCode: 400 });
      await assert.rejects(storage.deleteImage(key), { statusCode: 400 });
    }
  }
});

test("private local configuration cannot place images inside public uploads", async () => {
  process.env.NODE_ENV = "test";
  const modulePath = require.resolve("../utils/memoryPhotoStorage");
  try {
    for (const location of [process.env.LOCAL_UPLOAD_DIR, path.join(process.env.LOCAL_UPLOAD_DIR, "private")]) {
      process.env.MEMORY_PHOTO_UPLOAD_DIR = location;
      delete require.cache[modulePath];
      const unsafeStorage = require(modulePath);
      await assert.rejects(unsafeStorage.uploadImage(file), { statusCode: 503 });
    }
  } finally {
    process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(directory, "private");
    delete require.cache[modulePath];
  }
});

test("local retrieval preserves all supported image content types", async () => {
  process.env.NODE_ENV = "test";
  for (const mimetype of ["image/jpeg", "image/png", "image/webp"]) {
    const key = await storage.uploadImage({ ...file, mimetype });
    assert.equal((await storage.getImage(key)).contentType, mimetype);
    await storage.deleteImage(key);
  }
});

test("resolved directory links cannot redirect private writes into public uploads", async () => {
  process.env.NODE_ENV = "test";
  const linkedRoot = path.join(directory, "linked-private");
  await fs.symlink(process.env.LOCAL_UPLOAD_DIR, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  const modulePath = require.resolve("../utils/memoryPhotoStorage");
  try {
    process.env.MEMORY_PHOTO_UPLOAD_DIR = linkedRoot;
    delete require.cache[modulePath];
    await assert.rejects(require(modulePath).uploadImage(file), { statusCode: 503 });
  } finally {
    process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(directory, "private");
    delete require.cache[modulePath];
    await fs.unlink(linkedRoot);
  }
});

test("production uses a dedicated private bucket and returns bytes rather than public URLs", async () => {
  process.env.NODE_ENV = "production";
  process.env.AWS_REGION = "ap-southeast-1";
  process.env.AWS_MEMORY_PHOTO_BUCKET = "test-private-memory-photos";
  process.env.AWS_S3_BUCKET = "test-public-gallery";
  process.env.AWS_S3_PUBLIC_URL = "https://public.example.com";
  const original = S3Client.prototype.send;
  const commands = [];
  const body = Readable.from([file.buffer]);
  const before = await fs.readdir(directory, { recursive: true });
  S3Client.prototype.send = async (command) => {
    commands.push(command);
    return command instanceof GetObjectCommand
      ? { Body: body, ContentType: "image/png", ContentLength: file.buffer.length } : {};
  };
  try {
    const key = await storage.uploadImage(file);
    assert.match(key, keyPattern);
    assert(commands[0] instanceof PutObjectCommand);
    assert.equal(commands[0].input.Bucket, "test-private-memory-photos");
    assert.equal(commands[0].input.Key, key);
    assert.equal(commands[0].input.ACL, undefined);
    assert.equal(commands[0].input.GrantRead, undefined);
    assert.equal(commands[0].input.CacheControl, "private, no-store");
    assert.deepEqual(commands[0].input.Body, file.buffer);
    assert.equal(commands[0].input.ContentType, file.mimetype);
    const result = await storage.getImage(key);
    assert.equal(result.body, body);
    assert.equal(result.contentType, file.mimetype);
    assert.equal(result.contentLength, file.buffer.length);
    assert(commands[1] instanceof GetObjectCommand);
    await storage.deleteImage(key);
    await storage.deleteImage(key);
    assert(commands[2] instanceof DeleteObjectCommand);
    assert(commands[3] instanceof DeleteObjectCommand);
    assert(commands.every((command) => command.input.Key === key && command.input.Bucket === "test-private-memory-photos"));
    assert.deepEqual(await fs.readdir(directory, { recursive: true }), before);
  } finally { S3Client.prototype.send = original; }
});

test("production fails closed without private configuration and propagates storage failures", async () => {
  process.env.NODE_ENV = "production";
  const key = "memory-photos/12345678-1234-4234-8234-123456789abc.png";
  delete process.env.AWS_MEMORY_PHOTO_BUCKET;
  for (const action of [() => storage.uploadImage(file), () => storage.getImage(key), () => storage.deleteImage(key)]) {
    await assert.rejects(action(), { statusCode: 503 });
  }
  process.env.AWS_MEMORY_PHOTO_BUCKET = "test-private-memory-photos";
  const original = S3Client.prototype.send;
  try {
    process.env.AWS_MEMORY_PHOTO_BUCKET = process.env.AWS_S3_BUCKET;
    await assert.rejects(storage.uploadImage(file), { statusCode: 503 });
    process.env.AWS_MEMORY_PHOTO_BUCKET = "test-private-memory-photos";
    const failure = Object.assign(new Error("Storage denied"), { name: "AccessDenied" });
    S3Client.prototype.send = async () => { throw failure; };
    for (const action of [() => storage.uploadImage(file), () => storage.getImage(key), () => storage.deleteImage(key)]) {
      await assert.rejects(action(), (error) => error === failure);
    }
    S3Client.prototype.send = async () => { throw Object.assign(new Error("Missing"), { name: "NoSuchKey" }); };
    await assert.rejects(storage.getImage(key), { statusCode: 404 });
  } finally { S3Client.prototype.send = original; }
});
