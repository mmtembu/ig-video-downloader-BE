const puppeteer = require('puppeteer');
const fs = require('fs');

async function extractInstagramVideo(instagramUrl) {
  const embedHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <blockquote 
    class="instagram-media" 
    data-instgrm-captioned 
    data-instgrm-permalink="${instagramUrl}" 
    data-instgrm-version="14"
    style="background:#FFF; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin: 1px; max-width:540px; min-width:326px; padding:0; width:calc(100% - 2px);">
    <div style="padding:16px;">
      <a href="${instagramUrl}" style="background:#FFFFFF; text-align:center; text-decoration:none; width:100%;" target="_blank">
        View on Instagram
      </a>
    </div>
  </blockquote>
  <script async src="https://www.instagram.com/embed.js"></script>
</body>
</html>
`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  console.log('⏳ Loading Instagram embed...');

  await page.goto(instagramUrl, {
  waitUntil: 'networkidle2',
  timeout: 30000,
});


  // Wait for content to load
  await new Promise(resolve => setTimeout(resolve, 12000));

  // 📥 1. Try extracting from <script type="application/json"> tag
  const videoUrlFromJSON = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
    for (const script of scripts) {
      try {
        const jsonText = script.innerText || script.textContent;
        const parsed = JSON.parse(jsonText);
        const flattened = JSON.stringify(parsed);
        const matches = flattened.match(/https:[^"]+\.mp4[^"]+/g);
        if (matches) {
          const vsUrl = matches.find(url => url.includes('&vs='));
          if (vsUrl) return vsUrl;
        }
      } catch (err) {}
    }
    return null;
  });

  if (videoUrlFromJSON) {
    console.log('✅ Found video via JSON:', videoUrlFromJSON);
    await browser.close();
    return videoUrlFromJSON;
  }

  // 🧿 2. Try from <video> tag in main page
  const videoUrlFromVideoTag = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.map(v => v.src).find(src => src && src.includes('&vs=')) || null;
  });

  if (videoUrlFromVideoTag) {
    console.log('✅ Found video in <video> tag:', videoUrlFromVideoTag);
    await browser.close();
    return videoUrlFromVideoTag;
  }

  // 🔁 3. Try inside iframes
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const frameVideoUrl = await frame.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'));
        return videos.map(v => v.src).find(src => src && src.includes('&vs=')) || null;
      });
      if (frameVideoUrl) {
        console.log('✅ Found video inside iframe:', frameVideoUrl);
        await browser.close();
        return frameVideoUrl;
      }
    } catch (err) {
      console.warn('⚠️ Could not access iframe:', err.message);
    }
  }

  await browser.close();
  throw new Error('❌ Video not found in any source.');
}

// 🧪 Test
const instagramReelUrl = 'https://www.instagram.com/reel/DIZbC4IAXcf/';

extractInstagramVideo(instagramReelUrl)
  .then(url => {
    console.log('\n🎉 FINAL VIDEO URL:', url);
  })
  .catch(err => {
    console.error('\n🚨 ERROR:', err.message);
  });
