import assert from 'assert'
import { mock } from 'node:test'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import { recordServer, advance } from './tools/helpers.mjs'
import { genTracer } from './tools/tracer.mjs'


//本檔對應之契約(WServBroadcastServer之JSDoc, opt.onTrace; 規格: dspec/計時器相關函數之觀察回調與測試.md P1~P4):
//onTrace於內部事件發生當下同步呼叫, 傳入凍結之{ type, ... }(欄位皆為原始值), 不帶接收者; 其拋錯與回傳之rejection皆忽略, 不影響廣播與在線偵測;
//未給或非函數時不組事件物件, 行為同未提供; 停止後除進行中之派發與補發事件外不再通知
//type: alive、prune、emit、deliver、report、stop(內容見JSDoc); 在線逾時固定10秒、修剪每1秒, 皆為規格者以假時鐘推進


//poll, 模擬一次前端輪詢: 與w-converhp派發execute之參數形狀相同(func, input, pm)
let poll = (srv, clientId, pm) => {
    if (!pm) {
        pm = { resolve: () => {}, reject: () => {} }
    }
    srv.emit('execute', '[sys:polling]', { clientId }, pm)
}

//noTick, 濾掉在線偵測每50ms一次之tick事件
let noTick = (events) => events.filter((e) => !(e.type === 'alive' && e.evType === 'tick'))


describe('server onTrace', function() {

    describe('事件內容與順序', function() {

        it('客戶端進入: alive之enter早於本套件clientEnter、clientChange之排定, 再依序派發', async function() {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            poll(srv, 'c1')
            await tr.wait({ type: 'deliver', name: 'clientChange' })
            srv.clearBroadcast()
            let es = noTick(tr.events).slice(0, 5).map((e) => ({ ...e }))
            assert.deepStrictEqual(es, [
                { type: 'alive', evType: 'enter', key: 'c1', now: 1 },
                { type: 'emit', name: 'clientEnter', final: false },
                { type: 'emit', name: 'clientChange', final: false },
                { type: 'deliver', name: 'clientEnter', final: false, ok: true },
                { type: 'deliver', name: 'clientChange', final: false, ok: true },
            ]) //契約: 在線偵測事件轉交, 派發依排定順序
        })

        it('在線逾時離線: alive之leave、佇列修剪每1秒一次, 離線後佇列已刪', function() {
            mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] }) //在線逾時(固定10秒)與修剪週期(1秒)皆為規格, 以假時鐘推進
            try {
                let tr = genTracer()
                let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
                poll(srv, 'c1')
                advance(10100)
                assert.deepStrictEqual(tr.of({ type: 'prune' }).map((e) => [e.queues, e.removed]), Array(10).fill([1, 0])) //契約: 每1秒修剪一次, 在線者之佇列保留
                let leave = tr.of({ type: 'alive', evType: 'leave' })
                assert.deepStrictEqual(leave.map((e) => [e.key, e.now]), [['c1', 0]]) //契約: 逾時後離線
                assert.deepStrictEqual(tr.of({ type: 'emit' }).slice(2).map((e) => e.name), ['clientLeave', 'clientChange']) //契約: 離線後排定clientLeave與clientChange
                assert.strict.equal(tr.of({ type: 'alive', evType: 'stop' }).length, 1) //契約: 佇列已空而停止偵測
                advance(900)
                assert.deepStrictEqual(tr.of({ type: 'prune' }).slice(10).map((e) => [e.queues, e.removed]), [[0, 0]]) //契約: 離線時已先刪佇列, 其後之修剪為0
                srv.clearBroadcast()
            }
            finally {
                mock.timers.reset()
            }
        })

        it('停止: 補發已排定後通知stop(final為補發之客戶端數), 補發事件帶final', async function() {
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), { onTrace: tr.onTrace })
            poll(srv, 'c1')
            poll(srv, 'c2')
            await tr.wait({ type: 'deliver', name: 'clientChange' }, 2)
            let from = tr.mark()
            srv.clearBroadcast()
            await tr.wait({ type: 'deliver', name: 'clientChange', final: true }, 2, from)
            let es = tr.events.slice(from).map((e) => ({ ...e }))
            assert.deepStrictEqual(es.slice(0, 5), [
                { type: 'emit', name: 'clientLeave', final: true },
                { type: 'emit', name: 'clientChange', final: true },
                { type: 'emit', name: 'clientLeave', final: true },
                { type: 'emit', name: 'clientChange', final: true },
                { type: 'stop', final: 2 },
            ]) //契約: 補發先排定, 其後stop
            assert.deepStrictEqual(es.slice(5).map((e) => [e.type, e.name, e.final, e.ok]), [
                ['deliver', 'clientLeave', true, true],
                ['deliver', 'clientChange', true, true],
                ['deliver', 'clientLeave', true, true],
                ['deliver', 'clientChange', true, true],
            ]) //契約: 停止後只有補發事件之派發
        })

        it('事件為凍結物件、回調不帶接收者、欄位皆為原始值', async function() {
            let thisVals = []
            let frozen = []
            let prims = []
            let tr = genTracer()
            let srv = WServBroadcastServer(evem(), {
                onTrace: function(e) {
                    thisVals.push(this)
                    frozen.push(Object.isFrozen(e))
                    prims.push(Object.values(e).every((v) => v === null || typeof v !== 'object'))
                    tr.onTrace(e)
                },
            })
            srv.on('error', () => {})
            poll(srv, 'c1', {
                resolve: () => {
                    throw new Error('resolve failed')
                },
                reject: () => {},
            })
            await tr.wait({ type: 'deliver', name: 'clientChange' })
            srv.clearBroadcast()
            assert.ok(frozen.length >= 8)
            assert.ok(thisVals.every((v) => v === undefined)) //契約: 不帶接收者
            assert.ok(frozen.every((v) => v === true)) //契約: 凍結之事件物件
            assert.ok(prims.every((v) => v === true)) //契約: 欄位為原始值(不含物件、陣列、Error)
        })

    })

    describe('回調不影響廣播(未傳、紀錄器、拋錯、回傳rejection、非函數結果相同)', function() {

        //run, 同一情境(c1進入、廣播一則並取走、停止補發)跑指定之onTrace, 回傳使用端所見之進出事件、輪詢回覆
        let run = async (onTrace) => {
            let unhandled = []
            let onUnhandled = (err) => {
                unhandled.push(err)
            }
            process.on('unhandledRejection', onUnhandled)
            try {
                let opt = {}
                if (onTrace !== undefined) {
                    opt.onTrace = onTrace
                }
                let srv = WServBroadcastServer(evem(), opt)
                let ms = recordServer(srv)
                let replies = []
                let pm = { resolve: (v) => replies.push(v), reject: (v) => replies.push(v) }
                let nChange = 0
                let entered = new Promise((resolve) => {
                    srv.on('clientChange', () => {
                        nChange++
                        if (nChange === 1) {
                            resolve()
                        }
                    })
                })
                poll(srv, 'c1', pm)
                await entered
                srv.broadcast('m1')
                poll(srv, 'c1', pm)
                let left = new Promise((resolve) => {
                    srv.on('clientChange', (n) => {
                        if (n === 0) {
                            resolve()
                        }
                    })
                })
                srv.clearBroadcast()
                await left
                await new Promise((resolve) => setImmediate(resolve)) //未處理之rejection於微任務與nextTick後才通報
                return { ms, replies, unhandled: unhandled.length }
            }
            finally {
                process.off('unhandledRejection', onUnhandled)
            }
        }

        let expected = { ms: ['enter|c1', 'change|1', 'leave|c1', 'change|0'], replies: [[], [{ mode: 'broadcast', data: 'm1' }]], unhandled: 0 }

        it('未傳onTrace', async function() {
            assert.deepStrictEqual(await run(undefined), expected) //契約: 未給時行為同未提供
        })

        it('傳紀錄器', async function() {
            let tr = genTracer()
            assert.deepStrictEqual(await run(tr.onTrace), expected) //契約: 給了紀錄器不改變結果
            assert.ok(tr.count({ type: 'deliver' }) >= 4)
        })

        it('傳會拋錯之回調', async function() {
            let n = 0
            assert.deepStrictEqual(await run(() => {
                n++
                throw new Error('trace boom')
            }), expected) //契約: 回調拋錯被忽略, 不中斷廣播與在線偵測亦不改變結果
            assert.ok(n >= 8) //每個事件皆有呼叫(拋錯不使後續事件停止通知)
        })

        it('傳回傳rejection之回調', async function() {
            let n = 0
            assert.deepStrictEqual(await run(() => {
                n++
                return Promise.reject(new Error('trace reject'))
            }), expected) //契約: 回傳之rejection被忽略, 無未處理之rejection
            assert.ok(n >= 8)
        })

        it('傳非函數', async function() {
            for (let v of [null, 'fn', 1, true, {}, []]) {
                assert.deepStrictEqual(await run(v), expected, String(v)) //契約: 非函數視為未給
            }
        })

    })

})
