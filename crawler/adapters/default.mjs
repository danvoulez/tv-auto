export const adapter = {
  name: 'default',

  async waitForPlayer(page, timeoutMs) {
    await page.waitForFunction(
      () => !!document.querySelector('video'),
      { timeout: timeoutMs }
    );
  },

  async triggerPlay(page) {
    return page.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video) return { ok: false, reason: 'no_video_element' };

      try {
        if (video.paused) {
          await video.play();
        }
        return { ok: true };
      } catch (error) {
        const playButton =
          document.querySelector('[aria-label*="play" i]') ||
          document.querySelector('.play') ||
          document.querySelector('button');

        if (playButton) {
          playButton.click();
          return { ok: true, reason: 'fallback_click' };
        }

        return {
          ok: false,
          reason: 'play_failed',
          detail: String(error)
        };
      }
    });
  },

  async extract(page) {
    return page.evaluate(() => {
      const video = document.querySelector('video');
      const rawTitle =
        document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
        document.querySelector('h1')?.textContent ||
        document.title ||
        '';
      const title = rawTitle.trim();
      const durationSec = Number.isFinite(video?.duration)
        ? Math.round(video.duration)
        : null;
      const width = video?.videoWidth || null;
      const height = video?.videoHeight || null;
      const qualitySignals = [];
      if (width && height) qualitySignals.push(`${width}x${height}`);
      if (height && height >= 720) qualitySignals.push('hd');
      if (height && height >= 1080) qualitySignals.push('1080p');

      return {
        title,
        duration_sec: durationSec,
        resolution: width && height ? { width, height } : null,
        quality_signals: qualitySignals,
        theme_tags: [],
        visual_features: []
      };
    });
  }
};
