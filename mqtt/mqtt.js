const mqtt = require('mqtt')
const moment = require('moment-timezone')
const webpush = require('web-push')
const schedule = require('node-schedule')

const {
  upsertMqttDevice,
  getPushSubscriptions,
  clearBadSubscriptions,
} = require('../auth/db_user')
const {
  WEBPUSH_MAIL,
  WEBPUSH_PUBLIC_KEY,
  WEBPUSH_PRIVATE_KEY,
} = require('../tokens.json')

const adminUsers = ['ishay2', 'lior', 'amit', 'izak']

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
          detection: {
            open1: parsed.Open_1?.padStart(5, '0') ?? '09:46',
            close1: parsed.Close_1?.padStart(5, '0') ?? '09:48',
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

const pushOtaUpdate = async (id, version, user, store) => {
  if (
    adminUsers.includes(user.username) ||
    store.get(id)?.customer === user.customer
  )
    return new Promise((resolve, reject) => {
      const url = user.settings?.mqtt || 'mqtts://broker.hivemq.com:8883'

      const client = mqtt.connect(url, { rejectUnauthorized: false })

      client.on('connect', () => {
        client.publish(
          `YIELDX/OTA/RM/${id}`,
          `http://3.127.195.30/RedMite/OTA/${version}.bin`,
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
  listenToAlerts(store)

  mqttServers.forEach((url) => {
    const client = mqtt.connect(url, { rejectUnauthorized: false })
    client.on('connect', () => {
      client.subscribe(['YIELDX/STAT/RM/#', 'YIELDX/CONF/RM/#'])
      client.on('message', (topic, payload) => {
        const data = parseMessage(topic, payload)
        const device = { ...(store.get(`${data.id}|${url}`) ?? {}), ...data }

        if (device.status && device.conf) {
          const { cycles, updates } = calcExpectedTime(device)
          device.nextUpdate = updates.nextUpdate.unix() * 1000
          device.afterNextUpdate = updates.afterNextUpdate.unix() * 1000
          device.server = url
          device.status.currentCycle = cycles.currentCycle
          device.status.totalCycles = cycles.totalCycles

          upsertMqttDevice({
            deviceID: device.id,
            server: url,
            timestamp: moment(device.lastUpdated).toISOString(),
            mode: cycles.currentCycle
              ? `${device.status.mode}|${cycles.currentCycle}|${cycles.totalCycles}`
              : device.status.mode,
            customer: device.customer,
            expectedUpdateAt: moment(device.nextUpdate).toISOString(),
          })
        }

        store.set(`${data.id}|${url}`, device)
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
  let currentCycle = 0
  let totalCycles = 0

  const parseHour = (s, ago) => {
    const [hour, min] = s.split(':')
    const deadline = moment(nextUpdate)
      .tz(`Etc/GMT${(device.timezone >= 0 ? '' : '+') + -device.timezone}`)
      .hour(+hour)
      .minute(+min)
      .second(0)
    if (!ago && nextUpdate.isSameOrAfter(deadline)) deadline.add(1, 'day')
    if (ago && nextUpdate.isSameOrBefore(deadline)) deadline.subtract(1, 'day')
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
      const minutesSinceStart = moment(device.lastUpdated).diff(
        device.status.start,
        'minutes'
      )
      currentCycle = Math.floor(minutesSinceStart / trainCycleLength) + 1
      totalCycles = Math.ceil(device.conf.training.train / trainCycleLength)

      nextUpdate.add(trainCycleLength, 'minutes')
      if (currentCycle < totalCycles)
        afterNextUpdate = nextUpdate.clone().add(trainCycleLength, 'minutes')
      else {
        // This is calculated *after* 1 cycle!!!
        afterNextUpdate = moment.min(
          parseHour(device.conf.detection.open1),
          parseHour(device.conf.detection.close1),
          parseHour(device.conf.detection.startDet)
        )
      }
      break
    case 'Done Training':
    case 'Lid Closed Daily-Cycle Done':
      nextUpdate = moment.min(
        parseHour(device.conf.detection.open1),
        parseHour(device.conf.detection.close1),
        parseHour(device.conf.detection.startDet)
      )
      // Minimum *after* the first minimum
      afterNextUpdate = moment.min(
        parseHour(device.conf.detection.open1),
        parseHour(device.conf.detection.close1),
        parseHour(device.conf.detection.startDet)
      )
      break
    case 'Lid Opened Idling':
      nextUpdate = parseHour(device.conf.detection.close1)
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
      const minutesSinceOpen = moment(device.lastUpdated).diff(
        parseHour(device.conf.detection.startDet, true),
        'minutes'
      )
      currentCycle = Math.floor(minutesSinceOpen / detectCycleLength) + 1
      totalCycles = Math.ceil(device.conf.detection.detect / detectCycleLength)

      nextUpdate.add(detectCycleLength, 'minutes')
      if (currentCycle < totalCycles)
        afterNextUpdate = nextUpdate.clone().add(detectCycleLength, 'minutes')
      else afterNextUpdate = parseHour(device.conf.detection.open1)
      break
    default:
      afterNextUpdate = nextUpdate
  }

  return {
    updates: { nextUpdate, afterNextUpdate },
    cycles: { currentCycle, totalCycles },
  }
}

const listenToAlerts = (store) => {
  webpush.setVapidDetails(WEBPUSH_MAIL, WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY)

  store.onUpdate((device) => {
    const id = `${device.id}|${device.server}`

    const buffer = 10
    if (moment().subtract(buffer, 'minutes').isBefore(device.afterNextUpdate)) {
      const sendAt = moment
        .max(moment(device.afterNextUpdate), moment())
        .add(buffer, 'minutes')
      schedule.cancelJob(id)
      schedule.scheduleJob(id, sendAt.toDate(), () =>
        sendPushNotification(device)
      )
    }
  })
}

const sendPushNotification = async (device) => {
  const sessions = await getPushSubscriptions([...adminUsers, device.customer])

  const badSessions = await Promise.all(
    sessions.map(({ subscription, session }) =>
      webpush
        .sendNotification(
          subscription,
          JSON.stringify({
            deviceID: device.id,
            lastUpdated: device.lastUpdated,
            expectedUpdateAt: device.nextUpdate,
            mode: device.status.mode,
            server: device.server,
          })
        )
        .then(() => null)
        .catch((err) => {
          console.log(err)
          return session
        })
    )
  )
    .then((res) => res.filter((item) => item))
    .catch(() => [])

  if (badSessions.length) await clearBadSubscriptions(badSessions)
}

module.exports = {
  adminUsers,
  pushConfUpdate,
  pushOtaUpdate,
  setupMqtt,
  calcExpectedTime,
  mqttServers,
}
