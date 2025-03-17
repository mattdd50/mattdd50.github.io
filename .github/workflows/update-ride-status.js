const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK using credentials from environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const database = admin.database();

// Define your parks here – add as many as needed with a unique branch name and JSON URL.
const parks = [
  {
    name: "LegolandWindsor",
    url: "https://queue-times.com/parks/27/queue_times.json"
  },
  {
    name: "PaultonsPark",
    url: "https://queue-times.com/parks/49/queue_times.json"
  },
  // Example additional park:
  // {
  //   name: "AnotherPark",
  //   url: "https://queue-times.com/parks/XX/queue_times.json"
  // },
];

async function fetchRideData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching ride data:', error);
    throw error;
  }
}

async function updateRideDataForPark(park, data) {
  const now = new Date().getTime();

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
  
  const updatePromises = allRides.map(async (ride) => {
    const rideKey = ride.name.replace(/[.#$/[\]]/g, '_');
    const currentStatus = ride.is_open;
    const waitTime = ride.wait_time;
    
    try {
      const snapshot = await database.ref(`rideStatus/${park.name}/${rideKey}`).once('value');
      const rideData = snapshot.val() || {};

      // Prepare data update object with the current wait time and ride name.
      const updateData = {
        name: ride.name,
        waitTime: waitTime
      };

      // If the ride has just changed from open to closed, record the closure timestamp.
      if (!currentStatus && (rideData.lastStatus === undefined || rideData.lastStatus === true)) {
        console.log(`${ride.name} at ${park.name} changed to closed`);
        updateData.lastStatus = currentStatus;
        updateData.lastStatusChange = now;
      }
      // If the ride has just changed from closed to open, clear the closure timestamp.
      else if (currentStatus && rideData.lastStatus === false) {
        console.log(`${ride.name} at ${park.name} changed to open`);
        updateData.lastStatus = currentStatus;
        updateData.lastStatusChange = null;
      }
      // If this is the first time the ride is seen, record its status.
      else if (rideData.lastStatus === undefined) {
        console.log(`First time seeing ${ride.name} at ${park.name}, status: ${currentStatus ? 'open' : 'closed'}`);
        updateData.lastStatus = currentStatus;
        updateData.lastStatusChange = !currentStatus ? now : null;
      }
      
      await database.ref(`rideStatus/${park.name}/${rideKey}`).update(updateData);
    } catch (error) {
      console.error(`Error updating ride data for ${ride.name} at ${park.name}:`, error);
    }
  });
  
  await Promise.all(updatePromises);
}

async function main() {
  try {
    for (const park of parks) {
      console.log(`Fetching ride data for ${park.name}...`);
      const data = await fetchRideData(park.url);
      console.log(`Updating ride data for ${park.name}...`);
      await updateRideDataForPark(park, data);
    }
    console.log('Done updating ride data for all parks.');
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  } finally {
    // Clean up the Firebase connection.
    admin.app().delete();
  }
}

main();
