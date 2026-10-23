import assert from 'assert'
import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { delay, waitFor, recordClient } from './tools/helpers.mjs'


//本檔以真WConverhpServer/WConverhpClient經HTTP(固定埠8098, 各案循序)驗證輪詢之身分驗證鉤子, 對應之契約(兩端JSDoc):
//伺服端opt.verifyPolling於每次[sys:polling]之任何副作用之前呼叫, 傳入輸入(含clientId與前端getToken所放之固定鍵__sysToken__), 嚴格true才放行,
//拒絕者以固定訊息[sys:polling] permission denied拒絕、不建立佇列與在線身分、不觸發clientEnter、發error事件; 放行後交使用端監聽之data已剝除token;
//前端opt.getToken之回傳值放於輸入之固定鍵__sysToken__; 被拒絕之前端每輪以輪詢失敗通知({ msg: '[sys:polling] error', err })且不視為已連線


let port = 8098
let url = `http://localhost:${port}`
let KEY = '__sysToken__'
let GOOD = 'good-token-777'
let DENIED = '[sys:polling] permission denied'

//startServer, 真WConverhpServer + 本套件伺服端(注入verifyPolling: 僅token為GOOD者放行), 待其啟動
//啟動失敗(例如埠被占用)時WConverhpServer只發error事件而不拋錯, 於此轉為拋錯, 使該案失敗而非以錯誤之前提通過
let startServer = async () => {
    let commErrs = []
    let seenInputs = []
    let srv = new WConverhpServer({ port, apiName: 'api', verifyConn: () => true })
    srv.on('error', (e) => {
        commErrs.push(String(e))
    })
    srv = new WServBroadcastServer(srv, {
        verifyPolling: (input) => {
            seenInputs.push(input)
            return input[KEY] === GOOD
        },
    })
    let enters = []
    let errs = []
    srv.on('clientEnter', (clientId, data) => {
        enters.push({ clientId, data })
    })
    srv.on('error', (e) => {
        errs.push(e)
    })
    await delay(500) //待伺服器啟動
    let errStart = commErrs.find((s) => s.includes('start server error'))
    if (errStart) {
        //失敗時自行釋放(呼叫端之finally尚未接手): 停止本套件之計時器與通訊服務
        srv.clearBroadcast()
        try {
            await srv.stop()
        }
        catch (err) {
            //啟動失敗之通訊服務可能無法停止, 不影響拋出啟動失敗
            console.log('stop after start failure:', String(err))
        }
        throw new Error(`伺服端啟動失敗: ${errStart}`)
    }
    return { srv, enters, errs, seenInputs }
}

//genClient, 真WConverhpClient + 本套件前端
let genClient = (clientId, opt = {}) => {
    let cli = new WConverhpClient({ url, apiName: 'api', retryMain: 0 })
    cli.clientId = clientId //通訊物件上之clientId可自訂本前端之識別(WServBroadcastClient之JSDoc)
    cli = new WServBroadcastClient(cli, { timePolling: 100, ...opt })
    return { cli, rec: recordClient(cli) }
}


describe('api broadcast verifyPolling', function() {

    it('帶有效token者連上並收到廣播; 無token與錯誤token者每輪被拒、不連上、收不到廣播、伺服端不建立其任何狀態', async function() {
        let { srv, enters, errs, seenInputs } = await startServer()
        let a = genClient('cid-a', { getToken: () => GOOD })
        let b = genClient('cid-b', { getToken: async () => 'wrong-token' })
        let c = genClient('cid-c') //未給getToken
        try {
            assert.ok(await waitFor(() => a.rec.count('open') === 1, 5000), 'A應連上') //契約: 放行者行為同未注入
            assert.ok(await waitFor(() => b.rec.count('error') >= 2 && c.rec.count('error') >= 2, 5000), 'B、C應每輪發error') //契約: 被拒絕者每輪以輪詢失敗通知
            srv.broadcast('secret-1')
            assert.ok(await waitFor(() => a.rec.count('broadcast') === 1, 5000), 'A應收到廣播')
            await delay(400)
            assert.deepStrictEqual(a.rec.of('broadcast'), ['secret-1']) //契約: 放行者收到廣播
            for (let r of [b.rec, c.rec]) {
                assert.strict.equal(r.count('openOnce'), 0) //契約: 被拒絕者不視為已連線
                assert.strict.equal(r.count('open'), 0)
                assert.strict.equal(r.count('broadcast'), 0) //契約: 被拒絕者收不到廣播
                r.of('error').forEach((e) => {
                    assert.strict.equal(e.msg, '[sys:polling] error')
                    assert.ok(JSON.stringify(e.err).includes(DENIED) || String(e.err).includes(DENIED), `前端應見固定拒絕訊息, 實得: ${JSON.stringify(e.err)} / ${String(e.err)}`) //契約: 固定拒絕訊息
                })
            }
            //伺服端狀態: 只有A
            assert.deepStrictEqual(srv.getClients().map((v) => v.key), ['cid-a']) //契約: 拒絕不建立在線身分
            assert.deepStrictEqual(Object.keys(srv.getMessages()), ['cid-a']) //契約: 拒絕不建立佇列
            assert.deepStrictEqual(enters.map((v) => v.clientId), ['cid-a']) //契約: 拒絕不觸發clientEnter
            assert.deepStrictEqual(enters[0].data, { clientId: 'cid-a' }) //契約: 交使用端監聽之data已剝除token
            assert.ok(!JSON.stringify(enters).includes(GOOD) && !JSON.stringify(srv.getClients()).includes(GOOD), 'token不得出現在事件與在線資料') //契約: token不進入交使用端之資料
            assert.ok(errs.length >= 4 && errs.every((e) => e.msg === DENIED), `伺服端應對每次被拒發error事件, 實得: ${JSON.stringify(errs.slice(0, 3))}`) //契約: 拒絕發error事件供稽核
            //鉤子收到之輸入含clientId與token(經真實傳輸後的形狀)
            let ofA = seenInputs.find((v) => v.clientId === 'cid-a')
            assert.deepStrictEqual(ofA, { clientId: 'cid-a', [KEY]: GOOD }) //契約: 傳入輪詢之輸入(含clientId與token)
            assert.ok(seenInputs.find((v) => v.clientId === 'cid-c') && !Object.hasOwn(seenInputs.find((v) => v.clientId === 'cid-c'), KEY), '未給getToken者之輸入不帶固定鍵') //契約: 未給getToken時輸入恰為{ clientId }
        }
        finally {
            a.cli.clearBroadcast()
            b.cli.clearBroadcast()
            c.cli.clearBroadcast()
            srv.clearBroadcast()
            await srv.stop()
        }
    })

    it('匿名者以大量不同clientId輪詢, 皆被拒且伺服端不建立任何佇列與在線身分', async function() {
        let { srv, enters } = await startServer()
        try {
            let raw = new WConverhpClient({ url, apiName: 'api', retryMain: 0 })
            let rs = await Promise.all(Array.from({ length: 40 }, (_, i) => {
                return raw.execute('[sys:polling]', { clientId: `anon-${i}` }, () => {}).then((v) => ({ ok: v }), (e) => ({ err: e }))
            }))
            assert.ok(rs.every((r) => r.err !== undefined), `全數應被拒, 實得: ${JSON.stringify(rs.find((r) => r.ok !== undefined))}`) //契約: 無token者不得輪詢
            assert.ok(rs.every((r) => JSON.stringify(r.err).includes(DENIED) || String(r.err).includes(DENIED)), '固定拒絕訊息')
            srv.broadcast('secret-2')
            await delay(100)
            assert.deepStrictEqual(srv.getClients(), []) //契約: 拒絕不建立在線身分
            assert.deepStrictEqual(srv.getMessages(), {}) //契約: 拒絕不建立佇列
            assert.deepStrictEqual(enters, []) //契約: 拒絕不觸發clientEnter
        }
        finally {
            srv.clearBroadcast()
            await srv.stop()
        }
    })

    it('token逾期(鉤子由放行轉為拒絕)時, 前端由連線轉為每輪發error, 恢復有效token後再次open', async function() {
        let { srv } = await startServer()
        let token = GOOD
        let a = genClient('cid-a', { getToken: () => token })
        try {
            assert.ok(await waitFor(() => a.rec.count('open') === 1, 5000))
            token = 'expired'
            assert.ok(await waitFor(() => a.rec.count('error') >= 2, 5000), '逾期後每輪發error') //契約: 被拒絕之前端每輪以輪詢失敗通知
            token = GOOD
            assert.ok(await waitFor(() => a.rec.count('open') === 2, 5000), '恢復後再次open') //契約: 恢復時再發open
            assert.strict.equal(a.rec.count('openOnce'), 1)
        }
        finally {
            a.cli.clearBroadcast()
            srv.clearBroadcast()
            await srv.stop()
        }
    })

})
