import assert from 'assert'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { delay, waitFor, countTimeout, captureConsole, hasCall, genConnector, recordClient } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastClient之JSDoc, clearBroadcast): 停止輪詢並釋放, 可重複呼叫; 其後不再派發本套件之事件(含停止前已排定、停止時在途之輪詢結果);
//呼叫當下那次派發之其餘監聽器仍會收到該事件; 停止後之監聽器拋錯以console.error輸出, 不發error事件


let msgs = [{ mode: 'broadcast', data: 'm1' }, { mode: 'broadcast', data: 'm2' }, { mode: 'broadcast', data: 'm3' }]

//msAfter, 停止後再等待之時間, 涵蓋停止前已排定(1ms)之派發與其後數輪輪詢
let msAfter = 100


describe('client clearBroadcast', function() {

    it('於openOnce監聽內停止, 其後不再收到open與broadcast', async function() {
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve(msgs)), { timePolling: 30 })
        cli.on('openOnce', () => {
            cli.clearBroadcast()
        })
        let rec = recordClient(cli)
        await waitFor(() => rec.count('openOnce') === 1)
        await delay(msAfter)
        assert.deepStrictEqual(rec.seq(), ['openOnce']) //契約: 其後不再派發本套件之事件(含停止前已排定者)
    })

    it('於open監聽內停止, 其後不再收到broadcast', async function() {
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve(msgs)), { timePolling: 30 })
        cli.on('open', () => {
            cli.clearBroadcast()
        })
        let rec = recordClient(cli)
        await waitFor(() => rec.count('open') === 1)
        await delay(msAfter)
        assert.deepStrictEqual(rec.seq(), ['openOnce', 'open']) //契約: 其後不再派發本套件之事件(含停止前已排定者)
    })

    it('於broadcast監聽內停止, 同一回應之其餘訊息不再派發', async function() {
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve(msgs)), { timePolling: 30 })
        let got = []
        cli.on('broadcast', (data) => {
            got.push(data)
            cli.clearBroadcast()
        })
        await waitFor(() => got.length >= 1)
        await delay(msAfter)
        assert.deepStrictEqual(got, ['m1']) //契約: 其後不再派發本套件之事件(含停止前已排定者)
    })

    it('輪詢在途時停止, 該次輪詢之結果不派發任何本套件之事件', async function() {
        let outcomes = [
            () => Promise.resolve(msgs),
            () => Promise.resolve([]),
            () => Promise.resolve({ state: 'error', msg: 'invalid token' }),
            () => Promise.reject(new Error('conn failed')),
        ]
        for (let fn of outcomes) {
            let cli = WServBroadcastClient(genConnector(() => delay(100).then(fn)), { timePolling: 50 })
            let rec = recordClient(cli)
            await waitFor(() => cli.nExec === 1) //第一輪已送出, 其回應於100ms後才到
            cli.clearBroadcast()
            await delay(150)
            assert.deepStrictEqual(rec.seq(), [], `在途結果${String(fn)}不應派發`) //契約: 停止時在途之輪詢結果不派發
            assert.strict.equal(cli.nExec, 1) //契約: 停止後不再輪詢
        }
    })

    it('停止後之監聽器拋錯以console.error輸出, 不發error事件', async function() {
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve(msgs)), { timePolling: 30 })
        let errs = []
        cli.on('error', (err) => {
            errs.push(err)
        })
        let thrown = false
        cli.on('openOnce', () => {
            cli.clearBroadcast()
            thrown = true
            throw new Error('boom-after-clear')
        })
        let calls = await captureConsole(async () => {
            await waitFor(() => thrown)
            await delay(msAfter)
        })
        assert.deepStrictEqual(errs, []) //契約: 停止後不發error事件
        assert.ok(hasCall(calls, 'listener of event[openOnce] error'), `應以console.error輸出, 實得: ${JSON.stringify(calls.map((args) => String(args[0])))}`) //契約: 停止後之監聽器拋錯以console.error輸出
    })

    it('重複呼叫clearBroadcast不拋錯且不再輪詢', async function() {
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), { timePolling: 30 })
        await waitFor(() => cli.nExec >= 2)
        cli.clearBroadcast()
        cli.clearBroadcast()
        let n = cli.nExec
        await delay(msAfter)
        cli.clearBroadcast()
        assert.strict.equal(cli.nExec, n) //契約: 可重複呼叫, 停止後不再輪詢
    })

    it('首輪前停止則不呼叫execute亦不派發事件', async function() {
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), { timePolling: 30 })
        let rec = recordClient(cli)
        cli.clearBroadcast()
        await delay(120)
        assert.strict.equal(cli.nExec, 0) //契約: 停止輪詢
        assert.deepStrictEqual(rec.seq(), []) //契約: 其後不再派發本套件之事件
    })

    it('停止後不殘留本套件之計時器', async function() {
        await delay(5) //mocha於async測試函式之同步段之後才建立逾時計時器, 先讓出一次再量基準
        let n0 = countTimeout()
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve(msgs)), { timePolling: 30 })
        let rec = recordClient(cli)
        await waitFor(() => rec.count('broadcast') >= 3)
        cli.clearBroadcast()
        await delay(30)
        assert.strict.equal(countTimeout(), n0) //契約: 停止輪詢並釋放
    })

    it('於監聽器內停止時, 同一次派發之其餘監聽器仍收到該事件', async function() {
        let cli = WServBroadcastClient(genConnector(() => Promise.resolve(msgs)), { timePolling: 30 })
        cli.on('openOnce', () => {
            cli.clearBroadcast()
        })
        let rec = recordClient(cli)
        await waitFor(() => rec.count('openOnce') === 1)
        await delay(msAfter)
        assert.strict.equal(rec.count('openOnce'), 1) //契約: 呼叫當下那次派發之其餘監聽器仍會收到該事件
        assert.strict.equal(rec.count('open'), 0) //契約: 其後之事件不再派發
    })

})
