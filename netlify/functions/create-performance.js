// netlify/functions/create-performance.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  try {
    const { show_title, venue, director_email, performance_name } = JSON.parse(event.body);

    // 1. Create or find show
    let show_id;
    const { data: existing } = await supabase
      .from("shows")
      .select("id")
      .eq("director_email", director_email)
      .eq("title", show_title)
      .single();

    if (existing) {
      show_id = existing.id;
    } else {
      const { data: newShow, error: showError } = await supabase
        .from("shows")
        .insert([{ title: show_title, venue, director_email }])
        .select()
        .single();
      if (showError) throw showError;
      show_id = newShow.id;
    }

    // 2. Count existing performances for this show
    const { count } = await supabase
      .from("performances")
      .select("*", { count: "exact", head: true })
      .eq("show_id", show_id);

    // 3. Create performance
    const { data: performance, error: perfError } = await supabase
      .from("performances")
      .insert([{
        show_id,
        performance_number: (count || 0) + 1,
        datetime: new Date().toISOString(),
        status: "open",
        name: performance_name || null,
      }])
      .select()
      .single();

    if (perfError) throw perfError;

    return {
      statusCode: 200,
      body: JSON.stringify({
        show_id,
        performance_id: performance.id,
        performance_number: performance.performance_number,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
