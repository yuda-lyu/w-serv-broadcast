import fs from 'fs'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastClient from '../../src/WServBroadcastClient.mjs'


//本檔為測試用之子行程(不含測試案例, 由test/api-broadcast-polling.test.mjs以子行程執行): 以真WConverhpClient(retryMain預設3)建立本套件前端,
//依W_KASE於指定時點呼叫clearBroadcast, 停止後不呼叫process.exit, 讓事件迴圈自然清空(停止至行程結束之時間須於子行程內量測);
//於exit事件輸出一行'RESULT:'+JSON(各輸出之時點以毫秒計, 相對於本行程開始), 另於停止時輸出一行'CLEARED'、收到open時輸出一行'OPEN', 供母行程同步伺服端之動作
//W_KASE: backoff(連不上, 第1則通訊物件error後150ms停止, 即退避中)、inflight(第1次輪詢送出後200ms停止, 伺服端不回應)、
//reentrant(於第1則通訊物件error之監聽器內同步停止)、idle(連上且2次輪詢皆已結束後停止)、ghost(同backoff, 供母行程於停止後重啟伺服端)、
//token(第1次getToken懸置800ms, 第1次輪詢送出後200ms停止)
//W_STRIP4=1: 模擬不支援opt.signal之通訊物件(execute只取3個參數, 如w-converhp 2.1.7以前)
//W_TIMEOUT: 通訊物件每次嘗試之逾時(未給取預設); W_PORT: 伺服端之埠


let env = process.env
let t0 = Date.now()
let rel = () => Date.now() - t0

let out = { tClear: null, tExit: null, commErrs: [], ours: [], retryLogs: [], tokens: [], unhandled: 0, settledAtClear: null }

//console.log, 記錄w-converhp之重試訊息(wait ... to retry、retry n=...), 其餘照常輸出
let log0 = console.log
console.log = (...args) => {
    let s = args.map((a) => String(a)).join(' ')
    if (s.includes('retry')) {
        out.retryLogs.push(rel())
        return
    }
    log0(...args)
}
process.on('unhandledRejection', () => {
    out.unhandled++
})
process.on('exit', () => {
    out.tExit = rel()
    fs.writeSync(1, 'RESULT:' + JSON.stringify(out) + '\n')
})

//getToken, 記錄通訊物件每一次請求嘗試對getToken之呼叫(含重試); W_KASE為token時第1次呼叫懸置800ms(應用端取token慢)
let getToken = () => {
    out.tokens.push(rel())
    if (env.W_KASE === 'token' && out.tokens.length === 1) {
        return new Promise((resolve) => setTimeout(() => resolve(''), 800))
    }
    return ''
}
let opt = { url: `http://localhost:${env.W_PORT}`, apiName: 'api', getToken }
if (env.W_TIMEOUT) {
    opt.timeout = Number(env.W_TIMEOUT)
}
let cli = new WConverhpClient(opt)

//execute, 記錄輪詢是否已結束; W_STRIP4時只交3個參數
let nExec = 0
let nSettled = 0
let execute = cli.execute
cli.execute = (...args) => {
    nExec++
    if (env.W_STRIP4 === '1') {
        args = args.slice(0, 3)
    }
    let p = execute(...args)
    p.then(() => {
        nSettled++
    }, () => {
        nSettled++
    })
    return p
}

let bc = new WServBroadcastClient(cli, { timePolling: 100 })

//clear, 停止並記錄當下之各項計數(重入時, 觸發停止之那一則通訊物件error已計入)
let clear = () => {
    out.tClear = rel()
    out.settledAtClear = nSettled === nExec
    out.nCommAtClear = out.commErrs.length
    out.nOursAtClear = out.ours.length
    out.nRetryAtClear = out.retryLogs.length
    out.nTokensAtClear = out.tokens.length
    fs.writeSync(1, 'CLEARED\n')
    bc.clearBroadcast()
}

//isOurs, 本套件之error為{ msg, err }且msg為'[sys:polling] error'; 其餘為通訊物件自身之error
let isOurs = (e) => e !== null && typeof e === 'object' && e.msg === '[sys:polling] error'

bc.on('error', (e) => {
    if (isOurs(e)) {
        out.ours.push(rel())
        return
    }
    out.commErrs.push(rel())
    if (out.commErrs.length === 1 && env.W_KASE === 'reentrant') {
        clear()
    }
    if (out.commErrs.length === 1 && (env.W_KASE === 'backoff' || env.W_KASE === 'ghost')) {
        setTimeout(clear, 150)
    }
})
for (let name of ['openOnce', 'open', 'broadcast']) {
    bc.on(name, () => {
        out.ours.push(rel())
        if (name === 'open') {
            fs.writeSync(1, 'OPEN\n')
        }
    })
}

if (env.W_KASE === 'inflight' || env.W_KASE === 'token') {
    let t = setInterval(() => {
        if (nExec >= 1) {
            clearInterval(t)
            setTimeout(clear, 200)
        }
    }, 5)
}
if (env.W_KASE === 'idle') {
    let t = setInterval(() => {
        if (nSettled >= 2 && nSettled === nExec) {
            clearInterval(t)
            clear()
        }
    }, 5)
}
