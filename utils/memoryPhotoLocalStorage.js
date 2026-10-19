const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const keyPattern = /^memory-photos\/v1\/[0-9a-f-]{36}\.webp$/;
const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

class MemoryPhotoLocalStorageError extends Error {
  constructor(code, message) { super(message); this.name = "MemoryPhotoLocalStorageError"; this.code = code; }
}

const sanitized = (code, message, error) => {
  const result = new MemoryPhotoLocalStorageError(code, message);
  Object.defineProperty(result, "cause", { value: error, enumerable: false });
  return result;
};

exports.createMemoryPhotoLocalStorage = ({ directory, signingSecret, now = () => new Date() }) => {
  const root = path.resolve(directory);
  const target = (storageKey) => {
    if (!keyPattern.test(storageKey)) throw new Error("Invalid Memory Photo storage key.");
    const result = path.resolve(root, ...storageKey.split("/"));
    if (!result.startsWith(`${root}${path.sep}`)) throw new Error("Invalid Memory Photo storage path.");
    return result;
  };
  const safeTarget = async (storageKey) => {
    const filename = target(storageKey);
    const relative = path.relative(root, filename).split(path.sep);
    let current = root;
    for (const part of ["", ...relative.slice(0, -1)]) {
      if (part) current = path.join(current, part);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw Object.assign(new Error("Unsafe private storage path."), { code: "MEMORY_PHOTO_LOCAL_PATH_UNSAFE" });
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
    }
    return filename;
  };
  const head = async ({ storageKey }) => {
    try {
      const buffer = await fs.readFile(await safeTarget(storageKey));
      return { exists: true, contentType: "image/webp", contentLength: buffer.length, sha256: digest(buffer) };
    } catch (error) {
      if (error.code === "ENOENT") return { exists: false };
      throw error;
    }
  };
  return {
    async put({ storageKey, buffer, sha256 }) {
      if (!Buffer.isBuffer(buffer) || digest(buffer) !== sha256) throw new Error("Memory Photo checksum mismatch.");
      const filename = await safeTarget(storageKey);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, buffer, { flag: "wx" });
        await fs.link(temporary, filename);
        return { stored: true, matchedExisting: false };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await head({ storageKey });
        if (existing.exists && existing.sha256 === sha256) return { stored: true, matchedExisting: true };
        const conflict = new Error("An immutable Memory Photo key already contains different content.");
        conflict.code = "MEMORY_PHOTO_STORAGE_CONFLICT";
        throw conflict;
      } finally {
        await fs.rm(temporary, { force: true });
      }
    },
    head,
    async delete({ storageKey }) {
      try { await fs.unlink(await safeTarget(storageKey)); return { deleted: true }; } catch (error) {
        if (error.code === "ENOENT") return { deleted: false };
        throw error;
      }
    },
    async list() {
      const base = path.join(root, "memory-photos", "v1");
      try {
        await safeTarget(`memory-photos/v1/${crypto.randomUUID()}.webp`);
        const entries = await fs.readdir(base, { withFileTypes: true });
        return { objects: await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
          const storageKey = `memory-photos/v1/${entry.name}`;
          const stat = await fs.stat(path.join(base, entry.name));
          return { storageKey, lastModified: stat.mtime, size: stat.size };
        })) };
      } catch (error) { if (error.code === "ENOENT") return { objects: [] }; throw error; }
    },
    async createReadGrant({ storageKey, expiresInSeconds }) {
      target(storageKey);
      if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 900) throw new Error("Memory Photo read access must last between 60 and 900 seconds.");
      const payload = Buffer.from(JSON.stringify({ k: storageKey, e: now().getTime() + expiresInSeconds * 1000 })).toString("base64url");
      const signature = crypto.createHmac("sha256", signingSecret).update(payload).digest("base64url");
      return { kind: "local", token: `${payload}.${signature}`, expiresAt: new Date(now().getTime() + expiresInSeconds * 1000) };
    },
    async readGrant({ token }) {
      const [payload, signature, extra] = String(token).split(".");
      if (!payload || !signature || extra) throw new Error("Invalid local Memory Photo grant.");
      const expected = crypto.createHmac("sha256", signingSecret).update(payload).digest();
      let supplied;
      try { supplied = Buffer.from(signature, "base64url"); } catch { throw new Error("Invalid local Memory Photo grant."); }
      if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error("Invalid local Memory Photo grant.");
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (data.e <= now().getTime()) throw new Error("Local Memory Photo grant has expired.");
      const filename = await safeTarget(data.k);
      const stat = await fs.stat(filename);
      return { stream: require("node:fs").createReadStream(filename), contentType: "image/webp", contentLength: stat.size };
    },
  };
};

const originalFactory = exports.createMemoryPhotoLocalStorage;
exports.createMemoryPhotoLocalStorage = (options) => {
  const provider = originalFactory(options);
  const wrap = (name, code) => {
    const operation = provider[name];
    provider[name] = async (...args) => {
      try { return await operation(...args); } catch (error) {
        if (error instanceof MemoryPhotoLocalStorageError || error?.code?.startsWith("MEMORY_PHOTO_")) throw error;
        throw sanitized(code, "Private local Memory Photo storage operation failed.", error);
      }
    };
  };
  wrap("put", "MEMORY_PHOTO_LOCAL_WRITE_FAILED");
  wrap("head", "MEMORY_PHOTO_LOCAL_READ_FAILED");
  wrap("delete", "MEMORY_PHOTO_LOCAL_DELETE_FAILED");
  wrap("list", "MEMORY_PHOTO_LOCAL_LIST_FAILED");
  wrap("createReadGrant", "MEMORY_PHOTO_LOCAL_GRANT_FAILED");
  wrap("readGrant", "MEMORY_PHOTO_LOCAL_GRANT_INVALID");
  return provider;
};

exports.MEMORY_PHOTO_KEY_PATTERN = keyPattern;
exports.MemoryPhotoLocalStorageError = MemoryPhotoLocalStorageError;
