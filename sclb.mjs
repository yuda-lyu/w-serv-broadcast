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

//node --experimental-modules sclb.mjs
