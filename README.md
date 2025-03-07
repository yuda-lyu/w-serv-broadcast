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
let wo = WServBroadcastServer(instWConverServer)

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

```

#### Example for w-serv-broadcast-client:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/scla.mjs)]
```alias
import FormData from 'form-data'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastClient from './src/WServBroadcastClient.mjs'

let opt = {
    FormData,
    url: 'http://localhost:8080',
    apiName: 'api',
}

//initWConverhpClient
let initWConverhpClient = new WConverhpClient(opt)

//wo
let wo = WServBroadcastClient(initWConverhpClient)

wo.on('broadcast', function(data) {
    console.log(`broadcast`, data)
})
wo.on('error', function(err) {
    console.log(`error`, err)
})

```

### In a browser(UMD module):
[Necessary] Add script for w-serv-broadcast-client.
```alias
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.0.0/dist/w-serv-broadcast-client.umd.js"></script>
```

#### Example for w-serv-broadcast-client:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/weba.html)]
```alias
<script src="https://cdn.jsdelivr.net/npm/w-converhp/dist/w-converhp-client.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.0.0/dist/w-serv-broadcast-client.umd.js"></script>

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

//initWConverhpClient
let initWConverhpClient = new WConverhpClient(opt)

//wo
let wo = WServBroadcastClient(initWConverhpClient)

wo.on('broadcast', function(data) {
    console.log(`broadcast`, data)
})
wo.on('error', function(err) {
    console.log(`error`, err)
})

```