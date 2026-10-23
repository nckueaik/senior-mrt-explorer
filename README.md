# 捷運迷霧探險

給長輩用的手機網頁：用新北市敬老卡搭北捷出門走走。每次抽一個捷運站，照著大字轉乘卡片前往，到站後分段揭曉景點，最後附上景點介紹與平價美食，完成後在地圖上撥開迷霧。

## 功能
- 抽站：先選近程（單程 40 分鐘內）或遠程（40～90 分鐘），可以只抽室內景點。已去過的站、前 5 個到訪站及它們任何路線上的前後一站、當天休館的景點都不會抽到；抽不到時會自動放寬。每次最多換 2 次。
- 轉乘：最少轉乘優先，標出路線顏色、月台方向、站數、換車站與轉乘步行時間；附 Google 地圖備援。
- 分段揭曉：抽中 →「我到站了」→「我到了」。
- 敬老卡扣點估算（北捷票價表的敬老優惠票價），並顯示本月小計。
- 唸給我聽、一鍵打給家人、回家路線、用 LINE 報平安或回報店家沒開。
- 迷霧路線示意圖、徽章、里程碑。
- 紀錄存在手機（可以離線）；用 LINE 傳備份連結，換手機或第二支手機都能還原。
- 家人模式（4 位數密碼）：設定、查看答案、修正紀錄。

## 本機執行
```bash
python -m http.server 8765 --directory .
```
開啟 http://localhost:8765/ ；單元測試在 http://localhost:8765/tests/ 。

## 資料
| 檔案 | 來源與產生方式 |
| --- | --- |
| `data/network.json`、`data/fares.json` | `python -I tools/build_network.py`。來源為[臺北捷運系統票價](https://data.gov.tw/dataset/128418)與[轉乘步行時間](https://data.gov.tw/dataset/128417)（政府資料開放授權條款第 1 版）。站序為手寫，並用票價表距離驗證；站間分鐘依距離估算。 |
| `data/map-layout.json` | 手繪示意圖座標（不是北捷官方路線圖）。 |
| `data/spots.json` | 景點與美食內容，目前是第一批 10 站**草稿**。 |
| `img/` | `python -I tools/fetch_images.py --download`，來自維基共享資源的開放授權圖片，作者與授權記在 `spots.json`。 |
| `docs/content-review.md` | `python -I tools/build_review.py` 產生的核對清單。 |

## 更新內容
1. 修改 `data/spots.json`，核對完的站把 `draft` 改成 `false`。
2. 重新產生核對清單：`python -I tools/build_review.py`。
3. 把 `sw.js` 裡的 `CACHE` 版本號加 1，手機才會下載新資料。
