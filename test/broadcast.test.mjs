import assert from 'assert'
// import fs from 'fs'
// import _ from 'lodash-es'
import w from 'wsemi'
import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastServer from '../src/WServBroadcastServer.mjs'
import WServBroadcastClient from '../src/WServBroadcastClient.mjs'


describe('broadcast', function() {

    let msAll = []

    let runServer = () => {

        let ms = []

        let opt = {
            port: 8080,
            apiName: 'api',
            pathStaticFiles: '.', //要存取專案資料夾下web.html, 故不能給dist
            verifyConn: () => {
                return true
            },
        }

        //instWConverServer
        let instWConverServer = new WConverhpServer(opt)

        //wo
        let wo = new WServBroadcastServer(instWConverServer)

        //啟動後要等client連入才有辦法收broadcast, 故須延遲觸發
        setTimeout(() => {

            let n = 0
            let t = setInterval(() => {
                n++
                wo.broadcast(`n=${n}`)
                // console.log('broadcast n', n)
                ms.push({ broadcast: n })
                if (n >= 5) {
                    clearInterval(t)
                }
            }, 1500)

            //broadcast給前端還需要時間處理, 故不能於滿足條件n就stop
            setTimeout(() => {
                wo.clearBroadcast()
                instWConverServer.stop()
                // console.log('ms', ms)
                msAll.push({ server: ms })
            }, 10000)

        }, 3000)

        wo.on('clientEnter', function(data) {
            // console.log(`Server[port:${opt.port}]: clientEnter`, data)
        })
        wo.on('clientLeave', function(data) {
            // console.log(`Server[port:${opt.port}]: clientLeave`, data)
        })
        wo.on('clientChange', function(data) {
            // console.log(`Server[port:${opt.port}]: clientChange`, data)
        })
        wo.on('broadcast', function(data) {
            // console.log(`Server[port:${opt.port}]: broadcast`, data)
        })
        wo.on('error', function() {
            // console.log(`Server[port:${opt.port}]: error`, err)
        })
        wo.on('handler', function(data) {
            // console.log(`Server[port:${opt.port}]: handler`, data)
        })

    }

    let runClient = () => {

        let ms = []

        let opt = {
            FormData,
            url: 'http://localhost:8080',
            apiName: 'api',
        }

        //instWConverClient
        let instWConverClient = new WConverhpClient(opt)

        //wo
        let wo = new WServBroadcastClient(instWConverClient)

        wo.on('broadcast', function(data) {
            // console.log(`broadcast`, data)
            ms.push({ receive: data })
        })
        wo.on('openOnce', function() {
            // console.log(`openOnce`)
            ms.push({ event: 'openOnce' })
        })
        wo.on('open', function() {
            // console.log(`open`)
            ms.push({ event: 'open' })
        })
        wo.on('error', function() {
            // console.log(`error`, err)
        })

        setTimeout(() => {
            wo.clearBroadcast()
            // console.log('ms', ms)
            msAll.push({ client: ms })
        }, 13000)

    }

    let run = () => {
        let pm = w.genPm()
        runServer()
        runClient()
        setTimeout(() => {
            // console.log('msAll', JSON.stringify(msAll))
            // fs.writeFileSync('./test_broadcast.json', JSON.stringify(msAll), 'utf8')
            pm.resolve(msAll)
        }, 15000)
        return pm
    }

    let res = `[{"client":[{"event":"openOnce"},{"event":"open"},{"receive":"n=1"},{"receive":"n=2"},{"receive":"n=3"},{"receive":"n=4"},{"receive":"n=5"}]},{"server":[{"broadcast":1},{"broadcast":2},{"broadcast":3},{"broadcast":4},{"broadcast":5}]}]`
    it(`should return ${res} when test`, async function() {
        let r = await run()
        r = JSON.stringify(r)
        let rr = res
        assert.strict.deepEqual(r, rr)
    })

})
