import assert from 'assert'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import { delay, waitFor, countTimeout, captureConsole, hasCall, recordServer, pollRaw } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastServer之JSDoc, opt.verifyPolling):
//使用端注入verifyPolling(input)驗證輪詢之身分; 每次[sys:polling]於任何副作用(建立佇列、在線身分、取出訊息)之前呼叫, 傳入輪詢之輸入(複本, 含clientId與固定鍵__sysToken__之token);
//回傳(或resolve)嚴格true才放行, 其他值、拋錯或reject一律拒絕: 以固定訊息[sys:polling] permission denied拒絕該次輪詢, 不建立任何狀態, 並發error事件供稽核;
//放行時行為同未注入, 惟交給使用端之clientEnter/clientLeave之data已剝除token; 未注入(undefined或null)時行為同現行(輸入原物件交付, 不剝除任何鍵);
//給了但非函數者於建構時拋錯(不殘留計時器、監聽與掛載屬性); 伺服端停止時在途之驗證於解析後不建立任何狀態、不發任何事件、不回應


let KEY = '__sysToken__'
let TOKEN = 'tok-SECRET-123'
let DENIED = '[sys:polling] permission denied'
let HOOK_ERR = '[sys:polling] verifyPolling error'

//made, 本檔建立之伺服端實體; 於afterEach一律停止(停止可重複呼叫), 使斷言失敗時不殘留計時器而讓mocha自行結束
let made = []

//gen, 建構伺服端並記錄進出與error事件
let gen = (verifyPolling) => {
    let srv = WServBroadcastServer(evem(), verifyPolling === undefined ? {} : { verifyPolling })
    made.push(srv)
    let ms = recordServer(srv)
    let enters = []
    let leaves = []
    let errs = []
    srv.on('clientEnter', (clientId, data) => {
        enters.push({ clientId, data })
    })
    srv.on('clientLeave', (clientId, data) => {
        leaves.push({ clientId, data })
    })
    srv.on('error', (e) => {
        errs.push(e)
    })
    return { srv, ms, enters, leaves, errs }
}

//deferred, 可由測試決定何時結算之promise
let deferred = () => {
    let o = {}
    o.promise = new Promise((resolve, reject) => {
        o.resolve = resolve
        o.reject = reject
    })
    return o
}


describe('server verifyPolling', function() {

    afterEach(function() {
        made.forEach((srv) => {
            srv.clearBroadcast()
        })
        made.length = 0
    })

    describe('放行(嚴格true)', function() {

        it('sync與async之鉤子回true時, 行為同未注入: 回佇列、建立在線身分、發clientEnter; clientEnter之data已剝除token', async function() {
            let hooks = {
                sync: () => true,
                async: async () => true,
                thenable: () => ({ then: (res) => res(true) }),
            }
            for (let [name, hook] of Object.entries(hooks)) {
                let { srv, ms, enters } = gen(hook)
                let input = { clientId: 'a', [KEY]: TOKEN, note: 'n1' }
                let r = await pollRaw(srv, input, 100)
                assert.deepStrictEqual(r, { resolve: [] }, `${name}: 首輪回空陣列`) //契約: 放行時行為同未注入
                srv.broadcast('m1')
                let r2 = await pollRaw(srv, { clientId: 'a', [KEY]: TOKEN }, 100)
                assert.deepStrictEqual(r2, { resolve: [{ mode: 'broadcast', data: 'm1' }] }, `${name}: 取到其後之廣播`) //契約: 放行時行為同未注入
                assert.ok(await waitFor(() => ms.length >= 2), `${name}: 應發進場事件`)
                assert.deepStrictEqual(ms.slice(0, 2), ['enter|a', 'change|1'], name) //契約: 建立在線身分並發clientEnter、clientChange
                assert.deepStrictEqual(enters[0].data, { clientId: 'a', note: 'n1' }, `${name}: clientEnter之data無token`) //契約: 放行後交使用端監聽之前剝除token
                assert.deepStrictEqual(input, { clientId: 'a', [KEY]: TOKEN, note: 'n1' }, `${name}: 不改動呼叫端傳入之輸入物件`) //契約: 剝除不就地改動輸入
                srv.clearBroadcast()
            }
        })

        it('token不出現在交使用端之任何資料: clientEnter、getClients、clientLeave(含clearBroadcast補發)', async function() {
            let { srv, ms, enters, leaves } = gen(() => true)
            await pollRaw(srv, { clientId: 'a', [KEY]: 'tok-A-1', x: 1 })
            await pollRaw(srv, { clientId: 'a', [KEY]: 'tok-A-2', x: 2 }) //token輪替
            await pollRaw(srv, { clientId: 'b', [KEY]: 'tok-B-1' })
            assert.ok(await waitFor(() => enters.length === 2))
            assert.deepStrictEqual(srv.getClients().map((v) => v.data).sort((p, q) => p.clientId < q.clientId ? -1 : 1), [{ clientId: 'a', x: 2 }, { clientId: 'b' }]) //契約: 在線身分之data無token
            srv.clearBroadcast()
            assert.ok(await waitFor(() => leaves.length === 2))
            let all = JSON.stringify({ enters, leaves, ms })
            assert.ok(!all.includes('tok-'), `事件資料不得含token, 實得: ${all}`) //契約: token不進入交使用端監聽之事件資料
            assert.deepStrictEqual(leaves.map((v) => v.data).sort((p, q) => p.clientId < q.clientId ? -1 : 1), [{ clientId: 'a', x: 2 }, { clientId: 'b' }]) //契約: clientLeave之data為最後一次輪詢之輸入(已剝除token)
        })

        it('鉤子收到輸入之複本(含clientId與token), 其改動不影響clientId與交使用端之data', async function() {
            let seen = []
            let { srv, enters } = gen((input) => {
                seen.push(input)
                input.clientId = 'evil'
                delete input[KEY]
                input.extra = 1
                return true
            })
            let input = { clientId: 'x', [KEY]: TOKEN, k: 'v' }
            await pollRaw(srv, input)
            assert.strict.equal(seen.length, 1)
            assert.notStrictEqual(seen[0], input) //契約: 傳入鉤子者為複本, 非呼叫端之原物件
            assert.deepStrictEqual(input, { clientId: 'x', [KEY]: TOKEN, k: 'v' }) //契約: 鉤子之改動不影響原輸入
            assert.ok(await waitFor(() => enters.length === 1))
            assert.strict.equal(enters[0].clientId, 'x') //契約: 檢查之clientId即使用之clientId
            assert.deepStrictEqual(enters[0].data, { clientId: 'x', k: 'v' }) //契約: 交使用端之data不受鉤子改動影響
            assert.deepStrictEqual(Object.keys(srv.getMessages()), ['x'])
            srv.clearBroadcast()
        })

        it('共用同一input之其他execute監聽於驗證期間改動輸入, 不影響clientId與交使用端之data(快照)', async function() {
            let d = deferred()
            let { srv, enters } = gen(() => d.promise)
            //同一事件物件上各execute監聽共用同一input; 此監聽註冊於本套件之後, 於本套件取得快照之後才執行
            srv.on('execute', (func, input) => {
                if (func === '[sys:polling]') {
                    input.clientId = 'evil'
                    input.extra = 'x'
                    input.k = 'changed'
                }
            })
            let p = pollRaw(srv, { clientId: 'x', [KEY]: TOKEN, k: 'v' }, 300)
            await delay(20)
            d.resolve(true)
            assert.deepStrictEqual(await p, { resolve: [] })
            assert.ok(await waitFor(() => enters.length === 1))
            assert.strict.equal(enters[0].clientId, 'x') //契約: 檢查之值即使用之值
            assert.deepStrictEqual(enters[0].data, { clientId: 'x', k: 'v' }) //契約: 交使用端之data取自驗證時之快照
            assert.deepStrictEqual(Object.keys(srv.getMessages()), ['x'])
        })

        it('輸入之clientId為每次讀取不同之getter時, 檢查之值即使用之值', async function() {
            let seqs = [['victim', 'owner'], ['owner', 'victim']]
            let outs = []
            for (let seq of seqs) {
                let reads = 0
                let input = { [KEY]: TOKEN }
                Object.defineProperty(input, 'clientId', {
                    enumerable: true,
                    get: () => seq[Math.min(reads++, 1)],
                })
                let { srv } = gen((x) => x.clientId === 'owner') //鉤子只放行owner
                let r = await pollRaw(srv, input)
                outs.push({ seq: seq.join('>'), r, keys: Object.keys(srv.getMessages()) })
                srv.clearBroadcast()
            }
            //契約: 鉤子看到之clientId即交給佇列與在線偵測者: 首讀為victim者鉤子與使用皆為victim(被拒, 無狀態); 首讀為owner者皆為owner(放行, 只有owner之佇列)
            assert.deepStrictEqual(outs, [
                { seq: 'victim>owner', r: { reject: DENIED }, keys: [] },
                { seq: 'owner>victim', r: { resolve: [] }, keys: ['owner'] },
            ])
        })

        it('輸入含循環參照時, 交使用端之data(含其巢狀參照)皆已剝除token, 呼叫端之原物件不變', async function() {
            let { srv, enters } = gen(() => true)
            let input = { clientId: 'a', [KEY]: TOKEN }
            input.self = input
            await pollRaw(srv, input)
            assert.ok(await waitFor(() => enters.length === 1))
            assert.ok(!Object.hasOwn(enters[0].data, KEY)) //契約: 交使用端之data無token
            assert.ok(!Object.hasOwn(enters[0].data.self, KEY), '巢狀(循環)參照所指亦不得帶token') //契約: token不進入交使用端之任何資料
            assert.ok(Object.hasOwn(input, KEY), '呼叫端之原物件不被改動') //契約: 剝除不就地改動輸入
        })

        it('驗證放行後不再讀取原輸入物件(快照)', async function() {
            let d = deferred()
            let reads = 0
            let handler = {
                get: (t, k) => {
                    reads++
                    return t[k]
                },
            }
            let input = new Proxy({ clientId: 'a', [KEY]: TOKEN }, handler)
            let { srv } = gen(() => d.promise)
            let p = pollRaw(srv, input, 300)
            await delay(20)
            let n = reads
            d.resolve(true)
            await p
            assert.ok(n > 0, '取得快照時應讀過原輸入')
            assert.strict.equal(reads, n, '放行後之處理不得再讀原輸入物件') //契約: 檢查之值即使用之值, 放行後不再依賴可被改動之原輸入
        })

        it('鉤子傳入之輸入含clientId與使用端放入之身分資訊', async function() {
            let seen = []
            let { srv } = gen((input) => {
                seen.push(input)
                return true
            })
            await pollRaw(srv, { clientId: 'a', [KEY]: TOKEN, other: { deep: [1, 2] } })
            assert.deepStrictEqual(seen, [{ clientId: 'a', [KEY]: TOKEN, other: { deep: [1, 2] } }]) //契約: 傳入輪詢之輸入(含clientId與token)
            srv.clearBroadcast()
        })

    })

    describe('拒絕', function() {

        it('鉤子回非true(含看似真之值)時以固定訊息拒絕, 不建立佇列與在線身分、不發進出事件, 發error事件', async function() {
            let values = [false, undefined, null, 0, 1, -1, NaN, '', 'true', 'x', {}, [], [true], { ok: true }, Object(true), 'user-1']
            for (let v of values) {
                for (let mode of ['sync', 'async']) {
                    let hook = mode === 'sync' ? () => v : async () => v
                    let { srv, ms, enters, errs } = gen(hook)
                    let r = await pollRaw(srv, { clientId: 'x', [KEY]: TOKEN })
                    let tag = `${mode} ${String(v)}`
                    assert.deepStrictEqual(r, { reject: DENIED }, `${tag}: 固定拒絕訊息`) //契約: 非嚴格true一律以固定訊息拒絕
                    assert.deepStrictEqual(srv.getMessages(), {}, `${tag}: 不建立佇列`) //契約: 拒絕不建立任何狀態
                    assert.deepStrictEqual(srv.getClients(), [], `${tag}: 不建立在線身分`) //契約: 拒絕不建立任何狀態
                    assert.ok(await waitFor(() => errs.length >= 1), `${tag}: 應發error事件`)
                    await delay(30)
                    assert.deepStrictEqual(ms, [], `${tag}: 不發clientEnter與clientChange`) //契約: 拒絕不觸發clientEnter
                    assert.deepStrictEqual(enters, [], tag)
                    assert.strict.equal(errs.length, 1, `${tag}: 恰一則error`) //契約: 拒絕發error事件供稽核
                    assert.deepStrictEqual(errs[0], { msg: DENIED, err: v }, tag) //契約: error事件內容為{ msg, err }, err為鉤子之回傳值
                    srv.clearBroadcast()
                }
            }
        })

        it('鉤子拋錯或reject視同拒絕: 固定拒絕訊息不含鉤子拋出之內容, 不建立任何狀態, 發error事件(err為所拋之值)', async function() {
            let secret = new Error(`db down for ${TOKEN}`)
            let thrown = [secret, 'str-throw', undefined, { code: 1 }]
            for (let v of thrown) {
                for (let mode of ['throw', 'reject']) {
                    let hook = () => Promise.reject(v)
                    if (mode === 'throw') {
                        hook = () => {
                            throw v
                        }
                    }
                    let { srv, ms, errs } = gen(hook)
                    let r = await pollRaw(srv, { clientId: 'x', [KEY]: TOKEN })
                    let tag = `${mode} ${String(v)}`
                    assert.deepStrictEqual(r, { reject: DENIED }, `${tag}: 固定拒絕訊息(不洩漏原因)`) //契約: 拋錯或reject視同拒絕, 回固定訊息
                    assert.deepStrictEqual(srv.getMessages(), {}, tag) //契約: 不建立任何狀態
                    assert.deepStrictEqual(srv.getClients(), [], tag) //契約: 不建立任何狀態
                    assert.ok(await waitFor(() => errs.length >= 1), `${tag}: 應發error事件`)
                    await delay(30)
                    assert.deepStrictEqual(ms, [], tag) //契約: 拒絕不觸發clientEnter
                    assert.strict.equal(errs.length, 1, tag)
                    assert.strict.equal(errs[0].msg, HOOK_ERR, tag) //契約: 鉤子本身失敗之稽核訊息
                    assert.strict.equal(errs[0].err, v, tag) //契約: err為所拋之值
                    srv.clearBroadcast()
                }
            }
        })

        it('鉤子回thenable(非Promise)時依Promise規則吸收: resolve非true或reject皆視同拒絕', async function() {
            let cases = [
                { name: 'thenable resolve false', hook: () => ({ then: (res) => res(false) }), msg: DENIED, err: false },
                { name: 'thenable reject', hook: () => ({ then: (res, rej) => rej('t-rej') }), msg: HOOK_ERR, err: 't-rej' },
                { name: 'Promise reject 字串', hook: () => Promise.reject('s-rej'), msg: HOOK_ERR, err: 's-rej' },
                { name: 'async 函數 return undefined', hook: async () => {}, msg: DENIED, err: undefined },
            ]
            for (let c of cases) {
                let { srv, errs } = gen(c.hook)
                assert.deepStrictEqual(await pollRaw(srv, { clientId: 'x' }), { reject: DENIED }, c.name) //契約: 非嚴格true一律以固定訊息拒絕
                assert.deepStrictEqual(srv.getMessages(), {}, c.name) //契約: 拒絕不建立任何狀態
                assert.ok(await waitFor(() => errs.length >= 1), c.name)
                assert.deepStrictEqual(errs[0], { msg: c.msg, err: c.err }, c.name) //契約: 鉤子回傳非true與鉤子失敗之error訊息分別為permission denied與verifyPolling error
            }
        })

        it('已在線者被拒絕時, 不取走其佇列、不刷新其在線資料; 其後放行即恢復', async function() {
            let allow = true
            let { srv, errs } = gen(() => allow)
            await pollRaw(srv, { clientId: 'a', v: 1 })
            srv.broadcast('m1')
            allow = false
            let r = await pollRaw(srv, { clientId: 'a', v: 2 })
            assert.deepStrictEqual(r, { reject: DENIED })
            assert.deepStrictEqual(srv.getMessages().a, [{ mode: 'broadcast', data: 'm1' }]) //契約: 拒絕時不取出訊息(不洩漏、不遺失)
            assert.deepStrictEqual(srv.getClients().map((v) => v.data), [{ clientId: 'a', v: 1 }]) //契約: 拒絕時不刷新在線身分
            allow = true
            assert.deepStrictEqual(await pollRaw(srv, { clientId: 'a', v: 3 }), { resolve: [{ mode: 'broadcast', data: 'm1' }] }) //契約: 放行即恢復, 取到先前保留之訊息
            assert.ok(await waitFor(() => errs.length >= 1))
            await delay(30)
            assert.strict.equal(errs.length, 1) //契約: 只有被拒絕那次發error
            srv.clearBroadcast()
        })

        it('灌入多個不同clientId(皆被拒)時, 不建立任何佇列與在線身分', async function() {
            let { srv, ms, errs } = gen(() => false)
            for (let i = 0; i < 200; i++) {
                let r = await pollRaw(srv, { clientId: `c${i}`, [KEY]: '' })
                assert.deepStrictEqual(r, { reject: DENIED })
            }
            assert.deepStrictEqual(srv.getMessages(), {}) //契約: 拒絕不建立任何狀態
            assert.deepStrictEqual(srv.getClients(), [])
            srv.broadcast('secret')
            assert.deepStrictEqual(srv.getMessages(), {}) //契約: 被拒者不在線, 收不到廣播
            assert.ok(await waitFor(() => errs.length === 200))
            assert.deepStrictEqual(ms, [])
            srv.clearBroadcast()
        })

        it('放行後回覆本身拋錯時, 以輪詢處理失敗通知並拒絕該次輪詢; 拒絕亦拋錯時只通知, 不產生未處理的rejection', async function() {
            let { srv, errs } = gen(() => true)
            let rejected = null
            let pm1 = {
                resolve: () => {
                    throw new Error('resolve boom')
                },
                reject: (v) => {
                    rejected = v
                },
            }
            srv.emit('execute', '[sys:polling]', { clientId: 'a' }, pm1)
            assert.ok(await waitFor(() => rejected !== null))
            assert.strict.equal(rejected, '[sys:polling] error') //契約: 放行後處理失敗時拒絕該次輪詢(請求不懸置)
            assert.ok(await waitFor(() => errs.length >= 1))
            assert.strict.equal(errs[0].msg, '[sys:polling] error') //契約: 輪詢處理失敗發{ msg: '[sys:polling] error', err }
            assert.strict.equal(errs[0].err.message, 'resolve boom')

            let unhandled = []
            let onUn = (e) => {
                unhandled.push(e)
            }
            process.on('unhandledRejection', onUn)
            try {
                let pm2 = {
                    resolve: () => {
                        throw new Error('r1')
                    },
                    reject: () => {
                        throw new Error('r2')
                    },
                }
                srv.emit('execute', '[sys:polling]', { clientId: 'b' }, pm2)
                assert.ok(await waitFor(() => errs.length >= 3), '回覆與拒絕各失敗一次, 皆應通知')
                await delay(50)
                assert.deepStrictEqual(errs.slice(1).map((e) => e.err.message), ['r1', 'r2'])
                assert.deepStrictEqual(unhandled, []) //契約: 失敗不成為未處理的rejection(不使行程崩潰)
            }
            finally {
                process.off('unhandledRejection', onUn)
            }
        })

        it('同一clientId之兩個驗證交錯結算(後到者先完成)時, 兩者皆處理, 只有一個佇列與在線身分, 訊息不重複', async function() {
            let ds = [deferred(), deferred(), deferred()]
            ds[2].resolve(true)
            let n = 0
            let { srv, enters } = gen(() => ds[n++].promise)
            let p1 = pollRaw(srv, { clientId: 'a', v: 1 }, 500)
            let p2 = pollRaw(srv, { clientId: 'a', v: 2 }, 500)
            await delay(20)
            ds[1].resolve(true)
            assert.deepStrictEqual(await p2, { resolve: [] }) //後到者先完成: 先建立佇列
            srv.broadcast('m1')
            ds[0].resolve(true)
            assert.deepStrictEqual(await p1, { resolve: [{ mode: 'broadcast', data: 'm1' }] }) //先到者後完成: 取走其間廣播之訊息
            assert.deepStrictEqual(Object.keys(srv.getMessages()), ['a']) //契約: 同一clientId只有一個佇列
            assert.strict.equal(srv.getClients().length, 1) //契約: 同一clientId只有一個在線身分
            assert.deepStrictEqual(await pollRaw(srv, { clientId: 'a', v: 3 }), { resolve: [] }) //契約: 訊息至多取走一次, 不重複
            assert.ok(await waitFor(() => enters.length >= 1))
            await delay(30)
            assert.strict.equal(enters.length, 1) //契約: 同一clientId只進場一次
        })

        it('拒絕且無error監聽者時改以console.error輸出, 不拋錯', async function() {
            let srv = WServBroadcastServer(evem(), { verifyPolling: () => false })
            made.push(srv)
            let logs = await captureConsole(async () => {
                let r = await pollRaw(srv, { clientId: 'x' })
                assert.deepStrictEqual(r, { reject: DENIED })
                await delay(50)
            }, 'error')
            assert.ok(hasCall(logs, DENIED), `應以console.error輸出, 實得: ${JSON.stringify(logs)}`) //契約: 本套件之error無監聽者時改以console.error輸出
            srv.clearBroadcast()
        })

        it('併發: 兩個驗證同時在途, 先拒後放, 只有放行者建立狀態', async function() {
            let ds = { bad: deferred(), good: deferred() }
            let { srv, ms, errs } = gen((input) => ds[input.clientId].promise)
            let pBad = pollRaw(srv, { clientId: 'bad' }, 300)
            let pGood = pollRaw(srv, { clientId: 'good' }, 300)
            await delay(20)
            assert.deepStrictEqual(srv.getMessages(), {}) //契約: 驗證在途時尚無任何副作用
            ds.bad.resolve(false)
            ds.good.resolve(true)
            assert.deepStrictEqual(await pBad, { reject: DENIED })
            assert.deepStrictEqual(await pGood, { resolve: [] })
            assert.deepStrictEqual(Object.keys(srv.getMessages()), ['good']) //契約: 只有放行者建立佇列
            assert.deepStrictEqual(srv.getClients().map((v) => v.key), ['good'])
            assert.ok(await waitFor(() => ms.length >= 2))
            assert.deepStrictEqual(ms.slice(0, 2), ['enter|good', 'change|1'])
            assert.ok(await waitFor(() => errs.length >= 1))
            await delay(30)
            assert.strict.equal(errs.length, 1)
            srv.clearBroadcast()
        })

    })

    describe('呼叫時點與範圍', function() {

        it('鉤子於任何副作用之前呼叫: 呼叫當下尚無佇列、在線身分與進出事件', async function() {
            let snap = null
            let g = gen((input) => {
                snap = {
                    messages: Object.keys(g.srv.getMessages()),
                    clients: g.srv.getClients().map((v) => v.key),
                    ms: g.ms.slice(),
                }
                return true
            })
            await pollRaw(g.srv, { clientId: 'other' })
            assert.ok(await waitFor(() => g.ms.length >= 2))
            let msBefore = g.ms.slice()
            await pollRaw(g.srv, { clientId: 'x', [KEY]: TOKEN })
            assert.deepStrictEqual(snap.messages, ['other'], '呼叫當下不得已有x之佇列') //契約: 鉤子於建立佇列之前呼叫
            assert.deepStrictEqual(snap.clients, ['other'], '呼叫當下不得已有x之在線身分') //契約: 鉤子於建立在線身分之前呼叫
            assert.deepStrictEqual(snap.ms, msBefore) //契約: 鉤子於觸發clientEnter之前呼叫
            assert.deepStrictEqual(Object.keys(g.srv.getMessages()).sort(), ['other', 'x'])
            g.srv.clearBroadcast()
        })

        it('鉤子於取出訊息之前呼叫: 呼叫當下該clientId之佇列內容尚在', async function() {
            let seen = null
            let g = gen((input) => {
                seen = g.srv.getMessages().a
                return true
            })
            await pollRaw(g.srv, { clientId: 'a' })
            g.srv.broadcast('m1')
            await pollRaw(g.srv, { clientId: 'a' })
            assert.deepStrictEqual(seen, [{ mode: 'broadcast', data: 'm1' }]) //契約: 鉤子於取出(清空)訊息之前呼叫
            g.srv.clearBroadcast()
        })

        it('只對[sys:polling]呼叫鉤子; clientId不合者先拒絕, 不呼叫鉤子、不發error', async function() {
            let n = 0
            let { srv, errs } = gen(() => {
                n++
                return true
            })
            let r = await pollRaw(srv, { clientId: 'a' }, 50, 'foo')
            assert.deepStrictEqual(r, { unsettled: true }) //契約: 其他函數名本套件不回應
            for (let input of [{}, { clientId: '' }, null, { clientId: 123 }, { clientId: ['a'] }]) {
                assert.deepStrictEqual(await pollRaw(srv, input), { reject: '[sys:polling] invalid clientId' }, JSON.stringify(input)) //契約: clientId不是非空字串者拒絕(R02)
            }
            await delay(30)
            assert.strict.equal(n, 0) //契約: 驗證只針對有效之輪詢
            assert.deepStrictEqual(errs, []) //契約: 無效clientId不發error
            assert.deepStrictEqual(await pollRaw(srv, { clientId: 'ok' }), { resolve: [] })
            assert.strict.equal(n, 1) //對照: 有效之[sys:polling]恰呼叫鉤子一次(排除鉤子根本未接上而使上列斷言空洞成立)
            srv.clearBroadcast()
        })

    })

    describe('停止', function() {

        it('驗證在途時clearBroadcast, 其後鉤子解析為true: 不建立任何狀態、不發任何事件、不回應', async function() {
            let d = deferred()
            let { srv, ms, enters, leaves, errs } = gen(() => d.promise)
            let p = pollRaw(srv, { clientId: 'x', [KEY]: TOKEN }, 150)
            await delay(10)
            srv.clearBroadcast()
            d.resolve(true)
            assert.deepStrictEqual(await p, { unsettled: true }) //契約: 停止後不再回應輪詢
            await delay(30)
            assert.deepStrictEqual(srv.getMessages(), {}) //契約: 停止後不建立佇列
            assert.deepStrictEqual(srv.getClients(), []) //契約: 停止後不建立在線身分(亦不再啟動在線偵測)
            assert.deepStrictEqual([ms, enters, leaves, errs], [[], [], [], []]) //契約: 停止後不再派發本套件之事件
        })

        it('驗證在途時clearBroadcast, 其後鉤子解析為false或拋錯: 不發error、不回應', async function() {
            for (let mode of ['false', 'reject']) {
                let d = deferred()
                let { srv, ms, errs } = gen(() => d.promise)
                let p = pollRaw(srv, { clientId: 'x' }, 150)
                await delay(10)
                srv.clearBroadcast()
                if (mode === 'false') {
                    d.resolve(false)
                }
                else {
                    d.reject(new Error('boom'))
                }
                assert.deepStrictEqual(await p, { unsettled: true }, mode) //契約: 停止後不再回應輪詢
                await delay(30)
                assert.deepStrictEqual([ms, errs], [[], []], mode) //契約: 停止後不再派發本套件之事件(含error)
            }
        })

        it('停止後才到之輪詢不呼叫鉤子', async function() {
            let n = 0
            let { srv } = gen(() => {
                n++
                return true
            })
            srv.clearBroadcast()
            assert.deepStrictEqual(await pollRaw(srv, { clientId: 'x' }, 50), { unsettled: true }) //契約: 停止後不回應輪詢
            assert.strict.equal(n, 0) //契約: 停止後不再驗證
        })

    })

    describe('在線期限(真實時間, 約12秒)', function() {

        it('被拒絕之輪詢不刷新在線期限, 自然離線之clientLeave仍按最後一次放行起算; 其data無token', async function() {
            this.timeout(40000)
            let allow = true
            let { srv, leaves } = gen(() => allow)
            let tLeave = 0
            srv.on('clientLeave', () => {
                tLeave = Date.now()
            })
            let t0 = Date.now()
            await pollRaw(srv, { clientId: 'a', [KEY]: 'tok-A', x: 1 }) //唯一一次放行
            await delay(4000)
            allow = false
            assert.deepStrictEqual(await pollRaw(srv, { clientId: 'a', [KEY]: 'tok-B', x: 2 }), { reject: DENIED }) //約4秒時被拒
            await delay(3500)
            assert.deepStrictEqual(await pollRaw(srv, { clientId: 'a', [KEY]: 'tok-C', x: 3 }), { reject: DENIED }) //約7.5秒時被拒
            assert.ok(await waitFor(() => leaves.length === 1, 9000), '應於放行後約10秒自然離線') //若被拒絕之輪詢刷新期限, 離線會晚於約17.5秒
            let dt = tLeave - t0
            assert.ok(dt >= 8500 && dt <= 13500, `自然離線應在最後一次放行後約10秒, 實得${dt}ms`) //契約: 被拒絕不刷新在線身分
            assert.deepStrictEqual(leaves[0], { clientId: 'a', data: { clientId: 'a', x: 1 } }) //契約: clientLeave之data為最後一次放行之輸入(已剝除token)
        })

    })

    describe('建構與相容', function() {

        it('verifyPolling給了但非函數(undefined與null除外)時建構即拋錯, 不殘留計時器、監聽與掛載屬性', function() {
            let bad = [true, false, 0, 1, 'fn', '', {}, [], Symbol('x'), Object(true)]
            for (let v of bad) {
                let ev = evem()
                let n0 = countTimeout()
                assert.throws(() => {
                    made.push(WServBroadcastServer(ev, { verifyPolling: v })) //契約成立時建構即拋錯而不會登記; 紅燈時登記以便afterEach停止
                }, { message: 'opt.verifyPolling is not a function' }, String(typeof v) + ' ' + String(v?.toString?.())) //契約: 給了非函數者於建構時拋錯(不得靜默放行)
                assert.strict.equal(countTimeout(), n0, '不殘留計時器') //契約: 建構失敗時不留下計時器(R04)
                assert.strict.equal(ev.listenerCount('execute'), 0, '不殘留監聽') //契約: 建構失敗時不留下監聽(R04)
                assert.strict.equal(ev.broadcast, undefined, '不掛載屬性') //契約: 先驗後配
                assert.strict.equal(ev.clearBroadcast, undefined, '不掛載屬性')
            }
        })

        it('未注入(undefined或null)時行為同現行: 同步回應、輸入原物件交付(不剝除任何鍵)', async function() {
            for (let opt of [{}, { verifyPolling: undefined }, { verifyPolling: null }, undefined]) {
                let srv = WServBroadcastServer(evem(), opt)
                made.push(srv)
                let enters = []
                srv.on('clientEnter', (clientId, data) => {
                    enters.push({ clientId, data })
                })
                //同步回應: 回呼於emit返回前已結算(現行行為, 未注入時不增加任何非同步)
                let settled = null
                let input = { clientId: 'a', [KEY]: TOKEN, k: 1 }
                let pm = {
                    resolve: (v) => {
                        settled = { resolve: v }
                    },
                    reject: (v) => {
                        settled = { reject: v }
                    },
                }
                srv.emit('execute', '[sys:polling]', input, pm)
                assert.deepStrictEqual(settled, { resolve: [] }, JSON.stringify(opt)) //契約: 未注入時同步回應
                assert.ok(await waitFor(() => enters.length === 1))
                assert.strict.equal(enters[0].data, input, '未注入時clientEnter之data即輸入原物件') //契約: 未注入時行為同現行(輸入原物件交付)
                srv.clearBroadcast()
            }
        })

        it('與其後註冊且對[sys:polling]同步回應之監聽並存時: 未提供鉤子由本套件先結算, 提供鉤子則由該監聽先結算(回覆為非同步, 該監聽須略過[sys:polling])', async function() {
            let catchAll = (func, input, pm) => {
                pm.resolve({ state: 'error', msg: 'invalid token' })
            }
            let a = WServBroadcastServer(evem())
            made.push(a)
            a.on('execute', catchAll)
            assert.deepStrictEqual(await pollRaw(a, { clientId: 'a' }), { resolve: [] }) //契約: 未提供鉤子時同步回覆, 先於後註冊之監聽(現行行為)
            let { srv } = gen(() => true)
            srv.on('execute', catchAll)
            assert.deepStrictEqual(await pollRaw(srv, { clientId: 'a' }), { resolve: { state: 'error', msg: 'invalid token' } }) //契約: 提供鉤子時回覆為非同步, 後註冊且同步回應之監聽先結算(JSDoc 載明該監聽須略過[sys:polling])
        })

        it('停止後以同一事件物件重新建構(注入鉤子)可正常運作', async function() {
            let ev = evem()
            let s1 = WServBroadcastServer(ev, { verifyPolling: () => false })
            made.push(s1)
            assert.deepStrictEqual(await pollRaw(ev, { clientId: 'a' }), { reject: DENIED })
            s1.clearBroadcast()
            let s2 = WServBroadcastServer(ev, { verifyPolling: () => true })
            made.push(s2)
            assert.deepStrictEqual(await pollRaw(ev, { clientId: 'a' }), { resolve: [] }) //契約: 重建之新實體使用新鉤子
            s2.clearBroadcast()
        })

    })

})
