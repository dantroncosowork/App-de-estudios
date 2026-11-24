import {
  STORAGE_KEYS,
  buildDeepLinkUrl,
  createId,
  detectSourceType,
  isAiSource
} from '../shared/schema.js';

const CONTEXT_MENU_PAGE_ID = 'study-capture-page';
const CONTEXT_MENU_SELECTION_ID = 'study-capture-selection';
const CONTEXT_MENU_LINK_ID = 'study-capture-link';

const DEFAULT_PROJECTS = [
  {
    id: 'proj_ingenieria_ia',
    name: 'Ingeniería IA',
    color: '#2563eb',
    createdAt: new Date().toISOString()
  },
  {
    id: 'proj_python',
    name: 'Python',
    color: '#059669',
    createdAt: new Date().toISOString()
  },
  {
    id: 'proj_bolsa',
    name: 'Bolsa y Mercados',
    color: '#d97706',
    createdAt: new Date().toISOString()
  }
];

function isInspectableUrl(url) {
  return Boolean(url && (url.startsWith('http://') || url.startsWith('https://')));
}

async function ensureDefaultProjects() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.PROJECTS, STORAGE_KEYS.ITEMS]);
  const updates = {};
  if (!Array.isArray(data[STORAGE_KEYS.PROJECTS])) {
    updates[STORAGE_KEYS.PROJECTS] = DEFAULT_PROJECTS;
  }
  if (!Array.isArray(data[STORAGE_KEYS.ITEMS])) {
    updates[STORAGE_KEYS.ITEMS] = [];
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

async function setupContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_PAGE_ID,
    title: 'Guardar página / minuto en Estudio',
    contexts: ['page', 'video']
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SELECTION_ID,
    title: 'Guardar cita "%s" en Estudio',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_LINK_ID,
    title: 'Guardar enlace en Estudio',
    contexts: ['link']
  });
}

async function ensureContentScript(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'STUDY_PING' });
    if (ping?.ok) return true;
  } catch {
    // Not injected yet on this tab; try injecting programmatically
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/capture.js']
    });
    return true;
  } catch (err) {
    console.warn('No se pudo inyectar content/capture.js:', err?.message);
    return false;
  }
}

async function extractTabContext(tab, overrides = {}) {
  const url = overrides.url || tab?.url || '';
  const sourceType = detectSourceType(url);
  const fallback = {
    url,
    title: overrides.title || tab?.title || '',
    sourceType,
    timestampSec: null,
    quote: overrides.quote || '',
    tabId: tab?.id ?? null,
    capturedAt: new Date().toISOString()
  };

  if (!tab?.id || !isInspectableUrl(tab.url) || overrides.url) {
    return {
      ...fallback,
      deepLinkUrl: buildDeepLinkUrl(fallback)
    };
  }

  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    return {
      ...fallback,
      deepLinkUrl: buildDeepLinkUrl(fallback)
    };
  }

  try {
    const pageData = await chrome.tabs.sendMessage(tab.id, { type: 'STUDY_EXTRACT_CONTEXT' });
    const merged = {
      ...fallback,
      url: pageData?.url || fallback.url,
      title: pageData?.title || fallback.title,
      sourceType: detectSourceType(pageData?.url || fallback.url),
      timestampSec: pageData?.timestampSec ?? null,
      quote: overrides.quote || pageData?.quote || ''
    };
    return {
      ...merged,
      deepLinkUrl: buildDeepLinkUrl(merged)
    };
  } catch (err) {
    console.warn('Error extrayendo contexto de pestaña:', err?.message);
    return {
      ...fallback,
      deepLinkUrl: buildDeepLinkUrl(fallback)
    };
  }
}

async function flashBadge(text, color = '#2563eb') {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }, 1800);
  } catch {
    // Ignore badge errors
  }
}

async function storePendingCaptureAndNotify(context) {
  const payload = { ...context, nonce: createId('cap') };
  await chrome.storage.session.set({ [STORAGE_KEYS.PENDING_CAPTURE]: payload });
  try {
    await chrome.runtime.sendMessage({ type: 'STUDY_PENDING_CAPTURE_UPDATED', payload });
  } catch {
    // Side panel may still be opening; it will read PENDING_CAPTURE on load
  }
}

async function openSidePanelForTab(tab) {
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
}

async function savePendingJump(tabId, jumpData) {
  const { [STORAGE_KEYS.PENDING_JUMPS]: existing = {} } = await chrome.storage.session.get(
    STORAGE_KEYS.PENDING_JUMPS
  );
  existing[String(tabId)] = {
    ...jumpData,
    createdAt: Date.now()
  };
  await chrome.storage.session.set({ [STORAGE_KEYS.PENDING_JUMPS]: existing });
}

async function consumePendingJump(tabId) {
  const { [STORAGE_KEYS.PENDING_JUMPS]: existing = {} } = await chrome.storage.session.get(
    STORAGE_KEYS.PENDING_JUMPS
  );
  const key = String(tabId);
  const jump = existing[key];
  if (!jump) return null;
  delete existing[key];
  await chrome.storage.session.set({ [STORAGE_KEYS.PENDING_JUMPS]: existing });
  return jump;
}

async function handleOpenItem(item) {
  if (!item) return { ok: false, error: 'Elemento vacío.' };
  const targetUrl = item.deepLinkUrl || item.url;
  if (!targetUrl) return { ok: false, error: 'Este elemento no tiene enlace.' };

  const createdTab = await chrome.tabs.create({ url: targetUrl, active: true });

  const needsCourseraSeek =
    item.sourceType === 'coursera' &&
    item.timestampSec !== null &&
    item.timestampSec !== undefined;
  const needsQuoteScroll =
    Boolean(item.quote && item.quote.trim().length >= 4) && isAiSource(item.sourceType);

  if (createdTab?.id && (needsCourseraSeek || needsQuoteScroll)) {
    await savePendingJump(createdTab.id, {
      sourceType: item.sourceType,
      timestampSec: needsCourseraSeek ? item.timestampSec : null,
      quote: needsQuoteScroll ? item.quote : ''
    });
  }

  return { ok: true, tabId: createdTab?.id ?? null };
}

async function handleStartCrop(tab) {
  if (!tab?.id || !isInspectableUrl(tab.url)) {
    return {
      ok: false,
      error: 'No se puede recortar en esta pestaña (páginas internas de Chrome no lo permiten). Usa Ctrl+V con Win+Shift+S.'
    };
  }

  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    return {
      ok: false,
      error: 'Recarga la pestaña una vez para activar el recorte o pega con Ctrl+V.'
    };
  }

  try {
    const selection = await chrome.tabs.sendMessage(tab.id, { type: 'STUDY_START_CROP' });
    if (!selection?.ok) {
      return { ok: false, cancelled: Boolean(selection?.cancelled), error: selection?.error || '' };
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return {
      ok: true,
      dataUrl,
      rect: selection.rect,
      dpr: selection.dpr || 1
    };
  } catch (err) {
    return { ok: false, error: err?.message || 'Error al capturar la pantalla.' };
  }
}

async function handleCaptureFullTab(tab) {
  if (!tab?.windowId || !isInspectableUrl(tab.url)) {
    return {
      ok: false,
      error: 'No se puede capturar esta pestaña interna. Usa Win+Shift+S y pega con Ctrl+V.'
    };
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: err?.message || 'Error al capturar la pestaña.' };
  }
}

// Configure side panel to open directly when clicking the extension toolbar icon
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.warn('setPanelBehavior error:', err?.message);
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultProjects();
  await setupContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  try {
    // Open side panel immediately while the user gesture is fresh
    await openSidePanelForTab(tab);

    let overrides = {};
    if (info.menuItemId === CONTEXT_MENU_SELECTION_ID && info.selectionText) {
      overrides = { quote: info.selectionText.trim() };
    } else if (info.menuItemId === CONTEXT_MENU_LINK_ID && info.linkUrl) {
      overrides = {
        url: info.linkUrl,
        title: info.selectionText?.trim() || info.linkUrl
      };
    }

    const context = await extractTabContext(tab, overrides);
    await storePendingCaptureAndNotify(context);
    await flashBadge('OK', '#059669');
  } catch (err) {
    console.error('Context menu error:', err);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-capture') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    await openSidePanelForTab(tab);
    const context = await extractTabContext(tab);
    await storePendingCaptureAndNotify(context);
  } catch (err) {
    console.error('Command error:', err);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isInspectableUrl(tab?.url)) return;

  const { [STORAGE_KEYS.PENDING_JUMPS]: existing = {} } = await chrome.storage.session.get(
    STORAGE_KEYS.PENDING_JUMPS
  );
  const jump = existing[String(tabId)];
  if (!jump) return;

  // Expire stale jumps older than 2 minutes
  if (Date.now() - jump.createdAt > 120000) {
    await consumePendingJump(tabId);
    return;
  }

  await consumePendingJump(tabId);
  const ready = await ensureContentScript(tabId);
  if (!ready) return;

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'STUDY_RESTORE_POSITION',
      timestampSec: jump.timestampSec,
      quote: jump.quote,
      sourceType: jump.sourceType
    });
  } catch (err) {
    console.warn('No se pudo restaurar la posición en la pestaña:', err?.message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === 'STUDY_GET_ACTIVE_TAB_CONTEXT') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          sendResponse({ ok: false, error: 'No hay pestaña activa.' });
          return;
        }
        const context = await extractTabContext(tab);
        sendResponse({ ok: true, context });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error leyendo pestaña.' });
      }
    })();
    return true;
  }

  if (message.type === 'STUDY_REQUEST_CROP') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = await handleStartCrop(tab);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error iniciando recorte.' });
      }
    })();
    return true;
  }

  if (message.type === 'STUDY_REQUEST_FULL_CAPTURE') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = await handleCaptureFullTab(tab);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error capturando pestaña.' });
      }
    })();
    return true;
  }

  if (message.type === 'STUDY_OPEN_ITEM') {
    (async () => {
      try {
        const result = await handleOpenItem(message.item);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error abriendo enlace.' });
      }
    })();
    return true;
  }
});
