const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const AppError = require("./appError");

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

let client;

// Uploads one in-memory file and returns its public URL.
// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in config.env.
exports.uploadImage = async (file, folder) => {
  if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) {
    throw new AppError("Production image storage requires AWS_REGION and AWS_S3_BUCKET.", 503);
  }
  client ||= new S3Client({ region: process.env.AWS_REGION });
  const key = `${folder}/${crypto.randomUUID()}.${EXTENSIONS[file.mimetype]}`;

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  const base =
    process.env.AWS_S3_PUBLIC_URL ||
    `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;

  return `${base.replace(/\/$/, "")}/${key}`;
};
