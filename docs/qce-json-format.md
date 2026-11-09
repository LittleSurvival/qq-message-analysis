# QQ Chat Exporter JSON 模式研究

研究日期：2026-11-08。對照上游原始碼及本專案既有匯出檔；未複製上游實作。

## 來源

- [JSON exporter](https://github.com/shuakami/qq-chat-exporter/blob/master/qq-chat-export-core/src/json_exporter.rs)：`JsonExportMode`、單檔與分塊流程、metadata、chatInfo、statistics、exportOptions、avatars 與資源路徑處理。
- [訊息 parser](https://github.com/shuakami/qq-chat-exporter/blob/master/qq-chat-export-server/src/parser/simple_parser.rs)：QQ 元素轉換及圖片 `subType`。
- [HTML renderer](https://github.com/shuakami/qq-chat-exporter/blob/master/qq-chat-export-core/src/modern_html_exporter.rs)：`image.data.subType == sticker` 的貼圖渲染。
- [Web Streams / Blob.stream](https://developer.mozilla.org/en-US/docs/Web/API/Blob/stream)：本地 File 串流讀取，也可於 Worker 使用。
- [streamparser/json](https://github.com/juanjoDiaz/streamparser-json/tree/main/packages/plainjs)：選擇性串流 JSON 解析。
- [GitHub Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)：靜態建置與部署。

## 兩種下載輸出模式

1. **SingleJson（預設）**：一個 JSON 物件，包含 `metadata`、`chatInfo`、`statistics`、`messages`，可帶 `avatars` 與 `exportOptions`。目前上游採先寫 NDJSON 暫存、再串流組成最終 JSON 的流程，避免導出時全量常駐記憶體。
2. **ChunkedJsonl**：`manifest.json` + `chunks/cNNNNNN.jsonl`，可附 `avatars.json`。預設單塊上限為 50,000 則或 50 MiB，先到者分塊。manifest 只含索引與統計，沒有 messages 陣列。

本網站完整支援單檔 JSON，JSONL 支援單一分塊分析；尚未實作 manifest 整包合併與 ZIP 解壓。

## 訊息結構

```json
{
  "id": "message-id",
  "seq": "sequence",
  "timestamp": 1794067200000,
  "time": "formatted time",
  "sender": { "uid": "stable-id", "uin": "qq-number", "name": "display-name", "nickname": "nickname" },
  "type": "text",
  "content": {
    "text": "plain preview",
    "html": "rendered preview",
    "elements": [{ "type": "image", "data": { "subType": "sticker" } }],
    "resources": [],
    "mentions": []
  },
  "recalled": false,
  "system": false
}
```

`timestamp` 為毫秒 Unix time；分析器亦接受秒級 timestamp，但不猜測無時區的 `time` 字串。資料格式可能隨上游版本改變，未知元素保留在「其他」並顯示無效筆數。

最外層 `type=text` **不代表純文字**：實際資料中包含大量 image 元素；若只統計此欄位會漏掉圖片和表情包。`reply` 可與文字、圖片、at 並存。分類必須掃描 `content.elements`。

| 元素 | 含義與計數 |
| --- | --- |
| text | 文字，以 data.text 計 Unicode code point 數 |
| image + subType=photo 或無標記 | 一般圖片 |
| image + subType=sticker | 自訂表情包 |
| market_face | 商城表情包 |
| face | QQ 小表情，不與貼圖混為一談 |
| file | 檔案；使用 filename / size，不重複累計 resources |
| audio / video | 語音／影片 |
| reply / at | 回覆／提及；不展開預覽 |
| forward | 合併轉發；不將內層 messages 加入聊天總量 |
| json | 分享卡片，不解讀內嵌程式或連結 |
| system | 系統事件，預設排除 |

JSON 可以引用遠端資源、相對檔案與內嵌頭像。分析不需要下載這些內容；網站只渲染 avatars 中有效的內嵌 PNG／JPEG／GIF／WebP 頭像，不讀取外部網址或相對資源。`statistics` 用於比對實際讀取筆數，所有圖表由 messages 重算。

## 內嵌頭像

QCE `embed_avatars_as_base64` 預設關閉。開啟後，單檔 JSON 的 `avatars` 是以發言者 QQ 號碼（`sender.uin`）為鍵的 data URL 對照表，例如 `"avatars": {"123456": "data:image/jpeg;base64,..."}`。

本網站串流讀取每筆頭像，利用訊息中的 uid／uin 關係對應成員，不以暱稱猜配；也接受以成員 uid 為鍵的內嵌表。頭像可位於 messages 前後。資料缺失、內容無法解碼或單張編碼超過 2 MiB 時，顯示文字圖示。匿名模式及匿名 JSON／HTML／個人 PDF 不帶頭像。

單獨 JSONL 分塊沒有這張表時維持文字圖示；目前不自動讀取旁邊的 avatars.json。
