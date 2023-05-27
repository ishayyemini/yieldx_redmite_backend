const mqtt = require('mqtt')
const moment = require('moment-timezone')
const webpush = require('web-push')

const {
  upsertMqttDevice,
  getMqttDevices,
  getPushSubscriptions,
} = require('../auth/db_user')
const {
  WEBPUSH_MAIL,
  WEBPUSH_PUBLIC_KEY,
  WEBPUSH_PRIVATE_KEY,
} = require('../tokens.json')

const adminUsers = ['ishay2', 'lior', 'amit']

const mqttServers = [
  'mqtts://broker.hivemq.com:8883',
  'mqtts://3.64.31.133:8884',
]

const parseMessage = (topic, payload) => {
  let data = {}
  try {
    const parsed = JSON.parse(payload.toString())
    if (topic.startsWith('YIELDX/STAT/RM/'))
      data = {
        id: topic.split('/')[3],
        status: {
          start: parsed.STRT * 1000 || 0,
          end: parsed.END * 1000 || 0,
          detection: parsed.DETCT * 1000 || 0,
          trained: parsed.TRND * 1000 || 0,
          battery: parsed.BSTAT === 'Low' ? 'Low' : 'Ok',
          mode: parsed.MODE || '',
        },
        lastUpdated: parsed.TS * 1000 || 0,
      }
    if (topic.startsWith('YIELDX/CONF/RM/CURRENT/'))
      data = {
        id: topic.split('/')[4],
        location: parsed.Location ?? '',
        house: parsed.House ?? '',
        inHouseLoc: parsed.InHouseLoc ?? '',
        customer: parsed.Customer ?? '',
        contact: parsed.Contact ?? '',
        timezone: isNaN(parsed.TZ) ? 0 : Number(parsed.TZ),
        conf: {
          training: {
            preOpen: parsed.PreOpen ?? 0,
            ventDur: parsed.ventDur ?? 1,
            on1: parsed.On_1 ?? 0,
            sleep1: parsed.Sleep_1 ?? 0,
            train: parsed.Train ?? 0,
          },
          daily: {
            open1: parsed.Open_1?.padStart(5, '0') ?? '09:46',
            close1: parsed.Close_1?.padStart(5, '0') ?? '09:48',
          },
          detection: {
            startDet: parsed.StartDet?.padStart(5, '0') ?? '09:50',
            vent2: parsed.vent2 ?? 0,
            on2: parsed.On_2 ?? 1,
            sleep2: parsed.Sleep_2 ?? 1,
            detect: parsed.Detect ?? 1,
          },
        },
      }
  } catch {
    console.error('Cannot parse mqtt message')
  }
  return data
}

const pushConfUpdate = async (conf, user) => {
  return new Promise((resolve, reject) => {
    const url = user.settings?.mqtt || 'mqtts://broker.hivemq.com:8883'
    const data = JSON.stringify({
      Location: conf.location,
      House: conf.house,
      InHouseLoc: conf.inHouseLoc,
      Customer: conf.customer,
      Contact: conf.contact,
      PreOpen: conf.preOpen,
      ventDur: conf.ventDur,
      On_1: conf.on1,
      Sleep_1: conf.sleep1,
      Train: conf.train,
      Open_1: conf.open1,
      Close_1: conf.close1,
      StartDet: conf.startDet,
      vent2: conf.vent2,
      On_2: conf.on2,
      Sleep_2: conf.sleep2,
      Detect: conf.detect,
    })
    const client = mqtt.connect(url, { rejectUnauthorized: false })

    client.on('connect', () => {
      client.publish(
        `YIELDX/CONF/RM/NEW/${conf.id}`,
        data,
        { retain: true },
        (error) => {
          client.end()
          if (error) reject('MQTT error')
          else resolve()
        }
      )
    })
    client.on('error', (error) => {
      console.log(error)
      reject('MQTT error')
    })
  })
}

const setupMqtt = (store) => {
  mqttServers.forEach((url) => {
    const client = mqtt.connect(url, { rejectUnauthorized: false })
    client.on('connect', () => {
      client.subscribe(['YIELDX/STAT/RM/#', 'YIELDX/CONF/RM/#'])
      client.on('message', (topic, payload) => {
        const data = parseMessage(topic, payload)
        store.set(`${data.id}|${url}`, {
          ...(store.get(`${data.id}|${url}`) ?? {}),
          ...data,
          server: url,
        })
        const device = store.get(`${data.id}|${url}`)
        if (device.status && device.conf)
          upsertMqttDevice({
            deviceID: device.id,
            server: url,
            timestamp: moment(device.lastUpdated).toISOString(),
            mode: device.status.mode,
            customer: device.customer,
            expectedUpdateAt: calcExpectedTime(device).nextUpdate.toISOString(),
          })
      })
    })
    client.on('error', (error) => {
      console.log(error)
    })
  })
}

const calcExpectedTime = (device) => {
  let nextUpdate = moment(device.lastUpdated)
  let afterNextUpdate

  const parseHour = (s) => {
    const [hour, min] = s.split(':')
    const deadline = moment(nextUpdate)
      .tz(`Etc/GMT${(device.timezone >= 0 ? '' : '+') + -device.timezone}`)
      .hour(+hour)
      .minute(+min)
      .second(0)
    if (nextUpdate.isSameOrAfter(deadline)) deadline.add(1, 'day')
    return deadline
  }

  switch (device.status.mode) {
    case 'PreOpen Lid':
      nextUpdate.add(device.conf.training.preOpen, 'minutes')
      afterNextUpdate = nextUpdate
        .clone()
        .add(device.conf.training.on1 + device.conf.training.sleep1, 'minutes')
      break
    case 'Training':
      const trainCycleLength =
        device.conf.training.on1 + device.conf.training.sleep1
      const totalTrainCycles = Math.ceil(
        device.conf.training.train / trainCycleLength
      )
      const minutesSinceStart = moment(device.lastUpdated).diff(
        device.status.start,
        'minutes'
      )
      const currentTrainCycle =
        Math.floor(minutesSinceStart / trainCycleLength) + 1

      nextUpdate.add(trainCycleLength, 'minutes')
      if (currentTrainCycle < totalTrainCycles)
        afterNextUpdate = nextUpdate.clone().add(trainCycleLength, 'minutes')
      else {
        // This is calculated *after* 1 cycle!!!
        afterNextUpdate = moment.min(
          parseHour(device.conf.daily.open1),
          parseHour(device.conf.daily.close1),
          parseHour(device.conf.detection.startDet)
        )
      }
      break
    case 'Done Training':
    case 'Lid Closed Daily-Cycle Done':
      nextUpdate = moment.min(
        parseHour(device.conf.daily.open1),
        parseHour(device.conf.daily.close1),
        parseHour(device.conf.detection.startDet)
      )
      // Minimum *after* the first minimum
      afterNextUpdate = moment.min(
        parseHour(device.conf.daily.open1),
        parseHour(device.conf.daily.close1),
        parseHour(device.conf.detection.startDet)
      )
      break
    case 'Lid Opened Idling':
      nextUpdate = parseHour(device.conf.daily.close1)
      afterNextUpdate = parseHour(device.conf.detection.startDet)
      break
    case 'Lid Closed Idling':
      nextUpdate = parseHour(device.conf.detection.startDet)
      afterNextUpdate = nextUpdate
        .clone()
        .add(
          device.conf.detection.on2 + device.conf.detection.sleep2,
          'minutes'
        )
      break
    case 'Inspecting':
    case 'Report Inspection':
      const detectCycleLength =
        device.conf.detection.on2 + device.conf.detection.sleep2
      const totalDetectCycles = Math.ceil(
        device.conf.detection.detect / detectCycleLength
      )
      const minutesSinceOpen = moment(device.lastUpdated).diff(
        parseHour(device.conf.daily.open1),
        'minutes'
      )
      const currentDetectCycle =
        Math.floor(minutesSinceOpen / totalDetectCycles) + 1

      nextUpdate.add(detectCycleLength, 'minutes')
      if (currentDetectCycle < totalDetectCycles)
        afterNextUpdate = nextUpdate.clone().add(detectCycleLength, 'minutes')
      else afterNextUpdate = parseHour(device.conf.daily.open1)
      break
  }

  return { nextUpdate, afterNextUpdate }
}

const listenToAlerts = () => {
  webpush.setVapidDetails(WEBPUSH_MAIL, WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY)

  let lastPolled = '',
    devices = {}

  const pollDB = async () => {
    const newDevices = await getMqttDevices(lastPolled)

    newDevices.forEach((device) => {
      const id = `${device.deviceID}|${device.server}`
      const minutes = moment(device.expectedUpdateAt).diff(moment(), 'minutes')
      if (minutes > 0)
        device.notify = setTimeout(() => {
          sendPushNotification(devices[id])
        }, (minutes + 10) * 60 * 1000)
      devices[id] = device
    })

    lastPolled = new Date().toISOString()
  }

  setInterval(async () => {
    await pollDB()
  }, 10 * 60 * 1000)
}

const sendPushNotification = async (device) => {
  const subs = await getPushSubscriptions([...adminUsers, device.customer])
  console.log(subs)
  subs.forEach((sub) => {
    webpush.sendNotification(
      sub,
      JSON.stringify({
        title: 'RedMite - Device Error Alert',
        description: `Device ${device.deviceID} was expected
        to update at ${moment(device.expectedUpdateAt).toISOString()}.
        Current status is ${device.mode} since
        ${moment(device.timestamp).toISOString()}`,
      })
    )
  })
}

module.exports = {
  adminUsers,
  pushConfUpdate,
  setupMqtt,
  calcExpectedTime,
  mqttServers,
}
