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
 * @returns {Object} 回傳事件物件，可監聽error事件
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
 * //initWConverhpClient
 * let initWConverhpClient = new WConverhpClient(opt)
 *
 * //wo
 * let wo = WServBroadcastClient(initWConverhpClient)
 *
 * wo.on('broadcast', function(data) {
 *     console.log(`broadcast`, data)
 * })
 * wo.on('error', function(err) {
 *     console.log(`error`, err)
 * })
 *
 */
function WServBroadcastClient(initWConverhpClient, opt = {}) {

    //check
    if (!iseobj(initWConverhpClient)) {
        console.log('initWConverhpClient is not an effective object, and set initWConverhpClient to an EventEmitter')
        initWConverhpClient = evem()
    }
    if (!haskey(initWConverhpClient, 'emit')) {
        throw new Error(`initWConverhpClient is not an EventEmitter`)
    }

    //timePolling
    let timePolling = get(opt, 'timePolling')
    if (!isp0int(timePolling)) {
        timePolling = 2000
    }
    timePolling = cint(timePolling)

    //clientId
    let clientId = get(initWConverhpClient, 'clientId')
    if (!isestr(clientId)) {
        clientId = genID() //供伺服器識別真實連線使用者
    }

    //eeEmit
    let eeEmit = (name, ...args) => {
        setTimeout(() => {
            initWConverhpClient.emit(name, ...args)
        }, 1)
    }

    //setInterval
    setInterval(() => {

        //execute
        initWConverhpClient.execute('[sys:polling]', { clientId },
            function (prog, p, m) {
                // console.log('client web: execute: prog', prog, p, m)
            })
            .then(function(res) {
                // console.log('polling res', res)

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
                console.log('polling err', err)
            })

    }, timePolling)

    return initWConverhpClient
}


export default WServBroadcastClient
