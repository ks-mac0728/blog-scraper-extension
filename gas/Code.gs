// ========== 設定 ==========
var SPREADSHEET_ID  = '1kTcfBD_0FFplFjHR0j-wXexpdOV783QSNnOO9WXseVo';
var PARENT_FOLDER_ID = '1N8b7OGZo8ZNuanTWvZEc8tNY-aZtWIiY';

var SITE_MAP = {
  'blog-entry-570': {
    sheetName: 'ナマラー自動抽出',
    folderName: 'Video_Thumbnails_Namara',
    hasReview: true,
    imageReferer: 'https://contents.fc2.com/',
  },
  'blog-entry-625': {
    sheetName: 'シロドラー自動抽出',
    folderName: 'Video_Thumbnails_Shirodora',
    hasReview: true,
    imageReferer: 'https://market.laxd.com/',
  },
  'blog-entry-624': {
    sheetName: 'プリカラ自動抽出',
    folderName: 'Video_Thumbnails_Purikara',
    hasReview: false,
    imageReferer: null,
  },
};

// hasReviewによって列番号が変わる
// hasReview=true:  No(1) Noリンク(2) タイトル(3) 作品リンク(4) 画像Drive(5) 画像ステータス(6) レビュー(7) 販売日(8) ソース画像URL(9) 販売状況(10) レビュー詳細(11)
// hasReview=false: No(1) Noリンク(2) タイトル(3) 作品リンク(4) 画像Drive(5) 画像ステータス(6) 販売日(7) ソース画像URL(8) 販売状況(9) レビュー詳細(10)
function colNums(hasReview) {
  return {
    noLink:         2,
    title:          3,
    videoUrl:       4,
    driveUrl:       5,
    imageStatus:    6,
    saleDate:       hasReview ? 8 : 7,
    sourceImageUrl: hasReview ? 9 : 8,
    saleStatus:     hasReview ? 10 : 9,
    reviewDetail:   hasReview ? 11 : 10,
  };
}

// ========== GET ==========
function doGet(e) {
  var action = e.parameter.action;

  if (action === 'getExistingNos') {
    var siteKey = e.parameter.siteKey;
    var config = SITE_MAP[siteKey];
    if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(config.sheetName);
    if (!sheet || sheet.getLastRow() < 2) return jsonOut({ nos: [] });

    var nos = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues().flat().map(String).filter(Boolean);

    return jsonOut({ nos: nos });
  }

  if (action === 'getFailedRows') {
    var siteKey = e.parameter.siteKey;
    var config = SITE_MAP[siteKey];
    if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(config.sheetName);
    if (!sheet || sheet.getLastRow() < 2) return jsonOut({ rows: [] });

    var cols = colNums(config.hasReview);
    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(2, 1, lastRow - 1, cols.sourceImageUrl).getValues();

    var rows = [];
    data.forEach(function(row, i) {
      var status = String(row[cols.imageStatus - 1] || '');
      var sourceUrl = String(row[cols.sourceImageUrl - 1] || '');
      if (status === '取得失敗' && sourceUrl) {
        rows.push({
          rowIndex: i + 2, // シート上の実際の行番号（1始まり、ヘッダー除く）
          no: String(row[0] || ''),
          sourceImageUrl: sourceUrl,
        });
      }
    });

    return jsonOut({ rows: rows });
  }

  if (action === 'getMissingRows') {
    var siteKey = e.parameter.siteKey;
    var config = SITE_MAP[siteKey];
    if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(config.sheetName);
    if (!sheet || sheet.getLastRow() < 2) return jsonOut({ rows: [] });

    var cols = colNums(config.hasReview);
    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(2, 1, lastRow - 1, cols.sourceImageUrl).getValues();

    var rows = [];
    data.forEach(function(row, i) {
      var driveUrl = String(row[cols.driveUrl - 1] || '');
      if (driveUrl) return; // 既に画像がある行は対象外

      rows.push({
        rowIndex: i + 2,
        no: String(row[0] || ''),
        title: String(row[cols.title - 1] || ''),
        videoUrl: String(row[cols.videoUrl - 1] || ''),
        saleDate: String(row[cols.saleDate - 1] || ''),
      });
    });

    return jsonOut({ rows: rows });
  }

  if (action === 'getMissingReviews') {
    var siteKey = e.parameter.siteKey;
    var config = SITE_MAP[siteKey];
    if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });
    if (!config.hasReview) return jsonOut({ rows: [] });

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(config.sheetName);
    if (!sheet || sheet.getLastRow() < 2) return jsonOut({ rows: [] });

    var cols = colNums(config.hasReview);
    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(2, 1, lastRow - 1, cols.reviewDetail).getValues();

    var rows = [];
    data.forEach(function(row, i) {
      var reviewDetail = String(row[cols.reviewDetail - 1] || '');
      var noLink = String(row[cols.noLink - 1] || '');
      if (reviewDetail || !noLink) return; // 既に取得済み、またはNoリンクが無い行は対象外

      rows.push({
        rowIndex: i + 2,
        no: String(row[0] || ''),
        noLink: noLink,
      });
    });

    return jsonOut({ rows: rows });
  }

  if (action === 'getRowsByPage') {
    // 指定したページURL（詳細レビューページ）をNoリンクとして参照している行を
    // 全サイトのシートから横断検索する（RSSで変更検知したページの再取得に使う）
    var pageUrl = e.parameter.pageUrl;
    if (!pageUrl) return jsonOut({ error: 'pageUrlが指定されていません' });

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var rows = [];

    Object.keys(SITE_MAP).forEach(function(sk) {
      var cfg = SITE_MAP[sk];
      if (!cfg.hasReview) return; // レビュー詳細列が無いサイトは対象外
      var sheet = ss.getSheetByName(cfg.sheetName);
      if (!sheet || sheet.getLastRow() < 2) return;

      var cols = colNums(cfg.hasReview);
      var lastRow = sheet.getLastRow();
      var data = sheet.getRange(2, 1, lastRow - 1, cols.reviewDetail).getValues();

      data.forEach(function(row, i) {
        var noLink = String(row[cols.noLink - 1] || '');
        if (noLink.indexOf(pageUrl) === 0) {
          rows.push({ siteKey: sk, rowIndex: i + 2, no: String(row[0] || ''), noLink: noLink });
        }
      });
    });

    return jsonOut({ rows: rows });
  }

  return jsonOut({ error: '不明なアクション: ' + action });
}

// ========== POST ==========
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'save') {
      return doSave(data);
    }

    if (data.action === 'retryImages') {
      return doRetryImages(data);
    }

    if (data.action === 'fillMissing') {
      return doFillMissing(data);
    }

    if (data.action === 'fillReview') {
      return doFillReview(data);
    }

    return jsonOut({ error: '不明なアクション: ' + data.action });

  } catch (err) {
    console.error('doPost エラー:', err.message);
    return jsonOut({ error: err.message });
  }
}

// 新規データ追記
function doSave(data) {
  var siteKey = data.siteKey;
  var config  = SITE_MAP[siteKey];
  if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(config.sheetName);
  if (!sheet) return jsonOut({ error: 'シートが見つかりません: ' + config.sheetName });

  ensureHeader(sheet, config.hasReview);

  var existingNos = new Set();
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues().flat().map(String)
      .forEach(function(n) { if (n) existingNos.add(n); });
  }

  var parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var imageFolder  = getOrCreateFolder(parentFolder, config.folderName);

  var savedCount = 0;
  var imageCount = 0;

  (data.items || []).forEach(function(item) {
    if (existingNos.has(String(item.no))) return;

    var driveUrl    = '';
    var imageStatus = item.sourceImageUrl ? '取得失敗' : 'なし';

    if (item.imageBase64) {
      try {
        var result = saveImageToDrive(imageFolder, item.no, item.imageBase64);
        driveUrl    = result.driveUrl;
        imageStatus = '保存済み';
        imageCount++;
      } catch (imgErr) {
        imageStatus = '取得失敗';
        console.error('画像保存エラー No=' + item.no + ':', imgErr.message);
      }
    }

    var row = config.hasReview
      ? [item.no, item.noLink || '', item.title || '', item.videoUrl || '',
         driveUrl, imageStatus, item.review || '', item.formattedDate || '', item.sourceImageUrl || '',
         '販売中', item.reviewDetail || '']
      : [item.no, item.noLink || '', item.title || '', item.videoUrl || '',
         driveUrl, imageStatus, item.formattedDate || '', item.sourceImageUrl || '', '販売中'];

    sheet.appendRow(row);
    savedCount++;
  });

  return jsonOut({ success: true, savedCount: savedCount, imageCount: imageCount });
}

// 取得失敗行の画像を再取得して上書き
function doRetryImages(data) {
  var siteKey = data.siteKey;
  var config  = SITE_MAP[siteKey];
  if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(config.sheetName);
  if (!sheet) return jsonOut({ error: 'シートが見つかりません: ' + config.sheetName });

  var parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var imageFolder  = getOrCreateFolder(parentFolder, config.folderName);
  var cols = colNums(config.hasReview);

  var updatedCount = 0;

  (data.items || []).forEach(function(item) {
    if (!item.imageBase64 || !item.rowIndex) return;
    try {
      var result = saveImageToDrive(imageFolder, item.no, item.imageBase64);
      sheet.getRange(item.rowIndex, cols.driveUrl).setValue(result.driveUrl);
      sheet.getRange(item.rowIndex, cols.imageStatus).setValue('保存済み');
      updatedCount++;
    } catch (imgErr) {
      console.error('再取得保存エラー No=' + item.no + ':', imgErr.message);
    }
  });

  return jsonOut({ success: true, updatedCount: updatedCount });
}

// 他サイト（laxd.com等のmakerページ）から見つかった情報で、欠けている項目を埋める
function doFillMissing(data) {
  var siteKey = data.siteKey;
  var config  = SITE_MAP[siteKey];
  if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(config.sheetName);
  if (!sheet) return jsonOut({ error: 'シートが見つかりません: ' + config.sheetName });

  ensureHeader(sheet, config.hasReview);

  var parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var imageFolder  = getOrCreateFolder(parentFolder, config.folderName);
  var cols = colNums(config.hasReview);

  var updatedCount = 0;

  (data.items || []).forEach(function(item) {
    if (!item.rowIndex) return;

    if (item.videoUrl) {
      var videoCell = sheet.getRange(item.rowIndex, cols.videoUrl);
      if (!videoCell.getValue()) videoCell.setValue(item.videoUrl);
    }

    if (item.formattedDate) {
      var dateCell = sheet.getRange(item.rowIndex, cols.saleDate);
      if (!dateCell.getValue()) dateCell.setValue(item.formattedDate);
    }

    if (item.saleStatus) {
      sheet.getRange(item.rowIndex, cols.saleStatus).setValue(item.saleStatus);
    }

    if (item.imageBase64) {
      try {
        var result = saveImageToDrive(imageFolder, item.no, item.imageBase64);
        sheet.getRange(item.rowIndex, cols.driveUrl).setValue(result.driveUrl);
        sheet.getRange(item.rowIndex, cols.imageStatus).setValue('保存済み');
        sheet.getRange(item.rowIndex, cols.sourceImageUrl).setValue(item.sourceImageUrl || '');
        updatedCount++;
      } catch (imgErr) {
        sheet.getRange(item.rowIndex, cols.imageStatus).setValue('取得失敗');
        sheet.getRange(item.rowIndex, cols.sourceImageUrl).setValue(item.sourceImageUrl || '');
        console.error('画像保存エラー No=' + item.no + ':', imgErr.message);
      }
    } else if (item.sourceImageUrl) {
      // 画像fetch自体に失敗したが、ソースURLは判明している → 後で再取得ボタンの対象にする
      sheet.getRange(item.rowIndex, cols.imageStatus).setValue('取得失敗');
      sheet.getRange(item.rowIndex, cols.sourceImageUrl).setValue(item.sourceImageUrl);
      updatedCount++;
    }
  });

  return jsonOut({ success: true, updatedCount: updatedCount });
}

// Noリンク先のページから取得したレビュー詳細を書き込む
function doFillReview(data) {
  var siteKey = data.siteKey;
  var config  = SITE_MAP[siteKey];
  if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(config.sheetName);
  if (!sheet) return jsonOut({ error: 'シートが見つかりません: ' + config.sheetName });

  ensureHeader(sheet, config.hasReview);
  var cols = colNums(config.hasReview);

  var updatedCount = 0;
  (data.items || []).forEach(function(item) {
    if (!item.rowIndex || !item.reviewDetail) return;
    sheet.getRange(item.rowIndex, cols.reviewDetail).setValue(item.reviewDetail);
    updatedCount++;
  });

  return jsonOut({ success: true, updatedCount: updatedCount });
}

// ========== ヘルパー ==========
function saveImageToDrive(folder, no, base64) {
  var decoded = Utilities.base64Decode(base64);
  var blob    = Utilities.newBlob(decoded, 'image/jpeg', no + '.jpg');
  var file    = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { driveUrl: 'https://drive.google.com/uc?id=' + file.getId() };
}

function ensureHeader(sheet, hasReview) {
  var cols = colNums(hasReview);

  if (sheet.getRange(1, 1).getValue() !== 'No') {
    var header = hasReview
      ? ['No', 'Noリンク', 'タイトル', '作品リンク', '画像(Driveリンク)', '画像ステータス', 'レビュー', '販売日', 'ソース画像URL', '販売状況', 'レビュー詳細']
      : ['No', 'Noリンク', 'タイトル', '作品リンク', '画像(Driveリンク)', '画像ステータス', '販売日', 'ソース画像URL', '販売状況'];
    sheet.getRange(1, 1, 1, header.length)
      .setValues([header])
      .setBackground('#d9ead3')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
    return;
  }

  // 既存シートに無い列があれば追記する（後方互換のためのバックフィル）
  if (sheet.getRange(1, cols.saleStatus).getValue() !== '販売状況') {
    sheet.getRange(1, cols.saleStatus)
      .setValue('販売状況')
      .setBackground('#d9ead3')
      .setFontWeight('bold');
  }
  if (hasReview && sheet.getRange(1, cols.reviewDetail).getValue() !== 'レビュー詳細') {
    sheet.getRange(1, cols.reviewDetail)
      .setValue('レビュー詳細')
      .setBackground('#d9ead3')
      .setFontWeight('bold');
  }
}

function getOrCreateFolder(parent, folderName) {
  var it = parent.getFoldersByName(folderName);
  return it.hasNext() ? it.next() : parent.createFolder(folderName);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========== 初回セットアップ ==========
function setup() {
  var ss = SpreadsheetApp.create('FC2ブログスクレイパー - データ');
  var ssId = ss.getId();
  Object.keys(SITE_MAP).forEach(function(key) {
    var config = SITE_MAP[key];
    var sheet = ss.getSheetByName(config.sheetName) || ss.insertSheet(config.sheetName);
    ensureHeader(sheet, config.hasReview);
  });
  var defaultSheet = ss.getSheetByName('シート1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);
  var rootFolder = DriveApp.getRootFolder();
  var folder = rootFolder.createFolder('FC2ブログスクレイパー - 画像');
  var folderId = folder.getId();
  Logger.log('スプレッドシートID: ' + ssId);
  Logger.log('フォルダID: ' + folderId);
}
