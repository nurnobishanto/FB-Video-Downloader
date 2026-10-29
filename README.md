# SOFT IT FB VIDEO DOWNLOADER (Manifest V3)

A high-performance Chrome extension that allows users to smoothly detect and download Facebook videos in **HD (1080p/720p)** and **SD** quality from Pages, personal profiles, Reels, Watch, public groups, and authorized private groups.

---

## 🌟 Key Features

- **Official Name**: **SOFT IT FB VIDEO DOWNLOADER**
- **Multi-Layer Video Detection Engine**:
  1. **Background WebRequest Interceptor**: Directly captures authenticated progressive MP4 media requests sent to `*.fbcdn.net` and `*.facebook.com` with 100% reliability as soon as a video buffers or plays.
  2. **In-Page (MAIN World) GraphQL & SSR Parser**: Decodes Facebook's internal JSON scripts and GraphQL responses for `playable_url_quality_hd` (1080p/720p) and `playable_url` (SD).
  3. **React Fiber DOM Inspection**: Hooks into `<video>` HTML5 elements to read internal React player props directly.
  4. **Dynamic Feed DOM Observer**: Injects sleek floating download buttons directly on Facebook video cards.
- **Support for All Video Locations**:
  - Facebook Pages & User Profiles
  - Facebook Reels & Watch feeds
  - Public Facebook Groups
  - **Authorized Private Groups**: Works seamlessly using your active Facebook session without bypassing any privacy or access controls.
- **Multiple Quality Options**: Choose between Full HD/HD, SD, or individual stream bitrates before downloading.
- **Clean Naming Convention**: Saves files as `SOFT_IT_FB_[Title]_[Quality]_[ID].mp4`.

---

## 🚀 How to Reload or Install in Chrome

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
2. Enable **Developer mode** (top-right toggle switch).
3. If you already loaded the extension earlier, click the **Reload (circular arrow 🔄)** icon on the **SOFT IT FB VIDEO DOWNLOADER** card.
4. If loading for the first time, click **Load unpacked** and select:
   ```text
   E:\Extenstions\FB Video Downloader
   ```
5. Open or refresh [Facebook](https://www.facebook.com).
6. **Play or scroll to any video**:
   - The floating **Download** button appears on the video card.
   - The extension badge counter in your Chrome toolbar updates instantly.
   - Click the extension icon to view all detected videos and pick your preferred quality (HD/SD)!
