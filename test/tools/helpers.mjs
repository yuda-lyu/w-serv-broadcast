import { mock } from 'node:test'
import evem from 'wsemi/src/evem.mjs'


//本檔為測試共用之輔助函式, 不含測試案例(檔名不帶.test., 不被mocha之test/*.test.mjs抓取)


//delay
let delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


//advance, 以假時鐘(mock.timers, 須已enable)逐毫秒推進ms毫秒
//why: mock.timers.tick(n)一次推進n毫秒時, 時鐘先跳至終點, 其間新排定之計時器(如事件派發之1ms脫勾)排在終點之後而不執行, 且回呼內之Date.now()皆為終點值; 逐毫秒推進才與真實時間下之連鎖計時器一致
let advance = (ms) => {
    for (let i = 0; i < ms; i++) {
        mock.timers.tick(1)
    }
}


//waitFor, 至多等msMax毫秒直到fn()為真, 回傳最後之fn()
//why: 以固定時窗計算輪數之斷言於平行執行之負載下會因計時器延遲而少輪(flaky), 改為等條件成立
let waitFor = async (fn, msMax = 3000) => {
    let t0 = Date.now()
    while (!fn() && Date.now() - t0 < msMax) {
        await delay(10)
    }
    return fn()
}


//countTimeout, 目前行程之Timeout數(含setTimeout與setInterval), 供檢查計時器是否殘留
let countTimeout = () => {
    return process.getActiveResourcesInfo().filter((v) => v === 'Timeout').length
}


//captureConsole, 於執行fn期間記錄console指定方法之呼叫, 回傳各次呼叫之參數陣列
let captureConsole = async (fn, method = 'error') => {
    let calls = []
    let c0 = console[method]
    console[method] = (...args) => {
        calls.push(args)
    }
    try {
        await fn()
    }
    finally {
        console[method] = c0
    }
    return calls
}


//hasCall, console之呼叫中是否有任一參數之字串含text
let hasCall = (calls, text) => {
    return calls.some((args) => args.some((a) => String(a).includes(text)))
}


//genConnector, 模擬前端通訊物件(evem建立之事件物件加execute), execute依輪次呼叫fnRound(n, func, input, cbProgress), n自1起算
let genConnector = (fnRound) => {
    let ev = evem()
    ev.nExec = 0
    ev.execute = (...args) => {
        ev.nExec++
        return fnRound(ev.nExec, ...args)
    }
    return ev
}


//recordClient, 記錄前端本套件之四種事件, 回傳{ list, of, count, seq }
//  error事件只記錄本套件之形狀{ msg, err }(物件), 通訊物件(如WConverhpClient)自身之字串error另記於others
let recordClient = (cli) => {
    let list = []
    let others = []
    for (let name of ['openOnce', 'open', 'broadcast', 'error']) {
        cli.on(name, (...args) => {
            if (name === 'error' && (args[0] === null || typeof args[0] !== 'object')) {
                others.push(args[0])
                return
            }
            list.push({ ev: name, args })
        })
    }
    return {
        list,
        others,
        of: (name) => list.filter((v) => v.ev === name).map((v) => v.args[0]),
        count: (name) => list.filter((v) => v.ev === name).length,
        seq: () => list.map((v) => v.ev),
    }
}


//recordServer, 記錄伺服端本套件之進出事件, 回傳字串陣列(enter|id、leave|id、change|n)
let recordServer = (srv) => {
    let ms = []
    srv.on('clientEnter', (clientId) => {
        ms.push(`enter|${clientId}`)
    })
    srv.on('clientLeave', (clientId) => {
        ms.push(`leave|${clientId}`)
    })
    srv.on('clientChange', (num) => {
        ms.push(`change|${num}`)
    })
    return ms
}


//pollRaw, 模擬一次前端輪詢(與w-converhp派發execute之參數形狀相同), 回傳promise: { resolve: v }、{ reject: v }或逾msWait未結算之{ unsettled: true }
let pollRaw = (srv, input, msWait = 30, func = '[sys:polling]') => {
    return new Promise((resolve) => {
        let done = false
        let pm = {
            resolve: (v) => {
                if (!done) {
                    done = true
                    resolve({ resolve: v })
                }
            },
            reject: (v) => {
                if (!done) {
                    done = true
                    resolve({ reject: v })
                }
            },
        }
        srv.emit('execute', func, input, pm)
        setTimeout(() => {
            if (!done) {
                done = true
                resolve({ unsettled: true })
            }
        }, msWait)
    })
}


export {
    delay,
    advance,
    waitFor,
    countTimeout,
    captureConsole,
    hasCall,
    genConnector,
    recordClient,
    recordServer,
    pollRaw
}
