import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

const RENDER_SCALE = 1.5;
const THUMB_SCALE = 0.3;
const LAZY_RANGE = 5;     // render ± 5 pages around current
const EVICT_RANGE = 15;   // evict pages beyond ± 15

// Read server-injected config or fall back to query string
const config = window.__BOOK_CONFIG__ || {};
const PDF_URL = config.pdfSrc || new URLSearchParams(location.search).get('src') || './sample.pdf';
const INITIAL_RTL = config.turnPage === 'left';

// Page flip sound effect
let soundEnabled = true;
const flipSound = (() => {
  const audio = new Audio('./page-flip.mp3');
  audio.volume = 0.5;
  return function play() {
    if (!soundEnabled) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };
})();

// Lazy rendering state
let pdfDoc = null;
const pageCache = new Map(); // pageNum → { dataUrl, width, height }
let pageWidth = 0;
let pageHeight = 0;

async function renderPage(pageNum, scale = RENDER_SCALE) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL(),
    width: viewport.width,
    height: viewport.height,
  };
}

async function ensurePagesRendered(centerPage, range) {
  const numPages = pdfDoc.numPages;
  const lo = Math.max(1, centerPage - range);
  const hi = Math.min(numPages, centerPage + range);

  const promises = [];
  for (let i = lo; i <= hi; i++) {
    if (!pageCache.has(i)) {
      promises.push(
        renderPage(i).then((data) => {
          pageCache.set(i, data);
          // Update placeholder if it exists
          const placeholder = document.querySelector(`.page[data-page="${i}"] .page-loading`);
          if (placeholder) {
            const parent = placeholder.parentElement;
            parent.innerHTML = '';
            const img = document.createElement('img');
            img.src = data.dataUrl;
            parent.appendChild(img);
          }
        })
      );
    }
  }
  await Promise.all(promises);
}

function evictDistantPages(centerPage) {
  for (const [pageNum] of pageCache) {
    if (Math.abs(pageNum - centerPage) > EVICT_RANGE) {
      pageCache.delete(pageNum);
    }
  }
}

async function init() {
  const loadingEl = document.getElementById('loading');
  let bookEl = document.getElementById('book');

  try {
    // 1. Load PDF
    let pdfSource = PDF_URL;
    const isExternal = PDF_URL.startsWith('http');
    if (isExternal) {
      try {
        loadingEl.textContent = 'Loading PDF...';
        const res = await fetch(PDF_URL);
        pdfSource = { data: await res.arrayBuffer() };
      } catch {
        loadingEl.textContent = 'Retrying via CORS proxy...';
        const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(PDF_URL)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('Failed to load PDF via proxy');
        pdfSource = { data: await res.arrayBuffer() };
      }
    }
    pdfDoc = await pdfjsLib.getDocument({
      ...pdfSource,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/cmaps/',
      cMapPacked: true,
    }).promise;
    const numPages = pdfDoc.numPages;

    // 2. Render initial pages (1~6) for fast first paint
    const initialEnd = Math.min(numPages, LAZY_RANGE + 1);
    for (let i = 1; i <= initialEnd; i++) {
      loadingEl.textContent = `Rendering page ${i} of ${numPages}...`;
      const data = await renderPage(i);
      pageCache.set(i, data);
    }

    // 3. Get page dimensions from first page
    const firstPage = pageCache.get(1);
    pageWidth = Math.round(firstPage.width);
    pageHeight = Math.round(firstPage.height);

    let isRtl = INITIAL_RTL;
    let pageFlip = null;
    let currentPageMap = [];
    let currentShowCover = true;
    let lastSoundTime = 0;
    let edgesFrozen = false;
    let isSinglePage = false;

    // Build page DOM elements and init StPageFlip
    function buildBook(rtl, targetOriginalPage, mouseEvents = true) {
      const parentEl = bookEl.parentNode;
      if (pageFlip) {
        try { pageFlip.destroy(); } catch {}
      }

      const newBookEl = document.createElement('div');
      newBookEl.id = 'book';
      if (bookEl.parentNode) {
        bookEl.parentNode.replaceChild(newBookEl, bookEl);
      } else {
        parentEl.appendChild(newBookEl);
      }
      bookEl = newBookEl;

      // Build page list
      const entries = [];
      for (let i = 1; i <= numPages; i++) {
        entries.push({ num: i });
      }
      if (rtl) entries.reverse();

      // Build DOM and page map
      currentPageMap = [];
      for (const entry of entries) {
        const div = document.createElement('div');
        div.dataset.density = 'soft';
        div.dataset.page = String(entry.num);
        div.className = 'page';

        const cached = pageCache.get(entry.num);
        if (cached) {
          const img = document.createElement('img');
          img.src = cached.dataUrl;
          div.appendChild(img);
        } else {
          // Placeholder with loading spinner
          const placeholder = document.createElement('div');
          placeholder.className = 'page-loading';
          placeholder.innerHTML = '<div class="page-spinner"></div>';
          div.appendChild(placeholder);
        }

        bookEl.appendChild(div);
        currentPageMap.push(entry.num);
      }

      const totalBookPages = entries.length;

      // Calculate page dimensions that fit the book area
      const bookArea = document.getElementById('book-area');
      const aspectRatio = pageWidth / pageHeight;
      const areaStyle = getComputedStyle(bookArea);
      const viewW = bookArea.clientWidth - parseFloat(areaStyle.paddingLeft) - parseFloat(areaStyle.paddingRight);
      const viewH = bookArea.clientHeight - parseFloat(areaStyle.paddingTop) - parseFloat(areaStyle.paddingBottom);

      let fitW = Math.round(viewH * aspectRatio);
      let fitH = viewH;

      if (isSinglePage) {
        if (fitW > viewW) {
          fitW = viewW;
          fitH = Math.round(fitW / aspectRatio);
        }
      } else {
        if (fitW * 2 > viewW) {
          fitW = Math.floor(viewW / 2);
          fitH = Math.round(fitW / aspectRatio);
        }
      }

      fitW = Math.min(fitW, pageWidth);
      fitH = Math.min(fitH, pageHeight);

      const useShowCover = rtl ? (totalBookPages % 2 === 0) : true;
      currentShowCover = useShowCover;

      if (isSinglePage) {
        bookEl.style.width = fitW + 'px';
        bookEl.style.maxWidth = fitW + 'px';
        bookEl.style.height = fitH + 'px';
      }

      pageFlip = new St.PageFlip(bookEl, {
        width: fitW,
        height: fitH,
        size: isSinglePage ? 'fixed' : 'stretch',
        maxWidth: fitW,
        maxHeight: fitH,
        flippingTime: 450,
        maxShadowOpacity: 0.3,
        showCover: useShowCover,
        mobileScrollSupport: false,
        autoSize: !isSinglePage,
        usePortrait: true,
        useMouseEvents: mouseEvents,
        startPage: targetOriginalPage !== undefined
          ? currentPageMap.indexOf(targetOriginalPage)
          : (rtl ? totalBookPages - 1 : 0),
      });
      pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));

      pageFlip.on('flip', () => {
        const now = Date.now();
        if (now - lastSoundTime > 500) {
          flipSound();
          lastSoundTime = now;
        }
        updatePageInfo();

        // Lazy render nearby pages on flip
        const currentPage = getOriginalPage();
        ensurePagesRendered(currentPage, LAZY_RANGE);
        evictDistantPages(currentPage);
      });
      pageFlip.on('flipping', (e) => {
        updatePageEdges(e.data);
      });
      pageFlip.on('changeState', (e) => {
        if (e.data === 'read') {
          edgesFrozen = false;
          updatePageEdges();
        }
      });

      requestAnimationFrame(() => updatePageEdges());
    }

    // Page-edge elements
    const edgeLeft = document.createElement('div');
    edgeLeft.className = 'book-edge book-edge-left';
    document.body.appendChild(edgeLeft);
    const edgeRight = document.createElement('div');
    edgeRight.className = 'book-edge book-edge-right';
    document.body.appendChild(edgeRight);

    function updatePageEdges(overrideIdx) {
      if (zoomLevel > 1 || edgesFrozen) {
        edgeLeft.style.display = 'none';
        edgeRight.style.display = 'none';
        return;
      }
      edgeLeft.style.display = '';
      edgeRight.style.display = '';
      const block = document.querySelector('.stf__block');
      if (!block || !pageFlip) return;

      const rect = block.getBoundingClientRect();
      const idx = overrideIdx !== undefined ? overrideIdx : pageFlip.getCurrentPageIndex();
      const total = currentPageMap.length;
      const maxEdge = Math.min(Math.ceil(numPages / 4), 20);

      let readProgress = idx / Math.max(total - 1, 1);
      if (isRtl) readProgress = 1 - readProgress;

      const readW = Math.round(readProgress * maxEdge);
      const unreadW = maxEdge - readW;
      const lw = isRtl ? unreadW : readW;
      const rw = isRtl ? readW : unreadW;

      const h = rect.height;
      const top = rect.top;

      edgeLeft.style.cssText = `position:fixed;top:${top}px;height:${h}px;left:${rect.left - lw}px;width:${lw}px`;
      edgeRight.style.cssText = `position:fixed;top:${top}px;height:${h}px;left:${rect.right}px;width:${rw}px`;
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
      loadingEl.textContent = 'Resizing...';
      loadingEl.classList.remove('hidden');
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const currentOriginalPage = getOriginalPage();
        zoomLevel = 1; panX = 0; panY = 0;
        buildBook(isRtl, currentOriginalPage);
        applyZoom();
        updatePageInfo();
        loadingEl.classList.add('hidden');
      }, 200);
    });

    // 4. Parse initial page from hash (#p=N)
    const hashPage = (() => {
      const m = location.hash.match(/^#p=(\d+)$/);
      if (!m) return undefined;
      const p = parseInt(m[1], 10);
      return (p >= 1 && p <= numPages) ? p : undefined;
    })();

    // If hash page is set, pre-render pages around it
    if (hashPage && hashPage > initialEnd) {
      await ensurePagesRendered(hashPage, LAZY_RANGE);
    }

    // 5. Build initial book (use server config for RTL)
    buildBook(isRtl, hashPage);

    // Apply initial RTL button state
    if (isRtl) {
      const btnRtl = document.getElementById('btn-rtl');
      btnRtl.innerHTML = '<span class="material-symbols-rounded">format_textdirection_l_to_r</span>';
      btnRtl.style.background = 'rgba(255,255,255,0.25)';
    }

    // 6. Hide loading indicator
    loadingEl.classList.add('hidden');

    // 6. Controls
    const toolbar = document.getElementById('toolbar');
    const pageInfoEl = document.getElementById('page-info');
    const pageSlider = document.getElementById('page-slider');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnFirst = document.getElementById('btn-first');
    const btnLast = document.getElementById('btn-last');
    const btnThumbnail = document.getElementById('btn-thumbnail');
    const btnPageMode = document.getElementById('btn-page-mode');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnShare = document.getElementById('btn-share');
    const btnSound = document.getElementById('btn-sound');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomClose = document.getElementById('btn-zoom-close');
    const zoomInfoEl = document.getElementById('zoom-info');
    const bookArea = document.getElementById('book-area');
    const btnRtl = document.getElementById('btn-rtl');

    // Zoom & pan state
    let zoomLevel = 1;
    let panX = 0, panY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    const ZOOM_STEP = 0.1;
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 3.0;

    function applyZoom() {
      const isZoomed = zoomLevel > 1;
      const wasZoomed = bookArea.classList.contains('zoom-mode');

      if (isZoomed !== wasZoomed) {
        const currentOriginalPage = getOriginalPage();
        buildBook(isRtl, currentOriginalPage, !isZoomed);
        updatePageInfo();
      }

      if (!isZoomed) { panX = 0; panY = 0; }

      if (isZoomed) {
        bookEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
      } else if (zoomLevel < 1) {
        bookEl.style.transform = `scale(${zoomLevel})`;
      } else {
        bookEl.style.transform = '';
      }

      zoomInfoEl.textContent = `${Math.round(zoomLevel * 100)}%`;

      bookArea.classList.toggle('zoom-mode', isZoomed);
      btnZoomClose.classList.toggle('hidden', !isZoomed);

      const navDisplay = isZoomed ? 'none' : '';
      btnPrev.style.display = navDisplay;
      btnNext.style.display = navDisplay;
      btnFirst.style.display = navDisplay;
      btnLast.style.display = navDisplay;
      edgeLeft.style.display = navDisplay;
      edgeRight.style.display = navDisplay;

      if (!isZoomed) {
        requestAnimationFrame(() => updatePageEdges());
      }
    }

    function resetZoom() {
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      applyZoom();
    }

    btnZoomIn.addEventListener('click', () => {
      if (zoomLevel < ZOOM_MAX) {
        zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(1));
        applyZoom();
      }
    });

    btnZoomOut.addEventListener('click', () => {
      if (zoomLevel > ZOOM_MIN) {
        zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(1));
        applyZoom();
      }
    });

    btnZoomClose.addEventListener('click', resetZoom);

    // Pan drag (only when zoomed in)
    bookArea.addEventListener('mousedown', (e) => {
      if (zoomLevel <= 1) return;
      isPanning = true;
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      bookEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    });

    document.addEventListener('mouseup', () => {
      isPanning = false;
    });

    // Page slider setup
    pageSlider.min = 1;
    pageSlider.max = numPages;
    pageSlider.value = 1;

    function getOriginalPage() {
      const idx = pageFlip.getCurrentPageIndex();
      return currentPageMap[idx] || 1;
    }

    function updatePageInfo() {
      const idx = pageFlip.getCurrentPageIndex();
      const total = currentPageMap.length;
      const page1 = currentPageMap[idx] || 1;

      const isSpreadStart = currentShowCover
        ? (idx > 0 && idx % 2 === 1)
        : (idx % 2 === 0);

      if (isSpreadStart && idx + 1 < total) {
        const page2 = currentPageMap[idx + 1];
        const lo = Math.min(page1, page2);
        const hi = Math.max(page1, page2);
        pageInfoEl.textContent = `${lo}-${hi} / ${numPages}`;
        pageSlider.value = lo;
      } else {
        pageInfoEl.textContent = `${page1} / ${numPages}`;
        pageSlider.value = page1;
      }

      // Update URL hash with current page (preserve pathname)
      history.replaceState(null, '', `${location.pathname}#p=${page1}`);
    }

    // 取得目前可見的頁碼範圍 [最小, 最大]
    function getVisiblePageRange() {
      if (!pageFlip) return [1, 1];
      const idx = pageFlip.getCurrentPageIndex();
      const total = currentPageMap.length;
      const page1 = currentPageMap[idx] || 1;

      const isSpreadStart = currentShowCover
        ? (idx > 0 && idx % 2 === 1)
        : (idx % 2 === 0);

      if (isSpreadStart && idx + 1 < total) {
        const page2 = currentPageMap[idx + 1];
        return [Math.min(page1, page2), Math.max(page1, page2)];
      }
      return [page1, page1];
    }

    function flipNext() {
      const [, hi] = getVisiblePageRange();
      if (hi >= numPages) return; // 已到最後一頁
      flipSound();
      lastSoundTime = Date.now();
      isRtl ? pageFlip.flipPrev() : pageFlip.flipNext();
    }

    function flipPrev() {
      const [lo] = getVisiblePageRange();
      if (lo <= 1) return; // 已到第一頁
      flipSound();
      lastSoundTime = Date.now();
      isRtl ? pageFlip.flipNext() : pageFlip.flipPrev();
    }

    function goFirst() {
      const targetIdx = isRtl ? currentPageMap.length - 1 : 0;
      if (pageFlip.getCurrentPageIndex() === targetIdx) return;
      edgesFrozen = true;
      flipSound();
      lastSoundTime = Date.now();
      pageFlip.flip(targetIdx);
    }

    function goLast() {
      const targetIdx = isRtl ? 0 : currentPageMap.length - 1;
      if (pageFlip.getCurrentPageIndex() === targetIdx) return;
      edgesFrozen = true;
      flipSound();
      lastSoundTime = Date.now();
      pageFlip.flip(targetIdx);
    }

    updatePageInfo();
    toolbar.classList.add('visible');

    btnPrev.addEventListener('click', () => flipPrev());
    btnNext.addEventListener('click', () => flipNext());
    btnFirst.addEventListener('click', () => goFirst());
    btnLast.addEventListener('click', () => goLast());

    pageSlider.addEventListener('input', () => {
      const targetPage = parseInt(pageSlider.value);
      const targetIdx = currentPageMap.indexOf(targetPage);
      if (targetIdx >= 0) {
        pageFlip.turnToPage(targetIdx);
        updatePageEdges(targetIdx);
        updatePageInfo();
        // Lazy load around slider position
        ensurePagesRendered(targetPage, LAZY_RANGE);
      }
    });
    pageSlider.addEventListener('change', () => {
      flipSound();
    });

    btnSound.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      btnSound.innerHTML = `<span class="material-symbols-rounded">${soundEnabled ? 'volume_up' : 'volume_off'}</span>`;
      btnSound.style.background = soundEnabled ? '' : 'rgba(255,255,255,0.25)';
    });

    btnRtl.addEventListener('click', () => {
      const currentOriginalPage = getOriginalPage();
      isRtl = !isRtl;
      btnRtl.innerHTML = `<span class="material-symbols-rounded">${isRtl ? 'format_textdirection_l_to_r' : 'format_textdirection_r_to_l'}</span>`;
      btnRtl.style.background = isRtl ? 'rgba(255,255,255,0.25)' : '';

      zoomLevel = 1; panX = 0; panY = 0;
      buildBook(isRtl, currentOriginalPage);
      applyZoom();
      buildThumbnails();
      updatePageInfo();
    });

    btnPageMode.addEventListener('click', () => {
      const currentOriginalPage = getOriginalPage();
      isSinglePage = !isSinglePage;
      btnPageMode.innerHTML = `<span class="material-symbols-rounded">${isSinglePage ? 'menu_book' : 'article'}</span>`;
      btnPageMode.style.background = isSinglePage ? 'rgba(255,255,255,0.25)' : '';
      zoomLevel = 1; panX = 0; panY = 0;
      buildBook(isRtl, currentOriginalPage);
      applyZoom();
      updatePageInfo();
    });

    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });

    // Thumbnail overlay
    const thumbOverlay = document.getElementById('thumbnail-overlay');
    const thumbGrid = document.getElementById('thumbnail-grid');
    const btnThumbClose = document.getElementById('btn-thumb-close');

    async function buildThumbnails() {
      thumbGrid.innerHTML = '';
      const total = currentPageMap.length;
      let i = 0;

      if (currentShowCover && total > 0) {
        await addThumbItem([currentPageMap[0]], 0);
        i = 1;
      }

      while (i < total) {
        if (i + 1 < total) {
          await addThumbItem([currentPageMap[i], currentPageMap[i + 1]], i);
          i += 2;
        } else {
          await addThumbItem([currentPageMap[i]], i);
          i++;
        }
      }
    }

    async function addThumbItem(pages, flipIdx) {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.dataset.pages = pages.join(',');

      const imgWrap = document.createElement('div');
      imgWrap.className = pages.length === 1 ? 'thumb-single' : 'thumb-spread';

      for (const pageNum of pages) {
        // Use cached image or render low-res thumbnail
        let cached = pageCache.get(pageNum);
        if (!cached) {
          cached = await renderPage(pageNum, THUMB_SCALE);
          // Don't put low-res in main cache
        }
        const img = document.createElement('img');
        img.src = cached.dataUrl;
        imgWrap.appendChild(img);
      }

      item.appendChild(imgWrap);

      const label = document.createElement('div');
      label.className = 'thumb-label';
      const sorted = [...pages].sort((a, b) => a - b);
      label.textContent = sorted.length > 1 ? `${sorted[0]}-${sorted[1]}` : sorted[0];
      item.appendChild(label);

      item.addEventListener('click', () => {
        pageFlip.turnToPage(flipIdx);
        updatePageEdges(flipIdx);
        updatePageInfo();
        thumbOverlay.classList.add('hidden');
        // Lazy load around clicked page
        const clickedPage = pages[0];
        ensurePagesRendered(clickedPage, LAZY_RANGE);
      });

      thumbGrid.appendChild(item);
    }

    buildThumbnails();

    function updateThumbnailActive() {
      const currentPage = String(getOriginalPage());
      thumbGrid.querySelectorAll('.thumb-item').forEach(el => {
        const pages = el.dataset.pages.split(',');
        el.classList.toggle('active', pages.includes(currentPage));
      });
    }

    btnThumbnail.addEventListener('click', () => {
      updateThumbnailActive();
      thumbOverlay.classList.toggle('hidden');
      const active = thumbGrid.querySelector('.thumb-item.active');
      if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });

    btnThumbClose.addEventListener('click', () => {
      thumbOverlay.classList.add('hidden');
    });

    // Share
    btnShare.addEventListener('click', async () => {
      const shareUrl = window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({ title: document.title, url: shareUrl });
        } catch {}
      } else {
        await navigator.clipboard.writeText(shareUrl);
        btnShare.innerHTML = '<span class="material-symbols-rounded">check</span>';
        setTimeout(() => { btnShare.innerHTML = '<span class="material-symbols-rounded">share</span>'; }, 1500);
      }
    });

    // 7. Arrow key navigation
    document.addEventListener('keydown', (e) => {
      if (!thumbOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') thumbOverlay.classList.add('hidden');
        return;
      }
      if (e.key === 'Escape' && zoomLevel > 1) {
        resetZoom();
        return;
      }
      if ((e.key === '=' || e.key === '+') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        btnZoomIn.click();
      }
      if (e.key === '-' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        btnZoomOut.click();
      }
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        resetZoom();
      }
      if (zoomLevel <= 1) {
        if (e.key === 'ArrowRight') flipNext();
        if (e.key === 'ArrowLeft') flipPrev();
        if (e.key === 'Home') goFirst();
        if (e.key === 'End') goLast();
      }
    });
  } catch (err) {
    loadingEl.textContent = `Error: ${err.message}`;
    console.error('Failed to load PDF:', err);
  }
}

init();
