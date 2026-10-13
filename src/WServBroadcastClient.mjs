import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import genID from 'wsemi/src/genID.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import cint from 'wsemi/src/cint.mjs'
import genEeEmit from './genEeEmit.mjs'


/**
 * 瀏覽器端之資料控制與廣播器
 *
 * @class
 * @param {Object} instWConverClient 輸入通訊服務實體物件，須為具execute函數之eventemitter3事件物件(例如wsemi之evem所建立者)，可使用例如WConverhpClient等建立；未給、非事件物件或無execute函數時，因無法輪詢而於建構時拋錯
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Integer} [opt.timePolling=2000] 輸入每次輪詢間隔時間整數，預設2000
 * @returns {Object} 回傳事件物件，可監聽openOnce、open、broadcast、error事件，另掛載clearBroadcast函數供停止輪詢。error事件之內容一律為{ msg, err }，msg為描述字串、err為原因(原始錯誤或出錯之值)：輪詢失敗為{ msg: '[sys:polling] error', err }；監聽器之同步拋錯不會使行程崩潰，改以error事件通知，內容為{ msg: 'listener of event[x] error', err }(x為事件名、err為所拋之值)，無error監聽者時改以console.error輸出；error監聽器自身拋錯亦以console.error輸出。惟依EventEmitter規範，同一次派發中先拋錯之監聽器會中止該次派發，其後之監聽器不再被呼叫；async監聽器之reject不被攔截，須由監聽器自行處理。instWConverClient之execute同步拋錯或未回傳Promise時，亦以error事件通知該錯誤，並於下次輪詢時重試
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
    if (!haskey(instWConverClient, 'emit')) {
        throw new Error(`instWConverClient is not an EventEmitter`)
    }
    if (!isfun(instWConverClient.execute)) {
        throw new Error(`instWConverClient.execute is not a function`)
    }

    //timePolling
    let timePolling = get(opt, 'timePolling')
    if (!isp0int(timePolling)) {
        timePolling = 2000
    }
    timePolling = cint(timePolling)

    //clientId
    let clientId = get(instWConverClient, 'clientId')
    if (!isestr(clientId)) {
        clientId = genID() //供伺服器識別真實連線使用者
    }

    //eeEmit, 派發與error事件格式見genEeEmit
    let eeEmit = genEeEmit(instWConverClient)

    //setInterval
    let connFirst = false
    let connIng = false
    let execIng = false
    let t = setInterval(() => {

        //check
        if (execIng) {
            return
        }
        execIng = true

        //execute, 以try包住: execute同步拋錯(例如通訊物件無execute)或未回傳Promise時, 於計時器回呼內即成uncaughtException而使行程崩潰, 故改以error事件通知
        try {
            instWConverClient.execute('[sys:polling]', { clientId },
                function ({ prog, p, m }) {
                    // console.log('client web: execute: prog', prog, p, m)
                })
                .then(function(res) {
                    // console.log('polling res', res)

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

                    //check
                    if (!isearr(res)) {
                        return
                    }

                    each(res, (r) => {
                        // console.log('polling r', r)
                        let data = get(r, 'data', null)
                        eeEmit('broadcast', data)
                    })

                })
                .catch(function (err) {
                    // console.log('polling err', err)
                    connIng = false
                    eeEmit('error', { msg: '[sys:polling] error', err })
                })
                .finally(() => {
                    execIng = false
                })
        }
        catch (err) {
            connIng = false
            eeEmit('error', { msg: '[sys:polling] error', err })
            execIng = false
        }

    }, timePolling)

    //clearBroadcast
    let clearBroadcast = () => {
        clearInterval(t)
    }

    //save
    instWConverClient.clearBroadcast = clearBroadcast

    return instWConverClient
}


export default WServBroadcastClient
