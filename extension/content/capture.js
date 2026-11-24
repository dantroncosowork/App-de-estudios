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

  function normalizeText(str) {
    return (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function showPageToast(message, durationMs = 3400) {
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

  function highlightElementTemporarily(el, toastMessage) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    const prevBg = el.style.backgroundColor;
    const prevRadius = el.style.borderRadius;
    const prevTransition = el.style.transition;

    el.style.transition = 'outline-color 220ms ease, background-color 220ms ease';
    el.style.outline = '3px solid #2563eb';
    el.style.outlineOffset = '4px';
    el.style.borderRadius = '6px';
    el.style.backgroundColor = 'rgba(37, 99, 235, 0.14)';

    if (toastMessage) showPageToast(toastMessage);

    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
      el.style.backgroundColor = prevBg;
      el.style.borderRadius = prevRadius;
      el.style.transition = prevTransition;
    }, 4200);
  }

  function findBestVideo() {
    const shorts = document.querySelector('ytd-reel-video-renderer[is-active] video');
    if (shorts && shorts.readyState >= 1) return shorts;

    const ytMain = document.querySelector('#movie_player video.html5-main-video, video.html5-main-video');
    if (ytMain && (ytMain.currentTime > 0 || ytMain.duration > 1)) return ytMain;

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

  function captureAreaAnchor(rect) {
    const cx = Math.min(window.innerWidth - 2, Math.max(2, rect.x + rect.width / 2));
    const cy = Math.min(window.innerHeight - 2, Math.max(2, rect.y + rect.height / 2));
    const target = document.elementFromPoint(cx, cy);

    let elementId = '';
    let textSnippet = '';
    let headingText = '';

    if (target) {
      const withId = target.closest('[id]');
      if (withId?.id && !withId.id.startsWith('study-deeplink')) {
        elementId = withId.id;
      }

      const block =
        target.closest('p, li, pre, code, blockquote, figure, table, section, article, h1, h2, h3, h4, td, div') ||
        target;
      const rawText = (block.innerText || block.textContent || '').replace(/\s+/g, ' ').trim();
      textSnippet = rawText.slice(0, 140);

      // Find nearest heading above or inside parent section
      const section = target.closest('section, article, main') || document.body;
      const headings = Array.from(section.querySelectorAll('h1, h2, h3, h4'));
      let closestH = null;
      let bestDist = Infinity;
      for (const h of headings) {
        const hr = h.getBoundingClientRect();
        const dist = cy - hr.top;
        if (dist >= -40 && dist < bestDist) {
          bestDist = dist;
          closestH = h;
        }
      }
      if (closestH) {
        headingText = (closestH.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      }
    }

    const scrollHeight = Math.max(1, document.documentElement.scrollHeight);
    return {
      scrollY: Math.round(window.scrollY),
      scrollRatio: Number((window.scrollY / scrollHeight).toFixed(4)),
      elementId,
      headingText,
      textSnippet
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

        // Capture DOM/scroll anchor for this visual area now that overlay is gone
        const pageAnchor = captureAreaAnchor(currentRect);

        // Wait two frames so the overlay is completely cleared before Chrome captures the tab
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve({
              ok: true,
              rect: currentRect,
              dpr: window.devicePixelRatio || 1,
              pageAnchor
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

  // Finds the deepest visible block containing a phrase — works across Markdown formatting (bold/code) in Gemini, Claude, ChatGPT, and webs
  function findBestBlockByText(rawPhrase) {
    const clean = normalizeText(rawPhrase);
    if (clean.length < 4) return null;

    const candidates = [clean.slice(0, 60), clean.slice(0, 32)];
    if (clean.length > 70) {
      candidates.push(clean.slice(24, 64));
    }

    const selector =
      'p, li, pre, code, blockquote, h1, h2, h3, h4, td, dd, message-content, model-response, article, section';
    const blocks = Array.from(document.querySelectorAll(selector));

    for (const needle of candidates) {
      if (needle.length < 4) continue;
      let bestEl = null;
      let bestLen = Infinity;

      for (const el of blocks) {
        if (el.id === 'study-deeplink-toast') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const text = normalizeText(el.innerText || el.textContent);
        if (text.length >= needle.length && text.includes(needle)) {
          // Prefer the tightest / smallest block containing the quote
          if (text.length < bestLen) {
            bestLen = text.length;
            bestEl = el;
          }
        }
      }

      if (bestEl) return bestEl;
    }

    return null;
  }

  function locateQuoteWhenReady(quote) {
    const clean = normalizeText(quote);
    if (clean.length < 4) return;
    const deadline = Date.now() + 12000;

    function attempt() {
      const el = findBestBlockByText(quote);
      if (el) {
        highlightElementTemporarily(el, 'Estudio Deep Link · Cita localizada');
        return;
      }

      if (Date.now() < deadline) {
        setTimeout(attempt, 650);
      } else {
        showPageToast('Cita no visible aún · Usa "Copiar cita" + Ctrl+F si el chat es muy largo');
      }
    }

    setTimeout(attempt, 900);
  }

  function restoreAreaAnchorWhenReady(anchor) {
    if (!anchor) return;
    const deadline = Date.now() + 10000;

    function attempt(isFinal) {
      if (anchor.textSnippet && anchor.textSnippet.length >= 12) {
        const byText = findBestBlockByText(anchor.textSnippet);
        if (byText) {
          highlightElementTemporarily(byText, 'Estudio Deep Link · Área recortada localizada');
          return;
        }
      }

      if (anchor.elementId) {
        const byId = document.getElementById(anchor.elementId);
        if (byId) {
          highlightElementTemporarily(byId, 'Estudio Deep Link · Sección localizada');
          return;
        }
      }

      if (anchor.headingText && anchor.headingText.length >= 4) {
        const byHeading = findBestBlockByText(anchor.headingText);
        if (byHeading) {
          highlightElementTemporarily(byHeading, 'Estudio Deep Link · Sección localizada');
          return;
        }
      }

      if (!isFinal && Date.now() < deadline) {
        setTimeout(() => attempt(Date.now() + 700 >= deadline), 600);
        return;
      }

      // Scroll fallback when DOM has no stable text anchor (e.g., canvas / chart / image)
      if (typeof anchor.scrollY === 'number' && anchor.scrollY > 0) {
        window.scrollTo({ top: anchor.scrollY, behavior: 'smooth' });
        showPageToast('Estudio Deep Link · Posición aproximada restaurada');
      }
    }

    setTimeout(() => attempt(false), 700);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) return;

    if (message.type === 'STUDY_PING') {
      sendResponse({ ok: true });
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
      } else if (message.pageAnchor) {
        restoreAreaAnchorWhenReady(message.pageAnchor);
      }
      sendResponse({ ok: true });
    }
  });
})();
