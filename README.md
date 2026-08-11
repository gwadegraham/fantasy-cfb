# Campus Clash — Fantasy College Football

A season-long fantasy college football app: players draft FBS teams and earn
points based on real game results. Two leagues are supported (Claunts = V1
scoring, Graham = V2 scoring), each with its own rules.

## Tech stack

- **Node.js / Express** server (`server.js`)
- **MongoDB** via Mongoose (`models/`)
- **EJS** views (`views/`) + static client JS/CSS (`public/`)
- **Auth0** login via `express-openid-connect`
- **Socket.IO** for the live draft room
- **CollegeFootballData API** (`cfb.js`) for teams, games, rankings, lines
- **Jest** tests (`tests/`)

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values below
npm run devStart       # nodemon server.js  (http://localhost:3000)
```

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `URL` | Base URL; also used for internal API calls (`http://localhost:3000` locally) |
| `DATABASE_URL` | MongoDB connection string |
| `YEAR` | Current season |
| `AUTH_SECRET` | Long random string; signs the session cookie **and** draft socket tokens |
| `CLIENT_ID` / `ISSUER_BASE_URL` | Auth0 application settings |
| `CFBD_API_KEY` | CollegeFootballData API key |
| `INTERNAL_API_TOKEN` | Shared secret so scheduled jobs / scoring can call the app's own API. Must match on the web host **and** wherever the jobs run |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Sender for job status emails (jobs only) |

> Auth0: add `http://localhost:3000/callback` to Allowed Callback URLs and
> `http://localhost:3000` to Allowed Logout URLs for local login.

## Login screen

`auth/login.html` is the **source of truth** for the sign-in page, but it is not
served by this app — Auth0 hosts it. After editing, paste the whole file into
**Auth0 Dashboard → Branding → Universal Login → Login**, with *Customize Login
Page* toggled on, and save. Nothing deploys it for you, so the repo copy and the
live page drift apart silently if you skip that step.

Preview it locally without the paste-and-save loop:

```bash
npm run devStart   # then open http://localhost:3000/dev/login-preview
```

That route only exists when `NODE_ENV !== 'production'`. It fills in the
`@@config@@` placeholder the same way Auth0 does and rewrites the absolute
`campusclash.io` asset URLs to localhost, so you see local images. Email +
password may fail there — the real page is served from the Auth0 origin, where
`webAuth.login()` is same-origin; from localhost it is not. The social buttons
are plain redirects and behave normally.

Sign-up is deliberately absent: accounts are provisioned by the commissioner,
and *Disable Sign Ups* is on for the database connection. Don't re-add a league
selector — Auth0 Lock wrote it to `user_metadata.league`, while the whole app
reads `user_metadata.metadata.league`, so the value never reached anything.

## Authorization

- All API routes require a logged-in session (or the internal token).
- State-changing (non-GET) endpoints and the `/admin` page require a
  **commissioner** role (Admin / League Manager). See `modules/require-auth.js`
  and `modules/require-commissioner.js`.

## Live draft

Commissioners configure a draft in **Admin → Configure Draft** (order, date,
rounds, participants). The draft room (`/draft-room`) is a real-time,
snake-draft board powered by Socket.IO. See `modules/draft-*.js`.

## Scheduled jobs

Run as separate processes (e.g. via a scheduler) to pull games and update
scores during the season:

- `update-daily-scores-job.js`, `update-saturday-scores-job.js`,
  `update-sunday-scores-job.js` — retrieve games and recompute scores
- `saturday-job.js`, `sunday-job.js` — status emails
- `update-expected-wins-job.js` — load expected wins from `json/expectedWins{year}.json`

Jobs authenticate to the app with `INTERNAL_API_TOKEN` and run on Central time.

## Tests

```bash
npm test   # jest
```

CI runs the suite on every pull request (`.github/workflows/test.yml`).
