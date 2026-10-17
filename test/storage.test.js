const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const directory = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "king-queen-storage-test-"));
process.env.LOCAL_UPLOAD_DIR = directory;
const storage = require("../utils/imageStorage");
const file = { buffer: Buffer.from("test-image-content"), mimetype: "image/png" };

after(() => fs.rm(directory, { recursive: true, force: true }));

test("development saves image files locally without S3 configuration or calls", async () => {
  process.env.NODE_ENV = "development";
  delete process.env.AWS_REGION;
  delete process.env.AWS_S3_BUCKET;
  const originalSend = S3Client.prototype.send;
  S3Client.prototype.send = () => { throw Error("Development must not call S3"); };
  try {
    const url = await storage.uploadImage(file, "candidates");
    assert.match(url, /^\/uploads\/candidates\/[a-f0-9-]+\.png$/);
    const bytes = await fs.readFile(path.join(directory, url.slice("/uploads/".length)));
    assert.deepEqual(bytes, file.buffer);
    const second = await storage.uploadImage(file, "candidates");
    assert.notEqual(url, second);
  } finally { S3Client.prototype.send = originalSend; }
});

test("production writes to S3 and returns its public URL without saving locally", async () => {
  process.env.NODE_ENV = "production";
  process.env.AWS_REGION = "ap-southeast-1";
  process.env.AWS_S3_BUCKET = "test-voting-images";
  delete process.env.AWS_S3_PUBLIC_URL;
  const before = await fs.readdir(directory, { recursive: true });
  const originalSend = S3Client.prototype.send;
  const commands = [];
  S3Client.prototype.send = async function (command) { commands.push(command); return {}; };
  try {
    const url = await storage.uploadImage(file, "gallery/memory");
    assert.match(url, /^https:\/\/test-voting-images\.s3\.ap-southeast-1\.amazonaws\.com\/gallery\/memory\/[a-f0-9-]+\.png$/);
    assert(commands[0] instanceof PutObjectCommand);
    assert.equal(commands[0].input.Bucket, "test-voting-images");
    assert.equal(commands[0].input.ContentType, "image/png");
    assert.deepEqual(commands[0].input.Body, file.buffer);
    assert.deepEqual(await fs.readdir(directory, { recursive: true }), before);

    process.env.AWS_S3_PUBLIC_URL = "https://images.example.com/";
    assert.match(await storage.uploadImage(file, "candidates"), /^https:\/\/images\.example\.com\/candidates\//);
  } finally { S3Client.prototype.send = originalSend; }
});

test("production does not silently fall back to local files when S3 settings are missing", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.AWS_S3_BUCKET;
  await assert.rejects(storage.uploadImage(file, "candidates"), { statusCode: 503 });
});

test("image storage rejects unsupported formats and paths outside the allowed image folders", async () => {
  process.env.NODE_ENV = "development";
  for (const folder of ["../outside", "gallery/../../outside", "gallery/unknown", "/absolute"]) {
    await assert.rejects(storage.uploadImage(file, folder), { statusCode: 400 });
  }
  await assert.rejects(storage.uploadImage({ ...file, mimetype: "text/html" }, "candidates"), { statusCode: 400 });
});
