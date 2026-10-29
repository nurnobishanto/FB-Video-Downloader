/**
 * SOFT IT FB VIDEO DOWNLOADER - In-Page Script (MAIN World)
 * Multi-layer video detection:
 * 1. Network hooking (fetch & XHR request URLs + response text)
 * 2. Deep Script tag parsing (Relay SSR JSON blobs & regex fallback)
 * 3. React Fiber DOM inspection on HTML5 Video elements
 * 4. Video playback listener hooks
 */

(() => {
  if (window.__SOFT_IT_FB_INITIALIZED__) return;
  window.__SOFT_IT_FB_INITIALIZED__ = true;

  const detectedVideoMap = new Map();

  function decodeFbUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
      // Decode JSON/JS backslash escaped slashes and unicode entities
      let s = rawUrl
        .replace(/\\\//g, '/')
        .replace(/\\u002F/gi, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/\\u0025/gi, '%')
        .replace(/&amp;/g, '&');

      // Strip query byte ranges if present
      s = s.replace(/([?&])bytestart=\d+(&byteend=\d+)?(&|$)/, '$1').replace(/[?&]$/, '');

      if (s.startsWith('http://') || s.startsWith('https://')) {
        return s;
      }
    } catch (e) {}
    return rawUrl;
  }

  function emitVideoDetected(videoData) {
    if (!videoData || !videoData.id) return;
    if (!videoData.hdUrl && !videoData.sdUrl && (!videoData.qualities || videoData.qualities.length === 0)) {
      return;
    }

    const existing = detectedVideoMap.get(videoData.id);
    if (existing) {
      const merged = {
        ...existing,
        ...videoData,
        hdUrl: videoData.hdUrl || existing.hdUrl,
        sdUrl: videoData.sdUrl || existing.sdUrl,
        thumbnail: videoData.thumbnail || existing.thumbnail,
        title: videoData.title && !videoData.title.startsWith('Facebook Video') ? videoData.title : existing.title,
        qualities: videoData.qualities?.length ? videoData.qualities : existing.qualities
      };
      detectedVideoMap.set(videoData.id, merged);
      window.postMessage({
        source: 'SOFT_IT_INPAGE',
        type: 'VIDEO_UPDATED',
        video: merged
      }, '*');
    } else {
      detectedVideoMap.set(videoData.id, videoData);
      window.postMessage({
        source: 'SOFT_IT_INPAGE',
        type: 'VIDEO_DETECTED',
        video: videoData
      }, '*');
    }
  }

  // --- LAYER 1: Deep JSON Object Traversal ---
  function extractVideosFromObject(obj, foundVideos = []) {
    if (!obj || typeof obj !== 'object') return foundVideos;

    const isVideoNode = (
      obj.playable_url ||
      obj.playable_url_quality_hd ||
      obj.browser_native_hd_url ||
      obj.browser_native_sd_url ||
      obj.progressive_download_url ||
      (Array.isArray(obj.representations) && obj.representations.length > 0)
    );

    if (isVideoNode) {
      const id = String(obj.id || obj.video_id || obj.legacy_attachment_id || (obj.playback_video && obj.playback_video.id) || ('fb_' + Math.floor(Math.random() * 1000000)));
      const hdUrl = decodeFbUrl(obj.playable_url_quality_hd || obj.browser_native_hd_url);
      const sdUrl = decodeFbUrl(obj.playable_url || obj.browser_native_sd_url || obj.progressive_download_url);

      const thumbnail = decodeFbUrl(
        obj.preferred_thumbnail?.image?.uri ||
        obj.thumbnailImage?.uri ||
        obj.image?.uri ||
        obj.video_thumbnail_url
      );

      let title = '';
      if (typeof obj.message?.text === 'string') {
        title = obj.message.text;
      } else if (typeof obj.name === 'string') {
        title = obj.name;
      } else if (typeof obj.savable_description?.text === 'string') {
        title = obj.savable_description.text;
      }

      const duration = obj.playable_duration_in_ms ? Math.round(obj.playable_duration_in_ms / 1000) : (obj.length_in_second || 0);

      const qualities = [];
      if (hdUrl) {
        qualities.push({ quality: 'HD', label: 'High Definition (HD)', url: hdUrl, resolution: '720p/1080p' });
      }
      if (sdUrl && sdUrl !== hdUrl) {
        qualities.push({ quality: 'SD', label: 'Standard Definition (SD)', url: sdUrl, resolution: '360p/480p' });
      }

      if (Array.isArray(obj.representations)) {
        obj.representations.forEach(rep => {
          if (rep && rep.base_url) {
            const clean = decodeFbUrl(rep.base_url);
            const height = rep.height || (rep.dimension ? rep.dimension.height : null);
            if (clean && !qualities.some(q => q.url === clean)) {
              qualities.push({
                quality: height >= 720 ? 'HD' : 'SD',
                label: height ? `${height}p Video` : 'Stream',
                url: clean,
                resolution: height ? `${height}p` : 'MP4'
              });
            }
          }
        });
      }

      if (id && (hdUrl || sdUrl || qualities.length > 0)) {
        foundVideos.push({
          id,
          title: title.slice(0, 100) || `Facebook Video ${id}`,
          hdUrl,
          sdUrl,
          thumbnail,
          duration,
          qualities,
          detectedAt: Date.now()
        });
      }
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        extractVideosFromObject(obj[i], foundVideos);
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (key === 'actors' || key === 'comments' || key === 'reactions') continue;
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          extractVideosFromObject(obj[key], foundVideos);
        }
      }
    }

    return foundVideos;
  }

  // --- LAYER 2: Text & Regex Scan ---
  function parseAndExtract(text) {
    if (!text || typeof text !== 'string' || text.length < 30) return;

    // Check relevant keywords
    const hasVideoKeywords = (
      text.includes('playable_url') ||
      text.includes('browser_native_') ||
      text.includes('progressive_download_url') ||
      text.includes('fbcdn.net') ||
      text.includes('video_id')
    );
    if (!hasVideoKeywords) return;

    let cleanText = text;
    if (cleanText.startsWith('for (;;);')) {
      cleanText = cleanText.substring(9);
    }

    // Try JSON parsing
    try {
      const data = JSON.parse(cleanText);
      const videos = extractVideosFromObject(data);
      videos.forEach(emitVideoDetected);
      if (videos.length > 0) return;
    } catch (e) {}

    // Regex extraction for HD / SD URLs
    try {
      const hdRegex = /"playable_url_quality_hd"\s*:\s*"([^"]+)"|"browser_native_hd_url"\s*:\s*"([^"]+)"/g;
      const sdRegex = /"playable_url"\s*:\s*"([^"]+)"|"browser_native_sd_url"\s*:\s*"([^"]+)"|"progressive_download_url"\s*:\s*"([^"]+)"/g;

      let hdMatch;
      while ((hdMatch = hdRegex.exec(cleanText)) !== null) {
        const rawHd = hdMatch[1] || hdMatch[2];
        const hdUrl = decodeFbUrl(rawHd);
        if (hdUrl) {
          const idMatch = cleanText.match(/"video_id"\s*:\s*"?(\d+)"?/);
          const id = idMatch ? idMatch[1] : ('fb_' + Math.floor(Math.random() * 1000000));
          emitVideoDetected({
            id,
            title: `Facebook Video ${id}`,
            hdUrl,
            sdUrl: null,
            thumbnail: null,
            duration: 0,
            qualities: [{ quality: 'HD', label: 'High Definition (HD)', url: hdUrl, resolution: 'HD' }],
            detectedAt: Date.now()
          });
        }
      }

      let sdMatch;
      while ((sdMatch = sdRegex.exec(cleanText)) !== null) {
        const rawSd = sdMatch[1] || sdMatch[2] || sdMatch[3];
        const sdUrl = decodeFbUrl(rawSd);
        if (sdUrl) {
          const idMatch = cleanText.match(/"video_id"\s*:\s*"?(\d+)"?/);
          const id = idMatch ? idMatch[1] : ('fb_' + Math.floor(Math.random() * 1000000));
          emitVideoDetected({
            id,
            title: `Facebook Video ${id}`,
            hdUrl: null,
            sdUrl,
            thumbnail: null,
            duration: 0,
            qualities: [{ quality: 'SD', label: 'Standard Definition (SD)', url: sdUrl, resolution: 'SD' }],
            detectedAt: Date.now()
          });
        }
      }
    } catch (err) {}
  }

  // --- LAYER 3: Network Interception (Fetch & XHR) ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

    // Check if the request URL itself is a video stream URL from fbcdn
    if (reqUrl.includes('.fbcdn.net') && (reqUrl.includes('.mp4') || reqUrl.includes('bytestart') || reqUrl.includes('efg='))) {
      const clean = decodeFbUrl(reqUrl);
      const isHd = clean.includes('hd') || clean.includes('1080') || clean.includes('720');
      emitVideoDetected({
        id: 'fb_' + Math.abs(hashCode(clean)),
        title: 'Facebook Stream',
        hdUrl: isHd ? clean : null,
        sdUrl: !isHd ? clean : null,
        qualities: [{ quality: isHd ? 'HD' : 'SD', label: isHd ? 'HD Quality' : 'SD Quality', url: clean }]
      });
    }

    const response = await originalFetch.apply(this, args);
    try {
      const contentType = response.headers?.get('content-type') || '';
      if (contentType.includes('json') || contentType.includes('text') || reqUrl.includes('/api/graphql/')) {
        const clone = response.clone();
        clone.text().then(parseAndExtract).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this._reqUrl = args[1];
    return originalXhrOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._reqUrl && this._reqUrl.includes('.fbcdn.net') && this._reqUrl.includes('.mp4')) {
      const clean = decodeFbUrl(this._reqUrl);
      emitVideoDetected({
        id: 'fb_' + Math.abs(hashCode(clean)),
        title: 'Facebook Video Stream',
        hdUrl: clean,
        sdUrl: clean,
        qualities: [{ quality: 'HD', label: 'HD Quality', url: clean }]
      });
    }

    this.addEventListener('load', function () {
      try {
        if (typeof this.responseText === 'string') {
          parseAndExtract(this.responseText);
        }
      } catch (err) {}
    });
    return originalXhrSend.apply(this, args);
  };

  // --- LAYER 4: React Fiber DOM Inspection ---
  function inspectReactFiber(videoElem) {
    if (!videoElem) return;
    try {
      const fiberKey = Object.keys(videoElem).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!fiberKey) return;

      let fiber = videoElem[fiberKey];
      let depth = 0;

      while (fiber && depth < 20) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props) {
          // Check for videoData, videoProps, or direct URLs
          const hd = decodeFbUrl(props.playableUrlQualityHd || props.browserNativeHdUrl || props.hdSrc);
          const sd = decodeFbUrl(props.playableUrl || props.browserNativeSdUrl || props.sdSrc || props.src);
          const id = props.videoId || props.id || (props.videoData && props.videoData.id);

          if (hd || sd) {
            emitVideoDetected({
              id: String(id || ('fb_' + Math.floor(Math.random() * 1000000))),
              title: props.title || props.accessibilityCaption || 'Facebook Video',
              hdUrl: hd,
              sdUrl: sd,
              qualities: [
                ...(hd ? [{ quality: 'HD', label: 'HD Quality', url: hd }] : []),
                ...(sd && sd !== hd ? [{ quality: 'SD', label: 'SD Quality', url: sd }] : [])
              ]
            });
            break;
          }

          if (props.videoData) {
            extractVideosFromObject(props.videoData).forEach(emitVideoDetected);
          }
        }
        fiber = fiber.return;
        depth++;
      }
    } catch (e) {}
  }

  // Hook HTMLVideoElement events to inspect when video starts playing
  function attachVideoListeners() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      if (!v.__softItHooked) {
        v.__softItHooked = true;
        v.addEventListener('play', () => inspectReactFiber(v));
        v.addEventListener('playing', () => inspectReactFiber(v));
        v.addEventListener('loadedmetadata', () => inspectReactFiber(v));
        // Inspect immediately
        inspectReactFiber(v);
      }
    });
  }

  // --- Scan Script Tags ---
  function scanAllScripts() {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      if (s.textContent && s.textContent.length > 40) {
        parseAndExtract(s.textContent);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanAllScripts();
      attachVideoListeners();
    });
  } else {
    scanAllScripts();
    attachVideoListeners();
  }

  // Observe newly added nodes
  const observer = new MutationObserver((mutations) => {
    let hasNewScripts = false;
    let hasNewVideos = false;

    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.tagName === 'SCRIPT') hasNewScripts = true;
        if (node.tagName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) hasNewVideos = true;
      }
    }

    if (hasNewScripts) scanAllScripts();
    if (hasNewVideos) attachVideoListeners();
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // Query response helper
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'SOFT_IT_REQUEST_VIDEOS') {
      scanAllScripts();
      attachVideoListeners();
      window.postMessage({
        source: 'SOFT_IT_INPAGE',
        type: 'VIDEO_BATCH_SYNC',
        videos: Array.from(detectedVideoMap.values())
      }, '*');
    }
  });

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

})();
