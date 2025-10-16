// server.cjs
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');

const { NOTION_TOKEN, DATABASE_ID } = process.env;

if (!NOTION_TOKEN || !DATABASE_ID) {
  console.error('❌ Missing NOTION_TOKEN or DATABASE_ID');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🧩 OPERATIONS TEAM (User ID to Name)
const USER_ID_TO_NAME = {
  'c0ccc544-c4c3-4a32-9d3b-23a500383b0b': 'Brazil',
  '080c42c6-fbb2-47d6-9774-1d086c7c3210': 'Nishanth',
  'ff3909f8-9fa8-4013-9d12-c1e86f8ebffe': 'Chethan',
  'ec6410cf-b2cb-4ea8-8539-fb973e00a028': 'Derrick'
};

// ✅ Helper: pick next assignee (round robin, max 2 open tickets each)
async function pickNextAssignee() {
  const userIds = Object.keys(USER_ID_TO_NAME);

  const pages = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        { property: 'Status', select: { does_not_equal: 'Done' } },
        { property: 'Assigned To', people: { is_not_empty: true } }
      ]
    }
  });

  const counts = {};
  for (const id of userIds) counts[id] = 0;
  for (const page of pages.results) {
    const assigned = page.properties['Assigned To']?.people || [];
    if (assigned.length > 0) {
      const id = assigned[0].id;
      if (counts[id] !== undefined) counts[id]++;
    }
  }

  for (const id of userIds) {
    if ((counts[id] || 0) < 2) {
      return id;
    }
  }
  return userIds[0]; // default to first (Brazil)
}

// 🧱 VALIDATION HELPERS
const VALID_CATEGORY = new Set(['Hardware', 'Software', 'Payment', 'Network', 'Other']);
const VALID_SEVERITY = new Set(['S1', 'S2', 'S3', 'S4']);
const VALID_PRIORITY = new Set(['P1', 'P2', 'P3', 'P4']);

function normalizeSelect(value, validSet, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  const v = value.trim();
  return validSet.has(v) ? v : fallback;
}

// 🏗️ Create Notion Page
async function createNotionPage({
  issueSummary,
  customer,
  location,
  category,
  severity,
  priority,
  barcode,
  intakeNotes,
  sessionUrl,
  isTest = false
}) {
  const title = isTest ? 'SWIFT Connection Test' : (issueSummary || 'Issue');
  const cat = normalizeSelect(category, VALID_CATEGORY, 'Other');
  const sev = normalizeSelect(severity, VALID_SEVERITY, 'S3');
  const pri = normalizeSelect(priority, VALID_PRIORITY, 'P3');
  const assignedId = await pickNextAssignee();

  const properties = {
    'Issue Title': { title: [{ type: 'text', text: { content: title } }] },
    'Customer/ Tenant': { rich_text: [{ type: 'text', text: { content: customer || '' } }] },
    'Location': { rich_text: [{ type: 'text', text: { content: location || customer || '' } }] },
    'Category': { select: { name: cat } },
    'Severity': { select: { name: sev } },
    'Priority': { select: { name: pri } },
    'Status': { select: { name: 'To Do' } },
    'Customer informed': { checkbox: false },
    'Maintenance Report': { rich_text: [{ type: 'text', text: { content: '' } }] },
    'Assigned To': { people: [{ id: assignedId }] },
  };

  // Optional fields
  if (barcode) properties['Item Barcode'] = { rich_text: [{ text: { content: barcode } }] };
  if (intakeNotes) properties['Intake notes'] = { rich_text: [{ text: { content: intakeNotes } }] };
  if (sessionUrl) properties['Session Link'] = { url: sessionUrl };

  return await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties
  });
}

// 🌐 ROUTES
app.get('/health', (_req, res) => res.json({ ok: true, service: 'dtek-support-backend' }));

app.get('/test-notion', async (_req, res) => {
  try {
    const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
    const propNames = Object.keys(db.properties || {});
    res.json({ ok: true, message: 'Notion connection verified.', properties: propNames });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Notion connection failed', detail: String(err.message) });
  }
});

app.post('/api/create-test-ticket', async (_req, res) => {
  try {
    const page = await createNotionPage({
      issueSummary: 'SWIFT Connection Test',
      customer: 'System',
      location: 'System',
      category: 'Other',
      severity: 'S4',
      priority: 'P4',
      isTest: true
    });
    res.json({ ok: true, notion_page_id: page.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to create test ticket', detail: String(err.message) });
  }
});

app.post('/api/create-ticket', async (req, res) => {
  try {
    const {
      issueSummary,
      customer,
      location,
      category,
      severity,
      priority,
      barcode,
      intakeNotes,
      sessionUrl
    } = req.body || {};

    if (!issueSummary) return res.status(400).json({ ok: false, error: 'issueSummary is required' });

    const page = await createNotionPage({
      issueSummary,
      customer,
      location: location || customer,
      category,
      severity,
      priority,
      barcode,
      intakeNotes,
      sessionUrl
    });

    res.json({
      ok: true,
      message: "I've informed our team — they’re actively working on it.",
      notion_page_id: page.id
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to create ticket', detail: String(err.message) });
  }
});

// ✅ NEW: Mark Resolved API (sets time)
app.post('/api/mark-resolved', async (req, res) => {
  try {
    const { pageId } = req.body;
    if (!pageId) return res.status(400).json({ ok: false, error: 'pageId is required' });

    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Customer informed': { checkbox: true },
        'Resolved Date': { date: { start: new Date().toISOString() } },
        'Status': { select: { name: 'Done' } }
      }
    });

    res.json({ ok: true, message: 'Ticket marked as resolved and timer stopped.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to mark resolved', detail: String(err.message) });
  }
});

app.listen(PORT, () => console.log(`✅ SWIFT backend running on :${PORT}`));
