import assert from 'assert'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { genConnector } from './tools/helpers.mjs'
import { genTracer } from './tools/tracer.mjs'


//本檔對應之契約(WServBroadcastClient之JSDoc, opt.onTrace; 規格: dspec/計時器相關函數之觀察回調與測試.md P1~P4):
//onTrace於內部事件發生當下同步呼叫, 傳入凍結之{ type, ... }(欄位皆為原始值), 不帶接收者; 其拋錯與回傳之rejection皆忽略, 不影響輪詢與結果;
//未給或非函數時不組事件物件, 行為同未提供; 停止後除進行中之派發外不再通知
//type: start、tick、request、result、emit、deliver、report、stop(內容見JSDoc)


//deferred, 可由測試決定何時結算之promise
let deferred = () => {
    let o = {}
    o.promise = new Promise((resolve, reject) => {
        o.resolve = resolve
        o.reject = reject
    })
    return o
}

//flushMicro, 讓出所有已排入之微任務(含promise鏈)
let flushMicro = async () => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve()
    }
}


describe('client onTrace', function() {

    describe('事件內容與順序', function() {

        it('首輪合格回應: start、tick、request、result依序, 其後排定並派發openOnce、open、broadcast(非broadcast之mode略過)', async function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([{ mode: 'broadcast', data: 'x' }, { mode: 'other' }])), { timePolling: 30, onTrace: tr.onTrace })
            await tr.wait({ type: 'deliver', name: 'broadcast' })
            cli.clearBroadcast()
            let es = tr.events.map((e) => ({ ...e }))
            assert.deepStrictEqual(es.slice(0, 4), [
                { type: 'start', ms: 30 },
                { type: 'tick', n: 1, skipped: false },
                { type: 'request', n: 1, token: false },
                { type: 'result', n: 1, ok: true, reason: 'ok', msgs: 2 },
            ]) //契約: 首輪之事件順序與欄位
            assert.deepStrictEqual(tr.of({ type: 'emit' }).slice(0, 3).map((e) => [e.name, e.final]), [['openOnce', false], ['open', false], ['broadcast', false]]) //契約: 只排定openOnce、open與broadcast
            assert.deepStrictEqual(tr.of({ type: 'deliver' }).slice(0, 3).map((e) => [e.name, e.final, e.ok]), [['openOnce', false, true], ['open', false, true], ['broadcast', false, true]]) //契約: 依排定順序派發
        })

        it('事件為凍結物件、回調不帶接收者、欄位皆為原始值', async function() {
            let thisVals = []
            let frozen = []
            let prims = []
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([{ mode: 'broadcast', data: { a: 1 } }])), {
                timePolling: 30,
                onTrace: function(e) {
                    thisVals.push(this)
                    frozen.push(Object.isFrozen(e))
                    prims.push(Object.values(e).every((v) => v === null || typeof v !== 'object'))
                    tr.onTrace(e)
                },
            })
            await tr.wait({ type: 'deliver', name: 'broadcast' })
            cli.clearBroadcast()
            assert.ok(frozen.length >= 8)
            assert.ok(thisVals.every((v) => v === undefined)) //契約: 不帶接收者
            assert.ok(frozen.every((v) => v === true)) //契約: 凍結之事件物件
            assert.ok(prims.every((v) => v === true)) //契約: 欄位為原始值(不含物件、陣列、Error)
        })

        it('給了getToken: request帶token旗標; getToken拋錯之該輪不發出request, 以result通知失敗', async function() {
            let tr = genTracer()
            let n = 0
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), {
                timePolling: 30,
                getToken: () => {
                    n++
                    if (n === 1) {
                        throw new Error('token failed')
                    }
                    return 'tok'
                },
                onTrace: tr.onTrace,
            })
            cli.on('error', () => {})
            await tr.wait({ type: 'result', ok: true })
            cli.clearBroadcast()
            assert.deepStrictEqual(tr.of({ type: 'result' }).slice(0, 2).map((e) => [e.n, e.reason]), [[1, 'error'], [2, 'ok']]) //契約: 第1輪失敗, 第2輪合格
            assert.deepStrictEqual(tr.of({ type: 'request' }).slice(0, 1).map((e) => [e.n, e.token]), [[2, true]]) //契約: 第1輪不發出request; 第2輪帶token
        })

        it('回應不合協定: result為invalid, 其後以error事件通知', async function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve({ not: 'array' })), { timePolling: 30, onTrace: tr.onTrace })
            cli.on('error', () => {})
            await tr.wait({ type: 'deliver', name: 'error' })
            cli.clearBroadcast()
            let r = tr.of({ type: 'result' })[0]
            assert.deepStrictEqual({ ...r }, { type: 'result', n: 1, ok: false, reason: 'invalid' }) //契約: 不合協定之回應不視為已連線
            assert.strict.equal(tr.count({ type: 'emit', name: 'open' }), 0) //契約: 不發open
        })

        it('前一輪尚在途時計時器觸發: tick帶skipped, 不重入; 在途者結算後才有下一輪', async function() {
            let tr = genTracer()
            let d = deferred()
            let cli = WServBroadcastClient(genConnector((n) => (n === 1 ? d.promise : Promise.resolve([]))), { timePolling: 20, onTrace: tr.onTrace })
            await tr.wait({ type: 'tick', skipped: true }, 2) //前一輪在途而被略過2次
            assert.strict.equal(tr.count({ type: 'request' }), 1) //契約: 同一時間至多一個在途
            d.resolve([])
            await tr.wait({ type: 'result', n: 2 })
            cli.clearBroadcast()
            assert.deepStrictEqual(tr.of({ type: 'tick', skipped: true }).slice(0, 2).map((e) => e.n), [1, 1]) //契約: 略過者帶在途那一輪之輪數
            assert.deepStrictEqual(tr.of({ type: 'result' }).slice(0, 2).map((e) => e.n), [1, 2])
        })

        it('停止: stop帶inflight旗標, 可重複呼叫只通知一次, 其後在途之結果不再通知', async function() {
            let tr = genTracer()
            let d = deferred()
            let cli = WServBroadcastClient(genConnector(() => d.promise), { timePolling: 20, onTrace: tr.onTrace })
            await tr.wait({ type: 'request' })
            cli.clearBroadcast()
            cli.clearBroadcast()
            d.resolve([{ mode: 'broadcast', data: 'late' }])
            await flushMicro() //在途之結果於停止後才到, 由停止判斷略過
            assert.strict.equal(tr.count({ type: 'stop' }), 1) //契約: 停止只通知一次
            assert.strict.equal(tr.of({ type: 'stop' })[0].inflight, true) //契約: 停止時有在途之輪詢
            assert.strict.equal(tr.events[tr.events.length - 1].type, 'stop') //契約: 停止後不再通知(含在途之結果)
        })

        it('停止時無在途之輪詢: stop之inflight為false', function() {
            let tr = genTracer()
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), { timePolling: 1000, onTrace: tr.onTrace })
            cli.clearBroadcast()
            assert.deepStrictEqual(tr.events.map((e) => ({ ...e })), [{ type: 'start', ms: 1000 }, { type: 'stop', inflight: false }]) //契約: 建構後立即停止, 無輪詢
        })

    })

    describe('回調不影響輪詢(未傳、紀錄器、拋錯、回傳rejection、非函數結果相同)', function() {

        //run, 同一情境(第1輪失敗、第2輪起合格並廣播)跑指定之onTrace, 回傳使用端所見之事件序列與廣播內容
        let run = async (onTrace) => {
            let unhandled = []
            let onUnhandled = (err) => {
                unhandled.push(err)
            }
            process.on('unhandledRejection', onUnhandled)
            try {
                let seq = []
                let datas = []
                let opt = { timePolling: 20 }
                if (onTrace !== undefined) {
                    opt.onTrace = onTrace
                }
                let cli = WServBroadcastClient(genConnector((n) => (n === 1 ? Promise.reject(new Error('first failed')) : Promise.resolve([{ mode: 'broadcast', data: n }]))), opt)
                let done = new Promise((resolve) => {
                    for (let name of ['openOnce', 'open', 'error', 'broadcast']) {
                        cli.on(name, (v) => {
                            seq.push(name)
                            if (name === 'broadcast') {
                                datas.push(v)
                                if (datas.length === 2) {
                                    resolve()
                                }
                            }
                        })
                    }
                })
                await done
                cli.clearBroadcast()
                await new Promise((resolve) => setImmediate(resolve)) //未處理之rejection於微任務與nextTick後才通報
                return { seq: seq.slice(0, 5), datas, unhandled: unhandled.length, execs: cli.nExec >= 3 }
            }
            finally {
                process.off('unhandledRejection', onUnhandled)
            }
        }

        let expected = { seq: ['error', 'openOnce', 'open', 'broadcast', 'broadcast'], datas: [2, 3], unhandled: 0, execs: true }

        it('未傳onTrace', async function() {
            assert.deepStrictEqual(await run(undefined), expected) //契約: 未給時行為同未提供
        })

        it('傳紀錄器', async function() {
            let tr = genTracer()
            assert.deepStrictEqual(await run(tr.onTrace), expected) //契約: 給了紀錄器不改變結果
            assert.ok(tr.count({ type: 'result' }) >= 3)
        })

        it('傳會拋錯之回調', async function() {
            let n = 0
            assert.deepStrictEqual(await run(() => {
                n++
                throw new Error('trace boom')
            }), expected) //契約: 回調拋錯被忽略, 不中斷輪詢亦不改變結果
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
