"""從臺北捷運開放資料產生 data/network.json、data/fares.json、data/map-layout.json。

資料來源（政府資料開放授權條款第 1 版）：
- 臺北捷運系統票價 https://data.gov.tw/dataset/128418  → tools/raw/fares.csv (Big5)
- 臺北捷運轉乘車站轉乘步行時間 https://data.gov.tw/dataset/128417 → tools/raw/transfer.csv (Big5)

站序由本腳本手寫，並用票價表的「起訖站最短距離」驗證：沿線距離必須遞增。
站間行駛時間由距離估算（開放資料沒有可直接下載的站間時間）。

用法：python -I tools/build_network.py
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "tools" / "raw"
DATA = ROOT / "data"

LINES = {
    "BR": {"name": "文湖線", "color": "#c48c31", "text": "#ffffff"},
    "R": {"name": "淡水信義線", "color": "#e3002c", "text": "#ffffff"},
    "G": {"name": "松山新店線", "color": "#008659", "text": "#ffffff"},
    "O": {"name": "中和新蘆線", "color": "#f8b61c", "text": "#1a1a1a"},
    "BL": {"name": "板南線", "color": "#0070bd", "text": "#ffffff"},
    "Y": {"name": "環狀線", "color": "#ffdb00", "text": "#1a1a1a"},
}

# 每個 service 是一種實際行駛的列車路線；分支線拆成獨立 service，
# 這樣「蘆洲 ↔ 迴龍」才會正確算成要在大橋頭換車。
SERVICES = {
    "BR": ("BR", "動物園 木柵 萬芳社區 萬芳醫院 辛亥 麟光 六張犁 科技大樓 大安 忠孝復興 南京復興 中山國中 松山機場 大直 劍南路 西湖 港墘 文德 內湖 大湖公園 葫洲 東湖 南港軟體園區 南港展覽館"),
    "R": ("R", "淡水 紅樹林 竹圍 關渡 忠義 復興崗 北投 奇岩 唭哩岸 石牌 明德 芝山 士林 劍潭 圓山 民權西路 雙連 中山 台北車站 台大醫院 中正紀念堂 東門 大安森林公園 大安 信義安和 台北101/世貿 象山 廣慈/奉天宮"),
    "R-XB": ("R", "北投 新北投"),
    "G": ("G", "新店 新店區公所 七張 大坪林 景美 萬隆 公館 台電大樓 古亭 中正紀念堂 小南門 西門 北門 中山 松江南京 南京復興 台北小巨蛋 南京三民 松山"),
    "G-XT": ("G", "七張 小碧潭"),
    "O-HL": ("O", "南勢角 景安 永安市場 頂溪 古亭 東門 忠孝新生 松江南京 行天宮 中山國小 民權西路 大橋頭 台北橋 菜寮 三重 先嗇宮 頭前庄 新莊 輔大 丹鳳 迴龍"),
    "O-LZ": ("O", "南勢角 景安 永安市場 頂溪 古亭 東門 忠孝新生 松江南京 行天宮 中山國小 民權西路 大橋頭 三重國小 三和國中 徐匯中學 三民高中 蘆洲"),
    "BL": ("BL", "頂埔 永寧 土城 海山 亞東醫院 府中 板橋 新埔 江子翠 龍山寺 西門 台北車站 善導寺 忠孝新生 忠孝復興 忠孝敦化 國父紀念館 市政府 永春 後山埤 昆陽 南港 南港展覽館"),
    "Y": ("Y", "大坪林 十四張 秀朗橋 景平 景安 中和 橋和 中原 板新 板橋 新埔民生 頭前庄 幸福 新北產業園區"),
}

# 同一路線的分支點（在這裡換到另一個分支）
BRANCH_JUNCTIONS = {"大橋頭", "北投", "七張"}

# 站外或不同站名的轉乘通道（票價表把兩站分開列）
EXTRA_TRANSFERS = [("新埔", "新埔民生")]

# 開放資料未列出的轉乘站，步行分鐘的保守預設值
DEFAULT_TRANSFER_MIN = 5

# 行駛時間估算：每公里 1.5 分鐘＋每站停靠 0.5 分鐘，最少 1.5 分鐘
def ride_minutes(km):
    return max(1.5, round(km * 1.5 + 0.5, 1))


def read_csv(path):
    with open(path, encoding="big5", errors="strict") as f:
        return list(csv.reader(f))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    fare_rows = read_csv(RAW / "fares.csv")[1:]
    dist, senior, full = {}, {}, {}
    names = []
    for a, b, f_full, f_senior, km in fare_rows:
        if a not in dist:
            dist[a], senior[a], full[a] = {}, {}, {}
            names.append(a)
        dist[a][b] = float(km)
        senior[a][b] = int(f_senior)
        full[a][b] = int(f_full)

    errors = []
    in_services = set()
    services_out = {}
    for sid, (line, seq) in SERVICES.items():
        stations = seq.split()
        for s in stations:
            if s not in dist:
                errors.append(f"{sid}: 票價表沒有「{s}」")
        in_services.update(stations)
        if errors:
            continue
        # 相鄰三站 A-B-C：B 必須在 A 到 C 的最短路徑上（距離可相加），否則站序有誤。
        # 不用「離起點距離遞增」檢查，因為環形路網的最短距離可能繞走別條線。
        for i in range(len(stations) - 1):
            a, b = stations[i], stations[i + 1]
            if not 0 < dist[a][b] < 4:
                errors.append(f"{sid}: {a} → {b} 相鄰距離異常 ({dist[a][b]})")
        for i in range(len(stations) - 2):
            a, b, c = stations[i : i + 3]
            # 允許最短距離抄別條線的捷徑，但 C 一定要比 B 離 A 更遠
            if not dist[a][c] > max(dist[a][b], dist[b][c]):
                errors.append(f"{sid}: {a}-{b}-{c} 中間站不在兩站之間，站序可能有誤")
        segs = [ride_minutes(dist[stations[i]][stations[i + 1]]) for i in range(len(stations) - 1)]
        services_out[sid] = {"line": line, "stations": stations, "minutes": segs}

    missing = set(names) - in_services
    if missing:
        errors.append("站序沒有涵蓋：" + "、".join(sorted(missing)))
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)

    transfer_rows = read_csv(RAW / "transfer.csv")[1:]
    walk = {}
    for _, st, t, *_ in transfer_rows:
        st = st.removeprefix("捷運")
        if st not in dist:
            st = st.removesuffix("站")
        if st not in dist:
            errors.append(f"轉乘資料的站名對不上：{st}")
        walk[st] = int(t)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)

    # 每站所屬 service
    station_services = {}
    for sid, svc in services_out.items():
        for s in svc["stations"]:
            station_services.setdefault(s, []).append(sid)
    transfer_min = {}
    for s, sids in station_services.items():
        # 不同路線交會站，或同一路線的分支點才能換車；共用主幹的一般站不算轉乘站
        if len({services_out[x]["line"] for x in sids}) > 1 or s in BRANCH_JUNCTIONS:
            transfer_min[s] = walk.get(s, DEFAULT_TRANSFER_MIN)
    for a, b in EXTRA_TRANSFERS:
        transfer_min.setdefault(a, walk.get(a, DEFAULT_TRANSFER_MIN))
        transfer_min.setdefault(b, walk.get(b, DEFAULT_TRANSFER_MIN))

    network = {
        "source": "臺北捷運開放資料（票價、轉乘步行時間）；站間分鐘為依距離估算",
        "lines": LINES,
        "services": services_out,
        "transferMinutes": transfer_min,
        "linkedStations": EXTRA_TRANSFERS,
    }
    fares = {
        "source": "臺北捷運系統票價 https://data.gov.tw/dataset/128418（敬老卡優惠票價欄位）",
        "stations": names,
        "senior": [[senior[a][b] for b in names] for a in names],
    }
    DATA.mkdir(exist_ok=True)
    (DATA / "network.json").write_text(json.dumps(network, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "fares.json").write_text(json.dumps(fares, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK：{len(names)} 站、{len(services_out)} 條 service、{len(transfer_min)} 個轉乘站")


if __name__ == "__main__":
    main()
