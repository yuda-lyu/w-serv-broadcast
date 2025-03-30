import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
import WServBroadcastServer from './src/WServBroadcastServer.mjs'


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

let n = 0
setInterval(() => {
    n++
    wo.broadcast(`n=${n}`)
}, 1500)

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


//node --experimental-modules srv.mjs
