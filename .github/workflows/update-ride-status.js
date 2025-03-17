const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK using credentials from environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const database = admin.database();

async function fetchRideData() {
  try {
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

async function updateRideData(rides) {
  const now = new Date().getTime();
  
  const updatePromises = rides.map(async (ride) => {
    const rideKey = ride.name.replace(/[.#$/[\]]/g, '_');
    const currentStatus = ride.is_open;
    const waitTime = ride.wait_time;
    
    try {
      const snapshot = await database.ref(`rideStatus/${rideKey}`).once('value');
      const rideData = snapshot.val() || {};
      
      // Prepare data update object with the current wait time and name.
      const updateData = {
        name: ride.name,
        waitTime: waitTime
      };

      // If the ride just changed from open to closed, record the closure timestamp.
      if (!currentStatus && (rideData.lastStatus === undefined || rideData.lastStatus === true)) {
        console.log(`${ride.name} status changed to closed`);
        updateData.lastStatus = currentStatus;
        updateData.lastStatusChange = now;
      }
      // If the ride just changed from closed to open, clear the closure timestamp.
      else if (currentStatus && rideData.lastStatus === false) {
        console.log(`${ride.name} status changed to open`);
        updateData.lastStatus = currentStatus;
        updateData.lastStatusChange = null;
      }
      // If this is the first time the ride is seen, record its status and timestamp if closed.
      else if (rideData.lastStatus === undefined) {
        console.log(`First time seeing ${ride.name}, status: ${currentStatus ? 'open' : 'closed'}`);
        updateData.lastStatus = currentStatus;
        updateData.lastStatusChange = !currentStatus ? now : null;
      }
      
      await database.ref(`rideStatus/${rideKey}`).update(updateData);
    } catch (error) {
      console.error(`Error updating ride data for ${ride.name}:`, error);
    }
  });
  
  await Promise.all(updatePromises);
}

async function main() {
  try {
    console.log('Fetching ride data...');
    const data = await fetchRideData();
    
    // Combine rides from nested lands and top-level rides.
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
    
    console.log(`Found ${allRides.length} rides. Updating ride data...`);
    await updateRideData(allRides);
    console.log('Done updating ride data.');
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  } finally {
    // Clean up the Firebase connection.
    admin.app().delete();
  }
}

main();
