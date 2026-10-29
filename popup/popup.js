/**
 * FB Video Downloader - Popup Script
 * Manages video list presentation, quality selection, download triggers,
 * and user preferences.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const detectedCountText = document.getElementById('detectedCountText');
  const pageContextBadge = document.getElementById('pageContextBadge');
  const nonFbState = document.getElementById('nonFbState');
  const emptyState = document.getElementById('emptyState');
  const videoList = document.getElementById('videoList');
  const appFooter = document.getElementById('appFooter');
  const refreshBtn = document.getElementById('refreshBtn');
  const settingsToggleBtn = document.getElementById('settingsToggleBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const toggleOverlay = document.getElementById('toggleOverlay');
  const selectDefaultQuality = document.getElementById('selectDefaultQuality');
  const openFbBtn = document.getElementById('openFbBtn');
  const scanNowBtn = document.getElementById('scanNowBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');

  let currentTab = null;
  let detectedVideos = [];
  let userDefaultQuality = 'HD';

  // 1. Load preferences
  chrome.storage?.local?.get(['showOverlayButtons', 'defaultQuality'], (res) => {
    if (res.showOverlayButtons !== undefined) {
      toggleOverlay.checked = res.showOverlayButtons;
    }
    if (res.defaultQuality !== undefined) {
      selectDefaultQuality.value = res.defaultQuality;
      userDefaultQuality = res.defaultQuality;
    }
  });

  // Settings change listeners
  toggleOverlay.addEventListener('change', () => {
    chrome.storage?.local?.set({ showOverlayButtons: toggleOverlay.checked });
  });

  selectDefaultQuality.addEventListener('change', () => {
    userDefaultQuality = selectDefaultQuality.value;
    chrome.storage?.local?.set({ defaultQuality: userDefaultQuality });
    renderVideoCards();
  });

  settingsToggleBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  // 2. Identify active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab || !currentTab.url || !currentTab.url.includes('facebook.com')) {
    showNonFbState();
    return;
  }

  // Update page badge
  if (currentTab.url.includes('/reel/')) {
    pageContextBadge.textContent = 'Facebook Reels';
  } else if (currentTab.url.includes('/watch/')) {
    pageContextBadge.textContent = 'Facebook Watch';
  } else if (currentTab.url.includes('/groups/')) {
    pageContextBadge.textContent = 'Facebook Group';
  } else {
    pageContextBadge.textContent = 'Facebook Feed';
  }

  // 3. Fetch detected videos
  async function loadVideos() {
    detectedCountText.textContent = 'Scanning tab...';
    refreshBtn.classList.add('spinner');

    try {
      chrome.runtime.sendMessage({
        type: 'GET_TAB_VIDEOS',
        tabId: currentTab.id
      }, (response) => {
        refreshBtn.classList.remove('spinner');
        if (response && response.success) {
          detectedVideos = response.videos || [];
          renderVideoCards();
        } else {
          detectedVideos = [];
          renderVideoCards();
        }
      });
    } catch (err) {
      refreshBtn.classList.remove('spinner');
      detectedVideos = [];
      renderVideoCards();
    }
  }

  // 4. Render video cards
  function renderVideoCards() {
    videoList.innerHTML = '';

    if (detectedVideos.length === 0) {
      detectedCountText.textContent = '0 Videos Detected';
      emptyState.classList.remove('hidden');
      nonFbState.classList.add('hidden');
      appFooter.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    nonFbState.classList.add('hidden');
    appFooter.classList.remove('hidden');
    detectedCountText.textContent = `${detectedVideos.length} Video${detectedVideos.length > 1 ? 's' : ''} Detected`;

    detectedVideos.forEach((video) => {
      const card = createVideoCard(video);
      videoList.appendChild(card);
    });
  }

  function formatDuration(sec) {
    if (!sec || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function createVideoCard(video) {
    const card = document.createElement('div');
    card.className = 'video-card';

    // Prepare available qualities
    const options = [];
    if (video.hdUrl) {
      options.push({ tag: 'HD', label: '1080p/720p HD', url: video.hdUrl, badge: 'HD' });
    }
    if (video.sdUrl && video.sdUrl !== video.hdUrl) {
      options.push({ tag: 'SD', label: 'SD Quality', url: video.sdUrl, badge: 'SD' });
    }
    if (Array.isArray(video.qualities)) {
      video.qualities.forEach(q => {
        if (q.url && q.url !== video.hdUrl && q.url !== video.sdUrl) {
          options.push({
            tag: q.quality || 'MP4',
            label: q.label || (q.quality + ' Stream'),
            url: q.url,
            badge: q.resolution || ''
          });
        }
      });
    }

    // Default selected option based on preference
    let selectedOption = null;
    if (userDefaultQuality === 'HD') {
      selectedOption = options.find(o => o.tag === 'HD') || options[0];
    } else {
      selectedOption = options.find(o => o.tag === 'SD') || options[0];
    }

    const durationStr = formatDuration(video.duration);
    const titleText = video.title || 'Facebook Video ' + (video.id || '');

    // Card Header: Thumbnail + Meta
    const header = document.createElement('div');
    header.className = 'video-card-header';

    const thumbBox = document.createElement('div');
    thumbBox.className = 'video-thumb-container';
    if (video.thumbnail) {
      const img = document.createElement('img');
      img.className = 'video-thumb';
      img.src = video.thumbnail;
      img.alt = 'Thumbnail';
      img.onerror = () => {
        thumbBox.innerHTML = renderThumbFallback();
      };
      thumbBox.appendChild(img);
    } else {
      thumbBox.innerHTML = renderThumbFallback();
    }

    if (durationStr) {
      const durTag = document.createElement('span');
      durTag.className = 'duration-tag';
      durTag.textContent = durationStr;
      thumbBox.appendChild(durTag);
    }

    const metaBox = document.createElement('div');
    metaBox.className = 'video-meta';
    metaBox.innerHTML = `
      <div class="video-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</div>
      <div class="video-id-badge">ID: ${video.id || 'N/A'}</div>
    `;

    header.appendChild(thumbBox);
    header.appendChild(metaBox);
    card.appendChild(header);

    // Quality selection pills
    if (options.length > 1) {
      const pillsRow = document.createElement('div');
      pillsRow.className = 'quality-pills-row';

      options.forEach(opt => {
        const pill = document.createElement('button');
        pill.className = `quality-pill ${opt === selectedOption ? 'active' : ''}`;
        pill.innerHTML = `
          <span>${opt.label}</span>
          ${opt.badge ? `<span class="pill-badge">${opt.badge}</span>` : ''}
        `;

        pill.addEventListener('click', () => {
          selectedOption = opt;
          pillsRow.querySelectorAll('.quality-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          updateDownloadButtonText();
        });

        pillsRow.appendChild(pill);
      });

      card.appendChild(pillsRow);
    }

    // Action buttons
    const actionsRow = document.createElement('div');
    actionsRow.className = 'video-card-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'card-download-btn';
    
    function updateDownloadButtonText() {
      const tagText = selectedOption ? ` (${selectedOption.tag})` : '';
      downloadBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Download${tagText}</span>
      `;
    }
    updateDownloadButtonText();

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-link-btn';
    copyBtn.title = 'Copy Direct Video URL';
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;

    const statusMsg = document.createElement('div');
    statusMsg.className = 'card-status';

    downloadBtn.addEventListener('click', () => {
      if (!selectedOption || !selectedOption.url) {
        statusMsg.className = 'card-status error';
        statusMsg.textContent = 'Selected quality has no stream URL.';
        return;
      }

      downloadBtn.disabled = true;
      downloadBtn.innerHTML = `
        <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
        </svg>
        <span>Starting...</span>
      `;

      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_VIDEO',
        url: selectedOption.url,
        title: video.title || 'Facebook_Video',
        quality: selectedOption.tag,
        videoId: video.id
      }, (res) => {
        downloadBtn.disabled = false;
        updateDownloadButtonText();
        if (res && res.success) {
          statusMsg.className = 'card-status success';
          statusMsg.textContent = '✓ Download started: ' + res.filename;
        } else {
          statusMsg.className = 'card-status error';
          statusMsg.textContent = 'Failed: ' + (res?.error || 'Unknown error');
        }
      });
    });

    copyBtn.addEventListener('click', async () => {
      if (selectedOption?.url) {
        try {
          await navigator.clipboard.writeText(selectedOption.url);
          copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            `;
          }, 2000);
        } catch (e) {
          // Fallback
        }
      }
    });

    actionsRow.appendChild(downloadBtn);
    actionsRow.appendChild(copyBtn);
    card.appendChild(actionsRow);
    card.appendChild(statusMsg);

    return card;
  }

  function renderThumbFallback() {
    return `
      <div class="thumb-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showNonFbState() {
    nonFbState.classList.remove('hidden');
    emptyState.classList.add('hidden');
    videoList.innerHTML = '';
    appFooter.classList.add('hidden');
    detectedCountText.textContent = 'Inactive';
    pageContextBadge.textContent = 'Not Facebook';
  }

  // 5. Actions
  refreshBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(currentTab.id, { type: 'REFRESH_VIDEOS' }, () => {
      // Incase content script took a moment to inspect
      setTimeout(loadVideos, 400);
    });
  });

  scanNowBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(currentTab.id, { type: 'REFRESH_VIDEOS' }, () => {
      setTimeout(loadVideos, 400);
    });
  });

  openFbBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.facebook.com' });
  });

  downloadAllBtn.addEventListener('click', () => {
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Queueing downloads...';

    let delay = 0;
    detectedVideos.forEach(video => {
      const bestUrl = video.hdUrl || video.sdUrl || (video.qualities?.[0]?.url);
      const qualityTag = video.hdUrl ? 'HD' : 'SD';
      if (bestUrl) {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_VIDEO',
            url: bestUrl,
            title: video.title || 'Facebook_Video',
            quality: qualityTag,
            videoId: video.id
          });
        }, delay);
        delay += 600; // Stagger downloads slightly to prevent browser flood
      }
    });

    setTimeout(() => {
      downloadAllBtn.disabled = false;
      downloadAllBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Downloads Queued!
      `;
      setTimeout(() => {
        downloadAllBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download All (Highest Quality)
        `;
      }, 3000);
    }, delay + 200);
  });

  // Initial load
  if (currentTab?.id) {
    chrome.tabs.sendMessage(currentTab.id, { type: 'REFRESH_VIDEOS' }, () => {
      setTimeout(loadVideos, 300);
    });
  }
  loadVideos();
});
