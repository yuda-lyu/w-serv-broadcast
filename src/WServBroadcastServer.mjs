import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import evem from 'wsemi/src/evem.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import alive from 'wsemi/src/alive.mjs'
import genEeEmit from './genEeEmit.mjs'


/**
 * 伺服器端之資料控制與廣播器
 *
 * @class
 * @param {Object} instWConverServer 輸入通訊服務實體物件，須為eventemitter3事件物件(例如wsemi之evem所建立者)，可使用例如WConverhpServer等建立
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @returns {Object} 回傳事件物件，可監聽clientEnter、clientLeave、clientChange、error事件，並保留instWConverServer原有之execute、upload、download、handler事件；另掛載broadcast、getClients、getMessages、clearBroadcast函數。clientEnter與clientLeave帶(clientId, data)，data為該客戶端輪詢時所送之輸入物件；clientChange帶當前存活客戶端數量。clearBroadcast為停止並釋放：清除本套件之計時器與在線偵測(行程可立即結束)、移除所掛之execute監聽(其後不再回應輪詢)，並對已發出clientEnter之客戶端補發clientLeave與clientChange使進出成對，其後不再派發事件；停止後broadcast無作用、getClients回傳[]、getMessages回傳{}，可重複呼叫。error事件之內容一律為{ msg, err }，msg為描述字串、err為原因(原始錯誤或出錯之值)：輪詢處理失敗為{ msg: '[sys:polling] error', err }；監聽器之同步拋錯不會使行程崩潰，改以error事件通知，內容為{ msg: 'listener of event[x] error', err }(x為事件名、err為所拋之值)，無error監聽者時改以console.error輸出；error監聽器自身拋錯亦以console.error輸出。惟依EventEmitter規範，同一次派發中先拋錯之監聽器會中止該次派發，其後之監聽器不再被呼叫；async監聽器之reject不被攔截，須由監聽器自行處理
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
 * //instWConverServer
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
    let broadcastMessages = {}

    //check
    if (!iseobj(instWConverServer)) {
        console.log('instWConverServer is not an effective object, and set instWConverServer to an EventEmitter')
        instWConverServer = evem()
    }
    if (!haskey(instWConverServer, 'emit')) {
        throw new Error(`instWConverServer is not an EventEmitter`)
    }

    //eeEmit, 派發與error事件格式見genEeEmit
    let eeEmit = genEeEmit(instWConverServer)

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

    //onExecute, 具名以供clearBroadcast移除
    let onExecute = function(func, input, pm) {
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
                eeEmit('error', { msg: '[sys:polling] error', err })
                pm.reject('[sys:polling] error')
            }
        }
    }

    //execute
    instWConverServer.on('execute', onExecute)

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

    //clearBroadcast, 停止並釋放, 可重複呼叫
    //why: 原只清廣播計時器, 在線偵測之計時器要到全部客戶端逾時(預設10秒)才自行清除, 期間撐住行程且停止後仍派發clientLeave; 停止後才到之輪詢亦會再啟動在線偵測
    let clearBroadcast = () => {

        //停止修剪廣播訊息之計時器
        clearInterval(t)

        //移除execute監聽, 停止後不再回應輪詢, 亦不再啟動在線偵測
        instWConverServer.off('execute', onExecute)

        //釋放在線偵測, 其回傳已發出enter而尚未leave之客戶端, 對其補發clientLeave與clientChange使進出成對; 再次呼叫回傳[]故不重複補發
        let rs = ea.clear()
        let n = rs.length
        each(rs, (r) => {
            n--
            eeEmit('clientLeave', r.key, r.data)
            eeEmit('clientChange', n)
        })

        //清空廣播訊息, 其後broadcast無對象而無作用
        broadcastMessages = {}

    }

    //save
    instWConverServer.getClients = ea.get
    instWConverServer.getMessages = getMessages
    instWConverServer.broadcast = broadcast
    instWConverServer.clearBroadcast = clearBroadcast

    return instWConverServer
}


export default WServBroadcastServer
