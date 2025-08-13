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
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10 MB limit
});

const PORT = process.env.PORT || 3000;

// --- 2. SERVE THE WEBSITE ---

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
      io.emit('rankingLists', lists);
    } catch (error) {
      console.error("[ERROR] Failed to update ranking lists:", error);
    }
  });

  // --- Chat Handling ---
  socket.on('chatMessage', async (msg) => {
    console.log(`[CHAT] Received message from ${msg.user}`);
    // The message object from the client now includes a unique id
    const messageData = { ...msg, timestamp: new Date() };
    try {
        await db.collection('chat').add(messageData);
        io.emit('chatMessage', messageData);
    } catch (error) {
        console.error("[ERROR] Failed to save chat message:", error);
    }
  });

  // --- NEW: Edit Message Handling ---
  socket.on('editMessage', async ({ id, text }) => {
    try {
        const query = db.collection('chat').where('id', '==', id);
        const snapshot = await query.get();

        if (snapshot.empty) {
            console.log(`[EDIT] Message with id ${id} not found.`);
            return;
        }
        
        const docRef = snapshot.docs[0].ref;
        const docData = snapshot.docs[0].data();

        await docRef.update({ text: text });
        
        // Broadcast the full updated message details
        io.emit('messageEdited', { id, text, user: docData.user });
        console.log(`[SUCCESS] Edited message with id ${id}`);
    } catch (error) {
        console.error("[ERROR] Failed to edit message:", error);
    }
  });

  // --- NEW: Delete Message Handling ---
  socket.on('deleteMessage', async ({ id }) => {
      try {
          const query = db.collection('chat').where('id', '==', id);
          const snapshot = await query.get();

          if (snapshot.empty) {
              console.log(`[DELETE] Message with id ${id} not found.`);
              return;
          }

          await snapshot.docs[0].ref.delete();

          io.emit('messageDeleted', { id });
          console.log(`[SUCCESS] Deleted message with id ${id}`);
      } catch (error) {
          console.error("[ERROR] Failed to delete message:", error);
      }
  });


  // --- Clear Chat Handling ---
  socket.on('clearChat', async () => {
    console.log(`[CHAT] Received 'clearChat' command.`);
    try {
        const chatCollection = db.collection('chat');
        const snapshot = await chatCollection.get();
        
        if (snapshot.empty) return;

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
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