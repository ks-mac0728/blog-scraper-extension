// ========== 設定（必ず書き換えてください） ==========
var SPREADSHEET_ID  = 'YOUR_SPREADSHEET_ID'; // スプレッドシートのID
var PARENT_FOLDER_ID = 'YOUR_FOLDER_ID';     // 画像を保存するドライブフォルダのID

var SITE_MAP = {
  'blog-entry-570': {
    sheetName: 'ナマラー自動抽出',
    folderName: 'Video_Thumbnails_Namara',
    hasReview: true,
  },
  'blog-entry-625': {
    sheetName: 'シロドラー自動抽出',
    folderName: 'Video_Thumbnails_Shirodora',
    hasReview: true,
  },
  'blog-entry-624': {
    sheetName: 'プリカラ自動抽出',
    folderName: 'Video_Thumbnails_Purikara',
    hasReview: false,
  },
};

// ========== GET: 既存Noリストを返す ==========
// Chrome拡張機能が差分チェックに使う
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
      .getValues()
      .flat()
      .map(String)
      .filter(Boolean);

    return jsonOut({ nos: nos });
  }

  return jsonOut({ error: '不明なアクション: ' + action });
}

// ========== POST: テキスト＋Base64画像を受け取ってシートとDriveに保存 ==========
function doPost(e) {
  try {
    // Content-Type: text/plain で届くため postData.contents を JSON.parse する
    var data = JSON.parse(e.postData.contents);
    if (data.action !== 'save') return jsonOut({ error: '不明なアクション' });

    var siteKey = data.siteKey;
    var config  = SITE_MAP[siteKey];
    if (!config) return jsonOut({ error: '不明なサイト: ' + siteKey });

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(config.sheetName);
    if (!sheet) return jsonOut({ error: 'シートが見つかりません: ' + config.sheetName });

    ensureHeader(sheet, config.hasReview);

    // 二重保存防止のため既存Noをセットで保持
    var existingNos = new Set();
    if (sheet.getLastRow() >= 2) {
      sheet
        .getRange(2, 1, sheet.getLastRow() - 1, 1)
        .getValues()
        .flat()
        .map(String)
        .forEach(function(n) { if (n) existingNos.add(n); });
    }

    var parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
    var imageFolder  = getOrCreateFolder(parentFolder, config.folderName);

    var savedCount = 0;
    var imageCount = 0;

    (data.items || []).forEach(function(item) {
      if (existingNos.has(String(item.no))) return; // 既存はスキップ

      var driveUrl    = '';
      var imageStatus = item.thumbnailUrl ? '取得失敗' : 'なし';

      if (item.imageBase64) {
        try {
          var decoded = Utilities.base64Decode(item.imageBase64);
          var blob    = Utilities.newBlob(decoded, 'image/jpeg', item.no + '.jpg');
          var file    = imageFolder.createFile(blob);
          // リンクを知っている全員が閲覧できるように設定
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          driveUrl    = 'https://drive.google.com/uc?id=' + file.getId();
          imageStatus = '保存済み';
          imageCount++;
        } catch (imgErr) {
          imageStatus = 'Drive保存失敗';
          console.error('画像保存エラー No=' + item.no + ':', imgErr.message);
        }
      }

      // プリカラはレビュー列なし（8列）、他は9列
      var row = config.hasReview
        ? [item.no, item.noLink || '', item.title || '', item.videoUrl || '',
           driveUrl, imageStatus, item.review || '', item.formattedDate || '', item.sourceImageUrl || '']
        : [item.no, item.noLink || '', item.title || '', item.videoUrl || '',
           driveUrl, imageStatus, item.formattedDate || '', item.sourceImageUrl || ''];

      sheet.appendRow(row);
      savedCount++;
    });

    return jsonOut({ success: true, savedCount: savedCount, imageCount: imageCount });

  } catch (err) {
    console.error('doPost エラー:', err.message);
    return jsonOut({ error: err.message });
  }
}

// ========== ヘルパー ==========
function ensureHeader(sheet, hasReview) {
  if (sheet.getRange(1, 1).getValue() === 'No') return;
  var header = hasReview
    ? ['No', 'Noリンク', 'タイトル', '作品リンク', '画像(Driveリンク)', '画像ステータス', 'レビュー', '販売日', 'ソース画像URL']
    : ['No', 'Noリンク', 'タイトル', '作品リンク', '画像(Driveリンク)', '画像ステータス', '販売日', 'ソース画像URL'];
  sheet
    .getRange(1, 1, 1, header.length)
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
