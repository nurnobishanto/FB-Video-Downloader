/**
 * SOFT IT FB VIDEO DOWNLOADER - Background Service Worker (Manifest V3)
 * Manages video detection via WebRequest & Content Scripts, coordinates badges,
 * and handles one-click downloads.
 */

// Tab video storage: tabId -> Map(videoId -> videoData)
const tabVideos = new Map();

// Helper to sanitize filenames
function sanitizeFilename(title, quality, id) {
  let cleanTitle = (title || 'Facebook_Video')
    .replace(/[\\/:*?"<>|\n\r\t]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 50);

  if (!cleanTitle || cleanTitle === '_') {
    cleanTitle = 'Facebook_Video';
  }

  const qTag = quality ? `_${quality}` : '';
  const idTag = id ? `_${id}` : '';
  return `SOFT_IT_FB_${cleanTitle}${qTag}${idTag}.mp4`;
}

// Clean Facebook CDN video URLs (removes range chunking parameters like bytestart/byteend)
function cleanVideoUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Remove segment range parameters so browser downloads the complete progressive file
    parsed.searchParams.delete('bytestart');
    parsed.searchParams.delete('byteend');
    return parsed.toString();
  } catch (e) {
    return url.replace(/([?&])bytestart=\d+(&byteend=\d+)?(&|$)/, '$1').replace(/[?&]$/, '');
  }
}

// Extract Video ID from URL or filename
function extractIdFromUrl(url) {
  try {
    const urlObj = new URL(url);
    // 1. Check path for numerical segments (e.g. /123456789_n.mp4)
    const match = urlObj.pathname.match(/\/(\d{8,})[_\.]/);
    if (match && match[1]) return match[1];

    // 2. Check query params for id or oh hash
    const oh = urlObj.searchParams.get('oh');
    if (oh) return oh.substring(0, 10);
  } catch (e) {}

  // Fallback: simple hash of url
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i);
    hash |= 0;
  }
  return 'vid_' + Math.abs(hash);
}

// Update action badge for a tab
function updateBadge(tabId) {
  if (!tabId || tabId <= 0) return;
  const videos = tabVideos.get(tabId);
  const count = videos ? videos.size : 0;

  chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(count) : ''
  });

  chrome.action.setBadgeBackgroundColor({
    tabId,
    color: '#1877F2'
  });
}

// 1. WebRequest Interception: Intercepts all direct video requests made by Facebook player
if (chrome.webRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const { url, tabId } = details;
      if (!tabId || tabId <= 0) return;

      // Filter for FB video stream signatures
      const isFbCdn = url.includes('.fbcdn.net') || url.includes('.facebook.com');
      if (!isFbCdn) return;

      const isVideoPattern = (
        url.includes('.mp4') ||
        url.includes('/v/t42.') ||
        url.includes('/v/t66.') ||
        url.includes('/o1/v/') ||
        url.includes('efg=') ||
        url.includes('mime=video')
      );

      // Exclude audio-only streams if labeled
      const isAudioOnly = url.includes('mime=audio') || url.includes('dash_audio');
      if (!isVideoPattern || isAudioOnly) return;

      const fullUrl = cleanVideoUrl(url);
      const videoId = extractIdFromUrl(fullUrl);

      // Detect quality indication from URL params or efg payload
      let isHd = fullUrl.includes('playable_url_quality_hd') ||
                 fullUrl.includes('_hd.mp4') ||
                 fullUrl.includes('hd_src') ||
                 fullUrl.includes('1080') ||
                 fullUrl.includes('720');

      if (!tabVideos.has(tabId)) {
        tabVideos.set(tabId, new Map());
      }
      const currentMap = tabVideos.get(tabId);

      const existing = currentMap.get(videoId);
      const qualityTag = isHd ? 'HD' : 'SD';

      const updated = {
        id: videoId,
        title: existing?.title || `Facebook Video ${videoId}`,
        thumbnail: existing?.thumbnail || null,
        duration: existing?.duration || 0,
        hdUrl: isHd ? fullUrl : (existing?.hdUrl || null),
        sdUrl: !isHd ? fullUrl : (existing?.sdUrl || null),
        qualities: existing?.qualities || [],
        detectedAt: Date.now()
      };

      // Add to qualities list if not already present
      if (!updated.qualities.some(q => q.url === fullUrl)) {
        updated.qualities.push({
          quality: qualityTag,
          label: isHd ? 'High Definition (HD)' : 'Standard Definition (SD)',
          url: fullUrl,
          resolution: isHd ? '720p / 1080p' : 'SD'
        });
      }

      currentMap.set(videoId, updated);
      updateBadge(tabId);

      // Notify content script in case page is active
      chrome.tabs.sendMessage(tabId, {
        type: 'BG_VIDEO_DETECTED',
        video: updated
      }).catch(() => {});
    },
    { urls: ['*://*.fbcdn.net/*', '*://*.facebook.com/*'] }
  );

  // Also check onHeadersReceived for content-type: video/*
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      const { url, tabId, responseHeaders } = details;
      if (!tabId || tabId <= 0 || !responseHeaders) return;

      const contentTypeHeader = responseHeaders.find(
        h => h.name.toLowerCase() === 'content-type'
      );
      const isVideo = contentTypeHeader && contentTypeHeader.value?.toLowerCase().startsWith('video/');

      if (isVideo) {
        const fullUrl = cleanVideoUrl(url);
        const videoId = extractIdFromUrl(fullUrl);

        if (!tabVideos.has(tabId)) {
          tabVideos.set(tabId, new Map());
        }
        const currentMap = tabVideos.get(tabId);

        if (!currentMap.has(videoId)) {
          const entry = {
            id: videoId,
            title: `Facebook Video ${videoId}`,
            thumbnail: null,
            duration: 0,
            hdUrl: fullUrl,
            sdUrl: fullUrl,
            qualities: [
              { quality: 'HD', label: 'HD Quality', url: fullUrl, resolution: 'HD' }
            ],
            detectedAt: Date.now()
          };
          currentMap.set(videoId, entry);
          updateBadge(tabId);
        }
      }
    },
    { urls: ['*://*.fbcdn.net/*', '*://*.facebook.com/*'] },
    ['responseHeaders']
  );
}

// 2. Runtime Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id || message.tabId;

  switch (message.type) {
    case 'REGISTER_VIDEOS': {
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab ID found' });
        return false;
      }

      if (!tabVideos.has(tabId)) {
        tabVideos.set(tabId, new Map());
      }
      const currentMap = tabVideos.get(tabId);

      const incomingList = message.videos || [];
      incomingList.forEach(video => {
        if (video && video.id) {
          const existing = currentMap.get(video.id);
          currentMap.set(video.id, {
            ...existing,
            ...video,
            hdUrl: video.hdUrl || existing?.hdUrl,
            sdUrl: video.sdUrl || existing?.sdUrl,
            thumbnail: video.thumbnail || existing?.thumbnail,
            title: video.title || existing?.title,
            qualities: (video.qualities?.length ? video.qualities : existing?.qualities) || []
          });
        }
      });

      updateBadge(tabId);
      sendResponse({ success: true, count: currentMap.size });
      return true;
    }

    case 'GET_TAB_VIDEOS': {
      const targetTabId = message.tabId || tabId;
      const videosMap = tabVideos.get(targetTabId);
      const list = videosMap ? Array.from(videosMap.values()) : [];
      sendResponse({ success: true, videos: list });
      return true;
    }

    case 'DOWNLOAD_VIDEO': {
      const { url, title, quality, videoId } = message;
      if (!url) {
        sendResponse({ success: false, error: 'No download URL specified' });
        return false;
      }

      const cleanUrl = cleanVideoUrl(url);
      const filename = sanitizeFilename(title, quality, videoId);

      chrome.downloads.download({
        url: cleanUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('Download error:', chrome.runtime.lastError.message);
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          sendResponse({
            success: true,
            downloadId,
            filename
          });
        }
      });

      return true;
    }

    case 'CLEAR_TAB_VIDEOS': {
      if (tabId && tabVideos.has(tabId)) {
        tabVideos.delete(tabId);
        updateBadge(tabId);
      }
      sendResponse({ success: true });
      return true;
    }

    default:
      return false;
  }
});

// Clean up tabs on close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabVideos.has(tabId)) {
    tabVideos.delete(tabId);
  }
});

// Reset when navigating away from Facebook
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    if (tab.url && !tab.url.includes('facebook.com')) {
      tabVideos.delete(tabId);
      updateBadge(tabId);
    }
  }
});

// Update badge on tab switch
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadge(activeInfo.tabId);
});
