# w-serv-broadcast
An operator for data control and broadcast between nodejs and browser.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-serv-broadcast.svg?style=flat)](https://npmjs.org/package/w-serv-broadcast) 
[![license](https://img.shields.io/npm/l/w-serv-broadcast.svg?style=flat)](https://npmjs.org/package/w-serv-broadcast) 
[![npm download](https://img.shields.io/npm/dt/w-serv-broadcast.svg)](https://npmjs.org/package/w-serv-broadcast) 
[![npm download](https://img.shields.io/npm/dm/w-serv-broadcast.svg)](https://npmjs.org/package/w-serv-broadcast)
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-serv-broadcast.svg)](https://www.jsdelivr.com/package/npm/w-serv-broadcast)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-serv-broadcast/WServBroadcastServer.html).

## Parts
`w-serv-broadcast` includes 2 parts: 
* `w-serv-broadcast-server`: for nodejs server
* `w-serv-broadcast-client`: for nodejs and browser client

## Installation
### Using npm(ES6 module):
```alias
npm i w-serv-broadcast
```

#### Example for w-serv-broadcast-server:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/srv.mjs)]
```alias
import WConverhpServer from 'w-converhp/src/WConverhpServer.mjs'
import WServBroadcastServer from './src/WServBroadcastServer.mjs'
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
            clearInterval(t)
        }
    }, 1500)

    //broadcast給前端還需要時間處理, 故不能於滿足條件n就stop
    setTimeout(() => {
        wo.clearBroadcast()
        instWConverServer.stop()
        console.log('ms', ms)
    }, 10000)

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
```

#### Example for w-serv-broadcast-client:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/scla.mjs)]
```alias
import FormData from 'form-data'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastClient from './src/WServBroadcastClient.mjs'

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
    console.log(`broadcast`, data)
    ms.push({ receive: data })
})
wo.on('openOnce', function() {
    console.log(`openOnce`)
    ms.push({ event: 'openOnce' })
})
wo.on('open', function() {
    console.log(`open`)
    ms.push({ event: 'open' })
})
wo.on('error', function(err) {
    console.log(`error`, err)
})

setTimeout(() => {
    wo.clearBroadcast()
    console.log('ms', ms)
}, 13000)

// openOnce
// open
// broadcast n=1
// broadcast n=2
// broadcast n=3
// broadcast n=4
// broadcast n=5
// ms [
//   { event: 'openOnce' },
//   { event: 'open' },
//   { receive: 'n=1' },
//   { receive: 'n=2' },
//   { receive: 'n=3' },
//   { receive: 'n=4' },
//   { receive: 'n=5' }
// ]

```

### In a browser(UMD module):
[Necessary] Add script for w-serv-broadcast-client.
```alias
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.0.7/dist/w-serv-broadcast-client.umd.js"></script>
```

#### Example for w-serv-broadcast-client:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/weba.html)]
```alias
<script src="https://cdn.jsdelivr.net/npm/w-converhp/dist/w-converhp-client.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.0.7/dist/w-serv-broadcast-client.umd.js"></script>

//wcc
let WConverhpClient = window['w-converhp-client']
let wcc = new WConverhpClient({
    // FormData,
    url: 'http://localhost:9000',
})

//wsdc
let WServBroadcastClient = window['w-serv-broadcast-client']
    
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
    console.log(`broadcast`, data)
})
wo.on('error', function(err) {
    console.log(`error`, err)
})
// openOnce
// open
// broadcast,n=1
// broadcast,n=2
// broadcast,n=3
// broadcast,n=4
// broadcast,n=5
```