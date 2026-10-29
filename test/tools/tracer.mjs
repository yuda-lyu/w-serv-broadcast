//本檔為測試共用之輔助函式, 不含測試案例(檔名不帶.test., 不被mocha之test/*.test.mjs抓取)
//genTracer: 記錄兩端opt.onTrace之事件, 供測試以「等第N個事件」而非「等N毫秒」同步(規格: dspec/計時器相關函數之觀察回調與測試.md P1)


//模組載入時保存真實計時器: 防懸置上限不受測試中之假時鐘(mock.timers)影響, 否則假時鐘下上限失效而缺陷版會整案懸置
const setTimeoutReal = setTimeout
const clearTimeoutReal = clearTimeout


//isMatch, 事件是否符合條件: 條件為函數則以其回傳判定, 為物件則其每個欄位皆須相等(欄位值為函數者以其回傳判定)
let isMatch = (e, cond) => {
    if (typeof cond === 'function') {
        return cond(e) === true
    }
    return Object.keys(cond).every((k) => {
        let v = cond[k]
        return typeof v === 'function' ? v(e[k]) === true : e[k] === v
    })
}


//genTracer, 回傳{ onTrace, events, mark, count, wait, of }
//  onTrace: 給被測物之opt.onTrace; events: 至今之全部事件(依發生順序)
//  mark(): 目前之事件數, 供wait/count之from參數(只看其後之事件)
//  count(cond, from=0): 符合條件之事件數
//  of(cond, from=0): 符合條件之事件陣列
//  wait(cond, n=1, from=0): 等第n個符合條件(自from起算)之事件, 回傳該事件; 已有者立即成立
//    成立時於事件通知當下resolve, 續行之程式於目前呼叫堆疊(含被測物之該次派發)結束後才執行
//    msCap為防懸置上限(毫秒, 只防懸置不表達規格), 逾時以含已記錄事件摘要之錯誤reject
let genTracer = (opt = {}) => {
    let msCap = opt.msCap || 20000
    let events = []
    let waiters = []

    let find = (cond, n, from) => {
        let k = 0
        for (let i = from; i < events.length; i++) {
            if (isMatch(events[i], cond)) {
                k++
                if (k === n) {
                    return events[i]
                }
            }
        }
        return null
    }

    let onTrace = (e) => {
        events.push(e)
        for (let w of waiters.slice()) {
            let r = find(w.cond, w.n, w.from)
            if (r !== null) {
                waiters.splice(waiters.indexOf(w), 1)
                clearTimeoutReal(w.t)
                w.resolve(r)
            }
        }
    }

    let wait = (cond, n = 1, from = 0) => {
        let r = find(cond, n, from)
        if (r !== null) {
            return Promise.resolve(r)
        }
        return new Promise((resolve, reject) => {
            let w = { cond, n, from, resolve, t: null }
            w.t = setTimeoutReal(() => {
                waiters.splice(waiters.indexOf(w), 1)
                let sum = events.filter((e) => e.type !== 'alive' || e.evType !== 'tick').map((e) => JSON.stringify(e)).join(' ')
                reject(new Error(`event not reached within ${msCap}ms (cond=${typeof cond === 'function' ? cond.toString() : JSON.stringify(cond)}, n=${n}, from=${from}); events: ${sum}`))
            }, msCap)
            waiters.push(w)
        })
    }

    return {
        onTrace,
        events,
        mark: () => events.length,
        count: (cond, from = 0) => events.slice(from).filter((e) => isMatch(e, cond)).length,
        of: (cond, from = 0) => events.slice(from).filter((e) => isMatch(e, cond)),
        wait,
    }
}


export {
    genTracer
}
