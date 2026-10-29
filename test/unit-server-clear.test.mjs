import assert from 'assert'
import { spawn } from 'child_process'
import { mock } from 'node:test'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import { captureConsole, hasCall, advance } from './tools/helpers.mjs'
import { genTracer } from './tools/tracer.mjs'


//本檔對應之契約: 伺服端clearBroadcast為停止並釋放——清除本套件之計時器與在線偵測, 使行程可立即結束;
//對已發出clientEnter之客戶端補發clientLeave與clientChange使進出成對, 其後不再派發事件、不再回應輪詢;
//停止後broadcast無作用、getClients回傳[]、getMessages回傳{}; 可重複呼叫
//另(WServBroadcastServer之JSDoc): 停止前已排定而尚未送達之事件不再派發; 補發只對已送達clientEnter而未送達clientLeave之客戶端, 帶該客戶端最後一次輪詢之輸入;
//停止後之監聽器拋錯(含補發事件之監聽器)以console.error輸出; 呼叫當下那次派發之其餘監聽器仍會收到該事件;
//於同一次execute派發中、比本套件早註冊之監聽內停止時, 本套件不回應該次輪詢
//
//同步方式(規格: dspec/計時器相關函數之觀察回調與測試.md): 以opt.onTrace之事件為同步點(見tools/tracer.mjs), 不以固定等待;
//  deliver(change): 一次進出之事件已送達使用端; deliver(change, final): 停止時補發之事件已送達; emit: 事件已排定而尚未派發
//  否定斷言(未派發某事件)之觀察窗: 排定在先之計時器必先於其後才排定且到期較晚之計時器觸發, 故其後排定之短等待足以涵蓋已排定之派發(不受負載影響);
//  需涵蓋連鎖之計時器(在線偵測1ms後再派發1ms)者以假時鐘(mock.timers)推進


let delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

//poll, 模擬一次前端輪詢: 與w-converhp派發execute之參數形狀相同(func, input, pm)
let poll = (srv, clientId, pm) => {
    if (!pm) {
        pm = { resolve: () => {}, reject: () => {} }
    }
    srv.emit('execute', '[sys:polling]', { clientId }, pm)
}

//record, 記錄本套件派發之進出事件
let record = (srv) => {
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

//condChange, clientChange已送達使用端(一次進出事件之最後一個); 補發者另帶final: true
let condChange = { type: 'deliver', name: 'clientChange', final: false }
let condChangeFinal = { type: 'deliver', name: 'clientChange', final: true }


describe('server clearBroadcast', function() {

    it('已輪詢後呼叫clearBroadcast, 行程可立即結束(含停止後才到之輪詢)', async function() {
        //子行程於clearBroadcast及停止後才到之輪詢之後, 回報行程內仍作用中之計時器數: 為0即事件迴圈無本套件之工作, 行程可立即結束(取代停止至結束之牆鐘門檻, 其於負載下不穩)
        let script = `
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from './src/WServBroadcastServer.mjs'
let srv = WServBroadcastServer(evem(), {
    onTrace: (e) => {
        if (e.type === 'deliver' && e.name === 'clientChange' && e.final === false) {
            srv.clearBroadcast()
            console.log('cleared')
        }
        else if (e.type === 'deliver' && e.name === 'clientChange' && e.final === true) {
            //補發已送達, 其後再來一次停止後才到之輪詢
            setImmediate(() => {
                let pm = { resolve: () => {}, reject: () => {} }
                srv.emit('execute', '[sys:polling]', { clientId: 'c2' }, pm)
                setImmediate(() => {
                    console.log('active:' + JSON.stringify(process.getActiveResourcesInfo().filter((v) => v === 'Timeout')))
                })
            })
        }
    },
})
let pm = { resolve: () => {}, reject: () => {} }
srv.emit('execute', '[sys:polling]', { clientId: 'c1' }, pm)
`
        let r = await new Promise((resolve, reject) => {
            let out = ''
            let cp = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), windowsHide: true })
            cp.stdout.on('data', (b) => {
                out += b
            })
            cp.on('error', reject)
            //防懸置上限(只防子行程不結束時整案懸置, 不表達規格): 本套件若殘留計時器, 子行程不會自行結束
            let tKill = setTimeout(() => {
                cp.kill()
            }, 30000)
            cp.on('exit', (code, signal) => {
                clearTimeout(tKill)
                resolve({ out, code, signal })
            })
        })
        assert.ok(r.out.includes('cleared'), '子行程應印出cleared')
        assert.ok(r.out.includes('active:[]'), `停止及停止後才到之輪詢之後不應有作用中之計時器, 實得: ${r.out}`) //契約: 清除本套件之計時器與在線偵測, 停止後才到之輪詢亦不再啟動
        assert.strict.equal(r.signal, null, '子行程應自行結束而非被終止') //契約: 行程可立即結束(無殘留計時器撐住行程)
        assert.strict.equal(r.code, 0)
    })

    it('停止時對已進入之客戶端補發clientLeave與clientChange', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        let datas = []
        srv.on('clientLeave', (clientId, data) => {
            datas.push(data)
        })
        poll(srv, 'c1')
        poll(srv, 'c2')
        await tr.wait(condChange, 2) //兩者之進入皆已送達
        let n = ms.length
        srv.clearBroadcast()
        await tr.wait(condChangeFinal, 2) //兩者之補發皆已送達
        assert.deepStrictEqual(ms.slice(n), ['leave|c1', 'change|1', 'leave|c2', 'change|0']) //契約: 補發clientLeave與clientChange
        assert.deepStrictEqual(datas, [{ clientId: 'c1' }, { clientId: 'c2' }]) //契約: clientLeave帶該客戶端輪詢時所送之輸入物件
    })

    it('停止前尚未發出clientEnter之客戶端, 不補發clientLeave亦不再發clientEnter', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        poll(srv, 'c1')
        await tr.wait(condChange) //c1之進入已送達
        poll(srv, 'c2')
        srv.clearBroadcast() //c2尚未發出enter
        await tr.wait(condChangeFinal) //c1之補發已送達(c2之enter計時器排定在先, 若未取消必先於此觸發)
        assert.deepStrictEqual(ms, ['enter|c1', 'change|1', 'leave|c1', 'change|0']) //契約: 進出成對, 不出現有leave無enter
    })

    it('停止後不再回應輪詢、亦不再派發事件', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        poll(srv, 'c1')
        await tr.wait(condChange)
        srv.clearBroadcast()
        await tr.wait(condChangeFinal)
        let n = ms.length
        let resolved = false
        mock.timers.enable({ apis: ['setTimeout'] }) //以假時鐘推進停止後才到之輪詢可能啟動之連鎖計時器(在線偵測1ms後再派發1ms)
        try {
            poll(srv, 'c3', {
                resolve: () => {
                    resolved = true
                },
                reject: () => {},
            })
            advance(100)
        }
        finally {
            mock.timers.reset()
        }
        assert.strict.equal(resolved, false) //契約: 停止後不再回應輪詢
        assert.deepStrictEqual(ms.slice(n), []) //契約: 停止後不再派發事件
    })

    it('停止後broadcast無作用、getClients回傳[]、getMessages回傳{}', async function() {
        let srv = WServBroadcastServer(evem())
        poll(srv, 'c1')
        await delay(50)
        srv.clearBroadcast()
        srv.broadcast('x')
        assert.deepStrictEqual(srv.getClients(), []) //契約: getClients回傳[]
        assert.deepStrictEqual(srv.getMessages(), {}) //契約: getMessages回傳{}, broadcast無作用
    })

    it('重複呼叫clearBroadcast不拋錯且不重複補發', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        poll(srv, 'c1')
        await tr.wait(condChange)
        srv.clearBroadcast()
        srv.clearBroadcast()
        await tr.wait(condChangeFinal)
        srv.clearBroadcast()
        assert.deepStrictEqual(ms, ['enter|c1', 'change|1', 'leave|c1', 'change|0']) //契約: 可重複呼叫, 只補發一次
        assert.strict.equal(tr.count({ type: 'emit', final: true }), 2) //契約: 補發只排定一次(clientLeave與clientChange各一), 重複呼叫不再排定
        assert.strict.equal(tr.count({ type: 'stop' }), 1) //契約: 停止只作用一次
    })

    it('於clientLeave監聽內呼叫clearBroadcast不拋錯', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        srv.on('clientLeave', () => {
            srv.clearBroadcast()
        })
        poll(srv, 'c1')
        poll(srv, 'c2')
        await tr.wait(condChange, 2)
        srv.clearBroadcast()
        await tr.wait(condChangeFinal, 2)
        assert.deepStrictEqual(ms, ['enter|c1', 'change|2', 'enter|c2', 'change|2', 'leave|c1', 'change|1', 'leave|c2', 'change|0']) //契約: 監聽器內再停止不影響已排定之補發
    })

    it('停止前已排定而尚未送達之clientEnter不再派發, 亦不補發clientLeave', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        poll(srv, 'c1')
        //在線偵測發出enter後本套件再脫勾1ms才送達: 見到emit(已排定)之當下停止, 此時尚未送達(計時器回呼之後、下一個計時器回呼之前先執行續行之程式)
        await tr.wait({ type: 'emit', name: 'clientEnter' })
        srv.clearBroadcast()
        await delay(5) //已排定之派發(1ms)先於此觸發, 觸發當下已停止而被閘門丟棄
        assert.deepStrictEqual(ms, []) //契約: 停止前已排定而尚未送達之事件不再派發; 補發只對已送達clientEnter者
        assert.strict.equal(tr.count({ type: 'deliver' }), 0) //契約: 無任何事件送達
        assert.strict.equal(tr.count({ type: 'emit', final: true }), 0) //契約: 未送達clientEnter者不補發clientLeave
    })

    it('停止前已排定之輪詢例外error不再派發', async function() {
        let srv = WServBroadcastServer(evem())
        let errs = []
        srv.on('error', (err) => {
            errs.push(err)
        })
        let rejects = []
        poll(srv, 'c1', {
            resolve: () => {
                throw new Error('resolve failed')
            },
            reject: (msg) => {
                rejects.push(msg)
            },
        })
        srv.clearBroadcast()
        await delay(50)
        assert.deepStrictEqual(rejects, ['[sys:polling] error']) //契約: 輪詢例外時以reject回覆前端
        assert.deepStrictEqual(errs, []) //契約: 停止前已排定而尚未送達之事件不再派發
    })

    it('於clientEnter監聽內停止, 只對已送達clientEnter者補發clientLeave, 其餘已排定者不派發', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        let done = false
        srv.on('clientEnter', () => {
            if (!done) {
                done = true
                srv.clearBroadcast()
            }
        })
        poll(srv, 'c1')
        poll(srv, 'c2')
        await tr.wait(condChangeFinal) //補發已送達(其餘已排定者之計時器排定在先, 若未被閘門丟棄必先於此觸發)
        assert.deepStrictEqual(ms, ['enter|c1', 'leave|c1', 'change|0']) //契約: 補發只對已送達clientEnter而未送達clientLeave者, 其餘已排定者不派發
    })

    it('於clientChange監聽內停止, 只對已送達clientEnter者補發clientLeave, 其餘已排定者不派發', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        let done = false
        srv.on('clientChange', () => {
            if (!done) {
                done = true
                srv.clearBroadcast()
            }
        })
        poll(srv, 'c1')
        poll(srv, 'c2')
        await tr.wait(condChangeFinal)
        assert.deepStrictEqual(ms, ['enter|c1', 'change|2', 'leave|c1', 'change|0']) //契約: 補發只對已送達clientEnter而未送達clientLeave者, 其餘已排定者不派發
    })

    it('於error監聽內停止, 已排定之進出事件不再派發', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let ms = record(srv)
        let errs = []
        srv.on('error', (err) => {
            errs.push(err)
            srv.clearBroadcast()
        })
        poll(srv, 'c1', {
            resolve: () => {
                throw new Error('resolve failed')
            },
            reject: () => {},
        })
        await tr.wait({ type: 'stop' }) //error已送達, 其監聽器內已停止
        await delay(5) //已排定之進出事件(1ms)先於此觸發, 觸發當下已停止而被閘門丟棄
        assert.strict.equal(errs.length, 1) //契約: 停止前送達之error照常
        assert.deepStrictEqual(ms, []) //契約: 停止前已排定而尚未送達之事件不再派發
    })

    it('停止後補發事件之監聽器拋錯以console.error輸出, 不發error事件', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        poll(srv, 'c1')
        await tr.wait(condChange)
        let errs = []
        srv.on('error', (err) => {
            errs.push(err)
        })
        srv.on('clientLeave', () => {
            throw new Error('boom-leave')
        })
        let calls = await captureConsole(async () => {
            srv.clearBroadcast()
            await tr.wait({ type: 'report', src: 'listener', name: 'clientLeave', via: 'console' }) //補發之clientLeave送達而其監聽器拋錯, 本套件改以console.error通報
        })
        assert.deepStrictEqual(errs, []) //契約: 停止後不發error事件
        assert.ok(hasCall(calls, 'listener of event[clientLeave] error'), `應以console.error輸出, 實得: ${JSON.stringify(calls.map((args) => String(args[0])))}`) //契約: 停止後之監聽器拋錯(含補發事件之監聽器)以console.error輸出
    })

    it('補發之clientLeave帶該客戶端最後一次輪詢之輸入', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        let datas = []
        srv.on('clientLeave', (clientId, data) => {
            datas.push(data)
        })
        let pm = { resolve: () => {}, reject: () => {} }
        srv.emit('execute', '[sys:polling]', { clientId: 'c1', v: 1 }, pm)
        await tr.wait(condChange) //c1之進入已送達
        srv.emit('execute', '[sys:polling]', { clientId: 'c1', v: 2 }, pm) //已在線, 更新其最後一次輸入
        srv.clearBroadcast()
        await tr.wait(condChangeFinal)
        assert.deepStrictEqual(datas, [{ clientId: 'c1', v: 2 }]) //契約: 補發帶該客戶端最後一次輪詢之輸入(與在線逾時之clientLeave一致)
    })

    it('於監聽器內停止時, 同一次派發之其餘監聽器仍收到該事件', async function() {
        let tr = genTracer()
        let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
        srv.on('clientEnter', () => {
            srv.clearBroadcast()
        })
        let ms = record(srv)
        poll(srv, 'c1')
        await tr.wait(condChangeFinal)
        assert.deepStrictEqual(ms, ['enter|c1', 'leave|c1', 'change|0']) //契約: 呼叫當下那次派發之其餘監聽器仍會收到該事件; 其後只有補發
    })

    it('於同一次execute派發中、比本套件早註冊之監聽內停止, 本套件不回應該次輪詢', async function() {
        let ev = evem()
        let srv = null
        ev.on('execute', (func) => {
            if (func === '[sys:polling]' && srv !== null) {
                srv.clearBroadcast()
            }
        })
        srv = WServBroadcastServer(ev)
        let resolved = false
        poll(srv, 'c1', {
            resolve: () => {
                resolved = true
            },
            reject: () => {},
        })
        await delay(50)
        assert.strict.equal(resolved, false) //契約: 停止後不再回應輪詢
        assert.deepStrictEqual(srv.getMessages(), {}) //契約: 停止後getMessages回傳{}
        srv.broadcast('x')
        assert.deepStrictEqual(srv.getMessages(), {}) //契約: 停止後broadcast無作用
        assert.deepStrictEqual(srv.getClients(), []) //契約: 停止後getClients回傳[]
    })

})
