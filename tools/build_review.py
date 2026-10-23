"""從 data/spots.json 產生 docs/content-review.md（給家人逐站核對的清單）。

用法：python -I tools/build_review.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.loads((ROOT / "data" / "spots.json").read_text(encoding="utf-8"))
    out = [
        "# 內容核對清單",
        "",
        f"資料整理於 {data['checkedAt']}。每一站核對完，把 `data/spots.json` 裡該站的 `draft` 改成 `false`，再重新產生這份清單。",
        "",
        "核對方式：打電話、看官網，或實地走一趟。改了內容請同步修改 `data/spots.json`。",
        "",
    ]
    for st, d in data["stations"].items():
        mark = "草稿" if d.get("draft") else "已核對"
        out += [f"## {st} 站（{mark}）", "", f"- [ ] 謎題提示：{d['hint']}"]
        for s in d["spots"]:
            out += [
                f"- [ ] 景點：{s['name']}",
                f"  - [ ] 出口：{s['exit']}；電梯：{s['elevator'] or '待核對'}；步行約 {s['walkMin']} 分鐘（上限 10 分鐘）",
                f"  - [ ] 走法：{s['route']}",
                f"  - [ ] 路況：{s.get('access') or '待核對'}；廁所：{s.get('toilet') or '待核對'}",
                f"  - [ ] 開放時間：{s.get('hours') or '待核對'}；休館日（0=週日、1=週一）：{s['closedDays'] or '無'}",
                f"  - [ ] 費用：{s['fee']}（長輩優惠後 100 元內）",
                f"  - [ ] 室內／半室內／戶外：{s['setting']}",
            ]
            for v in s.get("verify", []):
                out.append(f"  - [ ] 特別確認：{v}")
            for src in s.get("sources", []):
                out.append(f"  - 參考：{src}")
        for f in d["foods"]:
            out += [
                f"- [ ] 美食：{f['name']}（{f['price']}）",
                f"  - [ ] 地點：{f['where']}；營業：{f['hours']}；公休：{f['closed'] or '待核對'}；電話：{f['phone'] or '待核對'}",
                "  - [ ] 有座位、適合長輩、每人 200 元內、步行 10 分鐘內",
                f"  - [ ] Google 地圖搜尋「{f['mapQuery']}」找得到正確的店" if f.get("mapQuery") else "  - [ ] 補上 mapQuery（Google 地圖搜尋字串）",
            ]
            for src in f.get("sources", []):
                out.append(f"  - 參考：{src}")
        out.append("")
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "content-review.md").write_text("\n".join(out), encoding="utf-8")
    print(f"OK：{len(data['stations'])} 站")


if __name__ == "__main__":
    main()
