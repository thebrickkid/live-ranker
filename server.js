// server.js

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// --- 1. SETUP AND INITIALIZATION ---
// FINAL CHANGE: Read credentials directly from the environment variable
const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

initializeApp({
  credential: cert(serviceAccount),
  projectId: 'bb-ranker',
  storageBucket: 'bb-ranker.appspot.com' 
});

const db = getFirestore();
const bucket = getStorage().bucket();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- 2. FILE UPLOAD HANDLING ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

app.post('/upload-image', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
    }
    if (req.body.oldImageUrl) {
        try {
            const oldFileName = req.body.oldImageUrl.split('/').pop().split('?')[0];
            if (oldFileName) await bucket.file(decodeURIComponent(oldFileName)).delete();
        } catch (error) {
            console.error("Failed to delete old image, it might not exist:", error.message);
        }
    }
    const fileName = `${uuidv4()}.jpg`;
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({ metadata: { contentType: req.file.mimetype } });
    stream.on('error', (err) => {
        console.error('File stream error:', err);
        res.status(500).json({ error: 'Failed to upload image.' });
    });
    stream.on('finish', async () => {
        await file.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        res.status(200).json({ imageUrl: publicUrl });
    });
    stream.end(req.file.buffer);
});


// --- 3. SERVE THE WEBSITE & SOCKET.IO LOGIC ---
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
    socket.on('requestInitialData', async () => { try { const chatSnapshot = await db.collection('chat').orderBy('timestamp').get(); const chatHistory = chatSnapshot.docs.map(doc => doc.data()); socket.emit('chatHistory', chatHistory); const listASnapshot = await db.collection('rankingLists').doc('listA').get(); const listBSnapshot = await db.collection('rankingLists').doc('listB').get(); const listA = listASnapshot.exists ? listASnapshot.data().items : []; const listB = listBSnapshot.exists ? listBSnapshot.data().items : []; const headersDoc = await db.collection('appState').doc('headers').get(); const headers = headersDoc.exists ? headersDoc.data() : { headerA: 'Ben', headerB: 'Steve' }; socket.emit('initialData', { lists: { listA, listB }, headers }); } catch (error) { console.error("Initial data fetch error:", error); } });
    socket.on('updateLists', async (lists) => { try { await db.collection('rankingLists').doc('listA').set({ items: lists.listA }); await db.collection('rankingLists').doc('listB').set({ items: lists.listB }); io.emit('rankingLists', lists); } catch (error) { console.error("Update lists error:", error); } });
    socket.on('updateHeaders', async (headers) => { try { await db.collection('appState').doc('headers').set(headers); io.emit('headersUpdated', headers); } catch (error) { console.error("Update headers error:", error); } });
    socket.on('chatMessage', async (msg) => { const messageData = { ...msg, timestamp: new Date() }; try { await db.collection('chat').add(messageData); io.emit('chatMessage', messageData); } catch (error) { console.error("Save chat message error:", error); } });
    socket.on('editMessage', async ({ id, text }) => { try { const query = db.collection('chat').where('id', '==', Number(id)); const snapshot = await query.get(); if (snapshot.empty) return; const docRef = snapshot.docs[0].ref; const docData = snapshot.docs[0].data(); await docRef.update({ text: text }); io.emit('messageEdited', { id, text, user: docData.user, color: docData.color }); } catch (error) { console.error("Edit message error:", error); } });
    socket.on('deleteMessage', async ({ id }) => { try { const query = db.collection('chat').where('id', '==', Number(id)); const snapshot = await query.get(); if (snapshot.empty) { console.error(`Admin delete failed: No message found with ID ${id}`); return; } await snapshot.docs[0].ref.delete(); io.emit('messageDeleted', { id }); } catch (error) { console.error("Delete message error:", error); } });
    socket.on('userColorChange', ({ user, color }) => { if (!user) return; socket.broadcast.emit('userColorUpdated', { user, color }); db.collection('chat').where('user', '==', user).get().then(snapshot => { if (snapshot.empty) return; const batch = db.batch(); snapshot.docs.forEach(doc => { batch.update(doc.ref, { color: color }); }); batch.commit().catch(err => console.error("Batch color update error:", err)); }); });
    socket.on('clearChat', async () => { try { const snapshot = await db.collection('chat').get(); if (snapshot.empty) return; const batch = db.batch(); snapshot.docs.forEach(doc => { batch.delete(doc.ref); }); await batch.commit(); io.emit('chatCleared'); } catch (error) { console.error("Clear chat error:", error); } });
    socket.on('disconnect', () => { /* User disconnected */ });
});

server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});