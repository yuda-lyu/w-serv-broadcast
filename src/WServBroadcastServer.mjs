import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import evem from 'wsemi/src/evem.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import alive from 'wsemi/src/alive.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import genEeEmit from './genEeEmit.mjs'
import { checkOptLog, genDiag } from './genDiag.mjs'
import pollingTokenKey from './pollingTokenKey.mjs'


/**
 * 伺服器端之資料控制與廣播器
 *
 * 身分驗證責任：本套件不驗證身分(token)，只於輪詢([sys:polling])之任何副作用之前呼叫使用端注入之opt.verifyPolling；未注入時任何能通過通訊層(例如WConverhpServer之verifyConn)者皆可輪詢，即取得其後之全部廣播(含部署方broadcast之內容)並建立在線身分與佇列，未注入時之預設為放行。使用端須自行完整驗證——verifyConn驗連線之token(含本系統使用者存在、啟用、部署方授權)；verifyPolling驗輪詢之身分(須同等完整，反查執行身分即驗證身分，不可只解碼或只查id，並自行決定空身分是否放行，另須檢查clientId歸屬該身分)；應用端自行註冊之其他execute監聽(各函數)與資料授權各自把關，含函數層級之角色或成員檢查。
 *
 * @class
 * @param {Object} instWConverServer 輸入通訊服務實體物件，須為具emit、on、off函數之eventemitter3事件物件(例如wsemi之evem所建立者)，可使用例如WConverhpServer等建立；有物件而缺emit、on或off時於建構時拋錯，且不留下任何計時器與監聽；未給或非有效物件時改以evem建立不連線之事件物件(並印出提示)，可由emit('execute', func, input, pm)手動驅動。同一事件物件只能建立一個本伺服器，重建前須先呼叫clearBroadcast
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.verifyPolling=null] 輸入輪詢之身分驗證鉤子函數(sync或async皆可)，由使用端注入，預設null(不驗證，行為同未提供本選項時：本套件不驗證身分，任何能通過通訊層者皆可輪詢，風險見上方「身分驗證責任」)。給予函數時，每次[sys:polling]於任何副作用(建立佇列、建立或刷新在線身分、取出訊息、發出clientEnter等事件)之前呼叫，傳入該次輪詢之輸入物件之複本(含clientId、前端opt.getToken放於固定鍵__sysToken__之token，及使用端自行放入之其他欄位)；回傳(或resolve，thenable亦以Promise規則吸收)嚴格true才放行，其他值(含看似為真之值，例如1、'user-1'、{})、拋錯或reject一律拒絕：以固定訊息'[sys:polling] permission denied'拒絕該次輪詢(訊息不含拒絕原因，原因只經error事件供稽核)，不建立或刷新任何狀態(已在線者之佇列亦不取出)，並發error事件(內容見回傳之說明)。放行後交給使用端監聽之clientEnter、clientLeave之data已剝除固定鍵__sysToken__，使token不進入事件資料(未提供verifyPolling時同樣剝除：輸入含自有鍵__sysToken__者取副本去鍵後交付，不改動呼叫端傳入之原物件；不含該鍵者行為同現行，輸入原物件交付)；提供verifyPolling時，clientId、傳給鉤子之輸入與交給使用端之data皆取自輪詢到達當下之同一份快照(深複製)，驗證期間原輸入物件被他人改動(例如同一事件物件上其他execute監聽共用同一輸入)不影響檢查之值與使用之值；提供verifyPolling時，輪詢之回覆(含拒絕)於鉤子結算後非同步送出(未提供時同現行，同步回覆)，故同一事件物件上於本套件之後註冊、且對[sys:polling]同步回應之監聽(例如對所有函數名皆回應invalid token之資料通道)會先結算該請求而使輪詢失敗，此類監聽須略過[sys:polling](不回應)。鉤子須自行驗證token是否有效、使用者是否存在且啟用、部署方是否授權，並檢查clientId歸屬該身分(clientId由前端自訂，須唯一，否則與他人互相取走訊息)。clientId不是非空字串者先於鉤子被拒絕([sys:polling] invalid clientId)，不呼叫鉤子；本套件不內建鉤子逾時，鉤子不結算時該次輪詢懸置至前端逾時，須由鉤子自行處理逾時；clearBroadcast時在途之驗證於其結算後不建立任何狀態、不發任何事件、不回應。給了非函數(undefined與null除外)時建構拋錯(opt.verifyPolling is not a function)，不靜默放行
 * @param {Function} [opt.onTrace=null] 輸入觀察回調函數，格式為(e)=>{}，預設null(未給或非函數時不組事件物件，行為、時序與效能同未提供)，供測試與診斷以事件(而非等待毫秒)同步。於內部事件發生當下同步呼叫，e為凍結之事件物件{ type, ... }(欄位皆為原始值)；回調不帶接收者呼叫，其同步拋錯與回傳之rejection皆忽略，不影響廣播與在線偵測，回傳值不使用。type有：alive(在線偵測wsemi之alive所轉交之事件，evType為其type：'enter'或'leave'〔key為clientId，now為該事件後之在線數，早於本套件clientEnter或clientLeave之排定〕、'tick'〔每次偵測佇列，size為偵測前之數量〕、'stop'〔佇列已空而停止偵測〕，在線逾時固定10秒、偵測間隔固定50毫秒)、prune(修剪佇列之計時器〔每1秒〕每次觸發，queues為修剪後之佇列數，removed為本次移除之佇列數)、emit(本套件事件已排定於1ms後派發，name為事件名，final為是否為停止時之補發)、deliver(事件已派發而監聽器皆已呼叫完，name為事件名，final同上，ok為監聽器是否皆未拋錯)、report(本套件改以error事件或診斷輸出〔console.error或opt.funLog〕通報：src為'listener'〔監聽器拋錯，name為其事件名；監聽器拋錯而error監聽器亦拋錯時，先通知後者〔name為'error'、via為'console'〕再通知原事件之通報〔via為'event'〕〕或'error'〔本套件自發之error於無error監聽者〕，msg為其描述字串，via為'event'或'console')、stop(clearBroadcast首次呼叫完成，final為已排定補發clientLeave之客戶端數)。停止後除停止當下已在進行之那次派發與補發事件之deliver、report外不再通知；停止前已排定而於停止後被閘門丟棄之事件不通知
 * @param {Boolean} [opt.logDetail=false] 輸入診斷輸出是否還原為遮罩後之細節(供除錯)，預設false。本套件之診斷輸出(error事件無監聽者時之error、停止後或error監聽器之監聽器拋錯、建構時之提示)一律經wsemi之getDiag：預設false時只輸出固定標籤與安全摘要{ src, name, errType, errCode }，不含值(err可能含token或使用者識別)；true時console輸出遮罩後之細節(憑證樣式與本實例見過之輪詢token〔輸入之__sysToken__，最近64個〕皆遮罩為***)。有給(非undefined、null)但非布林值時建構即同步拋錯(invalid opt.logDetail)，先於任何資源之配置
 * @param {Function} [opt.funLog=null] 輸入診斷輸出函數，格式為(label, safe, detail)=>{}，預設null。給予時診斷輸出只交給它(不寫console，logDetail不作用)，detail為遮罩後之細節；其同步拋錯與回傳之rejection皆吞下，不影響本套件；帶屬性noDetail===true者只以(label, safe)呼叫。有給(非undefined、null)但非函數時建構即同步拋錯(invalid opt.funLog)
 * @returns {Object} 回傳事件物件，可監聽clientEnter、clientLeave、clientChange、error事件，並保留instWConverServer原有之execute、upload、download、handler事件；另掛載broadcast、getClients、getMessages、clearBroadcast函數。本套件只處理函數名為[sys:polling]之execute，其他函數名須由應用端自行註冊execute監聽並回應，否則該請求懸置至前端逾時；本套件之execute監聽須先於「對所有函數名皆回應」之監聽註冊，否則輪詢由該監聽回應。輪詢之clientId須為非空字串，任意字串(含__proto__、constructor、含.或[]者)皆為一般識別，回覆一律為陣列；clientId不是非空字串者拒絕該次輪詢([sys:polling] invalid clientId)，不發事件、不建立在線身分。clientEnter與clientLeave帶(clientId, data)，clientEnter之data為該客戶端首次輪詢時所送之輸入物件，clientLeave之data為其最後一次輪詢時所送者(兩者皆已剝除token鍵__sysToken__，不論是否提供opt.verifyPolling)；clientChange帶當前存活客戶端數量(含剛輪詢而尚未發出clientEnter者)。broadcast以呼叫當下之值(複製)廣播給當前在線之客戶端，data須可序列化(同通訊服務之規則)，否則同批廣播於輪詢時遺失。在線逾時固定10秒，傳遞為至多一次：客戶端兩次成功輪詢之間隔達10秒時視為離線並丟棄其未取走之廣播，回覆送不到(例如不可序列化之data、傳輸失敗)時同批之廣播遺失。偵測到客戶端離線(在線逾時)時，先刪除該clientId之佇列與其未取走之廣播，才發出clientLeave與clientChange(事件於其後約1ms脫勾派發)：故clientLeave發出時離線前之廣播已不在任何佇列(getMessages已無該離線前之佇列)，其後(含於clientLeave監聽內)以同一clientId輪詢者取得新的空佇列，取不到離線前之遺留廣播，離線後、重新輪詢前之廣播亦不進入舊佇列；使用端因此可於clientLeave解除clientId與身分之綁定，不致使他人其後以同一clientId取得離線者遺留之廣播。若同一clientId於偵測到離線後、clientLeave派發前(約1ms內)已重新輪詢，則getMessages所見為該次重新進入之新佇列(僅含離線後之廣播)。注入opt.verifyPolling時，驗證在途而跨過離線者於放行時才取用佇列(取得新的空佇列)，鉤子須於在線逾時內結算，否則其放行結果可能於同一clientId已被他人重新綁定後才生效(本套件不內建鉤子逾時)。clearBroadcast停止時補發之clientLeave，發出時佇列同樣已清空(停止為終態，其後不再回應輪詢)。clearBroadcast為停止並釋放：清除本套件之計時器與在線偵測(行程可立即結束)、移除所掛之execute監聽(其後不再回應輪詢，含於同一次execute派發中先註冊之監聽內停止者；停止後之輪詢由同一事件物件上其他execute監聽回應，無其他監聽時由通訊服務立即拒絕，另有不回應[sys:polling]之監聽時懸置至前端逾時)，並對已送達clientEnter而尚未送達clientLeave之客戶端補發clientLeave與clientChange使進出成對；停止前已排定而尚未送達之事件不再派發，補發之後不再派發本套件之事件，惟呼叫當下那次派發之其餘監聽器仍會收到；停止後之監聽器拋錯(含補發事件之監聽器)以診斷輸出輸出(見opt.logDetail、opt.funLog)；停止後broadcast無作用、getClients回傳[]、getMessages回傳{}，可重複呼叫。getMessages回傳以clientId為鍵之一般物件(複製)。error事件之內容一律為{ msg, err }，msg為描述字串、err為原因(原始錯誤或出錯之值)：輪詢處理失敗為{ msg: '[sys:polling] error', err }；注入opt.verifyPolling時，鉤子回傳非true而拒絕為{ msg: '[sys:polling] permission denied', err }(err為鉤子之回傳值)，鉤子本身拋錯或reject而拒絕為{ msg: '[sys:polling] verifyPolling error', err }(err為所拋之值)，每次被拒絕各發一則(遠端大量輪詢時，error事件之數量同被拒絕之輪詢數)；本套件之error於派發當下無error監聽者時改以診斷輸出輸出(預設為console.error只輸出固定標籤與安全摘要{ src, errType, errCode }，不含err之值——其可能含token或使用者識別，例如opt.verifyPolling之回傳值或所拋之值；opt.logDetail為true時輸出遮罩後之細節，opt.funLog給予時只交給它；error事件之內容仍為原值{ msg, err }、不遮罩，使用端自行輸出時須自行處理)；監聽器之同步拋錯不會使行程崩潰，改以error事件通知，內容為{ msg: 'listener of event[x] error', err }(x為事件名、err為所拋之值)；無error監聽者、停止後、或拋錯者本身為error監聽器時，該拋錯改以診斷輸出輸出(label為[w-serv-broadcast] listener of event[x] error，摘要含src為'listener'與name為事件名，不含所拋之值)，監聽器拋錯而error監聽器亦拋錯時，後者亦以診斷輸出輸出(x為error)。惟依EventEmitter規範，同一次派發中先拋錯之監聽器會中止該次派發，其後之監聽器不再被呼叫；async監聽器之reject不被攔截，須由監聽器自行處理
 * @example
 *
 * import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
 * import WServBroadcastServer from './src/WServBroadcastServer.mjs'
 *
 * let opt = {
 *     port: 8080,
 *     apiName: 'api',
 *     pathStaticFiles: '.', //要存取專案資料夾下web.html, 故不能給dist
 *     verifyConn: () => {
 *         return true
 *     },
 * }
 *
 * //instWConverServer
 * let instWConverServer = new WConverhpServer(opt)
 *
 * //instWConverServer, 未提供verifyPolling時任何能通過verifyConn者皆可輪詢; 驗證輪詢之身分須注入verifyPolling(嚴格回傳true才放行), 前端以getToken放入token:
 * //instWConverServer = new WServBroadcastServer(instWConverServer, {
 * //    verifyPolling: async (input) => {
 * //        let userId = await getUserIdByToken(input.__sysToken__) //使用端自行完整驗證token, 並檢查input.clientId歸屬該身分
 * //        return userId !== ''
 * //    },
 * //})
 * instWConverServer = new WServBroadcastServer(instWConverServer)
 *
 * let n = 0
 * setInterval(() => {
 *     n++
 *     instWConverServer.broadcast(`n=${n}`)
 * }, 1500)
 *
 * instWConverServer.on('clientEnter', function(clientId, data) {
 *     console.log(`Server[port:${opt.port}]: clientEnter`, clientId, data)
 * })
 * instWConverServer.on('clientLeave', function(clientId, data) {
 *     console.log(`Server[port:${opt.port}]: clientLeave`, clientId, data)
 * })
 * instWConverServer.on('clientChange', function(numClients) {
 *     console.log(`Server[port:${opt.port}]: clientChange`, numClients)
 * })
 * instWConverServer.on('error', function(err) {
 *     console.log(`Server[port:${opt.port}]: error`, err)
 * })
 * instWConverServer.on('handler', function(data) {
 *     // console.log(`Server[port:${opt.port}]: handler`, data)
 * })
 *
 */
function WServBroadcastServer(instWConverServer, opt = {}) {

    //diag, 診斷輸出(wsemi之getDiag, 見genDiag): opt.logDetail與opt.funLog之型別先檢核(不合即拋錯, 於配置任何資源之前), 本套件之診斷輸出一律經diag, 不直接呼叫console
    //remember為記住token之函數(輪詢輸入之__sysToken__), 使細節輸出中之token遮罩
    let { diag, remember } = genDiag(checkOptLog(opt))

    //check, 未給或非有效物件時改以evem建立不連線之事件物件(族內伺服端同型之設計: 可由emit手動驅動, 與前端之無法輪詢不同)
    if (!iseobj(instWConverServer)) {
        diag('instWConverServer is not an effective object, and set instWConverServer to an EventEmitter')
        instWConverServer = evem()
    }
    //check, 須具本套件會用到之emit、on、off, 於指派屬性、註冊監聽、建立計時器之前檢查
    //why: 原只檢查emit, 缺on者先建立計時器才拋錯而殘留, 缺off者於停止時才拋錯而釋放不完全
    if (!haskey(instWConverServer, 'emit') || !isfun(instWConverServer.on) || !isfun(instWConverServer.off)) {
        throw new Error(`instWConverServer is not an EventEmitter`)
    }

    //verifyPolling, 使用端注入之輪詢身分驗證鉤子, 未給(undefined或null)時不驗證(行為同現行); 於指派屬性、註冊監聽、建立計時器之前檢查
    //why 給了非函數者拋錯: 使用端以為已驗證而實際靜默放行, 與預設拒絕之原則相反(誤設須立即可見)
    let verifyPolling = get(opt, 'verifyPolling')
    if (verifyPolling === undefined || verifyPolling === null) {
        verifyPolling = null
    }
    else if (!isfun(verifyPolling)) {
        throw new Error(`opt.verifyPolling is not a function`)
    }

    //broadcastMessages, 以clientId為鍵之訊息佇列
    //why 用Map: clientId為前端可控之字串, 一般物件加lodash get之路徑語意下, __proto__會改掉字典之原型而使全體廣播遺失, constructor、a.length、a[0]等會讀到非陣列
    let broadcastMessages = new Map()

    //trace, 觀察回調(opt.onTrace), 未給或非函數時為null
    let trace = getTrace(opt)

    //cleared, delivered(已送達使用端之clientEnter而尚未送達clientLeave者 → 其data, 供停止時補發)
    //why 以送達為準: 本套件之派發較在線偵測晚1ms, 以在線偵測之狀態補發會出現使用端未收到clientEnter卻收到clientLeave
    let cleared = false
    let delivered = new Map()

    //eeEmit, 派發、停止閘門與error事件格式見genEeEmit
    let eeEmit = genEeEmit(instWConverServer, {
        isCleared: () => cleared,
        diag,
        onDeliver: (name, args) => {
            if (name === 'clientEnter') {
                delivered.set(args[0], args[1])
            }
            else if (name === 'clientLeave') {
                delivered.delete(args[0])
            }
        },
        trace,
    })

    //ea, 在線偵測; 觀察回調轉交其事件(evType為alive之type)
    let optAlive = {}
    if (trace) {
        optAlive.onTrace = ({ type, ...info }) => {
            trace('alive', { evType: type, ...info })
        }
    }
    let ea = alive(optAlive)

    //message
    ea.on('message', function({ eventName, key, data, now }) {
        //console.log({ eventName, key, data, now })
        if (eventName === 'enter') {
            eeEmit('clientEnter', key, data)
        }
        else if (eventName === 'leave') {
            //先刪除該clientId之佇列與訊息, 才發出clientLeave與clientChange: 使用端常於clientLeave解除clientId與身分之綁定, 若佇列留到之後才刪(原由修剪計時器於最多1秒後刪除), 他人於此期間以同一clientId輪詢即取得離線者遺留之廣播
            //離線者無在線身分, 其佇列本即無用; 此後以同一clientId輪詢者由poll建立新的空佇列
            broadcastMessages.delete(key)

            //leave已排定而尚未送達者, 停止時補發須帶此data(在線偵測之最後輸入), 與在線逾時之clientLeave一致
            if (delivered.has(key)) {
                delivered.set(key, data)
            }
            eeEmit('clientLeave', key, data)
        }
        eeEmit('clientChange', now)
    })

    //msgDenied, 拒絕輪詢時回前端之固定訊息, 不隨拒絕原因而異(原因只經error事件供稽核)
    //msgVerifyErr, 鉤子本身拋錯或reject時之error事件訊息, 以與鉤子明確回傳非true者區分
    let msgDenied = '[sys:polling] permission denied'
    let msgVerifyErr = '[sys:polling] verifyPolling error'

    //verify, 呼叫使用端之verifyPolling, 回傳promise且永不reject: { pass: true }或{ pass: false, msg, err }
    //傳入輸入之複本(鉤子之改動不影響後續所用之輸入); 嚴格true才放行, 其他值、拋錯(同步或非同步)皆拒絕
    //executor同步執行, 故鉤子於onExecute內即被呼叫(早於任何副作用)
    let verify = (input) => {
        return new Promise((resolve) => {
            resolve(verifyPolling(cloneDeep(input)))
        })
            .then((v) => {
                if (v === true) {
                    return { pass: true }
                }
                return { pass: false, msg: msgDenied, err: v }
            }, (err) => {
                return { pass: false, msg: msgVerifyErr, err }
            })
    }

    //poll, 輪詢之全部副作用(取出訊息、建立佇列、建立或刷新在線身分、回覆)皆在此; 注入verifyPolling時須於驗證放行之後才呼叫
    //data為交給在線偵測之輸入(即clientEnter、clientLeave之data)
    let poll = (clientId, data, pm) => {

        //polling messages, 訊息已於broadcast時複製, 取出後清空
        let pms = broadcastMessages.get(clientId) || []
        broadcastMessages.set(clientId, [])

        //trigger
        ea.trigger(clientId, data)

        //resolve
        pm.resolve(pms)

    }

    //failPoll, 輪詢處理失敗之單一出口
    let failPoll = (err, pm) => {
        eeEmit('error', { msg: '[sys:polling] error', err })
        pm.reject('[sys:polling] error')
    }

    //onExecute, 具名以供clearBroadcast移除
    let onExecute = function(func, input, pm) {

        //check, 已停止者不處理: 停止可能發生於同一次execute派發中先註冊之監聽內, 此時本監聽雖已移除仍會被呼叫(eventemitter3走派發開始時之監聽清單)
        if (cleared) {
            return
        }

        //check, 只處理[sys:polling], 其他函數名由應用端之監聽回應
        if (func !== '[sys:polling]') {
            return
        }

        // console.log(`execute: [sys:polling]`, input)
        try {

            //snap, 輸入之快照(深複製, 保留循環參照), 此後的clientId、傳給鉤子之輸入與交使用端之data皆取自快照, 不再讀原輸入物件
            //取快照之時機: ①已提供verifyPolling(why: 檢查之值須即使用之值; 驗證期間同一input物件〔同一事件物件上各execute監聽共用〕可能被其他監聽器改動, 或其屬性為getter而每次讀取不同)
            //  ②輸入含自有鍵__sysToken__(why: 憑證不得進入交使用端之事件資料, 不論是否提供鉤子; 取副本去鍵, 不改動呼叫端之原物件)
            //  其餘(未提供verifyPolling且不含該鍵)仍取原輸入, 行為同現行(輸入原物件交付)
            let snap = input
            if (verifyPolling !== null || (typeof input === 'object' && input !== null && Object.prototype.hasOwnProperty.call(input, pollingTokenKey))) {
                snap = cloneDeep(input)
            }

            //clientId, 須為非空字串; 不合者只拒絕, 不發事件(避免遠端灌爆error)、不寫入佇列、不交給在線偵測
            let clientId = get(snap, 'clientId')
            // console.log('clientId', clientId)
            if (!isestr(clientId)) {
                pm.reject('[sys:polling] invalid clientId')
                return
            }

            //remember, 記住輪詢輸入之token(讀自快照), 其後診斷輸出之細節中該字串遮罩為***
            remember(get(snap, pollingTokenKey))

            //未提供verifyPolling, 同步處理(行為同現行): 輸入含__sysToken__者已取副本, 剝除其鍵後交付; 不含者snap即原輸入
            if (verifyPolling === null) {
                if (snap !== input) {
                    delete snap[pollingTokenKey]
                }
                poll(clientId, snap, pm)
                return
            }

            //已提供verifyPolling, 驗證放行之後才有任何副作用(建立佇列、在線身分、取出訊息)
            verify(snap)
                .then((r) => {

                    //check, 驗證期間已停止者不處理: 不建立任何狀態、不發任何事件、不回應(同停止後才到之輪詢)
                    if (cleared) {
                        return
                    }

                    //拒絕: 固定訊息回前端(不洩漏原因), 原因只經error事件供稽核; 不建立任何狀態
                    if (!r.pass) {
                        eeEmit('error', { msg: r.msg, err: r.err })
                        pm.reject(msgDenied)
                        return
                    }

                    //放行: 於快照上剝除token後交使用端(clientEnter等); 快照為本實體私有, 直接刪除其鍵, 故巢狀或循環參照所指亦為已剝除者
                    delete snap[pollingTokenKey]
                    poll(clientId, snap, pm)

                })
                .catch((err) => {
                    //放行後之處理或回覆失敗: 未停止者以輪詢處理失敗通知並拒絕該次輪詢(使請求不懸置); 回覆本身再拋錯者只通知, 以免成為未處理的rejection而使行程崩潰
                    if (cleared) {
                        return
                    }
                    try {
                        failPoll(err, pm)
                    }
                    catch (err2) {
                        eeEmit('error', { msg: '[sys:polling] error', err: err2 })
                    }
                })

        }
        catch (err) {
            // console.log('[sys:polling] error', err)
            failPoll(err, pm)
        }
    }

    //broadcast, 以呼叫當下之值(複製一次)推入各在線客戶端之佇列
    let broadcast = (data) => {

        //check, 已停止者無作用
        if (cleared) {
            return
        }

        let msg = {
            mode: 'broadcast',
            data: cloneDeep(data),
        }
        broadcastMessages.forEach((v) => {
            v.push(msg)
        })

    }

    //getMessages, 回傳一般物件(以fromEntries建立, 任意clientId皆為自有屬性), 使用cloneDeep避免外部修改內部數據
    let getMessages = () => {
        return Object.fromEntries(Array.from(broadcastMessages, ([k, v]) => [k, cloneDeep(v)]))
    }

    //clearBroadcast, 停止並釋放, 可重複呼叫
    //why: 原只清廣播計時器, 在線偵測之計時器要到全部客戶端逾時(預設10秒)才自行清除, 期間撐住行程且停止後仍派發clientLeave; 停止後才到之輪詢亦會再啟動在線偵測
    let t = null
    let clearBroadcast = () => {

        //check, 已停止則不再處理
        if (cleared) {
            return
        }
        cleared = true

        //停止修剪廣播訊息之計時器
        if (t !== null) {
            clearInterval(t)
            t = null
        }

        //移除execute監聽, 停止後不再回應輪詢, 亦不再啟動在線偵測
        instWConverServer.off('execute', onExecute)

        //清空廣播訊息, 其後broadcast無作用; 須先於補發clientLeave(離線時先清佇列再發事件, 與在線逾時之leave一致)
        broadcastMessages = new Map()

        //釋放在線偵測; 補發以已送達clientEnter而尚未送達clientLeave者為準, data取在線偵測之最後輸入
        let latest = new Map(map(ea.get(), (v) => [v.key, v.data]))
        ea.clear()
        let n = delivered.size
        let nFinal = n
        for (let [key, data] of Array.from(delivered)) {
            n--
            eeEmit.final('clientLeave', key, latest.has(key) ? latest.get(key) : data)
            eeEmit.final('clientChange', n)
        }
        delivered.clear()

        //stop, 補發已排定後通知(此後除進行中之派發與補發事件外不再通知)
        if (trace) {
            trace('stop', { final: nFinal })
        }

    }

    //save, 先指派屬性再註冊監聽、建立計時器: 指派失敗(例如不可擴充之物件)時不殘留監聽與計時器
    instWConverServer.getClients = ea.get
    instWConverServer.getMessages = getMessages
    instWConverServer.broadcast = broadcast
    instWConverServer.clearBroadcast = clearBroadcast

    //execute, 先註冊監聽再建立計時器: 註冊失敗時不殘留計時器
    instWConverServer.on('execute', onExecute)

    //修剪已離線客戶端之佇列: 離線時已於在線偵測之leave內先刪(見上), 此為保底(計時器數量與停止語意維持不變)
    t = setInterval(() => {
        let keys = new Set(map(ea.get(), 'key'))
        let nRemoved = 0
        for (let k of Array.from(broadcastMessages.keys())) {
            if (!keys.has(k)) {
                broadcastMessages.delete(k)
                nRemoved++
            }
        }
        if (trace) {
            trace('prune', { queues: broadcastMessages.size, removed: nRemoved })
        }
    }, 1000)

    return instWConverServer
}


export default WServBroadcastServer
