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

## Going offline (clientLeave)
A client is detected as offline when it has not polled successfully for 10 seconds. On detecting it the server **first deletes that `clientId`'s queue and its unretrieved broadcasts, and only then emits `clientLeave` and `clientChange`** (the events are dispatched about 1 ms later). So when `clientLeave` is emitted the broadcasts made before going offline are no longer in any queue (`getMessages()` no longer has the old queue), and anyone who polls with the same `clientId` afterwards (including inside the `clientLeave` listener) gets a new, empty queue and never the broadcasts left behind before going offline; broadcasts made after going offline but before that new poll do not go into the old queue either. It is therefore safe to release the binding between a `clientId` and an identity inside `clientLeave`. Broadcasts that were not retrieved before going offline are discarded (delivery is at most once).

Notes: if the same `clientId` polls again within that ~1 ms between the detection and the dispatch of `clientLeave`, `getMessages()` shows the new queue of that re-entry (it only holds broadcasts made after going offline). With `verifyPolling`, a poll whose verification is still pending when the client goes offline takes its queue when the hook settles (a new, empty queue); the package has no built-in hook timeout, so a hook that settles later than the 10 second online timeout may let a result take effect after the `clientId` has been bound to someone else. When the server is stopped with `clearBroadcast`, the `clientLeave` re-emitted for every client already entered is also emitted after the queues are cleared (a stopped server answers no more polls).

## Observation callback (`opt.onTrace`)
Both `new WServBroadcastServer(inst, { onTrace })` and `new WServBroadcastClient(inst, { onTrace })` accept an optional callback that is called synchronously, at the moment an internal event happens, with one frozen object `{ type, ... }` (all other fields are primitive values; there is never a field named `type` besides the event type). It exists so that tests and diagnostics can synchronize on **events instead of waiting for milliseconds**: the polling timer, the online detection and the 1 ms event dispatch are all driven by timers, and "wait N ms then assert" is unstable under load. The callback is called without a receiver; a throw or a rejected promise it returns is ignored and never affects the package; its return value is not used. When `onTrace` is missing or is not a function nothing is built or called (behavior, timing and cost are the same as before). After `clearBroadcast()` no more events are reported, except the dispatches that were already in progress when it was called and, on the server, the re-emitted `clientLeave` / `clientChange` events.

Client events: `start` (`ms`: polling interval), `tick` (`n`, `skipped`: every timer fire; `skipped` when the previous poll is still in flight), `request` (`n`, `token`: the poll was sent), `result` (`n`, `ok`, `reason` of `'ok'` / `'invalid'` / `'error'`, `msgs` for `'ok'`), `emit` / `deliver` / `report` (see below), `stop` (`inflight`).

Server events: `alive` (`evType` of the underlying online detection: `'enter'` / `'leave'` with `key` and `now`, `'tick'` with `size`, `'stop'`), `prune` (`queues`, `removed`: every 1 s queue pruning), `emit` / `deliver` / `report` (see below), `stop` (`final`: number of clients that get a re-emitted `clientLeave`).

Dispatch events (both sides): `emit` (`name`, `final`: an event was scheduled, dispatched 1 ms later), `deliver` (`name`, `final`, `ok`: all listeners were called, `ok` is false when one threw), `report` (`src` of `'listener'` / `'error'`, `msg`, `via` of `'event'` / `'console'`, and `name` for `'listener'`: the package reported a listener error or an error without an `error` listener). Events dropped by the stop gate are not reported.

```alias
let events = []
let cli = new WServBroadcastClient(instWConverClient, {
    onTrace: (e) => {
        events.push(e) // e.g. { type: 'result', n: 1, ok: true, reason: 'ok', msgs: 0 }
    },
})
```

## Diagnostic output (`opt.logDetail`, `opt.funLog`)
The package never writes error values to the console by itself. Whenever it has to report something that no `error` listener receives, it goes through the shared diagnostic output of `wsemi` (`getDiag`):

* a self-reported error (`{ msg, err }`, e.g. `[sys:polling] permission denied`, `[sys:polling] verifyPolling error`, a failed poll) when **no `error` listener** is registered;
* a throw of a listener of one of the package's events when **no `error` listener** is registered, after the instance was stopped (`clearBroadcast`), or when the thrown listener is the `error` listener itself (also when the `error` listener throws while the package reports another listener's throw);
* the server hint that `instWConverServer` is not an effective object (fixed text).

By default (`console.error`, hint via `console.log`) only a fixed label and a **safe summary** is printed, never the value: `console.error('[w-serv-broadcast] [sys:polling] permission denied', { src: 'error', errType: 'string' })`. The summary has `src` (`'error'` for a self-reported error, `'listener'` for a listener throw), `name` (the event name of the listener, `'listener'` only), `errType` (the class name of an error, or the `typeof` name of another value) and `errCode` (only a code from the built-in whitelist). The value (the return value or the thrown value of `verifyPolling` or `getToken`, the thrown value of a listener, an invalid poll response) can contain a token or a user identity, so it is not printed.

* `opt.logDetail: true` (both constructors): print the detail instead of the summary, `console.error(label, detail)`, where `detail` is the value after masking: credentials (URLs with account and password, `password` / `token` / `Authorization` / `Bearer` values, ...) and every token the instance has seen (`__sysToken__` of the polling inputs on the server, the results of `getToken` on the client; the most recent 64) become `***`.
* `opt.funLog(label, safe, detail)` (both constructors): the diagnostic output goes only to this function (nothing is written to the console, `logDetail` has no effect); `detail` is the masked detail as above. A throw or a rejected promise of `funLog` is swallowed and never affects the package. A `funLog` with the property `noDetail === true` is called with `(label, safe)` only.
* A `logDetail` that is given and not a boolean, or a `funLog` that is given and not a function (`undefined` and `null` are "not given"), makes the constructor throw (`invalid opt.logDetail` / `invalid opt.funLog`) before anything is set up.

The content of the `error` **event** is not changed: it is still `{ msg, err }` with the original `err` (not masked), because the listener is your code. If you log it, do not print `err` blindly (`err` can hold the return value or the thrown value of your `verifyPolling` / `getToken`).

## Upgrade Notes
* **Breaking change (diagnostic output)**: the package no longer prints the value of an error to the console. Before, `console.error('[w-serv-broadcast] <msg>', err)` printed the original `err` when there was no `error` listener, after a stop, and the `wsemi` event dispatcher printed `[wsemi w-serv-broadcast] listener of '<event>' threw:` with the original thrown value when a listener threw without an `error` listener or when the `error` listener itself threw. Now only a label and a safe summary are printed (see "Diagnostic output"); the label of a listener throw is `[w-serv-broadcast] listener of event[<event>] error` (also for the `error` listener). Use `opt.logDetail: true` or `opt.funLog` to get the detail (masked). Code that parsed these console lines must be updated; the `error` event, its `{ msg, err }` content, the order of events and the observation events are unchanged (new: `report` with `src: 'listener'`, `name: 'error'`, `via: 'console'` for an `error` listener that throws).
* New optional `logDetail` / `funLog` options on both constructors (see "Diagnostic output"); a given value of the wrong type makes the constructor throw. Requires `wsemi` 1.9.33 or later.
* New optional `onTrace` option on both constructors (see above). Not providing it keeps the previous behavior; there are no breaking changes.
* Going offline (online timeout) now clears the `clientId`'s queue **before** `clientLeave` / `clientChange` are emitted. Previously the queue was removed by a timer up to 1 second later, so a poll with the same `clientId` inside that window (for example another user who just got the `clientId` bound after your `clientLeave` handler released it) received the broadcasts left behind. The events, their payloads and the online detection are unchanged.
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
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.1.16/dist/w-serv-broadcast-client.umd.js"></script>
```

#### Example for w-serv-broadcast-client in web:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-broadcast/blob/master/web.html)]
```alias
<script src="https://cdn.jsdelivr.net/npm/w-converhp/dist/w-converhp-client.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/w-serv-broadcast@1.1.16/dist/w-serv-broadcast-client.umd.js"></script>

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