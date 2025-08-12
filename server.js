// server.js

// --- 1. SETUP AND INITIALIZATION ---

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- 2. SERVE THE WEBSITE ---

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});


// --- 3. HELPER FUNCTION TO DELETE A COLLECTION ---
async function deleteCollection(db, collectionPath, batchSize) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
        // When there are no documents left, we are done
        resolve();
        return;
    }

    // Delete documents in a batch
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    // Recurse on the next process tick, to avoid
    // exploding the stack.
    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}


// --- 4. REAL-TIME COMMUNICATION (SOCKET.IO) ---

io.on('connection', (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);

  // --- Initial Data Load ---
  socket.on('requestInitialData', async () => {
    console.log(`[REQUEST] User ${socket.id} requested initial data.`);
    try {
      const chatSnapshot = await db.collection('chat').orderBy('timestamp').get();
      const chatHistory = chatSnapshot.docs.map(doc => doc.data());
      socket.emit('chatHistory', chatHistory);

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


  // --- Chat Handling ---
  socket.on('chatMessage', async (msg) => {
    console.log(`[CHAT] Received message from ${msg.user}`);
    const messageData = { ...msg, timestamp: new Date() };
    try {
        await db.collection('chat').add(messageData);
        io.emit('chatMessage', messageData); // Broadcast to all
    } catch (error) {
        console.error("[ERROR] Failed to save chat message:", error);
    }
  });

  // --- Clear Chat Handling ---
  socket.on('clearChat', async () => {
    console.log(`[CHAT] Received 'clearChat' command.`);
    try {
        await deleteCollection(db, 'chat', 50);
        console.log('[SUCCESS] Chat history cleared from database.');
        io.emit('chatCleared'); // Notify all clients
    } catch (error) {
        console.error("[ERROR] Failed to clear chat:", error);
    }
  });


  // --- Ranking List Handling ---
  socket.on('updateLists', async (lists) => {
    console.log(`[RANKING] Received 'updateLists' command.`);
    try {
        await db.collection('rankingLists').doc('listA').set({ items: lists.listA });
        await db.collection('rankingLists').doc('listB').set({ items: lists.listB });
        console.log('[SUCCESS] Ranking lists saved to database.');
        // Broadcast the confirmed new state to ALL clients
        io.emit('rankingLists', lists);
    } catch (error) {
        console.error("[ERROR] Failed to update ranking lists:", error);
    }
  });
  

  // --- Disconnect Handling ---
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
  });
});


// --- 5. START THE SERVER ---

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
