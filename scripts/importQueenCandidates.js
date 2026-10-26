const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', 'config.env') });
const root = path.resolve(__dirname, '..', 'Candidates', 'Queen Candidates');
const candidates = [
  {
    folder: "Candidate1",
    fullName: "Suyati Linn",
    batchNumber: "Guf 97",
    age: 18,
    photos: ["photo_2026-10-19_09-56-02.jpg", "photo_2026-10-18_23-45-41.jpg", "photo_2026-10-18_23-45-41 (2).jpg"],
  },
  {
    folder: "Candidate2",
    fullName: "Ei Thwel Shin Thant",
    age: 14,
    photos: ["photo_2026-10-18_23-46-22.jpg", "photo_2026-10-18_23-46-23.jpg", "photo_2026-10-18_23-46-23 (2).jpg"],
  },
  {
    folder: "Candidate3",
    fullName: "Thiri San",
    nickname: "Jel",
    batchNumber: "Batch 6",
    age: 20,
    zodiacSign: "Capricorn",
    bio: "A friendly and cheerful person who enjoys spreading positivity and creating happy memories",
    hobbiesAndInterests: ["Traveling"],
    photos: ["photo_2026-10-18_23-47-13.jpg", "photo_2026-10-18_23-47-13 (2).jpg", "photo_2026-10-18_23-47-14.jpg"],
  },
  {
    folder: "Candidate4",
    fullName: "Kyal Sin San",
    batchNumber: "Guf 98",
    age: 18,
    photos: ["photo_2026-10-18_23-47-46.jpg", "photo_2026-10-18_23-47-47.jpg", "photo_2026-10-18_23-47-47 (2).jpg"],
  },
];

async function main() {
  const base = new URL(process.env.IMPORT_API_URL || `http://127.0.0.1:${process.env.PORT || 5000}`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('Candidate import is local-only. IMPORT_API_URL must point to the local API.');
  const call = async (endpoint, { token, method = 'GET', body } = {}) => {
    const multipart = body instanceof FormData;
    const response = await fetch(new URL(`/api/v1${endpoint}`, base), { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
    const json = await response.json();
    if (!response.ok) throw new Error(`Candidate import rejected: ${json.message || response.status}`);
    return json.data;
  };
  const login = await call('/auth/admin/login', { method: 'POST', body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } });
  const token = login.token;
  const existing = (await call('/admin/candidates', { token })).candidates;
  for (const candidate of candidates) {
    const { folder, photos, ...profile } = candidate;
    const previous = existing.find(c => c.fullName === profile.fullName && c.category === 'queen');
    const body = new FormData();
    body.append('data', JSON.stringify({ ...profile, category: 'queen', isActive: true,
      ...(previous ? { photoLayout: photos.map((_, index) => ({ upload: index })) } : {}) }));
    for (const filename of photos) {
      const bytes = await fs.readFile(path.join(root, folder, filename));
      body.append('images', new Blob([bytes], { type: 'image/jpeg' }), filename);
    }
    await call(`/candidates${previous ? `/${previous._id}` : ''}`, { token, method: previous ? 'PATCH' : 'POST', body });
  }
  console.log(`Imported ${candidates.length} Queen candidates through guarded API routes.`);
}
main().catch(() => {
  console.error('Candidate import could not finish. Confirm the local API is running, credentials are valid, voting is closed and announcement is hidden. Refresh candidates before retrying a partial import.');
  process.exitCode = 1;
});
