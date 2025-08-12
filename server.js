// server.js

// --- 1. SETUP AND INITIALIZATION ---

// Import necessary libraries
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// IMPORTANT: Firebase Setup
// 1. Go to your Firebase project settings -> Service Accounts.
// 2. Click "Generate new private key" and download the JSON file.
// 3. Rename the file to 'serviceAccountKey.json' and place it in the same directory as this server.js file.
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore(); // Connect to our Firestore database

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server); // Initialize Socket.IO

const PORT = process.env.PORT || 3000; // Port to run the server on

// --- 2. SERVE THE WEBSITE ---

// This tells the server to make the 'public' folder accessible to the web.
// We will put our index.html, images, etc., in a folder named 'public'.
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});


// --- 3. REAL-TIME COMMUNICATION (SOCKET.IO) ---

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // --- Initial Data Load ---
  // When a new user connects, send them the latest data from the database.
  socket.on('requestInitialData', async () => {
    try {
      // Fetch Chat History
      const chatSnapshot = await db.collection('chat').orderBy('timestamp').get();
      const chatHistory = chatSnapshot.docs.map(doc => doc.data());
      socket.emit('chatHistory', chatHistory);

      // Fetch Ranking Lists
      const listASnapshot = await db.collection('rankingLists').doc('listA').get();
      const listBSnapshot = await db.collection('rankingLists').doc('listB').get();
      
      const listA = listASnapshot.exists ? listASnapshot.data().items : [];
      const listB = listBSnapshot.exists ? listBSnapshot.data().items : [];
      
      socket.emit('rankingLists', { listA, listB });

    } catch (error) {
      console.error("Error fetching initial data:", error);
    }
  });


  // --- Chat Handling ---
  socket.on('chatMessage', async (msg) => {
    const messageData = {
        ...msg,
        timestamp: new Date() // Add a server-side timestamp
    };
    // Save the message to the database
    await db.collection('chat').add(messageData);
    // Broadcast the message to ALL connected users (including the sender)
    io.emit('chatMessage', messageData);
  });


  // --- Ranking List Handling ---
  socket.on('updateLists', async (lists) => {
    // Save the updated lists to the database
    await db.collection('rankingLists').doc('listA').set({ items: lists.listA });
    await db.collection('rankingLists').doc('listB').set({ items: lists.listB });
    
    // Broadcast the updated lists to all OTHER connected users
    socket.broadcast.emit('rankingLists', lists);
  });
  
  // --- Image Handling ---
  // The frontend will now handle images as data URLs to keep this simple.
  // For actual file uploads, we would need more complex code (e.g., using 'multer').
  // The current approach is robust for this application's needs.


  // --- Disconnect Handling ---
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});


// --- 4. START THE SERVER ---

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
