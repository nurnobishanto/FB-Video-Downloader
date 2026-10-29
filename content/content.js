/**
 * SOFT IT FB VIDEO DOWNLOADER - Content Script (Isolated World)
 * Injects floating download button on videos, coordinates detections between
 * in-page script, background webRequest, and the user interface.
 */

(() => {
  const videoCatalog = new Map();
  let showOverlayButtons = true;
  let defaultQuality = 'HD';

  // Load preferences
  chrome.storage?.local?.get(['showOverlayButtons', 'defaultQuality'], (res) => {
    if (res.showOverlayButtons !== undefined) showOverlayButtons = res.showOverlayButtons;
    if (res.defaultQuality !== undefined) defaultQuality = res.defaultQuality;
  });

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.showOverlayButtons) {
        showOverlayButtons = changes.showOverlayButtons.newValue;
        toggleAllOverlays(showOverlayButtons);
      }
      if (changes.defaultQuality) {
        defaultQuality = changes.defaultQuality.newValue;
      }
    }
  });

  // 1. Receive detections from in-page script
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'SOFT_IT_INPAGE') return;

    if (event.data.type === 'VIDEO_DETECTED' || event.data.type === 'VIDEO_UPDATED') {
      const video = event.data.video;
      if (video && video.id) {
        videoCatalog.set(video.id, video);
        syncVideosWithBackground();
      }
    } else if (event.data.type === 'VIDEO_BATCH_SYNC') {
      const videos = event.data.videos || [];
      videos.forEach(v => {
        if (v && v.id) videoCatalog.set(v.id, v);
      });
      syncVideosWithBackground();
    }
  });

  // 2. Receive detections from Background (via webRequest)
  chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (message.type === 'BG_VIDEO_DETECTED') {
      const video = message.video;
      if (video && video.id) {
        videoCatalog.set(video.id, video);
        syncVideosWithBackground();
      }
    } else if (message.type === 'REFRESH_VIDEOS') {
      requestInPageVideos();
      scanForVideos();
      sendResponse({ status: 'scanned', count: videoCatalog.size });
    }
  });

  let syncTimeout = null;
  function syncVideosWithBackground() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      const list = Array.from(videoCatalog.values());
      chrome.runtime?.sendMessage({
        type: 'REGISTER_VIDEOS',
        videos: list,
        url: window.location.href,
        pageTitle: document.title
      }).catch(() => {});
    }, 250);
  }

  function requestInPageVideos() {
    window.postMessage({ type: 'SOFT_IT_REQUEST_VIDEOS' }, '*');
  }

  // 3. DOM Container Discovery
  function findVideoContainer(videoElem) {
    if (!videoElem) return null;

    const selectors = [
      '[role="article"]',
      '[data-pagelet*="FeedUnit"]',
      '[data-pagelet*="TahoeVideo"]',
      'div[data-video-id]',
      'div[aria-label*="video" i]',
      'div[aria-label*="reel" i]',
      '.x1y1aw1k',
      '.x78zum5.xdt5ytf.x1iyjqo2'
    ];

    for (const selector of selectors) {
      const container = videoElem.closest(selector);
      if (container && container.offsetWidth > 150 && container.offsetHeight > 150) {
        return container;
      }
    }

    let parent = videoElem.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      if (parent.offsetWidth > 180 && parent.offsetHeight > 140) {
        return parent;
      }
      parent = parent.parentElement;
    }

    return videoElem.parentElement;
  }

  function createOverlayButton(container, videoElem) {
    if (container.querySelector('.fb-downloader-overlay-wrapper')) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'fb-downloader-overlay-wrapper';
    if (!showOverlayButtons) {
      wrapper.style.display = 'none';
    }

    const mainBtn = document.createElement('button');
    mainBtn.className = 'fb-downloader-btn';
    mainBtn.title = 'SOFT IT FB VIDEO DOWNLOADER';
    mainBtn.innerHTML = `
      <svg class="fb-dl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span class="fb-dl-text">Download</span>
      <svg class="fb-dl-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;

    const dropdown = document.createElement('div');
    dropdown.className = 'fb-downloader-dropdown';
    dropdown.innerHTML = `
      <div class="fb-dl-dropdown-header">SOFT IT &bull; Select Quality</div>
      <div class="fb-dl-options-list">
        <div class="fb-dl-loading">Scanning available streams...</div>
      </div>
    `;

    wrapper.appendChild(mainBtn);
    wrapper.appendChild(dropdown);

    const pos = window.getComputedStyle(container).position;
    if (pos === 'static') {
      container.style.position = 'relative';
    }

    container.appendChild(wrapper);

    let isOpen = false;
    function toggleDropdown(open) {
      isOpen = (open !== undefined) ? open : !isOpen;
      dropdown.classList.toggle('fb-dl-show', isOpen);
      if (isOpen) {
        populateDropdown(container, videoElem, dropdown);
      }
    }

    mainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleDropdown();
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        toggleDropdown(false);
      }
    });
  }

  function getLatestOrBestVideo() {
    if (videoCatalog.size === 0) return null;
    const list = Array.from(videoCatalog.values());
    return list[list.length - 1];
  }

  function populateDropdown(container, videoElem, dropdown) {
    const listContainer = dropdown.querySelector('.fb-dl-options-list');
    listContainer.innerHTML = '';

    // Request fresh scan
    requestInPageVideos();

    let videoData = null;

    // Check if video element has direct http src
    if (videoElem && videoElem.src && videoElem.src.startsWith('http') && !videoElem.src.startsWith('blob:')) {
      videoData = {
        id: 'fb_direct_' + Date.now(),
        title: 'Facebook Video',
        hdUrl: videoElem.src,
        sdUrl: videoElem.src,
        qualities: [{ quality: 'HD', label: 'Direct Stream (HD)', url: videoElem.src }]
      };
    } else {
      videoData = getLatestOrBestVideo();
    }

    if (!videoData || (!videoData.hdUrl && !videoData.sdUrl && (!videoData.qualities || videoData.qualities.length === 0))) {
      listContainer.innerHTML = `
        <div class="fb-dl-empty">
          <p>Stream buffering...</p>
          <small>Click Play on the video to capture high-definition stream.</small>
        </div>
      `;
      return;
    }

    const options = [];
    if (videoData.hdUrl) {
      options.push({ label: 'Full HD / HD Quality', tag: 'HD', url: videoData.hdUrl, badge: 'High Quality' });
    }
    if (videoData.sdUrl && videoData.sdUrl !== videoData.hdUrl) {
      options.push({ label: 'Standard Definition (SD)', tag: 'SD', url: videoData.sdUrl, badge: 'Faster' });
    }
    if (Array.isArray(videoData.qualities)) {
      videoData.qualities.forEach(q => {
        if (q.url && q.url !== videoData.hdUrl && q.url !== videoData.sdUrl) {
          options.push({ label: q.label || (q.quality + ' Stream'), tag: q.quality || 'MP4', url: q.url, badge: q.resolution || '' });
        }
      });
    }

    options.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'fb-dl-option-item';
      item.innerHTML = `
        <div class="fb-dl-opt-info">
          <span class="fb-dl-opt-tag fb-dl-tag-${opt.tag.toLowerCase()}">${opt.tag}</span>
          <span class="fb-dl-opt-label">${opt.label}</span>
          ${opt.badge ? `<span class="fb-dl-opt-badge">${opt.badge}</span>` : ''}
        </div>
        <button class="fb-dl-opt-btn" title="Download ${opt.label}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
      `;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload(opt.url, videoData.title, opt.tag, videoData.id, item);
      });

      listContainer.appendChild(item);
    });
  }

  function triggerDownload(url, title, quality, videoId, itemElem) {
    if (itemElem) {
      const btn = itemElem.querySelector('.fb-dl-opt-btn');
      if (btn) {
        btn.innerHTML = `
          <svg class="fb-dl-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
          </svg>
        `;
      }
    }

    chrome.runtime?.sendMessage({
      type: 'DOWNLOAD_VIDEO',
      url,
      title: title || 'Facebook_Video',
      quality,
      videoId
    }, (res) => {
      if (itemElem) {
        const btn = itemElem.querySelector('.fb-dl-opt-btn');
        if (btn) {
          if (res && res.success) {
            btn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
            setTimeout(() => {
              btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              `;
            }, 3000);
          } else {
            btn.innerHTML = `<span style="color:#ef4444;font-size:10px;">Error</span>`;
          }
        }
      }
    });
  }

  function toggleAllOverlays(visible) {
    const overlays = document.querySelectorAll('.fb-downloader-overlay-wrapper');
    overlays.forEach(o => {
      o.style.display = visible ? 'flex' : 'none';
    });
  }

  function scanForVideos() {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach(video => {
      const container = findVideoContainer(video);
      if (container) {
        createOverlayButton(container, video);
      }
    });
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanForVideos();
      scanScheduled = false;
    });
  }

  const domObserver = new MutationObserver(() => scheduleScan());
  domObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  scheduleScan();
  setInterval(scheduleScan, 1500);
  requestInPageVideos();
})();
