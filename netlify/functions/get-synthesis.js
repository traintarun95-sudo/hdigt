// netlify/functions/get-synthesis.js
// Fetches responses for a performance, formats them, calls Claude Sonnet,
// parses the four lenses, stores in Supabase, returns to director.

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── FORMAT RESPONSES ──────────────────────────────────────────────────────────
// This is the most important layer. Clean structured memory blocks,
// not raw JSON. Claude reads a room, not a dataset.

function formatResponses(performance, responses) {
  const header = `PERFORMANCE: ${performance.show_title} #${performance.performance_number}
DATE: ${new Date(performance.datetime).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
RESPONSES: ${responses.length}`;

  const blocks = responses.map((r, i) => `
--- RESPONSE ${i + 1} ---
Felt: ${r.felt || ""}
Meaning: ${r.meaning || ""}
Word: ${r.word || ""}
Stayed: ${r.stayed || ""}`).join("\n");

  return `${header}\n${blocks}`;
}

// ── PARSE CLAUDE OUTPUT ───────────────────────────────────────────────────────
// Splits the raw Claude output into four clean lens fields.
// Stores raw output too for debugging.

function parseLenses(text) {
  const lenses = {
    experience_lens: "",
    meaning_lens: "",
    craft_lens: "",
    residual_lens: "",
    raw_output: text,
  };

  const patterns = [
    { key: "experience_lens", label: "EXPERIENCE" },
    { key: "meaning_lens",    label: "MEANING" },
    { key: "craft_lens",      label: "CRAFT" },
    { key: "residual_lens",   label: "RESIDUAL" },
  ];

  patterns.forEach(({ key, label }, i) => {
    const nextLabel = patterns[i + 1]?.label;
    const regex = nextLabel
      ? new RegExp(`${label}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n+${nextLabel}|$)`, "i")
      : new RegExp(`${label}[\\s\\S]*?\\n([\\s\\S]*)`, "i");
    const match = text.match(regex);
    if (match) lenses[key] = match[1].trim();
  });

  return lenses;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are reading a collective audience reflection of a live performance.

Do not summarize data. Do not refer to "responses" or "participants".
Do not use statistics, percentages, or counts.
Do not attribute anything to individuals.
Write as if you are interpreting a shared memory of the room.
Allow contradiction. Allow tension. Never flatten disagreement.`;

// ── USER PROMPT ───────────────────────────────────────────────────────────────

function buildPrompt(formatted) {
  return `${formatted}

---

You must output exactly four sections in this order.
Each section = one prose paragraph (5–8 lines) followed by 2–3 short echo fragments in italics (drawn from the language of the room, not invented).
If the room diverged on something, name it explicitly on a new line beginning with "↳".

1. EXPERIENCE
How the performance was felt collectively in the moment. Emotional texture, attention, immersion, energy shifts.

2. MEANING & CLARITY
How the narrative or intent was understood or fragmented. Where it landed and where it broke.

3. CRAFT INTEGRATION
How performance elements — acting, staging, sound, rhythm, light — were perceived working together or apart.

4. RESIDUAL IMPACT
What stayed with the audience after the performance ended. Images, feelings, moments that persisted.

Output only the four sections. No preamble. No conclusion.`;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  try {
    const { performance_id } = JSON.parse(event.body);

    // 1. Fetch performance metadata
    const { data: performance, error: perfError } = await supabase
      .from("performances")
      .select("*, shows(title)")
      .eq("id", performance_id)
      .single();

    if (perfError) throw perfError;

    // Flatten show title into performance object
    performance.show_title = performance.shows?.title || "Untitled";

    // 2. Fetch all responses for this performance
    const { data: responses, error: respError } = await supabase
      .from("responses")
      .select("felt, meaning, word, stayed")
      .eq("performance_id", performance_id);

    if (respError) throw respError;
    if (!responses || responses.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No responses found for this performance." }),
      };
    }

    // 3. Format into clean memory blocks
    const formatted = formatResponses(performance, responses);

    // 4. Call Claude Sonnet
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(formatted) }],
      }),
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text;
    if (!rawText) throw new Error("Claude returned no content.");

    // 5. Parse into four lens fields
    const lenses = parseLenses(rawText);

    // 6. Store synthesis in Supabase
    const { error: synthError } = await supabase
      .from("syntheses")
      .insert([{
        performance_id,
        experience_lens: lenses.experience_lens,
        meaning_lens:    lenses.meaning_lens,
        craft_lens:      lenses.craft_lens,
        residual_lens:   lenses.residual_lens,
        raw_output:      lenses.raw_output,
      }]);

    if (synthError) throw synthError;

    // 7. Lock the performance
    await supabase
      .from("performances")
      .update({ status: "locked" })
      .eq("id", performance_id);

    // 8. Return to director
    return {
      statusCode: 200,
      body: JSON.stringify({
        experience_lens: lenses.experience_lens,
        meaning_lens:    lenses.meaning_lens,
        craft_lens:      lenses.craft_lens,
        residual_lens:   lenses.residual_lens,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
