import assert from 'assert'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { delay, waitFor, countTimeout, genConnector, recordClient } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastClient之JSDoc, opt.getToken):
//使用端可給getToken(sync或async皆可), 每次輪詢前呼叫, 其回傳之字串放於輪詢輸入之固定鍵__sysToken__(非字串取空字串);
//getToken拋錯或reject時該輪不發出輪詢, 以{ msg: '[sys:polling] error', err }通知並轉為未連線, 下一輪恢復; 停止時getToken在途者其後不發出輪詢、不派發事件;
//未給getToken(undefined或null)時輪詢輸入恰為{ clientId }(同現行); 給了但非函數者於建構時拋錯(不殘留計時器、不掛載clearBroadcast)


let KEY = '__sysToken__'

//deferred
let deferred = () => {
    let o = {}
    o.promise = new Promise((resolve, reject) => {
        o.resolve = resolve
        o.reject = reject
    })
    return o
}

//made, 本檔建立之前端實體; 於afterEach一律停止(停止可重複呼叫), 使斷言失敗時不殘留計時器而讓mocha自行結束
let made = []

//gen, 建構前端, 記錄各輪execute之輸入與第4參數
let gen = (opt, fnRound) => {
    let inputs = []
    let opts = []
    let conn = genConnector((n, func, input, cb, o) => {
        inputs.push({ func, input })
        opts.push(o)
        return fnRound ? fnRound(n) : Promise.resolve([])
    })
    conn.clientId = 'cid-1'
    let cli = WServBroadcastClient(conn, { timePolling: 20, ...opt })
    made.push(cli)
    let rec = recordClient(cli)
    return { cli, conn, rec, inputs, opts }
}


describe('client getToken', function() {

    afterEach(function() {
        made.forEach((cli) => {
            cli.clearBroadcast()
        })
        made.length = 0
    })

    it('sync與async之getToken之回傳值放於輪詢輸入之固定鍵__sysToken__, 每輪重新取得(token可輪替)', async function() {
        for (let mode of ['sync', 'async']) {
            let n = 0
            let getToken = () => `tok-${++n}`
            if (mode === 'async') {
                getToken = async () => {
                    await delay(1)
                    return `tok-${++n}`
                }
            }
            let { cli, conn, inputs } = gen({ getToken })
            assert.ok(await waitFor(() => conn.nExec >= 3), mode)
            cli.clearBroadcast()
            assert.ok(inputs.length >= 3)
            inputs.slice(0, 3).forEach((v, i) => {
                assert.strict.equal(v.func, '[sys:polling]', mode)
                assert.deepStrictEqual(v.input, { clientId: 'cid-1', [KEY]: `tok-${i + 1}` }, `${mode} 第${i + 1}輪`) //契約: token放於固定鍵__sysToken__, 每輪重新呼叫getToken
            })
        }
    })

    it('getToken回傳非字串時token取空字串(欄位不消失)', async function() {
        for (let v of [undefined, null, 123, true, {}, []]) {
            for (let mode of ['sync', 'async']) {
                let getToken = () => v
                if (mode === 'async') {
                    getToken = async () => v
                }
                let { cli, conn, inputs } = gen({ getToken })
                assert.ok(await waitFor(() => conn.nExec >= 1))
                cli.clearBroadcast()
                assert.deepStrictEqual(inputs[0].input, { clientId: 'cid-1', [KEY]: '' }, `${mode} 回傳${String(v)}`) //契約: 非字串取空字串
                assert.ok(Object.hasOwn(inputs[0].input, KEY), '欄位須存在(傳輸時undefined欄位會消失)') //契約: 固定鍵恆存在
            }
        }
    })

    it('未給getToken(undefined或null)時輪詢輸入恰為{ clientId }, 不帶固定鍵', async function() {
        for (let opt of [{}, { getToken: undefined }, { getToken: null }]) {
            let { cli, conn, inputs } = gen(opt)
            assert.ok(await waitFor(() => conn.nExec >= 2))
            cli.clearBroadcast()
            inputs.forEach((v) => {
                assert.deepStrictEqual(v.input, { clientId: 'cid-1' }, JSON.stringify(opt)) //契約: 未給getToken時同現行, 輸入恰為{ clientId }
            })
        }
    })

    it('帶getToken時execute仍帶第4參數{ signal }, 停止時該signal被中止', async function() {
        let { cli, conn, opts } = gen({ getToken: () => 't' }, () => new Promise(() => {})) //永不結算之在途輪詢
        assert.ok(await waitFor(() => conn.nExec >= 1))
        assert.ok(opts[0].signal instanceof AbortSignal) //契約: 第4參數帶signal(R10)
        assert.strict.equal(opts[0].signal.aborted, false)
        cli.clearBroadcast()
        assert.strict.equal(opts[0].signal.aborted, true) //契約: 停止時中止在途之輪詢請求(R10)
    })

    it('getToken拋錯或reject時該輪不發出輪詢, 以輪詢失敗通知並轉為未連線; 連線前後失敗皆下一輪恢復(再次open)', async function() {
        for (let mode of ['throw', 'reject']) {
            let boom = new Error('token store down')
            let failing = true
            let getToken = () => {
                if (!failing) {
                    return 'tok-ok'
                }
                if (mode === 'throw') {
                    throw boom
                }
                return Promise.reject(boom)
            }
            let { cli, conn, rec, inputs } = gen({ getToken })

            //(1) 首次連線前失敗: 該輪不呼叫execute, 以輪詢失敗通知
            assert.ok(await waitFor(() => rec.count('error') >= 2), `${mode}: 失敗之輪各發一則error`)
            assert.strict.equal(conn.nExec, 0, `${mode}: 失敗之輪不得呼叫execute`) //契約: getToken失敗之輪不呼叫execute
            rec.of('error').slice(0, 2).forEach((e) => {
                assert.deepStrictEqual(e, { msg: '[sys:polling] error', err: boom }, mode) //契約: error內容為{ msg, err }, err為所拋之值
            })
            assert.strict.equal(rec.count('open'), 0, `${mode}: 失敗時不視為已連線`)

            //(2) 恢復: 下一輪重新取得token並連上
            failing = false
            assert.ok(await waitFor(() => rec.count('open') === 1), `${mode}: 恢復後應open`)
            assert.deepStrictEqual(inputs[0].input, { clientId: 'cid-1', [KEY]: 'tok-ok' }, mode) //契約: 恢復後之輪帶新取得之token
            assert.strict.equal(rec.count('openOnce'), 1, mode)

            //(3) 已連線後失敗: 轉為未連線, 失敗之輪不發出輪詢
            failing = true
            let nErr = rec.count('error')
            assert.ok(await waitFor(() => rec.count('error') >= nErr + 2), `${mode}: 已連線後失敗亦各發一則error`) //契約: 每輪失敗發一則error
            let nExec = conn.nExec
            await delay(100)
            assert.strict.equal(conn.nExec, nExec, `${mode}: 失敗期間不得再呼叫execute`) //契約: getToken失敗之輪不呼叫execute

            //(4) 再恢復: 由未連線轉為連線再發open, openOnce仍只一次
            failing = false
            assert.ok(await waitFor(() => rec.count('open') === 2), `${mode}: 失敗後恢復應再發open`) //契約: 失敗轉為未連線, 恢復時再發open
            assert.strict.equal(rec.count('openOnce'), 1, mode) //契約: openOnce只發一次
            cli.clearBroadcast()
        }
    })

    it('getToken回傳thenable(非Promise)時依Promise規則吸收', async function() {
        let { cli, conn, inputs } = gen({ getToken: () => ({ then: (res) => res('tok-thenable') }) })
        assert.ok(await waitFor(() => conn.nExec >= 1))
        cli.clearBroadcast()
        assert.deepStrictEqual(inputs[0].input, { clientId: 'cid-1', [KEY]: 'tok-thenable' }) //契約: getToken sync或async(含thenable)皆可
    })

    it('execute未回傳Promise時, 給了getToken與未給者同視為輪詢失敗(不當成回應)', async function() {
        for (let opt of [{}, { getToken: () => 't' }]) {
            let tag = JSON.stringify(Object.keys(opt))
            let { cli, rec } = gen(opt, () => []) //execute同步回傳陣列而非Promise
            assert.ok(await waitFor(() => rec.count('error') >= 2), tag)
            cli.clearBroadcast()
            assert.strict.equal(rec.count('open'), 0, `${tag}: 不得把非Promise之回傳值當成回應而連上`) //契約: 未回傳Promise視為輪詢失敗
            assert.strict.equal(rec.count('openOnce'), 0, tag)
            rec.of('error').forEach((e) => {
                assert.strict.equal(e.msg, '[sys:polling] error', tag) //契約: 失敗以{ msg: '[sys:polling] error', err }通知
            })
        }
    })

    it('未給getToken時於計時器回呼內同步發出execute; 給了getToken時須先取得token, 不同步發出', function() {
        for (let [name, opt, nSync] of [['未給', {}, 1], ['給了', { getToken: () => 't' }, 0]]) {
            let cb = null
            let setInterval0 = globalThis.setInterval
            globalThis.setInterval = (fn) => {
                cb = fn
                return setInterval0(() => {}, 2147483647) //真實計時器實際不觸發, 回呼由本測試手動呼叫
            }
            let conn = genConnector(() => Promise.resolve([]))
            try {
                made.push(WServBroadcastClient(conn, { timePolling: 50, ...opt }))
            }
            finally {
                globalThis.setInterval = setInterval0
            }
            cb() //手動觸發一輪
            assert.strict.equal(conn.nExec, nSync, `${name}getToken: 計時器回呼返回時execute呼叫次數`) //契約: 未給getToken時行為同現行(同步發出)
        }
    })

    it('getToken慢於輪詢間隔時不重入(同一時間至多一個在途)', async function() {
        let inflight = 0
        let maxInflight = 0
        let nCall = 0
        let getToken = async () => {
            nCall++
            inflight++
            maxInflight = Math.max(maxInflight, inflight)
            await delay(80)
            inflight--
            return 't'
        }
        let { cli, conn } = gen({ getToken, timePolling: 10 })
        assert.ok(await waitFor(() => conn.nExec >= 2, 5000))
        cli.clearBroadcast()
        assert.strict.equal(maxInflight, 1) //契約: 前一輪未結束不重入(execIng)
        assert.ok(nCall <= conn.nExec + 1, `getToken呼叫次數${nCall}不應遠多於execute次數${conn.nExec}`)
    })

    it('停止時getToken在途: 其後解析也不發出輪詢、不派發事件、不殘留計時器', async function() {
        await delay(5) //async測試開頭同步量計時器數會少1(sgud/exp/experience.md E10), 先讓出再量基準
        for (let mode of ['resolve', 'reject']) {
            let n0 = countTimeout()
            let d = deferred()
            let called = 0
            let getToken = () => {
                called++
                return d.promise
            }
            let { cli, conn, rec } = gen({ getToken })
            assert.ok(await waitFor(() => called >= 1), mode)
            cli.clearBroadcast()
            if (mode === 'resolve') {
                d.resolve('late-token')
            }
            else {
                d.reject(new Error('late boom'))
            }
            await delay(60)
            assert.strict.equal(conn.nExec, 0, `${mode}: 停止後不得發出輪詢`) //契約: 停止時getToken在途者其後不發出輪詢
            assert.deepStrictEqual(rec.list, [], `${mode}: 不派發任何事件(含error)`) //契約: 停止後不再派發本套件之事件
            assert.strict.equal(called, 1, `${mode}: 停止後不再呼叫getToken`) //契約: 停止後不再呼叫getToken
            assert.ok(countTimeout() <= n0, `${mode}: 不殘留計時器(停止後之計時器數不得多於建構前: ${countTimeout()} > ${n0})`) //契約: 停止後不持有計時器(以<=比較: 同一worker前一案之暫時計時器可能於期間到期, 只會使數量減少)
        }
    })

    it('getToken給了但非函數(undefined與null除外)時建構即拋錯, 不殘留計時器、不掛載clearBroadcast', function() {
        for (let v of [true, false, 0, 1, 'fn', '', {}, [], Symbol('x')]) {
            let conn = genConnector(() => Promise.resolve([]))
            let n0 = countTimeout()
            assert.throws(() => {
                made.push(WServBroadcastClient(conn, { getToken: v })) //契約成立時建構即拋錯而不會登記; 紅燈時登記以便afterEach停止
            }, { message: 'opt.getToken is not a function' }, String(typeof v)) //契約: 給了非函數者於建構時拋錯
            assert.strict.equal(countTimeout(), n0, '不殘留計時器') //契約: 建構失敗時不留下計時器(R04)
            assert.strict.equal(conn.clearBroadcast, undefined, '不掛載clearBroadcast') //契約: 先驗後配(R04)
        }
    })

})
