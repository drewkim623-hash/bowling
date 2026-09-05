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

### 2b. Let people in without an account

Nobody should have to invent a password to write down that they lost four dollars. Supabase can
hand out an identity to somebody who has not signed up for anything, and this is switched off
until you say otherwise:

1. **Authentication** in the left sidebar → **Sign In / Providers**.
2. Turn on **Anonymous sign-ins**. Save.

Until you do, the front door still draws itself but nothing behind it works — tapping a name
comes back saying anonymous sign-ins are switched off, and pointing here.

What it buys you: the home page opens with **Who is bowling?**, everybody the book already
knows laid out to be tapped. Somebody new types a name and is straight in. There is no email,
no password, no confirmation link. They get a real row in the database like anybody else, and
every rule about who may change what applies to them unchanged.

**It lives in the browser and nowhere else.** That is the whole cost. Clear your site data or
pick up a different phone and you are a stranger again — your games stay in the book under your
name with nobody able to edit them. The **Me** tab offers anyone in that position an email and
a password, which upgrades the account in place: same profile, same history, nothing moves.
Worth doing for anyone who turns up twice.

**The commissioner.** The very first profile to exist becomes the commissioner — that will be
you, so sign yourself in before you hand the address around. The bar is a tapped name now, not
a confirmed email, so on a brand new database whoever gets there first gets the keys. A
commissioner can fix or delete anybody's games and any whole session, which is for
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

**Signing out is not a cliff.** It hands the phone to the next person. You stay on the front
door and tapping your name brings you straight back — with no password at all if you never made
one. There is no button anywhere that locks you out of your own account.

**Saying who you are.** The home page opens with **Who is bowling?** — every name the book
knows, waiting to be tapped. What a tap does depends on what it would cost to be wrong about
somebody:

- **A guest** — somebody who has been bowling on your tab as a name and nothing else — asks
  you to confirm first, telling you exactly what you are taking on (*"Everything the book has
  under Mike — −$40 across 6 nights — becomes yours"*), and then that placeholder and you
  become one person. His money lands on your account and Mike stops being a guest.
- **An account this phone has signed in before** goes straight in, no password. The phone
  keeps a small ring of everyone who has signed in on it, which is what you want for the phone
  that gets passed down the lane, and is not what you want on a borrowed one — **Sign out and
  forget me here**, on the Me tab, empties it.
- **Any other account** asks for the email and password. A name on a list is not a way in.
- **Nobody on the list?** *I am not on this list* → type a name → in.

None of this gates reading. The leaderboard, the money book and the trophy case are open to
anyone who has the address, signed in or not, exactly as before.

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

**A nought and an empty box are two different things.** Type **0** and that person bowled the
game and came out level — they are in the teams, in the record, and in the win-loss line as a
third figure (`4–2–1` is four won, two lost, one level). Leave the box **empty** and they were
not in that game at all. It only reads as sitting out if there is no number there. This matters
most on a **three-way night**: 2v2v2 settled by placement pays the top side, takes off the
bottom side, and leaves the middle on nothing — and the middle side bowled.

**Power rankings** answer *who is winning*, off the book: where you finish, how much you take,
how often you turn up. No scores needed, so guests are ranked like everybody else.

Where you finish now leans on **how many were on your side**. The fewer people standing next to
you, the less of the result was somebody else — so a game **one to a side counts four times**
what a four-man game does, three to a side counts twice, and two to a side sits between them.
Nothing is thrown away; the big-team games just do not shout as loudly. Two people with the
same record can now be told apart: win your singles and lose your fours and you rank well above
somebody who did the reverse.

Finishing level scores in the middle, which is exactly what the middle side of a three-way
night did.

**Bowling rankings**, underneath, are the other question: not who wins, but who bowls best.
Pins, spares, strikes, steadiness and form, no handicap anywhere near it. That one needs scores
logged, so it only covers whoever logs them.

**Sides split out.** The **Teams** tab has a strip along the top — **All · 1v1 · Pairs ·
Threes · Fours** — indexed on how many were on *your side*, so 2v2 and 2v2v2 both count as
Pairs. A size only appears once somebody has actually bowled it. Who you win with, the career
record and recent games all follow the tab. **1v1** is everybody for themselves: a different
number for every person, and it says outright that there are no partners to have.

**Sides beyond two.** 3v3, 2v2v2, four ways, any of it. The sides are read off the numbers —
same amount, same side — so the book works out three teams from a three-way game without being
told. A game with more than two sides says *"Drew & Nat came away up · Tony & Steve paid for
it"* rather than pretending it was head to head.

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

## Finishing a night

Press **Finish the session** at the bottom of a night's book and the site reads the
night back to you: everybody's record for the night, the square-up, and a few
paragraphs about what happened. Nothing locks — you can still go back and fix a
number, and everything below re-reads itself when you do.

It needs one column, which older databases will not have. In Supabase →
**SQL Editor**, run:

```sql
alter table sessions add column if not exists finished_at timestamptz;
alter table sessions add column if not exists archived_at timestamptz;
```

Until you run them, finishing and putting a night away still work but only on the
device you did it on. Once they are there, you finish or archive a night on your
phone and it is done for everybody.

## Putting a night away

The button at the foot of a night's book does not delete it. It puts the night in
the **archive**: out of the book, out of everybody's totals, counting for nothing —
but nothing is destroyed, and it can be brought straight back. The archive lives
under Stats, and it is the only place on the site with a button that really does
destroy something.

## The write-up

Every finished night is written up automatically, from the money and the sides read
off it. No key, no network, no cost — it is a function in the page. It leads on
whatever actually happened, and reaches back into everybody's record before tonight
for the "that is ten straight now" sort of line.

If you have set up the photo reader below, a second button appears offering to ask
Claude for a longer one. That is optional and always will be — deploy
`supabase/functions/write-recap` the same way as `parse-photo`, using the same
`ANTHROPIC_API_KEY` secret.

## Reading a photo (optional)

The site can read a photo of the monitor above the lane, or of the notes page you
keep the money on, and fill the numbers in for you to check. It is off until you set
it up, and the button does not appear until you do.

It needs an API key, and a key cannot live in `index.html` — that file is public and
anything in it is public with it. So the key lives in a small function inside your own
Supabase project, and the page asks that function.

### 1. Get a key

Go to **console.anthropic.com** → **API keys** → **Create key**. Copy it. It starts
`sk-ant-`. This is the secret kind — it never goes in `index.html` and never gets
committed to GitHub.

### 2. Put the function in Supabase

The easy way, in the dashboard:

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via editor**.
2. Name it exactly `parse-photo`.
3. Open `supabase/functions/parse-photo/index.ts` from this folder, copy all of it,
   paste it in, and deploy.

Or from a terminal, if you have the Supabase CLI:

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy parse-photo
```

### 3. Give it the key

Supabase → **Edge Functions** → **parse-photo** → **Secrets** → add:

```
ANTHROPIC_API_KEY = sk-ant-...
```

(or `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` from the terminal)

That is it. Reload the site and **📷 Read it off a photo** appears in a night's book,
and **📷 Read the monitor** on a session you are typing up.

### What to expect

It reads the names and the numbers and shows you **a draft you correct**, then you press
**Use these numbers**. Nothing is ever saved from a photo without you confirming it — a
bad read that saved itself would quietly poison the record book, and edits here are
permanent history.

It is good, not perfect. Photos taken at an angle, with glare on the screen, or with half
the sheet out of frame will produce nonsense in places. That is what the review screen is
for. If it is unsure it tells you so at the top.

Each photo costs a couple of cents against your Anthropic account. A season of Thursdays
is well under a dollar. The model is named at the top of `index.ts` if you ever want to
change it.

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
| `supabase/functions/parse-photo/` | Optional. The photo reader — holds your API key, in your Supabase project. |
| `icon.png` | The home screen icon. |
| `manifest.json` | Lets phones install it like an app. |
| `README.md` | This. |

**Put it on your home screen.** On an iPhone, open the site in Safari, tap the share button,
then **Add to Home Screen**. On Android, Chrome offers it in the menu. It opens without the
browser chrome, keeps the dark background, and looks like any other app on the phone.

Inside `index.html` there are two script blocks. The first is the scoring engine: pure
arithmetic, no page in sight, and the tests lift it straight out of the file and run it on
its own. The second is everything else.
