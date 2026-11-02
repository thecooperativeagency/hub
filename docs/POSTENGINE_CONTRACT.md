# PostEngine import contract

Read from `thecooperativeagency/postengine` at `server/routes.ts` and `shared/schema.ts`.

## What exists today

`POST /api/posts` creates a row through `insertPostSchema`. The post table default status is `draft`. Allowed statuses in the schema comment are `draft`, `queued`, `scheduled`, `published`, and `rejected`. Fields the insert accepts include `dealershipId`, `status`, `postType`, `vehicleInfo`, `caption`, `captionFacebook`, `captionGmb`, `hashtags`, `ctaBlock`, `mediaUrls` (JSON text), `mediaType`, `platforms` (JSON text), `scheduledFor`, `publishedAt`, `folderSource`, and `notes`.

That route has no admin token and no import token. The same file also has:

- `POST /api/posts/:id/publish`, which sets the post to `scheduled` and calls `publishPost`
- `POST /api/posts/bulk-approve`, which sets posts to `scheduled`

`GET /api/posts` in this file does not check `x-dashboard-pin`. The live desk already sends that header, so production may not match this file. The planner will not assume an unauthenticated create is safe for an outside caller.

## What the planner will call

Only when `PLANNER_PE_WRITE=1`. The default is `0`, and the Worker then does not call PostEngine at all on approve.

```http
POST https://postengine.thecoopbrla.com/api/import/posts
Authorization: Bearer <POSTENGINE_IMPORT_TOKEN>
Content-Type: application/json
```

The host is fixed. `POSTENGINE_URL` cannot point the Worker at another host.

Body, using the existing post fields:

| Field | Planner sends |
| --- | --- |
| `dealershipId` | PostEngine id already on the store: 1 BMW of Jackson, 2 Brian Harris BMW, 3 Audi Baton Rouge, 4 Harris Porsche, 6 Coop |
| `status` | `queued` only. The server must reject `scheduled`, `published`, and any publish flag |
| `postType` | `inventory` |
| `vehicleInfo` | The brief subject |
| `caption` | Frances’s caption draft, or the brief caption |
| `mediaUrls` | JSON array of delivered asset URLs |
| `mediaType` | `video` when the brief needs a reel, otherwise `image` |
| `platforms` | JSON array of the brief’s channels |
| `scheduledFor` | The brief date at 15:00 UTC |
| `notes` | `planner:<brief id>` |

Do not accept `publishedAt`. Do not archive a Drive file. Do not call the publisher.

Response `201`:

```json
{ "id": 440, "status": "queued" }
```

The planner stores `id` and later reads `GET /api/posts` (with `x-dashboard-pin`, as it already does). `draft`, `queued`, and `scheduled` show on the calendar as queued. `published` shows as published.

Until this route exists, leave `PLANNER_PE_WRITE` at `0`. Approving a brief records the yes and stops there.
