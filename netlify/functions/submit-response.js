// netlify/functions/submit-response.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  try {
    const { performance_id, felt, meaning, word, stayed } = JSON.parse(event.body);

    const { error } = await supabase
      .from("responses")
      .insert([{ performance_id, felt, meaning, word, stayed }]);

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
