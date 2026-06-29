const SITE_NAMES = {
  'blog-entry-570': 'ナマラー',
  'blog-entry-625': 'シロドラー',
  'blog-entry-624': 'プリカラ',
};

let currentTabId = null;
let currentSiteKey = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  currentTabId = tab.id;
  currentSiteKey = Object.keys(SITE_NAMES).find(k => (tab.url || '').includes(k)) || null;

  const badge = document.getElementById('site-badge');
  const runBtn = document.getElementById('run-btn');

  if (currentSiteKey) {
    badge.textContent = '検出: ' + SITE_NAMES[currentSiteKey];
    setStatus('ボタンを押してスクレイピングを開始します。');
    runBtn.disabled = false;
  } else {
    badge.textContent = '対象外ページ';
    badge.classList.add('inactive');
    setStatus('naname42.com の対象ページを開いてください。\n(blog-entry-570 / 625 / 624)');
  }

  runBtn.addEventListener('click', onRunClick);
}

async function onRunClick() {
  const runBtn = document.getElementById('run-btn');
  runBtn.disabled = true;
  setStatus('処理中...\n（画像DLがあるため数十秒かかる場合があります）');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'scrape',
      tabId: currentTabId,
      siteKey: currentSiteKey,
    });

    if (response.success) {
      if (response.savedCount === 0) {
        setStatus('新規データなし。\nすべて記録済みです。', 'success');
      } else {
        setStatus(
          '完了！\n新規追加: ' + response.savedCount + ' 件\n画像保存: ' + response.imageCount + ' 件',
          'success'
        );
      }
    } else {
      setStatus('エラー: ' + response.error, 'error');
    }
  } catch (e) {
    setStatus('エラー: ' + e.message, 'error');
  } finally {
    runBtn.disabled = false;
  }
}

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type || '';
}

init();
