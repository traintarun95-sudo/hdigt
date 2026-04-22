// netlify/functions/echo.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    const { question, answer } = JSON.parse(event.body);

    const prompt = `You are an interpretive reflection layer inside a live performance feedback system.

A participant has answered a question about a live performance.

Return ONE sentence only (8–18 words).
No analysis. No judgment. No praise. No mention of system or AI.
Reflect the emotional or perceptual tone of what they said.
It should feel like a quiet human echo, not feedback.

Question: ${question}
Answer: ${answer}

Return only the sentence.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 80,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const echo = data.content?.[0]?.text?.trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ echo }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
