/**
 * SOFT IT FB VIDEO DOWNLOADER - Background Service Worker (Manifest V3)
 * Manages video and high-resolution image detection via WebRequest & Content Scripts,
 * coordinates toolbar badges, and handles one-click downloads.
 */

// Tab media caches: tabId -> Map(mediaId -> mediaData)
const tabVideos = new Map();
const tabImages = new Map();

// Helper to sanitize filenames
function sanitizeFilename(title, quality, id, ext = 'mp4') {
  let cleanTitle = (title || (ext === 'mp4' ? 'Facebook_Video' : 'Facebook_Image'))
    .replace(/[\\/:*?"<>|\n\r\t]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 45);

  if (!cleanTitle || cleanTitle === '_') {
    cleanTitle = ext === 'mp4' ? 'Facebook_Video' : 'Facebook_Image';
  }

  const qTag = quality ? `_${quality}` : '';
  const idTag = id ? `_${id}` : '';
  const prefix = ext === 'mp4' ? 'SOFT_IT_FB_Video' : 'SOFT_IT_FB_Image';
  return `${prefix}_${cleanTitle}${qTag}${idTag}.${ext}`;
}

// Clean Facebook CDN media URLs
function cleanMediaUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('bytestart');
    parsed.searchParams.delete('byteend');
    return parsed.toString();
  } catch (e) {
    return url.replace(/([?&])bytestart=\d+(&byteend=\d+)?(&|$)/, '$1').replace(/[?&]$/, '');
  }
}

// Extract ID from media URL
function extractIdFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/(\d{8,})[_\.]/);
    if (match && match[1]) return match[1];

    const oh = urlObj.searchParams.get('oh');
    if (oh) return oh.substring(0, 10);
  } catch (e) {}

  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i);
    hash |= 0;
  }
  return 'med_' + Math.abs(hash);
}

// Update action badge for a tab
function updateBadge(tabId) {
  if (!tabId || tabId <= 0) return;
  const videoCount = tabVideos.get(tabId)?.size || 0;
  const imageCount = tabImages.get(tabId)?.size || 0;
  const total = videoCount + imageCount;

  chrome.action.setBadgeText({
    tabId,
    text: total > 0 ? String(total) : ''
  });

  chrome.action.setBadgeBackgroundColor({
    tabId,
    color: '#1877F2'
  });
}

// 1. WebRequest Interception: Intercepts all video & photo requests made by Facebook
if (chrome.webRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const { url, tabId, type } = details;
      if (!tabId || tabId <= 0) return;

      const isFbCdn = url.includes('.fbcdn.net') || url.includes('.facebook.com');
      if (!isFbCdn) return;

      // --- VIDEO INTERCEPTION ---
      const isVideoPattern = (
        url.includes('.mp4') ||
        url.includes('/v/t42.') ||
        url.includes('/v/t66.') ||
        url.includes('/o1/v/') ||
        url.includes('efg=') ||
        url.includes('mime=video')
      );
      const isAudioOnly = url.includes('mime=audio') || url.includes('dash_audio');

      if (isVideoPattern && !isAudioOnly) {
        const fullUrl = cleanMediaUrl(url);
        const videoId = extractIdFromUrl(fullUrl);

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

        chrome.tabs.sendMessage(tabId, {
          type: 'BG_VIDEO_DETECTED',
          video: updated
        }).catch(() => {});
        return;
      }

      // --- IMAGE / PHOTO INTERCEPTION ---
      // Intercept high-resolution Facebook photos from scontent / fbcdn
      const isPhoto = (
        type === 'image' ||
        url.includes('/p') ||
        url.includes('/t39.') ||
        url.includes('/t1.') ||
        url.includes('scontent')
      ) && (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.webp') || url.includes('fna.fbcdn.net'));

      // Filter out tiny UI icons/emojis
      const isUiIcon = (
        url.includes('/rsrc.php/') ||
        url.includes('emoji.php') ||
        url.includes('safe_image.php') ||
        url.includes('static.xx')
      );

      if (isPhoto && !isUiIcon) {
        const fullUrl = cleanMediaUrl(url);
        const imageId = extractIdFromUrl(fullUrl);

        if (!tabImages.has(tabId)) {
          tabImages.set(tabId, new Map());
        }
        const imgMap = tabImages.get(tabId);

        if (!imgMap.has(imageId)) {
          imgMap.set(imageId, {
            id: imageId,
            url: fullUrl,
            title: `Facebook Photo ${imageId}`,
            detectedAt: Date.now()
          });
          updateBadge(tabId);
        }
      }
    },
    { urls: ['*://*.fbcdn.net/*', '*://*.facebook.com/*'] }
  );

  // Headers check for content-type
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      const { url, tabId, responseHeaders } = details;
      if (!tabId || tabId <= 0 || !responseHeaders) return;

      const contentTypeHeader = responseHeaders.find(
        h => h.name.toLowerCase() === 'content-type'
      );
      const cType = contentTypeHeader?.value?.toLowerCase() || '';

      if (cType.startsWith('video/')) {
        const fullUrl = cleanMediaUrl(url);
        const videoId = extractIdFromUrl(fullUrl);

        if (!tabVideos.has(tabId)) {
          tabVideos.set(tabId, new Map());
        }
        const currentMap = tabVideos.get(tabId);

        if (!currentMap.has(videoId)) {
          currentMap.set(videoId, {
            id: videoId,
            title: `Facebook Video ${videoId}`,
            thumbnail: null,
            duration: 0,
            hdUrl: fullUrl,
            sdUrl: fullUrl,
            qualities: [{ quality: 'HD', label: 'HD Quality', url: fullUrl, resolution: 'HD' }],
            detectedAt: Date.now()
          });
          updateBadge(tabId);
        }
      }
    },
    { urls: ['*://*.fbcdn.net/*', '*://*.facebook.com/*'] },
    ['responseHeaders']
  );
}

// 2. Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id || message.tabId;

  switch (message.type) {
    case 'REGISTER_VIDEOS': {
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab ID found' });
        return false;
      }
      if (!tabVideos.has(tabId)) tabVideos.set(tabId, new Map());
      const currentMap = tabVideos.get(tabId);

      (message.videos || []).forEach(video => {
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

    case 'REGISTER_IMAGES': {
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab ID found' });
        return false;
      }
      if (!tabImages.has(tabId)) tabImages.set(tabId, new Map());
      const imgMap = tabImages.get(tabId);

      (message.images || []).forEach(img => {
        if (img && (img.url || img.id)) {
          const id = img.id || extractIdFromUrl(img.url);
          imgMap.set(id, {
            id,
            url: img.url,
            title: img.title || `Facebook Photo ${id}`,
            width: img.width || 0,
            height: img.height || 0,
            detectedAt: Date.now()
          });
        }
      });

      updateBadge(tabId);
      sendResponse({ success: true, count: imgMap.size });
      return true;
    }

    case 'GET_TAB_MEDIA': {
      const targetTabId = message.tabId || tabId;
      const vMap = tabVideos.get(targetTabId);
      const iMap = tabImages.get(targetTabId);

      sendResponse({
        success: true,
        videos: vMap ? Array.from(vMap.values()) : [],
        images: iMap ? Array.from(iMap.values()) : []
      });
      return true;
    }

    case 'GET_TAB_VIDEOS': {
      const targetTabId = message.tabId || tabId;
      const videosMap = tabVideos.get(targetTabId);
      sendResponse({ success: true, videos: videosMap ? Array.from(videosMap.values()) : [] });
      return true;
    }

    case 'DOWNLOAD_VIDEO': {
      const { url, title, quality, videoId } = message;
      if (!url) {
        sendResponse({ success: false, error: 'No download URL specified' });
        return false;
      }

      const cleanUrl = cleanMediaUrl(url);
      const filename = sanitizeFilename(title, quality, videoId, 'mp4');

      chrome.downloads.download({
        url: cleanUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId, filename });
        }
      });
      return true;
    }

    case 'DOWNLOAD_IMAGE': {
      const { url, title, imageId } = message;
      if (!url) {
        sendResponse({ success: false, error: 'No download URL specified' });
        return false;
      }

      const cleanUrl = cleanMediaUrl(url);
      const filename = sanitizeFilename(title, 'HD', imageId, 'jpg');

      chrome.downloads.download({
        url: cleanUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId, filename });
        }
      });
      return true;
    }

    case 'CLEAR_TAB_VIDEOS': {
      if (tabId) {
        tabVideos.delete(tabId);
        tabImages.delete(tabId);
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
  tabVideos.delete(tabId);
  tabImages.delete(tabId);
});

// Reset on domain change
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    if (tab.url && !tab.url.includes('facebook.com')) {
      tabVideos.delete(tabId);
      tabImages.delete(tabId);
      updateBadge(tabId);
    }
  }
});

// Update badge on switch
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadge(activeInfo.tabId);
});
