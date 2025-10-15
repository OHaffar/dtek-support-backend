import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/test-notion", async (req, res) => {
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}`, {
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28"
      }
    });

    const data = await response.json();
    if (data.object === "database") {
      res.json({ ok: true, message: "✅ Notion connection verified and aligned." });
    } else {
      res.status(400).json({ ok: false, error: data });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
