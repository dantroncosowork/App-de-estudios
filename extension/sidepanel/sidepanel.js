import {
  PROJECT_COLORS,
  SOURCE_META,
  STORAGE_KEYS,
  buildDeepLinkUrl,
  createExportPayload,
  createId,
  detectSourceType,
  formatBytes,
  formatTimestamp,
  normalizeCategories,
  parseTimestampInput,
  validateImportPayload
} from '../shared/schema.js';

const state = {
  activeTab: 'capture',
  projects: [],
  items: [],
  lastProjectId: '',
  categoriesDraft: [],
  attachedImage: null,
  selectedColor: PROJECT_COLORS[0],
  filterCategory: 'all',
  pendingDeleteId: null
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
  detectedTimestampPill: document.getElementById('detected-timestamp-pill'),
  editingBadge: document.getElementById('editing-badge'),
  inputTitle: document.getElementById('input-title'),
  inputUrl: document.getElementById('input-url'),
  inputTimestamp: document.getElementById('input-timestamp'),
  selectProject: document.getElementById('select-project'),
  btnManageProjects: document.getElementById('btn-manage-projects'),
  inputCategory: document.getElementById('input-category'),
  btnAddCategory: document.getElementById('btn-add-category'),
  selectedCategories: document.getElementById('selected-categories'),
  suggestedCategories: document.getElementById('suggested-categories'),
  inputQuote: document.getElementById('input-quote'),
  btnClearQuote: document.getElementById('btn-clear-quote'),
  inputNote: document.getElementById('input-note'),
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
  dialogDeleteDesc: document.getElementById('dialog-delete-desc')
};

let statusTimer = null;

function showStatus(message, type = 'success') {
  if (statusTimer) clearTimeout(statusTimer);
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner ${type === 'error' ? 'is-error' : 'is-success'}`;
  els.statusBanner.hidden = false;
  statusTimer = setTimeout(() => {
    els.statusBanner.hidden = true;
  }, 3600);
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
    STORAGE_KEYS.LAST_PROJECT_ID
  ]);

  state.projects = Array.isArray(data[STORAGE_KEYS.PROJECTS]) ? data[STORAGE_KEYS.PROJECTS] : [];
  state.items = Array.isArray(data[STORAGE_KEYS.ITEMS]) ? data[STORAGE_KEYS.ITEMS] : [];
  state.lastProjectId = data[STORAGE_KEYS.LAST_PROJECT_ID] || state.projects[0]?.id || '';

  if (state.projects.length === 0) {
    state.projects = [
      { id: 'proj_ingenieria_ia', name: 'Ingeniería IA', color: '#2563eb', createdAt: new Date().toISOString() },
      { id: 'proj_python', name: 'Python', color: '#059669', createdAt: new Date().toISOString() },
      { id: 'proj_bolsa', name: 'Bolsa y Mercados', color: '#d97706', createdAt: new Date().toISOString() }
    ];
    state.lastProjectId = state.projects[0].id;
    await chrome.storage.local.set({ [STORAGE_KEYS.PROJECTS]: state.projects });
  }
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

function updateSourceIndicators() {
  const url = els.inputUrl.value.trim();
  const sourceType = detectSourceType(url);
  const meta = SOURCE_META[sourceType] || SOURCE_META.web;

  els.detectedSourceBadge.textContent = meta.label;
  els.detectedSourceBadge.className = `source-badge ${meta.badgeClass}`;

  const sec = parseTimestampInput(els.inputTimestamp.value);
  if (sec !== null) {
    els.detectedTimestampPill.textContent = `⏱ ${formatTimestamp(sec)}`;
    els.detectedTimestampPill.hidden = false;
  } else {
    els.detectedTimestampPill.hidden = true;
  }

  els.btnClearQuote.hidden = !els.inputQuote.value.trim();
}

function renderProjectSelects() {
  const prevCaptureVal = els.selectProject.value || state.lastProjectId;
  const prevFilterVal = els.filterProject.value || 'all';

  els.selectProject.textContent = '';
  for (const project of state.projects) {
    const opt = document.createElement('option');
    opt.value = project.id;
    opt.textContent = project.name;
    els.selectProject.appendChild(opt);
  }
  if (state.projects.some((p) => p.id === prevCaptureVal)) {
    els.selectProject.value = prevCaptureVal;
  } else if (state.projects[0]) {
    els.selectProject.value = state.projects[0].id;
  }

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
}

function renderSelectedCategories() {
  els.selectedCategories.textContent = '';
  for (const cat of state.categoriesDraft) {
    const chip = document.createElement('span');
    chip.className = 'chip';

    const label = document.createElement('span');
    label.textContent = `#${cat}`;
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'chip-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Quitar categoría ${cat}`);
    removeBtn.addEventListener('click', () => {
      state.categoriesDraft = state.categoriesDraft.filter(
        (c) => c.toLowerCase() !== cat.toLowerCase()
      );
      renderSelectedCategories();
      renderSuggestedCategories();
    });
    chip.appendChild(removeBtn);
    els.selectedCategories.appendChild(chip);
  }
}

function renderSuggestedCategories() {
  const activeProjectId = els.selectProject.value;
  const freq = new Map();

  for (const item of state.items) {
    if (activeProjectId && item.projectId !== activeProjectId) continue;
    for (const cat of item.categories || []) {
      const key = cat.toLowerCase();
      if (!freq.has(key)) freq.set(key, { label: cat, count: 0 });
      freq.get(key).count += 1;
    }
  }

  const chosen = new Set(state.categoriesDraft.map((c) => c.toLowerCase()));
  const suggestions = Array.from(freq.values())
    .filter((entry) => !chosen.has(entry.label.toLowerCase()))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  els.suggestedCategories.textContent = '';
  for (const entry of suggestions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn';
    btn.textContent = `+ ${entry.label}`;
    btn.addEventListener('click', () => {
      addCategoriesFromInput(entry.label);
    });
    els.suggestedCategories.appendChild(btn);
  }
}

function addCategoriesFromInput(rawText) {
  const incoming = normalizeCategories(rawText);
  if (incoming.length === 0) return;
  state.categoriesDraft = normalizeCategories([...state.categoriesDraft, ...incoming]);
  renderSelectedCategories();
  renderSuggestedCategories();
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

async function applyDetectedContext(context) {
  if (!context) return;
  resetEditMode(false);
  els.inputTitle.value = context.title || '';
  els.inputUrl.value = context.url || '';
  els.inputTimestamp.value =
    context.timestampSec !== null && context.timestampSec !== undefined
      ? formatTimestamp(context.timestampSec)
      : '';
  if (context.quote) {
    els.inputQuote.value = context.quote;
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
          ? `Pestaña detectada (${formatTimestamp(res.context.timestampSec)}).`
          : 'Pestaña actual detectada.';
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
  showStatus('Contexto cargado desde la página. Elige proyecto y guarda.');
  return true;
}

function resetCaptureForm(clearAll = true) {
  els.editingItemId.value = '';
  els.editingBadge.hidden = true;
  els.btnCancelEdit.hidden = true;
  els.btnSaveCapture.textContent = 'Guardar captura';

  if (clearAll) {
    els.inputTitle.value = '';
    els.inputUrl.value = '';
    els.inputTimestamp.value = '';
    els.inputCategory.value = '';
    els.inputQuote.value = '';
    els.inputNote.value = '';
    state.categoriesDraft = [];
    state.attachedImage = null;
    renderSelectedCategories();
    renderSuggestedCategories();
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
  els.btnSaveCapture.textContent = 'Guardar cambios';

  els.inputTitle.value = item.title || '';
  els.inputUrl.value = item.url || '';
  els.inputTimestamp.value =
    item.timestampSec !== null && item.timestampSec !== undefined
      ? formatTimestamp(item.timestampSec)
      : '';
  if (state.projects.some((p) => p.id === item.projectId)) {
    els.selectProject.value = item.projectId;
  }
  state.categoriesDraft = [...(item.categories || [])];
  els.inputQuote.value = item.quote || '';
  els.inputNote.value = item.note || '';
  state.attachedImage = item.image ? { ...item.image } : null;

  renderSelectedCategories();
  renderSuggestedCategories();
  renderAttachedImage();
  updateSourceIndicators();
  els.inputTitle.focus();
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

function renderLibrary() {
  els.libraryCount.textContent = String(state.items.length);
  renderLibraryCategoryChips();

  const items = getFilteredItems();
  const projectMap = new Map(state.projects.map((p) => [p.id, p]));

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
        ? 'Abre YouTube, Coursera, Gemini o cualquier web y guarda tu primer deep link.'
        : 'Prueba cambiando el proyecto, fuente o búsqueda.';
    empty.append(p1, p2);
    els.libraryList.appendChild(empty);
  } else {
    for (const item of items) {
      const project = projectMap.get(item.projectId);
      const source = SOURCE_META[item.sourceType] || SOURCE_META.web;

      const card = document.createElement('article');
      card.className = 'item-card';
      card.style.setProperty('--card-accent', project?.color || '#2563eb');

      const top = document.createElement('div');
      top.className = 'item-card-top';

      const projPill = document.createElement('span');
      projPill.className = 'project-pill';
      const dot = document.createElement('span');
      dot.className = 'project-dot';
      dot.style.backgroundColor = project?.color || '#2563eb';
      const projName = document.createElement('span');
      projName.textContent = project?.name || 'Sin proyecto';
      projPill.append(dot, projName);
      top.appendChild(projPill);

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
        openTitleBtn.addEventListener('click', () => openSavedItem(item));
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
        openBtn.className = 'btn btn-primary btn-sm';
        openBtn.textContent = 'Abrir';
        openBtn.addEventListener('click', () => openSavedItem(item));
        actions.appendChild(openBtn);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-secondary btn-sm';
        copyBtn.textContent = 'Copiar link';
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(item.deepLinkUrl || item.url);
            showStatus('Deep link copiado al portapapeles.');
          } catch {
            showStatus('No se pudo copiar el enlace.', 'error');
          }
        });
        actions.appendChild(copyBtn);
      }

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-ghost btn-sm';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => startEditingItem(item));
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-ghost btn-sm';
      delBtn.textContent = 'Eliminar';
      delBtn.addEventListener('click', () => requestDeleteItem(item));
      actions.appendChild(delBtn);

      card.appendChild(actions);
      els.libraryList.appendChild(card);
    }
  }

  const totalImgBytes = state.items.reduce((acc, it) => acc + (it.image?.sizeBytes || 0), 0);
  const label = state.items.length === 1 ? '1 captura' : `${state.items.length} capturas`;
  els.storageSummary.textContent =
    totalImgBytes > 0 ? `${label} · Imágenes: ${formatBytes(totalImgBytes)}` : label;
}

async function openSavedItem(item) {
  const res = await chrome.runtime.sendMessage({ type: 'STUDY_OPEN_ITEM', item });
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
        await persistProjects();
        await persistItems();
        renderProjectSelects();
        renderProjectsManageList();
        renderLibrary();
        showStatus(`Proyecto "${project.name}" eliminado.`);
      });
      li.appendChild(delBtn);
    }

    els.projectsManageList.appendChild(li);
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
  showStatus(
    includeImages
      ? 'Respaldo JSON completo descargado.'
      : 'JSON ligero (sin imágenes) descargado.'
  );
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
    renderProjectSelects();
    renderLibrary();
    showStatus(`Importado: ${addedProjects} proyectos y ${addedItems} capturas nuevas.`);
  } catch (err) {
    showStatus(err?.message || 'Error importando el archivo JSON.', 'error');
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
        if (!els.inputTitle.value.trim()) {
          els.inputTitle.value = `Captura ${formatShortDate(new Date().toISOString())}`;
        }
        updateSourceIndicators();
        showStatus(`Captura pegada (${formatBytes(state.attachedImage.sizeBytes)}).`);
      } catch (err) {
        showStatus(err?.message || 'No se pudo leer la imagen del portapapeles.', 'error');
      }
      return;
    }
  }
}

function bindEvents() {
  els.tabCapture.addEventListener('click', () => setActiveTab('capture'));
  els.tabLibrary.addEventListener('click', () => setActiveTab('library'));

  els.btnDetectTab.addEventListener('click', () => detectActiveTab(false));

  els.btnCropTab.addEventListener('click', async () => {
    els.btnCropTab.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'STUDY_REQUEST_CROP' });
      if (!res?.ok) {
        if (!res?.cancelled && res?.error) showStatus(res.error, 'error');
        return;
      }
      state.attachedImage = await compressImageFromSource(res.dataUrl, res.rect, res.dpr);
      renderAttachedImage();
      showStatus(`Recorte guardado (${formatBytes(state.attachedImage.sizeBytes)}).`);
    } catch (err) {
      showStatus(err?.message || 'Error recortando la pantalla.', 'error');
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
      showStatus(`Pestaña capturada (${formatBytes(state.attachedImage.sizeBytes)}).`);
    } catch (err) {
      showStatus(err?.message || 'Error capturando la pestaña.', 'error');
    } finally {
      els.btnFullCapture.disabled = false;
    }
  });

  els.inputUrl.addEventListener('input', updateSourceIndicators);
  els.inputTimestamp.addEventListener('input', updateSourceIndicators);
  els.inputQuote.addEventListener('input', updateSourceIndicators);

  els.selectProject.addEventListener('change', () => {
    renderSuggestedCategories();
  });

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

  els.btnRemoveImage.addEventListener('click', () => {
    state.attachedImage = null;
    renderAttachedImage();
  });

  els.btnPreviewImage.addEventListener('click', () => {
    if (state.attachedImage?.dataUrl) {
      openImageLightbox(state.attachedImage.dataUrl, els.inputTitle.value.trim() || 'Captura adjunta');
    }
  });

  els.btnCancelEdit.addEventListener('click', () => {
    resetCaptureForm(true);
    detectActiveTab(true);
  });

  els.captureForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Commit any typed category sitting in the input field
    if (els.inputCategory.value.trim()) {
      addCategoriesFromInput(els.inputCategory.value);
      els.inputCategory.value = '';
    }

    const title = els.inputTitle.value.trim();
    if (!title) {
      els.inputTitle.focus();
      return;
    }

    const url = els.inputUrl.value.trim();
    const rawTs = els.inputTimestamp.value.trim();
    const timestampSec = rawTs ? parseTimestampInput(rawTs) : null;
    if (rawTs && timestampSec === null) {
      els.inputTimestamp.setCustomValidity('Usa formato mm:ss o segundos (ej. 04:15).');
      els.inputTimestamp.reportValidity();
      return;
    }
    els.inputTimestamp.setCustomValidity('');

    const projectId = els.selectProject.value;
    const quote = els.inputQuote.value.trim();
    const note = els.inputNote.value.trim();
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
        createdAt: now,
        updatedAt: now,
        syncedAt: null
      };
      state.items.unshift(newItem);
      showStatus('Captura guardada en tu biblioteca.');
    }

    state.lastProjectId = projectId;
    await chrome.storage.local.set({
      [STORAGE_KEYS.ITEMS]: state.items,
      [STORAGE_KEYS.LAST_PROJECT_ID]: projectId
    });

    resetCaptureForm(true);
    els.libraryCount.textContent = String(state.items.length);
    renderSuggestedCategories();
  });

  els.inputTimestamp.addEventListener('input', () => {
    els.inputTimestamp.setCustomValidity('');
  });

  // Library filters
  els.filterQuery.addEventListener('input', renderLibrary);
  els.filterProject.addEventListener('change', () => {
    state.filterCategory = 'all';
    renderLibrary();
  });
  els.filterSource.addEventListener('change', renderLibrary);

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
    await persistProjects();
    renderProjectSelects();
    els.selectProject.value = newProject.id;
    renderSuggestedCategories();
    renderProjectsManageList();
    els.inputProjectName.value = '';
    showStatus(`Proyecto "${name}" creado.`);
  });

  // Image lightbox dialog
  els.btnCloseImage.addEventListener('click', () => els.dialogImage.close());

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
      renderSuggestedCategories();
      showStatus('Captura eliminada.');
    }
  });

  // Global clipboard paste listener for Ctrl+V screenshots (e.g. Win+Shift+S)
  window.addEventListener('paste', handlePasteImage);

  // Live updates from service worker (context menu / Alt+S shortcut)
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'STUDY_PENDING_CAPTURE_UPDATED' && message.payload) {
      chrome.storage.session.remove(STORAGE_KEYS.PENDING_CAPTURE).catch(() => {});
      setActiveTab('capture');
      applyDetectedContext(message.payload);
      showStatus('Contexto actualizado desde la pestaña.');
    }
  });
}

async function init() {
  setupDialogLightDismissFallback();
  await loadState();
  renderProjectSelects();
  renderSelectedCategories();
  renderSuggestedCategories();
  renderAttachedImage();
  els.libraryCount.textContent = String(state.items.length);
  bindEvents();

  const hadPending = await checkPendingCaptureFromSession();
  if (!hadPending) {
    await detectActiveTab(true);
  }
}

init();
