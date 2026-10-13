import assert from 'assert'
import { spawn } from 'child_process'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'


//本檔對應之契約: 伺服端clearBroadcast為停止並釋放——清除本套件之計時器與在線偵測, 使行程可立即結束;
//對已發出clientEnter之客戶端補發clientLeave與clientChange使進出成對, 其後不再派發事件、不再回應輪詢;
//停止後broadcast無作用、getClients回傳[]、getMessages回傳{}; 可重複呼叫


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


describe('server clearBroadcast', function() {

    it('已輪詢後呼叫clearBroadcast, 行程可立即結束(含停止後才到之輪詢)', async function() {
        let script = `
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from './src/WServBroadcastServer.mjs'
let srv = WServBroadcastServer(evem())
let pm = { resolve: () => {}, reject: () => {} }
srv.emit('execute', '[sys:polling]', { clientId: 'c1' }, pm)
setTimeout(() => {
    srv.clearBroadcast()
    console.log('cleared')
    setTimeout(() => {
        srv.emit('execute', '[sys:polling]', { clientId: 'c2' }, pm)
    }, 50)
}, 100)
`
        let ms = await new Promise((resolve, reject) => {
            let tClear = null
            let cp = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd() })
            cp.stdout.on('data', (b) => {
                if (String(b).includes('cleared') && tClear === null) {
                    tClear = Date.now()
                }
            })
            cp.on('error', reject)
            cp.on('exit', () => {
                resolve(tClear === null ? null : Date.now() - tClear)
            })
        })
        assert.ok(ms !== null, '子行程應印出cleared')
        assert.ok(ms < 1500, `停止後應立即結束, 實得${ms}ms`) //契約: 清除本套件之計時器與在線偵測, 行程可立即結束
    })

    it('停止時對已進入之客戶端補發clientLeave與clientChange', async function() {
        let srv = WServBroadcastServer(evem())
        let ms = record(srv)
        let datas = []
        srv.on('clientLeave', (clientId, data) => {
            datas.push(data)
        })
        poll(srv, 'c1')
        poll(srv, 'c2')
        await delay(50)
        let n = ms.length
        srv.clearBroadcast()
        await delay(50)
        assert.deepStrictEqual(ms.slice(n), ['leave|c1', 'change|1', 'leave|c2', 'change|0']) //契約: 補發clientLeave與clientChange
        assert.deepStrictEqual(datas, [{ clientId: 'c1' }, { clientId: 'c2' }]) //契約: clientLeave帶該客戶端輪詢時所送之輸入物件
    })

    it('停止前尚未發出clientEnter之客戶端, 不補發clientLeave亦不再發clientEnter', async function() {
        let srv = WServBroadcastServer(evem())
        let ms = record(srv)
        poll(srv, 'c1')
        await delay(50)
        poll(srv, 'c2')
        srv.clearBroadcast()
        await delay(50)
        assert.deepStrictEqual(ms, ['enter|c1', 'change|1', 'leave|c1', 'change|0']) //契約: 進出成對, 不出現有leave無enter
    })

    it('停止後不再回應輪詢、亦不再派發事件', async function() {
        let srv = WServBroadcastServer(evem())
        let ms = record(srv)
        poll(srv, 'c1')
        await delay(50)
        srv.clearBroadcast()
        await delay(50)
        let n = ms.length
        let resolved = false
        poll(srv, 'c3', {
            resolve: () => {
                resolved = true
            },
            reject: () => {},
        })
        await delay(100)
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
        let srv = WServBroadcastServer(evem())
        let ms = record(srv)
        poll(srv, 'c1')
        await delay(50)
        srv.clearBroadcast()
        srv.clearBroadcast()
        await delay(50)
        srv.clearBroadcast()
        await delay(50)
        assert.deepStrictEqual(ms, ['enter|c1', 'change|1', 'leave|c1', 'change|0']) //契約: 可重複呼叫, 只補發一次
    })

    it('於clientLeave監聽內呼叫clearBroadcast不拋錯', async function() {
        let srv = WServBroadcastServer(evem())
        let ms = record(srv)
        srv.on('clientLeave', () => {
            srv.clearBroadcast()
        })
        poll(srv, 'c1')
        poll(srv, 'c2')
        await delay(50)
        srv.clearBroadcast()
        await delay(50)
        assert.deepStrictEqual(ms, ['enter|c1', 'change|2', 'enter|c2', 'change|2', 'leave|c1', 'change|1', 'leave|c2', 'change|0']) //契約: 監聽器內再停止不影響已排定之補發
    })

})
