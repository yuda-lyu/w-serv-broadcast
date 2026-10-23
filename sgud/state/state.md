# 現況(state)

本檔記當前已開發功能之最新狀態(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本),只記現況、不寫過程(過程見 `sgud/exp/experience.md`);藍圖見 `sgud/rule/rulebook.md`.

- 更新:2026-10-24(主控任務 20261023213314 之 broadcast-run03,承 run01、run02).
- 套件版本:`package.json` 為 1.1.11(已發布:輪詢驗證鉤子、前端 getToken、未注入時亦剝除 `__sysToken__`);**broadcast-run03 之變更(R12)尚未發布**,版號由主控決定(相容).
- 最近一次驗證:2026-10-24(broadcast-run03)`npm test`(`mocha --parallel "test/*.test.mjs" --timeout 180000`)連跑 3 次皆 145 passing(131 + 新增 14);eslint 對改動檔 0 error;新測試對變異版 M1(=修前)連 3 次 7 條紅.broadcast-run02 時 w-serv-webdata 之 9 檔測試(複本,未動該 repo;其以未提供鉤子之方式使用本套件)對現行碼 155 passing(run03 未重跑,該 repo 不在範圍).

## 功能現況

| 功能 | 狀態 | 規則帳本 | 測試 |
|---|---|---|---|
| 伺服端廣播、佇列、在線偵測(clientEnter/clientLeave/clientChange) | 完成 | R01、R03、R07 | `unit-server-*`、`api-broadcast-polling`、`broadcast` |
| **離線時先清該 clientId 之佇列,才發 clientLeave/clientChange**(clientLeave 發出時佇列已清空,其後同 clientId 輪詢得新空佇列) | **完成(2026-10-24,待發布)** | **R12**、R07 | `unit-server-leave-queue`(14,含真實時間約 13 秒) |
| 前端輪詢、openOnce/open/broadcast/error | 完成 | R01、R02、R05、R06 | `unit-client-*`、`api-broadcast-polling` |
| 停止為終態且冪等;停止後不派發 | 完成 | R01、R07 | `unit-server-clear`、`unit-client-clear` |
| 協定邊界雙向驗證(回應形狀、clientId) | 完成 | R02 | `unit-client-response`、`unit-server-polling-input` |
| 建構先驗後配 | 完成 | R04 | `unit-*-construct` |
| 停止時中止在途之輪詢請求(opt.signal) | 完成 | R10 | `unit-client-abort*`、`api-broadcast-polling`(api client stop) |
| error 事件 `{ msg, err }` 與監聽器拋錯隔離 | 完成 | R01 | `unit-listener-error` |
| **輪詢之身分驗證鉤子**:伺服端 `opt.verifyPolling`、前端 `opt.getToken`、固定鍵 `__sysToken__` | **完成(2026-10-23,待發布)** | **R11**、R04 | `unit-server-verify-polling`(31)、`unit-client-get-token`(11)、`api-broadcast-verify-polling`(4,埠 8098) |

## 已知缺口(皆為刻意不修或範圍外,詳見規則帳本第 2 節)

- L1 通訊物件不支援 opt.signal 時,停止後其請求照常完成或重試.
- L3 傳遞為至多一次.
- L9 鉤子不內建逾時;L10 拒絕不限流;L11 未注入 verifyPolling 時預設放行(JSDoc 與 README 已載風險).
- L13(broadcast-run03 外審 sol#2 提出,既有,待裁示)鉤子結算慢於 10 秒在線逾時時,放行結果於結算時才生效、取用當時之佇列;若期間 clientId 已被他人重新綁定並累積佇列,舊驗證之輪詢會取走該佇列.根除需讓每次驗證綁定在線代次(涉及鉤子行為),本輪不動;JSDoc 與 README 已載.
- (已解決,broadcast-run02,主控 2026-10-24 裁定)輪詢輸入中的 `__sysToken__` 一律剝除,不論是否提供鉤子:含該鍵者取副本去鍵後交付、不改動原物件;不含該鍵者原物件交付(R11-4).

## 待辦與下游

- 下游(broadcast-run03,R12):w-serv-webdata 主責 agent 實測(`webdata-run01-修正報告.md` L22 ③)之「離線後 `clientLeave` 先發出、佇列後刪,約 1 秒內他人以同一 clientId 重新綁定可取得遺留廣播」已由本套件 R12 處理(待發布);w-serv-webdata 端不必改,升版後即生效.

- T1 前端「連線→未連線」反向事件(日後另案).T2 既有測試檔內重複之 delay/poll 可收斂.
- **下游必做(L12)**:w-serv-webdata 之資料通道(`src/WServWebdataServerExec.mjs:264-285` 之 `execFun`)對 `[sys:polling]` 會同步回 `invalid token`/`invalid input`;本套件提供鉤子後回覆為非同步,該通道會先結算而使輪詢失敗,故改 w-serv-webdata 時須讓其略過 `[sys:polling]`.
- 下游:w-serv-webdata 須注入 `verifyPolling`(以其 `getUserIdByToken` 判斷)並由其前端提供 `getToken`;本套件發布後才改 w-serv-webdata(建議檔「三、後續」).自有套件庫內唯一使用端為 w-serv-webdata(`new WServBroadcastServer(inst)` / `new WServBroadcastClient(inst)` 皆不帶 opt,新增選項不影響其現行用法).
