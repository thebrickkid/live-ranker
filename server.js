// server.js

// --- 1. SETUP AND INITIALIZATION ---

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore();

// Initialize Express and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with a higher message size limit
// This is the key change to fix the upload limit issue.
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // Set limit to 10 MB (default is 1 MB)
});

const PORT = process.env.PORT || 3000;

// --- 2. SERVE THE WEBSITE ---

// Serve static files from the 'public' directory
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// --- 3. REAL-TIME COMMUNICATION (SOCKET.IO) ---

io.on('connection', (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);

  // --- Initial Data Load ---
  socket.on('requestInitialData', async () => {
    console.log(`[REQUEST] User ${socket.id} requested initial data.`);
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
      console.log(`[SUCCESS] Sent initial data to ${socket.id}`);

    } catch (error) {
      console.error("[ERROR] Failed to fetch initial data:", error);
    }
  });

  // --- Ranking List Handling ---
  socket.on('updateLists', async (lists) => {
    console.log(`[RANKING] Received 'updateLists' command.`);
    try {
      await db.collection('rankingLists').doc('listA').set({ items: lists.listA });
      await db.collection('rankingLists').doc('listB').set({ items: lists.listB });
      console.log('[SUCCESS] Ranking lists saved to database.');
      // Broadcast the updated lists to all clients
      io.emit('rankingLists', lists);
    } catch (error) {
      console.error("[ERROR] Failed to update ranking lists:", error);
    }
  });

  // --- Chat Handling ---
  socket.on('chatMessage', async (msg) => {
    console.log(`[CHAT] Received message from ${msg.user}`);
    const messageData = { ...msg, timestamp: new Date() };
    try {
        await db.collection('chat').add(messageData);
        // Broadcast the new message to all clients
        io.emit('chatMessage', messageData);
    } catch (error) {
        console.error("[ERROR] Failed to save chat message:", error);
    }
  });

  // --- Clear Chat Handling ---
  socket.on('clearChat', async () => {
    console.log(`[CHAT] Received 'clearChat' command.`);
    try {
        const chatCollection = db.collection('chat');
        const snapshot = await chatCollection.get();
        
        if (snapshot.empty) {
            console.log("[INFO] Chat collection is already empty.");
            io.emit('chatCleared');
            return;
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        console.log(`[SUCCESS] Deleted ${snapshot.size} chat messages.`);
        io.emit('chatCleared');

    } catch (error) {
        console.error("[ERROR] Failed to clear chat:", error);
    }
  });
  
  // --- Disconnect Handling ---
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
  });
});

// --- 4. START THE SERVER ---

server.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});