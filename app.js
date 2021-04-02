const firebase = require('firebase-admin')
const fs = require('fs')

firebase.initializeApp({
  credential: firebase.credential.cert(require('./service-account')),
})

const firestore = firebase.firestore()

const mode = process.argv[2]

async function deleteCollection(collectionPath, batchSize = 25) {
  const collectionRef = firestore.collection(collectionPath)
  const query = collectionRef.orderBy('__name__').limit(batchSize)

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject)
  })
}

async function deleteQueryBatch(query, resolve) {
  const snapshot = await query.get()

  const batchSize = snapshot.size
  if (batchSize === 0) {
    // When there are no documents left, we are done
    resolve()
    return
  }

  // Delete documents in a batch
  const batch = firestore.batch()
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref)
  })
  await batch.commit()

  // Recurse on the next process tick, to avoid
  // exploding the stack.
  process.nextTick(() => {
    deleteQueryBatch(query, resolve)
  })
}

const downloadJson = async () => {
  const devices = (await firestore.collection('devices').get()).docs.map(
    (doc) => {
      const { type, ...device } = doc.data()

      return device
    }
  )

  const rooms = (await firestore.collection('rooms').get()).docs.map((doc) => {
    const { name } = doc.data()

    return name
  })

  const sourceTypes = {}
  const sourceTypeDocs = (
    await firestore
      .collection('devices')
      .doc('definitions')
      .collection('sourceTypes')
      .get()
  ).docs
  sourceTypeDocs.forEach((doc) => {
    sourceTypes[doc.id] = doc.data()
  })

  const targetTypes = {}
  const targetTypeDocs = (
    await firestore
      .collection('devices')
      .doc('definitions')
      .collection('targetTypes')
      .get()
  ).docs
  targetTypeDocs.forEach((doc) => {
    targetTypes[doc.id] = doc.data().entries
  })

  fs.writeFileSync(
    'data.json',
    JSON.stringify({ rooms, devices, sourceTypes, targetTypes })
  )
}

const uploadJson = async () => {
  await deleteCollection('devices')
  await deleteCollection('rooms')
  await deleteCollection('devices/definitions/sourceTypes')
  await deleteCollection('devices/definitions/targetTypes')

  const { devices, rooms, sourceTypes, targetTypes } = require('./data.json')

  for (const room of rooms) {
    await firestore.collection('rooms').add({ name: room })
  }

  for (const device of devices) {
    const type = sourceTypes[device.sourceType].targetType

    await firestore.collection('devices').add({ ...device, type })
  }

  for (const [name, targetType] of Object.entries(targetTypes)) {
    await firestore
      .collection('devices')
      .doc('definitions')
      .collection('targetTypes')
      .doc(name)
      .set({ entries: targetType })
  }

  for (const [name, sourceType] of Object.entries(sourceTypes)) {
    await firestore
      .collection('devices')
      .doc('definitions')
      .collection('sourceTypes')
      .doc(name)
      .set(sourceType)
  }

  await firestore
    .collection('settings')
    .doc('firestore-sync')
    .update({ restart: Date.now() })
}

switch (mode) {
  case '--download': {
    downloadJson()
    break
  }
  case '--upload': {
    uploadJson()
    break
  }
}
