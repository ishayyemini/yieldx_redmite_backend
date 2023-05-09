const mqtt = require('mqtt')

const adminUsers = ['ishay2', 'lior', 'amit']
const setupClient = (ws, user) => {
  let store = {}
  const url = user.settings?.mqtt || 'mqtts://broker.hivemq.com:8883'

  const client = mqtt.connect(url, { rejectUnauthorized: false })
  client.on('connect', () => {
    client.subscribe(['YIELDX/STAT/RM/#', 'sensdata/#'])
    client.on('message', (topic, payload) => {
      const { type, ...data } = parseMessage(topic, payload)
      if (
        type === 'STATUS' ||
        (type === 'DATA' && (store[data.id]?.lastSens ?? 0) < data.lastSens)
      ) {
        store = {
          ...store,
          [data.id]: { ...(store[data.id] ?? {}), ...data },
        }
        if (
          [...adminUsers, store[data.id].customer ?? ''].includes(user.username)
        )
          ws.send(JSON.stringify(store[data.id]))
      }
    })
  })
  client.on('error', (error) => {
    console.log(error)
    ws.close(4004, `MQTT error: ${error.message}`)
  })
}

const parseMessage = (topic, payload) => {
  let data = {}
  try {
    const parsed = JSON.parse(payload.toString())
    if (topic.startsWith('YIELDX/STAT/RM/'))
      data = {
        type: 'STATUS',
        id: topic.split('/')[3],
        start: parsed.STRT ? new Date(parsed.STRT * 1000) : 0,
        end: parsed.END ? new Date(parsed.END * 1000) : 0,
        detection: parsed.DETCT ? new Date(parsed.DETCT * 1000) : 0,
        trained: parsed.TRND ? new Date(parsed.TRND * 1000) : 0,
        battery: parsed.BSTAT === 'Low' ? 'Low' : 'Ok',
        lastUpdated: new Date(parsed.TS * 1000),
      }
    if (topic.startsWith('sensdata/'))
      data = {
        type: 'DATA',
        id: topic.split('/')[1],
        lastSens: new Date(topic.split('/')[2]),
        location: parsed.Location,
        house: parsed.House,
        inHouseLoc: parsed.InHouseLoc,
        customer: parsed.Customer,
        contact: parsed.Contact,
      }
  } catch {
    console.error('Cannot parse mqtt message')
  }
  return data
}

module.exports = setupClient
