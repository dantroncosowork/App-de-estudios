import {
  STORAGE_KEYS,
  buildDeepLinkUrl,
  createId,
  detectSourceType,
  extractTimestampFromUrl,
  hexToTabGroupColor,
  isAiSource,
  normalizeUrlForMatch,
  tabGroupColorToHex
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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return tab;
  const [fallback] = await chrome.tabs.query({ active: true, currentWindow: true });
  return fallback || null;
}

async function getTargetWindow() {
  try {
    return await chrome.windows.getLastFocused({ populate: true });
  } catch {
    return await chrome.windows.getCurrent({ populate: true });
  }
}

async function ensureDefaultProjects() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.ITEMS,
    STORAGE_KEYS.FOCUS_MODE
  ]);
  const updates = {};
  if (!Array.isArray(data[STORAGE_KEYS.PROJECTS])) {
    updates[STORAGE_KEYS.PROJECTS] = DEFAULT_PROJECTS;
  }
  if (!Array.isArray(data[STORAGE_KEYS.ITEMS])) {
    updates[STORAGE_KEYS.ITEMS] = [];
  }
  if (typeof data[STORAGE_KEYS.FOCUS_MODE] !== 'boolean') {
    updates[STORAGE_KEYS.FOCUS_MODE] = true;
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
    // Not injected yet on this tab; inject programmatically
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

// Runs directly across ALL frames of a tab so YouTube, Shorts, Coursera, and embedded iframes always report exact currentTime
function probeFrameMediaAndSelection() {
  const parseClock = (txt) => {
    if (!txt) return null;
    const parts = txt.trim().split(':').map((n) => Number(n));
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  };

  let timestampSec = null;
  let videoPriority = 0;

  const shortsVideo = document.querySelector('ytd-reel-video-renderer[is-active] video');
  if (shortsVideo && Number.isFinite(shortsVideo.currentTime) && shortsVideo.readyState >= 1) {
    timestampSec = Math.floor(shortsVideo.currentTime);
    videoPriority = 100;
  }

  if (videoPriority < 90) {
    const ytMain = document.querySelector('#movie_player video.html5-main-video, video.html5-main-video');
    if (ytMain && Number.isFinite(ytMain.currentTime) && (ytMain.currentTime > 0 || ytMain.duration > 1)) {
      timestampSec = Math.floor(ytMain.currentTime);
      videoPriority = 95;
    }
  }

  if (videoPriority < 90) {
    const videos = Array.from(document.querySelectorAll('video'));
    let bestScore = -1;
    for (const v of videos) {
      if (!Number.isFinite(v.currentTime)) continue;
      if (v.currentTime <= 0 && !(Number.isFinite(v.duration) && v.duration > 1)) continue;
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      let score = 0;
      if (!v.paused && !v.ended) score += 100000;
      if (v.currentTime > 0) score += 50000;
      if (area > 0) score += Math.min(area, 40000);
      if (score > bestScore) {
        bestScore = score;
        timestampSec = Math.floor(v.currentTime);
        videoPriority = v.currentTime > 0 ? 80 : 40;
      }
    }
  }

  if (timestampSec === null || timestampSec === 0) {
    const clockEl = document.querySelector('#movie_player .ytp-time-current, .ytp-time-current');
    if (clockEl?.textContent) {
      const parsed = parseClock(clockEl.textContent);
      if (parsed !== null && (timestampSec === null || parsed > 0)) {
        timestampSec = parsed;
        videoPriority = Math.max(videoPriority, 85);
      }
    }
  }

  const rawSel = window.getSelection ? window.getSelection().toString() : '';
  const quote = rawSel.replace(/\s+/g, ' ').trim().slice(0, 1800);

  return {
    isTop: window === window.top,
    url: window.location.href,
    title: (document.title || '').replace(/^\(\d+\)\s+/, '').trim(),
    timestampSec,
    videoPriority,
    quote
  };
}

async function extractTabContext(tab, overrides = {}) {
  const url = overrides.url || tab?.url || '';
  const sourceType = detectSourceType(url);
  const urlTimestamp = extractTimestampFromUrl(url);

  const fallback = {
    url,
    title: overrides.title || (tab?.title || '').replace(/^\(\d+\)\s+/, '').trim(),
    sourceType,
    timestampSec: urlTimestamp,
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

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: probeFrameMediaAndSelection
    });

    const frames = (results || []).map((r) => r?.result).filter(Boolean);
    const topFrame = frames.find((f) => f.isTop) || frames[0];

    let bestTimestamp = urlTimestamp;
    let bestPriority = -1;
    let bestQuote = overrides.quote || '';

    for (const frame of frames) {
      if (frame.timestampSec !== null && frame.videoPriority > bestPriority) {
        bestTimestamp = frame.timestampSec;
        bestPriority = frame.videoPriority;
      }
      if (!bestQuote && frame.quote) {
        bestQuote = frame.quote;
      }
    }

    const finalUrl = topFrame?.url || fallback.url;
    const finalSource = detectSourceType(finalUrl);
    const merged = {
      ...fallback,
      url: finalUrl,
      title: topFrame?.title || fallback.title,
      sourceType: finalSource,
      timestampSec: bestTimestamp,
      quote: bestQuote
    };

    return {
      ...merged,
      deepLinkUrl: buildDeepLinkUrl(merged)
    };
  } catch (err) {
    console.warn('Error sondeando pestaña:', err?.message);
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
    setTimeout(async () => {
      try {
        await chrome.action.setBadgeText({ text: '' });
      } catch {
        // Ignore
      }
    }, 1800);
  } catch {
    // Ignore
  }
}

async function storePendingCaptureAndNotify(context) {
  const payload = { ...context, nonce: createId('cap') };
  await chrome.storage.session.set({ [STORAGE_KEYS.PENDING_CAPTURE]: payload });
  try {
    await chrome.runtime.sendMessage({ type: 'STUDY_PENDING_CAPTURE_UPDATED', payload });
  } catch {
    // Side panel may still be opening; it will read PENDING_CAPTURE on init
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

function buildJumpSpec(item) {
  const needsCourseraSeek =
    item.sourceType === 'coursera' &&
    item.timestampSec !== null &&
    item.timestampSec !== undefined;
  const needsQuoteScroll =
    Boolean(item.quote && item.quote.trim().length >= 4) && isAiSource(item.sourceType);
  const needsAreaScroll = Boolean(item.pageAnchor);

  if (!needsCourseraSeek && !needsQuoteScroll && !needsAreaScroll) {
    return null;
  }

  return {
    sourceType: item.sourceType,
    timestampSec: needsCourseraSeek ? item.timestampSec : null,
    quote: needsQuoteScroll ? item.quote : '',
    pageAnchor: needsAreaScroll ? item.pageAnchor : null
  };
}

async function dispatchImmediateJump(tabId, jump) {
  const ready = await ensureContentScript(tabId);
  if (!ready) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'STUDY_RESTORE_POSITION',
      timestampSec: jump.timestampSec,
      quote: jump.quote,
      sourceType: jump.sourceType,
      pageAnchor: jump.pageAnchor || null
    });
  } catch {
    // Ignore if tab is reloading
  }
}

async function findOrCreateTabGroup(windowId, title, colorHex, tabIds) {
  if (!tabIds || tabIds.length === 0) return null;
  const cleanTitle = (title || 'Estudio').trim();
  const groupColor = hexToTabGroupColor(colorHex);

  const existingGroups = await chrome.tabGroups.query({ windowId });
  const match = existingGroups.find(
    (g) => (g.title || '').trim().toLowerCase() === cleanTitle.toLowerCase()
  );

  let groupId;
  if (match) {
    groupId = await chrome.tabs.group({ groupId: match.id, tabIds });
  } else {
    groupId = await chrome.tabs.group({ createProperties: { windowId }, tabIds });
  }

  await chrome.tabGroups.update(groupId, {
    title: cleanTitle,
    color: groupColor,
    collapsed: false
  });

  return groupId;
}

async function collapseOtherTabGroups(windowId, keepGroupId) {
  const groups = await chrome.tabGroups.query({ windowId });
  for (const g of groups) {
    if (g.id !== keepGroupId && !g.collapsed) {
      try {
        await chrome.tabGroups.update(g.id, { collapsed: true });
      } catch {
        // Ignore locked/closing groups
      }
    }
  }
}

async function handleOpenItem({ item, project }) {
  if (!item) return { ok: false, error: 'Elemento vacío.' };
  const targetUrl = item.deepLinkUrl || item.url;
  if (!targetUrl) return { ok: false, error: 'Este elemento no tiene enlace.' };

  const win = await getTargetWindow();
  const windowId = win?.id;
  const openTabs = win?.tabs || [];
  const normTarget = normalizeUrlForMatch(targetUrl);

  let targetTab = openTabs.find((t) => normalizeUrlForMatch(t.url) === normTarget);
  let reused = false;

  if (targetTab) {
    reused = true;
    const needsUrlUpdate = targetTab.url !== targetUrl;
    if (needsUrlUpdate) {
      targetTab = await chrome.tabs.update(targetTab.id, { url: targetUrl, active: true });
    } else {
      targetTab = await chrome.tabs.update(targetTab.id, { active: true });
    }
  } else {
    targetTab = await chrome.tabs.create({ windowId, url: targetUrl, active: true });
  }

  const jump = buildJumpSpec(item);
  if (targetTab?.id && jump) {
    if (reused && targetTab.status === 'complete' && targetTab.url === targetUrl) {
      await dispatchImmediateJump(targetTab.id, jump);
    } else {
      await savePendingJump(targetTab.id, jump);
    }
  }

  // Place tab automatically inside the Project's Chrome Tab Group
  if (targetTab?.id && windowId && project?.name) {
    try {
      await findOrCreateTabGroup(windowId, project.name, project.color, [targetTab.id]);
    } catch (err) {
      console.warn('No se pudo agrupar pestaña:', err?.message);
    }
  }

  return { ok: true, tabId: targetTab?.id ?? null, reused };
}

async function handleLaunchGroup({ groupTitle, groupColorHex, items, focusMode = true }) {
  const validItems = (items || []).filter((it) => isInspectableUrl(it?.deepLinkUrl || it?.url));
  if (validItems.length === 0) {
    return { ok: false, error: 'No hay enlaces web válidos en este grupo.' };
  }

  const win = await getTargetWindow();
  const windowId = win.id;
  const openTabs = win.tabs || [];

  const seenUrls = new Set();
  const dedupedItems = [];
  for (const item of validItems) {
    const norm = normalizeUrlForMatch(item.deepLinkUrl || item.url);
    if (!seenUrls.has(norm)) {
      seenUrls.add(norm);
      dedupedItems.push(item);
    }
  }

  const tabIds = [];
  let openedCount = 0;
  let reusedCount = 0;

  for (let i = 0; i < dedupedItems.length; i += 1) {
    const item = dedupedItems[i];
    const targetUrl = item.deepLinkUrl || item.url;
    const norm = normalizeUrlForMatch(targetUrl);
    const shouldActivate = i === 0;

    let tab = openTabs.find((t) => normalizeUrlForMatch(t.url) === norm);
    let reused = false;

    if (tab) {
      reused = true;
      reusedCount += 1;
      if (tab.url !== targetUrl) {
        tab = await chrome.tabs.update(tab.id, { url: targetUrl, active: shouldActivate });
      } else if (shouldActivate) {
        tab = await chrome.tabs.update(tab.id, { active: true });
      }
    } else {
      openedCount += 1;
      tab = await chrome.tabs.create({ windowId, url: targetUrl, active: shouldActivate });
    }

    if (tab?.id) {
      tabIds.push(tab.id);
      const jump = buildJumpSpec(item);
      if (jump) {
        if (reused && tab.status === 'complete' && tab.url === targetUrl) {
          await dispatchImmediateJump(tab.id, jump);
        } else {
          await savePendingJump(tab.id, jump);
        }
      }
    }
  }

  const groupId = await findOrCreateTabGroup(windowId, groupTitle, groupColorHex, tabIds);
  if (focusMode && groupId !== null) {
    await collapseOtherTabGroups(windowId, groupId);
  }

  return {
    ok: true,
    groupId,
    openedCount,
    reusedCount,
    totalCount: tabIds.length
  };
}

async function handleListTabGroups() {
  const win = await getTargetWindow();
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  const tabs = win.tabs || [];
  const activeTab = tabs.find((t) => t.active);

  const enriched = groups
    .map((g) => {
      const groupTabs = tabs.filter((t) => t.groupId === g.id && isInspectableUrl(t.url));
      return {
        id: g.id,
        title: g.title || 'Grupo sin nombre',
        color: g.color,
        colorHex: tabGroupColorToHex(g.color),
        collapsed: g.collapsed,
        tabCount: groupTabs.length,
        isActiveGroup: activeTab?.groupId === g.id
      };
    })
    .filter((g) => g.tabCount > 0);

  return { ok: true, groups: enriched };
}

async function handleCaptureTabGroup(groupId) {
  const group = await chrome.tabGroups.get(groupId);
  const tabs = await chrome.tabs.query({ groupId });
  const inspectableTabs = tabs.filter((t) => isInspectableUrl(t.url));

  if (inspectableTabs.length === 0) {
    return { ok: false, error: 'Este grupo no tiene páginas web guardables.' };
  }

  const contexts = await Promise.all(inspectableTabs.map((t) => extractTabContext(t)));

  return {
    ok: true,
    group: {
      id: group.id,
      title: group.title || 'Grupo importado',
      color: group.color,
      colorHex: tabGroupColorToHex(group.color)
    },
    contexts
  };
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
      dpr: selection.dpr || 1,
      pageAnchor: selection.pageAnchor || null
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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-capture') return;

  if (tab?.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }

  (async () => {
    try {
      const targetTab = tab || (await getActiveTab());
      if (!targetTab) return;
      if (!tab?.windowId && targetTab.windowId) {
        await openSidePanelForTab(targetTab);
      }
      const context = await extractTabContext(targetTab);
      await storePendingCaptureAndNotify(context);
      await flashBadge('OK', '#059669');
    } catch (err) {
      console.error('Command error:', err);
    }
  })();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.runtime.sendMessage({ type: 'STUDY_ACTIVE_TAB_CHANGED', tabId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isInspectableUrl(tab?.url)) return;

  const { [STORAGE_KEYS.PENDING_JUMPS]: existing = {} } = await chrome.storage.session.get(
    STORAGE_KEYS.PENDING_JUMPS
  );
  const jump = existing[String(tabId)];
  if (!jump) return;

  if (Date.now() - jump.createdAt > 120000) {
    await consumePendingJump(tabId);
    return;
  }

  await consumePendingJump(tabId);
  await dispatchImmediateJump(tabId, jump);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === 'STUDY_GET_ACTIVE_TAB_CONTEXT') {
    (async () => {
      try {
        const tab = await getActiveTab();
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
        const tab = await getActiveTab();
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
        const tab = await getActiveTab();
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
        const result = await handleOpenItem({
          item: message.item,
          project: message.project
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error abriendo enlace.' });
      }
    })();
    return true;
  }

  if (message.type === 'STUDY_LAUNCH_GROUP') {
    (async () => {
      try {
        const result = await handleLaunchGroup({
          groupTitle: message.groupTitle,
          groupColorHex: message.groupColorHex,
          items: message.items,
          focusMode: message.focusMode
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error lanzando grupo.' });
      }
    })();
    return true;
  }

  if (message.type === 'STUDY_LIST_TAB_GROUPS') {
    (async () => {
      try {
        const result = await handleListTabGroups();
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error listando Tab Groups.' });
      }
    })();
    return true;
  }

  if (message.type === 'STUDY_CAPTURE_TAB_GROUP') {
    (async () => {
      try {
        const result = await handleCaptureTabGroup(message.groupId);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Error importando Tab Group.' });
      }
    })();
    return true;
  }
});
