# بطلوا رغي · Battalo Ra4y

Multiplayer games for friends. Hosted free on **GitHub Pages**, with **Firebase** as the only server side
(lobby, chat, invites, live games, leaderboard). Players sign in with **Google**. Installable on the home screen. Needs internet - there is no offline mode.

## 1. Firebase setup (5 minutes)
Only two Firebase products are used: **Authentication** (Google sign-in) and **Cloud Firestore** (free Spark plan is enough).
1. <https://console.firebase.google.com> → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** (pick a support email → Save).
3. **Build → Firestore Database → Create database** (any location, *production mode*).
4. Firestore → **Rules** tab → paste the contents of `firestore.rules` → **Publish**.
5. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig`
   values into `firebase-config.js` (`apiKey`, `authDomain`, `projectId`, `appId`).
6. After the site is live: **Authentication → Settings → Authorized domains → Add** `YOUR-USER.github.io`
   (needed or Google sign-in is refused).

## 2. Publish on GitHub Pages
The site files sit at the top level of the repo, so `index.html` is served directly - no build step or workflow needed.
1. Push this folder's contents to a GitHub repo (branch `main`, files at the repo root).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `/ (root)`** → Save.
3. Open `https://YOUR-USER.github.io/YOUR-REPO/`.

## Project layout
```
index.html             built game page (generated - committed so Pages can serve it)
firebase-config.js     your Firebase web-app keys
sw.js, manifest.webmanifest, *.png   installable-app files
vendor/                Stockfish (GPLv3), chess.js, qrcode-generator
src/                   source: net.js (Firebase), app.js, points.js, games/, style.css, index.template.html
build.js               node build.js -> regenerates index.html from src/
firestore.rules        paste into Firebase -> Firestore -> Rules
```

## Features
- **Google sign-in** - one tap, and your name and points follow you on every device. Tap your name in the top bar to change it or sign out.
- **Leaderboard** - top 50 on the *Ranks* tab. Points are earned per finished game (see the ⓘ button in *Ranks*). Solo wins scale with
  difficulty, friend games give more. Edit the values in `src/points.js`, then run `node build.js`.
- **Games** - Chess (Stockfish), Sudoku, Tic-Tac-Toe and Connect 4, solo or against a friend.
- **Invites by search** - pick a game, search the online players by name, tap Invite. The Lobby tab has the same search.
- **Private chat** - tap the chat button next to an online player (or a name under *Messages*) to talk one-to-one. Unread messages show a badge on the Lobby tab.
- **Lobby, invites, per-game chat and 2-player games** run on Firestore.
- **Watch** tab is just a "Coming soon" page for now.
- **Install to home screen** - Android/desktop Chrome shows an *Install* card; iPhone shows how to use *Add to Home Screen*.
- No connection checker, no offline page and no service-worker caching (`sw.js` only makes the app installable).

## Editing the code
`src/` is the source. After any change run `node build.js` to regenerate `index.html`, then commit both.
Firebase layer: `src/net.js`. Points: `src/points.js`. Stockfish (GPLv3), chess.js and qrcode-generator live in `vendor/`.

## Staying inside the free Firestore limits (50k reads / 20k writes per day)
Nothing polls and nothing listens in the background:
- **Lobby list** is one query, run only when the Lobby tab / invite sheet is opened or *refresh* is tapped (at most once per 15 s).
- **Presence** is a single small write on start, then one every 3 minutes while the app is on screen (and one delete when it closes).
  A player counts as online for 7 minutes after their last write. No heartbeat every few seconds, no ghost clean-up deletes.
- **Lobby chat** is listened to only while the Chat tab (or the chat inside a solo game) is open: the last 20 messages the first time,
  then only newer messages when it is reopened.
- **Leaderboard** is one fetch (50 rows) when *Ranks* opens, cached for 3 minutes, plus a manual refresh button.
- **Points** are one write using a server-side increment (no read-then-write transaction). Own stats are read once at sign-in.
- **Private chat** listens to one conversation only while its window is open (last 30 messages, then only newer ones). Each message is
  2 writes (the message + a tiny note in the receiver's `inbox/{uid}` document that drives the unread badge).
- **Invites and the inbox** are the only always-on listeners (they cost reads only when something arrives). A live 2-player game listens to its one room document.
- The *names* collection (unique-name reservation) is gone: it cost extra reads and writes on every sign-in and rename.
  Display names no longer have to be unique - Google accounts identify players.

## Good to know
- **Upgrading from the anonymous version:** old anonymous players are not linked to Google accounts, so everyone starts at 0 points.
  You can delete the old `names` collection (and old documents) from the Firestore console; republish `firestore.rules`.
- **Points are client-trusted** (there is no server code). The rules limit abuse: only your own row can be written, points
  can never go down, max +25 per write, one write per 3 seconds. A determined cheater can still farm points.
  Real protection would need Cloud Functions (Blaze plan).
- **The lobby is a snapshot**, not live: tap refresh to see who just arrived. Someone who closes the app drops off the list within
  a few minutes (immediately if the tab closes cleanly). Leaving a game early ends it for the other player.
- **Chat history** is kept in the `chat` collection; delete old entries from the console once in a while if you like.
