import assert from 'assert'
import { mock } from 'node:test'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { advance } from './tools/helpers.mjs'
import { genTracer } from './tools/tracer.mjs'


//本檔對應之契約: 本套件於計時器內派發事件或呼叫外部函數時, 使用端監聽器之同步拋錯與外部函數之同步拋錯皆不得使行程崩潰(uncaughtException);
//error事件之內容一律為{ msg, err }: 監聽器拋錯為{ msg: 'listener of event[x] error', err: 所拋之值 }, 輪詢失敗為{ msg: '[sys:polling] error', err: 原因 };
//error監聽器自身拋錯則改以console.error輸出; 派發仍於呼叫之後才發生(維持脫勾之時序)
//另(兩端JSDoc): 本套件自發之error於派發當下無error監聽者時改以console.error輸出, 有監聽者時照常發error事件
//
//同步方式(規格: dspec/計時器相關函數之觀察回調與測試.md): 以兩端opt.onTrace之事件為同步點(見tools/tracer.mjs), 不以固定等待;
//在線逾時(固定10秒)本身即規格者以假時鐘(mock.timers)推進


//genPm, 模擬w-converhp傳入execute監聽器之回覆通道
let genPm = (opt = {}) => {
    return {
        resolve: opt.resolve || (() => {}),
        reject: opt.reject || (() => {}),
    }
}

//poll, 模擬一次前端輪詢: 與w-converhp派發execute之參數形狀相同(func, input, pm)
let poll = (srv, clientId, pm = genPm()) => {
    srv.emit('execute', '[sys:polling]', { clientId }, pm)
}

//captureConsoleError, 於執行fn期間記錄console.error之呼叫
let captureConsoleError = async (fn) => {
    let calls = []
    let ce = console.error
    console.error = (...args) => {
        calls.push(args)
    }
    try {
        await fn()
    }
    finally {
        console.error = ce
    }
    return calls
}

//genConnector, 模擬前端通訊物件: execute依給定之函數回應
let genConnector = (execute) => {
    let ev = evem()
    ev.execute = execute
    return ev
}


describe('listener error', function() {

    describe('server', function() {

        //checkListenerError, fnTrigger(srv)使伺服端派發evName; 同步點為本套件對該監聽器拋錯之通報(report, via為event), 其時error事件已送達error監聽器
        let checkListenerError = async (evName, fnTrigger) => {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            let errs = []
            srv.on('error', (err) => {
                errs.push(err)
            })
            srv.on(evName, () => {
                throw new Error(`boom-${evName}`)
            })
            fnTrigger(srv)
            await tr.wait({ type: 'report', src: 'listener', name: evName, via: 'event' })
            srv.clearBroadcast()
            let r = errs.find((e) => e && e.msg === `listener of event[${evName}] error`)
            assert.ok(r, `應收到${evName}之監聽器錯誤通報, 實得: ${JSON.stringify(errs)}`) //契約: 監聽器拋錯改以error事件通知, msg為listener of event[x] error
            assert.strict.equal(r.err.message, `boom-${evName}`) //契約: err為監聽器所拋之錯誤
        }

        it('clientEnter監聽器拋錯時不崩潰並以error事件通知', async function() {
            await checkListenerError('clientEnter', (srv) => {
                poll(srv, 'c1')
            })
        })

        it('clientChange監聽器拋錯時不崩潰並以error事件通知', async function() {
            await checkListenerError('clientChange', (srv) => {
                poll(srv, 'c1')
            })
        })

        it('clientLeave監聽器拋錯時不崩潰並以error事件通知', async function() {
            //clientLeave於在線偵測逾時(固定10000ms)後才派發; 逾時本身即規格, 以假時鐘推進(含Date, 在線偵測以Date.now判定)
            mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
            try {
                await checkListenerError('clientLeave', (srv) => {
                    poll(srv, 'c1')
                    advance(10100) //c1於首次輪詢後10000ms逾時, 偵測間隔50ms, 其後排定之clientLeave於1ms後派發
                })
            }
            finally {
                mock.timers.reset()
            }
        })

        it('error監聽器拋錯時不崩潰並改以console.error輸出', async function() {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            srv.on('error', () => {
                throw new Error('boom-error')
            })
            let rejects = []
            let calls = await captureConsoleError(async () => {
                //pm.resolve拋錯使輪詢走入例外處理, 該處以error事件通知
                poll(srv, 'c1', genPm({
                    resolve: () => {
                        throw new Error('resolve failed')
                    },
                    reject: (msg) => {
                        rejects.push(msg)
                    },
                }))
                //error事件已派發而其監聽器拋錯(ok為false), wsemi於其後同一堆疊內以console.error通報, 本處於該堆疊結束後續行
                let e = await tr.wait({ type: 'deliver', name: 'error' })
                assert.strict.equal(e.ok, false) //契約: error監聽器自身拋錯
            })
            srv.clearBroadcast()
            assert.deepStrictEqual(rejects, ['[sys:polling] error']) //契約: 輪詢例外時以reject回覆前端
            assert.ok(calls.some((args) => String(args[0]).includes(`[wsemi w-serv-broadcast] listener of 'error' threw`)), `應以console.error輸出, 實得: ${JSON.stringify(calls.map((args) => String(args[0])))}`) //契約: error監聽器拋錯改以console.error輸出
        })

        it('輪詢例外時之error事件內容為{ msg, err }', async function() {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            let errs = []
            srv.on('error', (err) => {
                errs.push(err)
            })
            poll(srv, 'c1', genPm({
                resolve: () => {
                    throw new Error('resolve failed')
                },
            }))
            await tr.wait({ type: 'deliver', name: 'error' })
            srv.clearBroadcast()
            assert.strict.equal(errs.length, 1, `應恰一則error, 實得: ${JSON.stringify(errs)}`) //契約: 一次失敗一則
            assert.strict.equal(errs[0].msg, '[sys:polling] error') //契約: msg為描述字串
            assert.strict.equal(errs[0].err.message, 'resolve failed') //契約: err為原因
        })

        it('事件於呼叫之後才派發', async function() {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            let got = []
            srv.on('clientEnter', (clientId) => {
                got.push(clientId)
            })
            poll(srv, 'c1')
            let nSync = got.length
            await tr.wait({ type: 'deliver', name: 'clientEnter' })
            srv.clearBroadcast()
            assert.strict.equal(nSync, 0) //契約: 派發不在呼叫端之同步堆疊內發生
            assert.deepStrictEqual(got, ['c1']) //契約: 其後照常派發
        })

        it('無error監聽者時, 輪詢例外以console.error輸出', async function() {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            let calls = await captureConsoleError(async () => {
                poll(srv, 'c1', genPm({
                    resolve: () => {
                        throw new Error('resolve failed')
                    },
                }))
                await tr.wait({ type: 'report', src: 'error', via: 'console' })
                srv.clearBroadcast()
            })
            assert.ok(calls.some((args) => args.some((a) => String(a).includes('[sys:polling] error'))), `應以console.error輸出, 實得: ${JSON.stringify(calls.map((args) => String(args[0])))}`) //契約: 本套件自發之error於無error監聽者時改以console.error輸出
        })

        it('有error監聽者時照常發error事件, 不以console.error輸出', async function() {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            let errs = []
            srv.on('error', (err) => {
                errs.push(err)
            })
            let calls = await captureConsoleError(async () => {
                poll(srv, 'c1', genPm({
                    resolve: () => {
                        throw new Error('resolve failed')
                    },
                }))
                //派發之路徑二擇一(error事件或console.error), 見到error事件之送達即知未走console.error
                await tr.wait({ type: 'deliver', name: 'error' })
                srv.clearBroadcast()
            })
            assert.strict.equal(errs.length, 1) //契約: 有監聽者時照常發error事件
            assert.deepStrictEqual(calls, []) //契約: 有監聽者時不以console.error輸出
        })

    })

    describe('client', function() {

        //checkListenerError, 通訊物件每輪回一則broadcast; 同步點為本套件對該監聽器拋錯之通報(report, via為event), 其時error事件已送達error監聽器
        let checkListenerError = async (evName) => {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([{ mode: 'broadcast', data: 'x' }])), { timePolling: 50, onTrace: tr.onTrace })
            let errs = []
            cli.on('error', (err) => {
                errs.push(err)
            })
            cli.on(evName, () => {
                throw new Error(`boom-${evName}`)
            })
            await tr.wait({ type: 'report', src: 'listener', name: evName, via: 'event' })
            cli.clearBroadcast()
            let r = errs.find((e) => e && e.msg === `listener of event[${evName}] error`)
            assert.ok(r, `應收到${evName}之監聽器錯誤通報, 實得: ${JSON.stringify(errs)}`) //契約: 監聽器拋錯改以error事件通知, msg為listener of event[x] error
            assert.strict.equal(r.err.message, `boom-${evName}`) //契約: err為監聽器所拋之錯誤
        }

        it('openOnce監聽器拋錯時不崩潰並以error事件通知', async function() {
            await checkListenerError('openOnce')
        })

        it('open監聽器拋錯時不崩潰並以error事件通知', async function() {
            await checkListenerError('open')
        })

        it('broadcast監聽器拋錯時不崩潰並以error事件通知', async function() {
            await checkListenerError('broadcast')
        })

        it('error監聽器拋錯時不崩潰並改以console.error輸出', async function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.reject(new Error('conn failed'))), { timePolling: 50, onTrace: tr.onTrace })
            cli.on('error', () => {
                throw new Error('boom-error')
            })
            let calls = await captureConsoleError(async () => {
                //error事件已派發而其監聽器拋錯(ok為false), wsemi於其後同一堆疊內以console.error通報, 本處於該堆疊結束後續行
                let e = await tr.wait({ type: 'deliver', name: 'error' })
                assert.strict.equal(e.ok, false) //契約: error監聽器自身拋錯
            })
            cli.clearBroadcast()
            assert.ok(calls.some((args) => String(args[0]).includes(`[wsemi w-serv-broadcast] listener of 'error' threw`)), `應以console.error輸出, 實得: ${JSON.stringify(calls.map((args) => String(args[0])))}`) //契約: error監聽器拋錯改以console.error輸出
        })

        it('輪詢失敗時之error事件內容為{ msg, err }', async function() {
            let errConn = new Error('conn failed')
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.reject(errConn)), { timePolling: 50, onTrace: tr.onTrace })
            let errs = []
            cli.on('error', (err) => {
                errs.push(err)
            })
            await tr.wait({ type: 'deliver', name: 'error' })
            cli.clearBroadcast()
            assert.ok(errs.length >= 1, `應收到error事件, 實得${errs.length}則`)
            assert.ok(errs.every((e) => e && e.msg === '[sys:polling] error' && e.err === errConn), `error事件應為{ msg, err }, 實得: ${JSON.stringify(errs)}`) //契約: 輪詢失敗為{ msg: '[sys:polling] error', err: 原因 }
        })

        it('execute同步拋錯時不崩潰並以error事件通知, 且持續輪詢', async function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => {
                throw new Error('sync fail')
            }), { timePolling: 50, onTrace: tr.onTrace })
            let errs = []
            cli.on('error', (err) => {
                errs.push(err)
            })
            await tr.wait({ type: 'deliver', name: 'error' }, 2) //待第2則error送達(以事件而非固定時窗計輪數)
            cli.clearBroadcast()
            assert.ok(errs.length >= 2, `應持續收到error事件, 實得${errs.length}則`) //契約: 外部函數同步拋錯不中止輪詢
            assert.deepStrictEqual(tr.of({ type: 'result' }).slice(0, 2).map((e) => [e.n, e.reason]), [[1, 'error'], [2, 'error']]) //契約: 第2輪照常發出(輪數連續)
            assert.ok(errs.every((e) => e && e.msg === '[sys:polling] error' && e.err instanceof Error && e.err.message === 'sync fail'), `error事件應為{ msg, err }, 實得: ${JSON.stringify(errs)}`) //契約: 輪詢失敗為{ msg: '[sys:polling] error', err: 所拋之錯誤 }
        })

        it('execute回傳非Promise時不崩潰並以error事件通知', async function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => undefined), { timePolling: 50, onTrace: tr.onTrace })
            let errs = []
            cli.on('error', (err) => {
                errs.push(err)
            })
            await tr.wait({ type: 'deliver', name: 'error' })
            cli.clearBroadcast()
            assert.ok(errs.length >= 1 && errs.every((e) => e && e.msg === '[sys:polling] error' && e.err instanceof TypeError), `應收到err為TypeError之error事件, 實得: ${JSON.stringify(errs)}`) //契約: 外部函數回傳非預期值不使行程崩潰, 以{ msg, err }通知
        })

        it('無error監聽者時, 輪詢失敗以console.error輸出', async function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => {
                return Promise.reject(new Error('conn failed'))
            }), { timePolling: 50, onTrace: tr.onTrace })
            let calls = await captureConsoleError(async () => {
                await tr.wait({ type: 'report', src: 'error', via: 'console' }) //待本套件改以console.error通報
                cli.clearBroadcast()
            })
            assert.ok(calls.some((args) => args.some((a) => String(a).includes('[sys:polling] error'))), `應以console.error輸出, 實得: ${JSON.stringify(calls.map((args) => String(args[0])))}`) //契約: 本套件自發之error於無error監聽者時改以console.error輸出
        })

        it('有error監聽者時照常發error事件, 不以console.error輸出', async function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.reject(new Error('conn failed'))), { timePolling: 50, onTrace: tr.onTrace })
            let errs = []
            cli.on('error', (err) => {
                errs.push(err)
            })
            let calls = await captureConsoleError(async () => {
                await tr.wait({ type: 'deliver', name: 'error' }) //派發之路徑二擇一(error事件或console.error), 見到error事件之送達即知未走console.error
                cli.clearBroadcast()
            })
            assert.ok(errs.length >= 1) //契約: 有監聽者時照常發error事件
            assert.deepStrictEqual(calls, []) //契約: 有監聽者時不以console.error輸出
        })

    })

})
