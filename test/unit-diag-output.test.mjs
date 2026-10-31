import assert from 'assert'
import { inspect } from 'node:util'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { countTimeout, captureConsole } from './tools/helpers.mjs'
import { genTracer } from './tools/tracer.mjs'


//本檔對應之契約(排程第158項, 規格: dspec/診斷輸出與遮罩.md D1、D2、D3、D4): 本套件之診斷輸出(console.error、console.log)一律經wsemi之getDiag之一致介面:
//  預設只輸出固定標籤與安全摘要{ src, name, errType, errCode }, 不含error事件內容之值(err可能含token或使用者識別);
//  opt.logDetail===true時輸出遮罩後之細節; opt.funLog(label, safe, detail)給予時診斷輸出只交給它(不寫console);
//  憑證樣式與token(伺服端輪詢輸入之__sysToken__、前端getToken所得)於細節中遮罩為***;
//  有error監聽者時照常發error事件(內容{ msg, err }為原值, 不遮罩, 不輸出診斷)
//
//同步方式: 以兩端opt.onTrace之deliver事件為同步點(診斷輸出與其同一堆疊內發生, 續行之程式於堆疊結束後執行), 不以固定等待


//SECRET, 模擬token或使用者識別(出現在錯誤值內)
const SECRET = 'tok-Zq83mXk2'

//genPm, 模擬w-converhp傳入execute監聽器之回覆通道
let genPm = (opt = {}) => {
    return {
        resolve: opt.resolve || (() => {}),
        reject: opt.reject || (() => {}),
    }
}

//poll, 模擬一次前端輪詢: 與w-converhp派發execute之參數形狀相同(func, input, pm)
let poll = (srv, input, pm = genPm()) => {
    srv.emit('execute', '[sys:polling]', input, pm)
}

//genConnector, 模擬前端通訊物件: execute依給定之函數回應
let genConnector = (execute) => {
    let ev = evem()
    ev.execute = execute
    return ev
}

//dump, console呼叫之全部參數(含Error之message與stack)轉為單一字串, 供檢查是否含有不應輸出之值
let dump = (calls) => {
    return calls.map((args) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n')
}

//labels, 各次呼叫之第1參數(標籤)
let labels = (calls) => calls.map((args) => args[0])


describe('diagnostic output (getDiag)', function() {

    describe('server: 預設只輸出安全摘要', function() {

        it('無error監聽者, verifyPolling拒絕(回傳值含token): 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace, verifyPolling: () => `denied for ${SECRET}` })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET })
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.strict.equal(calls.length, 1, `應恰輸出一次, 實得: ${dump(calls)}`) //契約: 一則error一次輸出
            assert.ok(!dump(calls).includes(SECRET), `不得輸出err之值, 實得: ${dump(calls)}`) //契約D2: 預設不輸出資料值
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] [sys:polling] permission denied']) //契約: 標籤為固定詞彙
            assert.deepStrictEqual(calls[0][1], { src: 'error', errType: 'string' }) //契約: 摘要為{ src, errType }
            assert.strict.equal(calls[0].length, 2) //契約: 無第3參數(不含值)
        })

        it('無error監聽者, verifyPolling拋錯(含token): 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), {
                onTrace: tr.onTrace,
                verifyPolling: () => {
                    throw new Error(`lookup failed for ${SECRET}`)
                },
            })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET })
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.strict.equal(calls.length, 1, `應恰輸出一次, 實得: ${dump(calls)}`)
            assert.ok(!dump(calls).includes(SECRET), `不得輸出err之值, 實得: ${dump(calls)}`) //契約D2
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] [sys:polling] verifyPolling error'])
            assert.deepStrictEqual(calls[0][1], { src: 'error', errType: 'Error' })
        })

        it('無error監聽者, 輪詢處理失敗: 只輸出標籤與摘要(含errCode白名單)', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1' }, genPm({
                    resolve: () => {
                        let e = new Error(`write failed ${SECRET}`)
                        e.code = 'ECONNRESET'
                        throw e
                    },
                }))
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.ok(!dump(calls).includes(SECRET), `不得輸出err之值, 實得: ${dump(calls)}`) //契約D2
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] [sys:polling] error'])
            assert.deepStrictEqual(calls[0][1], { src: 'error', errType: 'Error', errCode: 'ECONNRESET' }) //契約: errCode只收白名單內之代碼
        })

        it('監聽器拋錯且無error監聽者(停止前): 只輸出標籤與摘要, 恰一次(不重複輸出原值)', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            srv.on('clientEnter', () => {
                throw new Error(`boom ${SECRET}`)
            })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1' })
                await tr.wait({ type: 'deliver', name: 'clientEnter', ok: false })
            })
            srv.clearBroadcast()
            assert.strict.equal(calls.length, 1, `應恰輸出一次, 實得: ${dump(calls)}`) //契約: 一次拋錯一次輸出
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D2: 無error監聽者時原由wsemi之evEmit輸出原值, 改由本套件輸出摘要
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] listener of event[clientEnter] error'])
            assert.deepStrictEqual(calls[0][1], { src: 'listener', name: 'clientEnter', errType: 'Error' })
            assert.deepStrictEqual(tr.of({ type: 'report' }).map((e) => [e.src, e.name, e.via]), [['listener', 'clientEnter', 'console']]) //契約: 觀察回調之report為via=console
        })

        it('停止後之監聽器拋錯(補發之clientLeave): 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            srv.on('clientLeave', () => {
                throw new Error(`boom ${SECRET}`)
            })
            poll(srv, { clientId: 'c1' })
            await tr.wait({ type: 'deliver', name: 'clientEnter' })
            let calls = await captureConsole(async () => {
                srv.clearBroadcast()
                await tr.wait({ type: 'deliver', name: 'clientLeave', ok: false })
            })
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D2
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] listener of event[clientLeave] error'])
            assert.deepStrictEqual(calls[0][1], { src: 'listener', name: 'clientLeave', errType: 'Error' })
        })

        it('error監聽器自身拋錯: 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            srv.on('error', () => {
                throw new Error(`boom-error ${SECRET}`)
            })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1' }, genPm({
                    resolve: () => {
                        throw new Error('resolve failed')
                    },
                }))
                await tr.wait({ type: 'deliver', name: 'error', ok: false })
            })
            srv.clearBroadcast()
            assert.strict.equal(calls.length, 1, `應恰輸出一次, 實得: ${dump(calls)}`)
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D2
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] listener of event[error] error'])
            assert.deepStrictEqual(calls[0][1], { src: 'listener', name: 'error', errType: 'Error' })
            assert.deepStrictEqual(tr.of({ type: 'report' }).map((e) => [e.src, e.name, e.via]), [['listener', 'error', 'console']]) //契約: error監聽器拋錯之通報為via=console
        })

        it('監聽器拋錯而error監聽器亦拋錯: 兩者皆只輸出摘要, 先通報error監聽器再通報原事件', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            srv.on('clientEnter', () => {
                throw new Error(`boom-enter ${SECRET}`)
            })
            srv.on('error', () => {
                throw new Error(`boom-error ${SECRET}`)
            })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1' })
                await tr.wait({ type: 'report', src: 'listener', name: 'clientEnter', via: 'event' })
            })
            srv.clearBroadcast()
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D2
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] listener of event[error] error']) //契約: error監聽器之拋錯以診斷輸出
            assert.deepStrictEqual(tr.of({ type: 'report' }).map((e) => [e.src, e.name, e.via]), [['listener', 'error', 'console'], ['listener', 'clientEnter', 'event']])
        })

        it('派發函數內部失敗(事件物件之listenerCount拋錯): 不外拋, 只輸出標籤與摘要(不交給wsemi輸出原值)', async function() {
            let tr = genTracer({ msCap: 3000 })
            let ev = evem()
            ev.listenerCount = () => {
                throw new Error(`listenerCount failed ${SECRET}`)
            }
            let srv = WServBroadcastServer(ev, { onTrace: tr.onTrace })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1' }, genPm({
                    resolve: () => {
                        throw new Error('resolve failed')
                    },
                }))
                await tr.wait({ type: 'report', src: 'error', msg: 'internal error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.strict.equal(calls.length, 1, `應恰輸出一次, 實得: ${dump(calls)}`)
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D4: 內部失敗不外拋至evEmit(其以console.error輸出原值)
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] internal error'])
            assert.deepStrictEqual(calls[0][1], { src: 'error', errType: 'Error' })
        })

        it('有error監聽者時照常發error事件(內容為原值), 不輸出診斷', async function() {
            let tr = genTracer({ msCap: 3000 })
            let errHook = new Error(`lookup failed for ${SECRET}`)
            let srv = WServBroadcastServer(evem(), {
                onTrace: tr.onTrace,
                verifyPolling: () => {
                    throw errHook
                },
            })
            let errs = []
            srv.on('error', (e) => {
                errs.push(e)
            })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET })
                await tr.wait({ type: 'deliver', name: 'error' })
            })
            srv.clearBroadcast()
            assert.deepStrictEqual(calls, []) //契約: 有監聽者時不輸出
            assert.strict.equal(errs.length, 1)
            assert.strict.equal(errs[0].msg, '[sys:polling] verifyPolling error') //契約: error事件之msg不變
            assert.strict.equal(errs[0].err, errHook) //契約: error事件之err為原值(身分不變, 不遮罩)
        })

    })

    describe('server: logDetail與funLog', function() {

        it('opt.logDetail為true: 輸出遮罩後之細節(token與憑證樣式為***)', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), {
                onTrace: tr.onTrace,
                logDetail: true,
                verifyPolling: () => {
                    throw new Error(`lookup failed for ${SECRET} with Authorization: Bearer abcd1234efgh5678`)
                },
            })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET })
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.strict.equal(calls.length, 1, `應恰輸出一次, 實得: ${dump(calls)}`)
            let s = dump(calls)
            assert.ok(s.includes('lookup failed for'), `logDetail應含錯誤細節, 實得: ${s}`) //契約D2: logDetail還原細節
            assert.ok(!s.includes(SECRET), `token須遮罩, 實得: ${s}`) //契約D3: 輪詢輸入之__sysToken__遮罩
            assert.ok(!s.includes('abcd1234efgh5678'), `憑證樣式須遮罩, 實得: ${s}`) //契約D3: Bearer憑證遮罩
            assert.ok(s.includes('***'), `應以***取代, 實得: ${s}`)
            assert.strict.equal(calls[0][0], '[w-serv-broadcast] [sys:polling] verifyPolling error') //契約: 標籤不變
        })

        it('opt.logDetail為false: 同預設(只輸出摘要)', async function() {
            let tr = genTracer({ msCap: 3000 })
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace, logDetail: false, verifyPolling: () => `denied for ${SECRET}` })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET })
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.ok(!dump(calls).includes(SECRET))
            assert.deepStrictEqual(calls[0][1], { src: 'error', errType: 'string' })
        })

        it('opt.funLog: 診斷輸出只交給它(label, safe, detail), 不寫console; detail已遮罩', async function() {
            let tr = genTracer({ msCap: 3000 })
            let logs = []
            let srv = WServBroadcastServer(evem(), {
                onTrace: tr.onTrace,
                funLog: (...args) => {
                    logs.push(args)
                },
                verifyPolling: () => `denied for ${SECRET}`,
            })
            let calls = await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET })
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.deepStrictEqual(calls, []) //契約: 給予funLog時不寫console
            assert.strict.equal(logs.length, 1)
            assert.strict.equal(logs[0].length, 3)
            assert.strict.equal(logs[0][0], '[w-serv-broadcast] [sys:polling] permission denied')
            assert.deepStrictEqual(logs[0][1], { src: 'error', errType: 'string' })
            assert.ok(String(logs[0][2]).includes('denied for'), `funLog應收到細節, 實得: ${String(logs[0][2])}`) //契約D2: funLog取細節
            assert.ok(!String(logs[0][2]).includes(SECRET), `細節之token須遮罩, 實得: ${String(logs[0][2])}`) //契約D3
        })

        it('opt.funLog帶noDetail: 只收label與safe兩引數', async function() {
            let tr = genTracer({ msCap: 3000 })
            let logs = []
            let funLog = (...args) => {
                logs.push(args)
            }
            funLog.noDetail = true
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace, funLog, verifyPolling: () => `denied for ${SECRET}` })
            await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET })
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.strict.equal(logs.length, 1)
            assert.strict.equal(logs[0].length, 2) //契約: noDetail之funLog不收細節
        })

        it('opt.funLog拋錯: 不影響本套件之流程(停止與回覆照常)', async function() {
            let tr = genTracer({ msCap: 3000 })
            let rejects = []
            let srv = WServBroadcastServer(evem(), {
                onTrace: tr.onTrace,
                funLog: () => {
                    throw new Error('funLog failed')
                },
                verifyPolling: () => false,
            })
            await captureConsole(async () => {
                poll(srv, { clientId: 'c1', __sysToken__: SECRET }, genPm({ reject: (m) => rejects.push(m) }))
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            srv.clearBroadcast()
            assert.deepStrictEqual(rejects, ['[sys:polling] permission denied']) //契約D4: 診斷輸出之失敗不影響被測功能
        })

        it('建構提示(instWConverServer非有效物件): 預設仍console.log原文; 給予funLog時只交給它', async function() {
            let calls = await captureConsole(async () => {
                let srv = WServBroadcastServer(null)
                srv.clearBroadcast()
            }, 'log')
            assert.deepStrictEqual(calls, [['instWConverServer is not an effective object, and set instWConverServer to an EventEmitter']]) //契約: 預設輸出不變
            let logs = []
            let calls2 = await captureConsole(async () => {
                let srv = WServBroadcastServer(null, { funLog: (...args) => logs.push(args) })
                srv.clearBroadcast()
            }, 'log')
            assert.deepStrictEqual(calls2, []) //契約D1: 診斷輸出一律經diag, 給予funLog時不寫console
            assert.strict.equal(logs.length, 1)
            assert.strict.equal(logs[0][0], 'instWConverServer is not an effective object, and set instWConverServer to an EventEmitter')
        })

    })

    describe('client: 預設只輸出安全摘要', function() {

        it('無error監聽者, getToken拋錯(含token): 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), {
                timePolling: 50,
                onTrace: tr.onTrace,
                getToken: () => {
                    throw new Error(`token store failed ${SECRET}`)
                },
            })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            cli.clearBroadcast()
            assert.ok(calls.length >= 1)
            assert.ok(!dump(calls).includes(SECRET), `不得輸出err之值, 實得: ${dump(calls)}`) //契約D2
            assert.strict.equal(calls[0][0], '[w-serv-broadcast] [sys:polling] error')
            assert.deepStrictEqual(calls[0][1], { src: 'error', errType: 'Error' })
            assert.strict.equal(calls[0].length, 2)
        })

        it('無error監聽者, 回應不合協定(回應原值含token): 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve({ token: SECRET })), { timePolling: 50, onTrace: tr.onTrace })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            cli.clearBroadcast()
            assert.ok(!dump(calls).includes(SECRET), `不得輸出err之值, 實得: ${dump(calls)}`) //契約D2: err為回應原值
            assert.deepStrictEqual(calls[0][1], { src: 'error', errType: 'object' })
        })

        it('監聽器拋錯且無error監聽者(停止前): 只輸出標籤與摘要, 恰一次', async function() {
            let tr = genTracer({ msCap: 3000 })
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([{ mode: 'broadcast', data: 'x' }])), { timePolling: 50, onTrace: tr.onTrace })
            cli.on('broadcast', () => {
                throw new Error(`boom ${SECRET}`)
            })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'deliver', name: 'broadcast', ok: false })
            })
            cli.clearBroadcast()
            assert.strict.equal(calls.length, 1, `應恰輸出一次, 實得: ${dump(calls)}`)
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D2
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] listener of event[broadcast] error'])
            assert.deepStrictEqual(calls[0][1], { src: 'listener', name: 'broadcast', errType: 'Error' })
        })

        it('停止後之監聽器拋錯: 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), { timePolling: 50, onTrace: tr.onTrace })
            cli.on('openOnce', () => {
                cli.clearBroadcast() //於監聽器內停止, 其後拋錯屬停止後
                throw new Error(`boom ${SECRET}`)
            })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'deliver', name: 'openOnce', ok: false })
            })
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D2
            assert.deepStrictEqual(labels(calls), ['[w-serv-broadcast] listener of event[openOnce] error'])
            assert.deepStrictEqual(calls[0][1], { src: 'listener', name: 'openOnce', errType: 'Error' })
        })

        it('error監聽器自身拋錯: 只輸出標籤與摘要', async function() {
            let tr = genTracer({ msCap: 3000 })
            let cli = WServBroadcastClient(genConnector(() => Promise.reject(new Error('conn failed'))), { timePolling: 50, onTrace: tr.onTrace })
            cli.on('error', () => {
                throw new Error(`boom-error ${SECRET}`)
            })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'deliver', name: 'error', ok: false })
            })
            cli.clearBroadcast()
            assert.ok(!dump(calls).includes(SECRET), `不得輸出所拋之值, 實得: ${dump(calls)}`) //契約D2
            assert.strict.equal(calls[0][0], '[w-serv-broadcast] listener of event[error] error')
            assert.deepStrictEqual(calls[0][1], { src: 'listener', name: 'error', errType: 'Error' })
        })

        it('有error監聽者時照常發error事件(內容為原值), 不輸出診斷', async function() {
            let tr = genTracer({ msCap: 3000 })
            let errConn = new Error(`conn failed ${SECRET}`)
            let cli = WServBroadcastClient(genConnector(() => Promise.reject(errConn)), { timePolling: 50, onTrace: tr.onTrace })
            let errs = []
            cli.on('error', (e) => {
                errs.push(e)
            })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'deliver', name: 'error' })
            })
            cli.clearBroadcast()
            assert.deepStrictEqual(calls, []) //契約: 有監聽者時不輸出
            assert.strict.equal(errs[0].err, errConn) //契約: error事件之err為原值(身分不變, 不遮罩)
        })

    })

    describe('client: logDetail與funLog', function() {

        it('opt.logDetail為true: 輸出遮罩後之細節(getToken所得之token為***)', async function() {
            let tr = genTracer({ msCap: 3000 })
            let cli = WServBroadcastClient(genConnector(() => Promise.reject(new Error(`rejected token ${SECRET}`))), {
                timePolling: 50,
                onTrace: tr.onTrace,
                logDetail: true,
                getToken: () => SECRET,
            })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            cli.clearBroadcast()
            let s = dump(calls)
            assert.ok(s.includes('rejected token'), `logDetail應含錯誤細節, 實得: ${s}`) //契約D2
            assert.ok(!s.includes(SECRET), `token須遮罩, 實得: ${s}`) //契約D3: getToken所得之token遮罩
            assert.ok(s.includes('***'), `應以***取代, 實得: ${s}`)
        })

        it('opt.funLog: 診斷輸出只交給它(label, safe, detail), 不寫console', async function() {
            let tr = genTracer({ msCap: 3000 })
            let logs = []
            let cli = WServBroadcastClient(genConnector(() => Promise.reject(new Error(`rejected token ${SECRET}`))), {
                timePolling: 50,
                onTrace: tr.onTrace,
                getToken: () => SECRET,
                funLog: (...args) => {
                    logs.push(args)
                },
            })
            let calls = await captureConsole(async () => {
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
            })
            cli.clearBroadcast()
            assert.deepStrictEqual(calls, []) //契約: 給予funLog時不寫console
            assert.ok(logs.length >= 1)
            assert.strict.equal(logs[0].length, 3)
            assert.strict.equal(logs[0][0], '[w-serv-broadcast] [sys:polling] error')
            assert.deepStrictEqual(logs[0][1], { src: 'error', errType: 'Error' })
            assert.ok(String(logs[0][2]).includes('rejected token'), `funLog應收到細節, 實得: ${String(logs[0][2])}`)
            assert.ok(!String(logs[0][2]).includes(SECRET), `細節之token須遮罩, 實得: ${String(logs[0][2])}`) //契約D3
        })

    })

    describe('opt.logDetail與opt.funLog之型別檢核(建構期)', function() {

        let badLogDetail = ['true', 1, 0, {}, []]
        let badFunLog = ['x', 1, true, {}, []]

        it('伺服端: logDetail非布林、funLog非函數時建構拋錯, 不殘留計時器與監聽', function() {
            let n0 = countTimeout()
            for (let v of badLogDetail) {
                let ev = evem()
                assert.throws(() => WServBroadcastServer(ev, { logDetail: v }), { message: 'invalid opt.logDetail' }, `logDetail=${JSON.stringify(v)}`) //契約: 與w-serv-webdata同形
                assert.strict.equal(ev.listenerCount('execute'), 0) //契約R04: 先驗後配
            }
            for (let v of badFunLog) {
                let ev = evem()
                assert.throws(() => WServBroadcastServer(ev, { funLog: v }), { message: 'invalid opt.funLog' }, `funLog=${JSON.stringify(v)}`)
                assert.strict.equal(ev.listenerCount('execute'), 0)
            }
            assert.strict.equal(countTimeout(), n0) //契約R04: 不殘留計時器
        })

        it('伺服端: undefined、null、布林與函數可通過', function() {
            for (let opt of [{}, { logDetail: undefined }, { logDetail: null }, { logDetail: true }, { logDetail: false }, { funLog: undefined }, { funLog: null }, { funLog: () => {} }]) {
                let srv = WServBroadcastServer(evem(), opt)
                srv.clearBroadcast()
            }
        })

        it('前端: logDetail非布林、funLog非函數時建構拋錯, 不殘留計時器與掛載屬性', function() {
            let n0 = countTimeout()
            for (let v of badLogDetail) {
                let ev = genConnector(() => Promise.resolve([]))
                assert.throws(() => WServBroadcastClient(ev, { logDetail: v }), { message: 'invalid opt.logDetail' }, `logDetail=${JSON.stringify(v)}`)
                assert.strict.equal(ev.clearBroadcast, undefined) //契約R04: 先驗後配, 不留掛載屬性
            }
            for (let v of badFunLog) {
                let ev = genConnector(() => Promise.resolve([]))
                assert.throws(() => WServBroadcastClient(ev, { funLog: v }), { message: 'invalid opt.funLog' }, `funLog=${JSON.stringify(v)}`)
                assert.strict.equal(ev.clearBroadcast, undefined)
            }
            assert.strict.equal(countTimeout(), n0)
        })

        it('前端: undefined、null、布林與函數可通過', function() {
            for (let opt of [{}, { logDetail: undefined }, { logDetail: null }, { logDetail: true }, { logDetail: false }, { funLog: undefined }, { funLog: null }, { funLog: () => {} }]) {
                let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), opt)
                cli.clearBroadcast()
            }
        })

    })

})
