const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://YOUR_PROJECT.firebaseio.com'
});
const db = admin.database();

async function updateDatabase() {
  try {
    const response = await axios.get('https://queue-times.com/parks/27/queue_times.json');
    const rides = [...response.data.rides, ...response.data.lands.flatMap(land => land.rides)];
    
    const updates = {};
    const now = Date.now();
    
    const dbRides = (await db.ref('rides').once('value')).val() || {};
    
    rides.forEach(ride => {
      const existing = dbRides[ride.id] || {};
      updates[`rides/${ride.id}`] = {
        ...existing,
        ...ride,
        closed_since: ride.is_open ? null : (existing.closed_since || now)
      };
    });

    await db.ref().update(updates);
    console.log('Database updated successfully');
  } catch (error) {
    console.error('Update failed:', error);
    process.exit(1);
  }
}

updateDatabase();
