import assert from 'assert'
import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { delay, waitFor, recordClient } from './tools/helpers.mjs'


//本檔以真WConverhpServer/WConverhpClient經HTTP(固定埠8097)驗證輪詢協定與停止, 對應之契約(兩端JSDoc):
//前端之輪詢回應須為陣列且元素皆為具字串mode之物件, 否則每輪以{ msg: '[sys:polling] error', err }通知且不視為已連線;
//本套件只處理[sys:polling], 本套件之execute監聽須先於「對所有函數名皆回應」之監聽註冊;
//前端clearBroadcast後不再派發本套件之事件(含停止時在途之輪詢結果), 通訊物件自身之重試與error不在此限


let port = 8097
let url = `http://localhost:${port}`

//catchAll, 模擬對所有函數名皆回應之應用端監聽(例如w-serv-webdata之資料通道對[sys:polling]回invalid token)
let catchAll = (func, input, pm) => {
    pm.resolve({ state: 'error', msg: 'invalid token' })
}

//startServer, order為'broadcastFirst'(本套件先註冊)、'catchAllFirst'(全回應者先註冊)或'broadcastOnly'
let startServer = async (order) => {
    let srv = new WConverhpServer({ port, apiName: 'api', verifyConn: () => true })
    srv.on('error', () => {})
    if (order === 'catchAllFirst') {
        srv.on('execute', catchAll)
    }
    srv = new WServBroadcastServer(srv)
    if (order === 'broadcastFirst') {
        srv.on('execute', catchAll)
    }
    await delay(500) //待伺服器啟動
    return srv
}

//isInvalidToken, 本套件之error事件中, err為全回應者之回應原值者
let isInvalidToken = (e) => {
    return e.msg === '[sys:polling] error' && e.err && e.err.state === 'error' && e.err.msg === 'invalid token'
}


describe('api broadcast polling', function() {

    it('伺服端只clearBroadcast而未停止通訊服務, 全回應者以非陣列回應時, 前端每輪發error而不靜默', async function() {
        let srv = await startServer('broadcastFirst')
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
        let srv = await startServer('catchAllFirst')
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
        let srv = await startServer('broadcastOnly')
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
        let srv = await startServer('broadcastOnly')
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
