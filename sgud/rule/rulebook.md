# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

- 建立:2026-10-13(run01 審計,設計階段);更新:2026-10-13(run02 依主控裁決 `C:\opensrcOper\dnow\20261013135951\review\run01-複審.md` 實作);2026-10-13 夜(主控任務 20261013214634 之 run02,依裁決 `C:\opensrcOper\dnow\20261013214634\review\run01-複審.md` 實作 T3:R10、R01 範圍限制、R04、L1、L7、L8);2026-10-23(主控任務 20261023213314 之 broadcast-run01,輪詢身分驗證鉤子:新增 R11、L9–L11,R01–R10 站點行號依此次實作重編).站點行號為最近一次實作後之工作樹(提交前).矩陣格號見 `tmp/輪詢協定與停止-全盤.md`(M1–M12)與 `tmp/run03-中止在途輪詢-全盤.md`(停止時點 S0–S13 × 輸出 O1–O9).
- 站點判準三種:已套/未套/刻意不套(附理由).簡稱:`Cl`=`src/WServBroadcastClient.mjs`、`Sv`=`src/WServBroadcastServer.mjs`、`Ge`=`src/genEeEmit.mjs`.

## 1. 規則

### R01 派發之單一擁有者與停止閘門

- 規則:本套件之事件一律經 `Ge` 派發(脫勾 1ms、監聽器拋錯隔離、error 為 `{msg,err}`);停止後(含停止前已排定、停止時在途之輪詢結果)不再派發本套件之事件,於派發當下判斷;唯伺服端停止時之補發(clientLeave/clientChange)走 `eeEmit.final`;停止後之監聽器拋錯通報(含補發事件之監聽器)一律 console.error;本套件自發之 error 於派發當下無 error 監聽者時 console.error.
- 盤點:`grep -n "eeEmit(\|eeEmit.final(\|ev.emit(" src/*.mjs`
- 站點:經 eeEmit——`Cl:137`(error,唯一出口,failPolling 內)、`:200` openOnce、`:205` open、`:213` broadcast;`Sv:125` clientEnter、`:132` clientLeave、`:134` clientChange、`:177` error(failPoll)、`:230` error(拒絕,R11)、`:249` error(放行後回覆再失敗之保底,R11);補發 `Sv:309`、`:310`(final);原生 emit 只在 `Ge:55`、`:74`(唯一擁有者).停止判斷:`Ge:51`、`:59`、`:84`;前端在途結果早退 `Cl:187`、`:222`(含中止所致之拒絕,R10)、`Cl:157`(getToken 期間停止,R11);伺服端驗證結算後之停止判斷 `Sv:224`、`:242`(R11).全部已套.(2026-10-23 broadcast-run01 後之行號.)
- 範圍限制(刻意):通訊物件自身之事件不在本規則內(其他呼叫之 error 於停止後照常);本套件輪詢之請求、重試與其 error 由 R10 中止(通訊物件須支援 opt.signal,不支援者見 L1);呼叫當下那次派發之其餘監聽器仍會收到(含於通訊物件之 error 監聽器內停止者;與 DOM 相同,不包裝監聽器).(原載「通訊物件自身之事件與重試不在本規則內(裁決 Q8)」,2026-10-13 依 w-converhp 2.1.8 之 opt.signal 改寫.)
- 測試:`test/unit-client-clear.test.mjs`、`test/unit-server-clear.test.mjs`(新增各案)、`test/unit-listener-error.test.mjs`(拋錯隔離、Q2)、`test/api-broadcast-polling.test.mjs`(在途停止).

### R02 協定邊界雙向驗證

- 規則:前端驗回應——須為陣列且元素皆為具字串 mode 之物件,否則整包以輪詢失敗通知(err 為回應原值),不發 openOnce/open;只派 mode 為 broadcast 者,其他 mode 略過(向前相容).伺服端驗請求——clientId 須為非空字串,否則只 `pm.reject('[sys:polling] invalid clientId')`,不發事件、不寫佇列、不交給在線偵測.
- 盤點:`grep -n "isValidRes\|invalid clientId" src/*.mjs`
- 站點:`Cl:111-113`、`:192`、`:212`(已套);`Sv:206-211`(已套;clientId 檢查先於 R11 之鉤子:不合者不呼叫鉤子、不發 error).
- 測試:`test/unit-client-response.test.mjs`、`test/unit-server-polling-input.test.mjs`、`test/api-broadcast-polling.test.mjs`.

### R03 以遠端可控字串為鍵之字典用 Map

- 規則:以 clientId 等前端可控之值為鍵者用 Map,不用一般物件與 lodash get/set 之路徑語意;對外回傳一般物件時以 `Object.fromEntries` 建立(任意鍵皆為自有屬性).
- 盤點:`grep -n "broadcastMessages\|delivered" src/WServBroadcastServer.mjs`
- 站點:`Sv:98`、`:103`、`:164-165`、`:261-275`、`:280`、`:315`、`:329-336`(已套).對照:`node_modules/wsemi/src/alive.mjs:120` 用無原型物件(已套).
- 測試:`test/unit-server-polling-input.test.mjs`.

### R04 建構先驗後配(原子化)

- 規則:順序為「檢查會用到之全部方法 → 指派掛載屬性 → 註冊監聽 → 起計時器」,任一步拋錯皆不殘留計時器與監聽.伺服端檢查 emit/on/off,前端檢查 emit/on/execute 與執行環境之 AbortController(R10 所需;缺者以描述性錯誤 `AbortController is not available` 拋出,與其他檢查同形,裁決 Q1 方案 A').
- 盤點:`grep -n "throw new Error\|setInterval\|\.on('execute'\|instWConver\(Server\|Client\)\.[a-zA-Z]* =" src/*.mjs`
- 站點:前端檢查 `Cl:62-85`(AbortController 為 `:72-75`、getToken 為 `:77-85`,R11)、AbortController 之建立 `:107`(不持有計時器或監聽)、指派 `:129`、計時器 `:171`(已套);伺服端檢查 `Sv:82-84`(emit/on/off)與 `:86-94`(verifyPolling,R11)、指派 `:320-323`、監聽 `:326`、計時器 `:329`(已套).
- 刻意不套:伺服端未給/非有效物件時改用 evem 建立不連線之實體(`Sv:76-79`;族內伺服端同型,`C:\opensrc\開源-JS-018-6-w-serv-webdata\w-serv-webdata\sgud/rule/rulebook.md:43`),已載於 JSDoc.
- 測試:`test/unit-client-construct.test.mjs`、`test/unit-server-construct.test.mjs`.

### R05 計時參數為正整數並夾至上限

- 規則:使用端可給之計時參數須為正整數(ispint;0 與無效值取預設),夾至 2147483647;協定上 timePolling 須明顯小於伺服端在線逾時 10 秒(JSDoc).
- 盤點:`grep -n "setInterval\|setTimeout\|timePolling" src/*.mjs`
- 站點:`Cl:87-93`(已套);`Sv:329` 起之計時器固定 1000(刻意不套:常數).
- 測試:`test/unit-client-construct.test.mjs`.

### R06 輪詢失敗之單一出口

- 規則:前端「connIng=false 並發 `{ msg:'[sys:polling] error', err }`」只寫一處(failPolling),reject、同步拋錯、回應不合協定三處共用.
- 盤點:`grep -n "connIng = false\|failPolling" src/WServBroadcastClient.mjs`
- 站點:定義 `Cl:135-138`;呼叫 `:193`、`:226`、`:233`(已套;R11 之 getToken 拋錯/reject 亦經 `:226`).
- 測試:`test/unit-client-response.test.mjs`(「曾連線後各類失敗」案).

### R07 停止為終態且冪等

- 規則:clearBroadcast 可重複呼叫、可於監聽器內呼叫;伺服端停止後不回應輪詢(含於同一次 execute 派發中、比本套件早註冊之監聽內停止),broadcast 無作用、getClients 回 `[]`、getMessages 回 `{}`;補發以「已送達使用端之 clientEnter 且尚未送達 clientLeave」為準,data 為最後一次輸入.
- 盤點:`grep -n "clearBroadcast\|if (cleared)" src/*.mjs`
- 站點:前端 `Cl:117-128`(冪等 `:118-120`、中止 `:127`);伺服端 `Sv:185`(onExecute 早退)、`:264`(broadcast)、`:286-317`(clearBroadcast)、`:100-117`(delivered 與 onDeliver)、`:128-131`(leave 已排定者更新 data)(皆已套).驗證在途時之停止見 R11.
- 測試:`test/unit-server-clear.test.mjs`、`test/unit-client-clear.test.mjs`.

### R08 同一事件物件只建構一個

- 規則:同一事件物件只能建立一個前端/伺服端實體,重建前須先 clearBroadcast.
- 站點:兩端 JSDoc `@param`(已套,文件化).
- 刻意不套:防護碼(裁決 Q7:屬誤用;與 w-sync-webdata 同作法只寫文件).

### R09 共用 execute 通道之責任

- 規則:本套件之 execute 監聽只處理 `[sys:polling]`,其他函數名由應用端註冊監聽回應;本套件之監聽須先於「對所有函數名皆回應」之監聽註冊.
- 站點:`Sv:190-192`(只處理 `[sys:polling]`,已套);JSDoc(已套).
- 刻意不套:只有本套件一個監聽時以錯誤拒絕其他函數名(K8,裁決 Q1:以 listenerCount 推測是否唯一監聽為脆弱之推測式判斷).
- 補充(2026-10-23,R11/L12):提供 verifyPolling 後本套件之回覆為非同步,「本套件之監聽須先於全回應者註冊」不再足夠——後註冊且同步回應 `[sys:polling]` 之監聽仍會先結算;該類監聽須自行略過 `[sys:polling]`.
- 測試:`test/unit-server-polling-input.test.mjs`(「其他函數名不回應」鎖定).

### R10 停止中止本層之在途請求(前端)

- 規則:每個前端實體於建構時建立一個 AbortController(唯一擁有者),只交給本套件之輪詢——`execute('[sys:polling]', { clientId }, cbProgress, { signal })` 為唯一交出點;clearBroadcast 先 `cleared = true` 再 `abort()`(中止之拒絕以微任務送達,由 `cleared` 早退,不派發、不輸出);在途結果之早退保留(不支援 opt.signal 之通訊物件、停止前已 settle 者仍落此,R01).中止只及本實體之輪詢:同一通訊物件上之其他呼叫、停止後於同一通訊物件重建之新實體不受影響.
- 承諾(JSDoc `Cl:26`,裁決 Q3):通訊物件支援 execute 之 opt.signal 者(WConverhpClient ≥ 2.1.8),停止後該請求不再重試、不再發出其 error 與重試訊息、不再呼叫 getToken;本套件除已排定之派發計時器(1ms 內觸發而不派發)外不再持有計時器與在途之請求(行程可立即結束).不支援者見 L1.
- 對通訊物件與執行環境之要求(JSDoc `Cl:22`;裁決 Q8 以文件規範,不改每輪一個控制器):包裝 execute 者須原樣轉交第 4 參數;通訊物件須於每次呼叫結束移除其掛於 signal 之監聽,且該監聽不得拋錯(Node 之 EventTarget 以 uncaughtException 回報);執行環境須內建 AbortController(R04).
- 盤點:`grep -n "AbortController\|signal\|abort()" src/WServBroadcastClient.mjs`
- 站點:建構檢查 `Cl:72-75`(R04);唯一擁有者之建立 `Cl:107`;唯一交出點 `Cl:142`(execPolling;R11 之 getToken 路徑亦經此);中止 `Cl:127`(於 `cleared = true` `:121` 之後);在途結果早退 `:187`、`:222`(保留,R01);JSDoc `Cl:22`(對通訊物件與執行環境之要求)、`Cl:26`(停止承諾).全部已套.
- 刻意不套:每輪一個 AbortController(方案 B,裁決 Q8:不移除監聽之自訂通訊物件屬契約外);特性偵測而無 AbortController 者退回現況(方案 C,裁決 Q1:族內唯一使用者 w-serv-webdata 亦要求 AbortController,退路走不到).
- 測試:`test/unit-client-abort.test.mjs`(U-1 交出 signal、U-2 停止當下中止且拒絕不派發、U-3 重建之新實體獨立)、`test/unit-client-abort-noac.test.mjs`(U-4' 缺 AbortController 時建構拋錯且不殘留計時器)、`test/api-broadcast-polling.test.mjs` 之 describe「api client stop」(A-1 退避中、A-2 在途、A-3 重入、A-4 閒置、A-5 應用端自身之請求不受影響、A-6 伺服端恢復後不見已停止之前端、A-7 對照組(不支援 opt.signal)、A-8 getToken 懸置中),子行程工具 `test/tools/childClientStop.mjs`.

### R11 輪詢之身分驗證由使用端注入之鉤子負責,於任何副作用之前呼叫(2026-10-23 broadcast-run01;跨套件原則「框架不驗證 token,只呼叫使用方注入之函數」)

- 規則(伺服端 `opt.verifyPolling(input)`):
  1. 放行判準:回傳(或 resolve,thenable 以 Promise 吸收)**嚴格 `true`** 才放行;其他值(含 `1`、`'user-1'`、`{}`、`Object(true)`)、同步拋錯、reject 一律拒絕.
  2. 拒絕處置:`pm.reject('[sys:polling] permission denied')`(固定訊息,不含原因)、**不建立任何狀態**(不寫佇列、不呼叫在線偵測、不取出已在線者之佇列、不刷新其在線資料)、發 error `{ msg: '[sys:polling] permission denied', err: <鉤子回傳值> }`;鉤子本身拋錯/reject 發 `{ msg: '[sys:polling] verifyPolling error', err: <所拋之值> }`(兩者回前端之訊息相同).
  3. 呼叫時點與快照:onExecute 內、**任何副作用之前**;全部副作用集中於 `poll()`,只在放行後呼叫(未注入者直接同步呼叫 `poll()`).已注入者於 onExecute 一進入即取 `snap = cloneDeep(input)`(保留循環參照),此後 clientId、傳給鉤子之輸入(`cloneDeep(snap)`)與交使用端之 data **皆取自快照,放行後不再讀原輸入物件**(「檢查之值即使用之值」:同一事件物件上其他 execute 監聽共用同一 input、或其屬性為 getter 時,驗證與使用不致分歧).clientId 不合者先被拒絕,不呼叫鉤子、不發 error(R02).
  4. 剝除 token:**僅於注入鉤子時**,放行後直接於快照上刪除固定鍵 `__sysToken__`(`src/pollingTokenKey.mjs` 單一定義,前後端共用)再交 `poll()`,故 clientEnter、clientLeave(含自然離線與 clearBroadcast 補發)、getClients 之 data 皆無 token,巢狀或循環參照所指亦為已剝除者;不就地改動呼叫端之輸入.未注入者輸入原物件交付(相容).
  5. 停止:驗證在途時 clearBroadcast,鉤子結算後(true/false/拋錯皆然)不建立狀態、不發任何事件(含 error)、不回應(同停止後才到之輪詢);停止後才到之輪詢在 onExecute 早退,不呼叫鉤子.
  6. 放行後之處理或回覆失敗(`poll()` 內拋錯、`pm.resolve` 拋錯):未停止者以 `failPoll` 發 `{ msg: '[sys:polling] error', err }` 並 `pm.reject('[sys:polling] error')`,使請求不懸置;`pm.reject` 亦拋錯者只再發一則 error,不成為未處理的 rejection(外審 sol#4 後補).
  7. 建構:給了非函數(undefined、null 除外)拋 `opt.verifyPolling is not a function`,先驗後配(R04).
- 規則(前端 `opt.getToken`):每輪輪詢前同步呼叫(sync/async 皆可),回傳之字串放於輪詢輸入 `__sysToken__`(非字串取 `''`,使欄位不因傳輸時 undefined 而消失);拋錯/reject → 該輪**不發出輪詢**,經 `failPolling`(R06)通知並轉未連線,下一輪重新取得;取得期間停止 → 不發出輪詢(`cleared` 判斷,結果由停止判斷略過);execute 未回傳 Promise 者與未給 getToken 時同視為輪詢失敗(外層 Promise 會吸收非 Promise 之回傳值,故於 `pollOnce` 內明確檢查,外審 sol#5 後補);未給(undefined、null)→ 輸入恰為 `{ clientId }` 且於計時器回呼內同步發出(相容);非函數拋 `opt.getToken is not a function`(R04).
- 盤點:`grep -n "verifyPolling\|getToken\|pollingTokenKey" src/*.mjs`
- 站點:伺服端——檢查 `Sv:86-94`;訊息常數 `:137-140`;`verify` `:145-157`(鉤子唯一呼叫點 `:147`);`poll`(全部副作用)`:161-170`;`failPoll` `:176-179`;onExecute 之快照 `:197-203`、clientId 檢查 `:206-211`、未注入之分流 `:213-217`、注入之驗證鏈 `:219-252`(停止判斷 `:224`、拒絕 `:228-233`、剝除 `:236`、放行 `:237`、放行後失敗之處置 `:240-251`);前端——檢查 `Cl:77-85`;`pollOnce` `:149-168`(getToken 呼叫 `:154`、停止判斷 `:157`、固定鍵 `:160`、非 Promise 檢查 `:163-165`);JSDoc:`Sv:17`、`:22`(opt.verifyPolling)、`:23`(error 內容)、`Cl:19`、`:25`(opt.getToken).全部已套.
- 刻意不套:①未注入時亦剝除 `__sysToken__`——〈不得改變〉未注入時之全部現行行為(clientEnter 之 data 即輸入原物件);自有套件庫內唯一使用端為 w-serv-webdata,其未送該鍵(使用端盤點見 broadcast-run01 報告),若主控要求改恆剝除,差異僅限含該鍵之輸入.②鉤子逾時——需求未要求,JSDoc 載明使用端自理(L9).③拒絕限流——error 事件數量等於被拒輪詢數(審計 4.8「限流不在本輪」),JSDoc 載明.④鉤子回傳身分物件——需求為 boolean,身分紀錄由使用端自行處理.⑤clientId 歸屬檢查——由鉤子負責(JSDoc 載明,輸入已含 clientId).
- 測試:`test/unit-server-verify-polling.test.mjs`(28 案:放行 8〔sync/async/thenable、token 不出現、鉤子收複本、他監聽改動輸入、getter、循環參照、放行後不再讀原輸入、鉤子傳入內容〕、拒絕 9〔值矩陣 16 值×sync/async、拋錯與 reject、thenable/字串 reject、回覆拋錯、同 ID 交錯、已在線者被拒、大量被拒、無 error 監聽者、併發〕、呼叫時點與範圍 3、停止 3、在線期限〔真實時間約 12 秒〕1、建構與相容 4〔含 L12 釘選〕)、`test/unit-client-get-token.test.mjs`(11 案)、`test/api-broadcast-verify-polling.test.mjs`(3 案,真 w-converhp,埠 8098).變異驗證 22 點(21 點為真變異、全部被抓到,含「拿掉鉤子呼叫」S-M1、「鉤子移到副作用之後」S-M2;1 點為等價變異對照,存活如預期;於 41 條時跑,其後僅增 L12 釘選 1 條);修前(HEAD 之 src)跑同一批 41 條測試 35 條紅、6 條相容/設計釘選綠;腳本與結果見 broadcast-run01 報告之證據夾.

## 2. 已知限制(刻意不修或範圍外)

- L1 停止時有輪詢在途而通訊物件不支援 opt.signal(WConverhpClient ≤ 2.1.7、或包裝 execute 而只轉交 3 個參數者):該請求照常完成或重試並發其自身 error,行程待其結束;本套件只丟棄其結果(R01;已載 JSDoc).生產堆疊之通訊物件由 w-serv-hapi 建立,其升至 w-converhp ≥ 2.1.8 後 R10 才在生產堆疊生效.(原載「通訊物件仍重試並發其自身 error,本套件無法中止(execute 無中止介面;裁決 Q8)」,2026-10-13 依 w-converhp 2.1.8 改寫,見 R10.)
- L2 監聽器內停止時,同一次派發之其餘監聽器仍收到(與 DOM 相同,不包裝監聽器;已載 JSDoc).
- L3 傳遞為至多一次:兩次成功輪詢間隔 ≥ 10 秒即被逐出並丟佇列;回覆失敗(含不可序列化之 data)即同批遺失(裁決 Q9、Q10 只做 F-1,已載 JSDoc).
- L4 async 監聽器之 reject 不被攔截(JSDoc 已載).
- L5 輪詢請求懸置時依通訊物件逾時(WConverhpClient 預設每次 5 分鐘、重試 3 次)才失敗.
- L6 契約外輸入:無 catch 之 thenable(同輪先 error 後 open);Node 原生 EventEmitter 於有 error 監聽者時行為同 eventemitter3,無監聽者時經 R01 之 console.error 不再拋 ERR_UNHANDLED_ERROR;通訊物件之 abort 監聽拋錯(Node 行程以 uncaughtException 結束)或每次呼叫所掛之監聽不移除(長壽 signal 上逐輪累積)——R10 之要求,只寫文件;建構途中經通訊物件之 setter 同步呼叫 clearBroadcast(計時器照建且回呼無 `cleared` 守門,家族內不可達).
- L7 停止時伺服端正於驗證(verifyConn)或接收本體中:前端中止使連線關閉,伺服端之通訊物件(WConverhpServer)記一則其自身之 error「receive payload error: closed before receive」(與使用者關閉分頁同;w-converhp 之既定設計,其測試 `node_modules/w-converhp/test/api-abortDuringAdmit.test.mjs:104`);非本套件之事件,JSDoc 不載(裁決 Q4).
- L8 伺服端停止後對端之輪詢:同一事件物件上無其他 execute 監聽者,由通訊服務立即拒絕(no listener);另有不回應 `[sys:polling]` 之監聽者,懸置至前端每次嘗試之逾時(w-converhp 刻意不代為終結,`node_modules/w-converhp/src/WConverhpServer.mjs:608-625`).只文件化於 `Sv:23`(裁決 Q6;不重提 K8).
- L9 鉤子(opt.verifyPolling)不內建逾時:鉤子永不結算時,該次輪詢之 pm 與閉包懸置至前端逾時(伺服端無釋放點);鉤子在途時伺服端停止,該請求照鉤子結算後靜默、不回應(同停止後才到之輪詢,L8),懸置至前端逾時或前端自身中止.逾時須由鉤子自行處理(R11,JSDoc 已載).
- L10 拒絕不限流:每次被拒絕發一則 error 事件,匿名者可使 error 事件數量等於其輪詢數(量級同通訊層 verifyConn 拒絕之路徑);限流不在本套件(審計 webdata-inv01 4.8).
- L12 提供 verifyPolling 時輪詢之回覆為非同步(鉤子結算後),同一事件物件上於本套件之後註冊、且對 `[sys:polling]` **同步**回應之監聽(例如 w-serv-webdata 資料通道之 `execFun`:無 `__sysToken__` 回 `invalid token`、有 token 而無 `__sysInputArgs__` 回 `invalid input`,見 `w-serv-webdata/src/WServWebdataServerExec.mjs:264-285`)會先結算該請求,輪詢失敗(前端每輪發 error);未提供鉤子時本套件同步先結算,僅註冊順序決定(R09).已由 `test/unit-server-verify-polling.test.mjs`「與其後註冊且對[sys:polling]同步回應之監聽並存時」釘選,JSDoc(`Sv:22`)與 README Upgrade Notes 已載.**改 w-serv-webdata 時須讓其資料通道略過 `[sys:polling]`(不回應)**——本輪不改該套件.
- L11 未注入 opt.verifyPolling 時任何能通過通訊層者皆可輪詢(預設為放行,JSDoc「身分驗證責任」與 README 已載);前端 opt.getToken 之 token 隨每次輪詢明文送出,傳輸安全由使用端與通訊層負責.

## 3. 待辦(日後另案)

- T1 前端「連線→未連線」之反向事件(裁決 Q3:本輪不做,JSDoc 已寫明現行語意「每輪失敗發 `{ msg: '[sys:polling] error', err }`、恢復時再發 open、不另提供斷線事件」).新增時須決定:事件名、停止時是否比照伺服端補發、與 w-converhp 自身 error 之區分.
- T2 既有測試檔內之 delay、poll 等與 `test/tools/helpers.mjs` 重複,可收斂.
- T3(已完成,2026-10-13 主控任務 20261013214634 之 run02)停止時中止在途之輪詢請求(採用 w-converhp 2.1.8 之 `opt.signal`;w-converhp 之 `建議w-serv-broadcast調整.md`):見 R10、R01 範圍限制、R04、L1、L6、L7、L8.審計回應 `C:\opensrcOper\dnow\20261013214634\agent-out\run01-審計回應.md`、裁決 `C:\opensrcOper\dnow\20261013214634\review\run01-複審.md`、全盤 `tmp/run03-中止在途輪詢-全盤.md`.

## 4. 破壞性變更紀錄

- (run02 實作,已發布 1.1.8,提交 `c298f91`)不合協定之輪詢回應不再發 openOnce/open,改每輪 error;停止後不再收到本套件之事件(含已排定與在途結果;伺服端補發以已送達 clientEnter 為準);非字串 clientId 之輪詢被拒;伺服端傳入缺 on/off、前端傳入缺 on 之物件於建構時拋錯;timePolling 為 0 時取預設 2000、超過上限者夾至上限;本套件自發之 error 無監聽者時改 console.error;broadcast 以呼叫當下之值廣播.
- (broadcast-run01,主控任務 20261023213314,待發布,版號由主控決定;相容)新增伺服端 `opt.verifyPolling`、前端 `opt.getToken` 兩個選項(皆可省略;省略時行為與 1.1.10 完全相同,含 clientEnter 之 data 即輸入原物件).注入 verifyPolling 後:①鉤子回非 true 者(例如未帶/帶錯 token,由鉤子決定)之輪詢被拒(`[sys:polling] permission denied`),前端每輪發 error、不 open;②鉤子要求 token 時需前端同時提供 getToken(部署順序:先升伺服端並注入、再升前端;舊前端被拒至重新整理);③clientEnter/clientLeave 之 data 不含 `__sysToken__`;④給了非函數之 verifyPolling/getToken 於建構時拋錯.內部新增 `src/pollingTokenKey.mjs`.
- (主控任務 20261013214634 之 run02 實作,待發布,預期 1.1.9)前端:①建構時要求執行環境內建 AbortController,缺者拋 `AbortController is not available`(Node 14.17 以前、Chrome 65 以前等;裁決 Q1);②輪詢之 execute 多帶第 4 參數 `{ signal }`——自訂通訊物件之第 4 參數另有語意者受影響,包裝 execute 者須原樣轉交;③clearBroadcast 中止在途之輪詢請求——通訊物件支援 opt.signal 時,停止後不再有該請求之重試、error、重試訊息與 getToken 呼叫,伺服端於驗證中被中斷時記一則其自身之 error(L7).API 不變.版號由主控決定.

## 5. 測試對照

| 測試檔 | 層 | 規則 | 案數 |
|---|---|---|---|
| `test/broadcast.test.mjs` | api(真 w-converhp,埠 8080;檔名未帶層級前綴) | R01、R02 之正常路徑 | 1 |
| `test/unit-client-construct.test.mjs` | unit | R04、R05、R01(進度回呼) | 9 |
| `test/unit-client-abort.test.mjs` | unit | R10(U-1~U-3) | 3 |
| `test/unit-client-abort-noac.test.mjs` | unit(子行程) | R04、R10(U-4') | 1 |
| `test/unit-client-response.test.mjs` | unit | R02、R06 | 7 |
| `test/unit-client-clear.test.mjs` | unit | R01、R07 | 9 |
| `test/unit-server-construct.test.mjs` | unit | R04、R08(重建) | 5 |
| `test/unit-server-polling-input.test.mjs` | unit | R02、R03、R09 | 5 |
| `test/unit-server-clear.test.mjs` | unit | R01、R07 | 16 |
| `test/unit-listener-error.test.mjs` | unit | R01(拋錯隔離、error 形狀、Q2) | 17 |
| `test/api-broadcast-polling.test.mjs` | api(真 w-converhp,埠 8097,各案循序) | R01、R02、R09(describe「api broadcast polling」4 案);R10、L1(describe「api client stop」A-1~A-8,前端於子行程) | 12 |
| `test/unit-server-verify-polling.test.mjs` | unit(含 1 案真實時間約 12 秒) | R11(伺服端 verifyPolling)、R04(建構)、R07(停止) | 28 |
| `test/unit-client-get-token.test.mjs` | unit | R11(前端 getToken)、R04、R06、R10(signal) | 11 |
| `test/api-broadcast-verify-polling.test.mjs` | api(真 w-converhp,埠 8098,各案循序) | R11 端到端 | 3 |
| `test/tools/helpers.mjs` | 共用工具(非測試) | — | — |
| `test/tools/childClientStop.mjs` | 子行程工具(非測試;真 WConverhpClient + 本套件前端,停止後不呼叫 process.exit) | R10 | — |

執行:`npm test`(`mocha --parallel "test/*.test.mjs" --timeout 180000`),2026-10-13 run02 後 73 passing;2026-10-13 夜(主控任務 20261013214634 之 run02)後 85 passing;2026-10-23 broadcast-run01 後 127 passing(85 + 新增 42);單檔:`npx mocha --no-parallel <檔> --timeout 180000`.
