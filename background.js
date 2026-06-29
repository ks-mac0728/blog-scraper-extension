// ========== 設定（デプロイ後に YOUR_SCRIPT_ID を書き換えてください） ==========
const GAS_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';

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
    highQualityWidth: 'w640',          // Laxdは w640 が最大
    imageReferer: 'https://market.laxd.com/',
  },
  'blog-entry-624': {
    name: 'プリカラ',
    hasReview: false,
    highQualityWidth: null,
    imageReferer: null,
  },
};

// ========== メッセージハンドラ ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrape') {
    handleScrape(message.tabId, message.siteKey)
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true; // 非同期レスポンスを使うために必須
  }
});

// ========== メインフロー ==========
async function handleScrape(tabId, siteKey) {
  if (!SITE_CONFIGS[siteKey]) throw new Error('対応していないサイトです: ' + siteKey);

  // 1. GASから既存Noリストを取得してフィルタに使う
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

  // 2. タブ内でスクレイピング + 画像DL（ブラウザのIPを使うためLaxd 403を回避）
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: scraperFunc,            // タブに注入して実行する自己完結関数
    args: [existingNos, siteKey, SITE_CONFIGS],
  });

  const scraped = results[0]?.result;
  if (!scraped) throw new Error('スクレイピング結果が取得できませんでした');
  if (scraped.error) throw new Error(scraped.error);
  if (scraped.items.length === 0) return { success: true, savedCount: 0, imageCount: 0 };

  // 3. テキスト＋Base64画像を GAS へ POST
  // Content-Type を text/plain にすることで CORS プリフライトを回避（GAS の仕様）
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

// ========== スクレイパー本体（タブのコンテキストに注入して実行） ==========
// この関数は .toString() でシリアライズされるため、必ず自己完結にすること
// 外部の変数・関数は参照不可。必要なデータは args 経由で受け取る。
async function scraperFunc(existingNos, siteKey, siteConfigs) {
  const config = siteConfigs[siteKey];
  if (!config) return { error: '設定が見つかりません: ' + siteKey };

  // ---- DOM からテーブル行を解析 ----
  function parseItems(hasReview) {
    const items = [];
    let currentYear = String(new Date().getFullYear());
    const html = document.body.innerHTML;

    // 年アンカー OR <tr> のどちらかにマッチする正規表現（GASの抽出ロジックと同一）
    const blockRe = /<a name="(\d{4})">\1年<\/a>|<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;

    while ((m = blockRe.exec(html)) !== null) {
      if (m[1]) { currentYear = m[1]; continue; } // 年アンカーの場合

      const rowHtml = m[2];
      const tds = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdm;
      while ((tdm = tdRe.exec(rowHtml)) !== null) tds.push(tdm[1]);

      if (tds.length < 3) continue;

      const rawNo = tds[0].replace(/<[^>]*>/g, '').trim();
      if (!rawNo || rawNo === 'No' || (tds[1] && tds[1].includes('タイトル'))) continue;

      // ・や※やカッコ書きを除去して正規化
      let no = rawNo
        .replace(/・/g, '')
        .replace(/※.*/g, '')
        .split('(')[0]
        .trim()
        .replace(/\s+/g, '');
      if (!no || no.includes('年')) continue;

      // No列のリンク
      const noHref = (tds[0].match(/href="([^"]*)"/i) || ['', ''])[1];
      const noLink = noHref && !noHref.startsWith('http') ? 'https://naname42.com/' + noHref : noHref;

      // タイトル列
      const titleRaw = tds[1];
      const titleHref = (titleRaw.match(/href="([^"]*)"/i) || ['', ''])[1];
      const videoUrl = titleHref && !titleHref.startsWith('http') ? 'https://naname42.com/' + titleHref : titleHref;

      // サムネイル画像URL
      const imgM = titleRaw.match(/<img[^>]+src="([^"]+)"/i);
      let thumbnailUrl = imgM ? imgM[1] : '';
      if (thumbnailUrl.startsWith('//')) thumbnailUrl = 'https:' + thumbnailUrl;

      const title = titleRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

      // レビュー列と日付列（サイトによって構成が違う）
      let reviewRaw = '', dateRaw = '';
      if (hasReview && tds.length >= 4) {
        reviewRaw = tds[2];
        dateRaw = tds[3];
      } else {
        dateRaw = tds[2] || '';
      }
      const review = reviewRaw.replace(/<[^>]*>/g, '').trim();

      // 日付のフォーマット（YYYYMMDD または MM/DD 形式を処理）
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

    return items.reverse(); // サイトは上が最新 → reverse で古い順にしてGASで appendRow
  }

  // ---- サムネイルURLを高画質に変換 ----
  function toHighQuality(url, width) {
    if (!url || !width) return url;
    return url.split('?')[0].replace(/\/w\d+\//, '/' + width + '/');
  }

  // ---- 画像を fetch して Base64 化（ブラウザのIPで通信するためLaxdの403を回避） ----
  async function fetchAsBase64(url, referer) {
    try {
      const headers = {};
      if (referer) headers['Referer'] = referer;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn('[Scraper] 画像取得失敗 HTTP ' + res.status + ': ' + url);
        return null;
      }
      const blob = await res.blob();
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => {
          // "data:image/jpeg;base64,XXXX..." の base64 部分だけ返す
          const b64 = reader.result ? reader.result.split(',')[1] : null;
          resolve(b64 || null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('[Scraper] fetch失敗:', url, e.message);
      return null;
    }
  }

  // ---- メイン処理 ----
  const existingSet = new Set(existingNos.map(String));
  const allItems = parseItems(config.hasReview);
  const newItems = allItems.filter(item => !existingSet.has(item.no));

  for (const item of newItems) {
    if (item.thumbnailUrl && config.highQualityWidth) {
      const hqUrl = toHighQuality(item.thumbnailUrl, config.highQualityWidth);
      item.sourceImageUrl = hqUrl;
      item.imageBase64 = await fetchAsBase64(hqUrl, config.imageReferer);
    } else {
      item.sourceImageUrl = item.thumbnailUrl || '';
      item.imageBase64 = null;
    }
  }

  return { items: newItems };
}
