// server.js

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
const io = new Server(server, { maxHttpBufferSize: 1e7 });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
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
    } catch (error) { console.error("Initial data fetch error:", error); }
  });

  socket.on('updateLists', async (lists) => {
    try {
      await db.collection('rankingLists').doc('listA').set({ items: lists.listA });
      await db.collection('rankingLists').doc('listB').set({ items: lists.listB });
      io.emit('rankingLists', lists);
    } catch (error) { console.error("Update lists error:", error); }
  });

  socket.on('chatMessage', async (msg) => {
    const messageData = { ...msg, timestamp: new Date() };
    try {
        await db.collection('chat').add(messageData);
        io.emit('chatMessage', messageData);
    } catch (error) { console.error("Save chat message error:", error); }
  });

  socket.on('editMessage', async ({ id, text }) => {
    try {
        const query = db.collection('chat').where('id', '==', Number(id));
        const snapshot = await query.get();
        if (snapshot.empty) return;
        
        const docRef = snapshot.docs[0].ref;
        const docData = snapshot.docs[0].data();
        await docRef.update({ text: text });
        
        io.emit('messageEdited', { id, text, user: docData.user, color: docData.color });
    } catch (error) { console.error("Edit message error:", error); }
  });

  socket.on('deleteMessage', async ({ id }) => {
      try {
          const query = db.collection('chat').where('id', '==', Number(id));
          const snapshot = await query.get();
          if (snapshot.empty) return;
          await snapshot.docs[0].ref.delete();
          io.emit('messageDeleted', { id });
      } catch (error) { console.error("Delete message error:", error); }
  });
  
  // CHANGE: New listener for real-time color changes
  socket.on('userColorChange', ({ user, color }) => {
      // Broadcast to all OTHER clients that a user's color has changed
      socket.broadcast.emit('userColorUpdated', { user, color });
      
      // Update the color for all of that user's messages in the database
      db.collection('chat').where('user', '==', user).get().then(snapshot => {
          if (snapshot.empty) return;
          const batch = db.batch();
          snapshot.docs.forEach(doc => {
              batch.update(doc.ref, { color: color });
          });
          batch.commit();
      });
  });

  socket.on('clearChat', async () => {
    try {
        const snapshot = await db.collection('chat').get();
        if (snapshot.empty) return;
        const batch = db.batch();
        snapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        await batch.commit();
        io.emit('chatCleared');
    } catch (error) { console.error("Clear chat error:", error); }
  });
  
  socket.on('disconnect', () => { /* User disconnected */ });
});

server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});