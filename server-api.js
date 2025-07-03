const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

async function extractInstagramVideo(instagramUrl) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  console.log('⏳ Loading Instagram page...');
  await page.goto(instagramUrl, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  await new Promise(resolve => setTimeout(resolve, 12000));

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
    console.log('✅ Found via JSON:', videoUrlFromJSON);
    await browser.close();
    return videoUrlFromJSON;
  }

  const videoUrlFromVideoTag = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.map(v => v.src).find(src => src && src.includes('&vs=')) || null;
  });

  if (videoUrlFromVideoTag) {
    console.log('✅ Found via <video>:', videoUrlFromVideoTag);
    await browser.close();
    return videoUrlFromVideoTag;
  }

  const frames = page.frames();
  for (const frame of frames) {
    try {
      const frameVideoUrl = await frame.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'));
        return videos.map(v => v.src).find(src => src && src.includes('&vs=')) || null;
      });
      if (frameVideoUrl) {
        console.log('✅ Found in iframe:', frameVideoUrl);
        await browser.close();
        return frameVideoUrl;
      }
    } catch (err) {
      console.warn('⚠️ iframe access issue:', err.message);
    }
  }

  await browser.close();
  throw new Error('❌ Video not found.');
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
