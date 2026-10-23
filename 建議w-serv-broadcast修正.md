# 建議 w-serv-broadcast 修正:輪詢(`[sys:polling]`)提供身分驗證鉤子

- 提出:全自有套件之主控(opensrcOper),2026-10-23;任務 `C:\opensrcOper\dnow\20261023213314`.
- 依據:跨套件原則 `C:\opensrcOper\dspec\使用者身分驗證原則.md`(框架不驗證 token,只呼叫使用方注入之函數;系統函數會回資料或改狀態者須身分);w-serv-webdata 審計報告 `C:\opensrcOper\dnow\20261023213314\agent-out\webdata-inv01-審計報告.md`(第三節、第四節 4.8、第六節 Q2).

## 一、問題(審計已實證)

- `[sys:polling]` 之處理函數在本套件 `src/WServBroadcastServer.mjs` 約 118-157 行:回傳該 clientId 佇列內之廣播(含同步表時間戳與部署方 `broadcast()` 內容),並建立/刷新在線身分(觸發 `clientEnter`/`clientLeave`/`clientChange`)、建立佇列.
- 輪詢只經通訊層 `verifyConn`,**不經任何身分反查**;實測匿名者(無 token)以新 clientId 輪詢即可收到其後之全部廣播,2000 個 clientId 各輪詢一次即建立 2000 個在線身分與佇列.

## 二、期望行為(主控裁定 Q2 採 2c:在本套件加正式之驗證鉤子,不由 w-serv-webdata 取出本套件之監聽)

1. **伺服端**:新增選項(名稱由你定,例 `verifyPolling`),由使用端(w-serv-webdata)注入;每次輪詢於**任何副作用之前**(建立佇列、在線身分、取出訊息)呼叫,傳入輪詢之輸入(含 clientId 與使用端放入之身分資訊);回傳嚴格 true 才放行,其他值、拋錯或 reject 一律拒絕(回固定之拒絕訊息,不建立任何狀態),並發 error 事件供稽核.未注入時維持現行行為(相容).
2. **前端**:輪詢之輸入可帶使用端提供之 token(例:新增 `getToken` 選項,sync/async 皆可),放於輸入之固定鍵;伺服端放行後、交使用端監聽(`clientEnter` 等)之前剝除該 token,避免 token 進入事件資料.
3. 文件:JSDoc 寫明「本套件不驗證身分,輪詢之身分由使用端注入之鉤子驗證;未注入時任何能通過通訊層者皆可輪詢」,並引用跨套件原則之標準註解(框架套件版).

## 三、後續

- w-serv-webdata 將注入此鉤子(以其 `getUserIdByToken` 判斷,並依其 `sysFuncsPublic` 設定決定空身分是否放行),並由其前端提供 token;本套件發布後才改 w-serv-webdata.
