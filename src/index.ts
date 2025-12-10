import express, { Request, Response } from 'express';
import { Window } from 'happy-dom';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

const config = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.faselhds.biz/',
    'X-Requested-With': 'XMLHttpRequest'
  }
};

interface ExtractedLink {
  quality: string;
  link: string;
}

async function fetchAndDecode(targetUrl: string): Promise<ExtractedLink[]> {
  // 1. Start time
  const startTime = Date.now();

  try {
    console.log("⏳ Fetching page...");
    const response = await fetch(targetUrl, { headers: config.headers });
    const html = await response.text();

    // 1. Extract quality section only
    const regex = /<div class="quality_change">([\s\S]*?)<\/button><\/div>/;
    const match = html.match(regex);

    if (!match) {
      console.log("⚠️ Could not find the quality_change section.");
      return [];
    }

    console.log("✅ Found encrypted block. Decrypting with Happy-DOM...");

    // 2. Setup Happy DOM environment
    const window = new Window({
      url: "https://www.faselhds.biz/",
      width: 1024,
      height: 768,
      settings: {
        // Disable external file loading to speed up and prevent hanging
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableIframePageLoading: true
      }
    });

    const document = window.document;

    // --- Mocking necessary functions ---
    // @ts-ignore
    window.fetch = () => Promise.resolve({ ok: true, json: () => ({}) });
    // @ts-ignore
    window.HTMLCanvasElement.prototype.getContext = () => null;
    // @ts-ignore
    window.HTMLElement.prototype.scrollIntoView = () => { };
    window.alert = () => { };
    // window.console.log = () => {}; // Keep console for server logs

    // 3. Insert code into page
    document.body.innerHTML = `<div id="container">${match[0]}</div>`;

    // 4. Run script manually
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      const code = script.textContent;
      if (code) {
        try {
          window.eval(code); // Execute code in fake window context
        } catch (e) {
          // Ignore non-critical errors
        }
      }
    });

    // 5. Wait for decryption
    return new Promise((resolve) => {
      setTimeout(() => {
        const buttons = document.querySelectorAll('button.hd_btn');
        const results: ExtractedLink[] = [];

        if (buttons.length > 0) {
          console.log("\n🎬 EXTRACTED LINKS:\n");
          buttons.forEach(btn => {
            const quality = btn.textContent.trim();
            const link = btn.getAttribute('data-url');
            if (link) {
              console.log(`[${quality}] -> ${link}`);
              results.push({ quality, link });
            }
          });
        } else {
          // Fallback
          const docContent = document.body.innerHTML;
          const urlMatch = docContent.match(/https?:\/\/[^"']+\.m3u8/g);
          if (urlMatch) {
            console.log("\n🎬 Raw Links Found via Regex after execution:\n");
            // Remove duplicates
            const uniqueLinks = [...new Set(urlMatch)];
            uniqueLinks.forEach(l => {
              console.log(l);
              results.push({ quality: 'auto', link: l });
            });
          } else {
            console.log("❌ Failed to decrypt links.");
          }
        }

        // 6. Calculate and print elapsed time
        const endTime = Date.now();
        const elapsedSeconds = ((endTime - startTime) / 1000).toFixed(3);

        console.log(`\n[#]TIME: ${elapsedSeconds} Sec`);

        // Close window
        window.close();
        resolve(results);
      }, 1000); // Keep 1000ms wait
    });

  } catch (error: any) {
    console.error("Error:", error.message);
    return [];
  }
}

app.get('/', (req: Request, res: Response) => {
  res.type('html').send(`
    <h1>Video Link Extractor API</h1>
    <p>Use the /api/extract endpoint with a 'url' query parameter.</p>
    <p>Example: <a href="/api/extract?url=https://example.com">/api/extract?url=...</a></p>
    `);
});

app.get('/api/extract', async (req: Request, res: Response) => {
  const url = req.query.url as string;

  if (!url) {
    return res.status(400).json({ error: 'URL query parameter is required.' });
  }

  try {
    const links = await fetchAndDecode(url);
    if (links.length === 0) {
      return res.status(404).json({ message: 'No video links found.', source: url });
    }
    res.status(200).json({ links });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to extract video links.', details: error.message });
  }
});

// Export the app for Vercel
export default app;

// Only listen if not running in a serverless environment
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}
