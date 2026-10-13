import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import evem from 'wsemi/src/evem.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import alive from 'wsemi/src/alive.mjs'
import genEeEmit from './genEeEmit.mjs'


/**
 * 伺服器端之資料控制與廣播器
 *
 * @class
 * @param {Object} instWConverServer 輸入通訊服務實體物件，須為具emit、on、off函數之eventemitter3事件物件(例如wsemi之evem所建立者)，可使用例如WConverhpServer等建立；有物件而缺emit、on或off時於建構時拋錯，且不留下任何計時器與監聽；未給或非有效物件時改以evem建立不連線之事件物件(並印出提示)，可由emit('execute', func, input, pm)手動驅動。同一事件物件只能建立一個本伺服器，重建前須先呼叫clearBroadcast
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @returns {Object} 回傳事件物件，可監聽clientEnter、clientLeave、clientChange、error事件，並保留instWConverServer原有之execute、upload、download、handler事件；另掛載broadcast、getClients、getMessages、clearBroadcast函數。本套件只處理函數名為[sys:polling]之execute，其他函數名須由應用端自行註冊execute監聽並回應，否則該請求懸置至前端逾時；本套件之execute監聽須先於「對所有函數名皆回應」之監聽註冊，否則輪詢由該監聽回應。輪詢之clientId須為非空字串，任意字串(含__proto__、constructor、含.或[]者)皆為一般識別，回覆一律為陣列；clientId不是非空字串者拒絕該次輪詢([sys:polling] invalid clientId)，不發事件、不建立在線身分。clientEnter與clientLeave帶(clientId, data)，clientEnter之data為該客戶端首次輪詢時所送之輸入物件，clientLeave之data為其最後一次輪詢時所送者；clientChange帶當前存活客戶端數量(含剛輪詢而尚未發出clientEnter者)。broadcast以呼叫當下之值(複製)廣播給當前在線之客戶端，data須可序列化(同通訊服務之規則)，否則同批廣播於輪詢時遺失。在線逾時固定10秒，傳遞為至多一次：客戶端兩次成功輪詢之間隔達10秒時視為離線並丟棄其未取走之廣播，回覆送不到(例如不可序列化之data、傳輸失敗)時同批之廣播遺失。clearBroadcast為停止並釋放：清除本套件之計時器與在線偵測(行程可立即結束)、移除所掛之execute監聽(其後不再回應輪詢，含於同一次execute派發中先註冊之監聽內停止者；停止後之輪詢由同一事件物件上其他execute監聽回應，無其他監聽時由通訊服務立即拒絕，另有不回應[sys:polling]之監聽時懸置至前端逾時)，並對已送達clientEnter而尚未送達clientLeave之客戶端補發clientLeave與clientChange使進出成對；停止前已排定而尚未送達之事件不再派發，補發之後不再派發本套件之事件，惟呼叫當下那次派發之其餘監聽器仍會收到；停止後之監聽器拋錯(含補發事件之監聽器)以console.error輸出；停止後broadcast無作用、getClients回傳[]、getMessages回傳{}，可重複呼叫。getMessages回傳以clientId為鍵之一般物件(複製)。error事件之內容一律為{ msg, err }，msg為描述字串、err為原因(原始錯誤或出錯之值)：輪詢處理失敗為{ msg: '[sys:polling] error', err }；本套件之error於派發當下無error監聽者時改以console.error輸出；監聽器之同步拋錯不會使行程崩潰，改以error事件通知，內容為{ msg: 'listener of event[x] error', err }(x為事件名、err為所拋之值)，無error監聽者時改以console.error輸出；error監聽器自身拋錯亦以console.error輸出。惟依EventEmitter規範，同一次派發中先拋錯之監聽器會中止該次派發，其後之監聽器不再被呼叫；async監聽器之reject不被攔截，須由監聽器自行處理
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

    //check, 未給或非有效物件時改以evem建立不連線之事件物件(族內伺服端同型之設計: 可由emit手動驅動, 與前端之無法輪詢不同)
    if (!iseobj(instWConverServer)) {
        console.log('instWConverServer is not an effective object, and set instWConverServer to an EventEmitter')
        instWConverServer = evem()
    }
    //check, 須具本套件會用到之emit、on、off, 於指派屬性、註冊監聽、建立計時器之前檢查
    //why: 原只檢查emit, 缺on者先建立計時器才拋錯而殘留, 缺off者於停止時才拋錯而釋放不完全
    if (!haskey(instWConverServer, 'emit') || !isfun(instWConverServer.on) || !isfun(instWConverServer.off)) {
        throw new Error(`instWConverServer is not an EventEmitter`)
    }

    //broadcastMessages, 以clientId為鍵之訊息佇列
    //why 用Map: clientId為前端可控之字串, 一般物件加lodash get之路徑語意下, __proto__會改掉字典之原型而使全體廣播遺失, constructor、a.length、a[0]等會讀到非陣列
    let broadcastMessages = new Map()

    //cleared, delivered(已送達使用端之clientEnter而尚未送達clientLeave者 → 其data, 供停止時補發)
    //why 以送達為準: 本套件之派發較在線偵測晚1ms, 以在線偵測之狀態補發會出現使用端未收到clientEnter卻收到clientLeave
    let cleared = false
    let delivered = new Map()

    //eeEmit, 派發、停止閘門與error事件格式見genEeEmit
    let eeEmit = genEeEmit(instWConverServer, {
        isCleared: () => cleared,
        onDeliver: (name, args) => {
            if (name === 'clientEnter') {
                delivered.set(args[0], args[1])
            }
            else if (name === 'clientLeave') {
                delivered.delete(args[0])
            }
        },
    })

    //ea
    let ea = alive()

    //message
    ea.on('message', function({ eventName, key, data, now }) {
        //console.log({ eventName, key, data, now })
        if (eventName === 'enter') {
            eeEmit('clientEnter', key, data)
        }
        else if (eventName === 'leave') {
            //leave已排定而尚未送達者, 停止時補發須帶此data(在線偵測之最後輸入), 與在線逾時之clientLeave一致
            if (delivered.has(key)) {
                delivered.set(key, data)
            }
            eeEmit('clientLeave', key, data)
        }
        eeEmit('clientChange', now)
    })

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

            //clientId, 須為非空字串; 不合者只拒絕, 不發事件(避免遠端灌爆error)、不寫入佇列、不交給在線偵測
            let clientId = get(input, 'clientId')
            // console.log('clientId', clientId)
            if (!isestr(clientId)) {
                pm.reject('[sys:polling] invalid clientId')
                return
            }

            //polling messages, 訊息已於broadcast時複製, 取出後清空
            let pms = broadcastMessages.get(clientId) || []
            broadcastMessages.set(clientId, [])

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

        //釋放在線偵測; 補發以已送達clientEnter而尚未送達clientLeave者為準, data取在線偵測之最後輸入
        let latest = new Map(map(ea.get(), (v) => [v.key, v.data]))
        ea.clear()
        let n = delivered.size
        for (let [key, data] of Array.from(delivered)) {
            n--
            eeEmit.final('clientLeave', key, latest.has(key) ? latest.get(key) : data)
            eeEmit.final('clientChange', n)
        }
        delivered.clear()

        //清空廣播訊息, 其後broadcast無作用
        broadcastMessages = new Map()

    }

    //save, 先指派屬性再註冊監聽、建立計時器: 指派失敗(例如不可擴充之物件)時不殘留監聽與計時器
    instWConverServer.getClients = ea.get
    instWConverServer.getMessages = getMessages
    instWConverServer.broadcast = broadcast
    instWConverServer.clearBroadcast = clearBroadcast

    //execute, 先註冊監聽再建立計時器: 註冊失敗時不殘留計時器
    instWConverServer.on('execute', onExecute)

    //修剪已離線客戶端之佇列
    t = setInterval(() => {
        let keys = new Set(map(ea.get(), 'key'))
        for (let k of Array.from(broadcastMessages.keys())) {
            if (!keys.has(k)) {
                broadcastMessages.delete(k)
            }
        }
    }, 1000)

    return instWConverServer
}


export default WServBroadcastServer
