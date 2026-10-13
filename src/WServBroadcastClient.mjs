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
import genEeEmit from './genEeEmit.mjs'


/**
 * 瀏覽器端之資料控制與廣播器
 *
 * @class
 * @param {Object} instWConverClient 輸入通訊服務實體物件，須為具emit、on與execute函數之eventemitter3事件物件(例如wsemi之evem所建立者)，可使用例如WConverhpClient等建立；未給、非事件物件(無emit或on)或無execute函數時，因無法輪詢而於建構時拋錯。通訊物件上之clientId(非空字串)可自訂本前端之識別，須唯一，否則與他人互相取走訊息，未給則隨機產生。同一通訊物件只能建立一個本前端，重建前須先呼叫clearBroadcast
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Integer} [opt.timePolling=2000] 輸入每次輪詢間隔時間正整數，單位為毫秒ms，預設2000，0與無效值取預設，超過計時器上限2147483647者夾至上限；須明顯小於伺服端之在線逾時(固定10秒)，否則伺服端會判定斷線並丟棄期間之廣播
 * @returns {Object} 回傳事件物件，可監聽openOnce、open、broadcast、error事件，另掛載clearBroadcast函數供停止輪詢。輪詢回應須為陣列且元素皆為具字串mode之物件(本套件伺服端之回覆形狀)，否則整包視為輪詢失敗(err為回應原值)且不視為已連線；只派發mode為broadcast之訊息，其他mode略過。openOnce於第一次收到合格回應時發出一次；open於由未連線轉為連線時發出(首次或失敗後恢復)；broadcast帶伺服端所廣播之data。每輪輪詢失敗(含通訊物件execute之reject、同步拋錯、未回傳Promise，及回應不合協定)發一則{ msg: '[sys:polling] error', err }並轉為未連線，恢復時再發open，不另提供斷線事件；同一事件物件上另有通訊物件自身之error(例如WConverhpClient每次嘗試失敗之訊息)，不代表該輪失敗。傳遞為至多一次：兩次成功輪詢之間隔達伺服端在線逾時、或伺服端之回覆送不到時，期間或同批之廣播遺失。clearBroadcast為停止並釋放，可重複呼叫，其後不再派發本套件之事件(含停止前已排定、停止時在途之輪詢結果)；惟通訊物件自身之重試與error、呼叫當下那次派發之其餘監聽器，不在此限；停止後之監聽器拋錯以console.error輸出。error事件之內容一律為{ msg, err }，msg為描述字串、err為原因(原始錯誤或出錯之值)；本套件之error於派發當下無error監聽者時改以console.error輸出；監聽器之同步拋錯不會使行程崩潰，改以error事件通知，內容為{ msg: 'listener of event[x] error', err }(x為事件名、err為所拋之值)，無error監聽者時改以console.error輸出；error監聽器自身拋錯亦以console.error輸出。惟依EventEmitter規範，同一次派發中先拋錯之監聽器會中止該次派發，其後之監聽器不再被呼叫；async監聽器之reject不被攔截，須由監聽器自行處理
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
 * //instWConverClient
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

    //eeEmit, 派發、停止閘門與error事件格式見genEeEmit
    let cleared = false
    let eeEmit = genEeEmit(instWConverClient, { isCleared: () => cleared })

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

    //setInterval
    t = setInterval(() => {

        //check
        if (execIng) {
            return
        }
        execIng = true

        //execute, 以try包住: execute同步拋錯(例如通訊物件無execute)或未回傳Promise時, 於計時器回呼內即成uncaughtException而使行程崩潰, 故改以error事件通知
        //進度回呼不取參數, 通訊物件不帶參數呼叫亦不拋錯
        try {
            instWConverClient.execute('[sys:polling]', { clientId }, () => {})
                .then(function(res) {
                    // console.log('polling res', res)

                    //check, 停止後才回到之結果不處理
                    if (cleared) {
                        return
                    }

                    //check, 不合協定之回應視為輪詢失敗, 不視為已連線
                    if (!isValidRes(res)) {
                        failPolling(res)
                        return
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

                    //check, 停止後才回到之結果不處理
                    if (cleared) {
                        return
                    }

                    failPolling(err)
                })
                .finally(() => {
                    execIng = false
                })
        }
        catch (err) {
            failPolling(err)
            execIng = false
        }

    }, timePolling)

    return instWConverClient
}


export default WServBroadcastClient
