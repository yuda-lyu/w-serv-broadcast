import assert from 'assert'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'


//本檔對應之契約: 前端之通訊物件須為具execute函數之事件物件(例如WConverhpClient); 未給、非事件物件、或無execute函數者永遠無法輪詢, 於建構時即拋錯


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

})
