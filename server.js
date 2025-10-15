import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Test Notion connection
app.get("/test-notion", async (req, res) => {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.DATABASE_ID;

    if (!notionToken || !databaseId) {
      return res.status(400).json({
        ok: false,
        error: "Missing NOTION_TOKEN or DATABASE_ID environment variables",
      });
    }

    const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      method: "GET",
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
      message: "✅ Notion connection verified",
      properties: Object.keys(data.properties || {}),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Listen
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
