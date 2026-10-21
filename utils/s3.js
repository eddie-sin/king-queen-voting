const crypto = require("crypto");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
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
