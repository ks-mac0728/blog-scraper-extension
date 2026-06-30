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

  const badge   = document.getElementById('site-badge');
  const runBtn  = document.getElementById('run-btn');
  const retryBtn = document.getElementById('retry-btn');
  const fillBtn = document.getElementById('fill-btn');

  if (currentSiteKey) {
    badge.textContent = '検出: ' + SITE_NAMES[currentSiteKey];
    setStatus('ボタンを押してスクレイピングを開始します。');
    runBtn.disabled = false;
    retryBtn.disabled = false;
    fillBtn.disabled = false;
  } else {
    badge.textContent = '対象外ページ';
    badge.classList.add('inactive');
    setStatus('naname42.com の対象ページを開いてください。\n(blog-entry-570 / 625 / 624)');
  }

  runBtn.addEventListener('click', onRunClick);
  retryBtn.addEventListener('click', onRetryClick);
  fillBtn.addEventListener('click', onFillClick);
}

async function onRunClick() {
  setButtonsDisabled(true);
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
        setStatus('完了！\n新規追加: ' + response.savedCount + ' 件\n画像保存: ' + response.imageCount + ' 件', 'success');
      }
    } else {
      setStatus('エラー: ' + response.error, 'error');
    }
  } catch (e) {
    setStatus('エラー: ' + e.message, 'error');
  } finally {
    setButtonsDisabled(false);
  }
}

async function onRetryClick() {
  setButtonsDisabled(true);
  setStatus('取得失敗の画像を再取得中...');
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'retryFailed',
      tabId: currentTabId,
      siteKey: currentSiteKey,
    });
    if (response.success) {
      if (response.updatedCount === 0) {
        setStatus('取得失敗の行はありませんでした。', 'success');
      } else {
        setStatus('完了！\n画像を更新: ' + response.updatedCount + ' 件', 'success');
      }
    } else {
      setStatus('エラー: ' + response.error, 'error');
    }
  } catch (e) {
    setStatus('エラー: ' + e.message, 'error');
  } finally {
    setButtonsDisabled(false);
  }
}

async function onFillClick() {
  setButtonsDisabled(true);
  setStatus('他サイトの一覧から欠損情報を補完中...');
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'fillMissing',
      siteKey: currentSiteKey,
    });
    if (response.success) {
      if (response.updatedCount === 0) {
        setStatus('欠損行はありませんでした。\n（マッチ: ' + (response.matchedCount || 0) + ' / 欠損: ' + (response.missingCount || 0) + ' 件）', 'success');
      } else {
        setStatus('完了！\n補完: ' + response.updatedCount + ' 件\n（マッチ: ' + response.matchedCount + ' / 欠損: ' + response.missingCount + ' 件）', 'success');
      }
    } else {
      setStatus('エラー: ' + response.error, 'error');
    }
  } catch (e) {
    setStatus('エラー: ' + e.message, 'error');
  } finally {
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  document.getElementById('run-btn').disabled = disabled;
  document.getElementById('retry-btn').disabled = disabled;
  document.getElementById('fill-btn').disabled = disabled;
}

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type || '';
}

init();
