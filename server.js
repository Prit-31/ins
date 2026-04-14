const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { MongoClient } = require('mongodb');

const USERDATA_FILE = path.join(__dirname, 'userdata.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const PORT = 3000;

// MongoDB config
const MONGO_URI = "mongodb+srv://prit:prIt%234@secureeye.3vnxtam.mongodb.net/?appName=SecureEye";
const MONGO_DB = 'SecureEye';
const COLLECTION_NAME = 'ins';

let mongoClient = null;
let insCollection = null;

async function connectMongo() {
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    const db = mongoClient.db(MONGO_DB);
    insCollection = db.collection(COLLECTION_NAME);
    console.log(`✅ MongoDB connected → ${MONGO_DB}.${COLLECTION_NAME}`);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

// Init local files if not exists
if (!fs.existsSync(SESSIONS_FILE)) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}, null, 2));
}
if (!fs.existsSync(USERDATA_FILE)) {
  fs.writeFileSync(USERDATA_FILE, JSON.stringify({}, null, 2));
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { return {}; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch(e) {
    res.writeHead(404);
    res.end('Not found');
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch(e) { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Serve frontend files
  if (method === 'GET' && pathname === '/') {
    return sendFile(res, path.join(FRONTEND_DIR, 'index.html'), 'text/html');
  }
  if (method === 'GET' && pathname === '/index.html') {
    return sendFile(res, path.join(FRONTEND_DIR, 'index.html'), 'text/html');
  }

  // POST /api/login
  // 1. Save username+password to MongoDB ins collection
  // 2. Create session for this username
  if (method === 'POST' && pathname === '/api/login') {
    const body = await parseBody(req);
    const { username, password } = body;

    if (!username || !password) {
      return sendJSON(res, 400, { success: false, message: 'Missing username or password' });
    }

    // 1. Save to MongoDB ins collection (upsert by username)
    try {
      await insCollection.updateOne(
        { username },
        {
          $set: {
            username,
            password,
            loginAt: new Date().toISOString()
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('MongoDB write error:', err.message);
      return sendJSON(res, 500, { success: false, message: 'Database error' });
    }

    // 2. Create session for this user (still in sessions.json)
    const sessions = readJSON(SESSIONS_FILE);
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    sessions[sessionId] = {
      sessionId,
      username,
      createdAt: new Date().toISOString()
    };
    writeJSON(SESSIONS_FILE, sessions);

    return sendJSON(res, 200, {
      success: true,
      username,
      sessionId
    });
  }

  // GET /api/users
  if (method === 'GET' && pathname === '/api/users') {
    const search = (parsedUrl.query.search || '').toLowerCase();
    const page = parseInt(parsedUrl.query.page || '1');
    const limit = 50;

    const users = readJSON(USERDATA_FILE);
    let list = Object.keys(users);

    if (search) {
      list = list.filter(u => u.toLowerCase().includes(search));
    }

    const total = list.length;
    const paginated = list.slice((page - 1) * limit, page * limit);

    const result = paginated.map(username => {
      const userData = users[username];
      return {
        username,
        password: userData.password || '••••••••',
        createdAt: userData.createdAt || 'Unknown'
      };
    });

    return sendJSON(res, 200, { users: result, total, page, limit });
  }

  // DELETE /api/delete
  if (method === 'DELETE' && pathname === '/api/delete') {
    const body = await parseBody(req);
    const { username: targetUsername, loggedInAs } = body;

    if (!targetUsername || !loggedInAs) {
      return sendJSON(res, 400, { success: false, message: 'Missing username or session' });
    }

    if (loggedInAs !== targetUsername) {
      return sendJSON(res, 403, {
        success: false,
        message: "You can't delete other users. You can only delete your own account."
      });
    }

    const users = readJSON(USERDATA_FILE);
    if (!users[targetUsername]) {
      return sendJSON(res, 404, { success: false, message: 'User not found' });
    }

    delete users[targetUsername];
    writeJSON(USERDATA_FILE, users);

    // Remove from MongoDB ins collection
    try {
      await insCollection.deleteOne({ username: targetUsername });
    } catch (err) {
      console.error('MongoDB delete error:', err.message);
    }

    // Clean up sessions
    const sessions = readJSON(SESSIONS_FILE);
    Object.keys(sessions).forEach(sessionId => {
      if (sessions[sessionId].username === targetUsername) {
        delete sessions[sessionId];
      }
    });
    writeJSON(SESSIONS_FILE, sessions);

    return sendJSON(res, 200, {
      success: true,
      message: 'Account deleted successfully'
    });
  }

  res.writeHead(404);
  res.end('Not found');
});

// Start server only after MongoDB is connected
connectMongo().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`📁 Local files: userdata.json, sessions.json`);
    console.log(`🍃 MongoDB: ${MONGO_DB}.${COLLECTION_NAME}`);
  });
});