const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // Parse JSON request bodies

// Retry wrapper for the extraction logic
async function retryUntilSuccess(taskFn, maxRetries = 10, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await taskFn();
      if (result) return result;
    } catch (err) {
      console.warn(`🔁 Retry ${attempt}/${maxRetries} failed:`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error('❌ Max retries reached without success.');
}

// Function to extract Instagram video URL from the given post URL
async function extractInstagramVideo(instagramUrl) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  console.log('⏳ Loading Instagram embed...');
  await page.goto(instagramUrl, {
    waitUntil: 'networkidle2',
    timeout: 0,
  });

  // Define attempt logic as a function for retrying
  const tryExtractVideoUrl = async () => {
    // Wait for embed or video content to render
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 1: Extract from <script type="application/json">
    const videoUrlFromJSON = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
      for (const script of scripts) {
        try {
          const jsonText = script.innerText || script.textContent;
          const parsed = JSON.parse(jsonText);
          const flattened = JSON.stringify(parsed);
          const matches = flattened.match(/https:[^"']+\.mp4[^"']+/g);
          if (matches) {
            const vsUrl = matches.find(url => url.includes('&vs='));
            if (vsUrl) return vsUrl;
          }
        } catch (_) {}
      }
      return null;
    });

    if (videoUrlFromJSON) {
      console.log('✅ Found video via JSON:', videoUrlFromJSON);
      return videoUrlFromJSON;
    }

    // Step 2: Extract from <video> tag
    const videoUrlFromVideoTag = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      return videos.map(v => v.src).find(src => src && src.includes('&vs=')) || null;
    });

    if (videoUrlFromVideoTag) {
      console.log('✅ Found video in <video> tag:', videoUrlFromVideoTag);
      return videoUrlFromVideoTag;
    }

    // Step 3: Check iframes
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const frameVideoUrl = await frame.evaluate(() => {
          const videos = Array.from(document.querySelectorAll('video'));
          return videos.map(v => v.src).find(src => src && src.includes('&vs=')) || null;
        });
        if (frameVideoUrl) {
          console.log('✅ Found video in iframe:', frameVideoUrl);
          return frameVideoUrl;
        }
      } catch (err) {
        console.warn('⚠️ iframe access issue:', err.message);
      }
    }

    return null; // retry again
  };

  // Run with retry logic
  const result = await retryUntilSuccess(tryExtractVideoUrl);
  await browser.close();
  return result;
}

app.post('/api/instagram/download', async (req, res) => {
  req.setTimeout(0);
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing Instagram URL' });
  }

  try {
    const videoUrl = await extractInstagramVideo(url);
    res.json({ success: true, videoUrl });
  } catch (err) {
    console.error('🚨 Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
