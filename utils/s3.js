const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const AppError = require("./appError");

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

let client;

const getClient = () => {
  if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) {
    throw new AppError("Production image storage requires AWS_REGION and AWS_S3_BUCKET.", 503);
  }
  client ||= new S3Client({ region: process.env.AWS_REGION });
  return client;
};

// Public address of the bucket; upload URLs and delete lookups must agree on it.
const publicBase = () => (
  process.env.AWS_S3_PUBLIC_URL ||
  `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
).replace(/\/$/, "");

// Uploads one in-memory file and returns its public URL.
// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in config.env.
exports.uploadImage = async (file, folder) => {
  const s3 = getClient();
  const key = `${folder}/${crypto.randomUUID()}.${EXTENSIONS[file.mimetype]}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  return `${publicBase()}/${key}`;
};

// Returns the object key for a URL in this app's bucket, or null for any other URL.
exports.keyFromUrl = (url) => {
  if (typeof url !== "string" || !process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) return null;
  const prefix = `${publicBase()}/`;
  if (!url.startsWith(prefix)) return null;
  try { return decodeURIComponent(url.slice(prefix.length)); } catch { return null; }
};

// Permanently removes one object. Needs s3:DeleteObject permission for the key.
exports.deleteImage = async (key) => {
  await getClient().send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }));
};

// Private operations never issue a public URL. Sharing a bucket requires an
// explicit deployment opt-in AND an independently secured memory-photos prefix.
// Callers validate the opaque key first.
const privateStorage = () => {
  if (!process.env.AWS_REGION || !process.env.AWS_MEMORY_PHOTO_BUCKET) {
    throw new AppError("Private image storage requires AWS_REGION and AWS_MEMORY_PHOTO_BUCKET.", 503);
  }
  const shared = process.env.MEMORY_PHOTO_ALLOW_SHARED_BUCKET;
  if (shared !== undefined && !["true", "false"].includes(shared)) {
    throw new AppError("MEMORY_PHOTO_ALLOW_SHARED_BUCKET must be true or false.", 503);
  }
  if (process.env.AWS_MEMORY_PHOTO_BUCKET === process.env.AWS_S3_BUCKET && shared !== "true") {
    throw new AppError("Memory Photo storage must use a separate private bucket.", 503);
  }
  client ||= new S3Client({ region: process.env.AWS_REGION });
  return { Bucket: process.env.AWS_MEMORY_PHOTO_BUCKET };
};

exports.uploadPrivateMemoryPhoto = async (file, key) => {
  await clientSend(new PutObjectCommand({
    ...privateStorage(), Key: key, Body: file.buffer, ContentType: file.mimetype,
    CacheControl: "private, no-store",
    // Omit ACL: compatible with bucket-owner-enforced buckets; no public grant.
  }));
};

const clientSend = (command) => client.send(command);

exports.getPrivateMemoryPhoto = async (key) => {
  try {
    const result = await clientSend(new GetObjectCommand({ ...privateStorage(), Key: key }));
    return { body: result.Body, contentType: result.ContentType, contentLength: result.ContentLength };
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      throw new AppError("Memory Photo image not found.", 404);
    }
    throw error;
  }
};

exports.deletePrivateMemoryPhoto = async (key) => {
  await clientSend(new DeleteObjectCommand({ ...privateStorage(), Key: key }));
};
