import assert from 'assert'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import { delay, waitFor, pollRaw } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastServer之JSDoc與README, 離線時之先後):
//客戶端離線(偵測到在線逾時10秒, 或clearBroadcast停止時之補發)時, 先清除該clientId之佇列與訊息, 才發出clientLeave與clientChange;
//故離線偵測之後, 以同一clientId輪詢者(含於clientLeave監聽內)取得新的空佇列, 取不到離線前之遺留訊息, 離線後、重新輪詢前之廣播亦不進入舊佇列;
//既有在線偵測與廣播語意不變: 持續輪詢者不離線且照常收到廣播, 重新輪詢後新廣播照常送達
//(起因: 以clientLeave解除clientId與身分綁定之使用端, 於離線後約1秒內他人可以同一clientId綁定並取得遺留之廣播)


//made, 本檔建立之伺服端實體; 於after一律停止(停止可重複呼叫), 使斷言失敗時不殘留計時器而讓mocha自行結束
let made = []

//runScenario, 真實時間約11秒: a、c、d(與注入組之e)各輪詢一次後即不再輪詢(其佇列有未取走之廣播m1、m2、m3), b持續每秒輪詢;
//  a、c、d、e約10秒後在線逾時離線:
//    a於clientLeave監聽內(同步)探測並以同一clientId輪詢; c於clientLeave監聽返回後(setImmediate)才探測並輪詢
//    d於離線後100ms: 先廣播m5, 再以同一clientId輪詢(離線後、重新輪詢前之廣播不得進入舊佇列)
//    e(僅注入組): 離線前第二次輪詢之驗證懸置(未計入在線), 於a之clientLeave監聽內放行, 即驗證在途跨離線
//  探測 = getMessages之鍵 + 以同一clientId輪詢之結果
let runScenario = async (withHook) => {
    let gate = { on: false, p: null, release: null }
    gate.p = new Promise((resolve) => {
        gate.release = resolve
    })
    let opt = {}
    if (withHook) {
        opt = { verifyPolling: (input) => (gate.on && input.clientId === 'e') ? gate.p : true }
    }
    let srv = WServBroadcastServer(evem(), opt)
    made.push(srv)
    let ids = withHook ? ['a', 'b', 'c', 'd', 'e'] : ['a', 'b', 'c', 'd']
    let leaves = []
    let probe = {}
    srv.on('clientLeave', (clientId) => {
        leaves.push(clientId)
        if (clientId === 'a') {
            probe.a = { keys: Object.keys(srv.getMessages()), poll: pollRaw(srv, { clientId: 'a' }) }
            gate.release(true) //e之驗證放行(驗證結算於本監聽返回後之微任務, 仍在修剪計時器之前)
            setTimeout(() => {
                let keys = Object.keys(srv.getMessages())
                srv.broadcast('m5')
                probe.d = { keys, poll: pollRaw(srv, { clientId: 'd' }) }
            }, 100)
        }
        else if (clientId === 'c') {
            setImmediate(() => {
                probe.c = { keys: Object.keys(srv.getMessages()), poll: pollRaw(srv, { clientId: 'c' }) }
            })
        }
    })

    //錯開修剪計時器之週期點: 修剪計時器自建構起每1秒一次, 在線逾時約為首次輪詢後10秒, 兩者若相近則修前行為(靠修剪計時器於離線後最多1秒才刪佇列)會偶然被修剪計時器先刪而漏抓
    //延後500ms使離線時點約落在兩次修剪之中間(距兩側各約0.5秒)
    await delay(500)

    //首次輪詢: 建立佇列與在線身分
    await Promise.all(ids.map((id) => pollRaw(srv, { clientId: id })))

    //離線前之廣播: a、c、d、e不再輪詢故未取走
    await delay(300)
    srv.broadcast('m1')
    srv.broadcast({ k: 2 })

    //b持續輪詢(保持在線並取走廣播), 直到離線者完成探測; 注入組於約9秒時令e再輪詢一次(驗證懸置)
    let t0 = Date.now()
    let sent3 = false
    let ePoll = null
    let bGot = []
    while (!(probe.a && probe.c) && Date.now() - t0 < 16000) {
        await delay(1000)
        if (!sent3 && Date.now() - t0 >= 4000) {
            srv.broadcast('m3')
            sent3 = true
        }
        if (withHook && ePoll === null && Date.now() - t0 >= 8000) {
            gate.on = true
            ePoll = pollRaw(srv, { clientId: 'e' }, 5000)
        }
        let r = await pollRaw(srv, { clientId: 'b' })
        bGot.push(...r.resolve.map((v) => v.data))
    }
    await waitFor(() => probe.d, 3000)
    let pa = probe.a ? await probe.a.poll : null
    let pc = probe.c ? await probe.c.poll : null
    let pd = probe.d ? await probe.d.poll : null
    let pe = ePoll !== null ? await ePoll : null

    //離線後逾一個佇列修剪週期(1秒)再觀察: 重新輪詢者之新佇列, 離線後的新廣播照常送達
    await delay(1500)
    srv.broadcast('m4')
    let postA = await pollRaw(srv, { clientId: 'a' })
    let postC = await pollRaw(srv, { clientId: 'c' })
    let rb = await pollRaw(srv, { clientId: 'b' })
    bGot.push(...rb.resolve.map((v) => v.data))
    let clients = srv.getClients().map((v) => v.key).sort()

    return {
        leaves,
        a: probe.a ? { keys: probe.a.keys, poll: pa } : null,
        c: probe.c ? { keys: probe.c.keys, poll: pc } : null,
        d: probe.d ? { keys: probe.d.keys, poll: pd } : null,
        e: pe,
        postA: { resolve: (postA.resolve || []).map((v) => v.data) },
        postC: { resolve: (postC.resolve || []).map((v) => v.data) },
        bGot,
        clients,
    }
}


describe('unit server leave queue', function() {

    after(function() {
        made.forEach((srv) => {
            srv.clearBroadcast()
        })
    })

    describe('在線逾時離線(真實時間, 約13秒)', function() {

        let res = {}

        before(async function() {
            this.timeout(60000)
            let rs = await Promise.all([
                runScenario(false),
                runScenario(true),
            ])
            res = { 未注入verifyPolling: rs[0], 注入verifyPolling: rs[1] }
        })

        for (let tag of ['未注入verifyPolling', '注入verifyPolling']) {

            describe(tag, function() {

                it('離線的是未再輪詢者, 持續輪詢之b不離線', function() {
                    let r = res[tag]
                    let expected = tag === '注入verifyPolling' ? ['a', 'c', 'd', 'e'] : ['a', 'c', 'd']
                    assert.deepStrictEqual(r.leaves.slice().sort(), expected) //契約: 在線偵測語意不變(逾時者離線, 持續輪詢者不離線)
                    assert.ok(r.clients.includes('b'), 'b應仍在線') //契約: 在線偵測語意不變
                })

                it('於clientLeave監聽內: 該clientId之佇列已不存在, 以同一clientId輪詢取不到離線前之遺留訊息', function() {
                    let r = res[tag]
                    assert.ok(r.a !== null, '應已探測到a之clientLeave')
                    assert.deepStrictEqual(r.a.poll, { resolve: [] }) //契約: 離線偵測之後以同一clientId輪詢者取得新空佇列(不含離線前之遺留訊息)
                    assert.ok(!r.a.keys.includes('a'), `clientLeave發出時a之佇列應已清除, 實得鍵: ${JSON.stringify(r.a.keys)}`) //契約: 離線偵測時先清除該clientId之佇列
                    assert.ok(r.a.keys.includes('b'), '持續輪詢之b之佇列不受影響') //契約: 只清離線者
                })

                it('於clientLeave之後立即(監聽返回後)以同一clientId輪詢: 取不到離線前之遺留訊息', function() {
                    let r = res[tag]
                    assert.ok(r.c !== null, '應已探測到c之clientLeave')
                    assert.deepStrictEqual(r.c.poll, { resolve: [] }) //契約: 離線偵測之後以同一clientId輪詢者取得新空佇列(不含離線前之遺留訊息)
                    assert.ok(!r.c.keys.includes('c'), `clientLeave之後c之佇列應已清除, 實得鍵: ${JSON.stringify(r.c.keys)}`) //契約: 離線偵測時先清除該clientId之佇列
                })

                it('離線後、重新輪詢前之廣播不進入舊佇列: 之後以同一clientId輪詢仍取得空佇列', function() {
                    let r = res[tag]
                    assert.ok(r.d !== null, '應已探測到d之離線後輪詢')
                    assert.ok(!r.d.keys.includes('d'), `離線後d不應有佇列, 實得鍵: ${JSON.stringify(r.d.keys)}`) //契約: 離線時先清除該clientId之佇列, 離線後的佇列由輪詢重新建立
                    assert.deepStrictEqual(r.d.poll, { resolve: [] }) //契約: 離線後廣播m5時d無佇列, 其後輪詢取得新空佇列(不含離線前之m1~m3與離線後、輪詢前之m5)
                })

                it('離線後重新輪詢者之新佇列: 離線後的新廣播照常送達, 不含離線前之訊息', function() {
                    let r = res[tag]
                    assert.deepStrictEqual(r.postA, { resolve: ['m5', 'm4'] }) //契約: 新佇列照常收廣播(僅重新輪詢之後的m5、m4)
                    assert.deepStrictEqual(r.postC, { resolve: ['m5', 'm4'] }) //契約: 同上
                })

                it('廣播語意不變: 持續輪詢之b依序收到離線前後之全部廣播(各一次)', function() {
                    let r = res[tag]
                    assert.deepStrictEqual(r.bGot, ['m1', { k: 2 }, 'm3', 'm5', 'm4']) //契約: 廣播語意不變(複製、依序、至多一次)
                })

            })

        }

        describe('注入verifyPolling: 驗證在途跨離線', function() {

            it('離線前發出而於離線後才放行之輪詢: 取得新空佇列(非離線前之遺留訊息), 並重新進入在線', function() {
                let r = res['注入verifyPolling']
                assert.deepStrictEqual(r.e, { resolve: [] }) //契約: 離線偵測之後(含驗證放行之輪詢)以同一clientId輪詢者取得新空佇列
                assert.ok(r.clients.includes('e'), '放行之輪詢應使e重新進入在線') //契約: 放行後行為同一般輪詢(建立在線身分)
            })

        })

    })

    describe('停止(clearBroadcast)之補發', function() {

        it('補發之clientLeave發出時該clientId之佇列已清空', async function() {
            let srv = WServBroadcastServer(evem())
            made.push(srv)
            let seen = []
            let entered = 0
            srv.on('clientEnter', () => {
                entered++
            })
            srv.on('clientLeave', (clientId) => {
                seen.push({ clientId, keys: Object.keys(srv.getMessages()) })
            })
            await pollRaw(srv, { clientId: 'a' })
            assert.ok(await waitFor(() => entered === 1), 'clientEnter應已送達(停止時只對已送達者補發)')
            srv.broadcast('m1')
            assert.deepStrictEqual(Object.keys(srv.getMessages()), ['a']) //前置: 停止前a之佇列有未取走之廣播
            srv.clearBroadcast()
            assert.ok(await waitFor(() => seen.length === 1), '應補發clientLeave')
            assert.deepStrictEqual(seen, [{ clientId: 'a', keys: [] }]) //契約: 補發之clientLeave發出時該clientId之佇列已清空(補發走timer, 於clearBroadcast同步段清空佇列之後才派發)
        })

    })

})
