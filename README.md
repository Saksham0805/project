# Campus Radar backend: email OTP login + deadline reminders

## Run it
1. Install Node 18+.
2. In this folder: `npm install`
3. Copy `.env.example` to `.env`, fill in Gmail + app password + JWT_SECRET.
4. `npm start` (API on http://localhost:3000)

## Hook up the frontend
1. Copy `auth.js` next to your `index.html`.
2. Add before `</body>`:  `<script src="auth.js"></script>`
3. Where you handle the bookmark/save click, call:

```js
// h = { id: 'smart-india-hack', title: 'Smart India Hackathon', deadline: '2026-12-05', url: 'https://...' }
const ok = await CampusAuth.syncBookmark(h, true);   // true = save, false = unsave
```

If `ok` is false (not logged in), don't increment your Saved counter.

Optional: define `window.CR_getLocalSaved = () => [...]` so anything saved before login is pushed to the server after login.

## How reminders work
Server checks every hour. One email at 72h before the deadline, one at 24h. No duplicates. Date-only deadlines count as 11:59 PM IST.

## Before deploying
- Change `API` at the top of `auth.js` to your hosted URL.
- Add your site's domain to `ALLOWED_ORIGINS`.
- `db.json` is fine for a college project. Swap to MongoDB/Postgres if it grows.
- Never commit `.env`.
