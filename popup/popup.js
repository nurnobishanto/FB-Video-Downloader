/**
 * SOFT IT FB VIDEO DOWNLOADER - Popup Script
 * Manages video and photo list presentations, quality selection,
 * tab switching, and one-click downloads.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const detectedCountText = document.getElementById('detectedCountText');
  const pageContextBadge = document.getElementById('pageContextBadge');
  const nonFbState = document.getElementById('nonFbState');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');
  const videoList = document.getElementById('videoList');
  const imageList = document.getElementById('imageList');
  const appFooter = document.getElementById('appFooter');
  const refreshBtn = document.getElementById('refreshBtn');
  const settingsToggleBtn = document.getElementById('settingsToggleBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const toggleOverlay = document.getElementById('toggleOverlay');
  const selectDefaultQuality = document.getElementById('selectDefaultQuality');
  const openFbBtn = document.getElementById('openFbBtn');
  const scanNowBtn = document.getElementById('scanNowBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const downloadAllText = document.getElementById('downloadAllText');
  const tabVideosBtn = document.getElementById('tabVideosBtn');
  const tabImagesBtn = document.getElementById('tabImagesBtn');
  const videoCountBadge = document.getElementById('videoCountBadge');
  const imageCountBadge = document.getElementById('imageCountBadge');

  let currentTab = null;
  let detectedVideos = [];
  let detectedImages = [];
  let activeMediaTab = 'videos'; // 'videos' | 'images'
  let userDefaultQuality = 'HD';

  // 1. Load preferences
  chrome.storage?.local?.get(['showOverlayButtons', 'defaultQuality'], (res) => {
    if (res.showOverlayButtons !== undefined) toggleOverlay.checked = res.showOverlayButtons;
    if (res.defaultQuality !== undefined) {
      selectDefaultQuality.value = res.defaultQuality;
      userDefaultQuality = res.defaultQuality;
    }
  });

  toggleOverlay.addEventListener('change', () => {
    chrome.storage?.local?.set({ showOverlayButtons: toggleOverlay.checked });
  });

  selectDefaultQuality.addEventListener('change', () => {
    userDefaultQuality = selectDefaultQuality.value;
    chrome.storage?.local?.set({ defaultQuality: userDefaultQuality });
    if (activeMediaTab === 'videos') renderVideos();
  });

  settingsToggleBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  // Tab switching
  tabVideosBtn.addEventListener('click', () => {
    activeMediaTab = 'videos';
    tabVideosBtn.classList.add('active');
    tabImagesBtn.classList.remove('active');
    videoList.classList.remove('hidden');
    imageList.classList.add('hidden');
    renderMediaView();
  });

  tabImagesBtn.addEventListener('click', () => {
    activeMediaTab = 'images';
    tabImagesBtn.classList.add('active');
    tabVideosBtn.classList.remove('active');
    imageList.classList.remove('hidden');
    videoList.classList.add('hidden');
    renderMediaView();
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

  // 3. Fetch detected media
  async function loadMedia() {
    detectedCountText.textContent = 'Scanning tab...';
    refreshBtn.classList.add('spinner');

    try {
      chrome.runtime.sendMessage({
        type: 'GET_TAB_MEDIA',
        tabId: currentTab.id
      }, (response) => {
        refreshBtn.classList.remove('spinner');
        if (response && response.success) {
          detectedVideos = response.videos || [];
          detectedImages = response.images || [];
        } else {
          detectedVideos = [];
          detectedImages = [];
        }
        updateCounters();
        renderMediaView();
      });
    } catch (err) {
      refreshBtn.classList.remove('spinner');
      detectedVideos = [];
      detectedImages = [];
      updateCounters();
      renderMediaView();
    }
  }

  function updateCounters() {
    videoCountBadge.textContent = String(detectedVideos.length);
    imageCountBadge.textContent = String(detectedImages.length);
  }

  function renderMediaView() {
    if (activeMediaTab === 'videos') {
      renderVideos();
    } else {
      renderImages();
    }
  }

  // 4. Render Videos
  function renderVideos() {
    videoList.innerHTML = '';

    if (detectedVideos.length === 0) {
      detectedCountText.textContent = '0 Videos Detected';
      emptyTitle.textContent = 'No Video Playing Yet';
      emptyDesc.textContent = 'Scroll down your Facebook feed or click Play on a video to capture the HD download link.';
      emptyState.classList.remove('hidden');
      nonFbState.classList.add('hidden');
      appFooter.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    nonFbState.classList.add('hidden');
    appFooter.classList.remove('hidden');
    downloadAllText.textContent = `Download All Videos (${detectedVideos.length})`;
    detectedCountText.textContent = `${detectedVideos.length} Video${detectedVideos.length > 1 ? 's' : ''} Ready`;

    detectedVideos.forEach((video) => {
      const card = createVideoCard(video);
      videoList.appendChild(card);
    });
  }

  function createVideoCard(video) {
    const card = document.createElement('div');
    card.className = 'video-card';

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

    let selectedOption = null;
    if (userDefaultQuality === 'HD') {
      selectedOption = options.find(o => o.tag === 'HD') || options[0];
    } else {
      selectedOption = options.find(o => o.tag === 'SD') || options[0];
    }

    const titleText = video.title || 'Facebook Video ' + (video.id || '');

    const header = document.createElement('div');
    header.className = 'video-card-header';

    const thumbBox = document.createElement('div');
    thumbBox.className = 'video-thumb-container';
    if (video.thumbnail) {
      const img = document.createElement('img');
      img.className = 'video-thumb';
      img.src = video.thumbnail;
      img.alt = 'Thumbnail';
      img.onerror = () => { thumbBox.innerHTML = renderThumbFallback(); };
      thumbBox.appendChild(img);
    } else {
      thumbBox.innerHTML = renderThumbFallback();
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
      if (!selectedOption?.url) return;
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
          statusMsg.textContent = '✓ Download started';
        } else {
          statusMsg.className = 'card-status error';
          statusMsg.textContent = 'Failed: ' + (res?.error || 'Error');
        }
      });
    });

    copyBtn.addEventListener('click', async () => {
      if (selectedOption?.url) {
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
      }
    });

    actionsRow.appendChild(downloadBtn);
    actionsRow.appendChild(copyBtn);
    card.appendChild(actionsRow);
    card.appendChild(statusMsg);
    return card;
  }

  // 5. Render Photos
  function renderImages() {
    imageList.innerHTML = '';

    if (detectedImages.length === 0) {
      detectedCountText.textContent = '0 Photos Detected';
      emptyTitle.textContent = 'No Photos Found Yet';
      emptyDesc.textContent = 'Scroll down your Facebook feed to detect high-resolution photos.';
      emptyState.classList.remove('hidden');
      nonFbState.classList.add('hidden');
      appFooter.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    nonFbState.classList.add('hidden');
    appFooter.classList.remove('hidden');
    downloadAllText.textContent = `Download All Photos (${detectedImages.length})`;
    detectedCountText.textContent = `${detectedImages.length} Photo${detectedImages.length > 1 ? 's' : ''} Ready`;

    detectedImages.forEach((img) => {
      const card = createImageCard(img);
      imageList.appendChild(card);
    });
  }

  function createImageCard(img) {
    const card = document.createElement('div');
    card.className = 'image-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'image-card-thumb-wrap';

    const imageElem = document.createElement('img');
    imageElem.className = 'image-card-thumb';
    imageElem.src = img.url;
    imageElem.alt = img.title || 'Photo';
    imageElem.loading = 'lazy';

    thumbWrap.appendChild(imageElem);

    if (img.width && img.height) {
      const dim = document.createElement('span');
      dim.className = 'dim-tag';
      dim.textContent = `${img.width}x${img.height}`;
      thumbWrap.appendChild(dim);
    } else {
      const dim = document.createElement('span');
      dim.className = 'dim-tag';
      dim.textContent = 'HD Photo';
      thumbWrap.appendChild(dim);
    }

    const actions = document.createElement('div');
    actions.className = 'image-card-actions';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'img-dl-btn';
    dlBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Download</span>
    `;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'img-copy-btn';
    copyBtn.title = 'Copy Photo URL';
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;

    dlBtn.addEventListener('click', () => {
      dlBtn.disabled = true;
      dlBtn.innerHTML = `
        <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
        </svg>
      `;

      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGE',
        url: img.url,
        title: img.title || 'Facebook_Photo',
        imageId: img.id
      }, (res) => {
        dlBtn.disabled = false;
        if (res && res.success) {
          dlBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Saved</span>
          `;
          setTimeout(() => {
            dlBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download</span>
            `;
          }, 2500);
        } else {
          dlBtn.innerHTML = `<span style="color:#ef4444;font-size:10px;">Error</span>`;
        }
      });
    });

    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(img.url);
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
    });

    actions.appendChild(dlBtn);
    actions.appendChild(copyBtn);
    card.appendChild(thumbWrap);
    card.appendChild(actions);

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
    imageList.innerHTML = '';
    appFooter.classList.add('hidden');
    detectedCountText.textContent = 'Inactive';
    pageContextBadge.textContent = 'Not Facebook';
  }

  // 6. Action Listeners
  refreshBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(currentTab.id, { type: 'REFRESH_VIDEOS' }, () => {
      setTimeout(loadMedia, 400);
    });
  });

  scanNowBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(currentTab.id, { type: 'REFRESH_VIDEOS' }, () => {
      setTimeout(loadMedia, 400);
    });
  });

  openFbBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.facebook.com' });
  });

  downloadAllBtn.addEventListener('click', () => {
    downloadAllBtn.disabled = true;

    if (activeMediaTab === 'videos') {
      downloadAllBtn.textContent = 'Queueing video downloads...';
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
          delay += 600;
        }
      });
      setTimeout(() => {
        downloadAllBtn.disabled = false;
        downloadAllBtn.innerHTML = `<span>Downloads Queued!</span>`;
        setTimeout(() => {
          downloadAllText.textContent = `Download All Videos (${detectedVideos.length})`;
        }, 3000);
      }, delay + 200);
    } else {
      downloadAllBtn.textContent = 'Queueing photo downloads...';
      let delay = 0;
      detectedImages.forEach(img => {
        if (img.url) {
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_IMAGE',
              url: img.url,
              title: img.title || 'Facebook_Photo',
              imageId: img.id
            });
          }, delay);
          delay += 400;
        }
      });
      setTimeout(() => {
        downloadAllBtn.disabled = false;
        downloadAllBtn.innerHTML = `<span>Photos Queued!</span>`;
        setTimeout(() => {
          downloadAllText.textContent = `Download All Photos (${detectedImages.length})`;
        }, 3000);
      }, delay + 200);
    }
  });

  // Initial load
  if (currentTab?.id) {
    chrome.tabs.sendMessage(currentTab.id, { type: 'REFRESH_VIDEOS' }, () => {
      setTimeout(loadMedia, 300);
    });
  }
  loadMedia();
});
