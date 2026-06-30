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
// hasReview=true:  No(1) Noリンク(2) タイトル(3) 作品リンク(4) 画像Drive(5) 画像ステータス(6) レビュー(7) 販売日(8) ソース画像URL(9)
// hasReview=false: No(1) Noリンク(2) タイトル(3) 作品リンク(4) 画像Drive(5) 画像ステータス(6) 販売日(7) ソース画像URL(8)
function colNums(hasReview) {
  return {
    driveUrl:       5,
    imageStatus:    6,
    sourceImageUrl: hasReview ? 9 : 8,
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
         driveUrl, imageStatus, item.review || '', item.formattedDate || '', item.sourceImageUrl || '']
      : [item.no, item.noLink || '', item.title || '', item.videoUrl || '',
         driveUrl, imageStatus, item.formattedDate || '', item.sourceImageUrl || ''];

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

// ========== ヘルパー ==========
function saveImageToDrive(folder, no, base64) {
  var decoded = Utilities.base64Decode(base64);
  var blob    = Utilities.newBlob(decoded, 'image/jpeg', no + '.jpg');
  var file    = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { driveUrl: 'https://drive.google.com/uc?id=' + file.getId() };
}

function ensureHeader(sheet, hasReview) {
  if (sheet.getRange(1, 1).getValue() === 'No') return;
  var header = hasReview
    ? ['No', 'Noリンク', 'タイトル', '作品リンク', '画像(Driveリンク)', '画像ステータス', 'レビュー', '販売日', 'ソース画像URL']
    : ['No', 'Noリンク', 'タイトル', '作品リンク', '画像(Driveリンク)', '画像ステータス', '販売日', 'ソース画像URL'];
  sheet.getRange(1, 1, 1, header.length)
    .setValues([header])
    .setBackground('#d9ead3')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
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
