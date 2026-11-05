# Coop Operator Hub

Static desk for The Cooperative Agency. GitHub Pages serves it at [hub.thecoopbrla.com](https://hub.thecoopbrla.com). Merging to `main` publishes the site, so that merge needs the owner's OK.

This repository is public. Do not commit client work, approval items, task lists, keys, or tokens. Sample planner rows are fictional and marked `SAMPLE`.

## Marketing planner

`planner.html` is the planning desk: posting health, a month and week content calendar, Lance's shoot schedule, the monthly brand-program rollout, events and sponsorship decisions, tasks by owner, and Lance's approval queue. It is linked from the hub index. The page is a static shell. Real rows live in the Worker.

The desk uses the public site's type and palette (Instrument Serif, Helvetica, `#e8e8e8` / black / white) and the hub's operator voice. It does not publish anything.

### Why a new Worker

`workers/whiteboard-sync` stores one JSON board in KV and guards writes with bearer tokens plus a revision check. That fits a single document. The planner is many rows — calendar items, ten rollout steps per store, shoots, events, tasks, approvals — edited one at a time and filtered by month, owner, and status. Putting that in the whiteboard key would rewrite the whole board on every save and mix two auth schemes.

`workers/planner-api` is a separate Worker with a D1 database (`DB`). D1 gives bound SQL for each create, update, and delete. The Worker also creates the tables on boot (`CREATE TABLE IF NOT EXISTS`) so a missed migration does not 500, and the SQL file in `migrations/` is what you apply before real use. Tests compare those two copies.

### Auth

Same idea as the whiteboard: a shared secret, compared with a length check and a constant-time compare. Never logged.

| Secret | Use |
| --- | --- |
| `PLANNER_PIN` | Desk PIN. The page sends it as `X-Planner-Pin` and `Authorization: Bearer`. |
| `PLANNER_TOKEN` | Bearer token for a script. |

If neither secret is set, the API is in **open fixture mode** and says so. Do not put real client work there. The PIN should be long. The route is on the public internet. `PLANNER_NOW` freezes the clock for tests. Do not set it in production.

`GET /api/planner/healthz` returns `{ "ok": true }` and no rows, with no PIN.

### The quarter, then the work

The desk is planned a quarter at a time. Each store has a theme for the quarter and for each month, the program, the events that fall in those months, and a target number of posts per channel. **Roll to the next quarter** copies the last plan forward. **From template** starts from the fictional cadence template (8 Instagram, 8 Facebook, and 4 Google Business posts a month for a rooftop; less for Coop).

A calendar item with kind `post` is a brief: store, channels, date, goal, offer or program link, notes, and the creative request. From those briefs the Worker derives the photos and reels, one need per store + subject + format, keeping the earliest due date. A Drive, PostEngine, or delivered shoot asset with the same subject and format removes that need.

Open needs become suggested shoots, grouped by store and a seven-day window, dated two days before the first due date. The shooter defaults to Lance and can be anyone (store staff or a freelancer). Accepting a suggestion puts it on the calendar and the shoot schedule. Marking the shoot delivered, or a shoot job coming back with asset URLs, closes the matching needs. Creative jobs stay blocked until those needs are covered.

Jobs are Eleanor (design), Frances (copy), Ansel (photo edit), Steve (video), and Lance (shoot). Status is `requested`, `in_progress`, `delivered`, or `approved`. Bots poll and deliver through `docs/BOT_API.md`. When the creative jobs are delivered, the brief is waiting on Lance. His approve queues a PostEngine draft only if `PLANNER_PE_WRITE=1`. The default is `0`. The import call is specified in `docs/POSTENGINE_CONTRACT.md` because the current PostEngine create route has no import token, and a different route publishes. This desk never publishes.

The calendar stage runs brief, creative, approved, queued, published. Each card says what it is blocked by.

### Posting health

Read-only. The Worker never calls a create, publish, or review endpoint. Allowed GETs:

- `https://zernio.com/api/v1/accounts`
- `https://zernio.com/api/v1/posts` (published, scheduled, and external published history)
- `https://postengine.thecoopbrla.com/api/posts` with header `x-dashboard-pin`

| Secret | Use |
| --- | --- |
| `ZERNIO_API_KEY` | `Authorization: Bearer` for the Zernio reads above. |
| `POSTENGINE_PIN` | `x-dashboard-pin` for PostEngine reads. |
| `ZERNIO_ACCOUNT_MAP` | Optional JSON. Store id to Zernio account ids, for example `{"bhbmw":["…"],"abr":[],"hp":[],"bmwj":[],"coop":[]}`. When set, display-name matching is skipped. |
| `PLANNER_BOT_TOKENS` | JSON of bot name to token. See `docs/BOT_API.md`. |
| `POSTENGINE_IMPORT_TOKEN` | Bearer token for `POST /api/import/posts`. Unused while the write flag is off. |
| `PLANNER_PE_WRITE` | Set to `1` only after PostEngine has the import route. Default `0`. |

PostEngine dealership ids are fixed: 1 BMW of Jackson, 2 Brian Harris BMW, 3 Audi Baton Rouge, 4 Harris Porsche, 6 Coop.

With a secret missing, or when a read fails, that source falls back to a fictional feed. A live empty response stays empty. It is not filled with samples. Days behind are counted in America/Chicago against each store's cadence (2 days for the rooftops, 7 for Coop). Cadence is editable on the desk, from 1 to 30.

### Shot lists

`GET /api/planner/shots` is the same PostEngine read (`GET /api/posts`, header `x-dashboard-pin`), counted per model for Audi Baton Rouge, Harris Porsche, Brian Harris BMW, and BMW of Jackson. The desk tab is **Shot lists**. A row is the model, distinct photo file names, post count, last published date, and a flag. Open a row for the shot checklist and any upcoming calendar item that names that model.

Thresholds live in `workers/planner-api/src/shots.js`: few is 4 or fewer photos, stale is nothing published in 60 days, overused is one photo or shoot folder over 40% of that model's posts or one photo used 3 or more times. A model with no posts is none, including one that only shows up on the calendar. `vehicleInfo` becomes a brand and model (`2026 BMW X5 M60` → BMW X5, year kept on the row). Lifestyle copy and anything unrecognized go to Other. Drafts and rejected posts are skipped. This is not a Drive catalog. With no `POSTENGINE_PIN`, the tab shows a fictional sample.

### Data model

| Table | What it holds |
| --- | --- |
| `stores` | The five rooftops, PostEngine id, cadence, market. Not created from the page. |
| `calendar_items` | Planned content. Date, channel, owner, status. |
| `shoots` | Shoot date, time, shooter (Lance by default), place, brief, status. |
| `rollouts` | One row per store per `YYYY-MM`, plus the program name. |
| `rollout_steps` | The ten steps: programs received, program sheet, manager email, specials page, banners, email blast, Meta posts, Google Business posts, paid brief, newsletter. Each has a status and an owner. |
| `events` | Sponsorships and events. Decision is `pending`, `yes`, or `no`. |
| `tasks` | Work for Daisy, Eleanor, Frances, Ansel, Steve, Della, or Lance. |
| `approvals` | Lance's queue. `pending`, `approved`, `changes`, or `declined`. |
| `planner_meta` | Whether the fictional seed has already run. |

`fixture = 1` marks sample rows. **Clear sample rows** on the desk deletes them and does not seed them again. Engine posts are not stored. They are read on each request.

Writes:

- `GET /api/planner?month=YYYY-MM` — the whole desk for that month
- `POST` and `PATCH` and `DELETE` under `/api/planner/calendar`, `/shoots`, `/events`, `/tasks`, `/approvals`
- `PATCH /api/planner/stores/:id` with `{ "cadenceDays": 2 }`
- `PATCH /api/planner/rollouts/:storeId/:month` and `.../steps/:stepKey`
- `DELETE /api/planner/fixtures`
- `POST /api/planner/session` with `{ "pin": "…" }`

### Local preview and tests

From `workers/planner-api`, on Node 22 or newer:

```bash
npm install
npm test
npm run dev:fixture
```

Open `http://127.0.0.1:8787/planner.html`. That server is an in-memory fixture preview. It is not the Workers runtime and it is not production.

`npm run dev` is `wrangler dev --local`, which uses the real runtime and local D1. Copy `.dev.vars.example` to `.dev.vars` first. Leave the secrets empty for fixture mode.

### What a person has to do to go live

This pull request does not deploy the Worker, create Cloudflare resources, set secrets, or change DNS. Merging `main` publishes the hub page only.

1. Confirm the owner wants the page on the hub. Merging `main` publishes GitHub Pages.
2. From `workers/planner-api`, run `npx wrangler d1 create hub-planner`.
3. Replace the placeholder `database_id` in `wrangler.jsonc` with the id Wrangler prints. The all-zero id is not a database.
4. Apply the schema: `npx wrangler d1 migrations apply hub-planner --remote`.
5. Set secrets by name, from a prompt or stdin, not from a shell argument you might commit:

   ```bash
   npx wrangler secret put PLANNER_PIN
   npx wrangler secret put PLANNER_TOKEN
   npx wrangler secret put ZERNIO_API_KEY
   npx wrangler secret put POSTENGINE_PIN
   npx wrangler secret put PLANNER_BOT_TOKENS
   ```

   Leave `PLANNER_PE_WRITE` unset. Set `POSTENGINE_IMPORT_TOKEN` only when PostEngine has the import route in `docs/POSTENGINE_CONTRACT.md`, then set `PLANNER_PE_WRITE` to `1`.
   Optional, if name matching is not enough: `npx wrangler secret put ZERNIO_ACCOUNT_MAP`.
6. Deploy the Worker: `npx wrangler deploy`. The config routes `hub.thecoopbrla.com/api/planner*` on the `thecoopbrla.com` zone. `workers_dev` is off. Logs and traces are on at full sample because this desk is one team, not a public API.
7. Merge the hub change so `planner.html` is on Pages.
8. Open the planner, enter the PIN, and confirm posting health says Zernio live and PostEngine live rather than sample.
9. Clear sample rows before anyone types real programs, tasks, or approvals.
10. Do not commit `.dev.vars`, real rows, or secret values. Do not set `PLANNER_NOW` in production.
