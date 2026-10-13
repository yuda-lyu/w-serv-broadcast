import assert from 'assert'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'


//本檔對應之契約(WServBroadcastClient之JSDoc @param instWConverClient, 規則帳本R04、R10): 須執行環境內建AbortController, 否則建構時拋錯
//(描述性訊息'AbortController is not available', 與其他建構檢查同形), 且建構失敗時不殘留輪詢計時器
//於子行程內刪除全域AbortController: 同一mocha worker會循序執行多個檔案, 於本行程刪除全域會波及他檔


let fd = path.dirname(fileURLToPath(import.meta.url))
let urlSrc = pathToFileURL(path.join(fd, '..', 'src', 'WServBroadcastClient.mjs')).href
let urlEvem = import.meta.resolve('wsemi/src/evem.mjs')

//runChild, 子行程: 刪除全域AbortController後建構前端, 輸出所拋之訊息與建構前後之Timeout數差
let runChild = () => new Promise((resolve) => {
    let code = `
delete globalThis.AbortController
let { default: WServBroadcastClient } = await import(${JSON.stringify(urlSrc)})
let { default: evem } = await import(${JSON.stringify(urlEvem)})
let countTimeout = () => process.getActiveResourcesInfo().filter((v) => v === 'Timeout').length
let ev = evem()
ev.execute = () => Promise.resolve([])
let n0 = countTimeout()
let msg = null
try {
    WServBroadcastClient(ev, { timePolling: 30 })
}
catch (err) {
    msg = err instanceof Error ? err.message : String(err)
}
let n1 = countTimeout()
process.stdout.write('RESULT:' + JSON.stringify({ msg, dTimeout: n1 - n0 }) + '\\n')
process.exit(0)
`
    let cp = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] })
    let o = ''
    let e = ''
    cp.stdout.on('data', (b) => {
        o += b
    })
    cp.stderr.on('data', (b) => {
        e += b
    })
    cp.on('close', () => {
        let line = o.split(/\r?\n/).find((l) => l.startsWith('RESULT:'))
        resolve({ res: line ? JSON.parse(line.slice(7)) : null, stderr: e.slice(0, 500) })
    })
})


describe('client construct without AbortController', function() {

    it('執行環境無AbortController時建構即拋描述性錯誤, 且不殘留輪詢計時器', async function() {
        let r = await runChild()
        assert.ok(r.res !== null, `子行程未輸出結果: ${r.stderr}`)
        assert.strict.equal(r.res.msg, 'AbortController is not available') //契約: 須執行環境內建AbortController, 否則建構時拋錯
        assert.strict.equal(r.res.dTimeout, 0) //契約(R04): 建構失敗時不殘留輪詢計時器
    })

})
