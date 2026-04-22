// netlify/functions/get-production.js
// Returns the single show and all its performances with response counts.
// MVP: one show per deployment. show_id is set via env variable.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async () => {
  try {
    // 1. Load the show (MVP: one show per deployment)
    const { data: shows, error: showError } = await supabase
      .from("shows")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1);

    if (showError) throw showError;
    if (!shows || shows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ show: null, performances: [], tonight: null }),
      };
    }

    const show = shows[0];

    // 2. Load all performances for this show
    const { data: performances, error: perfError } = await supabase
      .from("performances")
      .select("*")
      .eq("show_id", show.id)
      .order("datetime", { ascending: true });

    if (perfError) throw perfError;

    // 3. Get response counts for each performance
    const performancesWithCounts = await Promise.all(
      (performances || []).map(async (p) => {
        const { count } = await supabase
          .from("responses")
          .select("*", { count: "exact", head: true })
          .eq("performance_id", p.id);
        return { ...p, responses_count: count || 0 };
      })
    );

    // 4. Find tonight's open performance if any
    const tonight = performancesWithCounts.find(p => p.status === "open") || null;

    return {
      statusCode: 200,
      body: JSON.stringify({
        show,
        performances: performancesWithCounts,
        tonight,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
