# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

格式:每條寫[情境 → 事實(附證據) → 做法],日期一律絕對日期.E01~E03 由全自有套件之主控 agent 移入(2026-10-13),完整探測紀錄見主控之確認報告 `w-serv-broadcast調整確認-全盤.md`(隨任務資料夾存於 `C:\opensrcOper\dnow\` 或 `C:\opensrcOper\dhist\`).

### E01 前端可自訂之 clientId 被當成一般物件的鍵(2026-10-13,1.1.7 現況)

- 情境:主控 agent 核對 w-serv-webdata 之 `建議w-serv-broadcast調整.md` 時,補做對稱側(伺服端是否驗證前端輸入).
- 事實:伺服端之 `broadcastMessages` 為一般物件,以 lodash get 讀取(`src/WServBroadcastServer.mjs:94`、`:124`),以 `broadcastMessages[clientId] = []` 寫入(`:128`),clientId 直接取自前端輸入(`:120`).以 `__proto__` 當 clientId 輪詢一次,該輪詢者得 `{}`,其後之廣播對所有客戶端遺失(實測兩個一般客戶端皆收不到 m1、m3);`constructor` 只使其自身首輪得 `{}`.wsemi 之 alive 已為同一個 clientId 改用無原型物件(`wsemi/src/alive.mjs:120`).這與「冒用他人 clientId」不同:前端本來就能自訂自己的 clientId.
- 做法:以前端可控之字串為鍵的字典,一律用 Map 或 `Object.create(null)`,並以自有屬性讀取;clientId 不是非空字串者不建立在線身分.

### E02 eventemitter3 沒有 newListener,建構時之 on 於契約內不會拋錯(2026-10-13)

- 事實:eventemitter3 之 `on` 只在 listener 不是函數時拋錯(`node_modules/eventemitter3/index.js:58-60`),也不發 newListener 事件;newListener 是 Node 原生 EventEmitter 才有,而本套件要求 eventemitter3(`src/WServBroadcastServer.mjs:16`;wsemi `src/evEmit.mjs:36` 同).實測(1.1.7):傳入只有 emit 之物件,建構拋 `TypeError: instWConverServer.on is not a function`,且 Timeout 由 0 增為 1 而殘留;無 off 時 clearBroadcast 拋 TypeError,在線偵測要到客戶端逾時(停止後 10017ms)才停,並於其時發出 clientLeave.
- 做法:評估「建構中途拋錯」之情境時,先確認觸發條件在契約內;建構時之檢查要涵蓋實際會用到之方法(伺服端 emit、on、off;前端 execute).

### E03 同一 execute 通道上之註冊順序(2026-10-13)

- 事實:同一事件物件上之各 execute 監聽共用同一個 pm,先 settle 者勝(w-converhp `src/WConverhpServer.mjs:1031-1071`).對所有函數名都 resolve 之監聽若先於本套件註冊,或本套件 clearBroadcast 後只剩這類監聽(例如 w-serv-webdata 之資料通道回 `{ state: 'error', msg: 'invalid token' }`),1.1.7 之前端照發 openOnce、open,收不到推播也不發 error(實測).反之,典型之應用端監聽對未知函數 reject(如 w-converhp 之 execute 範例 `src/WConverhpServer.mjs:717-720`),先於本套件註冊時輪詢會被拒絕,前端看得到 error.
- 做法:診斷「前端連上卻收不到推播」時,先查同一事件物件上各 execute 監聽之註冊順序,以及各自對 `[sys:polling]` 之回應.

### E04 lodash get 之路徑語意使伺服端自己回非陣列(2026-10-13,1.1.7 現況,run01 審計)

- 情境:核對「本套件伺服端對 `[sys:polling]` 一律以陣列回覆」.
- 事實:`get(broadcastMessages, clientId, [])`(`src/WServBroadcastServer.mjs:124`)把 clientId 當路徑:a 有 2 則訊息時,clientId `a.length` 首輪得數字 `2`、`a[0]` 與 `['a',0]` 得 a 佇列之第一則訊息物件、`constructor`/`toString` 得 `{}`、`__proto__` 得 `{}` 且其後廣播對所有人遺失(實測 `tmp/run01-probe-server.mjs ids|proto` 與 inline).空字串、缺、非字串之 clientId 被 wsemi alive 拒絕(`alive.mjs:202-205`,只 console.log「trigger need key」),**不會**發 clientEnter('').
- 做法:以前端可控之值為鍵,一律 Map(或無原型物件+自有屬性讀取),不用 lodash get/set 之路徑語意;斷言「伺服端一律回 X」前,先列舉鍵之型別與語法(含 `.`、`[`).

### E05 只有本套件掛 execute 時,其他函數名之請求懸置(2026-10-13,run01 審計)

- 事實:w-converhp 只在 execute 監聽數為 0 時立即拒絕(`node_modules/w-converhp/src/WConverhpServer.mjs:635-654`);本套件之監聽只處理 `[sys:polling]`,其餘不 settle,於是 README 範例架構(WConverhpServer+本套件,無應用端監聽)下呼叫其他函數名會懸置至前端逾時(實測 `tmp/run01-probe-misc.mjs hang`:不掛本套件 32ms 拒絕;掛本套件 3015ms 逾時).w-converhp 帳本把「接了卻不回話」定為監聽者之責(`:623-625`).
- 做法:在共用通道上註冊「只處理部分訊息」之監聽時,要檢查自己是否遮蔽了下層之 fail-fast;判斷「是否唯一監聽」用派發當下之 listenerCount,並以 isfun 守護,不新增建構期失敗型.

### E06 全盤矩陣之標籤計數:非 UTF-8 locale 下 `[^】]` 會漏字(2026-10-13)

- 事實:`grep -o "【[^】]*】"` 在預設 locale 以位元組比對;`】` 為 E3 80 91,「契」為 E5 A5 91,含 0x91 而被排除,【契約外】整格漏計(實測 M3 少 1 格).
- 做法:`LC_ALL=C.UTF-8 grep -oP "【.*?】"`,並逐表核對格數與表頭宣告一致.

### E07 前次全盤把略過之 isearr 當成設計繼承(2026-10-13,流程教訓)

- 事實:1.1.7 之全盤(`tmp/w-serv-broadcast停止與派發-全盤.md` A5)寫「後到之輪詢由資料通道回 invalid token,前端視為無訊息(`src/WServBroadcastClient.mjs:115-117`),皆不懸置」,把 `isearr` 之略過當設計;同表 B2(前端在途派發)列待討論.兩者後來分別被 w-serv-webdata、w-serv-hapi 以建議書提出.
- 做法:讀到「略過/return 早退」時,先問它擋掉的是表上哪一格、該格應然為何(§2.1-5);伺服端已承諾之語意(如停止後不派發)必須逐條拿去對前端(§2.1-4).

### E08 自審矩陣被外部複審找出之漏洞形狀(2026-10-13,run01 審計)

- 事實:156 格之自審矩陣,經獨立子代理複審找出 31 條且全部屬實(`tmp/run01-複審整合.md`).五種形狀:①只用假通訊物件推演「停止後」,漏了 WConverhpClient 於停止後仍重試並發其自身 error(實測 inflightRetry);②只看本套件之派發,漏了 eventemitter3 派發迴圈之語意——同一次派發之其餘監聽器照收、移除監聽後進行中之 execute 派發仍呼叫本監聽(`node_modules/eventemitter3/index.js:194-212`、`:274-288`);③「已測」只看測試名稱,未核其前置狀態(恆失敗之測試只涵蓋首輪);④探測用了非預設設定(retryMain 0、timeout 3000)卻把結果當一般情形;⑤只把單則訊息當失敗單位,漏了「先清佇列後回覆」使回覆失敗時同批全遺失.
- 做法:推演停止/失敗時,假通訊物件與真 WConverhpClient(預設重試)各跑一次;凡經 EventEmitter 派發之規則,補「同一次派發之其他監聽器」與「派發中移除/新增監聽」兩格;標【正常-已測】前逐格核對所引測試之前置狀態;探測若改了預設值,結論要註明並另推預設下之後果;有佇列者一律問「取出後回覆失敗會怎樣」.

### E09 以 bash 內嵌 node -e 寫文字時 Windows 路徑之反斜線被吃(2026-10-13)

- 事實:在 bash 雙引號字串內以 `node --input-type=module -e "..."` 寫入含 `C:\\opensrc\\…\\test\\…` 之文字,寫出 `C:opensrc…	est…`(反斜線消失、`\t` 成 TAB);另一次因 `\2026…` 被當八進位跳脫而拋 SyntaxError.
- 做法:含 Windows 路徑、反斜線或大段中文之文字修改,一律用 Write/Edit 工具或寫成 `./tmp/*.mjs` 腳本檔再執行;改完以 `LC_ALL=C.UTF-8 grep -cP "\t"` 與 `grep -c "C:opensrc"` 掃描.

### E10 mocha 之 async 測試開頭同步量計時器數會少 1(2026-10-13,run02)

- 事實:以 `process.getActiveResourcesInfo()` 量 Timeout 數檢查「停止後不殘留計時器」,於 async 測試函式開頭同步量基準,結束時恆多 1;同邏輯之 `node -e` 腳本為 0.mocha 對回傳 Promise 之測試於函式同步段之後才建立逾時計時器.
- 做法:async 測試先 `await delay(5)` 再量基準;同步測試(不回傳 Promise)內基準與斷言同在一段者不受影響.

### E11 `--parallel` 下以固定時窗計算輪數之斷言會偶發失敗(2026-10-13,run02)

- 事實:「timePolling 30、200ms 內至少 2 則 error」於單檔跑恆綠,`npm test`(平行 9 檔)第 4 次跑時只得 1 則.平行負載使計時器延遲.
- 做法:要求「達到 N 輪/收到某事件」者一律以 `test/tools/helpers.mjs` 之 `waitFor(條件, 上限)` 等條件成立;只斷言「沒有發生」者可保留固定時窗(負載只會使其更易成立).改完連跑 `npm test` 數次確認.

### E12 停止後之補發與重建共用同一事件物件(2026-10-13,run02)

- 事實:伺服端 clearBroadcast 之補發(clientLeave、clientChange)以 1ms 脫勾送達;本套件把能力掛在傳入之事件物件上,停止後立即以同一物件重建,新掛之監聽會收到舊實體之補發(`test/unit-server-construct.test.mjs` 初版即因此紅).
- 做法:測試或使用端於停止後重建時,先等補發送達(數 ms)再掛新監聽;JSDoc 已載「同一事件物件只能建立一個,重建前須先 clearBroadcast」.

### E13 「停止後行程可立即結束」要在子行程內量,並扣除受測者以外之資源(2026-10-13,主控任務 20261013214634 run01 審計)

- 情境:驗證前端 clearBroadcast 後 Node 行程能否自然結束.
- 事實:在 mocha 行程內量不到(mocha 與其他測試之資源撐住事件迴圈);改以子行程不呼叫 `process.exit`、於 exit 事件記時(同 w-converhp `test/api-clientAbort.test.mjs:909-975`).token 情境量到 585–620ms,全為探測腳本 getToken 自身之 800ms 計時器;scope 情境之約 500ms 為應用端自身之請求——兩者皆非受測對象所持(`tmp/run03-probe-table.md`).
- 做法:子行程量「停止至 exit」;判讀前先列出子行程內所有自建之計時器與請求並扣除;500ms 之斷言門檻只用於子行程內除受測對象外無其他在途工作之情境.

### E14 停止後之殘餘請求要從伺服端看(2026-10-13,同上)

- 事實:前端停止時請求仍在途(getToken 懸置、伺服端 verifyConn 中、退避後伺服端恢復),伺服端於前端停止**之後**才發 clientEnter(幽靈在線,10 秒後 clientLeave);以同一自訂 clientId 於同一通訊物件重建時,舊實體之殘留重試取走新實體之廣播(實測遺失 m33、m34).前端之事件皆已由閘門擋下,只看前端完全看不出來(`tmp/run03-probe-table.md` 之 token、admit、ghost、theft).
- 做法:評估「停止」之完整性時,同時記錄伺服端於前端停止後之 clientEnter 與 error,並跑「停止後於同一通訊物件重建」之情境.

### E15 新增之真 HTTP 測試檔不可與既有檔共用固定埠(2026-10-13,同上)

- 事實:擬議之 api 測試另立一檔、同用 8097,`mocha --parallel` 下與 `test/api-broadcast-polling.test.mjs` 同時起伺服器,2 案 `listen EADDRINUSE :::8097`(`tmp/run03-green-protoA.txt`);以單一 `.test.mjs` 匯入兩段(循序)後連跑 5 次全綠.
- 做法:同一固定埠之真 HTTP 案一律放在同一個 `.test.mjs`;要另立檔就另配固定埠(8000 以上、非隨機、避開主控所禁之區段).

### E16 模擬缺少全域 API 之測試須於 finally 還原(2026-10-13,同上)

- 事實:mocha `--parallel` 之 worker 會循序跑多個檔案,刪除 `globalThis.AbortController` 而未還原,會使同一 worker 其後之檔案於建構時拋 ReferenceError.
- 做法:以 try/finally 還原,或改在子行程內刪除.

### E17 執行環境之支援版本要以相容資料實查,並以整個堆疊交叉(2026-10-13,同上)

- 事實:原以為 Node 14 皆無全域 AbortController;MDN browser-compat-data 8.1.5 載 Node 14.17.0 起即有.瀏覽器側以「能否載入通訊物件之 dist」交叉(w-converhp 之 client dist 含 async generator,Chrome 63 起),缺 AbortController 者只剩 Chrome 63–65.
- 做法:引用支援版本前,自 MDN browser-compat-data(unpkg `@mdn/browser-compat-data/data.json`)取值並註明其版本;判斷受影響之環境時,以堆疊中最高之語法/API 下限交叉,不只看單一 API.

### E18 「機率性」之探測結果先查相位(2026-10-13,主控任務 20261013214634 run02)

- 事實:theft 探測(停止後於同一通訊物件以同一 clientId 重建)於審計時 3 次中 2 次遺失 1–2 則,實作後以修前副本重跑 4 次皆 0.時間軸顯示:舊實體之重試約於停止後 850ms 到達,新實體於停止後 50ms 重建、每 100ms 輪詢——兩者皆鎖定於停止時刻而幾乎同相位,誰先到伺服端由抖動決定.改為停止後 100ms 重建、每 200ms 輪詢後,修前 3 次皆遺失 6–8 則、定稿 3 次皆 0(`tmp/run04-probe-table.md`).
- 做法:週期性活動與一次性事件皆由同一參考時刻導出時,結果之「機率」可能只是相位巧合;先列出各活動相對參考時刻之時點,把待觀察之事件放進兩次週期之間,再下「機率性」之結論.

### E19 新增測試先斷言前置時,清理要放 finally,紅燈時才不洩漏計時器(2026-10-13,同上)

- 事實:擬議 unit 案於現況(紅燈)時,先行之前置斷言(「輪詢應帶 AbortSignal」)失敗而跳過其後之 `clearBroadcast()`,輪詢計時器殘留,mocha 不結束(只能以 `taskkill /T` 結束並回驗);改為於 finally 停止後紅燈 43–51 秒正常退出.
- 做法:測試中建立之前端/伺服器一律於 finally 停止(停止可重複呼叫);寫完新案先對修前之程式跑一次紅燈,確認 mocha 會自行結束.

### E20 測試內組合套件路徑以 import.meta.resolve,不以目錄層級拼接(2026-10-13,同上)

- 事實:U-4' 原以「測試檔上兩層之 `node_modules/wsemi/...`」拼接路徑交給子行程,複製到 `tmp/run04-redhead/test/`(修前副本)時路徑失效,會以錯誤之理由變紅.改用 `import.meta.resolve('wsemi/src/evem.mjs')` 後,於 repo 與副本皆正確(本套件 eslint 之 babel parser 接受 `import.meta`).
- 做法:測試要把套件模組之位址交給子行程時,以 `import.meta.resolve` 由模組解析取得.

### E21 以 Write 工具產生之檔為 LF,本專案工作樹為 CRLF(2026-10-13,同上)

- 事實:`.editorconfig` 規定 `end_of_line = crlf`,git `core.autocrlf=true`(索引存 LF、工作樹 CRLF);Write 工具寫出 LF,git 於 diff 時提示「LF will be replaced by CRLF」.Edit 工具修改既有檔則保留原換行.
- 做法:以 Write 新建或整檔重寫之檔,寫完以 node 轉為 CRLF(`s.replace(/\r?\n/g, '\r\n')`),再以 `file <檔>` 或 `git ls-files --eol` 回驗,並重跑 lint 與測試.

### E22 新增「選項由使用端注入」類功能之驗證手法:單點變異複本＋同批測試(2026-10-23,broadcast-run01)

- 情境:提示詞要求「修前紅」並以變異驗證證明「拿掉鉤子呼叫」「把鉤子移到副作用之後」各被抓到.
- 事實:於 `./tmp/<輪>/mut/<名>/` 複製 `src` 與 `test`(`node_modules` 由上層解析),對複本之 src 做單點字串替換(斷言 old 恰出現一次、依檔案換行處理多行),以同一批新測試跑 mocha `--no-parallel --exit`;基準用 `git archive --format=tar HEAD src` 解到複本(GNU tar 會把 `C:` 當遠端主機,須以相對路徑加 `-C`、`cwd` 設為 repo 根).19 個複本約 3.5 分鐘.含 1 個等價變異作對照(預期存活),證明判定不是一律「失敗即抓到」.
- 做法:變異腳本寫成 `./tmp/*.mjs` 並以 quiet-run 執行;「移到副作用之後」之變異要真的讓副作用先發生(寫佇列、呼叫在線偵測),測試才有東西可抓——該格由「鉤子執行當下 getMessages/getClients/事件尚為空」之案抓到.

### E23 紅燈時未走到 clearBroadcast 的測試會讓 mocha 掛住(2026-10-23,broadcast-run01;同 E19)

- 事實:新測試對修前程式跑紅燈時,斷言失敗跳過末尾之 `srv.clearBroadcast()`,殘留 setInterval,不加 `--exit` 的 mocha 掛住(quiet-run 卡了 5 分鐘,須 `taskkill /T` 掉自己的 mocha 並回驗).
- 做法:測試檔以 `made` 陣列記錄所建實體,於 `afterEach` 一律 `clearBroadcast()`(可重複呼叫);臨時跑紅燈或變異時加 `--exit`.

### E24 WConverhpClient 不採 opt.clientId(2026-10-23,broadcast-run01)

- 事實:`new WConverhpClient({ ..., clientId: 'x' })` 之 `clientId` 被忽略(實測伺服端見到隨機字串);本套件前端讀的是**通訊物件上之屬性** `instWConverClient.clientId`(JSDoc 所載).
- 做法:測試或使用端要自訂前端識別,於建構 WServBroadcastClient 之前先 `cli.clientId = '...'`.

### E25 同步處理改為「先 await 驗證、再使用輸入」時,輸入須先快照(2026-10-23,broadcast-run01 外審)

- 事實:初版 `verifyPolling` 只把 `cloneDeep(input)` 給鉤子,放行後仍用原 `input`(`{ ...input }` 剝 token)與先前讀出之 clientId.外審(sol)指出五種形狀,皆讀碼屬實:①clientId 為 getter、每次讀取不同 → 檢查之值≠使用之值;②同一事件物件上其他 execute 監聽共用同一 input,於 await 期間可改動它;③淺拷貝使循環/巢狀參照仍帶 token;④放行後展開輸入時才拋錯(在 try 之外)→ `.catch` 只發事件、請求永不結算;⑤await 之後才發生的錯誤路徑須自己拒絕請求,不能只靠同步版的 try/catch.
- 做法:凡「await 驗證 → 使用輸入」之流程,進入時即快照(`cloneDeep`,保留循環參照),clientId、驗證輸入、交出之 data 皆取自快照,放行後不再讀原物件;敏感鍵直接在快照上刪;驗證鏈之 `.catch` 要拒絕請求並防範再拋.以 Proxy 計讀取次數之案(`放行後不再讀取原輸入物件`)當結構性釘選.

### E26 測試鎖被他套件長時間占滿時(2026-10-23,broadcast-run01)

- 事實:兩個 web-tests 槽被 w-web-api、w-web-perm 之 e2e 占用逾 20 分鐘,`quiet-run --lock` 在背景工具呼叫的 10 分鐘上限前都拿不到;`--release-stale` 只回收本套件之殘留鎖,對他套件之鎖回報「仍在執行,不動」.
- 做法:不要為每次測試各排一次隊;把要連跑的次數寫成腳本(`tmp/.../runn.mjs`,於同一次持鎖期間連跑 N 次 `npm test`),以 `run_in_background` 且 `timeout: 7200000` 排一次,再分段輪詢結果檔.排隊期間檔案若會被改(例如要先取「修前紅」),先把修前之 src 與測試複製到 `./tmp/<輪>/red/` 再排,以免排隊中途改了碼而紅燈變綠燈(broadcast-run02 作法:紅燈、變異、全套合為一支持鎖腳本 `suite.mjs`).

### E27 「保護只在選項啟用時才生效」會在設定缺漏時外洩;以相容為由保留需明列後果並交主控裁(2026-10-24,broadcast-run02)

- 事實:run01 為遵守〈不得改變〉,只在提供 `verifyPolling` 時剝除輪詢輸入中的 `__sysToken__`;提供 `getToken` 的前端遇到未設鉤子的伺服端(版本錯置或漏設)時,token 仍會進入 `clientEnter`/`clientLeave`/`getClients` 之 data.我將其列為待裁示(broadcast-run01 報告第八節),主控裁定一律剝除.實作成本低:含自有鍵者取副本去鍵,不含者 `snap === input` 原物件交付,相容影響只限含該鍵之輸入.
- 做法:涉及憑證/敏感欄位的處理,預設要 fail-safe(不依賴另一個選項是否啟用);若〈不得改變〉與此衝突,先列後果與最小相容方案請裁示,不自行取捨.判定「含該鍵」看**自有鍵是否存在**而非值之真偽(前端非字串 token 會送 `''`).

### E28 「修前紅」要先查相位:離線時點與 1 秒修剪計時器同相時,修前行為會偶然轉綠(2026-10-24,broadcast-run03;同 E18)

- 事實:修前行為(`leave` 時不刪佇列,靠 `setInterval(…,1000)` 於離線後最多 1 秒才刪)之重現取決於「離線時點」與「修剪計時器週期點」之相位.在線逾時約為首次輪詢後 10 秒,而修剪計時器自建構起每整秒一次,兩者皆由同一參考時刻導出而幾乎同相:變異 M1(=修前)在未錯開時 6 次跑中 2 次未完整重現(4/4、4/4、2/4、4/4、4/4、**0/4**),0/4 那次整份誤綠.首次輪詢前延後 500ms 使離線時點落在兩次修剪之中間後,M1 連 3 次皆 4/4 紅.
- 做法:測試修前行為若依賴計時器相位,先把待觀察事件放在兩次週期之間(延後起點),再下「修前紅」之結論;變異複本要連跑多次(≥3)確認紅燈穩定;探測點用 `setImmediate`(同輪 timers 之後)比 `setTimeout(…,5)` 更貼近「監聽返回後立即」且較不受負載影響.
- 另:`clientLeave` 經 `Ge` 以 1ms timer 脫勾派發,「同步段內先刪後 `eeEmit`」與「先 `eeEmit` 後刪」不可區分(等價變異,M3/M5 存活);可抓的是「刪除晚於派發」(M2:延後 20ms 刪)與「不刪」(M1).寫變異時先判斷哪些順序在脫勾下可觀察.

