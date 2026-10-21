# Memory Photo likes

`POST /api/v1/memory-photos/:id/like` ensures the active authenticated User has
liked the photo. `DELETE` on the same path removes only that user's like. Both
require an active User Bearer JWT, `memoryPhotosEnabled === true`, and an APPROVED
photo. Admin JWTs are rejected. Do not supply a request body or query parameters;
the user identity comes only from authentication middleware.

Both methods are idempotent and return HTTP 200, including repeated requests:

```json
{
  "status": "success",
  "data": { "photoId": "<photo ID>", "liked": true, "likeCount": 1 }
}
```

DELETE returns `liked: false`. `liked` describes the requested operation's result;
an overlapping later operation can change the state again. Counts are queried
from stored records after the operation and can likewise change as requests
continue. No user identities or private image information are returned.

The existing unique compound index on photoId/userId enforces one like per pair.
Startup builds the index before accepting traffic; mutation handlers also await
model initialization. Concurrent duplicate upserts return the same successful
outcome. DELETE filters on both photo and authenticated user and is harmless if
the like is absent. Distinct users may each like the same photo; there is no
separate denormalized count to increment or decrement.

Malformed IDs and body/query fields return 400. Missing or unapproved photos
return 404. Missing/invalid user authentication returns 401; disabled accounts,
admin tokens and disabled feature requests return 403. Feature and approval are
checked per request; existing likes remain intact while the feature is disabled.

The public paginated gallery now includes `likeCount` (zero if none), aggregated
only for its page of approved photos. Individual likers are never exposed.
Like operations do not change photos, moderation, files, or upload quota records.
Comments, dislikes and frontend behavior are not implemented.
