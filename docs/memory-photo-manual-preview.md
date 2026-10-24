# Local Memory Photo preview

This setup uses the existing `npm run dev` scripts, a separate loopback MongoDB process on port 27028, database `memory_manual_preview`, and private local images. It never loads `config.env`. An isolated preload rejects AWS helper calls. No existing MongoDB service or data is used.

## Start or restart

From the repository root, in PowerShell:

```powershell
node scripts/memoryPhotoPreview.cjs
```

Keep that terminal open. MongoDB 8.3 is expected at `C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe`; set `MONGOD_BINARY` to another installed executable if necessary. Ports 5502, 5573 and 27028 must be free; occupied ports cause setup to stop without disturbing other services. Existing dependencies must already be installed in the root and frontend directories.

The launcher runs the actual backend and frontend development scripts. It generates a full administrator through startup seeding, registers a student through `/auth/register`, and provisions a Memory Admin through the full-admin API. It enables Memory Photo via `PATCH /admin/settings`. On restart it reuses only its own disposable local accounts and refreshes their JWTs (12-hour lifetime).

## Preview URLs

- All Memories: http://127.0.0.1:5573/#memory-gallery
- My Memories: http://127.0.0.1:5573/#my-memories
- Upload Studio: http://127.0.0.1:5573/#memory-upload
- Student login: http://127.0.0.1:5573/#account
- Backend: http://127.0.0.1:5502/api/v1

The gallery is initially empty. Use the generated student's email and password from the ignored local file `frontend/test-artifacts/manual-preview/accounts.private.json` to log in through Account. Do not share that file or copy its contents into reports. ADMIN and MEMORY_ADMIN use the existing admin login API, not student login.

## Postman

Import these files locally:

1. `postman/Memory-Photo.preview.postman_collection.json`
2. `frontend/test-artifacts/manual-preview/Memory-Photo.preview.private.postman_environment.json`

Select the disposable preview environment. It includes generated account credentials and JWTs as local-only values; passwords and JWTs are marked secret. **Do not sync, export, commit, screenshot or log these populated values.** Masking does not encrypt the file. Do not enable request/response logging or share the Postman Console. Login responses necessarily contain JWTs, and registration responses contain a one-time voting key.

Run requests individually in order. The launcher has already provisioned the moderator, so this collection reuses its login without provisioning a duplicate. The canonical 76-request collection remains unchanged; do not run it blindly for manual preview.

1. Admin, student and moderator login: **200**. Tests chain tokens into run-local variables; the private environment also supports individual Send operations.
2. Admin enables Memory Photo: **200**; public settings: **200**, enabled true.
3. Student upload: multipart field `images`, exactly one PNG/JPEG/WebP, at most 5 MB. In Postman select `postman/fixtures/memory-photo.png` manually if its relative path does not resolve. Do not set multipart Content-Type yourself. Expect **201**, `data.photo.id`, `status: PENDING`, `createdAt`. Copy that ID into the local `photo_id` environment variable when using individual Send operations; collection-run scripts chain it automatically.
4. My Memories: **200**, `data.photos` contains pending submission; `data.quota` is `{limit:3,acceptedCount:1,remainingSlots:2}` for the first upload. Refresh the React tab to see its sealed envelope.
5. Moderator pending queue and private image: **200**. Student access: **403**; anonymous private review image: **401**. Public pending image: **404**.
6. Moderator approval: **200**, status APPROVED. Repeated review: **409**. To test rejection, upload a second image and review with `{"status":"REJECTED"}` instead; its lifetime quota remains consumed and public image returns **404**.
7. Anonymous gallery and approved image: **200**. React displays approved images through Express, never private storage keys.
8. Like and repeat like: **200**, one like. Batch like-status: **200**, `{status:"success",results:1,data:{photos:[{photoId,liked:true}]}}`. Refresh the React gallery to verify the heart state. Unlike and repeat unlike: **200**, zero likes. Public metadata exposes `likeCount` without identities.
9. The collection checks student/anonymous moderation denial and MEMORY_ADMIN settings/provisioning denial (**403** for authenticated wrong roles). Admin retains settings access.
10. After three accepted uploads, a fourth returns **409**. Rejected photos still count. Use only this disposable student's three slots.
11. Disable with full admin: **200**. Public gallery, public image, My Memories, upload, like-status and likes then return **403**; moderator review remains available (**200**).

If a JWT expires, rerun its login and update the private local token variable, or restart the launcher. Browser and Postman sessions are independent.

## Stop and cleanup

First disable the feature using the final Postman toggle request. In another terminal:

```powershell
node scripts/memoryPhotoPreview.cjs stop
```

Wait for `frontend/test-artifacts/manual-preview/stopped.json` containing `stopped:true`. The owning launcher stops only the process trees it created. Data is preserved for inspection/restart. If the launcher was closed unexpectedly, verify its recorded PIDs and actual command lines before stopping any remaining processes; do not kill arbitrary Node/MongoDB services.

After all three preview services have stopped, optionally delete **only** the resolved directory `C:/UOS-13/Voting/king-queen-voting/frontend/test-artifacts/manual-preview`. It contains this preview's entire MongoDB data, images, generated accounts, tokens, logs and preload. Never delete the project's other artifact directories or existing database paths. Restarting afterward generates fresh accounts and quota slots.

AWS browser verification remains deferred. This local preview establishes no current AWS privacy guarantees.
