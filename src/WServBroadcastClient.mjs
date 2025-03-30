import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import cint from 'wsemi/src/cint.mjs'
import genID from 'wsemi/src/genID.mjs'
import evem from 'wsemi/src/evem.mjs'


/**
 * 瀏覽器端之資料控制與同步器
 *
 * @class
 * @param {Object} instWConverClient 輸入通訊服務實體物件，可使用例如WConverhpClient等建立
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Integer} [opt.timePolling=2000] 輸入每次輪詢間隔時間整數，預設2000
 * @returns {Object} 回傳事件物件，可監聽open、openOnce、error事件
 * @example
 *
 * import FormData from 'form-data'
 * import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
 * import WServBroadcastClient from './src/WServBroadcastClient.mjs'
 *
 * let opt = {
 *     FormData,
 *     url: 'http://localhost:8080',
 *     apiName: 'api',
 * }
 *
 * //instWConverClient
 * let instWConverClient = new WConverhpClient(opt)
 *
 * //wo
 * let wo = new WServBroadcastClient(instWConverClient)
 *
 * wo.on('broadcast', function(data) {
 *     console.log(`broadcast`, data)
 * })
 * wo.on('error', function(err) {
 *     console.log(`error`, err)
 * })
 *
 */
function WServBroadcastClient(instWConverClient, opt = {}) {

    //check
    if (!iseobj(instWConverClient)) {
        console.log('instWConverClient is not an effective object, and set instWConverClient to an EventEmitter')
        instWConverClient = evem()
    }
    if (!haskey(instWConverClient, 'emit')) {
        throw new Error(`instWConverClient is not an EventEmitter`)
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

    //eeEmit
    let eeEmit = (name, ...args) => {
        setTimeout(() => {
            instWConverClient.emit(name, ...args)
        }, 1)
    }

    //setInterval
    let connFirst = false
    let connIng = false
    setInterval(() => {

        //execute
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
                eeEmit('error', err)
            })

    }, timePolling)

    return instWConverClient
}


export default WServBroadcastClient
