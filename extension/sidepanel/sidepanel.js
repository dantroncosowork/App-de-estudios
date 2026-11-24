import {
  PROJECT_COLORS,
  SOURCE_META,
  STORAGE_KEYS,
  buildDeepLinkUrl,
  createExportPayload,
  createId,
  detectSourceType,
  extractTimestampFromUrl,
  formatBytes,
  formatTimestamp,
  normalizeCategories,
  normalizeUrlForMatch,
  parseTimestampInput,
  validateImportPayload
} from '../shared/schema.js';

const MAX_SAFE_LAUNCH_TABS = 8;

const state = {
  activeTab: 'capture',
  projects: [],
  items: [],
  selectedProjectId: '',
  detectedTitle: '',
  categoriesDraft: [],
  attachedImage: null,
  pageAnchor: null,
  selectedColor: PROJECT_COLORS[0],
  filterCategory: 'all',
  focusMode: true,
  collapsedProjects: new Set(),
  draggingItemId: null,
  pendingDeleteId: null,
  pendingMoveItemId: null,
  pendingLaunchSpec: null,
  availableChromeGroups: [],
  selectedImportGroupId: null
};

const els = {
  tabCapture: document.getElementById('tab-capture'),
  tabLibrary: document.getElementById('tab-library'),
  libraryCount: document.getElementById('library-count'),
  statusBanner: document.getElementById('status-banner'),
  viewCapture: document.getElementById('view-capture'),
  viewLibrary: document.getElementById('view-library'),

  btnDetectTab: document.getElementById('btn-detect-tab'),
  btnCropTab: document.getElementById('btn-crop-tab'),
  btnFullCapture: document.getElementById('btn-full-capture'),

  captureForm: document.getElementById('capture-form'),
  editingItemId: document.getElementById('editing-item-id'),
  detectedSourceBadge: document.getElementById('detected-source-badge'),
  detectedTimestampLabel: document.getElementById('detected-timestamp-label'),
  detectedAnchorPill: document.getElementById('detected-anchor-pill'),
  editingBadge: document.getElementById('editing-badge'),
  detectedPreviewLine: document.getElementById('detected-preview-line'),

  projectPills: document.getElementById('project-pills'),
  btnManageProjects: document.getElementById('btn-manage-projects'),
  categoryPills: document.getElementById('category-pills'),
  inputCategory: document.getElementById('input-category'),
  btnAddCategory: document.getElementById('btn-add-category'),

  inputNote: document.getElementById('input-note'),
  detailsOptional: document.getElementById('details-optional'),
  quoteIndicator: document.getElementById('quote-indicator'),
  inputTitle: document.getElementById('input-title'),
  inputUrl: document.getElementById('input-url'),
  inputTimestamp: document.getElementById('input-timestamp'),
  btnGrabTime: document.getElementById('btn-grab-time'),
  inputQuote: document.getElementById('input-quote'),
  btnClearQuote: document.getElementById('btn-clear-quote'),

  imageDropzone: document.getElementById('image-dropzone'),
  imagePreviewWrap: document.getElementById('image-preview-wrap'),
  btnPreviewImage: document.getElementById('btn-preview-image'),
  imagePreviewEl: document.getElementById('image-preview-el'),
  imageMetaText: document.getElementById('image-meta-text'),
  btnRemoveImage: document.getElementById('btn-remove-image'),
  btnCancelEdit: document.getElementById('btn-cancel-edit'),
  btnSaveCapture: document.getElementById('btn-save-capture'),

  filterQuery: document.getElementById('filter-query'),
  filterProject: document.getElementById('filter-project'),
  filterSource: document.getElementById('filter-source'),
  libraryCategoryFilters: document.getElementById('library-category-filters'),
  toggleFocusMode: document.getElementById('toggle-focus-mode'),
  btnLaunchFiltered: document.getElementById('btn-launch-filtered'),
  btnImportTabGroup: document.getElementById('btn-import-tab-group'),
  libraryList: document.getElementById('library-list'),
  storageSummary: document.getElementById('storage-summary'),
  btnExportFull: document.getElementById('btn-export-full'),
  btnExportLite: document.getElementById('btn-export-lite'),
  btnImportJson: document.getElementById('btn-import-json'),
  inputImportFile: document.getElementById('input-import-file'),

  dialogProjects: document.getElementById('dialog-projects'),
  btnCloseProjects: document.getElementById('btn-close-projects'),
  formNewProject: document.getElementById('form-new-project'),
  inputProjectName: document.getElementById('input-project-name'),
  projectColorPicker: document.getElementById('project-color-picker'),
  projectsManageList: document.getElementById('projects-manage-list'),

  dialogImage: document.getElementById('dialog-image'),
  btnCloseImage: document.getElementById('btn-close-image'),
  lightboxImg: document.getElementById('lightbox-img'),

  dialogConfirmDelete: document.getElementById('dialog-confirm-delete'),
  dialogDeleteDesc: document.getElementById('dialog-delete-desc'),

  dialogConfirmLaunch: document.getElementById('dialog-confirm-launch'),
  dialogLaunchDesc: document.getElementById('dialog-launch-desc'),

  dialogMoveItem: document.getElementById('dialog-move-item'),
  btnCloseMove: document.getElementById('btn-close-move'),
  dialogMoveDesc: document.getElementById('dialog-move-desc'),
  moveProjectChoices: document.getElementById('move-project-choices'),

  dialogImportGroup: document.getElementById('dialog-import-group'),
  btnCloseImportGroup: document.getElementById('btn-close-import-group'),
  importGroupsEmpty: document.getElementById('import-groups-empty'),
  formImportGroup: document.getElementById('form-import-group'),
  importGroupsList: document.getElementById('import-groups-list'),
  importDestExisting: document.getElementById('import-dest-existing'),
  importDestNew: document.getElementById('import-dest-new'),
  importExistingWrap: document.getElementById('import-existing-wrap'),
  importTargetProject: document.getElementById('import-target-project'),
  importGroupCategory: document.getElementById('import-group-category'),
  btnCancelImportGroup: document.getElementById('btn-cancel-import-group'),
  btnSubmitImportGroup: document.getElementById('btn-submit-import-group')
};

let statusTimer = null;

function showStatus(message, type = 'success') {
  if (statusTimer) clearTimeout(statusTimer);
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner ${type === 'error' ? 'is-error' : 'is-success'}`;
  els.statusBanner.hidden = false;
  statusTimer = setTimeout(() => {
    els.statusBanner.hidden = true;
  }, 3400);
}

function setupDialogLightDismissFallback() {
  if ('closedBy' in HTMLDialogElement.prototype) return;

  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

async function loadState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.ITEMS,
    STORAGE_KEYS.LAST_PROJECT_ID,
    STORAGE_KEYS.FOCUS_MODE
  ]);

  state.projects = Array.isArray(data[STORAGE_KEYS.PROJECTS]) ? data[STORAGE_KEYS.PROJECTS] : [];
  state.items = Array.isArray(data[STORAGE_KEYS.ITEMS]) ? data[STORAGE_KEYS.ITEMS] : [];
  state.focusMode = typeof data[STORAGE_KEYS.FOCUS_MODE] === 'boolean' ? data[STORAGE_KEYS.FOCUS_MODE] : true;

  if (state.projects.length === 0) {
    state.projects = [
      { id: 'proj_ingenieria_ia', name: 'Ingeniería IA', color: '#2563eb', createdAt: new Date().toISOString() },
      { id: 'proj_python', name: 'Python', color: '#059669', createdAt: new Date().toISOString() },
      { id: 'proj_bolsa', name: 'Bolsa y Mercados', color: '#d97706', createdAt: new Date().toISOString() }
    ];
    await chrome.storage.local.set({ [STORAGE_KEYS.PROJECTS]: state.projects });
  }

  const savedLast = data[STORAGE_KEYS.LAST_PROJECT_ID];
  state.selectedProjectId = state.projects.some((p) => p.id === savedLast)
    ? savedLast
    : state.projects[0].id;

  els.toggleFocusMode.checked = state.focusMode;
}

async function persistProjects() {
  await chrome.storage.local.set({ [STORAGE_KEYS.PROJECTS]: state.projects });
}

async function persistItems() {
  await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: state.items });
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  const isCapture = tabName === 'capture';
  els.viewCapture.hidden = !isCapture;
  els.viewLibrary.hidden = isCapture;
  els.tabCapture.classList.toggle('is-active', isCapture);
  els.tabLibrary.classList.toggle('is-active', !isCapture);
  els.tabCapture.setAttribute('aria-pressed', String(isCapture));
  els.tabLibrary.setAttribute('aria-pressed', String(!isCapture));

  if (!isCapture) {
    renderLibrary();
  }
}

function getHostnameLabel(rawUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isWebLink(url) {
  return Boolean(url && (url.startsWith('http://') || url.startsWith('https://')));
}

function countUniqueWebLinks(items) {
  const seen = new Set();
  for (const item of items) {
    const url = item.deepLinkUrl || item.url;
    if (isWebLink(url)) {
      seen.add(normalizeUrlForMatch(url));
    }
  }
  return seen.size;
}

function updateSourceIndicators() {
  const url = els.inputUrl.value.trim();
  const sourceType = detectSourceType(url);
  const meta = SOURCE_META[sourceType] || SOURCE_META.web;

  els.detectedSourceBadge.textContent = meta.label;
  els.detectedSourceBadge.className = `source-badge ${meta.badgeClass}`;

  const sec = parseTimestampInput(els.inputTimestamp.value);
  els.detectedTimestampLabel.textContent = sec !== null ? `⏱ ${formatTimestamp(sec)}` : '⏱ --:--';
  els.detectedAnchorPill.hidden = !state.pageAnchor;

  const hasQuote = Boolean(els.inputQuote.value.trim());
  els.btnClearQuote.hidden = !hasQuote;
  els.quoteIndicator.hidden = !hasQuote;

  const displayTitle = els.inputTitle.value.trim() || state.detectedTitle;
  const host = getHostnameLabel(url);
  if (displayTitle && host) {
    els.detectedPreviewLine.textContent = `${displayTitle} · ${host}`;
  } else if (displayTitle) {
    els.detectedPreviewLine.textContent = displayTitle;
  } else if (host) {
    els.detectedPreviewLine.textContent = host;
  } else {
    els.detectedPreviewLine.textContent = state.attachedImage
      ? 'Captura visual lista para guardar'
      : 'Sin página detectada (pulsa ↻ o pega una captura)';
  }
}

function renderProjectPills() {
  if (!state.projects.some((p) => p.id === state.selectedProjectId) && state.projects[0]) {
    state.selectedProjectId = state.projects[0].id;
  }

  els.projectPills.textContent = '';
  for (const project of state.projects) {
    const isSelected = project.id === state.selectedProjectId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'project-choice';
    btn.style.setProperty('--pill-color', project.color);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(isSelected));

    const dot = document.createElement('span');
    dot.className = 'project-dot';
    dot.style.backgroundColor = isSelected ? '#ffffff' : project.color;

    const label = document.createElement('span');
    label.textContent = project.name;

    btn.append(dot, label);
    btn.addEventListener('click', () => {
      state.selectedProjectId = project.id;
      renderProjectPills();
      renderCategoryPills();
    });
    els.projectPills.appendChild(btn);
  }
}

function renderFilterProjectSelect() {
  const prevFilterVal = els.filterProject.value || 'all';
  els.filterProject.textContent = '';

  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'Todos los proyectos';
  els.filterProject.appendChild(allOpt);

  for (const project of state.projects) {
    const opt = document.createElement('option');
    opt.value = project.id;
    opt.textContent = project.name;
    els.filterProject.appendChild(opt);
  }

  els.filterProject.value =
    prevFilterVal === 'all' || state.projects.some((p) => p.id === prevFilterVal)
      ? prevFilterVal
      : 'all';

  // Also keep Import Target select synced
  const prevImportVal = els.importTargetProject.value || state.selectedProjectId;
  els.importTargetProject.textContent = '';
  for (const project of state.projects) {
    const opt = document.createElement('option');
    opt.value = project.id;
    opt.textContent = project.name;
    els.importTargetProject.appendChild(opt);
  }
  if (state.projects.some((p) => p.id === prevImportVal)) {
    els.importTargetProject.value = prevImportVal;
  }
}

function renderCategoryPills() {
  const freq = new Map();

  for (const item of state.items) {
    if (state.selectedProjectId && item.projectId !== state.selectedProjectId) continue;
    for (const cat of item.categories || []) {
      const key = cat.toLowerCase();
      if (!freq.has(key)) freq.set(key, { label: cat, count: 0 });
      freq.get(key).count += 1;
    }
  }

  const ordered = [];
  const seen = new Set();

  for (const cat of state.categoriesDraft) {
    const key = cat.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push({ key, label: cat, active: true });
    }
  }

  const sortedProjectCats = Array.from(freq.values()).sort((a, b) => b.count - a.count);
  for (const entry of sortedProjectCats) {
    const key = entry.label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push({ key, label: entry.label, active: false });
    }
    if (ordered.length >= 12) break;
  }

  els.categoryPills.textContent = '';
  for (const entry of ordered) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip-btn ${entry.active ? 'is-active' : ''}`;
    btn.setAttribute('aria-pressed', String(entry.active));
    btn.textContent = entry.active ? `#${entry.label} ×` : `#${entry.label}`;
    btn.addEventListener('click', () => {
      if (entry.active) {
        state.categoriesDraft = state.categoriesDraft.filter(
          (c) => c.toLowerCase() !== entry.key
        );
      } else {
        state.categoriesDraft = normalizeCategories([...state.categoriesDraft, entry.label]);
      }
      renderCategoryPills();
    });
    els.categoryPills.appendChild(btn);
  }
}

function addCategoriesFromInput(rawText) {
  const incoming = normalizeCategories(rawText);
  if (incoming.length === 0) return;
  state.categoriesDraft = normalizeCategories([...state.categoriesDraft, ...incoming]);
  renderCategoryPills();
}

function renderAttachedImage() {
  if (!state.attachedImage) {
    els.imagePreviewWrap.hidden = true;
    els.btnRemoveImage.hidden = true;
    els.imagePreviewEl.removeAttribute('src');
    els.imageMetaText.textContent = '';
    return;
  }

  els.imagePreviewEl.src = state.attachedImage.dataUrl;
  els.imageMetaText.textContent = `${state.attachedImage.width}×${state.attachedImage.height} · ${formatBytes(state.attachedImage.sizeBytes)}`;
  els.imagePreviewWrap.hidden = false;
  els.btnRemoveImage.hidden = false;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
    img.src = src;
  });
}

async function compressImageFromSource(imgSource, cropRect = null, dpr = 1) {
  const img = await loadImageElement(imgSource);

  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;

  if (cropRect) {
    sx = Math.max(0, Math.round(cropRect.x * dpr));
    sy = Math.max(0, Math.round(cropRect.y * dpr));
    sw = Math.min(img.naturalWidth - sx, Math.round(cropRect.width * dpr));
    sh = Math.min(img.naturalHeight - sy, Math.round(cropRect.height * dpr));
    if (sw < 10 || sh < 10) {
      throw new Error('El recorte es demasiado pequeño.');
    }
  }

  const maxWidth = 1280;
  const scale = sw > maxWidth ? maxWidth / sw : 1;
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  let dataUrl = canvas.toDataURL('image/webp', 0.82);
  let mimeType = 'image/webp';
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    mimeType = 'image/jpeg';
  }

  const base64Len = dataUrl.split(',')[1]?.length || 0;
  const sizeBytes = Math.round((base64Len * 3) / 4);

  return {
    dataUrl,
    mimeType,
    width: outW,
    height: outH,
    sizeBytes
  };
}

function hasUserDraftInProgress() {
  return Boolean(
    els.editingItemId.value ||
      els.inputNote.value.trim() ||
      els.inputTitle.value.trim() ||
      state.attachedImage
  );
}

async function applyDetectedContext(context) {
  if (!context) return;
  resetEditMode(false);
  state.detectedTitle = context.title || '';
  els.inputTitle.value = '';
  els.inputUrl.value = context.url || '';
  els.inputTimestamp.value =
    context.timestampSec !== null && context.timestampSec !== undefined
      ? formatTimestamp(context.timestampSec)
      : '';
  if (context.quote) {
    els.inputQuote.value = context.quote;
    els.detailsOptional.open = true;
  }
  updateSourceIndicators();
}

async function detectActiveTab(silent = false) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'STUDY_GET_ACTIVE_TAB_CONTEXT' });
    if (!res?.ok) {
      if (!silent) showStatus(res?.error || 'No se pudo leer la pestaña actual.', 'error');
      return;
    }
    await applyDetectedContext(res.context);
    if (!silent) {
      const msg =
        res.context.timestampSec !== null
          ? `Detectado (${formatTimestamp(res.context.timestampSec)}).`
          : 'Pestaña actualizada.';
      showStatus(msg);
    }
  } catch (err) {
    if (!silent) showStatus(err?.message || 'Error detectando pestaña.', 'error');
  }
}

async function checkPendingCaptureFromSession() {
  const data = await chrome.storage.session.get(STORAGE_KEYS.PENDING_CAPTURE);
  const pending = data[STORAGE_KEYS.PENDING_CAPTURE];
  if (!pending) return false;
  await chrome.storage.session.remove(STORAGE_KEYS.PENDING_CAPTURE);
  setActiveTab('capture');
  await applyDetectedContext(pending);
  showStatus('Contexto cargado. Pulsa Guardar o añade una nota.');
  els.inputNote.focus();
  return true;
}

function resetCaptureForm(clearAll = true) {
  els.editingItemId.value = '';
  els.editingBadge.hidden = true;
  els.btnCancelEdit.hidden = true;
  els.btnSaveCapture.textContent = 'Guardar';

  if (clearAll) {
    els.inputTitle.value = '';
    els.inputCategory.value = '';
    els.inputQuote.value = '';
    els.inputNote.value = '';
    els.detailsOptional.open = false;
    state.categoriesDraft = [];
    state.attachedImage = null;
    state.pageAnchor = null;
    renderCategoryPills();
    renderAttachedImage();
    updateSourceIndicators();
  }
}

function resetEditMode(clearFields = true) {
  if (!els.editingItemId.value && !clearFields) return;
  resetCaptureForm(clearFields);
}

function startEditingItem(item) {
  setActiveTab('capture');
  els.editingItemId.value = item.id;
  els.editingBadge.hidden = false;
  els.btnCancelEdit.hidden = false;
  els.btnSaveCapture.textContent = 'Actualizar';

  state.detectedTitle = item.title || '';
  els.inputTitle.value = item.title || '';
  els.inputUrl.value = item.url || '';
  els.inputTimestamp.value =
    item.timestampSec !== null && item.timestampSec !== undefined
      ? formatTimestamp(item.timestampSec)
      : '';
  if (state.projects.some((p) => p.id === item.projectId)) {
    state.selectedProjectId = item.projectId;
  }
  state.categoriesDraft = [...(item.categories || [])];
  els.inputQuote.value = item.quote || '';
  els.inputNote.value = item.note || '';
  state.attachedImage = item.image ? { ...item.image } : null;
  state.pageAnchor = item.pageAnchor ? { ...item.pageAnchor } : null;
  els.detailsOptional.open = true;

  renderProjectPills();
  renderCategoryPills();
  renderAttachedImage();
  updateSourceIndicators();
  els.inputNote.focus();
}

function formatShortDate(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function deriveItemTitle({ explicitTitle, detectedTitle, note, quote, url, hasImage }) {
  if (explicitTitle) return explicitTitle;
  if (detectedTitle) return detectedTitle;
  if (note) return note.split('\n')[0].trim().slice(0, 90);
  if (quote) return quote.slice(0, 90);
  if (url) return getHostnameLabel(url) || url.slice(0, 80);
  if (hasImage) return `Captura ${formatShortDate(new Date().toISOString())}`;
  return `Nota ${formatShortDate(new Date().toISOString())}`;
}

function getFilteredItems() {
  const query = els.filterQuery.value.trim().toLowerCase();
  const projectId = els.filterProject.value || 'all';
  const sourceType = els.filterSource.value || 'all';

  return state.items.filter((item) => {
    if (projectId !== 'all' && item.projectId !== projectId) return false;
    if (sourceType !== 'all' && item.sourceType !== sourceType) return false;
    if (
      state.filterCategory !== 'all' &&
      !(item.categories || []).some((c) => c.toLowerCase() === state.filterCategory)
    ) {
      return false;
    }

    if (query) {
      const haystack = [
        item.title,
        item.note,
        item.quote,
        item.url,
        ...(item.categories || [])
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function renderLibraryCategoryChips() {
  const projectId = els.filterProject.value || 'all';
  const map = new Map();

  for (const item of state.items) {
    if (projectId !== 'all' && item.projectId !== projectId) continue;
    for (const cat of item.categories || []) {
      const key = cat.toLowerCase();
      if (!map.has(key)) map.set(key, { key, label: cat, count: 0 });
      map.get(key).count += 1;
    }
  }

  const cats = Array.from(map.values()).sort((a, b) => b.count - a.count);
  if (state.filterCategory !== 'all' && !map.has(state.filterCategory)) {
    state.filterCategory = 'all';
  }

  els.libraryCategoryFilters.textContent = '';
  if (cats.length === 0) return;

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `chip-btn ${state.filterCategory === 'all' ? 'is-active' : ''}`;
  allBtn.textContent = 'Todas';
  allBtn.addEventListener('click', () => {
    state.filterCategory = 'all';
    renderLibrary();
  });
  els.libraryCategoryFilters.appendChild(allBtn);

  for (const entry of cats.slice(0, 14)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip-btn ${state.filterCategory === entry.key ? 'is-active' : ''}`;
    btn.textContent = `#${entry.label} (${entry.count})`;
    btn.addEventListener('click', () => {
      state.filterCategory = state.filterCategory === entry.key ? 'all' : entry.key;
      renderLibrary();
    });
    els.libraryCategoryFilters.appendChild(btn);
  }
}

function openImageLightbox(src, title) {
  els.lightboxImg.src = src;
  document.getElementById('dialog-image-title').textContent = title || 'Captura adjunta';
  els.dialogImage.showModal();
}

async function moveItemToProject(itemId, targetProjectId) {
  const item = state.items.find((i) => i.id === itemId);
  const targetProject = state.projects.find((p) => p.id === targetProjectId);
  if (!item || !targetProject || item.projectId === targetProjectId) return;

  item.projectId = targetProjectId;
  item.updatedAt = new Date().toISOString();
  await persistItems();
  renderLibrary();
  renderCategoryPills();
  showStatus(`Movido a "${targetProject.name}".`);
}

function openMoveDialog(item) {
  state.pendingMoveItemId = item.id;
  els.dialogMoveDesc.textContent = `Elige el proyecto para "${item.title}":`;
  els.moveProjectChoices.textContent = '';

  for (const project of state.projects) {
    const isCurrent = project.id === item.projectId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'project-choice';
    btn.style.setProperty('--pill-color', project.color);
    btn.setAttribute('aria-checked', String(isCurrent));
    if (isCurrent) btn.disabled = true;

    const dot = document.createElement('span');
    dot.className = 'project-dot';
    dot.style.backgroundColor = isCurrent ? '#ffffff' : project.color;

    const label = document.createElement('span');
    label.textContent = isCurrent ? `${project.name} (actual)` : project.name;

    btn.append(dot, label);
    btn.addEventListener('click', async () => {
      const idToMove = state.pendingMoveItemId;
      state.pendingMoveItemId = null;
      els.dialogMoveItem.close();
      await moveItemToProject(idToMove, project.id);
    });
    els.moveProjectChoices.appendChild(btn);
  }

  els.dialogMoveItem.showModal();
}

async function executeGroupLaunch(spec) {
  const res = await chrome.runtime.sendMessage({
    type: 'STUDY_LAUNCH_GROUP',
    groupTitle: spec.groupTitle,
    groupColorHex: spec.groupColorHex,
    items: spec.items,
    focusMode: state.focusMode
  });

  if (!res?.ok) {
    showStatus(res?.error || 'No se pudo abrir el grupo en Chrome.', 'error');
    return;
  }

  const parts = [];
  if (res.openedCount > 0) parts.push(`${res.openedCount} abiertas`);
  if (res.reusedCount > 0) parts.push(`${res.reusedCount} reutilizadas`);
  const focusNote = state.focusMode ? ' · Modo Foco' : '';
  showStatus(`Grupo "${spec.groupTitle}": ${parts.join(', ')}${focusNote}.`);
}

async function requestLaunchGroup({ groupTitle, groupColorHex, items }) {
  const uniqueCount = countUniqueWebLinks(items);
  if (uniqueCount === 0) {
    showStatus('Este grupo no tiene enlaces web para abrir.', 'error');
    return;
  }

  const spec = { groupTitle, groupColorHex, items };
  if (uniqueCount > MAX_SAFE_LAUNCH_TABS) {
    state.pendingLaunchSpec = spec;
    els.dialogLaunchDesc.textContent = `Vas a abrir ${uniqueCount} enlaces en el Tab Group "${groupTitle}". Las pestañas que ya tengas abiertas se reutilizarán sin duplicarse.`;
    els.dialogConfirmLaunch.returnValue = '';
    els.dialogConfirmLaunch.showModal();
    return;
  }

  await executeGroupLaunch(spec);
}

function buildItemCard(item, project) {
  const source = SOURCE_META[item.sourceType] || SOURCE_META.web;

  const card = document.createElement('article');
  card.className = 'item-card';
  card.style.setProperty('--card-accent', project?.color || '#2563eb');
  card.draggable = true;

  card.addEventListener('dragstart', (e) => {
    state.draggingItemId = item.id;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  });

  card.addEventListener('dragend', () => {
    state.draggingItemId = null;
    card.classList.remove('is-dragging');
    for (const grp of document.querySelectorAll('.project-group.is-drop-target')) {
      grp.classList.remove('is-drop-target');
    }
  });

  const top = document.createElement('div');
  top.className = 'item-card-top';

  const srcBadge = document.createElement('span');
  srcBadge.className = `source-badge ${source.badgeClass}`;
  srcBadge.textContent = source.label;
  top.appendChild(srcBadge);

  if (item.timestampSec !== null && item.timestampSec !== undefined) {
    const tsPill = document.createElement('span');
    tsPill.className = 'meta-pill';
    tsPill.textContent = `⏱ ${formatTimestamp(item.timestampSec)}`;
    top.appendChild(tsPill);
  }

  if (item.pageAnchor) {
    const anchorPill = document.createElement('span');
    anchorPill.className = 'meta-pill';
    anchorPill.textContent = 'Área';
    top.appendChild(anchorPill);
  }

  const dateSpan = document.createElement('span');
  dateSpan.className = 'item-date';
  dateSpan.textContent = formatShortDate(item.createdAt);
  top.appendChild(dateSpan);

  card.appendChild(top);

  const titleHeading = document.createElement('h3');
  titleHeading.className = 'item-title';
  if (item.deepLinkUrl || item.url) {
    const openTitleBtn = document.createElement('button');
    openTitleBtn.type = 'button';
    openTitleBtn.className = 'item-title-btn';
    openTitleBtn.textContent = item.title;
    openTitleBtn.addEventListener('click', () => openSavedItem(item, project));
    titleHeading.appendChild(openTitleBtn);
  } else {
    titleHeading.textContent = item.title;
  }
  card.appendChild(titleHeading);

  if (item.quote) {
    const quoteEl = document.createElement('blockquote');
    quoteEl.className = 'item-quote';
    quoteEl.textContent = item.quote;
    card.appendChild(quoteEl);
  }

  if (item.note) {
    const noteEl = document.createElement('p');
    noteEl.className = 'item-note';
    noteEl.textContent = item.note;
    card.appendChild(noteEl);
  }

  if (item.image?.dataUrl) {
    const thumbBtn = document.createElement('button');
    thumbBtn.type = 'button';
    thumbBtn.className = 'image-thumb-btn';
    thumbBtn.setAttribute('aria-label', `Ampliar captura de ${item.title}`);
    const img = document.createElement('img');
    img.src = item.image.dataUrl;
    img.alt = `Captura de ${item.title}`;
    img.loading = 'lazy';
    thumbBtn.appendChild(img);
    thumbBtn.addEventListener('click', () => openImageLightbox(item.image.dataUrl, item.title));
    card.appendChild(thumbBtn);
  }

  if (item.categories?.length) {
    const catsWrap = document.createElement('div');
    catsWrap.className = 'chip-list';
    for (const cat of item.categories) {
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'chip-btn';
      tag.textContent = `#${cat}`;
      tag.addEventListener('click', () => {
        state.filterCategory = cat.toLowerCase();
        renderLibrary();
      });
      catsWrap.appendChild(tag);
    }
    card.appendChild(catsWrap);
  }

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  if (item.deepLinkUrl || item.url) {
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn-primary btn-xs';
    openBtn.textContent = 'Abrir';
    openBtn.addEventListener('click', () => openSavedItem(item, project));
    actions.appendChild(openBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary btn-xs';
    copyBtn.textContent = 'Link';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.deepLinkUrl || item.url);
        showStatus('Deep link copiado.');
      } catch {
        showStatus('No se pudo copiar el enlace.', 'error');
      }
    });
    actions.appendChild(copyBtn);
  }

  if (item.quote) {
    const copyQuoteBtn = document.createElement('button');
    copyQuoteBtn.type = 'button';
    copyQuoteBtn.className = 'btn btn-secondary btn-xs';
    copyQuoteBtn.textContent = 'Cita';
    copyQuoteBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.quote);
        showStatus('Cita copiada (lista para Ctrl+F).');
      } catch {
        showStatus('No se pudo copiar la cita.', 'error');
      }
    });
    actions.appendChild(copyQuoteBtn);
  }

  if (state.projects.length > 1) {
    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'btn btn-ghost btn-xs';
    moveBtn.textContent = 'Mover';
    moveBtn.addEventListener('click', () => openMoveDialog(item));
    actions.appendChild(moveBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-ghost btn-xs';
  editBtn.textContent = 'Editar';
  editBtn.addEventListener('click', () => startEditingItem(item));
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-xs';
  delBtn.textContent = 'Borrar';
  delBtn.addEventListener('click', () => requestDeleteItem(item));
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

function getActiveFilterGroupTitle(projectMap) {
  const projFilter = els.filterProject.value || 'all';
  const proj = projFilter !== 'all' ? projectMap.get(projFilter) : null;
  const parts = [];
  if (proj) parts.push(proj.name);
  if (state.filterCategory !== 'all') parts.push(`#${state.filterCategory}`);
  else if (els.filterQuery.value.trim()) parts.push(els.filterQuery.value.trim().slice(0, 18));
  else if (els.filterSource.value !== 'all') {
    parts.push(SOURCE_META[els.filterSource.value]?.label || els.filterSource.value);
  }
  return {
    title: parts.length > 0 ? parts.join(' · ') : 'Estudio',
    colorHex: proj?.color || PROJECT_COLORS[0]
  };
}

function renderLibrary() {
  els.libraryCount.textContent = String(state.items.length);
  renderLibraryCategoryChips();

  const items = getFilteredItems();
  const projectMap = new Map(state.projects.map((p) => [p.id, p]));

  const hasSubFilter =
    state.filterCategory !== 'all' ||
    Boolean(els.filterQuery.value.trim()) ||
    els.filterSource.value !== 'all';
  const filteredWebCount = countUniqueWebLinks(items);

  if (hasSubFilter && filteredWebCount > 0) {
    els.btnLaunchFiltered.textContent = `▶ Abrir filtro (${filteredWebCount})`;
    els.btnLaunchFiltered.hidden = false;
  } else {
    els.btnLaunchFiltered.hidden = true;
  }

  els.libraryList.textContent = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p1 = document.createElement('p');
    p1.textContent =
      state.items.length === 0
        ? 'Aún no tienes capturas guardadas.'
        : 'No hay capturas que coincidan con estos filtros.';
    const p2 = document.createElement('p');
    p2.className = 'hint';
    p2.textContent =
      state.items.length === 0
        ? 'Guarda tu primer enlace o importa un Tab Group de Chrome.'
        : 'Prueba cambiando proyecto, fuente o búsqueda.';
    empty.append(p1, p2);
    els.libraryList.appendChild(empty);
  } else {
    // Group filtered items by Project
    const grouped = new Map();
    for (const project of state.projects) {
      grouped.set(project.id, []);
    }

    const orphanItems = [];
    for (const item of items) {
      if (grouped.has(item.projectId)) {
        grouped.get(item.projectId).push(item);
      } else {
        orphanItems.push(item);
      }
    }

    const sections = [];
    for (const project of state.projects) {
      const list = grouped.get(project.id) || [];
      if (list.length > 0) {
        sections.push({ project, list });
      }
    }
    if (orphanItems.length > 0) {
      sections.push({
        project: { id: 'proj_none', name: 'Sin proyecto', color: '#64748b' },
        list: orphanItems
      });
    }

    for (const { project, list } of sections) {
      const details = document.createElement('details');
      details.className = 'project-group';
      details.open = !state.collapsedProjects.has(project.id);
      details.addEventListener('toggle', () => {
        if (details.open) state.collapsedProjects.delete(project.id);
        else state.collapsedProjects.add(project.id);
      });

      // Allow dropping dragged cards onto another project section
      if (project.id !== 'proj_none') {
        details.addEventListener('dragover', (e) => {
          if (!state.draggingItemId) return;
          const dragged = state.items.find((i) => i.id === state.draggingItemId);
          if (!dragged || dragged.projectId === project.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          details.classList.add('is-drop-target');
        });
        details.addEventListener('dragleave', (e) => {
          if (!details.contains(e.relatedTarget)) {
            details.classList.remove('is-drop-target');
          }
        });
        details.addEventListener('drop', async (e) => {
          e.preventDefault();
          details.classList.remove('is-drop-target');
          const draggedId = state.draggingItemId || e.dataTransfer.getData('text/plain');
          if (draggedId) {
            await moveItemToProject(draggedId, project.id);
          }
        });
      }

      const summary = document.createElement('summary');
      summary.className = 'project-group-header';

      const titleWrap = document.createElement('span');
      titleWrap.className = 'project-group-title-wrap';

      const chevron = document.createElement('span');
      chevron.className = 'project-group-chevron';
      chevron.textContent = '▸';
      chevron.setAttribute('aria-hidden', 'true');

      const dot = document.createElement('span');
      dot.className = 'project-dot';
      dot.style.backgroundColor = project.color;

      const nameEl = document.createElement('span');
      nameEl.className = 'project-group-name';
      nameEl.textContent = project.name;

      const countEl = document.createElement('span');
      countEl.className = 'count-pill';
      countEl.textContent = String(list.length);

      titleWrap.append(chevron, dot, nameEl, countEl);
      summary.appendChild(titleWrap);

      const webCount = countUniqueWebLinks(list);
      if (webCount > 0) {
        const launchBtn = document.createElement('button');
        launchBtn.type = 'button';
        launchBtn.className = 'btn btn-secondary btn-xs';
        launchBtn.textContent = `▶ Grupo (${webCount})`;
        launchBtn.title = `Abrir ${webCount} enlaces en el Tab Group "${project.name}"`;
        launchBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const groupTitle =
            state.filterCategory !== 'all'
              ? `${project.name} · #${state.filterCategory}`
              : project.name;
          requestLaunchGroup({
            groupTitle,
            groupColorHex: project.color,
            items: list
          });
        });
        summary.appendChild(launchBtn);
      }

      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'project-group-body';
      for (const item of list) {
        body.appendChild(buildItemCard(item, project));
      }
      details.appendChild(body);

      els.libraryList.appendChild(details);
    }
  }

  const totalImgBytes = state.items.reduce((acc, it) => acc + (it.image?.sizeBytes || 0), 0);
  const label = state.items.length === 1 ? '1 captura' : `${state.items.length} capturas`;
  els.storageSummary.textContent =
    totalImgBytes > 0 ? `${label} · Imágenes: ${formatBytes(totalImgBytes)}` : label;
}

async function openSavedItem(item, project) {
  const resolvedProject = project || state.projects.find((p) => p.id === item.projectId) || null;
  const res = await chrome.runtime.sendMessage({
    type: 'STUDY_OPEN_ITEM',
    item,
    project: resolvedProject
  });
  if (!res?.ok) {
    showStatus(res?.error || 'No se pudo abrir el enlace.', 'error');
  }
}

function requestDeleteItem(item) {
  state.pendingDeleteId = item.id;
  els.dialogDeleteDesc.textContent = `Se eliminará "${item.title}" de tu biblioteca local.`;
  els.dialogConfirmDelete.returnValue = '';
  els.dialogConfirmDelete.showModal();
}

function renderColorPicker() {
  els.projectColorPicker.textContent = '';
  for (const color of PROJECT_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch';
    btn.style.backgroundColor = color;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(state.selectedColor === color));
    btn.setAttribute('aria-label', `Color ${color}`);
    btn.addEventListener('click', () => {
      state.selectedColor = color;
      renderColorPicker();
    });
    els.projectColorPicker.appendChild(btn);
  }
}

function renderProjectsManageList() {
  els.projectsManageList.textContent = '';
  for (const project of state.projects) {
    const li = document.createElement('li');
    li.className = 'project-manage-row';

    const left = document.createElement('span');
    left.className = 'project-pill';
    const dot = document.createElement('span');
    dot.className = 'project-dot';
    dot.style.backgroundColor = project.color;
    const name = document.createElement('span');
    const count = state.items.filter((i) => i.projectId === project.id).length;
    name.textContent = `${project.name} (${count})`;
    left.append(dot, name);
    li.appendChild(left);

    if (state.projects.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'link-btn is-danger';
      delBtn.textContent = 'Eliminar';
      delBtn.addEventListener('click', async () => {
        const fallback = state.projects.find((p) => p.id !== project.id);
        state.projects = state.projects.filter((p) => p.id !== project.id);
        state.items = state.items.map((item) =>
          item.projectId === project.id ? { ...item, projectId: fallback.id } : item
        );
        if (state.selectedProjectId === project.id) {
          state.selectedProjectId = fallback.id;
        }
        await persistProjects();
        await persistItems();
        renderProjectPills();
        renderFilterProjectSelect();
        renderProjectsManageList();
        renderLibrary();
        showStatus(`Proyecto "${project.name}" eliminado.`);
      });
      li.appendChild(delBtn);
    }

    els.projectsManageList.appendChild(li);
  }
}

function renderImportChromeGroupsList() {
  els.importGroupsList.textContent = '';
  for (const grp of state.availableChromeGroups) {
    const isSelected = grp.id === state.selectedImportGroupId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'import-group-choice';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(isSelected));

    const left = document.createElement('span');
    left.className = 'project-pill';
    const dot = document.createElement('span');
    dot.className = 'project-dot';
    dot.style.backgroundColor = grp.colorHex;
    const name = document.createElement('span');
    name.textContent = grp.isActiveGroup ? `${grp.title} (actual)` : grp.title;
    left.append(dot, name);

    const count = document.createElement('span');
    count.className = 'count-pill';
    count.textContent = `${grp.tabCount} tabs`;

    btn.append(left, count);
    btn.addEventListener('click', () => {
      state.selectedImportGroupId = grp.id;
      renderImportChromeGroupsList();
    });
    els.importGroupsList.appendChild(btn);
  }
}

async function openImportChromeGroupDialog() {
  const res = await chrome.runtime.sendMessage({ type: 'STUDY_LIST_TAB_GROUPS' });
  if (!res?.ok) {
    showStatus(res?.error || 'No se pudieron leer los Tab Groups.', 'error');
    return;
  }

  state.availableChromeGroups = res.groups || [];
  renderFilterProjectSelect();
  els.importGroupCategory.value = '';
  els.importDestExisting.checked = true;
  els.importExistingWrap.hidden = false;

  if (state.availableChromeGroups.length === 0) {
    els.importGroupsEmpty.hidden = false;
    els.formImportGroup.hidden = true;
  } else {
    const active = state.availableChromeGroups.find((g) => g.isActiveGroup);
    state.selectedImportGroupId = active ? active.id : state.availableChromeGroups[0].id;
    renderImportChromeGroupsList();
    els.importGroupsEmpty.hidden = true;
    els.formImportGroup.hidden = false;
  }

  els.dialogImportGroup.showModal();
}

async function handleSubmitImportChromeGroup(e) {
  e.preventDefault();
  if (state.selectedImportGroupId === null) return;

  els.btnSubmitImportGroup.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'STUDY_CAPTURE_TAB_GROUP',
      groupId: state.selectedImportGroupId
    });
    if (!res?.ok) {
      showStatus(res?.error || 'Error importando el grupo.', 'error');
      return;
    }

    let targetProjectId = els.importTargetProject.value;
    let targetProjectName =
      state.projects.find((p) => p.id === targetProjectId)?.name || 'Estudio';

    if (els.importDestNew.checked) {
      const existingByName = state.projects.find(
        (p) => p.name.trim().toLowerCase() === res.group.title.trim().toLowerCase()
      );
      if (existingByName) {
        targetProjectId = existingByName.id;
        targetProjectName = existingByName.name;
      } else {
        const created = {
          id: createId('proj'),
          name: res.group.title.slice(0, 60),
          color: res.group.colorHex || PROJECT_COLORS[0],
          createdAt: new Date().toISOString()
        };
        state.projects.push(created);
        targetProjectId = created.id;
        targetProjectName = created.name;
        await persistProjects();
      }
    }

    const batchCategories = normalizeCategories(els.importGroupCategory.value);
    const existingUrls = new Set(
      state.items
        .filter((i) => i.projectId === targetProjectId)
        .map((i) => normalizeUrlForMatch(i.deepLinkUrl || i.url))
    );

    const now = new Date().toISOString();
    let added = 0;
    let skipped = 0;

    for (const ctx of res.contexts || []) {
      const norm = normalizeUrlForMatch(ctx.deepLinkUrl || ctx.url);
      if (existingUrls.has(norm)) {
        skipped += 1;
        continue;
      }
      existingUrls.add(norm);
      state.items.unshift({
        id: createId('item'),
        projectId: targetProjectId,
        categories: [...batchCategories],
        sourceType: ctx.sourceType || detectSourceType(ctx.url),
        title: ctx.title || getHostnameLabel(ctx.url) || ctx.url,
        url: ctx.url,
        deepLinkUrl: ctx.deepLinkUrl || ctx.url,
        timestampSec: ctx.timestampSec ?? null,
        quote: ctx.quote || '',
        note: '',
        image: null,
        pageAnchor: null,
        createdAt: now,
        updatedAt: now,
        syncedAt: null
      });
      added += 1;
    }

    await persistItems();
    renderProjectPills();
    renderFilterProjectSelect();
    renderCategoryPills();
    renderLibrary();
    els.dialogImportGroup.close();

    const skipMsg = skipped > 0 ? ` (${skipped} duplicadas omitidas)` : '';
    showStatus(`Importadas ${added} pestañas en "${targetProjectName}"${skipMsg}.`);
  } catch (err) {
    showStatus(err?.message || 'Error importando el grupo.', 'error');
  } finally {
    els.btnSubmitImportGroup.disabled = false;
  }
}

function downloadJsonBackup(includeImages) {
  const payload = createExportPayload({
    projects: state.projects,
    items: state.items,
    includeImages
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = includeImages ? 'completo' : 'ligero';
  const a = document.createElement('a');
  a.href = url;
  a.download = `estudio-deep-links-${suffix}-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus(includeImages ? 'JSON completo descargado.' : 'JSON ligero descargado.');
}

async function handleImportFile(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const { projects: incomingProjects, items: incomingItems } = validateImportPayload(parsed);

    const existingProjectIds = new Set(state.projects.map((p) => p.id));
    let addedProjects = 0;
    for (const proj of incomingProjects) {
      if (proj?.id && proj?.name && !existingProjectIds.has(proj.id)) {
        state.projects.push({
          id: proj.id,
          name: String(proj.name).slice(0, 60),
          color: proj.color || PROJECT_COLORS[0],
          createdAt: proj.createdAt || new Date().toISOString()
        });
        existingProjectIds.add(proj.id);
        addedProjects += 1;
      }
    }

    const existingItemIds = new Set(state.items.map((i) => i.id));
    let addedItems = 0;
    for (const item of incomingItems) {
      if (item?.id && item?.title && !existingItemIds.has(item.id)) {
        state.items.push(item);
        existingItemIds.add(item.id);
        addedItems += 1;
      }
    }

    state.items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    await persistProjects();
    await persistItems();
    renderProjectPills();
    renderFilterProjectSelect();
    renderCategoryPills();
    renderLibrary();
    showStatus(`Importado: ${addedProjects} proyectos y ${addedItems} capturas.`);
  } catch (err) {
    showStatus(err?.message || 'Error importando el JSON.', 'error');
  }
}

async function handlePasteImage(event) {
  if (state.activeTab !== 'capture') return;
  const items = event.clipboardData?.items;
  if (!items) return;

  for (const entry of items) {
    if (entry.type && entry.type.startsWith('image/')) {
      event.preventDefault();
      const file = entry.getAsFile();
      if (!file) return;
      try {
        const objectUrl = URL.createObjectURL(file);
        try {
          state.attachedImage = await compressImageFromSource(objectUrl);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        renderAttachedImage();
        updateSourceIndicators();
        showStatus(`Captura pegada (${formatBytes(state.attachedImage.sizeBytes)}).`);
      } catch (err) {
        showStatus(err?.message || 'No se pudo leer la imagen.', 'error');
      }
      return;
    }
  }
}

async function submitCaptureForm() {
  if (els.inputCategory.value.trim()) {
    addCategoriesFromInput(els.inputCategory.value);
    els.inputCategory.value = '';
  }

  const url = els.inputUrl.value.trim();
  const rawTs = els.inputTimestamp.value.trim();
  const timestampSec = rawTs ? parseTimestampInput(rawTs) : null;
  if (rawTs && timestampSec === null) {
    els.detailsOptional.open = true;
    els.inputTimestamp.setCustomValidity('Usa formato mm:ss o segundos (ej. 04:15).');
    els.inputTimestamp.reportValidity();
    return;
  }
  els.inputTimestamp.setCustomValidity('');

  const quote = els.inputQuote.value.trim();
  const note = els.inputNote.value.trim();
  if (!url && !note && !quote && !state.attachedImage && !els.inputTitle.value.trim()) {
    showStatus('Detecta una pestaña, escribe una nota o pega una captura antes de guardar.', 'error');
    els.inputNote.focus();
    return;
  }

  const title = deriveItemTitle({
    explicitTitle: els.inputTitle.value.trim(),
    detectedTitle: state.detectedTitle,
    note,
    quote,
    url,
    hasImage: Boolean(state.attachedImage)
  });

  const projectId = state.selectedProjectId || state.projects[0]?.id || '';
  const sourceType = detectSourceType(url);
  const deepLinkUrl = buildDeepLinkUrl({ url, sourceType, timestampSec, quote });
  const now = new Date().toISOString();

  const editingId = els.editingItemId.value;
  if (editingId) {
    state.items = state.items.map((item) =>
      item.id === editingId
        ? {
            ...item,
            projectId,
            categories: [...state.categoriesDraft],
            sourceType,
            title,
            url,
            deepLinkUrl,
            timestampSec,
            quote,
            note,
            image: state.attachedImage ? { ...state.attachedImage } : null,
            pageAnchor: state.pageAnchor ? { ...state.pageAnchor } : null,
            updatedAt: now
          }
        : item
    );
    showStatus('Captura actualizada.');
  } else {
    const newItem = {
      id: createId('item'),
      projectId,
      categories: [...state.categoriesDraft],
      sourceType,
      title,
      url,
      deepLinkUrl,
      timestampSec,
      quote,
      note,
      image: state.attachedImage ? { ...state.attachedImage } : null,
      pageAnchor: state.pageAnchor ? { ...state.pageAnchor } : null,
      createdAt: now,
      updatedAt: now,
      syncedAt: null
    };
    state.items.unshift(newItem);
    showStatus('Guardado en tu biblioteca.');
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.ITEMS]: state.items,
    [STORAGE_KEYS.LAST_PROJECT_ID]: projectId
  });

  resetCaptureForm(true);
  els.libraryCount.textContent = String(state.items.length);
  renderCategoryPills();
}

function bindEvents() {
  els.tabCapture.addEventListener('click', () => setActiveTab('capture'));
  els.tabLibrary.addEventListener('click', () => setActiveTab('library'));

  els.btnDetectTab.addEventListener('click', () => detectActiveTab(false));

  els.btnGrabTime.addEventListener('click', async () => {
    els.btnGrabTime.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'STUDY_GET_ACTIVE_TAB_CONTEXT' });
      if (res?.ok && res.context?.timestampSec !== null && res.context?.timestampSec !== undefined) {
        els.inputTimestamp.value = formatTimestamp(res.context.timestampSec);
        if (!els.inputUrl.value.trim() && res.context.url) {
          els.inputUrl.value = res.context.url;
        }
        if (!state.detectedTitle && res.context.title) {
          state.detectedTitle = res.context.title;
        }
        updateSourceIndicators();
        showStatus(`Minuto: ${formatTimestamp(res.context.timestampSec)}`);
      } else {
        showStatus('No hay video activo en esta pestaña.', 'error');
      }
    } catch (err) {
      showStatus(err?.message || 'Error leyendo minuto.', 'error');
    } finally {
      els.btnGrabTime.disabled = false;
    }
  });

  els.btnCropTab.addEventListener('click', async () => {
    els.btnCropTab.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'STUDY_REQUEST_CROP' });
      if (!res?.ok) {
        if (!res?.cancelled && res?.error) showStatus(res.error, 'error');
        return;
      }
      state.attachedImage = await compressImageFromSource(res.dataUrl, res.rect, res.dpr);
      state.pageAnchor = res.pageAnchor || null;
      renderAttachedImage();
      updateSourceIndicators();
      showStatus(
        state.pageAnchor
          ? `Recorte y área vinculados (${formatBytes(state.attachedImage.sizeBytes)}).`
          : `Recorte listo (${formatBytes(state.attachedImage.sizeBytes)}).`
      );
    } catch (err) {
      showStatus(err?.message || 'Error recortando.', 'error');
    } finally {
      els.btnCropTab.disabled = false;
    }
  });

  els.btnFullCapture.addEventListener('click', async () => {
    els.btnFullCapture.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'STUDY_REQUEST_FULL_CAPTURE' });
      if (!res?.ok) {
        showStatus(res?.error || 'No se pudo capturar la pestaña.', 'error');
        return;
      }
      state.attachedImage = await compressImageFromSource(res.dataUrl);
      renderAttachedImage();
      updateSourceIndicators();
      showStatus(`Pestaña capturada (${formatBytes(state.attachedImage.sizeBytes)}).`);
    } catch (err) {
      showStatus(err?.message || 'Error capturando pestaña.', 'error');
    } finally {
      els.btnFullCapture.disabled = false;
    }
  });

  els.inputTitle.addEventListener('input', updateSourceIndicators);
  els.inputUrl.addEventListener('input', () => {
    const parsedTs = extractTimestampFromUrl(els.inputUrl.value.trim());
    if (parsedTs !== null) {
      els.inputTimestamp.value = formatTimestamp(parsedTs);
    }
    updateSourceIndicators();
  });
  els.inputTimestamp.addEventListener('input', () => {
    els.inputTimestamp.setCustomValidity('');
    updateSourceIndicators();
  });
  els.inputQuote.addEventListener('input', updateSourceIndicators);

  els.btnClearQuote.addEventListener('click', () => {
    els.inputQuote.value = '';
    updateSourceIndicators();
  });

  els.btnAddCategory.addEventListener('click', () => {
    addCategoriesFromInput(els.inputCategory.value);
    els.inputCategory.value = '';
    els.inputCategory.focus();
  });

  els.inputCategory.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addCategoriesFromInput(els.inputCategory.value);
      els.inputCategory.value = '';
    }
  });

  els.inputNote.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submitCaptureForm();
    }
  });

  els.btnRemoveImage.addEventListener('click', () => {
    state.attachedImage = null;
    state.pageAnchor = null;
    renderAttachedImage();
    updateSourceIndicators();
  });

  els.btnPreviewImage.addEventListener('click', () => {
    if (state.attachedImage?.dataUrl) {
      openImageLightbox(
        state.attachedImage.dataUrl,
        els.inputTitle.value.trim() || state.detectedTitle || 'Captura adjunta'
      );
    }
  });

  els.btnCancelEdit.addEventListener('click', () => {
    resetCaptureForm(true);
    detectActiveTab(true);
  });

  els.captureForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitCaptureForm();
  });

  // Library filters & Tab Groups toolbar
  els.filterQuery.addEventListener('input', renderLibrary);
  els.filterProject.addEventListener('change', () => {
    state.filterCategory = 'all';
    renderLibrary();
  });
  els.filterSource.addEventListener('change', renderLibrary);

  els.toggleFocusMode.addEventListener('change', async () => {
    state.focusMode = els.toggleFocusMode.checked;
    await chrome.storage.local.set({ [STORAGE_KEYS.FOCUS_MODE]: state.focusMode });
  });

  els.btnLaunchFiltered.addEventListener('click', () => {
    const items = getFilteredItems();
    const projectMap = new Map(state.projects.map((p) => [p.id, p]));
    const { title, colorHex } = getActiveFilterGroupTitle(projectMap);
    requestLaunchGroup({ groupTitle: title, groupColorHex: colorHex, items });
  });

  els.btnImportTabGroup.addEventListener('click', openImportChromeGroupDialog);
  els.btnCloseImportGroup.addEventListener('click', () => els.dialogImportGroup.close());
  els.btnCancelImportGroup.addEventListener('click', () => els.dialogImportGroup.close());
  els.importDestExisting.addEventListener('change', () => {
    els.importExistingWrap.hidden = false;
  });
  els.importDestNew.addEventListener('change', () => {
    els.importExistingWrap.hidden = true;
  });
  els.formImportGroup.addEventListener('submit', handleSubmitImportChromeGroup);

  els.btnExportFull.addEventListener('click', () => downloadJsonBackup(true));
  els.btnExportLite.addEventListener('click', () => downloadJsonBackup(false));
  els.btnImportJson.addEventListener('click', () => els.inputImportFile.click());
  els.inputImportFile.addEventListener('change', async () => {
    const [file] = els.inputImportFile.files || [];
    if (file) await handleImportFile(file);
    els.inputImportFile.value = '';
  });

  // Projects dialog
  els.btnManageProjects.addEventListener('click', () => {
    renderColorPicker();
    renderProjectsManageList();
    els.inputProjectName.value = '';
    els.dialogProjects.showModal();
  });
  els.btnCloseProjects.addEventListener('click', () => els.dialogProjects.close());

  els.formNewProject.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.inputProjectName.value.trim();
    if (!name) return;

    const newProject = {
      id: createId('proj'),
      name,
      color: state.selectedColor,
      createdAt: new Date().toISOString()
    };
    state.projects.push(newProject);
    state.selectedProjectId = newProject.id;
    await persistProjects();
    renderProjectPills();
    renderFilterProjectSelect();
    renderCategoryPills();
    renderProjectsManageList();
    els.inputProjectName.value = '';
    showStatus(`Proyecto "${name}" creado.`);
  });

  // Image lightbox & Move dialogs
  els.btnCloseImage.addEventListener('click', () => els.dialogImage.close());
  els.btnCloseMove.addEventListener('click', () => els.dialogMoveItem.close());

  // Delete confirmation dialog
  els.dialogConfirmDelete.addEventListener('close', async () => {
    const choice = els.dialogConfirmDelete.returnValue;
    els.dialogConfirmDelete.returnValue = '';
    const deleteId = state.pendingDeleteId;
    state.pendingDeleteId = null;

    if (choice === 'confirm' && deleteId) {
      state.items = state.items.filter((i) => i.id !== deleteId);
      await persistItems();
      renderLibrary();
      renderCategoryPills();
      showStatus('Captura eliminada.');
    }
  });

  // Large group launch confirmation dialog
  els.dialogConfirmLaunch.addEventListener('close', async () => {
    const choice = els.dialogConfirmLaunch.returnValue;
    els.dialogConfirmLaunch.returnValue = '';
    const spec = state.pendingLaunchSpec;
    state.pendingLaunchSpec = null;

    if (choice === 'confirm' && spec) {
      await executeGroupLaunch(spec);
    }
  });

  window.addEventListener('paste', handlePasteImage);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'STUDY_PENDING_CAPTURE_UPDATED' && message.payload) {
      chrome.storage.session.remove(STORAGE_KEYS.PENDING_CAPTURE).catch(() => {});
      setActiveTab('capture');
      applyDetectedContext(message.payload);
      showStatus('Contexto actualizado.');
      els.inputNote.focus();
    } else if (message?.type === 'STUDY_ACTIVE_TAB_CHANGED') {
      if (state.activeTab === 'capture' && !hasUserDraftInProgress()) {
        detectActiveTab(true);
      }
    }
  });
}

async function init() {
  setupDialogLightDismissFallback();
  await loadState();
  renderProjectPills();
  renderFilterProjectSelect();
  renderCategoryPills();
  renderAttachedImage();
  els.libraryCount.textContent = String(state.items.length);
  bindEvents();

  const hadPending = await checkPendingCaptureFromSession();
  if (!hadPending) {
    await detectActiveTab(true);
  }
}

init();
