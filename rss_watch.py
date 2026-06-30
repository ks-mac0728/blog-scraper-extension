#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RSS監視スクリプト。
naname42.com の RSS(https://naname42.com/?xml) は <dc:date> が編集時に更新されないため、
日付ではなく各アイテムの本文(content)をハッシュ化して前回との差分で変更を検知する。

変更が見つかったページが、
  - スクレイピング対象の一覧ページ（blog-entry-570/624/625）なら scraper.scrape_site() を実行
  - それ以外（Noリンク先の詳細レビューページ）なら、そのページを参照している行を
    GASから横断検索し、レビュー詳細を再取得して上書きする

cronやlaunchdから頻繁に（例: 1時間おき）呼び出される想定。
"""

import hashlib
import html
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scraper  # noqa: E402

RSS_URL = 'https://naname42.com/?xml'
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.rss_state.json')

BLOG_URL_TO_SITE_KEY = {cfg['blogUrl']: key for key, cfg in scraper.SITE_CONFIGS.items()}

ITEM_RE = re.compile(r'<item\b[^>]*>(.*?)</item>', re.S)
LINK_RE = re.compile(r'<link>(.*?)</link>', re.S)
DESC_RE = re.compile(r'<description>(.*?)</description>', re.S)
CONTENT_RE = re.compile(r'<content:encoded><!\[CDATA\[(.*?)\]\]></content:encoded>', re.S)


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def fetch_rss_items():
    xml_text = scraper.http_get_text(RSS_URL)
    items = []
    for item_xml in ITEM_RE.findall(xml_text):
        link_m = LINK_RE.search(item_xml)
        desc_m = DESC_RE.search(item_xml)
        content_m = CONTENT_RE.search(item_xml)
        link = html.unescape(link_m.group(1)).strip() if link_m else None
        body = (content_m.group(1) if content_m else '') + (desc_m.group(1) if desc_m else '')
        if not link:
            continue
        items.append({'link': link, 'body': body})
    return items


def content_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def reprocess_review_page(page_url):
    """詳細レビューページが変更されたとき、それを参照している行のレビューを再取得する。"""
    result = scraper.http_get_json(
        scraper.GAS_URL + '?action=getRowsByPage&pageUrl=' + page_url
    )
    rows = result.get('rows', [])
    if not rows:
        print(f'  [{page_url}] を参照している行が見つかりませんでした')
        return

    print(f'  [{page_url}] を参照している行: {len(rows)} 件 → レビュー再取得')
    by_site = {}
    for row in rows:
        by_site.setdefault(row['siteKey'], []).append(row)

    for site_key, site_rows in by_site.items():
        items = []
        for row in site_rows:
            detail = scraper.fetch_review_detail(row['noLink'], row['no'])
            scraper.polite_sleep()
            if detail:
                items.append({'rowIndex': row['rowIndex'], 'no': row['no'], 'reviewDetail': detail})
        if items:
            res = scraper.gas_fill_review_batch(site_key, items)
            print(f'    {site_key}: {res.get("updatedCount", 0)} 件更新')


def main():
    state = load_state()
    try:
        items = fetch_rss_items()
    except Exception as e:
        print(f'[ERROR] RSS取得失敗: {e}')
        return

    changed_pages = []
    for item in items:
        h = content_hash(item['body'])
        if state.get(item['link']) != h:
            changed_pages.append(item['link'])
            state[item['link']] = h

    if not changed_pages:
        print('変更なし')
        return

    print(f'変更検知: {len(changed_pages)} 件')
    for page_url in changed_pages:
        print(f'- {page_url}')
        site_key = BLOG_URL_TO_SITE_KEY.get(page_url)
        if site_key:
            print(f'  → 一覧ページ更新。{scraper.SITE_CONFIGS[site_key]["name"]} を再スクレイピングします')
            try:
                scraper.scrape_site(site_key)
            except Exception as e:
                print(f'  [ERROR] {site_key}: {e}')
        else:
            try:
                reprocess_review_page(page_url)
            except Exception as e:
                print(f'  [ERROR] {page_url}: {e}')
        scraper.polite_sleep()

    save_state(state)


if __name__ == '__main__':
    main()
