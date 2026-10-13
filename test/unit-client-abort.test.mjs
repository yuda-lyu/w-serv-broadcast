import assert from 'assert'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { delay, waitFor, captureConsole, genConnector, recordClient } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastClient之JSDoc, 規則帳本R10):
//J1 本套件以execute('[sys:polling]', { clientId }, cbProgress, { signal })輪詢, signal於停止前不中止;
//J2 clearBroadcast中止停止時在途之輪詢請求(於呼叫當下即中止所交出之signal);
//J5 停止後不派發本套件之事件(含中止所致之拒絕), 亦不以console.error輸出;
//J6 中止只及於本實體之輪詢請求: 停止後於同一通訊物件重建之新實體不受影響


//isAbortSignal, 以鴨子型別判定(同w-converhp之判定)
let isAbortSignal = (v) => v !== null && typeof v === 'object' && typeof v.aborted === 'boolean' && typeof v.addEventListener === 'function' && typeof v.removeEventListener === 'function'

//genAbortable, 模擬支援opt.signal之通訊物件: 輪詢懸置, 中止時以signal.reason拒絕(同w-converhp之契約); 記錄每次之signal與結局
let genAbortable = () => {
    let calls = []
    let ev = genConnector((n, func, input, cbProgress, opt) => {
        let signal = opt && opt.signal ? opt.signal : null
        let c = { signal, settled: null }
        calls.push(c)
        return new Promise((resolve, reject) => {
            if (signal === null) {
                return //未交出signal者: 永遠懸置
            }
            signal.addEventListener('abort', () => {
                c.settled = 'rejected'
                reject(signal.reason)
            })
        })
    })
    ev.calls = calls
    return ev
}


describe('client abort (opt.signal)', function() {

    it('輪詢以第4參數帶AbortSignal, 停止前未中止', async function() {
        let cli = WServBroadcastClient(genAbortable(), { timePolling: 30 })
        try {
            assert.ok(await waitFor(() => cli.calls.length >= 1), '前置: 應已輪詢')
            let s = cli.calls[0].signal
            assert.ok(isAbortSignal(s), '第4參數應為{ signal }且signal為AbortSignal') //契約J1
            assert.strict.equal(s.aborted, false) //契約J1: 停止前不中止
        }
        finally {
            cli.clearBroadcast()
        }
    })

    it('clearBroadcast於呼叫當下中止在途之輪詢, 該輪之拒絕不派發本套件之事件、不以console.error輸出', async function() {
        let unhandled = []
        let onUnhandled = (r) => {
            unhandled.push(r)
        }
        process.on('unhandledRejection', onUnhandled)
        let cli = null
        try {
            cli = WServBroadcastClient(genAbortable(), { timePolling: 30 })
            let rec = recordClient(cli)
            assert.ok(await waitFor(() => cli.calls.length >= 1), '前置: 應已輪詢')
            assert.ok(isAbortSignal(cli.calls[0].signal), '前置: 輪詢應帶AbortSignal') //契約J1
            let calls = await captureConsole(async () => {
                cli.clearBroadcast()
                assert.strict.equal(cli.calls[0].signal.aborted, true) //契約J2: 停止時於呼叫當下中止在途之輪詢請求
                await delay(50)
            })
            assert.strict.equal(cli.calls[0].settled, 'rejected', '前置: 在途之輪詢應因中止而拒絕') //契約J2
            assert.deepStrictEqual(rec.seq(), []) //契約J5: 中止所致之拒絕不派發本套件之事件
            assert.deepStrictEqual(calls, []) //契約J5: 不以console.error輸出
            assert.strict.equal(cli.calls.length, 1) //契約: 停止後不再輪詢
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
            if (cli !== null) {
                cli.clearBroadcast() //前置斷言失敗時亦停止, 不殘留輪詢計時器(可重複呼叫)
            }
        }
        assert.deepStrictEqual(unhandled, []) //中止之拒絕由本套件接住
    })

    it('於同一通訊物件重建後, 新實體之輪詢不受舊實體停止之影響', async function() {
        let ev = genAbortable()
        let cli = WServBroadcastClient(ev, { timePolling: 30 })
        let cli2 = null
        try {
            assert.ok(await waitFor(() => ev.calls.length >= 1), '前置: 應已輪詢')
            assert.ok(isAbortSignal(ev.calls[0].signal), '前置: 輪詢應帶AbortSignal') //契約J1
            cli.clearBroadcast()
            let n = ev.calls.length
            cli2 = WServBroadcastClient(ev, { timePolling: 30 })
            assert.ok(await waitFor(() => ev.calls.length > n), '前置: 新實體應已輪詢')
            assert.strict.equal(ev.calls[0].signal.aborted, true) //契約J2: 舊實體之輪詢已中止
            assert.strict.equal(ev.calls[n].signal.aborted, false) //契約J6: 只中止本實體之輪詢請求
        }
        finally {
            cli.clearBroadcast() //前置斷言失敗時亦停止(可重複呼叫)
            if (cli2 !== null) {
                cli2.clearBroadcast()
            }
        }
    })

})
