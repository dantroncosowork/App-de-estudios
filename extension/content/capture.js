(() => {
  if (window.__STUDY_DEEP_LINK_LOADED__) return;
  window.__STUDY_DEEP_LINK_LOADED__ = true;

  function formatSec(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function showPageToast(message, durationMs = 3200) {
    const existing = document.getElementById('study-deeplink-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'study-deeplink-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '2147483647',
      background: '#0f172a',
      color: '#f8fafc',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      borderRadius: '10px',
      padding: '10px 14px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 160ms ease'
    });

    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, durationMs);
  }

  function findBestVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    let best = null;
    let bestScore = -1;

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      let score = 0;
      if (!video.paused && !video.ended) score += 100000;
      if (video.currentTime > 0) score += 50000;
      if (Number.isFinite(video.duration) && video.duration > 1) score += 10000;
      score += Math.min(area, 50000);

      if (score > bestScore) {
        bestScore = score;
        best = video;
      }
    }

    return best;
  }

  function cleanTitle(rawTitle) {
    if (!rawTitle) return '';
    return rawTitle.replace(/^\(\d+\)\s+/, '').trim();
  }

  function extractPageContext() {
    const video = findBestVideo();
    let timestampSec = null;

    if (video && Number.isFinite(video.currentTime) && (video.currentTime > 0 || video.duration > 1)) {
      timestampSec = Math.floor(video.currentTime);
    }

    const rawSelection = window.getSelection ? window.getSelection().toString() : '';
    const quote = rawSelection.replace(/\s+/g, ' ').trim().slice(0, 1800);

    return {
      url: window.location.href,
      title: cleanTitle(document.title),
      timestampSec,
      quote
    };
  }

  function startInteractiveCrop() {
    return new Promise((resolve) => {
      const oldOverlay = document.getElementById('study-deeplink-crop-overlay');
      if (oldOverlay) oldOverlay.remove();

      const overlay = document.createElement('div');
      overlay.id = 'study-deeplink-crop-overlay';
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        background: 'rgba(15, 23, 42, 0.35)',
        cursor: 'crosshair',
        userSelect: 'none',
        touchAction: 'none'
      });

      const banner = document.createElement('div');
      banner.textContent = 'Arrastra para recortar un área · Pulsa Esc para cancelar';
      Object.assign(banner.style, {
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#0f172a',
        color: '#f8fafc',
        padding: '8px 14px',
        borderRadius: '999px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: '13px',
        fontWeight: '500',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
        pointerEvents: 'none'
      });
      overlay.appendChild(banner);

      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed',
        border: '2px solid #38bdf8',
        background: 'rgba(56, 189, 248, 0.14)',
        boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.42)',
        display: 'none',
        pointerEvents: 'none'
      });
      overlay.appendChild(box);

      const sizeBadge = document.createElement('div');
      Object.assign(sizeBadge.style, {
        position: 'absolute',
        bottom: '-26px',
        right: '0',
        background: '#0f172a',
        color: '#f8fafc',
        fontSize: '11px',
        padding: '2px 6px',
        borderRadius: '4px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'nowrap'
      });
      box.appendChild(sizeBadge);

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let currentRect = null;

      function cleanup() {
        window.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cleanup();
          resolve({ ok: false, cancelled: true });
        }
      }

      overlay.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        overlay.style.background = 'transparent';
        box.style.display = 'block';
        box.style.left = `${startX}px`;
        box.style.top = `${startY}px`;
        box.style.width = '0px';
        box.style.height = '0px';
        overlay.setPointerCapture(e.pointerId);
      });

      overlay.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const x = Math.min(startX, e.clientX);
        const y = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);
        currentRect = { x, y, width, height };
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        sizeBadge.textContent = `${Math.round(width)} × ${Math.round(height)}`;
      });

      overlay.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        cleanup();

        if (!currentRect || currentRect.width < 12 || currentRect.height < 12) {
          resolve({ ok: false, cancelled: true });
          return;
        }

        // Wait two frames so the overlay is completely cleared before Chrome captures the tab
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve({
              ok: true,
              rect: currentRect,
              dpr: window.devicePixelRatio || 1
            });
          });
        });
      });

      window.addEventListener('keydown', onKeyDown, true);
      document.documentElement.appendChild(overlay);
    });
  }

  function seekVideoWhenReady(timestampSec) {
    const targetSec = Math.max(0, Math.floor(Number(timestampSec)));
    const deadline = Date.now() + 16000;

    function attempt() {
      const video = findBestVideo();
      if (video && video.readyState >= 1) {
        try {
          video.currentTime = targetSec;
          showPageToast(`Estudio Deep Link · Saltado a ${formatSec(targetSec)}`);
          return;
        } catch {
          // Retry briefly if player blocked early seek
        }
      }

      if (Date.now() < deadline) {
        setTimeout(attempt, 450);
      } else {
        showPageToast(`Minuto guardado: ${formatSec(targetSec)} (no se detectó reproductor)`);
      }
    }

    attempt();
  }

  function normalizeText(str) {
    return (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function locateQuoteWhenReady(quote) {
    const clean = normalizeText(quote);
    if (clean.length < 4) return;
    const snippet = clean.slice(0, 64);
    const deadline = Date.now() + 10000;

    function searchDom() {
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const val = normalizeText(node.nodeValue);
        if (val.length >= 4 && val.includes(snippet.slice(0, Math.min(snippet.length, 32)))) {
          const parent = node.parentElement;
          if (parent && parent.offsetParent !== null) {
            return parent;
          }
        }
        node = walker.nextNode();
      }
      return null;
    }

    function attempt() {
      const el = searchDom();
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prevOutline = el.style.outline;
        const prevOffset = el.style.outlineOffset;
        const prevBg = el.style.backgroundColor;
        el.style.outline = '2px solid #2563eb';
        el.style.outlineOffset = '4px';
        el.style.backgroundColor = 'rgba(37, 99, 235, 0.14)';
        showPageToast('Estudio Deep Link · Cita localizada');

        setTimeout(() => {
          el.style.outline = prevOutline;
          el.style.outlineOffset = prevOffset;
          el.style.backgroundColor = prevBg;
        }, 3800);
        return;
      }

      if (Date.now() < deadline) {
        setTimeout(attempt, 650);
      } else {
        showPageToast('Chat abierto · Consulta la cita completa en tu panel de Estudio');
      }
    }

    setTimeout(attempt, 800);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) return;

    if (message.type === 'STUDY_PING') {
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'STUDY_EXTRACT_CONTEXT') {
      sendResponse(extractPageContext());
      return;
    }

    if (message.type === 'STUDY_START_CROP') {
      (async () => {
        const result = await startInteractiveCrop();
        sendResponse(result);
      })();
      return true;
    }

    if (message.type === 'STUDY_RESTORE_POSITION') {
      if (message.timestampSec !== null && message.timestampSec !== undefined) {
        seekVideoWhenReady(message.timestampSec);
      } else if (message.quote) {
        locateQuoteWhenReady(message.quote);
      }
      sendResponse({ ok: true });
    }
  });
})();
