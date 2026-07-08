#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
javtrailers.comの詳細ページを巡回し、DVD情報を抽出してGASスプレッドシートの調査用タブに書き込む。
書き込み先は本番のシリーズNoシートではなく、別タブ（人力レビュー用）。
"""
import json
import re
import sys
import time
from playwright.sync_api import sync_playwright

sys.path.insert(0, '/Users/saitoukousuke/blog-scraper-extension')
import scraper  # noqa: E402

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

TARGET_SHEET_ID = '1Qu7kagux1sK-2i64q0fWBRpEjbmQP35U42GdB5ZeegQ'
TAB_NAME = 'JavTrailers調査'
BATCH_SIZE = 10

with open('/tmp/ishibashi_items.json', encoding='utf-8') as f:
    items = json.load(f)


def classify(title):
    if re.search(r'素人生ドルR|ビキニ素人生ドルR', title):
        return 'R(別シリーズ)'
    if 'DS' in title:
        return 'DS'
    if 'Best Fuck' in title or 'Best Bikini' in title:
        return 'Best'
    if '100人斬り' in title:
        return '100人斬り'
    if re.search(r'素人生ドル\s*\d+(\s|$|海編|inハワイ)', title):
        return '番号のみ'
    return 'その他'


def extract_detail(page, url):
    page.goto(url, timeout=30000, wait_until='domcontentloaded')
    page.wait_for_selector('#description', timeout=20000)
    page.wait_for_timeout(800)

    def get_text(selector):
        try:
            return page.locator(selector).inner_text()
        except Exception:
            return ''

    info_text = get_text('#info-row .col-md-9')
    dvd_id = re.search(r'DVD ID:\s*([^\n]+)', info_text)
    code = re.search(r'品番[：:]\s*([^\n]+)', info_text)
    release = re.search(r'商品発売日[：:]\s*([^\n]+)', info_text)
    duration = re.search(r'収録時間[：:]\s*([^\n]+)', info_text)

    pkg_image = ''
    try:
        el = page.locator('img[data-src]').first
        pkg_image = el.get_attribute('data-src') or el.get_attribute('src') or ''
    except Exception:
        pass
    thumb_image = ''
    try:
        thumb_image = page.locator('#thumbnailContainer img').get_attribute('src') or ''
    except Exception:
        pass

    return {
        'dvdId': dvd_id.group(1).strip() if dvd_id else '',
        'code': code.group(1).strip() if code else '',
        'release': release.group(1).strip() if release else '',
        'duration': duration.group(1).strip() if duration else '',
        'pkgImage': pkg_image,
        'thumbImage': thumb_image,
    }


def main():
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for i, item in enumerate(items):
            url = 'https://javtrailers.com' + item['href']
            category = classify(item['title'])
            context = browser.new_context(user_agent=UA)
            page = context.new_page()
            try:
                d = extract_detail(page, url)
                rows.append([
                    item['title'], category, d['dvdId'], d['code'],
                    d['release'], d['duration'], d['pkgImage'], d['thumbImage'], url,
                ])
                print(f'[{i+1}/{len(items)}] OK: {item["title"]}')
            except Exception as e:
                rows.append([item['title'], category, '', '', '', '', '', '', url, f'ERROR: {e}'])
                print(f'[{i+1}/{len(items)}] ERROR: {item["title"]} -> {e}')
            context.close()
            time.sleep(3)

            if len(rows) >= BATCH_SIZE:
                scraper.http_post_json(scraper.GAS_URL, {
                    'action': 'writeStagingRows', 'sheetId': TARGET_SHEET_ID,
                    'tabName': TAB_NAME, 'rows': rows,
                })
                print(f'  -> {len(rows)}件 書き込み完了')
                rows = []
        browser.close()

    if rows:
        scraper.http_post_json(scraper.GAS_URL, {
            'action': 'writeStagingRows', 'sheetId': TARGET_SHEET_ID,
            'tabName': TAB_NAME, 'rows': rows,
        })
        print(f'  -> {len(rows)}件 書き込み完了（最終）')


if __name__ == '__main__':
    main()
