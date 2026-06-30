#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FC2ブログスクレイパー（Python版）
naname42.com のブログ一覧から新規作品を取得し、GAS Web App経由でスプレッドシートに記録する。
画像が取得できなかった作品は、各サイトのmakerページ（新着順一覧）を参照して補完する。
"""

import base64
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request

GAS_URL = 'https://script.google.com/macros/s/AKfycbw1SmD7DN_A2Hr0PMRO9Xzt8AqAZj2nsyI0AjpBCgGyOyoSDXJSRGBW3RaCrPNzDlqYeg/exec'

USER_AGENT = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

BATCH_SIZE = 5
MIN_DELAY = 2.0   # リクエスト間の最小待機秒数
MAX_DELAY = 6.0   # リクエスト間の最大待機秒数
MAX_MAKER_PAGES = 60  # makerページの最大探索ページ数（安全上限）

SITE_CONFIGS = {
    'blog-entry-570': {
        'name': 'ナマラー',
        'blogUrl': 'https://naname42.com/blog-entry-570.html',
        'hasReview': True,
        'highQualityWidth': 'w1104',
        'imageReferer': 'https://contents.fc2.com/',
        'makerBaseUrl': 'https://adult.contents.fc2.com/users/namara/articles?sort=date&order=desc',
        # ブログ側の作品リンク(aff.php?aid=NNN)と、商品一覧側のリンク(article_search.php?id=NNN)は
        # パラメータ名は違うが、値（記事ID）は同じものを指す
        'videoUrlIdPattern': re.compile(r'(?:aid=|article/)(\d+)'),
        'makerHrefIdPattern': re.compile(r'id=(\d+)'),
    },
    'blog-entry-625': {
        'name': 'シロドラー',
        'blogUrl': 'https://naname42.com/blog-entry-625.html',
        'hasReview': True,
        'highQualityWidth': 'w640',
        'imageReferer': 'https://market.laxd.com/',
        'makerBaseUrl': 'https://market.laxd.com/maker/shirodora/articles?sort=date&order=desc',
        'videoUrlIdPattern': re.compile(r'/item/([A-Za-z0-9]+)/'),
        'makerHrefIdPattern': re.compile(r'/item/([A-Za-z0-9]+)/'),
    },
    'blog-entry-624': {
        'name': 'プリカラ',
        'blogUrl': 'https://naname42.com/blog-entry-624.html',
        'hasReview': False,
        'highQualityWidth': None,
        'imageReferer': 'https://market.laxd.com/',
        'makerBaseUrl': 'https://market.laxd.com/maker/purikara/articles?sort=date&order=desc',
        'videoUrlIdPattern': re.compile(r'/item/([A-Za-z0-9]+)/'),
        'makerHrefIdPattern': re.compile(r'/item/([A-Za-z0-9]+)/'),
    },
}


def polite_sleep():
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


def http_get(url, max_time=20):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=max_time) as resp:
        return resp.read()


def http_get_text(url, max_time=20):
    return http_get(url, max_time).decode('utf-8', errors='replace')


def http_post_json(url, payload, max_time=60, retries=3):
    data = json.dumps(payload).encode('utf-8')
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method='POST',
                                          headers={'Content-Type': 'text/plain', 'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=max_time) as resp:
                result = json.loads(resp.read().decode('utf-8'))
            # GASがPOST→GETへのリダイレクトを誤って踏んでaction不明になる稀なケースをリトライ対象にする
            if isinstance(result, dict) and result.get('error') == '不明なアクション: undefined':
                raise RuntimeError('POSTがGETにリダイレクトされた可能性')
            return result
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    raise last_err


def http_get_json(url, max_time=20, retries=3):
    last_err = None
    for attempt in range(retries):
        try:
            return json.loads(http_get_text(url, max_time))
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    raise last_err


# ========== GASとの通信 ==========

def gas_get_existing_nos(site_key):
    try:
        result = http_get_json(GAS_URL + '?action=getExistingNos&siteKey=' + site_key)
        return set(map(str, result.get('nos', [])))
    except Exception as e:
        print(f'[WARN] 既存No取得失敗: {e}')
        return set()


def gas_get_missing_rows(site_key):
    result = http_get_json(GAS_URL + '?action=getMissingRows&siteKey=' + site_key)
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result.get('rows', [])


def gas_save_batch(site_key, items):
    result = http_post_json(GAS_URL, {'action': 'save', 'siteKey': site_key, 'items': items})
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result


def gas_fill_missing_batch(site_key, items):
    result = http_post_json(GAS_URL, {'action': 'fillMissing', 'siteKey': site_key, 'items': items})
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result


def gas_get_missing_reviews(site_key):
    result = http_get_json(GAS_URL + '?action=getMissingReviews&siteKey=' + site_key)
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result.get('rows', [])


def gas_fill_review_batch(site_key, items):
    result = http_post_json(GAS_URL, {'action': 'fillReview', 'siteKey': site_key, 'items': items})
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result


# ========== ブログ一覧ページの解析 ==========

def parse_blog_items(html, has_review):
    items = []
    current_year = str(time.localtime().tm_year)

    block_re = re.compile(r'<a name="(\d{4})">\1年</a>|<tr[^>]*>([\s\S]*?)</tr>', re.I)
    td_re = re.compile(r'<td[^>]*>([\s\S]*?)</td>', re.I)
    tag_re = re.compile(r'<[^>]*>')

    for m in block_re.finditer(html):
        if m.group(1):
            current_year = m.group(1)
            continue
        row_html = m.group(2) or ''
        tds = td_re.findall(row_html)
        if len(tds) < 3:
            continue

        raw_no = tag_re.sub('', tds[0]).strip()
        if not raw_no or raw_no == 'No' or (len(tds) > 1 and 'タイトル' in tds[1]):
            continue
        no = raw_no.replace('・', '')
        no = re.sub(r'※.*', '', no)
        no = no.split('(')[0].strip()
        no = re.sub(r'\s+', '', no)
        if not no or '年' in no:
            continue

        no_href_m = re.search(r'href="([^"]*)"', tds[0], re.I)
        no_href = no_href_m.group(1) if no_href_m else ''
        no_link = ('https://naname42.com/' + no_href) if no_href and not no_href.startswith('http') else no_href

        title_raw = tds[1]
        title_href_m = re.search(r'href="([^"]*)"', title_raw, re.I)
        title_href = title_href_m.group(1) if title_href_m else ''
        video_url = ('https://naname42.com/' + title_href) if title_href and not title_href.startswith('http') else title_href

        img_m = re.search(r'<img[^>]+src="([^"]+)"', title_raw, re.I)
        thumbnail_url = img_m.group(1) if img_m else ''
        if thumbnail_url.startswith('//'):
            thumbnail_url = 'https:' + thumbnail_url

        title = tag_re.sub('', title_raw)
        title = re.sub(r'\s+', ' ', title).strip()

        review_raw, date_raw = '', ''
        if has_review and len(tds) >= 4:
            review_raw, date_raw = tds[2], tds[3]
        else:
            date_raw = tds[2] if len(tds) > 2 else ''
        review = tag_re.sub('', review_raw).strip()

        d8_m = re.search(r'name="(\d{8})"', date_raw)
        formatted_date = ''
        if d8_m:
            d8 = d8_m.group(1)
            formatted_date = f'{d8[0:4]}/{d8[4:6]}/{d8[6:8]}'
        else:
            dm = re.search(r'(\d{2})/(\d{2})', date_raw)
            if dm:
                formatted_date = f'{current_year}/{dm.group(1)}/{dm.group(2)}'

        items.append({
            'no': no, 'noLink': no_link, 'title': title, 'videoUrl': video_url,
            'thumbnailUrl': thumbnail_url, 'review': review, 'formattedDate': formatted_date,
        })

    return list(reversed(items))


def to_high_quality(url, width):
    if not url or not width:
        return url
    base = url.split('?')[0]
    return re.sub(r'/w\d+/', f'/{width}/', base)


def fetch_image_base64(url, referer):
    if not url:
        return None
    try:
        headers = {'User-Agent': USER_AGENT}
        if referer:
            headers['Referer'] = referer
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
        return base64.b64encode(data).decode('ascii')
    except Exception as e:
        print(f'[WARN] 画像取得失敗 {url}: {e}')
        return None


# ========== Noリンク先ページからレビュー詳細を抽出 ==========

_review_page_cache = {}


def fetch_review_detail(no_link, no):
    """Noリンク（別のブログ記事ページ）からNoの項目のレビュー本文を抜き出す。
    顔/スタイル/ガチ度/展開の評価テーブルはノイズとして除外し、
    プロフィール文＋レビュー本文だけをまとめて1つの文字列にする。"""
    if not no_link or '#' not in no_link:
        return None
    page_url, anchor = no_link.split('#', 1)

    html = _review_page_cache.get(page_url)
    if html is None:
        try:
            html = http_get_text(page_url)
        except Exception as e:
            print(f'[WARN] レビューページ取得失敗 {page_url}: {e}')
            html = ''
        _review_page_cache[page_url] = html
    if not html:
        return None

    idx = html.find(f'name="{anchor}">')
    if idx == -1:
        return None
    outer_start = html.find('<table', idx)
    if outer_start == -1:
        return None
    first_close = html.find('</table>', outer_start)
    if first_close == -1:
        return None
    first_close_end = first_close + len('</table>')
    second_close = html.find('</table>', first_close_end)
    if second_close == -1:
        return None
    outer_html = html[outer_start:second_close + len('</table>')]

    inner_open = outer_html.find('<table', 6)
    if inner_open != -1:
        inner_close = outer_html.find('</table>', inner_open) + len('</table>')
        cleaned = outer_html[:inner_open] + outer_html[inner_close:]
    else:
        cleaned = outer_html

    text = re.sub(r'<[^>]*>', '\n', cleaned)
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    result = '\n'.join(lines)
    return result or None


# ========== makerページ（FC2/laxd 商品一覧）の解析 ==========

ITEM_LINK_RE = re.compile(
    r'<a href="([^"]+)"[^>]*title="([^"]*)"[^>]*class="c-cntCard-110-f_thumb_link"[^>]*>\s*<img src="([^"]+)"'
)


def parse_maker_page(html):
    items = []
    for href, title, thumb in ITEM_LINK_RE.findall(html):
        if thumb.startswith('//'):
            thumb = 'https:' + thumb
        items.append({'href': href, 'title': title.strip(), 'thumbnailUrl': thumb})
    return items


def fetch_maker_items(maker_base_url, target_titles, target_ids, maker_href_id_pattern):
    """新着順一覧を1ページずつ取得し、探している欠損行が全部見つかるか、
    空ページ・最大ページ数に当たるまで遡る。"""
    origin_m = re.match(r'(https?://[^/]+)', maker_base_url)
    origin = origin_m.group(1) if origin_m else ''

    by_id = {}
    by_title = {}
    remaining_titles = set(target_titles)
    remaining_ids = set(target_ids)
    reached_end = False  # 一覧の最後（空ページ）まで遡りきったか
    page = 1
    while page <= MAX_MAKER_PAGES:
        url = maker_base_url + ('&page=%d' % page if page > 1 else '')
        try:
            html = http_get_text(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                reached_end = True
                break
            raise

        raw_items = parse_maker_page(html)
        if not raw_items:
            reached_end = True
            break

        for it in raw_items:
            href = it['href']
            if href.startswith('/'):
                href = origin + href
            entry = {'href': href, 'title': it['title'], 'thumbnailUrl': it['thumbnailUrl']}
            by_title[it['title']] = entry
            remaining_titles.discard(it['title'])
            if maker_href_id_pattern:
                idm = maker_href_id_pattern.search(href)
                if idm:
                    by_id[idm.group(1)] = entry
                    remaining_ids.discard(idm.group(1))

        page += 1
        if not remaining_titles and not remaining_ids:
            break
        polite_sleep()

    return by_id, by_title, reached_end


# ========== サイトごとの処理 ==========

def scrape_site(site_key):
    config = SITE_CONFIGS[site_key]
    print(f'=== {config["name"]} ({site_key}) ===')

    existing_nos = gas_get_existing_nos(site_key)
    polite_sleep()

    blog_html = http_get_text(config['blogUrl'])
    all_items = parse_blog_items(blog_html, config['hasReview'])
    new_items = [it for it in all_items if it['no'] not in existing_nos]
    print(f'新規作品: {len(new_items)} 件')

    saved_count = 0
    image_count = 0
    for i in range(0, len(new_items), BATCH_SIZE):
        batch = new_items[i:i + BATCH_SIZE]
        for item in batch:
            if item['thumbnailUrl'] and config['highQualityWidth']:
                hq_url = to_high_quality(item['thumbnailUrl'], config['highQualityWidth'])
            else:
                hq_url = item['thumbnailUrl'] or ''
            item['sourceImageUrl'] = hq_url
            if hq_url:
                item['imageBase64'] = fetch_image_base64(hq_url, config['imageReferer'])
                polite_sleep()
            else:
                item['imageBase64'] = None

            if config['hasReview'] and item.get('noLink'):
                item['reviewDetail'] = fetch_review_detail(item['noLink'], item['no'])
                polite_sleep()

        result = gas_save_batch(site_key, batch)
        saved_count += result.get('savedCount', 0)
        image_count += result.get('imageCount', 0)
        polite_sleep()

    print(f'保存: {saved_count} 件 / 画像保存: {image_count} 件')

    # ----- 欠損情報の補完（makerページ参照） -----
    missing_rows = gas_get_missing_rows(site_key)
    print(f'欠損行: {len(missing_rows)} 件')

    if missing_rows:
        fill_missing_images(site_key, config, missing_rows)

    # ----- レビュー詳細の補完（既存行のうち未取得のもの） -----
    if config['hasReview']:
        fill_missing_reviews(site_key)


def fill_missing_images(site_key, config, missing_rows):
    target_titles = [row['title'] for row in missing_rows]
    target_ids = []
    if config['videoUrlIdPattern']:
        for row in missing_rows:
            idm = config['videoUrlIdPattern'].search(row.get('videoUrl') or '')
            if idm:
                target_ids.append(idm.group(1))

    by_id, by_title, reached_end = fetch_maker_items(
        config['makerBaseUrl'], target_titles, target_ids, config['makerHrefIdPattern']
    )

    to_fill = []
    unmatched = []
    for row in missing_rows:
        matched = None
        if config['videoUrlIdPattern'] and row.get('videoUrl'):
            idm = config['videoUrlIdPattern'].search(row['videoUrl'])
            if idm:
                matched = by_id.get(idm.group(1))
        if not matched:
            matched = by_title.get(row['title'])
        if matched:
            to_fill.append({'row': row, 'matched': matched})
        else:
            unmatched.append(row)

    print(f'マッチ: {len(to_fill)} / {len(missing_rows)} 件')
    # 一覧の最後まで遡ってマッチしなかった = 一覧から削除済み（販売終了）と判断できる
    # 途中で探索を打ち切った場合は判断材料が無いので「不明」のままにする
    not_found_status = '販売終了' if reached_end else '不明（未確認）'

    updated_count = 0
    for i in range(0, len(to_fill), BATCH_SIZE):
        batch = to_fill[i:i + BATCH_SIZE]
        items = []
        for entry in batch:
            row, matched = entry['row'], entry['matched']
            hq_url = to_high_quality(matched['thumbnailUrl'], config['highQualityWidth'] or 'w1080')
            b64 = fetch_image_base64(hq_url, config['imageReferer'])
            polite_sleep()
            items.append({
                'rowIndex': row['rowIndex'],
                'no': row['no'],
                'sourceImageUrl': hq_url,
                'imageBase64': b64,
                'videoUrl': matched['href'] if not row.get('videoUrl') else None,
                'saleStatus': '販売中',
            })
        result = gas_fill_missing_batch(site_key, items)
        updated_count += result.get('updatedCount', 0)
        polite_sleep()

    for i in range(0, len(unmatched), BATCH_SIZE):
        batch = unmatched[i:i + BATCH_SIZE]
        items = [{'rowIndex': row['rowIndex'], 'no': row['no'], 'saleStatus': not_found_status} for row in batch]
        gas_fill_missing_batch(site_key, items)
        polite_sleep()

    print(f'補完完了: {updated_count} 件（販売状況のみ更新: {len(unmatched)} 件）')


def fill_missing_reviews(site_key):
    rows = gas_get_missing_reviews(site_key)
    if not rows:
        print('レビュー詳細欠損: 0 件')
        return
    print(f'レビュー詳細欠損: {len(rows)} 件')

    updated_count = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        items = []
        for row in batch:
            detail = fetch_review_detail(row['noLink'], row['no'])
            polite_sleep()
            if detail:
                items.append({'rowIndex': row['rowIndex'], 'no': row['no'], 'reviewDetail': detail})
        if items:
            result = gas_fill_review_batch(site_key, items)
            updated_count += result.get('updatedCount', 0)
        polite_sleep()

    print(f'レビュー詳細補完: {updated_count} 件')


def main():
    targets = sys.argv[1:] or list(SITE_CONFIGS.keys())
    for site_key in targets:
        if site_key not in SITE_CONFIGS:
            print(f'[SKIP] 不明なサイト: {site_key}')
            continue
        try:
            scrape_site(site_key)
        except Exception as e:
            print(f'[ERROR] {site_key}: {e}')
        polite_sleep()


if __name__ == '__main__':
    main()
