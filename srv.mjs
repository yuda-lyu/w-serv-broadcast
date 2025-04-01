import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
import WServBroadcastServer from './src/WServBroadcastServer.mjs'


let ms = []

let opt = {
    port: 8080,
    apiName: 'api',
    pathStaticFiles: '.', //要存取專案資料夾下web.html, 故不能給dist
    funCheck: () => {
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
        console.log('broadcast n', n)
        ms.push({ broadcast: n })
        if (n >= 5) {
            //clearInterval(t)
        }
    }, 1500)

    //broadcast給前端還需要時間處理, 故不能於滿足條件n就stop
    setTimeout(() => {
        wo.clearBroadcast()
        instWConverServer.stop()
        console.log('ms', ms)
    }, 110000)

}, 3000)

wo.on('clientEnter', function(data) {
    console.log(`Server[port:${opt.port}]: clientEnter`, data)
})
wo.on('clientLeave', function(data) {
    console.log(`Server[port:${opt.port}]: clientLeave`, data)
})
wo.on('clientChange', function(data) {
    console.log(`Server[port:${opt.port}]: clientChange`, data)
})
wo.on('broadcast', function(data) {
    console.log(`Server[port:${opt.port}]: broadcast`, data)
})
wo.on('error', function(err) {
    console.log(`Server[port:${opt.port}]: error`, err)
})
wo.on('handler', function(data) {
    // console.log(`Server[port:${opt.port}]: handler`, data)
})

// Server[port:8080]: clientEnter {random}
// Server[port:8080]: clientChange 1
// broadcast n 1
// broadcast n 2
// broadcast n 3
// broadcast n 4
// broadcast n 5
// ms [
//   { broadcast: 1 },
//   { broadcast: 2 },
//   { broadcast: 3 },
//   { broadcast: 4 },
//   { broadcast: 5 }
// ]
// Server[port:8080]: clientLeave {random}
// Server[port:8080]: clientChange 0

//node --experimental-modules srv.mjs
