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

//node --experimental-modules scl.mjs
