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

/* ---------------------- Ops team mapping ---------------------- */
const USER_ID_TO_NAME = {
  'c0ccc544-c4c3-4a32-9d3b-23a500383b0b': 'Brazil',
  '080c42c6-fbb2-47d6-9774-1d086c7c3210': 'Nishanth',
  'ff3909f8-9fa8-4013-9d12-c1e86f8ebffe': 'Chethan',
  'ec6410cf-b2cb-4ea8-8539-fb973e00a028': 'Derrick'
};

/* --------- Pick next assignee --------- */
async function pickNextAssignee() {
  const ids = Object.keys(USER_ID_TO_NAME);
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
  ids.forEach(id => (counts[id] = 0));
  for (const page of pages.results) {
    const people = page.properties['Assigned To']?.people || [];
    if (people.length) {
      const id = people[0].id;
      if (counts[id] !== undefined) counts[id]++;
    }
  }

  const available = ids.find(id => (counts[id] || 0) < 2);
  return available || ids[0];
}

/* ---------------- Validation helpers ---------------- */
const VALID_CATEGORY = new Set(['Hardware', 'Software', 'Payment', 'Network', 'Other']);
const VALID_SEVERITY = new Set(['S1', 'S2', 'S3', 'S4']);
const VALID_PRIORITY = new Set(['P1', 'P2', 'P3', 'P4']);

function normalizeSelect(value, validSet, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  const v = value.trim();
  return validSet.has(v) ? v : fallback;
}

/* ---------------- Create Notion page ---------------- */
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
  attachments = [],
  isTest = false
}) {
  const title = isTest ? 'SWIFT Connection Test' : (issueSummary || 'Issue');
  const cat = normalizeSelect(category, VALID_CATEGORY, 'Other');
  const sev = normalizeSelect(severity, VALID_SEVERITY, 'S3');
  const pri = normalizeSelect(priority, VALID_PRIORITY, 'P3');
  const assignee = await pickNextAssignee();

  const props = {
    'Issue Title': { title: [{ type: 'text', text: { content: title } }] },
    'Customer/ Tenant': { rich_text: [{ type: 'text', text: { content: customer || '' } }] },
    'Location': { rich_text: [{ type: 'text', text: { content: location || customer || '' } }] },
    'Category': { select: { name: cat } },
    'Severity': { select: { name: sev } },
    'Priority': { select: { name: pri } },
    'Assigned To': { people: [{ id: assignee }] },
    'Status': { select: { name: 'To Do' } },
    'Customer informed': { checkbox: false },
    'Maintenance Report': { rich_text: [] }
  };

  if (intakeNotes) {
    props['Intake Notes'] = { rich_text: [{ type: 'text', text: { content: intakeNotes } }] };
  }
  if (barcode) {
    props['Item Barcode'] = { rich_text: [{ type: 'text', text: { content: barcode } }] };
  }
  if (sessionUrl) {
    props['Session Link'] = { url: sessionUrl };
  }

  const page = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: props
  });

  // Attach uploaded files as Notion file blocks
  if (attachments && attachments.length > 0) {
    for (const fileUrl of attachments) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: [
          {
            object: 'block',
            type: 'file',
            file: { type: 'external', external: { url: fileUrl } }
          }
        ]
      });
    }
  }

  return page;
}

/* ---------------- Mark ticket as resolved ---------------- */
async function markTicketResolved(pageId) {
  const nowISO = new Date().toISOString();
  return await notion.pages.update({
    page_id: pageId,
    properties: {
      'Customer informed': { checkbox: true },
      'Resolved Date': { date: { start: nowISO } },
      'Status': { select: { name: 'Done' } }
    }
  });
}

/* ---------------- Routes ---------------- */
app.get('/health', (_req, res) => res.json({ ok: true, service: 'dtek-support-backend' }));

// ✅ For quick DB connection checks if needed later
app.get('/api/test-notion', async (_req, res) => {
  try {
    const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
    res.json({ ok: true, name: db.title?.[0]?.plain_text || 'Customer Tickets' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Notion test failed', detail: err.message });
  }
});

// ✅ For safe connection testing
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
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to create test ticket', detail: err.message });
  }
});

// ✅ Main ticket creation endpoint
app.post('/api/create-ticket', async (req, res) => {
  try {
    const page = await createNotionPage(req.body);
    res.json({
      ok: true,
      message: "I've informed our team — they’re actively working on it.",
      notion_page_id: page.id
    });
  } catch (err) {
    console.error('❌ Ticket creation failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to create ticket', detail: err.message });
  }
});

// ✅ Mark as resolved endpoint
app.post('/api/mark-resolved', async (req, res) => {
  try {
    const { pageId } = req.body || {};
    if (!pageId)
      return res.status(400).json({ ok: false, error: 'pageId is required' });
    const updated = await markTicketResolved(pageId);
    res.json({
      ok: true,
      pageId: updated.id,
      message: 'Ticket marked as resolved and timer stopped.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to mark resolved', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ SWIFT backend listening on :${PORT}`);
});
