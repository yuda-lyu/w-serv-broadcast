import assert from 'assert'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'
import { delay, waitFor, genConnector, recordClient } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastClient之JSDoc): 輪詢回應須為陣列且元素皆為具字串mode之物件, 否則整包視為輪詢失敗(err為回應原值)、不發openOnce與open;
//只派發mode為broadcast者, 其他mode略過; openOnce於第一次收到合格回應時發出一次, open於由未連線轉為連線時發出;
//每輪失敗(execute之reject、同步拋錯、未回傳Promise、回應不合協定)發一則{ msg: '[sys:polling] error', err }並轉為未連線, 恢復時再發open


//run, 以給定之各輪回應建構前端, 待until(rec, cli)成立(至多3秒)後停止, 回傳事件紀錄
//以條件而非固定時窗決定停止時點: 平行執行之負載下計時器會延遲, 固定時窗內之輪數不固定
let run = async (fnRound, until) => {
    let cli = WServBroadcastClient(genConnector(fnRound), { timePolling: 30 })
    let rec = recordClient(cli)
    await waitFor(() => until(rec, cli))
    cli.clearBroadcast()
    await delay(20)
    return rec
}

//checkInvalid, 回應v不合協定時: 每輪一則error且err為回應原值, 不發openOnce、open、broadcast
let checkInvalid = async (v) => {
    let rec = await run(() => Promise.resolve(v), (rec, cli) => rec.count('error') >= 2 && cli.nExec >= 3)
    let errs = rec.of('error')
    let msg = `回應 ${JSON.stringify(v)}`
    assert.ok(errs.length >= 2, `${msg}: 應每輪一則error, 實得${errs.length}則`) //契約: 每輪失敗發一則error
    assert.ok(errs.every((e) => e.msg === '[sys:polling] error'), `${msg}: error之msg應為[sys:polling] error`) //契約: 回應不合協定以輪詢失敗通知
    errs.forEach((e) => {
        assert.deepStrictEqual(e.err, v, `${msg}: err應為回應原值`) //契約: err為回應原值
    })
    assert.strict.equal(rec.count('openOnce'), 0, `${msg}: 不發openOnce`) //契約: 不合協定之回應不發openOnce
    assert.strict.equal(rec.count('open'), 0, `${msg}: 不發open`) //契約: 不合協定之回應不發open
    assert.strict.equal(rec.count('broadcast'), 0, `${msg}: 不發broadcast`) //契約: 整包視為輪詢失敗
}


describe('client polling response', function() {

    it('回應不是陣列時每輪以輪詢失敗通知, 不發openOnce與open', async function() {
        for (let v of [{ state: 'error', msg: 'invalid token' }, {}, null, undefined, 'abc', 123, true]) {
            await checkInvalid(v)
        }
    })

    it('陣列中有元素不是具字串mode之物件時整包以輪詢失敗通知', async function() {
        let vs = [
            [null],
            [{}],
            [''],
            [[]],
            [null, null],
            [1],
            [{ data: 2 }],
            [{ mode: 1, data: 3 }],
            [{ mode: 'broadcast', data: 'ok' }, 'bad'], //合格與不合格並存時整包失敗, 合格者亦不派發
        ]
        for (let v of vs) {
            await checkInvalid(v)
        }
    })

    it('回應為空陣列時發openOnce與open, 不發error與broadcast', async function() {
        let rec = await run(() => Promise.resolve([]), (rec, cli) => rec.count('open') === 1 && cli.nExec >= 3)
        assert.strict.equal(rec.count('openOnce'), 1) //契約: openOnce於第一次收到合格回應時發出一次
        assert.strict.equal(rec.count('open'), 1) //契約: open於由未連線轉為連線時發出
        assert.strict.equal(rec.count('error'), 0) //契約: 空陣列為合格回應
        assert.strict.equal(rec.count('broadcast'), 0) //契約: 無訊息則不派發broadcast
    })

    it('只派發mode為broadcast之訊息, 其他mode略過', async function() {
        let rec = await run((n) => {
            if (n === 1) {
                return Promise.resolve([{ mode: 'broadcast', data: 'a' }, { mode: 'other', data: 'b' }, { mode: 'broadcast' }])
            }
            return Promise.resolve([])
        }, (rec, cli) => rec.count('broadcast') >= 2 && cli.nExec >= 3)
        assert.deepStrictEqual(rec.of('broadcast'), ['a', null]) //契約: 只派發mode為broadcast者, 其他mode略過(data缺者為null)
        assert.strict.equal(rec.count('error'), 0) //契約: 未知mode之元素不使回應不合協定
    })

    it('先回不合協定之回應後回合格回應時, 恢復後發openOnce與open, openOnce全程恰一次', async function() {
        let rec = await run((n) => {
            if (n <= 3) {
                return Promise.resolve({ state: 'error', msg: 'invalid token' })
            }
            return Promise.resolve([])
        }, (rec, cli) => rec.count('open') === 1 && cli.nExec >= 6)
        assert.deepStrictEqual(rec.seq(), ['error', 'error', 'error', 'openOnce', 'open']) //契約: 不合協定時每輪error, 合格後才發openOnce與open
    })

    it('曾連線後各類失敗皆轉為未連線並於恢復時再發open', async function() {
        let rec = await run((n) => {
            if (n === 2) {
                return Promise.reject(new Error('rejected'))
            }
            if (n === 4) {
                throw new Error('thrown')
            }
            if (n === 6) {
                return undefined //未回傳Promise
            }
            if (n === 8) {
                return Promise.resolve({ state: 'error', msg: 'invalid token' }) //回應不合協定
            }
            return Promise.resolve([])
        }, (rec, cli) => rec.seq().length >= 10 && cli.nExec >= 11)
        assert.deepStrictEqual(rec.seq(), ['openOnce', 'open', 'error', 'open', 'error', 'open', 'error', 'open', 'error', 'open']) //契約: 每輪失敗轉為未連線, 恢復時再發open; openOnce恰一次
        let errs = rec.of('error')
        assert.strict.equal(errs[0].err.message, 'rejected') //契約: reject之err為原因
        assert.strict.equal(errs[1].err.message, 'thrown') //契約: 同步拋錯之err為所拋之錯誤
        assert.ok(errs[2].err instanceof TypeError) //契約: 未回傳Promise之err為TypeError
        assert.deepStrictEqual(errs[3].err, { state: 'error', msg: 'invalid token' }) //契約: 回應不合協定之err為回應原值
    })

    it('連線中收到合格回應只派發broadcast, 不再發open', async function() {
        let rec = await run((n) => {
            if (n === 2) {
                return Promise.resolve([{ mode: 'broadcast', data: 'x' }])
            }
            return Promise.resolve([])
        }, (rec, cli) => rec.count('broadcast') === 1 && cli.nExec >= 4)
        assert.deepStrictEqual(rec.seq(), ['openOnce', 'open', 'broadcast']) //契約: open只於由未連線轉為連線時發出
    })

})
