// server.js

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage'); // NEW: For file storage
const multer = require('multer'); // NEW: For handling file uploads
const { v4: uuidv4 } = require('uuid'); // NEW: For unique file names

// --- 1. SETUP AND INITIALIZATION ---
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({
  credential: cert(serviceAccount),
  storageBucket: `${process.env.PROJECT_ID}.appspot.com` // IMPORTANT: Set your bucket name
});

const db = getFirestore();
const bucket = getStorage().bucket(); // NEW: Initialize storage bucket

const app = express();
const server = http.createServer(app);
const io = new Server(server); // No need for maxHttpBufferSize anymore
const PORT = process.env.PORT || 3000;

// --- 2. FILE UPLOAD HANDLING ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit per file
});

app.post('/upload-image', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
    }

    // If this is an edit, delete the old image first
    if (req.body.oldImageUrl) {
        try {
            const oldFileName = req.body.oldImageUrl.split('/').pop().split('?')[0];
            await bucket.file(decodeURIComponent(oldFileName)).delete();
            console.log(`[STORAGE] Deleted old file: ${oldFileName}`);
        } catch (error) {
            console.error("Failed to delete old image, it might not exist:", error.message);
        }
    }

    const fileName = `${uuidv4()}.jpg`;
    const file = bucket.file(fileName);

    const stream = file.createWriteStream({
        metadata: { contentType: req.file.mimetype },
    });

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
  socket.on('requestInitialData', async () => {
    try {
      // Fetching logic is unchanged
      const chatSnapshot = await db.collection('chat').orderBy('timestamp').get();
      const chatHistory = chatSnapshot.docs.map(doc => doc.data());
      socket.emit('chatHistory', chatHistory);
      const listASnapshot = await db.collection('rankingLists').doc('listA').get();
      const listBSnapshot = await db.collection('rankingLists').doc('listB').get();
      const listA = listASnapshot.exists ? listASnapshot.data().items : [];
      const listB = listBSnapshot.exists ? listBSnapshot.data().items : [];
      const headersDoc = await db.collection('appState').doc('headers').get();
      const headers = headersDoc.exists ? headersDoc.data() : { headerA: 'Ben', headerB: 'Steve' };
      socket.emit('initialData', { lists: { listA, listB }, headers });
    } catch (error) { console.error("Initial data fetch error:", error); }
  });

  // All other socket listeners are unchanged from the previous version
  socket.on('updateLists', async (lists) => { /* ... unchanged ... */ });
  socket.on('updateHeaders', async (headers) => { /* ... unchanged ... */ });
  socket.on('chatMessage', async (msg) => { /* ... unchanged ... */ });
  socket.on('editMessage', async ({ id, text }) => { /* ... unchanged ... */ });
  socket.on('deleteMessage', async ({ id }) => { /* ... unchanged ... */ });
  socket.on('userColorChange', ({ user, color }) => { /* ... unchanged ... */ });
  socket.on('clearChat', async () => { /* ... unchanged ... */ });
  socket.on('disconnect', () => { /* ... unchanged ... */ });
});

// --- UNCHANGED SOCKET LOGIC (for brevity, add the full blocks from the previous response) ---
io.on('connection', (socket) => {
    // Paste the full io.on('connection', ...) block from the previous response here
    // No changes are needed inside it.
});


server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});