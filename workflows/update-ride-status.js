const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// The credentials will come from GitHub Secrets
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const database = admin.database();

async function fetchRideData() {
  try {
    // Use one of your CORS proxies or direct URL if possible from server environment
    const response = await fetch('https://queue-times.com/parks/27/queue_times.json');
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching ride data:', error);
    throw error;
  }
}

async function updateRideStatusHistory(rides) {
  const now = new Date().getTime();
  
  const updatePromises = rides.map(async (ride) => {
    const rideKey = ride.name.replace(/[.#$/[\]]/g, '_');
    const currentStatus = ride.is_open;
    
    try {
      const snapshot = await database.ref(`rideStatus/${rideKey}`).once('value');
      const rideData = snapshot.val() || {};
      
      // If status has changed from open to closed, record the closure time
      if (!currentStatus && (rideData.lastStatus === undefined || rideData.lastStatus === true)) {
        console.log(`${ride.name} status changed to closed`);
        await database.ref(`rideStatus/${rideKey}`).update({
          lastStatus: currentStatus,
          lastStatusChange: now,
          name: ride.name
        });
      }
      // If status has changed from closed to open, update the last status
      else if (currentStatus && rideData.lastStatus === false) {
        console.log(`${ride.name} status changed to open`);
        await database.ref(`rideStatus/${rideKey}`).update({
          lastStatus: currentStatus,
          lastStatusChange: null,
          name: ride.name
        });
      }
      // If this is the first time we're seeing this ride, just record its status
      else if (rideData.lastStatus === undefined) {
        console.log(`First time seeing ${ride.name}, status: ${currentStatus ? 'open' : 'closed'}`);
        await database.ref(`rideStatus/${rideKey}`).set({
          lastStatus: currentStatus,
          lastStatusChange: !currentStatus ? now : null,
          name: ride.name
        });
      }
    } catch (error) {
      console.error(`Error updating ride status for ${ride.name}:`, error);
    }
  });
  
  await Promise.all(updatePromises);
}

async function main() {
  try {
    console.log('Fetching ride data...');
    const data = await fetchRideData();
    
    // Extract all rides
    let allRides = [];
    if (data.lands) {
      data.lands.forEach(land => {
        if (land.rides) {
          allRides = allRides.concat(land.rides);
        }
      });
    }
    if (data.rides) {
      allRides = allRides.concat(data.rides);
    }
    
    console.log(`Found ${allRides.length} rides. Updating status history...`);
    await updateRideStatusHistory(allRides);
    
    console.log('Done updating ride status history.');
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  } finally {
    // Ensure Firebase connection is closed
    admin.app().delete();
  }
}

main();
