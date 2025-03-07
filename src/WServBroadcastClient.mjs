import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import cint from 'wsemi/src/cint.mjs'
import genID from 'wsemi/src/genID.mjs'


/**
 * 瀏覽器端之資料控制與同步器
 *
 * @class
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Object} opt.instWConverClient 輸入通訊服務實體物件，可使用例如WConverhpClient等建立
 * @param {Function} [opt.cbGetToken=()=>''] 輸入取得使用者token的回調函數，預設()=>''
 * @param {Function} opt.cbGetServerMethods 輸入提供操作物件的回調函數，前後端通訊先取得可呼叫函數清單，映射完之後，後端函數都將放入物件當中，key為函數名而值為函數，並通過回調函數提供該物件
 * @param {Function} opt.cbRecvData 輸入取得變更表資料的回調函數
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
        throw new Error(`invalid initWConverhpClient`)
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
    function eeEmit(name, ...args) {
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

    //save bbb

    return initWConverhpClient
}


export default WServBroadcastClient
