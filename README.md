# Avengers Bowling

A record book for a casual bowling group. Everyone gets an account, everyone logs their
own scores, and the site turns those scores into profiles, rankings, records and awards.

It is one HTML file. No build step, no framework, no server of yours. The scores live in a
free Supabase database and the page is served for free by GitHub Pages.

**Have a look first:** open `index.html` in a browser with `?demo=1` on the end of the
address and you get a made-up season to click around in. Nothing is saved.

---

## Setting it up

Four things to do. Twenty minutes, most of it waiting.

### 1. Make the database

1. Go to **supabase.com** and make a free account.
2. Click **New project**. Give it a name (`bowling` is fine) and a database password —
   save that password somewhere, though you will not need it for this.
3. Pick the region closest to you. Click **Create new project** and let it finish. It
   takes a couple of minutes.

### 2. Build the tables

1. In your new project, click **SQL Editor** in the left sidebar.
2. Open the file `schema.sql` from this folder in any text editor, select all of it, copy it.
3. Paste it into the SQL editor and click **Run**.
4. You should see "Success. No rows returned." That is what success looks like here.

That one file creates every table, every rule about who is allowed to change what, and the
trigger that writes down every edit anyone ever makes.

### 3. Connect the page to the database

1. In Supabase, click the **gear icon → API** (or **Project Settings → API**).
2. You need two values from that page:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public** key — a very long string of letters and numbers
3. Open `index.html` in a text editor. Near the top of the script, about a third of the way
   down the file, there is a block that looks like this:

   ```js
   const SUPA = {
     url:     'YOUR_SUPABASE_PROJECT_URL',
     anonKey: 'YOUR_SUPABASE_ANON_KEY',
   };
   ```

4. Paste your two values between the quote marks. Save the file.

**About that key.** The anon key is *publishable*. It is designed to sit in a public web
page — every Supabase site on the internet ships one. It is not a password and you do not
need to hide it. What actually protects the data is the set of rules in `schema.sql`: anyone
may read, only signed-in people may add, and you may only change your own stuff. The key you
must never put in this file is the one called **service_role**. Leave that one alone.

### 4. Put it on the internet

1. Go to **github.com** and make a free account if you do not have one.
2. Click the **+** in the top right → **New repository**. Name it `bowling`. Leave it
   **Public**. Click **Create repository**.
3. On the next page click **uploading an existing file**.
4. Drag `index.html`, `schema.sql` and `README.md` into the box. Click **Commit changes**.
5. Click **Settings** (top of the repository) → **Pages** (left sidebar).
6. Under "Branch", choose **main** and **/ (root)**. Click **Save**.
7. Wait a minute, then refresh. GitHub shows you the address:

   ```
   https://YOUR-GITHUB-USERNAME.github.io/bowling/
   ```

Send that address to everyone who bowls. They open it, click **Create an account**, and
they are in. Anyone can read the whole record book without signing in at all.

### If you would rather use the command line

```bash
cd /Users/drewkim/Desktop/bowling
git init
git add index.html schema.sql README.md verify.mjs .gitignore
git commit -m "Avengers Bowling"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/bowling.git
git push -u origin main
```

Then turn on Pages in **Settings → Pages** as in step 4 above. To change anything later:
edit the file, then `git add -A && git commit -m "what changed" && git push`. The live site
updates about a minute after you push.

---

## Using it

**Logging scores.** Tap **Log**. You start with the session — the date, the alley, who
bowled, and whether you split into teams. Then you log game 1 for everyone, game 2 for
everyone, and so on. One person can enter the whole lane's scores in one sitting, which is
how it actually happens.

Each game is entered one of two ways, and the toggle remembers what you picked last:

- **Full** — tap the pins you knocked down, hit confirm, repeat. The score builds itself as
  you go and the strip underneath looks like the monitor above the lane. You cannot enter an
  impossible frame; the pins that are already down are not tappable.
- **Quick** — just the final score. Fast, and honest about it: those games get a small amber
  dot, and anything that needs to know what happened ball by ball quietly leaves them out
  rather than making something up.

**Nobody is in charge.** Nothing is verified and nothing is approved. Anyone can log
anything for anyone. But every game shows who entered it and when, every edit is written
down and shown next to the game, and the home page has a feed of the last thirty things
anybody did. That is the whole enforcement mechanism and it works fine among friends.

**Everything is explained.** Every section has a "What do these numbers mean?" panel at the
bottom that defines each stat in one plain sentence. Nobody has to know what a handicap is.

---

## Checking that it still works

There is a test harness. It runs the real page in a real browser and checks the scoring
engine against hand-verified scorecards, the split detection against a table of known
leaves, and that nothing overflows sideways on a phone.

```bash
npm install                 # once — pulls in Playwright
npx playwright install chromium
node verify.mjs             # everything
node verify.mjs --engine    # just the scoring maths, no browser needed
```

It prints how many checks passed. If it says anything other than ALL CHECKS PASS, something
is broken.

---

## The files

| File | What it is |
|---|---|
| `index.html` | The entire site — markup, styling and code. The only file the browser needs. |
| `schema.sql` | The database. Paste into Supabase once. |
| `verify.mjs` | The test harness. Never runs in the live site. |
| `README.md` | This. |

Inside `index.html` there are two script blocks. The first is the scoring engine: pure
arithmetic, no page in sight, and the tests lift it straight out of the file and run it on
its own. The second is everything else.
