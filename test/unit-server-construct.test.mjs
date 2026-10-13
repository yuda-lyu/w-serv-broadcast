import assert from 'assert'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import { delay, countTimeout, captureConsole, hasCall, recordServer, pollRaw } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastServer之JSDoc): 通訊服務實體須為具emit、on、off函數之eventemitter3事件物件, 有物件而缺emit、on或off時於建構時拋錯,
//且建構失敗時不留下任何計時器與監聽; 未給或非有效物件時改以evem建立不連線之事件物件並印出提示; 停止後可以同一事件物件重新建構


describe('server construct', function() {

    it('缺emit、on或off時建構即拋錯, 且不建立計時器', function() {
        let noOn = evem()
        noOn.on = undefined //遮蔽原型之on
        let noOff = evem()
        noOff.off = undefined //遮蔽原型之off
        let cases = [
            ['無emit', { a: 1 }],
            ['只有emit', { emit: () => true }],
            ['無on', noOn],
            ['無off', noOff],
        ]
        for (let [name, inst] of cases) {
            let n0 = countTimeout()
            assert.throws(() => {
                WServBroadcastServer(inst)
            }, { message: 'instWConverServer is not an EventEmitter' }, name) //契約: 缺emit、on或off時於建構時拋錯
            assert.strict.equal(countTimeout(), n0, `${name}: 不建立計時器`) //契約: 建構失敗時不留下計時器
        }
    })

    it('註冊execute監聽失敗時建構拋錯, 且不建立計時器', function() {
        let ev = evem()
        ev.on = () => {
            throw new Error('on boom')
        }
        let n0 = countTimeout()
        assert.throws(() => {
            WServBroadcastServer(ev)
        }, { message: 'on boom' })
        assert.strict.equal(countTimeout(), n0) //契約: 建構失敗時不留下計時器(先註冊監聽, 後起計時器)
    })

    it('事件物件不可擴充而建構拋錯時, 不留下計時器與execute監聽', function() {
        let ev = evem()
        Object.preventExtensions(ev)
        let n0 = countTimeout()
        assert.throws(() => {
            WServBroadcastServer(ev)
        })
        assert.strict.equal(countTimeout(), n0) //契約: 建構失敗時不留下計時器
        assert.strict.equal(ev.listenerCount('execute'), 0) //契約: 建構失敗時不留下監聽(先指派屬性, 後註冊監聽)
    })

    it('未給或非有效物件時改以evem建立不連線之事件物件並印出提示', async function() {
        for (let inst of [undefined, null, 'abc', {}]) {
            let srv = null
            let logs = await captureConsole(async () => {
                srv = WServBroadcastServer(inst)
            }, 'log')
            assert.ok(hasCall(logs, 'instWConverServer is not an effective object'), `${JSON.stringify(inst)}: 應印出提示`) //契約: 未給或非有效物件時印出提示
            assert.strict.equal(srv.listenerCount('execute'), 1) //契約: 改以evem建立之事件物件, 可由emit('execute', ...)手動驅動
            let r = await pollRaw(srv, { clientId: 'c1' })
            assert.deepStrictEqual(r, { resolve: [] }) //契約: 不連線之事件物件照常回應手動驅動之輪詢
            srv.clearBroadcast()
        }
    })

    it('停止後以同一事件物件重新建構可正常運作', async function() {
        let ev = evem()
        let s1 = WServBroadcastServer(ev)
        await pollRaw(s1, { clientId: 'c1' })
        await delay(30)
        s1.clearBroadcast()
        await delay(20) //舊實體之補發(clientLeave、clientChange)於停止後脫勾送達, 且與新實體共用同一事件物件, 待其送達後再重建
        let s2 = WServBroadcastServer(ev)
        let ms = recordServer(s2)
        let r = await pollRaw(s2, { clientId: 'c2' })
        await delay(30)
        assert.deepStrictEqual(r, { resolve: [] }) //契約: 重新建構之實體照常回應輪詢
        assert.deepStrictEqual(ms, ['enter|c2', 'change|1']) //契約: 重新建構之實體只追蹤自己之客戶端
        assert.strict.equal(ev.listenerCount('execute'), 1) //契約: 停止已移除舊實體之監聽
        s2.clearBroadcast()
    })

})
