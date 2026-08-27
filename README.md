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

> **Already set this up once?** Run `schema.sql` again. It is written to be safe to re-run,
> and the newest version adds the commissioner, the split tag, scoring by numbers instead of
> pins, and the money book. Nothing you have logged is touched — old games are migrated in
> place. If the site notices the database is behind, it says so on the Home tab and gives you
> the exact SQL with a copy button.

### 2. Build the tables

1. In your new project, click **SQL Editor** in the left sidebar.
2. Open the file `schema.sql` from this folder in any text editor, select all of it, copy it.
3. Paste it into the SQL editor and click **Run**.
4. You should see "Success. No rows returned." That is what success looks like here.

That one file creates every table, every rule about who is allowed to change what, and the
trigger that writes down every edit anyone ever makes.

**The commissioner.** The very first account to sign up becomes the commissioner — that will
be you. A commissioner can fix or delete anybody's games and any whole session, which is for
the night somebody types 132 instead of 213 and then goes home. It is not a quiet power: every
change a commissioner makes lands in the same visible history as everyone else's, with their
name on it. Nobody can promote themselves; the database refuses it. To hand the job over, or
to take it back, run one line in the SQL editor:

```sql
update profiles set is_admin = true  where display_name = 'Nat';
update profiles set is_admin = false where display_name = 'Drew';
```

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
4. Drag `index.html`, `schema.sql`, `icon.png`, `manifest.json` and `README.md` into the box.
   Click **Commit changes**.
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
git add index.html schema.sql icon.png manifest.json README.md verify.mjs .gitignore
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
bowled, and whether you split into teams. Then pick how you want to do it:

**Score it live.** The lane view. Everybody's scorecard sits across the top, the number pad
fills the bottom half, and it moves to the next bowler by itself the moment a frame is done.
Tap how many pins went down — 0 to 9, or the big blue button for a strike or a spare. Undo goes
back a ball even if that means handing it back to the person before you. Each game is written
to the record book the moment its tenth frame closes, and a game in progress survives locking
your phone, a dead battery or closing the tab: come back to Log and it offers to pick the night
back up. When everybody finishes, it offers you game 2.

**When somebody leaves a split**, tap **That left a split** before the next ball. That is the
one thing typing a number cannot work out for itself, and it feeds the split rate and split
conversion on everyone's profile.

**If you would rather tap the actual pins**, there is a link under the pad that swaps to a pin
deck — drag a finger across it to take several down at once. The only thing it buys you is
leave tracking: which pins you keep leaving standing, named (10-pin, bucket, greek church), and
splits spotted automatically instead of tagged by hand. Everything else — average, strike and
spare percentage, first-ball average, carry, tenth-frame average, streaks — comes out the same
either way. You can switch whenever you like, even mid-game.

**Type in scores afterwards.** For writing up a night that already happened. Log game 1 for
everyone, then game 2, and so on. Each game goes in one of two ways, and the toggle remembers
what you picked last:

- **Full** — ball by ball, the same pad as the live view. The score builds itself as you go and
  the strip underneath looks like the monitor above the lane. You cannot enter an impossible
  frame: after a 7, the buttons for 8 and 9 stop working.
- **Quick** — just the final score. Fast, and honest about it: those games get a small amber
  dot, and anything that needs to know what happened ball by ball quietly leaves them out
  rather than making something up.

## The money

The book is its own thing. It has nothing to do with logging scores, and you can keep
it for a night where nobody writes down a single game.

1. **Tonight** tab. Date, where, and who is in — including anyone **without an account**:
   type their name, tap **Add guest**, and they are in. A guest is remembered, so the same
   person next month adds to the same running total.
2. A card per game, a line per person. Type what they won or lost. It saves as you type
   and the running total sits at the top the whole time.
3. **Another game** when you move on. **Done** when you are finished.

**Quick fill** is there for the usual case: tap each name until it says won or lost, pick
the stake, and it fills the numbers in. *Winners split the pot* means everyone who lost puts
the stake in and the winners share it — two losers at $10 makes the winner $20 between them.
*Flat* means everyone who won takes the stake and everyone who lost pays it.

Every number stays an ordinary box you can type over. The quick fill is a shortcut, never a
rule, and nothing you typed is ever recalculated behind your back. If a game does not come to
zero the site says so and leaves it alone — uneven sides do that, and sometimes somebody
covers the difference.

Two tabs, because they are two different jobs:

- **Tonight** is the book you are keeping right now. Start a night, or pick back up one you
  left open. Somebody turning up late can be added mid-night.
- **Money** is the history: who is up and who is down all time, best and worst nights, a
  running total over time, and every night listed so you can open one back up and fix it.
  Guests appear in it exactly like account holders.

**Squaring up.** At the bottom of a night, the site works out the fewest handovers that settle
everybody — four people owing each other becomes two people passing a note across the table.
**Copy it for the group chat** puts the whole night, totals and handovers, on your clipboard.

**Taking things back out.** The ✕ beside a name removes them from that night and takes their
lines with them. The ✕ on a game clears that game. On the Money tab, a guest can be renamed,
deleted, or **merged** into a real account when they finally sign up — every night they ever
played moves across, and two lines for the same game are added together rather than one
quietly winning. Scores are the same: tap any game to edit or delete it, and a whole session
can be deleted from its own page.

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
| `icon.png` | The home screen icon. |
| `manifest.json` | Lets phones install it like an app. |
| `README.md` | This. |

**Put it on your home screen.** On an iPhone, open the site in Safari, tap the share button,
then **Add to Home Screen**. On Android, Chrome offers it in the menu. It opens without the
browser chrome, keeps the dark background, and looks like any other app on the phone.

Inside `index.html` there are two script blocks. The first is the scoring engine: pure
arithmetic, no page in sight, and the tests lift it straight out of the file and run it on
its own. The second is everything else.
