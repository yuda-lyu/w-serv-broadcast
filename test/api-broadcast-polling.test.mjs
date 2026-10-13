import assert from 'assert'
import net from 'net'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { delay, waitFor, recordClient } from './tools/helpers.mjs'


//本檔以真WConverhpServer/WConverhpClient經HTTP(固定埠8097, 各案循序)驗證輪詢協定與停止, 對應之契約(兩端JSDoc):
//前端之輪詢回應須為陣列且元素皆為具字串mode之物件, 否則每輪以{ msg: '[sys:polling] error', err }通知且不視為已連線;
//本套件只處理[sys:polling], 本套件之execute監聽須先於「對所有函數名皆回應」之監聽註冊;
//前端clearBroadcast後不再派發本套件之事件(含停止時在途之輪詢結果), 並中止停止時在途之輪詢請求: 通訊物件支援opt.signal者,
//該請求不再重試、不再發出其error與重試訊息、不再呼叫getToken, 行程可立即結束; 不支援者照常完成或重試並發出其自身之error, 惟其結果不派發;
//中止只及於本套件之輪詢請求, 同一事件物件上之其他呼叫不受影響


let port = 8097
let url = `http://localhost:${port}`
let fpChild = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools', 'childClientStop.mjs')

//catchAll, 模擬對所有函數名皆回應之應用端監聽(例如w-serv-webdata之資料通道對[sys:polling]回invalid token)
let catchAll = (func, input, pm) => {
    pm.resolve({ state: 'error', msg: 'invalid token' })
}

//startServer, 真WConverhpServer + 本套件伺服端, 待其啟動
//o.order為'broadcastFirst'(本套件先註冊、全回應者後註冊)或'catchAllFirst'(全回應者先註冊), 未給者只有本套件之監聽;
//o.onEnter於建構後立即監聽clientEnter; o.slowApp掛應用端之slowApp監聽(600ms後回應)
//啟動失敗(例如埠被占用)時WConverhpServer只發error事件而不拋錯, 於此轉為拋錯, 使該案失敗而非以錯誤之前提通過
let startServer = async (o = {}) => {
    let errs = []
    let srv = new WConverhpServer({ port, apiName: 'api', verifyConn: () => true })
    srv.on('error', (e) => {
        errs.push(String(e))
    })
    if (o.order === 'catchAllFirst') {
        srv.on('execute', catchAll)
    }
    srv = new WServBroadcastServer(srv)
    if (o.order === 'broadcastFirst') {
        srv.on('execute', catchAll)
    }
    if (o.onEnter) {
        srv.on('clientEnter', o.onEnter)
    }
    if (o.slowApp) {
        srv.on('execute', (func, input, pm) => {
            if (func === 'slowApp') {
                setTimeout(() => pm.resolve('slowApp done'), 600)
            }
        })
    }
    await delay(500) //待伺服器啟動
    let errStart = errs.find((s) => s.includes('start server error'))
    if (errStart) {
        throw new Error(`伺服端啟動失敗: ${errStart}`)
    }
    return srv
}

//startHang, 接受連線而永不回應之TCP伺服器(請求在途); 監聽失敗時以錯誤拒絕
let startHang = async () => {
    let socks = []
    let srv = net.createServer((s) => {
        socks.push(s)
        s.on('error', () => {})
    })
    await new Promise((resolve, reject) => {
        srv.once('error', reject)
        srv.listen(port, resolve)
    })
    return async () => {
        socks.forEach((s) => s.destroy())
        await new Promise((resolve) => srv.close(resolve))
    }
}

//pollOnce, 以另一個前端對伺服端輪詢一次(正向對照: 證明伺服端已啟動且clientEnter之觀察管道有效)
let pollOnce = async (clientId) => {
    let cli = new WConverhpClient({ url, apiName: 'api', retryMain: 0 })
    return cli.execute('[sys:polling]', { clientId }, () => {})
}

//runChild, 以子行程跑前端(見tools/childClientStop.mjs), onLine(line)收到CLEARED、OPEN等行; 回傳{ exitCode, res, stderr }
let runChild = (kase, env = {}, onLine = () => {}) => new Promise((resolve) => {
    let cp = spawn(process.execPath, [fpChild], { env: { ...process.env, W_KASE: kase, W_PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let o = ''
    let e = ''
    let buf = ''
    cp.stdout.on('data', (b) => {
        o += b
        buf += b
        let ls = buf.split(/\r?\n/)
        buf = ls.pop()
        ls.forEach(onLine)
    })
    cp.stderr.on('data', (b) => {
        e += b
    })
    let killer = setTimeout(() => cp.kill(), 30000)
    cp.on('close', (exitCode) => {
        clearTimeout(killer)
        let line = o.split(/\r?\n/).find((l) => l.startsWith('RESULT:'))
        resolve({ exitCode, res: line ? JSON.parse(line.slice(7)) : null, stderr: e.slice(0, 500) })
    })
})

//afterClear, 子行程停止後之計數與停止至行程結束之毫秒
let afterClear = (res) => {
    return {
        commErrs: res.commErrs.length - res.nCommAtClear,
        ours: res.ours.length - res.nOursAtClear,
        retryLogs: res.retryLogs.length - res.nRetryAtClear,
        tokens: res.tokens.length - res.nTokensAtClear,
        lag: res.tExit - res.tClear,
    }
}

//isInvalidToken, 本套件之error事件中, err為全回應者之回應原值者
let isInvalidToken = (e) => {
    return e.msg === '[sys:polling] error' && e.err && e.err.state === 'error' && e.err.msg === 'invalid token'
}


describe('api broadcast polling', function() {

    it('伺服端只clearBroadcast而未停止通訊服務, 全回應者以非陣列回應時, 前端每輪發error而不靜默', async function() {
        let srv = await startServer({ order: 'broadcastFirst' })
        let cli = new WConverhpClient({ url, apiName: 'api' })
        cli = new WServBroadcastClient(cli, { timePolling: 200 })
        let rec = recordClient(cli)
        try {
            assert.ok(await waitFor(() => rec.count('open') === 1, 3000), '應連上') //契約: 合格回應發open
            srv.broadcast('m1')
            assert.ok(await waitFor(() => rec.count('broadcast') === 1, 3000), '應收到m1') //契約: 推播照常送達
            let n = rec.list.length
            srv.clearBroadcast()
            srv.broadcast('m2')
            let errsAfter = () => rec.list.slice(n).filter((v) => v.ev === 'error').map((v) => v.args[0])
            await waitFor(() => errsAfter().length >= 2, 5000)
            let after = rec.list.slice(n)
            let errs = errsAfter()
            assert.ok(errs.length >= 2 && errs.every(isInvalidToken), `停止後應每輪發error, 實得: ${JSON.stringify(after)}`) //契約: 回應不合協定時每輪以輪詢失敗通知, err為回應原值
            assert.deepStrictEqual(rec.of('broadcast'), ['m1']) //契約: 停止後broadcast無作用
        }
        finally {
            cli.clearBroadcast()
            await srv.stop()
        }
    })

    it('全回應者先於本套件註冊時, 前端每輪發error且不發open', async function() {
        let srv = await startServer({ order: 'catchAllFirst' })
        let cli = new WConverhpClient({ url, apiName: 'api' })
        cli = new WServBroadcastClient(cli, { timePolling: 200 })
        let rec = recordClient(cli)
        try {
            await waitFor(() => rec.of('error').length >= 2, 5000)
            let errs = rec.of('error')
            assert.ok(errs.length >= 2 && errs.every(isInvalidToken), `應每輪發error, 實得: ${JSON.stringify(rec.list)}`) //契約: 本套件之execute監聽須先於全回應者註冊, 否則前端每輪以輪詢失敗通知
            assert.strict.equal(rec.count('openOnce'), 0) //契約: 不合協定之回應不發openOnce
            assert.strict.equal(rec.count('open'), 0) //契約: 不合協定之回應不發open
        }
        finally {
            cli.clearBroadcast()
            srv.clearBroadcast()
            await srv.stop()
        }
    })

    it('只有本套件之監聽時, 伺服端停止後前端以輪詢失敗通知', async function() {
        let srv = await startServer()
        let cli = new WConverhpClient({ url, apiName: 'api', retryMain: 0 })
        cli = new WServBroadcastClient(cli, { timePolling: 200 })
        let rec = recordClient(cli)
        try {
            assert.ok(await waitFor(() => rec.count('open') === 1, 3000), '應連上') //契約: 合格回應發open
            srv.clearBroadcast()
            let ok = await waitFor(() => rec.of('error').some((e) => e.msg === '[sys:polling] error' && String(e.err).includes('no listener')), 3000)
            assert.ok(ok, `停止後應收到輪詢失敗, 實得: ${JSON.stringify(rec.list)}`) //契約: 停止後不再回應輪詢(無人接聽由通訊服務拒絕), 前端以輪詢失敗通知
        }
        finally {
            cli.clearBroadcast()
            await srv.stop()
        }
    })

    it('前端於輪詢在途時停止, 其後不再收到本套件之事件', async function() {
        let srv = await startServer()
        let cli = new WConverhpClient({ url, apiName: 'api' })
        let execute = cli.execute
        cli.execute = (...args) => {
            let p = execute(...args)
            setTimeout(() => {
                cli.clearBroadcast() //請求已送出、回應未到時停止
            }, 0)
            return p
        }
        cli = new WServBroadcastClient(cli, { timePolling: 200 })
        let rec = recordClient(cli)
        try {
            await delay(800)
            assert.deepStrictEqual(rec.seq(), [], `停止後不應有本套件之事件, 實得: ${JSON.stringify(rec.list)}`) //契約: 停止時在途之輪詢結果不派發本套件之事件
        }
        finally {
            cli.clearBroadcast()
            srv.clearBroadcast()
            await srv.stop()
        }
    })

})


//以下各案之前端於子行程內執行(真WConverhpClient, retryMain預設3; 停止後不呼叫process.exit), 行程結束之時點須於子行程內量測
describe('api client stop (w-converhp opt.signal)', function() {

    it('退避中停止: 其後通訊物件之error、重試訊息與getToken皆0, 行程於停止後500ms內自然結束', async function() {
        let r = await runChild('backoff') //埠8097無人監聽, 每次嘗試連不上
        assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
        assert.strict.equal(r.exitCode, 0, r.stderr)
        assert.strict.equal(r.res.nCommAtClear, 1, '前置: 停止時應已有第1則通訊物件error(正於退避中)')
        let a = afterClear(r.res)
        assert.strict.equal(a.commErrs, 0, `停止後通訊物件之error, 實得${a.commErrs}則`) //契約: 該請求不再發出其error
        assert.strict.equal(a.retryLogs, 0, `停止後重試訊息, 實得${a.retryLogs}則`) //契約: 不再重試、不再發出重試訊息
        assert.strict.equal(a.tokens, 0, `停止後getToken被呼叫${a.tokens}次`) //契約: 不再呼叫getToken
        assert.strict.equal(a.ours, 0) //契約: 停止後不派發本套件之事件
        assert.ok(a.lag < 500, `停止至行程結束${a.lag}ms`) //契約: 行程可立即結束
        assert.strict.equal(r.res.unhandled, 0) //中止之拒絕由本套件接住
    })

    it('請求在途(伺服端不回應)時停止: 其後通訊物件之error、getToken與本套件事件皆0, 行程於停止後500ms內自然結束', async function() {
        let stop = await startHang()
        try {
            let r = await runChild('inflight', { W_TIMEOUT: '3000' })
            assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
            assert.strict.equal(r.exitCode, 0, r.stderr)
            assert.strict.equal(r.res.settledAtClear, false, '前置: 停止時輪詢請求應在途')
            let a = afterClear(r.res)
            assert.strict.equal(a.commErrs, 0, `停止後通訊物件之error, 實得${a.commErrs}則`) //契約: 中止停止時在途之輪詢請求, 不再發出其error
            assert.strict.equal(a.tokens, 0, `停止後getToken被呼叫${a.tokens}次`) //契約: 不再呼叫getToken
            assert.strict.equal(a.ours, 0) //契約: 停止後不派發本套件之事件
            assert.ok(a.lag < 500, `停止至行程結束${a.lag}ms`) //契約: 行程可立即結束
        }
        finally {
            await stop()
        }
    })

    it('於通訊物件error之監聽器內同步停止(重入): 不印重試訊息、不再重試、不再呼叫getToken, 行程於停止後500ms內自然結束', async function() {
        let r = await runChild('reentrant')
        assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
        assert.strict.equal(r.exitCode, 0, r.stderr)
        let a = afterClear(r.res)
        assert.strict.equal(a.commErrs, 0, `觸發停止之那一則之後, 通訊物件之error實得${a.commErrs}則`) //契約: 不再發出其error
        assert.strict.equal(a.retryLogs, 0, `停止後重試訊息, 實得${a.retryLogs}則`) //契約: 不再重試、不再發出重試訊息
        assert.strict.equal(a.tokens, 0, `停止後getToken被呼叫${a.tokens}次`) //契約: 不再呼叫getToken
        assert.strict.equal(a.ours, 0) //契約: 停止後不派發本套件之事件
        assert.ok(a.lag < 500, `停止至行程結束${a.lag}ms`) //契約: 行程可立即結束
    })

    it('連線中閒置時停止: 行程於停止後500ms內自然結束', async function() {
        let srv = await startServer()
        try {
            let r = await runChild('idle')
            assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
            assert.strict.equal(r.exitCode, 0, r.stderr)
            assert.ok(afterClear(r.res).lag < 500, `停止至行程結束${afterClear(r.res).lag}ms`) //契約: 行程可立即結束
        }
        finally {
            srv.clearBroadcast()
            await srv.stop()
        }
    })

    it('停止時同一通訊物件上應用端自身之請求在途: 不受影響, 照常完成', async function() {
        let srv = await startServer({ slowApp: true })
        let cli = new WConverhpClient({ url, apiName: 'api' })
        cli = new WServBroadcastClient(cli, { timePolling: 200 })
        let rec = recordClient(cli)
        try {
            assert.ok(await waitFor(() => rec.count('open') === 1, 3000), '應連上')
            let p = cli.execute('slowApp', {}, null)
            await delay(100)
            cli.clearBroadcast()
            let v = await p
            assert.strict.equal(v, 'slowApp done') //契約: 中止只及於本套件之輪詢請求, 同一事件物件上之其他呼叫不受影響
        }
        finally {
            cli.clearBroadcast()
            srv.clearBroadcast()
            await srv.stop()
        }
    })

    it('退避中停止後伺服端恢復: 舊輪詢不再到達, 伺服端不出現已停止之前端', async function() {
        let srv = await startServer()
        let srv2 = null
        let enters = []
        let tClear = null
        try {
            let pStart2 = null
            let r = await runChild('ghost', {}, (l) => {
                if (l === 'OPEN' && srv !== null) {
                    let s = srv
                    srv = null
                    s.clearBroadcast()
                    s.stop() //連上後停止伺服端, 下一輪連不上而進入退避
                }
                if (l === 'CLEARED') {
                    tClear = Date.now()
                    //停止後立即重啟伺服端(早於第1次重試之1000ms); 啟動失敗時startServer拋錯而使本案失敗
                    pStart2 = startServer({ onEnter: (id) => enters.push(id) })
                    pStart2.catch(() => {}) //先接住, 其拒絕於下方await時仍會拋出而使本案失敗
                }
            })
            assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
            assert.ok(pStart2 !== null, '前置: 子行程應已停止')
            srv2 = await pStart2
            await waitFor(() => Date.now() - tClear > 1800, 5000) //涵蓋舊輪詢第1次重試之時點(退避1000ms)
            //正向對照: 另一個前端輪詢一次, 伺服端須見到其clientEnter, 證明伺服端已啟動且觀察管道有效
            assert.deepStrictEqual(await pollOnce('probe-a6'), [])
            assert.ok(await waitFor(() => enters.includes('probe-a6'), 1000), `正向對照: 伺服端應見到probe-a6, 實得: ${JSON.stringify(enters)}`)
            let others = enters.filter((id) => id !== 'probe-a6')
            assert.deepStrictEqual(others, [], `伺服端不應出現已停止之前端, 實得: ${JSON.stringify(others)}`) //契約: 停止後通訊物件不再重試
        }
        finally {
            if (srv !== null) {
                srv.clearBroadcast()
                await srv.stop()
            }
            if (srv2 !== null) {
                srv2.clearBroadcast()
                await srv2.stop()
            }
        }
    })

    it('getToken懸置中停止: 請求不送出, 伺服端不出現已停止之前端', async function() {
        let enters = []
        let srv = await startServer({ onEnter: (id) => enters.push(id) })
        try {
            let r = await runChild('token') //第1次getToken懸置800ms, 第1次輪詢送出後200ms停止
            assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
            assert.strict.equal(r.res.settledAtClear, false, '前置: 停止時輪詢應在途(等待getToken)')
            await delay(1200) //涵蓋getToken懸置結束(停止後約600ms)與其後之請求往返
            //正向對照: 另一個前端輪詢一次, 伺服端須見到其clientEnter
            assert.deepStrictEqual(await pollOnce('probe-a8'), [])
            assert.ok(await waitFor(() => enters.includes('probe-a8'), 1000), `正向對照: 伺服端應見到probe-a8, 實得: ${JSON.stringify(enters)}`)
            let others = enters.filter((id) => id !== 'probe-a8')
            assert.deepStrictEqual(others, [], `伺服端不應出現已停止之前端, 實得: ${JSON.stringify(others)}`) //契約: 中止停止時在途之輪詢請求(等待getToken者即不送出)
        }
        finally {
            srv.clearBroadcast()
            await srv.stop()
        }
    })

    it('對照組: 通訊物件不支援opt.signal時, 停止後不派發本套件之事件, 通訊物件自身之重試、error與getToken照常', async function() {
        let r = await runChild('backoff', { W_STRIP4: '1' })
        assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
        assert.strict.equal(r.exitCode, 0, r.stderr)
        let a = afterClear(r.res)
        assert.strict.equal(a.ours, 0) //契約: 停止後不派發本套件之事件(與通訊物件無關)
        assert.ok(a.commErrs >= 1, `通訊物件不支援中止時, 停止後仍有其error(對照組須觀察得到), 實得${a.commErrs}則`) //契約: 不支援者照常重試並發出其自身之error
        assert.ok(a.tokens >= 1, `通訊物件不支援中止時, 停止後仍呼叫getToken(對照組須觀察得到), 實得${a.tokens}次`) //契約: 不支援者照常重試
        assert.ok(a.lag >= 1000, `通訊物件不支援中止時, 行程待其重試結束, 實得${a.lag}ms`) //契約: 不支援者照常重試
    })

})
