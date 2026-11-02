# Planner bot API

Bots poll their own creative jobs and deliver assets back. They do not publish, and they do not see the rest of the desk.

## Auth

Set the Worker secret `PLANNER_BOT_TOKENS` to a JSON object. Keys are bot names. Values are tokens. Do not commit the JSON.

```json
{
  "eleanor": "…",
  "frances": "…",
  "ansel": "…",
  "steve": "…",
  "lance": "…"
}
```

| Bot name | Jobs they can see |
| --- | --- |
| `eleanor` | Eleanor, design / look |
| `frances` | Frances, copy / captions |
| `ansel` | Ansel, photo and video edit |
| `steve` | Steve, video |
| `lance` | Lance, shoot |

Send the token as `Authorization: Bearer <token>`. A bot token is rejected on every other planner route.

`PLANNER_PIN` and `PLANNER_TOKEN` still open the whole desk for a person.

## List jobs

```http
GET /api/planner/jobs?assignee=Frances
Authorization: Bearer <frances token>
```

`assignee` must match the token. Omit it and the list is still only that bot’s jobs. A person with the PIN can omit it and see every job, or pass any assignee.

```json
{
  "ok": true,
  "assignee": "Frances",
  "jobs": [
    {
      "id": "…",
      "briefId": "…",
      "role": "copy",
      "assignee": "Frances",
      "title": "SAMPLE — copy / captions for the red coupe",
      "status": "requested",
      "dueOn": "2026-11-08",
      "captionDraft": "",
      "assetUrls": [],
      "blockedBy": ["need: reel · SAMPLE red coupe"]
    }
  ]
}
```

`blockedBy` is empty when the shoot assets for that post are already in the library. Do not start a blocked creative job. Shoot jobs are not blocked by assets. They are how the assets get made.

Status moves `requested` → `in_progress` → `delivered` → `approved`.

## Deliver

```http
POST /api/planner/jobs/<id>/deliver
Authorization: Bearer <token>
Content-Type: application/json

{
  "assetUrls": ["https://example.com/sample-frame.jpg"],
  "captionDraft": "SAMPLE caption.",
  "note": "First pass."
}
```

The job must be assigned to the token’s person. The response is the job with `status: "delivered"`.

A shoot delivery is also written into the asset library, which closes the matching photo or reel need and unblocks the creative jobs on that brief.

When every creative job on a brief is delivered, the brief lands in Lance’s approval queue. His approve is what can queue a PostEngine draft. Bots cannot approve and cannot call PostEngine.

Asset URLs must be `http`, `https`, or a `sample://` fixture link.
