import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import genID from 'wsemi/src/genID.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import cint from 'wsemi/src/cint.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import genEeEmit from './genEeEmit.mjs'
import pollingTokenKey from './pollingTokenKey.mjs'


/**
 * 瀏覽器端之資料控制與廣播器
 *
 * 身分驗證責任：本套件不驗證身分(token)，只依opt.getToken於每次輪詢之輸入帶使用端提供之token；驗證一律由伺服端使用端注入之WServBroadcastServer之opt.verifyPolling負責，未提供getToken時輪詢不帶token，伺服端未注入verifyPolling時任何能通過通訊層者皆可輪詢(預設為放行)。使用端須自行完整驗證，包含連線之token、輪詢之身分與各函數之授權。
 *
 * @class
 * @param {Object} instWConverClient 輸入通訊服務實體物件，須為具emit、on與execute函數之eventemitter3事件物件(例如wsemi之evem所建立者)，可使用例如WConverhpClient等建立；未給、非事件物件(無emit或on)或無execute函數時，因無法輪詢而於建構時拋錯。通訊物件上之clientId(非空字串)可自訂本前端之識別，須唯一，否則與他人互相取走訊息，未給則隨機產生。同一通訊物件只能建立一個本前端，重建前須先呼叫clearBroadcast。本套件以execute('[sys:polling]', { clientId }, cbProgress, { signal })輪詢，第4參數之signal供停止時中止在途之輪詢(見clearBroadcast)，包裝通訊物件之execute者須原樣轉交第4參數；通訊物件須於每次呼叫結束移除其掛於該signal之監聽，且該監聽不得拋錯(於Node以uncaughtException結束行程)，WConverhpClient 2.1.8以上皆符合；須執行環境內建AbortController(Chrome 66、Firefox 57、Safari 11.1、Edge 16、Node 14.17以上)，否則建構時拋錯
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Integer} [opt.timePolling=2000] 輸入每次輪詢間隔時間正整數，單位為毫秒ms，預設2000，0與無效值取預設，超過計時器上限2147483647者夾至上限；須明顯小於伺服端之在線逾時(固定10秒)，否則伺服端會判定斷線並丟棄期間之廣播
 * @param {Function} [opt.getToken=null] 輸入取得token之函數(sync或async皆可)，由使用端提供，預設null(輪詢輸入不帶token，恰為{ clientId }，行為同未提供本選項時)。給予函數時，每輪輪詢前呼叫(不帶參數)，將其回傳之字串放於輪詢輸入之固定鍵__sysToken__(非字串取空字串)，供伺服端opt.verifyPolling驗證，伺服端交使用端監聽(clientEnter等)之前剝除此鍵(不論是否提供verifyPolling，放行後才交付)；每輪重新取得，故token可輪替。getToken拋錯或reject時該輪不發出輪詢，以{ msg: '[sys:polling] error', err }通知並轉為未連線，下一輪重新取得；取得token期間呼叫clearBroadcast者，其後不發出輪詢、不派發事件(本套件不中止使用端之getToken，惟其結果被丟棄)。token隨每次輪詢明文送出，傳輸安全(例如HTTPS)由使用端與通訊層負責。給了非函數(undefined與null除外)時建構拋錯(opt.getToken is not a function)
 * @param {Function} [opt.onTrace=null] 輸入觀察回調函數，格式為(e)=>{}，預設null(未給或非函數時不組事件物件，行為、時序與效能同未提供)，供測試與診斷以事件(而非等待毫秒)同步。於內部事件發生當下同步呼叫，e為凍結之事件物件{ type, ... }(欄位皆為原始值)；回調不帶接收者呼叫，其同步拋錯與回傳之rejection皆忽略，不影響輪詢與結果，回傳值不使用。type有：start(建構完成起輪詢，ms為輪詢間隔)、tick(輪詢計時器每次觸發，n為已開始之輪數，skipped為前一輪尚在途而本次略過〔不重入〕)、request(對通訊物件發出第n輪之輪詢，token為輸入是否帶token〔getToken〕；getToken拋錯或reject之該輪不發出)、result(第n輪結果，reason為'ok'〔合格回應，msgs為回應之訊息數〕、'invalid'〔回應不合協定〕或'error'〔execute之reject、同步拋錯、未回傳Promise、getToken拋錯或reject〕，ok為reason是否為'ok'；皆早於該輪對應事件之派發)、emit(本套件事件已排定於1ms後派發，name為事件名)、deliver(事件已派發而監聽器皆已呼叫完，name為事件名，ok為監聽器是否皆未拋錯，final恆為false)、report(本套件改以error事件或console.error通報：src為'listener'〔監聽器拋錯，name為其事件名〕或'error'〔本套件自發之error於無error監聽者〕，msg為其描述字串，via為'event'或'console')、stop(clearBroadcast首次呼叫完成，inflight為停止時是否有在途之輪詢)。停止後除停止當下已在進行之那次派發之deliver與report外不再通知；停止前已排定而於停止後被閘門丟棄之事件不通知
 * @returns {Object} 回傳事件物件，可監聽openOnce、open、broadcast、error事件，另掛載clearBroadcast函數供停止輪詢。輪詢回應須為陣列且元素皆為具字串mode之物件(本套件伺服端之回覆形狀)，否則整包視為輪詢失敗(err為回應原值)且不視為已連線；只派發mode為broadcast之訊息，其他mode略過。openOnce於第一次收到合格回應時發出一次；open於由未連線轉為連線時發出(首次或失敗後恢復)；broadcast帶伺服端所廣播之data。每輪輪詢失敗(含通訊物件execute之reject〔例如被伺服端opt.verifyPolling以固定訊息[sys:polling] permission denied拒絕〕、同步拋錯、未回傳Promise、getToken拋錯或reject，及回應不合協定)發一則{ msg: '[sys:polling] error', err }並轉為未連線，恢復時再發open，不另提供斷線事件；同一事件物件上另有通訊物件自身之error(例如WConverhpClient每次嘗試失敗之訊息)，不代表該輪失敗。傳遞為至多一次：兩次成功輪詢之間隔達伺服端在線逾時、或伺服端之回覆送不到時，期間或同批之廣播遺失。clearBroadcast為停止並釋放，可重複呼叫，其後不再派發本套件之事件(含停止前已排定、停止時在途之輪詢結果)，並中止停止時在途之輪詢請求：通訊物件支援execute之opt.signal者(例如WConverhpClient 2.1.8以上)，該請求不再重試、不再發出其error與重試訊息、不再呼叫getToken，停止後本套件除已排定之派發計時器(1ms內觸發而不派發)外不再持有計時器與在途之請求(行程可立即結束)；伺服端已開始處理之該次輪詢照常完成，其取走之廣播隨之遺失(同傳遞為至多一次)；通訊物件不支援者(例如WConverhpClient 2.1.7以前)，該請求照常完成或重試並發出其自身之error，惟其結果不派發。中止只及於本套件之輪詢請求，同一事件物件上之其他呼叫不受影響；於監聽器內呼叫clearBroadcast時，該次派發(含通訊物件之error事件)之其餘監聽器仍會收到該事件；停止後之監聽器拋錯以console.error輸出。error事件之內容一律為{ msg, err }，msg為描述字串、err為原因(原始錯誤或出錯之值)；本套件之error於派發當下無error監聽者時改以console.error輸出；監聽器之同步拋錯不會使行程崩潰，改以error事件通知，內容為{ msg: 'listener of event[x] error', err }(x為事件名、err為所拋之值)，無error監聽者時改以console.error輸出；error監聽器自身拋錯亦以console.error輸出。惟依EventEmitter規範，同一次派發中先拋錯之監聽器會中止該次派發，其後之監聽器不再被呼叫；async監聽器之reject不被攔截，須由監聽器自行處理
 * @example
 *
 * import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
 * import WServBroadcastClient from './src/WServBroadcastClient.mjs'
 *
 * let opt = {
 *     url: 'http://localhost:8080',
 *     apiName: 'api',
 * }
 *
 * //instWConverClient
 * let instWConverClient = new WConverhpClient(opt)
 *
 * //instWConverClient, 伺服端注入verifyPolling驗證輪詢之身分時, 以getToken提供token:
 * //instWConverClient = new WServBroadcastClient(instWConverClient, { getToken: () => localStorage.getItem('token') })
 * instWConverClient = new WServBroadcastClient(instWConverClient)
 *
 * instWConverClient.on('broadcast', function(data) {
 *     console.log(`broadcast`, data)
 * })
 * instWConverClient.on('openOnce', function() {
 *     console.log(`openOnce`)
 * })
 * instWConverClient.on('open', function() {
 *     console.log(`open`)
 * })
 * instWConverClient.on('error', function(err) {
 *     console.log(`error`, err)
 * })
 *
 */
function WServBroadcastClient(instWConverClient, opt = {}) {

    //check, 須為可輪詢之通訊物件: 未給、非事件物件或無execute函數者永遠無法輪詢, 故於建構時即拋錯
    //why: 原於未給時改用evem建立之事件物件, 其無execute, 輪詢計時器每次呼叫皆失敗(修正前更於計時器內拋錯而使行程崩潰)
    if (!iseobj(instWConverClient)) {
        throw new Error(`instWConverClient is not an effective object`)
    }
    //on為使用端監聽本套件事件所需, 一併檢查
    if (!haskey(instWConverClient, 'emit') || !isfun(instWConverClient.on)) {
        throw new Error(`instWConverClient is not an EventEmitter`)
    }
    if (!isfun(instWConverClient.execute)) {
        throw new Error(`instWConverClient.execute is not a function`)
    }
    //AbortController, 停止時中止在途之輪詢所需(見clearBroadcast); 於配置任何資源之前檢查, 缺者以描述性錯誤拋出(同上列檢查)
    if (typeof AbortController !== 'function') {
        throw new Error(`AbortController is not available`)
    }

    //getToken, 使用端提供之token取得函數(sync或async皆可), 未給(undefined或null)時輪詢輸入不帶token(行為同現行); 於配置任何資源之前檢查
    //why 給了非函數者拋錯: 使用端以為輪詢已帶token而實際未帶, 伺服端驗證鉤子拒絕後每輪失敗卻難以追查
    let getToken = get(opt, 'getToken')
    if (getToken === undefined || getToken === null) {
        getToken = null
    }
    else if (!isfun(getToken)) {
        throw new Error(`opt.getToken is not a function`)
    }

    //timePolling, 正整數, 夾至計時器上限
    //why: 原允許0而每次計時器觸發即輪詢; 超過計時器上限者Node會改為1ms而密集輪詢(TimeoutOverflowWarning)
    let timePolling = get(opt, 'timePolling')
    if (!ispint(timePolling)) {
        timePolling = 2000
    }
    timePolling = Math.min(cint(timePolling), 2147483647)

    //clientId
    let clientId = get(instWConverClient, 'clientId')
    if (!isestr(clientId)) {
        clientId = genID() //供伺服器識別真實連線使用者
    }

    //trace, 觀察回調(opt.onTrace), 未給或非函數時為null
    let trace = getTrace(opt)

    //eeEmit, 派發、停止閘門與error事件格式見genEeEmit
    let cleared = false
    let eeEmit = genEeEmit(instWConverClient, { isCleared: () => cleared, trace })

    //ac, 本實體輪詢請求之中止控制器: 停止時中止在途之輪詢請求(通訊物件支援execute之opt.signal者, 例如WConverhpClient 2.1.8起)
    //why: 原只丟棄在途之結果, 通訊物件於停止後仍退避重試並發出其error, 行程待其結束; 每實體一個, 只交給本套件之輪詢
    let ac = new AbortController()

    //isValidRes, 輪詢回應須為陣列且元素皆為具字串mode之物件(本套件伺服端之回覆形狀), mode非broadcast者於派發時略過(向前相容)
    //why: 原只要execute有resolve即視為已連線, 非陣列者略過而不報錯, 例如同一事件物件上其他監聽代為回應時, 前端收不到推播亦無error
    let isValidRes = (res) => {
        return isarr(res) && res.every((r) => isobj(r) && isestr(r.mode))
    }

    //clearBroadcast, 停止並釋放, 可重複呼叫; 先指派再起輪詢計時器, 指派失敗(例如通訊物件不可擴充)時不殘留計時器
    let t = null
    let clearBroadcast = () => {
        if (cleared) {
            return
        }
        cleared = true
        if (t !== null) {
            clearInterval(t)
            t = null
        }
        //中止在途之輪詢請求, 須於cleared = true之後: 中止所致之拒絕以微任務送達, 由下方之停止判斷略過
        ac.abort()

        //stop, 停止後最後一個通知(此後除進行中之派發外不再通知)
        if (trace) {
            trace('stop', { inflight: execIng })
        }
    }
    instWConverClient.clearBroadcast = clearBroadcast

    //failPolling, 輪詢失敗之單一出口: 轉為未連線並通知
    let connFirst = false
    let connIng = false
    let execIng = false
    let failPolling = (err) => {
        connIng = false
        eeEmit('error', { msg: '[sys:polling] error', err })
    }

    //execPolling, 對通訊物件發出一次輪詢請求: 進度回呼不取參數, 通訊物件不帶參數呼叫亦不拋錯; 第4參數帶本實體之signal, 停止時中止(不支援opt.signal之通訊物件忽略之)
    let nRound = 0
    let execPolling = (input) => {
        if (trace) {
            trace('request', { n: nRound, token: haskey(input, pollingTokenKey) })
        }
        return instWConverClient.execute('[sys:polling]', input, () => {}, { signal: ac.signal })
    }

    //pollOnce, 一輪輪詢, 回傳通訊物件execute之結果(未回傳Promise者由呼叫端之.then拋錯並以失敗通知)
    //未給getToken: 同步發出, 輸入恰為{ clientId }(行為同現行)
    //給了getToken: 先取得token(同步呼叫, 其拋錯或reject即該輪失敗, 由呼叫端以輪詢失敗通知, 不發出輪詢), 放於固定鍵後發出; 非字串之token取空字串(傳輸時undefined之欄位會消失)
    //取得token期間已停止者不發出輪詢(其後之結果由呼叫端之停止判斷略過)
    let pollOnce = () => {
        if (getToken === null) {
            return execPolling({ clientId })
        }
        return new Promise((resolve) => {
            resolve(getToken())
        })
            .then((token) => {
                if (cleared) {
                    return null
                }
                let pmExec = execPolling({ clientId, [pollingTokenKey]: typeof token === 'string' ? token : '' })

                //check, execute未回傳Promise者視為輪詢失敗(同未給getToken時.then拋錯之處置): 外層Promise會吸收非Promise之回傳值而使其被當成回應
                if (pmExec === null || pmExec === undefined || !isfun(pmExec.then)) {
                    throw new TypeError('instWConverClient.execute did not return a Promise')
                }
                return pmExec
            })
    }

    //setInterval
    t = setInterval(() => {

        //check
        if (execIng) {
            if (trace) {
                trace('tick', { n: nRound, skipped: true })
            }
            return
        }
        execIng = true
        nRound++
        let n = nRound
        if (trace) {
            trace('tick', { n, skipped: false })
        }

        //execute, 以try包住: execute同步拋錯(例如通訊物件無execute)或未回傳Promise時, 於計時器回呼內即成uncaughtException而使行程崩潰, 故改以error事件通知
        //發出方式(進度回呼、第4參數signal、getToken)見execPolling與pollOnce
        try {
            pollOnce()
                .then(function(res) {
                    // console.log('polling res', res)

                    //check, 停止後才回到之結果(含中止所致之拒絕)不處理
                    if (cleared) {
                        return
                    }

                    //check, 不合協定之回應視為輪詢失敗, 不視為已連線
                    if (!isValidRes(res)) {
                        if (trace) {
                            trace('result', { n, ok: false, reason: 'invalid' })
                        }
                        failPolling(res)
                        return
                    }

                    if (trace) {
                        trace('result', { n, ok: true, reason: 'ok', msgs: res.length })
                    }

                    //connFirst
                    if (connFirst === false) {
                        connFirst = true
                        eeEmit('openOnce')
                    }

                    //connIng
                    if (connIng === false) {
                        eeEmit('open')
                    }
                    connIng = true

                    //broadcast, 只派發mode為broadcast者
                    each(res, (r) => {
                        // console.log('polling r', r)
                        if (r.mode === 'broadcast') {
                            eeEmit('broadcast', get(r, 'data', null))
                        }
                    })

                })
                .catch(function (err) {
                    // console.log('polling err', err)

                    //check, 停止後才回到之結果(含中止所致之拒絕)不處理
                    if (cleared) {
                        return
                    }

                    if (trace) {
                        trace('result', { n, ok: false, reason: 'error' })
                    }
                    failPolling(err)
                })
                .finally(() => {
                    execIng = false
                })
        }
        catch (err) {
            if (trace) {
                trace('result', { n, ok: false, reason: 'error' })
            }
            failPolling(err)
            execIng = false
        }

    }, timePolling)

    //start, 計時器已建立
    if (trace) {
        trace('start', { ms: timePolling })
    }

    return instWConverClient
}


export default WServBroadcastClient
