const GAS_URL = 'https://script.google.com/macros/s/AKfycbw1SmD7DN_A2Hr0PMRO9Xzt8AqAZj2nsyI0AjpBCgGyOyoSDXJSRGBW3RaCrPNzDlqYeg/exec';

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

function keepAlive() {
  return setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrape') {
    const timer = keepAlive();
    handleScrape(message.tabId, message.siteKey)
      .then(r => { clearInterval(timer); sendResponse(r); })
      .catch(e => { clearInterval(timer); sendResponse({ success: false, error: e.message }); });
    return true;
  }
  if (message.action === 'retryFailed') {
    const timer = keepAlive();
    handleRetryFailed(message.tabId, message.siteKey)
      .then(r => { clearInterval(timer); sendResponse(r); })
      .catch(e => { clearInterval(timer); sendResponse({ success: false, error: e.message }); });
    return true;
  }
});

// ========== Service Worker内で画像をfetch（declarativeNetRequestでCORSヘッダーを付与） ==========
async function fetchAsBase64(url, referer) {
  try {
    const headers = {};
    if (referer) headers['Referer'] = referer;
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

// ========== 通常スクレイプ ==========
async function handleScrape(tabId, siteKey) {
  const config = SITE_CONFIGS[siteKey];
  if (!config) throw new Error('対応していないサイトです: ' + siteKey);

  let existingNos = [];
  try {
    const res = await fetch(GAS_URL + '?action=getExistingNos&siteKey=' + siteKey);
    if (res.ok) existingNos = (await res.json()).nos || [];
  } catch (e) {
    console.warn('[BG] 既存No取得失敗:', e.message);
  }

  // タブ内でDOMパースのみ実施（画像fetchはService Worker側で行う）
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: scraperFunc,
    args: [existingNos, siteKey, SITE_CONFIGS],
  });

  const scraped = results[0]?.result;
  if (!scraped) throw new Error('スクレイピング結果が取得できませんでした');
  if (scraped.error) throw new Error(scraped.error);
  if (scraped.items.length === 0) return { success: true, savedCount: 0, imageCount: 0 };

  // Service Worker側で画像をfetch（declarativeNetRequestでCORSを回避）
  for (const item of scraped.items) {
    if (item.sourceImageUrl) {
      item.imageBase64 = await fetchAsBase64(item.sourceImageUrl, config.imageReferer);
    } else {
      item.imageBase64 = null;
    }
  }

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

// ========== 取得失敗行の再取得 ==========
async function handleRetryFailed(tabId, siteKey) {
  const config = SITE_CONFIGS[siteKey];
  if (!config) throw new Error('対応していないサイトです: ' + siteKey);

  const res = await fetch(GAS_URL + '?action=getFailedRows&siteKey=' + siteKey);
  if (!res.ok) throw new Error('失敗行取得エラー: HTTP ' + res.status);
  const { rows, error } = await res.json();
  if (error) throw new Error(error);
  if (!rows || rows.length === 0) return { success: true, updatedCount: 0 };

  // Service Worker側で画像をfetch（declarativeNetRequestでCORSを回避）
  const fetched = [];
  for (const row of rows) {
    const b64 = await fetchAsBase64(row.sourceImageUrl, config.imageReferer);
    fetched.push({ rowIndex: row.rowIndex, no: row.no, sourceImageUrl: row.sourceImageUrl, imageBase64: b64 });
  }

  const postRes = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'retryImages', siteKey, items: fetched }),
  });
  if (!postRes.ok) throw new Error('GAS通信エラー: HTTP ' + postRes.status);
  const result = await postRes.json();
  if (result.error) throw new Error(result.error);

  return { success: true, updatedCount: result.updatedCount };
}

// ========== スクレイパー本体（タブ内・DOMパースのみ） ==========
function scraperFunc(existingNos, siteKey, siteConfigs) {
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
      let no = rawNo.replace(/・/g, '').replace(/※.*/g, '').split('(')[0].trim().replace(/\s+/g, '');
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
      if (hasReview && tds.length >= 4) { reviewRaw = tds[2]; dateRaw = tds[3]; }
      else { dateRaw = tds[2] || ''; }
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
