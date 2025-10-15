import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// --- Health Check ---
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// --- Test Notion Connection ---
app.get("/test-notion", async (req, res) => {
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.DATABASE_ID;

  if (!notionToken || !databaseId) {
    return res.status(400).json({
      ok: false,
      error: "Missing NOTION_TOKEN or DATABASE_ID environment variables.",
    });
  }

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
      },
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        notion_error: data,
      });
    }

    res.json({
      ok: true,
      message: "✅ Notion connection verified and aligned.",
      properties: Object.keys(data.properties || {}),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

// --- Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
