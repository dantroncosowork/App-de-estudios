export const SCHEMA_VERSION = 1;
export const EXPORT_SOURCE = 'app-de-estudios-chrome-extension';

export const STORAGE_KEYS = {
  PROJECTS: 'study_projects',
  ITEMS: 'study_items',
  LAST_PROJECT_ID: 'study_last_project_id',
  FOCUS_MODE: 'study_focus_mode',
  PENDING_CAPTURE: 'study_pending_capture',
  PENDING_JUMPS: 'study_pending_jumps'
};

export const PROJECT_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#db2777',
  '#4f46e5'
];

const HEX_TO_TAB_GROUP_COLOR = {
  '#2563eb': 'blue',
  '#4f46e5': 'blue',
  '#7c3aed': 'purple',
  '#059669': 'green',
  '#d97706': 'orange',
  '#dc2626': 'red',
  '#0891b2': 'cyan',
  '#db2777': 'pink'
};

const TAB_GROUP_COLOR_TO_HEX = {
  blue: '#2563eb',
  purple: '#7c3aed',
  green: '#059669',
  orange: '#d97706',
  yellow: '#d97706',
  red: '#dc2626',
  cyan: '#0891b2',
  pink: '#db2777',
  grey: '#4f46e5'
};

export function hexToTabGroupColor(hex) {
  if (!hex) return 'blue';
  return HEX_TO_TAB_GROUP_COLOR[String(hex).toLowerCase()] || 'blue';
}

export function tabGroupColorToHex(color) {
  if (!color) return PROJECT_COLORS[0];
  return TAB_GROUP_COLOR_TO_HEX[String(color).toLowerCase()] || PROJECT_COLORS[0];
}

export function normalizeUrlForMatch(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    // Strip hash (#...) and YouTube timestamp param so the same video/page isn't duplicated
    u.hash = '';
    if (u.hostname.includes('youtube.com') || u.hostname === 'youtu.be') {
      u.searchParams.delete('t');
      u.searchParams.delete('time_continue');
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return String(rawUrl).split('#')[0].replace(/\/$/, '');
  }
}

export const SOURCE_META = {
  youtube: { label: 'YouTube', badgeClass: 'source-youtube' },
  coursera: { label: 'Coursera', badgeClass: 'source-coursera' },
  gemini: { label: 'Gemini', badgeClass: 'source-ai' },
  notebooklm: { label: 'NotebookLM', badgeClass: 'source-ai' },
  claude: { label: 'Claude', badgeClass: 'source-ai' },
  chatgpt: { label: 'ChatGPT', badgeClass: 'source-ai' },
  screenshot: { label: 'Captura PC', badgeClass: 'source-screenshot' },
  web: { label: 'Web', badgeClass: 'source-web' }
};

export function createId(prefix) {
  const rand = crypto.randomUUID
    ? crypto.randomUUID().slice(0, 12)
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
}

export function detectSourceType(rawUrl) {
  if (!rawUrl) return 'screenshot';
  try {
    const { hostname } = new URL(rawUrl);
    const host = hostname.toLowerCase();
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.includes('coursera.org')) return 'coursera';
    if (host.includes('notebooklm.google.com')) return 'notebooklm';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    return 'web';
  } catch {
    return 'web';
  }
}

export function isAiSource(sourceType) {
  return ['gemini', 'notebooklm', 'claude', 'chatgpt'].includes(sourceType);
}

export function formatTimestamp(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) {
    return '';
  }
  const total = Math.max(0, Math.floor(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function parseTimestampInput(text) {
  if (!text || !text.trim()) return null;
  const cleaned = text.trim().toLowerCase();
  if (/^\d+$/.test(cleaned)) {
    return Math.max(0, parseInt(cleaned, 10));
  }
  if (/^\d+s$/.test(cleaned)) {
    return Math.max(0, parseInt(cleaned.slice(0, -1), 10));
  }
  const hmsMatch = cleaned.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
    const h = Number(hmsMatch[1] || 0);
    const m = Number(hmsMatch[2] || 0);
    const s = Number(hmsMatch[3] || 0);
    return h * 3600 + m * 60 + s;
  }
  const parts = cleaned.split(':').map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

export function extractTimestampFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const candidate =
      parsed.searchParams.get('t') ||
      parsed.searchParams.get('start') ||
      parsed.searchParams.get('time_continue');
    if (candidate) {
      return parseTimestampInput(candidate);
    }
    if (parsed.hash) {
      const hashMatch = parsed.hash.match(/[&#?]t=([^&]+)/i);
      if (hashMatch) {
        return parseTimestampInput(hashMatch[1]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function buildTextFragmentUrl(rawUrl, quote) {
  if (!rawUrl || !quote) return rawUrl || '';
  const normalized = quote.replace(/\s+/g, ' ').trim();
  if (normalized.length < 4) return rawUrl;

  const base = rawUrl.split('#')[0];
  const words = normalized.split(' ');
  let fragment = '';

  if (words.length <= 10 && normalized.length <= 120) {
    fragment = encodeURIComponent(normalized);
  } else {
    const start = words.slice(0, 5).join(' ');
    const end = words.slice(-4).join(' ');
    fragment = `${encodeURIComponent(start)},${encodeURIComponent(end)}`;
  }

  return `${base}#:~:text=${fragment}`;
}

export function buildDeepLinkUrl({ url, sourceType, timestampSec, quote }) {
  if (!url) return '';

  try {
    if (sourceType === 'youtube' && timestampSec !== null && timestampSec !== undefined) {
      const parsed = new URL(url);
      const sec = Math.max(0, Math.floor(Number(timestampSec)));
      parsed.searchParams.set('t', `${sec}s`);
      return parsed.toString();
    }

    if (sourceType === 'coursera' && timestampSec !== null && timestampSec !== undefined) {
      // Keep clean URL (Coursera SPA ignores ?t=, so our extension seeks automatically via content script)
      return url.split('#')[0];
    }

    if (quote && quote.trim().length >= 4 && !isAiSource(sourceType)) {
      return buildTextFragmentUrl(url, quote);
    }

    return url;
  } catch {
    return url;
  }
}

export function normalizeCategories(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const clean = String(entry).trim().replace(/^#/, '');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createExportPayload({ projects, items, includeImages = true }) {
  const sanitizedItems = items.map((item) => {
    if (includeImages || !item.image) return item;
    return {
      ...item,
      image: null
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: EXPORT_SOURCE,
    projects,
    items: sanitizedItems
  };
}

export function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('El archivo no contiene un objeto JSON válido.');
  }
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!projects.length && !items.length) {
    throw new Error('El archivo JSON no contiene proyectos ni capturas.');
  }
  return { projects, items };
}
