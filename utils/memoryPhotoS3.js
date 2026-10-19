const {
  S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { MEMORY_PHOTO_KEY_PATTERN } = require("./memoryPhotoLocalStorage");

class MemoryPhotoStorageError extends Error {
  constructor(code, message) { super(message); this.name = "MemoryPhotoStorageError"; this.code = code; }
}

const fail = (code, message, cause) => {
  const error = new MemoryPhotoStorageError(code, message);
  if (cause) Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  return error;
};
const definitelyRejected = (error) => {
  const status = error?.$metadata?.httpStatusCode;
  return status === 400 || status === 401 || status === 403 || status === 412;
};

exports.createMemoryPhotoS3 = ({ client, bucket, region, presign = getSignedUrl, now = () => new Date() }) => {
  client ||= new S3Client({ region });
  const validate = (storageKey) => {
    if (!MEMORY_PHOTO_KEY_PATTERN.test(storageKey)) throw new MemoryPhotoStorageError("MEMORY_PHOTO_STORAGE_KEY_INVALID", "Invalid Memory Photo storage key.");
  };
  const head = async ({ storageKey }) => {
    validate(storageKey);
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey, ChecksumMode: "ENABLED" }));
      return {
        exists: true, contentType: result.ContentType, contentLength: result.ContentLength,
        sha256: result.ChecksumSHA256 ? Buffer.from(result.ChecksumSHA256, "base64").toString("hex") : null,
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return { exists: false };
      throw fail("MEMORY_PHOTO_STORAGE_READ_FAILED", "The private image state could not be verified.", error);
    }
  };
  return {
    async put({ storageKey, buffer, contentType, sha256 }) {
      validate(storageKey);
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket, Key: storageKey, Body: buffer, ContentType: contentType,
          ContentLength: buffer.length, ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
          CacheControl: "private, no-store", ServerSideEncryption: "AES256", IfNoneMatch: "*",
        }));
        return { stored: true, matchedExisting: false };
      } catch (error) {
        let existing;
        try { existing = await head({ storageKey }); } catch {
          throw fail("MEMORY_PHOTO_STORAGE_UNCERTAIN", "The private image upload outcome could not be verified.", error);
        }
        if (existing.exists && existing.sha256 === sha256 && existing.contentType === contentType && existing.contentLength === buffer.length) {
          return { stored: true, matchedExisting: true };
        }
        if (existing.exists) throw new MemoryPhotoStorageError("MEMORY_PHOTO_STORAGE_CONFLICT", "The immutable image key contains different or unverifiable content.");
        if (!definitelyRejected(error)) throw fail("MEMORY_PHOTO_STORAGE_UNCERTAIN", "The private image upload outcome could not be verified.", error);
        throw fail("MEMORY_PHOTO_STORAGE_WRITE_FAILED", "The private image could not be stored.", error);
      }
    },
    head,
    async delete({ storageKey }) {
      validate(storageKey);
      try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey })); return { deleted: true }; }
      catch (error) { throw fail("MEMORY_PHOTO_STORAGE_DELETE_FAILED", "The private image could not be deleted.", error); }
    },
    async list({ cursor } = {}) {
      let result;
      try { result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "memory-photos/v1/", ContinuationToken: cursor })); }
      catch (error) { throw fail("MEMORY_PHOTO_STORAGE_LIST_FAILED", "Private image objects could not be listed.", error); }
      return { objects: (result.Contents || []).map((object) => ({ storageKey: object.Key, lastModified: object.LastModified, size: object.Size })), cursor: result.NextContinuationToken };
    },
    async createReadGrant({ storageKey, expiresInSeconds }) {
      validate(storageKey);
      if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 900) {
        throw new MemoryPhotoStorageError("MEMORY_PHOTO_READ_TTL_INVALID", "Memory Photo read access must last between 60 and 900 seconds.");
      }
      let url;
      try { url = await presign(client, new GetObjectCommand({ Bucket: bucket, Key: storageKey, ResponseContentType: "image/webp", ResponseContentDisposition: "inline; filename=memory-photo.webp" }), { expiresIn: expiresInSeconds }); }
      catch (error) { throw fail("MEMORY_PHOTO_STORAGE_GRANT_FAILED", "Private image access could not be granted.", error); }
      return { kind: "url", url, expiresAt: new Date(now().getTime() + expiresInSeconds * 1000) };
    },
  };
};

exports.MemoryPhotoStorageError = MemoryPhotoStorageError;
