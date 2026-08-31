/**
 * Avengers Bowling — write the night up.
 *
 * Takes the money book for one night — what everybody put in, the sides that
 * were read off those numbers, and what everybody's record was going in — and
 * gives back a few paragraphs about what happened. No score is involved. None
 * is needed: the money says who won, who paid for it, and by how much.
 *
 * Deploy:   supabase functions deploy write-recap
 * Secret:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *           (the same secret parse-photo already uses — set once, both work)
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.71.0";

const MODEL = "claude-opus-5";      // swap for claude-sonnet-5 if you want it cheaper

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* Forcing a tool call is what makes the answer a shape the page can render,
   rather than a paragraph it has to unpick. */
const WRITE_TOOL = {
  name: "file_the_report",
  description: "File a short report on the night's bowling.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "story"],
    properties: {
      headline: {
        type: "string",
        description: "One short flat sentence, under about eight words. State the "
          + "single most interesting true thing about the night. No puns, no colons.",
      },
      story: {
        type: "array",
        description: "Three to five short paragraphs.",
        items: { type: "string" },
      },
    },
  },
} as const;

const PROMPT = `You are writing up a night of bowling among friends for the group's own
record book. They bet small amounts on each game. Nobody logs their scores — the only
record of the night is the money, so that is what you have.

You are given, as JSON:
- the date, the alley, and an optional title somebody gave the night
- each game, split into sides. Everyone on a side put the same amount in or took the
  same amount out. A positive amount means that side won that game; negative means they
  paid for it. Anyone listed as sat_out did not play that game.
- each person's totals for the night: games won, games lost, and net money
- going_in: what each person's record and net were BEFORE tonight

How to write it:
- Lead with the one thing most worth saying. A clean sweep, a total collapse, somebody
  who finally beat somebody, the biggest single swing, a run that just ended or extended.
- Use going_in. "Has now lost seven straight" or "first winning night since March" is the
  kind of line that makes a record book worth keeping. Only say it if the numbers show it.
- Name people. Use the exact names given.
- Every number you state must be in the data. Do not invent scores, strikes, spares,
  frames, pins or anything else about the actual bowling — you were not told any of it,
  and saying otherwise would be a lie the reader can check.
- Do not mention that scores were not recorded, and do not mention the data or yourself.
- Dry and plain. A little mean is fine — these are friends. No hype, no exclamation marks,
  no sports-broadcast cliché, no "in a stunning turn of events". Short sentences.
- Three to five paragraphs, and stop.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "This site has no ANTHROPIC_API_KEY set. See the README." }, 500);

  let night: unknown;
  try { night = await req.json(); } catch { return json({ error: "Send me JSON." }, 400); }

  const games = (night as { games?: unknown[] }).games;
  if (!Array.isArray(games) || !games.length)
    return json({ error: "There is nothing in the book for this night yet." }, 400);

  const client = new Anthropic({ apiKey: key });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [WRITE_TOOL],
      tool_choice: { type: "tool", name: "file_the_report" },
      messages: [{
        role: "user",
        content: PROMPT + "\n\nThe night:\n" + JSON.stringify(night, null, 1),
      }],
    });

    const call = response.content.find((b) => b.type === "tool_use");
    if (!call) return json({ error: "Nothing came back. Try again." }, 502);

    const out = call.input as { headline: string; story: string[] };
    return json({
      headline: String(out.headline || "").slice(0, 120),
      story: (out.story || []).map((p) => String(p).slice(0, 1200)).slice(0, 6),
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err);
    return json({ error: `Could not write it up — ${msg}` }, 502);
  }
});
