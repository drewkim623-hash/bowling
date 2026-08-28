/**
 * Avengers Bowling — read a photo.
 *
 * Takes a photo of the monitor above the lane, or of the notes page where the
 * money gets tallied, and turns it into numbers the site can show you for
 * checking. It never writes to the database: it answers, you confirm.
 *
 * Deploy:   supabase functions deploy parse-photo
 * Secret:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *
 * The key lives here, in Supabase, and never goes near index.html — that file
 * is public and anything in it is public with it.
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.71.0";

const MODEL = "claude-opus-5";      // swap for claude-sonnet-5 if you want it cheaper
const MAX_BYTES = 8 * 1024 * 1024;  // a phone photo is well under this

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* What we want back. Forcing a tool call is what makes the answer a shape we
   can rely on rather than a paragraph we have to unpick. */
const READ_TOOL = {
  name: "record_what_you_see",
  description: "Record the names and numbers visible in the photograph.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["people", "confident", "note"],
    properties: {
      people: {
        type: "array",
        description: "One entry per person visible in the photo, in the order they appear.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "values"],
          properties: {
            name: { type: "string", description: "The name as written in the photo." },
            values: {
              type: "array",
              description: "Their numbers left to right: one per game.",
              items: { type: "number" },
            },
          },
        },
      },
      confident: {
        type: "boolean",
        description: "False if the photo is blurred, cut off, or you are guessing at any number.",
      },
      note: {
        type: "string",
        description: "One short sentence for a human: what was unclear, or empty if all was well.",
      },
    },
  },
} as const;

const PROMPTS: Record<string, string> = {
  scores: `This is a photograph of a bowling alley scoring monitor.

Read the FINAL TOTAL for each bowler in each game — the big cumulative number in
the tenth frame box, not the individual frames or the pin counts. One number per
game per bowler, left to right in the order the games appear.

Rules:
- A bowling game total is a whole number between 0 and 300. Never report anything outside that.
- If a game is unfinished or its total is not legible, leave that number out rather than guessing.
- Names on lane monitors are often abbreviated or in caps. Report them exactly as shown.
- If you cannot read the photo at all, return an empty people list and say so in the note.`,

  money: `This is a photograph of a handwritten or typed tally of money won and lost
at a bowling night — the kind of running total people keep on a phone notes page.

Read each person's amounts. One number per column, left to right.

Rules:
- Money won is positive, money lost is negative. A number written as -10, (10) or "10 down" is negative ten.
- Report dollars, not cents: ten dollars is 10, not 1000.
- If a cell is blank or crossed out, use 0.
- If the sheet shows a running total as well as per-game amounts, report the PER-GAME amounts, not the running total.
- If you cannot read the photo at all, return an empty people list and say so in the note.`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "This site has no ANTHROPIC_API_KEY set. See the README." }, 500);

  let body: { mode?: string; media_type?: string; data?: string; people?: string[] };
  try { body = await req.json(); } catch { return json({ error: "Send me JSON." }, 400); }

  const mode = body.mode === "money" ? "money" : "scores";
  const media = String(body.media_type || "image/jpeg");
  const data = String(body.data || "");
  if (!data) return json({ error: "No photo in the request." }, 400);
  if (data.length > MAX_BYTES) return json({ error: "That photo is too big — try again with a smaller one." }, 413);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(media)) return json({ error: `Cannot read ${media} images.` }, 415);

  const roster = (body.people || []).filter(Boolean).slice(0, 20);
  const who = roster.length
    ? `\n\nThe people who might appear are: ${roster.join(", ")}. Match what is written to these names where it is obviously the same person (a first name, an initial, a nickname, a misspelling). If a name in the photo matches nobody on that list, report it exactly as written.`
    : "";

  const client = new Anthropic({ apiKey: key });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" },     // reading numbers off a picture is not hard thinking
      tools: [READ_TOOL],
      tool_choice: { type: "tool", name: "record_what_you_see" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media as "image/jpeg", data } },
          { type: "text", text: PROMPTS[mode] + who },
        ],
      }],
    });

    const call = response.content.find((b) => b.type === "tool_use");
    if (!call) return json({ error: "Nothing readable came back. Try a straighter photo." }, 502);

    const out = call.input as { people: { name: string; values: number[] }[]; confident: boolean; note: string };
    return json({
      mode,
      people: (out.people || []).map((p) => ({
        name: String(p.name || "").slice(0, 40),
        values: (p.values || []).filter((v) => Number.isFinite(v)),
      })),
      confident: !!out.confident,
      note: String(out.note || ""),
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err);
    return json({ error: `Could not read the photo — ${msg}` }, 502);
  }
});
