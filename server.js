// server.js  (CommonJS — works on Render)
const express = require("express");
const cors = require("cors");

// Node 18+ has global fetch; fallback for older runtimes
const fetchFn =
  globalThis.fetch ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const app = express();
app.use(cors());
app.use(express.json());

// ----- ENV -----
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
};

// ----- HELPERS -----
async function notionGetDB() {
  const r = await fetchFn(
    `https://api.notion.com/v1/databases/${DATABASE_ID}`,
    { headers: NOTION_HEADERS }
  );
  const t = await r.text();
  if (!r.ok) throw new Error(`DB fetch failed: ${t}`);
  return JSON.parse(t);
}

async function notionCreatePage(properties, children = []) {
  const body = { parent: { database_id: DATABASE_ID }, properties };
  if (children?.length) body.children = children;
  const r = await fetchFn("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: NOTION_HEADERS,
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return JSON.parse(t);
}

// ----- ROUTES -----
app.get("/", (_req, res) => res.send("DTEK Support Backend is running ✅"));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Verify Notion + list properties
app.get("/test-notion", async (_req, res) => {
  try {
    const db = await notionGetDB();
    res.json({
      ok: true,
      message: "✅ Notion connection verified and aligned.",
      properties: Object.keys(db.properties || {}),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Helper to find database id by name
app.get("/find-database", async (req, res) => {
  try {
    const q = req.query.q || "Customer Tickets";
    const r = await fetchFn("https://api.notion.com/v1/search", {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        query: q,
        filter: { value: "database", property: "object" },
        page_size: 10,
      }),
    });
    const data = await r.json();
    const results = (data.results || []).map((d) => ({
      title: d.title?.[0]?.plain_text || "(untitled)",
      id: (d.id || "").replace(/-/g, ""),
      raw_id: d.id,
    }));
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---- CREATE TEST TICKET (one-click sanity) ----
app.get("/api/create-test-ticket", async (_req, res) => {
  try {
    const props = {
      // A) Issue Title — Title
      "Issue Title": { title: [{ text: { content: "SWIFT Connection Test" } }] },
      // C) Date Reported — Date
      "Date Reported": { date: { start: new Date().toISOString() } },
      // D) Customer/ Tenant — Text
      "Customer/ Tenant": { rich_text: [{ text: { content: "ADNOC 123" } }] },
      // E) Location — Text
      Location: { rich_text: [{ text: { content: "ADNOC 123" } }] },
      // F) Category — Select
      Category: { select: { name: "Other" } },
      // G) Severity — Select (S1–S4)
      Severity: { select: { name: "S4" } },
      // H) Priority — Select (P1–P4)
      Priority: { select: { name: "P4" } },
      // J) Status — Select
      Status: { select: { name: "To Do" } },
      // N) Customer informed — Checkbox
      "Customer informed": { checkbox: false },
      // M) Maintenance Report — Text
      "Maintenance Report": {
        rich_text: [{ text: { content: "Intake: Test ticket path" } }],
      },
    };

    const page = await notionCreatePage(props);
    res.json({
      ok: true,
      ticket_id: page.id,
      url: page.url,
      message: "✅ Test ticket created.",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---- CREATE TICKET (called by Lovable) ----
app.post("/api/create-ticket", async (req, res) => {
  try {
    const {
      intakeContext = {}, // entire intake form object
      issueSummary = "", // one-line title (no location in title)
      followUpFacts = [], // array of strings
      attachments = [], // optional array of external URLs
      category = "Other", // Hardware|Software|Payment|Network|Other
      severity = "S3", // S1–S4
      priority = "P3", // P1–P4
      assignedNotionId = null, // Notion person id (optional)
    } = req.body || {};

    const storeLine =
      intakeContext["Store name + store number/location"] ||
      intakeContext.store ||
      "Unknown";

    // Build Maintenance Report
    const lines = [
      `Intake: ${storeLine}`,
      ...followUpFacts.map((v) => String(v).trim()).filter(Boolean),
    ];
    const maintenanceText = lines.join("\n");

    // Map EXACTLY to Notion schema
    const props = {
      "Issue Title": {
        title: [{ text: { content: issueSummary || "Untitled Ticket" } }],
      }, // A
      "Date Reported": { date: { start: new Date().toISOString() } }, // C
      "Customer/ Tenant": {
        rich_text: [{ text: { content: storeLine } }],
      }, // D
      Location: { rich_text: [{ text: { content: storeLine } }] }, // E
      Category: { select: { name: category } }, // F
      Severity: { select: { name: severity } }, // G
      Priority: { select: { name: priority } }, // H
      Status: { select: { name: "To Do" } }, // J
      "Maintenance Report": {
        rich_text: [{ text: { content: maintenanceText } }],
      }, // M
      "Customer informed": { checkbox: false }, // N
    };

    // I) Assigned To — Person (optional)
    if (assignedNotionId) {
      props["Assigned To"] = { people: [{ id: assignedNotionId }] };
    }

    // (O) Attachments — File (optional): store attachment links as blocks
    const children = [];
    if (attachments?.length) {
      for (const url of attachments) {
        if (!url) continue;
        children.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", text: { content: `Attachment: ${url}`, link: { url } } },
            ],
          },
        });
      }
    }

    const page = await notionCreatePage(props, children);
    res.json({
      ok: true,
      url: page.url,
      message: "✅ Ticket created in Notion.",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ----- START -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server listening on :${PORT}`));
