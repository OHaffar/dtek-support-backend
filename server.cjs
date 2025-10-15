// server.cjs
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const crypto = require('crypto');

const {
  NOTION_TOKEN,
  DATABASE_ID,
  ASSIGNEE_USER_IDS // optional: "id1,id2,id3"
} = process.env;

if (!NOTION_TOKEN || !DATABASE_ID) {
  console.error('Missing NOTION_TOKEN or DATABASE_ID');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- helpers ---
const VALID_CATEGORY = new Set(['Hardware', 'Software', 'Payment', 'Network', 'Other']);
const VALID_SEVERITY = new Set(['S1', 'S2', 'S3', 'S4']);
const VALID_PRIORITY = new Set(['P1', 'P2', 'P3', 'P4']);

function normalizeSelect(value, validSet, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  const v = value.trim();
  return validSet.has(v) ? v : fallback;
}

function pickAssigneeIdRoundRobin(customerStr) {
  if (!ASSIGNEE_USER_IDS) return null;
  const ids = ASSIGNEE_USER_IDS.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return null;
  const key = (customerStr || 'fallback') + ':' + Date.now().toString().slice(0, -4);
  const h = crypto.createHash('sha1').update(key).digest('hex');
  const idx = parseInt(h.slice(0, 6), 16) % ids.length;
  return ids[idx];
}

async function createNotionPage({
  issueSummary,
  customer,
  location,
  category,
  severity,
  priority,
  isTest = false
}) {
  const title = isTest ? 'SWIFT Connection Test' : (issueSummary || 'Issue');
  const cat = normalizeSelect(category, VALID_CATEGORY, 'Other');
  const sev = normalizeSelect(severity, VALID_SEVERITY, 'S3');
  const pri = normalizeSelect(priority, VALID_PRIORITY, 'P3');

  const assignedId = pickAssigneeIdRoundRobin(customer || location || '');

  const properties = {
    'Issue Title': {
      title: [{ type: 'text', text: { content: title } }]
    },
    'Customer/ Tenant': {
      rich_text: [{ type: 'text', text: { content: customer || '' } }]
    },
    'Location': {
      rich_text: [{ type: 'text', text: { content: location || customer || '' } }]
    },
    'Category': {
      select: { name: cat }
    },
    'Severity': {
      select: { name: sev }
    },
    'Priority': {
      select: { name: pri }
    },
    'Status': {
      select: { name: 'To Do' }
    },
    'Customer informed': {
      checkbox: false
    },
    'Maintenance Report': {
      rich_text: [{
        type: 'text',
        text: {
          content: isTest
            ? `Intake: Automated connectivity test @ ${new Date().toISOString()}`
            : `Intake: ${[
                issueSummary ? `Issue: ${issueSummary}` : null,
                customer ? `Customer: ${customer}` : null,
                location ? `Location: ${location}` : null,
                category ? `Category: ${cat}` : null,
                severity ? `Severity: ${sev}` : null,
                priority ? `Priority: ${pri}` : null
              ].filter(Boolean).join(' | ')}`
        }
      }]
    }
  };

  if (assignedId) {
    properties['Assigned To'] = { people: [{ id: assignedId }] };
  }

  return await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties
  });
}

// --- routes ---
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'dtek-support-backend' });
});

app.get('/test-notion', async (_req, res) => {
  try {
    const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
    const propNames = Object.keys(db.properties || {});
    const hasCategory = propNames.includes('Category');
    res.json({
      ok: true,
      message: 'Notion connection verified and aligned.',
      properties: propNames,
      categoryFieldOK: hasCategory
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Notion connection failed', detail: String(err.message || err) });
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
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to create test ticket', detail: String(err.message || err) });
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
      priority
    } = req.body || {};

    if (!issueSummary) {
      return res.status(400).json({ ok: false, error: 'issueSummary is required' });
    }

    const page = await createNotionPage({
      issueSummary,
      customer,
      location: location || customer,
      category,
      severity,
      priority
    });

    res.json({
      ok: true,
      message: "I've informed the operations team — they’re actively working on it.",
      notion_page_id: page.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to create ticket', detail: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`SWIFT backend listening on :${PORT}`);
});
