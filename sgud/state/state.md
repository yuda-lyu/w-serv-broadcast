# 現況(state)

本檔記當前已開發功能之最新狀態(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本),只記現況、不寫過程(過程見 `sgud/exp/experience.md`);藍圖見 `sgud/rule/rulebook.md`.

- 更新:2026-10-23(主控任務 20261023213314 之 broadcast-run01).
- 套件版本:`package.json` 為 1.1.10;本輪變更**尚未發布**,版號由主控決定(新增兩個選項,相容).
- 最近一次驗證:2026-10-23 `npm test`(`mocha --parallel "test/*.test.mjs" --timeout 180000`)127 passing(既有 85 + 本輪新增 42);eslint 對本輪改動檔 0 error;w-serv-webdata 之 9 檔測試對修前/修後各跑一次皆 155 passing(複本,未動該 repo).

## 功能現況

| 功能 | 狀態 | 規則帳本 | 測試 |
|---|---|---|---|
| 伺服端廣播、佇列、在線偵測(clientEnter/clientLeave/clientChange) | 完成 | R01、R03、R07 | `unit-server-*`、`api-broadcast-polling`、`broadcast` |
| 前端輪詢、openOnce/open/broadcast/error | 完成 | R01、R02、R05、R06 | `unit-client-*`、`api-broadcast-polling` |
| 停止為終態且冪等;停止後不派發 | 完成 | R01、R07 | `unit-server-clear`、`unit-client-clear` |
| 協定邊界雙向驗證(回應形狀、clientId) | 完成 | R02 | `unit-client-response`、`unit-server-polling-input` |
| 建構先驗後配 | 完成 | R04 | `unit-*-construct` |
| 停止時中止在途之輪詢請求(opt.signal) | 完成 | R10 | `unit-client-abort*`、`api-broadcast-polling`(api client stop) |
| error 事件 `{ msg, err }` 與監聽器拋錯隔離 | 完成 | R01 | `unit-listener-error` |
| **輪詢之身分驗證鉤子**:伺服端 `opt.verifyPolling`、前端 `opt.getToken`、固定鍵 `__sysToken__` | **完成(2026-10-23,待發布)** | **R11**、R04 | `unit-server-verify-polling`(28)、`unit-client-get-token`(11)、`api-broadcast-verify-polling`(3,埠 8098) |

## 已知缺口(皆為刻意不修或範圍外,詳見規則帳本第 2 節)

- L1 通訊物件不支援 opt.signal 時,停止後其請求照常完成或重試.
- L3 傳遞為至多一次.
- L9 鉤子不內建逾時;L10 拒絕不限流;L11 未注入 verifyPolling 時預設放行(JSDoc 與 README 已載風險).
- 未注入時不剝除輪詢輸入中的 `__sysToken__`(〈不得改變〉相容,R11 刻意不套①);若要恆剝除須主控裁示.

## 待辦與下游

- T1 前端「連線→未連線」反向事件(日後另案).T2 既有測試檔內重複之 delay/poll 可收斂.
- **下游必做(L12)**:w-serv-webdata 之資料通道(`src/WServWebdataServerExec.mjs:264-285` 之 `execFun`)對 `[sys:polling]` 會同步回 `invalid token`/`invalid input`;本套件提供鉤子後回覆為非同步,該通道會先結算而使輪詢失敗,故改 w-serv-webdata 時須讓其略過 `[sys:polling]`.
- 下游:w-serv-webdata 須注入 `verifyPolling`(以其 `getUserIdByToken` 判斷)並由其前端提供 `getToken`;本套件發布後才改 w-serv-webdata(建議檔「三、後續」).自有套件庫內唯一使用端為 w-serv-webdata(`new WServBroadcastServer(inst)` / `new WServBroadcastClient(inst)` 皆不帶 opt,新增選項不影響其現行用法).
