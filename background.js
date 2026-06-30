const GAS_URL = 'https://script.google.com/macros/s/AKfycbyMpaRiFj_N_fSHNf5RE3bVJmMtGwaW9Py9NOe47Ki3LPy41IGn22_HKIl1k6k3C3eRdw/exec';

const SITE_CONFIGS = {
  'blog-entry-570': {
    name: 'ナマラー',
    hasReview: true,
    highQualityWidth: 'w1104',
    imageReferer: 'https://contents.fc2.com/',
  },
  'blog-entry-625': {
    name: 'シロドラー',
    hasReview: true,
    highQualityWidth: 'w640',
    imageReferer: 'https://market.laxd.com/',
  },
  'blog-entry-624': {
    name: 'プリカラ',
    hasReview: false,
    highQualityWidth: null,
    imageReferer: null,
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrape') {
    handleScrape(message.tabId, message.siteKey)
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

async function handleScrape(tabId, siteKey) {
  const config = SITE_CONFIGS[siteKey];
  if (!config) throw new Error('対応していないサイトです: ' + siteKey);

  // 1. GASから既存Noリストを取得
  let existingNos = [];
  try {
    const res = await fetch(GAS_URL + '?action=getExistingNos&siteKey=' + siteKey);
    if (res.ok) {
      const json = await res.json();
      existingNos = json.nos || [];
    }
  } catch (e) {
    console.warn('[BG] 既存No取得失敗（全件処理します）:', e.message);
  }

  // 2. タブ内でDOM解析（テキスト情報とサムネイルURLのみ取得）
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: scraperFunc,
    args: [existingNos, siteKey, SITE_CONFIGS],
  });

  const scraped = results[0]?.result;
  if (!scraped) throw new Error('スクレイピング結果が取得できませんでした');
  if (scraped.error) throw new Error(scraped.error);
  if (scraped.items.length === 0) return { success: true, savedCount: 0, imageCount: 0 };

  // 3. 画像をService Workerでfetch（host_permissionsによりCORSを回避）
  for (const item of scraped.items) {
    if (item.sourceImageUrl) {
      item.imageBase64 = await fetchAsBase64InBackground(item.sourceImageUrl, config.imageReferer);
    } else {
      item.imageBase64 = null;
    }
  }

  // 4. GASへPOST
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'save', siteKey, items: scraped.items }),
  });

  if (!res.ok) throw new Error('GAS通信エラー: HTTP ' + res.status);
  const result = await res.json();
  if (result.error) throw new Error(result.error);

  return { success: true, savedCount: result.savedCount, imageCount: result.imageCount };
}

// Service Worker側での画像fetch（CORSなし・host_permissions適用）
async function fetchAsBase64InBackground(url, referer) {
  try {
    const headers = { 'Referer': referer || '' };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn('[BG] 画像取得失敗 HTTP ' + res.status + ':', url);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (e) {
    console.warn('[BG] 画像fetch失敗:', url, e.message);
    return null;
  }
}

// ========== スクレイパー本体（タブのコンテキストに注入） ==========
// テキスト情報とsourceImageUrlのみ返す（画像fetchはしない）
async function scraperFunc(existingNos, siteKey, siteConfigs) {
  const config = siteConfigs[siteKey];
  if (!config) return { error: '設定が見つかりません: ' + siteKey };

  function parseItems(hasReview) {
    const items = [];
    let currentYear = String(new Date().getFullYear());
    const html = document.body.innerHTML;

    const blockRe = /<a name="(\d{4})">\1年<\/a>|<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;

    while ((m = blockRe.exec(html)) !== null) {
      if (m[1]) { currentYear = m[1]; continue; }

      const rowHtml = m[2];
      const tds = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdm;
      while ((tdm = tdRe.exec(rowHtml)) !== null) tds.push(tdm[1]);

      if (tds.length < 3) continue;

      const rawNo = tds[0].replace(/<[^>]*>/g, '').trim();
      if (!rawNo || rawNo === 'No' || (tds[1] && tds[1].includes('タイトル'))) continue;

      let no = rawNo
        .replace(/・/g, '')
        .replace(/※.*/g, '')
        .split('(')[0]
        .trim()
        .replace(/\s+/g, '');
      if (!no || no.includes('年')) continue;

      const noHref = (tds[0].match(/href="([^"]*)"/i) || ['', ''])[1];
      const noLink = noHref && !noHref.startsWith('http') ? 'https://naname42.com/' + noHref : noHref;

      const titleRaw = tds[1];
      const titleHref = (titleRaw.match(/href="([^"]*)"/i) || ['', ''])[1];
      const videoUrl = titleHref && !titleHref.startsWith('http') ? 'https://naname42.com/' + titleHref : titleHref;

      const imgM = titleRaw.match(/<img[^>]+src="([^"]+)"/i);
      let thumbnailUrl = imgM ? imgM[1] : '';
      if (thumbnailUrl.startsWith('//')) thumbnailUrl = 'https:' + thumbnailUrl;

      const title = titleRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

      let reviewRaw = '', dateRaw = '';
      if (hasReview && tds.length >= 4) {
        reviewRaw = tds[2];
        dateRaw = tds[3];
      } else {
        dateRaw = tds[2] || '';
      }
      const review = reviewRaw.replace(/<[^>]*>/g, '').trim();

      const d8 = dateRaw.match(/name="(\d{8})"/);
      let formattedDate = '';
      if (d8) {
        formattedDate = d8[1].slice(0,4) + '/' + d8[1].slice(4,6) + '/' + d8[1].slice(6,8);
      } else {
        const dm = dateRaw.match(/(\d{2})\/(\d{2})/);
        if (dm) formattedDate = currentYear + '/' + dm[1] + '/' + dm[2];
      }

      items.push({ no, noLink, title, videoUrl, thumbnailUrl, review, formattedDate });
    }

    return items.reverse();
  }

  function toHighQuality(url, width) {
    if (!url || !width) return url;
    return url.split('?')[0].replace(/\/w\d+\//, '/' + width + '/');
  }

  const existingSet = new Set(existingNos.map(String));
  const allItems = parseItems(config.hasReview);
  const newItems = allItems.filter(item => !existingSet.has(item.no));

  for (const item of newItems) {
    if (item.thumbnailUrl && config.highQualityWidth) {
      item.sourceImageUrl = toHighQuality(item.thumbnailUrl, config.highQualityWidth);
    } else {
      item.sourceImageUrl = item.thumbnailUrl || '';
    }
  }

  return { items: newItems };
}
