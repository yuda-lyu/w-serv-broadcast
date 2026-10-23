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

## Identity verification (polling)
`w-serv-broadcast` does **not** verify identity (token). The server only calls the verification hook injected by the user; when no hook is injected, anyone who passes the transport layer (e.g. `verifyConn` of `w-converhp`) can poll, i.e. receive all later broadcasts (including whatever the deployer passes to `broadcast()`), and create an online identity and a message queue per `clientId`. The default is therefore "allow".

* Server `new WServBroadcastServer(instWConverServer, { verifyPolling })`: `verifyPolling(input)` (sync or async) is called on every `[sys:polling]` **before any side effect** (queue, online identity, message retrieval, `clientEnter`). It receives a copy of the polling input (`clientId`, the token under the fixed key `__sysToken__`, and any user fields). Only a strict `true` (or a promise / thenable resolving to `true`) lets the poll through; any other value, a throw or a reject is a denial: the poll is rejected with the fixed message `[sys:polling] permission denied`, no state is created, and an `error` event `{ msg, err }` is emitted for auditing (`msg` is `[sys:polling] permission denied`, or `[sys:polling] verifyPolling error` when the hook itself threw/rejected). After a poll is allowed, `__sysToken__` is stripped before `clientEnter` / `clientLeave` receive the input (and the same stripping applies when no hook is provided, see Upgrade Notes).
* Client `new WServBroadcastClient(instWConverClient, { getToken })`: `getToken()` (sync or async) is called before every poll and its string result is sent under `__sysToken__` (a non-string becomes `''`); when it throws or rejects, that round is reported as `{ msg: '[sys:polling] error', err }` and nothing is sent. Without `getToken` the polling input is exactly `{ clientId }`.
* The hook must validate the token completely (valid token, user exists and is enabled, deployer authorization), decide whether an empty identity is allowed, and check that `clientId` belongs to that identity (a `clientId` is chosen by the client and must be unique, otherwise clients take each other's messages). The package has no built-in hook timeout: a hook that never settles leaves that poll pending until the client times out. A token travels with every poll in plain text: use HTTPS.

```alias
//server
instWConverServer = new WServBroadcastServer(instWConverServer, {
    verifyPolling: async (input) => {
        let userId = await getUserIdByToken(input.__sysToken__) //your own complete verification
        return userId !== '' && ownsClientId(userId, input.clientId)
    },
})

//client
instWConverClient = new WServBroadcastClient(instWConverClient, {
    getToken: () => localStorage.getItem('token'),
})
```

## Upgrade Notes
* New server option `verifyPolling` and new client option `getToken` (both optional). **Not providing them keeps the previous behavior** (polling is not verified; for an input without `__sysToken__` the input object is handed to `clientEnter` / `clientLeave` as is, replies stay synchronous). Existing code needs no change, but if polling must be restricted to authenticated users you must inject `verifyPolling` on the server **and** provide `getToken` on the client.
* Order of deployment: update the server first (with `verifyPolling`), then the clients. A client without `getToken` sends no token, so a `verifyPolling` that requires a valid token denies it (`[sys:polling] permission denied` on every poll, no connection, no broadcast) until its page is reloaded with a version that provides `getToken`; a `verifyPolling` that accepts an empty token lets it through, as you decide.
* `verifyPolling` / `getToken` given but not a function (other than `undefined` / `null`) makes the constructor throw (`opt.verifyPolling is not a function` / `opt.getToken is not a function`) instead of silently skipping verification.
* Every denied poll emits one `error` event on the server: on a public endpoint, an anonymous caller can generate as many `error` events as polls (same order of magnitude as polls rejected by the transport layer); rate limiting is not part of this package.
* With `verifyPolling` provided, the reply of a poll is asynchronous (sent after the hook settles). Another `execute` listener registered on the same event object **after** this package and answering `[sys:polling]` synchronously (for example a data channel that answers every function name with `invalid token`) therefore settles the request first and the poll fails; such a listener must skip `[sys:polling]` (not answer it). Without `verifyPolling` the reply is synchronous and registration order alone decides, as before.
* The fixed key `__sysToken__` is reserved for the token in the polling input and is **always** removed before `clientEnter` / `clientLeave` (and the online-client data returned by `getClients`) see the input, **whether or not `verifyPolling` is provided**: a credential must never reach event data or logs. When the input carries that key, the server hands a copy without it to the listeners and never modifies the object it received; an input without that key is handed over as the same object, exactly as before. The only visible difference from earlier versions is for inputs that contain the key, which is sent only by a client that has `getToken` set.

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

//instWConverServer
instWConverServer = new WServBroadcastServer(instWConverServer)

//啟動後要等client連入才有辦法收broadcast, 故須延遲觸發
setTimeout(() => {

    let n = 0
    let t = setInterval(() => {
        n++
        instWConverServer.broadcast(`n=${n}`)
        console.log('broadcast n', n)
        ms.push({ broadcast: n })
        if (n >= 5) {
            clearInterval(t)
        }
    }, 1500)

    //broadcast給前端還需要時間處理, 故不能於滿足條件n就stop
    setTimeout(() => {
        instWConverServer.clearBroadcast()
        instWConverServer.stop()
        console.log('ms', ms)
    }, 10000)

}, 3000)

instWConverServer.on('clientEnter', function(clientId, data) {
    console.log(`Server[port:${opt.port}]: clientEnter`, clientId, data)
})
instWConverServer.on('clientLeave', function(clientId, data) {
    console.log(`Server[port:${opt.port}]: clientLeave`, clientId, data)
})
instWConverServer.on('clientChange', function(numClients) {
    console.log(`Server[port:${opt.port}]: clientChange`, numClients)
})
instWConverServer.on('error', function(err) {
    console.log(`Server[port:${opt.port}]: error`, err)
})
instWConverServer.on('handler', function(data) {
    // console.log(`Server[port:${opt.port}]: handler`, data)
})

// Server[port:8080]: clientEnter {random} { clientId: {random} }
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
// Server[port:8080]: clientLeave {random} { clientId: {random} }
// Server[port:8080]: clientChange 0
```

#### Example for w-serv-broadcast-client in node.js:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/scl.mjs)]
```alias
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastClient from './src/WServBroadcastClient.mjs'

let ms = []

let opt = {
    url: 'http://localhost:8080',
    apiName: 'api',
}

//instWConverClient
let instWConverClient = new WConverhpClient(opt)

//instWConverClient
instWConverClient = new WServBroadcastClient(instWConverClient)

instWConverClient.on('broadcast', function(data) {
    console.log(`broadcast`, data)
    ms.push({ receive: data })
})
instWConverClient.on('openOnce', function() {
    console.log(`openOnce`)
    ms.push({ event: 'openOnce' })
})
instWConverClient.on('open', function() {
    console.log(`open`)
    ms.push({ event: 'open' })
})
instWConverClient.on('error', function(err) {
    console.log(`error`, err)
})

setTimeout(() => {
    instWConverClient.clearBroadcast()
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

Add script for w-serv-broadcast-client.
```alias
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.1.11/dist/w-serv-broadcast-client.umd.js"></script>
```

#### Example for w-serv-broadcast-client in web:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/web.html)]
```alias
<script src="https://cdn.jsdelivr.net/npm/w-converhp/dist/w-converhp-client.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.1.11/dist/w-serv-broadcast-client.umd.js"></script>

//WConverhpClient
let WConverhpClient = window['w-converhp-client']

//WServBroadcastClient
let WServBroadcastClient = window['w-serv-broadcast-client']
    
let opt = {
    url: 'http://localhost:8080',
    apiName: 'api',
}

//instWConverClient
let instWConverClient = new WConverhpClient(opt)

//instWConverClient
instWConverClient = new WServBroadcastClient(instWConverClient)

instWConverClient.on('broadcast', function(data) {
    console.log(`broadcast`, data)
})
instWConverClient.on('openOnce', function() {
    console.log(`openOnce`)
})
instWConverClient.on('open', function() {
    console.log(`open`)
})
instWConverClient.on('error', function(err) {
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