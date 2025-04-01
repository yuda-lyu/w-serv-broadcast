import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import alive from 'wsemi/src/alive.mjs'
import evem from 'wsemi/src/evem.mjs'


/**
 * 伺服器端之資料控制與同步器
 *
 * @class
 * @param {Object} instWConverServer 輸入通訊服務實體物件，可使用例如WConverhpServer等建立
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @returns {Object} 回傳事件物件，可監聽error事件
 * @example
 *
 * import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
 * import WServBroadcastServer from './src/WServBroadcastServer.mjs'
 *
 * let opt = {
 *     port: 8080,
 *     apiName: 'api',
 *     pathStaticFiles: '.', //要存取專案資料夾下web.html, 故不能給dist
 *     funCheck: () => {
 *         return true
 *     },
 * }
 *
 * //instWConverServer
 * let instWConverServer = new WConverhpServer(opt)
 *
 * //wo
 * let wo = new WServBroadcastServer(instWConverServer)
 *
 * let n = 0
 * setInterval(() => {
 *     n++
 *     wo.broadcast(`n=${n}`)
 * }, 1500)
 *
 * wo.on('clientEnter', function(data) {
 *     console.log(`Server[port:${opt.port}]: clientEnter`, data)
 * })
 * wo.on('clientLeave', function(data) {
 *     console.log(`Server[port:${opt.port}]: clientLeave`, data)
 * })
 * wo.on('clientChange', function(data) {
 *     console.log(`Server[port:${opt.port}]: clientChange`, data)
 * })
 * wo.on('broadcast', function(data) {
 *     console.log(`Server[port:${opt.port}]: broadcast`, data)
 * })
 * wo.on('error', function(err) {
 *     console.log(`Server[port:${opt.port}]: error`, err)
 * })
 * wo.on('handler', function(data) {
 *     // console.log(`Server[port:${opt.port}]: handler`, data)
 * })
 *
 */
function WServBroadcastServer(instWConverServer, opt = {}) {
    let broadcastMessages = {}

    //check
    if (!iseobj(instWConverServer)) {
        console.log('instWConverServer is not an effective object, and set instWConverServer to an EventEmitter')
        instWConverServer = evem()
    }
    if (!haskey(instWConverServer, 'emit')) {
        throw new Error(`instWConverServer is not an EventEmitter`)
    }

    //eeEmit
    let eeEmit = (name, ...args) => {
        setTimeout(() => {
            instWConverServer.emit(name, ...args)
        }, 1)
    }

    //ea
    let ea = alive()

    //ea broadcastMessages
    let t = setInterval(() => {

        //now alive
        let nowAlive = ea.get()
        //console.log('nowAlive', nowAlive)

        //clientIds
        let clientIds = map(nowAlive, 'key')
        //console.log('clientIds', clientIds)

        //pick
        let t = {}
        each(clientIds, (clientId) => {
            t[clientId] = get(broadcastMessages, clientId, [])
        })
        broadcastMessages = t
        // console.log('broadcastMessages', broadcastMessages)

    }, 1000)

    //message
    ea.on('message', function({ eventName, key, data, now }) {
        //console.log({ eventName, key, data, now })
        if (eventName === 'enter') {
            eeEmit('clientEnter', key, data)
        }
        else if (eventName === 'leave') {
            eeEmit('clientLeave', key, data)
        }
        eeEmit('clientChange', now)
    })

    //execute
    instWConverServer.on('execute', function(func, input, pm) {
        if (func === '[sys:polling]') {
            // console.log(`execute: [sys:polling]`, input)
            try {

                //clientId
                let clientId = get(input, 'clientId', '')
                // console.log('clientId', clientId)

                //polling messages
                let pms = get(broadcastMessages, clientId, [])
                pms = cloneDeep(pms)

                //clear messages
                broadcastMessages[clientId] = []

                //trigger
                ea.trigger(clientId, input)

                //resolve
                pm.resolve(pms)

            }
            catch (err) {
                // console.log('[sys:polling] error', err)
                eeEmit('error', err)
                pm.reject('[sys:polling] error')
            }
        }
    })

    //broadcast
    let broadcast = (data) => {

        //check, broadcastMessages受ea偵測頻率1s影響, 伺服器初始化後至少需1s才會有有效對象
        if (!iseobj(broadcastMessages)) {
            return
        }

        //modify broadcast data
        let t = {}
        each(broadcastMessages, (v, k) => {

            //push, 數據為陣列, 加入新廣播數據
            v.push({
                mode: 'broadcast',
                data,
            })

            //save
            t[k] = v

        })
        broadcastMessages = t

    }

    //getMessages
    let getMessages = () => {
        return cloneDeep(broadcastMessages) //使用cloneDeep避免外部修改內部數據
    }

    //clearBroadcast
    let clearBroadcast = () => {
        clearInterval(t)
    }

    //save
    instWConverServer.getClients = ea.get
    instWConverServer.getMessages = getMessages
    instWConverServer.broadcast = broadcast
    instWConverServer.clearBroadcast = clearBroadcast

    return instWConverServer
}


export default WServBroadcastServer
