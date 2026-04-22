// netlify/functions/get-run.js
// Fetches syntheses across N performances, compresses into memory blocks,
// calls Claude Sonnet for run-level pattern reading, returns three layers.

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MIN_PERFORMANCES = 5;

// ── FORMAT RUN MEMORY BLOCKS ──────────────────────────────────────────────────
// Each performance becomes a compressed memory block.
// Claude reads the arc of nights, not individual responses.

function formatRunMemory(performances) {
  return performances.map((p, i) => {
    const s = p.syntheses?.[0];
    if (!s) return null;
    return `
--- NIGHT ${i + 1} (${new Date(p.datetime).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}) ---
Experience: ${s.experience_lens?.slice(0, 300) || ""}
Meaning: ${s.meaning_lens?.slice(0, 300) || ""}
Craft: ${s.craft_lens?.slice(0, 300) || ""}
Residual: ${s.residual_lens?.slice(0, 300) || ""}`;
  }).filter(Boolean).join("\n");
}

// ── PARSE RUN OUTPUT ──────────────────────────────────────────────────────────

function parseRunLayers(text) {
  const layers = {
    stability_layer:  "",
    fractures_layer:  "",
    drift_layer:      "",
    raw_output:       text,
  };

  const patterns = [
    { key: "stability_layer", label: "STABILITY" },
    { key: "fractures_layer", label: "FRACTURES" },
    { key: "drift_layer",     label: "DRIFT" },
  ];

  patterns.forEach(({ key, label }, i) => {
    const nextLabel = patterns[i + 1]?.label;
    const regex = nextLabel
      ? new RegExp(`${label}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n+${nextLabel}|$)`, "i")
      : new RegExp(`${label}[\\s\\S]*?\\n([\\s\\S]*)`, "i");
    const match = text.match(regex);
    if (match) layers[key] = match[1].trim();
  });

  return layers;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analyzing a sequence of live performances of the same production over time.

You are not summarizing nights. You are reading the arc.
Do not refer to "responses", "data", or "participants".
Do not use statistics or counts.
Write as if you are a critical observer who has attended every performance and is now reflecting on what has shifted, what has held, and what is becoming.
Allow contradiction. Name tension explicitly. Never smooth disagreement into consensus.`;

// ── USER PROMPT ───────────────────────────────────────────────────────────────

function buildRunPrompt(formatted, performanceCount) {
  return `The following are collective audience readings from ${performanceCount} performances of the same production, in chronological order.

${formatted}

---

You must output exactly three sections in this order.
Each section = one prose paragraph (5–8 lines) followed by 1–2 short echo fragments that capture the pattern.
If a pattern is changing direction, name it explicitly on a new line beginning with "↳".

1. STABILITY
What has settled and stopped shifting across performances. What the room consistently perceives night after night. The production's established ground.

2. FRACTURES
What refuses to resolve regardless of execution or audience. Structural recurring signals that persist across every night. Name these directly — they are the most actionable layer.

3. DRIFT
How audience understanding or interpretation of the work is evolving over time. Not a change in the performance — a change in how it is being received as its cultural presence accumulates.

Output only the three sections. No preamble. No conclusion.`;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  try {
    const { show_id } = JSON.parse(event.body);

    // 1. Fetch all locked performances for this show with their syntheses
    const { data: performances, error: perfError } = await supabase
      .from("performances")
      .select("id, datetime, performance_number, syntheses(experience_lens, meaning_lens, craft_lens, residual_lens)")
      .eq("show_id", show_id)
      .eq("status", "locked")
      .order("datetime", { ascending: true });

    if (perfError) throw perfError;

    // 2. Gate: minimum performances required
    if (!performances || performances.length < MIN_PERFORMANCES) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          locked: true,
          message: "The run is still finding its shape. Come back after a few more nights.",
          performances_count: performances?.length || 0,
          minimum_required: MIN_PERFORMANCES,
        }),
      };
    }

    // 3. Format into compressed memory blocks
    const formatted = formatRunMemory(performances);

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
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildRunPrompt(formatted, performances.length) }],
      }),
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text;
    if (!rawText) throw new Error("Claude returned no content.");

    // 5. Parse into three layer fields
    const layers = parseRunLayers(rawText);

    // 6. Return to director
    return {
      statusCode: 200,
      body: JSON.stringify({
        locked: false,
        performances_count: performances.length,
        stability_layer: layers.stability_layer,
        fractures_layer: layers.fractures_layer,
        drift_layer:     layers.drift_layer,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
