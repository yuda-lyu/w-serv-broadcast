import assert from 'assert'
import evem from 'wsemi/src/evem.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import { delay, captureConsole, recordServer, pollRaw } from './tools/helpers.mjs'


//本檔對應之契約(WServBroadcastServer之JSDoc): 輪詢之clientId須為非空字串, 任意字串(含__proto__、constructor、a.length、a[0])皆為一般識別, 回覆一律為陣列;
//clientId不是非空字串者拒絕該次輪詢, 不發事件、不建立在線身分; getMessages回傳一般物件; broadcast以呼叫當下之值(複製)廣播;
//本套件只處理[sys:polling], 其他函數名之execute不回應(須由應用端註冊監聽回應)


//dataOf, 輪詢結果之各則訊息之data
let dataOf = (r) => {
    assert.ok(Array.isArray(r.resolve), `回覆應為陣列, 實得: ${JSON.stringify(r)}`) //契約: 回覆一律為陣列
    return r.resolve.map((v) => v.data)
}


describe('server polling input', function() {

    it('特殊字串之clientId輪詢後得陣列, 且不影響其他客戶端之廣播', async function() {
        let srv = WServBroadcastServer(evem())
        let ids = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'a.length', 'a[0]', 'a.b']
        await pollRaw(srv, { clientId: 'a' })
        await pollRaw(srv, { clientId: 'b' })
        srv.broadcast('m0')
        for (let id of ids) {
            let r = await pollRaw(srv, { clientId: id })
            assert.deepStrictEqual(dataOf(r), [], `${id}: 首輪得空陣列`) //契約: 任意字串皆為一般識別, 回覆一律為陣列
        }
        srv.broadcast('m1')
        assert.deepStrictEqual(dataOf(await pollRaw(srv, { clientId: 'a' })), ['m0', 'm1']) //契約: 不影響其他客戶端之廣播
        assert.deepStrictEqual(dataOf(await pollRaw(srv, { clientId: 'b' })), ['m0', 'm1']) //契約: 不影響其他客戶端之廣播
        for (let id of ids) {
            assert.deepStrictEqual(dataOf(await pollRaw(srv, { clientId: id })), ['m1'], `${id}: 收到其後之廣播`) //契約: 任意字串皆為一般識別
        }
        srv.clearBroadcast()
    })

    it('clientId不是非空字串時拒絕該次輪詢, 不發事件、不建立在線身分、不印log', async function() {
        let srv = WServBroadcastServer(evem())
        let ms = recordServer(srv)
        let errs = []
        srv.on('error', (err) => {
            errs.push(err)
        })
        let inputs = [{}, { clientId: '' }, null, { clientId: 123 }, { clientId: { x: 1 } }, { clientId: ['a', 0] }, { clientId: null }]
        let logs = await captureConsole(async () => {
            for (let input of inputs) {
                let r = await pollRaw(srv, input)
                assert.deepStrictEqual(r, { reject: '[sys:polling] invalid clientId' }, JSON.stringify(input)) //契約: clientId不是非空字串者拒絕該次輪詢
            }
            await delay(50)
        }, 'log')
        assert.deepStrictEqual(srv.getClients(), []) //契約: 不建立在線身分
        assert.deepStrictEqual(ms, []) //契約: 不發事件
        assert.deepStrictEqual(errs, []) //契約: 不發事件
        assert.deepStrictEqual(logs, []) //契約: 不交給在線偵測(不印trigger need key)
        srv.clearBroadcast()
    })

    it('getMessages回傳一般物件, 特殊字串之clientId為其自有屬性', async function() {
        let srv = WServBroadcastServer(evem())
        await pollRaw(srv, { clientId: '__proto__' })
        await pollRaw(srv, { clientId: 'a' })
        srv.broadcast('x')
        let m = srv.getMessages()
        assert.strict.equal(Object.getPrototypeOf(m), Object.prototype) //契約: getMessages回傳一般物件
        assert.ok(Object.hasOwn(m, '__proto__')) //契約: 任意字串皆為一般識別
        assert.deepStrictEqual(Object.keys(m).sort(), ['__proto__', 'a']) //契約: 每個在線客戶端一個佇列
        assert.deepStrictEqual(m.a, [{ mode: 'broadcast', data: 'x' }]) //契約: 佇列內容為廣播訊息
        srv.clearBroadcast()
    })

    it('broadcast以呼叫當下之值廣播, 其後改動data不影響尚未取走之訊息', async function() {
        let srv = WServBroadcastServer(evem())
        await pollRaw(srv, { clientId: 'a' })
        let o = { x: 1 }
        srv.broadcast(o)
        o.x = 2
        assert.deepStrictEqual(dataOf(await pollRaw(srv, { clientId: 'a' })), [{ x: 1 }]) //契約: broadcast以呼叫當下之值(複製)廣播
        srv.clearBroadcast()
    })

    it('本套件只處理[sys:polling], 其他函數名之execute不回應', async function() {
        let srv = WServBroadcastServer(evem())
        let r = await pollRaw(srv, {}, 50, 'foo')
        assert.deepStrictEqual(r, { unsettled: true }) //契約: 其他函數名須由應用端註冊監聽回應, 本套件不回應
        srv.clearBroadcast()
    })

})
