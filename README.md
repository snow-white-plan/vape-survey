# 電子煙防制衛教問卷

民眾用手機掃 QR Code 進入網頁 → 填基本資料 → 前測 → 看衛教影片 → 後測 → 活動回饋。

本文件寫給**接手維護的人**。不需要會寫程式，大部分維護工作只要改 Google 試算表就好。

---

## 目錄

1. [系統架構](#一系統架構)
2. [交接資源清單](#二交接資源清單)
3. [檔案結構](#三檔案結構)
4. [常見維護工作](#四常見維護工作)
5. [從零建置（全新部署時才需要）](#五從零建置全新部署時才需要)
6. [題目試算表欄位說明](#六題目試算表欄位說明)
7. [作答資料說明](#七作答資料說明)
8. [測試方式](#八測試方式)
9. [疑難排解](#九疑難排解)
10. [安全性](#十安全性)

---

## 一、系統架構

```
            ┌──────────────────────────┐
  民眾手機 ─▶│ GitHub Pages(問卷網頁)  │
            └────────┬─────────┬───────┘
          讀取題目 │         │ 送出作答
                     ▼         ▼
  ┌──────────────────────┐   ┌────────────────────────────┐
  │ 題目設定試算表(公開)  │   │ Apps Script 網頁應用程式     │
  │ 發佈成 4 個 CSV 網址   │   │ → 寫入作答試算表(不公開)    │
  └──────────────────────┘   └────────────────────────────┘
```

| 元件 | 放在哪 | 誰可以看 | 用途 |
|---|---|---|---|
| 問卷網頁 | GitHub Pages | 所有人 | 顯示問卷、播放影片、送出資料 |
| 題目設定試算表 | Google 雲端硬碟 | 所有人(已發佈到網路) | 管理題目、選項、文字、影片網址、場次 |
| 作答試算表 | Google 雲端硬碟 | 只有擁有者 | 存放作答結果 |
| Apps Script | 綁在作答試算表裡 | — | 接收網頁送來的資料並寫入作答試算表 |

**重點觀念**
- 網頁本身**沒有存任何題目**，每次打開都即時讀取題目試算表。所以改題目**不用動 GitHub**。
- 題目試算表讀不到時(例如 Google 暫時故障)，網頁會改用 `data/questions.fallback.json` 的備援題目。
- 民眾送出的資料會先存在手機裡，送成功才刪除；網路不穩時會自動重試，所以斷線不會遺失資料。

---

## 二、交接資源清單

> 交接時請把下表填好，並確認接手者有權限。

| 項目 | 網址 / 名稱 | 擁有者帳號 |
|---|---|---|
| 問卷網址(GitHub Pages) | `https://snow-white-plan.github.io/` | |
| GitHub repository | `https://github.com/snow-white-plan` | |
| 題目設定試算表 | 電子煙問卷-題目設定 | |
| 作答試算表 | 電子煙問卷-作答資料 | |
| Apps Script 專案 | 電子煙問卷-作答接收 | |
| Apps Script 部署網址(`/exec` 結尾) | 填在 `js/config.js` 的 `submitUrl` | |

**交接時要做的權限設定**
- GitHub：repo → Settings → Collaborators → 加入接手者。
- 兩份試算表：右上角「共用」→ 加入接手者為「編輯者」。
- Apps Script 以**擁有者帳號**身分執行。如果原擁有者的帳號會被停用，接手者必須在自己帳號重新建立作答試算表與 Apps Script(見[第五節](#五從零建置全新部署時才需要)步驟 2)，再更新 `submitUrl`。

---

## 三、檔案結構

| 路徑 | 用途 | 上傳到 GitHub |
|---|---|---|
| `index.html` | 問卷網頁入口 | ✅ 必要 |
| `css/style.css` | 網頁樣式 | ✅ 必要 |
| `js/config.js` | **唯一需要手動填寫的設定**(題目 CSV 網址、送出網址) | ✅ 必要 |
| `js/questions.js` | 讀取題目 | ✅ 必要 |
| `js/app.js` | 問卷主程式 | ✅ 必要 |
| `data/questions.fallback.json` | 備援題目 | ✅ 必要 |
| `media/video.mp4` | 衛教影片 | ✅ 必要 |
| `tools/qrcode.html` | QR Code 產生器 | ✅ 建議 |
| `README.md` | 本說明文件 | 可選 |
| `google-apps-script/Code.gs` | Apps Script 程式碼的備份 | 可選 |
| `sheet-templates/*.csv` | 題目設定試算表的範本 | 可選 |
| `tools/stress-test.js` | 上線前壓力測試(在自己電腦執行) | 不需要 |
| `電子煙問卷-題目設定.xlsx` | 題目試算表範本，上傳到 Google 雲端用 | ❌ 不要 |

> `index.html` 必須在 repo 的**最外層**，資料夾結構要維持原樣。

### `js/config.js` 設定

```js
window.SURVEY_CONFIG = {
  sheetCsv: {
    questions: "題目試算表 questions 分頁的 CSV 網址",
    options:   "options 分頁的 CSV 網址",
    settings:  "settings 分頁的 CSV 網址",
    sessions:  "sessions 分頁的 CSV 網址"
  },
  submitUrl: "Apps Script 部署網址(/exec 結尾)",
  fallbackUrl: "data/questions.fallback.json",
  defaultSession: "default",
  loadTimeoutMs: 8000
};
```

- `submitUrl` 留空 = 測試模式，資料只存在瀏覽器，不會送出。
- 要修改時，可直接在 GitHub 網頁上打開這個檔案 → 鉛筆圖示 → 編輯 → Commit changes，1~3 分鐘後生效。

---

## 四、常見維護工作

### 修改題目、選項、說明文字

1. 打開「題目設定試算表」直接修改。
2. **活動已經開始的話，把 `settings` 分頁的 `questions_version` 改成新版本**(例如 `2026-10-16-v1` → `2026-11-20-v2`)。作答資料會記錄版本，分析時才能分辨誰填的是哪一版。
3. 存檔後約等 **5 分鐘**(Google 發佈有快取)，用手機重新整理確認。
4. (建議)同步更新 `data/questions.fallback.json`，否則 Google 故障時會顯示舊題目。

⚠️ 注意事項
- **不要改已上線題目的 `id`**，否則新舊資料會變成兩個不同欄位。
- 要停用某題，把 `active` 改成 `FALSE`，不要刪除整列。
- 分頁名稱(`questions`、`options`、`settings`、`sessions`)和第一列標題**不能改**。

### 新增活動場次

1. 在 `sessions` 分頁新增一列：`code` 填英數代碼(例如 `school-a`)、`name` 填名稱、`active` 填 `TRUE`。
2. 打開 `https://帳號.github.io/repo名/tools/qrcode.html`，輸入場次代碼，產生該場次專用的 QR Code。
3. 民眾從這個 QR Code 進入，資料的 `session` 欄會記為 `school-a`。

場次結束後把 `active` 改為 `FALSE`，之後再用該 QR Code 進入會被記為 `default`(原始代碼仍會存在 `session_raw`)。

### 更換衛教影片

1. 將新影片命名為 `video.mp4`，在 GitHub 的 `media/` 資料夾上傳覆蓋(建議 H.264 編碼、1080p、25 MB 以內；GitHub 單檔上限 100 MB)。
2. 若檔名不同，修改 `settings` 分頁的 `video_url`。
3. 英文版影片、字幕(`.vtt`)、封面圖可另外填 `video_url_en`、`video_subtitle_zh/en`、`video_poster`。

影片必須完整播完才能進入下一步，播放時無法往後拖曳。

### 下載作答資料

1. 打開「作答試算表」，上方選單「**問卷工具 → 立即合併資料**」(平常每 10 分鐘也會自動合併)。
2. 切到 `merged` 分頁 →「檔案 → 下載 → CSV 或 Microsoft Excel」。

**分析請用 `merged` 分頁**(一人一列)；`raw` 是原始紀錄，請勿手動修改。

⚠️ `merged` 的**第 2 列是中文欄位說明**，資料從第 3 列開始。匯入 SPSS、R、Excel 樞紐分析前，請先刪除下載檔的第 2 列。

### 修改 Apps Script(Code.gs)

1. 作答試算表 →「擴充功能 → Apps Script」，修改後儲存。
2. **「部署 → 管理部署作業」→ 鉛筆圖示 → 版本選「新版本」→ 部署**。
3. ⚠️ 不要按「新增部署作業」，那會產生新網址，網頁就送不進來了。
4. 修改後同步更新 repo 裡的 `google-apps-script/Code.gs` 備份。

### 題目試算表換新的時候

`Code.gs` 最上方的 `QUESTIONS_CSV_URL`、`OPTIONS_CSV_URL` 用來讀取題目文字，以產生 `merged` 第 2 列的中文說明，要和 `js/config.js` 的 `questions`、`options` 網址一致。如果重建了題目試算表，兩邊都要更新。讀取失敗時，題目欄的說明會是空白，但資料合併不受影響。

---

## 五、從零建置(全新部署時才需要)

### 步驟 1：題目設定試算表

1. 把 `電子煙問卷-題目設定.xlsx` 上傳到 Google 雲端硬碟 → 右鍵「選擇開啟工具 → Google 試算表」→「**檔案 → 儲存為 Google 試算表**」(xlsx 格式不能發佈)。
   - 或：新增空白試算表，建立 `questions`、`options`、`settings`、`sessions` 四個分頁，分別「檔案 → 匯入」對應的 `sheet-templates/*.csv`，選「取代目前的工作表」。
2. 「檔案 → 共用 → 發佈到網路」：
   - 左邊選 `questions`，右邊選「逗號分隔值 (.csv)」
   - 「已發佈的內容與設定」保持「整份文件」，勾選「有變更時自動重新發佈」
   - 按「發佈」
3. 複製網址貼到 `js/config.js` 的 `sheetCsv.questions`。
4. 左邊下拉改選 `options`、`settings`、`sessions`，分別複製網址(不用再按發佈)。4 個網址只差在 `gid=` 的數字。
5. 把網址貼到瀏覽器測試，會下載 CSV 或顯示逗號分隔文字即為成功。

> 這份試算表是公開的，**只能放題目，絕對不要放作答資料**。

### 步驟 2：作答試算表與 Apps Script

1. 新增一份**空白** Google 試算表，命名「電子煙問卷-作答資料」。**不要發佈、不要開放「知道連結的人」檢視**。
2. 「擴充功能 → Apps Script」，專案命名「電子煙問卷-作答接收」，把 `google-apps-script/Code.gs` 全部內容貼上並儲存。
3. 上方函式選單選 `setup` → 執行 → 授權。
   - 出現「Google 尚未驗證這個應用程式」時，按「進階 → 前往(不安全)」，這是你自己的程式所以沒問題。
   - 執行後會自動建立 `raw`、`merged` 分頁，以及每 10 分鐘自動合併的排程。
4. 「部署 → 新增部署作業」→ 齒輪選「網頁應用程式」：
   - 執行身分：**我**
   - 誰可以存取：**任何人**
5. 複製「網頁應用程式」網址(`/exec` 結尾)，貼到 `js/config.js` 的 `submitUrl`。

### 步驟 3：GitHub Pages

1. 在 GitHub 建立 **Public** repository(免費方案的 Pages 需要 public；網頁沒有任何金鑰，公開是安全的)。
2. 「Add file → Upload files」，依[第三節](#三檔案結構)表格上傳檔案，保留資料夾結構。
3. Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`、`/ (root)` → Save。
4. 1~3 分鐘後網址為 `https://帳號.github.io/repo名/`。
5. 打開 `https://帳號.github.io/repo名/tools/qrcode.html` 產生 QR Code。

### 步驟 4：上線前檢查

依[第八節](#八測試方式)完成測試。

---

## 六、題目試算表欄位說明

### questions(題目)

| 欄位 | 說明 |
|---|---|
| `id` | 題號，也是資料欄名。只能用英數字與底線，英文字母開頭。**上線後不要改** |
| `page` | 出現在哪一頁：`1` 基本資料、`2` 前測、`4` 後測補充題、`5` 活動回饋(第 3 頁是影片) |
| `prepost` | `TRUE` = 前後測共用題，會同時出現在第 2 頁(欄名加 `_pre`)與第 4 頁(欄名加 `_post`) |
| `type` | `single` 單選、`number` 數字、`text` 文字、`heading` 段落標題(第二行起為說明文字) |
| `option_set` | 單選題使用的選項組，對應 options 的 `set`；名稱以 `likert` 開頭的會顯示成 1~5 彩色量尺 |
| `required` | `TRUE` 必填 |
| `min` / `max` | 數字題範圍 |
| `zh_text` / `en_text` | 題目文字 |
| `hint_zh` / `hint_en` | 題目下方的補充說明 |
| `unit_zh` / `unit_en` | 數字題輸入框後的單位(例如「歲」) |
| `correct_answer` | 正確答案(填選項的 `value`) |
| `reveal` | `TRUE` = 後測完成後顯示解答 |
| `explain_zh` / `explain_en` | 解答說明 |
| `order` | 同頁排序(數字小的在前) |
| `active` | `FALSE` = 隱藏此題 |

### options(選項)

| 欄位 | 說明 |
|---|---|
| `set` | 選項組名稱 |
| `value` | 存入資料的代碼。**上線後不要改** |
| `zh_label` / `en_label` | 顯示文字 |
| `order` | 排序 |
| `has_other` | `TRUE` = 選此項時出現「其他」文字框(欄名為 `題號_other`) |

### settings(網頁設定)

| 欄位 | 說明 |
|---|---|
| `questions_version` | 題目版本，**改題目時要更新** |
| `pageN_title_zh/en`、`pageN_intro_zh/en` | 各頁標題與說明 |
| `consent_zh/en` | 第一頁的同意說明 |
| `completion_zh/en` | 完成畫面文字 |
| `video_url`、`video_url_en` | 影片路徑(英文版可另填) |
| `video_subtitle_zh/en` | 字幕 `.vtt` 路徑 |
| `video_poster` | 影片封面圖 |

### sessions(場次)

| 欄位 | 說明 |
|---|---|
| `code` | 場次代碼，用在網址 `?s=代碼` |
| `name` | 場次名稱(方便辨識用) |
| `active` | `TRUE` 啟用 |

---

## 七、作答資料說明

### 分頁

- `raw`：每次送出一列(前測、後測、回饋各一次)，只新增不修改。
- `merged`：依匿名配對碼合併成一人一列，**分析與匯出請用此分頁**。每次合併都會整份重建，手動修改會被覆蓋。
  - 第 1 列：欄位名稱
  - 第 2 列：中文說明(題目文字、前測或後測、選項代碼、正確答案)，從題目設定試算表自動產生
  - 第 3 列起：作答資料

### 主要欄位

依 `merged` 分頁由左到右的順序：

| 欄位 | 說明 |
|---|---|
| `completed_at` | 活動回饋送出時間(伺服器時間)；空白代表沒有填完 |
| `session` / `session_raw` | 場次 / 網址上的原始場次參數 |
| `lang` | 作答語言 `zh` / `en` |
| `questions_version` | 作答時的題目版本 |
| `consent` | 同意參加(`1` = 已勾選) |
| `A1`~`A5`、`B1` | 基本資料 |
| `K1_pre`、`H1_pre`~`H5_pre` | 前測 |
| `pre_duration` | 前測作答時長(秒) |
| `video_completed` | 是否看完影片 |
| `K1_post`、`H1_post`~`H5_post`、`S1` | 後測 |
| `post_duration` | 後測作答時長(秒) |
| `F1` | 活動回饋 |
| `pre_submitted_at`、`post_submitted_at` | 前測、後測送出時間(伺服器時間) |
| `pair_id` | 匿名配對碼(同一支手機的前測、後測、回饋會是同一個) |
| `user_agent` | 填答裝置與瀏覽器資訊 |

> 修改 `merged` 欄位順序：調整 `Code.gs` 最上方的 `LEADING_COLUMNS`(最前面的欄位)與 `TRAILING_COLUMNS`(最後面的欄位)，題目欄位會自動排在中間。

### 選項代碼

- A4 / A5：`9` = 不願回答
- K1：`T` 對、`F` 錯、`DK` 不知道
- H 題：1~5(**H4 為反向題，分析時請反轉計分**)
- S1：4 非常有幫助 ~ 1 沒有幫助

---

## 八、測試方式

### 本機測試

VS Code 安裝 Live Server 擴充套件，在 `index.html` 按右鍵「Open with Live Server」。

### 網址參數

| 參數 | 效果 |
|---|---|
| `?s=demo-booth` | 指定場次 |
| `?lang=en` / `?lang=zh` | 直接進入英文 / 中文(優先於手機記住的語言) |
| `?s=demo-booth&lang=en` | 可同時使用 |

畫面右上角也可以隨時切換語言。

### 重複填寫測試

手機填完後會記住「已完成」，再開只會看到完成畫面。要重填請用**無痕視窗**，或清除瀏覽器的網站資料。

### 上線前檢查清單

- [ ] 4 個 CSV 網址貼到瀏覽器都能打開
- [ ] 用手機完整填一次(LINE 掃描器、相機各一次)，確認 `raw` 有 3 列、`merged` 有完整一列
- [ ] 英文版 `?lang=en` 也測一次
- [ ] 影片可以正常播放
- [ ] (選擇性)壓力測試：`node tools/stress-test.js <submitUrl> 100`，完成後到 `raw` 篩選 `session = stress-test` 刪除測試列，再執行一次合併
- [ ] 20~30 人預試後再調整題目文字

---

## 九、疑難排解

| 狀況 | 可能原因與解法 |
|---|---|
| 網頁顯示「問卷載入失敗」 | 題目 CSV 網址與備援 JSON 都讀不到。檢查 `js/config.js` 網址是否正確、試算表是否仍為「發佈到網路」狀態 |
| 改了題目但網頁沒變 | Google 發佈有約 5 分鐘快取，稍候再重新整理 |
| 網頁顯示舊題目 | 可能讀到備援題目，表示 CSV 網址讀取失敗，檢查發佈狀態 |
| 畫面顯示「連線不穩，自動重試中」 | 送不進 Apps Script。檢查 `submitUrl` 是否正確、部署存取權是否為「任何人」 |
| 打開 Apps Script 網址出現「Sorry, unable to open the file at this time」 | 瀏覽器同時登入多個 Google 帳號。改用無痕視窗測試；出現 `Script function not found: doGet` 是正常的(此程式只接收送出資料) |
| 部署時沒有「任何人」選項 | 公司 / 學校帳號被組織政策限制。改用個人 Gmail 帳號，或請 IT 開放 |
| 修改 Code.gs 後網頁送不進來 | 可能按了「新增部署作業」導致網址改變。改用「管理部署作業 → 編輯 → 新版本」，或把新網址更新到 `submitUrl` |
| `merged` 沒有更新 | 手動執行「問卷工具 → 立即合併資料」；若排程消失，執行「問卷工具 → 初始化」重建 |
| 試算表選單沒有「問卷工具」 | 重新整理試算表頁面 |
| GitHub Pages 網址 404 | 確認 Pages 已啟用、`index.html` 在 repo 最外層，等 1~3 分鐘 |
| 影片無法播放 | 確認 `media/video.mp4` 已上傳，且 `settings` 的 `video_url` 路徑一致；影片需為 H.264 編碼 |

---

## 十、安全性

- 前端沒有任何金鑰；公開的只有題目 CSV 網址與 Apps Script 送出網址。
- 送出網址只能「新增一列」，無法讀取或修改作答資料。
- 後端會檢查欄位格式與長度，並防止試算表公式注入；隱藏的 honeypot 欄位可擋掉部分機器人。
- 填答完成後，手機只保留「已完成」標記，不保留作答內容。
- **作答試算表絕對不要發佈或開放連結檢視。**
