// server.js

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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);

  socket.on('requestInitialData', async () => {
    try {
      const chatSnapshot = await db.collection('chat').orderBy('timestamp').get();
      const chatHistory = chatSnapshot.docs.map(doc => doc.data());
      socket.emit('chatHistory', chatHistory);

      const listASnapshot = await db.collection('rankingLists').doc('listA').get();
      const listBSnapshot = await db.collection('rankingLists').doc('listB').get();
      const listA = listASnapshot.exists ? listASnapshot.data().items : [];
      const listB = listBSnapshot.exists ? listBSnapshot.data().items : [];
      socket.emit('rankingLists', { listA, listB });
    } catch (error) {
      console.error("[ERROR] Failed to fetch initial data:", error);
    }
  });

  socket.on('updateLists', async (lists) => {
    try {
      await db.collection('rankingLists').doc('listA').set({ items: lists.listA });
      await db.collection('rankingLists').doc('listB').set({ items: lists.listB });
      io.emit('rankingLists', lists);
    } catch (error) {
      console.error("[ERROR] Failed to update ranking lists:", error);
    }
  });

  socket.on('chatMessage', async (msg) => {
    const messageData = { ...msg, timestamp: new Date() };
    try {
        await db.collection('chat').add(messageData);
        io.emit('chatMessage', messageData);
    } catch (error) {
        console.error("[ERROR] Failed to save chat message:", error);
    }
  });

  socket.on('editMessage', async ({ id, text }) => {
    try {
        // CHANGE: Ensure ID is treated as a number for the query
        const query = db.collection('chat').where('id', '==', Number(id));
        const snapshot = await query.get();
        if (snapshot.empty) return;
        
        const docRef = snapshot.docs[0].ref;
        const docData = snapshot.docs[0].data();
        await docRef.update({ text: text });
        
        io.emit('messageEdited', { id, text, user: docData.user });
    } catch (error) {
        console.error("[ERROR] Failed to edit message:", error);
    }
  });

  socket.on('deleteMessage', async ({ id }) => {
      try {
          // CHANGE: Ensure ID is treated as a number for the query
          const query = db.collection('chat').where('id', '==', Number(id));
          const snapshot = await query.get();
          if (snapshot.empty) return;
          await snapshot.docs[0].ref.delete();
          io.emit('messageDeleted', { id });
      } catch (error) {
          console.error("[ERROR] Failed to delete message:", error);
      }
  });

  socket.on('clearChat', async () => {
    try {
        const chatCollection = db.collection('chat');
        const snapshot = await chatCollection.get();
        if (snapshot.empty) return;
        const batch = db.batch();
        snapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        await batch.commit();
        io.emit('chatCleared');
    } catch (error) {
        console.error("[ERROR] Failed to clear chat:", error);
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});