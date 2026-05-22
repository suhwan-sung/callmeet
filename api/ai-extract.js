export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const { text } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error:'API 키가 설정되지 않았습니다'});
  const today = new Date().toISOString().split("T")[0];
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: `Extract agreed-upon appointments from Korean text. Today:${today}. Return ONLY raw JSON array. Schema:[{"date":"YYYY-MM-DD","time":"HH:MM or null","title":"Korean","people":"or null","location":"or null","notes":"or null"}]. Return [] if none.`,
        messages: [{ role: "user", content: `대화:\n${text}` }]
      })
    });
    const data = await response.json();
    const raw = data.content?.find(b => b.type === "text")?.text || "[]";
    const result = JSON.parse(raw.replace(/```json|```/g,"").trim());
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
