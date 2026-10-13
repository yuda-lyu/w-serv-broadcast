import assert from 'assert'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { waitFor, countTimeout, genConnector, recordClient } from './tools/helpers.mjs'


//本檔對應之契約: 前端之通訊物件須為具execute函數之事件物件(例如WConverhpClient); 未給、非事件物件、或無execute函數者永遠無法輪詢, 於建構時即拋錯
//另(WServBroadcastClient之JSDoc): 事件物件須具emit與on; timePolling為正整數, 0與無效值取預設2000, 超過計時器上限2147483647者夾至上限;
//建構失敗(例如通訊物件不可擴充)時不殘留輪詢計時器; 進度回呼不取參數; 執行環境須內建AbortController, 否則建構時拋錯(見unit-client-abort-noac.test.mjs)


let delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

//checkThrow, 建構時應拋出指定訊息之錯誤
let checkThrow = (inst, msg) => {
    assert.throws(() => {
        WServBroadcastClient(inst)
    }, (err) => {
        return err instanceof Error && err.message === msg
    })
}


describe('client construct', function() {

    it('未給通訊物件時建構即拋錯', function() {
        checkThrow(undefined, 'instWConverClient is not an effective object') //契約: 未給
        checkThrow(null, 'instWConverClient is not an effective object') //契約: 未給
        checkThrow({}, 'instWConverClient is not an effective object') //契約: 空物件
        checkThrow('abc', 'instWConverClient is not an effective object') //契約: 非物件
    })

    it('通訊物件非事件物件時建構即拋錯', function() {
        checkThrow({ execute: () => Promise.resolve([]) }, 'instWConverClient is not an EventEmitter') //契約: 無emit
    })

    it('通訊物件無execute函數時建構即拋錯', function() {
        checkThrow(evem(), 'instWConverClient.execute is not a function') //契約: 無execute
        let ev = evem()
        ev.execute = 1
        checkThrow(ev, 'instWConverClient.execute is not a function') //契約: execute非函數
    })

    it('通訊物件有效時建構成功並開始輪詢', async function() {
        let ev = evem()
        ev.execute = () => Promise.resolve([])
        let cli = WServBroadcastClient(ev, { timePolling: 50 })
        let opened = false
        cli.on('open', () => {
            opened = true
        })
        await delay(200)
        cli.clearBroadcast()
        assert.strict.equal(opened, true) //契約: 有效之通訊物件照常輪詢
    })

    it('通訊物件缺on時建構即拋錯', function() {
        let ev = evem()
        ev.execute = () => Promise.resolve([])
        ev.on = undefined //遮蔽原型之on
        checkThrow(ev, 'instWConverClient is not an EventEmitter') //契約: 事件物件須具emit與on
    })

    it('timePolling為0、負數、非整數或無效值時取預設2000', async function() {
        for (let timePolling of [0, -1, 1.5, 'abc', null]) {
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), { timePolling })
            await delay(150)
            cli.clearBroadcast()
            assert.strict.equal(cli.nExec, 0, `timePolling=${timePolling}`) //契約: 0與無效值取預設2000(150ms內不輪詢)
        }
    })

    it('timePolling超過計時器上限時夾至上限, 不發出計時器溢位警告', async function() {
        let warnings = []
        let onWarning = (w) => {
            warnings.push(w.name)
        }
        process.on('warning', onWarning)
        try {
            let cli = WServBroadcastClient(genConnector(() => Promise.resolve([])), { timePolling: 3000000000 })
            await delay(150)
            cli.clearBroadcast()
            assert.strict.equal(cli.nExec, 0) //契約: 超過計時器上限者夾至上限(不會因溢位改為1ms而密集輪詢)
        }
        finally {
            process.off('warning', onWarning)
        }
        assert.ok(!warnings.includes('TimeoutOverflowWarning'), `不應有TimeoutOverflowWarning, 實得: ${warnings}`) //契約: 夾至上限2147483647
    })

    it('通訊物件不可擴充而建構拋錯時, 不殘留輪詢計時器亦不輪詢', async function() {
        let ev = genConnector(() => Promise.resolve([]))
        Object.preventExtensions(ev)
        let n0 = countTimeout()
        assert.throws(() => {
            WServBroadcastClient(ev, { timePolling: 30 })
        })
        assert.strict.equal(countTimeout(), n0) //契約: 建構失敗時不殘留輪詢計時器
        await delay(120)
        assert.strict.equal(ev.nExec, 0) //契約: 建構失敗時不輪詢
    })

    it('通訊物件不帶參數呼叫進度回呼時不使該輪失敗', async function() {
        let cli = WServBroadcastClient(genConnector((n, func, input, cbProgress) => {
            cbProgress()
            return Promise.resolve([])
        }), { timePolling: 30 })
        let rec = recordClient(cli)
        await waitFor(() => rec.count('open') === 1 && cli.nExec >= 2)
        cli.clearBroadcast()
        assert.strict.equal(rec.count('error'), 0) //契約: 進度回呼不取參數
        assert.strict.equal(rec.count('open'), 1) //契約: 該輪照常成為合格回應
    })

})
