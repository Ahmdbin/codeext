import express, { Request, Response } from 'express';
import { Window } from 'happy-dom';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const app = express();
const port = process.env.PORT || 3000;

class VideoLinkExtractor {
  private config: any;
  private foundUrls: Map<string, Set<string>>;
  private foundPlyrUrl: Map<string, string>;

  constructor(config = {}) {
    this.config = {
      timeout: 5000, // Increased timeout to 5 seconds
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
      maxRetries: 2,
      ...config
    };
    this.foundUrls = new Map();
    this.foundPlyrUrl = new Map();
  }

  async processSingleUrl(url: string, retry = 0): Promise<{ masterLink: string | null; plyrLink: string | null; }> {
    try {
      let html: string;
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': this.config.userAgent },
          // Note: node-fetch timeout is an AbortSignal, not a number. This might need adjustment.
        });
        html = await response.text();
      } catch (e) {
        const response = await fetch(url, {
          headers: { 'User-Agent': this.config.userAgent },
        });
        html = await response.text();
      }

      const $ = cheerio.load(html);
      const onclickElement = $('li[onclick]').first();
      let plyrLink: string | null = null;

      if (onclickElement.length > 0) {
        const onclickContent = onclickElement.attr('onclick');
        if (onclickContent) {
            const match = onclickContent.match(/player_iframe\.location\.href\s*=\s*'(.*?)'/);
            if (match && match[1]) {
              plyrLink = match[1];
              this.foundPlyrUrl.set(url, plyrLink);
            }
        }
      }

      if (plyrLink) {
        try {
          const plyrResponse = await fetch(plyrLink, {
              headers: { 'User-Agent': this.config.userAgent },
          });
          const plyrHtml = await plyrResponse.text();
          
          const plyrWindow = new Window();
          const plyrDocument = plyrWindow.document;
          plyrDocument.write(plyrHtml);
          
          const scripts = plyrDocument.querySelectorAll('script');
          scripts.forEach(script => {
            const content = script.textContent || '';
            const match = content.match(/https?:\/\/[^\"]+\.m3u8/gi);
            if (match) {
              match.forEach(link => this.addVideoUrl(link, url));
            }
          });

          const buttons = plyrDocument.querySelectorAll('button.hd_btn');
          buttons.forEach(button => {
            const videoUrl = button.getAttribute('data-url');
            if (videoUrl && videoUrl.includes('.m3u8')) {
              this.addVideoUrl(videoUrl, url);
            }
          });
          // It's good practice to close the window to free up resources
          plyrWindow.close();
        } catch (e: any) {
          console.error(`Error processing player link ${plyrLink}: ${e.message}`);
        }
      }

      return {
        masterLink: this.getMasterLink(url),
        plyrLink: plyrLink
      };
    } catch (err) {
      if (retry < this.config.maxRetries) {
        return this.processSingleUrl(url, retry + 1);
      }
      return { masterLink: null, plyrLink: null };
    }
  }

  addVideoUrl(videoUrl: string, sourceUrl: string) {
    if (!videoUrl || !videoUrl.match(/\.m3u8|scdns\.io|faselhd/i)) return;
    if (!this.foundUrls.has(sourceUrl)) this.foundUrls.set(sourceUrl, new Set());
    this.foundUrls.get(sourceUrl)?.add(videoUrl);
  }

  getMasterLink(sourceUrl: string): string | null {
    if (!this.foundUrls.has(sourceUrl)) return null;
    const urls = Array.from(this.foundUrls.get(sourceUrl) || []);
    return urls.find(url => url.includes('master.m3u8')) || urls[0] || null;
  }

  getPlyrLink(sourceUrl: string): string | null {
    return this.foundPlyrUrl.get(sourceUrl) || null;
  }
}

async function extractLinks(url: string) {
  const extractor = new VideoLinkExtractor();
  return await extractor.processSingleUrl(url);
}

app.get('/', (req: Request, res: Response) => {
    res.type('html').send(`
    <h1>Video Link Extractor API</h1>
    <p>Use the /api/extract endpoint with a 'url' query parameter.</p>
    <p>Example: <a href="/api/extract?url=https://example.com">/api/extract?url=https://example.com</a></p>
    `);
});

app.get('/api/extract', async (req: Request, res: Response) => {
  const url = req.query.url as string;

  if (!url) {
    return res.status(400).json({ error: 'URL query parameter is required.' });
  }

  try {
    const result = await extractLinks(url);
    if (!result.masterLink && !result.plyrLink) {
        return res.status(404).json({ message: 'No video links found.', source: url });
    }
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to extract video links.', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

